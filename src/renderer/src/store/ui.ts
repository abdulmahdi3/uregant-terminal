import { create } from 'zustand'
import type { SnippetItem } from '@shared/types'

export const APP_THEMES = ['dark', 'light', 'amoled', 'ocean', 'forest', 'dusk'] as const
export type AppTheme = (typeof APP_THEMES)[number]

interface UiState {
  showSettings: boolean
  showCommandPalette: boolean
  showShortcuts: boolean
  showPipeMode: boolean
  showTaskManager: boolean
  showAskAll: boolean
  linkingPaneId: string | null
  /** when set, only this pane is rendered (zoom / maximize) */
  zoomedPaneId: string | null
  /** panes currently being dragged onto a workspace tab (null = no drag in progress) */
  draggingPaneIds: string[] | null
  /** scrollback search bar visible (operates on the active pane) */
  searchOpen: boolean
  /** snippet awaiting {{variable}} values before insertion (null = none) */
  fillSnippet: SnippetItem | null
  /** save-as-template modal open for this pane id (null = closed) */
  savingTemplatePaneId: string | null
  /** SSH connect prompt open */
  showSshPrompt: boolean
  /** standalone notes panel open */
  showNotes: boolean
  /** app-wide color theme */
  appTheme: AppTheme
  /** when opening settings, jump to this section id (consumed once by SettingsModal) */
  settingsSection: string | null

  setShowSettings: (v: boolean) => void
  /** open settings, optionally navigating straight to a section (e.g. 'learning') */
  openSettings: (section?: string) => void
  setShowCommandPalette: (v: boolean) => void
  toggleCommandPalette: () => void
  setShowShortcuts: (v: boolean) => void
  toggleShortcuts: () => void
  togglePipeMode: () => void
  setShowTaskManager: (v: boolean) => void
  toggleTaskManager: () => void
  setShowAskAll: (v: boolean) => void
  setLinkingPaneId: (id: string | null) => void
  setZoomedPaneId: (id: string | null) => void
  setDraggingPanes: (ids: string[] | null) => void
  setSearchOpen: (v: boolean) => void
  setFillSnippet: (s: SnippetItem | null) => void
  setSavingTemplatePaneId: (id: string | null) => void
  setShowSshPrompt: (v: boolean) => void
  setShowNotes: (v: boolean) => void
  toggleNotes: () => void
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
  showAskAll: false,
  showSshPrompt: false,
  showNotes: false,
  linkingPaneId: null as string | null
}

export const useUi = create<UiState>((set, get) => ({
  showSettings: false,
  showCommandPalette: false,
  showShortcuts: false,
  showPipeMode: false,
  showTaskManager: false,
  showAskAll: false,
  linkingPaneId: null,
  zoomedPaneId: null,
  draggingPaneIds: null,
  searchOpen: false,
  fillSnippet: null,
  savingTemplatePaneId: null,
  showSshPrompt: false,
  showNotes: false,
  appTheme: 'dark',
  settingsSection: null,

  // Overlays are mutually exclusive — opening one closes the rest (so e.g.
  // hitting Ctrl+K while Settings is open swaps to the palette, not stacks).
  setShowSettings: (v) => set(v ? { ...ALL_CLOSED, showSettings: true } : { showSettings: false }),
  openSettings: (section) =>
    set({ ...ALL_CLOSED, showSettings: true, settingsSection: section ?? null }),
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
  setShowAskAll: (v) => set(v ? { ...ALL_CLOSED, showAskAll: true } : { showAskAll: false }),
  setLinkingPaneId: (id) => set(id ? { ...ALL_CLOSED, linkingPaneId: id } : { linkingPaneId: null }),
  setZoomedPaneId: (id) => set({ zoomedPaneId: id }),
  setDraggingPanes: (ids) => set({ draggingPaneIds: ids && ids.length ? ids : null }),
  setSearchOpen: (v) => set({ searchOpen: v }),
  setFillSnippet: (s) => set({ fillSnippet: s }),
  setSavingTemplatePaneId: (id) => set({ savingTemplatePaneId: id }),
  setShowSshPrompt: (v) => set(v ? { ...ALL_CLOSED, showSshPrompt: true } : { showSshPrompt: false }),
  setShowNotes: (v) => set(v ? { ...ALL_CLOSED, showNotes: true } : { showNotes: false }),
  toggleNotes: () =>
    set((s) => (s.showNotes ? { showNotes: false } : { ...ALL_CLOSED, showNotes: true })),
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
      showAskAll: false,
      showSshPrompt: false,
      showNotes: false,
      linkingPaneId: null
    })
}))
