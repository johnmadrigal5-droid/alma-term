// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { shellQuote } from './shell-quote'

/** What a POSIX shell makes of the quoted text: it must be exactly the original. */
const viaShell = (text: string) =>
  execFileSync('sh', ['-c', `printf %s ${shellQuote(text)}`]).toString()

describe('shellQuote', () => {
  const nasty = [
    'simple',
    'with space',
    "it's",
    "'''",
    '$(rm -rf ~)',
    '`touch /tmp/pwned`',
    '; ls',
    '&& echo x',
    'a\nb',
    '*',
    '~',
    '$HOME',
    '--rf',
    '"dq"',
    'tab\there',
    'back\\slash',
    'ñandú café',
  ]

  it.each(nasty)('round-trips %j through a real shell', (text) => {
    expect(viaShell(text)).toBe(text)
  })

  it('quotes the empty string as an empty argument', () => {
    expect(shellQuote('')).toBe("''")
    expect(viaShell('')).toBe('')
  })

  it('wraps everything in single quotes and escapes the quote itself', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`)
  })

  it('refuses text with a NUL, which no shell argument can carry', () => {
    expect(() => shellQuote('a\0b')).toThrow()
  })
})
