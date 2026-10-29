/*
 * 诊断 IPC（S-247）。
 *
 * 只开一个动作：读内存快照。**刻意不开放「清 GC」「杀进程」这类动作** ——
 * S-247 §7 明确不做自动回收，那么也不该给渲染端一个入口。
 */

import { registerMessagePackHandler } from './messagepack-handler'
import { readMemorySnapshot, type MemorySnapshot } from '../diagnostics/memory-monitor'

export function registerDiagnosticsHandlers(): void {
  registerMessagePackHandler<undefined, MemorySnapshot>('diagnostics:memory', async () => {
    return await readMemorySnapshot()
  })
}
