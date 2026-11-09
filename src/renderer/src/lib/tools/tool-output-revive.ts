import type { ToolResultContent } from '@renderer/lib/api/types'
import type { StructuredDecoder } from './desktop-tool-blocks'

/**
 * S-351 —— 把「存成字符串的块数组」还原成数组，只针对**含图片块**的输出。
 *
 * **存在理由**：落库的 `tool_use.output` 是 JSON 字符串（后端 DTO 的 output 是 string，
 * 数组被 stringify），实时链路里它却是内联数组。而卡片一律用 `Array.isArray(output)`
 * 取图片块 —— 于是同一张截图，执行中能看到预览，重新加载会话后只剩原文 JSON 文本。
 * S-294 只修了桌面 / 窗口截图那条（`splitDesktopToolBlocks`），浏览器截图卡、
 * 图片插件卡、通用 `ImageOutputBlock` 全漏着，症状一模一样。
 *
 * 判据刻意收得很窄：只有解出来是数组、且数组里至少有一个 `image` 块才换。
 * 其余字符串原样返回 —— 普通文本输出万一恰好是合法 JSON 数组（`[1,2]` 之类），
 * 当成块数组会让卡片把原文藏起来、变空白。
 *
 * **解码器为什么是参数**：和 `desktop-tool-blocks` 同一个理由 —— `tool-result-format`
 * 顶部 import 了 zustand 的 settings-store，直接拖进来 node 里就跑不了回归测试。
 */
export function reviveImageBlocks(
  content: ToolResultContent | undefined,
  decode: StructuredDecoder
): ToolResultContent | undefined {
  if (typeof content !== 'string') return content
  const trimmed = content.trim()
  // 块数组序列化后必然以 `[` 开头；不以此开头就不必进解码器（TOON 分支也省了）。
  if (!trimmed.startsWith('[')) return content
  const parsed = decode(trimmed)
  if (!Array.isArray(parsed)) return content
  const hasImage = parsed.some(
    (block) => !!block && typeof block === 'object' && (block as { type?: unknown }).type === 'image'
  )
  return hasImage ? (parsed as ToolResultContent) : content
}
