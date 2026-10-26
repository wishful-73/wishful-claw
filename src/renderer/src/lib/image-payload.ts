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

function stripNode(node: unknown): unknown {
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
