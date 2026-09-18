import type { DiffViewerChunk, DiffViewerLine } from '@renderer/components/chat/CodeDiffViewer'
import { parseDiffBlocks } from './utils'

/**
 * 把 unified diff 文本折成 CodeDiffViewer 需要的 chunk 结构。
 * 与变更面板共用同一套渲染，避免两处各写一份映射导致行号/高亮不一致。
 */
export function diffTextToChunks(text: string): DiffViewerChunk[] {
  return parseDiffBlocks(text).map((block) => ({
    type: 'lines' as const,
    lines: block.lines.flatMap((line): DiffViewerLine[] => {
      if (line.type === 'add') {
        return [{ type: 'add' as const, text: line.content.slice(1), newNum: Number(line.right) }]
      }
      if (line.type === 'remove') {
        return [{ type: 'del' as const, text: line.content.slice(1), oldNum: Number(line.left) }]
      }
      if (line.type === 'context') {
        return [
          {
            type: 'keep' as const,
            text: line.content,
            oldNum: Number(line.left),
            newNum: Number(line.right)
          }
        ]
      }
      return []
    })
  }))
}
