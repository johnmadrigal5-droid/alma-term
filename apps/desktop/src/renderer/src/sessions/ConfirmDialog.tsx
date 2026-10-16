import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'

interface Props {
  title: string
  description: string
  confirmLabel: string
  onConfirm(): void
  onCancel(): void
}

export function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <Dialog open title={title} description={description} tone="danger" onDismiss={onCancel}>
      <div className="flex justify-end gap-2">
        <Button autoFocus onClick={onCancel}>
          Cancelar
        </Button>
        <Button variant="primary" className="bg-err" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
