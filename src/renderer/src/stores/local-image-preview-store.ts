/**
 * agent 回复里点开本地图片时的全屏预览。
 *
 * 与右侧预览面板的 ImageViewer 是同一套读取通道（fs:read-file-binary），
 * 单独开一个全局单例宿主，是为了让聊天窗的路径标签能直接弹全屏，
 * 不用先跳右侧面板再点开。
 */

import { create } from 'zustand'

interface LocalImagePreviewState {
  open: boolean
  filePath: string | null
  sshConnectionId?: string
  openLocalImagePreview: (filePath: string, sshConnectionId?: string) => void
  closeLocalImagePreview: () => void
}

export const useLocalImagePreviewStore = create<LocalImagePreviewState>((set) => ({
  open: false,
  filePath: null,
  sshConnectionId: undefined,
  openLocalImagePreview: (filePath, sshConnectionId) =>
    set({ open: true, filePath, sshConnectionId }),
  closeLocalImagePreview: () => set({ open: false, filePath: null, sshConnectionId: undefined })
}))
