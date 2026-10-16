import type { Folder, SavedSession, SessionTree } from '@alma/protocol'
import type { TabStatus } from '../state/sessions-store'

export interface TreeRow {
  kind: 'folder' | 'session'
  id: string
  depth: number
  name: string
  parentId: string | null
  detail?: string
  expanded?: boolean
  status?: TabStatus
}

const collator = new Intl.Collator('es', { sensitivity: 'base' })
const byName = (a: { name: string }, b: { name: string }) => collator.compare(a.name, b.name)

// "Producción" matches "produccion": compare without case or diacritics.
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

const matches = (s: SavedSession, query: string) =>
  [s.name, s.host, s.username].some((field) => normalize(field).includes(query))

export function buildRows(
  tree: SessionTree,
  expanded: ReadonlySet<string>,
  query: string,
  liveBySavedId: ReadonlyMap<string, TabStatus>,
): TreeRow[] {
  const q = normalize(query.trim())
  const childFolders = (parentId: string | null) =>
    tree.folders
      .filter((f) => f.parentId === parentId)
      .sort((a, b) => a.sort - b.sort || byName(a, b))
  const childSessions = (folderId: string | null) =>
    tree.sessions.filter((s) => s.folderId === folderId && (!q || matches(s, q))).sort(byName)

  // While searching, a folder is shown (and open) only if something inside matches.
  const hasMatch = (f: Folder): boolean =>
    childSessions(f.id).length > 0 || childFolders(f.id).some(hasMatch)

  const rows: TreeRow[] = []
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childFolders(parentId)) {
      if (q && !hasMatch(f)) continue
      const open = q ? true : expanded.has(f.id)
      rows.push({ kind: 'folder', id: f.id, depth, name: f.name, parentId, expanded: open })
      if (open) walk(f.id, depth + 1)
    }
    for (const s of childSessions(parentId)) {
      const status = liveBySavedId.get(s.id)
      rows.push({
        kind: 'session',
        id: s.id,
        depth,
        name: s.name,
        parentId,
        detail: `${s.username}@${s.host}`,
        ...(status ? { status } : {}),
      })
    }
  }
  walk(null, 0)
  return rows
}
