/*
 * 落库剥离图片 base64（S-224）。
 *
 * 存在理由：这是整条链路上唯一会「删数据」的一步，剥错就是不可逆的丢图 ——
 * 库里只留下一个没有 data 也没有 filePath 的空块，谁也救不回来。
 * 所以反向断言（没 filePath 不许剥）比正向断言更重要。
 *
 * 钉死五组：
 *   ① 带 filePath 的图片块：data 被剥、其余字段完整；
 *   ② 没 filePath 的图片块：data 必须原样保留（关键安全断言）；
 *   ③ 非图片结构（文本、字符串、普通对象）一律不动；
 *   ④ content / segments / toolCalls 三种容器都能剥到；
 *   ⑤ 纯函数：不改入参，且序列化产物不含 base64 头。
 */

import assert from 'node:assert/strict'
import { attachChatImagePaths } from '../../src/renderer/src/lib/image-persist-chat'
import { stripImagePayloads } from '../../src/renderer/src/lib/image-payload'
import type { ContentBlock, ImageBlock } from '../../src/renderer/src/lib/api/types'

let checks = 0

function checkEqual<T>(actual: T, expected: T, description: string): void {
  checks += 1
  assert.equal(actual, expected, `${description}（期望 ${String(expected)}，实得 ${String(actual)}）`)
}

function checkTrue(value: boolean, description: string): void {
  checks += 1
  assert.ok(value, description)
}

const TINY_BASE64 = 'iVBORw0KGgoAAAANSUhEUg=='

function imageBlock(filePath?: string, data: string | undefined = TINY_BASE64): unknown {
  return {
    type: 'image',
    source: {
      type: 'base64',
      mediaType: 'image/png',
      ...(data === undefined ? {} : { data }),
      ...(filePath ? { filePath } : {})
    }
  }
}

// ─── 1. 带 filePath ⇒ 剥 data，其余字段保留 ───

{
  const input = { blocks: [imageBlock('C:\\imgs\\2026-10\\abc.png')] }
  const output = stripImagePayloads(input) as { blocks: Array<{ type: string; source: Record<string, unknown> }> }
  const source = output.blocks[0].source

  checkEqual('data' in source, false, 'filePath 存在时 data 被剥掉')
  checkEqual(source.filePath, 'C:\\imgs\\2026-10\\abc.png', 'filePath 原样保留')
  checkEqual(source.mediaType, 'image/png', 'mediaType 原样保留')
  checkEqual(source.type, 'base64', 'source.type 不动（三处写入器按它分流）')
  checkEqual(output.blocks[0].type, 'image', '块 type 不动')
}

// ─── 2. 没 filePath ⇒ data 必须保留 ───

{
  const input = { blocks: [imageBlock(undefined)] }
  const output = stripImagePayloads(input) as { blocks: Array<{ source: Record<string, unknown> }> }
  checkEqual(output.blocks[0].source.data, TINY_BASE64, '没有 filePath 时 data 必须原样保留')
}

{
  // filePath 是空串、纯空白，都不算「有路径」。
  for (const bogus of ['', '   ']) {
    const input = { blocks: [imageBlock(bogus)] }
    const output = stripImagePayloads(input) as { blocks: Array<{ source: Record<string, unknown> }> }
    checkEqual(output.blocks[0].source.data, TINY_BASE64, `filePath 为 ${JSON.stringify(bogus)} 时不许剥`)
  }
}

{
  // data 本来就不存在，剥不剥都一样，但不应报错。
  const input = { blocks: [imageBlock('C:\\a.png', undefined)] }
  const output = stripImagePayloads(input) as { blocks: Array<{ source: Record<string, unknown> }> }
  checkEqual('data' in output.blocks[0].source, false, '本来没有 data 时不凭空造出 data')
}

// ─── 3. 非图片结构一律不动 ───

checkEqual(stripImagePayloads('plain string'), 'plain string', '字符串原样返回')
checkEqual(stripImagePayloads(42), 42, '数字原样返回')
checkEqual(stripImagePayloads(null), null, 'null 原样返回')

