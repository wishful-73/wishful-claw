/*
 * 插件资产下载器（S-242）—— 状态机 + 多源回退 + 断点续传 + sha256 校验。
 *
 * 落盘位置是**主程序共享资产区**，不是插件目录。理由（需求 §4.2）：
 * 插件更新一版目录一换，几百 MB 就白下；两个插件要同一个模型时各存一份，磁盘翻倍；
 * 卸载插件时又不敢删（可能是别人还在用的）。按资产 id 存，这三个问题一起消失。
 *
 * 这个文件刻意**不 import electron** —— 数据根由调用方传入，fetch 可注入。
 * 于是整条链路（续传 / 多源 / 校验失败 / 取消 / 并发）都能用本地 http 服务跑单测，
 * 不必启动 Electron，也不必真的去下载几百 MB。
 */

import { createHash } from 'crypto'
import { createReadStream, createWriteStream } from 'fs'
import { mkdir, rename, rm, stat, truncate } from 'fs/promises'
import { dirname, join } from 'path'
import {
  findCatalogEntry,
  listCatalog,
  resolveAssetRelativePath,
  type PluginAssetCatalogEntry
} from './plugin-asset-catalog'
import type {
  PluginAssetProgressEvent,
  PluginAssetState,
  PluginAssetStatus
} from '../../shared/plugin-asset-types'

export type {
  PluginAssetProgressEvent,
  PluginAssetState,
  PluginAssetStatus
} from '../../shared/plugin-asset-types'

export interface PluginAssetManagerOptions {
  /** 共享资产根，生产传 `{dataRoot}/plugin-assets`。 */
  rootDir: string
  /** 覆盖内置目录（单测用）。 */
  catalog?: PluginAssetCatalogEntry[]
  /** 进度出口。主进程接到这里转发 IPC。 */
  emit?: (event: PluginAssetProgressEvent) => void
  /** 注入 fetch（单测指向本地 http 服务）。 */
  fetchImpl?: typeof fetch
  /** 不同资产的最大并发数（需求 §4.4：2）。 */
  maxConcurrent?: number
}

/** 单源内最多重试次数（指数退避）。 */
const RETRY_PER_SOURCE = 3
/** 并发上限缺省值。 */
const DEFAULT_MAX_CONCURRENT = 2
/** 进度节流：≥ 200 ms 或 ≥ 5% 才推一次，避免刷爆 IPC。 */
const PROGRESS_MIN_INTERVAL_MS = 200
const PROGRESS_MIN_DELTA = 0.05

class AssetCancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'AssetCancelledError'
  }
}

interface ActiveDownload {
  controller: AbortController
  promise: Promise<PluginAssetStatus>
}

export class PluginAssetManager {
  private readonly rootDir: string
  private readonly catalog: PluginAssetCatalogEntry[]
  private readonly emitEvent?: (event: PluginAssetProgressEvent) => void
  private readonly fetchImpl: typeof fetch
  private readonly maxConcurrent: number

  private readonly active = new Map<string, ActiveDownload>()
  private readonly failures = new Map<string, string>()
  private readonly lastProgressAt = new Map<string, number>()
  private readonly lastProgressPercent = new Map<string, number>()
  private running = 0
  private readonly waiting: Array<() => void> = []

  constructor(options: PluginAssetManagerOptions) {
    this.rootDir = options.rootDir
    this.catalog = options.catalog ?? listCatalog()
    this.emitEvent = options.emit
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.maxConcurrent = Math.max(1, options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT)
  }

  /** 绝对落盘路径（不论是否就绪）。 */
  absolutePath(id: string): string {
    return join(this.rootDir, ...resolveAssetRelativePath(id).split('/'))
  }

  /**
   * 正在占着下载槽位的资产数（≤ `maxConcurrent`）。
   * 设置页显示「正在下载 N 项」用，单测也靠它验闸门 —— 数 TCP 连接会把
   * 已下完但还没 close 的连接算进来，冤枉人。
   */
  get runningCount(): number {
    return this.running
  }

