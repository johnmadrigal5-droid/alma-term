import { randomUUID } from 'node:crypto'
import {
  clampSize,
  type ApiResult,
  type ApplyImportArgs,
  type ControlRequest,
  type CreateFolderArgs,
  type CredentialEvent,
  type Folder,
  type IdArgs,
  type ImportCandidate,
  type ImportPreview,
  type SessionLog,
  type LiveSession,
  type OpenSavedArgs,
  type RenameFolderArgs,
  type SavedSession,
  SaveSessionInput,
  type SessionTree,
} from '@alma/protocol'
import { AppError } from './app-error'
import { HostRequestError, type RequestOptions } from './host-supervisor'
import type { KnownHostsStore } from './known-hosts-store'
import type { SecretStore } from './secrets'
import type { SessionRegistry } from './session-registry'
import type { SessionsRepo } from './sessions-repo'
import { exportJson } from './export-json'

export const IMPORT_FOLDER = 'Importadas de ~/.ssh/config'

interface ClosablePort {
  close(): void
}

export interface SavedHandlerDeps<P extends ClosablePort> {
  repo: SessionsRepo
  secrets: Pick<SecretStore, 'isSecure'>
  registry: SessionRegistry
  knownHosts: KnownHostsStore
  request(message: ControlRequest, transfer?: P[], options?: RequestOptions): Promise<unknown>
  newChannel(): { port1: P; port2: P }
  postPort(sessionId: string, port: P): void
  previewImport(existing: SavedSession[]): ImportPreview
  /** Asks the user where to save; null when the dialog is cancelled. */
  saveExportFile(json: string): Promise<string | null>
  /** The session log settings for a connection called `name`; absent when logging is off. */
  logFor?(name: string): Promise<SessionLog>
}

export function toFailure(error: unknown): ApiResult<never> {
  if (error instanceof HostRequestError || error instanceof AppError)
    return { ok: false, error: { code: error.code, message: error.message } }
  const message = error instanceof Error ? error.message : 'Error desconocido'
  return { ok: false, error: { code: 'HOST_UNAVAILABLE', message } }
}

// Without IdentityFile, OpenSSH would end up asking for the password.
function importInput(c: ImportCandidate, folderId: string | null) {
  return SaveSessionInput.safeParse({
    folderId,
    name: c.alias.trim().slice(0, 80),
    ...c.target,
    auth: c.keyPath ? 'key' : 'password',
    keyPath: c.keyPath,
  })
}

/** Drops the candidates the repo would refuse, so the dialog never offers them. */
function validPreview(preview: ImportPreview): ImportPreview {
  const invalid = preview.candidates.filter((c) => !importInput(c, null).success)
  return {
    ...preview,
    candidates: preview.candidates.filter((c) => !invalid.includes(c)),
    warnings: [
      ...preview.warnings,
      ...invalid.map((c) => `Se omite «${c.alias}»: datos de conexión inválidos`),
    ],
  }
}

async function attempt<T>(fn: () => Promise<T>): Promise<ApiResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (error) {
    return toFailure(error)
  }
}

