import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, RefreshCw, X } from 'lucide-react'
import type { Pane } from '@shared/types'
import { DEFAULT_AGENT } from '@shared/providers'
import { useWorkspace } from '@renderer/store/workspace'
import { getLastAgentCwd, setLastAgentCwd } from '@renderer/lib/agentPrefs'
import { isTerminalStarted } from '@renderer/lib/terminalPool'
import TerminalPane from './TerminalPane'
import AgentLauncher from './AgentLauncher'

/**
 * The "AI pane" launches an agent CLI (default: claude) directly in a chosen
 * folder — no shell prompt, no typing. A small launcher form picks the folder
 * first (prefilled with the last-used one for one-click reopen).
 */
export default function AiPane({ pane }: { pane: Pane }): JSX.Element {
  const updatePane = useWorkspace((s) => s.updatePane)
  const removePane = useWorkspace((s) => s.removePane)
  const command = pane.agent?.command ?? DEFAULT_AGENT
  const cwd = pane.agent?.cwd

  // The CLI is "started" once it prints its first output. Until then (with a
  // folder chosen) we show a loader instead of a blank pane. Re-mounts after
  // zoom report started=true immediately, so no loader flashes.
  const [started, setStarted] = useState(() => isTerminalStarted(pane.id))
  const [bootFailed, setBootFailed] = useState(false)
  const booting = !!cwd && !started

  // Safety net: never let the loader hang forever if the CLI is silent.
  useEffect(() => {
    if (!cwd || started) return
    const t = window.setTimeout(() => setBootFailed(true), 12000)
    return () => window.clearTimeout(t)
  }, [cwd, started])

  if (!cwd) {
    return (
      <AgentLauncher
        command={command}
        defaultCwd={getLastAgentCwd()}
        onOpen={(dir) => {
          setLastAgentCwd(dir)
          updatePane(pane.id, { agent: { command, cwd: dir }, title: command })
        }}
      />
    )
  }

  return (
    <div className="agent-pane">
      {booting && !bootFailed && (
        <div className="agent-booting">
          <Loader2 size={26} className="spin" />
          <div className="booting-text">
            Launching <b>{command}</b>…
          </div>
          <div className="booting-path">{cwd}</div>
        </div>
      )}
      {bootFailed && (
        <div className="agent-booting agent-boot-error">
          <AlertCircle size={26} className="boot-error-icon" />
          <div className="booting-text">Agent did not respond</div>
          <div className="booting-path">{cwd}</div>
          <div className="boot-error-actions">
            <button className="btn" onClick={() => { setBootFailed(false); setStarted(true) }}>
              <RefreshCw size={13} /> Continue anyway
            </button>
            <button className="btn danger" onClick={() => removePane(pane.id)}>
              <X size={13} /> Close pane
            </button>
          </div>
        </div>
      )}
      <TerminalPane
        paneId={pane.id}
        command={command}
        cwd={cwd}
        onReady={(ptyId) => updatePane(pane.id, { agent: { command, cwd, ptyId } })}
        onExit={() => removePane(pane.id)}
        onStarted={() => setStarted(true)}
      />
    </div>
  )
}
