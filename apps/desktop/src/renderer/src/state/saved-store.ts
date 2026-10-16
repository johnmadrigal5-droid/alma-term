import type { AlmaApi, SessionTree } from '@alma/protocol'
import { create } from 'zustand'

export interface SavedState {
  status: 'loading' | 'error' | 'ready'
  tree: SessionTree | null
  error: string | null
  query: string
  expanded: ReadonlySet<string>
  load(api: AlmaApi['saved']): Promise<void>
  setQuery(query: string): void
  toggle(folderId: string): void
  expand(folderId: string): void
}

export function createSavedStore() {
  return create<SavedState>()((set, get) => ({
    status: 'loading',
    tree: null,
    error: null,
    query: '',
    expanded: new Set(),
    load: async (api) => {
      // Keep showing the previous tree while reloading after an edit.
      if (!get().tree) set({ status: 'loading', error: null })
      const result = await api.tree()
      if (result.ok) set({ status: 'ready', tree: result.data, error: null })
      else set({ status: 'error', error: result.error.message })
    },
    setQuery: (query) => set({ query }),
    toggle: (folderId) => {
      const expanded = new Set(get().expanded)
      if (!expanded.delete(folderId)) expanded.add(folderId)
      set({ expanded })
    },
    expand: (folderId) => {
      if (get().expanded.has(folderId)) return
      set({ expanded: new Set([...get().expanded, folderId]) })
    },
  }))
}

export type SavedStore = ReturnType<typeof createSavedStore>

export const useSaved = createSavedStore()
