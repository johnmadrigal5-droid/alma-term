import { useId, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'

interface Props {
  title: string
  initial?: string
  onSubmit(name: string): void
  onCancel(): void
}

export function FolderNameDialog({ title, initial = '', onSubmit, onCancel }: Props) {
  const id = useId()
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError('Indica un nombre')
    if (trimmed.length > 80) return setError('Máximo 80 caracteres')
    onSubmit(trimmed)
  }
  return (
    <Dialog open title={title} onDismiss={onCancel}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
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
          <Button type="submit" variant="primary">
            Guardar
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
