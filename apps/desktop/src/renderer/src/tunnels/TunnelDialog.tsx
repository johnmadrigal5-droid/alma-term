import { isLoopback, type TunnelSpecInput, type TunnelType } from '@alma/protocol'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import { TYPE_LABEL, tunnelErrorCopy } from './describe-tunnel'
import type { OpenResult } from './tunnels-actions'

export interface TunnelSession {
  sessionId: string
  title: string
  /** Id of the saved session (bookmark) behind this tab, if it has one. */
  savedId?: string | null
}

/** What the form starts with; every value is the text of its field. */
export interface TunnelFormValues {
  sessionId?: string
  type?: TunnelType
  bindHost?: string
  bindPort?: string
  targetHost?: string
  targetPort?: string
}

export interface TunnelDialogProps {
  /** Open SSH sessions a tunnel can be created on. */
  sessions: readonly TunnelSession[]
  initial?: TunnelFormValues
  /** `keep` is set when the user asked to save the tunnel with the saved session. */
  onSubmit(
    sessionId: string,
    spec: TunnelSpecInput,
    keep: { savedId: string; autoStart: boolean } | null,
  ): Promise<OpenResult>
  onClose(): void
}

const HINT: Record<TunnelType, string> = {
  L: 'Un puerto de este equipo llega a un servicio que ve el servidor.',
  R: 'Un puerto del servidor llega a un servicio de este equipo.',
  D: 'Un proxy SOCKS5 en este equipo que sale por el servidor.',
}

const TYPES: TunnelType[] = ['L', 'R', 'D']
const parsePort = (text: string): number | null =>
  /^\d{1,5}$/.test(text.trim()) ? Number(text.trim()) : null

type Errors = Partial<Record<'bindPort' | 'targetHost' | 'targetPort', string>>

const inputClass = 'h-8 rounded-md bg-s2 px-2 text-text'

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string
  label: string
  error?: string | undefined
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      {children}
      {error && (
        <span id={`${id}-error`} className="text-xs text-err">
          {error}
        </span>
      )}
    </div>
  )
}

