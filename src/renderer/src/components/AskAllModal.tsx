import { useEffect, useRef, useState } from 'react'
import { Bot, Send } from 'lucide-react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { askAllAgents, liveAiPaneIds } from '@renderer/lib/inject'
import { toast } from '@renderer/store/toasts'

/**
 * "Ask all agents": type one prompt and fan it out to every live AI pane so the
 * different agents (claude / codex / gemini / …) can be compared side by side.
 */
export default function AskAllModal(): JSX.Element | null {
  const show = useUi((s) => s.showAskAll)
  const setShow = useUi((s) => s.setShowAskAll)
  const panes = useWorkspace((s) => s.panes)
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (show) {
      setText('')
      requestAnimationFrame(() => ref.current?.focus())
    }
  }, [show])

  if (!show) return null

  const targets = liveAiPaneIds()
  const agentList = targets
    .map((id) => panes[id]?.agent?.command ?? panes[id]?.title)
    .filter(Boolean) as string[]

  const close = (): void => setShow(false)

  const send = (): void => {
    const prompt = text.trim()
    if (!prompt) return
    const n = askAllAgents(prompt)
    close()
    toast(n ? `Asked ${n} agent${n !== 1 ? 's' : ''}` : 'No running agent panes', n ? 'ok' : 'info')
  }

  return (
    <div className="modal-overlay" onMouseDown={close}>
      <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            <Bot size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            Ask all agents
          </h2>
          <button className="icon-btn" onClick={close}>
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="hint">
            {targets.length
              ? `Sends the same prompt to ${targets.length} agent pane${targets.length !== 1 ? 's' : ''}: ${agentList.join(', ')}`
              : 'No running agent panes — open one or more AI panes first.'}
          </p>
          <textarea
            ref={ref}
            className="input"
            rows={5}
            value={text}
            placeholder="Type a prompt to send to every agent…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                send()
              }
            }}
            style={{ marginTop: 6, resize: 'vertical', fontFamily: 'inherit' }}
          />
          <div className="settings-actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={send} disabled={!text.trim() || !targets.length}>
              <Send size={13} /> Send to all · Ctrl+Enter
            </button>
            <button className="btn" onClick={close}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
