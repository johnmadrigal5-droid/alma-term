import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { join } from 'node:path'
import {
  AnswerPromptArgs,
  ApplyImportArgs,
  clampSize,
  CloseArgs,
  CreateFolderArgs,
  IdArgs,
  OpenLocalArgs,
  OpenSavedArgs,
  OpenSshArgs,
  RenameFolderArgs,
  ResizeArgs,
  SaveSessionInput,
  SavedTunnelInput,
  SavedTunnelListArgs,
  SavedTunnelRemoveArgs,
  ThemeName,
  type ApiResult,
  type LiveSession,
} from '@alma/protocol'
import {
  dialog,
  ipcMain,
  MessageChannelMain,
  type BrowserWindow,
  type MessagePortMain,
} from 'electron'
import { z } from 'zod'
import type { HostSupervisor } from './host-supervisor'
import type { KnownHostsStore } from './known-hosts-store'
import { createSavedHandlers, toFailure } from './saved-handlers'
import type { SecretStore } from './secrets'
import type { SessionRegistry } from './session-registry'
import type { SessionsRepo } from './sessions-repo'
import type { SettingsRepo } from './settings-repo'
import { createSftpHandlers } from './sftp-handlers'
import { createTunnelHandlers } from './tunnel-handlers'
import type { TunnelsRepo } from './tunnels-repo'
import { OVERLAY } from './window-theme'
import { listDir, previewImport, readText } from './ssh-config-import'

export interface IpcDeps {
  supervisor: HostSupervisor<MessagePortMain>
  registry: SessionRegistry
  knownHosts: KnownHostsStore
  repo: SessionsRepo
  secrets: SecretStore
  settings: SettingsRepo
  tunnels: TunnelsRepo
  getWindow: () => BrowserWindow | null
  isTrusted: (frameUrl: string | undefined) => boolean
}

