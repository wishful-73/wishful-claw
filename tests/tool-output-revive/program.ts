/*
 * 历史消息里的图片块还原（iter-v3-8 S-351）。
 *
 * 存在理由：落库的 `tool_use.output` 是 JSON **字符串**，实时链路里是内联数组。
 * 卡片一律用 `Array.isArray(output)` 取图片块 —— 于是同一张截图，执行中能看到预览，
 * 重开会话后只剩原文 JSON 文本（用户看到的就是「点开卡片是一坨 JSON」）。
 * S-294 只修了桌面 / 窗口截图，浏览器截图、图片插件卡、通用 ImageOutputBlock 全漏着。
 *
 * 钉死五条：
 *   ① 内联数组原样过（执行中那一份，不能被改坏）；
 *   ② 含 image 块的 JSON 字符串解成数组 —— 这是库里的真实形状，本套件的靶心；
 *   ③ 没有 image 块的字符串原样返回 —— 普通文本输出不得被当成块数组藏起来；
 *   ④ 非法 JSON / 空串 / 非块数组 ⇒ 原样返回，不抛；
 *   ⑤ 解码器失效时不得凭空出图（证明结果确实来自解码，不是巧合）。
 *
 * 解码器是注入的，这里用裸 JSON.parse；生产侧传 `decodeStructuredToolResult`（还认 TOON）。
 */

import assert from 'node:assert/strict'
import { reviveImageBlocks } from '../../src/renderer/src/lib/tools/tool-output-revive'
import type { ImageBlock, TextBlock, ToolResultContent } from '../../src/renderer/src/lib/api/types'

let checks = 0

function checkEqual<T>(actual: T, expected: T, description: string): void {
  checks += 1
  assert.equal(actual, expected, `${description}（期望 ${String(expected)}，实得 ${String(actual)}）`)
}

function decodeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const screenshotBlocks: Array<TextBlock | ImageBlock> = [
  {
    type: 'image',
    source: {
      type: 'base64',
      mediaType: 'image/png',
      filePath: 'D:\\claw\\wishful-claw\\.wishful-claw\\image\\1794186665198-4f7662f4.png'
    }
  },
  { type: 'text', text: 'Screenshot captured: 575x1434px - https://example.com/' }
]

// ─── 1. 内联数组原样过 ───

const inline = reviveImageBlocks(screenshotBlocks, decodeJson)
checkEqual(Array.isArray(inline), true, '内联数组：仍是数组')
checkEqual(inline === screenshotBlocks, true, '内联数组：同一个引用，不做无谓拷贝')

// ─── 2. 含 image 块的 JSON 字符串 —— 回归靶心 ───

const persisted = JSON.stringify(screenshotBlocks)
const revived = reviveImageBlocks(persisted, decodeJson)
checkEqual(Array.isArray(revived), true, 'JSON 字符串：解成数组（改之前这里是 false）')
const revivedBlocks = Array.isArray(revived) ? revived : []
checkEqual(revivedBlocks.length, 2, 'JSON 字符串：两个块都在')
checkEqual(revivedBlocks[0]?.type, 'image', 'JSON 字符串：第 1 块是图片')
checkEqual(
  (revivedBlocks[0] as ImageBlock)?.source.filePath,
  'D:\\claw\\wishful-claw\\.wishful-claw\\image\\1794186665198-4f7662f4.png',
  'JSON 字符串：filePath 带出（重开会话靠它走 oc-media://）'
)
checkEqual(
  (revivedBlocks[1] as TextBlock)?.text.includes('575x1434'),
  true,
  'JSON 字符串：备注原文完整'
)

// ─── 3. 没有 image 块的字符串原样返回 ───

const plainArrayText = '[1,2,3]'
checkEqual(
  reviveImageBlocks(plainArrayText, decodeJson),
  plainArrayText,
  '普通 JSON 数组文本：原样返回，不许当块数组'
)

const textOnlyBlocks = JSON.stringify([{ type: 'text', text: 'just text' }])
checkEqual(
  reviveImageBlocks(textOnlyBlocks, decodeJson),
  textOnlyBlocks,
  '纯 text 块数组：原样返回（保住卡片显示原文的退路）'
)

const bashOutput = 'line one\nline two'
checkEqual(reviveImageBlocks(bashOutput, decodeJson), bashOutput, '普通多行文本：原样返回')

// ─── 4. 解不出来 ⇒ 原样，且不抛 ───

checkEqual(reviveImageBlocks('[{not json', decodeJson), '[{not json', '坏 JSON：原样返回')
checkEqual(reviveImageBlocks('', decodeJson), '', '空串：原样返回')
checkEqual(reviveImageBlocks('-   a\n-   b', decodeJson), '-   a\n-   b', 'TOON 形态文本：原样返回')
checkEqual(reviveImageBlocks(undefined, decodeJson), undefined, 'undefined：原样返回')

const objectOutput = '{"x":1,"y":2}'
checkEqual(reviveImageBlocks(objectOutput, decodeJson), objectOutput, '对象字符串：原样返回（看不懂就不碰）')

// ─── 5. 解码器失效时不得凭空出图 ───

checks += 1
assert.notEqual(
  Array.isArray(reviveImageBlocks(persisted, () => null)),
  true,
  '解码器失效 ⇒ 不得变成数组（证明结果确实来自解码，而不是输入本来就是这个形状）'
)

// 类型层面也要能当 ToolResultContent 用 —— 下面这行过不了 typecheck 就说明签名错了。
const asContent: ToolResultContent | undefined = reviveImageBlocks(persisted, decodeJson)
checks += 1
assert.ok(asContent !== undefined, '返回值可赋给 ToolResultContent')

console.log(`tool-output-revive: ${checks} checks passed`)
