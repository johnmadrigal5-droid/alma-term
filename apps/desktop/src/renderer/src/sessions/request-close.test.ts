// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { closeWarning, createRequestClose } from './request-close'

describe('closeWarning', () => {
  it('is null when the tab has nothing running', () => {
    expect(closeWarning({ tunnels: 0, transfers: 0 })).toBeNull()
  })

  it('names what would stop, with the right plurals', () => {
    expect(closeWarning({ tunnels: 1, transfers: 0 })?.description).toBe(
      'Se cerrará 1 túnel activo de esta pestaña.',
    )
    expect(closeWarning({ tunnels: 2, transfers: 0 })?.description).toBe(
      'Se cerrarán 2 túneles activos de esta pestaña.',
    )
    expect(closeWarning({ tunnels: 0, transfers: 1 })?.description).toBe(
      'Se cancelará 1 transferencia en curso de esta pestaña.',
    )
    expect(closeWarning({ tunnels: 0, transfers: 3 })?.description).toBe(
      'Se cancelarán 3 transferencias en curso de esta pestaña.',
    )
    expect(closeWarning({ tunnels: 1, transfers: 2 })?.description).toBe(
      'Se cerrará 1 túnel activo y se cancelarán 2 transferencias en curso de esta pestaña.',
    )
    expect(closeWarning({ tunnels: 1, transfers: 1 })?.description).toBe(
      'Se cerrará 1 túnel activo y se cancelará 1 transferencia en curso de esta pestaña.',
    )
  })
})

describe('createRequestClose', () => {
  function setup(counts: { tunnels: number; transfers: number }) {
    const close = vi.fn()
    const confirm = vi.fn()
    const request = createRequestClose({ counts: () => counts, close, confirm })
    return { request, close, confirm }
  }

  it('closes at once when nothing would be lost', () => {
    const { request, close, confirm } = setup({ tunnels: 0, transfers: 0 })
    request('s1')
    expect(close).toHaveBeenCalledWith('s1')
    expect(confirm).not.toHaveBeenCalled()
  })

  it('asks first when a tunnel or a transfer is running, whichever way the tab was closed', () => {
    const { request, close, confirm } = setup({ tunnels: 1, transfers: 0 })
    request('s1')
    expect(close).not.toHaveBeenCalled()
    expect(confirm).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ title: 'Cerrar la pestaña' }),
    )
  })

  it('counts only the tab being closed', () => {
    const counts = vi.fn(() => ({ tunnels: 0, transfers: 0 }))
    createRequestClose({ counts, close: vi.fn(), confirm: vi.fn() })('s7')
    expect(counts).toHaveBeenCalledWith('s7')
  })
})
