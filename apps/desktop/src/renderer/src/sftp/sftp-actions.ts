import type {
  AlmaApi,
  ProtocolError,
  RemoteEntry,
  TransferEvent,
  TransferStartArgs,
} from '@alma/protocol'
import { isLocalName, joinLocal, localBasename } from './format'
import { joinRemote, parentRemote, remoteBasename } from './remote'
import type { SftpStore } from './sftp-store'

export interface OverwriteAnswer {
  replace: boolean
  /** Apply the same answer to the remaining conflicts of this batch. */
  all: boolean
}

interface Deps {
  api: Pick<AlmaApi, 'sftp' | 'transfers' | 'pickUploadFiles' | 'pickDownloadFolder'>
  store: SftpStore
  platform: string
  askOverwrite(name: string, many: boolean): Promise<OverwriteAnswer>
  /** Removes a transfer from the Transfers list (a conflict that was answered here). */
  dismissTransfer(transferId: string): void
  /** Every transfer started here, with its arguments (the Transfers list retries with them). */
  onStarted?(args: TransferStartArgs & { transferId: string }): void
  /** A transfer the host refused to queue (the session is gone, invalid arguments). */
  onStartFailed?(
    args: TransferStartArgs & { transferId: string },
    name: string,
    error: ProtocolError,
  ): void
  newId?: () => string
}

interface Started {
  sessionId: string
  direction: 'upload' | 'download'
  localPath: string
  remotePath: string
}

/** Resolves the overwrite question for each conflict of a batch, honouring "Aplicar a todos". */
function overwritePolicy(ask: Deps['askOverwrite'], many: boolean) {
  let remembered: boolean | null = null
  return async (name: string): Promise<boolean> => {
    if (remembered !== null) return remembered
    const answer = await ask(name, many)
    if (answer.all) remembered = answer.replace
    return answer.replace
  }
}

