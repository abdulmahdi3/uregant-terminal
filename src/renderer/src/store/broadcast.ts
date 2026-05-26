import { create } from 'zustand'

/**
 * Broadcast input mode: type a prompt once in the active pane and send it to
 * several selected panes at once. Ephemeral (session-only) — like a transient
 * UI mode, not something worth persisting across restarts.
 */
interface BroadcastState {
  enabled: boolean
  /** pane ids that receive the broadcast (the active source pane submits on its own) */
  members: string[]
  toggle: () => void
  setEnabled: (v: boolean) => void
  toggleMember: (id: string) => void
  /** replace the whole member list at once (used by the "all panes" picker) */
  setMembers: (ids: string[]) => void
  isMember: (id: string) => boolean
  clear: () => void
}

export const useBroadcastStore = create<BroadcastState>((set, get) => ({
  enabled: false,
  members: [],
  toggle: () => set((s) => ({ enabled: !s.enabled })),
  setEnabled: (v) => set({ enabled: v }),
  toggleMember: (id) =>
    set((s) => ({
      members: s.members.includes(id) ? s.members.filter((m) => m !== id) : [...s.members, id]
    })),
  setMembers: (ids) => set({ members: [...new Set(ids)] }),
  isMember: (id) => get().members.includes(id),
  clear: () => set({ members: [] })
}))
