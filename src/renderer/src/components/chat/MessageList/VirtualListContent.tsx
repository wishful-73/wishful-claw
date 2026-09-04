import * as React from 'react'
import { ArrowDown, CircleUserRound } from 'lucide-react'
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
import { extractUnifiedMessageText } from '@renderer/lib/agent/context-compression'
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
  onRetry: MessageListProps['onRetry']
  onContinue: MessageListProps['onContinue']
  onEditUserMessage: MessageListProps['onEditUserMessage']
  onDeleteMessage: MessageListProps['onDeleteMessage']
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
    onRetry,
    onContinue,
    onEditUserMessage,
    onDeleteMessage
  } = props

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <div
        ref={listRef}
        className="absolute inset-0 overflow-y-auto pl-7 md:pl-9"
        data-message-content
        style={{ overflowAnchor: 'none' }}
        onScroll={handleListScroll}
      >
        <div
          ref={virtualContentRef}
          className="relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
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
                style={{ transform: `translateY(${virtualRow.start}px)` }}
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
                    const showContinue = item.showContinue
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
                        showContinue={showContinue}
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
                        onRetry={onRetry}
                        onContinue={onContinue}
                        onEditUserMessage={onEditUserMessage}
                        onDeleteMessage={onDeleteMessage}
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
            className="absolute left-0 right-0 top-0 z-20 pl-7 pr-14 md:pl-9"
            initial={animationsEnabled ? { opacity: 0, y: -6 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={animationsEnabled ? { opacity: 0, y: -6 } : undefined}
            transition={animationsEnabled ? { duration: 0.15, ease: 'easeOut' } : { duration: 0 }}
          >
            <div className={getMessageColumnClass(fullWidth)}>
              <button
                type="button"
                onClick={onJumpToPinnedMessage}
                title={extractUnifiedMessageText(pinnedTurnMessage)}
                className="flex w-full items-start gap-2 rounded-b-lg border border-t-0 border-border/70 bg-background/92 px-3 py-2 text-left shadow-sm backdrop-blur-sm transition-colors hover:bg-background"
              >
                <CircleUserRound className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="line-clamp-2 flex-1 text-xs leading-5 text-muted-foreground">
                  {extractUnifiedMessageText(pinnedTurnMessage) ||
                    t('messageList.pinnedTurnEmpty')}
                </span>
              </button>
            </div>
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
