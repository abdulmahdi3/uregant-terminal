import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import type { ProviderId } from '@shared/types'
import { PROVIDER_LABELS, DEFAULT_MODELS, AGENTS, AGENT_LABELS, latestModel } from '@shared/providers'
import { uid } from '@renderer/lib/snippets'
import { SUPPORTED_LANGUAGES } from '@renderer/i18n/i18n'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'
import { getShellSpecs, refreshWslDistros, type ShellSpec } from '@renderer/lib/shells'
import { getAvailableAgents, refreshAgentAvailability } from '@renderer/lib/agents'

const ACCENT_PRESETS = [
  { label: 'Blue', value: '#4c8dff' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Rose', value: '#f43f5e' },
]

type KeyProvider = 'anthropic' | 'openai' | 'gemini'
const KEY_PROVIDERS: KeyProvider[] = ['anthropic', 'openai', 'gemini']

export default function SettingsModal(): JSX.Element | null {
  const { t } = useTranslation()
  const show = useUi((s) => s.showSettings)
  const setShow = useUi((s) => s.setShowSettings)
  const settings = useSettings((s) => s.settings)
  const patch = useSettings((s) => s.patch)

  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [ollamaUrl, setOllamaUrl] = useState('')
  const [ollamaUrlError, setOllamaUrlError] = useState('')
  const [tgToken, setTgToken] = useState('')
  const [defaultModels, setDefaultModels] = useState<string[]>([])
  const [shells, setShells] = useState<ShellSpec[]>(getShellSpecs())
  const [availableAgents, setAvailableAgents] = useState<Set<string>>(getAvailableAgents())
  const [snipName, setSnipName] = useState('')
  const [snipKind, setSnipKind] = useState<'prompt' | 'shell'>('prompt')
  const [snipBody, setSnipBody] = useState('')

  // WSL distros + agent availability are detected asynchronously.
  useEffect(() => {
    void refreshWslDistros().then(() => setShells(getShellSpecs()))
    void refreshAgentAvailability().then((s) => setAvailableAgents(new Set(s)))
  }, [])

  useEffect(() => {
    if (settings) setOllamaUrl(settings.providers.ollama.baseUrl)
  }, [settings])

  useEffect(() => {
    if (!settings) return
    const models = DEFAULT_MODELS[settings.defaultProvider]
    setDefaultModels(models)
    // Keep the default model up to date: if none chosen or it's no longer a known
    // model for this provider, snap to the latest (top of the list).
    if (!settings.defaultModel || !models.includes(settings.defaultModel)) {
      void patch({ defaultModel: latestModel(settings.defaultProvider) })
    }
  }, [settings?.defaultProvider])

  if (!show || !settings) return null

  // Map the stored default shell (binary + args) back to a spec id for the <select>.
  const currentShellId = ((): string => {
    if (!settings.defaultShell) return 'default'
    const argsKey = (settings.defaultShellArgs ?? []).join(' ')
    const match = shells.find(
      (s) => s.file === settings.defaultShell && (s.args ?? []).join(' ') === argsKey
    )
    return match?.id ?? 'default'
  })()

  const saveKey = (provider: ProviderId): void => {
    const key = keyInputs[provider]
    if (!key) return
    void patch({ providerKey: { provider, key } })
    setKeyInputs((s) => ({ ...s, [provider]: '' }))
  }
  const clearKey = (provider: ProviderId): void =>
    void patch({ providerKey: { provider, key: null } })

  const snippets = settings.prefs.snippets ?? []
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

  return (
    <div className="modal-overlay" onMouseDown={() => setShow(false)}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('settings.title')}</h2>
          <button className="icon-btn" onClick={() => setShow(false)}>
            ✕
          </button>
        </div>

        <div className="modal-body">
          {/* Providers */}
          <section className="settings-section">
            <h3>{t('settings.providers')}</h3>
            {KEY_PROVIDERS.map((p) => {
              const meta = settings.providers[p]
              return (
                <div className="settings-row" key={p}>
                  <label className="settings-label">{PROVIDER_LABELS[p]}</label>
                  <div className="settings-control">
                    <input
                      className="input"
                      type="password"
                      placeholder={
                        meta.keySet ? `${t('settings.keySet')} (${meta.keyPreview})` : t('settings.apiKey')
                      }
                      value={keyInputs[p] ?? ''}
                      onChange={(e) => setKeyInputs((s) => ({ ...s, [p]: e.target.value }))}
                    />
                    <div className="settings-actions">
                      <button className="btn primary" onClick={() => saveKey(p)} disabled={!keyInputs[p]}>
                        {t('settings.save')}
                      </button>
                      <button className="btn danger" onClick={() => clearKey(p)} disabled={!meta.keySet}>
                        {t('settings.clear')}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}

            <div className="settings-row">
              <label className="settings-label">{PROVIDER_LABELS.ollama}</label>
              <div className="settings-control">
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
              </div>
            </div>
          </section>

          {/* Telegram */}
          <section className="settings-section">
            <h3>{t('settings.telegram')}</h3>
            <div className="settings-row">
              <label className="settings-label">{t('settings.telegramToken')}</label>
              <div className="settings-control">
                <input
                  className="input"
                  type="password"
                  placeholder={
                    settings.telegram.tokenSet
                      ? `${t('settings.keySet')} (${settings.telegram.tokenPreview})`
                      : t('settings.telegramToken')
                  }
                  value={tgToken}
                  onChange={(e) => setTgToken(e.target.value)}
                />
                <div className="settings-actions">
                  <button
                    className="btn primary"
                    disabled={!tgToken}
                    onClick={() => {
                      void patch({ telegramToken: tgToken })
                      setTgToken('')
                    }}
                  >
                    {t('settings.save')}
                  </button>
                  <button
                    className="btn danger"
                    disabled={!settings.telegram.tokenSet}
                    onClick={() => patch({ telegramToken: null })}
                  >
                    {t('settings.clear')}
                  </button>
                  <button className="btn" onClick={() => window.api.restartTelegram().catch(() => {})}>
                    {t('settings.restart')}
                  </button>
                </div>
                <span className={'hint ' + (settings.telegram.running ? 'ok' : '')}>
                  {t('settings.telegramStatus')}:{' '}
                  {settings.telegram.running ? t('settings.telegramRunning') : t('settings.telegramStopped')}
                </span>
              </div>
            </div>
            <div className="settings-row">
              <label className="settings-label">{t('settings.telegramDefaultChat')}</label>
              <div className="settings-control">
                <input
                  className="input"
                  defaultValue={settings.telegram.defaultChatId ?? ''}
                  onBlur={(e) => patch({ telegramDefaultChatId: e.target.value || null })}
                />
              </div>
            </div>
            <div className="settings-row">
              <label className="settings-label">Allowed chats</label>
              <div className="settings-control">
                <textarea
                  className="input"
                  rows={3}
                  defaultValue={(settings.prefs.telegramChatWhitelist ?? []).join('\n')}
                  placeholder="One chat ID per line"
                  style={{ resize: 'vertical', fontFamily: 'var(--mono)' }}
                  onBlur={(e) => {
                    const ids = Array.from(
                      new Set(
                        e.target.value
                          .split(/[\s,]+/)
                          .map((v) => v.trim())
                          .filter((v) => /^-?\d+$/.test(v))
                      )
                    )
                    patch({ prefs: { telegramChatWhitelist: ids } })
                  }}
                />
                <span className="hint">
                  Only these chat IDs may control the app (one per line). Empty = allow any chat
                  that messages the bot.
                </span>
              </div>
            </div>
          </section>

          {/* Defaults */}
          <section className="settings-section">
            <h3>{t('settings.defaults')}</h3>
            <div className="settings-row">
              <label className="settings-label">{t('settings.defaultProvider')}</label>
              <div className="settings-control">
                <select
                  className="select"
                  value={settings.defaultProvider}
                  onChange={(e) => patch({ defaultProvider: e.target.value as ProviderId, defaultModel: '' })}
                >
                  {(Object.keys(PROVIDER_LABELS) as ProviderId[]).map((p) => (
                    <option key={p} value={p}>
                      {PROVIDER_LABELS[p]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="settings-row">
              <label className="settings-label">{t('settings.defaultModel')}</label>
              <div className="settings-control">
                <select
                  className="select"
                  value={settings.defaultModel}
                  onChange={(e) => patch({ defaultModel: e.target.value })}
                >
                  {!defaultModels.includes(settings.defaultModel) && settings.defaultModel && (
                    <option value={settings.defaultModel}>{settings.defaultModel}</option>
                  )}
                  {defaultModels.map((m, i) => (
                    <option key={m} value={m}>
                      {m}
                      {i === 0 ? ' — latest' : ''}
                    </option>
                  ))}
                </select>
                <span className="hint">Defaults to the latest model; updates as new ones ship.</span>
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-label">Default agent</label>
              <div className="settings-control">
                <select
                  className="select"
                  value={settings.defaultAgent}
                  onChange={(e) => patch({ defaultAgent: e.target.value })}
                >
                  {AGENTS.map((a) => {
                    const unavailable = availableAgents.size > 0 && !availableAgents.has(a)
                    return (
                      <option key={a} value={a} disabled={unavailable}>
                        {AGENT_LABELS[a]}
                      </option>
                    )
                  })}
                </select>
                <span className="hint">New AI panes launch this CLI by default.</span>
              </div>
            </div>

            <div className="settings-row">
              <label className="settings-label">Default terminal</label>
              <div className="settings-control">
                <select
                  className="select"
                  value={currentShellId}
                  onChange={(e) => {
                    if (e.target.value === 'default') {
                      void patch({ defaultShell: '', defaultShellArgs: [] })
                      return
                    }
                    const spec = shells.find((s) => s.id === e.target.value)
                    if (spec) void patch({ defaultShell: spec.file, defaultShellArgs: spec.args ?? [] })
                  }}
                >
                  <option value="default">OS default</option>
                  {shells.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <span className="hint">New shell panes launch this by default.</span>
              </div>
            </div>
          </section>

          {/* Notifications */}
          <section className="settings-section">
            <h3>Notifications</h3>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={!!settings.prefs.notifyOnDone}
                onChange={(e) => patch({ prefs: { notifyOnDone: e.target.checked } })}
              />
              <span>Desktop notification when an agent finishes</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={!!settings.prefs.notifySound}
                onChange={(e) => patch({ prefs: { notifySound: e.target.checked } })}
              />
              <span>Play a sound when an agent finishes</span>
            </label>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={!!settings.prefs.telegramNotifyOnDone}
                onChange={(e) => patch({ prefs: { telegramNotifyOnDone: e.target.checked } })}
              />
              <span>Send a Telegram message when a linked pane finishes</span>
            </label>
          </section>

          {/* Startup */}
          <section className="settings-section">
            <h3>Startup</h3>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={!!settings.prefs.autoRestore}
                onChange={(e) => patch({ prefs: { autoRestore: e.target.checked } })}
              />
              <span>Reopen the last workspace (panes + layout) on launch</span>
            </label>
          </section>

          {/* Snippets */}
          <section className="settings-section">
            <h3>Snippets</h3>
            <span className="hint" style={{ display: 'block', marginBottom: 8 }}>
              Reusable prompts / commands; insert into the active pane from the command palette.
              Use <code>{'{{name}}'}</code> for fill-in variables.
            </span>
            {snippets.length > 0 && (
              <div className="snippet-list">
                {snippets.map((s) => (
                  <div className="snippet-row" key={s.id}>
                    <span className={clsx('snippet-kind', s.kind)}>{s.kind}</span>
                    <span className="snippet-name" title={s.body}>
                      {s.name}
                    </span>
                    <button className="btn danger sm" onClick={() => removeSnippet(s.id)}>
                      {t('settings.clear')}
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="settings-row" style={{ marginTop: 8 }}>
              <div className="settings-control">
                <div className="settings-actions" style={{ marginBottom: 6 }}>
                  <input
                    className="input"
                    placeholder="Snippet name"
                    value={snipName}
                    onChange={(e) => setSnipName(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <select
                    className="select"
                    value={snipKind}
                    onChange={(e) => setSnipKind(e.target.value as 'prompt' | 'shell')}
                  >
                    <option value="prompt">prompt</option>
                    <option value="shell">shell</option>
                  </select>
                </div>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="Body — e.g. Review {{file}} for bugs"
                  value={snipBody}
                  onChange={(e) => setSnipBody(e.target.value)}
                  style={{ resize: 'vertical', fontFamily: 'var(--mono)' }}
                />
                <div className="settings-actions" style={{ marginTop: 6 }}>
                  <button
                    className="btn primary"
                    onClick={addSnippet}
                    disabled={!snipName.trim() || !snipBody.trim()}
                  >
                    Add snippet
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Appearance */}
          <section className="settings-section">
            <h3>{t('settings.appearance')}</h3>
            <div className="settings-row">
              <label className="settings-label">{t('settings.language')}</label>
              <div className="settings-control">
                <select
                  className="select"
                  value={settings.language}
                  onChange={(e) => patch({ language: e.target.value })}
                >
                  {SUPPORTED_LANGUAGES.map((l) => (
                    <option key={l.code} value={l.code}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="settings-row">
              <label className="settings-label">Accent Color</label>
              <div className="settings-control">
                <div className="color-picker-row">
                  {ACCENT_PRESETS.map((p) => (
                    <button
                      key={p.value}
                      className={clsx('color-swatch', settings.accentColor === p.value && 'active')}
                      style={{ background: p.value }}
                      onClick={() => patch({ accentColor: p.value })}
                      title={p.label}
                    />
                  ))}
                  <label className="color-custom-label" title="Custom color">
                    <input
                      type="color"
                      value={settings.accentColor || '#4c8dff'}
                      onChange={(e) => patch({ accentColor: e.target.value })}
                      className="color-custom-input"
                    />
                    <span
                      className={clsx(
                        'color-swatch',
                        'color-custom-preview',
                        !ACCENT_PRESETS.some((p) => p.value === settings.accentColor) && 'active'
                      )}
                      style={{ background: settings.accentColor || '#4c8dff' }}
                    >
                      <span className="color-custom-plus">+</span>
                    </span>
                  </label>
                </div>
                <span className="hint">Changes the UI accent color globally.</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
