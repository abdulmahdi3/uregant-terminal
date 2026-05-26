import { useEffect } from 'react'
import { useWorkspace } from '@renderer/store/workspace'
import { getLeaves } from '@renderer/lib/mosaicTree'
import type { PaneInfo } from '@shared/types'

/**
 * Subscribes to workspace changes and pushes a PaneInfo snapshot to the main
 * process so Telegram bot commands (/panes, /screenshot) have an up-to-date
 * picture of what's open without needing to query the renderer at command time.
 */
export function usePaneRegistry(): void {
  useEffect(() => {
    const push = (): void => {
      const { panes, layout } = useWorkspace.getState()
      const leaves = getLeaves(layout)
      const registry: PaneInfo[] = leaves.map((paneId, i) => {
        const p = panes[paneId]
        return {
          number: i + 1,
          id: paneId,
          type: p?.type ?? 'empty',
          title: p?.title ?? paneId,
          agentCommand: p?.agent?.command,
          shellName: p?.shell?.shell?.split(/[\\/]/).pop()?.replace(/\.exe$/i, ''),
          linkedChatId: p?.telegramChatId,
          cwd: p?.agent?.cwd ?? p?.shell?.cwd
        }
      })
      void window.api.updatePaneRegistry(registry)
    }

    push()
    return useWorkspace.subscribe(push)
  }, [])
}
