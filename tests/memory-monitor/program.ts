/*
 * S-247 回归：内存观测的口径。
 *
 * 断言的重点不是「数字对不对」，而是**三种最容易悄悄出错的地方**：
 *   1. 单位 —— Electron 报 KB，我们对外说字节，换错一次面板就显示「1/1024」的假象；
 *   2. 类型映射 —— Browser 才是主进程，Tab 是渲染进程，映射错整张表都在说谎；
 *   3. 告警去重 —— 去重失效会 5 分钟刷满日志，阈值写反则从来不会告警。
 *
 * 这三类错了都不会抛异常，只会让人看着一个错的结论去做优化 —— 比崩溃更贵。
 */

import {
  buildProcessRows,
  exceedsProcessThreshold,
  exceedsWorkerThreshold,
  mapProcessKind,
  shouldWarn,
  sumWorkingSet,
  WARN_PROCESS_WORKING_SET_BYTES,
  WARN_WORKER_MANAGED_BYTES,
  WARN_DEDUPE_MS
} from '../../src/main/diagnostics/memory-shape'
import type { MemoryProcessRow, WorkerMemoryRow } from '../../src/shared/diagnostics-types'

let assertions = 0
function assert(condition: boolean, message: string): void {
  assertions += 1
  if (!condition) throw new Error(message)
}

function checkKindMapping(): void {
  assert(mapProcessKind('Browser') === 'main', 'Browser is the main process')
  assert(mapProcessKind('Tab') === 'renderer', 'Tab is a renderer')
  assert(mapProcessKind('GPU') === 'gpu', 'GPU maps to gpu')
  assert(mapProcessKind('Utility') === 'utility', 'Utility is utility')
  assert(mapProcessKind('Pepper Plugin') === 'utility', 'Pepper Plugin is utility')
  assert(mapProcessKind('Zygote') === 'utility', 'Zygote is utility')
  // Electron 的类型值是原样字符串，不做大小写兜底 —— 兜底会让真出现新类型时被静默归错
  assert(mapProcessKind('browser') === 'other', 'unknown casing falls back to other')
  assert(mapProcessKind('') === 'other', 'empty type falls back to other')
}

function checkRowBuilding(): void {
  const rows = buildProcessRows([
    { pid: 100, type: 'Browser', memory: { workingSetSize: 1024, peakWorkingSetSize: 2048 } },
    { pid: 200, type: 'Tab', memory: { workingSetSize: 512 * 1024 } },
    { pid: 300, type: 'GPU' },
    { pid: 400 }
  ])

  assert(rows.length === 4, 'one row per metric')
  assert(rows[0].pid === 100, 'row keeps pid')
  assert(rows[0].kind === 'main', 'main row kind')
  assert(rows[0].workingSetBytes === 1_048_576, '1024 KB becomes 1048576 bytes')
  assert(rows[0].peakWorkingSetBytes === 2_097_152, 'peak is converted the same way')
  assert(rows[1].kind === 'renderer', 'renderer row kind')
  assert(rows[1].workingSetBytes === 536_870_912, '512 MB stays 512 MB')
  assert(rows[1].peakWorkingSetBytes === 0, 'missing peak becomes 0, never NaN')
  assert(rows[0].electronType === 'Browser', 'raw electron type is kept for diagnostics')
  assert(rows[2].kind === 'gpu', 'GPU row kind')
  assert(rows[2].workingSetBytes === 0, 'a metric without memory becomes 0, never NaN')
  assert(rows[3].electronType === 'unknown', 'missing type is reported as unknown')
  assert(rows[3].kind === 'other', 'missing type is classified as other')
}

function checkTotals(): void {
  const rows: MemoryProcessRow[] = buildProcessRows([
    { pid: 1, type: 'Browser', memory: { workingSetSize: 1024 } },
    { pid: 2, type: 'Tab', memory: { workingSetSize: 1024 } }
  ])
  const worker: WorkerMemoryRow = {
    pid: 9,
    managedBytes: 10,
    heapBytes: 20,
    fragmentedBytes: 5,
    workingSetBytes: 1024 * 1024
  }

  assert(sumWorkingSet([], null) === 0, 'empty snapshot totals 0')
  assert(sumWorkingSet(rows, null) === 2_097_152, 'two 1 MB rows total 2 MB')
  assert(sumWorkingSet(rows, worker) === 3_145_728, 'worker working set is added, managed is not')
}

function checkThresholds(): void {
  assert(WARN_PROCESS_WORKING_SET_BYTES === 1_610_612_736, 'process threshold is 1.5 GB in bytes')
  assert(WARN_WORKER_MANAGED_BYTES === 838_860_800, 'worker threshold is 800 MB in bytes')

  assert(!exceedsProcessThreshold(WARN_PROCESS_WORKING_SET_BYTES - 1), 'below threshold is silent')
  assert(exceedsProcessThreshold(WARN_PROCESS_WORKING_SET_BYTES), 'exactly at threshold warns')
  assert(exceedsProcessThreshold(WARN_PROCESS_WORKING_SET_BYTES + 1), 'above threshold warns')
  assert(exceedsWorkerThreshold(WARN_WORKER_MANAGED_BYTES), 'worker uses its own threshold')
  assert(exceedsWorkerThreshold(WARN_PROCESS_WORKING_SET_BYTES), 'a 1.5 GB heap crosses the worker threshold too')
}

function checkWarnDedupe(): void {
  const map = new Map<number, number>()

  assert(shouldWarn(map, 100, 1_000_000), 'first sighting warns')
  assert(!shouldWarn(map, 100, 1_000_000 + WARN_DEDUPE_MS - 1), 'same pid inside window stays quiet')
  assert(shouldWarn(map, 100, 1_000_000 + WARN_DEDUPE_MS), 'same pid after window warns again')
  assert(shouldWarn(map, 200, 1_000_000 + 1), 'a different pid is not swallowed by the first one')
  assert(map.get(100) === 1_000_000 + WARN_DEDUPE_MS, 'the map records the moment we actually warned')
}

checkKindMapping()
checkRowBuilding()
checkTotals()
checkThresholds()
checkWarnDedupe()

console.log(`memory-monitor: ${assertions} assertions passed`)
