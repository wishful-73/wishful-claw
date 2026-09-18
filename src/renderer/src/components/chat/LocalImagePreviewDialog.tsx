/**
 * agent 回复里点开本地图片时的全屏预览宿主。
 *
 * 挂在 MainLayout 上全局单例，内容复用右侧预览面板的 ImageViewer，
 * 保证缩放 / 旋转 / 复制 / 拖拽一套能力完全一致。
 */

import * as React from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'
import { useLocalImagePreviewStore } from '@renderer/stores/local-image-preview-store'
import { ImageViewer } from '@renderer/lib/preview/viewers/image-viewer'

export function LocalImagePreviewDialog(): React.JSX.Element | null {
  const open = useLocalImagePreviewStore((s) => s.open)
  const filePath = useLocalImagePreviewStore((s) => s.filePath)
  const sshConnectionId = useLocalImagePreviewStore((s) => s.sshConnectionId)
  const close = useLocalImagePreviewStore((s) => s.closeLocalImagePreview)

  if (!filePath) return null

  const fileName = filePath.split(/[\\/]/).pop() || filePath

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col p-4">
        <DialogHeader className="sr-only">
          <DialogTitle>{fileName}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md bg-background">
          {open ? (
            <ImageViewer
              filePath={filePath}
              content=""
              viewMode="preview"
              sshConnectionId={sshConnectionId}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