export function createSftpActions(deps: Deps) {
  const { api, store } = deps
  const newId = deps.newId ?? (() => crypto.randomUUID())
  const started = new Map<string, Started>()
  const panel = (sessionId: string) => store.getState().panels[sessionId]
  /** Latest listing asked per session; older answers are dropped. */
  const listing = new Map<string, number>()
  const ticket = (sessionId: string) => {
    const next = (listing.get(sessionId) ?? 0) + 1
    listing.set(sessionId, next)
    return () => listing.get(sessionId) === next
  }

  async function load(sessionId: string, path: string): Promise<void> {
    const current = ticket(sessionId)
    store.getState().patch(sessionId, { status: 'loading', error: null })
    const result = await api.sftp.list({ sessionId, path })
    if (!current()) return
    if (result.ok)
      store.getState().patch(sessionId, {
        path,
        entries: result.data,
        status: 'ready',
        rowErrors: {},
        loaded: true,
      })
    else store.getState().patch(sessionId, { status: 'error', error: result.error.message })
  }

  async function start(job: Started & { overwrite: boolean }): Promise<void> {
    const transferId = newId()
    started.set(transferId, job)
    const args = { transferId, ...job }
    deps.onStarted?.(args)
    const result = await api.transfers.start(args)
    if (result.ok) return
    started.delete(transferId)
    const name =
      job.direction === 'upload' ? localBasename(job.localPath) : remoteBasename(job.remotePath)
    deps.onStartFailed?.(args, name, result.error)
  }

  const rowAction = async (
    sessionId: string,
    name: string,
    run: () => Promise<{ ok: boolean; error?: { message: string } }>,
  ) => {
    store.getState().setRowError(sessionId, name, null)
    const result = await run()
    if (result.ok) await refresh(sessionId)
    else store.getState().setRowError(sessionId, name, result.error?.message ?? 'Error')
  }

  async function refresh(sessionId: string): Promise<void> {
    const current = panel(sessionId)
    if (current) await load(sessionId, current.path)
  }

  async function open(sessionId: string): Promise<void> {
    if (panel(sessionId)?.status === 'ready') return
    store.getState().patch(sessionId, { status: 'loading', error: null })
    const home = await api.sftp.home({ sessionId })
    if (!home.ok)
      return store.getState().patch(sessionId, { status: 'error', error: home.error.message })
    await load(sessionId, home.data)
  }

  async function upload(sessionId: string, localPaths: readonly string[]): Promise<void> {
    const current = panel(sessionId)
    if (!current) return
    const replace = overwritePolicy(deps.askOverwrite, localPaths.length > 1)
    for (const localPath of localPaths) {
      const name = localBasename(localPath)
      const remotePath = joinRemote(current.path, name)
      const existing = await api.sftp.stat({ sessionId, path: remotePath })
      if (existing.ok && existing.data?.kind === 'dir') {
        store.getState().setRowError(sessionId, name, 'Ya hay una carpeta con ese nombre')
        continue
      }
      const exists = existing.ok && existing.data !== null
      if (exists && !(await replace(name))) continue
      await start({ sessionId, direction: 'upload', localPath, remotePath, overwrite: exists })
    }
  }

  return {
    open,

    /** Retries whatever failed: the home lookup if nothing loaded yet, else the listing. */
    async retry(sessionId: string): Promise<void> {
      const current = panel(sessionId)
      // Nothing ever listed: the home lookup itself failed, so start over.
      if (!current?.loaded) {
        store.getState().drop(sessionId)
        return open(sessionId)
      }
      return refresh(sessionId)
    },

    refresh,
    goto: load,

    async cd(sessionId: string, name: string): Promise<void> {
      const current = panel(sessionId)
      if (!current) return
      const target = joinRemote(current.path, name)
      const latest = ticket(sessionId)
      store.getState().setRowError(sessionId, name, null)
      const result = await api.sftp.list({ sessionId, path: target })
      if (!latest()) return
      if (result.ok)
        store.getState().patch(sessionId, {
          path: target,
          entries: result.data,
          status: 'ready',
          error: null,
          rowErrors: {},
          loaded: true,
        })
      else {
        // This cd superseded a listing in flight; the entries on screen are still the last good ones.
        if (panel(sessionId)?.status === 'loading')
          store.getState().patch(sessionId, { status: 'ready' })
        store.getState().setRowError(sessionId, name, result.error.message)
      }
    },

    async up(sessionId: string): Promise<void> {
      const current = panel(sessionId)
      if (current && current.path !== '/') await load(sessionId, parentRemote(current.path))
    },

    /** null on success, else the message for the dialog. */
    async mkdir(sessionId: string, name: string): Promise<string | null> {
      const current = panel(sessionId)
      if (!current) return 'El panel no está listo'
      const result = await api.sftp.mkdir({ sessionId, path: joinRemote(current.path, name) })
      if (!result.ok) return result.error.message
      await refresh(sessionId)
      return null
    },

    async rename(sessionId: string, entry: RemoteEntry, name: string): Promise<void> {
      const current = panel(sessionId)
      if (!current) return
      await rowAction(sessionId, entry.name, () =>
        api.sftp.rename({
          sessionId,
          from: joinRemote(current.path, entry.name),
          to: joinRemote(current.path, name),
        }),
      )
    },

    async remove(sessionId: string, entry: RemoteEntry): Promise<void> {
      const current = panel(sessionId)
      if (!current) return
      await rowAction(sessionId, entry.name, () =>
        api.sftp.remove({
          sessionId,
          path: joinRemote(current.path, entry.name),
          kind: entry.kind,
        }),
      )
    },

    async chmod(sessionId: string, entry: RemoteEntry, mode: number): Promise<void> {
      const current = panel(sessionId)
      if (!current) return
      await rowAction(sessionId, entry.name, () =>
        api.sftp.chmod({ sessionId, path: joinRemote(current.path, entry.name), mode }),
      )
    },

    upload,

    async pickAndUpload(sessionId: string): Promise<void> {
      const files = await api.pickUploadFiles()
      if (files.length > 0) await upload(sessionId, files)
    },

    /** Files only in this milestone; folders in the selection are skipped. */
    async download(sessionId: string, entries: readonly RemoteEntry[]): Promise<void> {
      const current = panel(sessionId)
      const files = entries.filter((e) => e.kind !== 'dir')
      if (!current || files.length === 0) return
      const folder = await api.pickDownloadFolder()
      if (!folder) return
      const replace = overwritePolicy(deps.askOverwrite, files.length > 1)
      for (const entry of files) {
        if (!isLocalName(entry.name, deps.platform)) {
          store
            .getState()
            .setRowError(sessionId, entry.name, 'El nombre no es válido en este sistema')
          continue
        }
        const localPath = joinLocal(folder, entry.name, deps.platform)
        // Asked here and not after a failed first try: no error flashes in the Transfers list.
        const exists = await api.transfers.localExists({ path: localPath })
        const there = exists.ok && exists.data
        if (there && !(await replace(entry.name))) continue
        await start({
          sessionId,
          direction: 'download',
          localPath,
          remotePath: joinRemote(current.path, entry.name),
          overwrite: there,
        })
      }
    },

    /**
     * Reacts to transfers this panel started: refresh after uploads, and ask on a download
     * conflict that appeared between the existence check and the open.
     */
    async onTransfer(event: TransferEvent): Promise<void> {
      const job = started.get(event.transferId)
      if (!job) return
      if (event.state !== 'done' && event.state !== 'error' && event.state !== 'cancelled') return
      started.delete(event.transferId)
      if (event.state === 'error' && event.error?.code === 'EEXIST') {
        deps.dismissTransfer(event.transferId)
        if (await deps.askOverwrite(event.name, false).then((a) => a.replace))
          await start({ ...job, overwrite: true })
        return
      }
      const current = panel(job.sessionId)
      if (
        event.state === 'done' &&
        job.direction === 'upload' &&
        current?.path === parentRemote(job.remotePath)
      )
        await refresh(job.sessionId)
    },
  }
}

export type SftpActions = ReturnType<typeof createSftpActions>
