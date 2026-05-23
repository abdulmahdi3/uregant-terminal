import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { useWorkspace } from './store/workspace'
import { useUi } from './store/ui'
import { sendChat, stopChat } from './lib/chat'
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './i18n/i18n'
import './styles/global.css'
import './styles/titlebar.css'
import './styles/workspace.css'
import './styles/ai.css'
import './styles/statusbar.css'
import './styles/palette.css'
import './styles/settings.css'
import './styles/themes.css'

// Debug handles for the scripted smoke/profiling harness (see src/main/smoke.ts).
const dbg = window as unknown as {
  __ws: typeof useWorkspace
  __ui: typeof useUi
  __chat: { sendChat: typeof sendChat; stopChat: typeof stopChat }
}
dbg.__ws = useWorkspace
dbg.__ui = useUi
dbg.__chat = { sendChat, stopChat }

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
