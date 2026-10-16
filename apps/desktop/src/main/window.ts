import type { ThemeName } from '@alma/protocol'
import { BrowserWindow } from 'electron'
import { OVERLAY } from './window-theme'

export interface WindowOptions {
  devServerUrl: string | undefined
  rendererFile: string
  preloadFile: string
  theme: ThemeName
}

export function createMainWindow(options: WindowOptions): BrowserWindow {
  const isMac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: OVERLAY[options.theme].color,
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    ...(isMac ? {} : { titleBarOverlay: OVERLAY[options.theme] }),
    webPreferences: {
      preload: options.preloadFile,
      // Read by the preload before the first paint, so the window starts on the saved theme.
      additionalArguments: [`--alma-theme=${options.theme}`],
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('render-process-gone', (_event, details) => {
    console.warn(`[main] renderer terminado: ${details.reason}`)
    if (details.reason !== 'clean-exit') win.webContents.reload()
  })
  win.once('ready-to-show', () => win.show())
  if (options.devServerUrl) void win.loadURL(options.devServerUrl)
  else void win.loadFile(options.rendererFile)
  return win
}
