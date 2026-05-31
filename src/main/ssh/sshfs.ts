import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'

/**
 * SSHFS mounting for "agent over SSH": mount the remote folder as a local Windows
 * drive via SSHFS-Win (SFTP over SSH — nothing installed on the server), so a
 * LOCAL agent can open it and read/edit files like a normal folder. Commands that
 * must run ON the server still go through the urssh exec bridge.
 *
 * We use the DIRECT model — spawn sshfs.exe with `-o password_stdin` (the only
 * documented way to pass a password non-interactively; the `net use \\sshfs\`
 * provider can't take an inline password) — keep the process as the mount handle,
 * and unmount via the bundled umount.exe + terminating the process. Researched
 * against winfsp/sshfs-win docs.
 */

const PROGRAM_FILES = process.env.ProgramFiles || 'C:\\Program Files'
export const SSHFS_BIN = join(PROGRAM_FILES, 'SSHFS-Win', 'bin', 'sshfs.exe')

/** One-line winget install (WinFsp must precede SSHFS-Win) + docs URL. */
export const SSHFS_INSTALL = {
  installCommand:
    'winget install -e --id WinFsp.WinFsp --accept-package-agreements --accept-source-agreements && ' +
    'winget install -e --id SSHFS-Win.SSHFS-Win --accept-package-agreements --accept-source-agreements',
  url: 'https://github.com/winfsp/sshfs-win'
}

/** Whether SSHFS-Win is installed (its sshfs.exe implies WinFsp too, a dependency). */
export function sshfsInstalled(exists: (p: string) => boolean = existsSync): boolean {
  return exists(SSHFS_BIN)
}

/**
 * Pick a free drive letter, scanning Z → H so we don't collide with system/local
 * disks (A/B legacy, C system, and typical local letters). `isUsed(letter)` tells
 * us whether a letter is taken. Returns null if none free.
 */
export function pickFreeDrive(isUsed: (letter: string) => boolean): string | null {
  for (let c = 'Z'.charCodeAt(0); c >= 'H'.charCodeAt(0); c--) {
    const letter = String.fromCharCode(c)
    if (!isUsed(letter)) return letter
  }
  return null
}

/**
 * Build the sshfs.exe argument list. The password is NEVER an argument — it's
 * written to stdin (password_stdin). Empty remotePath = remote home dir; a path
 * starting with '/' is absolute, otherwise it's home-relative.
 */
export function buildSshfsArgs(opts: {
  username: string
  host: string
  port: number
  drive: string
  remotePath?: string
}): string[] {
  const source = `${opts.username}@${opts.host}:${opts.remotePath ?? ''}`
  const args = [
    '-f', // foreground: the process IS the mount, so we keep the handle to unmount
    source,
    `${opts.drive}:`, // mountpoint = drive letter (WinFsp creates it)
    '-o', 'password_stdin',
    '-o', 'idmap=user',
    '-o', 'uid=-1,gid=-1',
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'UserKnownHostsFile=/dev/null',
    '-o', 'reconnect',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=3',
    '-o', 'dir_cache=yes'
  ]
  if (opts.port && opts.port !== 22) args.push('-o', `Port=${opts.port}`)
  return args
}

export interface SshfsMountOpts {
  target: string // connection key ("user@host[:port]")
  host: string
  port: number
  username: string
  password: string
  remotePath?: string
}

interface Mount {
  drive: string
  proc: ChildProcess
  mountPath: string
}

const driveRoot = (letter: string): string => `${letter}:\\`

export class SshfsManager {
  private mounts = new Map<string, Mount>()
  /** in-flight mount promises, so concurrent clicks for a target dedupe (no double mount) */
  private inflight = new Map<string, Promise<{ drive: string; mountPath: string }>>()
  /** drive letters reserved between pick and the drive actually appearing */
  private reserved = new Set<string>()

  installed(): boolean {
    return sshfsInstalled()
  }

  /** A tracked mount is healthy only if the drive is present AND its process is alive. */
  private isAlive(m: Mount): boolean {
    return existsSync(m.mountPath) && m.proc.exitCode === null && !m.proc.killed
  }

