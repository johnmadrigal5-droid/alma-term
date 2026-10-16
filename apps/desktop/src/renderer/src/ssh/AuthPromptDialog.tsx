import type { AuthPrompt } from '@alma/protocol'
import { useId, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'

interface Props {
  prompt: AuthPrompt
  onSubmit(responses: string[], remember: boolean): void
  onCancel(): void
}

const REMEMBER_LABEL = {
  password: 'Recordar contraseña',
  passphrase: 'Recordar frase de contraseña',
} as const

export function AuthPromptDialog({ prompt, onSubmit, onCancel }: Props) {
  const id = useId()
  const [values, setValues] = useState<string[]>(() => prompt.fields.map(() => ''))
  const [remember, setRemember] = useState(false)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    onSubmit(values, prompt.remember !== undefined && remember)
  }
  return (
    <Dialog
      open
      title={prompt.title}
      description={prompt.instructions || undefined}
      onDismiss={onCancel}
      // A stray click must not abort a login: only Escape or Cancelar cancel it.
      contentProps={{ onInteractOutside: (event) => event.preventDefault() }}
    >
      <form className="flex flex-col gap-4" onSubmit={submit}>
        {prompt.fields.map((field, index) => (
          <div key={index} className="flex flex-col gap-1">
            <label htmlFor={`${id}-${index}`} className="text-xs text-muted">
              {field.label}
            </label>
            <input
              id={`${id}-${index}`}
              type={field.echo ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={values[index] ?? ''}
              onChange={(event) =>
                setValues((prev) => prev.map((v, i) => (i === index ? event.target.value : v)))
              }
              className="h-8 rounded-md bg-s2 px-2 text-text"
            />
          </div>
        ))}
        {prompt.remember && (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={remember}
              onChange={(event) => setRemember(event.target.checked)}
              className="accent-accent"
            />
            {REMEMBER_LABEL[prompt.remember]}
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancelar</Button>
          <Button type="submit" variant="primary">
            Continuar
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
