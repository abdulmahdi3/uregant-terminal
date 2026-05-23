import type { Pane } from '@shared/types'
import { AGENTS } from '@shared/providers'
import { useWorkspace } from '@renderer/store/workspace'
import { useUi } from '@renderer/store/ui'

export interface Command {
  id: string
  title: string
  group: string
  /** human-readable shortcut hint, e.g. "Ctrl+T" */
  shortcut?: string
  /** hidden from the palette list but still runnable by id */
  hidden?: boolean
  run: () => void
}

const ws = (): ReturnType<typeof useWorkspace.getState> => useWorkspace.getState()
const ui = (): ReturnType<typeof useUi.getState> => useUi.getState()

function activePane(): Pane | null {
  const s = ws()
  return (s.activePaneId && s.panes[s.activePaneId]) || null
}

/** Run `command` in the active AI pane, or spin up a new one. */
function runAgent(command: string): void {
  const pane = activePane()
  if (pane?.type === 'ai') {
    ws().setAgent(pane.id, command)
  } else {
    const id = ws().addPane('ai')
    ws().setAgent(id, command)
  }
}

/** Build the full command list against the current store state. */
export function getCommands(): Command[] {
  const cmds: Command[] = [
    // ---- panes ----
    {
      id: 'pane.newAi',
      title: 'New agent pane (claude)',
      group: 'Panes',
      shortcut: 'Ctrl+T',
      run: () => ws().addPane('ai')
    },
    {
      id: 'pane.newShell',
      title: 'New shell pane',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+5',
      run: () => ws().addPane('shell')
    },
    {
      id: 'pane.splitRight',
      title: 'Split active pane → right (duplicate)',
      group: 'Panes',
      shortcut: 'Ctrl+D',
      run: () => {
        const id = ws().activePaneId
        if (id) ws().duplicatePane(id, 'row')
        else ws().addPane('ai', 'row')
      }
    },
    {
      id: 'pane.splitDown',
      title: 'Split active pane → down (duplicate)',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+D',
      run: () => {
        const id = ws().activePaneId
        if (id) ws().duplicatePane(id, 'column')
        else ws().addPane('ai', 'column')
      }
    },
    {
      id: 'pane.close',
      title: 'Close active pane',
      group: 'Panes',
      shortcut: 'Ctrl+W',
      run: () => {
        const id = ws().activePaneId
        if (id) {
          window.api.linkPaneToTelegram(id, null)
          ws().removePane(id)
        }
      }
    },
    {
      id: 'pane.reopen',
      title: 'Reopen closed pane',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+T',
      run: () => ws().reopenClosed()
    },
    {
      id: 'pane.openTerminal',
      title: 'Open terminal in agent folder',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+C',
      run: () => {
        const id = ws().activePaneId
        if (id) ws().openTerminalHere(id)
      }
    },
    {
      id: 'pane.zoom',
      title: 'Toggle zoom (maximize) active pane',
      group: 'Panes',
      shortcut: 'Ctrl+Shift+Enter',
      run: () => {
        const id = ws().activePaneId
        if (id) ui().toggleZoom(id)
      }
    },
    {
      id: 'pane.linkTelegram',
      title: 'Link active pane to Telegram…',
      group: 'Panes',
      run: () => {
        const id = ws().activePaneId
        if (id) ui().setLinkingPaneId(id)
      }
    },

    // ---- agent ----
    {
      id: 'agent.restart',
      title: 'Restart agent in active pane',
      group: 'Agent',
      run: () => {
        const pane = activePane()
        if (pane?.type === 'ai' && pane.agent) ws().setAgent(pane.id, pane.agent.command)
      }
    },

    // ---- app ----
    {
      id: 'app.settings',
      title: 'Open settings',
      group: 'App',
      shortcut: 'Ctrl+,',
      run: () => ui().setShowSettings(true)
    },
    {
      id: 'app.shortcuts',
      title: 'Keyboard shortcuts',
      group: 'App',
      shortcut: '?',
      run: () => ui().setShowShortcuts(true)
    },
    {
      id: 'app.reload',
      title: 'Reload window',
      group: 'App',
      run: () => location.reload()
    }
  ]

  // run / switch agent CLI
  for (const a of AGENTS) {
    cmds.push({
      id: `agent.run.${a}`,
      title: `Run agent: ${a}`,
      group: 'Agent',
      run: () => runAgent(a)
    })
  }

  // focus pane 1..n (hidden from the list; reachable via Ctrl+1..9)
  const count = Object.keys(ws().panes).length
  for (let i = 0; i < Math.min(count, 9); i++) {
    cmds.push({
      id: `pane.focus.${i + 1}`,
      title: `Focus pane ${i + 1}`,
      group: 'Panes',
      shortcut: `Ctrl+${i + 1}`,
      hidden: true,
      run: () => ws().focusByIndex(i)
    })
  }

  return cmds
}

/** Run a command by id (used by the hotkey layer). */
export function runCommand(id: string): void {
  getCommands().find((c) => c.id === id)?.run()
}