{
  const textBlock = { type: 'text', text: 'hello' }
  const output = stripImagePayloads([textBlock]) as Array<Record<string, unknown>>
  checkEqual(output[0].text, 'hello', 'text 块内容不动')
}

{
  // type 是 image 但 source 不是对象 —— 不该崩，也不该动。
  const weird = { type: 'image', source: 'not-an-object' }
  const output = stripImagePayloads([weird]) as Array<Record<string, unknown>>
  checkEqual(output[0].source, 'not-an-object', 'source 非对象时原样返回')
}

// ─── 4. 三种容器都能剥到 ───

{
  const msg = {
    content: [{ type: 'text', text: 'hi' }, imageBlock('C:\\a.png')],
    segments: [
      { type: 'tool_use', iteration: 1, toolCallId: 't1', toolName: 'read' },
      { type: 'text', iteration: 1, text: '看这张图', blocks: [imageBlock('C:\\b.png')] }
    ],
    toolCalls: [
      {
        id: 't1',
        name: 'read_file',
        input: { file_path: 'x' },
        status: 'completed',
        output: 'ok',
        image: imageBlock('C:\\c.png')
      }
    ]
  }

  const output = stripImagePayloads(msg) as typeof msg

  checkEqual('data' in output.content[1].source, false, 'content 容器：data 被剥')
  checkEqual(output.content[1].source.filePath, 'C:\\a.png', 'content 容器：filePath 保留')

  checkTrue(
    JSON.stringify(output.segments).includes('C:\\\\b.png') ||
      JSON.stringify(output.segments).includes('C:\\b.png'),
    'segments 容器：filePath 保留'
  )
  checkEqual(JSON.stringify(output.segments).includes('iVBORw0KGgo'), false, 'segments 容器：base64 被剥')

  checkEqual(JSON.stringify(output.toolCalls).includes('iVBORw0KGgo'), false, 'toolCalls 容器：base64 被剥')
  checkTrue(
    JSON.stringify(output.toolCalls).includes('C:\\\\c.png') ||
      JSON.stringify(output.toolCalls).includes('C:\\c.png'),
    'toolCalls 容器：filePath 保留'
  )
}

// ─── 6. 字符串化 JSON：库里 99% 字节的来路（S-284） ───
//
// 工具结果的 output 不是数组，是**被上游 stringify 过一层**的文本
// （截图结果是 `[{"type":"image","source":{...,"data":"…"}}]`）。
// 旧实现遇到 string 原样返回，于是里面的 image 块从头到尾没被看见。

{
  // 真实形态：数组串，image 块带 filePath，后面跟一个 text 块。
  const stringified = JSON.stringify([
    imageBlock('C:\\shots\\a.png'),
    { type: 'text', text: 'Saved to C:\\shots\\a.png' }
  ])

  const output = stripImagePayloads({ output: stringified }) as { output: string }

  checkEqual(typeof output.output, 'string', '字符串化 JSON 仍是字符串，类型不变')
  checkEqual(output.output.includes(TINY_BASE64), false, '删掉字符串化 JSON 里的 base64 载荷')
  checkEqual(output.output.includes('C:\\\\shots\\\\a.png'), true, 'filePath 留在字符串里')

  const reparsed = JSON.parse(output.output) as Array<{ type: string; text?: string }>
  checkEqual(reparsed.length, 2, '剥完仍是结构完整的 JSON，块数不变')
  checkEqual(reparsed[1].text, 'Saved to C:\\shots\\a.png', 'text 块内容不被破坏')
}

{
  // 安全断言：字符串里没有 filePath ⇒ 一个字节都不许动。
  const stringified = JSON.stringify([imageBlock(undefined)])
  const output = stripImagePayloads({ output: stringified }) as { output: string }
  checkEqual(output.output.includes(TINY_BASE64), true, '字符串化 JSON 里没 filePath 时不许剥')
}

