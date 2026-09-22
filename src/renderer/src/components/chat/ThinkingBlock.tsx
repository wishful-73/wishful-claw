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
import { isWebUrl } from '@renderer/lib/preview/web-url'
import { WebUrlCode } from './AssistantMessage/WebUrlCode'
import { useStreamingRenderPool } from '@renderer/hooks/use-typewriter'
import { CollapsibleHeightPanel } from './CollapsibleHeightPanel'

/**
 * 思考区滚动提前量（px）：滚动条先一步拉到底，在内容底之下垫出这么一段空白。
 * 新内容长进这段空白里时滚动条一动不动；空白用尽那一刻再拉到底、再垫一段。
 *
 * 必须与内容层的 `pb-32` 一致（8rem = 128px）—— 滚动到底时视口底边恰好落在内容 div 的
 * padding 起点上，那段 padding 就是这里的提前量。**改一个必须同时改另一个。**
 *
 * 取值 = 视口高（`max-h-80` = 320px）的 40%（老大 2026-09-16 口径，从 30% 上调）。
 * 提前量越大，单帧增量越不容易一次把它击穿 ⇒ 补的次数越少；代价是可见内容变矮。
 */
const THINKING_SCROLL_AHEAD_PX = 128

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

  useLayoutEffect(() => {
    if (!isThinking || !hasThinkingContent || !contentRef.current) return
    const el = contentRef.current
    // 提前量还在（内容长了不到 THINKING_SCROLL_AHEAD_PX）就一动不动；
    // 用尽那一刻重新拉到底，垫出下一段提前量。
    //
    // 两个方向都错过的写法，别再走回去：
    // - 每帧 `el.scrollTop = maxTop`（无条件贴底）：位置稳，但滚动条每帧都在滑，晃。
    // - 攒够一行高（24px）才滚：24px 是「行高」不是「提前量」，领先量太小，
    //   下一帧又得动，退化成每帧都在滑，白白多了一堆判断。
    const maxTop = el.scrollHeight - el.clientHeight
    if (maxTop - el.scrollTop >= THINKING_SCROLL_AHEAD_PX) {
      el.scrollTop = maxTop
    }
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
              // scrollBehavior 必须写 inline：全局 `* { scroll-behavior: smooth }`
              // （assets/main.css:323）没包在 @layer 里，优先级高于 Tailwind 的 scroll-auto
              // class，只有 inline 压得住。smooth 会把 `el.scrollTop = x` 从瞬时跳变
              // 变成几百 ms 的滚动动画 —— 本组件每帧重新赋值，于是每帧都「打断上一个动画、
              // 从头再来」，滚动条永远在追赶一个够不着的目标，观感就是持续蠕动。
              style={{ overflowAnchor: 'none', scrollBehavior: 'auto' }}
            >
              {isThinking ? (
                <div
                  className={`${getLiveOutputSurfaceClass(liveOutputAnimationStyle)} whitespace-pre-wrap break-words pb-32 leading-relaxed`}
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
                          if (isWebUrl(code)) {
                            return <WebUrlCode url={code} style={{ fontFamily: MONO_FONT }} />
                          }
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
