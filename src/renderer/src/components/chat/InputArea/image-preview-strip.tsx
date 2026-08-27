import * as React from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { X } from 'lucide-react'
import {
  Dialog, DialogContent, DialogTitle
} from '@renderer/components/ui/dialog'
import { useTranslation } from 'react-i18next'
import type { ImageAttachment } from '@renderer/lib/image-attachments'

interface ImagePreviewStripProps {
  attachedImages: ImageAttachment[]
  animationsEnabled: boolean
  imagePreviewRef: React.RefObject<HTMLDivElement | null>
  setPreviewImage: (img: ImageAttachment | null) => void
  removeImage: (id: string) => void
  previewImage: ImageAttachment | null
}

export function ImagePreviewStrip({
  attachedImages,
  animationsEnabled,
  imagePreviewRef,
  setPreviewImage,
  removeImage,
  previewImage
}: ImagePreviewStripProps) {
  const { t } = useTranslation('chat')

  return (
    <>
      {attachedImages.length > 0 && (
        <div
          ref={imagePreviewRef}
          className="shrink-0 flex gap-2 overflow-x-auto px-3 pt-3 pb-1"
        >
          <AnimatePresence initial={false}>
            {attachedImages.map((img) => (
              <motion.div
                key={img.id}
                layout={animationsEnabled}
                initial={animationsEnabled ? { opacity: 0, scale: 0.9 } : false}
                animate={{ opacity: 1, scale: 1 }}
                exit={animationsEnabled ? { opacity: 0, scale: 0.9 } : undefined}
                transition={
                  animationsEnabled ? { duration: 0.15, ease: 'easeOut' } : { duration: 0 }
                }
                className="relative group/img shrink-0"
              >
                <button
                  type="button"
                  className="block cursor-zoom-in rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t('userMessage.imagePreview')}
                  title={t('userMessage.imagePreview')}
                  onClick={() => setPreviewImage(img)}
                >
                  <img
                    src={img.dataUrl}
                    alt=""
                    className="composer-image-thumb size-16 rounded-xl object-cover transition-transform group-hover/img:scale-[1.03]"
                  />
                </button>
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 size-5 rounded-full bg-destructive text-destructive-foreground shadow-md opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center"
                  aria-label={t('userMessage.removeImage')}
                  title={t('userMessage.removeImage')}
                  onClick={() => removeImage(img.id)}
                >
                  <X className="size-3" />
                </button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <Dialog
        open={Boolean(previewImage)}
        onOpenChange={(open) => {
          if (!open) setPreviewImage(null)
        }}
      >
        <DialogContent className="max-h-[90vh] !w-fit !max-w-[min(96vw,1100px)] overflow-hidden p-2 sm:!max-w-[min(96vw,1100px)]">
          <DialogTitle className="sr-only">{t('userMessage.imagePreview')}</DialogTitle>
          {previewImage && (
            <div className="flex max-w-full items-center justify-center overflow-hidden">
              <img
                src={previewImage.dataUrl}
                alt={t('userMessage.imagePreview')}
                className="block h-auto max-h-[calc(90vh-1rem)] w-auto max-w-[min(92vw,1068px)] rounded object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
