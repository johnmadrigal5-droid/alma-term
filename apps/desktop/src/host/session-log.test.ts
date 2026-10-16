import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openSessionLog, safeName, TextLines } from './session-log'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('TextLines', () => {
  it('returns finished lines and keeps the partial one', () => {
    const lines = new TextLines()
    expect(lines.push(bytes('uno\r\ndos\r\ntr'))).toEqual(['uno', 'dos'])
    expect(lines.push(bytes('es\n'))).toEqual(['tres'])
    expect(lines.flush()).toBeNull()
  })

  it('drops colors, cursor moves and window titles', () => {
    const lines = new TextLines()
    const out = lines.push(
      bytes(
        '\x1b[1;32malma@demo\x1b[0m:\x1b[34m~\x1b[0m$ ls\x1b]0;title\x07\x1b]8;;http://x\x1b\\\r\n',
      ),
    )
    expect(out).toEqual(['alma@demo:~$ ls'])
  })

  it('applies backspace and carriage return to the current line', () => {
    const lines = new TextLines()
    expect(lines.push(bytes('lss\b\r\n'))).toEqual(['ls'])
    expect(lines.push(bytes('10%\r50%\r100%\n'))).toEqual(['100%'])
  })

  it('decodes a character split across chunks', () => {
    const lines = new TextLines()
    const raw = bytes('ñ\n')
    expect(lines.push(raw.slice(0, 1))).toEqual([])
    expect(lines.push(raw.slice(1))).toEqual(['ñ'])
  })

  it('flushes the last partial line', () => {
    const lines = new TextLines()
    lines.push(bytes('prompt$ '))
    expect(lines.flush()).toBe('prompt$ ')
  })
})

describe('safeName', () => {
  it('cannot leave the folder or hide the file', () => {
    const hostile = safeName('../../etc/passwd')
    expect(hostile).not.toMatch(/[/\\]/)
    expect(hostile.startsWith('.')).toBe(false)
    expect(safeName('root@10.0.0.1')).toBe('root@10.0.0.1')
    expect(safeName('...')).toBe('session')
    expect(safeName('a'.repeat(200))).toHaveLength(80)
  })
})

describe('openSessionLog', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const make = () => {
    dir = mkdtempSync(join(tmpdir(), 'alma-log-'))
    return dir
  }
  const wait = (log: { close(): void }) => {
    log.close()
    return new Promise((resolve) => setTimeout(resolve, 50))
  }

  it('writes timestamped plain text to a private file named after the session', async () => {
    const base = make()
    const log = openSessionLog({
      dir: join(base, 'logs'),
      name: 'root@host',
      now: () => new Date(2026, 9, 16, 8, 5, 9),
    })
    log.write(bytes('\x1b[32mhola\x1b[0m\r\nfin'))
    await wait(log)
    const files = readdirSync(join(base, 'logs'))
    expect(files).toEqual(['root@host_2026-10-16_08-05-09.log'])
    const file = join(base, 'logs', files[0] ?? '')
    expect(readFileSync(file, 'utf8')).toBe(
      '# Alma Term session log: root@host\n# Started 2026-10-16 08:05:09\n' +
        '[2026-10-16 08:05:09] hola\n[2026-10-16 08:05:09] fin\n',
    )
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('warns once and never throws when the folder is not writable', () => {
    const base = make()
    const blocker = join(base, 'file')
    writeFileSync(blocker, 'x')
    const warn = vi.fn()
    const log = openSessionLog({ dir: join(blocker, 'logs'), name: 'x', warn })
    expect(() => {
      log.write(bytes('a\n'))
      log.write(bytes('b\n'))
      log.close()
    }).not.toThrow()
    expect(warn).toHaveBeenCalledTimes(1)
  })
})
