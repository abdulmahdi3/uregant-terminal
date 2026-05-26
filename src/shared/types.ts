// Shared types used across main, preload, and renderer.
// Keep this free of any node/electron/dom imports so all processes can use it.

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama'

export type PaneType = 'ai' | 'shell' | 'empty'

export interface ShellPaneState {
  shell: string
  /** extra args for the shell binary (e.g. ["-d", "Ubuntu"] for a WSL distro) */
  args?: string[]
  cwd?: string
  ptyId?: string
}

/** An "AI pane" is a terminal that auto-launches an agent CLI (claude, codex, …). */
export interface AgentPaneState {
  /** command typed into the shell on launch, e.g. "claude" */
  command: string
  cwd?: string
  ptyId?: string
  shell?: string
}

export interface Pane {
  id: string
  type: PaneType
  title: string
  agent?: AgentPaneState
  shell?: ShellPaneState
  /** chat id this pane forwards output to, if linked */
  telegramChatId?: string
  /** pane IDs this pane pipes its output into (supports fan-out to multiple) */
  pipeTargets?: string[]
}

// ---------------------------------------------------------------------------
// Settings (renderer-safe view — secrets are never sent here in full)
// ---------------------------------------------------------------------------

export interface ProviderSettingsPublic {
  anthropic: { keySet: boolean; keyPreview?: string }
  openai: { keySet: boolean; keyPreview?: string }
  gemini: { keySet: boolean; keyPreview?: string }
  ollama: { baseUrl: string }
}

export interface TelegramSettingsPublic {
  tokenSet: boolean
  tokenPreview?: string
  defaultChatId?: string
  running: boolean
}

export type ThemeName = 'dark' | 'light'

/** A reusable saved prompt or shell command (may contain {{variables}}). */
export interface SnippetItem {
  id: string
  name: string
  body: string
  kind: 'prompt' | 'shell'
}

/** A saved pane configuration that can be spawned in one click. */
export interface PaneTemplate {
  id: string
  name: string
  type: 'ai' | 'shell'
  agentCommand?: string
  shell?: string
  shellArgs?: string[]
  cwd?: string
  /** command auto-typed once the shell is ready (shell templates) */
  startupCommand?: string
}

/** Free-form user preferences persisted as one JSON blob via electron-store. */
export interface AppPrefs {
  /** desktop notification when an agent finishes a turn */
  notifyOnDone: boolean
  /** play a short sound when an agent finishes a turn */
  notifySound: boolean
  /** also send a Telegram "finished" message on turn completion */
  telegramNotifyOnDone: boolean
  /** Telegram chat IDs allowed to control the app (empty = allow any) */
  telegramChatWhitelist: string[]
  /** terminal font family ('' = built-in default) */
  fontFamily: string
  /** terminal font size in px */
  fontSize: number
  /** reopen the last workspace (panes + layout) on launch */
  autoRestore: boolean
  /** saved reusable prompts / commands */
  snippets: SnippetItem[]
  /** saved pane configurations */
  templates: PaneTemplate[]
}

export const DEFAULT_PREFS: AppPrefs = {
  notifyOnDone: false,
  notifySound: false,
  telegramNotifyOnDone: false,
  telegramChatWhitelist: [],
  fontFamily: '',
  fontSize: 13,
  autoRestore: true,
  snippets: [],
  templates: []
}

export interface SettingsPublic {
  providers: ProviderSettingsPublic
  telegram: TelegramSettingsPublic
  defaultProvider: ProviderId
  defaultModel: string
  /** agent CLI new AI panes launch by default (e.g. "claude") */
  defaultAgent: string
  /** shell binary new shell panes launch by default ("" = OS default) */
  defaultShell: string
  /** args for the default shell (e.g. ["-d", "Ubuntu"]) */
  defaultShellArgs: string[]
  theme: ThemeName
  language: string
  accentColor: string
  prefs: AppPrefs
}

// Patch shapes the renderer may send to mutate settings.
export interface SettingsPatch {
  providerKey?: { provider: ProviderId; key: string | null }
  ollamaBaseUrl?: string
  telegramToken?: string | null
  telegramDefaultChatId?: string | null
  defaultProvider?: ProviderId
  defaultModel?: string
  defaultAgent?: string
  defaultShell?: string
  defaultShellArgs?: string[]
  theme?: ThemeName
  language?: string
  accentColor?: string
  /** shallow-merged into the stored prefs blob */
  prefs?: Partial<AppPrefs>
}

// ---------------------------------------------------------------------------
// PTY (shell) streaming
// ---------------------------------------------------------------------------

export interface PtySpawnRequest {
  paneId: string
  shell?: string
  /** extra args for the shell binary (e.g. ["-d", "Ubuntu"] for a WSL distro) */
  shellArgs?: string[]
  cwd?: string
  cols: number
  rows: number
  /** optional command typed into the shell once it is ready (e.g. "claude") */
  startupCommand?: string
  /** spawn this program directly as the pty process (e.g. "claude"), instead of a shell */
  command?: string
}

