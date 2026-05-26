import { forwardRef, useEffect, useState } from 'react'
import { Mosaic, MosaicWindow } from 'react-mosaic-component'
import type { MosaicNode } from 'react-mosaic-component'
import { getLeaves } from '@renderer/lib/mosaicTree'

/** Minimum percentage either side of a split may occupy (prevents tiny panes). */
const MIN_SPLIT_PCT = 20

function clampSplits(node: MosaicNode<string> | null): MosaicNode<string> | null {
  if (node === null || typeof node === 'string') return node
  const pct = node.splitPercentage ?? 50
  return {
    ...node,
    splitPercentage: Math.max(MIN_SPLIT_PCT, Math.min(100 - MIN_SPLIT_PCT, pct)),
    first: clampSplits(node.first) as MosaicNode<string>,
    second: clampSplits(node.second) as MosaicNode<string>
  }
}
import { Bot, Terminal, SquareDashed, Send, Columns2, Rows2, X, History, Copy, GripVertical, Radio } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import { useBroadcastStore } from '@renderer/store/broadcast'
import { usePaneStatus, type PaneStatus } from '@renderer/store/paneStatus'
import { useUi } from '@renderer/store/ui'
import { useTokens, formatTokens } from '@renderer/store/tokens'
import { useSessions } from '@renderer/store/sessions'
import { toast } from '@renderer/store/toasts'
import { getFullText, getScreenText } from '@renderer/lib/terminalPool'
import { answerBlocks } from '@renderer/hooks/useChainForwarding'
import { AGENTS, AGENT_LABELS } from '@shared/providers'
import { getAvailableAgents, refreshAgentAvailability } from '@renderer/lib/agents'
import { getShellSpecs, refreshWslDistros, type ShellSpec } from '@renderer/lib/shells'
import PaneView from './PaneView'
import { AgentLogo, ShellLogo } from './brandIcons'
import 'react-mosaic-component/react-mosaic-component.css'

function relTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function PaneIcon({ paneId, size = 14 }: { paneId: string; size?: number }): JSX.Element {
  const type = useWorkspace((s) => s.panes[paneId]?.type)
  const command = useWorkspace((s) => s.panes[paneId]?.agent?.command)
  const shell = useWorkspace((s) => s.panes[paneId]?.shell?.shell)
  const args = useWorkspace((s) => s.panes[paneId]?.shell?.args)
  if (type === 'ai') return <AgentLogo command={command ?? 'claude'} size={size} />
  if (type === 'shell') return <ShellLogo shell={shell} args={args} size={size} />
  return <SquareDashed size={size} className="pane-icon" />
}

const STATUS_LABEL: Record<PaneStatus, string> = {
  working: 'Working',
  awaiting: 'Awaiting',
  idle: 'Idle'
}

/** Colored dot showing an AI pane's turn status (Working / Awaiting / Idle). */
function AgentStatusDot({ paneId }: { paneId: string }): JSX.Element {
  const status = usePaneStatus((s) => s.status[paneId]) ?? 'idle'
  return (
    <span
      className={clsx('agent-stat-dot', `is-${status}`)}
      title={`Agent: ${STATUS_LABEL[status]}`}
    />
  )
}

function PaneStatus({ paneId }: { paneId: string }): JSX.Element | null {
  const pane = useWorkspace((s) => s.panes[paneId])
  if (!pane) return null
  if (pane.type === 'shell') {
    if (!pane.shell?.ptyId) return <span className="pane-loading" title="Connecting…" />
    const name = pane.shell.shell.split(/[\\/]/).pop()?.replace(/\.exe$/i, '')
    return <span className="pane-status">{name}</span>
  }
  return null
}

/**
 * Slim, custom replacement for the default mosaic toolbar (also the drag handle).
 * Must forward a ref to a native element: react-mosaic attaches the React-DnD
 * drag-source ref to whatever `renderToolbar` returns.
 */
