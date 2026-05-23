import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { getScreenText, onTerminalInput } from '@renderer/lib/terminalPool'
import { answerBlocks } from './useChainForwarding'

// How long the pane must be quiet after output before we treat the answer as
// complete and forward it (matches the chain-forwarding cadence).
const IDLE_MS = 1500

// Escape sequences in raw keystrokes (arrow keys, bracketed-paste markers, etc.).
// Stripping them leaves just the printable text the user typed.
const INPUT_ESC = new RegExp('\\u001B\\[[0-9;]*[~A-Za-z]|\\u001B[O][A-Za-z]?', 'g')

// Wrap injected text in bracketed-paste markers so the CLI treats it as a paste
// (handles multi-line and avoids per-char keybindings firing).
const ESC = String.fromCharCode(27)
const bracketPaste = (s: string): string => `${ESC}[200~${s}${ESC}[201~`

interface TgState {
  armed: boolean
  timer: number
  baseBlocks: Set<string>
  lastSent: string
  inputBuf: string
}

function ptyOf(paneId: string): string | undefined {
  const pane = useWorkspace.getState().panes[paneId]
  return pane?.type === 'ai' ? pane.agent?.ptyId : pane?.shell?.ptyId
}

/**
 * Owns the two-way Telegram bridge for panes linked to a chat:
 *  - outbound: when a turn starts (typed locally or received from Telegram) the
 *    bot posts a "working" placeholder; once the pane goes quiet it is deleted
 *    and only the LAST answer block is sent back;
 *  - inbound: messages received from Telegram are typed into the linked pane.
 */
export function useTelegramForwarding(): void {
  useEffect(() => {
    const state = new Map<string, TgState>()
    const getSt = (id: string): TgState => {
      let s = state.get(id)
      if (!s) {
        s = { armed: false, timer: 0, baseBlocks: new Set(), lastSent: '', inputBuf: '' }
        state.set(id, s)
      }
      return s
    }
    const isLinked = (id: string): boolean => !!useWorkspace.getState().panes[id]?.telegramChatId

    // The in-memory pane->chat map in the main process is lost on restart, so
    // re-register it from the persisted panes once they have hydrated.
    for (const [id, pane] of Object.entries(useWorkspace.getState().panes)) {
      if (pane.telegramChatId) window.api.linkPaneToTelegram(id, pane.telegramChatId)
    }

    // Begin tracking a turn: snapshot the answers already on screen (so only new
    // blocks count) and ask the bot to show its "working" placeholder.
    const startTurn = (id: string, prompt: string | null): void => {
      const s = getSt(id)
      s.armed = true
      s.baseBlocks = new Set(answerBlocks(getScreenText(id)))
      window.api.telegramStartTurn(id, prompt)
    }

    const flush = (id: string): void => {
      const s = getSt(id)
      s.armed = false
      const fresh = answerBlocks(getScreenText(id)).filter((b) => !s.baseBlocks.has(b))
      // Only the final answer block — not every block produced this turn.
      const last = (fresh[fresh.length - 1] ?? '').trim()
      const toSend = last && last !== s.lastSent ? last : ''
      if (toSend) s.lastSent = toSend
      // An empty string still tells the bridge to remove the "working" placeholder.
      window.api.telegramFinishTurn(id, toSend)
    }

    // ---- outbound: capture locally-typed prompts ----
    const offInput = onTerminalInput((paneId, data) => {
      if (!isLinked(paneId)) return
      const s = getSt(paneId)
      let buf = s.inputBuf
      for (const ch of data.replace(INPUT_ESC, '')) {
        const code = ch.charCodeAt(0)
        if (code === 13 || code === 10) {
          const prompt = buf.trim()
          buf = ''
          if (prompt) startTurn(paneId, prompt) // echo prompt + show "working"
        } else if (code === 127 || code === 8) {
          buf = buf.slice(0, -1) // backspace / delete
        } else if (code >= 32) {
          buf += ch // printable character
        }
      }
      s.inputBuf = buf
    })

    // ---- inbound: type Telegram messages into the linked pane ----
    const offInbound = window.api.onTelegramInbound(({ paneId, text }) => {
      const ptyId = ptyOf(paneId)
      if (!ptyId) return
      startTurn(paneId, null) // they sent it from Telegram; just show "working"
      window.api.writePty(ptyId, bracketPaste(text))
      // submit on the next tick so the paste is registered first
      window.setTimeout(() => window.api.writePty(ptyId, '\r'), 150)
    })

    const offData = window.api.onPtyData((e) => {
      const s = state.get(e.paneId)
      if (!s?.armed) return
      window.clearTimeout(s.timer)
      s.timer = window.setTimeout(() => flush(e.paneId), IDLE_MS)
    })

    return () => {
      offInput()
      offInbound()
      offData()
      state.forEach((s) => window.clearTimeout(s.timer))
    }
  }, [])
}
