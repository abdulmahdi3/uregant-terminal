import { create } from 'zustand'

/**
 * Lifecycle of an AI pane within a turn:
 *  - awaiting: a prompt was submitted, waiting for the agent to start responding
 *  - working:  output is streaming
 *  - idle:     the agent finished a turn (went quiet) or is freshly waiting
 */
export type PaneStatus = 'awaiting' | 'working' | 'idle'

interface PaneStatusState {
  status: Record<string, PaneStatus>
  set: (id: string, s: PaneStatus) => void
  remove: (id: string) => void
}

export const usePaneStatus = create<PaneStatusState>((set) => ({
  status: {},
  set: (id, s) =>
    set((st) => (st.status[id] === s ? st : { status: { ...st.status, [id]: s } })),
  remove: (id) =>
    set((st) => {
      if (!(id in st.status)) return st
      const status = { ...st.status }
      delete status[id]
      return { status }
    })
}))

// ---- turn-complete event (working -> idle) ----
// Features like desktop / Telegram "agent done" notifications subscribe here so
// the idle detection lives in exactly one place.
type TurnListener = (paneId: string) => void
const turnListeners = new Set<TurnListener>()

export function onPaneTurnComplete(cb: TurnListener): () => void {
  turnListeners.add(cb)
  return () => turnListeners.delete(cb)
}

export function emitPaneTurnComplete(paneId: string): void {
  turnListeners.forEach((cb) => cb(paneId))
}
