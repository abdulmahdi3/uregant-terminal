import { create } from 'zustand'
import type { MosaicDirection, MosaicNode } from 'react-mosaic-component'
import type { Pane, PaneType, ProviderId } from '@shared/types'
import { DEFAULT_AGENT } from '@shared/providers'
import { getLeaves, splitLeaf, removeLeaf } from '@renderer/lib/mosaicTree'
import { disposeTerminal } from '@renderer/lib/terminalPool'
import { homeDir } from '@renderer/lib/osInfo'
import { toast } from '@renderer/store/toasts'
import { buildAutoLayout, buildPresetLayout, PRESET_PANE_COUNT } from '@renderer/lib/layoutPresets'

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/** Best-effort home dir (renderer runs with sandbox:false, so env is available). */
function getHome(): string | undefined {
  try {
    return (process as NodeJS.Process).env.HOME ?? (process as NodeJS.Process).env.USERPROFILE
  } catch {
    return undefined
  }
}

/** how long the pane open/close pop animation runs (keep in sync with workspace.css) */
export const PANE_ANIM_MS = 180

/** SSH targets with an agent-open request in flight, to dedupe double-clicks. */
const sshAgentOpening = new Set<string>()

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
  /** panes marked (via right-click) for a group move to another workspace */
  selectedPaneIds: string[]

  // defaults sourced from settings (kept in sync by App)
  defaultProvider: ProviderId
  defaultModel: string
  /** agent CLI new AI panes launch by default */
  defaultAgent: string
  /** shell binary new shell panes launch by default ("" = OS default) */
  defaultShell: string
  defaultShellArgs: string[]
  /** working directory new shell panes open in ("" = home) */
  defaultShellCwd: string
  /** focus a newly created pane automatically (settings-controlled) */
  focusNewPane: boolean

  addPane: (type: PaneType, direction?: MosaicDirection, init?: PaneInit) => string
  splitPane: (id: string) => void
  /** split a pane, copying its session (agent command + folder) into the new one */
  duplicatePane: (id: string, direction: MosaicDirection) => void
  removePane: (id: string) => void
  /** remove a pane from this workspace WITHOUT killing its terminal (used to move it elsewhere) */
  detachPane: (id: string) => void
  reopenClosed: () => void
  setActive: (id: string) => void
  /** toggle a pane in/out of the group-move selection */
  togglePaneSelected: (id: string) => void
  /** clear the group-move selection */
  clearPaneSelection: () => void
  focusByIndex: (index: number) => void
  setLayout: (node: MosaicNode<string> | null) => void
  setPaneType: (id: string, type: PaneType, init?: PaneInit) => void
  updatePane: (id: string, patch: Partial<Pane>) => void
  /** change which agent CLI an AI pane runs (respawns its terminal) */
  setAgent: (id: string, command: string) => void
  /** add or remove a pipe target for a pane (toggles presence in pipeTargets[]) */
  togglePipeTarget: (id: string, targetId: string) => void
  /** replace a pane's whole pipe-target list at once (used by the "all panes" picker) */
  setPipeTargets: (id: string, targets: string[]) => void
  /** open a shell pane in the same directory as an AI pane */
  openTerminalHere: (paneId: string) => void
  /** open an agent pane in the same directory as a shell pane */
  openAgentHere: (paneId: string) => void
  setDefaults: (defaults: {
    provider: ProviderId
    model: string
    agent: string
    shell: string
    shellArgs: string[]
    shellCwd?: string
    focusNewPane?: boolean
  }) => void
  /** replace whole workspace (used by persistence restore) */
  hydrate: (panes: Record<string, Pane>, layout: MosaicNode<string> | null) => void
  /** rearrange all panes into a named layout preset */
  applyLayoutPreset: (presetId: string) => void
}

/** Optional seed for a new pane: which agent CLI, or which shell binary + args. */
export interface PaneInit {
  agentCommand?: string
  /** working directory the agent CLI should open in (AI panes only) */
  agentCwd?: string
  shell?: string
  shellArgs?: string[]
  /** title to show instead of the generic "Shell N" / agent command */
  label?: string
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

interface PaneDefaults {
  agent: string
  shell: string
  shellArgs: string[]
  shellCwd: string
}

function makePane(type: PaneType, defaults: PaneDefaults, init?: PaneInit): Pane {
  const id = uid()
  paneCounter += 1
  const base: Pane = { id, type, title: `${type} ${paneCounter}` }
  if (type === 'ai') {
    // An "AI pane" is a terminal that auto-launches an agent CLI (default: claude).
    const command = init?.agentCommand ?? defaults.agent ?? DEFAULT_AGENT
    base.title = init?.label ?? command
    base.agent = { command, cwd: init?.agentCwd }
  } else if (type === 'shell') {
    base.title = init?.label ?? `Shell ${paneCounter}`
    const cwd = init?.shell !== undefined ? undefined : defaults.shellCwd || undefined
    if (init?.shell !== undefined) {
      base.shell = { shell: init.shell, args: init.shellArgs }
    } else {
      base.shell = {
        shell: defaults.shell,
        args: defaults.shellArgs.length ? defaults.shellArgs : undefined,
        cwd
      }
    }
  } else {
    base.title = `Pane ${paneCounter}`
  }
  return base
}

/** Snapshot of the pane defaults sourced from settings. */
function paneDefaults(s: WorkspaceState): PaneDefaults {
  return {
    agent: s.defaultAgent,
    shell: s.defaultShell,
    shellArgs: s.defaultShellArgs,
    shellCwd: s.defaultShellCwd
  }
}

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  panes: {},
  layout: null,
  activePaneId: null,
  recentlyClosed: [],
  entering: {},
  closing: {},
  selectedPaneIds: [],
  defaultProvider: 'anthropic',
  defaultModel: '',
  defaultAgent: DEFAULT_AGENT,
  defaultShell: '',
  defaultShellArgs: [],
  defaultShellCwd: '',
  focusNewPane: true,

