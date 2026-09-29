import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Markdown from 'react-markdown'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  SAFE_LINK_COMPONENTS
} from '@renderer/lib/preview/viewers/markdown-components'
import { CopyBtn } from '../shared'

interface MemoryHit {
  id: string
  title: string
  priority: string
  scope: string
  content: string
}

/**
 * Parse memory_search output into structured hits.
 *
 * Input format (from MemorySearchTool):
 *   Matches: 2
 *
 *   [id=12] Title (priority=standard, scope=global)
 *     content line 1
 *     content line 2
 *
 *   [id=13] Another Title (priority=lasting, scope=project:...)
 *     content
 */
function parseSearchHits(output: string): { count: number; hits: MemoryHit[] } | null {
  const countMatch = output.match(/^Matches:\s*(\d+)/m)
  if (!countMatch) return null
  const count = parseInt(countMatch[1], 10)

  const hits: MemoryHit[] = []
  // Match: [id=12] Title (priority=standard, scope=global)
  const entryRegex = /\[id=(\d+)\]\s+(.+?)\s*\(priority=(\w+),\s*scope=(.+?)\)/g
  const blocks: { id: string; title: string; priority: string; scope: string; startIndex: number }[] = []
  let m: RegExpExecArray | null
  while ((m = entryRegex.exec(output)) !== null) {
    blocks.push({
      id: m[1],
      title: m[2].trim(),
      priority: m[3].trim(),
      scope: m[4].trim(),
      startIndex: m.index + m[0].length
    })
  }

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    const nextStart = i + 1 < blocks.length ? blocks[i + 1].startIndex : output.length
    // Content is between the header line and the next entry (or end)
    const rawContent = output.slice(block.startIndex, nextStart).trim()
    // Remove leading/trailing empty lines and normalize indentation
    const content = rawContent
      .split('\n')
      .map((line) => line.replace(/^ {2}/, ''))
      .join('\n')
      .trim()
    hits.push({
      id: block.id,
      title: block.title,
      priority: block.priority,
      scope: block.scope,
      content
    })
  }

  return { count, hits }
}

const PRIORITY_TONES: Record<string, string> = {
  permanent: 'text-purple-500 bg-purple-500/10',
  lasting: 'text-amber-500 bg-amber-500/10',
  standard: 'text-blue-500 bg-blue-500/10',
  ephemeral: 'text-gray-500 bg-gray-500/10'
}

function PriorityBadge({ priority }: { priority: string }) {
  const { t } = useTranslation('chat')
  const tone = PRIORITY_TONES[priority] ?? 'text-gray-500 bg-gray-500/10'
  // 已知优先级走 i18n；上游新增的未知值原样回显，不猜含义。
  const label = PRIORITY_TONES[priority] ? t(`memory.priority.${priority}`) : priority
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>
      {label}
    </span>
  )
}

function SearchResults({ output }: { output: string }) {
  const { t } = useTranslation('chat')
  const parsed = parseSearchHits(output)

  if (!parsed || parsed.hits.length === 0) {
    return (
      <div className="px-3.5 py-2.5 text-xs text-muted-foreground">
        <Markdown
          remarkPlugins={MARKDOWN_REMARK_PLUGINS}
          rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
          components={SAFE_LINK_COMPONENTS}
        >
          {output}
        </Markdown>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="px-0.5 text-[11px] text-muted-foreground">
        {t('memory.hits', { count: parsed.count })}
      </div>
      {parsed.hits.map((hit) => (
        <div
          key={hit.id}
          className="rounded-lg border border-border/50 bg-muted/15 px-3 py-2"
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">{hit.title}</span>
            <PriorityBadge priority={hit.priority} />
          </div>
          <div className="prose prose-sm dark:prose-invert max-w-none text-xs prose-p:my-0.5 prose-ul:my-0.5 prose-li:my-0">
            <Markdown
              remarkPlugins={MARKDOWN_REMARK_PLUGINS}
              rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
              components={SAFE_LINK_COMPONENTS}
            >
              {hit.content}
            </Markdown>
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Card-style output block for memory tools.
 *
 * For write tools (append / update / hot_write):
 *   Preview content is extracted from the tool's **input** parameters,
 *   not the return value — the return value is an operation summary for the agent.
 *
 * For search:
 *   The return value is parsed into structured cards with title, priority badge, and content.
 *
 * For hot_read:
 *   The return value is MEMORY.md content, displayed as markdown.
 */
export function MemoryOutputBlock({
  name,
  input,
  output
}: {
  name: string
  input: Record<string, unknown>
  output: string
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [expanded, setExpanded] = React.useState(false)

  // memory_search — render as structured card list
  if (name === 'memory_search') {
    return (
      <div>
        <div className="flex justify-end">
          <CopyBtn text={output} />
        </div>
        <div className="overflow-auto max-h-[480px] px-0.5">
          <SearchResults output={output} />
        </div>
      </div>
    )
  }

  // Determine what to display for write/read tools
  let displayContent: string

  if (name === 'memory_hot_write') {
    const section = typeof input.section === 'string' ? input.section : ''
    const content = typeof input.content === 'string' ? input.content : ''
    displayContent = content || `*Deleted section: ${section}*`
  } else if (name === 'memory_append') {
    const content = typeof input.content === 'string' ? input.content : ''
    displayContent = content
  } else if (name === 'memory_update') {
    const content = typeof input.content === 'string' ? input.content : null
    const status = typeof input.status === 'string' ? input.status : null
    const priority = typeof input.priority === 'string' ? input.priority : null
    if (content) {
      displayContent = content
    } else if (status) {
      displayContent = `*Status changed to: ${status}*`
    } else if (priority) {
      displayContent = `*Priority changed to: ${priority}*`
    } else {
      displayContent = output
    }
  } else if (name === 'memory_hot_read') {
    // memory_hot_read — strip the first line (e.g. "MEMORY.md (global) — 3 sections:")
    const newlineIdx = output.indexOf('\n')
    displayContent = newlineIdx >= 0 ? output.slice(newlineIdx + 1).trim() : output
  } else {
    displayContent = output
  }

  const isLong = displayContent.length > 800 || displayContent.split('\n').length > 16
  const displayed = isLong && !expanded
    ? displayContent.slice(0, 800) + '…'
    : displayContent

  return (
    <div>
      <div className="flex justify-end">
        <CopyBtn text={displayContent} />
      </div>
      <div
        className={`overflow-auto rounded-lg border border-border/50 bg-muted/15 px-3.5 py-2.5 ${
          isLong && !expanded ? 'max-h-48' : 'max-h-[480px]'
        }`}
      >
        <div className="prose prose-sm dark:prose-invert max-w-none text-xs prose-headings:mb-1.5 prose-headings:mt-2 prose-headings:text-sm prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-pre:bg-muted prose-pre:px-2.5 prose-pre:py-2 prose-code:before:content-none prose-code:after:content-none">
          <Markdown
            remarkPlugins={MARKDOWN_REMARK_PLUGINS}
            rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
            components={SAFE_LINK_COMPONENTS}
          >
            {displayed}
          </Markdown>
        </div>
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded
            ? t('action.showLess', { ns: 'common' })
            : t('toolCall.showAll', { chars: displayContent.length, lines: displayContent.split('\n').length })}
        </button>
      )}
    </div>
  )
}
