// 更新器状态回归入口：按原顺序加载各断言套件，最后统一汇总。
// 拆分自原单文件 program.ts（S-252，2026-10-28），断言本体已逐字迁出。

import './suites/state'
import './suites/lifecycle'
import './suites/gates'
import './suites/release-notes'
import { checks, runAsyncChecks } from './harness'

void runAsyncChecks().then(() => {
  console.log(`updater-state: ${checks} checks passed`)
})
