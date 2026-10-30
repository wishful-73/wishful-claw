/*
 * 聊天窗图片的全屏查看浮层（S-288 从 `ImagePreview.tsx` 拆出）。
 *
 * 有 `filePath` 时复用右侧预览面板的 `ImageViewer` —— 缩放 0.25~5 / 旋转 / 最大化 /
 * 复制 / 拖拽，与右侧面板、`LocalImagePreviewDialog` 是同一套口径，不再手搓第三种。
 * 没有 `filePath`（`data:` / `blob:` / `http:` 来源的图）时退回原来的 object-contain 浮层：
 * `ImageViewer` 只认盘上路径，为它加 `src` 入参会牵动另两处已验证的入口。
 */

import * as React from 'react'
import { X, Download, Copy, Check } from 'lucide-react'
import { motion, AnimatePresence } from 'motion/react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@renderer/components/ui/dialog'
import { ImageViewer } from '@renderer/lib/preview/viewers/image-viewer'

export interface ImagePreviewAction {
  key: string
  label: string
  icon: React.ReactNode
  onClick: () => void
}

export interface ImageLightboxProps {
  open: boolean
  src: string
  alt?: string
  /** 盘上路径。有它就走 `ImageViewer`（可缩放），没有就退回等比塞满窗口。 */
  filePath?: string
  actions?: ImagePreviewAction[]
  copied?: boolean
  onClose: () => void
  onDownload: () => void
  onCopy: () => void
  onImageLoad?: (event: React.SyntheticEvent<HTMLImageElement>) => void
}

const FLOATING_BUTTON =
  'rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors p-2'

export function ImageLightbox({
  open,
  src,
  alt = 'Image',
  filePath,
  actions = [],
  copied = false,
  onClose,
  onDownload,
  onCopy,
  onImageLoad
}: ImageLightboxProps): React.JSX.Element | null {
  // 盘上路径这条：ImageViewer 自带缩放 / 旋转 / 复制，这里只补它没有的下载。
  if (filePath) {
    return (
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
        {/* `sm:max-w-[95vw]` 不能省：`DialogContent` 自带 `sm:max-w-lg`，
            变体优先级高于裸 `max-w-[95vw]`，只写后者在 ≥640px 视口上会被压回 512px 宽。 */}
        <DialogContent className="flex h-[92vh] w-[95vw] max-w-[95vw] flex-col gap-2 p-4 sm:max-w-[95vw]">
          <DialogHeader className="sr-only">
            <DialogTitle>{alt}</DialogTitle>
          </DialogHeader>
          <button
            type="button"
            onClick={onDownload}
            className="absolute top-4 right-12 rounded-xs opacity-70 transition-opacity hover:opacity-100"
            title="Download"
            aria-label="Download"
          >
            <Download className="size-4" />
          </button>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md bg-background">
            {open ? (
              <ImageViewer filePath={filePath} content="" viewMode="preview" />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 px-4 pb-12 pt-16"
          onClick={onClose}
        >
          {/* Toolbar */}
          <div className="absolute right-4 top-4 z-20 flex items-center gap-2">
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  action.onClick()
                }}
                className={FLOATING_BUTTON}
                title={action.label}
                aria-label={action.label}
              >
                {action.icon}
              </button>
            ))}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onCopy()
              }}
              className={FLOATING_BUTTON}
              title="Copy to clipboard"
              aria-label="Copy to clipboard"
            >
              {copied ? <Check className="size-5" /> : <Copy className="size-5" />}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onDownload()
              }}
              className={FLOATING_BUTTON}
              title="Download"
              aria-label="Download"
            >
              <Download className="size-5" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onClose()
              }}
              className={FLOATING_BUTTON}
              title="Close"
              aria-label="Close"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Image —— 无盘上路径，只能等比塞满窗口 */}
          <motion.img
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0.9 }}
            src={src}
            alt={alt}
            className="h-full w-full object-contain"
            onLoad={onImageLoad}
            onClick={(event) => event.stopPropagation()}
          />

          <div className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 text-sm text-white/60">
            Click outside to close
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
