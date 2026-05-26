import { useEffect } from 'react'
import type { PaneType } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'

// Quiet period after the last output before a pane counts as "finished"
// (matches usePaneActivity's turn-detection window).
const IDLE_MS = 1500

/** A pane's type, looked up in the active workspace OR any saved background one. */
function paneTypeAnywhere(paneId: string): PaneType | undefined {
  const active = useWorkspace.getState().panes[paneId]
  if (active) return active.type
  for (const w of useWorkspaces.getState().list) {
    const p = w.panes?.[paneId]
    if (p) return p.type
  }
  return undefined
}

/** Which workspace a pane belongs to (active first, then background snapshots). */
function workspaceIdOfPane(paneId: string): string | null {
  if (useWorkspace.getState().panes[paneId]) return useWorkspaces.getState().activeId
  for (const w of useWorkspaces.getState().list) {
    if (w.panes?.[paneId]) return w.id
  }
  return null
}

/**
 * Badges a background workspace tab when one of its agents or terminals finishes
 * (output stops for IDLE_MS). Runs off the global PTY stream, so it sees panes in
 * every workspace — not just the active one — unlike usePaneActivity.
 */
export function useWorkspaceBadges(): void {
  useEffect(() => {
    const timers = new Map<string, number>()
    const working = new Set<string>()
    // Skip each pane's first working→idle (its boot/banner/initial prompt).
    const completedOnce = new Set<string>()

    const off = window.api.onPtyData((e) => {
      const type = paneTypeAnywhere(e.paneId)
      if (type !== 'ai' && type !== 'shell') return
      working.add(e.paneId)
      const prev = timers.get(e.paneId)
      if (prev) window.clearTimeout(prev)
      timers.set(
        e.paneId,
        window.setTimeout(() => {
          timers.delete(e.paneId)
          if (!working.delete(e.paneId)) return
          if (!completedOnce.has(e.paneId)) {
            completedOnce.add(e.paneId)
            return
          }
          const wsId = workspaceIdOfPane(e.paneId)
          if (wsId) useWorkspaces.getState().bumpBadge(wsId)
        }, IDLE_MS)
      )
    })

    return () => {
      off()
      timers.forEach((t) => window.clearTimeout(t))
    }
  }, [])
}
