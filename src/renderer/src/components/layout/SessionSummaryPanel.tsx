/**
 * SessionSummaryPanel — right panel view showing the latest context
 * compression summary of a session. Falls back to an empty state
 * ("暂无摘要") when the session was never compressed.
 *
 * Data source: in-memory session messages first; if no summary is found
 * there (the summary may predate the loaded turn window), the full DB
 * history is scanned once.
 */

import { useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import { Archive, Loader2 } from 'lucide-react'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import { useChatStore } from '@renderer/stores/chat-store'
import { dbLoadMessages } from '@renderer/stores/chat-store/db-helpers'
import { convertChatMessagesToUnified } from '@renderer/components/chat/MessageList/utils'
import {
  getCompactSummaryDisplayText,
  isCompactSummaryLikeMessage
} from '@renderer/lib/agent/context-compression'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS
} from '@renderer/lib/preview/viewers/markdown-components'

function findLatestSummary(messages: UnifiedMessage[]): UnifiedMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isCompactSummaryLikeMessage(messages[index])) return messages[index]
  }
  return null
}

export function SessionSummaryPanel({
  sessionId
}: {
  sessionId: string | null
}): React.JSX.Element {
  const { t } = useTranslation('layout')

  // messageCount acts as the re-scan trigger: the messages array itself is
  // mutated in place, so its reference never changes between renders.
  const messageCount = useChatStore((state) => {
    if (!sessionId) return 0
    return state.sessions.find((session) => session.id === sessionId)?.messageCount ?? 0
  })

  // undefined = resolving, null = no summary, otherwise the summary message.
  const [summary, setSummary] = useState<UnifiedMessage | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false

    const resolve = async (): Promise<void> => {
      if (!sessionId) {
        setSummary(null)
        return
      }
      const session = useChatStore.getState().sessions.find((item) => item.id === sessionId)
      const inMemory = session?.messages?.length
        ? convertChatMessagesToUnified(session.messages)
        : []
      const found = findLatestSummary(inMemory)
      if (found) {
        if (!cancelled) setSummary(found)
        return
      }
      // The summary may predate the loaded turn window — scan full history.
      try {
        const rows = await dbLoadMessages(sessionId)
        if (cancelled) return
        setSummary(findLatestSummary(convertChatMessagesToUnified(rows)))
      } catch (err) {
        console.error('[SessionSummaryPanel] Failed to load summary:', err)
        if (!cancelled) setSummary(null)
      }
    }

    setSummary(undefined)
    void resolve()
    return () => {
      cancelled = true
    }
  }, [sessionId, messageCount])

  const content = summary ? getCompactSummaryDisplayText(summary).trim() : ''
  const meta = summary?.meta?.compactSummary

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2.5">
        <Archive className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="text-xs font-medium">
          {t('rightPanel.summary', { defaultValue: 'Session summary' })}
        </span>
        {typeof meta?.messagesSummarized === 'number' && meta.messagesSummarized > 0 ? (
          <span className="rounded border border-border/70 bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {t('rightPanel.summaryMessages', {
              defaultValue: 'Earlier {{count}} messages summarized',
              count: meta.messagesSummarized
            })}
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {summary === undefined ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {t('thinking.thinkingEllipsis', { ns: 'chat', defaultValue: 'Loading...' })}
          </div>
        ) : !summary || !content ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            {t('rightPanel.summaryEmpty', { defaultValue: 'No summary yet' })}
          </div>
        ) : (
          <div className="prose prose-sm max-w-none text-[13px] leading-relaxed text-foreground dark:prose-invert [&_h1]:mb-2 [&_h1]:mt-1 [&_h1]:text-base [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-sm [&_h3]:mb-1 [&_h3]:mt-2 [&_h3]:text-sm [&_li]:my-0.5 [&_p]:my-1.5 [&_pre]:overflow-x-auto">
            <Markdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>
              {content}
            </Markdown>
          </div>
        )}
      </div>
    </div>
  )
}
