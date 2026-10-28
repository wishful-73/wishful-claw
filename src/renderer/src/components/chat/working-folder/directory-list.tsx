/**
 * 工作目录选择对话框的两个来源区块：本地桌面目录列表、SSH 连接列表。
 *
 * S-250 从 `WorkingFolderSelectorDialog.tsx` 搬出，JSX 与类名逐字平移。
 * 状态仍留在对话框层，这里只收值与该区块要触发的回调。
 */

import { ArrowRight, FolderOpen, Monitor, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Input } from '@renderer/components/ui/input'
import { cn } from '@renderer/lib/utils'
import type { DesktopDirectoryOption } from './types'

/** 未填目录时的 SSH 工作目录兜底值；对话框补齐创建流程时也用它。 */
export const DEFAULT_SSH_WORKDIR = ''

export function LocalFolderSection({
  createMode,
  preferredDirectoryLabel,
  desktopDirectoriesLoading,
  desktopDirectories,
  normalizedWorkingFolder,
  onSelectOtherFolder,
  onRefresh,
  onSelectDesktopFolder
}: {
  createMode: boolean
  preferredDirectoryLabel: string
  desktopDirectoriesLoading: boolean
  desktopDirectories: DesktopDirectoryOption[]
  normalizedWorkingFolder: string
  onSelectOtherFolder: () => Promise<void>
  onRefresh: () => Promise<void>
  onSelectDesktopFolder: (folderPath: string) => Promise<void>
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const { t: tLayout } = useTranslation('layout')

  return (
    <>
      {createMode ? (
        <button
          className="group mb-3 flex w-full items-center gap-3 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
          onClick={() => void onSelectOtherFolder()}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FolderOpen className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-foreground">
              {t('input.selectLocalProjectFolder', {
                defaultValue: 'Select local working folder'
              })}
            </div>
            <div className="text-[10px] text-muted-foreground/70">
              {t('input.selectLocalProjectFolderHint', {
                defaultValue:
                  'Open the system folder picker. It starts from your last/default project location.'
              })}
            </div>
          </div>
          <ArrowRight className="size-4 shrink-0 text-primary/70 transition-transform group-hover:translate-x-0.5" />
        </button>
      ) : null}

      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-[10px] font-medium text-muted-foreground/70">
          {t('input.desktopFolders')}
        </p>
        <button
          className="text-[10px] text-muted-foreground/60 transition-colors hover:text-muted-foreground"
          onClick={() => void onRefresh()}
        >
          {tLayout('refresh')}
        </button>
      </div>

      <div
        className={cn(
          'max-h-40 overflow-y-auto pr-1',
          createMode ? 'grid grid-cols-2 gap-1.5' : 'flex flex-wrap gap-1.5'
        )}
      >
        {desktopDirectoriesLoading ? (
          <span className="text-[11px] text-muted-foreground/60">{t('input.loadingFolders')}</span>
        ) : desktopDirectories.length > 0 ? (
          desktopDirectories.map((directory) => {
            const selected = directory.path.toLowerCase() === normalizedWorkingFolder
            return (
              <button
                key={directory.path}
                className={cn(
                  'inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition-colors',
                  createMode ? 'w-full justify-start' : '',
                  selected
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-border/70 bg-muted/20 text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                )}
                onClick={() => void onSelectDesktopFolder(directory.path)}
                title={directory.path}
              >
                <FolderOpen className="size-3 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{directory.name}</span>
              </button>
            )
          })
        ) : (
          <span className="text-[11px] text-muted-foreground/60">
            {t('input.noDesktopFolders')}
          </span>
        )}

        {!createMode ? (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
            onClick={() => void onSelectOtherFolder()}
          >
            <FolderOpen className="size-3 shrink-0" />
            {t('input.selectOtherFolder')}
          </button>
        ) : null}
      </div>

      {createMode ? (
        <p className="mt-2 truncate text-[10px] text-muted-foreground/60">
          {t('input.pickerDefaultLocation', {
            defaultValue: 'Picker opens at: {{path}}',
            path: preferredDirectoryLabel
          })}
        </p>
      ) : null}
    </>
  )
}

export function SshConnectionSection({
  createMode,
  connections,
  activeSshConnectionId,
  sshDirInputs,
  onSelectSshFolder,
  onChangeSshDir
}: {
  createMode: boolean
  connections: Array<{
    id: string
    name: string
    username: string
    host: string
    port: number
    defaultDirectory?: string | null
  }>
  activeSshConnectionId: string | null
  sshDirInputs: Record<string, string>
  onSelectSshFolder: (connectionId: string) => Promise<void>
  onChangeSshDir: (connectionId: string, value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation('chat')

  return (
    <div className={cn('border-t pt-3', createMode ? 'mt-0' : 'mt-3')}>
      <p className="mb-2 flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground/70">
        <Monitor className="size-3" />
        {t('input.sshConnections')}
      </p>
      {connections.length > 0 ? (
        <div className="space-y-1.5">
          {connections.map((conn) => {
            const isSelected = activeSshConnectionId === conn.id
            const dirValue = sshDirInputs[conn.id] ?? conn.defaultDirectory ?? DEFAULT_SSH_WORKDIR
            return (
              <div
                key={conn.id}
                className={cn(
                  'flex min-w-0 flex-col gap-2 rounded-md border px-2 py-2 transition-colors sm:flex-row sm:items-center',
                  isSelected
                    ? 'border-primary/60 bg-primary/10'
                    : 'border-border/70 bg-muted/20 hover:bg-muted/50'
                )}
              >
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <Server className="size-3 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium">{conn.name}</div>
                    <div className="truncate text-[9px] text-muted-foreground/50">
                      {conn.username}@{conn.host}:{conn.port}
                    </div>
                  </div>
                </div>
                <div className="flex min-w-0 items-center gap-1.5 sm:w-64 sm:shrink-0">
                  <Input
                    aria-label={t('input.sshDirectory')}
                    value={dirValue}
                    onChange={(event) => onChangeSshDir(conn.id, event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void onSelectSshFolder(conn.id)
                    }}
                    placeholder={t('input.sshDirectoryPlaceholder', {
                      defaultValue: '/home/user/project'
                    })}
                    className="h-7 min-w-0 flex-1 bg-background/60 text-[10px]"
                  />
                  <button
                    className="shrink-0 rounded-md border border-primary/50 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary transition-colors hover:bg-primary/15"
                    onClick={() => void onSelectSshFolder(conn.id)}
                  >
                    {t('input.sshSelect', {
                      defaultValue: 'Select'
                    })}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <span className="text-[11px] text-muted-foreground/60">
          {t('input.noSshConnections', {
            defaultValue: 'No SSH connections configured'
          })}
        </span>
      )}
    </div>
  )
}