  /** Mount (or reuse) the remote folder; resolves once the drive is browseable. */
  mount(opts: SshfsMountOpts): Promise<{ drive: string; mountPath: string }> {
    const live = this.mounts.get(opts.target)
    if (live) {
      if (this.isAlive(live)) return Promise.resolve({ drive: live.drive, mountPath: live.mountPath })
      this.cleanup(opts.target) // stale/dead — tear it down before remounting
    }
    const pending = this.inflight.get(opts.target)
    if (pending) return pending
    const p = this.doMount(opts).finally(() => this.inflight.delete(opts.target))
    this.inflight.set(opts.target, p)
    return p
  }

  private async doMount(opts: SshfsMountOpts): Promise<{ drive: string; mountPath: string }> {
    if (!sshfsInstalled()) throw new Error('SSHFS-Win is not installed')
    // Try up to 2 free drive letters: a single letter can be wedged by a prior
    // failed/half mount, so don't fail outright — route around it.
    const tried = new Set<string>()
    let lastErr: Error | undefined
    for (let attempt = 0; attempt < 2; attempt++) {
      const used = (l: string): boolean =>
        tried.has(l) ||
        existsSync(driveRoot(l)) ||
        this.reserved.has(l) ||
        [...this.mounts.values()].some((m) => m.drive === l)
      const drive = pickFreeDrive(used)
      if (!drive) break
      tried.add(drive)
      try {
        return await this.tryMountOnDrive(opts, drive)
      } catch (e) {
        lastErr = e as Error
      }
    }
    throw lastErr ?? new Error('No free drive letter available to mount the remote folder')
  }

  private async tryMountOnDrive(
    opts: SshfsMountOpts,
    drive: string
  ): Promise<{ drive: string; mountPath: string }> {
    this.reserved.add(drive)
    const mountPath = driveRoot(drive)

    const args = buildSshfsArgs({
      username: opts.username,
      host: opts.host,
      port: opts.port,
      drive,
      remotePath: opts.remotePath
    })
    const proc = spawn(SSHFS_BIN, args, { windowsHide: true, env: { ...process.env, CYGFUSE: 'WinFsp' } })
    // Track immediately so a quit/cleanup during the (up to 25s) mount window can
    // still reap the process and free the drive — it isn't an orphan.
    this.mounts.set(opts.target, { drive, proc, mountPath })

    let stderr = ''
    proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    // A short-lived child that dies immediately can emit an async EPIPE on stdin;
    // an unhandled stream 'error' would crash the main process. Swallow it.
    proc.stdin?.on('error', () => {})
    try {
      proc.stdin?.write(opts.password + '\n')
      proc.stdin?.end()
    } catch {
      /* stdin may already be closed if the process died immediately */
    }

    // Mounting is async: poll the drive root until it appears, racing against an
    // early process exit (= failure) and an overall timeout.
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false
        const finish = (fn: () => void): void => {
          if (settled) return
          settled = true
          clearInterval(poll)
          clearTimeout(timeout)
          fn()
        }
        const poll = setInterval(() => {
          if (existsSync(mountPath)) finish(resolve)
        }, 250)
        const timeout = setTimeout(
          () => finish(() => reject(new Error(`SSHFS mount timed out: ${stderr.trim().slice(0, 300)}`))),
          12000
        )
        proc.on('exit', (code) =>
          finish(() =>
            reject(new Error(`sshfs exited (${code ?? '?'}): ${stderr.trim().slice(0, 300) || 'mount failed'}`))
          )
        )
        proc.on('error', (e) => finish(() => reject(e)))
      })
    } catch (e) {
      this.cleanup(opts.target) // kill the process + free the drive/reservation
      throw e
    }

    this.reserved.delete(drive)
    return { drive, mountPath }
  }

  /** Tear down a target's mount: kill the sshfs.exe process TREE (cygwin spawns
   *  child ssh/WinFsp helpers) so the drive is released; modern WinFsp self-
   *  unmounts when the owning process dies. Synchronous so it works from quit. */
  private killMount(m: Mount): void {
    try {
      if (typeof m.proc.pid === 'number')
        spawnSync('taskkill', ['/PID', String(m.proc.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 })
    } catch {
      /* taskkill missing (non-Windows) — fall back to proc.kill below */
    }
    try {
      m.proc.kill()
    } catch {
      /* already gone */
    }
  }

  private cleanup(target: string): void {
    const m = this.mounts.get(target)
    if (!m) return
    this.mounts.delete(target)
    this.reserved.delete(m.drive)
    this.killMount(m)
  }

  unmount(target: string): void {
    this.cleanup(target)
  }

  unmountAll(): void {
    for (const target of [...this.mounts.keys()]) this.cleanup(target)
  }
}
