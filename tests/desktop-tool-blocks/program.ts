/*
 * 桌面 / 窗口截图的 output → 图片块 + 备注块（iter-v3-5 S-294）。
 *
 * 存在理由：库里存的 `output` 是**字符串**（JSON / TOON 序列化后的块数组），不是数组。
 * 卡片原来直接 `Array.isArray(output)` 判死，同一个判据造成两个症状 ——
 * 图片区整块不渲染（点开空白）、备注空导致标题行尺寸退化成 `?x?`。
 * 屏幕上看就是「卡片点开屁都没有 + 右上角 ?x?」，查了半天才定位到一句 if。
 *
 * 钉死五条：
 *   ① 数组直接过（执行中那一份是内联数组）；
 *   ② JSON 字符串能解出来 —— 这是库里的真实形状；
 *   ③ 解码后仍不是数组 / 解不出来 ⇒ 两个空列表，不抛；
 *   ④ image 与 text 各归各类，其它类型（比如 tool_use）不混进来；
 *   ⑤ 尺寸徽标从备注首个 `数字x数字` 取，两种工具都能取到。
 *
 * 解码器是注入的，所以这里用裸 JSON.parse —— 生产侧传的是
 * `decodeStructuredToolResult`（它还认 TOON）。这个套件只验证判据本身。
 */

import assert from 'node:assert/strict'
import {
  resolveScreenshotDimensions,
  splitDesktopToolBlocks
} from '../../src/renderer/src/lib/tools/desktop-tool-blocks'
import type { TextBlock } from '../../src/renderer/src/lib/api/types'

let checks = 0

function checkEqual<T>(actual: T, expected: T, description: string): void {
  checks += 1
  assert.equal(actual, expected, `${description}（期望 ${String(expected)}，实得 ${String(actual)}）`)
}

/** 测试用的解码器：只认 JSON。生产侧另有 TOON 分支，不在本套件职责内。 */
function decodeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// ─── 1. 数组直接过 ───

const inlineArray = [
  { type: 'image', source: { type: 'base64', data: 'AAA', mediaType: 'image/png', filePath: 'D:/tmp/a.png' } },
  { type: 'text', text: 'Captured desktop screenshot 2520x1680 (origin 0,0)' }
]

const fromArray = splitDesktopToolBlocks(inlineArray, decodeJson)
checkEqual(fromArray.images.length, 1, '内联数组：图片块 1 个')
checkEqual(fromArray.notes.length, 1, '内联数组：备注块 1 个')
checkEqual(fromArray.images[0]?.source.filePath, 'D:/tmp/a.png', '内联数组：filePath 带出')

// ─── 2. JSON 字符串 —— 库里的真实形状 ───
//
// 这一段就是回归的靶心：改之前 Array.isArray('[...]') 是 false，
// images / notes 双空，展开卡片什么都没有。

const jsonString = JSON.stringify(inlineArray)
const fromString = splitDesktopToolBlocks(jsonString, decodeJson)
checkEqual(fromString.images.length, 1, 'JSON 字符串：图片块 1 个')
checkEqual(fromString.notes.length, 1, 'JSON 字符串：备注块 1 个')
checkEqual(
  fromString.images[0]?.source.filePath,
  'D:/tmp/a.png',
  'JSON 字符串：filePath 带出（重开会话走 oc-media:// 靠它）'
)
checkEqual(fromString.notes[0]?.text.includes('2520x1680'), true, 'JSON 字符串：备注原文完整')

// 反向断言：如果判据退回「只认数组」，这条会立刻红。
checks += 1
assert.notEqual(
  splitDesktopToolBlocks(jsonString, () => null).images.length,
  1,
  '解码器失效时不得凭空出图 —— 说明解析结果确实来自解码'
)

// ─── 3. 解不出来 / 不是数组 ⇒ 空，且不抛 ───

const badJson = splitDesktopToolBlocks('{not json', decodeJson)
checkEqual(badJson.images.length, 0, '坏 JSON：无图片')
checkEqual(badJson.notes.length, 0, '坏 JSON：无备注')

const objectOutput = splitDesktopToolBlocks('{"x":1,"y":2}', decodeJson)
checkEqual(objectOutput.images.length, 0, '对象（DesktopClick 那种）不产图')
checkEqual(objectOutput.notes.length, 0, '对象不产备注')

checkEqual(splitDesktopToolBlocks(undefined, decodeJson).images.length, 0, 'undefined：无图片')
checkEqual(splitDesktopToolBlocks('', decodeJson).images.length, 0, '空串：无图片')
checkEqual(splitDesktopToolBlocks('[]', decodeJson).images.length, 0, '空数组：无图片')

// ─── 4. 各归各类，其它块不混进来 ───

const mixed = splitDesktopToolBlocks(
  [
    { type: 'text', text: 'first note' },
    { type: 'image', source: { type: 'base64', data: 'ONE', filePath: 'D:/tmp/1.png' } },
    { type: 'tool_use', id: 'x', name: 'Whatever' },
    { type: 'image', source: { type: 'base64', data: 'TWO', filePath: 'D:/tmp/2.png' } },
    { type: 'text', text: 'second note' }
  ],
  decodeJson
)
checkEqual(mixed.images.length, 2, '混合：只数出 2 张图')
checkEqual(mixed.notes.length, 2, '混合：只数出 2 条备注')
checkEqual(mixed.images[0]?.source.filePath, 'D:/tmp/1.png', '混合：第 1 张图是自己的')
checkEqual(mixed.images[1]?.source.filePath, 'D:/tmp/2.png', '混合：第 2 张图是自己的')

// 顺序也要保 —— 备注第一条决定尺寸徽标，不能被打乱。
checkEqual(mixed.notes[0]?.text, 'first note', '混合：备注保持原顺序')

// ─── 5. 尺寸徽标 ───

const desktopNotes: TextBlock[] = [
  {
    type: 'text',
    text: 'Captured desktop screenshot 2520x1680 (origin 0,0, scale 1.5) across 1 display(s): primary 0 at (0,0) 2520x1680.'
  }
]
checkEqual(resolveScreenshotDimensions(desktopNotes).width, '2520', '桌面截图：宽')
checkEqual(resolveScreenshotDimensions(desktopNotes).height, '1680', '桌面截图：高')

const windowNotes: TextBlock[] = [
  {
    type: 'text',
    text: 'Captured the Wishful Claw window (1920x1080). Its content area sits at DIP (100,50), 1920x1080 — at scale 1.5 that is screen pixels (150,75), 2880x1620.'
  }
]
checkEqual(resolveScreenshotDimensions(windowNotes).width, '1920', '窗口截图：宽取窗口内容尺寸')
checkEqual(resolveScreenshotDimensions(windowNotes).height, '1080', '窗口截图：高取窗口内容尺寸')

// 取不到退 `?` —— 但这本身是 bug 信号，S-294 就是它一直在退 `?`。
checkEqual(resolveScreenshotDimensions([]).width, '?', '无备注：宽退 ?')
checkEqual(resolveScreenshotDimensions([]).height, '?', '无备注：高退 ?')
checkEqual(
  resolveScreenshotDimensions([{ type: 'text', text: 'no dimensions here' }]).width,
  '?',
  '备注里没有尺寸：宽退 ?'
)

console.log(`desktop-tool-blocks: ${checks} checks passed`)
