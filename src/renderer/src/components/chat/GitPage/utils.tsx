// Utility functions, types, and sub-components extracted from GitPage.tsx

import * as React from 'react'
import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  File,
  FilePlus,
  Minus,
  Plus,
  RotateCcw
} from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { cn } from '@renderer/lib/utils'
import type { GitStatusFile } from '@renderer/stores/git-store'

export type ScmFileSection = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

export interface ScmFileRow {
  path: string
  section: ScmFileSection
  file: GitStatusFile
}

export function parseRemoteBranchName(shortName: string): { remote: string; branchName: string } | null {
  const i = shortName.indexOf('/')
  if (i <= 0) return null
  return { remote: shortName.slice(0, i), branchName: shortName.slice(i + 1) }
}

export function scmFileKey(row: Pick<ScmFileRow, 'section' | 'path'>): string {
  return `${row.section}:${row.path}`
}

export function statusLetters(file: GitStatusFile, section: ScmFileSection): string {
  if (section === 'untracked') return 'U'
  if (section === 'conflicted') return '!'
  if (section === 'staged') return file.stagedStatus.trim() || '·'
  return file.unstagedStatus.trim() || '·'
}

export function parseDiffBlocks(diffText: string): Array<{
  header: string
  lines: Array<{
    type: 'add' | 'remove' | 'meta' | 'context'
    left: string
    right: string
    content: string
  }>
}> {
  const sections: Array<{
    header: string
    lines: Array<{
      type: 'add' | 'remove' | 'meta' | 'context'
      left: string
      right: string
      content: string
    }>
  }> = []
  const rawLines = diffText.split(/\r?\n/)
  let current = {
    header: 'diff',
    lines: [] as Array<{
      type: 'add' | 'remove' | 'meta' | 'context'
      left: string
      right: string
      content: string
    }>
  }
  let leftLine = 0
  let rightLine = 0

  const pushCurrent = (): void => {
    if (current.lines.length > 0) sections.push(current)
  }

  for (const line of rawLines) {
    if (line.startsWith('@@')) {
      pushCurrent()
      current = { header: line, lines: [] }
      const match = line.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/)
      leftLine = match ? Number(match[1]) : 0
      rightLine = match ? Number(match[2]) : 0
      current.lines.push({ type: 'meta', left: '', right: '', content: line })
      continue
    }

    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('Binary files')
    ) {
      current.lines.push({ type: 'meta', left: '', right: '', content: line })
      continue
    }

    if (line.startsWith('+')) {
      current.lines.push({ type: 'add', left: '', right: String(rightLine), content: line })
      rightLine += 1
      continue
    }

    if (line.startsWith('-')) {
      current.lines.push({ type: 'remove', left: String(leftLine), right: '', content: line })
      leftLine += 1
      continue
    }

    current.lines.push({
      type: 'context',
      left: String(leftLine),
      right: String(rightLine),
      content: line
    })
    leftLine += 1
    rightLine += 1
  }

  pushCurrent()
  return sections
}

export function ScmSectionHeader({
  title,
  count,
  defaultOpen,
  children,
  actions
}: {
  title: string
  count: number
  defaultOpen?: boolean
  children: React.ReactNode
  actions?: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen !== false)
  // 手写折叠，不用 ui/collapsible —— 那个壳在 open=false 时会把 children 整体藏掉，
  // 触发器放里面就跟着没了（该原语已删除）。
  return (
    <div className="border-b border-border/60">
      <div className="flex min-h-8 items-center gap-1 pr-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-0.5 rounded-sm py-1 pl-1 text-left hover:bg-muted/50"
        >
          {open ? (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">({count})</span>
        </button>
        {actions ? <div className="flex shrink-0 items-center gap-0.5">{actions}</div> : null}
      </div>
      {open ? <div className="pb-1">{children}</div> : null}
    </div>
  )
}

export function ScmFileRowView({
  row,
  selected,
  onSelect,
  onStage,
  onUnstage,
  onDiscard,
  disabled,
  labels
}: {
  row: ScmFileRow
  selected: boolean
  onSelect: () => void
  onStage: () => void
  onUnstage: () => void
  onDiscard: () => void
  disabled?: boolean
  labels: { stage: string; unstage: string; discard: string }
}): React.JSX.Element {
  const Icon = row.section === 'untracked' ? FilePlus : File
  return (
    <div
      className={cn(
        'group flex min-h-[26px] cursor-pointer items-center gap-0.5 rounded-sm pr-0.5 text-[13px] leading-tight',
        selected ? 'bg-muted' : 'hover:bg-muted/60'
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1.5 py-0.5 pl-6 pr-1 text-left"
        onClick={onSelect}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{row.path}</span>
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {statusLetters(row.file, row.section)}
        </span>
      </button>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {row.section === 'staged' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation()
                  onUnstage()
                }}
              >
                <Minus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{labels.unstage}</TooltipContent>
          </Tooltip>
        ) : null}
        {row.section === 'unstaged' ||
        row.section === 'untracked' ||
        row.section === 'conflicted' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                disabled={disabled || row.section === 'conflicted'}
                onClick={(event) => {
                  event.stopPropagation()
                  onStage()
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{labels.stage}</TooltipContent>
          </Tooltip>
        ) : null}
        {row.section !== 'conflicted' ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 text-destructive hover:text-destructive"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation()
                  onDiscard()
                }}
              >
                <RotateCcw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">{labels.discard}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </div>
  )
}
