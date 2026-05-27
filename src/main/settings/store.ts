import { safeStorage } from 'electron'
import Store from 'electron-store'
import type {
  ProviderId,
  SettingsPublic,
  SettingsPatch,
  ThemeName,
  AppPrefs
} from '@shared/types'
import { DEFAULT_PREFS } from '@shared/types'
import { DEFAULT_MODELS, DEFAULT_OLLAMA_URL, DEFAULT_AGENT } from '@shared/providers'

interface RawSettings {
  providers: {
    anthropic: { keyEnc?: string }
    openai: { keyEnc?: string }
    gemini: { keyEnc?: string }
    ollama: { baseUrl: string }
  }
  telegram: { tokenEnc?: string; defaultChatId?: string }
  defaultProvider: ProviderId
  defaultModel: string
  defaultAgent: string
  defaultShell: string
  defaultShellArgs: string[]
  theme: ThemeName
  accentColor: string
  prefs: AppPrefs
}

const DEFAULTS: RawSettings = {
  providers: {
    anthropic: {},
    openai: {},
    gemini: {},
    ollama: { baseUrl: DEFAULT_OLLAMA_URL }
  },
  telegram: {},
  defaultProvider: 'anthropic',
  defaultModel: DEFAULT_MODELS.anthropic[0],
  defaultAgent: DEFAULT_AGENT,
  defaultShell: '',
  defaultShellArgs: [],
  theme: 'dark',
  accentColor: '#4c8dff',
  prefs: DEFAULT_PREFS
}

function encrypt(plain: string): string {
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(plain).toString('base64')
  }
  // Fallback (e.g. OS keychain unavailable): mark as plain so we can still read it.
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
}

function decrypt(stored: string | undefined): string | undefined {
  if (!stored) return undefined
  try {
    if (stored.startsWith('enc:')) {
      return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
    if (stored.startsWith('plain:')) {
      return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    }
  } catch {
    return undefined
  }
  return undefined
}

function preview(key: string | undefined): string | undefined {
  if (!key) return undefined
  const tail = key.slice(-4)
  return `••••${tail}`
}

export class SettingsStore {
  private store = new Store<RawSettings>({ name: 'urterminal-settings', defaults: DEFAULTS })

  private raw(): RawSettings {
    // electron-store merges defaults, but nested objects may be partial.
    const s = this.store.store
    return {
      ...DEFAULTS,
      ...s,
      providers: {
        anthropic: { ...s.providers?.anthropic },
        openai: { ...s.providers?.openai },
        gemini: { ...s.providers?.gemini },
        ollama: { baseUrl: s.providers?.ollama?.baseUrl || DEFAULT_OLLAMA_URL }
      },
      telegram: { ...s.telegram },
      prefs: { ...DEFAULT_PREFS, ...s.prefs }
    }
  }

  getPublic(telegramRunning = false, botUsername?: string, telegramError?: string): SettingsPublic {
    const s = this.raw()
    const aKey = decrypt(s.providers.anthropic.keyEnc)
    const oKey = decrypt(s.providers.openai.keyEnc)
    const gKey = decrypt(s.providers.gemini.keyEnc)
    const tToken = decrypt(s.telegram.tokenEnc)
    return {
      providers: {
        anthropic: { keySet: !!aKey, keyPreview: preview(aKey) },
        openai: { keySet: !!oKey, keyPreview: preview(oKey) },
        gemini: { keySet: !!gKey, keyPreview: preview(gKey) },
        ollama: { baseUrl: s.providers.ollama.baseUrl }
      },
      telegram: {
        tokenSet: !!tToken,
        tokenPreview: preview(tToken),
        defaultChatId: s.telegram.defaultChatId,
        running: telegramRunning,
        botUsername,
        error: telegramError
      },
      defaultProvider: s.defaultProvider,
      defaultModel: s.defaultModel,
      defaultAgent: s.defaultAgent || DEFAULT_AGENT,
      defaultShell: s.defaultShell || '',
      defaultShellArgs: s.defaultShellArgs || [],
      theme: s.theme,
      accentColor: s.accentColor || '#4c8dff',
      prefs: { ...DEFAULT_PREFS, ...s.prefs }
    }
  }

  getPrefs(): AppPrefs {
    return { ...DEFAULT_PREFS, ...this.raw().prefs }
  }

  getApiKey(provider: ProviderId): string | undefined {
    const s = this.raw()
    if (provider === 'anthropic') return decrypt(s.providers.anthropic.keyEnc)
    if (provider === 'openai') return decrypt(s.providers.openai.keyEnc)
    if (provider === 'gemini') return decrypt(s.providers.gemini.keyEnc)
    return undefined
  }

  getOllamaBaseUrl(): string {
    return this.raw().providers.ollama.baseUrl
  }

  getTelegramToken(): string | undefined {
    return decrypt(this.raw().telegram.tokenEnc)
  }

  getTelegramDefaultChat(): string | undefined {
    return this.raw().telegram.defaultChatId
  }

  patch(patch: SettingsPatch): void {
    const s = this.raw()

    if (patch.providerKey) {
      const { provider, key } = patch.providerKey
      if (provider === 'ollama') {
        // ollama uses baseUrl, not a key
      } else {
        const enc = key ? encrypt(key) : undefined
        s.providers[provider] = enc ? { keyEnc: enc } : {}
      }
    }
    if (patch.ollamaBaseUrl !== undefined) {
      s.providers.ollama.baseUrl = patch.ollamaBaseUrl || DEFAULT_OLLAMA_URL
    }
    if (patch.telegramToken !== undefined) {
      s.telegram.tokenEnc = patch.telegramToken ? encrypt(patch.telegramToken) : undefined
    }
    if (patch.telegramDefaultChatId !== undefined) {
      s.telegram.defaultChatId = patch.telegramDefaultChatId || undefined
    }
    if (patch.defaultProvider) s.defaultProvider = patch.defaultProvider
    if (patch.defaultModel !== undefined) s.defaultModel = patch.defaultModel
    if (patch.defaultAgent !== undefined) s.defaultAgent = patch.defaultAgent
    if (patch.defaultShell !== undefined) s.defaultShell = patch.defaultShell
    if (patch.defaultShellArgs !== undefined) s.defaultShellArgs = patch.defaultShellArgs
    if (patch.theme) s.theme = patch.theme
    if (patch.accentColor) s.accentColor = patch.accentColor
    if (patch.prefs) s.prefs = { ...DEFAULT_PREFS, ...s.prefs, ...patch.prefs }

    this.store.set(s)
  }
}
