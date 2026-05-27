import { create } from 'zustand'
import type { SettingsPublic, SettingsPatch } from '@shared/types'
import { setTerminalFont, setTerminalConfig, setTerminalTheme } from '@renderer/lib/terminalPool'
import { useWorkspace } from './workspace'
import { useUi, type AppTheme } from './ui'

interface SettingsState {
  settings: SettingsPublic | null
  load: () => Promise<void>
  patch: (patch: SettingsPatch) => Promise<void>
  apply: (s: SettingsPublic) => void
}

function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

function darkenHex(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = Math.max(0, ((n >> 16) & 255) - 29)
  const g = Math.max(0, ((n >> 8) & 255) - 20)
  const b = Math.max(0, (n & 255) - 15)
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

function applyAccentColor(hex: string): void {
  const el = document.documentElement
  el.style.setProperty('--accent', hex)
  el.style.setProperty('--accent-strong', darkenHex(hex))
  el.style.setProperty('--accent-soft', hexToRgba(hex, 0.14))
  el.style.setProperty('--accent-glow', hexToRgba(hex, 0.35))
}

function applySideEffects(s: SettingsPublic): void {
  // Mirror auto-restore to localStorage so usePersistence can read it
  // synchronously at startup, before this async settings load resolves.
  try {
    localStorage.setItem('urterminal.autoRestore', s.prefs.autoRestore ? '1' : '0')
  } catch {
    /* ignore */
  }
  document.documentElement.setAttribute('data-theme', 'dark')
  useWorkspace.getState().setDefaults({
    provider: s.defaultProvider,
    model: s.defaultModel,
    agent: s.defaultAgent,
    shell: s.defaultShell,
    shellArgs: s.defaultShellArgs,
    shellCwd: s.prefs.defaultShellCwd,
    focusNewPane: s.prefs.focusNewPane
  })
  // pane title bars (settings-controlled) — collapse the mosaic toolbar when off
  document.documentElement.classList.toggle('hide-pane-headers', !s.prefs.showPaneHeaders)
  applyAccentColor(s.accentColor || '#4c8dff')
  setTerminalFont(s.prefs.fontFamily || '', s.prefs.fontSize || 13)
  setTerminalConfig({
    cursorStyle: s.prefs.cursorStyle,
    cursorBlink: s.prefs.cursorBlink,
    lineHeight: s.prefs.lineHeight,
    letterSpacing: s.prefs.letterSpacing,
    scrollback: s.prefs.scrollback,
    scrollSensitivity: s.prefs.scrollSensitivity,
    copyOnSelect: s.prefs.copyOnSelect,
    pasteOnRightClick: s.prefs.pasteOnRightClick,
    bell: s.prefs.terminalBell,
    padding: s.prefs.terminalPadding
  })
  // App color theme: 'system' resolves to light/dark via the OS preference;
  // every other value is a concrete theme class applied on .app (see App.tsx).
  const themePref = s.prefs.appTheme || 'dark'
  const resolved =
    themePref === 'system'
      ? window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : themePref
  useUi.getState().setAppTheme(resolved as AppTheme)
  setTerminalTheme(resolved) // agent/shell terminal background follows the theme
  // Recolor the native window caption buttons to match the theme's title-bar
  // (--bg-elev) and dim text (--text-dim).
  const ov = OVERLAY_COLORS[resolved] ?? OVERLAY_COLORS.dark
  window.api.setWindowOverlay(ov.color, ov.symbol)
}

/** Native caption-overlay colors per theme — color = --bg-elev, symbol = --text-dim. */
const OVERLAY_COLORS: Record<string, { color: string; symbol: string }> = {
  dark: { color: '#12151c', symbol: '#8b94a6' },
  light: { color: '#ffffff', symbol: '#4f5b6e' },
  amoled: { color: '#090909', symbol: '#8b94a6' },
  ocean: { color: '#0c1524', symbol: '#8b94a6' },
  forest: { color: '#0b160e', symbol: '#8b94a6' },
  dusk: { color: '#1b1610', symbol: '#8b94a6' }
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  apply: (s) => {
    applySideEffects(s)
    set({ settings: s })
  },
  load: async () => {
    const s = await window.api.getSettings()
    get().apply(s)
  },
  patch: async (patch) => {
    const s = await window.api.patchSettings(patch)
    get().apply(s)
  }
}))
