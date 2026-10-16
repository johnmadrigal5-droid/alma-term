import type { HostKeyPrompt } from '@alma/protocol'
import { useRef } from 'react'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'

interface Props {
  prompt: HostKeyPrompt
  onAnswer(accept: boolean): void
}

function Fingerprint({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <code className="break-all rounded-md bg-s2 px-2 py-1 font-mono text-xs text-text">
        {value}
      </code>
    </div>
  )
}

export function HostKeyDialog({ prompt, onAnswer }: Props) {
  const safeRef = useRef<HTMLButtonElement>(null)
  const changed = prompt.status === 'changed'
  const where = prompt.port === 22 ? prompt.host : `${prompt.host}:${prompt.port}`
  return (
    <Dialog
      open
      tone={changed ? 'danger' : 'default'}
      title={changed ? 'La clave del servidor cambió' : `Primera conexión a ${where}`}
      description={
        changed
          ? `La clave de ${where} no coincide con la guardada. Puede ser una reinstalación del servidor o alguien interceptando la conexión. No conectes si no esperabas este cambio.`
          : `Alma Term no conoce todavía este servidor. Comprueba la huella con el administrador antes de confiar.`
      }
      onDismiss={() => onAnswer(false)}
      contentProps={{
        onOpenAutoFocus: (event) => {
          event.preventDefault()
          safeRef.current?.focus()
        },
      }}
    >
      <div className="flex flex-col gap-2">
        {changed && prompt.knownFingerprint && (
          <Fingerprint label="Huella guardada" value={prompt.knownFingerprint} />
        )}
        <Fingerprint
          label={changed ? `Huella nueva (${prompt.keyType})` : `Huella (${prompt.keyType})`}
          value={prompt.fingerprint}
        />
      </div>
      <div className="flex justify-end gap-2">
        {changed ? (
          <>
            <Button onClick={() => onAnswer(true)}>Reemplazar clave</Button>
            <Button ref={safeRef} variant="primary" onClick={() => onAnswer(false)}>
              No conectar
            </Button>
          </>
        ) : (
          <>
            <Button ref={safeRef} onClick={() => onAnswer(false)}>
              Cancelar
            </Button>
            <Button variant="primary" onClick={() => onAnswer(true)}>
              Confiar y conectar
            </Button>
          </>
        )}
      </div>
    </Dialog>
  )
}