const PaneHeader = forwardRef<HTMLDivElement, { paneId: string }>(function PaneHeader(
  { paneId },
  ref
): JSX.Element {
  const title = useWorkspace((s) => s.panes[paneId]?.title ?? paneId)
  const linked = useWorkspace((s) => !!s.panes[paneId]?.telegramChatId)
  const activePaneId = useWorkspace((s) => s.activePaneId)
  const paneType = useWorkspace((s) => s.panes[paneId]?.type)
  const layout = useWorkspace((s) => s.layout)
  const paneCount = useWorkspace((s) => Object.keys(s.panes).length)
  const leaves = getLeaves(layout)
  const paneNum = leaves.indexOf(paneId) + 1  // 1-based; 0 = not in layout yet
  const agentCwd = useWorkspace((s) => s.panes[paneId]?.agent?.cwd)
  const shellCwd = useWorkspace((s) => s.panes[paneId]?.shell?.cwd)
  const isActive = useTokens((s) => !!s.activePanes[paneId])
  const tokenCount = useTokens((s) => s.byPane[paneId] ?? 0)
  const broadcastOn = useBroadcastStore((s) => s.enabled)
  const isBroadcastSource = useWorkspace((s) => s.activePaneId === paneId)
  const isBroadcastMember = useBroadcastStore((s) => s.members.includes(paneId))
  const inBroadcast = broadcastOn && (isBroadcastSource || isBroadcastMember)
  const updatePane = useWorkspace((s) => s.updatePane)
  const duplicatePane = useWorkspace((s) => s.duplicatePane)
  const removePane = useWorkspace((s) => s.removePane)
  const openTerminalHere = useWorkspace((s) => s.openTerminalHere)
  const openAgentHere = useWorkspace((s) => s.openAgentHere)
  const setActive = useWorkspace((s) => s.setActive)
  const setLinkingPaneId = useUi((s) => s.setLinkingPaneId)
  const setDraggingPane = useUi((s) => s.setDraggingPane)
  const toggleZoom = useUi((s) => s.toggleZoom)
  // Only show the "move to workspace" grip when there's somewhere to move to.
  const hasOtherWorkspaces = useWorkspaces((s) => s.list.length > 1)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(title)

  const commit = (): void => {
    const v = draft.trim()
    if (v) updatePane(paneId, { title: v })
    setEditing(false)
  }
  const startEdit = (): void => {
    setDraft(title)
    setEditing(true)
  }

  const close = (): void => {
    window.api.linkPaneToTelegram(paneId, null)
    removePane(paneId)
  }

  // Copy the agent's last answer block to the clipboard. Falls back to the
  // visible screen text for agents whose output isn't in ● answer blocks.
  const copyLastResult = (): void => {
    const blocks = answerBlocks(getFullText(paneId))
    const last = blocks.length ? blocks[blocks.length - 1] : getScreenText(paneId).trim()
    if (!last) {
      toast('No result to copy yet', 'info')
      return
    }
    void navigator.clipboard
      .writeText(last)
      .then(() => toast('Copied last result', 'ok'))
      .catch(() => toast('Copy failed', 'error'))
  }

  const stop = (e: React.MouseEvent): void => e.stopPropagation()

  return (
    <div
      ref={ref}
      className={clsx('pane-header', activePaneId === paneId && 'active')}
      onMouseDown={() => setActive(paneId)}
      // double-click the header's empty space to maximize the pane, again to restore
      onDoubleClick={() => toggleZoom(paneId)}
      onAuxClick={(e) => {
        // middle-click anywhere on the header (like a browser tab) closes it
        if (e.button === 1) {
          e.preventDefault()
          close()
        }
      }}
    >
      {paneCount >= 2 && paneNum > 0 && (
        <span className="pane-num" title={`Pane ${paneNum}`}>{paneNum}</span>
      )}
      <PaneIcon paneId={paneId} />
      {paneType === 'ai' && <AgentStatusDot paneId={paneId} />}
      {editing ? (
        <input
          className="pane-title-edit"
          autoFocus
          value={draft}
          onMouseDown={stop}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      ) : (
        <span
          className="pane-title"
          title="Double-click to rename"
          onDoubleClick={(e) => {
            e.stopPropagation()
            startEdit()
          }}
        >
          {title}
        </span>
      )}
      {paneType === 'ai' && agentCwd && (
        <>
          <span className={clsx('pane-cwd', isActive && 'active')} title={agentCwd}>
            {agentCwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || agentCwd}
          </span>
          {tokenCount > 0 && (
            <span className="pane-tok">~{formatTokens(tokenCount)}</span>
          )}
        </>
      )}
      {inBroadcast && (
        <span
          className="pane-broadcast-tag"
          title={isBroadcastSource ? 'Broadcast source' : 'Receives broadcast input'}
        >
          <Radio size={11} />
          {isBroadcastSource ? 'src' : 'bc'}
        </span>
      )}
      <PaneStatus paneId={paneId} />
      <div className="pane-header-spacer" />
      <div className="pane-controls" onMouseDown={stop} onDoubleClick={stop}>
        {hasOtherWorkspaces && (
          <button
            className="icon-btn pane-move-grip"
            title="Drag to another workspace tab to move this pane"
            draggable
            onDragStart={(e) => {
              // Shield the native drag from react-mosaic's own drag source on the header.
              e.stopPropagation()
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData('text/plain', title)
              setDraggingPane(paneId)
            }}
            onDragEnd={() => setDraggingPane(null)}
          >
            <GripVertical size={13} />
          </button>
        )}
        {paneType === 'ai' && agentCwd && (
          <button
            className="icon-btn"
            title="Copy last result"
            onClick={copyLastResult}
          >
            <Copy size={13} />
          </button>
        )}
        {paneType === 'ai' && agentCwd && (
          <button
            className="icon-btn"
            title={`Open terminal here · Ctrl+Shift+C\n${agentCwd}`}
            onClick={() => openTerminalHere(paneId)}
          >
            <Terminal size={13} />
          </button>
        )}
        {paneType === 'shell' && (
          <button
            className="icon-btn"
            title={`Open agent in this folder${shellCwd ? `\n${shellCwd}` : ' (home)'}`}
            onClick={() => openAgentHere(paneId)}
          >
            <Bot size={13} />
          </button>
        )}
        <button
          className={clsx('icon-btn', linked && 'linked')}
          title="Link to Telegram"
          onClick={() => setLinkingPaneId(paneId)}
        >
          <Send size={13} />
        </button>
        <button
          className="icon-btn"
          title={paneCount >= 9 ? 'Max 9 panes reached' : 'Split right (duplicate session)'}
          disabled={paneCount >= 9}
          onClick={() => duplicatePane(paneId, 'row')}
        >
          <Columns2 size={13} />
        </button>
        <button
          className="icon-btn"
          title={paneCount >= 9 ? 'Max 9 panes reached' : 'Split down (duplicate session)'}
          disabled={paneCount >= 9}
          onClick={() => duplicatePane(paneId, 'column')}
        >
          <Rows2 size={13} />
        </button>
        <button className="icon-btn danger" title="Close (Ctrl+W)" onClick={close}>
          <X size={13} />
        </button>
      </div>
    </div>
  )
})

