/*
 * 诊断类型（S-247）：主进程采样、渲染端展示，两边共用一份。
 *
 * 单位统一为**字节**。`app.getAppMetrics()` 原生报 KB，转换只在主进程做一次 ——
 * 渲染端再除一遍就是"两处换算两处可能写错"。
 */

export type MemoryProcessKind = 'main' | 'renderer' | 'gpu' | 'utility' | 'other'

export interface MemoryProcessRow {
  kind: MemoryProcessKind
  /** Electron 报的原始类型（Browser / Tab / GPU…），排查时比分类值有用 */
  electronType: string
  pid: number
  workingSetBytes: number
  peakWorkingSetBytes: number
}

export interface WorkerMemoryRow {
  pid: number
  managedBytes: number
  heapBytes: number
  fragmentedBytes: number
  workingSetBytes: number
}

export interface MemorySnapshot {
  capturedAt: number
  processes: MemoryProcessRow[]
  /** Worker 没起、超时或报错时为 null —— 采样失败不该让整个面板空白 */
  worker: WorkerMemoryRow | null
  totalWorkingSetBytes: number
  warnings: string[]
}
