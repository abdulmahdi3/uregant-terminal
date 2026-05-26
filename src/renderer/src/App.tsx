import { useEffect } from 'react'
import clsx from 'clsx'
import TitleBar from './components/TitleBar'
import Workspace from './components/Workspace'
import StatusBar from './components/StatusBar'
import CommandPalette from './components/CommandPalette'
import ShortcutsModal from './components/ShortcutsModal'
import SettingsModal from './components/SettingsModal'
import TelegramLinkModal from './components/TelegramLinkModal'
import TaskManagerModal from './components/TaskManagerModal'
import AskAllModal from './components/AskAllModal'
import Toaster from './components/Toaster'
import CopiedFlash from './components/CopiedFlash'
import { useSettings } from './store/settings'
import { useUi } from './store/ui'
import { startMetricsLoop } from './store/metrics'
import { useHotkeys } from './hooks/useHotkeys'
import { usePersistence } from './hooks/usePersistence'
import { useChainForwarding } from './hooks/useChainForwarding'
import { useTelegramForwarding } from './hooks/useTelegramForwarding'
import { usePaneRegistry } from './hooks/usePaneRegistry'
import { useBroadcast } from './hooks/useBroadcast'
import { refreshWslDistros } from './lib/shells'
import { refreshAgentAvailability } from './lib/agents'

export default function App(): JSX.Element {
  const load = useSettings((s) => s.load)
  const appTheme = useUi((s) => s.appTheme)

  useHotkeys()
  usePersistence()
  useChainForwarding()
  useTelegramForwarding()
  usePaneRegistry()
  useBroadcast()

  useEffect(() => {
    // Expose zoom control so the main process can zoom a pane for screenshots
    ;(window as unknown as Record<string, unknown>).__setZoomedPane =
      (id: string | null) => useUi.getState().setZoomedPaneId(id)
    return () => {
      delete (window as unknown as Record<string, unknown>).__setZoomedPane
    }
  }, [])

  useEffect(() => {
    void load()
    void refreshWslDistros() // populate the shell launcher with installed WSL distros
    void refreshAgentAvailability() // flag which agent CLIs are actually installed
    const stopMetrics = startMetricsLoop()
    const offSettings = window.api.onSettingsChanged((s) => useSettings.getState().apply(s))
    // Inbound Telegram messages are handled in useTelegramForwarding, which also
    // arms answer-tracking so replies are sent back to the chat.

    return () => {
      stopMetrics()
      offSettings()
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
      <TaskManagerModal />
      <AskAllModal />
      <ShortcutsModal />
      <Toaster />
      <CopiedFlash />
    </div>
  )
}
