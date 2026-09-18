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
  // Permission mode is independent of collaboration mode (iter-31 S-59): the session's
  // own choice wins regardless of chat/cowork, so chat sessions can opt into YOLO too.
  // The fallback is the same workspace default for every session kind — chat, global and
  // cowork all share it (老大: "YOLO 也共享 cowork 中的默认值").
  const effectivePermissionMode: PermissionMode = opts.targetSession?.permissionMode ??
    pendingPermissionMode ??
    defaultCoworkPermissionMode

  const handleCollabModeChange = React.useCallback((nextMode: CollabMode): void => {
    if (opts.disabled || opts.isStreaming || opts.isOptimizingLocked || opts.pendingImageReads > 0 || !opts.projectScoped) return
    if (!opts.draftSessionId) {
      // Switching to chat no longer resets the permission choice (iter-31 S-59):
      // chat sessions may run YOLO too, so the user's pick is left alone.
      setPendingCollabMode(nextMode)
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
