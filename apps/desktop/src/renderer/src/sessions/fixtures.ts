import type { Folder, SavedSession, SessionTree } from '@alma/protocol'

let n = 0
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`

export function folder(name: string, parentId: string | null = null): Folder {
  return { id: uuid(), name, parentId, sort: 0 }
}

export function session(
  name: string,
  folderId: string | null = null,
  over: Partial<SavedSession> = {},
): SavedSession {
  return {
    id: uuid(),
    folderId,
    name,
    host: `${name.toLowerCase()}.example`,
    port: 22,
    username: 'alma',
    auth: 'password',
    keyPath: null,
    hasPassword: false,
    hasPassphrase: false,
    ...over,
  }
}

export function treeOf(folders: Folder[], sessions: SavedSession[]): SessionTree {
  return { folders, sessions, canRemember: true }
}
