import type { CredentialEvent } from '@alma/protocol'
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  app,
  dialog,
  safeStorage,
  utilityProcess,
  type BrowserWindow,
  type MessagePortMain,
} from 'electron'
import { ActivityTracker, createCloseGuard } from './activity-tracker'
import { HostRequestError, HostSupervisor } from './host-supervisor'
import { registerIpc } from './ipc'
import { openDatabase } from './db/open-database'
import { KnownHostsStore } from './known-hosts-store'
import { RestartPolicy } from './restart-policy'
import { createSafeStorageSecretStore } from './secrets'
import { SessionRegistry } from './session-registry'
import { createSmokeGuard, smokeMode } from './smoke'
import { SettingsRepo } from './settings-repo'
import { TunnelsRepo } from './tunnels-repo'
import { SessionsRepo } from './sessions-repo'
import { openStorage } from './startup'
import { isTrustedSender } from './trusted-sender'
import { createMainWindow } from './window'

const here = import.meta.dirname
const devServerUrl = app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL']
const rendererFile = join(here, '../renderer/index.html')
const preloadFile = join(here, '../preload/index.cjs')

// CI has a real keyring but no desktop session for Chromium to detect it from: it asks for
// libsecret by name. Only that value is accepted, so the variable cannot pick a weaker store.
if (process.env['ALMA_PASSWORD_STORE'] === 'gnome-libsecret')
  app.commandLine.appendSwitch('password-store', 'gnome-libsecret')

let mainWindow: BrowserWindow | null = null
const activity = new ActivityTracker()

void app.whenReady().then(async () => {
  const registry = new SessionRegistry()
  const userData = app.getPath('userData')
  const db = await openStorage({
    file: join(userData, 'alma.db'),
    migrations: join(app.getAppPath(), 'drizzle'),
    open: openDatabase,
    showError: (title, message) => dialog.showErrorBox(title, message),
  })
  const knownHosts = new KnownHostsStore(db, (m) => console.warn(`[main] ${m}`))
  await knownHosts
    .importLegacyJson(join(userData, 'known_hosts.json'))
    .catch((error: unknown) =>
      console.warn(`[main] claves de host antiguas no migradas: ${String(error)}`),
    )
  const secrets = await createSafeStorageSecretStore(safeStorage, process.platform)
  const repo = new SessionsRepo(db, secrets)
  const settingsRepo = new SettingsRepo(db)
  const theme = await settingsRepo.theme()
  let onCredential: (event: CredentialEvent) => Promise<void> = async () => {}
  const supervisor = new HostSupervisor<MessagePortMain>({
    fork: () => {
      const child = utilityProcess.fork(join(here, 'host.js'), [], {
        serviceName: 'alma-session-host',
        stdio: 'inherit',
      })
      return {
        postMessage: (message, transfer) => child.postMessage(message, transfer),
        onMessage: (listener) => {
          child.on('message', listener)
        },
        onExit: (listener) => {
          child.on('exit', listener)
        },
        kill: () => {
          child.kill()
        },
      }
    },
    policy: new RestartPolicy(),
    onEvent: (event) => {
      activity.apply(event)
      const send = (channel: string) => mainWindow?.webContents.send(channel, event)
      switch (event.type) {
        case 'event.status':
          if (event.state === 'closed' || event.state === 'lost') registry.remove(event.sessionId)
          return send('session:status')
        case 'event.step':
          return send('session:step')
        case 'event.prompt':
          return send('session:prompt')
        case 'event.prompt-closed':
          return send('session:prompt-closed')
        case 'event.hostkey-trusted':
          return void knownHosts.trust(event.entry)
        case 'event.credential':
          // Never forwarded to the renderer: main stores it encrypted.
          return void onCredential(event)
        case 'event.transfer':
          return send('transfers:event')
        case 'event.tunnel':
          return send('tunnels:event')
        case 'event.sftp-mode':
          return send('sftp:mode')
      }
    },
    onHostLost: () => {
      const sessionIds = registry.clear()
      activity.clear()
      mainWindow?.webContents.send('host:lost', { sessionIds })
    },
    onGaveUp: () => {
      dialog.showErrorBox(
        'Alma Term',
        'El proceso de sesiones falló varias veces seguidas. Reinicia la aplicación.',
      )
    },
    warn: (message) => console.warn(`[main] ${message}`),
  })
  supervisor.start()

  const saved = registerIpc({
    supervisor,
    registry,
    knownHosts,
    repo,
    secrets,
    settings: settingsRepo,
    tunnels: new TunnelsRepo(db),
    getWindow: () => mainWindow,
    isTrusted: (url) => isTrustedSender(url, { devServerUrl, rendererFile }),
  })
  onCredential = saved.onCredential

  mainWindow = createMainWindow({ devServerUrl, rendererFile, preloadFile, theme })
  // CI proves each packaged binary starts: window loaded and the host (with node-pty) answering.
  if (smokeMode(process.env)) {
    const guard = createSmokeGuard({
      exit: (code) => app.exit(code),
      // A packaged Windows app has no console: CI reads the verdict from a file as well.
      log: (message) => {
        console.log(message)
        const file = process.env['ALMA_SMOKE_FILE']
        if (file) appendFileSync(file, `${message}\n`)
      },
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    })
    mainWindow.webContents.once('did-finish-load', () => guard.mark('loaded'))
    supervisor
      .request(
        {
          type: 'session.resize',
          requestId: randomUUID(),
          sessionId: randomUUID(),
          cols: 80,
          rows: 24,
        },
        [],
        { timeoutMs: 20_000 },
      )
      .then(
        () => guard.fail('el host aceptó una sesión que no existe'),
        (error: unknown) =>
          // "No such session" is the right answer: the host is up and speaking the protocol.
          error instanceof HostRequestError && error.code === 'SESSION_NOT_FOUND'
            ? guard.mark('hostReady')
            : guard.fail(`el host no respondió bien: ${String(error)}`),
      )
  }

  // Closing with transfers or tunnels running asks first (spec §6). The E2E suite answers for
  // itself through ALMA_E2E_AUTO_CONFIRM_CLOSE so a run never hangs on the dialog.
  const closeGuard = createCloseGuard({
    counts: () => activity.counts(),
    ask: async ({ message, detail }) => {
      if (process.env['ALMA_E2E_AUTO_CONFIRM_CLOSE'] === '1') return true
      const options = {
        type: 'warning' as const,
        message,
        detail,
        buttons: ['Cancelar', 'Cerrar y detener'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }
      const answer = mainWindow
        ? await dialog.showMessageBox(mainWindow, options)
        : await dialog.showMessageBox(options)
      return answer.response === 1
    },
  })
  mainWindow.on('close', (event) => closeGuard.onClose(event, () => mainWindow?.close()))
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  // Not 'before-quit': that one fires before the windows are asked to close, so a quit the user
  // cancels in the close warning would leave the app running with a dead host and a closed db.
  app.on('will-quit', () => {
    supervisor.stop()
    db.close()
  })
})

app.on('window-all-closed', () => app.quit())
