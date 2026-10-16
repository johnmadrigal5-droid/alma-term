import { create } from 'zustand'
import {
  arrange,
  clampSplit,
  effectivePane,
  PANE_COUNT,
  spread,
  type LayoutPreset,
  type Split,
} from '../layout/panes'
import { useSessions, type SessionsStore } from './sessions-store'

export interface PanesState {
  preset: LayoutPreset
  split: Split
  /** Pane each tab was put in, kept across presets. */
  home: Record<string, number>
  /** Tab ids, most recently active first. */
  recent: string[]
  /** Pane that receives the next new tab, when the user picked an empty one. */
  target: number | null
  setPreset(preset: LayoutPreset): void
  setSplit(axis: 'x' | 'y', ratio: number): void
  moveTab(sessionId: string, pane: number): void
  focusPane(pane: number): void
}

export function createPanesStore(sessions: SessionsStore) {
  const ids = () => sessions.getState().tabs.map((t) => t.sessionId)
  const store = create<PanesState>()((set, get) => ({
    preset: 'single',
    split: { x: 0.5, y: 0.5 },
    home: {},
    recent: [],
    target: null,
    setPreset: (preset) =>
      set({ preset, target: null, home: spread(ids(), get().home, get().recent, preset) }),
    setSplit: (axis, ratio) => set({ split: { ...get().split, [axis]: clampSplit(ratio) } }),
    moveTab: (sessionId, pane) => {
      if (pane < 0 || pane >= PANE_COUNT[get().preset] || !(sessionId in get().home)) return
      set({ home: { ...get().home, [sessionId]: pane }, target: null })
      sessions.getState().setActive(sessionId)
    },
    focusPane: (pane) => {
      const { home, recent, preset } = get()
      const shown = arrange(ids(), home, recent, preset).front[pane]
      if (shown) {
        set({ target: null })
        sessions.getState().setActive(shown)
      } else set({ target: pane })
    },
  }))

  sessions.subscribe((state, prev) => {
    const { home, recent, preset, target } = store.getState()
    const live = state.tabs.map((t) => t.sessionId)
    const focused =
      target ?? (prev.activeId !== null ? effectivePane(home[prev.activeId], preset) : 0)
    let placed = false
    const nextHome: Record<string, number> = {}
    for (const id of live) {
      const known = home[id]
      if (known === undefined) placed = true
      nextHome[id] = known ?? focused
    }
    let nextRecent = recent.filter((id) => live.includes(id))
    // The active tab closed: stay in its pane (its next tab, or the pane itself if now empty)
    // instead of jumping to whatever followed it in tab order.
    let nextTarget = placed ? null : target
    let stay: string | null = null
    if (prev.activeId !== null && !live.includes(prev.activeId)) {
      const pane = effectivePane(home[prev.activeId], preset)
      const next = arrange(live, nextHome, nextRecent, preset).front[pane] ?? null
      if (next === null) nextTarget = pane
      else if (state.activeId === null || effectivePane(nextHome[state.activeId], preset) !== pane)
        stay = next
    }
    // The user went back to a tab they already had: they gave up on the pane they had picked.
    const switched =
      state.activeId !== prev.activeId &&
      state.activeId !== null &&
      prev.activeId !== null &&
      live.includes(prev.activeId) &&
      !placed
    // Opening a terminal in the picked pane failed: nothing is waiting for it any more.
    const failedOpen = state.openError !== null && state.openError !== prev.openError
    if (switched || failedOpen) nextTarget = null
    const active = stay ?? state.activeId
    if (active !== null && nextRecent[0] !== active)
      nextRecent = [active, ...nextRecent.filter((id) => id !== active)]
    const same =
      live.length === Object.keys(home).length &&
      !placed &&
      nextTarget === target &&
      nextRecent.length === recent.length &&
      nextRecent.every((id, i) => recent[i] === id)
    if (!same) store.setState({ home: nextHome, recent: nextRecent, target: nextTarget })
    if (stay !== null) sessions.getState().setActive(stay)
  })

  return store
}

export const usePanes = createPanesStore(useSessions)
