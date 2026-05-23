import { create } from 'zustand'
import type { SettingsPublic, SettingsPatch } from '@shared/types'
import i18n from '@renderer/i18n/i18n'
import { useWorkspace } from './workspace'

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
  // Single refined dark theme — no in-face theme switcher by design.
  document.documentElement.setAttribute('data-theme', 'dark')
  document.documentElement.setAttribute('dir', s.language === 'ar' ? 'rtl' : 'ltr')
  if (i18n.language !== s.language) void i18n.changeLanguage(s.language)
  useWorkspace.getState().setDefaults(s.defaultProvider, s.defaultModel)
  applyAccentColor(s.accentColor || '#4c8dff')
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
