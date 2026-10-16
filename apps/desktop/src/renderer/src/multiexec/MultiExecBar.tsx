import { X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Button } from '../components/ui/button'
import type { Tab } from '../state/sessions-store'

interface Props {
  tabs: readonly Tab[]
  targets: readonly string[]
  broadcast: boolean
  history: readonly string[]
  focusRequest: number
  platform: string
  onToggleTarget(sessionId: string): void
  onSetTargets(sessionIds: string[]): void
  onToggleBroadcast(): void
  onRun(command: string): { sent: number; skipped: number }
  onClose(): void
}

const NOTICE_MS = 4000

/** Chip names: sessions sharing a title get "(1)", "(2)"… so they can be told apart. */
function chipNames(tabs: readonly Tab[]): Map<string, string> {
  const total = new Map<string, number>()
  for (const t of tabs) total.set(t.title, (total.get(t.title) ?? 0) + 1)
  const seen = new Map<string, number>()
  return new Map(
    tabs.map((t) => {
      if ((total.get(t.title) ?? 0) < 2) return [t.sessionId, t.title]
      const n = (seen.get(t.title) ?? 0) + 1
      seen.set(t.title, n)
      return [t.sessionId, `${t.title} (${n})`]
    }),
  )
}

const sessions = (n: number) => (n === 1 ? '1 sesión' : `${n} sesiones`)

/** Composer docked under the panes: pick targets, broadcast keys or send one command. */
export function MultiExecBar(props: Props) {
  const { tabs, targets, broadcast, history, focusRequest } = props
  const [draft, setDraft] = useState('')
  const [cursor, setCursor] = useState(-1)
  const [notice, setNotice] = useState<string | null>(null)
  /** What was typed before browsing the history, to get it back with ArrowDown. */
  const unsent = useRef('')
  const field = useRef<HTMLInputElement>(null)
  const fieldId = useId()
  const ready = tabs.filter((t) => t.status === 'ready')
  const chosen = ready.filter((t) => targets.includes(t.sessionId))
  const all = ready.length > 0 && chosen.length === ready.length
  const names = chipNames(ready)

  useEffect(() => {
    if (focusRequest > 0) field.current?.focus()
  }, [focusRequest])

  // The result of a run fades by itself: it would be stale after a few seconds.
  useEffect(() => {
    if (notice === null) return
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice])

  const run = () => {
    // Leading spaces stay (HISTCONTROL=ignorespace); only the end is trimmed.
    const command = draft.trimEnd()
    if (command.trim() === '') return
    if (chosen.length === 0) return setNotice('Selecciona al menos una sesión')
    const { sent, skipped } = props.onRun(command)
    setNotice(
      skipped > 0
        ? `Enviado a ${sent} de ${sent + skipped}; ${skipped} sin conexión`
        : `Enviado a ${sessions(sent)}`,
    )
    setDraft('')
    setCursor(-1)
    unsent.current = ''
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      // Enter that confirms an IME composition is not a request to run.
      if (event.nativeEvent.isComposing) return
      return run()
    }
    const step = { ArrowUp: 1, ArrowDown: -1 }[event.key]
    if (step === undefined) return
    event.preventDefault()
    const next = Math.max(-1, Math.min(history.length - 1, cursor + step))
    if (cursor === -1 && next !== -1) unsent.current = draft
    setCursor(next)
    setDraft(next === -1 ? unsent.current : (history[next] ?? ''))
  }

  return (
    <section
      aria-label="MultiExec"
      data-keeps-focus
      className="mb-2 mr-2 flex flex-col gap-2 rounded-lg bg-s1 p-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={broadcast}
          className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm hover:bg-s2"
          onClick={props.onToggleBroadcast}
        >
          <span
            aria-hidden
            className={`h-4 w-7 rounded-full p-0.5 transition-colors duration-150 motion-reduce:transition-none ${
              broadcast ? 'bg-accent' : 'bg-s3'
            }`}
          >
            <span
              className={`block h-3 w-3 rounded-full bg-text transition-transform duration-150 motion-reduce:transition-none ${
                broadcast ? 'translate-x-3' : ''
              }`}
            />
          </span>
          Broadcast de teclas
        </button>
        <div
          role="group"
          aria-label="Destinos"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-1"
        >
          {ready.length === 0 ? (
            <span className="text-xs text-muted">Abre sesiones para usar MultiExec</span>
          ) : (
            ready.map((t) => {
              const on = targets.includes(t.sessionId)
              return (
                <button
                  key={t.sessionId}
                  type="button"
                  aria-pressed={on}
                  className={`h-6 cursor-pointer rounded-md px-2 text-xs ${
                    on ? 'bg-accent text-white' : 'bg-s2 text-muted hover:text-text'
                  }`}
                  onClick={() => props.onToggleTarget(t.sessionId)}
                >
                  {names.get(t.sessionId) ?? t.title}
                </button>
              )
            })
          )}
          {ready.length > 1 && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => props.onSetTargets(all ? [] : ready.map((t) => t.sessionId))}
            >
              {all ? 'Ninguna' : 'Todas'}
            </Button>
          )}
        </div>
        <Button size="icon" variant="ghost" aria-label="Ocultar MultiExec" onClick={props.onClose}>
          <X size={16} aria-hidden />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <label htmlFor={fieldId} className="sr-only">
          Comando para MultiExec
        </label>
        <input
          ref={field}
          id={fieldId}
          value={draft}
          autoComplete="off"
          spellCheck={false}
          aria-keyshortcuts={props.platform === 'darwin' ? 'Meta+Shift+M' : 'Control+Shift+M'}
          placeholder="Comando para las sesiones seleccionadas"
          className="h-8 min-w-0 flex-1 rounded-md bg-s2 px-2 font-mono text-sm text-text placeholder:text-faint focus-visible:outline-2 focus-visible:outline-accent"
          onChange={(e) => {
            setDraft(e.target.value)
            setCursor(-1)
          }}
          onKeyDown={onKeyDown}
        />
        <Button
          variant="primary"
          disabled={chosen.length === 0 || draft.trim() === ''}
          onClick={run}
        >
          Ejecutar en {chosen.length}
        </Button>
      </div>
      {notice && (
        <p role="status" className="m-0 text-xs text-muted">
          {notice}
        </p>
      )}
    </section>
  )
}
