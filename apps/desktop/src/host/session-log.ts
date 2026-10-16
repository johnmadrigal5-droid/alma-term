import { mkdirSync, createWriteStream, type WriteStream } from 'node:fs'
import { join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export interface SessionLogWriter {
  write(bytes: Uint8Array): void
  close(): void
}

export interface SessionLogOptions {
  dir: string
  name: string
  now?: () => Date
  warn?: (message: string) => void
}

const pad = (n: number) => String(n).padStart(2, '0')
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

/** A file-name part: letters, digits and `._@-` only, so a host name cannot leave the folder. */
export function safeName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._@-]+/g, '_').replace(/^\.+/, '')
  return cleaned.slice(0, 80) || 'session'
}

/**
 * Plain text of a terminal stream: escape sequences dropped, backspace and carriage return
 * applied to the current line, every finished line returned. The partial line waits for more.
 */
export class TextLines {
  private readonly decoder = new StringDecoder('utf8')
  private line: string[] = []
  // A carriage return only clears the line once something else is printed: CRLF ends it intact.
  private returned = false
  private escape: 'none' | 'esc' | 'csi' | 'osc' | 'oscEsc' | 'charset' = 'none'

  push(bytes: Uint8Array): string[] {
    const done: string[] = []
    for (const char of this.decoder.write(Buffer.from(bytes))) this.feed(char, done)
    return done
  }

  /** What is left when the session ends. */
  flush(): string | null {
    const rest = this.decoder.end()
    for (const char of rest) this.feed(char, [])
    const text = this.line.join('')
    this.line = []
    return text === '' ? null : text
  }

  private feed(char: string, done: string[]): void {
    switch (this.escape) {
      case 'esc':
        if (char === '[') this.escape = 'csi'
        else if (char === ']') this.escape = 'osc'
        else if (char === '(' || char === ')' || char === '#') this.escape = 'charset'
        else this.escape = 'none'
        return
      case 'csi':
        // Parameters and intermediates run up to a final byte in @..~.
        if (char >= '@' && char <= '~') this.escape = 'none'
        return
      case 'osc':
        if (char === '\x07') this.escape = 'none'
        else if (char === '\x1b') this.escape = 'oscEsc'
        return
      case 'oscEsc':
        this.escape = char === '\\' ? 'none' : 'osc'
        return
      case 'charset':
        this.escape = 'none'
        return
      case 'none':
        break
    }
    if (char === '\r') {
      this.returned = true
      return
    }
    if (char === '\n') {
      done.push(this.line.join(''))
      this.line = []
      this.returned = false
      return
    }
    if (char === '\x1b') {
      this.escape = 'esc'
      return
    }
    const printable = char === '\b' || char === '\t' || char >= ' '
    if (!printable) return
    if (this.returned) {
      this.line = []
      this.returned = false
    }
    if (char === '\b') this.line.pop()
    else this.line.push(char)
  }
}

/** Opens `<dir>/<name>_<date>_<time>.log`; a failure warns once and the session goes on unlogged. */
export function openSessionLog(options: SessionLogOptions): SessionLogWriter {
  const now = options.now ?? (() => new Date())
  const started = now()
  const warn = options.warn ?? (() => undefined)
  const lines = new TextLines()
  let stream: WriteStream | null = null
  let failed = false

  const fail = (error: unknown) => {
    if (failed) return
    failed = true
    stream = null
    warn(
      `no se pudo escribir el registro de sesión: ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  try {
    mkdirSync(options.dir, { recursive: true, mode: 0o700 })
    const file = join(
      options.dir,
      `${safeName(options.name)}_${day(started)}_${clock(started).replaceAll(':', '-')}.log`,
    )
    // Logs hold whatever the terminal showed: readable by the user only.
    stream = createWriteStream(file, { flags: 'a', mode: 0o600 })
    stream.on('error', fail)
    stream.write(
      `# Alma Term session log: ${options.name}\n# Started ${day(started)} ${clock(started)}\n`,
    )
  } catch (error) {
    fail(error)
  }

  const emit = (text: string) => {
    if (!stream || failed) return
    stream.write(`[${day(now())} ${clock(now())}] ${text}\n`)
  }

  return {
    write: (bytes) => {
      if (failed) return
      for (const text of lines.push(bytes)) emit(text)
    },
    close: () => {
      if (failed || !stream) return
      const rest = lines.flush()
      if (rest !== null) emit(rest)
      stream.end()
      stream = null
    },
  }
}
