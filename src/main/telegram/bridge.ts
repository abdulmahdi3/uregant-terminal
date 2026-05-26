import { Bot, Keyboard, InputFile } from 'grammy'
import { BrowserWindow } from 'electron'
import type { TelegramStatus, TelegramInbound, TelegramCreatePane, PaneInfo } from '@shared/types'
import { AGENTS } from '@shared/providers'
import type { SettingsStore } from '../settings/store'

const FLUSH_MS = 1200
const TG_MAX = 3800

const ANSI_RE = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*' +
    '(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007' +
    '|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~])',
  'g'
)
const OSC_RE = new RegExp('[\\u001B\\u009D]\\][\\s\\S]*?(?:\\u0007|\\u001B\\\\|$)', 'g')
const CTRL_RE = new RegExp('[\\u0000-\\u0008\\u000B-\\u001F\\u007F]', 'g')

function cleanForTelegram(text: string): string {
  return text.replace(OSC_RE, '').replace(ANSI_RE, '').replace(CTRL_RE, '')
}

// ---- button labels (pressing a button sends this exact text) ----
const B_SCREENSHOT = '📸 Screenshot'
const B_PANES      = '📋 Panes'
const B_SS_PANE    = '📷 Screenshot pane'
const B_ZOOM       = '🔍 Zoom + shot'
const B_CHAT       = '💬 Chat with pane'
const B_RUN        = '▶️ New pane'
const B_BACK       = '‹ Back'
const B_EXIT_CHAT  = '🚪 Exit chat'
const B_DEFAULT_FOLDER = '🏠 Default folder'
const B_TYPE_PATH      = '✏️ Type a path'

// Friendly shell aliases accepted by /run, mapped to a shell binary.
const SHELL_ALIASES: Record<string, string> = {
  shell: 'powershell.exe',
  powershell: 'powershell.exe',
  pwsh: 'pwsh.exe',
  cmd: 'cmd.exe',
  bash: 'bash.exe',
  wsl: 'wsl.exe'
}

// ---- user mode per chatId ----
// 'main' | 'ss_pick' | 'zoom_pick' | 'chat_pick' | 'chat:<paneId>'
type UserMode = string

type EmitInbound = (e: TelegramInbound) => void
type EmitStatus = (s: TelegramStatus) => void
type EmitCreatePane = (e: TelegramCreatePane) => void

export class TelegramBridge {
  private bot: Bot | null = null
  private status: TelegramStatus = { running: false }

  private links = new Map<string, string>()
  private outBuf = new Map<string, string>()
  private flushTimer: NodeJS.Timeout | null = null
  private working = new Map<string, number>()
  private paneRegistry: PaneInfo[] = []
  /** chatId → current interaction mode */
  private userMode = new Map<string, UserMode>()
  /** recently used launch folders (newest first), offered as buttons in /run */
  private recentFolders: string[] = []

  constructor(
    private settings: SettingsStore,
    private getWindow: () => BrowserWindow | null,
    private emitInbound: EmitInbound,
    private emitStatus: EmitStatus,
    private emitCreatePane: EmitCreatePane
  ) {}

  isRunning(): boolean { return this.status.running }
  getStatus(): TelegramStatus { return this.status }

  async start(): Promise<TelegramStatus> {
    await this.stop()
    const token = this.settings.getTelegramToken()
    if (!token) {
      this.status = { running: false }
      this.emitStatus(this.status)
      return this.status
    }
    try {
      const bot = new Bot(token)

      bot.on('message:text', async (ctx) => {
        const chatId = ctx.chat.id.toString()
        const text = ctx.message.text.trim()
        if (!this.isAuthorized(chatId)) {
          try { await ctx.reply(`⛔ This chat (${chatId}) is not authorized to control URterminal.`) } catch { /* ignore */ }
          return
        }
        try {
          await this.handleText(chatId, text, ctx)
        } catch (err) {
          this.emitError(err)
          try { await ctx.reply('❌ ' + String(err), { reply_markup: this.mainKb() }) } catch { /* ignore */ }
        }
      })

      bot.catch((err) => this.emitError(err.error ?? err))
      await bot.init()
      void bot.start({ drop_pending_updates: true })
      this.bot = bot
      this.status = { running: true, botUsername: bot.botInfo.username }
    } catch (err) {
      this.status = { running: false, error: (err as Error).message }
    }
    this.emitStatus(this.status)
    return this.status
  }

