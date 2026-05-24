import { forwardRef, useState } from 'react'
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
import { Bot, Terminal, SquareDashed, Send, Columns2, Rows2, X, Camera, History } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { useUi } from '@renderer/store/ui'
import { useTokens, formatTokens } from '@renderer/store/tokens'
import { useSessions } from '@renderer/store/sessions'
import { toast } from '@renderer/store/toasts'
import PaneView from './PaneView'
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
  if (type === 'ai') return <Bot size={size} className="pane-icon ai" />
  if (type === 'shell') return <Terminal size={size} className="pane-icon shell" />
  return <SquareDashed size={size} className="pane-icon" />
}

function PaneStatus({ paneId }: { paneId: string }): JSX.Element | null {
  const pane = useWorkspace((s) => s.panes[paneId])
  const isActive = useTokens((s) => !!s.activePanes[paneId])
  const tokenCount = useTokens((s) => s.byPane[paneId] ?? 0)

  if (!pane) return null
  if (pane.type === 'ai') {
    if (!pane.agent?.ptyId) return null
    return (
      <span className="pane-status streaming">
        <span className={clsx('pulse', !isActive && 'pulse-idle')} />
        live
        {tokenCount > 0 && (
          <span className="pane-tok">~{formatTokens(tokenCount)}</span>
        )}
      </span>
    )
  }
  if (pane.type === 'shell' && pane.shell?.shell) {
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
  const updatePane = useWorkspace((s) => s.updatePane)
  const duplicatePane = useWorkspace((s) => s.duplicatePane)
  const removePane = useWorkspace((s) => s.removePane)
  const openTerminalHere = useWorkspace((s) => s.openTerminalHere)
  const setActive = useWorkspace((s) => s.setActive)
  const setLinkingPaneId = useUi((s) => s.setLinkingPaneId)
  const toggleZoom = useUi((s) => s.toggleZoom)

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
        <span className="pane-cwd" title={agentCwd}>
          {agentCwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || agentCwd}
        </span>
      )}
      <PaneStatus paneId={paneId} />
      <div className="pane-header-spacer" />
      <div className="pane-controls" onMouseDown={stop} onDoubleClick={stop}>
        {paneType === 'ai' && agentCwd && (
          <button
            className="icon-btn"
            title={`Open terminal here · Ctrl+Shift+C\n${agentCwd}`}
            onClick={() => openTerminalHere(paneId)}
          >
            <Terminal size={13} />
          </button>
        )}
        <button
          className={clsx('icon-btn', linked && 'linked')}
          title="Link to Telegram"
          onClick={() => setLinkingPaneId(paneId)}
        >
          <Send size={13} />
        </button>
        {linked && (
          <button
            className="icon-btn"
            title="Screenshot this pane → Telegram"
            onClick={() => void window.api.screenshotPane(paneId)}
          >
            <Camera size={13} />
          </button>
        )}
        <button
          className="icon-btn"
          title="Split right (duplicate session)"
          onClick={() => duplicatePane(paneId, 'row')}
        >
          <Columns2 size={13} />
        </button>
        <button
          className="icon-btn"
          title="Split down (duplicate session)"
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

  if (layout === null) {
    const recentSessions = sessions.slice(0, 4)
    return (
      <div className="workspace-empty">
        <div className="empty-hero">
          <div className="empty-icon-wrap">
            <Bot size={28} strokeWidth={1.3} />
          </div>
          <h2 className="empty-title">urterminal</h2>
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
      className="mosaic-uregant"
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
