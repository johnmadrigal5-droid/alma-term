import { PassThrough } from 'node:stream'
import type { ExecChannel } from '../ssh/connector-types'
import { AckReader, formatHeader } from '../scp/scp-protocol'
import { socketPair } from './fake-tunnel-net'

/** Splits a command the way a POSIX shell does for the quoting `shellQuote` produces. */
export function shellArgs(command: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuote = false
  let started = false
  for (let i = 0; i < command.length; i++) {
    const c = command[i] as string
    if (inQuote) {
      if (c === "'") inQuote = false
      else current += c
    } else if (c === "'") {
      inQuote = true
      started = true
    } else if (c === '\\' && command[i + 1] === "'") {
      current += "'"
      i += 1
    } else if (c === ' ') {
      if (started || current !== '') args.push(current)
      current = ''
      started = false
    } else {
      current += c
      started = true
    }
  }
  if (started || current !== '') args.push(current)
  return args
}

/** A server answering the few commands and the scp protocol the fallback uses, in memory. */
export class FakeScpHost {
  readonly files = new Map<string, Buffer>()
  readonly dirs = new Set<string>(['/', '/home', '/home/alma'])
  readonly commands: string[] = []
  readonly modes = new Map<string, number>()
  /** The next command fails with this stderr and exit code 1. */
  failNext: string | null = null

  exec = async (command: string): Promise<ExecChannel> => {
    this.commands.push(command)
    const [io, peer] = socketPair()
    const stderr = new PassThrough()
    let finish: (code: number | null) => void = () => undefined
    const exit = new Promise<number | null>((resolve) => {
      finish = resolve
    })
    // Like ssh2: the exit is reported after the output was delivered, not before.
    const done = (code: number) => {
      stderr.end()
      peer.end()
      // The exit counts once the client read everything the command wrote.
      const report = () => setImmediate(() => finish(code))
      if (io.readableEnded) report()
      else io.once('end', report)
    }
    const channel: ExecChannel = {
      io,
      stderr,
      exit,
      close: () => {
        io.destroy()
        peer.destroy()
        finish(null)
      },
    }
    if (this.failNext !== null) {
      const message = this.failNext
      this.failNext = null
      queueMicrotask(() => {
        stderr.write(message)
        done(1)
      })
      return channel
    }
    queueMicrotask(() => this.serve(command, peer, stderr, done))
    return channel
  }

  private serve(
    command: string,
    peer: NodeJS.ReadWriteStream,
    stderr: PassThrough,
    done: (code: number) => void,
  ) {
    const args = shellArgs(command)
    const fail = (message: string) => {
      stderr.write(message)
      done(1)
    }
    if (command === 'pwd') {
      peer.write('/home/alma\n')
      return done(0)
    }
    if (args[0] === 'scp' && args[1] === '-t')
      return this.sink(args[3] as string, peer, stderr, done)
    if (args[0] === 'scp' && args[1] === '-f')
      return this.source(args[3] as string, peer, stderr, done)
    if (args[0] === 'ls') {
      const dir = (args[3] ?? '').replace(/\/$/, '') || '/'
      if (!this.dirs.has(dir))
        return fail(`ls: cannot access '${dir}': No such file or directory\n`)
      const prefix = dir === '/' ? '/' : `${dir}/`
      const names = new Set<string>()
      for (const d of this.dirs)
        if (d.startsWith(prefix) && d !== dir && !d.slice(prefix.length).includes('/'))
          names.add(`${d.slice(prefix.length)}/`)
      for (const f of this.files.keys())
        if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/'))
          names.add(f.slice(prefix.length))
      peer.write([...names].sort().join('\n') + (names.size > 0 ? '\n' : ''))
      return done(0)
    }
    if (command.startsWith('if [ -d ')) {
      const target = args[3] as string
      if (this.dirs.has(target)) peer.write('d\n')
      else if (this.files.has(target)) peer.write(`f ${this.files.get(target)?.length ?? 0}\n`)
      else peer.write('n\n')
      return done(0)
    }
    if (args[0] === 'mkdir') {
      const target = args[2] as string
      if (this.dirs.has(target))
        return fail(`mkdir: cannot create directory '${target}': File exists\n`)
      this.dirs.add(target)
      return done(0)
    }
    if (args[0] === 'rm') {
      const target = args.at(-1) as string
      if (!this.files.delete(target) && args[1] !== '-f')
        return fail(`rm: cannot remove '${target}': No such file or directory\n`)
      return done(0)
    }
    if (args[0] === 'rmdir') {
      const target = args.at(-1) as string
      const busy = [...this.files.keys(), ...this.dirs].some((p) => p.startsWith(`${target}/`))
      if (busy) return fail(`rmdir: failed to remove '${target}': Directory not empty\n`)
      this.dirs.delete(target)
      return done(0)
    }
    if (args[0] === 'mv') {
      const [from, to] = [args[3] as string, args[4] as string]
      const data = this.files.get(from)
      if (data === undefined) return fail(`mv: cannot stat '${from}': No such file or directory\n`)
      this.files.delete(from)
      this.files.set(to, data)
      return done(0)
    }
    if (args[0] === 'chmod') {
      this.modes.set(args.at(-1) as string, Number.parseInt(args[1] as string, 8))
      return done(0)
    }
    fail(`sh: ${command}: command not found\n`)
  }

