import { create } from 'zustand'

export const HISTORY_LIMIT = 30

export interface MultiExecState {
  open: boolean
  broadcast: boolean
  targets: string[]
  /** Newest first, at most 30, no repeats. */
  history: string[]
  /** Bumped to ask the command field for focus. */
  focusRequest: number
  setOpen(open: boolean): void
  focusField(): void
  toggleBroadcast(): void
  toggleTarget(sessionId: string): void
  setTargets(sessionIds: readonly string[]): void
  remember(command: string): void
  prune(live: ReadonlySet<string>): void
}

export function createMultiExecStore() {
  return create<MultiExecState>()((set, get) => ({
    open: false,
    broadcast: false,
    targets: [],
    history: [],
    focusRequest: 0,
    // Broadcast never outlives the composer that shows it.
    setOpen: (open) => set(open ? { open } : { open, broadcast: false }),
    focusField: () => set({ open: true, focusRequest: get().focusRequest + 1 }),
    toggleBroadcast: () => set({ broadcast: !get().broadcast }),
    toggleTarget: (id) => {
      const { targets } = get()
      set({ targets: targets.includes(id) ? targets.filter((t) => t !== id) : [...targets, id] })
    },
    setTargets: (ids) => set({ targets: [...new Set(ids)] }),
    remember: (command) =>
      set({
        history: [command, ...get().history.filter((c) => c !== command)].slice(0, HISTORY_LIMIT),
      }),
    prune: (live) => {
      const targets = get().targets.filter((id) => live.has(id))
      if (targets.length !== get().targets.length) set({ targets })
    },
  }))
}

export const useMultiExec = createMultiExecStore()
