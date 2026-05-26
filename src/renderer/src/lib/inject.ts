import type { Pane } from '@shared/types'
import { useWorkspace } from '@renderer/store/workspace'

const ESC = String.fromCharCode(27)
/** Wrap text in bracketed-paste markers so the CLI treats it as a paste. */
export const bracketPaste = (s: string): string => `${ESC}[200~${s}${ESC}[201~`

export function ptyOf(pane: Pane | undefined): string | undefined {
  if (!pane) return undefined
  return pane.type === 'ai' ? pane.agent?.ptyId : pane.shell?.ptyId
}

/**
 * Paste text into a pane's terminal, optionally submitting it. Returns false if
 * the pane has no live PTY yet.
 */
export function injectText(paneId: string, text: string, submit = true): boolean {
  const pane = useWorkspace.getState().panes[paneId]
  const pty = ptyOf(pane)
  if (!pty) return false
  window.api.writePty(pty, bracketPaste(text))
  if (submit) window.setTimeout(() => window.api.writePty(pty, '\r'), 150)
  return true
}

/** Pane ids of every AI pane that has a live PTY. */
export function liveAiPaneIds(): string[] {
  return Object.values(useWorkspace.getState().panes)
    .filter((p) => p.type === 'ai' && p.agent?.ptyId)
    .map((p) => p.id)
}

/** Fan a single prompt out to every live AI pane. Returns how many it reached. */
export function askAllAgents(prompt: string): number {
  const ids = liveAiPaneIds()
  for (const id of ids) injectText(id, prompt, true)
  return ids.length
}
