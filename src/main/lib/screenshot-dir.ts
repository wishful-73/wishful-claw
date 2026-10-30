/**
 * 截图落盘的目录与命名（S-283）。
 *
 * 目录：`{dataRoot}/screenshots/{yyyy-MM}/{sha256 前 16 位}.png`
 *
 * 与 `images/`（聊天图片，S-224）分开：那边是用户资产，这边是工具产物 —— 量大、
 * 需要能整体清理，混在一起用户翻目录会懵。
 *
 * 命名照抄 `chat-image-dir.ts` 的手法：按**内容哈希**取名，同一张桌面截图重复捕获
 * 天然去重，不会把盘撑爆；按**本地年月**分目录，用 UTC 会在月初月末把图分错月份。
 *
 * 纯函数、零 electron 依赖 —— 命名规则要被 node 单测直接覆盖。
 */

import { createHash } from 'crypto'
import { join } from 'path'

export const SCREENSHOTS_SUBDIR = 'screenshots'

/** 本地时间的 `yyyy-MM`。UTC 会把月初/月末的截图分到错误的月份。 */
export function formatScreenshotMonth(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * 文件名 = 内容 sha256 前 16 位 + `.png`。
 *
 * 对**解码后的字节**求哈希：同一张截图无论从哪条路径进来（桌面全屏 / 窗口自身），
 * 只要字节相同就落同一个文件名，天然去重。
 */
export function screenshotFileNameFromBuffer(buffer: Buffer): string {
  const digest = createHash('sha256').update(buffer).digest('hex')
  return `${digest.slice(0, 16)}.png`
}

export function resolveScreenshotDir(dataRoot: string, date: Date): string {
  return join(dataRoot, SCREENSHOTS_SUBDIR, formatScreenshotMonth(date))
}
