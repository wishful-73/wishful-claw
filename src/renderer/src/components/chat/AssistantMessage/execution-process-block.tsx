// ExecutionProcessBlock — wraps the "execution process" (thinking + tool calls + intermediate text)
// in a collapsible block. The final reply text is rendered outside this block.
//
// Behavior:
// - collapsible=false: not rendered (no process content)
// - collapsible=true + isStreaming: expanded, showing live process
// - collapsible=true + !isStreaming: auto-collapsed, showing summary
// - User can manually toggle; once toggled, auto behavior is overridden

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { CollapsibleHeightPanel } from '../CollapsibleHeightPanel'

export interface ExecutionProcessBlockProps {
  /** Whether the block can collapse. true when there is process content (thinking/tool_use/intermediate text). */
  collapsible: boolean
  /** Whether the Agent is currently streaming (executing). */
  isStreaming: boolean
  /** Summary text shown when collapsed (e.g., "运行了3个命令，查看了2个文件"). */
  summary?: string | null
  /** Optional active detail text shown while streaming (e.g., "Running Bash..."). */
  activeDetail?: string | null
  /** Process content: thinking blocks, tool calls, intermediate text. */
  children: React.ReactNode
}

export function ExecutionProcessBlock({
  collapsible,
  isStreaming,
  summary,
  activeDetail,
  children
}: ExecutionProcessBlockProps): React.JSX.Element | null {
  const [userToggled, setUserToggled] = useState(false)
  const [userExpanded, setUserExpanded] = useState(false)

  // Reset user override when streaming restarts (new user message → new execution)
  useEffect(() => {
    if (isStreaming) {
      setUserToggled(false)
      setUserExpanded(false)
    }
  }, [isStreaming])

  // Auto behavior: expanded while streaming, collapsed when done
  // User override takes precedence once toggled
  const expanded = userToggled ? userExpanded : isStreaming

  const handleToggle = useCallback(() => {
    if (!userToggled) {
      setUserExpanded(!expanded)
    } else {
      setUserExpanded((prev) => !prev)
    }
    setUserToggled(true)
  }, [expanded, userToggled])

  if (!collapsible) return null

  // Determine display text: streaming shows activeDetail, done shows summary
  const displayText = isStreaming
    ? (activeDetail ?? undefined)
    : (summary ?? undefined)

  // During streaming: no fold header, no border -- just show content directly
  if (isStreaming) {
    return (
      <div className="space-y-2">
        {children}
      </div>
    )
  }

  // After streaming: collapsible block with summary header and border
  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleToggle}
        aria-expanded={expanded}
        className="group flex items-center gap-1.5 rounded-md py-0.5 text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        {displayText && (
          <span className="shrink-0">{displayText}</span>
        )}
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 group-hover:text-foreground',
            !expanded && '-rotate-90'
          )}
        />
      </button>
      <CollapsibleHeightPanel open={expanded} className="overflow-hidden">
        {/* R-10.3: 定格过程展开封顶 70vh 出内部滚动条；执行中分支（上方 isStreaming 提前返回）不受限 */}
        <div
          className={cn(
            'space-y-2 border-l border-border/40 ml-2 pl-3',
            expanded && 'max-h-[70vh] overflow-y-auto'
          )}
        >
          {children}
        </div>
      </CollapsibleHeightPanel>
    </div>
  )
}