export function TunnelDialog({ sessions, initial, onSubmit, onClose }: TunnelDialogProps) {
  const uid = useId()
  const [sessionId, setSessionId] = useState(initial?.sessionId ?? sessions[0]?.sessionId ?? '')
  const [type, setType] = useState<TunnelType>(initial?.type ?? 'L')
  const [bindHost, setBindHost] = useState(initial?.bindHost ?? '127.0.0.1')
  const [bindPort, setBindPort] = useState(initial?.bindPort ?? '')
  const [targetHost, setTargetHost] = useState(initial?.targetHost ?? '')
  const [targetPort, setTargetPort] = useState(initial?.targetPort ?? '')
  const [expose, setExpose] = useState(false)
  const [keep, setKeep] = useState(false)
  const [autoStart, setAutoStart] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [failure, setFailure] = useState<{ title: string; action?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const bindPortRef = useRef<HTMLInputElement>(null)
  const [refocusPort, setRefocusPort] = useState(0)

  // An empty address falls back to 127.0.0.1 on submit, so it is not an exposure.
  const savedId = sessions.find((s) => s.sessionId === sessionId)?.savedId ?? null
  const external = !isLoopback(bindHost.trim() || '127.0.0.1')
  const needsAck = external && !expose

  // "Elegir otro puerto": the field to change takes the focus.
  useEffect(() => {
    if (refocusPort > 0) {
      bindPortRef.current?.focus()
      bindPortRef.current?.select()
    }
  }, [refocusPort])

  if (sessions.length === 0)
    return (
      <Dialog open title="Nuevo túnel" onDismiss={onClose}>
        <p className="m-0 text-muted">Abre una sesión SSH para crear un túnel</p>
        <div className="flex justify-end">
          <Button onClick={onClose}>Cerrar</Button>
        </div>
      </Dialog>
    )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const next: Errors = {}
    const bind = parsePort(bindPort)
    if (bind === null || bind > 65535) next.bindPort = 'Indica un puerto entre 0 y 65535'
    const target = parsePort(targetPort)
    if (type !== 'D') {
      if (targetHost.trim() === '') next.targetHost = 'Indica el host de destino'
      if (target === null || target < 1 || target > 65535)
        next.targetPort = 'Indica un puerto entre 1 y 65535'
    }
    setErrors(next)
    setFailure(null)
    if (Object.keys(next).length > 0 || bind === null) return
    const spec: TunnelSpecInput = {
      type,
      bindHost: bindHost.trim() || '127.0.0.1',
      bindPort: bind,
      ...(type !== 'D' && target !== null
        ? { targetHost: targetHost.trim(), targetPort: target }
        : {}),
      exposeExternally: external && expose,
    }
    setBusy(true)
    const result = await onSubmit(sessionId, spec, keep && savedId ? { savedId, autoStart } : null)
    setBusy(false)
    if (result.ok) return onClose()
    setFailure(tunnelErrorCopy(result.error))
    if (result.error.code === 'TUNNEL_BIND_IN_USE') setRefocusPort((n) => n + 1)
  }

  const bindLabel = 'Dirección de escucha'
  return (
    <Dialog open title="Nuevo túnel" onDismiss={onClose}>
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <Field id={`${uid}-session`} label="Sesión">
          <select
            id={`${uid}-session`}
            autoFocus
            className={inputClass}
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
          >
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.title}
              </option>
            ))}
          </select>
        </Field>

        <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
          <legend className="mb-1 p-0 text-xs text-muted">Tipo</legend>
          <div className="flex gap-2">
            {TYPES.map((t) => (
              <label
                key={t}
                className={`flex h-8 flex-1 cursor-pointer items-center justify-center rounded-md text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                  type === t ? 'bg-accent text-white' : 'bg-s2 text-muted hover:text-text'
                }`}
              >
                <input
                  type="radio"
                  name={`${uid}-type`}
                  className="sr-only"
                  checked={type === t}
                  onChange={() => setType(t)}
                />
                {TYPE_LABEL[t]}
              </label>
            ))}
          </div>
          <p className="m-0 text-xs text-muted">{HINT[type]}</p>
        </fieldset>

        <div className="grid grid-cols-[1fr_96px] gap-2">
          <Field id={`${uid}-bind`} label={bindLabel}>
            <input
              id={`${uid}-bind`}
              className={inputClass}
              value={bindHost}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setBindHost(e.target.value)}
            />
          </Field>
          <Field id={`${uid}-bport`} label="Puerto de escucha" error={errors.bindPort}>
            <input
              id={`${uid}-bport`}
              ref={bindPortRef}
              inputMode="numeric"
              placeholder="0 = automático"
              aria-invalid={errors.bindPort ? true : undefined}
              aria-describedby={errors.bindPort ? `${uid}-bport-error` : undefined}
              className={inputClass}
              value={bindPort}
              onChange={(e) => setBindPort(e.target.value)}
            />
          </Field>
        </div>

        {external && (
          <div className="flex flex-col gap-2 rounded-md bg-s2 p-2 text-xs text-warn">
            <p className="m-0">
              Escuchar fuera de 127.0.0.1 permite que otros equipos de tu red usen este túnel.
            </p>
            <label className="flex items-center gap-2 text-text">
              <input
                type="checkbox"
                checked={expose}
                onChange={(e) => setExpose(e.target.checked)}
              />
              Entiendo que otros equipos podrán conectarse
            </label>
          </div>
        )}

        {type !== 'D' && (
          <div className="grid grid-cols-[1fr_96px] gap-2">
            <Field id={`${uid}-thost`} label="Host de destino" error={errors.targetHost}>
              <input
                id={`${uid}-thost`}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={errors.targetHost ? true : undefined}
                aria-describedby={errors.targetHost ? `${uid}-thost-error` : undefined}
                className={inputClass}
                value={targetHost}
                onChange={(e) => setTargetHost(e.target.value)}
              />
            </Field>
            <Field id={`${uid}-tport`} label="Puerto de destino" error={errors.targetPort}>
              <input
                id={`${uid}-tport`}
                inputMode="numeric"
                aria-invalid={errors.targetPort ? true : undefined}
                aria-describedby={errors.targetPort ? `${uid}-tport-error` : undefined}
                className={inputClass}
                value={targetPort}
                onChange={(e) => setTargetPort(e.target.value)}
              />
            </Field>
          </div>
        )}

        {savedId && (
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
              Guardar con la sesión
            </label>
            {keep && (
              <label className="flex items-center gap-2 pl-6">
                <input
                  type="checkbox"
                  checked={autoStart}
                  onChange={(e) => setAutoStart(e.target.checked)}
                />
                Abrir al conectar
              </label>
            )}
          </div>
        )}

        {failure && (
          <p role="alert" className="m-0 text-sm text-err">
            {failure.title}
            {failure.action && <span className="text-muted"> · {failure.action}</span>}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy || needsAck}>
            {busy ? 'Creando…' : 'Crear'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
