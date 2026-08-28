// Bottom action bar for AssistantMessage: copy, fork, translate, speak, share, retry, delete, etc.

import * as React from 'react'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import {
  Copy, ChevronsDownUp, ChevronsUpDown, RotateCcw, Play, Ellipsis,
  Languages, Volume2, Share2, GitFork, Trash2
} from 'lucide-react'
import type { RequestDebugInfo } from '@renderer/lib/api/types'
import type { MemoryRecallInfo } from '@renderer/stores/chat-store/types'
import { useUIStore } from '@renderer/stores/ui-store'
import { useTranslateStore } from '@renderer/stores/translate-store'
import { useChatStore } from '@renderer/stores/chat-store'
import type { CompletionSummaryData } from './types'
import { CompletionSummaryBar } from './token-summary'
import { ActionIconButton, DebugToggleButton } from './ui-buttons'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'

export interface ActionBarProps {
  isStreaming: boolean
  plainText: string
  isLiveMode: boolean
  sessionId?: string | null
  msgId?: string
  createdAt?: number
  showRetry?: boolean
  showContinue?: boolean
  onRetry?: (messageId: string) => void
  onContinue?: () => void
  onDelete?: (messageId: string) => void
  devMode: boolean
  debugInfo?: RequestDebugInfo
  collapsed: boolean
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  renderMode: string
  renderContent: () => React.JSX.Element
  completionSummary: CompletionSummaryData | null
  t: (key: string, options?: Record<string, unknown>) => string
  preToolPhase?: boolean
  memoryRecall?: MemoryRecallInfo
}

