import { applyTheme } from './apply-theme'
import { createThemeStore } from './theme-store'

// window.api is read when the module loads: the preload is always there before the renderer.
export const useTheme = createThemeStore({
  initial: window.api.initialTheme,
  setTheme: (theme) => window.api.settings.setTheme(theme),
  apply: (theme) => applyTheme(theme),
})
