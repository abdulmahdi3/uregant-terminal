import { app, dialog, BrowserWindow } from 'electron'
import pkg from 'electron-updater'

// electron-updater ships as CommonJS; the named export isn't reliable under
// the ESM/bundler interop, so pull autoUpdater off the default export.
const { autoUpdater } = pkg

/**
 * Wire up GitHub-based auto-update for the packaged NSIS install.
 *
 * On launch (packaged builds only) we ask GitHub Releases whether a newer
 * version exists, download it in the background, and once it's ready prompt
 * the user to restart now or later. Nothing happens in dev, in the portable
 * build, or when no newer release is published.
 */
export function initAutoUpdate(getWindow: () => BrowserWindow | null): void {
  // Auto-update only applies to an installed app. Skip dev runs entirely;
  // electron-updater also no-ops for the portable target (no install to patch).
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    // A failed update check must never break the running app — just log it.
    console.error('[updater]', err == null ? 'unknown error' : (err.stack ?? err).toString())
  })

  autoUpdater.on('update-downloaded', (info) => {
    const win = getWindow()
    void dialog
      .showMessageBox(win ?? new BrowserWindow({ show: false }), {
        type: 'info',
        buttons: ['Restart now', 'Later'],
        defaultId: 0,
        cancelId: 1,
        title: 'Update ready',
        message: `urterminal ${info.version} has been downloaded.`,
        detail: 'Restart the app to apply the update. It will also install automatically next time you quit.'
      })
      .then(({ response }) => {
        if (response === 0) {
          // isSilent=false shows the NSIS progress; isForceRunAfter relaunches.
          autoUpdater.quitAndInstall(false, true)
        }
      })
  })

  // Fire-and-forget; the .catch keeps an offline launch from logging an
  // unhandled rejection.
  autoUpdater.checkForUpdates().catch((err) => {
    console.error('[updater] check failed', err)
  })
}
