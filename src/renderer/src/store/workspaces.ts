import { create } from 'zustand'
import type { MosaicNode } from 'react-mosaic-component'
import type { Pane } from '@shared/types'
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
  rename: (id: string, name: string) => void
  add: () => void
  switchTo: (id: string) => void
  remove: (id: string) => void
}

const firstId = uid()

export const useWorkspaces = create<WorkspacesState>((set, get) => ({
  list: [{ id: firstId, name: 'URterminal' }],
  activeId: firstId,
  _counter: 0,

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
    set({ list: savedList, activeId: id })
  },

  remove: (id) => {
    const { list, activeId } = get()
    if (list.length <= 1) return
    const remaining = list.filter((w) => w.id !== id)
    if (id === activeId) {
      const ws = useWorkspace.getState()
      const idx = list.findIndex((w) => w.id === id)
      const next = remaining[Math.max(0, idx - 1)]
      ws.hydrate(next?.panes ?? {}, next?.layout ?? null)
      set({ list: remaining, activeId: next.id })
    } else {
      set({ list: remaining })
    }
  }
}))
