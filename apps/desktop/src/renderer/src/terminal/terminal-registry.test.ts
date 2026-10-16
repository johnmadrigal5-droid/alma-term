// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { TerminalRegistry, type TerminalHandle } from './terminal-registry'

const handle = (): TerminalHandle => ({
  modes: () => ({ applicationCursorKeysMode: false, bracketedPasteMode: false }),
  write: vi.fn(),
})

describe('TerminalRegistry', () => {
  it('finds a registered terminal until it unregisters', () => {
    const r = new TerminalRegistry()
    const h = handle()
    const off = r.register('a', h)
    expect(r.get('a')).toBe(h)
    off()
    expect(r.get('a')).toBeUndefined()
  })

  it('an old registration does not remove a newer one (remount)', () => {
    const r = new TerminalRegistry()
    const off = r.register('a', handle())
    const newer = handle()
    r.register('a', newer)
    off()
    expect(r.get('a')).toBe(newer)
  })

  it('delivers input to listeners until they unsubscribe', () => {
    const r = new TerminalRegistry()
    const seen = vi.fn()
    const off = r.onInput(seen)
    r.emitInput('a', { kind: 'keys', data: 'x' })
    off()
    r.emitInput('a', { kind: 'keys', data: 'y' })
    expect(seen).toHaveBeenCalledExactlyOnceWith('a', { kind: 'keys', data: 'x' })
  })
})
