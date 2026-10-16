// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  AckReader,
  formatHeader,
  ScpSourceParser,
  type AckResult,
  type SourceEvent,
} from './scp-protocol'

const bytes = (...n: number[]) => Uint8Array.from(n)
const text = (s: string) => Uint8Array.from(Buffer.from(s))

describe('formatHeader', () => {
  it('builds the C line with mode, size and name', () => {
    expect(Buffer.from(formatHeader(1234, 'a.txt')).toString()).toBe('C0644 1234 a.txt\n')
    expect(Buffer.from(formatHeader(0, 'x', 0o755)).toString()).toBe('C0755 0 x\n')
  })

  it('refuses names that could break the line or climb out of the folder', () => {
    for (const name of ['', '.', '..', 'a/b', 'a\nb', 'a\0b'])
      expect(() => formatHeader(1, name)).toThrow()
  })

  it('refuses a size that is not a whole non-negative number', () => {
    for (const size of [-1, 1.5, Number.NaN, Infinity])
      expect(() => formatHeader(size, 'a')).toThrow()
  })
})

describe('AckReader', () => {
  const collect = (reader: AckReader, chunks: Uint8Array[]): AckResult[] =>
    chunks.flatMap((c) => reader.feed(c))

  it('reads a plain acknowledgement', () => {
    expect(collect(new AckReader(), [bytes(0)])).toEqual([{ ok: true }])
  })

  it('reads an error message after a 1 or 2, even split in single bytes', () => {
    const msg = [...text('scp: /x: Permission denied\n')]
    const out = collect(new AckReader(), [bytes(1), ...msg.map((b) => bytes(b))])
    expect(out).toEqual([{ ok: false, fatal: false, message: 'scp: /x: Permission denied' }])
    const fatal = collect(new AckReader(), [bytes(2, ...text('no space\n'))])
    expect(fatal).toEqual([{ ok: false, fatal: true, message: 'no space' }])
  })

  it('reads several acknowledgements that arrive together', () => {
    expect(collect(new AckReader(), [bytes(0, 0)])).toEqual([{ ok: true }, { ok: true }])
  })

  it('treats any other byte as a protocol error', () => {
    const [result] = collect(new AckReader(), [bytes(0x43)])
    expect(result).toMatchObject({ ok: false, fatal: true })
  })
})

describe('ScpSourceParser (download)', () => {
  const run = (chunks: Uint8Array[]): SourceEvent[] => {
    const parser = new ScpSourceParser()
    return chunks.flatMap((c) => parser.feed(c))
  }
  const file = (content: string, name = 'f.txt') => [
    ...text(`C0644 ${Buffer.byteLength(content)} ${name}\n`),
    ...text(content),
    0,
  ]

  it('gives the header, the exact bytes and the end', () => {
    const events = run([Uint8Array.from(file('hola'))])
    expect(events[0]).toEqual({ type: 'header', size: 4, name: 'f.txt' })
    expect(
      Buffer.concat(
        events.filter((e) => e.type === 'data').map((e) => Buffer.from(e.bytes)),
      ).toString(),
    ).toBe('hola')
    expect(events.at(-1)).toEqual({ type: 'end' })
  })

  it('copes with any chunking, one byte at a time included', () => {
    const all = file('abc\ndef')
    const events = run(all.map((b) => bytes(b)))
    expect(events[0]).toMatchObject({ type: 'header', size: 7 })
    const data = Buffer.concat(
      events.filter((e) => e.type === 'data').map((e) => Buffer.from(e.bytes)),
    )
    expect(data.toString()).toBe('abc\ndef')
    expect(events.at(-1)).toEqual({ type: 'end' })
  })

  it('never hands out more bytes than the header announced', () => {
    const events = run([Uint8Array.from([...file('hola'), ...text('basura')])])
    const data = Buffer.concat(
      events.filter((e) => e.type === 'data').map((e) => Buffer.from(e.bytes)),
    )
    expect(data.toString()).toBe('hola')
  })

  it('reports a server error line', () => {
    const events = run([Uint8Array.from([1, ...text('scp: nope: No such file or directory\n')])])
    expect(events).toEqual([
      { type: 'error', message: 'scp: nope: No such file or directory', fatal: false },
    ])
  })

  it('rejects a directory announcement, since only single files are transferred', () => {
    const events = run([text('D0755 0 carpeta\n')])
    expect(events[0]).toMatchObject({ type: 'error' })
  })

  it('rejects a name that is not a plain file name, and a malformed header', () => {
    expect(run([text('C0644 1 ../x\n')])[0]).toMatchObject({ type: 'error' })
    expect(run([text('C0644 abc f\n')])[0]).toMatchObject({ type: 'error' })
    expect(run([text('C0644 -5 f\n')])[0]).toMatchObject({ type: 'error' })
  })

  it('ignores time lines the server may send first', () => {
    const events = run([Uint8Array.from([...text('T1 0 1 0\n'), ...file('x')])])
    expect(events[0]).toMatchObject({ type: 'header', size: 1 })
  })

  it('fails when the byte after the data is not the terminating zero', () => {
    const events = run([Uint8Array.from([...text('C0644 1 f\n'), 0x41, 0x42])])
    expect(events.at(-1)).toMatchObject({ type: 'error' })
  })

  it('bounds the header line so a server cannot make it grow forever', () => {
    const events = run([Uint8Array.from(Buffer.alloc(8192, 0x61))])
    expect(events[0]).toMatchObject({ type: 'error' })
  })
})
