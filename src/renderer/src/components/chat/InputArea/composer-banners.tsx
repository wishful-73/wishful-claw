import { AlertTriangle, FolderOpen, ClipboardList, Target } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { exitPlanMode as exitPlanModeAction } from '@renderer/hooks/use-chat-actions'

interface ComposerBannersProps {
  hasApiKey: boolean
  needsWorkingFolder: boolean
  onSelectFolder?: () => void
  mode: string
  planMode: boolean
  projectScoped: boolean
  draftSessionId: string | null
  workingFolder?: string
  hideWorkingFolderIndicator: boolean
  hasPendingGoalMode: boolean
  composerWidthClass: string
  onOpenSettings: (tab: string) => void
}

export function ComposerBanners({
  hasApiKey,
  needsWorkingFolder,
  onSelectFolder,
  mode,
  planMode,
  projectScoped,
  draftSessionId,
  workingFolder,
  hideWorkingFolderIndicator,
  hasPendingGoalMode,
  composerWidthClass,
  onOpenSettings
}: ComposerBannersProps) {
  const { t } = useTranslation('chat')

  return (
    <>
      {/* API key warning */}
      {!hasApiKey && (
        <button
          type="button"
          className={cn(
            composerWidthClass,
            'mb-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-left text-xs text-amber-600 dark:text-amber-400 transition-colors hover:bg-amber-500/10'
          )}
          onClick={() => onOpenSettings('provider')}
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>{t('input.noApiKey')}</span>
        </button>
      )}

      {/* Working folder required warning */}
      {needsWorkingFolder && onSelectFolder && (
        <button
          type="button"
          className={cn(
            composerWidthClass,
            'mb-2 flex items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-left text-xs text-amber-600 dark:text-amber-400 transition-colors hover:bg-amber-500/10'
          )}
          onClick={onSelectFolder}
        >
          <FolderOpen className="size-3.5 shrink-0" />
          <span>{t('input.noWorkingFolder', { mode })}</span>
        </button>
      )}

      {/* Plan mode banner */}
      {planMode && projectScoped && (
        <div className={cn(composerWidthClass, 'mb-2 flex items-center justify-between gap-2 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-1.5')}>
          <div className="flex items-center gap-1.5 text-xs text-violet-600 dark:text-violet-400">
            <ClipboardList className="size-3.5 shrink-0" />
            <span>
              {t('input.planModeActive', {
                defaultValue: 'Plan Mode — exploring codebase, no file changes'
              })}
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-violet-600 dark:text-violet-400 hover:bg-violet-500/10"
            onClick={() => void exitPlanModeAction(draftSessionId)}
          >
            {t('input.exitPlanMode', { defaultValue: 'Exit Plan Mode' })}
          </Button>
        </div>
      )}

      {/* Working folder indicator */}
      {workingFolder && !hideWorkingFolderIndicator && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <FolderOpen className="size-3" />
          <span className="truncate">{workingFolder}</span>
        </div>
      )}

      {hasPendingGoalMode && (
        <div
          className={cn(
            composerWidthClass,
            'mb-2 flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300'
          )}
        >
          <Target className="size-3.5 shrink-0" />
          <span>
            {t('input.pendingGoalBanner', {
              defaultValue:
                'Goal mode is active. The Agent will discuss the objective with you and create a goal once confirmed.'
            })}
          </span>
        </div>
      )}
    </>
  )
}