export interface PtyDataEvent {
  ptyId: string
  paneId: string
  data: string
}

export interface PtyExitEvent {
  ptyId: string
  paneId: string
  exitCode: number
}

/** A live PTY process, surfaced to the renderer's task manager. */
export interface PtyTaskInfo {
  ptyId: string
  paneId: string
  pid: number
  /** the shell or program that was launched (e.g. "powershell.exe", "claude") */
  shell: string
  /** epoch ms when the process was spawned */
  startedAt: number
}

/** A single OS process row for the system tab of the task manager. */
export interface SystemProcess {
  pid: number
  name: string
  /** working-set memory in MB */
  memMB: number
  /** CPU usage 0–100, derived from the delta of cumulative CPU time between samples */
  cpuPercent: number
}

/** Clipboard contents resolved in the main process (image wins over text). */
export interface ClipboardContent {
  text?: string
  /** absolute path to a temp PNG written from a clipboard image, if any */
  imagePath?: string
}

// ---------------------------------------------------------------------------
// Pane registry (sent from renderer → main so Telegram commands can inspect)
// ---------------------------------------------------------------------------

export interface PaneInfo {
  /** 1-based display number in layout leaf order */
  number: number
  id: string
  type: PaneType
  title: string
  agentCommand?: string
  shellName?: string
  linkedChatId?: string
}

// ---------------------------------------------------------------------------
// Telegram bridge
// ---------------------------------------------------------------------------

export interface TelegramInbound {
  /** target pane the message should be injected into as a prompt */
  paneId: string
  text: string
  chatId: string
}

export interface TelegramStatus {
  running: boolean
  error?: string
  botUsername?: string
}

/** Request from Telegram (/run) to open a new pane remotely. */
export interface TelegramCreatePane {
  type: 'ai' | 'shell'
  /** agent CLI for ai panes (e.g. "claude") */
  agentCommand?: string
  /** shell binary for shell panes (e.g. "powershell.exe") */
  shell?: string
  /** working directory to launch in */
  cwd?: string
  /** chat that requested it — the new pane is auto-linked back to it */
  chatId: string
}

// ---------------------------------------------------------------------------
// Perf
// ---------------------------------------------------------------------------

export interface PerfSample {
  mainRssMB: number
  heapUsedMB: number
  /** Main-process CPU usage since the previous sample, 0–100 (per core-second). */
  cpuPercent: number
  timestamp: number
}

// ---------------------------------------------------------------------------
// Window controls + file save (frameless window)
// ---------------------------------------------------------------------------

export interface FileSaveRequest {
  /** Suggested file name shown in the save dialog. */
  defaultName: string
  /** UTF-8 contents to write. */
  contents: string
}

export interface FileSaveResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
}

// ---------------------------------------------------------------------------
// IPC channel names — single source of truth.
// ---------------------------------------------------------------------------

export const IPC = {
  // settings
  settingsGet: 'settings:get',
  settingsPatch: 'settings:patch',
  settingsChanged: 'settings:changed',

  // pty
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyList: 'pty:list',
  ptyData: 'pty:data', // main -> renderer (event)
  ptyExit: 'pty:exit', // main -> renderer (event)

  // shells (list installed WSL distros for the shell launcher)
  shellListWsl: 'shell:list-wsl',
  // which: report which of the given commands are installed on PATH
  commandsCheck: 'shell:check-commands',

  // clipboard (right-click paste of text + images)
  clipboardRead: 'clipboard:read',

  // system process monitor (task manager "System" tab)
  systemProcList: 'system:proc-list',
  systemProcKill: 'system:proc-kill',

  // saved sessions (named workspace snapshots persisted to disk)
  sessionsRead: 'sessions:read',
  sessionsWrite: 'sessions:write',

  // telegram
  telegramStatus: 'telegram:status',
  telegramRestart: 'telegram:restart',
  telegramLinkPane: 'telegram:link-pane',
  telegramForward: 'telegram:forward',
  telegramStartTurn: 'telegram:start-turn', // show prompt + "working" placeholder
  telegramFinishTurn: 'telegram:finish-turn', // delete placeholder + send result
  telegramNotifyDone: 'telegram:notify-done', // ping linked chat that a turn finished
  telegramInbound: 'telegram:inbound', // main -> renderer (event)
  telegramCreatePane: 'telegram:create-pane', // main -> renderer (event): /run
  telegramStatusChanged: 'telegram:status-changed', // main -> renderer (event)

  // perf
  perfSample: 'perf:sample',

  // window controls (frameless)
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximize-toggle',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximizedChanged: 'window:maximized-changed', // main -> renderer (event)

  // file save dialog
  fileSave: 'file:save',

  // directory picker (choose the folder to open an agent in)
  dialogOpenDir: 'dialog:open-dir',

  // pane registry (renderer pushes snapshot to main on every workspace change)
  panesUpdate: 'panes:update',

  // screenshot → Telegram
  screenshotPane: 'screenshot:pane',
  screenshotWindow: 'screenshot:window'
} as const
