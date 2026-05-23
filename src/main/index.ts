import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { registerIpc, type IpcContext } from './ipc'
import { initAutoUpdate } from './updater'

let mainWindow: BrowserWindow | null = null
let ipc: IpcContext | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 560,
    show: false,
    // Frameless custom title bar, but keep the NATIVE Windows caption buttons
    // (minimize / maximize / close) in the top-right via the overlay API.
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#12151c',   // must match --bg-elev in global.css
      symbolColor: '#8b94a6',
      height: 40
    },
    backgroundColor: '#0b0d12',
    title: 'uregant-terminal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Reveal the window reliably: prefer 'ready-to-show', but fall back to
  // 'did-finish-load' and a timeout so the window never stays stuck hidden.
  let shown = false
  const reveal = (): void => {
    if (shown || !mainWindow) return
    shown = true
    mainWindow.show()
    mainWindow.focus()
  }
  mainWindow.once('ready-to-show', reveal)
  mainWindow.webContents.once('did-finish-load', reveal)
  setTimeout(reveal, 3000)

  // Tell the renderer when the OS maximize state flips so the title-bar
  // maximize/restore button can stay in sync.
  const sendMaxState = (): void =>
    mainWindow?.webContents.send('window:maximized-changed', mainWindow.isMaximized())
  mainWindow.on('maximize', sendMaxState)
  mainWindow.on('unmaximize', sendMaxState)

  mainWindow.webContents.once('did-finish-load', () => {
    if (!mainWindow) return
    if (process.env.UREGANT_SMOKE) {
      void import('./smoke').then((m) => m.runSmoke(mainWindow!))
    } else if (process.env.UREGANT_SMOKE_AI) {
      void import('./smoke').then((m) => m.runAiSmoke(mainWindow!))
    } else if (process.env.UREGANT_SMOKE_SETTINGS) {
      void import('./smoke').then((m) => m.runSettingsSmoke(mainWindow!))
    } else if (process.env.UREGANT_SMOKE_TG) {
      void import('./smoke').then((m) => m.runTelegramSmoke(mainWindow!))
    } else if (process.env.UREGANT_PROFILE) {
      void import('./smoke').then((m) =>
        m.runProfile(mainWindow!, parseInt(process.env.UREGANT_PROFILE!, 10) || 9)
      )
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // electron-vite injects ELECTRON_RENDERER_URL in dev.
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Use a stable app name so the userData dir (settings + persisted workspace)
// is consistent across dev (`npm run dev`) and the packaged build, and never
// shares the generic "Electron" data dir with other unpackaged Electron apps.
app.setName('uregant-terminal')

// Single-instance lock — only in the packaged app. Launching the .exe again
// focuses the existing window instead of opening a duplicate. Skipped in dev
// because electron-vite spawns a fresh Electron on every hot-restart.
const hasInstanceLock = !app.isPackaged || app.requestSingleInstanceLock()
if (!hasInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

app.whenReady().then(() => {
  if (!hasInstanceLock) return
  app.setAppUserModelId('com.uregant.terminal')
  ipc = registerIpc(() => mainWindow)
  createWindow()
  initAutoUpdate(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  ipc?.pty.killAll()
  ipc?.streamer.cancelAll()
  void ipc?.telegram.stop()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
