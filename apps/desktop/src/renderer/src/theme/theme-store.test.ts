// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { createThemeStore } from './theme-store'

function setup(
  initial: 'dark' | 'light' = 'dark',
  save = async () => ({ ok: true as const, data: null }),
) {
  const apply = vi.fn()
  const setTheme = vi.fn(save)
  const store = createThemeStore({ initial, setTheme, apply })
  return { store, apply, setTheme }
}

describe('theme store', () => {
  it('starts on the theme the window was opened with', () => {
    expect(setup('light').store.getState().theme).toBe('light')
  })

  it('toggles, applies the tokens and saves the choice', () => {
    const { store, apply, setTheme } = setup('dark')
    store.getState().toggle()
    expect(store.getState().theme).toBe('light')
    expect(apply).toHaveBeenCalledWith('light')
    expect(setTheme).toHaveBeenCalledWith('light')
    store.getState().toggle()
    expect(store.getState().theme).toBe('dark')
  })

  it('keeps the interface on the new theme when saving fails and says so', async () => {
    const { store } = setup(
      'dark',
      async () => ({ ok: false, error: { code: 'IO_FAILED', message: 'x' } }) as never,
    )
    store.getState().toggle()
    await new Promise((r) => setTimeout(r, 0))
    expect(store.getState().theme).toBe('light')
    expect(store.getState().persistError).toBe(true)
  })
})
