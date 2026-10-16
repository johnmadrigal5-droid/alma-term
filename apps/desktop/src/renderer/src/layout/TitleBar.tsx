import {
  Columns2,
  Grid2x2,
  Plus,
  Radio,
  Rows2,
  Search,
  Square,
  SquareTerminal,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useRef, type KeyboardEvent } from 'react'
import { Button } from '../components/ui/button'
import { StatusDot } from '../components/StatusDot'
import type { ThemeName } from '@alma/protocol'
import type { Tab } from '../state/sessions-store'
import { ThemeButton } from '../theme/ThemeButton'
import { PRESETS, TAB_MIME, type LayoutPreset } from './panes'

const ICONS: Record<LayoutPreset, LucideIcon> = {
  single: Square,
  columns: Columns2,
  rows: Rows2,
  grid: Grid2x2,
}

interface Props {
  tabs: readonly Tab[]
  activeId: string | null
  platform: string
  onSelect(sessionId: string): void
  onClose(sessionId: string): void
  onNew(): void
  onPalette(): void
  preset: LayoutPreset
  onPreset(preset: LayoutPreset): void
  multiExecOpen: boolean
  onMultiExec(): void
  theme: ThemeName
  onToggleTheme(): void
}

/** Pane presets as a radio group: arrows move the choice, like native radios. */
function PresetPicker({ preset, onPreset }: Pick<Props, 'preset' | 'onPreset'>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (step === undefined) return
    event.preventDefault()
    const index = PRESETS.findIndex((p) => p.preset === preset)
    const next = (index + step + PRESETS.length) % PRESETS.length
    const target = PRESETS[next]
    if (!target) return
    onPreset(target.preset)
    buttons.current[next]?.focus()
  }
  return (
    <div
      role="radiogroup"
      aria-label="Distribución de paneles"
      className="no-drag flex items-center gap-1"
      onKeyDown={onKeyDown}
    >
      {PRESETS.map(({ preset: value, label }, i) => {
        const Icon = ICONS[value]
        const checked = preset === value
        return (
          <button
            key={value}
            ref={(el) => {
              buttons.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked ? 0 : -1}
            className={`grid h-7 w-7 cursor-pointer place-items-center rounded-md ${
              checked ? 'bg-s2 text-text' : 'text-faint hover:bg-s1 hover:text-muted'
            }`}
            onClick={() => onPreset(value)}
          >
            <Icon size={14} aria-hidden />
          </button>
        )
      })}
    </div>
  )
}

export function TitleBar({
  tabs,
  activeId,
  platform,
  onSelect,
  onClose,
  onNew,
  onPalette,
  preset,
  onPreset,
  multiExecOpen,
  onMultiExec,
  theme,
  onToggleTheme,
}: Props) {
  const hint = platform === 'darwin' ? '⌘K' : 'Ctrl K'
  // Leave room for macOS traffic lights (left) or the window controls overlay (right).
  const inset = platform === 'darwin' ? 'pl-20 pr-2' : 'pl-2 pr-36'
  return (
    <header className={`drag flex h-10 shrink-0 items-center gap-2 bg-canvas ${inset}`}>
      <span
        aria-hidden="true"
        className="grid h-6 w-6 place-items-center rounded-md bg-accent text-white"
      >
        <SquareTerminal size={14} />
      </span>
      <div className="no-drag flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2">
        {/* No tablist while there are no tabs: an empty one breaks aria-required-children. */}
        {tabs.length > 0 && (
          <div role="tablist" aria-label="Sesiones abiertas" className="flex items-center gap-1">
            {tabs.map((tab) => {
              const active = tab.sessionId === activeId
              return (
                <button
                  key={tab.sessionId}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`flex h-7 shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-md pl-2 pr-1 ${active ? 'bg-s2 font-medium text-text' : 'text-muted hover:bg-s1'}`}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(TAB_MIME, tab.sessionId)
                    e.dataTransfer.effectAllowed = 'move'
                  }}
                  onClick={() => onSelect(tab.sessionId)}
                  onKeyDown={(e) => {
                    // Keyboard way to close (the x below is for the pointer: a button inside a
                    // tablist would not be valid ARIA).
                    if (e.key === 'Delete') {
                      e.preventDefault()
                      onClose(tab.sessionId)
                    }
                  }}
                >
                  <StatusDot status={tab.status} />
                  <span>{tab.title}</span>
                  <span
                    data-close=""
                    aria-hidden="true"
                    className="grid h-5 w-5 place-items-center rounded text-faint hover:bg-s3 hover:text-text"
                    onClick={(e) => {
                      e.stopPropagation()
                      onClose(tab.sessionId)
                    }}
                  >
                    <X size={12} aria-hidden="true" />
                  </span>
                </button>
              )
            })}
          </div>
        )}
        <Button variant="ghost" size="icon" aria-label="Nueva terminal local" onClick={onNew}>
          <Plus size={14} aria-hidden="true" />
        </Button>
      </div>
      <PresetPicker preset={preset} onPreset={onPreset} />
      <button
        type="button"
        aria-pressed={multiExecOpen}
        aria-keyshortcuts={platform === 'darwin' ? 'Meta+Shift+M' : 'Control+Shift+M'}
        className={`no-drag flex h-7 shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-xs ${
          multiExecOpen ? 'bg-s2 text-accent-text' : 'text-muted hover:bg-s1'
        }`}
        onClick={onMultiExec}
      >
        <Radio size={14} aria-hidden />
        MultiExec
      </button>
      <ThemeButton theme={theme} onToggle={onToggleTheme} />
      <button
        type="button"
        onClick={onPalette}
        aria-keyshortcuts={platform === 'darwin' ? 'Meta+K' : 'Control+K'}
        className="no-drag flex h-7 w-60 shrink-0 cursor-pointer items-center gap-2 rounded-md bg-s1 px-2 text-left text-faint hover:bg-s2 hover:text-muted"
      >
        <Search size={14} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">Conectar, buscar o ejecutar…</span>
        <kbd className="rounded bg-s3 px-1 font-sans text-xs text-muted">{hint}</kbd>
      </button>
    </header>
  )
}
