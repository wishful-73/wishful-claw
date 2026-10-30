/*
 * 内存观测（S-247 第一步）。
 *
 * 这条需求不是「把内存降下来」，是「让内存自己说话」—— 老大报的「占用奇高但没在用东西」
 * 至今没有量化口径，事后也没法复盘。所以这里只做三件事：
 *
 *   1. 采样：`app.getAppMetrics()` 一次拿全主/渲染/GPU/utility（比分别采样口径一致），
 *      Worker 走它早就写好、但从来没人调的 `worker/memory` 端点。
 *   2. 落日志：低频（5 分钟）每个进程一行，格式固定 —— 「事后能指出是哪个进程、什么时候开始涨」。
 *   3. 超阈值告警：单进程或 Worker 托管堆越线时 Warn 一次（同 pid 十分钟内不重复刷）。
 *
 * **不做**：定时 GC、杀渲染进程、设内存上限（S-247 §7）。在数据说真泄漏之前动手，
 * 等于把正常占用当泄漏修，副作用比症状更贵。
 */

import { app } from 'electron'
import { getNativeWorker } from '../lib/native-worker'
import { logInfo, logWarn } from '../lib/logger'
import type {
  MemoryProcessRow,
  MemorySnapshot,
  WorkerMemoryRow
} from '../../shared/diagnostics-types'
import {
  buildProcessRows,
  exceedsProcessThreshold,
  exceedsWorkerThreshold,
  shouldWarn,
  sumWorkingSet,
  WARN_PROCESS_WORKING_SET_BYTES
} from './memory-shape'

export type {
  MemoryProcessKind,
  MemoryProcessRow,
  MemorySnapshot,
  WorkerMemoryRow
} from '../../shared/diagnostics-types'

/** 面板刷新用（主进程每 5 s 采一次，渲染端读缓存）。 */
export const MEMORY_SAMPLE_INTERVAL_MS = 5_000
/** 落日志间隔（5 分钟）—— 低频是为了不淹掉真正有用的日志。 */
export const MEMORY_LOG_INTERVAL_MS = 5 * 60_000

interface RawWorkerMemory {
  Success?: boolean
  Pid?: number
  ManagedBytes?: number
  HeapBytes?: number
  FragmentedBytes?: number
  WorkingSetBytes?: number
  Error?: string | null
}

async function captureWorkerMemory(): Promise<WorkerMemoryRow | null> {
  try {
    const raw = await getNativeWorker().request<RawWorkerMemory>('worker/memory', {}, 5_000)
    if (!raw || raw.Success === false) return null
    return {
      pid: Number(raw.Pid ?? 0),
      managedBytes: Number(raw.ManagedBytes ?? 0),
      heapBytes: Number(raw.HeapBytes ?? 0),
      fragmentedBytes: Number(raw.FragmentedBytes ?? 0),
      workingSetBytes: Number(raw.WorkingSetBytes ?? 0)
    }
  } catch {
    return null
  }
}

export async function captureMemorySnapshot(): Promise<MemorySnapshot> {
  const warnings: string[] = []
  let processes: MemoryProcessRow[] = []

  try {
    // getAppMetrics 的 memory 字段单位是 KB，换算在 buildProcessRows 里做一次
    processes = buildProcessRows(app.getAppMetrics())
  } catch (error) {
    warnings.push(`app metrics: ${(error as Error).message}`)
  }

  const worker = await captureWorkerMemory()
  if (!worker) warnings.push('worker memory unavailable')

  return {
    capturedAt: Date.now(),
    processes,
    worker,
    totalWorkingSetBytes: sumWorkingSet(processes, worker),
    warnings
  }
}

function toMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

let latest: MemorySnapshot | null = null
let sampleTimer: NodeJS.Timeout | null = null
let logTimer: NodeJS.Timeout | null = null
let ticking = false
const lastWarnAt = new Map<number, number>()

async function tick(): Promise<void> {
  // 采样会 await worker IPC；上一轮没回来就跳过，避免慢 Worker 把定时器叠成队列
  if (ticking) return
  ticking = true
  try {
    latest = await captureMemorySnapshot()
  } catch (error) {
    logWarn('main', `memory sample failed: ${(error as Error).message}`)
  } finally {
    ticking = false
  }
}

function emitLogLine(snapshot: MemorySnapshot): void {
  const now = Date.now()
  for (const row of snapshot.processes) {
    logInfo(
      'main',
      `memory role=${row.kind} type=${row.electronType} pid=${row.pid} ws=${toMb(row.workingSetBytes)} peak=${toMb(row.peakWorkingSetBytes)}`
    )
  }
  if (snapshot.worker) {
    logInfo(
      'main',
      `memory role=worker pid=${snapshot.worker.pid} ws=${toMb(snapshot.worker.workingSetBytes)} managed=${toMb(snapshot.worker.managedBytes)} heap=${toMb(snapshot.worker.heapBytes)} frag=${toMb(snapshot.worker.fragmentedBytes)}`
    )
  } else {
    logWarn('main', 'memory role=worker unavailable')
  }
  logInfo(
    'main',
    `memory total ws=${toMb(snapshot.totalWorkingSetBytes)} processes=${snapshot.processes.length}`
  )

  for (const row of snapshot.processes) {
    if (!exceedsProcessThreshold(row.workingSetBytes)) continue
    if (!shouldWarn(lastWarnAt, row.pid, now)) continue
    logWarn(
      'main',
      `memory high role=${row.kind} pid=${row.pid} ws=${toMb(row.workingSetBytes)} threshold=${toMb(WARN_PROCESS_WORKING_SET_BYTES)} total=${toMb(snapshot.totalWorkingSetBytes)}`
    )
  }

  if (snapshot.worker && exceedsWorkerThreshold(snapshot.worker.managedBytes)) {
    if (shouldWarn(lastWarnAt, snapshot.worker.pid, now)) {
      logWarn(
        'main',
        `memory high role=worker pid=${snapshot.worker.pid} managed=${toMb(snapshot.worker.managedBytes)} heap=${toMb(snapshot.worker.heapBytes)} frag=${toMb(snapshot.worker.fragmentedBytes)}`
      )
    }
  }
}

/** 启动采样与周期日志。重复调用无副作用（已有定时器就返回）。 */
export function startMemoryMonitor(): void {
  if (sampleTimer) return
  void tick()
  sampleTimer = setInterval(() => void tick(), MEMORY_SAMPLE_INTERVAL_MS)
  sampleTimer.unref?.()
  logTimer = setInterval(() => {
    if (latest) emitLogLine(latest)
  }, MEMORY_LOG_INTERVAL_MS)
  logTimer.unref?.()
}

export function stopMemoryMonitor(): void {
  if (sampleTimer) clearInterval(sampleTimer)
  if (logTimer) clearInterval(logTimer)
  sampleTimer = null
  logTimer = null
}

/** 渲染端拉取用：返回缓存快照；首次调用时现采一次，别让面板空白 5 秒。 */
export async function readMemorySnapshot(): Promise<MemorySnapshot> {
  if (!latest) latest = await captureMemorySnapshot()
  return latest
}
