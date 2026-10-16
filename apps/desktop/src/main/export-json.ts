import type { SessionTree } from '@alma/protocol'

/** Bookmarks only: no credentials, and not even whether one is stored. */
export function exportJson(tree: SessionTree): string {
  return JSON.stringify(
    {
      version: 1,
      folders: tree.folders,
      sessions: tree.sessions.map((s) => ({
        id: s.id,
        folderId: s.folderId,
        name: s.name,
        host: s.host,
        port: s.port,
        username: s.username,
        auth: s.auth,
        keyPath: s.keyPath,
      })),
    },
    null,
    2,
  )
}
