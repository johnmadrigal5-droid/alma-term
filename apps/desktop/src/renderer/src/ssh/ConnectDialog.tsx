import type { Folder, SavedSession, SaveSessionInput, SshAuth } from '@alma/protocol'
import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { z } from 'zod'
import { Button } from '../components/ui/button'
import { Dialog } from '../components/ui/dialog'
import type { SshRequest } from '../state/sessions-store'

type AuthType = SshAuth['type']

interface FormValues {
  name: string
  folderId: string
  host: string
  port: string
  username: string
  authType: AuthType
  password: string
  privateKeyPath: string
  passphrase: string
  remember: boolean
  forget: boolean
}

const Form = z
  .object({
    name: z.string().trim().max(80, 'Máximo 80 caracteres'),
    folderId: z.string(),
    host: z.string().trim().min(1, 'Indica el host').max(255, 'Máximo 255 caracteres'),
    port: z
      .string()
      .trim()
      .regex(/^\d+$/, 'El puerto va de 1 a 65535')
      .transform(Number)
      .pipe(
        z
          .number()
          .int()
          .min(1, 'El puerto va de 1 a 65535')
          .max(65535, 'El puerto va de 1 a 65535'),
      ),
    username: z.string().trim().min(1, 'Indica el usuario').max(64, 'Máximo 64 caracteres'),
    authType: z.enum(['password', 'key', 'agent']),
    password: z.string(),
    privateKeyPath: z.string().trim(),
    passphrase: z.string(),
    remember: z.boolean(),
    forget: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.authType === 'key' && v.privateKeyPath === '')
      ctx.addIssue({
        code: 'custom',
        path: ['privateKeyPath'],
        message: 'Elige el archivo de la clave',
      })
  })

type Parsed = z.output<typeof Form>
type Field = keyof FormValues

// Order in which errors are reported and the first invalid field receives focus.
const FIELD_ORDER: Field[] = ['name', 'host', 'port', 'username', 'privateKeyPath']

export const NO_KEYRING_NOTICE =
  'Tu sistema no tiene un llavero disponible; la contraseña no se puede guardar de forma segura.'

function authOf(v: Parsed): SshAuth {
  if (v.authType === 'key')
    return {
      type: 'key',
      privateKeyPath: v.privateKeyPath,
      ...(v.passphrase ? { passphrase: v.passphrase } : {}),
    }
  if (v.authType === 'agent') return { type: 'agent' }
  return v.password ? { type: 'password', password: v.password } : { type: 'password' }
}

function toRequest(v: Parsed, savedId: string | null): SshRequest {
  return { target: { host: v.host, port: v.port, username: v.username }, auth: authOf(v), savedId }
}

function secretOf(v: Parsed): SaveSessionInput['secret'] {
  if (v.authType === 'agent') return undefined
  const kind = v.authType === 'key' ? 'passphrase' : 'password'
  const typed = v.authType === 'key' ? v.passphrase : v.password
  if (v.forget) return { kind, value: null }
  if (v.remember && typed) return { kind, value: typed }
  return undefined
}

function toInput(v: Parsed, savedId: string | null): SaveSessionInput {
  const secret = secretOf(v)
  return {
    ...(savedId ? { id: savedId } : {}),
    folderId: v.folderId || null,
    name: v.name || `${v.username}@${v.host}`,
    host: v.host,
    port: v.port,
    username: v.username,
    auth: v.authType,
    keyPath: v.authType === 'key' ? v.privateKeyPath : null,
    ...(secret ? { secret } : {}),
  }
}

function initialValues(
  initial: SshRequest | null,
  saved: SavedSession | null,
  folderId: string | null,
): FormValues {
  const auth = initial?.auth
  return {
    name: saved?.name ?? '',
    folderId: saved?.folderId ?? folderId ?? '',
    host: saved?.host ?? initial?.target.host ?? '',
    port: String(saved?.port ?? initial?.target.port ?? 22),
    username: saved?.username ?? initial?.target.username ?? '',
    authType: saved?.auth ?? auth?.type ?? 'password',
    password: '',
    privateKeyPath: saved?.keyPath ?? (auth?.type === 'key' ? auth.privateKeyPath : ''),
    passphrase: '',
    remember: false,
    forget: false,
  }
}

