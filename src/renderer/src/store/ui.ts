import { create } from 'zustand'

export const APP_THEMES = ['dark', 'amoled', 'ocean', 'forest', 'dusk'] as const
export type AppTheme = (typeof APP_THEMES)[number]

interface UiState {
  showSettings: boolean
  showCommandPalette: boolean
  showShortcuts: boolean
  showPipeMode: boolean
  showTaskManager: boolean
  linkingPaneId: string | null
  /** when set, only this pane is rendered (zoom / maximize) */
  zoomedPaneId: string | null
  /** pane currently being dragged onto a workspace tab (null = no drag in progress) */
  draggingPaneId: string | null
  /** app-wide color theme */
  appTheme: AppTheme

  setShowSettings: (v: boolean) => void
  setShowCommandPalette: (v: boolean) => void
  toggleCommandPalette: () => void
  setShowShortcuts: (v: boolean) => void
  toggleShortcuts: () => void
  togglePipeMode: () => void
  setShowTaskManager: (v: boolean) => void
  toggleTaskManager: () => void
  setLinkingPaneId: (id: string | null) => void
  setZoomedPaneId: (id: string | null) => void
  setDraggingPane: (id: string | null) => void
  toggleZoom: (id: string) => void
  setAppTheme: (theme: AppTheme) => void
  cycleAppTheme: () => void
  /** close every transient overlay (used by Escape) */
  closeOverlays: () => void
}

/** Every transient overlay closed — spread before opening one for exclusivity. */
const ALL_CLOSED = {
  showSettings: false,
  showCommandPalette: false,
  showShortcuts: false,
  showPipeMode: false,
  showTaskManager: false,
  linkingPaneId: null as string | null
}

export const useUi = create<UiState>((set, get) => ({
  showSettings: false,
  showCommandPalette: false,
  showShortcuts: false,
  showPipeMode: false,
  showTaskManager: false,
  linkingPaneId: null,
  zoomedPaneId: null,
  draggingPaneId: null,
  appTheme: 'dark',

  // Overlays are mutually exclusive — opening one closes the rest (so e.g.
  // hitting Ctrl+K while Settings is open swaps to the palette, not stacks).
  setShowSettings: (v) => set(v ? { ...ALL_CLOSED, showSettings: true } : { showSettings: false }),
  setShowCommandPalette: (v) =>
    set(v ? { ...ALL_CLOSED, showCommandPalette: true } : { showCommandPalette: false }),
  toggleCommandPalette: () =>
    set((s) =>
      s.showCommandPalette ? { showCommandPalette: false } : { ...ALL_CLOSED, showCommandPalette: true }
    ),
  setShowShortcuts: (v) => set(v ? { ...ALL_CLOSED, showShortcuts: true } : { showShortcuts: false }),
  toggleShortcuts: () =>
    set((s) => (s.showShortcuts ? { showShortcuts: false } : { ...ALL_CLOSED, showShortcuts: true })),
  togglePipeMode: () =>
    set((s) => (s.showPipeMode ? { showPipeMode: false } : { ...ALL_CLOSED, showPipeMode: true })),
  setShowTaskManager: (v) =>
    set(v ? { ...ALL_CLOSED, showTaskManager: true } : { showTaskManager: false }),
  toggleTaskManager: () =>
    set((s) =>
      s.showTaskManager ? { showTaskManager: false } : { ...ALL_CLOSED, showTaskManager: true }
    ),
  setLinkingPaneId: (id) => set(id ? { ...ALL_CLOSED, linkingPaneId: id } : { linkingPaneId: null }),
  setZoomedPaneId: (id) => set({ zoomedPaneId: id }),
  setDraggingPane: (id) => set({ draggingPaneId: id }),
  toggleZoom: (id) => set({ zoomedPaneId: get().zoomedPaneId === id ? null : id }),
  setAppTheme: (theme) => set({ appTheme: theme }),
  cycleAppTheme: () =>
    set((s) => {
      const idx = APP_THEMES.indexOf(s.appTheme)
      return { appTheme: APP_THEMES[(idx + 1) % APP_THEMES.length] }
    }),
  closeOverlays: () =>
    set({
      showSettings: false,
      showCommandPalette: false,
      showShortcuts: false,
      showPipeMode: false,
      showTaskManager: false,
      linkingPaneId: null
    })
}))
