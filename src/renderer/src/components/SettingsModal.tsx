import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import {
  Check, Search, Trash2, RotateCcw, Download, Upload, Keyboard,
  Volume2, Volume1, VolumeX, Play, Monitor, EyeOff,
  KeyRound, Cpu, Bot, SquareTerminal, Server,
  TextCursor, Rows3, MoveVertical, MoveHorizontal, ScrollText, SquareDashed, GripVertical,
  Bell, Copy, ClipboardPaste, PanelTop,
  Palette, Type, CaseSensitive, Droplet,
  FolderOpen, Save, Layers, Focus, History, Eraser, Languages,
  Send, MessageSquare, Users, Info
} from 'lucide-react'
import type { ProviderId, AppPrefs, SettingsPatch, IntegrationId, IntegrationStatus } from '@shared/types'
import { DEFAULT_PREFS } from '@shared/types'
import { PROVIDER_LABELS, DEFAULT_MODELS, latestModel, DEFAULT_AGENT } from '@shared/providers'
import { uid } from '@renderer/lib/snippets'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { toast } from '@renderer/store/toasts'
import { getShellSpecs, refreshWslDistros, type ShellSpec } from '@renderer/lib/shells'
import { getAgents, getAvailableAgents, refreshAgentAvailability } from '@renderer/lib/agents'
import { playDoneSound } from '@renderer/hooks/useDoneNotifications'
import LearningPanel from './LearningPanel'
import { LANGUAGES } from '@renderer/lib/translate'

const ACCENT_PRESETS = [
  { label: 'Blue', value: '#4c8dff' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Rose', value: '#f43f5e' },
]

// Common monospace families offered for terminals (layered over the built-in
// stack, so an unavailable one falls back gracefully). '' = built-in default.
const FONT_OPTIONS = [
  { value: '', label: 'Default (JetBrains Mono)' },
  { value: 'JetBrains Mono', label: 'JetBrains Mono' },
  { value: 'Cascadia Code', label: 'Cascadia Code' },
  { value: 'Cascadia Mono', label: 'Cascadia Mono' },
  { value: 'Consolas', label: 'Consolas' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Fira Code', label: 'Fira Code' },
  { value: 'Source Code Pro', label: 'Source Code Pro' },
  { value: 'Ubuntu Mono', label: 'Ubuntu Mono' },
  { value: 'Menlo', label: 'Menlo' },
  { value: 'Monaco', label: 'Monaco' }
]

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'amoled', label: 'AMOLED' },
  { value: 'ocean', label: 'Ocean' },
  { value: 'forest', label: 'Forest' },
  { value: 'dusk', label: 'Dusk' }
]

type KeyProvider = 'anthropic' | 'openai' | 'gemini'
const KEY_PROVIDERS: KeyProvider[] = ['anthropic', 'openai', 'gemini']

/** Pref keys reset by each section's "Reset" button. */
const SECTION_PREF_KEYS: Record<string, (keyof AppPrefs)[]> = {
  terminal: [
    'cursorStyle', 'cursorBlink', 'lineHeight', 'letterSpacing', 'scrollback',
    'terminalPadding', 'showPaneHeaders', 'scrollSensitivity', 'scrollbarWidth', 'terminalBell',
    'copyOnSelect', 'pasteOnRightClick'
  ],
  behavior: [
    'defaultShellCwd', 'autoSaveSeconds', 'maxRestorePanes',
    'focusNewPane', 'clearWorkspaceOnExit', 'autoRestore', 'defaultLanguage'
  ],
  notifications: [
    'notifyOnDone', 'notifySound', 'notifyOnlyUnfocused', 'notifyVolume', 'notifySoundName'
  ],
  appearance: ['appTheme', 'fontFamily', 'fontSize']
}

/** Small "Key set" / "Not set" status pill used by the key + token fields. */
function KeyStatus({ set }: { set: boolean }): JSX.Element {
  return (
    <span className={clsx('settings-status', set ? 'set' : 'unset')}>
      {set ? (
        <>
          <Check size={11} /> Key set
        </>
      ) : (
        'Not set'
      )}
    </span>
  )
}

/**
 * Metadata for the to-do service cards. Each service uses the connection
 * method that fits it best — Todoist and Notion offer simple personal tokens
 * we can paste; TickTick / Microsoft To Do / Google Tasks require a registered
 * OAuth client to fully sign in, so they fall back to "open the service" plus
 * an access-token paste once the user has one.
 */
type IntegrationKind = 'token' | 'oauth'
interface IntegrationMeta {
  id: IntegrationId
  name: string
  initials: string
  kind: IntegrationKind
  /** false = shown grayed-out with "Coming soon" — only TickTick is wired up right now */
  active: boolean
  desc: string
  /** where to get a token / sign in */
  setupUrl: string
  setupLabel: string
  /** placeholder shown in the token input */
  tokenPlaceholder: string
}
const INTEGRATIONS: IntegrationMeta[] = [
  {
    id: 'ticktick',
    name: 'TickTick',
    initials: 'TT',
    kind: 'oauth',
    active: true,
    desc: 'OAuth sign-in — paste a TickTick access token once you have one, or open TickTick to manage your tasks.',
    setupUrl: 'https://developer.ticktick.com/',
    setupLabel: 'TickTick developer portal',
    tokenPlaceholder: 'Access token'
  },
  {
    id: 'todoist',
    name: 'Todoist',
    initials: 'TD',
    kind: 'token',
    active: false,
    desc: 'Connect with a personal API token to sync your Todoist tasks alongside your notes.',
    setupUrl: 'https://app.todoist.com/app/settings/integrations/developer',
    setupLabel: 'Get my Todoist token',
    tokenPlaceholder: 'Personal API token'
  },
  {
    id: 'microsoftTodo',
    name: 'Microsoft To Do',
    initials: 'MS',
    kind: 'oauth',
    active: false,
    desc: 'Microsoft Graph access token. Use the Graph Explorer to generate one for the Tasks.ReadWrite scope.',
    setupUrl: 'https://developer.microsoft.com/en-us/graph/graph-explorer',
    setupLabel: 'Open Graph Explorer',
    tokenPlaceholder: 'Graph access token'
  },
  {
    id: 'googleTasks',
    name: 'Google Tasks',
    initials: 'GT',
    kind: 'oauth',
    active: true,
    desc: 'Paste a Google OAuth access token with the Tasks scope (e.g. from the OAuth Playground). URterminal validates it, then you can pull your agenda or quick-add tasks from the command palette.',
    setupUrl: 'https://developers.google.com/oauthplayground/',
    setupLabel: 'Open OAuth Playground (select Tasks API v1)',
    tokenPlaceholder: 'OAuth access token'
  },
  {
    id: 'notion',
    name: 'Notion',
    initials: 'No',
    kind: 'token',
    active: false,
    desc: 'Create an internal integration in Notion, share a database with it, and paste its secret here.',
    setupUrl: 'https://www.notion.so/my-integrations',
    setupLabel: 'Create a Notion integration',
    tokenPlaceholder: 'Internal integration secret'
  }
]

