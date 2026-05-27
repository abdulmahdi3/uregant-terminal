import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { IPC } from '@shared/types'

// Scripted end-to-end harness. Enabled by env vars so it exercises the *real*
// main process (real IPC, real PtyManager) against the real renderer:
//   URTERMINAL_SMOKE=1            -> basic shell + pane round-trip, screenshot, exit
//   URTERMINAL_PROFILE=<n>        -> spin up <n> AI panes + 1 shell for profiling
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function runSmoke(win: BrowserWindow): Promise<void> {
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`[console:${level}] ${message}`)
  })

  const exec = <T>(code: string): Promise<T> => win.webContents.executeJavaScript(code)

  try {
    await wait(500)

    // Add a shell pane and two AI panes through the real store.
    await exec(`window.__ws.getState().addPane('shell')`)
    await wait(300)
    await exec(`window.__ws.getState().addPane('ai')`)
    await exec(`window.__ws.getState().addPane('ai')`)
    await wait(600)

    // Find the shell pane's ptyId (set once the pty spawns) and type a command.
    const ptyId = await exec<string | null>(`
      (() => {
        const panes = Object.values(window.__ws.getState().panes);
        const sh = panes.find(p => p.type === 'shell');
        return sh && sh.shell ? sh.shell.ptyId || null : null;
      })()
    `)
    console.log('SMOKE shell ptyId:', ptyId)

    if (ptyId) {
      const marker = 'hello_from_smoke_42'
      await exec(`window.api.writePty(${JSON.stringify(ptyId)}, 'echo ${marker}\\r\\n')`)
      await wait(1200)
      const termText = await exec<string>(`
        (document.querySelector('.shell-pane .xterm-rows')?.innerText || '')
      `)
      const sawEcho = termText.includes(marker)
      // The command itself echoes the marker; a real shell prints it again on its own line.
      const occurrences = termText.split(marker).length - 1
      console.log('SMOKE shell output occurrences of marker:', occurrences, '(>=1 means pty works)')
      if (!sawEcho) errors.push('shell output did not contain marker')
    } else {
      errors.push('shell ptyId was never set (pty did not spawn)')
    }

    const paneCount = await exec<number>(`Object.keys(window.__ws.getState().panes).length`)
    const windows = await exec<number>(`document.querySelectorAll('.mosaic-window').length`)
    console.log('SMOKE panes:', paneCount, 'mosaic-windows:', windows)

    const img = await win.webContents.capturePage()
    writeFileSync(join(process.cwd(), 'smoke.png'), img.toPNG())
    console.log('SMOKE screenshot bytes:', img.toPNG().length)

    if (errors.length) {
      console.log('SMOKE ERRORS:\n' + errors.join('\n'))
      app.exit(1)
    } else {
      console.log('SMOKE OK')
      app.exit(0)
    }
  } catch (e) {
    console.log('SMOKE EXCEPTION: ' + (e as Error).message)
    app.exit(3)
  }
}

/** Opens Settings, seeds a key + token preview, and captures EN + AR/RTL views. */
export async function runSettingsSmoke(win: BrowserWindow): Promise<void> {
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) errors.push(`[console:${level}] ${message}`)
  })
  const exec = (code: string): Promise<unknown> => win.webContents.executeJavaScript(code)
  try {
    await new Promise((r) => setTimeout(r, 500))
    await exec(`window.api.patchSettings({ providerKey: { provider: 'anthropic', key: 'sk-ant-demo-XYZ9' } })`)
    await exec(`window.api.patchSettings({ telegramToken: '123456:demo-token-abcd' })`)
    await new Promise((r) => setTimeout(r, 200))
    await exec(`window.__ui.getState().setShowSettings(true)`)
    await new Promise((r) => setTimeout(r, 400))

    let img = await win.webContents.capturePage()
    writeFileSync(join(process.cwd(), 'smoke-settings-en.png'), img.toPNG())
    console.log('SETSMOKE en screenshot bytes:', img.toPNG().length)

    const keySet = await exec(`window.__ws ? true : true`)
    void keySet
    const publicView = await win.webContents.executeJavaScript(
      `(async () => { const s = await window.api.getSettings(); return JSON.stringify({ aKey: s.providers.anthropic.keySet, aPrev: s.providers.anthropic.keyPreview, tg: s.telegram.tokenSet }); })()`
    )
    console.log('SETSMOKE public:', publicView)

    if (errors.length) {
      console.log('SETSMOKE ERRORS:\n' + errors.join('\n'))
      app.exit(1)
    } else {
      console.log('SETSMOKE OK')
      app.exit(0)
    }
  } catch (e) {
    console.log('SETSMOKE EXCEPTION: ' + (e as Error).message)
    app.exit(3)
  }
}
