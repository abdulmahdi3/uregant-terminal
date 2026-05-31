import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/types'
import type { AgentDiscovery } from '@shared/providers'
import type {
  SettingsPublic,
  SettingsPatch,
  PtySpawnRequest,
  SshSpawnRequest,
  PtyDataEvent,
  PtyExitEvent,
  PtyTaskInfo,
  SystemProcess,
  ClipboardContent,
  TelegramStatus,
  TelegramInbound,
  TelegramCreatePane,
  PerfSample,
  ClaudeUsage,
  FileSaveRequest,
  FileSaveResult,
  PaneInfo,
  SessionData,
  LastSessionPayload,
  NoteDoc,
  TickTickProject,
  TickTickProjectData,
  TickTickTask,
  UpdaterStatus
} from '@shared/types'

/** Subscribe helper that returns an unsubscribe fn and strips the IpcRenderer event arg. */
function on<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: unknown, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // ---- app info ----
  getAppInfo: (): Promise<{ version: string }> => ipcRenderer.invoke(IPC.appInfo),

  // ---- settings ----
  getSettings: (): Promise<SettingsPublic> => ipcRenderer.invoke(IPC.settingsGet),
  patchSettings: (patch: SettingsPatch): Promise<SettingsPublic> =>
    ipcRenderer.invoke(IPC.settingsPatch, patch),
  onSettingsChanged: (cb: (s: SettingsPublic) => void): (() => void) =>
    on<SettingsPublic>(IPC.settingsChanged, cb),

  // ---- pty ----
  spawnPty: (req: PtySpawnRequest): Promise<{ ptyId: string; shell: string }> =>
    ipcRenderer.invoke(IPC.ptySpawn, req),
  spawnSsh: (req: SshSpawnRequest): Promise<{ ptyId: string; shell: string }> =>
    ipcRenderer.invoke(IPC.sshSpawn, req),
  writePty: (ptyId: string, data: string): void => ipcRenderer.send(IPC.ptyWrite, { ptyId, data }),
  resizePty: (ptyId: string, cols: number, rows: number): void =>
    ipcRenderer.send(IPC.ptyResize, { ptyId, cols, rows }),
  killPty: (ptyId: string): void => ipcRenderer.send(IPC.ptyKill, { ptyId }),
  listPtys: (): Promise<PtyTaskInfo[]> => ipcRenderer.invoke(IPC.ptyList),
  onPtyData: (cb: (e: PtyDataEvent) => void): (() => void) => on<PtyDataEvent>(IPC.ptyData, cb),
  onPtyExit: (cb: (e: PtyExitEvent) => void): (() => void) => on<PtyExitEvent>(IPC.ptyExit, cb),

  // ---- shells ----
  listWslDistros: (): Promise<{ name: string; default: boolean }[]> =>
    ipcRenderer.invoke(IPC.shellListWsl),
  checkCommands: (names: string[]): Promise<string[]> =>
    ipcRenderer.invoke(IPC.commandsCheck, names),
  discoverAgents: (): Promise<AgentDiscovery> => ipcRenderer.invoke(IPC.agentsDiscover),

  // ---- learning layer (local recorder; opt-in) ----
  learning: {
    /** Report a submitted user prompt as an authoritative turn boundary. */
    turnMarker: (paneId: string, text: string, ts: number): void =>
      ipcRenderer.send(IPC.learningTurnMarker, { paneId, text, ts }),
    getConfig: (): Promise<Record<string, unknown>> => ipcRenderer.invoke(IPC.learningGetConfig),
    setConfig: (patch: Record<string, unknown>): Promise<Record<string, unknown>> =>
      ipcRenderer.invoke(IPC.learningSetConfig, patch),
    openStore: (): Promise<void> => ipcRenderer.invoke(IPC.learningOpenStore),
    listCandidates: (): Promise<unknown[]> => ipcRenderer.invoke(IPC.learningListCandidates),
    onCandidates: (cb: (c: unknown[]) => void): (() => void) =>
      on<unknown[]>(IPC.learningCandidates, cb),
    /** Run a distillation pass (model call); requires learning + egress enabled. */
    distill: (projectHash?: string): Promise<{ ok: boolean; applied?: number; queued?: number; ops?: number; error?: string }> =>
      ipcRenderer.invoke(IPC.learningDistill, projectHash),
    listMemory: (projectHash?: string | null): Promise<unknown> =>
      ipcRenderer.invoke(IPC.learningListMemory, projectHash),
    listPendingOps: (): Promise<unknown[]> => ipcRenderer.invoke(IPC.learningListPendingOps),
    approveOp: (id: string): Promise<boolean> => ipcRenderer.invoke(IPC.learningApproveOp, id),
    rejectOp: (id: string): Promise<void> => ipcRenderer.invoke(IPC.learningRejectOp, id),
    forgetProject: (projectHash: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.learningForgetProject, projectHash),
    inject: (cwd: string, agentId: string): Promise<{ status: string; file?: string }> =>
      ipcRenderer.invoke(IPC.learningInject, { cwd, agentId })
  },

  // ---- clipboard (right-click paste) ----
  readClipboard: (): Promise<ClipboardContent> => ipcRenderer.invoke(IPC.clipboardRead),

  // ---- system process monitor ----
  listSystemProcesses: (): Promise<SystemProcess[]> => ipcRenderer.invoke(IPC.systemProcList),
  killSystemProcess: (pid: number): void => ipcRenderer.send(IPC.systemProcKill, { pid }),

  // ---- saved sessions (stored on disk) ----
  readSessions: (): Promise<unknown[]> => ipcRenderer.invoke(IPC.sessionsRead),
  writeSessions: (sessions: unknown[]): Promise<void> =>
    ipcRenderer.invoke(IPC.sessionsWrite, sessions),
  // per-session chat content (terminal transcripts)
  readSessionData: (id: string): Promise<SessionData | null> =>
    ipcRenderer.invoke(IPC.sessionDataRead, id),
  writeSessionData: (id: string, data: SessionData): Promise<void> =>
    ipcRenderer.invoke(IPC.sessionDataWrite, id, data),
  deleteSessionData: (id: string): Promise<void> =>
    ipcRenderer.invoke(IPC.sessionDataDelete, id),
  // auto-saved last session (full snapshot for close/crash restore)
  readLastSession: (): Promise<LastSessionPayload | null> =>
    ipcRenderer.invoke(IPC.lastSessionRead),
  writeLastSession: (payload: LastSessionPayload): Promise<void> =>
    ipcRenderer.invoke(IPC.lastSessionWrite, payload),
  /** synchronous final write at window close (async IPC can't finish in beforeunload) */
  flushLastSession: (payload: LastSessionPayload): void => {
    ipcRenderer.sendSync(IPC.lastSessionFlush, payload)
  },

  // ---- standalone notes (app-wide, persisted to userData/notes.json) ----
  readNotes: (): Promise<NoteDoc[]> => ipcRenderer.invoke(IPC.notesRead),
  writeNotes: (notes: NoteDoc[]): Promise<void> => ipcRenderer.invoke(IPC.notesWrite, notes),

  // ---- TickTick to-do integration (OAuth + Open API proxy) ----
  tickTickConnect: (): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.tickTickConnect),
  tickTickDisconnect: (): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.tickTickDisconnect),
  tickTickListProjects: (): Promise<TickTickProject[]> =>
    ipcRenderer.invoke(IPC.tickTickListProjects),
  tickTickCreateProject: (input: {
    name: string
    color?: string
    viewMode?: string
    kind?: string
  }): Promise<TickTickProject> => ipcRenderer.invoke(IPC.tickTickCreateProject, input),
  tickTickDeleteProject: (projectId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.tickTickDeleteProject, projectId),
  tickTickProjectData: (projectId: string): Promise<TickTickProjectData> =>
    ipcRenderer.invoke(IPC.tickTickProjectData, projectId),
  tickTickCreateTask: (input: {
    projectId: string
    title: string
    content?: string
    desc?: string
    dueDate?: string
    startDate?: string
    isAllDay?: boolean
    priority?: number
    tags?: string[]
    items?: Array<{ title: string; status?: number; sortOrder?: number }>
  }): Promise<TickTickTask> => ipcRenderer.invoke(IPC.tickTickCreateTask, input),
  tickTickUpdateTask: (
    input: Partial<TickTickTask> & { id: string; projectId: string }
  ): Promise<TickTickTask> => ipcRenderer.invoke(IPC.tickTickUpdateTask, input),
  tickTickCompleteTask: (projectId: string, taskId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.tickTickCompleteTask, { projectId, taskId }),
  tickTickDeleteTask: (projectId: string, taskId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.tickTickDeleteTask, { projectId, taskId }),

  // ---- self-update (electron-updater backed by GitHub releases) ----
  onUpdateAvailable: (cb: (s: UpdaterStatus) => void): (() => void) =>
    on<UpdaterStatus>(IPC.updaterAvailable, cb),
  onUpdateDownloaded: (cb: (s: UpdaterStatus) => void): (() => void) =>
    on<UpdaterStatus>(IPC.updaterDownloaded, cb),
  onUpdateError: (cb: (msg: string) => void): (() => void) =>
    on<string>(IPC.updaterError, cb),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.updaterInstall),

  // ---- telegram ----
  getTelegramStatus: (): Promise<TelegramStatus> => ipcRenderer.invoke(IPC.telegramStatus),
  restartTelegram: (): Promise<TelegramStatus> => ipcRenderer.invoke(IPC.telegramRestart),
  testTelegram: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.telegramTest),
  linkPaneToTelegram: (paneId: string, chatId: string | null): Promise<void> =>
    ipcRenderer.invoke(IPC.telegramLinkPane, { paneId, chatId }),
  forwardToTelegram: (paneId: string, text: string): void =>
    ipcRenderer.send(IPC.telegramForward, { paneId, text }),
  telegramStartTurn: (paneId: string, prompt: string | null): void =>
    ipcRenderer.send(IPC.telegramStartTurn, { paneId, prompt }),
  telegramFinishTurn: (paneId: string, result: string): void =>
    ipcRenderer.send(IPC.telegramFinishTurn, { paneId, result }),
  telegramNotifyDone: (paneId: string, label: string): void =>
    ipcRenderer.send(IPC.telegramNotifyDone, { paneId, label }),
  onTelegramInbound: (cb: (e: TelegramInbound) => void): (() => void) =>
    on<TelegramInbound>(IPC.telegramInbound, cb),
  onTelegramCreatePane: (cb: (e: TelegramCreatePane) => void): (() => void) =>
    on<TelegramCreatePane>(IPC.telegramCreatePane, cb),
  onTelegramStatusChanged: (cb: (s: TelegramStatus) => void): (() => void) =>
    on<TelegramStatus>(IPC.telegramStatusChanged, cb),

  // ---- perf ----
  getPerfSample: (): Promise<PerfSample> => ipcRenderer.invoke(IPC.perfSample),

  // ---- claude usage ----
  getClaudeUsage: (): Promise<ClaudeUsage> => ipcRenderer.invoke(IPC.claudeUsage),

  // ---- window controls (frameless) ----
  windowMinimize: (): void => ipcRenderer.send(IPC.windowMinimize),
  windowMaximizeToggle: (): void => ipcRenderer.send(IPC.windowMaximizeToggle),
  windowClose: (): void => ipcRenderer.send(IPC.windowClose),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC.windowIsMaximized),
  onWindowMaximizedChanged: (cb: (maximized: boolean) => void): (() => void) =>
    on<boolean>(IPC.windowMaximizedChanged, cb),
  setWindowOverlay: (color: string, symbolColor: string): void =>
    ipcRenderer.send(IPC.windowSetOverlay, { color, symbolColor }),
  /** Open a new, independent URterminal window on the current desktop. */
  openNewWindow: (): void => ipcRenderer.send(IPC.windowOpenNew),

  // ---- file save ----
  saveFile: (req: FileSaveRequest): Promise<FileSaveResult> =>
    ipcRenderer.invoke(IPC.fileSave, req),

  // ---- directory picker ----
  pickDirectory: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.dialogOpenDir, defaultPath),

  // ---- open a folder in the OS file manager ----
  openPath: (path: string): Promise<void> => ipcRenderer.invoke(IPC.shellOpenPath, path),

  // ---- pane registry (keeps main process in sync for Telegram /panes) ----
  updatePaneRegistry: (panes: PaneInfo[]): Promise<void> =>
    ipcRenderer.invoke(IPC.panesUpdate, panes),

  // ---- screenshots → Telegram ----
  screenshotPane: (paneId: string): Promise<void> =>
    ipcRenderer.invoke(IPC.screenshotPane, paneId),
  screenshotWindow: (): Promise<void> =>
    ipcRenderer.invoke(IPC.screenshotWindow)
}

export type UrterminalApi = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('api', api)
} else {
  ;(globalThis as unknown as { api: UrterminalApi }).api = api
}
