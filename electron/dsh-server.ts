import { app } from 'electron'
import { createRequire } from 'node:module'
import { spawn, type ChildProcess } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const START_TIMEOUT_MS = 30_000
const FORCE_KILL_MS = 2_000
const STDERR_TAIL_BYTES = 8192

/** Preferred port for the dsh web server; the next free port is used when busy. */
const DEFAULT_WEB_PORT = 3080
/** Scan DEFAULT_WEB_PORT .. DEFAULT_WEB_PORT + PORT_SCAN_LIMIT - 1 for a free port. */
const PORT_SCAN_LIMIT = 50
/** Re-probe and rebind this many times if the port is grabbed between probe and bind. */
const PORT_BIND_RETRIES = 3

export type DshStatus =
  | { state: 'starting' }
  | { state: 'ready'; url: string }
  | { state: 'error'; message: string; detail?: string }

/**
 * Return the first free TCP port starting at `start` (inclusive), probing
 * with a short listen on 127.0.0.1 — the interface dsh web binds. Ports that
 * cannot be bound (EADDRINUSE, EACCES) count as occupied and are skipped.
 */
function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const attempt = (port: number): void => {
      if (port >= start + PORT_SCAN_LIMIT) {
        reject(new Error(`no free port between ${start} and ${start + PORT_SCAN_LIMIT - 1}`))
        return
      }
      const probe = net.createServer()
      probe.unref()
      probe.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
          attempt(port + 1)
        } else {
          reject(err)
        }
      })
      probe.once('listening', () => {
        probe.close(() => resolve(port))
      })
      probe.listen(port, '127.0.0.1')
    }
    attempt(start)
  })
}

// Packaged apps have no reliable stdout; keep a log file for field diagnostics.
function diagLog(...args: unknown[]) {
  console.log(...args)
  try {
    const dir = app.getPath('logs')
    mkdirSync(dir, { recursive: true })
    appendFileSync(path.join(dir, 'dsh-server.log'), args.map(String).join(' ') + '\n')
  } catch {
    /* best-effort diagnostics */
  }
}

/**
 * In the packaged app the whole dependency tree is unpacked from asar
 * (`asarUnpack: node_modules/**`): native addons cannot dlopen from inside
 * asar, and the web frontend dist is served with real fs reads. Replace the
 * exact `app.asar` segment (never matches `app.asar.unpacked` itself).
 */
function dshBinPath(): string {
  const resolved = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/lib/bin.js')
  if (!app.isPackaged) return resolved
  const segs = resolved.split(path.sep)
  const i = segs.indexOf('app.asar')
  if (i !== -1) segs[i] = 'app.asar.unpacked'
  return segs.join(path.sep)
}

class DshServer {
  private child: ChildProcess | null = null
  private status: DshStatus = { state: 'starting' }
  private stderrTail = ''
  private stopping = false
  private startPromise: Promise<void> | null = null
  private portRetries = 0
  private listeners = new Set<(s: DshStatus) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null

  getStatus(): DshStatus {
    return this.status
  }

