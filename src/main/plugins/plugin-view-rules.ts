/*
 * 插件视图的纯判据（S-241）—— 零 electron 依赖，便于单测。
 *
 * 抽出来的理由只有一个：这两条判据最容易写错，而且真机上撞到的概率最低。
 * 「entry 越出插件根」要是一个大小写/前缀边界没对齐，就等于让插件加载任意本地文件；
 * 「崩溃计数」要是一个时间窗算错，要么放过崩溃循环，要么把偶发崩溃当循环。
 */

import { posix } from 'path'

const WIN32 = process.platform === 'win32'
/**
 * 视图 entry 是否落在插件根内。
 *
 * 归一化器已经校验过一次，这里是第二道 —— `views[].entry` 来自插件自己写的
 * json，旧版插件或手改的清单可能绕过归一化。
 *
 * 判据自己解析 `.` / `..`，不依赖调用方先 resolve：调用点多一处漏 resolve，
 * 这条闸就等于不存在。统一分隔符再比前缀 —— `/` 与 `\` 混用是 Windows 上
 * 最常见的漏判来源。
 *
 * `caseInsensitive` 默认按平台（Windows 文件系统不区分大小写），单测可强制指定。
 */
export function isEntryInsideRoot(
  root: string,
  target: string,
  caseInsensitive: boolean = WIN32
): boolean {
  if (!root || !target) return false

  const normalize = (value: string): string => {
    const unified = value.replace(/\\/g, '/').replace(/\/+$/, '')
    const normalized = posix.normalize(unified)
    return caseInsensitive ? normalized.toLowerCase() : normalized
  }

  const rootKey = normalize(root)
  const targetKey = normalize(target)
  // 根目录本身不是文件 —— 相等不算「在里面」
  if (targetKey === rootKey) return false
  // 必须带分隔符，否则 `plugins/foo-bar` 会被当成 `plugins/foo` 的子路径
  const prefix = rootKey.endsWith('/') ? rootKey : `${rootKey}/`
  return targetKey.startsWith(prefix)
}

/** 淘汰超出窗口的崩溃时间戳，保持原有顺序。 */
export function pruneCrashStamps(stamps: number[], now: number, windowMs: number): number[] {
  return stamps.filter((stamp) => now - stamp < windowMs)
}

/** 窗口内达到上限就停手 —— 1 分钟崩 3 次的插件，问题在它自己，不在我们。 */
export function shouldStopReopening(stamps: number[], limit: number): boolean {
  return stamps.length >= limit
}
