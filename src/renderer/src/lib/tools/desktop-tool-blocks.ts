import type { ImageBlock, TextBlock, ToolResultContent } from '@renderer/lib/api/types'

/**
 * S-294 —— 桌面 / 窗口截图的 `output` → 图片块 + 备注块。
 *
 * **存在理由**：库里存的 `output` 是**字符串**（JSON 或 TOON 序列化后的块数组），不是数组。
 * `DesktopActionToolCard` 原来直接 `Array.isArray(output)` 判死，同一个判据造成两个症状：
 * 图片区整块不渲染（点开空白）、备注空导致标题行尺寸退化成 `?x?`。
 *
 * 抽成纯映射就能钉死 —— 内联在 `useMemo` 里不能（`tests/image-block-source` 同一个道理）。
 *
 * **解码器为什么是参数而不是直接 import**：`tool-result-format` 顶部 import 了
 * `useSettingsStore`（zustand），一旦拖进来，node 里就 import 不了这个模块，回归测试
 * 只能退化成「测判据、测不到真实形状」。调用方传 `decodeStructuredToolResult`，
 * 测试传裸 `JSON.parse` 包装即可。
 */
export type StructuredDecoder = (text: string) => unknown

export interface DesktopToolBlocks {
  images: ImageBlock[]
  notes: TextBlock[]
}

/**
 * 数组直接用；字符串先解码。解码失败 / 解码后仍不是数组 ⇒ 两个空列表（调用方不渲染）。
 *
 * **不能用裸 `JSON.parse` 当解码器**：设置项 `toolResultFormat` 可切 `toon`，
 * 那时 output 是 TOON 字符串，裸 parse 直接抛。`decodeStructuredToolResult` 两条路都试。
 */
export function splitDesktopToolBlocks(
  output: ToolResultContent | undefined,
  decode: StructuredDecoder
): DesktopToolBlocks {
  let blocks: unknown = output
  if (typeof blocks === 'string') {
    blocks = decode(blocks)
  }
  if (!Array.isArray(blocks)) {
    return { images: [], notes: [] }
  }

  return {
    images: blocks.filter((block): block is ImageBlock => block?.type === 'image'),
    notes: blocks.filter((block): block is TextBlock => block?.type === 'text')
  }
}

/**
 * 标题行那个 `W × H` 徽标。
 *
 * 备注的首个 `数字x数字` 就是图片尺寸，两种工具都成立：
 *  - `DesktopScreenshot` → `Captured desktop screenshot 2520x1680 (origin 0,0, ...)`
 *  - `CaptureAppWindow`  → `Captured the Wishful Claw window (1920x1080). Its content area sits at DIP ...`
 *
 * 取不到就退 `?` —— 但**取不到本身是 bug 信号**，不是正常态（S-294 就是它一直在退 `?`）。
 */
export function resolveScreenshotDimensions(notes: TextBlock[]): { width: string; height: string } {
  const match = notes[0]?.text.match(/(\d+)x(\d+)/)
  return { width: match?.[1] ?? '?', height: match?.[2] ?? '?' }
}
