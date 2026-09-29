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
import { openWebUrl } from './web-url'

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

/**
 * 交给内置浏览器（`<webview>`）渲染的文件。
 *
 * PDF 实测走 Chromium 自带阅读器可用（页面里会挂上 `chrome-extension://…pdf_embedder` 那套），
 * 比自家 pdf.js 那条链（读全文件 → base64 → IPC → worker → 解析 → 渲染）少一大圈，
 * 也不用为了一个预览把几 MB 的包塞进 IPC。HTML 同理 —— 浏览器本来就是干这个的。
 */
const BROWSER_PREVIEW_EXTENSIONS = new Set(['.pdf', '.html', '.htm', '.xhtml', '.shtml'])

export function isBrowserPreviewFilePath(filePath: string): boolean {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return false
  return BROWSER_PREVIEW_EXTENSIONS.has(filePath.slice(dot).toLowerCase())
}

/**
 * 本地绝对路径 → `file://` URL（`<webview>` 的 src 要的是这个）。
 *
 * 反斜杠统一成正斜杠、盘符前补一个斜杠凑出 `file:///D:/…` 三段斜杠的形态；
 * 中文与空格交给 `encodeURI`；`#` `?` 会截断 URL（被当成片段/查询串），单独编码。
 */
export function localPathToFileUrl(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  const absolute = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${encodeURI(absolute).replace(/#/g, '%23').replace(/\?/g, '%3F')}`
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

/** 图片走全屏预览，PDF / HTML 交给内置浏览器，其余文件走右侧预览面板。 */
export function openLocalTarget(
  filePath: string,
  options: { sshConnectionId?: string; sessionId?: string | null } = {}
): void {
  if (isImageFilePath(filePath)) {
    useLocalImagePreviewStore.getState().openLocalImagePreview(filePath, options.sshConnectionId)
    return
  }
  // PDF / HTML：本地文件转 file:// 后交给内置浏览器（Chromium 自带阅读器 / 渲染引擎），
  // 比预览面板里那条 react-pdf / iframe 链更直接，也不用把几 MB 的包塞进 IPC。
  // 远端文件不在本地文件系统上，转出来是个指向不存在文件的 URL —— 那种情况仍回预览面板。
  if (!options.sshConnectionId && isBrowserPreviewFilePath(filePath)) {
    openWebUrl(localPathToFileUrl(filePath))
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
