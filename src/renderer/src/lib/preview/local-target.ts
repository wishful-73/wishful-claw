/**
 * agent 回复里的本地路径 → 打开动作。
 *
 * 两类目标分开走：图片用全屏图片预览，其余交给右侧预览面板。
 * 「路径真的存在才渲染成可点标签」的判定在 use-local-target-available.ts。
 */

import { IPC } from '@renderer/lib/ipc/channels'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useLocalImagePreviewStore } from '@renderer/stores/local-image-preview-store'

/** 命中即走全屏图片预览；与 preview-panel-helpers 的 EXT_SETS.image 同一份扩展名表。 */
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.jfif', '.pjpeg', '.pjp', '.gif', '.apng',
  '.bmp', '.webp', '.avif', '.ico', '.cur', '.tif', '.tiff', '.heic', '.heif', '.jxl'
])

export function isImageFilePath(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return false
  return IMAGE_EXTENSIONS.has(filePath.slice(dot).toLowerCase())
}

/** 存在且是文件才算可用。stat 拿不到结论（抛错 / 通道失败）一律当不可用，不猜。 */
export async function localTargetIsAvailable(
  filePath: string,
  sshConnectionId?: string
): Promise<boolean> {
  try {
    const result = (await ipcClient.invoke(
      sshConnectionId ? IPC.SSH_FS_STAT_PATH : IPC.FS_STAT_PATH,
      sshConnectionId ? { connectionId: sshConnectionId, path: filePath } : { path: filePath }
    )) as { exists?: boolean; isDirectory?: boolean; error?: string } | null
    if (!result || result.error || result.exists === false) return false
    return !result.isDirectory
  } catch {
    return false
  }
}

/** 图片走全屏预览，其余文件走右侧预览面板。 */
export function openLocalTarget(
  filePath: string,
  options: { sshConnectionId?: string; sessionId?: string | null } = {}
): void {
  if (isImageFilePath(filePath)) {
    useLocalImagePreviewStore.getState().openLocalImagePreview(filePath, options.sshConnectionId)
    return
  }
  useUIStore
    .getState()
    .openFilePreview(
      filePath,
      undefined,
      options.sshConnectionId,
      options.sessionId ?? null,
      undefined,
      undefined
    )
}
