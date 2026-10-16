import type { TabStatus } from '../state/sessions-store'

const dot: Record<TabStatus, string> = {
  connecting: 'bg-warn',
  ready: 'bg-ok',
  error: 'bg-err',
  closed: 'bg-faint',
  lost: 'bg-err',
}
const label: Record<TabStatus, string> = {
  connecting: 'conectando',
  ready: 'activa',
  error: 'con error',
  closed: 'terminada',
  lost: 'perdida',
}

export function StatusDot({ status }: { status: TabStatus }) {
  return (
    <>
      <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[status]}`} />
      <span className="sr-only">{label[status]}</span>
    </>
  )
}
