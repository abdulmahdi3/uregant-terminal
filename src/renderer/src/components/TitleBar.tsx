import { useState } from 'react'
import { Bot, Terminal, Settings, Command as CommandIcon, Layers, X } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { useUi } from '@renderer/store/ui'
import { useWorkspaces } from '@renderer/store/workspaces'
import type { WorkspaceEntry } from '@renderer/store/workspaces'

const MAX_TABS = 4

function WorkspaceTab({ ws, active }: { ws: WorkspaceEntry; active: boolean }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(ws.name)
  const rename = useWorkspaces((s) => s.rename)
  const switchTo = useWorkspaces((s) => s.switchTo)
  const remove = useWorkspaces((s) => s.remove)
  const canClose = useWorkspaces((s) => s.list.length > 1)

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
      className={clsx('ws-tab', active && 'active')}
      onClick={() => !active && switchTo(ws.id)}
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
  const setShowSettings = useUi((s) => s.setShowSettings)
  const togglePalette = useUi((s) => s.toggleCommandPalette)
  const list = useWorkspaces((s) => s.list)
  const activeId = useWorkspaces((s) => s.activeId)
  const addWorkspace = useWorkspaces((s) => s.add)
  const switchTo = useWorkspaces((s) => s.switchTo)

  const visibleList = list.slice(0, MAX_TABS)
  const overflowList = list.slice(MAX_TABS)
  const activeInOverflow = overflowList.some((w) => w.id === activeId)

  return (
    <header className="titlebar">
      <div className="titlebar-left" data-nodrag>
        <Terminal size={15} className="brand-icon" />
        <span className="brand-name">uregant</span>

        <div className="titlebar-sep" />

        <button className="icon-btn" title="Command palette (Ctrl+K)" onClick={togglePalette}>
          <CommandIcon size={14} />
        </button>
        <button className="icon-btn" title="Settings (Ctrl+,)" onClick={() => setShowSettings(true)}>
          <Settings size={14} />
        </button>

        <div className="titlebar-sep" />

        <button className="action-btn agent-btn" title="New agent pane" onClick={() => addPane('ai')}>
          <Bot size={13} />
        </button>
        <button className="action-btn shell-btn" title="New shell pane" onClick={() => addPane('shell')}>
          <Terminal size={13} />
        </button>
        <button className="action-btn ws-btn" title="New workspace" onClick={addWorkspace}>
          <Layers size={13} />
        </button>
      </div>

      <div className="titlebar-drag" />

      <div className="titlebar-workspaces" data-nodrag>
        {visibleList.map((w) => (
          <WorkspaceTab key={w.id} ws={w} active={w.id === activeId} />
        ))}
        {overflowList.length > 0 && (
          <div className="ws-overflow-wrap">
            <button
              className={clsx('ws-more-btn', activeInOverflow && 'has-active')}
              title={`${overflowList.length} more workspace${overflowList.length !== 1 ? 's' : ''} — hover to see`}
            >
              ···
            </button>
            <div className="ws-overflow-menu">
              {overflowList.map((w) => (
                <div
                  key={w.id}
                  className={clsx('ws-overflow-item', w.id === activeId && 'active')}
                  onClick={() => switchTo(w.id)}
                >
                  {w.name}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
