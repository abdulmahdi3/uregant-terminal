import { Bot } from 'grammy'
import type { TelegramStatus, TelegramInbound } from '@shared/types'
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

  constructor(
    private settings: SettingsStore,
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
    // `/pane <id> <text>` overrides routing; otherwise reverse-lookup the link.
    let paneId: string | undefined
    let body = text
    const m = text.match(/^\/pane\s+(\S+)\s+([\s\S]+)$/)
    if (m) {
      paneId = m[1]
      body = m[2]
    } else {
      for (const [pid, cid] of this.links) {
        if (cid === chatId) {
          paneId = pid
          break
        }
      }
    }
    if (!paneId) {
      void this.bot?.api.sendMessage(
        chatId,
        'No pane linked to this chat. Use /pane <paneId> <message> or link a pane in the app.'
      )
      return
    }
    this.emitInbound({ paneId, text: body, chatId })
  }
}
