/*
 * 图片块 → ImagePreview 的 src / filePath（iter-37 S-162）。
 *
 * 存在理由：三张卡片此前各自手搓同一段映射，而它藏起来的错误是静默的 —— 把第 1 张图的字节
 * 送给第 2 张图那颗按钮，屏幕上看起来一模一样。抽成一个纯映射就能钉死，内联三份不能。
 *
 * 钉死四条：
 *   ① base64 块拼成 data URL，mediaType 缺省补 image/png；
 *   ② url 块直接用 url；
 *   ③ 两者都没有但带 filePath 时，src 兜底成 oc-media://（S-284：落库副本里
 *      base64 已被剥掉，重开会话走的就是这条路），全空则返回 null（调用方跳过）；
 *   ④ 两张图的载荷永远各归各，不串。
 */

import assert from 'node:assert/strict'
import { resolveImageBlockSource } from '../../src/renderer/src/lib/tools/image-block-source'
import { filePathToMediaUrl } from '../../src/renderer/src/lib/local-media-url'
import type { ImageBlock } from '../../src/renderer/src/lib/api/types'

let checks = 0

function checkEqual<T>(actual: T, expected: T, description: string): void {
  checks += 1
  assert.equal(actual, expected, `${description}（期望 ${String(expected)}，实得 ${String(actual)}）`)
}

function block(source: ImageBlock['source']): ImageBlock {
  return { type: 'image', source }
}

// ─── 1. base64 块 → data URL ───

checkEqual(
  resolveImageBlockSource(block({ type: 'base64', data: 'AAA', mediaType: 'image/webp' }))?.src,
  'data:image/webp;base64,AAA',
  'base64 用块上声明的 mediaType'
)
checkEqual(
  resolveImageBlockSource(block({ type: 'base64', data: 'AAA' }))?.src,
  'data:image/png;base64,AAA',
  'mediaType 缺省补 image/png'
)

// ─── 2. url 块 → url ───

checkEqual(
  resolveImageBlockSource(block({ type: 'url', url: 'https://example.test/a.png' }))?.src,
  'https://example.test/a.png',
  'url 块直接用 url'
)

// ─── 3. filePath 是独立的第三路 ───

const withPath = resolveImageBlockSource(
  block({ type: 'base64', data: 'AAA', filePath: 'D:/tmp/a.png' })
)
checkEqual(withPath?.filePath, 'D:/tmp/a.png', 'filePath 原样带出')
checkEqual(withPath?.src, 'data:image/png;base64,AAA', 'filePath 不影响 src')

checkEqual(
  resolveImageBlockSource(block({ type: 'base64', filePath: 'D:/tmp/a.png' }))?.src,
  filePathToMediaUrl('D:/tmp/a.png'),
  '只有 filePath（base64 已被剥离）时 src 兜底成 oc-media://'
)

// 剥完之后 source.type 仍是 base64、data 已经没了 —— 这是重开会话的真实形状，
// 不能因为 type 还写着 base64 就去拼一个 data:,…;base64,（空载荷）。
const strippedBlock = resolveImageBlockSource(block({ type: 'base64', filePath: 'D:/tmp/a.png' }))
checkEqual(strippedBlock?.src.startsWith('data:'), false, '剥空的块不得产出 data: URL')
checkEqual(strippedBlock?.filePath, 'D:/tmp/a.png', '剥空的块 filePath 仍在')

// url 优先于 filePath：url 块本来就该直接用远端地址。
checkEqual(
  resolveImageBlockSource(
    block({ type: 'url', url: 'https://example.test/a.png', filePath: 'D:/tmp/a.png' })
  )?.src,
  'https://example.test/a.png',
  'url 存在时不被 filePath 顶掉'
)

// ─── 4. 全空 → null，调用方跳过 ───

checkEqual(resolveImageBlockSource(block({ type: 'base64' })), null, '无 data / url / filePath → null')
checkEqual(resolveImageBlockSource(block({ type: 'url' })), null, 'url 块但 url 缺失 → null')

// ─── 5. 关键：两张图各自拿到自己的载荷，不串 ───

const first = block({ type: 'base64', data: 'FIRST', mediaType: 'image/png', filePath: 'D:/tmp/1.png' })
const second = block({ type: 'base64', data: 'SECOND', mediaType: 'image/webp', filePath: 'D:/tmp/2.webp' })

const resolvedFirst = resolveImageBlockSource(first)
const resolvedSecond = resolveImageBlockSource(second)

checkEqual(resolvedFirst?.src, 'data:image/png;base64,FIRST', '第 1 张的 src 是自己的')
checkEqual(resolvedSecond?.src, 'data:image/webp;base64,SECOND', '第 2 张的 src 是自己的')
checkEqual(resolvedFirst?.filePath, 'D:/tmp/1.png', '第 1 张的 filePath 是自己的')
checkEqual(resolvedSecond?.filePath, 'D:/tmp/2.webp', '第 2 张的 filePath 是自己的')

// 反向断言：把两张图混起来也绝不会相等 —— 相等就意味着按钮会送错图。
checks += 1
assert.notEqual(resolvedFirst?.src, resolvedSecond?.src, '两张图的 src 必须不同')

console.log(`image-block-source: ${checks} checks passed`)