export function registerIpc(deps: IpcDeps): ReturnType<typeof createSavedHandlers> {
  const saved = createSavedHandlers<MessagePortMain>({
    repo: deps.repo,
    secrets: deps.secrets,
    registry: deps.registry,
    knownHosts: deps.knownHosts,
    request: (message, transfer, options) => deps.supervisor.request(message, transfer, options),
    newChannel: () => new MessageChannelMain(),
    postPort: (sessionId, port) =>
      requireWindow().webContents.postMessage('session:port', { sessionId }, [port]),
    previewImport: (existing) =>
      previewImport({
        home: homedir(),
        localUser: userInfo().username,
        existing,
        read: readText,
        list: listDir,
      }),
    saveExportFile: async (json) => {
      const options: Electron.SaveDialogOptions = {
        title: 'Exportar sesiones',
        defaultPath: join(homedir(), 'alma-sesiones.json'),
        filters: [{ name: 'JSON', extensions: ['json'] }],
      }
      const win = deps.getWindow()
      const result = await (win
        ? dialog.showSaveDialog(win, options)
        : dialog.showSaveDialog(options))
      if (result.canceled || !result.filePath) return null
      writeFileSync(result.filePath, json, { mode: 0o600 })
      return result.filePath
    },
  })

  function handle<A, R>(
    channel: string,
    schema: z.ZodType<A>,
    fn: (args: A) => Promise<ApiResult<R>>,
  ): void {
    ipcMain.handle(channel, async (event, raw: unknown): Promise<ApiResult<R>> => {
      if (!deps.isTrusted(event.senderFrame?.url)) {
        return { ok: false, error: { code: 'INVALID_MESSAGE', message: 'Origen no confiable' } }
      }
      const parsed = schema.safeParse(raw)
      if (!parsed.success)
        return { ok: false, error: { code: 'INVALID_MESSAGE', message: 'Argumentos inválidos' } }
      try {
        return await fn(parsed.data)
      } catch (error) {
        return toFailure(error)
      }
    })
  }

  function requireWindow(): BrowserWindow {
    const win = deps.getWindow()
    if (!win) throw new Error('No hay ventana principal')
    return win
  }

  handle('session:openLocal', OpenLocalArgs, async ({ cols, rows }) => {
    const win = requireWindow()
    const sessionId = randomUUID()
    const { port1, port2 } = new MessageChannelMain()
    try {
      await deps.supervisor.request(
        { type: 'local.open', requestId: randomUUID(), sessionId, ...clampSize(cols, rows) },
        [port1],
      )
    } catch (error) {
      port2.close()
      throw error
    }
    const live: LiveSession = { sessionId, kind: 'local', title: 'local', savedId: null }
    deps.registry.add(live)
    win.webContents.postMessage('session:port', { sessionId }, [port2])
    return { ok: true, data: live }
  })

  handle('session:openSsh', OpenSshArgs, async ({ sessionId, target, auth, cols, rows }) => {
    const win = requireWindow()
    const { port1, port2 } = new MessageChannelMain()
    deps.registry.addPending(sessionId, null)
    try {
      // No main-side deadline: the host times out TCP + handshake itself and pauses
      // that clock while a prompt waits for the user.
      await deps.supervisor.request(
        {
          type: 'ssh.open',
          requestId: randomUUID(),
          sessionId,
          ...clampSize(cols, rows),
          target,
          auth,
          trusted: await deps.knownHosts.list(target.host, target.port),
          rememberable: false,
        },
        [port1],
        { timeoutMs: null },
      )
    } catch (error) {
      port2.close()
      throw error
    } finally {
      deps.registry.resolvePending(sessionId)
    }
    const live: LiveSession = {
      sessionId,
      kind: 'ssh',
      title: `${target.username}@${target.host}`,
      savedId: null,
    }
    deps.registry.add(live)
    win.webContents.postMessage('session:port', { sessionId }, [port2])
    return { ok: true, data: live }
  })

  handle('session:answerPrompt', AnswerPromptArgs, async ({ promptId, answer }) => {
    await deps.supervisor.request({
      type: 'prompt.answer',
      requestId: randomUUID(),
      promptId,
      answer,
    })
    return { ok: true, data: null }
  })

  async function pick(options: Electron.OpenDialogOptions): Promise<string[]> {
    const win = deps.getWindow()
    const result = await (win
      ? dialog.showOpenDialog(win, options)
      : dialog.showOpenDialog(options))
    return result.canceled ? [] : result.filePaths
  }

  ipcMain.handle('dialog:pickPrivateKey', async (event): Promise<string | null> => {
    if (!deps.isTrusted(event.senderFrame?.url)) return null
    const [file] = await pick({
      title: 'Elegir clave privada',
      defaultPath: join(homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles'],
    })
    return file ?? null
  })

  ipcMain.handle('dialog:pickUploadFiles', async (event): Promise<string[]> => {
    if (!deps.isTrusted(event.senderFrame?.url)) return []
    return pick({ title: 'Subir archivos', properties: ['openFile', 'multiSelections'] })
  })

  ipcMain.handle('dialog:pickDownloadFolder', async (event): Promise<string | null> => {
    if (!deps.isTrusted(event.senderFrame?.url)) return null
    const [folder] = await pick({
      title: 'Descargar en',
      properties: ['openDirectory', 'createDirectory'],
    })
    return folder ?? null
  })

  const sftp = createSftpHandlers({
    request: (message, _transfer, options) => deps.supervisor.request(message, [], options),
    localExists: async (path) => {
      try {
        await stat(path)
        return true
      } catch {
        return false
      }
    },
  })
  const tunnels = createTunnelHandlers({
    request: (message, _transfer, options) => deps.supervisor.request(message, [], options),
  })
  for (const { channels, dispatch } of [sftp, tunnels])
    for (const channel of channels)
      ipcMain.handle(channel, async (event, raw: unknown) => {
        if (!deps.isTrusted(event.senderFrame?.url))
          return { ok: false, error: { code: 'INVALID_MESSAGE', message: 'Origen no confiable' } }
        return dispatch(channel, raw)
      })

  handle('session:resize', ResizeArgs, async ({ sessionId, cols, rows }) => {
    await deps.supervisor.request({
      type: 'session.resize',
      requestId: randomUUID(),
      sessionId,
      ...clampSize(cols, rows),
    })
    return { ok: true, data: null }
  })

  handle('session:close', CloseArgs, async ({ sessionId }) => {
    await deps.supervisor.request({ type: 'session.close', requestId: randomUUID(), sessionId })
    deps.registry.remove(sessionId)
    return { ok: true, data: null }
  })

  handle('session:reattachAll', z.undefined(), () => saved.reattachAll())
  handle('session:openSaved', OpenSavedArgs, (args) => saved.openSaved(args))
  handle('saved:tree', z.undefined(), () => saved.tree())
  handle('saved:save', SaveSessionInput, (input) => saved.save(input))
  handle('saved:remove', IdArgs, (args) => saved.remove(args))
  handle('saved:createFolder', CreateFolderArgs, (args) => saved.createFolder(args))
  handle('saved:renameFolder', RenameFolderArgs, (args) => saved.renameFolder(args))
  handle('saved:removeFolder', IdArgs, (args) => saved.removeFolder(args))
  handle('saved:previewImport', z.undefined(), () => saved.previewImport())
  handle('saved:applyImport', ApplyImportArgs, (args) => saved.applyImport(args))
  handle('saved:exportJson', z.undefined(), () => saved.exportJson())
  handle('tunnels:saved:list', SavedTunnelListArgs, async ({ savedId }) => ({
    ok: true,
    data: await deps.tunnels.list(savedId),
  }))
  handle('tunnels:saved:save', SavedTunnelInput, async (input) => ({
    ok: true,
    data: await deps.tunnels.save(input),
  }))
  handle('tunnels:saved:remove', SavedTunnelRemoveArgs, async ({ id }) => {
    await deps.tunnels.remove(id)
    return { ok: true, data: null }
  })
  handle('settings:setTheme', ThemeName, async (theme) => {
    await deps.settings.setTheme(theme)
    // The controls drawn over the title bar follow the theme (macOS draws its own).
    if (process.platform !== 'darwin') deps.getWindow()?.setTitleBarOverlay(OVERLAY[theme])
    return { ok: true, data: null }
  })

  return saved
}
