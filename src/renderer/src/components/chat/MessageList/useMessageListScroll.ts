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
  STREAMING_BOTTOM_FOLLOW_CHUNK,
  STREAMING_BOTTOM_FOLLOW_REFILL_AT,
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
  /** R-10.2: 执行中内容高度水位线——min-height 补齐，widget 收缩时高度只增不减。
   *  直写 DOM，不经 state，故不在这里回传。 */
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

  // ── R-10.2 执行中高度水位线 ──────────────────────────────────────
  // 执行中虚拟内容总高度可能随动态组件渲染收缩，贴底重算会让整个窗口跳。
  // 水位线取执行期间观测到的最大 totalSize，以 min-height 补在内容容器上：
  // 高度只增不减，收缩部分由底部留白顶住；执行结束立即收回（一次跳动可接受）。
  const contentHeightWatermarkRef = React.useRef(0)
  // 水位线**直写 DOM**，不走 React state。
  // 内容按渲染池 catch-up 的粒度增长时（单帧几百 px），水位线每帧都在抬；走 setState 就是
  // 每帧一次整棵消息树的 re-render —— 那本身就成了抖动的来源之一。
  // 只要 `minHeight` 不出现在 JSX 的 style 里，React 的 diff 就不会碰这个属性，手写的值留得住。
  const applyMinHeight = React.useCallback((height: number) => {
    const el = virtualContentRef.current
    if (el) el.style.minHeight = height > 0 ? `${height}px` : ''
  }, [])
  // 内容底 DOM 真值缓存（getRealContentBottom 的最近一次结果）。scroll 事件
  // 频率高，syncBottomState 用缓存判定即可，80px 阈值下毫秒级滞后无感。
  const realContentBottomRef = React.useRef(0)

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

  // ── R-10.2 三轮：DOM 地面真值 ────────────────────────────────────
  // 虚拟器 totalSize 是账面值（未测行按估算高计），流式期间尾行系统性偏小，
  // 不能当地面真值——d0eb6bdd 的教训。行是绝对定位 + translateY，offsetTop
  // 不含 transform，必须用 getBoundingClientRect 取各行真实底边的最大值，
  // 该值与 scrollTop 同坐标系，可直接参与贴底/悬空计算。
  const getRealContentBottom = React.useCallback((): number => {
    const content = virtualContentRef.current
    if (!content || content.children.length === 0) return 0
    const contentTop = content.getBoundingClientRect().top
    let bottom = 0
    for (const child of content.children) {
      const childBottom = (child as HTMLElement).getBoundingClientRect().bottom - contentTop
      if (childBottom > bottom) bottom = childBottom
    }
    return bottom
  }, [])

  const scrollToBottomImmediate = React.useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const ref = listRef.current
      if (!ref || rows.length === 0) return
      let bottom = Math.max(0, ref.scrollHeight - ref.clientHeight)
      if (contentHeightWatermarkRef.current > 0) {
        // R-10.2：水位线激活时地面真值用 DOM（getRealContentBottom），totalSize
        // 是账面值（未测行按估算计）不可用。
        const realBottom = getRealContentBottom()
        if (realBottom > 0) {
          realContentBottomRef.current = realBottom
          // 余量目标 = 视口底边应当停在内容底下方多远。
          // 上限取半屏：内容缩回去时视口最多漂到这么深，再深就纯是空白了。
          const gapCeiling =
            ref.clientHeight > 0 ? ref.clientHeight / 2 : Number.POSITIVE_INFINITY
          const gapTarget = Math.min(STREAMING_BOTTOM_FOLLOW_CHUNK, gapCeiling)
          // 悬空救援与跟随姿态共用一个目标：内容底之下留一整块余量。
          const followTarget = Math.max(0, realBottom + gapTarget - ref.clientHeight)
          if (ref.scrollTop > realBottom + 1) {
            // 整屏悬空（收缩使视口内零内容）：无条件救回跟随姿态，一次到位。
            markProgrammaticScroll()
            ref.scrollTop = followTarget
            return
          }
          // 余量双向跟随：太小（内容在长）→ 补；太大（内容在缩）→ 收回。
          // 两个方向都只回到 gapTarget，位移全部由 scrollTop 承担。
          //
          // 关键：**这一路绝不触碰 min-height**。缩 min-height 会让 scrollHeight 骤变，
          // 浏览器在同一帧把 scrollTop clamp 回去 —— 那一下就是回跳，收几次就跳几次。
          // 反过来只移视口，scrollHeight 纹丝不动，压根没有 clamp 可言。
          // 非钉底（用户在上方阅读）绝不拽。
          if (!canAutoScrollRef.current()) return
          // 提前量跟随（老大 2026-09-16 定）：视口底边先一步停在内容底下方 gapTarget 处，
          // 这段 gapTarget 就是「提前量」。内容长进提前量里时滚动条一动不动
          // （remaining 从 gapTarget 一路降到 REFILL_AT）；用尽那一刻再补满，垫出下一段。
          //
          // 与「攒着不滚」的区别就在滚动条停下时领先不领先：提前量恒为 0 才是攒着不滚，
          // 那样下一帧又得滚一下，等于没有缓冲。
          // 也不能无条件 followTarget（每帧都跟）—— 那样内容底位置是稳的，但滚动条每帧
          // 都在滑，观感是持续晃动。
          // 收缩由只增不减的水位线兜住，本函数只管「用尽 → 补满」。
          const remaining = ref.scrollTop + ref.clientHeight - realBottom
          if (remaining >= STREAMING_BOTTOM_FOLLOW_REFILL_AT && remaining <= gapCeiling) return
          bottom = followTarget
        }
      }
      // Already pinned: re-writing scrollTop would dispatch another scroll
      // event, whose handler sets state and re-runs the auto-scroll layout
      // effects — that cycle is what React reports as "Maximum update depth
      // exceeded".
      if (Math.abs(ref.scrollTop - bottom) <= 1) return
      markProgrammaticScroll()
      if (behavior === 'auto') {
        ref.scrollTop = bottom
        return
      }
      ref.scrollTo({ top: bottom, behavior })
    },
    [getRealContentBottom, markProgrammaticScroll, rows.length]
  )

  const syncBottomState = React.useCallback(() => {
    const ref = listRef.current
    if (!ref) return
    // R-10.2：水位线激活时 dist 对「真实内容底」算（可为负——跟随姿态视口
    // 底边低于内容底 GAP）。悬空（视口顶越过内容底、零内容可见）强制判
    // not atBottom：让「滚到底部」按钮出现，且不复活跟随模式——救援由
    // scrollToBottomImmediate 的悬空分支负责。
    if (contentHeightWatermarkRef.current > 0 && realContentBottomRef.current > 0) {
      const contentBottom = realContentBottomRef.current
      if (ref.scrollTop > contentBottom + 1) {
        lastScrollOffsetRef.current = ref.scrollTop
        setIsAtBottom((p) => (p === false ? p : false))
        return
      }
    }
    const dist =
      contentHeightWatermarkRef.current > 0 && realContentBottomRef.current > 0
        ? realContentBottomRef.current - (ref.scrollTop + ref.clientHeight)
        : getDistanceToBottom(ref)
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

  // 探针要从 rAF 里读 totalSize，而每帧 render 都会换掉 rowVirtualizer 的对象引用；
  // 直接写进依赖会让 rAF 每帧被取消重启、采不到样本，所以过一层 ref。
  const virtualizerRef = React.useRef(rowVirtualizer)
  virtualizerRef.current = rowVirtualizer

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
    // R-10.2: 水位线不跨会话残留
    contentHeightWatermarkRef.current = 0
    realContentBottomRef.current = 0
    applyMinHeight(0)
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
    // iter-30 S-31/S-32 水位线：min-height 只增不减。
    //
    // 作用只有一个 —— 撑住 scrollHeight，挡住「内容收缩 ⇒ scrollHeight 骤减 ⇒ 浏览器
    // clamp scrollTop」这条链路。只要水位线不降，就没有 clamp，也就没有回跳。
    //
    // 留白被内容收缩撑得很大怎么办？—— 不在这里解决。2026-09-16 晚试过「超半屏就收
    // min-height」并加节流，结果跳得更凶：收 min-height 本身就是制造 scrollHeight 骤减，
    // 节流只是把攒了几百 px 的位移合并成一次更大的跳。
    // 正解在 scrollToBottomImmediate 的双向跟随：scrollHeight 纹丝不动，只把视口拉回
    // 内容底附近。用户看到的留白始终是基准值；水位线多撑出来的那部分在视口之外，
    // 看不见，也就无所谓它多大。
    if (isSessionOutputting) {
      const realBottom = getRealContentBottom()
      if (realBottom > 0) {
        // 补给量上限取半屏：视口矮的时候 CHUNK(240) 可能不止半屏，撑个比视口还深的坑没意义。
        const viewportHeight = listRef.current?.clientHeight ?? 0
        const gapCeiling = viewportHeight > 0 ? viewportHeight / 2 : Number.POSITIVE_INFINITY
        const gapTarget = Math.min(STREAMING_BOTTOM_FOLLOW_CHUNK, gapCeiling)

        const hasWatermark = contentHeightWatermarkRef.current > 0
        const gap = hasWatermark ? contentHeightWatermarkRef.current - realBottom : 0

        if (!hasWatermark || gap < STREAMING_BOTTOM_FOLLOW_REFILL_AT) {
          const needed = realBottom + gapTarget
          // 只增不减：needed 没超过当前水位线就什么都不做。
          if (needed > contentHeightWatermarkRef.current) {
            contentHeightWatermarkRef.current = needed
            applyMinHeight(needed)
          }
        }
        realContentBottomRef.current = realBottom
      }
    } else if (contentHeightWatermarkRef.current !== 0) {
      // iter-30 S-32：撤留白之前，先把视口对齐到「真实内容底」。
      // 旧实现在这里直接清 0，可 DOM 的 min-height 要等下一次提交才撤——于是
      // 同帧的 scrollToBottomImmediate 会按「含留白」的 scrollHeight 把视口推到
      // 底，下一帧留白消失、scrollHeight 骤减，浏览器又把 scrollTop clamp 回来。
      // 一推一弹，正是那次最难受的回跳。
      // 先落到真底：撤销 min-height 之后它仍是合法位置，撤销帧不再产生任何位移，
      // 而 GAP 姿态收掉的 80px 也退化成一次单向、可预期的贴底动作。
      const ref = listRef.current
      const realBottom = getRealContentBottom()
      if (ref && realBottom > 0) {
        const target = Math.max(0, realBottom - ref.clientHeight)
        if (Math.abs(ref.scrollTop - target) > 1) {
          markProgrammaticScroll()
          ref.scrollTop = target
        }
      }
      contentHeightWatermarkRef.current = 0
      realContentBottomRef.current = realBottom
      applyMinHeight(0)
      return
    }
    if (contentHeightWatermarkRef.current > 0) {
      // 水位线激活：贴底跟随（GAP 姿态、只推不拽、钉底门控）与整屏悬空
      // 救援都统一在 scrollToBottomImmediate 内处理，无论钉底与否都执行——
      // 悬空救援不能被 !canAutoScroll 门挡住。
      scrollToBottomImmediate()
      return
    }
    if (!canAutoScroll() && !isAtBottom) return
    scrollToBottomImmediate()
  }, [canAutoScroll, getRealContentBottom, isAtBottom, isSessionOutputting, scrollToBottomImmediate, virtualListTotalSize])

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
