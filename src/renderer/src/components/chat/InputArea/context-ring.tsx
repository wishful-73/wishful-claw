// Context ring: circular progress indicator for context window usage

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Archive, ChevronDown, Loader2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import { Slider } from '@renderer/components/ui/slider'
import { useChatStore } from '@renderer/stores/chat-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { formatTokens } from '@renderer/lib/format-tokens'
import {
  SESSION_COMPRESSION_THRESHOLD_STEP,
  applySessionContextCap,
  getCompressionTriggerTokens,
  getEffectiveContextWindow,
  resolveCompressionContextLength,
  resolveCompressionReservedOutputBudget,
  resolveSessionCompressionThreshold,
  resolveSessionContextCapRange,
  resolveSessionContextCapTokens
} from '@renderer/lib/agent/context-compression'
import { cn } from '@renderer/lib/utils'
import { useActiveModelConfig } from './use-active-model-config'
import type { ContextRingProps } from './types'

// 鼠标移入环到面板展开之间的延迟：400ms 是「扫过去」与「想看一眼」的分界，
// 与提交列表的 HoverCard（branch-panel / GitPage）取同一个值。
const RING_PANEL_OPEN_DELAY_MS = 400

// 压缩阈值滑条按百分点走（30~90），与 `Settings → 运行时` 那个全局滑条同量程同口径；
// 存回会话时再除以 100。用百分比整数是为了让滑条落在整齐的刻度上。
const THRESHOLD_SLIDER_MIN = 30
const THRESHOLD_SLIDER_MAX = 90

function formatThresholdPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

