import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type {
  SettingsPublic,
  SettingsPatch,
  ProviderId,
  ChatStreamRequest,
  StreamChunk,
  PtySpawnRequest,
  PtyDataEvent,
  PtyExitEvent,
  TelegramStatus,
  TelegramInbound,
  PerfSample,
  FileSaveRequest,
  FileSaveResult
} from '@shared/types'

/** Subscribe helper that returns an unsubscribe fn and strips the IpcRenderer event arg. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // ---- settings ----
  getSettings: (): Promise<SettingsPublic> => ipcRenderer.invoke(IPC.settingsGet),
  patchSettings: (patch: SettingsPatch): Promise<SettingsPublic> =>
    ipcRenderer.invoke(IPC.settingsPatch, patch),
  onSettingsChanged: (cb: (s: SettingsPublic) => void): (() => void) =>
    on<SettingsPublic>(IPC.settingsChanged, cb),
  testProviderKey: (provider: ProviderId): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.providerTestKey, provider),
  listModels: (provider: ProviderId): Promise<string[]> =>
    ipcRenderer.invoke(IPC.providerListModels, provider),

  // ---- ai streaming ----
  startChat: (req: ChatStreamRequest): Promise<void> => ipcRenderer.invoke(IPC.chatStart, req),
  cancelChat: (streamId: string): Promise<void> => ipcRenderer.invoke(IPC.chatCancel, streamId),
  onChatChunk: (cb: (chunk: StreamChunk) => void): (() => void) =>
    on<StreamChunk>(IPC.chatChunk, cb),

  // ---- pty ----
  spawnPty: (req: PtySpawnRequest): Promise<{ ptyId: string; shell: string }> =>
    ipcRenderer.invoke(IPC.ptySpawn, req),
  writePty: (ptyId: string, data: string): void => ipcRenderer.send(IPC.ptyWrite, { ptyId, data }),
  resizePty: (ptyId: string, cols: number, rows: number): void =>
    ipcRenderer.send(IPC.ptyResize, { ptyId, cols, rows }),
  killPty: (ptyId: string): void => ipcRenderer.send(IPC.ptyKill, { ptyId }),
  onPtyData: (cb: (e: PtyDataEvent) => void): (() => void) => on<PtyDataEvent>(IPC.ptyData, cb),
  onPtyExit: (cb: (e: PtyExitEvent) => void): (() => void) => on<PtyExitEvent>(IPC.ptyExit, cb),

  // ---- telegram ----
  getTelegramStatus: (): Promise<TelegramStatus> => ipcRenderer.invoke(IPC.telegramStatus),
  restartTelegram: (): Promise<TelegramStatus> => ipcRenderer.invoke(IPC.telegramRestart),
  linkPaneToTelegram: (paneId: string, chatId: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC.telegramLinkPane, { paneId, chatId }),
  forwardToTelegram: (paneId: string, text: string): void =>
    ipcRenderer.send(IPC.telegramForward, { paneId, text }),
  telegramStartTurn: (paneId: string, prompt: string | null): void =>
    ipcRenderer.send(IPC.telegramStartTurn, { paneId, prompt }),
  telegramFinishTurn: (paneId: string, result: string): void =>
    ipcRenderer.send(IPC.telegramFinishTurn, { paneId, result }),
  onTelegramInbound: (cb: (e: TelegramInbound) => void): (() => void) =>
    on<TelegramInbound>(IPC.telegramInbound, cb),
  onTelegramStatusChanged: (cb: (s: TelegramStatus) => void): (() => void) =>
    on<TelegramStatus>(IPC.telegramStatusChanged, cb),

  // ---- perf ----
  getPerfSample: (): Promise<PerfSample> => ipcRenderer.invoke(IPC.perfSample),

  // ---- window controls (frameless) ----
  windowMinimize: (): void => ipcRenderer.send(IPC.windowMinimize),
  windowMaximizeToggle: (): void => ipcRenderer.send(IPC.windowMaximizeToggle),
  windowClose: (): void => ipcRenderer.send(IPC.windowClose),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
  onWindowMaximizedChanged: (cb: (maximized: boolean) => void): (() => void) =>
    on<boolean>(IPC.windowMaximizedChanged, cb),

  // ---- file save ----
  saveFile: (req: FileSaveRequest): Promise<FileSaveResult> =>
    ipcRenderer.invoke(IPC.fileSave, req),

  // ---- directory picker ----
  pickDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.dialogOpenDir, defaultPath)
}

export type UregantApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  ;(globalThis as unknown as { api: UregantApi }).api = api
}
