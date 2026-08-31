import * as React from 'react'
import type { TFunction } from 'i18next'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { type CollabMode } from '../CollabModeSwitcher'
import { useModeControls } from './use-mode-controls'
import { usePermissionMode, type PermissionMode } from './use-permission-mode'

type TargetSessionMode = {
  collaborationMode?: CollabMode
  permissionMode?: PermissionMode
}

interface UseComposerModeStateOptions {
  projectScoped: boolean
  draftSessionId: string | null | undefined
  resetKey: string
  targetSession: TargetSessionMode | null | undefined
  disabled: boolean
  isStreaming: boolean
  isOptimizingLocked: boolean
  pendingImageReads: number
  hasActiveGoal: boolean
  focusInputAtEnd: () => void
  setPendingPlanMode: React.Dispatch<React.SetStateAction<boolean>>
  setPendingGoalMode: React.Dispatch<React.SetStateAction<boolean>>
  t: TFunction
}

export function useComposerModeState(opts: UseComposerModeStateOptions) {
  const defaultProjectCollabMode = useSettingsStore((s) => s.projectSessionDefaultCollaborationMode)
  const defaultCoworkPermissionMode = useSettingsStore((s) => s.coworkDefaultPermissionMode)
  const [pendingCollabMode, setPendingCollabMode] = React.useState<CollabMode | null>(null)
  const [pendingPermissionMode, setPendingPermissionMode] = React.useState<PermissionMode | null>(null)

  const effectiveCollabMode: CollabMode = opts.targetSession?.collaborationMode ??
    (opts.projectScoped ? pendingCollabMode ?? defaultProjectCollabMode : 'chat')
  const effectivePermissionMode: PermissionMode = effectiveCollabMode === 'cowork'
    ? opts.targetSession?.permissionMode ?? pendingPermissionMode ?? defaultCoworkPermissionMode
    : 'default'

  const handleCollabModeChange = React.useCallback((nextMode: CollabMode): void => {
    if (opts.disabled || opts.isStreaming || opts.isOptimizingLocked || opts.pendingImageReads > 0 || !opts.projectScoped) return
    if (!opts.draftSessionId) {
      setPendingCollabMode(nextMode)
      if (nextMode === 'chat') setPendingPermissionMode('default')
    }
    requestAnimationFrame(() => opts.focusInputAtEnd())
  }, [opts.disabled, opts.draftSessionId, opts.focusInputAtEnd, opts.isOptimizingLocked,
    opts.isStreaming, opts.pendingImageReads, opts.projectScoped])

  const { handlePlanModeChange, handleGoalModeChange } = useModeControls({
    projectScoped: opts.projectScoped,
    draftSessionId: opts.draftSessionId ?? null,
    disabled: opts.disabled,
    isStreaming: opts.isStreaming,
    isOptimizingLocked: opts.isOptimizingLocked,
    pendingImageReads: opts.pendingImageReads,
    hasActiveGoal: opts.hasActiveGoal,
    focusInputAtEnd: opts.focusInputAtEnd,
    setPendingPlanMode: opts.setPendingPlanMode,
    setPendingGoalMode: opts.setPendingGoalMode,
    t: opts.t
  })

  const { permissionMode, handleSelectPermissionMode } = usePermissionMode({
    sessionId: opts.draftSessionId ?? null,
    permissionMode: effectivePermissionMode,
    onPendingModeChange: setPendingPermissionMode,
    t: opts.t
  })

  React.useEffect(() => {
    setPendingCollabMode(null)
    setPendingPermissionMode(null)
  }, [opts.resetKey])

  return {
    effectiveCollabMode,
    effectivePermissionMode,
    handleCollabModeChange,
    handlePlanModeChange,
    handleGoalModeChange,
    permissionMode,
    handleSelectPermissionMode
  }
}
