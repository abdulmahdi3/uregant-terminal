import { create } from 'zustand'
import type { MosaicDirection, MosaicNode } from 'react-mosaic-component'
import type { Pane, PaneType, ProviderId, ChatMessage } from '@shared/types'
import { DEFAULT_AGENT } from '@shared/providers'
import { getLeaves, splitLeaf, removeLeaf } from '@renderer/lib/mosaicTree'
import { disposeTerminal } from '@renderer/lib/terminalPool'
import { buildPresetLayout, PRESET_PANE_COUNT } from '@renderer/lib/layoutPresets'

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** how long the pane open/close pop animation runs (keep in sync with workspace.css) */
export const PANE_ANIM_MS = 180

export interface WorkspaceState {
  panes: Record<string, Pane>
  layout: MosaicNode<string> | null
  activePaneId: string | null
  /** stack of recently closed panes, newest last (for "reopen closed pane") */
  recentlyClosed: Pane[]
  /** panes currently playing their pop-in animation (cleared after PANE_ANIM_MS) */
  entering: Record<string, true>
  /** panes playing their pop-out animation; still in the layout until removal */
  closing: Record<string, true>

  // defaults sourced from settings (kept in sync by App)
  defaultProvider: ProviderId
  defaultModel: string

  addPane: (type: PaneType, direction?: MosaicDirection) => string
  splitPane: (id: string) => void
  /** split a pane, copying its session (agent command + folder) into the new one */
  duplicatePane: (id: string, direction: MosaicDirection) => void
  removePane: (id: string) => void
  reopenClosed: () => void
  setActive: (id: string) => void
  focusByIndex: (index: number) => void
  setLayout: (node: MosaicNode<string> | null) => void
  setPaneType: (id: string, type: PaneType) => void
  updatePane: (id: string, patch: Partial<Pane>) => void
  clearMessages: (id: string) => void
  /** change which agent CLI an AI pane runs (respawns its terminal) */
  setAgent: (id: string, command: string) => void
  /** add or remove a pipe target for a pane (toggles presence in pipeTargets[]) */
  togglePipeTarget: (id: string, targetId: string) => void
  /** open a shell pane in the same directory as an AI pane */
  openTerminalHere: (paneId: string) => void
  setDefaults: (provider: ProviderId, model: string) => void
  /** replace whole workspace (used by persistence restore) */
  hydrate: (panes: Record<string, Pane>, layout: MosaicNode<string> | null) => void
  /** rearrange all panes into a named layout preset */
  applyLayoutPreset: (presetId: string) => void

  // ai message helpers
  addMessage: (paneId: string, msg: ChatMessage) => void
  appendToMessage: (paneId: string, messageId: string, text: string) => void
  appendBatch: (updates: { paneId: string; messageId: string; text: string }[]) => void
  endMessage: (paneId: string, messageId: string) => void
  setActiveStream: (paneId: string, streamId: string | undefined) => void
}

let paneCounter = 0

/** clear a pane's transient `entering` flag after its pop-in animation finishes */
function scheduleEnterClear(
  set: (fn: (s: WorkspaceState) => Partial<WorkspaceState>) => void,
  id: string
): void {
  window.setTimeout(() => {
    set((s) => {
      const entering = { ...s.entering }
      delete entering[id]
      return { entering }
    })
  }, PANE_ANIM_MS)
}

