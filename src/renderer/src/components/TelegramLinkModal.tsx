import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import clsx from 'clsx'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { useSettings } from '@renderer/store/settings'

export default function TelegramLinkModal(): JSX.Element | null {
  const { t } = useTranslation()
  const paneId = useUi((s) => s.linkingPaneId)
  const setLinkingPaneId = useUi((s) => s.setLinkingPaneId)
  const pane = useWorkspace((s) => (paneId ? s.panes[paneId] : null))
  const updatePane = useWorkspace((s) => s.updatePane)
  const defaultChat = useSettings((s) => s.settings?.telegram.defaultChatId)
  const [chatId, setChatId] = useState('')

  useEffect(() => {
    if (pane) setChatId(pane.telegramChatId ?? defaultChat ?? '')
  }, [pane, defaultChat])

  if (!paneId || !pane) return null

  const close = (): void => setLinkingPaneId(null)

  const chatIdValid = /^-?\d+$/.test(chatId.trim())

  const link = (): void => {
    if (!chatIdValid) return
    window.api.linkPaneToTelegram(paneId, chatId.trim())
    updatePane(paneId, { telegramChatId: chatId.trim() })
    close()
  }
  const unlink = (): void => {
    window.api.linkPaneToTelegram(paneId, null)
    updatePane(paneId, { telegramChatId: undefined })
    close()
  }

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>✈ {t('telegram.link')}</h2>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          {pane.telegramChatId && (
            <p className="hint ok">{t('telegram.linked', { chatId: pane.telegramChatId })}</p>
          )}
          <label className="settings-label">{t('telegram.chatIdPrompt')}</label>
          <input
            className={clsx('input', chatId.trim() && !chatIdValid && 'input-error')}
            value={chatId}
            autoFocus
            onChange={(e) => setChatId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && link()}
            placeholder="e.g. 123456789 or -100123456789"
            style={{ marginTop: 6 }}
          />
          {chatId.trim() && !chatIdValid && (
            <span className="hint fail" style={{ marginTop: 4, display: 'block' }}>
              Chat ID must be a number (e.g. 123456789 or -100123456789)
            </span>
          )}
          <div className="settings-actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={link} disabled={!chatIdValid}>
              {t('telegram.link')}
            </button>
            {pane.telegramChatId && (
              <button className="btn danger" onClick={unlink}>
                {t('telegram.unlink')}
              </button>
            )}
            <button className="btn" onClick={close}>
              {t('settings.close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
