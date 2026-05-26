import { useEffect, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import type { WorkspaceEntry } from '@renderer/store/workspaces'
import { useUi } from '@renderer/store/ui'
import { AGENTS, AGENT_LABELS } from '@shared/providers'
import { getAvailableAgents, refreshAgentAvailability } from '@renderer/lib/agents'
import { getShellSpecs, refreshWslDistros, type ShellSpec } from '@renderer/lib/shells'
import { AgentLogo, ShellLogo } from './brandIcons'
import SessionsMenu from './SessionsMenu'
import logoPng from '@renderer/assets/logo.png'

function AppLogo(): JSX.Element {
  return <img src={logoPng} width={16} height={16} className="brand-logo" alt="URterminal" />
}

/**
 * Hover-to-open dropdown. Uses a short close delay (not pure CSS :hover) so the
 * mouse can cross the gap to the menu without it vanishing, and items stay
 * clickable. Closes on item click.
 */
function HoverDropdown({
  trigger,
  children,
  align = 'left'
}: {
  trigger: JSX.Element
  children: JSX.Element
  align?: 'left' | 'center'
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const show = (): void => {
    if (timer.current) window.clearTimeout(timer.current)
    setOpen(true)
  }
  const hide = (): void => {
    timer.current = window.setTimeout(() => setOpen(false), 160)
  }
  return (
    <div
      className="hover-dd"
      onMouseEnter={show}
      onMouseLeave={hide}
      // Dragging a pane over the trigger opens the menu so it can be dropped on
      // a workspace listed inside (overflow tabs aren't visible otherwise).
      onDragEnter={show}
      onDragOver={show}
      onDragLeave={hide}
    >
      {trigger}
      {open && (
        <div
          className={clsx('hover-dd-menu', align === 'center' && 'center')}
          onMouseEnter={show}
          onMouseLeave={hide}
          onDragEnter={show}
          onDragOver={show}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  )
}

const MAX_TABS = 4

function WorkspaceTab({ ws, active }: { ws: WorkspaceEntry; active: boolean }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(ws.name)
  const [dropOver, setDropOver] = useState(false)
  const rename = useWorkspaces((s) => s.rename)
  const switchTo = useWorkspaces((s) => s.switchTo)
  const remove = useWorkspaces((s) => s.remove)
  const movePaneTo = useWorkspaces((s) => s.movePaneTo)
  const canClose = useWorkspaces((s) => s.list.length > 1)
  const draggingPaneId = useUi((s) => s.draggingPaneId)
  const setDraggingPane = useUi((s) => s.setDraggingPane)
  // A pane can be dropped here only when one is being dragged and this isn't
  // the workspace it already lives in.
  const canDrop = !!draggingPaneId && !active

  const commit = (): void => {
    const v = draft.trim()
    rename(ws.id, v || ws.name)
    setDraft(v || ws.name)
    setEditing(false)
  }

  const startEdit = (e: React.MouseEvent): void => {
    e.stopPropagation()
    setDraft(ws.name)
    setEditing(true)
  }

  const close = (e: React.MouseEvent): void => {
    e.stopPropagation()
    remove(ws.id)
  }

  return (
    <div
      className={clsx('ws-tab', active && 'active', canDrop && 'drop-ok', dropOver && 'drop-over')}
      onClick={() => !active && switchTo(ws.id)}
      onAuxClick={(e) => {
        if (e.button === 1) { e.preventDefault(); remove(ws.id) }
      }}
      onDragOver={(e) => {
        if (!canDrop) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!dropOver) setDropOver(true)
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => {
        if (!canDrop) return
        e.preventDefault()
        setDropOver(false)
        if (draggingPaneId) movePaneTo(draggingPaneId, ws.id)
        setDraggingPane(null)
      }}
    >
      {editing ? (
        <input
          className="ws-tab-input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') { setDraft(ws.name); setEditing(false) }
          }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <>
          <span
            className="ws-tab-name"
            onClick={active ? startEdit : undefined}
            title={active ? 'Click to rename' : ws.name}
          >
            {ws.name}
          </span>
          {canClose && (
            <button
              className="ws-tab-close"
              onClick={close}
              onMouseDown={(e) => e.stopPropagation()}
              title="Close workspace"
            >
              <X size={10} />
            </button>
          )}
        </>
      )}
    </div>
  )
}

export default function TitleBar(): JSX.Element {
  const addPane = useWorkspace((s) => s.addPane)
  const paneCount = useWorkspace((s) => Object.keys(s.panes).length)
  const atMax = paneCount >= 9
  const list = useWorkspaces((s) => s.list)
  const activeId = useWorkspaces((s) => s.activeId)
  const addWorkspace = useWorkspaces((s) => s.add)
  const switchTo = useWorkspaces((s) => s.switchTo)
  const removeWorkspace = useWorkspaces((s) => s.remove)
  const movePaneTo = useWorkspaces((s) => s.movePaneTo)
  const draggingPaneId = useUi((s) => s.draggingPaneId)
  const setDraggingPane = useUi((s) => s.setDraggingPane)
  const canCloseWorkspace = list.length > 1

  // Installed agents + all shells (incl. WSL distros), detected asynchronously.
  const [available, setAvailable] = useState<Set<string>>(getAvailableAgents())
  const [shells, setShells] = useState<ShellSpec[]>(getShellSpecs())
  useEffect(() => {
    void refreshAgentAvailability().then((s) => setAvailable(new Set(s)))
    void refreshWslDistros().then(() => setShells(getShellSpecs()))
  }, [])
  // Show only installed agents in the menu; fall back to all before detection runs.
  const agentList = available.size ? AGENTS.filter((a) => available.has(a)) : [...AGENTS]

  let visibleList = list.slice(0, MAX_TABS)
  let overflowList = list.slice(MAX_TABS)
  const activeIdx = list.findIndex((w) => w.id === activeId)
  // Keep the active workspace visible: if it would be hidden in the overflow,
  // pull it into the last visible slot and push the displaced tab to the end of
  // the dropdown (so the active one is always seen directly, not in the menu).
  if (activeIdx >= MAX_TABS) {
    const activeWs = list[activeIdx]
    const displaced = list[MAX_TABS - 1]
    visibleList = [...list.slice(0, MAX_TABS - 1), activeWs]
    const visibleIds = new Set(visibleList.map((w) => w.id))
    overflowList = [...list.filter((w) => !visibleIds.has(w.id) && w.id !== displaced.id), displaced]
  }
  const activeInOverflow = overflowList.some((w) => w.id === activeId)

  return (
    <header className="titlebar">
      <div className="titlebar-left" data-nodrag>
        {/* Brand */}
        <AppLogo />
        <span className="brand-name">URterminal</span>

        <div className="titlebar-sep" />

        {/* Installed agents — one icon each, opens a new pane of that agent */}
        {agentList.map((a) => (
          <button
            key={a}
            className="icon-btn agent-icon-btn"
            title={atMax ? 'Max 9 panes reached' : `New ${AGENT_LABELS[a]} pane`}
            disabled={atMax}
            onClick={() => addPane('ai', undefined, { agentCommand: a, label: AGENT_LABELS[a] })}
          >
            <AgentLogo command={a} size={15} />
          </button>
        ))}

        <div className="titlebar-sep" />

        {/* Shells + WSL distros — one icon each, opens a new shell pane.
            (Admin PowerShell is offered in the empty-pane launcher, not here.) */}
        {shells
          .filter((spec) => spec.id !== 'powershell-admin')
          .map((spec) => (
          <button
            key={spec.id}
            className="icon-btn agent-icon-btn"
            title={atMax ? 'Max 9 panes reached' : `New ${spec.label}`}
            disabled={atMax}
            onClick={() =>
              addPane('shell', undefined, {
                shell: spec.file,
                shellArgs: spec.args,
                label: spec.label
              })
            }
          >
            <ShellLogo shell={spec.file} args={spec.args} size={15} />
          </button>
        ))}
      </div>

      <div className="titlebar-drag" />

      <div className="titlebar-workspaces" data-nodrag>
        {visibleList.map((w) => (
          <WorkspaceTab key={w.id} ws={w} active={w.id === activeId} />
        ))}
        {overflowList.length > 0 && (
          <HoverDropdown
            align="center"
            trigger={
              <button
                className={clsx('ws-more-btn', activeInOverflow && 'has-active')}
                title={`${overflowList.length} more workspace${overflowList.length !== 1 ? 's' : ''}`}
              >
                ···
              </button>
            }
          >
            <>
              {overflowList.map((w) => (
                <div
                  key={w.id}
                  className={clsx(
                    'hover-dd-item',
                    w.id === activeId && 'active',
                    draggingPaneId && w.id !== activeId && 'drop-ok'
                  )}
                  onClick={() => switchTo(w.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault()
                      removeWorkspace(w.id)
                    }
                  }}
                  onDragOver={(e) => {
                    if (!draggingPaneId || w.id === activeId) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => {
                    if (!draggingPaneId || w.id === activeId) return
                    e.preventDefault()
                    movePaneTo(draggingPaneId, w.id)
                    setDraggingPane(null)
                  }}
                >
                  <span className="hover-dd-item-name">{w.name}</span>
                  {canCloseWorkspace && (
                    <button
                      className="hover-dd-item-close"
                      title="Close workspace"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeWorkspace(w.id)
                      }}
                    >
                      <X size={11} />
                    </button>
                  )}
                </div>
              ))}
            </>
          </HoverDropdown>
        )}
        <button className="ws-add-btn" title="New workspace" onClick={addWorkspace}>
          <Plus size={11} />
        </button>
        {/* Sessions = saved workspace snapshots → grouped with the workspace tabs */}
        <SessionsMenu />
      </div>

      <div className="titlebar-drag" />
    </header>
  )
}