/**
 * TickTick has its own form because it's the only integration that's actually
 * wired up. It needs the user's registered app credentials (clientId +
 * clientSecret) and runs a full OAuth code-grant flow via the main process.
 */
function TickTickCard({
  status,
  onSaveClient,
  onConnect,
  onDisconnect
}: {
  status: import('@shared/types').TickTickStatus
  onSaveClient: (clientId: string, clientSecret: string) => Promise<void>
  onConnect: () => Promise<void>
  onDisconnect: () => Promise<void>
}): JSX.Element {
  const [clientId, setClientId] = useState(status.clientId ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const credsReady = !!(clientId.trim() && (clientSecret.trim() || status.clientSecretSet))
  const connected = status.connected

  return (
    <div className={clsx('integration-card', connected && 'connected')}>
      <div className="integration-head">
        <span className="integration-logo ticktick">TT</span>
        <h4 className="integration-title">TickTick</h4>
        <span className={clsx('integration-status', connected && 'connected')}>
          {connected ? 'Connected' : credsReady ? 'Ready to connect' : 'Setup required'}
        </span>
      </div>
      <p className="integration-desc">
        Register an app on the TickTick developer portal with redirect URI{' '}
        <code>http://localhost:23123/callback</code>, then paste the client ID and secret here
        and click <strong>Connect</strong> to sign in.
      </p>

      <div className="integration-field">
        <label>Client ID</label>
        <input
          type="text"
          placeholder="Client ID from developer.ticktick.com"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="integration-field">
        <label>Client secret</label>
        <input
          type="password"
          placeholder={status.clientSecretSet ? '•••• saved' : 'Client secret'}
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>

      <div className="integration-actions">
        <button
          className="btn sm"
          disabled={busy || (!clientId.trim() && !clientSecret.trim())}
          onClick={async () => {
            setBusy(true)
            try {
              await onSaveClient(clientId.trim(), clientSecret.trim())
              setClientSecret('')
            } finally {
              setBusy(false)
            }
          }}
        >
          Save credentials
        </button>
        <button
          className="btn primary sm"
          disabled={busy || !credsReady}
          onClick={async () => {
            // Persist any unsaved creds first so the OAuth flow can read them.
            if (clientId.trim() || clientSecret.trim()) {
              await onSaveClient(clientId.trim(), clientSecret.trim())
              setClientSecret('')
            }
            setBusy(true)
            try {
              await onConnect()
            } finally {
              setBusy(false)
            }
          }}
        >
          {connected ? 'Reconnect' : 'Connect via OAuth'}
        </button>
        {connected && (
          <button
            className="btn danger sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onDisconnect()
              } finally {
                setBusy(false)
              }
            }}
          >
            Disconnect
          </button>
        )}
      </div>
      <div className="integration-help">
        <a href="https://developer.ticktick.com/" target="_blank" rel="noreferrer">
          Open TickTick developer portal ↗
        </a>
      </div>
    </div>
  )
}

/** One card in the Integrations section — token input + connect/disconnect. */
function IntegrationCard({
  meta,
  status,
  onConnect,
  onDisconnect
}: {
  meta: IntegrationMeta
  status: IntegrationStatus
  onConnect: (token: string) => void
  onDisconnect: () => void
}): JSX.Element {
  const [token, setToken] = useState('')
  const connected = status.connected
  const disabled = !meta.active
  return (
    <div className={clsx('integration-card', connected && 'connected', disabled && 'inactive')}>
      <div className="integration-head">
        <span className={clsx('integration-logo', meta.id)}>{meta.initials}</span>
        <h4 className="integration-title">{meta.name}</h4>
        <span className={clsx('integration-status', connected && 'connected', disabled && 'inactive')}>
          {disabled ? 'Coming soon' : connected ? 'Connected' : 'Not connected'}
        </span>
      </div>
      <p className="integration-desc">{meta.desc}</p>
      <div className="integration-actions">
        <input
          type="password"
          placeholder={meta.tokenPlaceholder}
          value={token}
          disabled={disabled}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !disabled && token.trim()) {
              onConnect(token.trim())
              setToken('')
            }
          }}
        />
        <button
          className="btn primary sm"
          disabled={disabled || !token.trim()}
          onClick={() => {
            onConnect(token.trim())
            setToken('')
          }}
        >
          {connected ? 'Update' : 'Connect'}
        </button>
        {connected && !disabled && (
          <button className="btn danger sm" onClick={onDisconnect} title="Disconnect">
            Disconnect
          </button>
        )}
      </div>
      <div className="integration-help">
        {disabled ? (
          <span>Not yet implemented — only TickTick can be connected for now.</span>
        ) : (
          <a href={meta.setupUrl} target="_blank" rel="noreferrer">
            {meta.setupLabel} ↗
          </a>
        )}
      </div>
    </div>
  )
}

/** Pill toggle switch (snaps instantly — no transitions, per project style). */
function Switch({
  checked,
  onChange,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}): JSX.Element {
  return (
    <input
      className="settings-switch"
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
    />
  )
}

/**
 * The shared settings card used by every page: an icon badge + title +
 * optional description, with a control on the right (selects/inputs/switch) or
 * stacked full-width below the text for wide controls (textareas, button rows).
 * Pass `as="label"` for toggle cards so the whole card is clickable.
 */
function SettingCard({
  icon,
  title,
  desc,
  control,
  as = 'div',
  stacked = false
}: {
  icon?: ReactNode
  title: ReactNode
  desc?: ReactNode
  control: ReactNode
  as?: 'label' | 'div'
  stacked?: boolean
}): JSX.Element {
  const Tag = (as === 'label' ? 'label' : 'div') as 'label'
  return (
    <Tag className={clsx('setting-card', as === 'label' && 'as-label', stacked && 'stacked')}>
      {icon && <span className="setting-card-icon">{icon}</span>}
      <span className="setting-card-main">
        <span className="setting-card-text">
          <span className="setting-card-title">{title}</span>
          {desc && <span className="setting-card-desc">{desc}</span>}
        </span>
        {stacked && <span className="setting-card-control stacked">{control}</span>}
      </span>
      {!stacked && <span className="setting-card-control">{control}</span>}
    </Tag>
  )
}

/** Toggle card: a SettingCard whose control is the pill Switch. */
function ToggleCard({
  icon,
  title,
  desc,
  checked,
  onChange
}: {
  icon?: ReactNode
  title: ReactNode
  desc?: ReactNode
  checked: boolean
  onChange: (v: boolean) => void
}): JSX.Element {
  return (
    <SettingCard
      as="label"
      icon={icon}
      title={title}
      desc={desc}
      control={<Switch checked={checked} onChange={onChange} />}
    />
  )
}

