/**
 * 落库前剥离图片 base64（S-224）。
 *
 * `messages.meta` 里原本把整块 base64 一起 JSON 化进库，一张 3 MB 的图就是
 * 一条 4 MB 的字符串行。落盘之后字节有了磁盘位置，库里只该留 `filePath`。
 *
 * **剥离条件是四个全满足**：`type === 'image'`、`source` 是对象、`filePath` 非空、
 * `data` 存在。少任何一个都不碰 —— 没有 `filePath` 的块一旦被剥，图就彻底没了。
 *
 * 纯函数，返回深拷贝，不改原对象：内存里的消息还要继续用于渲染和下一轮请求。
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * S-284：剥掉「字符串化 JSON」里的图片 base64。
 *
 * 工具结果的 `output` 常常不是数组而是**被上游 stringify 过一层**的字符串
 * （截图结果是 `[{"type":"image","source":{"type":"base64","data":"…"}}]` 这样的文本）。
 * 旧实现遇到 string 直接原样返回，于是里面的 image 块**从头到尾没被看见** ——
 * 库里 99% 的字节就是这么留下来的。
 *
 * 先做两个廉价判据（长度、首字符、是否提到 image）再 parse：绝大多数工具输出是
 * 普通文本或 unrelated 的 JSON，不该为它们付 `JSON.parse` 的代价。
 */
function stripStringifiedJson(text: string): string {
  if (text.length < 32) return text
  const first = text.charCodeAt(0)
  if (first !== 0x5b /* [ */ && first !== 0x7b /* { */) return text
  if (!text.includes('"image"')) return text
  try {
    const parsed: unknown = JSON.parse(text)
    return JSON.stringify(stripNode(parsed))
  } catch {
    return text
  }
}

function stripNode(node: unknown): unknown {
  if (typeof node === 'string') {
    return stripStringifiedJson(node)
  }
  if (Array.isArray(node)) {
    return node.map(stripNode)
  }
  if (!isPlainObject(node)) {
    return node
  }

  const copy: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node)) {
    copy[key] = stripNode(value)
  }

  if (copy.type === 'image' && isPlainObject(copy.source)) {
    const source = copy.source
    const filePath = source.filePath
    if (typeof filePath === 'string' && filePath.trim().length > 0 && 'data' in source) {
      const stripped = { ...source }
      delete stripped.data
      copy.source = stripped
    }
  }

  return copy
}

export function stripImagePayloads<T>(value: T): T {
  return stripNode(value) as T
}
