import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import type { ProviderId } from '@shared/types'
import { PROVIDER_LABELS, DEFAULT_MODELS } from '@shared/providers'
import { SUPPORTED_LANGUAGES } from '@renderer/i18n/i18n'
import { useSettings } from '@renderer/store/settings'
import { useUi } from '@renderer/store/ui'

const ACCENT_PRESETS = [
  { label: 'Blue', value: '#4c8dff' },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Purple', value: '#a855f7' },
  { label: 'Cyan', value: '#06b6d4' },
  { label: 'Green', value: '#22c55e' },
  { label: 'Amber', value: '#f59e0b' },
  { label: 'Rose', value: '#f43f5e' },
]

type TestState = Record<string, { status: 'idle' | 'testing' | 'ok' | 'fail'; error?: string }>

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
  const [tests, setTests] = useState<TestState>({})
  const [defaultModels, setDefaultModels] = useState<string[]>([])

  useEffect(() => {
    if (settings) setOllamaUrl(settings.providers.ollama.baseUrl)
  }, [settings])

  useEffect(() => {
    if (!settings) return
    setDefaultModels(DEFAULT_MODELS[settings.defaultProvider])
    let cancelled = false
    void window.api.listModels(settings.defaultProvider).then((list) => {
      if (!cancelled && list.length) setDefaultModels(list)
    })
    return () => {
      cancelled = true
    }
  }, [settings?.defaultProvider])

  if (!show || !settings) return null

  const saveKey = (provider: ProviderId): void => {
    const key = keyInputs[provider]
    if (!key) return
    void patch({ providerKey: { provider, key } })
    setKeyInputs((s) => ({ ...s, [provider]: '' }))
  }
  const clearKey = (provider: ProviderId): void =>
    void patch({ providerKey: { provider, key: null } })

  const testKey = async (provider: ProviderId): Promise<void> => {
    setTests((s) => ({ ...s, [provider]: { status: 'testing' } }))
    const res = await window.api.testProviderKey(provider)
    setTests((s) => ({
      ...s,
      [provider]: res.ok ? { status: 'ok' } : { status: 'fail', error: res.error }
    }))
  }

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
              const test = tests[p]
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
                      <button
                        className="btn"
                        onClick={() => testKey(p)}
                        disabled={!meta.keySet || test?.status === 'testing'}
                      >
                        {test?.status === 'testing' ? t('settings.testing') : t('settings.test')}
                      </button>
                      <button className="btn danger" onClick={() => clearKey(p)} disabled={!meta.keySet}>
                        {t('settings.clear')}
                      </button>
                    </div>
                    {test?.status === 'ok' && <span className="hint ok">✓ {t('settings.testOk')}</span>}
                    {test?.status === 'fail' && (
                      <span className="hint fail">✗ {test.error || t('settings.testFail')}</span>
                    )}
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
                  {defaultModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
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
