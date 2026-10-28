/**
 * 命令 / 终端类工具的入参陈列。
 *
 * S-250 从 `structured-input.tsx` 搬出，JSX 与类名逐字平移。
 */

import { useTranslation } from 'react-i18next'
import { MONO_FONT } from '@renderer/lib/constants'

export function CommandPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const command =
    typeof input.command === 'string'
      ? input.command
      : typeof input.command_preview === 'string'
        ? input.command_preview
        : ''
  const description = input.description ? String(input.description) : null
  const timeout = input.timeout ? String(input.timeout) : null
  const commandChars = typeof input.command_chars === 'number' ? input.command_chars : null
  const commandLines = typeof input.command_lines === 'number' ? input.command_lines : null
  const commandTruncated = input.command_truncated === true
  return (
    <div className="space-y-0.5">
      <div className="flex items-start gap-1.5 text-xs">
        <span className="shrink-0 select-none pt-0.5 font-mono text-[11px] text-zinc-500">$</span>
        <span
          className="break-all font-mono text-[11px] text-sky-600 dark:text-sky-300"
          style={{ fontFamily: MONO_FONT }}
        >
          {command}
        </span>
      </div>
      {(description ||
        timeout ||
        commandChars !== null ||
        commandLines !== null ||
        commandTruncated) && (
        <div className="flex flex-wrap items-center gap-2 pl-[18px]">
          {description && <p className="text-[10px] text-muted-foreground/60">{description}</p>}
          {commandLines !== null && (
            <span className="text-[10px] text-muted-foreground/55">
              {t('toolCall.lineCount', { count: commandLines })}
            </span>
          )}
          {commandChars !== null && (
            <span className="text-[10px] text-muted-foreground/55">
              {t('toolCall.charCount', { count: commandChars })}
            </span>
          )}
          {commandTruncated && (
            <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-600 dark:text-amber-300">
              {t('toolCall.preview')}
            </span>
          )}
          {timeout && (
            <span className="text-[10px] text-muted-foreground/55">
              {t('toolCall.timeoutMs', { value: timeout })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
