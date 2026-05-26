import { create } from 'zustand'
import type { MosaicNode } from 'react-mosaic-component'
import type { Pane } from '@shared/types'
import { getLeaves } from '@renderer/lib/mosaicTree'
import { buildAutoLayout } from '@renderer/lib/layoutPresets'
import { repaintTerminal } from '@renderer/lib/terminalPool'
import { useWorkspace } from './workspace'

const uid = (): string => Math.random().toString(36).slice(2, 10)

export interface WorkspaceEntry {
  id: string
  name: string
  panes?: Record<string, Pane>
  layout?: MosaicNode<string> | null
}

interface WorkspacesState {
  list: WorkspaceEntry[]
  activeId: string
  _counter: number
  /** unread "agent/terminal finished" counts per background workspace */
  badges: Record<string, number>
  /** increment the done-badge for a workspace (ignored for the active one) */
  bumpBadge: (id: string) => void
  rename: (id: string, name: string) => void
  add: () => void
  switchTo: (id: string) => void
  remove: (id: string) => void
  /** move a pane out of the active workspace into another one, then open it there */
  movePaneTo: (paneId: string, targetId: string) => void
  /** move several panes into an existing workspace, then open it there */
  movePanesTo: (paneIds: string[], targetId: string) => void
  /** move several panes into a brand-new workspace, then open it */
  movePanesToNew: (paneIds: string[]) => void
}

const firstId = uid()

export const useWorkspaces = create<WorkspacesState>((set, get) => ({
  list: [{ id: firstId, name: 'URterminal' }],
  activeId: firstId,
  _counter: 0,
  badges: {},

  bumpBadge: (id) =>
    set((s) => {
      if (id === s.activeId) return s
      return { badges: { ...s.badges, [id]: (s.badges[id] ?? 0) + 1 } }
    }),

  rename: (id, name) =>
    set((s) => ({ list: s.list.map((w) => (w.id === id ? { ...w, name } : w)) })),

  add: () => {
    const ws = useWorkspace.getState()
    const { list, activeId, _counter } = get()
    const savedList = list.map((w) =>
      w.id === activeId ? { ...w, panes: { ...ws.panes }, layout: ws.layout } : w
    )
    const newId = uid()
    const next = _counter + 1
    ws.hydrate({}, null)
    set({ list: [...savedList, { id: newId, name: `Workspace ${next}` }], activeId: newId, _counter: next })
  },

  switchTo: (id) => {
    const { list, activeId } = get()
    if (id === activeId) return
    const ws = useWorkspace.getState()
    const savedList = list.map((w) =>
      w.id === activeId ? { ...w, panes: { ...ws.panes }, layout: ws.layout } : w
    )
    const target = savedList.find((w) => w.id === id)
    ws.hydrate(target?.panes ?? {}, target?.layout ?? null)
    set((s) => ({ list: savedList, activeId: id, badges: { ...s.badges, [id]: 0 } }))
    // The target's terminals get re-parented into freshly mounted containers;
    // xterm renders blank after a re-parent, so repaint each across a couple of
    // frames (otherwise switching into a background workspace looks empty).
    for (const pid of getLeaves(target?.layout ?? null)) repaintTerminal(pid)
  },

  remove: (id) => {
    const { list, activeId } = get()
    // Last workspace: clear its content but keep the tab
    if (list.length <= 1) {
      if (id === activeId) useWorkspace.getState().hydrate({}, null)
      return
    }
    const remaining = list.filter((w) => w.id !== id)
    if (id === activeId) {
      const ws = useWorkspace.getState()
      const idx = list.findIndex((w) => w.id === id)
      const next = remaining[Math.max(0, idx - 1)]
      ws.hydrate(next?.panes ?? {}, next?.layout ?? null)
      set({ list: remaining, activeId: next.id })
      for (const pid of getLeaves(next?.layout ?? null)) repaintTerminal(pid)
    } else {
      set({ list: remaining })
    }
  },

  movePaneTo: (paneId, targetId) => {
    const { activeId, list } = get()
    if (targetId === activeId) return
    const ws = useWorkspace.getState()
    const pane = ws.panes[paneId]
    if (!pane) return
    // Detach from the active workspace WITHOUT disposing the terminal, so the
    // running CLI + scrollback survive the move (the pool is keyed by pane id).
    ws.detachPane(paneId)
    // Append into the target workspace's saved snapshot, rebuilding a balanced
    // layout (same as adding a pane) so the moved pane gets a sane size.
    const nextList = list.map((w) => {
      if (w.id !== targetId) return w
      const ids = [...getLeaves(w.layout ?? null), paneId]
      return { ...w, panes: { ...(w.panes ?? {}), [paneId]: pane }, layout: buildAutoLayout(ids) }
    })
    set({ list: nextList })
    // Open the target workspace and focus the moved pane.
    get().switchTo(targetId)
    useWorkspace.getState().setActive(paneId)
    // The moved terminal was re-parented into a new container — repaint it.
    repaintTerminal(paneId)
  },

  movePanesTo: (paneIds, targetId) => {
    const { activeId, list } = get()
    if (targetId === activeId) return
    const ws = useWorkspace.getState()
    const moving = paneIds.filter((id) => ws.panes[id])
    if (!moving.length) return
    const moved: Record<string, Pane> = {}
    for (const id of moving) moved[id] = ws.panes[id]
    // Detach all from the active workspace WITHOUT disposing their terminals.
    for (const id of moving) ws.detachPane(id)
    const nextList = list.map((w) => {
      if (w.id !== targetId) return w
      const ids = [...getLeaves(w.layout ?? null), ...moving]
      return { ...w, panes: { ...(w.panes ?? {}), ...moved }, layout: buildAutoLayout(ids) }
    })
    set({ list: nextList })
    get().switchTo(targetId)
    const after = useWorkspace.getState()
    after.setActive(moving[moving.length - 1])
    after.clearPaneSelection()
    for (const id of moving) repaintTerminal(id)
  },

  movePanesToNew: (paneIds) => {
    const ws = useWorkspace.getState()
    const moving = paneIds.filter((id) => ws.panes[id])
    if (!moving.length) return
    const moved: Record<string, Pane> = {}
    for (const id of moving) moved[id] = ws.panes[id]
    // Detach first, then `add()` snapshots the (now-smaller) source workspace
    // correctly and switches us to a fresh empty one.
    for (const id of moving) ws.detachPane(id)
    get().add()
    const layout = buildAutoLayout(moving)
    useWorkspace.getState().hydrate(moved, layout)
    const { activeId, list } = get()
    set({ list: list.map((w) => (w.id === activeId ? { ...w, panes: moved, layout } : w)) })
    const after = useWorkspace.getState()
    after.setActive(moving[moving.length - 1])
    after.clearPaneSelection()
    for (const id of moving) repaintTerminal(id)
  }
}))
