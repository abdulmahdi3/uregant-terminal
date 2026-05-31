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
  /** command auto-typed once the shell is ready (used by pane templates) */
  startupCommand?: string
  /** when set, this pane is an SSH session (target = "user@host[:port]") */
  ssh?: { target: string }
}

/** An "AI pane" is a terminal that auto-launches an agent CLI (claude, codex, …). */
export interface AgentPaneState {
  /** command typed into the shell on launch, e.g. "claude" */
  command: string
  cwd?: string
  ptyId?: string
  shell?: string
}

/** A single checkable item in a pane's to-do list. */
export interface TodoItem {
  id: string
  text: string
  done: boolean
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
  /** free-form note attached to the pane (shown via the header note button) */
  notes?: string
  /** checkable to-do list attached to the pane (shown in the note popover) */
  todos?: TodoItem[]
}

/** Chat content for a saved session: per-pane terminal transcript (replayable ANSI). */
export interface SessionData {
  /** paneId -> serialized terminal buffer (ANSI snapshot produced by addon-serialize) */
  transcripts: Record<string, string>
}

/** Full auto-saved snapshot of the live workspace, written on change + on close. */
export interface LastSessionPayload {
  panes: Record<string, Pane>
  /** mosaic layout tree (pane-id leaves); kept loose to avoid importing react-mosaic here */
  layout: unknown
  transcripts: Record<string, string>
  /** epoch ms this snapshot was written (used to archive it into the session list) */
  savedAt?: number
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
  /** bot @username once connected (getMe succeeded) */
  botUsername?: string
  /** last connection/polling error, surfaced in the UI when the bot isn't running */
  error?: string
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

export type CursorStyle = 'block' | 'bar' | 'underline'
export type NotifySound = 'chime' | 'beep'

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
  /** recent SSH targets (most recent first, e.g. "user@host"), shown by the SSH button */
  sshHosts: string[]

  // ---- appearance / terminal ----
  /** app color theme (matches APP_THEMES: dark, amoled, ocean, forest, dusk, light, system) */
  appTheme: string
  /** terminal caret shape */
  cursorStyle: CursorStyle
  /** terminal caret blink */
  cursorBlink: boolean
  /** terminal line height multiplier (1.0 = default) */
  lineHeight: number
  /** terminal letter spacing in px */
  letterSpacing: number
  /** terminal scrollback buffer size (lines) */
  scrollback: number
  /** inner padding around terminal contents (px) */
  terminalPadding: number
  /** show the per-pane title/header bar */
  showPaneHeaders: boolean
  /** terminal scroll speed multiplier */
  scrollSensitivity: number
  /** play a short sound when the terminal emits a bell (\\a) */
  terminalBell: boolean

  // ---- behavior / workflow ----
  /** warn before closing a pane whose process is still running */
  confirmClose: boolean
  /** working directory new shell panes open in ('' = home) */
  defaultShellCwd: string
  /** debounce (seconds) before the live workspace is auto-saved to disk */
  autoSaveSeconds: number
  /** cap on how many panes are restored on launch (0 = unlimited) */
  maxRestorePanes: number
  /** focus a newly created pane automatically */
  focusNewPane: boolean
  /** copy the terminal selection to the clipboard automatically */
  copyOnSelect: boolean
  /** paste on right-click in a terminal */
  pasteOnRightClick: boolean
  /** clear the saved workspace on exit (next launch starts empty) */
  clearWorkspaceOnExit: boolean

  // ---- notifications ----
  /** only fire desktop/sound notifications when the window is NOT focused */
  notifyOnlyUnfocused: boolean
  /** notification chime volume (0–100) */
  notifyVolume: number
  /** which built-in notification sound to play */
  notifySoundName: NotifySound
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
  templates: [],
  sshHosts: [],

  appTheme: 'dark',
  cursorStyle: 'block',
  cursorBlink: true,
  lineHeight: 1.0,
  letterSpacing: 0,
  scrollback: 5000,
  terminalPadding: 8,
  showPaneHeaders: true,
  scrollSensitivity: 1,
  terminalBell: false,

  confirmClose: false,
  defaultShellCwd: '',
  autoSaveSeconds: 1,
  maxRestorePanes: 0,
  focusNewPane: true,
  copyOnSelect: true,
  pasteOnRightClick: true,
  clearWorkspaceOnExit: false,

  notifyOnlyUnfocused: false,
  notifyVolume: 60,
  notifySoundName: 'chime'
}

/** External to-do services the user can connect for syncing tasks. */
export type IntegrationId = 'todoist' | 'ticktick' | 'microsoftTodo' | 'googleTasks' | 'notion'

