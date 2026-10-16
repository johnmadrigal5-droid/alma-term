import type {
  AuthPrompt,
  ConnectStep,
  HostKeyPrompt,
  ProtocolError,
  SavedSession,
  SshAuth,
  SshTarget,
} from '@alma/protocol'
import { create } from 'zustand'

export type TabStatus = 'connecting' | 'ready' | 'error' | 'closed' | 'lost'

/** What an SSH tab was opened with; never holds a password (re-asked on retry). */
export interface SshRequest {
  target: SshTarget
  auth: SshAuth
  /** Bookmark the tab came from: retry reopens it by id so main supplies the stored secret. */
  savedId?: string | null
}

export interface Tab {
  sessionId: string
  title: string
  kind: 'local' | 'ssh'
  status: TabStatus
  exitCode: number | null
  generation: number
  step: ConnectStep | null
  error: ProtocolError | null
  request: SshRequest | null
  /** Why a lost tab died: its network connection, or the whole session host. */
  lostBy?: 'connection' | 'host'
}

export interface PendingPrompt {
  sessionId: string
  promptId: string
  prompt: HostKeyPrompt | AuthPrompt
}

export interface ConnectDialogState {
  initial: SshRequest | null
  /** Tab replaced by the new connection when editing a failed session. */
  replaceId: string | null
  /** Bookmark being edited, if any. */
  saved: SavedSession | null
  /** Folder preselected for a new session ("Nueva sesión aquí"). */
  folderId: string | null
}

export interface SessionsState {
  tabs: Tab[]
  activeId: string | null
  openError: string | null
  nextNumber: number
  prompts: PendingPrompt[]
  connectDialog: ConnectDialogState | null
  addTab(input: { sessionId: string; title: string; kind?: Tab['kind'] }): void
  addSshTab(input: { sessionId: string; title: string; request: SshRequest }): void
  setStep(sessionId: string, step: ConnectStep): void
  setError(sessionId: string, error: ProtocolError): void
  addPrompt(prompt: PendingPrompt): void
  removePrompt(promptId: string): void
  openConnectDialog(state?: Partial<ConnectDialogState>): void
  closeConnectDialog(): void
  setStatus(sessionId: string, status: TabStatus, exitCode?: number | null): void
  removeTab(sessionId: string): void
  setActive(sessionId: string): void
  cycle(delta: 1 | -1): void
  selectIndex(index: number): void
  markLost(sessionIds: readonly string[], by: 'connection' | 'host'): void
  setOpenError(message: string | null): void
}

function blankTab(sessionId: string, title: string, kind: Tab['kind']): Tab {
  return {
    sessionId,
    title,
    kind,
    status: 'connecting',
    exitCode: null,
    generation: 0,
    step: null,
    error: null,
    request: null,
  }
}

export function createSessionsStore() {
  return create<SessionsState>()((set, get) => {
    const updateTab = (sessionId: string, fn: (tab: Tab) => Tab) =>
      set({ tabs: get().tabs.map((t) => (t.sessionId === sessionId ? fn(t) : t)) })
    return {
      tabs: [],
      activeId: null,
      openError: null,
      nextNumber: 1,
      prompts: [],
      connectDialog: null,
      addTab: ({ sessionId, title, kind = 'local' }) => {
        const existing = get().tabs.find((t) => t.sessionId === sessionId)
        if (existing) {
          set({
            tabs: get().tabs.map((t) =>
              t.sessionId === sessionId
                ? { ...t, status: 'ready', generation: t.generation + 1 }
                : t,
            ),
            activeId: sessionId,
          })
          return
        }
        const n = get().nextNumber
        const numbered = kind === 'local'
        set({
          tabs: [
            ...get().tabs,
            {
              ...blankTab(sessionId, numbered ? `${title} ${n}` : title, kind),
              status: 'ready',
            },
          ],
          activeId: sessionId,
          nextNumber: numbered ? n + 1 : n,
        })
      },
      addSshTab: ({ sessionId, title, request }) => {
        set({
          tabs: [...get().tabs, { ...blankTab(sessionId, title, 'ssh'), request }],
          activeId: sessionId,
        })
      },
      setStep: (sessionId, step) => updateTab(sessionId, (t) => ({ ...t, step })),
      setError: (sessionId, error) =>
        updateTab(sessionId, (t) => ({ ...t, status: 'error', error, step: null })),
      addPrompt: (prompt) => {
        if (!get().tabs.some((t) => t.sessionId === prompt.sessionId)) return
        set({ prompts: [...get().prompts.filter((p) => p.promptId !== prompt.promptId), prompt] })
      },
      removePrompt: (promptId) =>
        set({ prompts: get().prompts.filter((p) => p.promptId !== promptId) }),
      openConnectDialog: (state = {}) =>
        set({
          connectDialog: {
            initial: state.initial ?? null,
            replaceId: state.replaceId ?? null,
            saved: state.saved ?? null,
            folderId: state.folderId ?? null,
          },
        }),
      closeConnectDialog: () => set({ connectDialog: null }),
      setStatus: (sessionId, status, exitCode = null) =>
        updateTab(sessionId, (t) => ({ ...t, status, exitCode })),
      removeTab: (sessionId) => {
        const { tabs, activeId } = get()
        const index = tabs.findIndex((t) => t.sessionId === sessionId)
        if (index < 0) return
        const remaining = tabs.filter((t) => t.sessionId !== sessionId)
        let nextActive = activeId
        if (activeId === sessionId)
          nextActive = (remaining[index] ?? remaining[index - 1])?.sessionId ?? null
        set({
          tabs: remaining,
          activeId: nextActive,
          prompts: get().prompts.filter((p) => p.sessionId !== sessionId),
        })
      },
      setActive: (sessionId) => set({ activeId: sessionId }),
      cycle: (delta) => {
        const { tabs, activeId } = get()
        if (tabs.length === 0) return
        const index = tabs.findIndex((t) => t.sessionId === activeId)
        const next = tabs[(index + delta + tabs.length) % tabs.length]
        if (next) set({ activeId: next.sessionId })
      },
      selectIndex: (index) => {
        const tab = get().tabs[index]
        if (tab) set({ activeId: tab.sessionId })
      },
      markLost: (sessionIds, by) => {
        const lost = new Set(sessionIds)
        set({
          tabs: get().tabs.map((t) =>
            lost.has(t.sessionId) ? { ...t, status: 'lost', lostBy: by } : t,
          ),
        })
      },
      setOpenError: (message) => set({ openError: message }),
    }
  })
}

export type SessionsStore = ReturnType<typeof createSessionsStore>

export const useSessions = createSessionsStore()
