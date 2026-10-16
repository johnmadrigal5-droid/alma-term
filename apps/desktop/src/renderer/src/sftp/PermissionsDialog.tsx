import { useId, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { displayName, formatMode, parseMode } from './format'

interface Props {
  name: string
  mode: number
  onSubmit(mode: number): void
  onCancel(): void
}

export function PermissionsDialog({ name, mode, onSubmit, onCancel }: Props) {
  const id = useId()
  const [text, setText] = useState(mode.toString(8).padStart(3, '0'))
  const parsed = parseMode(text)
  const [error, setError] = useState<string | null>(null)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (parsed === null) return setError('Usa 3 o 4 dígitos del 0 al 7, por ejemplo 644')
    onSubmit(parsed)
  }
  return (
    <Dialog open title={`Permisos de «${displayName(name)}»`} onDismiss={onCancel}>
      <form className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor={id} className="text-xs text-muted">
            Permisos (octal)
          </label>
          <input
            id={id}
            autoFocus
            inputMode="numeric"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint`}
            className="h-8 rounded-md bg-s2 px-2 font-mono text-text"
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
          />
          <span id={`${id}-hint`} className="font-mono text-xs text-muted">
            {parsed === null ? '—' : formatMode(parsed)}
          </span>
          {error && (
            <span role="alert" className="text-xs text-err">
              {error}
            </span>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancelar</Button>
          <Button type="submit" variant="primary">
            Aplicar
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