  private partPath(id: string): string {
    return `${this.absolutePath(id)}.part`
  }

  private entryOf(id: string): PluginAssetCatalogEntry | null {
    const key = (id ?? '').trim()
    if (!key) return null
    return this.catalog.find((entry) => entry.id === key) ?? findCatalogEntry(key)
  }

  private emitProgress(
    id: string,
    state: PluginAssetState,
    receivedBytes: number,
    totalBytes: number,
    error?: string,
    force = false
  ): void {
    const percent = totalBytes > 0 ? Math.min(1, receivedBytes / totalBytes) : 0
    const now = Date.now()
    const lastAt = this.lastProgressAt.get(id) ?? 0
    const lastPercent = this.lastProgressPercent.get(id) ?? 0
    const due =
      force ||
      now - lastAt >= PROGRESS_MIN_INTERVAL_MS ||
      Math.abs(percent - lastPercent) >= PROGRESS_MIN_DELTA ||
      state !== 'downloading'
    if (!due) return

    this.lastProgressAt.set(id, now)
    this.lastProgressPercent.set(id, percent)
    this.emitEvent?.({ id, state, receivedBytes, totalBytes, percent, error })
  }

  /**
   * 轻量状态：**只查存在性与大小**，不重算 sha256。
   * 需求 §4.4 明写 —— 每次开面板都全量校验，用户看到的是几秒卡顿。
   */
  async status(id: string): Promise<PluginAssetStatus> {
    const key = (id ?? '').trim()
    const entry = this.entryOf(key)
    if (!entry) return { id: key, state: 'unknown', receivedBytes: 0 }

    if (this.active.has(key)) {
      const received = (await this.sizeOf(this.partPath(key))) ?? 0
      return {
        id: key,
        state: 'downloading',
        name: entry.name,
        size: entry.size,
        receivedBytes: received
      }
    }

    const failure = this.failures.get(key)
    const full = await this.sizeOf(this.absolutePath(key))
    if (full !== null && full === entry.size) {
      return {
        id: key,
        state: 'ready',
        name: entry.name,
        size: entry.size,
        receivedBytes: full,
        path: this.absolutePath(key)
      }
    }

    const partial = (await this.sizeOf(this.partPath(key))) ?? 0
    if (failure) {
      return {
        id: key,
        state: 'failed',
        name: entry.name,
        size: entry.size,
        receivedBytes: partial,
        error: failure
      }
    }

    return {
      id: key,
      state: 'absent',
      name: entry.name,
      size: entry.size,
      receivedBytes: partial
    }
  }

  /** 本插件声明的一批资产的状态（未知 id 也如实返回 `unknown`）。 */
  async statusOf(ids: string[]): Promise<PluginAssetStatus[]> {
    const result: PluginAssetStatus[] = []
    for (const id of ids ?? []) result.push(await this.status(id))
    return result
  }

  /** 就绪则返回绝对路径，否则 null。插件只该用这个拿路径。 */
  async pathOf(id: string): Promise<string | null> {
    const status = await this.status(id)
    return status.state === 'ready' ? (status.path ?? null) : null
  }

