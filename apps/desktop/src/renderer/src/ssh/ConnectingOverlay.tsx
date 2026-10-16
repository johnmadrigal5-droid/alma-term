import type { ConnectStep } from '@alma/protocol'
import { Check, LoaderCircle } from 'lucide-react'
import { Button } from '../components/ui/button'

const STEPS: { id: ConnectStep; label: string }[] = [
  { id: 'tcp', label: 'TCP' },
  { id: 'hostkey', label: 'Clave de host' },
  { id: 'auth', label: 'Autenticación' },
  { id: 'shell', label: 'Shell' },
]

interface Props {
  title: string
  step: ConnectStep | null
  onCancel?(): void
}

export function ConnectingOverlay({ title, step, onCancel }: Props) {
  const current = Math.max(
    0,
    STEPS.findIndex((s) => s.id === step),
  )
  return (
    <div role="status" className="absolute inset-0 grid place-items-center bg-canvas/85">
      <div className="flex flex-col items-center gap-4 text-center">
        <h2 className="m-0 text-base font-semibold text-text">Conectando a {title}</h2>
        <ol className="m-0 flex list-none gap-4 p-0">
          {STEPS.map((s, index) => {
            const state = index < current ? 'done' : index === current ? 'active' : 'pending'
            return (
              <li
                key={s.id}
                data-state={state}
                aria-current={state === 'active' ? 'step' : undefined}
                className={`flex items-center gap-2 ${
                  state === 'pending'
                    ? 'text-faint'
                    : state === 'active'
                      ? 'text-text'
                      : 'text-muted'
                }`}
              >
                {state === 'done' && <Check size={14} aria-hidden="true" className="text-ok" />}
                {state === 'active' && (
                  <LoaderCircle
                    size={14}
                    aria-hidden="true"
                    className="animate-spin text-accent-text motion-reduce:animate-none"
                  />
                )}
                {s.label}
              </li>
            )
          })}
        </ol>
        {onCancel && (
          <Button size="sm" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </div>
  )
}
