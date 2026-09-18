// 会话级「请求上下文上限」开关（iter-32 S-73 的入口，S-83 从上下文环菜单提到工具栏）。

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useChatStore } from '@renderer/stores/chat-store'
import { formatTokens } from '@renderer/lib/format-tokens'
import { SESSION_CONTEXT_CAP_TOKENS } from '@renderer/lib/agent/context-compression'
import { cn } from '@renderer/lib/utils'

interface ContextCapToggleProps {
  sessionId: string | null
  className?: string
}

/**
 * 开着 = 这个会话的有效上下文窗口被压到 SESSION_CONTEXT_CAP_TOKENS；
 * 关着 = 用模型的真实窗口。开关落在会话上（不是全局设置）。
 */
export function ContextCapToggle({
  sessionId,
  className
}: ContextCapToggleProps): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const capEnabled = useChatStore((s) => {
    if (!sessionId) return false
    const index = s.sessionsById[sessionId]
    return index !== undefined ? s.sessions[index]?.contextCapEnabled === true : false
  })
  const updateSessionContextCap = useChatStore((s) => s.updateSessionContextCap)

  if (!sessionId) return null

  const capLabel = formatTokens(SESSION_CONTEXT_CAP_TOKENS)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          // composer-control 的 CSS 是 .composer-shell [data-slot='button'].composer-control
          // 三级选择器，普通工具类压不过它，所以开启态的颜色必须带 important。
          className={cn(className, capEnabled && 'text-primary!')}
          aria-pressed={capEnabled}
          onClick={() => updateSessionContextCap(sessionId, !capEnabled)}
        >
          <Gauge className="size-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        {capEnabled
          ? t('input.contextCapOn', {
              tokens: capLabel,
              defaultValue: 'Request context capped at {{tokens}} — click to turn off'
            })
          : t('input.contextCapOff', {
              tokens: capLabel,
              defaultValue: 'Limit request context to {{tokens}}'
            })}
      </TooltipContent>
    </Tooltip>
  )
}
