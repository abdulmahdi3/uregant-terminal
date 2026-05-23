import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react'
import clsx from 'clsx'
import { useWorkspace } from '@renderer/store/workspace'
import { getMosaicNeighbors } from '@renderer/lib/mosaicTree'

export default function PipeArrows({ paneId }: { paneId: string }): JSX.Element | null {
  const layout = useWorkspace((s) => s.layout)
  const pipeTo = useWorkspace((s) => s.panes[paneId]?.pipeTo)
  const setPipeTo = useWorkspace((s) => s.setPipeTo)

  if (!layout) return null

  const { left, right, up, down } = getMosaicNeighbors(layout, paneId)
  if (!left && !right && !up && !down) return null

  const toggle = (neighborId: string): void => {
    setPipeTo(paneId, pipeTo === neighborId ? undefined : neighborId)
  }

  return (
    <div className={clsx('pipe-arrows', pipeTo && 'has-active')}>
      {up && (
        <button
          className={clsx('pipe-arrow up', pipeTo === up && 'active')}
          onClick={(e) => { e.stopPropagation(); toggle(up) }}
          title={pipeTo === up ? 'Piping up — click to stop' : 'Pipe output to pane above'}
        >
          <ArrowUp size={11} />
        </button>
      )}
      {right && (
        <button
          className={clsx('pipe-arrow right', pipeTo === right && 'active')}
          onClick={(e) => { e.stopPropagation(); toggle(right) }}
          title={pipeTo === right ? 'Piping right — click to stop' : 'Pipe output to pane on right'}
        >
          <ArrowRight size={11} />
        </button>
      )}
      {down && (
        <button
          className={clsx('pipe-arrow down', pipeTo === down && 'active')}
          onClick={(e) => { e.stopPropagation(); toggle(down) }}
          title={pipeTo === down ? 'Piping down — click to stop' : 'Pipe output to pane below'}
        >
          <ArrowDown size={11} />
        </button>
      )}
      {left && (
        <button
          className={clsx('pipe-arrow left', pipeTo === left && 'active')}
          onClick={(e) => { e.stopPropagation(); toggle(left) }}
          title={pipeTo === left ? 'Piping left — click to stop' : 'Pipe output to pane on left'}
        >
          <ArrowLeft size={11} />
        </button>
      )}
    </div>
  )
}
