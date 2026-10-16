import type { AlmaApi, ThemeName } from '@alma/protocol'
import { create } from 'zustand'

interface Deps {
  initial: ThemeName
  setTheme: AlmaApi['settings']['setTheme']
  /** Puts the tokens on the page and the terminals (applyTheme). */
  apply(theme: ThemeName): void
}

interface ThemeState {
  theme: ThemeName
  /** The last save failed: the theme still changed, but it will not survive a restart. */
  persistError: boolean
  toggle(): void
}

export function createThemeStore({ initial, setTheme, apply }: Deps) {
  return create<ThemeState>()((set, get) => ({
    theme: initial,
    persistError: false,
    toggle: () => {
      const next: ThemeName = get().theme === 'dark' ? 'light' : 'dark'
      apply(next)
      set({ theme: next })
      void setTheme(next).then(
        (result) => set({ persistError: !result.ok }),
        () => set({ persistError: true }),
      )
    },
  }))
}
