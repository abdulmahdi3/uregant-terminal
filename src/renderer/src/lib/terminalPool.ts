import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { noteOutputChars } from './chat'
import { useTokens } from '@renderer/store/tokens'
import '@xterm/xterm/css/xterm.css'

const SCROLLBACK = 5000
// Hide the boot loader only once this many bytes have streamed — early terminal
// setup sequences are tiny, so a threshold avoids hiding the loader before the
// CLI has actually painted anything.
const START_BYTES = 150

const darkTheme = {
  background: '#0b0d12',
  foreground: '#e7ecf3',
  cursor: '#4c8dff',
  selectionBackground: '#264f78',
  black: '#484f58',
  brightBlack: '#6e7681',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightWhite: '#f0f6fc'
}

export interface TerminalOpts {
  command?: string
  cwd?: string
  onReady?: (ptyId: string, shell: string) => void
  onExit?: (code: number) => void
  /** fired once when the process produces its first output (boot finished) */
  onStarted?: () => void
}

interface Entry {
  term: Terminal
  fit: FitAddon
  command?: string
  cwd?: string
  ptyId: string | null
  onExit?: (code: number) => void
  onStarted?: () => void
  started: boolean
  bytes: number
  dispose: () => void
  lastCols: number
  lastRows: number
}

/** Whether a pane's process has already produced output (so no loader needed). */
export function isTerminalStarted(paneId: string): boolean {
  return pool.get(paneId)?.started ?? false
}

// ---- user-input notification (used by chain forwarding to detect a new turn) ----
type InputListener = (paneId: string) => void
const inputListeners = new Set<InputListener>()
export function onTerminalInput(cb: InputListener): () => void {
  inputListeners.add(cb)
  return () => inputListeners.delete(cb)
}

/** Current visible screen text of a pane's terminal (the "result in current state"). */
export function getScreenText(paneId: string): string {
  const entry = pool.get(paneId)
  if (!entry) return ''
  const term = entry.term
  const buf = term.buffer.active
  const lines: string[] = []
  for (let i = 0; i < term.rows; i++) {
    const line = buf.getLine(buf.viewportY + i)
    lines.push(line ? line.translateToString(true) : '')
  }
  return lines.join('\n')
}

/**
 * Terminals (xterm + their PTY) live here, keyed by pane id, independent of
 * React mount/unmount. This keeps the running CLI and its on-screen buffer
 * intact when a pane is re-parented (zoom, drag-rearrange) instead of killing
 * and respawning it — which was causing duplicated/cut banners and slow zoom.
 */
const pool = new Map<string, Entry>()

function createEntry(paneId: string, container: HTMLElement, opts: TerminalOpts): Entry {
  const term = new Terminal({
    fontFamily: "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
    fontSize: 13,
    scrollback: SCROLLBACK,
    cursorBlink: true,
    allowProposedApi: true,
    theme: darkTheme
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  term.open(container)
  fit.fit()

  const entry: Entry = {
    term,
    fit,
    command: opts.command,
    cwd: opts.cwd,
    ptyId: null,
    onExit: opts.onExit,
    onStarted: opts.onStarted,
    started: false,
    bytes: 0,
    lastCols: term.cols,
    lastRows: term.rows,
    dispose: () => {}
  }

  const onData = term.onData((d) => {
    if (entry.ptyId) window.api.writePty(entry.ptyId, d)
    inputListeners.forEach((cb) => cb(paneId))
  })
  const offData = window.api.onPtyData((e) => {
    if (e.paneId === paneId) {
      if (!entry.started) {
        entry.bytes += e.data.length
        if (entry.bytes >= START_BYTES) {
          entry.started = true
          entry.onStarted?.()
        }
      }
      term.write(e.data)
      noteOutputChars(e.data.length)
      useTokens.getState().note(e.data.length, paneId)
    }
  })
  const offExit = window.api.onPtyExit((e) => {
    if (e.paneId !== paneId) return
    if (entry.onExit) entry.onExit(e.exitCode)
    else term.write(`\r\n\x1b[90m[process exited: ${e.exitCode}]\x1b[0m\r\n`)
  })

  entry.dispose = (): void => {
    try {
      onData.dispose()
    } catch {
      /* noop */
    }
    offData()
    offExit()
    if (entry.ptyId) window.api.killPty(entry.ptyId)
    try {
      term.dispose()
    } catch {
      /* noop */
    }
  }

  pool.set(paneId, entry)

  void window.api
    .spawnPty({ paneId, cols: term.cols, rows: term.rows, command: opts.command, cwd: opts.cwd })
    .then((res) => {
      entry.ptyId = res.ptyId
      opts.onReady?.(res.ptyId, res.shell)
    })
    .catch((err: Error) => {
      const msg = opts.command
        ? `\r\n\x1b[31mCould not launch "${opts.command}". Is it installed and on your PATH?\x1b[0m\r\n${err.message}\r\n`
        : `\r\n\x1b[31mFailed to start shell.\x1b[0m\r\n${err.message}\r\n`
      term.write(msg)
    })

  return entry
}

/** Attach the pane's terminal to `container`, creating + spawning it on first use. */
export function mountTerminal(paneId: string, container: HTMLElement, opts: TerminalOpts): void {
  let entry = pool.get(paneId)
  // command/cwd changed (e.g. switched agent) → tear down and start fresh
  if (entry && (entry.command !== opts.command || entry.cwd !== opts.cwd)) {
    disposeTerminal(paneId)
    entry = undefined
  }
  if (!entry) {
    createEntry(paneId, container, opts)
    return
  }
  entry.onExit = opts.onExit
  entry.onStarted = opts.onStarted
  if (entry.started) opts.onStarted?.() // re-attach (e.g. zoom): already running
  if (entry.term.element && entry.term.element.parentElement !== container) {
    container.appendChild(entry.term.element)
  }
  fitTerminal(paneId)
  entry.term.refresh(0, entry.term.rows - 1)
}

/** Re-fit a terminal to its container and push the new size to the PTY (if changed). */
export function fitTerminal(paneId: string): void {
  const entry = pool.get(paneId)
  if (!entry) return
  try {
    entry.fit.fit()
    const { cols, rows } = entry.term
    if (entry.ptyId && (cols !== entry.lastCols || rows !== entry.lastRows)) {
      entry.lastCols = cols
      entry.lastRows = rows
      window.api.resizePty(entry.ptyId, cols, rows)
    }
  } catch {
    /* fit can throw if the element is detached mid-layout */
  }
}

/** Permanently tear down a pane's terminal + PTY (called when the pane is closed). */
export function disposeTerminal(paneId: string): void {
  const entry = pool.get(paneId)
  if (!entry) return
  pool.delete(paneId)
  entry.dispose()
  useTokens.getState().clearPane(paneId)
}
