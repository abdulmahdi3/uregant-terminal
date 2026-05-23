import { useEffect } from 'react'
import clsx from 'clsx'
import TitleBar from './components/TitleBar'
import Workspace from './components/Workspace'
import StatusBar from './components/StatusBar'
import CommandPalette from './components/CommandPalette'
import ShortcutsModal from './components/ShortcutsModal'
import SettingsModal from './components/SettingsModal'
import TelegramLinkModal from './components/TelegramLinkModal'
import Toaster from './components/Toaster'
import { useSettings } from './store/settings'
import { useWorkspace } from './store/workspace'
import { useUi } from './store/ui'
import { startMetricsLoop } from './store/metrics'
import { useHotkeys } from './hooks/useHotkeys'
import { usePersistence } from './hooks/usePersistence'
import { useChainForwarding } from './hooks/useChainForwarding'
import { installChatStream } from './lib/chat'

export default function App(): JSX.Element {
  const load = useSettings((s) => s.load)
  const appTheme = useUi((s) => s.appTheme)

  useHotkeys()
  usePersistence()
  useChainForwarding()

  useEffect(() => {
    installChatStream()
    void load()
    const stopMetrics = startMetricsLoop()
    const offSettings = window.api.onSettingsChanged((s) => useSettings.getState().apply(s))

    // Inbound Telegram messages -> type into the target pane's terminal.
    const offInbound = window.api.onTelegramInbound(({ paneId, text }) => {
      const pane = useWorkspace.getState().panes[paneId]
      if (!pane) return
      const ptyId = pane.type === 'ai' ? pane.agent?.ptyId : pane.shell?.ptyId
      if (ptyId) window.api.writePty(ptyId, text + '\r')
    })

    return () => {
      stopMetrics()
      offSettings()
      offInbound()
    }
  }, [load])

  return (
    <div className={clsx('app', appTheme !== 'dark' && `theme-${appTheme}`)}>
      <TitleBar />
      <main className="workspace-root">
        <Workspace />
      </main>
      <StatusBar />

      <CommandPalette />
      <SettingsModal />
      <TelegramLinkModal />
      <ShortcutsModal />
      <Toaster />
    </div>
  )
}
