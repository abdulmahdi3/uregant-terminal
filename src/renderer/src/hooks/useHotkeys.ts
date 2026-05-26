import { useEffect } from 'react'
import { useUi } from '@renderer/store/ui'
import { useWorkspace } from '@renderer/store/workspace'
import { runCommand } from '@renderer/lib/commands'
import { eventToCombo } from '@renderer/lib/keys'
import { useShortcuts } from '@renderer/store/shortcuts'

function isTypingTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null
  if (!t) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || t.isContentEditable
}

/**
 * Single global keydown handler — the only place hotkeys are wired.
 * Keeping the chrome empty (no on-screen buttons) and routing everything
 * through here + the command palette is what keeps the UI uncluttered.
 */
export function useHotkeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey
      const ui = useUi.getState()

      // Command palette toggle — works everywhere.
      if (mod && !e.shiftKey && e.code === 'KeyK') {
        e.preventDefault()
        ui.toggleCommandPalette()
        return
      }

      // Scrollback search for the active pane.
      if (mod && !e.shiftKey && e.code === 'KeyF') {
        e.preventDefault()
        ui.setSearchOpen(true)
        return
      }

      // Escape: close search → clear pane selection → overlays → exit zoom.
      if (e.key === 'Escape') {
        if (ui.searchOpen) {
          ui.setSearchOpen(false)
          return
        }
        if (useWorkspace.getState().selectedPaneIds.length) {
          useWorkspace.getState().clearPaneSelection()
          return
        }
        if (
          ui.showCommandPalette ||
          ui.showSettings ||
          ui.showShortcuts ||
          ui.showAskAll ||
          ui.linkingPaneId
        ) {
          ui.closeOverlays()
          return
        }
        if (ui.zoomedPaneId) {
          ui.setZoomedPaneId(null)
          return
        }
        return
      }

      // User-assigned custom shortcuts (take priority over the built-ins below).
      const combo = eventToCombo(e)
      if (combo) {
        const custom = useShortcuts.getState().custom
        const id = Object.keys(custom).find((k) => custom[k] === combo)
        if (id) {
          e.preventDefault()
          runCommand(id)
          return
        }
      }

      // "?" cheatsheet — only when not typing.
      if (!mod && e.key === '?' && !isTypingTarget(e.target)) {
        e.preventDefault()
        runCommand('app.shortcuts')
        return
      }

      if (!mod) return

      // Ctrl/Cmd combinations.
      if (e.shiftKey) {
        switch (e.code) {
          case 'KeyD':
            e.preventDefault()
            return runCommand('pane.splitDown')
          case 'KeyT':
            e.preventDefault()
            return runCommand('pane.reopen')
          case 'KeyC':
            e.preventDefault()
            return runCommand('pane.openTerminal')
          case 'KeyS':
            e.preventDefault()
            return runCommand('pane.screenshot')
          case 'Digit5':
            e.preventDefault()
            return runCommand('pane.newShell')
          case 'Enter':
            e.preventDefault()
            return runCommand('pane.zoom')
        }
        return
      }

      switch (e.code) {
        case 'KeyT':
          e.preventDefault()
          return runCommand('pane.newAi')
        case 'KeyD':
          e.preventDefault()
          return runCommand('pane.splitRight')
        case 'KeyW':
          e.preventDefault()
          return runCommand('pane.close')
        case 'Comma':
          e.preventDefault()
          return runCommand('app.settings')
      }

      // Ctrl+1..9 focus pane
      if (/^Digit[1-9]$/.test(e.code)) {
        e.preventDefault()
        const n = Number(e.code.slice(5))
        useWorkspace.getState().focusByIndex(n - 1)
      }
    }

    // A plain click anywhere drops the pane selection. A drag-to-move ends with
    // a 'dragend' (no 'click' is dispatched), so moving panes is unaffected.
    const onClick = (): void => {
      const ws = useWorkspace.getState()
      if (ws.selectedPaneIds.length) ws.clearPaneSelection()
    }

    // Safety net: always drop the cross-workspace drag state when any drag ends
    // (a mosaic rearrange can otherwise leave the "new workspace" affordance up).
    const onDragEnd = (): void => useUi.getState().setDraggingPanes(null)

    window.addEventListener('keydown', onKey)
    window.addEventListener('click', onClick)
    window.addEventListener('dragend', onDragEnd)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('click', onClick)
      window.removeEventListener('dragend', onDragEnd)
    }
  }, [])
}
