import type { ThemeName } from '@alma/protocol'
import { Moon, Sun } from 'lucide-react'

interface Props {
  theme: ThemeName
  onToggle(): void
}

/** Switches between the dark and the light theme; the label names the theme it leads to. */
export function ThemeButton({ theme, onToggle }: Props) {
  const toLight = theme === 'dark'
  const Icon = toLight ? Sun : Moon
  return (
    <button
      type="button"
      aria-label={toLight ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      title={toLight ? 'Tema claro' : 'Tema oscuro'}
      className="no-drag grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-s1 hover:text-text"
      onClick={onToggle}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  )
}
