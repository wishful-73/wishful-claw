import * as React from 'react'
import { flushSync } from 'react-dom'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { useChatStore } from '@renderer/stores/chat-store'
import {
  type MessageListRow,
  areStringSetsEqual,
  getDistanceToBottom,
  AUTO_SCROLL_BOTTOM_THRESHOLD,
  INITIAL_TAIL_RENDER_COUNT,
  PROGRAMMATIC_SCROLL_GUARD_MS,
  STREAMING_AUTO_SCROLL_BOTTOM_THRESHOLD,
  USER_LOCATOR_HIGHLIGHT_MS,
  VIRTUAL_ROW_ESTIMATED_HEIGHT,
  VIRTUAL_ROW_OVERSCAN,
} from './utils'
import type { UnifiedMessage } from '@renderer/lib/api/types'
import type { AssistantReplyRailItem as RailItem } from './utils'
import { createJumpToAssistantMessage, applySuggestedPrompt as applySuggestedPromptImpl } from './scroll-utils'
import { AssistantReplyRailItem } from './utils'

export interface MessageListScrollInput {
  activeSessionId: string | null
  messages: UnifiedMessage[]
  rows: MessageListRow[]
  hasLoadOlderRow: boolean
  loadedRangeStart: number
  streamingMessageId: string | null
  pinnedMessageId: string | null
  isSessionOutputting: boolean
  canSessionTriggerStreamingAutoScroll: boolean
  pendingAskUserQuestion: ReturnType<typeof import('./utils').findPendingAskUserQuestion>
  assistantRailItems: RailItem[]
  assistantRailItemById: Map<string, RailItem>
  measuredMessageHeightsRef: React.RefObject<Map<string, number>>
  setAssistantRailMeasureVersion: React.Dispatch<React.SetStateAction<number>>
}

export interface MessageListScrollOutput {
  listRef: React.RefObject<HTMLDivElement | null>
  containerRef: React.RefObject<HTMLDivElement | null>
  virtualContentRef: React.RefObject<HTMLDivElement | null>
  rowVirtualizer: ReturnType<typeof useVirtualizer>
  isAtBottom: boolean
  isLoadingOlderMessages: boolean
  isPinnedTurnOverlayVisible: boolean
  activeAssistantRailMessageIds: Set<string>
  highlightedMessageId: string | null
  handleListScroll: () => void
  scrollToBottom: () => void
  handleJumpToPinnedMessage: () => void
  handleJumpToAssistantMessage: (item: AssistantReplyRailItem) => Promise<void>
  loadOlderMessages: (preserveResidentHistory?: boolean) => Promise<number>
  requestAssistantRailSync: () => void
  applySuggestedPrompt: (prompt: string) => void
}

