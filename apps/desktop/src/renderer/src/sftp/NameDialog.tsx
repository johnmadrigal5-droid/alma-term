import { useId, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { invalidName } from './remote'

interface Props {
  title: string
  submitLabel: string
  initial?: string
  /** Resolves null on success, else the server's message. */
  onSubmit(name: string): Promise<string | null>
  onCancel(): void
}

export function NameDialog({ title, submitLabel, initial = '', onSubmit, onCancel }: Props) {
  const id = useId()
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const invalid = invalidName(name)
    if (invalid) return setError(invalid)
    setBusy(true)
    const failure = await onSubmit(name)
    setBusy(false)
    if (failure) setError(failure)
  }
  return (
    <Dialog open title={title} onDismiss={onCancel}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-xs text-muted">
            Nombre
          </label>
          <input
            id={id}
            autoFocus
            aria-required="true"
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            className="h-8 rounded-md bg-s2 px-2 text-text"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setError(null)
            }}
          />
          {error && (
            <span id={`${id}-error`} role="alert" className="text-xs text-err">
              {error}
            </span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {submitLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
