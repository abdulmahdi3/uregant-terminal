import { Bot, InputFile } from 'grammy'
import { BrowserWindow } from 'electron'
import type { TelegramStatus, TelegramInbound, PaneInfo } from '@shared/types'
import type { SettingsStore } from '../settings/store'

const FLUSH_MS = 1200
const TG_MAX = 3800 // stay under Telegram's 4096 limit with headroom

// Matches ANSI/VT escape sequences: CSI (colors, cursor moves, clears) and
// OSC (e.g. window-title sequences). Raw PTY bytes are full of these and
// Telegram renders them literally, so strip them before forwarding.
// Built from a string of \u escapes to keep this source pure ASCII.
const ANSI_RE = new RegExp(
  '[\\u001B\\u009B][[\\]()#;?]*' +
    '(?:(?:(?:;[-a-zA-Z\\d/#&.:=?%@~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d/#&.:=?%@~_]*)*)?\\u0007' +
    '|(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~])',
  'g'
)

// OSC sequences (e.g. window title `ESC ] 0 ; text BEL`) can contain spaces,
// which the general ANSI regex does not handle, so strip them first.
// Terminated by BEL () or ST (ESC \).
const OSC_RE = new RegExp('[\\u001B\\u009D]\\][\\s\\S]*?(?:\\u0007|\\u001B\\\\|$)', 'g')

// Strip remaining C0 control characters and DEL, but keep tab and newline.
const CTRL_RE = new RegExp('[\\u0000-\\u0008\\u000B-\\u001F\\u007F]', 'g')

/** Strip ANSI escape sequences and stray control chars before forwarding. */
function cleanForTelegram(text: string): string {
  return text.replace(OSC_RE, '').replace(ANSI_RE, '').replace(CTRL_RE, '')
}

type EmitInbound = (e: TelegramInbound) => void
type EmitStatus = (s: TelegramStatus) => void

export class TelegramBridge {
  private bot: Bot | null = null
  private status: TelegramStatus = { running: false }

  /** paneId -> chatId (outbound + reverse-lookup for inbound) */
  private links = new Map<string, string>()
  /** chatId -> buffered outbound text */
  private outBuf = new Map<string, string>()
  private flushTimer: NodeJS.Timeout | null = null
  /** chatId -> message_id of the transient "working" placeholder, if any */
  private working = new Map<string, number>()
  /** Current pane layout snapshot, updated by renderer on every workspace change */
  private paneRegistry: PaneInfo[] = []

  constructor(
    private settings: SettingsStore,
    private getWindow: () => BrowserWindow | null,
    private emitInbound: EmitInbound,
    private emitStatus: EmitStatus
  ) {}

  isRunning(): boolean {
    return this.status.running
  }

