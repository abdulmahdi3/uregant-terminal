import { Client } from 'ssh2'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { tmpdir } from 'os'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { buildUrsshCmd, buildUrsshSh } from './ursshHelpers'

/**
 * "Agent over SSH" — lets a LOCAL agent (e.g. Claude) operate a remote server
 * without installing anything on it. URterminal keeps ONE authenticated ssh2
 * connection per target and exposes a loopback HTTP endpoint; a generated
 * `urssh` helper script POSTs a command to that endpoint, which runs it on the
 * reused connection and returns the output. So the agent just runs
 * `urssh "<command>"` for every server action — no per-command password prompt,
 * no remote install (mirrors the VSCode Remote-SSH idea, agent-side).
 */

export interface AgentOverSshOpts {
  target: string // "user@host[:port]" label (also the connection key)
  host: string
  port: number
  username: string
  password: string
}

export interface AgentOverSshResult {
  /** absolute path to the generated helper the agent should call */
  helperPath: string
}

interface Conn {
  client: Client
  ready: Promise<void>
}

export class SshAgentBridge {
  private server: Server | null = null
  private port = 0
  private token = randomBytes(24).toString('hex')
  private conns = new Map<string, Conn>()
  private helperDir: string | null = null

  /** Lazily start the loopback HTTP exec server; resolves once it's listening. */
  private ensureServer(): Promise<void> {
    if (this.server) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => this.handle(req, res))
      server.on('error', reject)
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address()
        this.port = typeof addr === 'object' && addr ? addr.port : 0
        this.server = server
        resolve()
      })
    })
  }

  /** Open (or reuse) the authenticated connection for a target. */
  private ensureConn(opts: AgentOverSshOpts): Conn {
    const existing = this.conns.get(opts.target)
    if (existing) return existing
    const client = new Client()
    const ready = new Promise<void>((resolve, reject) => {
      client.on('ready', () => resolve())
      client.on('error', (e) => {
        this.conns.delete(opts.target)
        reject(e)
      })
      client.on('close', () => this.conns.delete(opts.target))
    })
    client.connect({
      host: opts.host,
      port: opts.port,
      username: opts.username,
      password: opts.password,
      readyTimeout: 20000,
      keepaliveInterval: 15000
    })
    // Keep the rejection handled even if no exec runs before a connect failure
    // (open() no longer awaits this, so the first urssh call surfaces errors).
    void ready.catch(() => {})
    const conn: Conn = { client, ready }
    this.conns.set(opts.target, conn)
    return conn
  }

  /** Run one command on the target's connection, returning combined output. */
  private exec(target: string, command: string): Promise<string> {
    const conn = this.conns.get(target)
    if (!conn) return Promise.reject(new Error('No SSH connection for that target'))
    return conn.ready.then(
      () =>
        new Promise<string>((resolve, reject) => {
          conn.client.exec(command, (err, stream) => {
            if (err) return reject(err)
            let out = ''
            stream.on('data', (d: Buffer) => (out += d.toString('utf8')))
            stream.stderr.on('data', (d: Buffer) => (out += d.toString('utf8')))
            stream.on('close', (code: number) => {
              if (code) out += `\n[remote exit ${code}]`
              resolve(out)
            })
          })
        })
    )
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST' || req.url !== '/exec') {
      res.statusCode = 404
      res.end('not found')
      return
    }
    if (req.headers['x-urssh-token'] !== this.token) {
      res.statusCode = 403
      res.end('forbidden')
      return
    }
    const target = String(req.headers['x-urssh-target'] ?? '')
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const command = body.trim()
      if (!command) {
        res.statusCode = 400
        res.end('empty command')
        return
      }
      this.exec(target, command)
        .then((out) => {
          res.statusCode = 200
          res.setHeader('content-type', 'text/plain; charset=utf-8')
          res.end(out)
        })
        .catch((e: Error) => {
          res.statusCode = 502
          res.end(`urssh error: ${e.message}`)
        })
    })
  }

  /**
   * Ensure a connection + helper exist for the target and return the helper path.
   * Throws if the SSH connection can't be made. (The caller composes the agent
   * instruction so it can include SSHFS mount info when present.)
   */
  async open(opts: AgentOverSshOpts): Promise<AgentOverSshResult> {
    await this.ensureServer()
    // Start (or reuse) the connection in the background — don't block the open on
    // it. The first urssh command awaits conn.ready and surfaces any failure.
    this.ensureConn(opts)
    if (!this.helperDir) this.helperDir = mkdtempSync(join(tmpdir(), 'urssh-'))
    const win = process.platform === 'win32'
    const helperPath = join(this.helperDir, win ? 'urssh.cmd' : 'urssh')
    const content = win
      ? buildUrsshCmd({ port: this.port, token: this.token, target: opts.target })
      : buildUrsshSh({ port: this.port, token: this.token, target: opts.target })
    writeFileSync(helperPath, content, win ? undefined : { mode: 0o755 })
    return { helperPath }
  }

  /** Close the reused connection for a single target (e.g. when its pane closes). */
  disposeConn(target: string): void {
    const conn = this.conns.get(target)
    if (!conn) return
    this.conns.delete(target)
    try {
      conn.client.end()
    } catch {
      /* ignore */
    }
  }

  dispose(): void {
    for (const { client } of this.conns.values()) {
      try {
        client.end()
      } catch {
        /* ignore */
      }
    }
    this.conns.clear()
    try {
      this.server?.close()
    } catch {
      /* ignore */
    }
    this.server = null
    // Remove the temp dir holding the token-bearing urssh helper.
    if (this.helperDir) {
      try {
        rmSync(this.helperDir, { recursive: true, force: true })
      } catch {
        /* ignore */
      }
      this.helperDir = null
    }
  }
}
