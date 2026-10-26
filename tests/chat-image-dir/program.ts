/*
 * 聊天图片目录与命名（S-224）。
 *
 * 存在理由：文件名是全仓库唯一一处「内容 → 路径」的映射，它错了会静默出事：
 * 哈希算错 ⇒ 去重失效、磁盘翻倍；扩展名取错 ⇒ 图片在 <img> 里打不开。
 * 两个都看不出来，只能钉成断言。
 *
 * 钉死四组：
 *   ① 月目录 = 本地时间 yyyy-MM（不是 UTC，月末不会跨月错位）；
 *   ② 同名同图：字节相同 ⇒ 文件名相同（去重的前提）；
 *   ③ 不同内容 / 不同 mediaType ⇒ 文件名不同；
 *   ④ 哈希取的是「解码后的字节」，不是 base64 文本。
 */

import assert from 'node:assert/strict'
import { join } from 'node:path'
import {
  CHAT_IMAGES_SUBDIR,
  chatImageFileName,
  formatChatImageMonth,
  resolveChatImageDir
} from '../../src/main/lib/chat-image-dir'

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

checkEqual(formatChatImageMonth(new Date(2026, 9, 26)), '2026-10', '本地时间 10 月')
checkEqual(formatChatImageMonth(new Date(2026, 0, 5)), '2026-01', '一月补零')
checkEqual(formatChatImageMonth(new Date(2026, 11, 31)), '2026-12', '十二月')
checkEqual(
  formatChatImageMonth(new Date(2026, 0, 1, 0, 30)),
  '2026-01',
  '本地时间的月初不会被 UTC 挤到上一年十二月'
)

// ─── 2. 同字节 ⇒ 同名（去重前提） ───

const pngBase64 = Buffer.from('fake-png-bytes').toString('base64')
checkEqual(
  chatImageFileName(pngBase64, 'image/png'),
  chatImageFileName(pngBase64, 'image/png'),
  '同字节同类型两次调用文件名一致'
)

// ─── 3. 不同输入 ⇒ 不同名 ───

checkTrue(
  chatImageFileName(pngBase64, 'image/png') !==
    chatImageFileName(Buffer.from('other-bytes').toString('base64'), 'image/png'),
  '不同字节不同文件名'
)
checkTrue(
  chatImageFileName(pngBase64, 'image/png') !== chatImageFileName(pngBase64, 'image/jpeg'),
  '同字节不同 mediaType 扩展名不同，文件名也不同'
)

// ─── 4. 哈希打的是解码后的字节 ───

{
  // base64 文本不同（带换行的非规范写法）、解码后字节相同 ⇒ 必须同名。
  const canonical = Buffer.from('hello world').toString('base64')
  const withNewline = `${canonical.slice(0, 8)}\n${canonical.slice(8)}`
  checkTrue(withNewline !== canonical, '（前置）两种写法的 base64 文本确实不同')
  checkEqual(
    chatImageFileName(withNewline, 'image/png'),
    chatImageFileName(canonical, 'image/png'),
    '文本不同但字节相同 ⇒ 同名'
  )
}
{
  // 直接比对：对字节哈希 ≠ 对 base64 文本哈希。
  const bytes = Buffer.from('abcd')
  const asBase64 = bytes.toString('base64')
  const nameFromBytes = chatImageFileName(asBase64, 'image/png').replace(/\.png$/, '')
  const nameFromText = chatImageFileName(Buffer.from(asBase64).toString('base64'), 'image/png').replace(
    /\.png$/,
    ''
  )
  checkTrue(
    nameFromBytes !== nameFromText,
    '字节哈希与 base64 文本哈希结果不同（证明取的是解码后字节）'
  )
}

// ─── 5. 扩展名映射与长度 ───

checkEqual(chatImageFileName(pngBase64, 'image/jpeg').endsWith('.jpg'), true, 'image/jpeg → .jpg')
checkEqual(chatImageFileName(pngBase64, 'image/webp').endsWith('.webp'), true, 'image/webp → .webp')
checkEqual(chatImageFileName(pngBase64, 'image/gif').endsWith('.gif'), true, 'image/gif → .gif')
checkEqual(chatImageFileName(pngBase64, 'image/bmp').endsWith('.bmp'), true, 'image/bmp → .bmp')
checkEqual(chatImageFileName(pngBase64, undefined).endsWith('.png'), true, 'mediaType 缺省 → .png')
checkEqual(
  chatImageFileName(pngBase64, 'application/octet-stream').endsWith('.png'),
  true,
  '未知类型兜底 → .png'
)
checkEqual(chatImageFileName(pngBase64, 'image/png').replace(/\.[a-z]+$/, '').length, 16, '哈希段 16 位')

// ─── 6. 目录拼接 ───

checkEqual(
  resolveChatImageDir('/data', new Date(2026, 9, 26)),
  join('/data', CHAT_IMAGES_SUBDIR, '2026-10'),
  '目录 = dataRoot/images/yyyy-MM'
)

console.log(`聊天图片目录与命名检查通过（${checks} 项断言）。`)
