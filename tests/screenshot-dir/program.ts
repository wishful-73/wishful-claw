/*
 * 截图落盘目录与命名（S-283）。
 *
 * 存在理由：文件名是全仓库唯一一处「内容 → 路径」的映射，它错了会静默出事 ——
 * 哈希算错 ⇒ 去重失效、磁盘翻倍；扩展名错误 ⇒ 图片打不开。两个都看不出来，
 * 只能钉成断言。
 *
 * 钉死四组：
 *   ① 月目录 = 本地时间 yyyy-MM（不是 UTC，月末不会跨月错位）；
 *   ② 同字节 ⇒ 同名（去重的前提）；
 *   ③ 不同字节 ⇒ 不同名；
 *   ④ 目录必须与聊天图片 `images/` 分家（S-224 是用户资产，这里是工具产物）。
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  SCREENSHOTS_SUBDIR,
  formatScreenshotMonth,
  resolveScreenshotDir,
  screenshotFileNameFromBuffer
} from '../../src/main/lib/screenshot-dir'
import { CHAT_IMAGES_SUBDIR } from '../../src/main/lib/chat-image-dir'

let checks = 0

function checkEqual<T>(actual: T, expected: T, description: string): void {
  checks += 1
  assert.equal(actual, expected, `${description}（期望 ${String(expected)}，实得 ${String(actual)}）`)
}

function checkTrue(value: boolean, description: string): void {
  checks += 1
  assert.ok(value, description)
}

// ─── 1. 月目录 ───

checkEqual(formatScreenshotMonth(new Date(2026, 9, 26)), '2026-10', '本地时间 10 月')
checkEqual(formatScreenshotMonth(new Date(2026, 0, 5)), '2026-01', '一月补零')
checkEqual(formatScreenshotMonth(new Date(2026, 11, 31)), '2026-12', '十二月')
checkEqual(
  formatScreenshotMonth(new Date(2026, 0, 1, 0, 30)),
  '2026-01',
  '本地时间的月初不会被 UTC 挤到上一年十二月'
)

// ─── 2. 同字节 ⇒ 同名（去重前提）───

const pngBuffer = Buffer.from('fake-png-bytes')
checkEqual(
  screenshotFileNameFromBuffer(pngBuffer),
  screenshotFileNameFromBuffer(pngBuffer),
  '同字节两次调用文件名一致'
)
{
  // 桌面全屏与窗口自身走两个不同的 handler，但只要拍出来字节相同，就必须落同一个文件 ——
  // 否则「同一帧截两次」会白占两份盘。
  const a = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const b = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  checkTrue(a !== b, '（前置）两个 Buffer 对象不是同一个引用')
  checkEqual(screenshotFileNameFromBuffer(a), screenshotFileNameFromBuffer(b), '内容相同的两份字节同名')
}

// ─── 3. 不同输入 ⇒ 不同名 ───

checkTrue(
  screenshotFileNameFromBuffer(Buffer.from('frame-a')) !==
    screenshotFileNameFromBuffer(Buffer.from('frame-b')),
  '不同字节不同文件名'
)
{
  // 只差一个字节也要分开：桌面截图每一帧几乎都不一样，撞名就等于丢图。
  const base = Buffer.alloc(256, 0)
  const mutated = Buffer.from(base)
  mutated[255] = 1
  checkTrue(
    screenshotFileNameFromBuffer(base) !== screenshotFileNameFromBuffer(mutated),
    '仅末字节不同也必须不同名'
  )
}

// ─── 4. 名字形状 ───

checkEqual(screenshotFileNameFromBuffer(pngBuffer).length, 16 + '.png'.length, '16 位哈希 + .png')
checkTrue(screenshotFileNameFromBuffer(pngBuffer).endsWith('.png'), '扩展名固定 .png')
checkTrue(
  !screenshotFileNameFromBuffer(pngBuffer).includes('/') &&
    !screenshotFileNameFromBuffer(pngBuffer).includes('\\'),
  '文件名不含路径分隔符'
)
checkTrue(
  /^[0-9a-f]{16}\.png$/.test(screenshotFileNameFromBuffer(pngBuffer)),
  '形如 16 位小写十六进制 + .png'
)

// ─── 5. 目录拼接 ───

checkEqual(
  resolveScreenshotDir('/data', new Date(2026, 9, 26)),
  join('/data', SCREENSHOTS_SUBDIR, '2026-10'),
  '目录 = dataRoot/screenshots/yyyy-MM'
)
checkEqual(SCREENSHOTS_SUBDIR, 'screenshots', '子目录名固定 screenshots')
checkTrue(
  SCREENSHOTS_SUBDIR !== CHAT_IMAGES_SUBDIR,
  '截图目录必须与聊天图片目录分家（一个是工具产物、一个是用户资产）'
)

console.log(`截图落盘目录与命名检查通过（${checks} 项断言）。`)