  /** 开始在下载；同一资产重复调用返回同一个 promise。 */
  download(id: string): Promise<PluginAssetStatus> {
    const key = (id ?? '').trim()
    const entry = this.entryOf(key)
    if (!entry) {
      return Promise.resolve({ id: key, state: 'unknown', receivedBytes: 0 })
    }
    const existing = this.active.get(key)
    if (existing) return existing.promise

    const controller = new AbortController()
    const promise = this.runQueued(key, entry, controller)
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        // 取消不算失败：`.part` 留着，用户再点就续
        if (error instanceof AssetCancelledError) {
          this.failures.delete(key)
          return { id: key, state: 'absent' as const, receivedBytes: 0 }
        }
        this.failures.set(key, message)
        this.emitProgress(key, 'failed', 0, entry.size, message, true)
        return { id: key, state: 'failed' as const, receivedBytes: 0, error: message }
      })
      .finally(() => {
        this.active.delete(key)
        this.lastProgressAt.delete(key)
        this.lastProgressPercent.delete(key)
      })

    this.active.set(key, { controller, promise })
    return promise
  }

  /** 取消下载 —— 保留 `.part`，下次接着来。 */
  cancel(id: string): boolean {
    const key = (id ?? '').trim()
    const active = this.active.get(key)
    if (!active) return false
    active.controller.abort()
    return true
  }

  /** 显式全量校验（下载完成时自动跑，这里是给「我怀疑文件坏了」用的）。 */
  async verify(id: string): Promise<PluginAssetStatus> {
    const key = (id ?? '').trim()
    const entry = this.entryOf(key)
    if (!entry) return { id: key, state: 'unknown', receivedBytes: 0 }

    const abs = this.absolutePath(key)
    const size = await this.sizeOf(abs)
    if (size === null) {
      return { id: key, state: 'absent', name: entry.name, size: entry.size, receivedBytes: 0 }
    }

    this.emitProgress(key, 'verifying', size, entry.size, undefined, true)
    const digest = await this.hashFile(abs)
    if (size !== entry.size || digest !== entry.sha256.toLowerCase()) {
      const error =
        size !== entry.size
          ? `size mismatch: got ${size}, expected ${entry.size}`
          : 'sha256 mismatch'
      this.failures.set(key, error)
      await rm(abs, { force: true })
      this.emitProgress(key, 'failed', 0, entry.size, error, true)
      return { id: key, state: 'failed', name: entry.name, size: entry.size, receivedBytes: 0, error }
    }

    this.failures.delete(key)
    this.emitProgress(key, 'ready', size, entry.size, undefined, true)
    return {
      id: key,
      state: 'ready',
      name: entry.name,
      size: entry.size,
      receivedBytes: size,
      path: abs
    }
  }

  /** 删除资产（连 `.part` 一起）。插件卸载**不**调用它 —— 见 S-244 的独立清理入口。 */
  async remove(id: string): Promise<void> {
    const key = (id ?? '').trim()
    if (!key) return
    this.cancel(key)
    await rm(this.absolutePath(key), { force: true })
    await rm(this.partPath(key), { force: true })
    this.failures.delete(key)
  }

  // ─── 内部 ───

  private async runQueued(
    id: string,
    entry: PluginAssetCatalogEntry,
    controller: AbortController
  ): Promise<PluginAssetStatus> {
    await this.acquireSlot()
    try {
      // 排队期间用户可能已经点了取消 —— 别白占一个槽位
      if (controller.signal.aborted) throw new AssetCancelledError()
      return await this.runDownload(id, entry, controller)
    } finally {
      this.releaseSlot()
    }
  }

  private acquireSlot(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.running += 1
        resolve()
      })
    })
  }

  private releaseSlot(): void {
    this.running = Math.max(0, this.running - 1)
    const next = this.waiting.shift()
    if (next) next()
  }

  private async runDownload(
    id: string,
    entry: PluginAssetCatalogEntry,
    controller: AbortController
  ): Promise<PluginAssetStatus> {
    const abs = this.absolutePath(id)
    const part = this.partPath(id)
    await mkdir(dirname(abs), { recursive: true })
    this.failures.delete(id)

    let lastError = 'no usable source'
    for (const url of entry.urls) {
      try {
        await this.downloadFromUrl(id, entry, url, part, controller)
        this.emitProgress(id, 'verifying', entry.size, entry.size, undefined, true)
        const hash = await this.hashFile(part)
        if (hash !== entry.sha256.toLowerCase()) {
          // 校验不过绝不落 ready：宁可报损坏，也不能让投毒文件冒充就绪
          await rm(part, { force: true })
          throw new Error(`sha256 mismatch from ${url}`)
        }
        await rm(abs, { force: true })
        await rename(part, abs)
        this.failures.delete(id)
        this.emitProgress(id, 'ready', entry.size, entry.size, undefined, true)
        return {
          id,
          state: 'ready',
          name: entry.name,
          size: entry.size,
          receivedBytes: entry.size,
          path: abs
        }
      } catch (error) {
        if (error instanceof AssetCancelledError) throw error
        lastError = error instanceof Error ? error.message : String(error)
      }
    }

    throw new Error(lastError)
  }

  private async downloadFromUrl(
    id: string,
    entry: PluginAssetCatalogEntry,
    url: string,
    part: string,
    controller: AbortController
  ): Promise<void> {
    let attempt = 0
    while (attempt < RETRY_PER_SOURCE) {
      attempt += 1
      try {
        await this.streamOnce(id, entry, url, part, controller)
        return
      } catch (error) {
        if (error instanceof AssetCancelledError) throw error
        if (attempt >= RETRY_PER_SOURCE) throw error
        // 指数退避：0.5s / 1s —— 用户看得见的等待，别让他以为卡死
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
      }
    }
  }

  private async streamOnce(
    id: string,
    entry: PluginAssetCatalogEntry,
    url: string,
    part: string,
    controller: AbortController
  ): Promise<void> {
    const existing = (await this.sizeOf(part)) ?? 0
    if (existing > entry.size) {
      // `.part` 比目标还大 ⇒ 上次的表写错了或文件换版了，重来
      await truncate(part, 0)
    }
    const offset = Math.min(existing, entry.size)

    if (offset >= entry.size && offset > 0) {
      // 已经下满，交给调用方去校验
      this.emitProgress(id, 'verifying', offset, entry.size, undefined, true)
      return
    }

    const headers: Record<string, string> = {}
    if (offset > 0) headers['Range'] = `bytes=${offset}-`

    let sink: ReturnType<typeof createWriteStream> | null = null
    try {
      const response = await this.fetchImpl(url, { headers, signal: controller.signal })
      if (response.status === 416 && offset > 0) {
        // 服务端认为我们已经拿全了
        this.emitProgress(id, 'verifying', offset, entry.size, undefined, true)
        return
      }
      if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`)

      const supportResume = response.status === 206
      let written = supportResume ? offset : 0
      if (!supportResume && offset > 0) await truncate(part, 0)

      sink = createWriteStream(part, { flags: supportResume ? 'a' : 'w' })
      const body = response.body
      if (!body) throw new Error(`empty response body from ${url}`)

      this.emitProgress(id, 'downloading', written, entry.size, undefined, true)

      const reader = body.getReader()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (controller.signal.aborted) throw new AssetCancelledError()
          if (!value) continue
          written += value.byteLength
          if (!sink.write(Buffer.from(value))) {
            await new Promise<void>((resolve) => sink!.once('drain', () => resolve()))
          }
          this.emitProgress(id, 'downloading', written, entry.size)
        }
      } finally {
        reader.releaseLock?.()
      }

      if (written !== entry.size) {
        throw new Error(`incomplete: got ${written} of ${entry.size} bytes from ${url}`)
      }
    } catch (error) {
      // abort 抛出来的是各式各样的（DOMException / TypeError / AbortError），
      // 统一按 signal 判定，不靠错误类型
      if (controller.signal.aborted) throw new AssetCancelledError()
      throw error
    } finally {
      if (sink) await new Promise<void>((resolve) => sink!.end(() => resolve()))
    }
  }

  private async sizeOf(path: string): Promise<number | null> {
    try {
      const info = await stat(path)
      return info.isFile() ? info.size : null
    } catch {
      return null
    }
  }

  private async hashFile(path: string): Promise<string> {
    const hash = createHash('sha256')
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(path)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve())
      stream.on('error', reject)
    })
    return hash.digest('hex')
  }
}
