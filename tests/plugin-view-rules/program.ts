/*
 * Guard: 插件视图的两条纯判据（S-241）。
 *
 * 为什么这两条要有单测：真机上一辈子也可能撞不到边界。
 * ① `isEntryInsideRoot` 判错的方向是「放行」—— 插件清单里写一条 `../../..` 的 entry，
 *    主进程就会去加载插件根之外的任意本地文件，而且权限全开。这类错误不会报错，
 *    只会安静地多开一个窗口。
 * ② 崩溃计数判错的方向同样是「放行」—— 一个一启动就崩的插件会把渲染进程重启
 *    无限次，CPU 占满，用户只看到风扇转。
 *
 * 两条都是纯函数，不打桩、不启 Electron。
 */

import assert from 'node:assert/strict'
import {
  isEntryInsideRoot,
  pruneCrashStamps,
  shouldStopReopening
} from '../../src/main/plugins/plugin-view-rules'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

// ─── ① entry 必须落在插件根内 ───

// Windows 语义（默认按平台，这里显式传 true 让断言与平台无关）
check(
  isEntryInsideRoot('C:\\plugins\\foo', 'C:\\plugins\\foo\\view.html', true),
  'direct child file must be inside the root'
)
check(
  isEntryInsideRoot('C:\\plugins\\foo\\', 'C:\\plugins\\foo\\dist\\index.html', true),
  'trailing separator on the root must not break the check'
)
check(
  isEntryInsideRoot('C:\\plugins\\foo', 'C:\\PLUGINS\\FOO\\view.html', true),
  'Windows paths are case-insensitive'
)
check(
  !isEntryInsideRoot('C:\\plugins\\foo', 'C:\\PLUGINS\\FOO\\view.html', false),
  'case-sensitive mode must reject a case mismatch'
)

// 逃逸与同前缀兄弟目录 —— 两条最容易被 startsWith 骗过去
check(
  !isEntryInsideRoot('C:\\plugins\\foo', 'C:\\plugins\\foo\\..\\bar\\evil.html', true),
  'dot-dot escape must be rejected once the path is resolved'
)
check(
  !isEntryInsideRoot('C:\\plugins\\foo', 'C:\\plugins\\foo\\..\\..\\Windows\\System32\\x.html', true),
  'multi-level escape must be rejected'
)
check(
  !isEntryInsideRoot('C:\\plugins\\foo', 'C:\\plugins\\foo-bar\\view.html', true),
  'sibling directory sharing the prefix must not pass'
)
check(
  !isEntryInsideRoot('C:\\plugins\\foo', 'C:\\plugins\\foobar', true),
  'sibling directory with a longer name must not pass'
)

// 分隔符混用：清单里写 `/`、系统拼出 `\`，混着比必漏
check(
  isEntryInsideRoot('C:\\plugins\\foo', 'C:/plugins/foo/view.html', true),
  'forward slashes must be normalized before comparing'
)
check(
  isEntryInsideRoot('C:/plugins/foo', 'C:\\plugins\\foo\\view.html', true),
  'backslashes must be normalized the other way too'
)

// 边界输入
check(!isEntryInsideRoot('C:\\plugins\\foo', 'C:\\plugins\\foo', true), 'the root itself is not a file')
check(!isEntryInsideRoot('', 'C:\\plugins\\foo\\view.html', true), 'empty root must be rejected')
check(!isEntryInsideRoot('C:\\plugins\\foo', '', true), 'empty target must be rejected')

// ─── ② 崩溃计数：1 分钟内 ≤ 3 次，超过停手 ───

const WINDOW_MS = 60_000
const LIMIT = 3
const t0 = 1_700_000_000_000

check(pruneCrashStamps([], t0, WINDOW_MS).length === 0, 'empty stamp list stays empty')
check(
  pruneCrashStamps([t0 - 10_000, t0 - 70_000], t0, WINDOW_MS).length === 1,
  'stamps older than the window are dropped'
)
check(
  pruneCrashStamps([t0 - 59_999], t0, WINDOW_MS).length === 1,
  'a stamp just inside the window survives'
)
check(
  pruneCrashStamps([t0 - 60_000], t0, WINDOW_MS).length === 0,
  'a stamp exactly on the window edge is dropped (open interval)'
)

check(!shouldStopReopening([t0], LIMIT), 'one crash is not a loop')
check(!shouldStopReopening([t0, t0 + 1], LIMIT), 'two crashes are not a loop')
check(shouldStopReopening([t0, t0 + 1, t0 + 2], LIMIT), 'three crashes inside the window stop reopening')
check(
  shouldStopReopening([t0, t0 + 1, t0 + 2, t0 + 3], LIMIT),
  'more than three crashes also stop (never falls back to allowed)'
)

// 第三次崩溃时，第一次已滑出窗口 ⇒ 不该被当成循环
const spread = [t0 - 120_000, t0 - 100_000, t0]
check(
  !shouldStopReopening(pruneCrashStamps(spread, t0, WINDOW_MS), LIMIT),
  'crashes spread across more than a minute must not count as a loop'
)

console.log(`plugin-view rules checks passed (${checks} assertions)`)
