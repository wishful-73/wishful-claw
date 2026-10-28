/**
 * 工作目录选择对话框的类型定义。
 *
 * S-250 从 `WorkingFolderSelectorDialog.tsx` 搬出，字段一字未改。
 */

export interface DesktopDirectoryOption {
  name: string
  path: string
  isDesktop: boolean
}

export interface DesktopDirectorySuccessResult {
  desktopPath: string
  directories: DesktopDirectoryOption[]
}

export interface DesktopDirectoryErrorResult {
  error: string
}

export type DesktopDirectoryResult = DesktopDirectorySuccessResult | DesktopDirectoryErrorResult

export type PendingSelection =
  | { kind: 'local'; folderPath: string }
  | { kind: 'ssh'; folderPath: string; connectionId: string }

export interface WorkingFolderSelectorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workingFolder?: string
  sshConnectionId?: string | null
  projectName?: string
  createMode?: boolean
  preferredSection?: 'local' | 'ssh'
  onSelectLocalFolder: (folderPath: string, projectName?: string) => void | Promise<void>
  onSelectSshFolder: (folderPath: string, connectionId: string, projectName?: string) => void | Promise<void>
}
