import { useEffect } from 'react'
import type { Pane } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { getScreenText, onTerminalInput } from '@renderer/lib/terminalPool'

const IDLE_MS = 1500

interface SrcState {
  armed: boolean
  timer: number
  lastSent: string
  baseBlocks: Set<string>
}

function ptyOf(pane: Pane | undefined): string | undefined {
  return pane?.agent?.ptyId || pane?.shell?.ptyId
}

function answerBlocks(text: string): string[] {
  const blocks: string[] = []
  let cur: string[] | null = null
  const isBoundary = (t: string): boolean =>
    /^[❯✻⏵╭╮╰╯│]/.test(t) || (t.length > 0 && /^[─-╿\s]+$/.test(t))
  const flush = (): void => {
    if (cur) {
      const b = cur.join('\n').replace(/\s+$/, '').trim()
      if (b) blocks.push(b)
      cur = null
    }
  }
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const t = line.trim()
    if (/^●/.test(t)) {
      flush()
      cur = [t.replace(/^●\s?/, '')]
    } else if (cur) {
      if (isBoundary(t)) flush()
      else cur.push(line.replace(/^ {1,2}/, ''))
    }
  }
  flush()
  return blocks
}

/**
 * When a pane has pipeTargets set, its answer blocks are pasted into every
 * target pane once the source goes idle (fan-out supported).
 */
export function useChainForwarding(): void {
  useEffect(() => {
    const state = new Map<string, SrcState>()
    const getSrc = (id: string): SrcState => {
      let s = state.get(id)
      if (!s) {
        s = { armed: false, timer: 0, lastSent: '', baseBlocks: new Set() }
        state.set(id, s)
      }
      return s
    }
    const arm = (id: string): void => {
      const s = getSrc(id)
      if (!s.armed) {
        s.armed = true
        s.baseBlocks = new Set(answerBlocks(getScreenText(id)))
      }
    }

    const targets = (sourceId: string): Pane[] => {
      const ws = useWorkspace.getState()
      return (ws.panes[sourceId]?.pipeTargets ?? [])
        .map((id) => ws.panes[id])
        .filter(Boolean) as Pane[]
    }

    const flush = (sourceId: string): void => {
      const st = getSrc(sourceId)
      st.armed = false
      const tgts = targets(sourceId)
      if (!tgts.length) return
      const fresh = answerBlocks(getScreenText(sourceId)).filter((b) => !st.baseBlocks.has(b))
      const result = fresh.join('\n\n').trim()
      if (!result || result === st.lastSent) return
      st.lastSent = result
      for (const tgt of tgts) {
        const pty = ptyOf(tgt)
        if (!pty) continue
        if (tgt.pipeTargets?.length) arm(tgt.id) // chain piping
        window.api.writePty(pty, `\x1b[200~${result}\x1b[201~`)
        window.setTimeout(() => window.api.writePty(pty, '\r'), 150)
      }
    }

    const offInput = onTerminalInput((paneId) => {
      if (useWorkspace.getState().panes[paneId]?.pipeTargets?.length) arm(paneId)
    })

    const offData = window.api.onPtyData((e) => {
      if (!useWorkspace.getState().panes[e.paneId]?.pipeTargets?.length) return
      const st = getSrc(e.paneId)
      if (!st.armed) return
      window.clearTimeout(st.timer)
      st.timer = window.setTimeout(() => flush(e.paneId), IDLE_MS)
    })

    return () => {
      offInput()
      offData()
      state.forEach((s) => window.clearTimeout(s.timer))
    }
  }, [])
}