{
  // 廉价判据：不是 JSON 容器、或压根没提 image 的字符，原样返回。
  checkEqual(
    stripImagePayloads('look, there is an "image" here'),
    'look, there is an "image" here',
    '首字符不是 [/{ 的字符串不尝试解析'
  )

  const noImageJson = JSON.stringify({ exitCode: 0, stdout: 'all good', stderr: '' })
  const output = stripImagePayloads({ output: noImageJson }) as { output: string }
  checkEqual(output.output, noImageJson, '不含 image 的 JSON 串一个字符都不变')
}

{
  // 畸形 JSON：解析失败必须安静退回原文，不能把写库主路径炸掉。
  const broken = '{ "type": "image", ...truncated'
  checkEqual(stripImagePayloads(broken), broken, '畸形 JSON 不抛、原样返回')
}

// ─── 7. 纯函数 + 序列化产物无 base64 头 ───

{
  const original = { content: [imageBlock('C:\\keep.png')] }
  const snapshot = JSON.stringify(original)
  stripImagePayloads(original)
  checkEqual(JSON.stringify(original), snapshot, '不改入参（内存里的消息还要继续用于渲染与下一轮请求）')
}

{
  const msg = { content: [imageBlock('C:\\keep.png')], segments: [{ blocks: [imageBlock('C:\\s.png')] }] }
  const serialized = JSON.stringify(stripImagePayloads(msg))
  checkEqual(serialized.includes('"data":"iVBOR'), false, '序列化产物不含 base64 头')
  checkEqual(serialized.includes('iVBORw0KGgo'), false, '序列化产物彻底不含 base64 载荷')
}

// ─── 6. attachChatImagePaths 的三条降级保证（验收 #7 / #8 的唯一落点） ───
//
// esbuild 输出 CJS，不支持顶层 await，故整组包进 IIFE。

void (async () => {
{
  // 落盘成功：补 filePath，但 data 必须保留 —— 本次请求还要拿它发给模型。
  const block = imageBlock()
  const result = await attachChatImagePaths([block as ContentBlock], async () => ({
    filePath: 'C:\\images\\a.png'
  }))
  const source = (result[0] as ImageBlock).source
  checkEqual(source.filePath, 'C:\\images\\a.png', '成功时补上 filePath')
  checkEqual(source.data, TINY_BASE64, '成功时仍保留 data（请求体要它）')
}

{
  // 落盘抛异常：绝不能让写盘问题挡住发送 ⇒ 块原样返回，仍有 data。
  const block = imageBlock()
  const result = await attachChatImagePaths([block as ContentBlock], async () => {
    throw new Error('disk full')
  })
  checkEqual(result.length, 1, '异常时块数不变')
  checkEqual((result[0] as ImageBlock).source.data, TINY_BASE64, '异常时 data 原样保留')
  checkEqual((result[0] as ImageBlock).source.filePath, undefined, '异常时不写 filePath')
}

{
  // 落盘返回 error 而无 filePath（主进程 catch 的形态）：同样不补路径。
  const block = imageBlock()
  const result = await attachChatImagePaths([block as ContentBlock], async () => ({
    error: 'permission denied'
  }))
  checkEqual((result[0] as ImageBlock).source.filePath, undefined, '返回 error 时不写 filePath')
  checkEqual((result[0] as ImageBlock).source.data, TINY_BASE64, '返回 error 时 data 保留')
}

{
  // 已有 filePath（编辑重发）：短路，不再为同一张图重传一遍 base64。
  let called = 0
  const block = imageBlock('C:\\images\\existing.png')
  const result = await attachChatImagePaths([block as ContentBlock], async () => {
    called += 1
    return { filePath: 'C:\\images\\other.png' }
  })
  checkEqual(called, 0, '已有 filePath 时不再调用落盘')
  checkEqual(
    (result[0] as ImageBlock).source.filePath,
    'C:\\images\\existing.png',
    '已有 filePath 保持不变'
  )
}

{
  // 畸形块：结构不对绝不能抛到发送主路径。
  const weird = [{ type: 'image', source: null } as unknown as ContentBlock]
  const result = await attachChatImagePaths(weird, async () => ({ filePath: 'C:\\x.png' }))
  checkEqual(result.length, 1, '畸形块不抛、原样返回')
}

console.log(`落库剥离图片载荷检查通过（${checks} 项断言）。`)
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