export function ContextRing({
  sessionId,
  onCompressContext,
  isCompressing = false
}: ContextRingProps): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const activeSession = useChatStore((s) => {
    if (!sessionId) return null
    const idx = s.sessionsById[sessionId]
    return idx !== undefined ? (s.sessions[idx] ?? null) : null
  })
  const contextCompressionThreshold = useSettingsStore((s) => s.contextCompressionThreshold)
  const updateSessionContextCap = useChatStore((s) => s.updateSessionContextCap)
  const updateSessionCompressionThreshold = useChatStore(
    (s) => s.updateSessionCompressionThreshold
  )

  // 会话级「压缩阈值」（iter-32 S-85）：会话设过就用会话的，否则用全局的。
  // 0 表示没设过 —— 那条「跟随全局」还原路径靠它。
  const sessionThreshold = activeSession?.compressionThreshold ?? 0
  const thresholdIsSession = sessionThreshold > 0
  const effectiveThreshold = resolveSessionCompressionThreshold(
    sessionThreshold,
    contextCompressionThreshold
  )

  const activeModelCfg = useActiveModelConfig(activeSession)
  const compressionConfig = activeModelCfg
    ? {
        enabled: true,
        // 会话设了「请求上下文上限」时，显示与触发都按 min(真实窗口, 上限) 算
        // （iter-32 S-73/S-84）。上限只在它当初被设置的那个模型上生效。
        contextLength: applySessionContextCap(
          resolveCompressionContextLength(activeModelCfg),
          resolveSessionContextCapTokens({
            capTokens: activeSession?.contextCapTokens,
            capModelId: activeSession?.contextCapModelId,
            currentModelId: activeModelCfg.id
          })
        ),
        threshold: effectiveThreshold,
        preCompressThreshold: 0.65,
        reservedOutputBudget: resolveCompressionReservedOutputBudget(activeModelCfg)
      }
    : null

  const sessionKey = sessionId ?? ''
  const latestUsage = React.useMemo(() => {
    if (!activeSession?.messagesLoaded) return null
    for (let index = activeSession.messages.length - 1; index >= 0; index -= 1) {
      const message = activeSession.messages[index]
      const contextTokens = message?.usage?.contextTokens ?? 0
      if (contextTokens > 0) {
        return {
          messageId: message.id,
          contextTokens
        }
      }
    }
    return null
  }, [activeSession?.messages, activeSession?.messagesLoaded])
  const contextUsageBaselineRef = React.useRef<{
    sessionId: string
    initialized: boolean
    messageId: string | null
    contextTokens: number
  }>({ sessionId: '', initialized: false, messageId: null, contextTokens: 0 })
  const [hasFreshContextUsage, setHasFreshContextUsage] = React.useState(false)

  React.useEffect(() => {
    let baseline = contextUsageBaselineRef.current
    if (baseline.sessionId !== sessionKey) {
      baseline = {
        sessionId: sessionKey,
        initialized: false,
        messageId: null,
        contextTokens: 0
      }
      contextUsageBaselineRef.current = baseline
      setHasFreshContextUsage(false)
    }
    if (!activeSession?.messagesLoaded) return

    if (!baseline.initialized) {
      contextUsageBaselineRef.current = {
        sessionId: sessionKey,
        initialized: true,
        messageId: latestUsage?.messageId ?? null,
        contextTokens: latestUsage?.contextTokens ?? 0
      }
      setHasFreshContextUsage(Boolean(latestUsage))
      return
    }

    if (
      latestUsage &&
      (latestUsage.messageId !== baseline.messageId ||
        latestUsage.contextTokens !== baseline.contextTokens)
    ) {
      setHasFreshContextUsage(true)
    }
  }, [activeSession?.messagesLoaded, latestUsage, sessionKey])

  const [ctxUsedRaw, ctxLimitRaw] = useStoreWithEqualityFn(
    useChatStore,
    React.useCallback(
      (s): [number, number | null] => {
        if (!sessionId) return [0, null]
        const idx = s.sessionsById[sessionId]
        const activeSession = idx !== undefined ? s.sessions[idx] : undefined
        if (!activeSession) return [0, null]
        const messages = activeSession.messages
        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index]
          const usage = message?.usage
          if (!usage) continue
          const contextTokens = usage.contextTokens ?? 0
          if (contextTokens <= 0) continue
          return [contextTokens, usage.contextLength ?? null]
        }
        return [0, null]
      },
      [sessionId]
    ),
    (a, b) => a[0] === b[0] && a[1] === b[1]
  )

  // —— 面板开合（iter-32 S-84）——
  // 鼠标移入环、或单击环，都只是「把它打开」：面板一旦展开就常在，不会因为鼠标移开而收起。
  // 收起的路径有三条 —— 点面板外（失焦）、Esc、面板右上角那个收起图标。
  // 常在这一条是必需的：面板里要拖滑杆，若移开即关，鼠标拖到量程两端时人就先丢了面板。
  const [panelOpen, setPanelOpen] = React.useState(false)
  const panelOpenTimerRef = React.useRef<number | null>(null)

  const clearPanelOpenTimer = React.useCallback((): void => {
    if (panelOpenTimerRef.current !== null) {
      window.clearTimeout(panelOpenTimerRef.current)
      panelOpenTimerRef.current = null
    }
  }, [])

  React.useEffect(() => clearPanelOpenTimer, [clearPanelOpenTimer])

  // 打开留一点延迟：鼠标扫过工具栏时不该弹面板。
  const schedulePanelOpen = React.useCallback((): void => {
    if (panelOpen) return
    clearPanelOpenTimer()
    panelOpenTimerRef.current = window.setTimeout(() => {
      panelOpenTimerRef.current = null
      setPanelOpen(true)
    }, RING_PANEL_OPEN_DELAY_MS)
  }, [clearPanelOpenTimer, panelOpen])

  // Radix 自己会在 trigger 的 onClick 上 toggle，这里接管开合，所以先 preventDefault。
  const handlePanelToggle = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    clearPanelOpenTimer()
    setPanelOpen((open) => !open)
  }

  const handlePanelOpenChange = (next: boolean): void => {
    clearPanelOpenTimer()
    setPanelOpen(next)
  }

  const closePanel = (): void => {
    clearPanelOpenTimer()
    setPanelOpen(false)
  }

  if (!sessionId || !activeSession) return null

  const ctxUsed = ctxUsedRaw
  const ctxLimit = ctxLimitRaw ?? compressionConfig?.contextLength ?? null
  const ctxGaugeLimit = compressionConfig ? getEffectiveContextWindow(compressionConfig) : ctxLimit
  const isCurrentSessionUsageFresh =
    contextUsageBaselineRef.current.sessionId === sessionKey && hasFreshContextUsage

  if (!ctxGaugeLimit || !isCurrentSessionUsageFresh) return null

  const pct = Math.min((ctxUsed / ctxGaugeLimit) * 100, 100)
  const strokeColor =
    pct > 80 ? 'stroke-red-500' : pct > 50 ? 'stroke-amber-500' : 'stroke-emerald-500'
  const fillColor = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-amber-500' : 'bg-emerald-500'
  const canCompress = Boolean(onCompressContext) && !isCompressing
  const triggerTokens = compressionConfig ? getCompressionTriggerTokens(compressionConfig) : 0
  // 有效窗口比模型窗口小，差的就是这个数（给回复留的座位）。绝大多数模型是 20K，
  // 少数输出上限本来就小的（档案 maxOutputTokens 写 4096 / 1000 的）跟着变小。
  const reservedOutputBudget = resolveCompressionReservedOutputBudget(activeModelCfg)

  // 上限只在窗口比下限更大的模型上才有得调；模型窗口本身 ≤200K 时这块不渲染，
  // 面板退化成纯用量 + 压缩（与「上限」引入前一致）。
  const capModelId = activeModelCfg?.id ?? null
  const capRange = activeModelCfg
    ? resolveSessionContextCapRange(resolveCompressionContextLength(activeModelCfg))
    : null
  const capTokens = resolveSessionContextCapTokens({
    capTokens: activeSession.contextCapTokens,
    capModelId: activeSession.contextCapModelId,
    currentModelId: capModelId
  })
  const isCapped = capTokens > 0
  // 未设上限时滑杆停在最右端 —— 「模型最大窗口」与「不限制」本来就是同一个状态。
  const capSliderValue =
    capRange === null
      ? 0
      : isCapped
        ? Math.min(Math.max(capTokens, capRange.min), capRange.max)
        : capRange.max

  // SVG circular progress
  const size = 26
  const strokeWidth = 2.5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - pct / 100)

  return (
    <Popover open={panelOpen} onOpenChange={handlePanelOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('input.panelTitle', { defaultValue: 'Context usage' })}
          className={cn(
            // size-8：与同排其它图标控件（Button size="icon-sm"）同一个盒子，
            // 否则 26px 的环和 32px 的按钮中心点对不齐（iter-32 S-84）。
            'flex size-8 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring',
            isCompressing && 'opacity-70'
          )}
          onClick={handlePanelToggle}
          onMouseEnter={schedulePanelOpen}
          onMouseDown={(event) => {
            event.preventDefault()
          }}
        >
          <div className="relative flex size-[26px] shrink-0 items-center justify-center">
            <svg width={size} height={size} className="-rotate-90">
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                className="stroke-muted/30"
                strokeWidth={strokeWidth}
              />
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                className={`${strokeColor} transition-all duration-500`}
                strokeWidth={strokeWidth}
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                strokeLinecap="round"
              />
            </svg>
            <span className="absolute text-[7px] font-medium text-muted-foreground tabular-nums select-none">
              {pct.toFixed(0)}%
            </span>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent
        // 正上方：align=center 让面板以环为中心向两侧展开。环在工具栏右侧组，
        // 面板会比环宽得多，靠 collisionPadding 兜住不越出视口。
        align="center"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        className="w-72 p-3"
      >
        {/* 用量 */}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold text-foreground">
            {t('input.panelTitle', { defaultValue: 'Context usage' })}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <span className="text-xs font-semibold tabular-nums text-foreground">
              {formatTokens(ctxUsed)} / {formatTokens(ctxGaugeLimit)}
            </span>
            <button
              type="button"
              onClick={closePanel}
              title={t('input.panelCollapse', { defaultValue: 'Collapse' })}
              aria-label={t('input.panelCollapse', { defaultValue: 'Collapse' })}
              className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
            >
              <ChevronDown className="size-3.5" />
            </button>
          </div>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', fillColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="tabular-nums">{pct.toFixed(1)}%</span>
          {/* 输出预留与压缩线都是次要信息，挤在百分比同一行，整块只占一行。
              两者判据各自独立：预留算出来是 0（模型 maxOutputTokens 很小）时压缩线照样显示，反之亦然。 */}
          <span className="flex flex-wrap items-center justify-end gap-x-1.5 tabular-nums">
            {reservedOutputBudget > 0 && (
              <span>
                {t('input.outputReserved', {
                  tokens: formatTokens(reservedOutputBudget),
                  defaultValue: '{{tokens}} reserved for output'
                })}
              </span>
            )}
            {reservedOutputBudget > 0 && triggerTokens > 0 && <span aria-hidden>·</span>}
            {triggerTokens > 0 && (
              <span>
                {t('input.compressionTriggersAt', {
                  tokens: formatTokens(triggerTokens),
                  defaultValue: 'auto-compress at {{tokens}}'
                })}
              </span>
            )}
          </span>
        </div>

        {/* 请求上下文上限 */}
        {capRange !== null && capModelId !== null && (
          <div className="mt-3 border-t border-border/60 pt-3">
            <div className="flex items-end justify-between gap-3">
              <span className="text-xs font-semibold text-foreground">
                {t('input.contextCapTitle', { defaultValue: 'Request context limit' })}
              </span>
              <span className="text-xs font-semibold tabular-nums text-foreground">
                {isCapped
                  ? formatTokens(capTokens)
                  : t('input.contextCapUnlimited', { defaultValue: 'Model max' })}
              </span>
            </div>
            <Slider
              className="mt-3"
              min={capRange.min}
              max={capRange.max}
              step={capRange.step}
              value={[capSliderValue]}
              onValueChange={(next) => {
                const tokens = next[0]
                if (tokens === undefined) return
                updateSessionContextCap(sessionId, tokens, capModelId)
              }}
              aria-label={t('input.contextCapTitle', { defaultValue: 'Request context limit' })}
            />
            <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
              <span className="tabular-nums">{formatTokens(capRange.min)}</span>
              <span className="tabular-nums">{formatTokens(capRange.max)}</span>
            </div>
            {/* 上限是「每次请求最多带多少上下文」的天花板，方向单一，所以成本提示放这里。
                注意这是**方向性**提示、不是绝对结论：对话本身就短于上限时，设多低都一样。 */}
            <p className="mt-1 text-[10px] text-muted-foreground">
              {t('input.contextCapHint', {
                defaultValue: 'Lower limit, lower cost'
              })}
            </p>
          </div>
        )}

        {/* 压缩阈值：会话级覆盖，没设过就用全局的 */}
        <div className="mt-3 border-t border-border/60 pt-3">
          <div className="flex items-end justify-between gap-3">
            <span className="text-xs font-semibold text-foreground">
              {t('input.compressionThresholdTitle', { defaultValue: 'Compression threshold' })}
            </span>
            <span className="text-xs font-semibold tabular-nums text-foreground">
              {thresholdIsSession
                ? formatThresholdPercent(effectiveThreshold)
                : t('input.compressionThresholdFollow', {
                    percent: formatThresholdPercent(effectiveThreshold),
                    defaultValue: 'Global {{percent}}'
                  })}
            </span>
          </div>
          <Slider
            className="mt-3"
            min={THRESHOLD_SLIDER_MIN}
            max={THRESHOLD_SLIDER_MAX}
            step={Math.round(SESSION_COMPRESSION_THRESHOLD_STEP * 100)}
            value={[Math.round(effectiveThreshold * 100)]}
            onValueChange={(next) => {
              const percent = next[0]
              if (percent === undefined) return
              updateSessionCompressionThreshold(sessionId, percent / 100)
            }}
            aria-label={t('input.compressionThresholdTitle', { defaultValue: 'Compression threshold' })}
          />
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span className="tabular-nums">{THRESHOLD_SLIDER_MIN}%</span>
            <span className="tabular-nums">{THRESHOLD_SLIDER_MAX}%</span>
          </div>
          {/* 会话覆盖的还原出口。「跟随全局」是滑条量程（30~90%）之外的哨兵值 0 ——
              没有这个按钮，用户只要拖过一次就再也回不到跟随全局了。 */}
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              disabled={!thresholdIsSession}
              onClick={() => updateSessionCompressionThreshold(sessionId, 0)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] transition-colors',
                thresholdIsSession ? 'text-primary hover:bg-primary/10' : 'text-muted-foreground/50'
              )}
            >
              {t('input.compressionThresholdUseGlobal', { defaultValue: 'Follow global' })}
            </button>
          </div>
        </div>

        {/* 压缩：先落盘已产出的内容，再压上下文 */}
        <button
          type="button"
          disabled={!canCompress}
          onClick={() => onCompressContext?.()}
          className={cn(
            'mt-3 flex w-full items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            canCompress
              ? 'bg-muted/60 text-foreground hover:bg-muted'
              : 'cursor-default bg-muted/30 text-muted-foreground'
          )}
        >
          {isCompressing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Archive className="size-3.5" />
          )}
          {isCompressing
            ? t('input.compressingContext', { defaultValue: 'Compressing context...' })
            : t('input.compressContextNow', { defaultValue: 'Compress context now' })}
        </button>
      </PopoverContent>
    </Popover>
  )
}
