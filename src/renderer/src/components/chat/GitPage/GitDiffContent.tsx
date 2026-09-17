// Git 差异内容渲染 —— 从 GitPage.tsx 抽出，供宽态内联区与紧凑态弹窗共用。

import * as React from 'react'
import { cn } from '@renderer/lib/utils'
import type { parseDiffBlocks } from './utils'

export type GitDiffBlock = ReturnType<typeof parseDiffBlocks>[number]

/**
 * 行号 + 增删配色的统一差异表。调用方负责外层滚动容器与空态文案。
 */
export function GitDiffContent({ blocks }: { blocks: GitDiffBlock[] }): React.JSX.Element {
  return (
    <div className="font-mono text-[12px] leading-[20px]">
      {blocks.map((block, blockIndex) => (
        <div key={`${block.header}-${blockIndex}`} className="border-b border-border/50 last:border-0">
          <div className="bg-muted/50 px-3 py-1 text-[11px] text-muted-foreground">
            {block.header}
          </div>
          {block.lines.map((line, lineIndex) => (
            <div
              key={`${blockIndex}-${lineIndex}`}
              className={cn(
                'grid grid-cols-[48px_48px_minmax(0,1fr)] border-b border-border/40 last:border-0',
                line.type === 'add' && 'bg-green-500/10 text-green-800 dark:text-green-300',
                line.type === 'remove' && 'bg-red-500/10 text-red-800 dark:text-red-300',
                line.type === 'meta' && 'bg-muted/40 text-muted-foreground'
              )}
            >
              <div className="select-none border-r border-border/40 px-1.5 text-right text-[10px] text-muted-foreground">
                {line.left}
              </div>
              <div className="select-none border-r border-border/40 px-1.5 text-right text-[10px] text-muted-foreground">
                {line.right}
              </div>
              <pre className="overflow-x-auto px-2 py-0 whitespace-pre-wrap break-words">
                {line.content || ' '}
              </pre>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
