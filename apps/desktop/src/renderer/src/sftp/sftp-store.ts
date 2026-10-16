import type { RemoteEntry } from '@alma/protocol'
import { create } from 'zustand'

export interface PanelState {
  path: string
  entries: RemoteEntry[]
  status: 'loading' | 'ready' | 'error'
  /** Failure of the whole listing (shown in the header). */
  error: string | null
  /** Failure of one action on one entry (shown in its row), by name. */
  rowErrors: Record<string, string>
  /** A listing succeeded at least once (retry refreshes instead of starting over). */
  loaded: boolean
  /** Which protocol the session ended up with; scp when the server has no SFTP. */
  mode: 'sftp' | 'scp'
}

interface SftpState {
  panels: Record<string, PanelState>
  patch(sessionId: string, patch: Partial<PanelState>): void
  setRowError(sessionId: string, name: string, message: string | null): void
  drop(sessionId: string): void
  setMode(sessionId: string, mode: 'sftp' | 'scp'): void
}

const EMPTY: PanelState = {
  path: '/',
  entries: [],
  status: 'loading',
  error: null,
  rowErrors: {},
  loaded: false,
  mode: 'sftp',
}

export function createSftpStore() {
  return create<SftpState>()((set, get) => ({
    panels: {},
    patch: (sessionId, patch) =>
      set({
        panels: {
          ...get().panels,
          [sessionId]: { ...EMPTY, ...get().panels[sessionId], ...patch },
        },
      }),
    setRowError: (sessionId, name, message) => {
      const panel = get().panels[sessionId]
      if (!panel) return
      const rest = Object.entries(panel.rowErrors).filter(([key]) => key !== name)
      const rowErrors = Object.fromEntries(message === null ? rest : [...rest, [name, message]])
      get().patch(sessionId, { rowErrors })
    },
    setMode: (sessionId, mode) => get().patch(sessionId, { mode }),
    drop: (sessionId) =>
      set({
        panels: Object.fromEntries(Object.entries(get().panels).filter(([id]) => id !== sessionId)),
      }),
  }))
}

export type SftpStore = ReturnType<typeof createSftpStore>

export const useSftp = createSftpStore()
