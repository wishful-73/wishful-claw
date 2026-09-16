/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { memo, useState, useEffect, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { BrainCircuit, ChevronRight, ChevronDown } from 'lucide-react'
import Markdown from 'react-markdown'
import { MONO_FONT } from '@renderer/lib/constants'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { normalizeLanguageCode } from '@renderer/lib/i18n-language'
import {
  getLiveOutputComponentClass,
  getLiveOutputCursorClass,
  getLiveOutputShimmerClass,
  getLiveOutputSurfaceClass
} from '@renderer/lib/live-output-animation'
import {
  openMarkdownHref,
  resolveLocalFilePath,
  openLocalFilePath,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS
} from '@renderer/lib/preview/viewers/markdown-components'
import { useStreamingRenderPool } from '@renderer/hooks/use-typewriter'
import { CollapsibleHeightPanel } from './CollapsibleHeightPanel'

interface ThinkingBlockProps {
  thinking: string
  isStreaming?: boolean
  startedAt?: number
  completedAt?: number
}

export const ThinkingBlock = memo(function ThinkingBlock({
  thinking,
  isStreaming = false,
  startedAt,
  completedAt
}: ThinkingBlockProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation('chat')
  const liveOutputAnimationStyle = useSettingsStore((s) => s.liveOutputAnimationStyle)
  const isThinking = isStreaming && !completedAt
  const renderPool = useStreamingRenderPool(thinking, isThinking, liveOutputAnimationStyle)
  const liveComponentClassName = isThinking
    ? getLiveOutputComponentClass(liveOutputAnimationStyle)
    : ''
  const hasThinkingContent = thinking.trim().length > 0
  const defaultCollapsed = !isThinking && hasThinkingContent

  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [liveElapsed, setLiveElapsed] = useState(0)
  const contentRef = useRef<HTMLDivElement>(null)

  // Auto-collapse when thinking transitions from active to completed
  const prevIsThinkingRef = useRef(isThinking)
  useEffect(() => {
    if (prevIsThinkingRef.current && !isThinking) {
      setCollapsed(true)
    }
    prevIsThinkingRef.current = isThinking
  }, [isThinking])

  // Live timer while thinking
  useEffect(() => {
    if (!isThinking || !startedAt) return
    const tick = (): void => setLiveElapsed(Math.round((Date.now() - startedAt) / 1000))
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [isThinking, startedAt])

  // 贴底 = 每帧把滚动条推到内容底（maxTop）。底部那 48px 留白由内容容器的 pb-12 提供，所以滚动条
  // 天然「提前」于文本末尾，新内容先落进这段缓冲里 —— 这正是要的效果。
  // 每帧执行、不设门槛：滚动量恒等于每帧内容增量，是连续跟随；阈值式判定（攒够才滚）会把连续跟随
  // 拆成离散台阶，单次跳跃反而更大。
  // 在 paint 前完成（useLayoutEffect），避免留下「内容已长出来、滚动条没跟上」的一帧。
  useLayoutEffect(() => {
    if (!isThinking || !hasThinkingContent || !contentRef.current) return
    const el = contentRef.current
    // 留白必须由容器的底部 padding 提供：scrollTop 一旦超过 maxTop 会被浏览器直接 clamp 掉，
    // 靠偏移做不出留白。
    el.scrollTop = el.scrollHeight - el.clientHeight
  }, [hasThinkingContent, isThinking, renderPool.text])

  if (!isThinking && !hasThinkingContent) {
    return null
  }

  const expanded = isThinking || (hasThinkingContent && !collapsed)
  const compactLanguage = normalizeLanguageCode(i18n.language)

  // Compute duration label from persisted timestamps
  const persistedDuration =
    startedAt && completedAt ? Math.round((completedAt - startedAt) / 1000) : null

  const durationLabel =
    persistedDuration !== null
      ? t('thinking.thoughtFor', { seconds: persistedDuration })
      : isThinking && liveElapsed > 0
        ? t('thinking.thinkingFor', { seconds: liveElapsed })
        : isThinking
          ? t('thinking.thinkingEllipsis')
          : t('thinking.thoughts')
  const headerLabel = isThinking
    ? t('thinking.deepThinking', { defaultValue: 'Thinking deeply' })
    : t('thinking.deepThought', { defaultValue: 'Thought deeply' })

  const compactElapsedLabel =
    liveElapsed > 0
      ? compactLanguage === 'ko' as string
        ? `${liveElapsed}초`
        : compactLanguage === 'zh' || compactLanguage === 'ja' as string
          ? `${liveElapsed} 秒`
          : `${liveElapsed}s`
      : ''

  return (
    <div className={`my-4 min-w-0${liveComponentClassName ? ` ${liveComponentClassName}` : ''}`}>
      <button
        onClick={() => {
          if (isThinking) return
          setCollapsed((v) => !v)
        }}
        title={durationLabel}
        className="group inline-flex max-w-full items-center gap-1.5 rounded-md px-0.5 py-1 text-left text-[13px] text-muted-foreground/70 transition-colors hover:text-foreground"
      >
        <span
          className={`flex size-5 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/20 text-violet-600 transition-colors group-hover:border-violet-500/30 group-hover:text-violet-500 dark:border-white/[0.08] dark:bg-white/[0.025] dark:text-violet-400 ${
            isThinking
              ? 'shadow-[0_0_0_1px_rgba(139,92,246,0.08)] animate-pulse'
              : 'shadow-[0_0_0_1px_rgba(139,92,246,0.04)]'
          }`}
        >
          <BrainCircuit className="size-3" />
        </span>
        <span className="min-w-0 truncate font-medium">{headerLabel}</span>
        {expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/55 transition-colors group-hover:text-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/55 transition-colors group-hover:text-foreground" />
        )}
      </button>

      <CollapsibleHeightPanel open={expanded} className="overflow-hidden">
        <div className="max-w-full px-0.5 pb-1 text-sm leading-7 text-muted-foreground/75">
          {/* T-8: 内层滚动容器必须禁掉滚动锚定。内容增长时浏览器的 overflow-anchor
              会自动调 scrollTop 去稳锚点，与这里的手动贴底对打 —— 表现为「滚到顶
              又被拉回」，且上游越快（一次涨得越多）越明显。外层列表容器已有同样的
              overflowAnchor:'none'（MessageList/VirtualListContent.tsx:126），内层此前漏了。 */}
          {hasThinkingContent ? (
            <div
              ref={contentRef}
              className="max-h-80 overflow-y-auto"
              style={{ overflowAnchor: 'none' }}
            >
              {isThinking ? (
                <div
                  className={`${getLiveOutputSurfaceClass(liveOutputAnimationStyle)} whitespace-pre-wrap break-words pb-12 leading-relaxed`}
                  data-render-pool-size={renderPool.poolSize}
                  data-rendered-length={renderPool.renderedLength}
                  data-target-length={renderPool.targetLength}
                >
                  {renderPool.text}
                  <span className={getLiveOutputCursorClass(liveOutputAnimationStyle)} />
                </div>
              ) : (
                <div className="[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-2 [&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-5 [&_li]:my-1">
                  <Markdown
                    remarkPlugins={MARKDOWN_REMARK_PLUGINS}
                    rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                    components={{
                      a: ({ href, children, ...props }) => (
                        <a
                          {...props}
                          href={href}
                          className="text-primary underline underline-offset-2 hover:text-primary/80 break-all"
                          onClick={(event) => {
                            if (!href) return
                            const handled = openMarkdownHref(href)
                            if (handled) event.preventDefault()
                          }}
                        >
                          {children}
                        </a>
                      ),
                      code: ({ children, className, ...props }) => {
                        const isInline = !className
                        if (isInline) {
                          const code = String(children ?? '').replace(/\n$/, '')
                          const resolvedPath = resolveLocalFilePath(code)
                          if (resolvedPath) {
                            return (
                              <button
                                type="button"
                                className="cursor-pointer rounded bg-muted px-1 py-0.5 text-xs font-mono text-primary underline-offset-2 hover:underline"
                                style={{ fontFamily: MONO_FONT }}
                                title={resolvedPath}
                                onClick={() => {
                                  void openLocalFilePath(code)
                                }}
                              >
                                {children}
                              </button>
                            )
                          }
                          return (
                            <code
                              className="rounded bg-muted px-1 py-0.5 text-xs font-mono"
                              style={{ fontFamily: MONO_FONT }}
                              {...props}
                            >
                              {children}
                            </code>
                          )
                        }
                        return (
                          <code className={className} style={{ fontFamily: MONO_FONT }} {...props}>
                            {children}
                          </code>
                        )
                      }
                    }}
                  >
                    {thinking}
                  </Markdown>
                </div>
              )}
            </div>
          ) : (
            <div role="status" aria-live="polite" className="thinking-live-status">
              <span
                className={`thinking-live-label ${getLiveOutputShimmerClass(liveOutputAnimationStyle)}`}
              >
                {t('thinking.pending', { defaultValue: 'Thinking' })}
              </span>
              {liveElapsed > 0 && (
                <span className="thinking-live-meta" aria-label={durationLabel}>
                  {compactElapsedLabel}
                </span>
              )}
            </div>
          )}
        </div>
      </CollapsibleHeightPanel>
    </div>
  )
})

ThinkingBlock.displayName = 'ThinkingBlock'
