import type {
  AlmaApi,
  ThemeName,
  HostLostPush,
  PromptClosedEvent,
  PromptEvent,
  SftpModeEvent,
  StatusEvent,
  StepEvent,
  TransferEvent,
  TunnelEvent,
} from '@alma/protocol'
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

// main passes the saved theme as a window argument: known before anything is painted.
const initialTheme: ThemeName = (() => {
  // No runtime import here (the sandboxed preload is bundled alone): anything but "light" is dark.
  return process.argv.includes('--alma-theme=light') ? 'light' : 'dark'
})()

const api: AlmaApi = {
  platform: process.platform,
  initialTheme,
  settings: {
    setTheme: (theme) => ipcRenderer.invoke('settings:setTheme', theme),
    chooseLogDir: () => ipcRenderer.invoke('settings:chooseLogDir'),
    openLogDir: () => ipcRenderer.invoke('settings:openLogDir'),
  },
  flags: { disableWebgl: process.env['ALMA_DISABLE_WEBGL'] === '1' },
  session: {
    openLocal: (args) => ipcRenderer.invoke('session:openLocal', args),
    openSsh: (args) => ipcRenderer.invoke('session:openSsh', args),
    answerPrompt: (args) => ipcRenderer.invoke('session:answerPrompt', args),
    resize: (args) => ipcRenderer.invoke('session:resize', args),
    close: (args) => ipcRenderer.invoke('session:close', args),
    openSaved: (args) => ipcRenderer.invoke('session:openSaved', args),
    reattachAll: () => ipcRenderer.invoke('session:reattachAll'),
  },
  saved: {
    tree: () => ipcRenderer.invoke('saved:tree'),
    save: (input) => ipcRenderer.invoke('saved:save', input),
    remove: (args) => ipcRenderer.invoke('saved:remove', args),
    createFolder: (args) => ipcRenderer.invoke('saved:createFolder', args),
    renameFolder: (args) => ipcRenderer.invoke('saved:renameFolder', args),
    removeFolder: (args) => ipcRenderer.invoke('saved:removeFolder', args),
    previewImport: () => ipcRenderer.invoke('saved:previewImport'),
    applyImport: (args) => ipcRenderer.invoke('saved:applyImport', args),
    exportJson: () => ipcRenderer.invoke('saved:exportJson'),
  },
  sftp: {
    home: (args) => ipcRenderer.invoke('sftp:home', args),
    list: (args) => ipcRenderer.invoke('sftp:list', args),
    stat: (args) => ipcRenderer.invoke('sftp:stat', args),
    mkdir: (args) => ipcRenderer.invoke('sftp:mkdir', args),
    rename: (args) => ipcRenderer.invoke('sftp:rename', args),
    remove: (args) => ipcRenderer.invoke('sftp:remove', args),
    chmod: (args) => ipcRenderer.invoke('sftp:chmod', args),
  },
  transfers: {
    start: (args) => ipcRenderer.invoke('transfers:start', args),
    pause: (args) => ipcRenderer.invoke('transfers:pause', args),
    resume: (args) => ipcRenderer.invoke('transfers:resume', args),
    cancel: (args) => ipcRenderer.invoke('transfers:cancel', args),
    localExists: (args) => ipcRenderer.invoke('transfers:localExists', args),
  },
  onTransfer: (listener) => subscribe<TransferEvent>('transfers:event', listener),
  onSftpMode: (listener) => subscribe<SftpModeEvent>('sftp:mode', listener),
  tunnels: {
    open: (args) => ipcRenderer.invoke('tunnels:open', args),
    close: (args) => ipcRenderer.invoke('tunnels:close', args),
    saved: {
      list: (args) => ipcRenderer.invoke('tunnels:saved:list', args),
      save: (args) => ipcRenderer.invoke('tunnels:saved:save', args),
      remove: (args) => ipcRenderer.invoke('tunnels:saved:remove', args),
    },
  },
  onTunnel: (listener) => subscribe<TunnelEvent>('tunnels:event', listener),
  pickUploadFiles: () => ipcRenderer.invoke('dialog:pickUploadFiles'),
  pickDownloadFolder: () => ipcRenderer.invoke('dialog:pickDownloadFolder'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onStatus: (listener) => {
    const handler = (_event: IpcRendererEvent, payload: StatusEvent) => listener(payload)
    ipcRenderer.on('session:status', handler)
    return () => {
      ipcRenderer.removeListener('session:status', handler)
    }
  },
  onHostLost: (listener) => subscribe<HostLostPush>('host:lost', listener),
  onStep: (listener) => subscribe<StepEvent>('session:step', listener),
  onPrompt: (listener) => subscribe<PromptEvent>('session:prompt', listener),
  onPromptClosed: (listener) => subscribe<PromptClosedEvent>('session:prompt-closed', listener),
  pickPrivateKey: () => ipcRenderer.invoke('dialog:pickPrivateKey'),
}

// contextBridge cannot carry MessagePorts, so forward them to the page with window.postMessage.
ipcRenderer.on('session:port', (event, meta: { sessionId: string }) => {
  window.postMessage({ type: 'alma:port', sessionId: meta.sessionId }, '*', event.ports)
})

contextBridge.exposeInMainWorld('api', api)