  onStatus(fn: (s: DshStatus) => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private set(s: DshStatus) {
    this.status = s
    for (const fn of this.listeners) fn(s)
  }

  private clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private fail(message: string, detail?: string) {
    this.clearTimer()
    this.set({ state: 'error', message, detail })
  }

  /**
   * Run the dsh CLI on the app's own Electron binary in pure-Node mode
   * (ELECTRON_RUN_AS_NODE — the RunAsNode fuse is enabled): end users need no
   * system Node. Not utilityProcess: in the packaged app its NodeService
   * silently drops `--expose-internals`, which the dsh loader requires for
   * its HMR service; pure-Node mode honors it (verified on the packaged
   * binary). Idempotent: no-op while a start attempt is already in flight (a
   * spawn or an automatic port retry) and while a child is alive.
   */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.portRetries = 0
    this.startPromise = this.startInner().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  private async startInner(): Promise<void> {
    if (this.child) return
    this.stopping = false
    this.stderrTail = ''
    this.set({ state: 'starting' })

    // Prefer 3080 (the plain `dsh web` port); when another process — e.g. a
    // standalone `dsh web` — holds it, fall back to 3081, 3082, ...
    let port: number
    try {
      port = await findFreePort(DEFAULT_WEB_PORT)
    } catch (err) {
      diagLog('[dsh] port probe failed:', String(err))
      this.fail('no free port found for the dsh server', String(err))
      return
    }
    diagLog(`[dsh] starting dsh web on port ${port}`)

    // Resolved lazily: app.getPath('userData') is only meaningful after app
    // startup, and this module must stay safe to import before main.ts runs.
    const dshHome = path.join(app.getPath('userData'), 'dsh')

    // Fork through a tiny wrapper: it watches its stdin pipe and exits when
    // the pipe closes — i.e. when the parent dies. A plain child_process
    // child would otherwise orphan and keep serving on its port after an
    // abrupt parent death (crash, dev-server restart, SIGKILL).
    let wrapperPath: string
    try {
      mkdirSync(dshHome, { recursive: true })
      wrapperPath = path.join(dshHome, 'electron-dsh-child.mjs')
      writeFileSync(
        wrapperPath,
        [
          'process.stdin.resume()',
          "process.stdin.on('end', () => process.exit(0))",
          "process.stdin.on('error', () => {})",
          `await import(${JSON.stringify('file://' + dshBinPath())})`,
        ].join('\n'),
      )
    } catch (err) {
      diagLog('[dsh] wrapper write failed:', String(err))
      this.fail('failed to prepare the dsh launcher', String(err))
      return
    }

    let child: ChildProcess
    try {
      child = spawn(
        process.execPath,
        ['--expose-internals', wrapperPath, 'web', '--port', String(port)],
        {
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1',
            ELECTRON_NO_ATTACH_CONSOLE: '1',
            DSH_HOME: dshHome,
            DSH_TELEMETRY_DISABLED: '1',
          },
          cwd: os.homedir(),
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
    } catch (err) {
      diagLog('[dsh] spawn failed:', String(err))
      this.fail('failed to start dsh', String(err))
      return
    }
    this.child = child
    diagLog('[dsh] spawned pid', child.pid)

    child.on('error', (err) => {
      // e.g. the binary cannot be executed at all (no 'exit' follows in that case)
      diagLog('[dsh] child error:', String(err))
      if (this.child !== child) return
      this.child = null
      this.fail('failed to start dsh', String(err))
    })

    child.on('exit', (code, signal) => {
      diagLog(`[dsh] child exited with code ${code} signal ${signal}`)
      if (this.child !== child) return
      this.child = null
      this.clearTimer()
      if (this.stopping) return
      if (this.status.state === 'error') return // timeout already reported
      // The port was grabbed between our probe and dsh's bind: retry on the
      // next free port instead of surfacing an error.
      if (
        this.status.state === 'starting' &&
        /EADDRINUSE/i.test(this.stderrTail) &&
        this.portRetries < PORT_BIND_RETRIES
      ) {
        this.portRetries++
        diagLog('[dsh] bind raced another process; retrying on the next free port')
        this.startPromise = this.startInner().finally(() => {
          this.startPromise = null
        })
        return
      }
      if (this.status.state === 'ready') {
        this.fail('Server stopped', `exit code ${code}\n${this.stderrTail}`)
      } else {
        this.fail('dsh exited before becoming ready', `exit code ${code}\n${this.stderrTail}`)
      }
    })

    // The server prints `dsh web: http://127.0.0.1:<port>` once after it has
    // bound, echoing the port we selected (or the next free one after a bind
    // race was retried).
    let buf = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trim()
        buf = buf.slice(nl + 1)
        diagLog('[dsh]', line)
        if (this.status.state === 'starting') {
          const m = line.match(/dsh web:\s*(https?:\/\/\S+)/)
          if (m) this.onUrlLine(m[1])
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-STDERR_TAIL_BYTES)
      diagLog('[dsh-err]', chunk.toString().trimEnd())
    })

    this.timer = setTimeout(() => {
      if (this.status.state !== 'starting') return
      this.fail('Timed out waiting for the dsh server', this.stderrTail || '(no stderr output)')
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }, START_TIMEOUT_MS)
  }

  private onUrlLine(url: string) {
    this.clearTimer()
    this.set({ state: 'ready', url })
    // Belt-and-suspenders: the line is printed after listen, but confirm the
    // URL actually answers before the renderer navigates to it.
    void this.confirmHttp(url)
  }

  private async confirmHttp(url: string) {
    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline && this.status.state === 'ready') {
      try {
        await fetch(url)
        return
      } catch {
        await new Promise((r) => setTimeout(r, 500))
      }
    }
  }

  /** Kill the child (SIGTERM), force-killing after a grace period. Idempotent. */
  stop(): Promise<void> {
    const child = this.child
    if (!child) return Promise.resolve()
    this.stopping = true
    this.clearTimer()
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(force)
        if (this.child === child) this.child = null
        resolve()
      }
      const force = setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {
          /* already gone */
        }
        finish()
      }, FORCE_KILL_MS)
      child.once('exit', finish)
      child.kill()
    })
  }
}

export const dshServer = new DshServer()
