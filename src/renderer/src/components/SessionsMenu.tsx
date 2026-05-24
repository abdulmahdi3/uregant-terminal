import { useEffect, useRef, useState } from 'react'
import { History, Save, RotateCcw, Trash2 } from 'lucide-react'
import clsx from 'clsx'
import { useSessions } from '@renderer/store/sessions'
import { toast } from '@renderer/store/toasts'

function relativeTime(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** Title-bar dropdown for saving the current workspace and restoring saved ones. */
export default function SessionsMenu(): JSX.Element {
  const sessions = useSessions((s) => s.sessions)
  const save = useSessions((s) => s.save)
  const restore = useSessions((s) => s.restore)
  const remove = useSessions((s) => s.remove)

  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const doSave = (): void => {
    const name = draft.trim() || `Session ${new Date().toLocaleString()}`
    save(name)
    setDraft('')
    toast(`Session saved: ${name}`, 'ok')
  }

  const doRestore = (id: string): void => {
    const s = restore(id)
    if (s) {
      toast(`Restored session: ${s.name}`, 'ok')
      setOpen(false)
    }
  }

  return (
    <div className="sessions-wrap" ref={wrapRef} data-nodrag>
      <button
        className={clsx('icon-btn sessions-btn', open && 'active')}
        title="Saved sessions"
        onClick={() => setOpen((v) => !v)}
      >
        <History size={13} />
      </button>

      {open && (
        <div className="sessions-menu">
          <div className="sessions-save">
            <input
              className="sessions-input"
              placeholder="Name this session…"
              value={draft}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doSave()
                if (e.key === 'Escape') setOpen(false)
              }}
            />
            <button className="btn sm primary" onClick={doSave} title="Save current workspace">
              <Save size={12} /> Save
            </button>
          </div>

          <div className="sessions-list">
            {sessions.length === 0 ? (
              <p className="sessions-empty">No saved sessions yet.</p>
            ) : (
              sessions.map((s) => (
                <div key={s.id} className="session-row">
                  <div className="session-info" onClick={() => doRestore(s.id)} title="Restore">
                    <span className="session-name">{s.name}</span>
                    <span className="session-meta">
                      {s.paneCount} pane{s.paneCount !== 1 ? 's' : ''} · {relativeTime(s.savedAt)}
                    </span>
                  </div>
                  <button
                    className="icon-btn"
                    title="Restore this session"
                    onClick={() => doRestore(s.id)}
                  >
                    <RotateCcw size={12} />
                  </button>
                  <button
                    className="icon-btn danger"
                    title="Delete session"
                    onClick={() => remove(s.id)}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
