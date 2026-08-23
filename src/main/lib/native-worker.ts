// Electron types available via electron-vite/node
import { spawn, type ChildProcess } from 'child_process'
import { randomUUID } from 'crypto'
import { EventEmitter } from 'events'
import * as net from 'net'
import * as path from 'path'
import { decode, encode } from '@msgpack/msgpack'
import { app } from 'electron'
import { logError, logWarn } from './logger'
import { readPersistedSettings, SETTINGS_STORAGE_KEY } from './settings-store'

const DEFAULT_TIMEOUT_MS = 60_000
const CONNECT_TIMEOUT_MS = 10_000
// CONNECT_RETRY_MS not needed in simplified version
const FRAME_HEADER_BYTES = 4
const MAX_FRAME_BYTES = 256 * 1024 * 1024

type PendingRequest = {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type NativeWorkerResponse = {
  id?: number
  result?: unknown
  error?: string
}

type NativeWorkerEventFrame = {
  event?: string
  params?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

class NativeWorkerManager {
  private child: ChildProcess | null = null
  private socket: net.Socket | null = null
  private _endpoint: string | null = null
  get endpoint(): string | null { return this._endpoint }
  private events = new EventEmitter()
  private pending = new Map<number, PendingRequest>()
  private readChunks: Buffer[] = []
  private readBufferedBytes = 0
  private pendingFrameLength = -1
  private nextId = 1
  private startPromise: Promise<void> | null = null

  get isRunning(): boolean {
    return (
      this.child !== null &&
      !this.child.killed &&
      this.child.exitCode === null &&
      this.socket !== null &&
      !this.socket.destroyed
    )
  }

  get processId(): number | null {
    return this.child?.pid ?? null
  }

  async ensureStarted(): Promise<void> {
    if (this.isRunning) return
    if (!this.startPromise) {
      this.startPromise = this.start().finally(() => {
        this.startPromise = null
      })
    }
    await this.startPromise
  }

  onEvent(eventName: string, listener: (params: unknown) => void): () => void {
    this.events.on(eventName, listener)
    return () => this.events.off(eventName, listener)
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    timeoutMs?: number
  ): Promise<T> {
    const effectiveTimeoutMs =
      typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
        ? timeoutMs
        : DEFAULT_TIMEOUT_MS

    await this.ensureStarted()

    const socket = this.socket
    if (!socket || !this.isRunning) {
      throw new Error('Worker is not running')
    }

    const id = this.nextId++
    const payload = encode({ id, method, params: params ?? {} })
    const frame = createFrame(payload)

    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Worker request timed out: ${method} (${effectiveTimeoutMs}ms)`))
      }, effectiveTimeoutMs)

      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer })
      socket.write(frame)
    })
  }

  private async start(): Promise<void> {
    const workerPath = resolveWorkerPath()
    if (!workerPath) {
      throw new Error('Worker binary not found. Build the .NET project first.')
    }

    const endpoint = createEndpoint()
    console.log('[Worker] spawning', { workerPath, endpoint })

    // Read defaultShell from persisted settings and inject as env var
    let workerEnv = { ...process.env }
    // Propagate the main process's log level so the Worker matches dev/prod
    // verbosity (main: debug in dev, error when packaged; Worker default: warn).
    if (!workerEnv.WISHFUL_CLAW_LOG_LEVEL) {
      workerEnv.WISHFUL_CLAW_LOG_LEVEL = resolveWorkerLogLevel()
    }
    try {
      const persisted = readPersistedSettings(SETTINGS_STORAGE_KEY) as
        { state?: { defaultShell?: string } } | null
      const defaultShell = persisted?.state?.defaultShell
      if (defaultShell) {
        workerEnv.WISHFUL_SHELL = defaultShell
      }
    } catch { /* ignore — settings file may not exist yet */ }

    const child = spawn(workerPath, ['--ipc', endpoint], {
      cwd: path.dirname(workerPath),
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      env: workerEnv
    })

    this.child = child
    this._endpoint = endpoint

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim()
      if (text) {
        console.warn(`[Worker] ${text}`)
        logWarn('worker', text)
      }
    })

    child.on('exit', (code, signal) => {
      console.log('[Worker] exited', { code, signal })
      logWarn('worker', `Worker exited: code=${code} signal=${signal}`)
      this.closeWorker(new Error(`Worker exited with code ${code}`))
    })

    child.on('error', (error) => {
      console.error('[Worker] spawn error', error)
      logError('worker', `Spawn error: ${error.message}`, { stack: error.stack })
      this.closeWorker(error)
    })

    // Connect to the worker's IPC endpoint
    await this.connect(endpoint)

    // Verify connectivity
    await this.request('worker/ping', {}, 10_000)
    console.log('[Worker] connected', { pid: child.pid })
  }

  private async connect(endpoint: string): Promise<void> {
    // Pass the full endpoint path directly to net.createConnection.
    // On Windows this is `\\.\pipe\wishful-claw-...`; Node.js handles it natively.
    // On Unix this is a filesystem socket path.
    const deadline = Date.now() + CONNECT_TIMEOUT_MS
    const retryIntervalMs = 200
    let lastError: Error | null = null

    while (Date.now() < deadline) {
      if (this.child?.exitCode !== null && this.child?.exitCode !== undefined) {
        throw new Error(`Worker exited before IPC connection: code=${this.child.exitCode}`)
      }
      try {
        const socket = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.createConnection(endpoint)
          const timer = setTimeout(() => {
            s.destroy()
            reject(new Error('connect attempt timeout'))
          }, 1000)

          s.once('connect', () => {
            clearTimeout(timer)
            resolve(s)
          })
          s.once('error', (error) => {
            clearTimeout(timer)
            s.destroy()
            reject(error)
          })
        })

        // Only attach data/close handlers after successful connection
        this.socket = socket
        socket.on('data', (chunk: Buffer) => {
          this.handleSocketData(chunk)
        })
        socket.on('close', () => {
          if (!this.socket?.destroyed) {
            this.closeWorker(new Error('Worker IPC closed'))
          }
        })
        console.log('[Worker] socket connected')
        return
      } catch (err) {
        lastError = err as Error
        await new Promise((r) => setTimeout(r, retryIntervalMs))
      }
    }

    throw new Error(
      `Worker connect timed out (${CONNECT_TIMEOUT_MS}ms): ${lastError?.message}`
    )
  }

  private handleSocketData(chunk: Buffer): void {
    this.readChunks.push(chunk)
    this.readBufferedBytes += chunk.length

    while (true) {
      if (this.pendingFrameLength < 0) {
        if (this.readBufferedBytes < FRAME_HEADER_BYTES) return
        const header = this.consumeBufferedBytes(FRAME_HEADER_BYTES)
        const length = header.readUInt32BE(0)
        if (length <= 0 || length > MAX_FRAME_BYTES) {
          this.closeWorker(new Error(`Invalid frame length: ${length}`))
          return
        }
        this.pendingFrameLength = length
      }

      if (this.readBufferedBytes < this.pendingFrameLength) return
      const payload = this.consumeBufferedBytes(this.pendingFrameLength)
      this.pendingFrameLength = -1
      this.handleResponseFrame(payload)
    }
  }

  private consumeBufferedBytes(count: number): Buffer {
    const first = this.readChunks[0]
    if (first.length >= count) {
      const out = first.subarray(0, count)
      if (first.length === count) {
        this.readChunks.shift()
      } else {
        this.readChunks[0] = first.subarray(count)
      }
      this.readBufferedBytes -= count
      return out
    }

    const out = Buffer.allocUnsafe(count)
    let offset = 0
    while (offset < count) {
      const chunk = this.readChunks[0]
      const take = Math.min(chunk.length, count - offset)
      chunk.copy(out, offset, 0, take)
      if (take === chunk.length) {
        this.readChunks.shift()
      } else {
        this.readChunks[0] = chunk.subarray(take)
      }
      offset += take
    }
    this.readBufferedBytes -= count
    return out
  }

  private handleResponseFrame(payload: Buffer): void {
    let decoded: unknown
    try {
      decoded = decode(payload)
    } catch (error) {
      console.warn('[Worker] invalid MessagePack response:', error)
      logWarn('worker', `Invalid MessagePack response: ${String(error)}`)
      return
    }

    if (!isRecord(decoded)) return

    const eventFrame = decoded as NativeWorkerEventFrame
    if (typeof eventFrame.event === 'string' && eventFrame.event) {
      this.events.emit(eventFrame.event, extractEventParameters(eventFrame.event, decoded))
      return
    }

    const response = decoded as NativeWorkerResponse
    if (typeof response.id !== 'number') return
    const pending = this.pending.get(response.id)
    if (!pending) return

    clearTimeout(pending.timer)
    this.pending.delete(response.id)
    if (typeof response.error === 'string' && response.error) {
      pending.reject(new Error(response.error))
    } else {
      pending.resolve(response.result)
    }
  }

  private closeWorker(error: Error): void {
    this.socket?.destroy()
    this.socket = null
    this.child = null
    this._endpoint = null
    this.readChunks = []
    this.readBufferedBytes = 0
    this.pendingFrameLength = -1

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
}

function createFrame(payload: Uint8Array): Buffer {
  const header = Buffer.allocUnsafe(FRAME_HEADER_BYTES)
  header.writeUInt32BE(payload.length, 0)
  return Buffer.concat([header, Buffer.from(payload)])
}

function createEndpoint(): string {
  const id = `${process.pid}-${Date.now().toString(36)}-${randomUUID()}`
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\wishful-claw-${id}`
  }
  return path.join('/tmp', `wishful-claw-${id}.sock`)
}

function resolveWorkerLogLevel(): string {
  const override = process.env['WISHFUL_CLAW_LOG_LEVEL']
  if (override) return override
  // Dev default is info: DEBUG-level per-event traces flood the console
  // during goal/sub-agent runs. Set WISHFUL_CLAW_LOG_LEVEL=debug explicitly
  // when deep diagnosis is needed.
  return app.isPackaged ? 'warn' : 'info'
}

function resolveWorkerPath(): string | null {
  const overridePath = process.env.WISHFUL_CLAW_WORKER_PATH?.trim()
  if (overridePath && require('fs').existsSync(overridePath)) {
    return overridePath
  }

  const executableName =
    process.platform === 'win32' ? 'WishfulClaw.Worker.exe' : 'WishfulClaw.Worker'

  // Production mode: look in app resources (packaged by electron-builder)
  try {
    const resourcesPath = path.join(process.resourcesPath, 'worker', executableName)
    if (require('fs').existsSync(resourcesPath)) return resourcesPath
  } catch {
    // process.resourcesPath may not be available in dev mode
  }

  // Dev mode: look in the .NET build output
  const devPath = path.join(
    process.cwd(),
    'src',
    'runtime',
    'WishfulClaw.Worker',
    'bin',
    'Debug',
    'net10.0',
    executableName
  )

  const fs = require('fs')
  if (fs.existsSync(devPath)) return devPath

  // Also check without .exe extension (dotnet run)
  if (process.platform === 'win32') {
    const dllPath = path.join(
      process.cwd(),
      'src',
      'runtime',
      'WishfulClaw.Worker',
      'bin',
      'Debug',
      'net10.0',
      'WishfulClaw.Worker.dll'
    )
    if (fs.existsSync(dllPath)) return dllPath
  }

  return null
}

let workerManager: NativeWorkerManager | null = null

export function getNativeWorker(): NativeWorkerManager {
  if (!workerManager) {
    workerManager = new NativeWorkerManager()
  }
  return workerManager
}

export function latchNativeWorkerShutdown(): void {
  // Placeholder for graceful shutdown
}

function extractEventParameters(eventName: string, decoded: Record<string, unknown>): unknown {
  if ('params' in decoded) return decoded.params
  if (eventName !== 'agent/stream') return undefined

  // agent/stream events are MessagePack-encoded envelopes where the fields
  // (v, runId, sessionId, seq, events) are at the top level alongside the
  // event name, not wrapped in a params field.
  const envelope = {
    v: decoded.v,
    runId: decoded.runId,
    sessionId: decoded.sessionId,
    seq: decoded.seq,
    events: decoded.events
  }
  return envelope
}
