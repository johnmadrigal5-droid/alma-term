import type {
  AlmaApi,
  ApiResult,
  Folder,
  SavedSession,
  SaveSessionInput,
  SshAuth,
} from '@alma/protocol'
import type { SaveOptions } from '../ssh/ConnectDialog'
import { useSaved, type SavedStore } from './saved-store'
import type { SshRequest } from './sessions-store'

interface SessionOpeners {
  openSaved(input: { title: string; request: SshRequest }): Promise<void>
  openSsh(request: SshRequest, title?: string): Promise<void>
}

function authOf(saved: SavedSession, typed: Pick<SaveOptions, 'password' | 'passphrase'>): SshAuth {
  switch (saved.auth) {
    case 'agent':
      return { type: 'agent' }
    case 'key':
      return {
        type: 'key',
        privateKeyPath: saved.keyPath ?? '',
        ...(typed.passphrase ? { passphrase: typed.passphrase } : {}),
      }
    case 'password':
      return typed.password ? { type: 'password', password: typed.password } : { type: 'password' }
  }
}

function requestOf(saved: SavedSession, typed: SaveOptions | null = null): SshRequest {
  return {
    target: { host: saved.host, port: saved.port, username: saved.username },
    auth: authOf(saved, typed ?? {}),
    savedId: saved.id,
  }
}

export function createSavedActions(
  api: AlmaApi['saved'],
  store: SavedStore = useSaved,
  sessions: SessionOpeners,
) {
  const reload = () => store.getState().load(api)

  async function after<T>(result: ApiResult<T>): Promise<ApiResult<T>> {
    if (result.ok) await reload()
    return result
  }

  async function connect(saved: SavedSession): Promise<void> {
    await sessions.openSaved({ title: saved.name, request: requestOf(saved) })
  }

  async function save(
    input: SaveSessionInput,
    options: SaveOptions,
  ): Promise<ApiResult<SavedSession>> {
    const result = await after(await api.save(input))
    if (!result.ok || !options.connect) return result
    // A secret typed in the form opens the first connection directly; otherwise main supplies
    // the stored one (or the server asks for it).
    // Not awaited: the editor closes right away and the tab shows the connection steps.
    if (options.password || options.passphrase)
      void sessions.openSsh(requestOf(result.data, options), result.data.name)
    else void connect(result.data)
    return result
  }

  return {
    reload,
    connect,
    save,
    duplicate: async (saved: SavedSession) =>
      after(
        await api.save({
          folderId: saved.folderId,
          name: `${saved.name} (copia)`.slice(0, 80),
          host: saved.host,
          port: saved.port,
          username: saved.username,
          auth: saved.auth,
          keyPath: saved.keyPath,
        }),
      ),
    remove: async (id: string) => after(await api.remove({ id })),
    createFolder: async (name: string, parentId: string | null): Promise<ApiResult<Folder>> =>
      after(await api.createFolder({ name, parentId })),
    renameFolder: async (id: string, name: string) => after(await api.renameFolder({ id, name })),
    removeFolder: async (id: string) => after(await api.removeFolder({ id })),
  }
}

export type SavedActions = ReturnType<typeof createSavedActions>