/** Public view of a connected integration — never exposes raw token, just status. */
/** Update-related payload pushed from the main-process auto-updater. */
export interface UpdaterStatus {
  version: string
  releaseNotes?: string
  releaseDate?: string
}

export interface IntegrationStatus {
  /** true if a credential/token is stored for this service */
  connected: boolean
  /** epoch ms the user connected (or last refreshed the token) */
  connectedAt?: number
}
/** TickTick has extra setup fields (client_id/client_secret) it needs from the user. */
export interface TickTickStatus extends IntegrationStatus {
  /** the user's app client_id, shown plain (it's not secret on its own) */
  clientId?: string
  /** whether a client_secret has been saved (not the value itself) */
  clientSecretSet: boolean
}
export interface IntegrationsPublic {
  todoist: IntegrationStatus
  ticktick: TickTickStatus
  microsoftTodo: IntegrationStatus
  googleTasks: IntegrationStatus
  notion: IntegrationStatus
}

// ---------------------------------------------------------------------------
// TickTick open API surface (subset we actually use)
// ---------------------------------------------------------------------------

export interface TickTickProject {
  id: string
  name: string
  color?: string
  closed?: boolean
  viewMode?: string
  kind?: 'TASK' | 'NOTE' | string
}

export interface TickTickChecklistItem {
  id: string
  title: string
  status: number // 0 = normal, 1 = completed
  startDate?: string
  isAllDay?: boolean
  timeZone?: string
  sortOrder?: number
  completedTime?: string
}

export interface TickTickTask {
  id: string
  projectId: string
  title: string
  content?: string
  desc?: string
  isAllDay?: boolean
  startDate?: string
  dueDate?: string
  timeZone?: string
  reminders?: string[]
  tags?: string[]
  repeatFlag?: string
  priority?: number // 0 None, 1 Low, 3 Medium, 5 High
  status?: number // 0 Open, 2 Completed
  completedTime?: string
  sortOrder?: number
  items?: TickTickChecklistItem[]
}

export interface TickTickProjectData {
  project: TickTickProject
  tasks: TickTickTask[]
  columns?: unknown[]
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
  accentColor: string
  prefs: AppPrefs
  integrations: IntegrationsPublic
}

/** A standalone, app-wide note (lives outside any pane; persisted to disk). */
export interface NoteDoc {
  id: string
  title: string
  body: string
  /** optional tags for grouping in the notes panel */
  tags?: string[]
  /** optional inline to-do list */
  todos?: TodoItem[]
  createdAt: number
  updatedAt: number
  /** "pinned to top" in the notes panel sidebar */
  pinned?: boolean
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
  accentColor?: string
  /** shallow-merged into the stored prefs blob */
  prefs?: Partial<AppPrefs>
  /** set or clear a to-do service credential (token = null disconnects) */
  integrationToken?: { id: IntegrationId; token: string | null }
  /** set TickTick app client_id (registered on developer.ticktick.com); null clears it */
  tickTickClientId?: string | null
  /** set TickTick app client_secret; null clears it */
  tickTickClientSecret?: string | null
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
  /** extra args for the directly-spawned `command` (e.g. ["--continue"] to resume a session) */
  commandArgs?: string[]
}

/** Open an SSH session that streams through the same pty:data/pty:exit channels. */
export interface SshSpawnRequest {
  paneId: string
  /** "user@host" or "user@host:port" */
  target: string
  /** password for a fresh connection; omit to use a previously saved one */
  password?: string
  /** persist the password (encrypted) for next time */
  savePassword?: boolean
  cols: number
  rows: number
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
  /** working directory the pane was launched in, if known */
  cwd?: string
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

/**
 * Live Claude usage from Anthropic's OAuth usage endpoint (the same source as
 * `/usage`). Account-global, not per-pane. `percent` is the real plan
 * utilization; `resetInMs` counts down to the window reset.
 */
export interface ClaudeUsageWindow {
  /** Plan utilization for this window, 0–100 (rounded). */
  percent: number
  /** Milliseconds until this window resets. */
  resetInMs: number
}
export interface ClaudeUsage {
  /** A usage reading was obtained (token present + endpoint answered). */
  ok: boolean
  /** Rolling 5-hour window. */
  fiveHour: ClaudeUsageWindow | null
  /** Rolling 7-day window. */
  sevenDay: ClaudeUsageWindow | null
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
  // app info (version, etc.)
  appInfo: 'app:info',

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
  // agents: discover the merged agent list (built-ins + manifest + gh extensions)
  agentsDiscover: 'agents:discover',

