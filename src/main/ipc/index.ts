import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFile } from 'fs/promises'
import { IPC } from '@shared/types'
import type {
  PtySpawnRequest,
  ChatStreamRequest,
  ProviderId,
  SettingsPatch,
  FileSaveRequest,
  FileSaveResult
} from '@shared/types'
import { PtyManager } from '../pty/manager'
import { SettingsStore } from '../settings/store'
import { Streamer } from '../ai/streamer'
import { TelegramBridge } from '../telegram/bridge'
import { getAdapter, ProviderError } from '../providers'
import type { ProviderCreds } from '../providers/types'

export interface IpcContext {
  getWindow: () => BrowserWindow | null
  pty: PtyManager
  settings: SettingsStore
  streamer: Streamer
  telegram: TelegramBridge
}

export function registerIpc(getWindow: () => BrowserWindow | null): IpcContext {
  const emit = (channel: string, payload: unknown): void => {
    getWindow()?.webContents.send(channel, payload)
  }

  const settings = new SettingsStore()

  const telegram = new TelegramBridge(
    settings,
    (inbound) => emit(IPC.telegramInbound, inbound),
    () => {
      // surface running state by pushing a fresh public settings snapshot
      emit(IPC.settingsChanged, settings.getPublic(telegram.isRunning(), telegram.getStatus().botUsername))
      emit(IPC.telegramStatusChanged, telegram.getStatus())
    }
  )

  // PTY data goes to the renderer only. Telegram forwarding for terminal panes
  // is driven from the renderer (useTelegramForwarding), which extracts the
  // submitted prompt and the agent's answer blocks from the rendered screen
  // instead of streaming raw escape-code redraws.
  const pty = new PtyManager((channel, payload) => {
    emit(channel, payload)
  })

  const streamer = new Streamer(
    settings,
    (chunk) => emit(IPC.chatChunk, chunk),
    (paneId, text) => telegram.forward(paneId, text)
  )

  const credsFor = (provider: ProviderId): ProviderCreds =>
    provider === 'ollama'
      ? { baseUrl: settings.getOllamaBaseUrl() }
      : { apiKey: settings.getApiKey(provider) }

  const publicSettings = (): ReturnType<SettingsStore['getPublic']> =>
    settings.getPublic(telegram.isRunning(), telegram.getStatus().botUsername)

  // ---- settings ----
  ipcMain.handle(IPC.settingsGet, () => publicSettings())
  ipcMain.handle(IPC.settingsPatch, async (_e, patch: SettingsPatch) => {
    const tokenChanged = patch.telegramToken !== undefined
    settings.patch(patch)
    if (tokenChanged) await telegram.start()
    const next = publicSettings()
    emit(IPC.settingsChanged, next)
    return next
  })
  ipcMain.handle(IPC.providerListModels, async (_e, provider: ProviderId) => {
    try {
      return await getAdapter(provider).listModels(credsFor(provider))
    } catch {
      return []
    }
  })
  ipcMain.handle(IPC.providerTestKey, async (_e, provider: ProviderId) => {
    try {
      await getAdapter(provider).listModels(credsFor(provider))
      return { ok: true }
    } catch (err) {
      const message = err instanceof ProviderError ? err.message : (err as Error).message
      return { ok: false, error: message }
    }
  })

  // ---- ai chat ----
  ipcMain.handle(IPC.chatStart, (_e, req: ChatStreamRequest) => {
    void streamer.start(req)
  })
  ipcMain.handle(IPC.chatCancel, (_e, streamId: string) => streamer.cancel(streamId))

  // ---- telegram ----
  ipcMain.handle(IPC.telegramStatus, () => telegram.getStatus())
  ipcMain.handle(IPC.telegramRestart, () => telegram.start())
  ipcMain.handle(
    IPC.telegramLinkPane,
    (_e, { paneId, chatId }: { paneId: string; chatId: string | null }) =>
      telegram.linkPane(paneId, chatId)
  )
  ipcMain.on(IPC.telegramForward, (_e, { paneId, text }: { paneId: string; text: string }) =>
    telegram.forward(paneId, text)
  )
  ipcMain.on(
    IPC.telegramStartTurn,
    (_e, { paneId, prompt }: { paneId: string; prompt: string | null }) =>
      void telegram.startTurn(paneId, prompt)
  )
  ipcMain.on(IPC.telegramFinishTurn, (_e, { paneId, result }: { paneId: string; result: string }) =>
    void telegram.finishTurn(paneId, result)
  )

  // ---- perf ----
  // CPU% is derived from the delta of process.cpuUsage between samples so the
  // title-bar/status-bar pill shows a live, meaningful number.
  let lastCpu = process.cpuUsage()
  let lastCpuAt = Date.now()
  ipcMain.handle(IPC.perfSample, () => {
    const mem = process.memoryUsage()
    const now = Date.now()
    const cpu = process.cpuUsage(lastCpu) // micros since last call
    const elapsedMs = Math.max(1, now - lastCpuAt)
    const cpuPercent = Math.min(
      100,
      Math.round((((cpu.user + cpu.system) / 1000 / elapsedMs) * 100) * 10) / 10
    )
    lastCpu = process.cpuUsage()
    lastCpuAt = now
    return {
      mainRssMB: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsedMB: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10,
      cpuPercent,
      timestamp: now
    }
  })

  // ---- window controls (frameless window) ----
  ipcMain.on(IPC.windowMinimize, () => getWindow()?.minimize())
  ipcMain.on(IPC.windowMaximizeToggle, () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  ipcMain.on(IPC.windowClose, () => getWindow()?.close())
  ipcMain.handle(IPC.windowIsMaximized, () => getWindow()?.isMaximized() ?? false)

  // ---- directory picker (choose folder to open an agent in) ----
  ipcMain.handle(IPC.dialogOpenDir, async (_e, defaultPath?: string): Promise<string | null> => {
    const win = getWindow()
    const res = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Choose a folder to open the agent in',
      defaultPath: defaultPath || undefined,
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths.length) return null
    return res.filePaths[0]
  })

  // ---- file save (transcript export, etc.) ----
  ipcMain.handle(IPC.fileSave, async (_e, req: FileSaveRequest): Promise<FileSaveResult> => {
    const win = getWindow()
    try {
      const res = await dialog.showSaveDialog(win ?? undefined!, {
        defaultPath: req.defaultName,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Text', extensions: ['txt'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      })
      if (res.canceled || !res.filePath) return { ok: false, canceled: true }
      await writeFile(res.filePath, req.contents, 'utf8')
      return { ok: true, path: res.filePath }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  // ---- pty ----
  ipcMain.handle(IPC.ptySpawn, (_e, req: PtySpawnRequest) => pty.spawn(req))
  ipcMain.on(IPC.ptyWrite, (_e, { ptyId, data }: { ptyId: string; data: string }) =>
    pty.write(ptyId, data)
  )
  ipcMain.on(
    IPC.ptyResize,
    (_e, { ptyId, cols, rows }: { ptyId: string; cols: number; rows: number }) =>
      pty.resize(ptyId, cols, rows)
  )
  ipcMain.on(IPC.ptyKill, (_e, { ptyId }: { ptyId: string }) => pty.kill(ptyId))

  // start the bot if a token is already configured
  void telegram.start()

  return { getWindow, pty, settings, streamer, telegram }
}
