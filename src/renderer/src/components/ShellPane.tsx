import type { Pane } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'
import TerminalPane from './TerminalPane'

const HOME = process.env.HOME ?? process.env.USERPROFILE

export default function ShellPane({ pane }: { pane: Pane }): JSX.Element {
  const updatePane = useWorkspace((s) => s.updatePane)
  const cwd = pane.shell?.cwd ?? HOME
  return (
    <TerminalPane
      paneId={pane.id}
      cwd={cwd}
      onReady={(ptyId, shell) => updatePane(pane.id, { shell: { shell, ptyId, cwd } })}
    />
  )
}
