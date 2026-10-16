import { SquareTerminal } from 'lucide-react'
import {
  useCallback,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Button } from '../components/ui/button'
import { ConnectingOverlay } from '../ssh/ConnectingOverlay'
import { errorCopy } from '../ssh/error-copy'
import type { Tab } from '../state/sessions-store'
import { PaneHeader } from './PaneHeader'
import { PaneSeparator } from './PaneSeparator'
import { gridTemplate, paneArea, paneName, TAB_MIME, type LayoutPreset, type Split } from './panes'
import { clampSideWidth, SIDE_HEIGHT, sideLayout } from './side-layout'

export interface PanesView {
  preset: LayoutPreset
  split: Split
  paneOf: Readonly<Record<string, number>>
  front: readonly (string | null)[]
  /** Sessions shown with the MultiExec ring and label. */
  receivers: ReadonlySet<string>
  onSplit(axis: 'x' | 'y', ratio: number): void
  onMove(sessionId: string, pane: number): void
  onFocusPane(pane: number): void
  onActivate(sessionId: string): void
}

const SINGLE: PanesView = {
  preset: 'single',
  split: { x: 0.5, y: 0.5 },
  paneOf: {},
  front: [],
  receivers: new Set(),
  onSplit: () => undefined,
  onMove: () => undefined,
  onFocusPane: () => undefined,
  onActivate: () => undefined,
}

export interface SidePanel {
  visible: boolean
  width: number
  onSideWidth(width: number): void
  renderSide(tab: Tab): ReactNode
}

interface Props {
  tabs: readonly Tab[]
  activeId: string | null
  openError: string | null
  platform: string
  onOpenLocal(): void
  onReopen(sessionId: string): void
  onCloseTab(sessionId: string): void
  onRetry(sessionId: string): void
  onEdit(sessionId: string): void
  renderTerminal(tab: Tab, active: boolean): ReactNode
  /** SFTP next to the active SSH tab; absent in tests that do not need it. */
  side?: SidePanel
  /** Split layout; absent means one pane showing the active tab. */
  panes?: PanesView
}

const KEY_STEP = 16

function SideSeparator({ width, onSideWidth }: Pick<SidePanel, 'width' | 'onSideWidth'>) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const onKeyDown = (event: KeyboardEvent) => {
    const delta = { ArrowLeft: KEY_STEP, ArrowRight: -KEY_STEP }[event.key]
    if (delta === undefined) return
    event.preventDefault()
    onSideWidth(clampSideWidth(width + delta))
  }
  return (
    <div
      role="separator"
      aria-label="Ancho del panel SFTP"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={240}
      aria-valuemax={560}
      tabIndex={0}
      className="w-1 shrink-0 cursor-col-resize rounded bg-transparent outline-none hover:bg-s3 focus-visible:bg-accent"
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { x: e.clientX, width }
      }}
      onPointerMove={(e) => {
        const start = drag.current
        if (start) onSideWidth(clampSideWidth(start.width + start.x - e.clientX))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
    />
  )
}

/**
 * Width of the work area, to put the side panel right of the terminal or below it. A callback
 * ref: the area only exists once a tab is open, long after the first render.
 */
function useWidth() {
  const [width, setWidth] = useState(Number.POSITIVE_INFINITY)
  const observer = useRef<ResizeObserver | null>(null)
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect()
    observer.current = null
    if (!el) return
    observer.current = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.current.observe(el)
  }, [])
  return { ref, width }
}

