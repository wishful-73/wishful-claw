/**
 * 会话概览面板的一行键值展示，以及终端标签取名。
 *
 * S-250 从 `SessionSummaryPanel.tsx` 搬出，JSX 与类名逐字平移。
 */

import { cn } from '@renderer/lib/utils'
import type { TerminalTab } from '@renderer/stores/terminal-store'
import { compactPath } from './use-git-summary'

export function ContextRow({
  icon,
  label,
  value,
  title,
  muted = false
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  title?: string
  muted?: boolean
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs" title={title}>
      <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground/75">
        {icon}
      </span>
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-right text-foreground/85',
          muted && 'text-muted-foreground/70'
        )}
      >
        {value}
      </span>
    </div>
  )
}

export function terminalLabel(terminal: TerminalTab): string {
  return terminal.title || compactPath(terminal.shell) || terminal.id
}
