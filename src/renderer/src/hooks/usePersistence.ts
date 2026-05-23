import { useEffect } from 'react'
import type { MosaicNode } from 'react-mosaic-component'
import type { Pane } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toasts'

const KEY = 'uregant.workspace.v1'

interface Persisted {
  panes: Record<string, Pane>
  layout: MosaicNode<string> | null
}

/** Strip runtime-only fields so a restored pane spawns fresh PTYs / no dangling streams. */
function sanitize(panes: Record<string, Pane>): Record<string, Pane> {
  const out: Record<string, Pane> = {}
  for (const [id, p] of Object.entries(panes)) {
    const clone: Pane = { ...p } // keeps pipeTo, telegramChatId, etc.
    if (clone.shell) clone.shell = { shell: clone.shell.shell }
    if (clone.agent) clone.agent = { command: clone.agent.command, cwd: clone.agent.cwd }
    if (clone.ai) clone.ai = { ...clone.ai, activeStreamId: undefined }
    out[id] = clone
  }
  return out
}

export function usePersistence(): void {
  // Restore once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY)
      if (!raw) return
      const data = JSON.parse(raw) as Persisted
      if (data.layout && data.panes && Object.keys(data.panes).length) {
        useWorkspace.getState().hydrate(sanitize(data.panes), data.layout)
      }
    } catch {
      toast('Workspace state was corrupted and could not be restored.', 'error')
    }
  }, [])

  // Persist (debounced) whenever panes/layout change, and flush immediately
  // when the window is closing so the latest layout/folders are never lost.
  useEffect(() => {
    let handle = 0
    const save = (): void => {
      const { panes, layout } = useWorkspace.getState()
      const payload: Persisted = { panes: sanitize(panes), layout }
      try {
        localStorage.setItem(KEY, JSON.stringify(payload))
      } catch {
        /* quota / serialization errors are non-fatal */
      }
    }
    const unsub = useWorkspace.subscribe(() => {
      window.clearTimeout(handle)
      handle = window.setTimeout(save, 400)
    })
    const flush = (): void => save()
    window.addEventListener('beforeunload', flush)
    return () => {
      window.clearTimeout(handle)
      window.removeEventListener('beforeunload', flush)
      unsub()
    }
  }, [])
}
