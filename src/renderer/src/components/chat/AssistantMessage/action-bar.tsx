// Bottom action bar for AssistantMessage: copy, fork, speak, share, retry, delete, etc.

import * as React from 'react'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Copy, ChevronsDownUp, ChevronsUpDown, Ellipsis, Volume2, Share2, GitFork } from 'lucide-react'
import type { RequestDebugInfo } from '@renderer/lib/api/types'
import type { MemoryRecallInfo } from '@renderer/stores/chat-store/types'
import { useUIStore } from '@renderer/stores/ui-store'
import { useChatStore } from '@renderer/stores/chat-store'
import type { CompletionSummaryData } from './types'
import { CompletionSummaryBar } from './token-summary'
import { ActionIconButton, DebugToggleButton } from './ui-buttons'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger
} from '@renderer/components/ui/dropdown-menu'
import { formatDurationMs } from '@renderer/lib/format-duration'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { isSpeechSupported, speakMessage } from '@renderer/lib/speech'

export interface ActionBarProps {
  isStreaming: boolean
  plainText: string
  isLiveMode: boolean
  sessionId?: string | null
  msgId?: string
  createdAt?: number
  updatedAt?: number
  /** 整轮总耗时（ms）。只有被压缩切分过的消息才有：分段后每段只报自己那一截。 */
  totalElapsedMs?: number
  devMode: boolean
  debugInfo?: RequestDebugInfo
  collapsed: boolean
  setCollapsed: React.Dispatch<React.SetStateAction<boolean>>
  renderMode: string
  renderContent: () => React.JSX.Element
  completionSummary: CompletionSummaryData | null
  t: (key: string, options?: Record<string, unknown>) => string
  memoryRecall?: MemoryRecallInfo
}

export function AssistantActionBar({
  isStreaming,
  plainText,
  isLiveMode,
  sessionId,
  msgId,
  devMode,
  debugInfo,
  collapsed,
  setCollapsed,
  renderMode,
  renderContent,
  completionSummary,
  createdAt,
  updatedAt,
  totalElapsedMs,
  t
}: ActionBarProps): React.JSX.Element {
  // 时间戳只在这一轮跑完后才亮：流式期间显示的是「开始时间」，看着像已经完成。
  const finishedAt = updatedAt ?? createdAt
  // 耗时只在两个戳都齐、且结束晚于开始时才算（老消息没有 updatedAt）。
  const elapsedMs =
    updatedAt != null && createdAt != null && updatedAt > createdAt ? updatedAt - createdAt : null

  const navigateToSession = useUIStore((s) => s.navigateToSession)
  const forkSessionFromMessage = useChatStore((s) => s.forkSessionFromMessage)
  const [forking, setForking] = useState(false)

  const handleCopy = useCallback((): void => {
    if (!plainText) return
    navigator.clipboard.writeText(plainText)
  }, [plainText])

  const handleSpeak = useCallback((): void => {
    const text = plainText.trim()
    if (!text) return
    if (!isSpeechSupported()) {
      toast.error(t('messageActions.speechNotSupported'))
      return
    }
    // 在回调里读最新设置：音色 / 语速随时可改，不必让每条消息都订阅一遍。
    const { speechVoice, speechRate, speechPitch } = useSettingsStore.getState()
    speakMessage(text, {
      voice: speechVoice ?? '',
      rate: speechRate ?? 1,
      pitch: speechPitch ?? 1
    })
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
      const forkedSessionId = await forkSessionFromMessage(sessionId, msgId)
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
            <div>
              {renderContent()}
              {!isStreaming && renderMode !== 'transcript' && completionSummary && (
                <CompletionSummaryBar summary={completionSummary} />
              )}
            </div>
          </>
        )}
        {/* 结束时间和耗时都只在跑完后才亮；被压缩切分过的消息，末段再多报一个整轮总耗时 */}
        {!isStreaming && finishedAt != null && (
          <p className="mt-1.5 text-[10px] text-muted-foreground/50 tabular-nums">
            {new Date(finishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {elapsedMs != null && ` · ${formatDurationMs(elapsedMs)}`}
            {totalElapsedMs != null &&
              ` · ${t('messageActions.elapsedTotal', { duration: formatDurationMs(totalElapsedMs) })}`}
          </p>
        )}
        {!isStreaming &&
          (plainText || (isLiveMode && sessionId && msgId) || (devMode && debugInfo)) && (
            <div
              className="mt-2 flex items-center gap-1 opacity-0 transition-opacity group-hover/msg:opacity-100"
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