export function createSavedHandlers<P extends ClosablePort>(deps: SavedHandlerDeps<P>) {
  const { repo, registry } = deps

  async function ensureImportFolder(): Promise<Folder> {
    const existing = (await repo.tree()).folders.find(
      (f) => f.parentId === null && f.name === IMPORT_FOLDER,
    )
    return existing ?? repo.createFolder(IMPORT_FOLDER, null)
  }

  return {
    tree: (): Promise<ApiResult<SessionTree>> => attempt(() => repo.tree()),
    save: (input: SaveSessionInput): Promise<ApiResult<SavedSession>> =>
      attempt(() => repo.save(input)),
    remove: ({ id }: IdArgs): Promise<ApiResult<null>> =>
      attempt(async () => {
        await repo.remove(id)
        return null
      }),
    createFolder: ({ name, parentId }: CreateFolderArgs): Promise<ApiResult<Folder>> =>
      attempt(() => repo.createFolder(name, parentId)),
    renameFolder: ({ id, name }: RenameFolderArgs): Promise<ApiResult<null>> =>
      attempt(async () => {
        await repo.renameFolder(id, name)
        return null
      }),
    removeFolder: ({ id }: IdArgs): Promise<ApiResult<null>> =>
      attempt(async () => {
        await repo.removeFolder(id)
        return null
      }),

    previewImport: (): Promise<ApiResult<ImportPreview>> =>
      attempt(async () => validPreview(deps.previewImport((await repo.tree()).sessions))),

    applyImport: ({ aliases }: ApplyImportArgs): Promise<ApiResult<{ created: number }>> =>
      attempt(async () => {
        const existing = (await repo.tree()).sessions
        const chosen = validPreview(deps.previewImport(existing))
          .candidates.filter((c) => aliases.includes(c.alias))
          .filter(
            (c) =>
              !existing.some(
                (s) =>
                  s.host === c.target.host &&
                  s.port === c.target.port &&
                  s.username === c.target.username,
              ),
          )
        if (chosen.length === 0) return { created: 0 }
        const folder = await ensureImportFolder()
        for (const c of chosen) {
          const input = importInput(c, folder.id)
          if (input.success) await repo.save(input.data)
        }
        return { created: chosen.length }
      }),

    exportJson: (): Promise<ApiResult<{ file: string } | null>> =>
      attempt(async () => {
        const file = await deps.saveExportFile(exportJson(await repo.tree()))
        return file ? { file } : null
      }),

    openSaved: ({
      sessionId,
      savedId,
      cols,
      rows,
    }: OpenSavedArgs): Promise<ApiResult<LiveSession>> =>
      attempt(async () => {
        const config = await repo.connectConfig(savedId)
        const { port1, port2 } = deps.newChannel()
        registry.addPending(sessionId, savedId)
        try {
          // No main-side deadline: the host owns the connect timeout and pauses it on prompts.
          await deps.request(
            {
              type: 'ssh.open',
              requestId: randomUUID(),
              sessionId,
              ...clampSize(cols, rows),
              target: config.target,
              auth: config.auth,
              trusted: await deps.knownHosts.list(config.target.host, config.target.port),
              rememberable: deps.secrets.isSecure(),
              log: await deps.logFor?.(`${config.target.username}@${config.target.host}`),
            },
            [port1],
            { timeoutMs: null },
          )
        } catch (error) {
          port2.close()
          throw error
        } finally {
          registry.resolvePending(sessionId)
        }
        const live: LiveSession = { sessionId, kind: 'ssh', title: config.name, savedId }
        registry.add(live)
        deps.postPort(sessionId, port2)
        return live
      }),

    /** Host → main only. The secret is stored encrypted and never reaches the renderer or logs. */
    onCredential: async (event: CredentialEvent): Promise<void> => {
      const savedId =
        registry.get(event.sessionId)?.savedId ?? registry.pendingSavedId(event.sessionId)
      if (!savedId) return
      try {
        await repo.setSecret(savedId, event.kind, event.secret)
      } catch {
        // Not secure anymore or the bookmark was deleted meanwhile: nothing to keep.
      }
    },

    reattachAll: (): Promise<ApiResult<LiveSession[]>> =>
      attempt(async () => {
        // A reloaded renderer lost the tabs of sessions still connecting: cancel them.
        for (const sessionId of registry.takePending())
          await deps
            .request({ type: 'session.close', requestId: randomUUID(), sessionId })
            .catch(() => undefined)
        const reattached: LiveSession[] = []
        for (const live of registry.list()) {
          const { port1, port2 } = deps.newChannel()
          try {
            await deps.request(
              { type: 'session.reattach', requestId: randomUUID(), sessionId: live.sessionId },
              [port1],
            )
            deps.postPort(live.sessionId, port2)
            reattached.push(live)
          } catch {
            port2.close()
            registry.remove(live.sessionId)
          }
        }
        return reattached
      }),
  }
}
