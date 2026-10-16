import type { ProtocolError, SavedTunnel, TunnelEvent, TunnelSpec } from '@alma/protocol'
import { create } from 'zustand'

export type TunnelViewState = 'opening' | 'open' | 'closed' | 'error'

export interface TunnelView {
  tunnelId: string
  sessionId: string
  spec: TunnelSpec
  state: TunnelViewState
  /** The port really listening; 0 while the tunnel is opening. */
  boundPort: number
  connections: number
  error: ProtocolError | null
  /** Id of the saved tunnel this row is kept as; null when it is only running. */
  savedTunnelId: string | null
}

export const isActiveTunnel = (view: TunnelView) =>
  view.state === 'opening' || view.state === 'open'

interface TunnelsState {
  items: Record<string, TunnelView>
  /** Saved tunnels by saved session (bookmark) id, for the sessions that are open. */
  saved: Record<string, SavedTunnel[]>
  setSaved(savedId: string, list: SavedTunnel[]): void
  addSaved(savedId: string, tunnel: SavedTunnel): void
  removeSaved(id: string): void
  /** A tunnel that failed to open stays as an error row (saved ones, started on their own). */
  markFailed(tunnelId: string, error: ProtocolError): void
  /** Newest first. */
  views(): TunnelView[]
  activeCount(): number
  /** Shows the tunnel as opening while the host works on it. */
  begin(tunnelId: string, sessionId: string, spec: TunnelSpec, savedTunnelId?: string | null): void
  markSaved(tunnelId: string, savedTunnelId: string | null): void
  apply(event: TunnelEvent): void
  remove(tunnelId: string): void
  /** The sessions are gone (the host died): their tunnels went with them. */
  closeSessions(sessionIds: readonly string[]): void
  clearClosed(): void
}

export function createTunnels() {
  return create<TunnelsState>()((set, get) => ({
    items: {},
    saved: {},
    setSaved: (savedId, list) => set({ saved: { ...get().saved, [savedId]: list } }),
    addSaved: (savedId, tunnel) =>
      set({ saved: { ...get().saved, [savedId]: [...(get().saved[savedId] ?? []), tunnel] } }),
    removeSaved: (id) =>
      set({
        saved: Object.fromEntries(
          Object.entries(get().saved).map(([key, list]) => [key, list.filter((t) => t.id !== id)]),
        ),
      }),
    markFailed: (tunnelId, error) => {
      const view = get().items[tunnelId]
      if (view)
        set({
          items: { ...get().items, [tunnelId]: { ...view, state: 'error', error, connections: 0 } },
        })
    },
    views: () => Object.values(get().items).reverse(),
    activeCount: () => Object.values(get().items).filter(isActiveTunnel).length,

    begin: (tunnelId, sessionId, spec, savedTunnelId = null) =>
      set({
        items: {
          ...get().items,
          [tunnelId]: {
            tunnelId,
            sessionId,
            spec,
            state: 'opening',
            boundPort: 0,
            connections: 0,
            error: null,
            savedTunnelId,
          },
        },
      }),

    markSaved: (tunnelId, savedTunnelId) => {
      const view = get().items[tunnelId]
      if (view) set({ items: { ...get().items, [tunnelId]: { ...view, savedTunnelId } } })
    },

    apply: (event) =>
      set({
        items: {
          ...get().items,
          [event.tunnelId]: {
            tunnelId: event.tunnelId,
            sessionId: event.sessionId,
            spec: event.spec,
            state: event.state,
            boundPort: event.boundPort,
            connections: event.state === 'open' ? event.connections : 0,
            error: event.error ?? null,
            savedTunnelId: get().items[event.tunnelId]?.savedTunnelId ?? null,
          },
        },
      }),

    remove: (tunnelId) =>
      set({
        items: Object.fromEntries(Object.entries(get().items).filter(([id]) => id !== tunnelId)),
      }),

    closeSessions: (sessionIds) => {
      const lost = new Set(sessionIds)
      set({
        items: Object.fromEntries(
          Object.entries(get().items).map(([id, view]) => [
            id,
            lost.has(view.sessionId) && isActiveTunnel(view)
              ? { ...view, state: 'closed' as const, connections: 0 }
              : view,
          ]),
        ),
      })
    },

    clearClosed: () =>
      set({
        items: Object.fromEntries(Object.entries(get().items).filter(([, v]) => isActiveTunnel(v))),
      }),
  }))
}

export type TunnelsStore = ReturnType<typeof createTunnels>
