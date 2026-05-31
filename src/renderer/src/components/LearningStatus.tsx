import { useEffect, useState } from 'react'
import { Brain } from 'lucide-react'
import clsx from 'clsx'
import { useUi } from '@renderer/store/ui'

/**
 * Status-bar indicator for the Hermes learning layer. When learning is enabled
 * it surfaces how many distilled learnings are waiting for review (the loop
 * otherwise queues them invisibly); clicking opens the Learning settings so they
 * can be approved/rejected. Hidden entirely while learning is off.
 */
export default function LearningStatus(): JSX.Element | null {
  const openSettings = useUi((s) => s.openSettings)
  const [enabled, setEnabled] = useState(false)
  const [pending, setPending] = useState(0)
  const [candidates, setCandidates] = useState(0)
  const api = window.api.learning

  useEffect(() => {
    let alive = true
    const refresh = (): void => {
      void api?.getConfig().then((c) => {
        if (alive) setEnabled(!!(c as { enabled?: boolean }).enabled)
      })
      void api?.listPendingOps().then((p) => {
        if (alive) setPending((p as unknown[])?.length ?? 0)
      })
      void api?.listCandidates().then((c) => {
        if (alive) setCandidates((c as unknown[])?.length ?? 0)
      })
    }
    refresh()
    const off = api?.onCandidates(() => refresh())
    // also re-poll periodically so a config toggle / new distillation is reflected
    const iv = window.setInterval(refresh, 20000)
    return () => {
      alive = false
      off?.()
      window.clearInterval(iv)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!enabled) return null

  const title =
    pending > 0
      ? `${pending} learning${pending === 1 ? '' : 's'} awaiting review — click to open`
      : candidates > 0
        ? `${candidates} session${candidates === 1 ? '' : 's'} gated for distillation`
        : 'Learning is on'

  return (
    <button
      className={clsx('sb-item sb-learning', pending > 0 && 'accent')}
      title={title}
      onClick={() => openSettings('learning')}
    >
      <Brain size={12} />
      {pending > 0 ? <span>{pending}</span> : candidates > 0 ? <span className="dim">{candidates}</span> : null}
    </button>
  )
}