function SessionOverlay({
  tab,
  onReopen,
  onCloseTab,
}: { tab: Tab } & Pick<Props, 'onReopen' | 'onCloseTab'>) {
  const lost = tab.status === 'lost'
  const dropped = lost && tab.lostBy === 'connection'
  return (
    <div
      role={lost ? 'alert' : 'status'}
      className="absolute inset-0 grid place-items-center bg-canvas/85"
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="m-0 text-base font-semibold text-text">
          {dropped ? 'Conexión perdida' : lost ? 'Sesión perdida' : 'La sesión terminó'}
        </h2>
        <p className="m-0 text-muted">
          {dropped
            ? 'La conexión con el servidor se cortó. El contenido se conserva.'
            : lost
              ? 'El proceso de sesiones se reinició y esta terminal se cerró.'
              : `Código de salida ${tab.exitCode ?? 'desconocido'}`}
        </p>
        <div className="flex gap-2">
          <Button onClick={() => onCloseTab(tab.sessionId)}>Cerrar pestaña</Button>
          <Button variant="primary" onClick={() => onReopen(tab.sessionId)}>
            {dropped ? 'Reconectar' : lost ? 'Abrir de nuevo' : 'Reabrir'}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ErrorOverlay({
  tab,
  onRetry,
  onEdit,
  onCloseTab,
}: { tab: Tab } & Pick<Props, 'onRetry' | 'onEdit' | 'onCloseTab'>) {
  const code = tab.error?.code ?? 'HOST_UNAVAILABLE'
  const text = errorCopy(code)
  return (
    <div role="alert" className="absolute inset-0 grid place-items-center bg-canvas/85">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <h2 className="m-0 text-base font-semibold text-err">{text.title}</h2>
        <p className="m-0 leading-normal text-muted">{text.description}</p>
        <div className="flex gap-2">
          <Button onClick={() => onCloseTab(tab.sessionId)}>Cerrar pestaña</Button>
          {text.actions.includes('edit') && (
            <Button onClick={() => onEdit(tab.sessionId)}>Editar sesión</Button>
          )}
          {text.actions.includes('retry') && (
            <Button variant="primary" onClick={() => onRetry(tab.sessionId)}>
              Reintentar
            </Button>
          )}
        </div>
        {tab.error && (
          <details className="w-full text-left text-xs text-muted">
            <summary className="cursor-pointer">Detalles técnicos</summary>
            <p className="m-0 mt-2">Código: {tab.error.code}</p>
            <code className="mt-2 block break-all rounded-md bg-s2 p-2 font-mono">
              {tab.error.message}
            </code>
          </details>
        )}
      </div>
    </div>
  )
}

function TabOverlay({ tab, ...props }: { tab: Tab } & Props) {
  switch (tab.status) {
    case 'ready':
      return null
    case 'connecting':
      return (
        <ConnectingOverlay
          title={tab.title}
          step={tab.step}
          onCancel={() => props.onCloseTab(tab.sessionId)}
        />
      )
    case 'error':
      return <ErrorOverlay tab={tab} {...props} />
    default:
      return <SessionOverlay tab={tab} onReopen={props.onReopen} onCloseTab={props.onCloseTab} />
  }
}

export function Workspace(props: Props) {
  const { tabs, activeId, openError, platform, onOpenLocal, renderTerminal, side } = props
  const area = useWidth()
  const layout = sideLayout(area.width)
  const activeTab = tabs.find((t) => t.sessionId === activeId)
  const sideTab =
    side?.visible && activeTab?.kind === 'ssh' && activeTab.status === 'ready' ? activeTab : null
  const shortcut = platform === 'darwin' ? '⌘ ⇧ T' : 'Ctrl ⇧ T'
  const view = props.panes ?? { ...SINGLE, front: [activeId] }
  const multi = view.preset !== 'single'
  const template = gridTemplate(view.preset, view.split)
  const dropTab = (pane: number) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(TAB_MIME)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    },
    onDrop: (e: DragEvent) => {
      const id = e.dataTransfer.getData(TAB_MIME)
      if (!id) return
      e.preventDefault()
      view.onMove(id, pane)
    },
  })
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 pb-2 pr-2">
      {openError && (
        <div role="alert" className="flex items-center gap-2 rounded-lg bg-s1 px-4 py-2 text-err">
          <span className="flex-1">No se pudo abrir la terminal: {openError}</span>
          <Button size="sm" onClick={onOpenLocal}>
            Reintentar
          </Button>
        </div>
      )}
      {tabs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-lg bg-s1 text-center">
          <span
            aria-hidden="true"
            className="grid h-12 w-12 place-items-center rounded-xl bg-s2 text-muted"
          >
            <SquareTerminal size={24} />
          </span>
          <h2 className="m-0 text-base font-semibold">Abre una terminal para empezar</h2>
          <p className="m-0 text-muted">
            Atajo: <kbd className="rounded bg-s3 px-1 font-mono text-xs text-text">{shortcut}</kbd>
          </p>
          <Button variant="primary" onClick={onOpenLocal}>
            Abrir terminal local
          </Button>
        </div>
      ) : (
        <div
          ref={area.ref}
          className={`flex min-h-0 flex-1 gap-1 ${layout === 'below' ? 'flex-col' : 'flex-row'}`}
        >
          <div
            className="grid min-h-0 min-w-0 flex-1"
            style={{ gridTemplateColumns: template.columns, gridTemplateRows: template.rows }}
          >
            {tabs.map((tab) => {
              const pane = view.paneOf[tab.sessionId] ?? 0
              const shown = view.front[pane] === tab.sessionId
              const receiving = view.receivers.has(tab.sessionId)
              return (
                <section
                  key={tab.sessionId}
                  aria-label={`Terminal ${tab.title}`}
                  hidden={!shown}
                  style={{ gridArea: paneArea(view.preset, pane) }}
                  className={`relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg bg-term-bg ${
                    receiving ? 'ring-2 ring-inset ring-accent' : ''
                  }`}
                  {...dropTab(pane)}
                >
                  {multi && (
                    <PaneHeader
                      tab={tab}
                      pane={pane}
                      preset={view.preset}
                      receiving={receiving}
                      onMove={view.onMove}
                    />
                  )}
                  {!multi && receiving && (
                    <span className="absolute right-2 top-2 z-10 rounded bg-s2 px-2 text-xs font-medium text-accent-text">
                      Recibe MultiExec
                    </span>
                  )}
                  {/* Only focus in the terminal activates it: the header menu would lose focus to it. */}
                  <div
                    className="relative min-h-0 flex-1"
                    onFocusCapture={() => view.onActivate(tab.sessionId)}
                  >
                    {tab.status !== 'connecting' &&
                      tab.status !== 'error' &&
                      renderTerminal(tab, tab.sessionId === activeId)}
                    <TabOverlay tab={tab} {...props} />
                  </div>
                </section>
              )
            })}
            {view.front.map((id, pane) =>
              id === null ? (
                <section
                  key={`empty-${pane}`}
                  aria-label={`Panel ${paneName(view.preset, pane)}, vacío`}
                  style={{ gridArea: paneArea(view.preset, pane) }}
                  className="flex flex-col items-center justify-center gap-2 rounded-lg bg-s1 p-4 text-center"
                  {...dropTab(pane)}
                >
                  <p className="m-0 text-sm text-muted">Arrastra una pestaña aquí</p>
                  <Button
                    size="sm"
                    onClick={() => {
                      view.onFocusPane(pane)
                      onOpenLocal()
                    }}
                  >
                    Abrir terminal local aquí
                  </Button>
                </section>
              ) : null,
            )}
            {(view.preset === 'columns' || view.preset === 'grid') && (
              <PaneSeparator axis="x" ratio={view.split.x} onSplit={view.onSplit} />
            )}
            {(view.preset === 'rows' || view.preset === 'grid') && (
              <PaneSeparator axis="y" ratio={view.split.y} onSplit={view.onSplit} />
            )}
          </div>
          {sideTab && side && (
            <>
              {layout === 'right' && (
                <SideSeparator width={side.width} onSideWidth={side.onSideWidth} />
              )}
              <div
                className="min-h-0 shrink-0"
                style={layout === 'right' ? { width: side.width } : { height: SIDE_HEIGHT }}
              >
                {side.renderSide(sideTab)}
              </div>
            </>
          )}
        </div>
      )}
    </main>
  )
}
