import {
  ArrowDownUp,
  FolderPlus,
  Import,
  Plus,
  Search,
  SquareTerminal,
  Waypoints,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '../components/ui/button'
import { SessionTree, type TreeAction } from '../sessions/SessionTree'
import type { TreeRow } from '../sessions/tree-model'

export interface SidebarProps {
  status: 'loading' | 'error' | 'ready'
  error: string | null
  rows: readonly TreeRow[]
  /** No saved sessions at all (as opposed to a search with no results). */
  empty: boolean
  query: string
  onQuery(query: string): void
  onRetry(): void
  onNewSsh(): void
  onNewFolder(): void
  onImport(): void
  onOpenLocal(): void
  onConnect(sessionId: string): void
  onToggle(folderId: string): void
  onAction(action: TreeAction, row: TreeRow): void
  section: SidebarSection
  activeTransfers: number
  activeTunnels: number
  onSection(section: SidebarSection): void
  /** Content of the Transferencias section. */
  transfers: ReactNode
  /** Content of the Túneles section. */
  tunnels: ReactNode
}

export type SidebarSection = 'sessions' | 'tunnels' | 'transfers'

function SectionButton({
  current,
  label,
  icon,
  onClick,
  badge,
  units = ['activa', 'activas'],
}: {
  current: boolean
  label: string
  icon: ReactNode
  onClick(): void
  badge?: number
  /** Singular and plural of what the badge counts, for the accessible name. */
  units?: [string, string]
}) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      aria-label={badge ? `${label}, ${badge} ${badge === 1 ? units[0] : units[1]}` : label}
      onClick={onClick}
      className={`flex h-7 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left ${
        current ? 'bg-s2 text-text' : 'text-muted hover:bg-s1 hover:text-text'
      }`}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {badge ? (
        <span aria-hidden="true" className="rounded-full bg-accent px-2 text-xs text-white">
          {badge}
        </span>
      ) : null}
    </button>
  )
}

function Body(props: SidebarProps) {
  if (props.status === 'loading')
    return (
      <div aria-label="Cargando sesiones" aria-busy="true" className="flex flex-col gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-7 animate-pulse rounded-md bg-s1 motion-reduce:animate-none" />
        ))}
      </div>
    )
  if (props.status === 'error')
    return (
      <div className="flex flex-col items-center gap-2 px-4 text-center">
        <p role="alert" className="m-0 text-err">
          {props.error}
        </p>
        <Button onClick={props.onRetry}>Reintentar</Button>
      </div>
    )
  if (props.empty)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 text-center">
        <h2 className="m-0 text-sm font-semibold text-text">Aún no tienes sesiones</h2>
        <p className="m-0 leading-normal text-muted">
          Guarda un servidor SSH, importa tu ~/.ssh/config o abre una terminal local.
        </p>
        <div className="flex flex-col gap-2">
          <Button variant="primary" onClick={props.onNewSsh}>
            Nueva sesión SSH
          </Button>
          <Button onClick={props.onImport}>Importar ~/.ssh/config</Button>
          <Button onClick={props.onOpenLocal}>Abrir terminal local</Button>
        </div>
      </div>
    )
  if (props.rows.length === 0)
    return <p className="m-0 px-2 text-muted">Ninguna sesión coincide con «{props.query}»</p>
  return (
    <SessionTree
      rows={props.rows}
      onConnect={props.onConnect}
      onToggle={props.onToggle}
      onAction={props.onAction}
    />
  )
}

export function Sidebar(props: SidebarProps) {
  return (
    <aside
      aria-label="Navegación y sesiones"
      className="flex w-60 shrink-0 flex-col gap-2 bg-canvas p-2"
    >
      <nav aria-label="Secciones" className="flex flex-col gap-1">
        <SectionButton
          current={props.section === 'sessions'}
          label="Sesiones"
          icon={<SquareTerminal size={14} aria-hidden="true" />}
          onClick={() => props.onSection('sessions')}
        />
        <SectionButton
          current={props.section === 'tunnels'}
          label="Túneles"
          icon={<Waypoints size={14} aria-hidden="true" />}
          badge={props.activeTunnels}
          units={['activo', 'activos']}
          onClick={() => props.onSection('tunnels')}
        />
        <SectionButton
          current={props.section === 'transfers'}
          label="Transferencias"
          icon={<ArrowDownUp size={14} aria-hidden="true" />}
          badge={props.activeTransfers}
          onClick={() => props.onSection('transfers')}
        />
      </nav>
      {props.section === 'transfers' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{props.transfers}</div>
      ) : props.section === 'tunnels' ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">{props.tunnels}</div>
      ) : (
        <>
          {props.status === 'ready' && !props.empty && (
            <>
              <label className="flex h-8 items-center gap-2 rounded-md bg-s1 px-2 text-muted focus-within:ring-2 focus-within:ring-accent">
                <Search size={14} aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Buscar sesiones"
                  placeholder="Buscar sesiones"
                  value={props.query}
                  onChange={(e) => props.onQuery(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-text outline-none"
                />
              </label>
              <div className="flex gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Nueva sesión SSH"
                  onClick={props.onNewSsh}
                >
                  <Plus size={14} aria-hidden="true" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Nueva carpeta"
                  onClick={props.onNewFolder}
                >
                  <FolderPlus size={14} aria-hidden="true" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Importar ~/.ssh/config"
                  onClick={props.onImport}
                >
                  <Import size={14} aria-hidden="true" />
                </Button>
              </div>
            </>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            <Body {...props} />
          </div>
        </>
      )}
    </aside>
  )
}
