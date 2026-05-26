import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { usePaneStatus, emitPaneTurnComplete } from '@renderer/store/paneStatus'
import { onTerminalInput } from '@renderer/lib/terminalPool'

// Quiet period after the last output before a turn counts as finished.
const IDLE_MS = 1500

/**
 * Tracks each AI pane's Working / Idle / Awaiting status from PTY output and
 * submitted input, and emits a turn-complete event when a working pane goes
 * quiet (consumed by the desktop + Telegram "done" notifications).
 */
export function usePaneActivity(): void {
  useEffect(() => {
    const timers = new Map<string, number>()
    const working = new Set<string>()
    const isAi = (id: string): boolean => useWorkspace.getState().panes[id]?.type === 'ai'

    const offData = window.api.onPtyData((e) => {
      if (!isAi(e.paneId)) return
      working.add(e.paneId)
      usePaneStatus.getState().set(e.paneId, 'working')
      const prev = timers.get(e.paneId)
      if (prev) window.clearTimeout(prev)
      timers.set(
        e.paneId,
        window.setTimeout(() => {
          timers.delete(e.paneId)
          if (working.delete(e.paneId)) {
            usePaneStatus.getState().set(e.paneId, 'idle')
            emitPaneTurnComplete(e.paneId)
          }
        }, IDLE_MS)
      )
    })

    // A submitted line (Enter) before any output means the agent is about to work.
    const offInput = onTerminalInput((paneId, data) => {
      if (!isAi(paneId)) return
      if (/[\r\n]/.test(data) && !working.has(paneId)) {
        usePaneStatus.getState().set(paneId, 'awaiting')
      }
    })

    return () => {
      offData()
      offInput()
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [])
}
