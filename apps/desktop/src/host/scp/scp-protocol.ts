import { isEntryName } from '../sftp/remote-path'

const LINE_LIMIT = 4096
const MAX_SIZE = Number.MAX_SAFE_INTEGER

/** `C<mode> <size> <name>\n`: announces one file to a scp sink. */
export function formatHeader(size: number, name: string, mode = 0o644): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('Tamaño de archivo no válido')
  if (!isEntryName(name) || name.includes('\n')) throw new Error('Nombre de archivo no válido')
  return Uint8Array.from(Buffer.from(`C${mode.toString(8).padStart(4, '0')} ${size} ${name}\n`))
}

export type AckResult =
  | { ok: true }
  | {
      ok: false
      /** 2 and protocol violations end the transfer; 1 is a warning the server survives. */
      fatal: boolean
      message: string
    }

/** Reads the one-byte acknowledgements a scp peer sends: 0, or 1/2 plus a message line. */
export class AckReader {
  private message: number[] | null = null
  private fatal = false

  feed(chunk: Uint8Array): AckResult[] {
    const results: AckResult[] = []
    for (const byte of chunk) {
      if (this.message) {
        if (byte !== 0x0a) {
          this.message.push(byte)
          continue
        }
        results.push({
          ok: false,
          fatal: this.fatal,
          message: Buffer.from(this.message).toString('utf8'),
        })
        this.message = null
      } else if (byte === 0) results.push({ ok: true })
      else if (byte === 1 || byte === 2) {
        this.message = []
        this.fatal = byte === 2
      } else results.push({ ok: false, fatal: true, message: 'Respuesta SCP inesperada' })
    }
    return results
  }
}

export type SourceEvent =
  | { type: 'header'; size: number; name: string }
  | { type: 'data'; bytes: Uint8Array }
  | { type: 'end' }
  | { type: 'error'; message: string; fatal: boolean }

/**
 * Reads what a scp source sends for one file: an optional `T` line, the `C` header, exactly
 * `size` bytes and a terminating zero. Never hands out more than the header announced.
 */
export class ScpSourceParser {
  private phase: 'line' | 'data' | 'trailer' | 'done' = 'line'
  private line: number[] = []
  private remaining = 0

  feed(chunk: Uint8Array): SourceEvent[] {
    const events: SourceEvent[] = []
    let offset = 0
    while (offset < chunk.length && this.phase !== 'done') {
      if (this.phase === 'line') {
        const byte = chunk[offset++] as number
        if (byte !== 0x0a) {
          this.line.push(byte)
          if (this.line.length > LINE_LIMIT) events.push(this.fail('Cabecera SCP demasiado larga'))
          continue
        }
        const event = this.header()
        if (event) events.push(event)
      } else if (this.phase === 'data') {
        const take = Math.min(this.remaining, chunk.length - offset)
        events.push({ type: 'data', bytes: chunk.subarray(offset, offset + take) })
        offset += take
        this.remaining -= take
        if (this.remaining === 0) this.phase = 'trailer'
      } else {
        const byte = chunk[offset++]
        if (byte === 0) {
          this.phase = 'done'
          events.push({ type: 'end' })
        } else events.push(this.fail('El servidor no cerró el archivo como esperaba SCP'))
      }
    }
    return events
  }

  private fail(message: string, fatal = true): SourceEvent {
    this.phase = 'done'
    return { type: 'error', message, fatal }
  }

  private header(): SourceEvent | null {
    const bytes = this.line
    this.line = []
    const first = bytes[0]
    if (first === 1 || first === 2)
      return this.fail(Buffer.from(bytes.slice(1)).toString('utf8'), first === 2)
    const line = Buffer.from(bytes).toString('utf8')
    if (first === 0x54 /* T */) return null
    if (first === 0x44 /* D */)
      return this.fail('SCP solo transfiere archivos sueltos, no carpetas')
    const match = /^C([0-7]{4}) (\d+) ([^]+)$/.exec(line)
    if (!match) return this.fail('Cabecera SCP no válida')
    const size = Number(match[2])
    const name = match[3] as string
    if (!Number.isSafeInteger(size) || size > MAX_SIZE || !isEntryName(name))
      return this.fail('Cabecera SCP no válida')
    this.remaining = size
    this.phase = size === 0 ? 'trailer' : 'data'
    return { type: 'header', size, name }
  }
}
