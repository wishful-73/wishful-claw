/**
 * 渲染进程内存构成探针（S-247 §13.4，E 维度 —— **最后一个探针**）。
 *
 * ## 只回答一个问题
 *
 * 执行 agent 任务时进程 WS 冲到 1.1~1.4 GB，而 V8 堆只有 230 MB、Blink 资源合计
 * < 15 MB、消息数据 0.2 MB、DOM 节点与空闲态持平（§13.2 全部排除）。那 ~920 MB
 * 缺口在哪？
 *
 * 只可能在 V8 堆外：
 *
 * | 字段 | 含义 |
 * |---|---|
 * | `rss` | 进程工作集（= 老大在任务管理器看到的数） |
 * | `heapUsed` / `heapTotal` | V8 堆已用 / 已申请（消息、组件、JS 对象都在这） |
 * | `external` | V8 堆外，C++ 对象 + `ArrayBuffer` / `TypedArray` 的 backing store |
 * | `arrayBuffers` | 其中 `ArrayBuffer` + `Buffer` 占的部分 |
 * | `native` | `rss - heapTotal - external`，剩下的是 Blink / Skia / malloc |
 *
 * ## 判读（§13.5，拿到数据直接开工，不再讨论方向）
 *
 * - `external` / `arrayBuffers` 几百 MB ⇒ **锁定 ArrayBuffer**。头号嫌疑是流式事件
 *   每个都走一次 `decodeMessagePackPayload`（`src/preload/index.ts`），产出大量
 *   `ArrayBuffer`。修法按 §13.5-A 顺序查。
 * - `external` 很小而 `native` 很大 ⇒ 落在 malloc / 碎片，走 §13.5-B。
 *
 * ## 两条硬约束（都是踩过的坑）
 *
 * 1. **绝不 import `electron`**（§12.7）。渲染端 import 它会在启动链最前面炸，
 *    表现为白屏而不是报错弹窗，`typecheck` 抓不到。这里只用 `window.api`。
 * 2. **不是泄漏就别当成泄漏修**。§12.9 已实测 1175 MB 能在 29 秒内掉回 142 MB，
 *    V8 收得回来。所以不做定时 GC、不做强制回收（§7）。
 *
 * 定性完连本文件一起删。
 */

import { writeLog } from '@renderer/lib/error-logger'

/** 采样间隔。15 秒 —— 单行输出，比原来的 30 秒密一倍，为了不漏掉短任务的峰值。 */
const SAMPLE_INTERVAL_MS = 15_000

const MB = 1024 * 1024

function toMb(bytes: number): string {
  return `${(bytes / MB).toFixed(1)}MB`
}

interface ProcessMemorySample {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers: number
}

function readSample(): ProcessMemorySample | null {
  try {
    const api = (window as unknown as { api?: { getProcessMemory?: () => ProcessMemorySample } }).api
    if (!api?.getProcessMemory) return null
    return api.getProcessMemory()
  } catch {
    return null
  }
}

function emitLine(sample: ProcessMemorySample): void {
  // native = 进程工作集 - V8 已申请堆 - V8 堆外。负数说明 V8 堆已归还但 RSS 未回落，
  // 照原样打印（钳到 0 会掩盖「页没还给系统」这个事实）。
  const native = sample.rss - sample.heapTotal - sample.external
  const line =
    `renderer probe ext rss=${toMb(sample.rss)} heapUsed=${toMb(sample.heapUsed)}` +
    ` heapTotal=${toMb(sample.heapTotal)} external=${toMb(sample.external)}` +
    ` arrayBuffers=${toMb(sample.arrayBuffers)} native=${toMb(native)}`
  void writeLog('info', line)
}

let timer: ReturnType<typeof setInterval> | null = null

/** 启动探针。重复调用无副作用。 */
export function startRendererMemoryProbe(): void {
  if (timer) return
  const tick = (): void => {
    const sample = readSample()
    if (sample) emitLine(sample)
  }
  tick()
  timer = setInterval(tick, SAMPLE_INTERVAL_MS)
}

export function stopRendererMemoryProbe(): void {
  if (timer) clearInterval(timer)
  timer = null
}