  /** `scp -t dir`: receives one file. */
  private sink(
    dir: string,
    peer: NodeJS.ReadWriteStream,
    stderr: PassThrough,
    done: (code: number) => void,
  ) {
    if (!this.dirs.has(dir)) {
      stderr.write(`scp: ${dir}: No such file or directory\n`)
      return done(1)
    }
    peer.write(Buffer.from([0]))
    let line: number[] = []
    let name = ''
    let remaining = 0
    let body: Buffer[] = []
    let phase: 'header' | 'data' | 'trailer' = 'header'
    peer.on('data', (chunk: Buffer) => {
      let offset = 0
      while (offset < chunk.length) {
        if (phase === 'header') {
          const byte = chunk[offset++] as number
          if (byte !== 0x0a) {
            line.push(byte)
            continue
          }
          const match = /^C(\d{4}) (\d+) (.+)$/.exec(Buffer.from(line).toString())
          line = []
          if (!match) {
            peer.write(Buffer.from([1, ...Buffer.from('bad header\n')]))
            return
          }
          remaining = Number(match[2])
          name = match[3] as string
          phase = remaining === 0 ? 'trailer' : 'data'
          peer.write(Buffer.from([0]))
        } else if (phase === 'data') {
          const take = Math.min(remaining, chunk.length - offset)
          body.push(chunk.subarray(offset, offset + take))
          offset += take
          remaining -= take
          if (remaining === 0) phase = 'trailer'
        } else {
          this.files.set(`${dir === '/' ? '' : dir}/${name}`, Buffer.concat(body))
          body = []
          peer.write(Buffer.from([0]))
          done(0)
          return
        }
      }
    })
  }

  /** `scp -f path`: sends one file. */
  private source(
    path: string,
    peer: NodeJS.ReadWriteStream,
    stderr: PassThrough,
    done: (code: number) => void,
  ) {
    const data = this.files.get(path)
    peer.once('data', () => {
      if (data === undefined) {
        peer.write(Buffer.from([1, ...Buffer.from(`scp: ${path}: No such file or directory\n`)]))
        return done(1)
      }
      const name = path.slice(path.lastIndexOf('/') + 1)
      peer.write(formatHeader(data.length, name))
      let acks = 0
      const reader = new AckReader()
      peer.on('data', (c: Buffer) => {
        for (const result of reader.feed(c)) {
          if (!result.ok) return done(1)
          acks += 1
          if (acks === 1) {
            if (data.length > 0) peer.write(data)
            peer.write(Buffer.from([0]))
          } else done(0)
        }
      })
    })
  }
}
