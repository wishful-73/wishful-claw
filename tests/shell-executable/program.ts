// iter-31 S-56 — 默认 shell 端点解析。
//
// 「设置 → 终端与 SSH」里选的默认 Shell 落到主进程 spawn 时，中间只经过这一个纯函数：
//   terminal-store.createTab → resolveShellExecutable() → TERMINAL_CREATE.shell
// 返回 undefined 表示「不指定」，由主进程走自己的候选链（PowerShell 优先，cmd 兜底）。
//
// 重点锁四条：
//   1. auto 与非法值都归 undefined —— 这是「让主进程自己挑」的唯一表示
//   2. 各端点只在自己平台上解析出可执行文件，跨平台必须 undefined（回落候选链）
//   3. custom 取用户填的路径并 trim；空白等于没填
//   4. normalizeShellExecutionEndpoint 是唯一入口，非法值一律回落 auto

import assert from 'node:assert/strict'
import {
  DEFAULT_SHELL_EXECUTION_ENDPOINT,
  normalizeShellExecutionEndpoint,
  resolveShellExecutable
} from '../../src/renderer/src/stores/settings-store-types'
import type { ShellExecutionEndpoint } from '../../src/renderer/src/stores/settings-store-types'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

function resolve(
  endpoint: ShellExecutionEndpoint,
  platform: string,
  customShellExecutable?: string
): string | undefined {
  return resolveShellExecutable({ endpoint, customShellExecutable, platform })
}

// ── auto：不指定，交给主进程候选链 ───────────────────────────────────────

eq(DEFAULT_SHELL_EXECUTION_ENDPOINT, 'auto', '出厂默认是 auto')
eq(resolve('auto', 'win32'), undefined, 'win32 下 auto 不指定可执行文件')
eq(resolve('auto', 'darwin'), undefined, 'darwin 下 auto 不指定可执行文件')
eq(resolve('auto', 'linux'), undefined, 'linux 下 auto 不指定可执行文件')

// ── Windows 端点 ─────────────────────────────────────────────────────────

eq(resolve('powershell', 'win32'), 'powershell.exe', 'win32 下 powershell → powershell.exe')
eq(resolve('pwsh', 'win32'), 'pwsh.exe', 'win32 下 pwsh → pwsh.exe')
eq(resolve('cmd', 'win32'), 'cmd.exe', 'win32 下 cmd → cmd.exe')

// ── POSIX 端点 ───────────────────────────────────────────────────────────

eq(resolve('zsh', 'darwin'), '/bin/zsh', 'darwin 下 zsh → /bin/zsh')
eq(resolve('bash', 'linux'), '/bin/bash', 'linux 下 bash → /bin/bash')
eq(resolve('sh', 'linux'), '/bin/sh', 'linux 下 sh → /bin/sh')

// ── 跨平台：选了自己平台上没有的端点 → undefined（回落候选链） ───────────

eq(resolve('zsh', 'win32'), undefined, 'win32 下选 zsh 解析不出，回落候选链')
eq(resolve('bash', 'win32'), undefined, 'win32 下选 bash 解析不出，回落候选链')
eq(resolve('powershell', 'darwin'), undefined, 'darwin 下选 powershell 解析不出')
eq(resolve('cmd', 'linux'), undefined, 'linux 下选 cmd 解析不出')

// ── custom ───────────────────────────────────────────────────────────────

eq(resolve('custom', 'win32', 'D:\\tools\\nu.exe'), 'D:\\tools\\nu.exe', 'custom 取用户填的路径')
eq(resolve('custom', 'win32', '  C:\\bin\\sh.exe  '), 'C:\\bin\\sh.exe', 'custom 路径两端空白被 trim')
eq(resolve('custom', 'win32', ''), undefined, 'custom 为空等于没填')
eq(resolve('custom', 'win32', '   '), undefined, 'custom 只有空白等于没填')
eq(resolve('custom', 'win32'), undefined, 'custom 未提供值时等于没填')

// ── platform 缺失 / 大小写 / 空白 ────────────────────────────────────────

eq(resolve('powershell', ''), undefined, 'platform 为空串时解析不出')
eq(resolve('powershell', ' WIN32 '), 'powershell.exe', 'platform 的大小写与空白被规范化')

// ── normalizeShellExecutionEndpoint ──────────────────────────────────────

const legal: ShellExecutionEndpoint[] = [
  'auto',
  'zsh',
  'bash',
  'sh',
  'powershell',
  'pwsh',
  'cmd',
  'custom'
]
for (const value of legal) {
  eq(normalizeShellExecutionEndpoint(value), value, `合法端点原样保留：${value}`)
}
eq(normalizeShellExecutionEndpoint('nope'), 'auto', '非法字符串回落 auto')
eq(normalizeShellExecutionEndpoint(''), 'auto', '空串回落 auto')
eq(normalizeShellExecutionEndpoint(undefined), 'auto', 'undefined 回落 auto')
eq(normalizeShellExecutionEndpoint(null), 'auto', 'null 回落 auto')
eq(normalizeShellExecutionEndpoint(42), 'auto', '数字回落 auto')
eq(normalizeShellExecutionEndpoint({}), 'auto', '对象回落 auto')

console.log(`shell executable checks passed (${checks} assertions).`)
