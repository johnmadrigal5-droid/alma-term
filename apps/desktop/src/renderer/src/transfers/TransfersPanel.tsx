import { ArrowDown, ArrowUp, Pause, Play, RotateCw, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import { formatSize } from '../sftp/format'
import type { TransferView } from './transfers-store'

export interface TransfersPanelProps {
  views: readonly TransferView[]
  onPause(transferId: string): void
  onResume(transferId: string): void
  onCancel(transferId: string): void
  onRetry(transferId: string): void
  onClearDone(): void
}

const STATE_LABEL: Record<TransferView['state'], string> = {
  queued: 'En cola',
  running: 'En curso',
  paused: 'Pausada',
  done: 'Completada',
  cancelled: 'Cancelada',
  error: 'Error',
}

function percent(view: TransferView): number {
  if (view.total === 0) return view.state === 'done' ? 100 : 0
  return Math.min(100, Math.round((view.bytes / view.total) * 100))
}

function Row({ view, ...actions }: { view: TransferView } & Omit<TransfersPanelProps, 'views'>) {
  const value = percent(view)
  const Direction = view.direction === 'upload' ? ArrowUp : ArrowDown
  const iconButton = (label: string, icon: typeof Pause, onClick: () => void) => {
    const Icon = icon
    return (
      <Button size="icon" variant="ghost" aria-label={`${label} ${view.name}`} onClick={onClick}>
        <Icon size={14} aria-hidden />
      </Button>
    )
  }
  return (
    <li className="flex flex-col gap-1 rounded-md bg-s1 p-2">
      <div className="flex items-center gap-2">
        <Direction size={14} aria-hidden className="shrink-0 text-muted" />
        <span className="sr-only">{view.direction === 'upload' ? 'Subida' : 'Bajada'}</span>
        <span className="min-w-0 flex-1 truncate text-sm" title={view.name}>
          {view.name}
        </span>
        {view.state === 'running' &&
          iconButton('Pausar', Pause, () => actions.onPause(view.transferId))}
        {view.state === 'paused' &&
          iconButton('Reanudar', Play, () => actions.onResume(view.transferId))}
        {view.state === 'error' &&
          iconButton('Reintentar', RotateCw, () => actions.onRetry(view.transferId))}
        {(view.state === 'running' || view.state === 'paused' || view.state === 'queued') &&
          iconButton('Cancelar', X, () => actions.onCancel(view.transferId))}
      </div>
      <div
        role="progressbar"
        aria-label={`Progreso de ${view.name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
        className="h-1 overflow-hidden rounded bg-s3"
      >
        <div
          className={`h-full ${view.state === 'error' ? 'bg-err' : 'bg-accent'} transition-[width] duration-200`}
          style={{ width: `${value}%` }}
        />
      </div>
      <p className="m-0 text-xs text-muted">
        {view.state === 'error' && view.error ? (
          <span className="text-err">{view.error.message}</span>
        ) : (
          <>
            {formatSize(view.bytes)} de {formatSize(view.total)}
            {view.state === 'running' && view.speed > 0 && ` · ${formatSize(view.speed)}/s`}
            {view.state !== 'running' && (
              <>
                {' · '}
                <span>{STATE_LABEL[view.state]}</span>
              </>
            )}
          </>
        )}
      </p>
    </li>
  )
}

export function TransfersPanel({ views, ...actions }: TransfersPanelProps) {
  if (views.length === 0) return <p className="m-0 px-2 text-sm text-muted">Sin transferencias</p>
  const finished = views.some((v) => v.state === 'done' || v.state === 'cancelled')
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <ul aria-label="Transferencias" className="m-0 flex list-none flex-col gap-1 p-0">
        {views.map((view) => (
          <Row key={view.transferId} view={view} {...actions} />
        ))}
      </ul>
      {finished && (
        <Button size="sm" variant="ghost" onClick={actions.onClearDone}>
          Limpiar completadas
        </Button>
      )}
    </div>
  )
}
