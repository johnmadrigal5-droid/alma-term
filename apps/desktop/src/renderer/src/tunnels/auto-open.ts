import type { AlmaApi, ProtocolError, SavedTunnel, TunnelSpec } from '@alma/protocol'
import type { OpenResult } from './tunnels-actions'

interface Deps {
  /** Gets the saved tunnels of the saved session once listed (the panel shows the idle ones). */
  onListed?(savedId: string, list: SavedTunnel[]): void
  api: AlmaApi['tunnels']['saved']
  /** Opens one tunnel; `savedTunnelId` marks the row as one that is kept with the session. */
  open(sessionId: string, spec: TunnelSpec, savedTunnelId: string): Promise<OpenResult>
}

/** Sessions (by id and generation) whose saved tunnels were already opened. */
const started = new Set<string>()
/** Sessions being worked on right now: a second call must not list and open them again. */
const inflight = new Set<string>()

/** For tests: forgets which sessions were already handled. */
export function resetAutoOpen(): void {
  started.clear()
  inflight.clear()
}

/**
 * Opens the saved tunnels marked to start with a session, once per connection: a reconnect
 * (new generation) opens them again because they died with the old one.
 */
export async function autoOpen(
  { api, open, onListed }: Deps,
  sessionId: string,
  savedId: string,
  generation = 0,
): Promise<{ opened: number; failed: ProtocolError[] }> {
  const key = `${sessionId}:${generation}`
  if (started.has(key) || inflight.has(key)) return { opened: 0, failed: [] }
  inflight.add(key)
  try {
    const listed = await api.list({ savedId })
    // A failed listing is not remembered: the next call tries again.
    if (!listed.ok) return { opened: 0, failed: [listed.error] }
    started.add(key)
    onListed?.(savedId, listed.data)
    let opened = 0
    const failed: ProtocolError[] = []
    for (const tunnel of listed.data) {
      if (!tunnel.autoStart) continue
      try {
        const result = await open(sessionId, tunnel.spec, tunnel.id)
        if (result.ok) opened += 1
        else failed.push(result.error)
      } catch {
        failed.push({ code: 'IO_FAILED', message: 'No se pudo abrir el túnel guardado' })
      }
    }
    return { opened, failed }
  } finally {
    inflight.delete(key)
  }
}
