import * as React from 'react'
import type { TFunction } from 'i18next'
import { toast } from 'sonner'
import { useUIStore } from '@renderer/stores/ui-store'

interface UseModeControlsOptions {
  projectScoped: boolean
  draftSessionId: string | null
  disabled: boolean
  isStreaming: boolean
  isOptimizingLocked: boolean
  pendingImageReads: number
  hasActiveGoal: boolean
  focusInputAtEnd: () => void
  setPendingGoalMode: React.Dispatch<React.SetStateAction<boolean>>
  t: TFunction
}

export function useModeControls(opts: UseModeControlsOptions) {
  const handlePlanModeChange = React.useCallback(
    (enabled: boolean): void => {
      if (enabled && !opts.projectScoped) {
        toast.error(
          opts.t('input.planModeUnavailable', {
            defaultValue: 'Plan Mode needs a project working folder.'
          })
        )
        return
      }

      // 会话尚未创建时无处落 planMode（planModesBySession 按 sessionId 存），
      // 与改造前一致：此路径不做任何事。
      if (!opts.draftSessionId) return

      if (enabled) {
        useUIStore.getState().enterPlanMode(opts.draftSessionId)
      } else {
        useUIStore.getState().exitPlanMode(opts.draftSessionId)
      }
    },
    [opts.draftSessionId, opts.projectScoped, opts.t]
  )

  const handleGoalModeChange = React.useCallback(
    (enabled: boolean): void => {
      if (opts.disabled || opts.isStreaming || opts.isOptimizingLocked || opts.pendingImageReads > 0) return

      if (!enabled) {
        opts.setPendingGoalMode(false)
        return
      }

      if (opts.hasActiveGoal) return
      opts.setPendingGoalMode(true)
      requestAnimationFrame(() => {
        opts.focusInputAtEnd()
      })
    },
    [
      opts.disabled,
      opts.draftSessionId,
      opts.focusInputAtEnd,
      opts.hasActiveGoal,
      opts.isOptimizingLocked,
      opts.isStreaming,
      opts.pendingImageReads,
      opts.t,
      opts.setPendingGoalMode
    ]
  )

  return { handlePlanModeChange, handleGoalModeChange }
}
