import { Ellipsis } from 'lucide-react'
import { StatusDot } from '../components/StatusDot'
import { Menu } from '../components/ui/menu'
import type { Tab } from '../state/sessions-store'
import { PANE_COUNT, paneName, type LayoutPreset } from './panes'

interface Props {
  tab: Tab
  pane: number
  preset: LayoutPreset
  receiving: boolean
  onMove(sessionId: string, pane: number): void
}

/** Title of a pane in split layouts, with the keyboard way to move its tab elsewhere. */
export function PaneHeader({ tab, pane, preset, receiving, onMove }: Props) {
  const others = Array.from({ length: PANE_COUNT[preset] }, (_, i) => i).filter((i) => i !== pane)
  return (
    <header className="flex h-7 shrink-0 items-center gap-2 bg-s1 px-2 text-xs">
      <StatusDot status={tab.status} />
      <span className="min-w-0 flex-1 truncate text-muted">{tab.title}</span>
      {receiving && <span className="font-medium text-accent-text">Recibe MultiExec</span>}
      <Menu
        label={`Acciones del panel ${tab.title}`}
        trigger={<Ellipsis size={14} aria-hidden />}
        items={others.map((i) => ({
          label: `Mover al panel ${paneName(preset, i)}`,
          onSelect: () => onMove(tab.sessionId, i),
        }))}
      />
    </header>
  )
}