export default function Workspace(): JSX.Element {
  const layout = useWorkspace((s) => s.layout)
  const setLayout = useWorkspace((s) => s.setLayout)
  const panes = useWorkspace((s) => s.panes)
  const addPane = useWorkspace((s) => s.addPane)
  const zoomedPaneId = useUi((s) => s.zoomedPaneId)
  const setZoomedPaneId = useUi((s) => s.setZoomedPaneId)
  const sessions = useSessions((s) => s.sessions)
  const restore = useSessions((s) => s.restore)

  // Device-installed agents + shells/WSL distros, detected asynchronously.
  const [availAgents, setAvailAgents] = useState<Set<string>>(getAvailableAgents())
  const [shellSpecs, setShellSpecs] = useState<ShellSpec[]>(getShellSpecs())
  useEffect(() => {
    void refreshAgentAvailability().then((s) => setAvailAgents(new Set(s)))
    void refreshWslDistros().then(() => setShellSpecs(getShellSpecs()))
  }, [])

  if (layout === null) {
    const recentSessions = sessions.slice(0, 4)
    const agentList = availAgents.size ? AGENTS.filter((a) => availAgents.has(a)) : [...AGENTS]
    return (
      <div className="workspace-empty">
        <div className="empty-hero">
          <div className="empty-icon-wrap">
            <Bot size={28} strokeWidth={1.3} />
          </div>
          <h2 className="empty-title">URterminal</h2>
          <p className="empty-sub">AI agent + shell workspace</p>
        </div>
        <div className="empty-actions">
          <button className="empty-action-card agent" onClick={() => addPane('ai')}>
            <Bot size={18} strokeWidth={1.4} className="eac-icon" />
            <span className="eac-label">Agent</span>
            <span className="eac-hint">Claude Code session</span>
            <span className="eac-key">Ctrl+Shift+A</span>
          </button>
          <button className="empty-action-card shell" onClick={() => addPane('shell')}>
            <Terminal size={18} strokeWidth={1.4} className="eac-icon" />
            <span className="eac-label">Shell</span>
            <span className="eac-hint">Interactive terminal</span>
            <span className="eac-key">Ctrl+Shift+S</span>
          </button>
        </div>

        <div className="empty-discover">
          <div className="empty-disc-group">
            <div className="empty-disc-title">Agents on this device</div>
            <div className="empty-chips">
              {agentList.map((a) => (
                <button
                  key={a}
                  className="empty-chip"
                  title={`New ${AGENT_LABELS[a]} pane`}
                  onClick={() => addPane('ai', undefined, { agentCommand: a, label: AGENT_LABELS[a] })}
                >
                  <AgentLogo command={a} size={15} />
                  {AGENT_LABELS[a]}
                </button>
              ))}
            </div>
          </div>

          <div className="empty-disc-group">
            <div className="empty-disc-title">Shells &amp; WSL distros</div>
            <div className="empty-chips">
              {shellSpecs.map((spec) => (
                <button
                  key={spec.id}
                  className="empty-chip"
                  title={`New ${spec.label}`}
                  onClick={() =>
                    addPane('shell', undefined, {
                      shell: spec.file,
                      shellArgs: spec.args,
                      label: spec.label
                    })
                  }
                >
                  <ShellLogo shell={spec.file} args={spec.args} size={15} />
                  {spec.label}
                </button>
              ))}
            </div>
          </div>

          <div className="empty-disc-group">
            <div className="empty-disc-title">Things you can do</div>
            <ul className="empty-tips">
              <li>Split & tile up to 9 panes — drag borders to resize</li>
              <li>Link any pane to Telegram, or screenshot it with <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd></li>
              <li>Open an agent in a shell's folder (and vice-versa) from the pane header</li>
              <li>Save & restore whole workspaces as sessions</li>
            </ul>
          </div>
        </div>

        {recentSessions.length > 0 && (
          <div className="empty-sessions">
            <div className="es-header">
              <History size={13} />
              <span>Recent sessions</span>
            </div>
            <div className="es-list">
              {recentSessions.map(s => (
                <button
                  key={s.id}
                  className="es-row"
                  onClick={() => { restore(s.id); toast(`Restored: ${s.name}`, 'ok') }}
                >
                  <span className="es-name">{s.name}</span>
                  <span className="es-meta">{s.paneCount} pane{s.paneCount !== 1 ? 's' : ''} · {relTime(s.savedAt)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="empty-footer">
          <span><kbd>Ctrl</kbd>+<kbd>K</kbd> command palette</span>
        </div>
      </div>
    )
  }

  // Zoom: render only the focused pane, full-bleed.
  if (zoomedPaneId && panes[zoomedPaneId]) {
    return (
      <div className="zoom-host">
        <div className="zoom-pane">
          <PaneHeader paneId={zoomedPaneId} />
          <div className="zoom-body pane-capture" data-pane-id={zoomedPaneId}>
            <PaneView paneId={zoomedPaneId} />
          </div>
        </div>
        <button className="zoom-exit btn sm" onClick={() => setZoomedPaneId(null)}>
          Exit zoom · Esc
        </button>
      </div>
    )
  }

  return (
    <Mosaic<string>
      className="mosaic-urterminal"
      value={layout}
      onChange={(node: MosaicNode<string> | null) => setLayout(clampSplits(node))}
      renderTile={(id, path) => (
        <MosaicWindow<string>
          path={path}
          title={panes[id]?.title ?? id}
          renderToolbar={() => (
            <div className="pane-header-host">
              <PaneHeader paneId={id} />
            </div>
          )}
        >
          <div className="pane-capture" data-pane-id={id}>
            <PaneView paneId={id} />
          </div>
        </MosaicWindow>
      )}
    />
  )
}