  // learning layer (local observe -> distill -> inject; opt-in, default off)
  learningTurnMarker: 'learning:turn-marker', // renderer -> main: a submitted user prompt
  learningGetConfig: 'learning:get-config',
  learningSetConfig: 'learning:set-config',
  learningOpenStore: 'learning:open-store', // reveal the local learning dir in the OS
  learningListCandidates: 'learning:list-candidates', // renderer -> main: pending review queue
  learningCandidates: 'learning:candidates', // main -> renderer (event): new gate candidates
  learningDistill: 'learning:distill', // renderer -> main: run a distillation pass (model call)
  learningListMemory: 'learning:list-memory', // renderer -> main: current brain (memories+skills)
  learningListPendingOps: 'learning:list-pending-ops', // renderer -> main: distilled ops awaiting review
  learningApproveOp: 'learning:approve-op', // renderer -> main: write a pending op into the brain
  learningRejectOp: 'learning:reject-op', // renderer -> main: discard a pending op
  learningForgetProject: 'learning:forget-project', // renderer -> main: wipe one project's learning
  learningInject: 'learning:inject', // renderer -> main: write the brain into an agent's context file

  // clipboard (right-click paste of text + images)
  clipboardRead: 'clipboard:read',

  // system process monitor (task manager "System" tab)
  systemProcList: 'system:proc-list',
  systemProcKill: 'system:proc-kill',

  // saved sessions (named workspace snapshots persisted to disk)
  sessionsRead: 'sessions:read', // metadata + pane config list (sessions.json)
  sessionsWrite: 'sessions:write',
  // per-session chat content (terminal transcripts), stored one file per session
  sessionDataRead: 'sessions:data-read',
  sessionDataWrite: 'sessions:data-write',
  sessionDataDelete: 'sessions:data-delete',
  // auto-saved "last session" (full snapshot incl. transcripts) for crash/close restore
  lastSessionRead: 'sessions:last-read',
  lastSessionWrite: 'sessions:last-write',
  lastSessionFlush: 'sessions:last-flush', // synchronous write used on window close

  // standalone, app-wide notes (separate file under userData, survives close)
  notesRead: 'notes:read',
  notesWrite: 'notes:write',

  // app self-update (electron-updater backed by GitHub releases)
  updaterAvailable: 'updater:available', // main -> renderer (event)
  updaterDownloaded: 'updater:downloaded', // main -> renderer (event)
  updaterError: 'updater:error', // main -> renderer (event)
  updaterInstall: 'updater:install', // renderer -> main: quit + apply

  // TickTick to-do integration (OAuth via main-process loopback server + REST)
  tickTickConnect: 'ticktick:connect',
  tickTickDisconnect: 'ticktick:disconnect',
  tickTickListProjects: 'ticktick:list-projects',
  tickTickCreateProject: 'ticktick:create-project',
  tickTickDeleteProject: 'ticktick:delete-project',
  tickTickProjectData: 'ticktick:project-data',
  tickTickCreateTask: 'ticktick:create-task',
  tickTickUpdateTask: 'ticktick:update-task',
  tickTickCompleteTask: 'ticktick:complete-task',
  tickTickDeleteTask: 'ticktick:delete-task',

  // telegram
  telegramStatus: 'telegram:status',
  telegramRestart: 'telegram:restart',
  telegramTest: 'telegram:test', // send a test message to verify the round trip
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

  // claude usage (live from Anthropic's OAuth /usage endpoint)
  claudeUsage: 'claude:usage',

  // window controls (frameless)
  windowMinimize: 'window:minimize',
  windowMaximizeToggle: 'window:maximize-toggle',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximizedChanged: 'window:maximized-changed', // main -> renderer (event)
  windowSetOverlay: 'window:set-overlay', // recolor the native caption-button overlay (theme)
  windowOpenNew: 'window:open-new', // open a fresh, independent window (current desktop)

  // file save dialog
  fileSave: 'file:save',

  // directory picker (choose the folder to open an agent in)
  dialogOpenDir: 'dialog:open-dir',

  // open a path in the OS file manager (Explorer / Finder)
  shellOpenPath: 'shell:open-path',

  // open an SSH session (streams via the pty:data/pty:exit channels)
  sshSpawn: 'ssh:spawn',

  // pane registry (renderer pushes snapshot to main on every workspace change)
  panesUpdate: 'panes:update',

  // screenshot → Telegram
  screenshotPane: 'screenshot:pane',
  screenshotWindow: 'screenshot:window'
} as const