export default function SettingsModal(): JSX.Element | null {
  const { t } = useTranslation()
  const show = useUi((s) => s.showSettings)
  const setShow = useUi((s) => s.setShowSettings)
  const settingsSection = useUi((s) => s.settingsSection)
  const setShowShortcuts = useUi((s) => s.setShowShortcuts)
  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)

  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [ollamaUrlError, setOllamaUrlError] = useState('')
  const [tgToken, setTgToken] = useState('')
  const [defaultModels, setDefaultModels] = useState<string[]>([])
  const [shells, setShells] = useState<ShellSpec[]>(getShellSpecs())
  const [agents, setAgents] = useState(getAgents())
  const [availableAgents, setAvailableAgents] = useState<Set<string>>(getAvailableAgents())
  const [snipName, setSnipName] = useState('')
  const [snipKind, setSnipKind] = useState<'prompt' | 'shell'>('prompt')
  const [snipBody, setSnipBody] = useState('')
  const [appVersion, setAppVersion] = useState('')

  // two-pane navigation + filtering
  const [query, setQuery] = useState('')
  const [active, setActive] = useState('providers')
  const contentRef = useRef<HTMLDivElement>(null)
  const sectionEls = useRef<Record<string, HTMLElement | null>>({})
  const importRef = useRef<HTMLInputElement>(null)

  // WSL distros + agent availability are detected asynchronously.
  useEffect(() => {
    void refreshWslDistros().then(() => setShells(getShellSpecs()))
    void refreshAgentAvailability().then((s) => {
      setAgents([...getAgents()])
      setAvailableAgents(new Set(s))
    })
    void window.api.getAppInfo().then((i) => setAppVersion(i.version)).catch(() => {})
  }, [])

  useEffect(() => {
    if (settings) setOllamaUrl(settings.providers.ollama.baseUrl)
  }, [settings])

  // Jump straight to a section when opened via openSettings('learning') etc.
  useEffect(() => {
    if (settingsSection) {
      setActive(settingsSection)
      setQuery('')
      useUi.setState({ settingsSection: null })
    }
  }, [settingsSection])

  useEffect(() => {
    if (!settings) return
    const models = DEFAULT_MODELS[settings.defaultProvider]
    setDefaultModels(models)
    if (!settings.defaultModel || !models.includes(settings.defaultModel)) {
      void patch({ defaultModel: latestModel(settings.defaultProvider) })
    }
  }, [settings?.defaultProvider])

  if (!show || !settings) return null
  const prefs = settings.prefs

  // Map the stored default shell (binary + args) back to a spec id for the <select>.
  const currentShellId = ((): string => {
    if (!settings.defaultShell) return 'default'
    const argsKey = (settings.defaultShellArgs ?? []).join(' ')
    const m = shells.find(
      (s) => s.file === settings.defaultShell && (s.args ?? []).join(' ') === argsKey
    )
    return m?.id ?? 'default'
  })()

  // ---- helpers ----
  const setPref = (p: Partial<AppPrefs>): void => void patch({ prefs: p })

  const saveKey = (provider: ProviderId): void => {
    const key = keyInputs[provider]
    if (!key) return
    void patch({ providerKey: { provider, key } })
    setKeyInputs((s) => ({ ...s, [provider]: '' }))
  }
  const clearKey = (provider: ProviderId): void => void patch({ providerKey: { provider, key: null } })

  const snippets = prefs.snippets ?? []
  const addSnippet = (): void => {
    if (!snipName.trim() || !snipBody.trim()) return
    void patch({
      prefs: {
        snippets: [...snippets, { id: uid(), name: snipName.trim(), body: snipBody, kind: snipKind }]
      }
    })
    setSnipName('')
    setSnipBody('')
  }
  const removeSnippet = (id: string): void =>
    void patch({ prefs: { snippets: snippets.filter((s) => s.id !== id) } })

  const resetSection = (id: string): void => {
    const keys = SECTION_PREF_KEYS[id]
    if (keys) {
      const p: Record<string, unknown> = {}
      for (const k of keys) p[k] = DEFAULT_PREFS[k]
      void patch({ prefs: p as Partial<AppPrefs> })
    }
    if (id === 'appearance') void patch({ accentColor: '#4c8dff' })
  }

  const exportSettings = (): void => {
    const data = {
      _app: 'urterminal',
      version: 1,
      prefs: settings.prefs,
      accentColor: settings.accentColor,
      defaultProvider: settings.defaultProvider,
      defaultModel: settings.defaultModel,
      defaultAgent: settings.defaultAgent,
      defaultShell: settings.defaultShell,
      defaultShellArgs: settings.defaultShellArgs
    }
    void window.api
      .saveFile({ defaultName: 'urterminal-settings.json', contents: JSON.stringify(data, null, 2) })
      .then((r) => {
        if (r.ok) toast('Settings exported', 'ok')
        else if (!r.canceled) toast(`Export failed: ${r.error ?? 'unknown error'}`, 'error')
      })
  }

  const onImportFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file) return
    const reader = new FileReader()
    reader.onload = (): void => {
      try {
        const d = JSON.parse(String(reader.result)) as Record<string, unknown>
        const p: SettingsPatch = {}
        if (d.prefs && typeof d.prefs === 'object') p.prefs = d.prefs as Partial<AppPrefs>
        if (typeof d.accentColor === 'string') p.accentColor = d.accentColor
        if (typeof d.defaultProvider === 'string') p.defaultProvider = d.defaultProvider as ProviderId
        if (typeof d.defaultModel === 'string') p.defaultModel = d.defaultModel
        if (typeof d.defaultAgent === 'string') p.defaultAgent = d.defaultAgent
        if (typeof d.defaultShell === 'string') p.defaultShell = d.defaultShell
        if (Array.isArray(d.defaultShellArgs)) p.defaultShellArgs = d.defaultShellArgs as string[]
        void patch(p)
        toast('Settings imported', 'ok')
      } catch {
        toast('Invalid settings file', 'error')
      }
    }
    reader.readAsText(file)
  }

  const resetAllData = (): void => {
    if (!window.confirm('Reset ALL settings and clear saved sessions/workspace? This cannot be undone.')) return
    void patch({
      prefs: { ...DEFAULT_PREFS },
      accentColor: '#4c8dff',
      defaultAgent: DEFAULT_AGENT,
      defaultShell: '',
      defaultShellArgs: []
    })
    try {
      localStorage.removeItem('urterminal.shortcuts.v1')
      localStorage.removeItem('urterminal.workspace.v1')
      localStorage.removeItem('urterminal.autoRestore')
    } catch {
      /* ignore */
    }
    void window.api.writeSessions([])
    void window.api.writeLastSession({ panes: {}, layout: null, transcripts: {}, savedAt: Date.now() })
    window.setTimeout(() => location.reload(), 200)
  }

  // ---- section metadata (sidebar nav + search filtering) ----
  const labels: Record<string, string[]> = {
    providers: [PROVIDER_LABELS.anthropic, PROVIDER_LABELS.openai, PROVIDER_LABELS.gemini, PROVIDER_LABELS.ollama],
    defaults: [t('settings.defaultProvider'), t('settings.defaultModel'), 'Default agent', 'Default terminal'],
    terminal: [
      'Cursor style', 'Cursor blink', 'Line height', 'Letter spacing', 'Scrollback',
      'Terminal padding', 'Scroll sensitivity', 'Scrollbar width', 'Terminal bell sound', 'Copy on select',
      'Paste on right-click', 'Show pane title bars'
    ],
    appearance: ['Theme', 'Terminal font', 'Font size', 'Accent Color'],
    behavior: [
      'Default shell folder', 'Auto-save interval', 'Max restored panes',
      'Focus new pane on create',
      'Reopen last workspace on launch', 'Clear workspace on exit',
      'Default language', 'Translate'
    ],
    notifications: [
      'Desktop notification when an agent finishes', 'Play a sound when an agent finishes',
      'Only notify when window is unfocused', 'Notification sound', 'Notification volume'
    ],
    telegram: [t('settings.telegramToken'), t('settings.telegramDefaultChat'), 'Allowed chats'],
    integrations: ['Integrations', 'Todoist', 'TickTick', 'Microsoft To Do', 'Google Tasks', 'Notion'],
    snippets: ['Snippets'],
    keyboard: ['Keyboard shortcuts'],
    learning: ['Learning', 'Cross-agent learning', 'Distillation', 'Review candidates', 'Brain store', 'Hermes'],
    about: ['About', 'Version', 'Export settings', 'Import settings', 'Reset all data']
  }
  const SECTIONS: { id: string; title: string }[] = [
    { id: 'providers', title: t('settings.providers') },
    { id: 'defaults', title: t('settings.defaults') },
    { id: 'terminal', title: 'Terminal' },
    { id: 'appearance', title: t('settings.appearance') },
    { id: 'behavior', title: 'Behavior' },
    { id: 'notifications', title: 'Notifications' },
    { id: 'telegram', title: t('settings.telegram') },
    { id: 'integrations', title: 'Integrations' },
    { id: 'snippets', title: 'Snippets' },
    { id: 'keyboard', title: 'Keyboard' },
    { id: 'learning', title: 'Learning' },
    { id: 'about', title: 'About' }
  ]

  const q = query.trim().toLowerCase()
  const match = (label: string): boolean => !q || label.toLowerCase().includes(q)
  const sectionVisible = (id: string, title: string): boolean =>
    !q || title.toLowerCase().includes(q) || (labels[id] ?? []).some((l) => l.toLowerCase().includes(q))
  const visibleSections = SECTIONS.filter((s) => sectionVisible(s.id, s.title))

  // Pages, not one long scroll: clicking a nav item switches to that page,
  // clears any search filter, and resets the scroll to the top.
  const goTo = (id: string): void => {
    setActive(id)
    setQuery('')
    if (contentRef.current) contentRef.current.scrollTop = 0
  }
  // When searching we temporarily show every matching section stacked so a
  // setting can be found across pages; otherwise only the active page renders.
  const showSection = (id: string, title: string): boolean =>
    q ? sectionVisible(id, title) : active === id
  const sectionRef = (id: string) => (el: HTMLElement | null): void => {
    sectionEls.current[id] = el
  }

  /** Section <h3> with an optional per-section reset button. */
  const Head = ({ id, title }: { id: string; title: string }): JSX.Element => (
    <div className="settings-section-head">
      <h3>{title}</h3>
      {SECTION_PREF_KEYS[id] && (
        <button className="btn ghost sm settings-reset" title="Reset this section to defaults" onClick={() => resetSection(id)}>
          <RotateCcw size={11} /> Reset
        </button>
      )}
    </div>
  )

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal settings" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('settings.title')}</h2>
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>

        <div className="settings-layout">
          <aside className="settings-nav">
            <div className="settings-search">
              <Search size={13} />
              <input
                className="settings-search-input"
                placeholder="Search settings…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <nav className="settings-nav-list">
              {SECTIONS.map((s) => {
                const dim = !visibleSections.some((v) => v.id === s.id)
                return (
                  <button
                    key={s.id}
                    className={clsx('settings-nav-item', active === s.id && 'active', dim && 'dim')}
                    onClick={() => goTo(s.id)}
                  >
                    {s.title}
                  </button>
                )
              })}
            </nav>
          </aside>

          <div className="settings-content" ref={contentRef}>
            {visibleSections.length === 0 && (
              <p className="settings-empty">No settings match “{query}”.</p>
            )}

            {/* Providers */}
            {showSection('providers', t('settings.providers')) && (
              <section className="settings-section" ref={sectionRef('providers')}>
                <Head id="providers" title={t('settings.providers')} />
                <p className="settings-block-hint notif-intro">
                  Bring your own API keys. They’re encrypted on disk via the OS keychain and never leave this machine.
                </p>
                {KEY_PROVIDERS.map((p) => {
                  const meta = settings.providers[p]
                  if (!match(PROVIDER_LABELS[p])) return null
                  return (
                    <SettingCard
                      key={p}
                      stacked
                      icon={<KeyRound size={16} />}
                      title={PROVIDER_LABELS[p]}
                      desc={meta.keySet ? 'A key is saved for this provider.' : 'No key set yet.'}
                      control={
                        <>
                          <input
                            className="input"
                            type="password"
                            placeholder={meta.keySet ? `•••• ${meta.keyPreview ?? ''}` : t('settings.apiKey')}
                            value={keyInputs[p] ?? ''}
                            onChange={(e) => setKeyInputs((s) => ({ ...s, [p]: e.target.value }))}
                          />
                          <div className="settings-actions">
                            <KeyStatus set={meta.keySet} />
                            <button className="btn primary" onClick={() => saveKey(p)} disabled={!keyInputs[p]}>
                              {t('settings.save')}
                            </button>
                            <button className="btn danger" onClick={() => clearKey(p)} disabled={!meta.keySet}>
                              {t('settings.clear')}
                            </button>
                          </div>
                        </>
                      }
                    />
                  )
                })}
                {match(PROVIDER_LABELS.ollama) && (
                  <SettingCard
                    stacked
                    icon={<Server size={16} />}
                    title={PROVIDER_LABELS.ollama}
                    desc="Run models locally — set your Ollama server URL."
                    control={
                      <>
                        <input
                          className={clsx('input', ollamaUrlError && 'input-error')}
                          value={ollamaUrl}
                          placeholder={t('settings.baseUrl')}
                          onChange={(e) => { setOllamaUrl(e.target.value); setOllamaUrlError('') }}
                          onBlur={() => {
                            if (!ollamaUrl) { patch({ ollamaBaseUrl: ollamaUrl }); return }
                            try {
                              const u = new URL(ollamaUrl)
                              if (!u.protocol.startsWith('http')) throw new Error()
                              setOllamaUrlError('')
                              patch({ ollamaBaseUrl: ollamaUrl })
                            } catch {
                              setOllamaUrlError('Must be a valid http:// or https:// URL')
                            }
                          }}
                        />
                        {ollamaUrlError && <span className="hint fail">{ollamaUrlError}</span>}
                      </>
                    }
                  />
                )}
              </section>
            )}

            {/* Defaults */}
            {showSection('defaults', t('settings.defaults')) && (
              <section className="settings-section" ref={sectionRef('defaults')}>
                <Head id="defaults" title={t('settings.defaults')} />
                {match(t('settings.defaultProvider')) && (
                  <SettingCard
                    icon={<Server size={16} />}
                    title={t('settings.defaultProvider')}
                    desc="Provider used for new AI panes."
                    control={
                      <select
                        className="select"
                        value={settings.defaultProvider}
                        onChange={(e) => patch({ defaultProvider: e.target.value as ProviderId, defaultModel: '' })}
                      >
                        {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((p) => (
                          <option key={p} value={p}>{PROVIDER_LABELS[p]}</option>
                        ))}
                      </select>
                    }
                  />
                )}
                {match(t('settings.defaultModel')) && (
                  <SettingCard
                    icon={<Cpu size={16} />}
                    title={t('settings.defaultModel')}
                    desc="Defaults to the latest model; updates as new ones ship."
                    control={
                      <select
                        className="select"
                        value={settings.defaultModel}
                        onChange={(e) => patch({ defaultModel: e.target.value })}
                      >
                        {!defaultModels.includes(settings.defaultModel) && settings.defaultModel && (
                          <option value={settings.defaultModel}>{settings.defaultModel}</option>
                        )}
                        {defaultModels.map((m, i) => (
                          <option key={m} value={m}>{m}{i === 0 ? ' — latest' : ''}</option>
                        ))}
                      </select>
                    }
                  />
                )}
                {match('Default agent') && (
                  <SettingCard
                    icon={<Bot size={16} />}
                    title="Default agent"
                    desc="New AI panes launch this CLI by default."
                    control={
                      <select className="select" value={settings.defaultAgent} onChange={(e) => patch({ defaultAgent: e.target.value })}>
                        {agents.map((a) => {
                          const unavailable = availableAgents.size > 0 && !availableAgents.has(a.id)
                          return <option key={a.id} value={a.id} disabled={unavailable}>{a.label}</option>
                        })}
                      </select>
                    }
                  />
                )}
                {match('Default terminal') && (
                  <SettingCard
                    icon={<SquareTerminal size={16} />}
                    title="Default terminal"
                    desc="New shell panes launch this by default."
                    control={
                      <select
                        className="select"
                        value={currentShellId}
                        onChange={(e) => {
                          if (e.target.value === 'default') { void patch({ defaultShell: '', defaultShellArgs: [] }); return }
                          const spec = shells.find((s) => s.id === e.target.value)
                          if (spec) void patch({ defaultShell: spec.file, defaultShellArgs: spec.args ?? [] })
                        }}
                      >
                        <option value="default">OS default</option>
                        {shells.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </select>
                    }
                  />
                )}
              </section>
            )}

            {/* Terminal */}
            {showSection('terminal', 'Terminal') && (
              <section className="settings-section" ref={sectionRef('terminal')}>
                <Head id="terminal" title="Terminal" />
                {match('Cursor style') && (
                  <SettingCard icon={<TextCursor size={16} />} title="Cursor style" control={
                    <select className="select" value={prefs.cursorStyle} onChange={(e) => setPref({ cursorStyle: e.target.value as AppPrefs['cursorStyle'] })}>
                      <option value="block">Block</option>
                      <option value="bar">Bar</option>
                      <option value="underline">Underline</option>
                    </select>
                  } />
                )}
                {match('Line height') && (
                  <SettingCard icon={<Rows3 size={16} />} title="Line height" desc="1.0 = default" control={
                    <input className="input num" type="number" min={0.8} max={2.5} step={0.05} value={prefs.lineHeight}
                      onChange={(e) => setPref({ lineHeight: Number(e.target.value) || 1 })} />
                  } />
                )}
                {match('Letter spacing') && (
                  <SettingCard icon={<MoveHorizontal size={16} />} title="Letter spacing" desc="Pixels between characters." control={
                    <input className="input num" type="number" min={-2} max={8} step={0.5} value={prefs.letterSpacing}
                      onChange={(e) => setPref({ letterSpacing: Number(e.target.value) || 0 })} />
                  } />
                )}
                {match('Scrollback') && (
                  <SettingCard icon={<ScrollText size={16} />} title="Scrollback" desc="Lines kept in the scroll buffer." control={
                    <input className="input num" type="number" min={100} max={200000} step={500} value={prefs.scrollback}
                      onChange={(e) => setPref({ scrollback: Math.max(100, Number(e.target.value) || 5000) })} />
                  } />
                )}
                {match('Terminal padding') && (
                  <SettingCard icon={<SquareDashed size={16} />} title="Terminal padding" desc="Pixels around terminal contents." control={
                    <input className="input num" type="number" min={0} max={40} step={1} value={prefs.terminalPadding}
                      onChange={(e) => setPref({ terminalPadding: Math.max(0, Number(e.target.value) || 0) })} />
                  } />
                )}
                {match('Scroll sensitivity') && (
                  <SettingCard icon={<MoveVertical size={16} />} title="Scroll sensitivity" desc="Mouse-wheel speed multiplier." control={
                    <input className="input num" type="number" min={1} max={10} step={1} value={prefs.scrollSensitivity}
                      onChange={(e) => setPref({ scrollSensitivity: Math.max(1, Number(e.target.value) || 1) })} />
                  } />
                )}
                {match('Scrollbar width') && (
                  <SettingCard icon={<GripVertical size={16} />} title="Scrollbar width" desc="Thickness of the scrollbars, in pixels." control={
                    <input className="input num" type="number" min={6} max={28} step={1} value={prefs.scrollbarWidth ?? 14}
                      onChange={(e) => setPref({ scrollbarWidth: Math.max(6, Math.min(28, Number(e.target.value) || 14)) })} />
                  } />
                )}
                {match('Cursor blink') && (
                  <ToggleCard icon={<TextCursor size={16} />} title="Cursor blink" desc="Blink the terminal cursor." checked={prefs.cursorBlink} onChange={(v) => setPref({ cursorBlink: v })} />
                )}
                {match('Terminal bell sound') && (
                  <ToggleCard icon={<Bell size={16} />} title="Terminal bell sound" desc="Play the system bell on the BEL character." checked={prefs.terminalBell} onChange={(v) => setPref({ terminalBell: v })} />
                )}
                {match('Copy on select') && (
                  <ToggleCard icon={<Copy size={16} />} title="Copy on select" desc="Selecting text copies it to the clipboard." checked={prefs.copyOnSelect} onChange={(v) => setPref({ copyOnSelect: v })} />
                )}
                {match('Paste on right-click') && (
                  <ToggleCard icon={<ClipboardPaste size={16} />} title="Paste on right-click" desc="Right-click pastes the clipboard." checked={prefs.pasteOnRightClick} onChange={(v) => setPref({ pasteOnRightClick: v })} />
                )}
                {match('Show pane title bars') && (
                  <ToggleCard icon={<PanelTop size={16} />} title="Show pane title bars" desc="Display the header bar on each pane." checked={prefs.showPaneHeaders} onChange={(v) => setPref({ showPaneHeaders: v })} />
                )}
              </section>
            )}

            {/* Appearance */}
            {showSection('appearance', t('settings.appearance')) && (
              <section className="settings-section" ref={sectionRef('appearance')}>
                <Head id="appearance" title={t('settings.appearance')} />
                {match('Theme') && (
                  <SettingCard icon={<Palette size={16} />} title="Theme" desc="Terminals stay dark; “System” follows your OS." control={
                    <select className="select" value={prefs.appTheme} onChange={(e) => setPref({ appTheme: e.target.value })}>
                      {THEME_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  } />
                )}
                {match('Terminal font') && (
                  <SettingCard icon={<Type size={16} />} title="Terminal font" desc="Font family for all terminals." control={
                    <select className="select" value={prefs.fontFamily} onChange={(e) => setPref({ fontFamily: e.target.value })}>
                      {!FONT_OPTIONS.some((f) => f.value === prefs.fontFamily) && prefs.fontFamily && (
                        <option value={prefs.fontFamily}>{prefs.fontFamily} (custom)</option>
                      )}
                      {FONT_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  } />
                )}
                {match('Font size') && (
                  <SettingCard icon={<CaseSensitive size={16} />} title="Font size" desc="Terminal text size." control={
                    <select className="select" value={prefs.fontSize || 13} onChange={(e) => setPref({ fontSize: Number(e.target.value) })}>
                      {[10, 11, 12, 13, 14, 15, 16, 18, 20].map((n) => <option key={n} value={n}>{n}px</option>)}
                    </select>
                  } />
                )}
                {match('Accent Color') && (
                  <SettingCard stacked icon={<Droplet size={16} />} title="Accent color" desc="Changes the UI accent color globally." control={
                    <div className="color-picker-row">
                      {ACCENT_PRESETS.map((p) => (
                        <button key={p.value} className={clsx('color-swatch', settings.accentColor === p.value && 'active')}
                          style={{ background: p.value }} onClick={() => patch({ accentColor: p.value })} title={p.label} />
                      ))}
                      <label className="color-custom-label" title="Custom color">
                        <input type="color" value={settings.accentColor || '#4c8dff'}
                          onChange={(e) => patch({ accentColor: e.target.value })} className="color-custom-input" />
                        <span className={clsx('color-swatch', 'color-custom-preview', !ACCENT_PRESETS.some((p) => p.value === settings.accentColor) && 'active')}
                          style={{ background: settings.accentColor || '#4c8dff' }}>
                          <span className="color-custom-plus">+</span>
                        </span>
                      </label>
                    </div>
                  } />
                )}
              </section>
            )}

            {/* Behavior */}
            {showSection('behavior', 'Behavior') && (
              <section className="settings-section" ref={sectionRef('behavior')}>
                <Head id="behavior" title="Behavior" />
                {match('Default shell folder') && (
                  <SettingCard stacked icon={<FolderOpen size={16} />} title="Default shell folder" desc="New shell panes open here (empty = home)." control={
                    <input className="input mono" placeholder="e.g. F:\\projects" defaultValue={prefs.defaultShellCwd}
                      onBlur={(e) => setPref({ defaultShellCwd: e.target.value.trim() })} />
                  } />
                )}
                {match('Auto-save interval') && (
                  <SettingCard icon={<Save size={16} />} title="Auto-save interval" desc="Seconds between workspace auto-saves." control={
                    <input className="input num" type="number" min={1} max={120} step={1} value={prefs.autoSaveSeconds}
                      onChange={(e) => setPref({ autoSaveSeconds: Math.max(1, Number(e.target.value) || 1) })} />
                  } />
                )}
                {match('Max restored panes') && (
                  <SettingCard icon={<Layers size={16} />} title="Max restored panes" desc="0 = no limit." control={
                    <input className="input num" type="number" min={0} max={9} step={1} value={prefs.maxRestorePanes}
                      onChange={(e) => setPref({ maxRestorePanes: Math.max(0, Number(e.target.value) || 0) })} />
                  } />
                )}
                {match('Focus new pane on create') && (
                  <ToggleCard icon={<Focus size={16} />} title="Focus new pane on create" desc="Move focus to a pane as soon as it opens." checked={prefs.focusNewPane} onChange={(v) => setPref({ focusNewPane: v })} />
                )}
                {match('Reopen last workspace on launch') && (
                  <ToggleCard icon={<History size={16} />} title="Reopen last workspace on launch" desc="Restore your panes when the app starts." checked={prefs.autoRestore} onChange={(v) => setPref({ autoRestore: v })} />
                )}
                {match('Clear workspace on exit') && (
                  <ToggleCard icon={<Eraser size={16} />} title="Clear workspace on exit" desc="Start fresh next launch instead of restoring." checked={prefs.clearWorkspaceOnExit} onChange={(v) => setPref({ clearWorkspaceOnExit: v })} />
                )}
                {match('Default language') && (
                  <SettingCard icon={<Languages size={16} />} title="Default language" desc="Target language for “Translate selection → send to agents”." control={
                    <select className="select" value={prefs.defaultLanguage || 'English'} onChange={(e) => setPref({ defaultLanguage: e.target.value })}>
                      {!LANGUAGES.includes(prefs.defaultLanguage) && prefs.defaultLanguage && (
                        <option value={prefs.defaultLanguage}>{prefs.defaultLanguage}</option>
                      )}
                      {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                  } />
                )}
              </section>
            )}

            {/* Notifications */}
            {showSection('notifications', 'Notifications') && (
              <section className="settings-section" ref={sectionRef('notifications')}>
                <Head id="notifications" title="Notifications" />
                <p className="settings-block-hint notif-intro">
                  Get alerted when an AI agent finishes a turn and goes idle.
                </p>

                {/* Desktop + focus options as descriptive option cards */}
                {match('Desktop notification when an agent finishes') && (
                  <label className="notif-option">
                    <span className="notif-option-icon"><Monitor size={16} /></span>
                    <span className="notif-option-text">
                      <span className="notif-option-title">Desktop notifications</span>
                      <span className="notif-option-desc">Show a system pop-up when an agent finishes.</span>
                    </span>
                    <input
                      className="notif-switch"
                      type="checkbox"
                      checked={prefs.notifyOnDone}
                      onChange={(e) => setPref({ notifyOnDone: e.target.checked })}
                    />
                  </label>
                )}
                {match('Only notify when window is unfocused') && (
                  <label className="notif-option">
                    <span className="notif-option-icon"><EyeOff size={16} /></span>
                    <span className="notif-option-text">
                      <span className="notif-option-title">Only when unfocused</span>
                      <span className="notif-option-desc">Stay silent while URterminal is the active window.</span>
                    </span>
                    <input
                      className="notif-switch"
                      type="checkbox"
                      checked={prefs.notifyOnlyUnfocused}
                      onChange={(e) => setPref({ notifyOnlyUnfocused: e.target.checked })}
                    />
                  </label>
                )}

                {/* Sound: a card whose controls nest under (and depend on) the toggle */}
                {(match('Play a sound when an agent finishes') ||
                  match('Notification sound') ||
                  match('Notification volume')) && (
                  <div className={clsx('notif-sound-card', !prefs.notifySound && 'off')}>
                    <label className="notif-option notif-sound-head">
                      <span className="notif-option-icon">
                        {prefs.notifySound ? <Volume2 size={16} /> : <VolumeX size={16} />}
                      </span>
                      <span className="notif-option-text">
                        <span className="notif-option-title">Sound</span>
                        <span className="notif-option-desc">Play a chime when an agent finishes.</span>
                      </span>
                      <input
                        className="notif-switch"
                        type="checkbox"
                        checked={prefs.notifySound}
                        onChange={(e) => setPref({ notifySound: e.target.checked })}
                      />
                    </label>

                    <div className="notif-sound-controls" aria-hidden={!prefs.notifySound}>
                      <div className="notif-control">
                        <span className="notif-control-label">Tone</span>
                        <div className="notif-tone">
                          <select
                            className="select"
                            disabled={!prefs.notifySound}
                            value={prefs.notifySoundName}
                            onChange={(e) => setPref({ notifySoundName: e.target.value as AppPrefs['notifySoundName'] })}
                          >
                            <option value="chime">Chime</option>
                            <option value="beep">Beep</option>
                          </select>
                          <button
                            className="btn sm"
                            disabled={!prefs.notifySound || (prefs.notifyVolume ?? 0) === 0}
                            title="Preview sound"
                            onClick={() => playDoneSound(prefs.notifyVolume ?? 60, prefs.notifySoundName ?? 'chime')}
                          >
                            <Play size={12} /> Test
                          </button>
                        </div>
                      </div>

                      <div className="notif-control">
                        <span className="notif-control-label">Volume</span>
                        <div className="notif-volume">
                          {(prefs.notifyVolume ?? 0) === 0
                            ? <VolumeX size={15} className="notif-volume-icon" />
                            : (prefs.notifyVolume ?? 0) < 50
                              ? <Volume1 size={15} className="notif-volume-icon" />
                              : <Volume2 size={15} className="notif-volume-icon" />}
                          <input
                            className="notif-range"
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            disabled={!prefs.notifySound}
                            value={prefs.notifyVolume}
                            onChange={(e) => setPref({ notifyVolume: Number(e.target.value) })}
                          />
                          <span className="notif-volume-val">{prefs.notifyVolume}%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            )}

            {/* Telegram */}
            {showSection('telegram', t('settings.telegram')) && (
              <section className="settings-section" ref={sectionRef('telegram')}>
                <Head id="telegram" title={t('settings.telegram')} />
                {match(t('settings.telegramToken')) && (
                  <SettingCard
                    stacked
                    icon={<Send size={16} />}
                    title={t('settings.telegramToken')}
                    desc="Control URterminal from Telegram — screenshots, agents, tasks."
                    control={
                      <>
                        <input
                          className="input"
                          type="password"
                          placeholder={settings.telegram.tokenSet ? `•••• ${settings.telegram.tokenPreview ?? ''}` : t('settings.telegramToken')}
                          value={tgToken}
                          onChange={(e) => setTgToken(e.target.value)}
                        />
                        <div className="settings-actions">
                          <KeyStatus set={settings.telegram.tokenSet} />
                          <button className="btn primary" disabled={!tgToken} onClick={() => { void patch({ telegramToken: tgToken }); setTgToken('') }}>
                            {t('settings.save')}
                          </button>
                          <button className="btn danger" disabled={!settings.telegram.tokenSet} onClick={() => patch({ telegramToken: null })}>
                            {t('settings.clear')}
                          </button>
                          <button className="btn" onClick={() => window.api.restartTelegram().catch(() => {})}>
                            {t('settings.restart')}
                          </button>
                          <button
                            className="btn"
                            disabled={!settings.telegram.running}
                            onClick={() =>
                              void window.api.testTelegram().then((r) =>
                                toast(r.ok ? 'Test message sent' : `Test failed: ${r.error ?? 'unknown'}`, r.ok ? 'ok' : 'error')
                              )
                            }
                          >
                            Send test
                          </button>
                        </div>
                        <span className={'hint ' + (settings.telegram.running ? 'ok' : '')}>
                          {t('settings.telegramStatus')}:{' '}
                          {settings.telegram.running
                            ? `${t('settings.telegramRunning')}${settings.telegram.botUsername ? ` · @${settings.telegram.botUsername}` : ''}`
                            : t('settings.telegramStopped')}
                        </span>
                        {settings.telegram.error && !settings.telegram.running && (
                          <span className="hint fail">⚠ {settings.telegram.error}</span>
                        )}
                      </>
                    }
                  />
                )}
                {match(t('settings.telegramDefaultChat')) && (
                  <SettingCard stacked icon={<MessageSquare size={16} />} title={t('settings.telegramDefaultChat')} desc="Where screenshots and test messages are sent." control={
                    <input className="input" defaultValue={settings.telegram.defaultChatId ?? ''}
                      onBlur={(e) => patch({ telegramDefaultChatId: e.target.value || null })} />
                  } />
                )}
                {match('Allowed chats') && (
                  <SettingCard stacked icon={<Users size={16} />} title="Allowed chats" desc="Only these chat IDs may control the app (one per line). Empty = allow any chat." control={
                    <textarea
                      className="input mono"
                      rows={3}
                      defaultValue={(settings.prefs.telegramChatWhitelist ?? []).join('\n')}
                      placeholder="One chat ID per line"
                      onBlur={(e) => {
                        const ids = Array.from(new Set(e.target.value.split(/[\s,]+/).map((v) => v.trim()).filter((v) => /^-?\d+$/.test(v))))
                        patch({ prefs: { telegramChatWhitelist: ids } })
                      }}
                    />
                  } />
                )}
              </section>
            )}

            {/* Integrations — connect external to-do services */}
            {showSection('integrations', 'Integrations') && (
              <section className="settings-section" ref={sectionRef('integrations')}>
                <Head id="integrations" title="Integrations" />
                <span className="hint settings-block-hint">
                  Connect your favourite to-do services. Tokens are encrypted on disk
                  via the OS keychain and never leave this machine.
                </span>
                <div className="integrations-grid">
                  {INTEGRATIONS.map((meta) => {
                    if (meta.id === 'ticktick') {
                      const tt = settings.integrations?.ticktick ?? {
                        connected: false,
                        clientSecretSet: false
                      }
                      return (
                        <TickTickCard
                          key={meta.id}
                          status={tt}
                          onSaveClient={async (clientId, clientSecret) => {
                            const p: SettingsPatch = {}
                            if (clientId) p.tickTickClientId = clientId
                            if (clientSecret) p.tickTickClientSecret = clientSecret
                            if (Object.keys(p).length) await patch(p)
                          }}
                          onConnect={async () => {
                            try {
                              await window.api.tickTickConnect()
                              toast('TickTick connected', 'ok')
                            } catch (e) {
                              toast(`TickTick connect failed: ${(e as Error).message}`, 'error')
                            }
                          }}
                          onDisconnect={async () => {
                            try {
                              await window.api.tickTickDisconnect()
                              toast('TickTick disconnected', 'info')
                            } catch (e) {
                              toast(`Disconnect failed: ${(e as Error).message}`, 'error')
                            }
                          }}
                        />
                      )
                    }
                    return (
                      <IntegrationCard
                        key={meta.id}
                        meta={meta}
                        status={settings.integrations?.[meta.id] ?? { connected: false }}
                        onConnect={(token) => {
                          void (async () => {
                            await patch({ integrationToken: { id: meta.id, token } })
                            // Google Tasks: validate the pasted token against the API so a
                            // bad/expired token surfaces immediately instead of failing later.
                            if (meta.id === 'googleTasks') {
                              try {
                                await window.api.googleTasksVerify()
                                toast('Google Tasks connected', 'ok')
                              } catch (e) {
                                await patch({ integrationToken: { id: meta.id, token: null } })
                                toast(`Google Tasks token rejected: ${(e as Error).message}`, 'error')
                              }
                              return
                            }
                            toast(`${meta.name} connected`, 'ok')
                          })()
                        }}
                        onDisconnect={() => {
                          void patch({ integrationToken: { id: meta.id, token: null } })
                          toast(`${meta.name} disconnected`, 'info')
                        }}
                      />
                    )
                  })}
                </div>
              </section>
            )}

            {/* Snippets */}
            {showSection('snippets', 'Snippets') && (
              <section className="settings-section" ref={sectionRef('snippets')}>
                <Head id="snippets" title="Snippets" />
                <span className="hint settings-block-hint">
                  Reusable prompts / commands; insert into the active pane from the command palette.
                  Use <code>{'{{name}}'}</code> for fill-in variables.
                </span>
                {snippets.length > 0 && (
                  <div className="snippet-list">
                    {snippets.map((s) => (
                      <div className="snippet-item" key={s.id}>
                        <div className="snippet-item-head">
                          <span className={clsx('snippet-kind', s.kind)}>{s.kind}</span>
                          <span className="snippet-name">{s.name}</span>
                          <button className="icon-btn danger snippet-del" title={t('settings.clear')} onClick={() => removeSnippet(s.id)}>
                            <Trash2 size={13} />
                          </button>
                        </div>
                        <pre className="snippet-preview">{s.body}</pre>
                      </div>
                    ))}
                  </div>
                )}
                <div className="snippet-add">
                  <div className="snippet-add-row">
                    <input className="input" placeholder="Snippet name" value={snipName} onChange={(e) => setSnipName(e.target.value)} />
                    <select className="select snippet-add-kind" value={snipKind} onChange={(e) => setSnipKind(e.target.value as 'prompt' | 'shell')}>
                      <option value="prompt">prompt</option>
                      <option value="shell">shell</option>
                    </select>
                  </div>
                  <textarea className="input mono" rows={3} placeholder="Body — e.g. Review {{file}} for bugs" value={snipBody} onChange={(e) => setSnipBody(e.target.value)} />
                  <div className="settings-actions">
                    <button className="btn primary" onClick={addSnippet} disabled={!snipName.trim() || !snipBody.trim()}>Add snippet</button>
                  </div>
                </div>
              </section>
            )}

            {/* Keyboard */}
            {showSection('keyboard', 'Keyboard') && (
              <section className="settings-section" ref={sectionRef('keyboard')}>
                <Head id="keyboard" title="Keyboard" />
                <SettingCard
                  icon={<Keyboard size={16} />}
                  title="Keyboard shortcuts"
                  desc="View and remap every shortcut, with per-key reset and restore-defaults."
                  control={
                    <button className="btn" onClick={() => setShowShortcuts(true)}>
                      <Keyboard size={13} /> Open editor
                    </button>
                  }
                />
              </section>
            )}

            {/* Learning */}
            {showSection('learning', 'Learning') && (
              <section className="settings-section" ref={sectionRef('learning')}>
                <Head id="learning" title="Learning" />
                <LearningPanel />
              </section>
            )}

            {/* About */}
            {showSection('about', 'About') && (
              <section className="settings-section" ref={sectionRef('about')}>
                <Head id="about" title="About" />
                <SettingCard
                  icon={<Info size={16} />}
                  title="Version"
                  control={<span className="settings-static">URterminal {appVersion || '—'}</span>}
                />
                <SettingCard
                  icon={<Save size={16} />}
                  title="Settings file"
                  desc="Export your settings to a file, or import them on another machine."
                  control={
                    <>
                      <button className="btn" onClick={exportSettings}><Download size={13} /> Export…</button>
                      <button className="btn" onClick={() => importRef.current?.click()}><Upload size={13} /> Import…</button>
                      <input ref={importRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onImportFile} />
                    </>
                  }
                />
                <SettingCard
                  icon={<Trash2 size={16} />}
                  title="Reset all data"
                  desc="Restore all settings to defaults and clear saved sessions/workspace."
                  control={
                    <button className="btn danger" onClick={resetAllData}><Trash2 size={13} /> Reset all</button>
                  }
                />
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
