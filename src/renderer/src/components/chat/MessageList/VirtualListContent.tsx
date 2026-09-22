import * as React from 'react'
import { ArrowDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { AssistantReplyRail } from './AssistantReplyRail'
import { MessageRow } from './MessageRow'
import {
  getMessageColumnClass,
  mergeHiddenToolUseIds,
  hasEmptyAssistantContent,
  TAIL_LIVE_MESSAGE_COUNT,
  TAIL_STATIC_MESSAGE_COUNT,
  type MessageListRow,
  type MessageListProps
} from './utils'
import { extractEditableUserMessageDraft } from '@renderer/lib/image-attachments'
import { USER_MESSAGE_BUBBLE_CLASS } from '../user-message-helpers'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import type { RequestRetryState } from '@renderer/lib/agent/types'
import type { OrchestrationRunStore } from '@renderer/lib/orchestration/build-runs'

interface VirtualListContentProps {
  containerRef: React.RefObject<HTMLDivElement | null>
  listRef: React.RefObject<HTMLDivElement | null>
  virtualContentRef: React.RefObject<HTMLDivElement | null>
  rowVirtualizer: any & {
    getTotalSize: () => number
    getVirtualItems: () => Array<{ key: string | number; index: number; start: number }>
    measureElement: (el: Element | null) => void
  }
  handleListScroll: () => void
  hasLoadOlderRow: boolean
  loadOlderMessages: (preserveResidentHistory?: boolean) => Promise<number>
  isLoadingOlderMessages: boolean
  totalTurns: number
  loadedTurns: number
  pinnedTurnMessage: UnifiedMessage | null
  isPinnedTurnOverlayVisible: boolean
  onJumpToPinnedMessage: () => void
  rows: MessageListRow[]
  lastMessageRowIndex: number
  messageLookup: Map<string, UnifiedMessage>
  toolResultsLookup: Map<string, unknown>
  orchestrationState: OrchestrationRunStore
  duplicatePlanReviewToolUseIds: Set<string>
  sessionAssistantMessageIds: string[]
  sessionToolUseIds: string[]
  streamingMessageId: string | null
  isAgentExecutionActive: boolean
  highlightedMessageId: string | null
  sessionRequestRetryState: RequestRetryState | null
  targetSessionId: string | null
  fullWidth: boolean
  isAtBottom: boolean
  animationsEnabled: boolean
  assistantRailItems: Array<{ id: string; sortOrder: number }>
  activeAssistantRailMessageIds: Set<string>
  handleJumpToAssistantMessage: (item: { id: string; sortOrder: number }) => Promise<void>
  scrollToBottom: () => void
  t: (key: string, options?: Record<string, unknown>) => string
  onEditUserMessage: MessageListProps['onEditUserMessage']
}

export function VirtualListContent(props: VirtualListContentProps): React.JSX.Element {
  const {
    containerRef,
    listRef,
    virtualContentRef,
    rowVirtualizer,
    handleListScroll,
    hasLoadOlderRow,
    loadOlderMessages,
    isLoadingOlderMessages,
    totalTurns,
    loadedTurns,
    pinnedTurnMessage,
    isPinnedTurnOverlayVisible,
    onJumpToPinnedMessage,
    rows,
    lastMessageRowIndex,
    toolResultsLookup,
    orchestrationState,
    duplicatePlanReviewToolUseIds,
    sessionAssistantMessageIds,
    sessionToolUseIds,
    streamingMessageId,
    isAgentExecutionActive,
    highlightedMessageId,
    sessionRequestRetryState,
    targetSessionId,
    fullWidth,
    isAtBottom,
    animationsEnabled,
    assistantRailItems,
    activeAssistantRailMessageIds,
    handleJumpToAssistantMessage,
    scrollToBottom,
    t,
    onEditUserMessage
  } = props

  // R-10.5: 吸附卡改为紧凑指示条——不再全量渲染 UserMessage（长粘贴会把
  // 窗口占满）。只取纯文本，两行截断，悬浮 title 看全文，点击跳回消息本体。
  const pinnedPreviewText = React.useMemo(() => {
    if (!pinnedTurnMessage) return ''
    return extractEditableUserMessageDraft(pinnedTurnMessage.content).text.replace(
      /\r\n?/g,
      '\n'
    )
  }, [pinnedTurnMessage])

  // T-9: 吸附卡是浮在内容区顶部之上（absolute overlay），首行需要让出它的高度，
  // 否则顶部第一条消息被遮住。卡高走 ResizeObserver —— 两行截断时高度随内容变化。
  const pinnedCardRef = React.useRef<HTMLDivElement>(null)
  const [pinnedCardHeight, setPinnedCardHeight] = React.useState(0)

  React.useLayoutEffect(() => {
    const el = pinnedCardRef.current
    if (!el) {
      setPinnedCardHeight(0)
      return
    }
    const measure = (): void => setPinnedCardHeight(el.getBoundingClientRect().height)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [pinnedPreviewText, isPinnedTurnOverlayVisible])

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <div
        ref={listRef}
        className="absolute inset-0 overflow-y-auto pl-7 md:pl-9"
        data-message-content
        // 同 ThinkingBlock：全局 `* { scroll-behavior: smooth }`（assets/main.css:323）会把每次
        // scrollTop 赋值变成平滑动画，与逐帧跟随对打。inline 覆盖成 auto（瞬时）。
        style={{ overflowAnchor: 'none', scrollBehavior: 'auto' }}
        onScroll={handleListScroll}
      >
        <div
          ref={virtualContentRef}
          className="relative w-full"
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`
            // 注：R-10.2 的执行中高度水位线**不写在这里** —— 由 useMessageListScroll
            // 直写 el.style.minHeight（见 applyMinHeight）。只要 minHeight 不出现在 JSX 的
            // style 里，React 的 diff 就不会碰这个属性，手写的值留得住；写成 state 等于
            // 每抬一次水位线就整树 re-render 一趟。
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow: any) => {
            const isLoadOlderRow = hasLoadOlderRow && virtualRow.index === 0
            const rowIndex = virtualRow.index - (hasLoadOlderRow ? 1 : 0)
            // 顶部间距加在行上而不是滚动容器上：容器 padding-top 会让虚拟列表的
            // item 0 起点与 scrollTop=0 错开（virtualizer 未设 scrollMargin），
            // 行内 padding 则由 measureElement 自动量进行高，不动任何滚动数学。
            // 有「加载更早」行时它自带 pt-3，不叠加。
            const isFirstVisualRow = rowIndex === 0 && !hasLoadOlderRow

            return (
              <div
                key={virtualRow.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className={
                  isFirstVisualRow
                    ? 'absolute left-0 top-0 w-full pt-3'
                    : 'absolute left-0 top-0 w-full'
                }
                style={{
                  transform: `translateY(${virtualRow.start}px)`,
                  // T-9: 吸附卡可见时首行让位（inline style 覆盖 pt-3）
                  ...(isFirstVisualRow && isPinnedTurnOverlayVisible && pinnedCardHeight > 0
                    ? { paddingTop: `${Math.ceil(pinnedCardHeight)}px` }
                    : {})
                }}
              >
                {isLoadOlderRow ? (
                  <div
                    className={`${getMessageColumnClass(fullWidth)} flex justify-center pb-3 pt-3 animate-in fade-in-0 duration-200`}
                  >
                    <button
                      type="button"
                      className="rounded-full border border-border/70 bg-background/92 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground disabled:cursor-wait disabled:opacity-70"
                      onClick={() => void loadOlderMessages(true)}
                      disabled={isLoadingOlderMessages}
                    >
                      {t(
                        isLoadingOlderMessages
                          ? 'messageList.loadingOlderProgress'
                          : 'messageList.loadOlderProgress',
                        { loadedTurns, totalTurns }
                      )}
                    </button>
                  </div>
                ) : (
                  (() => {
                    const row = rows[rowIndex]
                    if (!row) return null

                    const liveCutoffIndex = Math.max(
                      0,
                      lastMessageRowIndex - TAIL_LIVE_MESSAGE_COUNT
                    )
                    const disableAnimation =
                      lastMessageRowIndex >= 0
                        ? rowIndex >=
                          Math.max(0, lastMessageRowIndex - (TAIL_STATIC_MESSAGE_COUNT - 1))
                        : false

                    const item = row.data
                    const message = item.kind === 'message' ? item.message : undefined
                    const originMessageId = item.kind === 'message' ? item.originMessageId : null
                    const isLastUserMessage = item.isLastUserMessage
                    const isLastAssistantMessage = item.isLastAssistantMessage
                    const isEmptyAssistantLoading =
                      message !== undefined &&
                      isLastAssistantMessage &&
                      isAgentExecutionActive &&
                      hasEmptyAssistantContent(message)
                    const isStreaming =
                      Boolean(message) &&
                      (streamingMessageId === originMessageId || isEmptyAssistantLoading)
                    const rowRenderMode =
                      !isStreaming && rowIndex < liveCutoffIndex ? 'static' : undefined
                    const orchestration = originMessageId
                      ? orchestrationState.byMessageId.get(originMessageId)
                      : undefined

                    return (
                      <MessageRow
                        item={item}
                        sessionId={targetSessionId}
                        sessionAssistantMessageIds={sessionAssistantMessageIds}
                        sessionToolUseIds={sessionToolUseIds}
                        isStreaming={isStreaming}
                        isLastUserMessage={isLastUserMessage}
                        isLastAssistantMessage={isLastAssistantMessage}
                        disableAnimation={disableAnimation}
                        toolResults={originMessageId ? (toolResultsLookup.get(originMessageId) as any) : undefined}
                        orchestrationRun={orchestration?.primaryRun ?? null}
                        hiddenToolUseIds={mergeHiddenToolUseIds(
                          orchestration?.hiddenToolUseIds as any,
                          duplicatePlanReviewToolUseIds
                        )}
                        anchorMessageId={null}
                        highlightMessageId={highlightedMessageId}
                        renderMode={rowRenderMode}
                        requestRetryState={
                          isLastAssistantMessage ? (sessionRequestRetryState ?? null) : null
                        }
                        fullWidth={fullWidth}
                        onEditUserMessage={onEditUserMessage}
                      />
                    )
                  })()
                )}
              </div>
            )
          })}
        </div>
      </div>

      <AnimatePresence>
        {pinnedTurnMessage && isPinnedTurnOverlayVisible && (
          <motion.div
            key="pinned-turn"
            ref={pinnedCardRef}
            className="absolute left-0 right-0 top-0 z-20 bg-background pb-2 pl-7 pr-14 md:pl-9"
            initial={animationsEnabled ? { opacity: 0, y: -6 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={animationsEnabled ? { opacity: 0, y: -6 } : undefined}
            transition={animationsEnabled ? { duration: 0.15, ease: 'easeOut' } : { duration: 0 }}
          >
            <div className={getMessageColumnClass(fullWidth)}>
              <button
                type="button"
                onClick={onJumpToPinnedMessage}
                title={pinnedPreviewText || undefined}
                className={`${USER_MESSAGE_BUBBLE_CLASS} ml-auto block w-fit max-w-full cursor-pointer text-left text-sm leading-snug`}
              >
                {pinnedPreviewText ? (
                  <span className="line-clamp-2 whitespace-pre-wrap break-words">
                    {pinnedPreviewText}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {t('messageList.pinnedTurnEmpty')}
                  </span>
                )}
              </button>
            </div>
            {/* R-10.1: 底部渐隐遮罩——吸附卡是不透明底色，向下渐隐融入消息流 */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-background to-transparent"
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AssistantReplyRail
        items={assistantRailItems as any}
        activeMessageIds={activeAssistantRailMessageIds}
        onJump={handleJumpToAssistantMessage}
      />

      <AnimatePresence>
        {!isAtBottom && (
          <motion.div
            key="scroll-to-bottom"
            className="absolute bottom-4 left-1/2 z-10"
            initial={animationsEnabled ? { opacity: 0, scale: 0.9, y: 4, x: '-50%' } : false}
            animate={{ opacity: 1, scale: 1, y: 0, x: '-50%' }}
            exit={animationsEnabled ? { opacity: 0, scale: 0.9, y: 4, x: '-50%' } : undefined}
            transition={animationsEnabled ? { duration: 0.15, ease: 'easeOut' } : { duration: 0 }}
          >
            <button
              onClick={scrollToBottom}
              className="flex items-center gap-1.5 rounded-full border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground shadow-lg backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:text-foreground hover:shadow-xl"
            >
              <ArrowDown className="size-3" />
              {t('messageList.scrollToBottom')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