export interface SaveOptions {
  connect: boolean
  /** Typed in the form: used for the first connection even when it is not remembered. */
  password?: string
  passphrase?: string
}

interface Props {
  initial: SshRequest | null
  saved: SavedSession | null
  folders: readonly Folder[]
  canRemember: boolean
  folderId?: string | null
  /** Why the last save failed, shown above the buttons. */
  error?: string | null
  onSubmit(request: SshRequest): void
  onSave(input: SaveSessionInput, options: SaveOptions): void
  onCancel(): void
  pickPrivateKey(): Promise<string | null>
}

const inputClass =
  'h-8 rounded-md bg-s2 px-2 text-text aria-[invalid=true]:outline aria-[invalid=true]:outline-1 aria-[invalid=true]:outline-err'

const AUTH_OPTIONS: { value: AuthType; label: string }[] = [
  { value: 'password', label: 'Contraseña' },
  { value: 'key', label: 'Clave privada' },
  { value: 'agent', label: 'Agente SSH' },
]

interface FieldProps {
  id: string
  'aria-invalid': true | undefined
  'aria-describedby': string | undefined
  'aria-required': true | undefined
}

export function ConnectDialog({
  initial,
  saved,
  folders,
  canRemember,
  folderId = null,
  error = null,
  onSubmit,
  onSave,
  onCancel,
  pickPrivateKey,
}: Props) {
  const id = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const [values, setValues] = useState<FormValues>(() => initialValues(initial, saved, folderId))
  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>({})
  const parsed = Form.safeParse(values)
  const errors: Partial<Record<Field, string>> = {}
  if (!parsed.success)
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as Field
      errors[key] ??= issue.message
    }

  const set = <F extends Field>(field: F, value: FormValues[F]) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    setTouched((prev) => ({ ...prev, [field]: true }))
  }

  // Valid → returns the data; invalid → shows every error and focuses the first bad field.
  const validate = (): Parsed | null => {
    if (parsed.success) return parsed.data
    setTouched(Object.fromEntries(FIELD_ORDER.map((f) => [f, true])))
    const first = FIELD_ORDER.find((f) => errors[f])
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#${CSS.escape(`${id}-${first}`)}`)?.focus()
    return null
  }

  const savedId = saved?.id ?? null
  const save = (connect: boolean) => {
    const data = validate()
    if (!data) return
    // The typed secret also opens this first connection; it is stored only via `secret`.
    const options: SaveOptions = { connect }
    if (data.authType === 'password' && data.password) options.password = data.password
    if (data.authType === 'key' && data.passphrase) options.passphrase = data.passphrase
    onSave(toInput(data, savedId), options)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (saved) return save(true)
    const data = validate()
    if (data) onSubmit(toRequest(data, null))
  }

  const field = (
    name: Field,
    label: string,
    input: (props: FieldProps) => ReactNode,
    required = false,
  ) => {
    const error = touched[name] ? errors[name] : undefined
    const inputId = `${id}-${name}`
    const errorId = `${inputId}-error`
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-xs text-muted">
          {label}
        </label>
        {input({
          id: inputId,
          'aria-invalid': error ? true : undefined,
          'aria-describedby': error ? errorId : undefined,
          'aria-required': required ? true : undefined,
        })}
        {error && (
          <span id={errorId} role="alert" className="text-xs text-err">
            {error}
          </span>
        )}
      </div>
    )
  }

  const pick = async () => {
    const path = await pickPrivateKey()
    if (path) set('privateKeyPath', path)
  }

  const secretKind = values.authType === 'key' ? 'passphrase' : 'password'
  const hasStored = secretKind === 'password' ? saved?.hasPassword : saved?.hasPassphrase
  const keepPlaceholder = hasStored ? 'Dejar vacío para mantener la guardada' : undefined

  return (
    <Dialog open title={saved ? 'Editar sesión' : 'Nueva sesión SSH'} onDismiss={onCancel}>
      <form ref={formRef} className="flex flex-col gap-4" onSubmit={submit} noValidate>
        <div className="grid grid-cols-2 gap-2">
          {field('name', 'Nombre', (p) => (
            <input
              {...p}
              className={inputClass}
              value={values.name}
              placeholder={
                values.username && values.host ? `${values.username}@${values.host}` : undefined
              }
              onChange={(e) => set('name', e.target.value)}
            />
          ))}
          {field('folderId', 'Carpeta', (p) => (
            <select
              {...p}
              className={inputClass}
              value={values.folderId}
              onChange={(e) => set('folderId', e.target.value)}
            >
              <option value="">Sin carpeta</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ))}
        </div>
        <div className="grid grid-cols-[1fr_96px] gap-2">
          {field(
            'host',
            'Host',
            (p) => (
              <input
                {...p}
                className={inputClass}
                value={values.host}
                autoFocus
                spellCheck={false}
                onChange={(e) => set('host', e.target.value)}
              />
            ),
            true,
          )}
          {field(
            'port',
            'Puerto',
            (p) => (
              <input
                {...p}
                className={inputClass}
                inputMode="numeric"
                value={values.port}
                onChange={(e) => set('port', e.target.value)}
              />
            ),
            true,
          )}
        </div>
        {field(
          'username',
          'Usuario',
          (p) => (
            <input
              {...p}
              className={inputClass}
              value={values.username}
              spellCheck={false}
              onChange={(e) => set('username', e.target.value)}
            />
          ),
          true,
        )}
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-1 p-0 text-xs text-muted">Autenticación</legend>
          <div role="radiogroup" className="flex gap-4">
            {AUTH_OPTIONS.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name={`${id}-auth`}
                  value={option.value}
                  checked={values.authType === option.value}
                  onChange={() => set('authType', option.value)}
                  className="accent-accent"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        {values.authType === 'password' &&
          field('password', 'Contraseña (opcional)', (p) => (
            <input
              {...p}
              type="password"
              autoComplete="off"
              placeholder={keepPlaceholder ?? 'Vacía para que la pida el servidor'}
              className={inputClass}
              value={values.password}
              onChange={(e) => set('password', e.target.value)}
            />
          ))}
        {values.authType === 'key' && (
          <>
            {field(
              'privateKeyPath',
              'Archivo de clave',
              (p) => (
                <div className="flex gap-2">
                  <input
                    {...p}
                    className={`${inputClass} min-w-0 flex-1 font-mono text-xs`}
                    value={values.privateKeyPath}
                    spellCheck={false}
                    onChange={(e) => set('privateKeyPath', e.target.value)}
                  />
                  <Button onClick={() => void pick()}>Elegir archivo</Button>
                </div>
              ),
              true,
            )}
            {field('passphrase', 'Frase de contraseña (opcional)', (p) => (
              <input
                {...p}
                type="password"
                autoComplete="off"
                placeholder={keepPlaceholder ?? 'Vacía si la clave no está cifrada'}
                className={inputClass}
                value={values.passphrase}
                onChange={(e) => set('passphrase', e.target.value)}
              />
            ))}
          </>
        )}
        {values.authType === 'agent' && (
          <p className="m-0 text-xs text-muted">
            Usa las claves cargadas en el agente del sistema (SSH_AUTH_SOCK o el agente de OpenSSH
            en Windows).
          </p>
        )}
        {values.authType !== 'agent' && (
          <div className="flex flex-col gap-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm aria-disabled:cursor-not-allowed aria-disabled:text-faint">
              <input
                type="checkbox"
                checked={values.remember && canRemember}
                disabled={!canRemember}
                onChange={(e) => set('remember', e.target.checked)}
                className="accent-accent"
              />
              {secretKind === 'password' ? 'Recordar contraseña' : 'Recordar frase de contraseña'}
            </label>
            {!canRemember && <p className="m-0 text-xs text-muted">{NO_KEYRING_NOTICE}</p>}
            {hasStored && (
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={values.forget}
                  onChange={(e) => set('forget', e.target.checked)}
                  className="accent-accent"
                />
                {secretKind === 'password'
                  ? 'Olvidar contraseña guardada'
                  : 'Olvidar frase de contraseña guardada'}
              </label>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="m-0 text-sm text-err">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel}>Cancelar</Button>
          {saved ? (
            <Button onClick={() => save(false)}>Guardar</Button>
          ) : (
            <Button type="submit">Conectar</Button>
          )}
          <Button
            type={saved ? 'submit' : 'button'}
            variant="primary"
            onClick={saved ? undefined : () => save(true)}
          >
            Guardar y conectar
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
