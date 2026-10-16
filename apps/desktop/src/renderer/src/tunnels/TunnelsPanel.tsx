import type { SavedTunnel } from '@alma/protocol'
import { BookmarkMinus, Play, Plus, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import { describeTunnel, TYPE_LABEL, tunnelErrorCopy } from './describe-tunnel'
import type { TunnelView } from './tunnels-store'

export interface TunnelsPanelProps {
  views: readonly TunnelView[]
  sessionTitle(sessionId: string): string
  onNew(): void
  onClose(tunnelId: string): void
  /** A failed tunnel: reopen the form with its values. */
  onRetry(view: TunnelView): void
  onClearClosed(): void
  /** Stop keeping a saved tunnel with its session. */
  onForget(tunnelId: string): void
  /** Saved tunnels of the open sessions that are not running now. */
  savedIdle: readonly { tunnel: SavedTunnel; sessionId: string; title: string }[]
  onOpenSaved(sessionId: string, tunnel: SavedTunnel): void
  onForgetSaved(tunnel: SavedTunnel): void
}

function Row({
  view,
  ...props
}: { view: TunnelView } & Pick<
  TunnelsPanelProps,
  'sessionTitle' | 'onClose' | 'onRetry' | 'onForget'
>) {
  const route = describeTunnel(view.spec, view.boundPort)
  const copy = view.error ? tunnelErrorCopy(view.error) : null
  const status =
    view.state === 'opening'
      ? 'Abriendo…'
      : view.state === 'closed'
        ? 'Cerrado'
        : view.state === 'error'
          ? null
          : view.connections === 1
            ? 'Activo · 1 conexión'
            : `Activo · ${view.connections} conexiones`
  const active = view.state === 'open' || view.state === 'opening'
  return (
    <li aria-busy={view.state === 'opening'} className="flex flex-col gap-1 rounded-md bg-s1 p-2">
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-s3 px-1 text-xs text-muted">
          {TYPE_LABEL[view.spec.type]}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={route}>
          {route}
        </span>
        {view.savedTunnelId && (
          <>
            <span className="shrink-0 rounded bg-s3 px-1 text-xs text-muted">Guardado</span>
            <Button
              size="icon"
              variant="ghost"
              aria-label={`Olvidar túnel ${route}`}
              onClick={() => props.onForget(view.tunnelId)}
            >
              <BookmarkMinus size={14} aria-hidden />
            </Button>
          </>
        )}
        {active && (
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Cerrar túnel ${route}`}
            disabled={view.state === 'opening'}
            onClick={() => props.onClose(view.tunnelId)}
          >
            <X size={14} aria-hidden />
          </Button>
        )}
      </div>
      {copy ? (
        <div className="flex items-center gap-2 text-xs">
          <span role="alert" className="min-w-0 flex-1 text-err">
            {copy.title}
          </span>
          {copy.action && (
            <Button size="sm" onClick={() => props.onRetry(view)}>
              {copy.action}
            </Button>
          )}
        </div>
      ) : (
        <p className="m-0 text-xs text-muted">
          {props.sessionTitle(view.sessionId)} · <span>{status}</span>
        </p>
      )}
    </li>
  )
}

/** Tunnels of every open session, with a way to create and close them. */
export function TunnelsPanel({
  views,
  onNew,
  onClearClosed,
  savedIdle,
  onOpenSaved,
  onForgetSaved,
  ...rest
}: TunnelsPanelProps) {
  const closed = views.some((v) => v.state === 'closed' || v.state === 'error')
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Button size="sm" onClick={onNew}>
        <Plus size={14} aria-hidden />
        Nuevo túnel
      </Button>
      {views.length === 0 && savedIdle.length === 0 ? (
        <p className="m-0 px-2 text-sm text-muted">Sin túneles</p>
      ) : (
        <>
          {views.length > 0 && (
            <ul aria-label="Túneles" className="m-0 flex list-none flex-col gap-1 p-0">
              {views.map((view) => (
                <Row key={view.tunnelId} view={view} {...rest} />
              ))}
            </ul>
          )}
          {savedIdle.length > 0 && (
            <section aria-label="Túneles guardados" className="flex flex-col gap-1">
              <h3 className="m-0 px-1 text-xs font-semibold uppercase tracking-wide text-muted">
                Guardados
              </h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {savedIdle.map(({ tunnel, sessionId, title }) => {
                  const route = describeTunnel(tunnel.spec, 0)
                  return (
                    <li key={tunnel.id} className="flex flex-col gap-1 rounded-md bg-s1 p-2">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded bg-s3 px-1 text-xs text-muted">
                          {TYPE_LABEL[tunnel.spec.type]}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={route}>
                          {route}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Abrir túnel guardado ${route}`}
                          onClick={() => onOpenSaved(sessionId, tunnel)}
                        >
                          <Play size={14} aria-hidden />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Olvidar túnel guardado ${route}`}
                          onClick={() => onForgetSaved(tunnel)}
                        >
                          <BookmarkMinus size={14} aria-hidden />
                        </Button>
                      </div>
                      <p className="m-0 text-xs text-muted">
                        {title}
                        {tunnel.autoStart ? ' · Se abre al conectar' : ''}
                      </p>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </>
      )}
      {closed && (
        <Button size="sm" variant="ghost" onClick={onClearClosed}>
          Limpiar cerrados
        </Button>
      )}
    </div>
  )
}
