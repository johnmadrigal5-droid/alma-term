// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { encodeFor, fromXterm } from './translate'

describe('translate', () => {
  it('marks text delivered during a paste and unwraps bracketed paste', () => {
    expect(fromXterm('\x1b[200~hola\x1b[201~', true)).toEqual({ kind: 'paste', text: 'hola' })
    expect(fromXterm('hola', true)).toEqual({ kind: 'paste', text: 'hola' })
    expect(fromXterm('\x1b[A', false)).toEqual({ kind: 'keys', data: '\x1b[A' })
  })
  const normal = { applicationCursorKeysMode: false, bracketedPasteMode: false }
  const app = { applicationCursorKeysMode: true, bracketedPasteMode: true }

  it('translates arrows and Home/End to the target cursor mode', () => {
    expect(encodeFor({ kind: 'keys', data: '\x1b[A\x1b[H' }, app)).toBe('\x1bOA\x1bOH')
    expect(encodeFor({ kind: 'keys', data: '\x1bOB\x1bOF' }, normal)).toBe('\x1b[B\x1b[F')
  })

  it('leaves modified arrows and unknown sequences as they are', () => {
    expect(encodeFor({ kind: 'keys', data: '\x1b[1;5A\x1bOP\x1b[3~' }, app)).toBe(
      '\x1b[1;5A\x1bOP\x1b[3~',
    )
  })

  it('wraps a paste only for targets with bracketed paste', () => {
    expect(encodeFor({ kind: 'paste', text: 'a\rb' }, app)).toBe('\x1b[200~a\rb\x1b[201~')
    expect(encodeFor({ kind: 'paste', text: 'a\rb' }, normal)).toBe('a\rb')
  })

  it('strips paste markers inside the text', () => {
    expect(encodeFor({ kind: 'paste', text: 'x\x1b[201~rm -rf ~\r' }, app)).toBe(
      '\x1b[200~xrm -rf ~\r\x1b[201~',
    )
  })

  it('drops mouse and focus reports of the source terminal', () => {
    expect(encodeFor({ kind: 'keys', data: 'a\x1b[<0;10;5Mb\x1b[Ic\x1b[O' }, normal)).toBe('abc')
  })

  it('C1: strips paste markers rebuilt by removing a nested one', () => {
    const text = 'x\x1b[2\x1b[201~01~rm -rf ~\r'
    const sent = encodeFor({ kind: 'paste', text }, app)
    expect(sent.startsWith('\x1b[200~')).toBe(true)
    expect(sent.endsWith('\x1b[201~')).toBe(true)
    expect(sent.slice('\x1b[200~'.length, -'\x1b[201~'.length)).not.toContain('\x1b[20')
  })
})