  getStatus(): TelegramStatus {
    return this.status
  }

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
      bot.on('message:text', (ctx) => this.handleInbound(ctx.chat.id.toString(), ctx.message.text))
      bot.catch((err) => {
        this.status = { running: this.status.running, error: String(err.error ?? err) }
        this.emitStatus(this.status)
      })
      await bot.init()
      // start() runs long-polling; do not await (it resolves only on stop).
      void bot.start({ drop_pending_updates: true })
      this.bot = bot
      this.status = { running: true, botUsername: bot.botInfo.username }
    } catch (err) {
      this.status = { running: false, error: (err as Error).message }
    }
    this.emitStatus(this.status)
    return this.status
  }

  async stop(): Promise<void> {
    if (this.bot) {
      try {
        await this.bot.stop()
      } catch {
        /* ignore */
      }
      this.bot = null
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    this.outBuf.clear()
    this.working.clear()
    this.status = { running: false }
  }

  linkPane(paneId: string, chatId: string | null): void {
    if (chatId) this.links.set(paneId, chatId)
    else this.links.delete(paneId)
  }

  setPaneRegistry(panes: PaneInfo[]): void {
    this.paneRegistry = panes
  }

  /** Called via IPC when the pane header camera button is clicked. */
  async screenshotPane(paneId: string): Promise<void> {
    const chatId = this.links.get(paneId)
    if (!chatId || !this.bot) return
    const win = this.getWindow()
    if (!win) return
    await this._capturePane(chatId, win, paneId)
  }

  /** Called via IPC for a full-window screenshot, sent to the default chat. */
  async screenshotWindow(): Promise<void> {
    const chatId = this.settings.getTelegramDefaultChat()
    if (!chatId || !this.bot) return
    const win = this.getWindow()
    if (!win) return
    await this._captureWindow(chatId, win)
  }

  /**
   * Start of a turn: optionally echo the prompt, then post a transient
   * "working" placeholder whose id is remembered so finishTurn can delete it.
   */
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
    } catch {
      /* a failed placeholder must not break the turn */
    }
  }

  /** End of a turn: remove the "working" placeholder and send the result. */
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

  /** Delete the "working" placeholder for a chat, if one is outstanding. */
  private async clearWorking(chatId: string): Promise<void> {
    const id = this.working.get(chatId)
    if (id == null || !this.bot) return
    this.working.delete(chatId)
    try {
      await this.bot.api.deleteMessage(chatId, id)
    } catch {
      /* message may already be gone */
    }
  }

  /** Buffer pane output and flush to its linked chat on a throttle. */
  forward(paneId: string, text: string): void {
    const chatId = this.links.get(paneId)
    if (!chatId || !text) return
    this.outBuf.set(chatId, (this.outBuf.get(chatId) ?? '') + text)
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS)
    }
  }

  private flush(): void {
    this.flushTimer = null
    if (!this.bot) {
      this.outBuf.clear()
      return
    }
    for (const [chatId, text] of this.outBuf) {
      const cleaned = cleanForTelegram(text)
      // Skip flushes that were only escape sequences / whitespace.
      if (!cleaned.trim()) continue
      const trimmed = cleaned.length > TG_MAX ? cleaned.slice(-TG_MAX) : cleaned
      void this.bot.api.sendMessage(chatId, trimmed).catch((err) => {
        this.status = { ...this.status, error: String(err) }
        this.emitStatus(this.status)
      })
    }
    this.outBuf.clear()
  }

  private handleInbound(chatId: string, text: string): void {
    const trimmed = text.trim()

    // ---- bot commands ----
    if (trimmed === '/panes' || trimmed === '/panes@' + (this.status.botUsername ?? '')) {
      void this.cmdPanes(chatId)
      return
    }
    if (trimmed === '/help') {
      void this.cmdHelp(chatId)
      return
    }
    if (trimmed === '/screenshot' || trimmed.startsWith('/screenshot ')) {
      const arg = trimmed.split(/\s+/)[1]
      void this.cmdScreenshot(chatId, arg)
      return
    }

    // ---- pane routing (existing behaviour) ----
    let paneId: string | undefined
    let body = trimmed
    const m = trimmed.match(/^\/pane\s+(\S+)\s+([\s\S]+)$/)
    if (m) {
      paneId = m[1]
      body = m[2]
    } else {
      for (const [pid, cid] of this.links) {
        if (cid === chatId) { paneId = pid; break }
      }
    }
    if (!paneId) {
      void this.bot?.api.sendMessage(
        chatId,
        'No pane linked to this chat.\nUse /pane <paneId> <message> or link a pane in the app.\n\nType /help for all commands.'
      )
      return
    }
    this.emitInbound({ paneId, text: body, chatId })
  }

  // ---- command handlers ----

  private async cmdPanes(chatId: string): Promise<void> {
    if (!this.bot) return
    if (this.paneRegistry.length === 0) {
      await this.bot.api.sendMessage(chatId, '📭 No panes are currently open.')
      return
    }
    const lines = this.paneRegistry.map(p => {
      const icon = p.type === 'ai' ? '🤖' : p.type === 'shell' ? '🖥' : '▫️'
      const detail = p.agentCommand ? ` · ${p.agentCommand}` : p.shellName ? ` · ${p.shellName}` : ''
      const linked = p.linkedChatId === chatId ? ' 📡' : p.linkedChatId ? ' 🔗' : ''
      return `${p.number}. ${icon} ${p.title}${detail}${linked}`
    })
    const footer = '\n\n/screenshot — full window\n/screenshot <n> — single pane'
    await this.bot.api.sendMessage(chatId, `Open panes (${this.paneRegistry.length}):\n${lines.join('\n')}${footer}`)
  }

  private async cmdHelp(chatId: string): Promise<void> {
    if (!this.bot) return
    await this.bot.api.sendMessage(chatId, [
      '📟 URterminal Bot Commands',
      '',
      '/panes — list open panes',
      '/screenshot — capture full terminal window',
      '/screenshot <n> — capture pane number n',
      '/pane <id> <text> — send text to a specific pane'
    ].join('\n'))
  }

  private async cmdScreenshot(chatId: string, arg?: string): Promise<void> {
    if (!this.bot) return
    const win = this.getWindow()
    if (!win) { await this.bot.api.sendMessage(chatId, '❌ App window not available.'); return }

    if (arg) {
      const n = parseInt(arg, 10)
      const pane = isNaN(n) ? undefined : this.paneRegistry.find(p => p.number === n)
      if (!pane) {
        await this.bot.api.sendMessage(chatId, `❌ Pane ${arg} not found. Use /panes to see open panes.`)
        return
      }
      await this._capturePane(chatId, win, pane.id, pane.title)
    } else {
      await this._captureWindow(chatId, win)
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
      const caption = title ? `📸 ${title}` : '📸 Pane screenshot'
      await this.bot.api.sendPhoto(chatId, new InputFile(buf, 'pane.png'), { caption })
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