function makePane(type: PaneType, defaults: { provider: ProviderId; model: string }): Pane {
  const id = uid()
  paneCounter += 1
  const base: Pane = { id, type, title: `${type} ${paneCounter}` }
  if (type === 'ai') {
    // An "AI pane" is a terminal that auto-launches an agent CLI (default: claude).
    base.title = DEFAULT_AGENT
    base.agent = { command: DEFAULT_AGENT }
    void defaults
  } else if (type === 'shell') {
    base.title = `Shell ${paneCounter}`
    base.shell = { shell: '' }
  } else {
    base.title = `Pane ${paneCounter}`
  }
  return base
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  panes: {},
  layout: null,
  activePaneId: null,
  recentlyClosed: [],
  entering: {},
  closing: {},
  defaultProvider: 'anthropic',
  defaultModel: '',

  addPane: (type, direction) => {
    const { layout, activePaneId, defaultProvider, defaultModel } = get()
    const pane = makePane(type, { provider: defaultProvider, model: defaultModel })
    const leaves = getLeaves(layout)
    // split the active leaf (or the first one); alternate direction for a grid feel
    // unless an explicit direction was requested.
    const target = activePaneId && leaves.includes(activePaneId) ? activePaneId : leaves[0]
    // predictable: split to the right unless a direction is explicitly requested
    const dir: MosaicDirection = direction ?? 'row'
    const nextLayout = layout === null ? pane.id : splitLeaf(layout, target, pane.id, dir)
    set((s) => ({
      panes: { ...s.panes, [pane.id]: pane },
      layout: nextLayout,
      activePaneId: pane.id,
      entering: { ...s.entering, [pane.id]: true }
    }))
    scheduleEnterClear(set, pane.id)
    return pane.id
  },

  splitPane: (id) => {
    const { activePaneId } = get()
    if (id !== activePaneId) set({ activePaneId: id })
    get().addPane('empty')
  },

  duplicatePane: (id, direction) => {
    const src = get().panes[id]
    if (!src) return
    const np = makePane(src.type, {
      provider: get().defaultProvider,
      model: get().defaultModel
    })
    // copy the live session so the new pane opens the same agent in the same folder
    if (src.type === 'ai' && src.agent) {
      np.agent = { command: src.agent.command, cwd: src.agent.cwd }
      np.title = src.title
    }
    set((s) => {
      const layout = s.layout === null ? np.id : splitLeaf(s.layout, id, np.id, direction)
      return {
        panes: { ...s.panes, [np.id]: np },
        layout,
        activePaneId: np.id,
        entering: { ...s.entering, [np.id]: true }
      }
    })
    scheduleEnterClear(set, np.id)
  },

  removePane: (id) => {
    const s0 = get()
    if (!s0.panes[id] || s0.closing[id]) return // ignore double-close
    // play the pop-out first: keep the pane in the layout (and its terminal alive)
    // until the animation finishes, then do the real teardown.
    set((s) => ({ closing: { ...s.closing, [id]: true } }))
    window.setTimeout(() => {
      disposeTerminal(id)
      set((s) => {
        const closed = s.panes[id]
        const panes = { ...s.panes }
        delete panes[id]
        // Remove the closed pane from every other pane's pipeTargets
        for (const [pid, pane] of Object.entries(panes)) {
          if (pane.pipeTargets?.includes(id)) {
            const next = pane.pipeTargets.filter((t) => t !== id)
            panes[pid] = { ...pane, pipeTargets: next.length ? next : undefined }
          }
        }
        const layout = removeLeaf(s.layout, id)
        const remaining = getLeaves(layout)
        const activePaneId =
          s.activePaneId === id ? remaining[remaining.length - 1] ?? null : s.activePaneId
        const recentlyClosed = closed
          ? [...s.recentlyClosed, closed].slice(-10)
          : s.recentlyClosed
        const closing = { ...s.closing }
        delete closing[id]
        return { panes, layout, activePaneId, recentlyClosed, closing }
      })
    }, PANE_ANIM_MS)
  },

  reopenClosed: () => {
    const { recentlyClosed } = get()
    if (!recentlyClosed.length) return
    const last = recentlyClosed[recentlyClosed.length - 1]
    // give it a fresh id so it can't collide with anything still alive
    const revived = makePane(last.type, {
      provider: last.ai?.provider ?? get().defaultProvider,
      model: last.ai?.model ?? get().defaultModel
    })
    revived.title = last.title
    if (last.agent) revived.agent = { command: last.agent.command, cwd: last.agent.cwd }
    if (last.ai) revived.ai = { ...last.ai, activeStreamId: undefined }
    set((s) => {
      const leaves = getLeaves(s.layout)
      const target = s.activePaneId && leaves.includes(s.activePaneId) ? s.activePaneId : leaves[0]
      const layout = s.layout === null ? revived.id : splitLeaf(s.layout, target, revived.id, 'row')
      return {
        panes: { ...s.panes, [revived.id]: revived },
        layout,
        activePaneId: revived.id,
        recentlyClosed: s.recentlyClosed.slice(0, -1),
        entering: { ...s.entering, [revived.id]: true }
      }
    })
    scheduleEnterClear(set, revived.id)
  },

  setActive: (id) => set({ activePaneId: id }),

  focusByIndex: (index) => {
    const leaves = getLeaves(get().layout)
    const id = leaves[index]
    if (id) set({ activePaneId: id })
  },

  setLayout: (node) => set({ layout: node }),

  setPaneType: (id, type) =>
    set((s) => {
      const existing = s.panes[id]
      if (!existing) return s
      const { defaultProvider, defaultModel } = s
      const replacement: Pane = { ...existing, type }
      if (type === 'ai' && !replacement.ai) {
        replacement.ai = { provider: defaultProvider, model: defaultModel, messages: [] }
        replacement.title = existing.title.replace(/^Pane/, 'AI')
      } else if (type === 'shell' && !replacement.shell) {
        replacement.shell = { shell: '' }
        replacement.title = existing.title.replace(/^Pane/, 'Shell')
      }
      return { panes: { ...s.panes, [id]: replacement } }
    }),

  updatePane: (id, patch) =>
    set((s) => (s.panes[id] ? { panes: { ...s.panes, [id]: { ...s.panes[id], ...patch } } } : s)),

  clearMessages: (id) =>
    set((s) => {
      const pane = s.panes[id]
      if (!pane?.ai) return s
      return { panes: { ...s.panes, [id]: { ...pane, ai: { ...pane.ai, messages: [] } } } }
    }),

  togglePipeTarget: (id, targetId) =>
    set((s) => {
      const pane = s.panes[id]
      if (!pane) return s
      const cur = pane.pipeTargets ?? []
      const next = cur.includes(targetId)
        ? cur.filter((t) => t !== targetId)
        : [...cur, targetId]
      return { panes: { ...s.panes, [id]: { ...pane, pipeTargets: next.length ? next : undefined } } }
    }),

  openTerminalHere: (paneId) => {
    const s0 = get()
    const pane = s0.panes[paneId]
    if (!pane || pane.type !== 'ai') return
    const cwd = pane.agent?.cwd
    const np = makePane('shell', { provider: s0.defaultProvider, model: s0.defaultModel })
    np.shell = { shell: '', cwd }
    if (cwd) {
      const name = cwd.replace(/\\/g, '/').split('/').filter(Boolean).pop()
      if (name) np.title = name
    }
    set((s) => {
      const layout = s.layout === null ? np.id : splitLeaf(s.layout, paneId, np.id, 'column')
      return {
        panes: { ...s.panes, [np.id]: np },
        layout,
        activePaneId: np.id,
        entering: { ...s.entering, [np.id]: true }
      }
    })
    scheduleEnterClear(set, np.id)
  },

  setAgent: (id, command) =>
    set((s) => {
      const pane = s.panes[id]
      if (!pane || pane.type !== 'ai') return s
      // keep the folder, drop ptyId so the terminal respawns with the new command
      return {
        panes: {
          ...s.panes,
          [id]: { ...pane, title: command, agent: { command, cwd: pane.agent?.cwd } }
        }
      }
    }),

  setDefaults: (provider, model) => set({ defaultProvider: provider, defaultModel: model }),

  applyLayoutPreset: (presetId) => {
    const s0 = get()
    const needed = PRESET_PANE_COUNT[presetId]
    if (!needed) return
    const existing = getLeaves(s0.layout)
    const hasContent = existing.some((id) => {
      const t = s0.panes[id]?.type
      return t === 'ai' || t === 'shell'
    })
    // if panes have active content and we'd need to remove some, leave them alone
    if (hasContent && existing.length > needed) return
    const panes = { ...s0.panes }
    const ids: string[] = existing.slice(0, needed)
    // remove excess empty panes that won't fit the new layout
    for (const id of existing.slice(needed)) {
      disposeTerminal(id)
      delete panes[id]
    }
    // create any missing panes
    const entering: Record<string, true> = {}
    while (ids.length < needed) {
      const p = makePane('empty', { provider: s0.defaultProvider, model: s0.defaultModel })
      panes[p.id] = p
      entering[p.id] = true
      ids.push(p.id)
    }
    const layout = buildPresetLayout(presetId, ids)
    const activePaneId = ids.includes(s0.activePaneId ?? '') ? s0.activePaneId : ids[0]
    set({ panes, layout, activePaneId, entering: { ...s0.entering, ...entering } })
    for (const id of Object.keys(entering)) scheduleEnterClear(set, id)
  },

  hydrate: (panes, layout) => {
    const ids = getLeaves(layout)
    set({ panes, layout, activePaneId: ids[ids.length - 1] ?? null })
  },

  addMessage: (paneId, msg) =>
    set((s) => {
      const pane = s.panes[paneId]
      if (!pane?.ai) return s
      const ai = { ...pane.ai, messages: [...pane.ai.messages, msg] }
      return { panes: { ...s.panes, [paneId]: { ...pane, ai } } }
    }),

  appendToMessage: (paneId, messageId, text) =>
    set((s) => {
      const pane = s.panes[paneId]
      if (!pane?.ai) return s
      const messages = pane.ai.messages.map((m) =>
        m.id === messageId ? { ...m, content: m.content + text } : m
      )
      return { panes: { ...s.panes, [paneId]: { ...pane, ai: { ...pane.ai, messages } } } }
    }),

  // Apply many streamed-text appends in a single state update (one re-render
  // per animation frame regardless of how many tokens / panes are streaming).
  appendBatch: (updates) =>
    set((s) => {
      if (!updates.length) return s
      const byPane = new Map<string, Map<string, string>>()
      for (const u of updates) {
        if (!byPane.has(u.paneId)) byPane.set(u.paneId, new Map())
        const m = byPane.get(u.paneId)!
        m.set(u.messageId, (m.get(u.messageId) ?? '') + u.text)
      }
      const panes = { ...s.panes }
      for (const [paneId, msgMap] of byPane) {
        const pane = panes[paneId]
        if (!pane?.ai) continue
        const messages = pane.ai.messages.map((msg) =>
          msgMap.has(msg.id) ? { ...msg, content: msg.content + msgMap.get(msg.id)! } : msg
        )
        panes[paneId] = { ...pane, ai: { ...pane.ai, messages } }
      }
      return { panes }
    }),

  endMessage: (paneId, messageId) =>
    set((s) => {
      const pane = s.panes[paneId]
      if (!pane?.ai) return s
      const messages = pane.ai.messages.map((m) =>
        m.id === messageId ? { ...m, streaming: false } : m
      )
      return { panes: { ...s.panes, [paneId]: { ...pane, ai: { ...pane.ai, messages } } } }
    }),

  setActiveStream: (paneId, streamId) =>
    set((s) => {
      const pane = s.panes[paneId]
      if (!pane?.ai) return s
      return {
        panes: { ...s.panes, [paneId]: { ...pane, ai: { ...pane.ai, activeStreamId: streamId } } }
      }
    })
}))

export const newMessageId = uid
