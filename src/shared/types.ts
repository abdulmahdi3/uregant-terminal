// Shared types used across main, preload, and renderer.
// Keep this free of any node/electron/dom imports so all processes can use it.

export type ProviderId = 'anthropic' | 'openai' | 'gemini' | 'ollama'

export type PaneType = 'ai' | 'shell' | 'empty'

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** true while assistant text is still streaming in */
  streaming?: boolean
  createdAt: number
}

export interface AiPaneState {
  provider: ProviderId
  model: string
  messages: ChatMessage[]
  /** active stream id if currently generating */
  activeStreamId?: string
}

export interface ShellPaneState {
  shell: string
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
  ai?: AiPaneState
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

export interface SettingsPublic {
  providers: ProviderSettingsPublic
  telegram: TelegramSettingsPublic
  defaultProvider: ProviderId
  defaultModel: string
  theme: ThemeName
  language: string
  accentColor: string
}

// Patch shapes the renderer may send to mutate settings.
export interface SettingsPatch {
  providerKey?: { provider: ProviderId; key: string | null }
  ollamaBaseUrl?: string
  telegramToken?: string | null
  telegramDefaultChatId?: string | null
  defaultProvider?: ProviderId
  defaultModel?: string
  theme?: ThemeName
  language?: string
  accentColor?: string
}

// ---------------------------------------------------------------------------
// AI streaming
// ---------------------------------------------------------------------------

export interface ChatStreamRequest {
  streamId: string
  paneId: string
  provider: ProviderId
  model: string
  messages: { role: ChatRole; content: string }[]
}

export type StreamChunk =
  | { streamId: string; paneId: string; type: 'text'; text: string }
  | { streamId: string; paneId: string; type: 'done' }
  | { streamId: string; paneId: string; type: 'error'; message: string }

// ---------------------------------------------------------------------------
// PTY (shell) streaming
// ---------------------------------------------------------------------------

export interface PtySpawnRequest {
  paneId: string
  shell?: string
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
  providerTestKey: 'settings:test-key',
  providerListModels: 'settings:list-models',

  // ai streaming
  chatStart: 'chat:start',
  chatCancel: 'chat:cancel',
  chatChunk: 'chat:chunk', // main -> renderer (event)

  // pty
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data', // main -> renderer (event)
  ptyExit: 'pty:exit', // main -> renderer (event)

  // telegram
  telegramStatus: 'telegram:status',
  telegramRestart: 'telegram:restart',
  telegramLinkPane: 'telegram:link-pane',
  telegramForward: 'telegram:forward',
  telegramInbound: 'telegram:inbound', // main -> renderer (event)
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
  dialogOpenDir: 'dialog:open-dir'
} as const