export function useMessageListScroll(input: MessageListScrollInput): MessageListScrollOutput {
  const {
    activeSessionId,
    messages,
    rows,
    hasLoadOlderRow,
    loadedRangeStart,
    streamingMessageId,
    pinnedMessageId,
    isSessionOutputting,
    canSessionTriggerStreamingAutoScroll,
    pendingAskUserQuestion,
    assistantRailItems,
    assistantRailItemById,
    measuredMessageHeightsRef,
    setAssistantRailMeasureVersion,
  } = input

  const virtualRowCount = rows.length + (hasLoadOlderRow ? 1 : 0)

  // ── Refs ────────────────────────────────────────────────────────
  const listRef = React.useRef<HTMLDivElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const virtualContentRef = React.useRef<HTMLDivElement | null>(null)
  const renderedSessionIdRef = React.useRef<string | null>(activeSessionId)
  const pendingInitialScrollSessionIdRef = React.useRef<string | null>(activeSessionId)
  if (renderedSessionIdRef.current !== activeSessionId) {
    renderedSessionIdRef.current = activeSessionId
    pendingInitialScrollSessionIdRef.current = activeSessionId
  }
  const autoScrollModeRef = React.useRef<'off' | 'stream' | 'user'>('off')
  const initialTailReleaseFrameRef = React.useRef<number | null>(null)
  const scheduledAssistantRailSyncRef = React.useRef<number | null>(null)
  const highlightedMessageTimerRef = React.useRef<number | null>(null)
  const lastScrollOffsetRef = React.useRef(0)
  const programmaticScrollUntilRef = React.useRef(0)
  const wasSessionOutputtingRef = React.useRef(isSessionOutputting)
  const previousStreamingMessageIdRef = React.useRef(streamingMessageId)
  const isLoadingOlderMessagesRef = React.useRef(false)

  // ── State ───────────────────────────────────────────────────────
  const [isAtBottom, setIsAtBottom] = React.useState(true)
  const [activeAssistantRailMessageIds, setActiveAssistantRailMessageIds] = React.useState<
    Set<string>
  >(() => new Set())
  const [highlightedMessageId, setHighlightedMessageId] = React.useState<string | null>(null)
  const [isLoadingOlderMessages, setIsLoadingOlderMessages] = React.useState(false)
  const [isPinnedTurnOverlayVisible, setIsPinnedTurnOverlayVisible] = React.useState(false)

  // ── Helpers ─────────────────────────────────────────────────────
  const canAutoScroll = React.useCallback(() => {
    const mode = autoScrollModeRef.current
    return (
      mode === 'user' || (mode === 'stream' && canSessionTriggerStreamingAutoScroll && isAtBottom)
    )
  }, [canSessionTriggerStreamingAutoScroll, isAtBottom])

  const canAutoScrollRef = React.useRef(canAutoScroll)
  canAutoScrollRef.current = canAutoScroll

  const markProgrammaticScroll = React.useCallback(() => {
    programmaticScrollUntilRef.current = window.performance.now() + PROGRAMMATIC_SCROLL_GUARD_MS
  }, [])

  const scrollToBottomImmediate = React.useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const ref = listRef.current
      if (!ref || rows.length === 0) return
      const bottom = Math.max(0, ref.scrollHeight - ref.clientHeight)
      // Already pinned: re-writing scrollTop would dispatch another scroll
      // event, whose handler sets state and re-runs the auto-scroll layout
      // effects — that cycle is what React reports as "Maximum update depth
      // exceeded".
      if (Math.abs(ref.scrollTop - bottom) <= 1) return
      markProgrammaticScroll()
      if (behavior === 'auto') { ref.scrollTop = bottom; return }
      ref.scrollTo({ top: bottom, behavior })
    },
    [markProgrammaticScroll, rows.length]
  )

  const syncBottomState = React.useCallback(() => {
    const ref = listRef.current
    if (!ref) return
    const dist = getDistanceToBottom(ref)
    const threshold = isSessionOutputting ? STREAMING_AUTO_SCROLL_BOTTOM_THRESHOLD : AUTO_SCROLL_BOTTOM_THRESHOLD
    const prev = lastScrollOffsetRef.current
    const cur = ref.scrollTop
    const isProg = window.performance.now() < programmaticScrollUntilRef.current
    lastScrollOffsetRef.current = cur
    if (cur < prev && dist > threshold && !isProg) {
      autoScrollModeRef.current = 'off'
      setIsAtBottom(false)
      return
    }
    const atBottom = dist <= threshold
    if (atBottom && isSessionOutputting && autoScrollModeRef.current === 'off') autoScrollModeRef.current = 'stream'
    const next = atBottom || (isSessionOutputting && autoScrollModeRef.current === 'stream')
    setIsAtBottom((p) => (p === next ? p : next))
  }, [isSessionOutputting])

  const measureVisibleMessageHeights = React.useCallback(() => {
    const ref = listRef.current
    if (!ref) return false
    let changed = false
    for (const element of ref.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const messageId = element.dataset.messageId
      if (!messageId) continue
      const height = element.offsetHeight
      if (height <= 0) continue
      const previous = measuredMessageHeightsRef.current.get(messageId)
      if (previous === undefined || Math.abs(previous - height) > 2) {
        measuredMessageHeightsRef.current.set(messageId, height)
        changed = true
      }
    }
    return changed
  }, [])

  const setActiveAssistantRailIds = React.useCallback((nextIds: Set<string>) => {
    setActiveAssistantRailMessageIds((previousIds) =>
      areStringSetsEqual(previousIds, nextIds) ? previousIds : nextIds
    )
  }, [])

  const syncActiveAssistantRail = React.useCallback(() => {
    const ref = listRef.current
    if (!ref || assistantRailItems.length === 0) {
      setActiveAssistantRailIds(new Set())
      return
    }
    const didMeasure = measureVisibleMessageHeights()
    if (didMeasure) {
      setAssistantRailMeasureVersion((version) => version + 1)
    }
    const containerRect = ref.getBoundingClientRect()
    const nextActiveIds = new Set<string>()
    for (const element of ref.querySelectorAll<HTMLElement>('[data-message-id]')) {
      const messageId = element.dataset.messageId
      if (!messageId) continue
      if (!assistantRailItemById.has(messageId)) continue
      const rect = element.getBoundingClientRect()
      if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) continue
      nextActiveIds.add(messageId)
    }
    setActiveAssistantRailIds(nextActiveIds)
  }, [assistantRailItemById, assistantRailItems, measureVisibleMessageHeights, setActiveAssistantRailIds])

  const requestAssistantRailSync = React.useCallback(() => {
    if (scheduledAssistantRailSyncRef.current !== null) return
    scheduledAssistantRailSyncRef.current = window.requestAnimationFrame(() => {
      scheduledAssistantRailSyncRef.current = null
      syncActiveAssistantRail()
    })
  }, [syncActiveAssistantRail])


  // ── shouldAdjustScrollPositionOnItemSizeChange ──────────────────
  const shouldAdjustScrollPositionOnItemSizeChange = React.useCallback(
    (item: { end: number }, _delta: number, instance: { scrollOffset: number | null }): boolean => {
      if (canAutoScroll()) return false
      // 加载历史消息期间不让虚拟列表调整 scrollTop，由 loadOlderMessages
      // 的 scrollHeight 差值补偿统一处理。
      if (isLoadingOlderMessagesRef.current) return false
      const scrollOffset = instance.scrollOffset ?? 0
      return item.end < scrollOffset
    },
    [canAutoScroll]
  )

  // ── Virtualizer ─────────────────────────────────────────────────
  const rowVirtualizer = useVirtualizer({
    count: virtualRowCount,
    getScrollElement: () => listRef.current,
    estimateSize: () => VIRTUAL_ROW_ESTIMATED_HEIGHT,
    overscan: VIRTUAL_ROW_OVERSCAN,
    rangeExtractor: (range) => {
      if (pendingInitialScrollSessionIdRef.current !== activeSessionId || range.count === 0) {
        return defaultRangeExtractor(range)
      }
      const startIndex = Math.max(0, range.count - INITIAL_TAIL_RENDER_COUNT)
      return Array.from({ length: range.count - startIndex }, (_, offset) => startIndex + offset)
    },
    getItemKey: (index) => {
      if (hasLoadOlderRow && index === 0) return `load-older:${activeSessionId ?? 'none'}`
      const row = rows[index - (hasLoadOlderRow ? 1 : 0)]
      return row?.key ?? `row:${index}`
    }
  })
  rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange =
    shouldAdjustScrollPositionOnItemSizeChange

  // ── Pinned current-turn overlay visibility ──────────────────────
  // 当前轮 user message 滚出可视区顶部时显示顶部吸附卡；仍在可视区时不重复展示。
  const setPinnedOverlay = React.useCallback((visible: boolean) => {
    setIsPinnedTurnOverlayVisible((prev) => (prev === visible ? prev : visible))
  }, [])

  const syncPinnedTurnOverlay = React.useCallback(() => {
    if (!pinnedMessageId) {
      setPinnedOverlay(false)
      return
    }
    const ref = listRef.current
    if (!ref) return
    const element = ref.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(pinnedMessageId)}"]`
    )
    if (element) {
      const containerTop = ref.getBoundingClientRect().top
      setPinnedOverlay(element.getBoundingClientRect().bottom <= containerTop + 1)
      return
    }
    // 未渲染（超出 overscan）时按虚拟行索引判断在可视区上方还是下方。
    const rowIndex = rows.findIndex((row) => row.key === pinnedMessageId)
    if (rowIndex < 0) {
      setPinnedOverlay(false)
      return
    }
    const virtualIndex = rowIndex + (hasLoadOlderRow ? 1 : 0)
    const items = rowVirtualizer.getVirtualItems()
    const firstItem = items[0]
    setPinnedOverlay(Boolean(firstItem && virtualIndex < firstItem.index))
  }, [hasLoadOlderRow, pinnedMessageId, rows, rowVirtualizer, setPinnedOverlay])

  // ── Jump back to the pinned current-turn user message ───────────
  const handleJumpToPinnedMessage = React.useCallback(() => {
    if (!pinnedMessageId) return
    autoScrollModeRef.current = 'off'
    setIsAtBottom(false)
    const highlightTarget = (): void => {
      setHighlightedMessageId(pinnedMessageId)
      if (highlightedMessageTimerRef.current !== null) {
        window.clearTimeout(highlightedMessageTimerRef.current)
      }
      highlightedMessageTimerRef.current = window.setTimeout(() => {
        setHighlightedMessageId((prev) => (prev === pinnedMessageId ? null : prev))
        highlightedMessageTimerRef.current = null
      }, USER_LOCATOR_HIGHLIGHT_MS) as unknown as number
    }
    const ref = listRef.current
    if (!ref) return
    const target = ref.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(pinnedMessageId)}"]`
    )
    if (target) {
      markProgrammaticScroll()
      highlightTarget()
      const targetTop =
        ref.scrollTop + (target.getBoundingClientRect().top - ref.getBoundingClientRect().top)
      ref.scrollTo({ top: Math.max(0, targetTop - 8), behavior: 'smooth' })
      return
    }
    const rowIndex = rows.findIndex((row) => row.key === pinnedMessageId)
    if (rowIndex < 0) return
    markProgrammaticScroll()
    highlightTarget()
    rowVirtualizer.scrollToIndex(rowIndex + (hasLoadOlderRow ? 1 : 0), { align: 'start' })
  }, [hasLoadOlderRow, markProgrammaticScroll, pinnedMessageId, rows, rowVirtualizer])

  // ── Jump to assistant message (delegated to scroll-utils) ──────
  const handleJumpToAssistantMessage = React.useCallback(
    createJumpToAssistantMessage({
      listRef,
      activeSessionId,
      markProgrammaticScroll,
      requestAssistantRailSync,
      rowVirtualizer: rowVirtualizer as any,
      setActiveAssistantRailIds,
      setHighlightedMessageId,
      highlightedMessageTimerRef,
      autoScrollModeRef,
      setIsAtBottom,
    }),
    [activeSessionId, markProgrammaticScroll, requestAssistantRailSync, rowVirtualizer, setActiveAssistantRailIds]
  )

  // ── Load older messages ─────────────────────────────────────────
  // flushSync 同步提交 DOM 后立即用 scrollHeight 差值补偿 scrollTop。
  // shouldAdjustScrollPositionOnItemSizeChange 在加载期间返回 false，
  // 不让虚拟列表干扰 scrollTop。
  const loadOlderMessages = React.useCallback(
    async (_preserveResidentHistory = false): Promise<number> => {
      if (!activeSessionId || isLoadingOlderMessagesRef.current || loadedRangeStart <= 0) return 0
      autoScrollModeRef.current = 'off'
      pendingInitialScrollSessionIdRef.current = null
      if (initialTailReleaseFrameRef.current !== null) {
        window.clearTimeout(initialTailReleaseFrameRef.current as unknown as number)
        initialTailReleaseFrameRef.current = null
      }
      isLoadingOlderMessagesRef.current = true
      setIsAtBottom(false)
      setIsLoadingOlderMessages(true)
      try {
        const ref = listRef.current
        const oldScrollTop = ref?.scrollTop ?? 0
        const oldHeight = ref?.scrollHeight ?? 0

        const { messages: newMessages, rangeStart, hasMore, totalTurns } = await useChatStore
          .getState()
          .fetchOlderMessages?.(activeSessionId) ?? { messages: [], rangeStart: 0, hasMore: false, totalTurns: 0 }

        if (newMessages.length === 0) return 0

        flushSync(() => {
          useChatStore.getState().prependMessages?.(activeSessionId, newMessages, rangeStart, hasMore, totalTurns)
        })
        if (ref) {
          const newHeight = ref.scrollHeight
          const delta = newHeight - oldHeight
          if (delta > 0) {
            markProgrammaticScroll()
            ref.scrollTop = oldScrollTop + delta
          }
        }

        syncBottomState()
        requestAssistantRailSync()
        return newMessages.length
      } finally {
        isLoadingOlderMessagesRef.current = false
        setIsLoadingOlderMessages(false)
      }
    },
    [activeSessionId, loadedRangeStart, markProgrammaticScroll, requestAssistantRailSync, syncBottomState]
  )

  // ── Scroll handler ──────────────────────────────────────────────
  const handleListScroll = React.useCallback(() => {
    // Older history is loaded only via the explicit top button (click-triggered);
    // scrolling to the top never fetches anything by itself.
    syncBottomState()
    syncPinnedTurnOverlay()
    requestAssistantRailSync()
  }, [requestAssistantRailSync, syncBottomState, syncPinnedTurnOverlay])

  // ── Load recent messages on session change ──────────────────────
  React.useEffect(() => {
    if (!activeSessionId) return
    void useChatStore.getState().loadRecentSessionMessages(activeSessionId)
  }, [activeSessionId])

  React.useEffect(() => {
    if (!activeSessionId || !streamingMessageId) return
    if (messages.some((m) => m.id === streamingMessageId)) return
    void useChatStore.getState().loadRecentSessionMessages(activeSessionId, true)
  }, [activeSessionId, messages, streamingMessageId])

  // ── Session reset layout effect ─────────────────────────────────
  React.useLayoutEffect(() => {
    pendingInitialScrollSessionIdRef.current = activeSessionId
    lastScrollOffsetRef.current = 0
    programmaticScrollUntilRef.current = 0
    measuredMessageHeightsRef.current.clear()
    setAssistantRailMeasureVersion((version) => version + 1)
    setActiveAssistantRailIds(new Set())
    setIsPinnedTurnOverlayVisible(false)
  }, [activeSessionId, setActiveAssistantRailIds])

  // ── Initial scroll to bottom ────────────────────────────────────
  React.useLayoutEffect(() => {
    if (!activeSessionId) return
    if (pendingInitialScrollSessionIdRef.current !== activeSessionId) return
    if (!(messages.length > 0 || streamingMessageId)) return
    autoScrollModeRef.current = isSessionOutputting ? 'stream' : 'user'
    scrollToBottomImmediate()
    if (initialTailReleaseFrameRef.current !== null) {
      window.clearTimeout(initialTailReleaseFrameRef.current as unknown as number)
    }
    const initializedSessionId = activeSessionId
    initialTailReleaseFrameRef.current = window.setTimeout(() => {
      if (pendingInitialScrollSessionIdRef.current === initializedSessionId) {
        pendingInitialScrollSessionIdRef.current = null
      }
      initialTailReleaseFrameRef.current = null
    }, 300) as unknown as number
    return () => {
      if (initialTailReleaseFrameRef.current !== null) {
        window.clearTimeout(initialTailReleaseFrameRef.current as unknown as number)
      }
    }
  }, [activeSessionId, isSessionOutputting, messages.length, scrollToBottomImmediate, streamingMessageId])

  // ── Streaming state transition ──────────────────────────────────
  React.useLayoutEffect(() => {
    const previousStreamingMessageId = previousStreamingMessageIdRef.current
    previousStreamingMessageIdRef.current = streamingMessageId
    if (
      !activeSessionId ||
      !streamingMessageId ||
      previousStreamingMessageId === streamingMessageId ||
      pendingAskUserQuestion ||
      isLoadingOlderMessagesRef.current
    ) {
      return
    }

    autoScrollModeRef.current = 'stream'
    setIsAtBottom(true)
    scrollToBottomImmediate()
    const frameId = window.requestAnimationFrame(() => {
      if (previousStreamingMessageIdRef.current === streamingMessageId) {
        scrollToBottomImmediate()
      }
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [
    activeSessionId,
    pendingAskUserQuestion,
    scrollToBottomImmediate,
    streamingMessageId
  ])

  React.useEffect(() => {
    const wasOutputting = wasSessionOutputtingRef.current
    if (!wasOutputting && isSessionOutputting && isAtBottom && !pendingAskUserQuestion) {
      autoScrollModeRef.current = 'stream'
    } else if (wasOutputting && !isSessionOutputting && autoScrollModeRef.current === 'stream') {
      autoScrollModeRef.current = 'off'
    }
    wasSessionOutputtingRef.current = isSessionOutputting
  }, [isAtBottom, isSessionOutputting, pendingAskUserQuestion])

  // ── Auto-scroll on new rows ─────────────────────────────────────
  React.useLayoutEffect(() => {
    if (pendingAskUserQuestion) return
    if (isLoadingOlderMessagesRef.current) return
    if (!canAutoScroll()) return
    scrollToBottomImmediate()
  }, [canAutoScroll, pendingAskUserQuestion, rows.length, scrollToBottomImmediate])

  // ── Bottom anchor: re-pin on virtual size change ────────────────
  const virtualListTotalSize = rowVirtualizer.getTotalSize()
  React.useLayoutEffect(() => {
    if (pendingAskUserQuestion) return
    if (isLoadingOlderMessagesRef.current) return
    if (!canAutoScroll() && !isAtBottom) return
    scrollToBottomImmediate()
  }, [canAutoScroll, isAtBottom, pendingAskUserQuestion, scrollToBottomImmediate, virtualListTotalSize])

  // ── Pinned overlay sync on anchor/layout changes ────────────────
  React.useEffect(() => {
    syncPinnedTurnOverlay()
  }, [rows.length, syncPinnedTurnOverlay, virtualListTotalSize])

  // ── Resize observer ─────────────────────────────────────────────
  React.useEffect(() => {
    const viewport = listRef.current
    const content = virtualContentRef.current
    if (!activeSessionId || !viewport || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (canAutoScrollRef.current() && !isLoadingOlderMessagesRef.current) scrollToBottomImmediate()
    })
    observer.observe(viewport)
    observer.observe(content)
    return () => observer.disconnect()
  }, [activeSessionId, scrollToBottomImmediate])

  // ── Rail sync on mount ──────────────────────────────────────────
  React.useEffect(() => {
    requestAssistantRailSync()
  }, [requestAssistantRailSync])

  // ── Cleanup ─────────────────────────────────────────────────────
  React.useEffect(() => {
    return () => {
      if (initialTailReleaseFrameRef.current !== null) window.clearTimeout(initialTailReleaseFrameRef.current as unknown as number)
      if (scheduledAssistantRailSyncRef.current !== null) window.cancelAnimationFrame(scheduledAssistantRailSyncRef.current)
      if (highlightedMessageTimerRef.current !== null) window.clearTimeout(highlightedMessageTimerRef.current)
    }
  }, [])

  // ── Public scroll-to-bottom ─────────────────────────────────────
  const scrollToBottom = React.useCallback(() => {
    autoScrollModeRef.current = 'user'
    setIsAtBottom(true)
    scrollToBottomImmediate('smooth')
  }, [scrollToBottomImmediate])

  // ── Apply suggested prompt (delegated to scroll-utils) ─────────
  const applySuggestedPrompt = React.useCallback(applySuggestedPromptImpl, [])

  return {
    listRef,
    containerRef,
    virtualContentRef,
    rowVirtualizer: rowVirtualizer as any,
    isAtBottom,
    isLoadingOlderMessages,
    isPinnedTurnOverlayVisible,
    activeAssistantRailMessageIds,
    highlightedMessageId,
    handleListScroll,
    scrollToBottom,
    handleJumpToPinnedMessage,
    handleJumpToAssistantMessage,
    loadOlderMessages,
    requestAssistantRailSync,
    applySuggestedPrompt,
  }
}
