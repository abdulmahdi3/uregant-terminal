import { create } from 'zustand'

export const APP_THEMES = ['dark', 'amoled', 'ocean', 'forest', 'dusk'] as const
export type AppTheme = (typeof APP_THEMES)[number]

interface UiState {
  showSettings: boolean
  showCommandPalette: boolean
  showShortcuts: boolean
  showPipeMode: boolean
  linkingPaneId: string | null
  /** when set, only this pane is rendered (zoom / maximize) */
  zoomedPaneId: string | null
  /** app-wide color theme */
  appTheme: AppTheme

  setShowSettings: (v: boolean) => void
  setShowCommandPalette: (v: boolean) => void
  toggleCommandPalette: () => void
  setShowShortcuts: (v: boolean) => void
  toggleShortcuts: () => void
  togglePipeMode: () => void
  setLinkingPaneId: (id: string | null) => void
  setZoomedPaneId: (id: string | null) => void
  toggleZoom: (id: string) => void
  setAppTheme: (theme: AppTheme) => void
  cycleAppTheme: () => void
  /** close every transient overlay (used by Escape) */
  closeOverlays: () => void
}

export const useUi = create<UiState>((set, get) => ({
  showSettings: false,
  showCommandPalette: false,
  showShortcuts: false,
  showPipeMode: false,
  linkingPaneId: null,
  zoomedPaneId: null,
  appTheme: 'dark',

  setShowSettings: (v) => set({ showSettings: v }),
  setShowCommandPalette: (v) => set({ showCommandPalette: v }),
  toggleCommandPalette: () => set((s) => ({ showCommandPalette: !s.showCommandPalette })),
  setShowShortcuts: (v) => set({ showShortcuts: v }),
  toggleShortcuts: () => set((s) => ({ showShortcuts: !s.showShortcuts })),
  togglePipeMode: () => set((s) => ({ showPipeMode: !s.showPipeMode })),
  setLinkingPaneId: (id) => set({ linkingPaneId: id }),
  setZoomedPaneId: (id) => set({ zoomedPaneId: id }),
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
      linkingPaneId: null
    })
}))
