import { tokens, type ThemeName, type ThemeTokens } from './tokens'

const kebab = (key: string) => key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

export function applyTheme(name: ThemeName, root: HTMLElement = document.documentElement): void {
  for (const [key, value] of Object.entries(tokens[name])) {
    root.style.setProperty(`--alma-${kebab(key)}`, value)
  }
  root.dataset['theme'] = name
  root.style.colorScheme = name
}

export function currentTokens(root: HTMLElement = document.documentElement): ThemeTokens {
  return root.dataset['theme'] === 'light' ? tokens.light : tokens.dark
}
