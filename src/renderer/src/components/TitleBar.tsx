import { useEffect, useRef, useState } from 'react'
import { Plus, X, Layers, Save } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { useWorkspaces } from '@renderer/store/workspaces'
import type { WorkspaceEntry } from '@renderer/store/workspaces'
import { useUi } from '@renderer/store/ui'
import { useSettings } from '@renderer/store/settings'
import { spawnTemplate, removeTemplate } from '@renderer/lib/templates'
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
  const movePanesTo = useWorkspaces((s) => s.movePanesTo)
  const canClose = useWorkspaces((s) => s.list.length > 1)
  const badge = useWorkspaces((s) => s.badges[ws.id] ?? 0)
  const draggingPaneIds = useUi((s) => s.draggingPaneIds)
  const setDraggingPanes = useUi((s) => s.setDraggingPanes)
  // Panes can be dropped here only when a drag is in progress and this isn't
  // the workspace they already live in.
  const canDrop = !!draggingPaneIds && !active

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
        if (!draggingPaneIds) return
        // Capture the drop even for the active tab so it can't bubble up to the
        // title bar's "new workspace" catch-all (dropping on an existing
        // workspace must never spawn a new one).
        e.preventDefault()
        e.dataTransfer.dropEffect = canDrop ? 'move' : 'none'
        if (canDrop && !dropOver) setDropOver(true)
      }}
      onDragLeave={() => setDropOver(false)}
      onDrop={(e) => {
        if (!draggingPaneIds) return
        e.preventDefault()
        e.stopPropagation()
        setDropOver(false)
        if (canDrop) movePanesTo(draggingPaneIds, ws.id)
        setDraggingPanes(null)
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
          {!active && badge > 0 && (
            <span className="ws-tab-badge" title={`${badge} finished here`}>
              {badge > 99 ? '99+' : badge}
            </span>
          )}
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
  const movePanesTo = useWorkspaces((s) => s.movePanesTo)
  const movePanesToNew = useWorkspaces((s) => s.movePanesToNew)
  const draggingPaneIds = useUi((s) => s.draggingPaneIds)
  const setDraggingPanes = useUi((s) => s.setDraggingPanes)
  const badges = useWorkspaces((s) => s.badges)
  const canCloseWorkspace = list.length > 1
  const templates = useSettings((s) => s.settings?.prefs.templates ?? [])
  const activePaneId = useWorkspace((s) => s.activePaneId)
  const setSavingTemplatePaneId = useUi((s) => s.setSavingTemplatePaneId)

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
  const overflowBadgeTotal = overflowList.reduce((n, w) => n + (badges[w.id] ?? 0), 0)

  return (
    <header
      className="titlebar"
      // Catch-all: dropping dragged panes anywhere on the title bar that isn't an
      // existing workspace tab moves them into a brand-new workspace.
      onDragOver={(e) => {
        if (!draggingPaneIds) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        if (!draggingPaneIds) return
        e.preventDefault()
        movePanesToNew(draggingPaneIds)
        setDraggingPanes(null)
      }}
    >
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

        <div className="titlebar-sep" />

        {/* Pane templates — one click to spawn a saved agent/shell config */}
        <HoverDropdown
          trigger={
            <button className="icon-btn agent-icon-btn" title="Pane templates">
              <Layers size={15} />
            </button>
          }
        >
          <>
            {templates.length === 0 && (
              <div className="hover-dd-item" style={{ opacity: 0.6, cursor: 'default' }}>
                No templates yet
              </div>
            )}
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="hover-dd-item"
                onClick={() => spawnTemplate(tpl)}
                title={tpl.type === 'ai' ? tpl.agentCommand : tpl.shell}
              >
                <span className="hover-dd-item-name">
                  {tpl.type === 'ai' ? '🤖' : '🖥'} {tpl.name}
                </span>
                <button
                  className="hover-dd-item-close"
                  title="Delete template"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeTemplate(tpl.id)
                  }}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
            <div className="hover-dd-sep" />
            <div
              className={clsx('hover-dd-item', !activePaneId && 'disabled')}
              onClick={() => activePaneId && setSavingTemplatePaneId(activePaneId)}
            >
              <Save size={12} />
              <span className="hover-dd-item-name">Save active pane…</span>
            </div>
          </>
        </HoverDropdown>
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
                {overflowBadgeTotal > 0 && (
                  <span className="ws-tab-badge ws-more-badge">
                    {overflowBadgeTotal > 99 ? '99+' : overflowBadgeTotal}
                  </span>
                )}
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
                    draggingPaneIds && w.id !== activeId && 'drop-ok'
                  )}
                  onClick={() => switchTo(w.id)}
                  onAuxClick={(e) => {
                    if (e.button === 1) {
                      e.preventDefault()
                      removeWorkspace(w.id)
                    }
                  }}
                  onDragOver={(e) => {
                    if (!draggingPaneIds) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = w.id === activeId ? 'none' : 'move'
                  }}
                  onDrop={(e) => {
                    if (!draggingPaneIds) return
                    e.preventDefault()
                    e.stopPropagation()
                    if (w.id !== activeId) movePanesTo(draggingPaneIds, w.id)
                    setDraggingPanes(null)
                  }}
                >
                  <span className="hover-dd-item-name">{w.name}</span>
                  {w.id !== activeId && (badges[w.id] ?? 0) > 0 && (
                    <span className="ws-tab-badge">
                      {(badges[w.id] ?? 0) > 99 ? '99+' : badges[w.id]}
                    </span>
                  )}
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
        {draggingPaneIds ? (
          <div
            className="ws-new-drop"
            title="Drop here to move into a new workspace"
            onDragOver={(e) => {
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              movePanesToNew(draggingPaneIds)
              setDraggingPanes(null)
            }}
          >
            <Plus size={11} />
            <span>New workspace</span>
          </div>
        ) : (
          <button className="ws-add-btn" title="New workspace" onClick={addWorkspace}>
            <Plus size={11} />
          </button>
        )}
        {/* Sessions = saved workspace snapshots → grouped with the workspace tabs */}
        <SessionsMenu />
      </div>

      <div className="titlebar-drag" />
    </header>
  )
}
