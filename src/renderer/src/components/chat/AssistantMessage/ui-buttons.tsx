// Small reusable UI button and indicator components

import * as React from 'react'
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Copy, Check, ChevronDown, ChevronRight, Bug, Loader2, CheckCircle2, XCircle
} from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { readSidecarDebugBody } from '@renderer/lib/ipc/agent-bridge'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle
} from '@renderer/components/ui/dialog'
import type { RequestDebugInfo } from '@renderer/lib/api/types'
import { getLiveOutputShimmerClass } from '@renderer/lib/live-output-animation'
import type { ModelThinkingIndicatorProps } from './types'
import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { MONO_FONT } from '@renderer/lib/constants'
import { LazySyntaxHighlighter } from '../LazySyntaxHighlighter'

export function DebugToggleButton({
  debugInfo,
  sessionId
}: {
  debugInfo: RequestDebugInfo
  sessionId?: string | null
}): React.JSX.Element {
  const [show, setShow] = useState(false)
  const [bodyText, setBodyText] = useState<string | null>(null)
  const [bodyLoading, setBodyLoading] = useState(false)
  const [bodyLoadError, setBodyLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!show) {
      setBodyText(null)
      setBodyLoading(false)
      setBodyLoadError(null)
      return
    }

    let cancelled = false
    setBodyLoadError(null)

    if (debugInfo.body) {
      setBodyText(debugInfo.body)
      setBodyLoading(false)
      return
    }

    setBodyText(null)
    if (!debugInfo.bodyRef && !sessionId) {
      setBodyLoading(false)
      return
    }

    setBodyLoading(true)
    readSidecarDebugBody({ bodyRef: debugInfo.bodyRef, sessionId })
      .then((body) => {
        if (!cancelled) {
          setBodyText(body)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setBodyLoadError(error instanceof Error ? error.message : 'Debug body is unavailable')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBodyLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [debugInfo.body, debugInfo.bodyRef, sessionId, show])

  const bodyFormatted = (() => {
    if (!bodyText) return null
    try {
      return JSON.stringify(JSON.parse(bodyText), null, 2)
    } catch {
      return bodyText
    }
  })()

  return (
    <>
      <button
        type="button"
        onClick={() => setShow(true)}
        aria-label="Debug"
        title="Debug"
        className={`flex items-center gap-1 rounded px-1 py-0.5 text-[11px] transition-colors ${show ? 'bg-orange-500/10 text-orange-500' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'}`}
      >
        <Bug className="size-3.5" />
        <span>Debug</span>
      </button>
      <Dialog open={show} onOpenChange={setShow}>
        <DialogContent className="flex max-h-[80vh] max-w-[90vw] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b bg-muted/30 px-4 py-2.5 pr-10 text-left">
            <DialogTitle className="flex items-center gap-2 text-xs font-medium">
              <Bug className="size-3.5 text-orange-500" />
              <span>Request Debug</span>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto">
            <div
              className="space-y-1.5 border-b px-4 py-2 text-[11px]"
              style={{ fontFamily: MONO_FONT }}
            >
              <div className="flex gap-2">
                <span className="text-muted-foreground/60 shrink-0">URL</span>
                <span className="text-foreground break-all">{debugInfo.url}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground/60 shrink-0">Method</span>
                <span className="text-foreground">{debugInfo.method}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-muted-foreground/60 shrink-0">Time</span>
                <span className="text-foreground">
                  {new Date(debugInfo.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between border-b bg-muted/20 px-4 py-1.5">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Request Body
                </span>
                {bodyFormatted ? <CopyButton text={bodyFormatted} /> : null}
              </div>
              {bodyFormatted ? (
                <LazySyntaxHighlighter
                  language="json"
                  customStyle={{
                    margin: 0,
                    padding: '12px 16px',
                    fontSize: '11px',
                    fontFamily: MONO_FONT,
                    background: 'transparent',
                    wordBreak: 'break-all',
                    whiteSpace: 'pre-wrap'
                  }}
                  codeTagProps={{ style: { fontFamily: MONO_FONT } }}
                >
                  {bodyFormatted}
                </LazySyntaxHighlighter>
              ) : (
                <div className="px-4 py-3 text-[11px] text-muted-foreground">
                  {bodyLoading
                    ? 'Loading request body...'
                    : (bodyLoadError ?? 'Request body is unavailable')}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function CopyButton({ text }: { text: string }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text])

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? t('userMessage.copied') : t('action.copy', { ns: 'common' })}
    </button>
  )
}

export function ActionIconButton({
  label,
  icon,
  onClick,
  danger = false,
  disabled = false
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          className={`flex size-7 items-center justify-center rounded-md border border-border/50 bg-background/90 text-muted-foreground transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50 ${danger ? 'hover:text-destructive' : 'hover:text-accent-foreground'}`}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}

export function GenerationProcessLine({
  active,
  label,
  detail,
  expanded,
  collapsible = false,
  failedCount = 0,
  failedLabel,
  onClick
}: {
  active: boolean
  label: string
  detail?: string | null
  expanded?: boolean
  collapsible?: boolean
  /** S-271：run 内失败项数。> 0 时图标变红并出红色徽章 —— 失败不再靠「把卡拎到面板外」提示。 */
  failedCount?: number
  failedLabel?: string
  onClick?: () => void
}): React.JSX.Element {
  const hasFailure = failedCount > 0
  const content = (
    <>
      <span
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border bg-transparent',
          active
            ? 'border-sky-500/25 text-sky-600 dark:text-sky-300'
            : hasFailure
              ? 'border-destructive/30 text-destructive'
              : 'border-lime-500/25 text-lime-600 dark:text-lime-400'
        )}
      >
        {active ? (
          <Loader2 className="size-3 animate-spin" />
        ) : hasFailure ? (
          <XCircle className="size-3" />
        ) : (
          <CheckCircle2 className="size-3" />
        )}
      </span>
      <span className="shrink-0 font-mono font-medium text-foreground/82">{label}</span>
      {detail ? (
        <span className="min-w-0 flex-1 truncate text-muted-foreground/60">({detail})</span>
      ) : (
        <span className="min-w-0 flex-1" />
      )}
      {hasFailure && failedLabel ? (
        <span className="shrink-0 rounded-full bg-destructive/10 px-1.5 py-px text-[11px] font-medium text-destructive">
          {failedLabel}
        </span>
      ) : null}
      {collapsible ? (
        expanded ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
        ) : (
          <ChevronRight className="size-3 shrink-0 text-muted-foreground/60 transition-colors group-hover:text-foreground" />
        )
      ) : null}
    </>
  )

  const className =
    'group flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/35 hover:text-foreground dark:hover:bg-white/[0.035]'

  if (collapsible) {
    return (
      <button type="button" onClick={onClick} aria-expanded={expanded} className={className}>
        {content}
      </button>
    )
  }

  return <div className={className}>{content}</div>
}

export function ModelThinkingIndicator({
  modelName,
  label
}: ModelThinkingIndicatorProps): React.JSX.Element {
  const liveOutputAnimationStyle = useSettingsStore((s) => s.liveOutputAnimationStyle)
  const statusLabel = modelName ? `${modelName} ${label}` : label

  return (
    <div className="pending-assistant-status" role="status" aria-label={statusLabel}>
      <span
        className={`pending-assistant-label ${getLiveOutputShimmerClass(liveOutputAnimationStyle)}`}
      >
        {label}
      </span>
    </div>
  )
}