  private emitError(err: unknown): void {
    this.status = { running: this.status.running, error: String(err) }
    this.emitStatus(this.status)
    console.error('[TelegramBridge]', err)
  }

  async stop(): Promise<void> {
    if (this.bot) {
      try { await this.bot.stop() } catch { /* ignore */ }
      this.bot = null
    }
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null }
    this.outBuf.clear()
    this.working.clear()
    this.status = { running: false }
  }

  /**
   * Whether a chat may control the app. An empty whitelist means open access
   * (legacy behaviour); otherwise only listed chats — plus the default chat —
   * are allowed, so the app can be driven from phone + desktop Telegram.
   */
  private isAuthorized(chatId: string): boolean {
    const wl = this.settings.getPrefs().telegramChatWhitelist ?? []
    if (!wl.length) return true
    return wl.includes(chatId) || chatId === this.settings.getTelegramDefaultChat()
  }

  linkPane(paneId: string, chatId: string | null): void {
    if (chatId) this.links.set(paneId, chatId)
    else this.links.delete(paneId)
  }

  setPaneRegistry(panes: PaneInfo[]): void {
    this.paneRegistry = panes
  }

  /** Camera button in pane header → screenshot that pane to its linked chat */
  async screenshotPane(paneId: string): Promise<void> {
    const chatId = this.links.get(paneId)
    if (!chatId || !this.bot) return
    const win = this.getWindow()
    if (!win) return
    await this._capturePane(chatId, win, paneId)
  }

  /** Full-window screenshot to the default chat */
  async screenshotWindow(): Promise<void> {
    const chatId = this.settings.getTelegramDefaultChat()
    if (!chatId || !this.bot) return
    const win = this.getWindow()
    if (!win) return
    await this._captureWindow(chatId, win)
  }

  async startTurn(paneId: string, prompt: string | null): Promise<void> {
    const chatId = this.links.get(paneId)
    if (!chatId || !this.bot) return
    await this.clearWorking(chatId)
    try {
      if (prompt) {
        const p = cleanForTelegram(prompt).trim()
        if (p) await this.bot.api.sendMessage(chatId, `🧑 ${p}`)
      }
      const msg = await this.bot.api.sendMessage(chatId, '⏳ Working…')
      this.working.set(chatId, msg.message_id)
    } catch { /* placeholder failure must not break the turn */ }
  }

  async finishTurn(paneId: string, result: string): Promise<void> {
    const chatId = this.links.get(paneId)
    if (!chatId || !this.bot) return
    await this.clearWorking(chatId)
    const cleaned = cleanForTelegram(result)
    if (!cleaned.trim()) return
    const out = cleaned.length > TG_MAX ? cleaned.slice(-TG_MAX) : cleaned
    try {
      await this.bot.api.sendMessage(chatId, `🤖 ${out}`)
    } catch (err) {
      this.status = { ...this.status, error: String(err) }
      this.emitStatus(this.status)
    }
  }

  /** Ping the linked chat that a pane's turn finished (independent of active chatting). */
  async notifyDone(paneId: string, label: string): Promise<void> {
    const chatId = this.links.get(paneId)
    if (!chatId || !this.bot) return
    try {
      await this.bot.api.sendMessage(chatId, `✅ ${cleanForTelegram(label) || 'Agent'} finished`)
    } catch { /* notification is best-effort */ }
  }

  private async clearWorking(chatId: string): Promise<void> {
    const id = this.working.get(chatId)
    if (id == null || !this.bot) return
    this.working.delete(chatId)
    try { await this.bot.api.deleteMessage(chatId, id) } catch { /* may already be gone */ }
  }

  forward(paneId: string, text: string): void {
    const chatId = this.links.get(paneId)
    if (!chatId || !text) return
    this.outBuf.set(chatId, (this.outBuf.get(chatId) ?? '') + text)
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS)
  }

  private flush(): void {
    this.flushTimer = null
    if (!this.bot) { this.outBuf.clear(); return }
    for (const [chatId, text] of this.outBuf) {
      const cleaned = cleanForTelegram(text)
      if (!cleaned.trim()) continue
      const trimmed = cleaned.length > TG_MAX ? cleaned.slice(-TG_MAX) : cleaned
      void this.bot.api.sendMessage(chatId, trimmed).catch((err) => {
        this.status = { ...this.status, error: String(err) }
        this.emitStatus(this.status)
      })
    }
    this.outBuf.clear()
  }

  // ---- keyboards ----

  private mainKb(): Keyboard {
    return new Keyboard()
      .text(B_SCREENSHOT).text(B_PANES).row()
      .text(B_SS_PANE).text(B_ZOOM).row()
      .text(B_CHAT).text(B_RUN)
      .resized().persistent()
  }

  private panePickerKb(): Keyboard {
    const kb = new Keyboard()
    for (const p of this.paneRegistry) {
      const icon = p.type === 'ai' ? '🤖' : p.type === 'shell' ? '🖥' : '▫️'
      kb.text(`${p.number}. ${icon} ${p.title}`).row()
    }
    return kb.text(B_BACK).resized().persistent()
  }

  private chatKb(): Keyboard {
    return new Keyboard().text(B_EXIT_CHAT).resized().persistent()
  }

  /** Program picker for a new pane — agents + shells as buttons (no typing). */
  private runAgentKb(): Keyboard {
    const kb = new Keyboard()
    AGENTS.forEach((a, i) => {
      kb.text(a)
      if (i % 2 === 1) kb.row()
    })
    if (AGENTS.length % 2 === 1) kb.row()
    kb.text('powershell').text('cmd').row()
    kb.text('wsl').text('bash').row()
    kb.text(B_BACK)
    return kb.resized().persistent()
  }

  /** Folder picker — shows the actual paths as buttons so the user never types. */
  private runFolderKb(candidates: string[]): Keyboard {
    const kb = new Keyboard()
    for (const c of candidates) kb.text(c).row()
    kb.text(B_DEFAULT_FOLDER).text(B_TYPE_PATH).row()
    kb.text(B_BACK)
    return kb.resized().persistent()
  }

  /** Unique launch-folder suggestions: recent folders + currently open panes' cwds. */
  private folderCandidates(): string[] {
    const fromPanes = this.paneRegistry
      .map((p) => p.cwd)
      .filter((c): c is string => !!c && c.trim().length > 0)
    const seen = new Set<string>()
    const out: string[] = []
    for (const f of [...this.recentFolders, ...fromPanes]) {
      const key = f.trim()
      if (!key || seen.has(key)) continue
      seen.add(key)
      out.push(key)
      if (out.length >= 6) break
    }
    return out
  }

  private rememberFolder(cwd?: string): void {
    const f = cwd?.trim()
    if (!f) return
    this.recentFolders = [f, ...this.recentFolders.filter((x) => x !== f)].slice(0, 6)
  }

  // ---- main text dispatcher ----

  private async handleText(
    chatId: string,
    text: string,
    ctx: { reply: (t: string, o?: object) => Promise<unknown> }
  ): Promise<void> {
    const reply = (t: string, kb?: Keyboard) =>
      ctx.reply(t, kb ? { reply_markup: kb } : undefined)

    const mode: UserMode = this.userMode.get(chatId) ?? 'main'

    // ---- /run <agent|shell> [folder] — works in any mode ----
    if (text === '/run' || text.toLowerCase().startsWith('/run ')) {
      await this.cmdRun(chatId, text.replace(/^\/run\s*/i, ''), reply)
      this.userMode.set(chatId, 'main')
      return
    }

    // ---- new pane: step 1, pick the program (agent/shell) ----
    if (mode === 'run_agent') {
      if (text === B_BACK) {
        this.userMode.set(chatId, 'main')
        await reply('Main menu:', this.mainKb())
        return
      }
      const head = text.toLowerCase()
      const sel = (AGENTS as readonly string[]).includes(head)
        ? { type: 'ai' as const, cmd: head }
        : SHELL_ALIASES[head]
          ? { type: 'shell' as const, cmd: head }
          : null
      if (!sel) {
        await reply('❌ Pick a program from the buttons:', this.runAgentKb())
        return
      }
      this.userMode.set(chatId, `run_folder:${sel.type}:${sel.cmd}`)
      await reply(`📂 Choose a folder for ${sel.cmd}:`, this.runFolderKb(this.folderCandidates()))
      return
    }

    // ---- new pane: step 2, pick the folder (shown as buttons, not typed) ----
    if (mode.startsWith('run_folder:')) {
      const [, type, cmd] = mode.split(':')
      if (text === B_BACK) {
        this.userMode.set(chatId, 'run_agent')
        await reply('▶️ Choose a program:', this.runAgentKb())
        return
      }
      if (text === B_TYPE_PATH) {
        this.userMode.set(chatId, `run_type:${type}:${cmd}`)
        await reply('✏️ Send the folder path:', new Keyboard().text(B_BACK).resized().persistent())
        return
      }
      const cwd = text === B_DEFAULT_FOLDER ? undefined : text
      await this.createPaneFromPick(chatId, type as 'ai' | 'shell', cmd, cwd, reply)
      this.userMode.set(chatId, 'main')
      return
    }

    // ---- new pane: optional manual path entry ----
    if (mode.startsWith('run_type:')) {
      const [, type, cmd] = mode.split(':')
      if (text === B_BACK) {
        this.userMode.set(chatId, 'main')
        await reply('Main menu:', this.mainKb())
        return
      }
      await this.createPaneFromPick(chatId, type as 'ai' | 'shell', cmd, text, reply)
      this.userMode.set(chatId, 'main')
      return
    }

    // ---- chatting with a pane ----
    if (mode.startsWith('chat:')) {
      if (text === B_EXIT_CHAT || text === '/exit') {
        this.userMode.set(chatId, 'main')
        await reply('Main menu:', this.mainKb())
      } else {
        const paneId = mode.slice(5)
        this.emitInbound({ paneId, text, chatId })
      }
      return
    }

    // ---- picking a pane ----
    if (mode === 'ss_pick' || mode === 'zoom_pick' || mode === 'chat_pick') {
      if (text === B_BACK) {
        this.userMode.set(chatId, 'main')
        await reply('Main menu:', this.mainKb())
        return
      }
      const num = parseInt(text)
      const pane = isNaN(num) ? this.paneRegistry.find(p =>
        text.startsWith(`${p.number}.`)
      ) : this.paneRegistry.find(p => p.number === num)
      if (!pane) {
        await reply('❌ Pane not found. Choose from the list:', this.panePickerKb())
        return
      }
      this.userMode.set(chatId, 'main')
      if (mode === 'ss_pick') {
        await this.cmdScreenshotPane(chatId, pane)
      } else if (mode === 'zoom_pick') {
        await this.cmdZoomScreenshot(chatId, pane)
      } else {
        this.userMode.set(chatId, `chat:${pane.id}`)
        await reply(`💬 Chatting with ${pane.title}. Type your message:`, this.chatKb())
      }
      return
    }

    // ---- main menu buttons ----
    switch (text) {
      case B_SCREENSHOT:
        await this.cmdScreenshot(chatId)
        break
      case B_PANES:
        await this.cmdPanes(chatId, ctx)
        break
      case B_SS_PANE:
        if (this.paneRegistry.length === 0) { await reply('📭 No panes open.'); break }
        this.userMode.set(chatId, 'ss_pick')
        await reply('📷 Choose a pane:', this.panePickerKb())
        break
      case B_ZOOM:
        if (this.paneRegistry.length === 0) { await reply('📭 No panes open.'); break }
        this.userMode.set(chatId, 'zoom_pick')
        await reply('🔍 Choose a pane to zoom & screenshot:', this.panePickerKb())
        break
      case B_CHAT:
        if (this.paneRegistry.length === 0) { await reply('📭 No panes open.'); break }
        this.userMode.set(chatId, 'chat_pick')
        await reply('💬 Choose a pane to chat with:', this.panePickerKb())
        break
      case B_RUN:
        this.userMode.set(chatId, 'run_agent')
        await reply('▶️ Choose a program:', this.runAgentKb())
        break
      default:
        await reply('URterminal — choose an action:', this.mainKb())
    }
  }

  // ---- command implementations ----

  private async cmdPanes(chatId: string, ctx: { reply: (t: string, o?: object) => Promise<unknown> }): Promise<void> {
    if (this.paneRegistry.length === 0) {
      await ctx.reply('📭 No panes are currently open.')
      return
    }
    const lines = this.paneRegistry.map(p => {
      const icon = p.type === 'ai' ? '🤖' : p.type === 'shell' ? '🖥' : '▫️'
      const detail = p.agentCommand ? ` · ${p.agentCommand}` : p.shellName ? ` · ${p.shellName}` : ''
      const linked = p.linkedChatId === chatId ? ' 📡' : p.linkedChatId ? ' 🔗' : ''
      return `${p.number}. ${icon} ${p.title}${detail}${linked}`
    })
    await ctx.reply(`Open panes (${this.paneRegistry.length}):\n${lines.join('\n')}`)
  }

  /** Parse a "<agent|shell> [folder]" string into a create-pane request. */
  private parseRun(argStr: string): Omit<TelegramCreatePane, 'chatId'> | null {
    const trimmed = argStr.trim()
    if (!trimmed) return null
    const sp = trimmed.indexOf(' ')
    const head = (sp === -1 ? trimmed : trimmed.slice(0, sp)).toLowerCase()
    const cwd = (sp === -1 ? '' : trimmed.slice(sp + 1).trim()) || undefined
    if ((AGENTS as readonly string[]).includes(head)) return { type: 'ai', agentCommand: head, cwd }
    if (SHELL_ALIASES[head]) return { type: 'shell', shell: SHELL_ALIASES[head], cwd }
    return null
  }

  private async cmdRun(
    chatId: string,
    argStr: string,
    reply: (t: string, kb?: Keyboard) => Promise<unknown>
  ): Promise<void> {
    const parsed = this.parseRun(argStr)
    if (!parsed) {
      await reply(
        '❌ Usage: <agent|shell> [folder]\n' +
          `Agents: ${AGENTS.join(', ')} · Shells: powershell, cmd, wsl, bash`,
        this.mainKb()
      )
      return
    }
    this.rememberFolder(parsed.cwd)
    this.emitCreatePane({ ...parsed, chatId })
    const what = parsed.type === 'ai' ? parsed.agentCommand : parsed.shell
    await reply(`▶️ Opening ${what}${parsed.cwd ? ` in ${parsed.cwd}` : ''}…`, this.mainKb())
  }

  /** Create a pane from the button-driven picker (program + chosen/typed folder). */
  private async createPaneFromPick(
    chatId: string,
    type: 'ai' | 'shell',
    cmd: string,
    cwd: string | undefined,
    reply: (t: string, kb?: Keyboard) => Promise<unknown>
  ): Promise<void> {
    const folder = cwd?.trim() || undefined
    const req: Omit<TelegramCreatePane, 'chatId'> =
      type === 'ai'
        ? { type: 'ai', agentCommand: cmd, cwd: folder }
        : { type: 'shell', shell: SHELL_ALIASES[cmd] ?? cmd, cwd: folder }
    this.rememberFolder(folder)
    this.emitCreatePane({ ...req, chatId })
    await reply(`▶️ Opening ${cmd}${folder ? ` in ${folder}` : ''}…`, this.mainKb())
  }

  private async cmdScreenshot(chatId: string): Promise<void> {
    const win = this.getWindow()
    if (!win) { await this.bot?.api.sendMessage(chatId, '❌ App window not available.'); return }
    await this._captureWindow(chatId, win)
  }

  private async cmdScreenshotPane(chatId: string, pane: PaneInfo): Promise<void> {
    const win = this.getWindow()
    if (!win) { await this.bot?.api.sendMessage(chatId, '❌ App window not available.'); return }
    await this._capturePane(chatId, win, pane.id, pane.title)
  }

  private async cmdZoomScreenshot(chatId: string, pane: PaneInfo): Promise<void> {
    const win = this.getWindow()
    if (!win) { await this.bot?.api.sendMessage(chatId, '❌ App window not available.'); return }
    try {
      await win.webContents.executeJavaScript(
        `window.__setZoomedPane && window.__setZoomedPane('${pane.id}')`
      )
      await new Promise<void>(resolve => setTimeout(resolve, 350))
      const img = await win.capturePage()
      await win.webContents.executeJavaScript(
        `window.__setZoomedPane && window.__setZoomedPane(null)`
      )
      const buf = img.toPNG()
      if (!buf.length) { await this.bot?.api.sendMessage(chatId, '❌ Screenshot was empty.'); return }
      await this.bot?.api.sendPhoto(chatId, new InputFile(buf, 'pane-zoom.png'), {
        caption: `🔍 ${pane.title} (full screen)`
      })
    } catch (err) {
      await win.webContents.executeJavaScript(
        `window.__setZoomedPane && window.__setZoomedPane(null)`
      ).catch(() => {})
      await this.bot?.api.sendMessage(chatId, `❌ Zoom screenshot failed: ${(err as Error).message}`)
    }
  }

  private async _capturePane(
    chatId: string, win: BrowserWindow, paneId: string, title?: string
  ): Promise<void> {
    if (!this.bot) return
    try {
      type RectInfo = { x: number; y: number; width: number; height: number; dpr: number }
      const rect = await win.webContents.executeJavaScript(
        `(function(){
          var el=document.querySelector('[data-pane-id="${paneId}"]');
          if(!el)return null;
          var r=el.getBoundingClientRect();
          return{x:r.left,y:r.top,width:r.width,height:r.height,dpr:window.devicePixelRatio||1};
        })()`
      ) as RectInfo | null
      if (!rect || rect.width === 0 || rect.height === 0) {
        await this.bot.api.sendMessage(chatId, '❌ Could not locate the pane on screen.')
        return
      }
      const { x, y, width, height, dpr } = rect
      const img = await win.capturePage({
        x: Math.round(x * dpr), y: Math.round(y * dpr),
        width: Math.round(width * dpr), height: Math.round(height * dpr)
      })
      const buf = img.toPNG()
      if (!buf.length) { await this.bot.api.sendMessage(chatId, '❌ Screenshot was empty.'); return }
      await this.bot.api.sendPhoto(chatId, new InputFile(buf, 'pane.png'), {
        caption: title ? `📸 ${title}` : '📸 Pane screenshot'
      })
    } catch (err) {
      await this.bot.api.sendMessage(chatId, `❌ Screenshot failed: ${(err as Error).message}`)
    }
  }

  private async _captureWindow(chatId: string, win: BrowserWindow): Promise<void> {
    if (!this.bot) return
    try {
      const img = await win.capturePage()
      const buf = img.toPNG()
      if (!buf.length) { await this.bot.api.sendMessage(chatId, '❌ Screenshot was empty.'); return }
      await this.bot.api.sendPhoto(chatId, new InputFile(buf, 'terminal.png'), {
        caption: '📸 Full terminal window'
      })
    } catch (err) {
      await this.bot.api.sendMessage(chatId, `❌ Screenshot failed: ${(err as Error).message}`)
    }
  }
}