  addPane: (type, direction, init) => {
    const s0 = get()
    const { layout, activePaneId } = s0
    const leaves = getLeaves(layout)
    // toolbar buttons (no explicit direction) are capped at 9; split/duplicate are always allowed
    if (!direction && leaves.length >= 9) return ''
    const pane = makePane(type, paneDefaults(s0), init)
    const newLeaves = [...leaves, pane.id]
    let nextLayout: MosaicNode<string>
    if (!direction && newLeaves.length <= 9) {
      nextLayout = buildAutoLayout(newLeaves)
    } else {
      const target = activePaneId && leaves.includes(activePaneId) ? activePaneId : leaves[0]
      const dir: MosaicDirection = direction ?? 'row'
      nextLayout = layout === null ? pane.id : splitLeaf(layout, target, pane.id, dir)
    }
    set((s) => ({
      panes: { ...s.panes, [pane.id]: pane },
      layout: nextLayout,
      // "focus new pane on create" (settings-controlled); first pane always focuses
      activePaneId: s.focusNewPane || !s.activePaneId ? pane.id : s.activePaneId,
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
    const np = makePane(src.type, paneDefaults(get()))
    // copy the live session so the new pane opens the same agent in the same folder
    if (src.type === 'ai' && src.agent) {
      np.agent = { command: src.agent.command, cwd: src.agent.cwd }
      np.title = src.title
    } else if (src.type === 'shell' && src.shell) {
      np.shell = { shell: src.shell.shell, args: src.shell.args, cwd: src.shell.cwd }
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
        // If this was an agent-over-SSH pane and no other pane uses the same
        // target, release its remote resources (unmount drive + close exec conn).
        const sshTarget = closed?.agent?.sshTarget
        if (sshTarget && !Object.values(panes).some((p) => p.agent?.sshTarget === sshTarget)) {
          window.api.sshCloseAgent(sshTarget)
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
        const selectedPaneIds = s.selectedPaneIds.filter((p) => p !== id)
        return { panes, layout, activePaneId, recentlyClosed, closing, selectedPaneIds }
      })
    }, PANE_ANIM_MS)
  },

  detachPane: (id) =>
    set((s) => {
      if (!s.panes[id]) return s
      const panes = { ...s.panes }
      delete panes[id]
      // drop the detached pane from any remaining pane's pipe targets
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
      const selectedPaneIds = s.selectedPaneIds.filter((p) => p !== id)
      return { panes, layout, activePaneId, selectedPaneIds }
    }),

  reopenClosed: () => {
    const { recentlyClosed } = get()
    if (!recentlyClosed.length) return
    const last = recentlyClosed[recentlyClosed.length - 1]
    // give it a fresh id so it can't collide with anything still alive
    const revived = makePane(last.type, paneDefaults(get()))
    revived.title = last.title
    if (last.agent) revived.agent = { command: last.agent.command, cwd: last.agent.cwd }
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

  togglePaneSelected: (id) =>
    set((s) => {
      if (!s.panes[id]) return s
      // Select the pane together with every pane it's piped to (and panes that
      // pipe into it) — its connected group moves as one unit.
      const group = new Set<string>([id])
      s.panes[id].pipeTargets?.forEach((t) => s.panes[t] && group.add(t))
      for (const [pid, p] of Object.entries(s.panes)) {
        if (p.pipeTargets?.includes(id)) group.add(pid)
      }
      const groupIds = [...group]
      const allSelected = groupIds.every((g) => s.selectedPaneIds.includes(g))
      const sel = allSelected
        ? s.selectedPaneIds.filter((p) => !group.has(p))
        : [...new Set([...s.selectedPaneIds, ...groupIds])]
      return { selectedPaneIds: sel }
    }),

  clearPaneSelection: () =>
    set((s) => (s.selectedPaneIds.length ? { selectedPaneIds: [] } : s)),

  focusByIndex: (index) => {
    const leaves = getLeaves(get().layout)
    const id = leaves[index]
    if (id) set({ activePaneId: id })
  },

  setLayout: (node) => set({ layout: node }),

  setPaneType: (id, type, init) =>
    set((s) => {
      const existing = s.panes[id]
      if (!existing) return s
      const replacement: Pane = { ...existing, type, agent: undefined, shell: undefined }
      if (type === 'ai') {
        const command = init?.agentCommand ?? DEFAULT_AGENT
        replacement.agent = { command }
        replacement.title = init?.label ?? command
      } else if (type === 'shell') {
        replacement.shell = { shell: init?.shell ?? '', args: init?.shellArgs }
        replacement.title = init?.label ?? existing.title.replace(/^Pane/, 'Shell')
      }
      return { panes: { ...s.panes, [id]: replacement } }
    }),

  updatePane: (id, patch) =>
    set((s) => (s.panes[id] ? { panes: { ...s.panes, [id]: { ...s.panes[id], ...patch } } } : s)),

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

  setPipeTargets: (id, targets) =>
    set((s) => {
      const pane = s.panes[id]
      if (!pane) return s
      const next = [...new Set(targets.filter((t) => t !== id && s.panes[t]))]
      return { panes: { ...s.panes, [id]: { ...pane, pipeTargets: next.length ? next : undefined } } }
    }),

  openTerminalHere: (paneId) => {
    const s0 = get()
    const pane = s0.panes[paneId]
    if (!pane || pane.type !== 'ai') return
    const cwd = pane.agent?.cwd
    const np = makePane('shell', paneDefaults(s0))
    // Open the agent's working dir in PowerShell rather than the OS-default cmd.
    np.shell = { shell: 'powershell.exe', cwd }
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

  openAgentHere: (paneId) => {
    const s0 = get()
    const pane = s0.panes[paneId]
    if (!pane || pane.type !== 'shell') return
    const command = s0.defaultAgent || DEFAULT_AGENT
    // SSH pane: open a LOCAL agent that operates the remote server with nothing
    // installed on it — the remote folder is mounted as a local drive (SSHFS) so
    // the agent edits files normally, and `urssh "<cmd>"` runs commands ON the
    // server. The pane is created AFTER the mount so it opens in the mounted
    // folder (cwd) rather than flashing the folder picker.
    if (pane.shell?.ssh) {
      const target = pane.shell.ssh.target
      if (sshAgentOpening.has(target)) return // already opening for this target
      sshAgentOpening.add(target)
      void window.api
        .sshOpenAgent(target)
        .then((res) => {
          if (!res.ok || !res.cwd) {
            toast(`Agent over SSH failed: ${res.error ?? 'unknown error'}`, 'error')
            return
          }
          const np = makePane('ai', paneDefaults(get()))
          np.agent = { command, cwd: res.cwd || homeDir() || '.', sshTarget: target }
          np.title = res.mounted ? `${command} ${res.drive}: → ${target}` : `${command} → ${target}`
          set((s) => {
            // The source SSH pane may have been closed during the connect/mount
            // wait — split off it if still present, else off any existing leaf,
            // so the new agent pane never becomes an orphan missing from layout.
            const leaves = getLeaves(s.layout)
            const anchor = leaves.includes(paneId) ? paneId : leaves[leaves.length - 1]
            const layout =
              s.layout === null || anchor === undefined
                ? np.id
                : splitLeaf(s.layout, anchor, np.id, 'column')
            return {
              panes: { ...s.panes, [np.id]: np },
              layout,
              activePaneId: np.id,
              entering: { ...s.entering, [np.id]: true }
            }
          })
          scheduleEnterClear(set, np.id)

          // The agent's instructions are delivered via a CLAUDE.md in its working
          // dir (read automatically on startup) — no fragile auto-typing needed.
          if (res.mounted) toast(`Mounted ${target} at ${res.drive}: — editing files there`, 'ok')
          else if (res.needsSshfs)
            toast('Install SSHFS-Win to edit remote files directly (run "SSH: Install remote-folder mount"). Running commands works now.', 'info')
          else if (res.mountError)
            toast(`Couldn't mount the remote folder: ${res.mountError}. Running commands still works.`, 'error')
        })
        .catch((e: Error) => toast(`Agent over SSH failed: ${e.message}`, 'error'))
        .finally(() => sshAgentOpening.delete(target))
      return
    }
    // The shell's launch cwd (live `cd`s aren't tracked); fall back to home.
    const cwd = pane.shell?.cwd ?? getHome()
    const np = makePane('ai', paneDefaults(s0))
    np.agent = { command, cwd }
    np.title = command
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

  setDefaults: (d) =>
    set({
      defaultProvider: d.provider,
      defaultModel: d.model,
      defaultAgent: d.agent || DEFAULT_AGENT,
      defaultShell: d.shell,
      defaultShellArgs: d.shellArgs,
      ...(d.shellCwd !== undefined ? { defaultShellCwd: d.shellCwd } : {}),
      ...(d.focusNewPane !== undefined ? { focusNewPane: d.focusNewPane } : {})
    }),

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
      const p = makePane('empty', paneDefaults(s0))
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
    set({ panes, layout, activePaneId: ids[ids.length - 1] ?? null, selectedPaneIds: [] })
  }
}))
