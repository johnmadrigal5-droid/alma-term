import { useId, useState } from 'react'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { displayName } from './format'
import type { OverwriteAnswer } from './sftp-actions'

interface Props {
  name: string
  /** Several files in the batch: offer "Aplicar a todos". */
  many: boolean
  onAnswer(answer: OverwriteAnswer): void
}

export function ConfirmOverwrite({ name, many, onAnswer }: Props) {
  const id = useId()
  const [all, setAll] = useState(false)
  return (
    <Dialog
      open
      title="El archivo ya existe"
      description={`Ya existe «${displayName(name)}». ¿Reemplazarlo?`}
      onDismiss={() => onAnswer({ replace: false, all: false })}
    >
      {many && (
        <label htmlFor={id} className="flex items-center gap-2 text-sm">
          <input id={id} type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          Aplicar a todos
        </label>
      )}
      <div className="flex justify-end gap-2">
        <Button autoFocus onClick={() => onAnswer({ replace: false, all })}>
          Omitir
        </Button>
        <Button variant="primary" onClick={() => onAnswer({ replace: true, all })}>
          Reemplazar
        </Button>
      </div>
    </Dialog>
  )
}
