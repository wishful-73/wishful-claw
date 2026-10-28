/**
 * 搜索类工具（Glob / Grep）的入参陈列。
 *
 * S-250 从 `structured-input.tsx` 搬出，JSX 与类名逐字平移。
 */

import { useTranslation } from 'react-i18next'
import { MONO_FONT } from '@renderer/lib/constants'
import { Search } from 'lucide-react'

export function GlobPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const pattern = String(input.pattern ?? '')
  const path = input.path ? String(input.path) : null
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs">
        <span className="shrink-0 text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
          {t('Glob')}
        </span>
        <span
          className="font-mono text-[11px] text-sky-600 dark:text-sky-300"
          style={{ fontFamily: MONO_FONT }}
        >
          {pattern}
        </span>
      </div>
      {path && (
        <div>
          <span className="text-[10px] text-zinc-500 font-mono" style={{ fontFamily: MONO_FONT }}>
            {path}
          </span>
        </div>
      )}
    </div>
  )
}

export function GrepPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const pattern = String(input.pattern ?? '')
  const path = input.path ? String(input.path) : null
  const include = input.include ? String(input.include) : null
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs">
        <Search className="size-3 text-amber-500 dark:text-amber-400" />
        <span
          className="font-mono text-[11px] text-amber-600/80 dark:text-amber-400/80"
          style={{ fontFamily: MONO_FONT }}
        >
          /{pattern}/
        </span>
      </div>
      {(path || include) && (
        <div className="flex items-center gap-2 pl-[18px]">
          {path && (
            <span
              className="text-[10px] text-muted-foreground/55 font-mono"
              style={{ fontFamily: MONO_FONT }}
            >
              {t('toolCall.searchInPath', { path })}
            </span>
          )}
          {include && (
            <span
              className="text-[10px] text-muted-foreground/55 font-mono"
              style={{ fontFamily: MONO_FONT }}
            >
              {t('toolCall.includeGlob', { include })}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
