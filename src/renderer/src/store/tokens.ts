import { create } from 'zustand'

interface TokensState {
  total: number
  byPane: Record<string, number>
  /** panes that have produced output in the last 2 s (drives the live animation) */
  activePanes: Record<string, true>
  note: (chars: number, paneId?: string) => void
  clearPane: (paneId: string) => void
}

// rAF-batched accumulation – mirrors the pattern in chat.ts
let pendingTotal = 0
const pendingByPane: Record<string, number> = {}
let raf = 0

function flush(): void {
  raf = 0
  if (!pendingTotal) return
  const total = pendingTotal
  const byPane = { ...pendingByPane }
  pendingTotal = 0
  for (const k of Object.keys(pendingByPane)) delete pendingByPane[k]
  useTokens.setState((s) => {
    const next = { ...s.byPane }
    for (const [id, n] of Object.entries(byPane)) next[id] = (next[id] ?? 0) + n
    return { total: s.total + total, byPane: next }
  })
}

const activityTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const useTokens = create<TokensState>((set) => ({
  total: 0,
  byPane: {},
  activePanes: {},

  note: (chars, paneId) => {
    const tokens = Math.max(1, Math.round(chars / 4))
    pendingTotal += tokens
    if (paneId) pendingByPane[paneId] = (pendingByPane[paneId] ?? 0) + tokens
    if (!raf) raf = requestAnimationFrame(flush)

    if (paneId) {
      set((s) =>
        s.activePanes[paneId]
          ? s
          : { activePanes: { ...s.activePanes, [paneId]: true } }
      )
      if (activityTimers.has(paneId)) clearTimeout(activityTimers.get(paneId)!)
      activityTimers.set(
        paneId,
        setTimeout(() => {
          set((s) => {
            const activePanes = { ...s.activePanes }
            delete activePanes[paneId]
            return { activePanes }
          })
          activityTimers.delete(paneId)
        }, 2000)
      )
    }
  },

  clearPane: (paneId) => {
    if (activityTimers.has(paneId)) {
      clearTimeout(activityTimers.get(paneId)!)
      activityTimers.delete(paneId)
    }
    delete pendingByPane[paneId]
    set((s) => {
      const byPane = { ...s.byPane }
      delete byPane[paneId]
      const activePanes = { ...s.activePanes }
      delete activePanes[paneId]
      return { byPane, activePanes }
    })
  }
}))

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}
