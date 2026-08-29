// Context ring: circular progress indicator for context window usage

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreWithEqualityFn } from 'zustand/traditional'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useChatStore } from '@renderer/stores/chat-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { useChannelStore } from '@renderer/stores/channel-store'
import { useProviderStore } from '@renderer/stores/provider-store'
import { useUIStore } from '@renderer/stores/ui-store'
import type { AIModelConfig } from '@renderer/lib/api/types'
import { formatTokens } from '@renderer/lib/format-tokens'
import {
  getEffectiveContextWindow,
  resolveCompressionContextLength,
  resolveCompressionReservedOutputBudget,
  resolveCompressionThreshold
} from '@renderer/lib/agent/context-compression'
import { resolveSessionModelSelection } from '@renderer/lib/session-model-resolution'
import { cn } from '@renderer/lib/utils'
import type { ContextRingProps } from './types'

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
  const mainModelSelectionMode = useSettingsStore((s) => s.mainModelSelectionMode)
  const contextCompressionThreshold = useSettingsStore((s) => s.contextCompressionThreshold)
  const channels = useChannelStore((s) => s.channels)
  const autoSelection = useUIStore((s) =>
    activeSession ? (s.autoModelSelectionsBySession[activeSession.id] ?? null) : null
  )

  const activeModelCfg = useProviderStore((s) => {
    const activeChannel = activeSession?.pluginId
      ? (channels.find((item) => item.id === activeSession.pluginId) ?? null)
      : null
    const selection = resolveSessionModelSelection({
      session: activeSession,
      providers: s.providers,
      activeProviderId: s.activeProviderId,
      activeModelId: s.activeModelId,
      globalMode: mainModelSelectionMode,
      channelProviderId: activeChannel?.providerId,
      channelModelId: activeChannel?.model
    })
    const providerId =
      selection.isAutoModeActive && autoSelection?.providerId
        ? autoSelection.providerId
        : selection.providerId
    const modelId =
      selection.isAutoModeActive && autoSelection?.modelId
        ? autoSelection.modelId
        : selection.modelId
    if (!providerId || !modelId) return null
    const provider = s.providers.find((p: any) => p.id === providerId)
    return provider?.models.find((m: any) => m.id === modelId) ?? null
  }) as AIModelConfig | null
  const compressionConfig = activeModelCfg
    ? {
        enabled: true,
        contextLength: resolveCompressionContextLength(activeModelCfg),
        threshold: resolveCompressionThreshold(contextCompressionThreshold),
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
      setHasFreshContextUsage(false)
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

  if (!sessionId || !activeSession) return null

  const ctxUsed = ctxUsedRaw
  const ctxLimit = ctxLimitRaw ?? compressionConfig?.contextLength ?? null
  const ctxGaugeLimit = compressionConfig ? getEffectiveContextWindow(compressionConfig) : ctxLimit
  const isCurrentSessionUsageFresh =
    contextUsageBaselineRef.current.sessionId === sessionKey && hasFreshContextUsage

  if (!ctxGaugeLimit || !isCurrentSessionUsageFresh) return null

  const pct = Math.min((ctxUsed / ctxGaugeLimit) * 100, 100)
  const remaining = Math.max(ctxGaugeLimit - ctxUsed, 0)
  const strokeColor =
    pct > 80 ? 'stroke-red-500' : pct > 50 ? 'stroke-amber-500' : 'stroke-emerald-500'
  const canCompress = Boolean(onCompressContext) && !isCompressing
  const handleDoubleClick = (event: React.MouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    if (!canCompress) return
    onCompressContext?.()
  }

  // SVG circular progress
  const size = 26
  const strokeWidth = 2.5
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - pct / 100)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-disabled={!canCompress}
          aria-label={t('input.doubleClickCompressContext', {
            defaultValue: 'Double-click to compress context'
          })}
          className={cn(
            'flex items-center justify-center rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring',
            canCompress ? 'cursor-pointer' : 'cursor-default',
            isCompressing && 'opacity-70'
          )}
          onDoubleClick={handleDoubleClick}
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
              {isCurrentSessionUsageFresh && (
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
              )}
            </svg>
            {isCurrentSessionUsageFresh && (
              <span className="absolute text-[7px] font-medium text-muted-foreground tabular-nums select-none">
                {pct.toFixed(0)}%
              </span>
            )}
          </div>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <div className="text-xs space-y-0.5">
          <p className="font-medium">{t('input.compressionBudget')}</p>
          <p className="text-muted-foreground">
            {formatTokens(ctxUsed)} / {formatTokens(ctxGaugeLimit)} ({pct.toFixed(1)}%)
          </p>
          <p className="text-muted-foreground">
            {formatTokens(remaining)} {t('input.remaining')}
          </p>
          {onCompressContext && (
            <p className="text-muted-foreground">
              {isCompressing
                ? t('input.compressingContext', { defaultValue: 'Compressing context...' })
                : t('input.doubleClickCompressContext', {
                    defaultValue: 'Double-click to compress context'
                  })}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
