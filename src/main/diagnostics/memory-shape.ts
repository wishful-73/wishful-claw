/*
 * 内存观测的纯函数部分（S-247）。
 *
 * 单独拆出来只有一个理由：**能测**。`app.getAppMetrics()` 只能在真机 Electron 里跑，
 * 而单位换算（KB→字节）、类型映射、阈值判断、告警去重这些恰恰是最容易写错的地方，
 * 写错了还不会报错 —— 只会让面板显示一个错的数字。所以这层不 import electron。
 */

import type { MemoryProcessKind, MemoryProcessRow, WorkerMemoryRow } from '../../shared/diagnostics-types'

const KB = 1024

/** 单进程工作集越过 1.5 GB 记一次 Warn。 */
export const WARN_PROCESS_WORKING_SET_BYTES = 1_536 * 1024 * 1024
/** Worker 托管堆越过 800 MB 记一次 Warn（托管堆才是真泄漏的指纹，工作集含未归还的碎片）。 */
export const WARN_WORKER_MANAGED_BYTES = 800 * 1024 * 1024
/** 同一个 pid 的重复告警间隔。 */
export const WARN_DEDUPE_MS = 10 * 60_000

/** `app.getAppMetrics()` 里我们真正用到的那几个字段（其余忽略）。 */
export interface RawAppMetric {
  pid: number
  type?: string
  memory?: {
    workingSetSize?: number
    peakWorkingSetSize?: number
  }
}

export function mapProcessKind(electronType: string): MemoryProcessKind {
  switch (electronType) {
    case 'Browser':
      return 'main'
    case 'Tab':
      return 'renderer'
    case 'GPU':
      return 'gpu'
    case 'Utility':
    case 'Pepper Plugin':
    case 'Pepper Plugin Broker':
    case 'Sandbox helper':
    case 'Zygote':
      return 'utility'
    default:
      return 'other'
  }
}

/**
 * Electron 报的 KB 换成字节。**只在这里换一次** —— 渲染端再除一遍就是两处换算。
 * 缺字段按 0 处理：拿不到读数不该让整张表消失。
 */
export function buildProcessRows(metrics: readonly RawAppMetric[]): MemoryProcessRow[] {
  return metrics.map((metric) => {
    const electronType = String(metric.type ?? 'unknown')
    return {
      kind: mapProcessKind(electronType),
      electronType,
      pid: metric.pid,
      workingSetBytes: (metric.memory?.workingSetSize ?? 0) * KB,
      peakWorkingSetBytes: (metric.memory?.peakWorkingSetSize ?? 0) * KB
    }
  })
}

/** 合计 = 所有 Electron 进程 + Worker（Worker 是独立进程，不在这份 metrics 里）。 */
export function sumWorkingSet(
  rows: readonly MemoryProcessRow[],
  worker: WorkerMemoryRow | null
): number {
  return rows.reduce((sum, row) => sum + row.workingSetBytes, 0) + (worker?.workingSetBytes ?? 0)
}

export function exceedsProcessThreshold(bytes: number): boolean {
  return bytes >= WARN_PROCESS_WORKING_SET_BYTES
}

/**
 * Worker `worker/memory` 的原始回包 → 结构化行（S-247 §19.6）。
 *
 * **为什么必须有这个函数**：C# 侧 `WishfulClawJsonContext` 用的是
 * `JsonKnownNamingPolicy.CamelCase`（`WishfulClawJsonContext.cs:14`），回包字段是
 * `pid` / `managedBytes` / …；而这里原先按 PascalCase 读 `raw.Pid`，每个字段都
 * `undefined` ⇒ `Number(undefined ?? 0)` = 0。结果 Worker 内存从上线起**一直记 0**，
 * 563MB 的真实占用从没进过日志。这种错不报错、不崩、只是数字悄悄变假，
 * 所以映射单独拆成纯函数，配回归测试钉住字段名。
 *
 * `pid <= 0` 判为「没量到」返回 null，而不是返回一行全 0 的假数据 —— 假数据比缺数据更坏。
 */
export function mapWorkerMemory(raw: unknown): WorkerMemoryRow | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.success === false) return null

  const pid = toNonNegativeNumber(r.pid)
  if (pid <= 0) return null

  return {
    pid,
    managedBytes: toNonNegativeNumber(r.managedBytes),
    heapBytes: toNonNegativeNumber(r.heapBytes),
    fragmentedBytes: toNonNegativeNumber(r.fragmentedBytes),
    workingSetBytes: toNonNegativeNumber(r.workingSetBytes)
  }
}

function toNonNegativeNumber(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export function exceedsWorkerThreshold(managedBytes: number): boolean {
  return managedBytes >= WARN_WORKER_MANAGED_BYTES
}

/**
 * 同一个 pid 十分钟内只告警一次 —— 内存高是持续状态，5 分钟一条会刷满日志。
 * 只用调用方给的 map 做读写，无内部状态，便于测。
 */
export function shouldWarn(
  lastWarnAt: Map<number, number>,
  pid: number,
  now: number
): boolean {
  const previous = lastWarnAt.get(pid) ?? 0
  if (now - previous < WARN_DEDUPE_MS) return false
  lastWarnAt.set(pid, now)
  return true
}
