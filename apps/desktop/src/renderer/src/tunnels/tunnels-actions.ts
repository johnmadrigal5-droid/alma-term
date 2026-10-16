import {
  TunnelSpec,
  type AlmaApi,
  type ProtocolError,
  type SavedTunnel,
  type TunnelSpecInput,
} from '@alma/protocol'
import type { TunnelsStore } from './tunnels-store'

interface Deps {
  api: AlmaApi['tunnels']
  store: TunnelsStore
  newId?: () => string
}

export interface OpenOptions {
  /** The tunnel comes from a saved one: its row is marked, nothing is saved again. */
  savedTunnelId?: string
  /** Keep the tunnel with this saved session once it is open. */
  keep?: { savedId: string; autoStart: boolean }
}

export type OpenResult = { ok: true } | { ok: false; error: ProtocolError }

export function createTunnelActions({ api, store, newId = () => crypto.randomUUID() }: Deps) {
  const actions = {
    /**
     * Opens a tunnel. A refusal is returned for the dialog to show and leaves no row behind:
     * the user fixes the form and tries again.
     */
    async open(
      sessionId: string,
      input: TunnelSpecInput,
      options: OpenOptions = {},
    ): Promise<OpenResult> {
      const parsed = TunnelSpec.safeParse(input)
      if (!parsed.success)
        return {
          ok: false,
          error: {
            code: 'INVALID_MESSAGE',
            message: parsed.error.issues[0]?.message ?? 'Túnel inválido',
          },
        }
      const tunnelId = newId()
      store.getState().begin(tunnelId, sessionId, parsed.data, options.savedTunnelId ?? null)
      let result: Awaited<ReturnType<typeof api.open>>
      try {
        result = await api.open({ sessionId, tunnelId, spec: parsed.data })
      } catch {
        result = { ok: false, error: { code: 'IO_FAILED', message: 'No se pudo abrir el túnel' } }
      }
      if (result.ok) {
        if (options.keep) {
          const saved = await api.saved.save({
            savedId: options.keep.savedId,
            spec: parsed.data,
            autoStart: options.keep.autoStart,
          })
          // The tunnel is open either way; a failed save just leaves it unmarked.
          if (saved.ok) {
            store.getState().markSaved(tunnelId, saved.data.id)
            store.getState().addSaved(options.keep.savedId, saved.data)
          }
        }
        return { ok: true }
      }
      // A saved tunnel that fails on its own has no dialog to tell the user: keep its row.
      if (options.savedTunnelId) store.getState().markFailed(tunnelId, result.error)
      else store.getState().remove(tunnelId)
      return { ok: false, error: result.error }
    },

    /** Stops keeping a tunnel with its session; a tunnel that is running stays open. */
    async forget(tunnelId: string): Promise<void> {
      const savedTunnelId = store.getState().items[tunnelId]?.savedTunnelId
      if (!savedTunnelId) return
      const result = await api.saved.remove({ id: savedTunnelId })
      if (result.ok) {
        store.getState().markSaved(tunnelId, null)
        store.getState().removeSaved(savedTunnelId)
      }
    },

    /** Opens a saved tunnel that is not running. */
    openSaved(sessionId: string, tunnel: SavedTunnel): Promise<OpenResult> {
      return actions.open(sessionId, tunnel.spec, { savedTunnelId: tunnel.id })
    },

    /** Deletes a saved tunnel that is not running (a running one goes through `forget`). */
    async forgetSaved(tunnel: SavedTunnel): Promise<void> {
      const result = await api.saved.remove({ id: tunnel.id })
      if (result.ok) store.getState().removeSaved(tunnel.id)
    },

    async close(tunnelId: string): Promise<void> {
      await api.close({ tunnelId })
    },
  }
  return actions
}

export type TunnelActions = ReturnType<typeof createTunnelActions>