export function AssistantActionBar({
  isStreaming,
  plainText,
  isLiveMode,
  sessionId,
  msgId,
  showRetry,
  showContinue,
  onRetry,
  onContinue,
  onDelete,
  devMode,
  debugInfo,
  collapsed,
  setCollapsed,
  renderMode,
  renderContent,
  completionSummary,
  createdAt,
  t,
  preToolPhase
}: ActionBarProps): React.JSX.Element {
  const openTranslatePage = useUIStore((s) => s.openTranslatePage)
  const navigateToSession = useUIStore((s) => s.navigateToSession)
  const setTranslateSourceText = useTranslateStore((s) => s.setSourceText)
  const forkSessionFromMessage = useChatStore((s) => s.forkSessionFromMessage)
  const [forking, setForking] = useState(false)

  const handleCopy = useCallback((): void => {
    if (!plainText) return
    navigator.clipboard.writeText(plainText)
  }, [plainText])

  const handleTranslate = useCallback((): void => {
    const text = plainText.trim()
    if (!text) return
    setTranslateSourceText(text)
    openTranslatePage()
    toast.success(t('messageActions.sentToTranslator'))
  }, [openTranslatePage, plainText, setTranslateSourceText, t])

  const handleSpeak = useCallback((): void => {
    const text = plainText.trim()
    if (!text) return
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast.error(t('messageActions.speechNotSupported'))
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en-US'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }, [plainText, t])

  const handleShare = useCallback(async (): Promise<void> => {
    const text = plainText.trim()
    if (!text) return
    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
      await navigator.clipboard.writeText(text)
      toast.success(t('messageActions.copiedForShare'))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.error(t('messageActions.shareFailed'))
    }
  }, [plainText, t])

  const handleFork = useCallback(async (): Promise<void> => {
    if (!sessionId || !msgId || forking) return

    setForking(true)
    try {
      const forkedSessionId = await forkSessionFromMessage?.(sessionId, msgId) ?? null
      if (!forkedSessionId) {
        toast.error(t('messageActions.forkFailed'))
        return
      }

      navigateToSession(forkedSessionId)
      toast.success(t('messageActions.forked'))
    } catch (error) {
      console.error('[AssistantMessage] Failed to fork session:', error)
      toast.error(t('messageActions.forkFailed'))
    } finally {
      setForking(false)
    }
  }, [forkSessionFromMessage, forking, msgId, navigateToSession, sessionId, t])

  const handleDeleteAndRegenerate = useCallback((): void => {
    if (!showRetry || !onRetry || !msgId) return
    onRetry(msgId)
  }, [msgId, onRetry, showRetry])

  return (
    <div className="group/msg flex flex-col">
      <div className="min-w-0 overflow-hidden pl-1.5 sm:pl-2">
        {collapsed ? (
          <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
            <div className="max-h-10 overflow-hidden whitespace-pre-wrap break-words">
              {plainText.trim() || t('messageActions.collapsedMessage')}
            </div>
          </div>
        ) : (
          <>
            {preToolPhase && isStreaming && plainText.trim() && (
              <div className='mb-1.5 flex items-center gap-1.5 text-[10px] font-medium text-amber-600/80 dark:text-amber-400/80'>
                <span className='inline-block size-1.5 rounded-full bg-amber-500/60' />
                {t('assistantMessage.planningPhase', { defaultValue: 'Planning' })}
              </div>
            )}
            <div>
              {renderContent()}
              {!isStreaming && renderMode !== 'transcript' && completionSummary && (
                <CompletionSummaryBar summary={completionSummary} />
              )}
            </div>
          </>
        )}
        {createdAt && (
          <p className="mt-1.5 text-[10px] text-muted-foreground/50 tabular-nums">
            {new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {!isStreaming &&
          (plainText ||
            (isLiveMode && sessionId && msgId) ||
            (msgId && onDelete) ||
            (devMode && debugInfo) ||
            (showContinue && onContinue) ||
            (showRetry && onRetry)) && (
            <div
              className={`mt-2 flex items-center gap-1 transition-opacity ${showContinue && onContinue ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100'}`}
            >
              {plainText && (
                <ActionIconButton
                  label={t('action.copy', { ns: 'common' })}
                  icon={<Copy className="size-3.5" />}
                  onClick={handleCopy}
                />
              )}
              {isLiveMode && sessionId && msgId ? (
                <ActionIconButton
                  label={t('messageActions.fork')}
                  icon={<GitFork className="size-3.5" />}
                  onClick={() => void handleFork()}
                  disabled={forking}
                />
              ) : null}
              {showContinue && onContinue ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={onContinue}
                      aria-label={t('assistantMessage.continueToolExecution', {
                        defaultValue: 'Continue execution'
                      })}
                      className="flex size-7 items-center justify-center rounded-md border border-border/50 bg-background/90 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                    >
                      <Play className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {t('assistantMessage.continueToolExecutionHint', {
                      defaultValue:
                        'Detected that the last run stopped at tool execution. Click to continue in this message without creating a new AI message'
                    })}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              {showRetry && onRetry ? (
                <ActionIconButton
                  label={t('assistantMessage.regenerateReference', {
                    defaultValue: 'Regenerate reference'
                  })}
                  icon={<RotateCcw className="size-3.5" />}
                  onClick={() => msgId && onRetry?.(msgId)}
                />
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={t('action.showMore', { ns: 'common' })}
                    title={t('action.showMore', { ns: 'common' })}
                    className="flex size-7 items-center justify-center rounded-md border border-border/50 bg-background/90 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                  >
                    <Ellipsis className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuItem onSelect={handleCopy} disabled={!plainText.trim()}>
                    <Copy className="size-4" />
                    {t('action.copy', { ns: 'common' })}
                  </DropdownMenuItem>
                  {isLiveMode && sessionId && msgId ? (
                    <DropdownMenuItem onSelect={() => void handleFork()} disabled={forking}>
                      <GitFork className="size-4" />
                      {t('messageActions.fork')}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuItem onSelect={handleTranslate} disabled={!plainText.trim()}>
                    <Languages className="size-4" />
                    {t('messageActions.translate')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleSpeak} disabled={!plainText.trim()}>
                    <Volume2 className="size-4" />
                    {t('messageActions.readAloud')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => void handleShare()}
                    disabled={!plainText.trim()}
                  >
                    <Share2 className="size-4" />
                    {t('messageActions.share')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setCollapsed((value) => !value)}>
                    {collapsed ? (
                      <ChevronsDownUp className="size-4" />
                    ) : (
                      <ChevronsUpDown className="size-4" />
                    )}
                    {collapsed ? t('messageActions.expand') : t('messageActions.collapse')}
                  </DropdownMenuItem>
                  {showContinue && onContinue && (
                    <DropdownMenuItem onSelect={onContinue}>
                      <Play className="size-4" />
                      {t('assistantMessage.continueToolExecution', {
                        defaultValue: 'Continue execution'
                      })}
                    </DropdownMenuItem>
                  )}
                  {showRetry && onRetry && (
                    <DropdownMenuItem onSelect={() => msgId && onRetry?.(msgId)}>
                      <RotateCcw className="size-4" />
                      {t('assistantMessage.regenerateReference', {
                        defaultValue: 'Regenerate reference'
                      })}
                    </DropdownMenuItem>
                  )}
                  {showRetry && onRetry && (
                    <DropdownMenuItem onSelect={handleDeleteAndRegenerate}>
                      <RotateCcw className="size-4" />
                      {t('messageActions.deleteAndRegenerate')}
                    </DropdownMenuItem>
                  )}
                  {msgId && onDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => onDelete(msgId)}>
                        <Trash2 className="size-4" />
                        {t('action.delete', { ns: 'common' })}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {devMode && debugInfo && (
                <DebugToggleButton debugInfo={debugInfo} sessionId={sessionId} />
              )}
            </div>
          )}
      </div>
    </div>
  )
}
