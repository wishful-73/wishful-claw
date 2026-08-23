import * as React from 'react'
import type { TFunction } from 'i18next'
import { confirm } from '@renderer/components/ui/confirm-dialog'
import { useSettingsStore } from '@renderer/stores/settings-store'

// Permission modes were simplified to two tiers: default (ask for risky
// tools) and fullAccess (YOLO — auto-approve everything). The legacy
// whitelist tier is no longer selectable; existing whitelist settings in
// the store are ignored (kept for migration compatibility only).

export type PermissionMode = 'default' | 'fullAccess'

interface UsePermissionModeOptions {
  autoApprove: boolean
  t: TFunction
}

export function usePermissionMode(opts: UsePermissionModeOptions) {
  const permissionMode: PermissionMode = opts.autoApprove ? 'fullAccess' : 'default'

  const handleSelectPermissionMode = React.useCallback(
    async (mode: PermissionMode): Promise<void> => {
      if (mode === permissionMode) return
      if (mode === 'fullAccess') {
        const ok = await confirm({
          title: opts.t('permission.fullAccessConfirmTitle'),
          description: opts.t('permission.fullAccessConfirmDesc'),
          confirmLabel: opts.t('permission.fullAccessConfirmAction'),
          variant: 'destructive'
        })
        if (!ok) return
        useSettingsStore.getState().updateSettings({ autoApprove: true })
        return
      }
      useSettingsStore.getState().updateSettings({ autoApprove: false })
    },
    [permissionMode, opts.t]
  )

  return { permissionMode, handleSelectPermissionMode }
}
