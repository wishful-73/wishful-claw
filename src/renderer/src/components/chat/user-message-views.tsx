import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Check, X, Copy, FileText, AlertCircle, ArrowDownRight } from 'lucide-react'
import {
  writeImageBlobToClipboard,
  writeImageDataUrlToClipboard
} from '@renderer/lib/utils/image-clipboard'
import type {
  GlobalDispatchMeta,
  SelectedFileReadsMeta
} from '@renderer/lib/api/types'
import { type ImageAttachment } from '@renderer/lib/image-attachments'
import { cn } from '@renderer/lib/utils'

/**
 * 全局会话派活 / 沟通的来路标记（v3-iter-5 S-278）。
 *
 * 为什么要它：项目会话里凭空多出一条用户消息、正文还是一整段任务描述，
 * 分不清是谁说的。meta 里带着 dispatch 身份，就该在气泡上写明白。
 *
 * 任务标题取**派发那一刻的快照**（`meta.globalDispatch.globalTaskTitle`），
 * 不 join 任务板当前值 —— 任务改名不该改写历史消息。
 */
export function GlobalDispatchBadge({
  meta
}: {
  meta?: GlobalDispatchMeta
}): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  if (!meta) return null

  const isWorkRequest = meta.kind === 'work_request'
  const title = meta.globalTaskTitle?.trim()

  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] leading-none">
      <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-1 font-medium text-sky-600 dark:text-sky-400">
        <ArrowDownRight className="size-3 shrink-0" />
        {isWorkRequest
          ? t('userMessage.globalDispatchWorkRequest', { defaultValue: 'Global task' })
          : t('userMessage.globalDispatchMessage', { defaultValue: 'From global session' })}
      </span>
      {title && (
        <span
          className="max-w-[18rem] truncate rounded-md border border-border/60 bg-background/45 px-1.5 py-1 text-muted-foreground"
          title={title}
        >
          {title}
        </span>
      )}
      {/* 标题拿不到时退化成 id：至少还能回溯是哪一次派发。 */}
      {!title && (
        <span
          className="rounded-md border border-border/60 bg-background/45 px-1.5 py-1 font-mono text-[10px] text-muted-foreground/80"
          title={meta.dispatchId}
        >
          {meta.dispatchId}
        </span>
      )}
    </div>
  )
}

export function UserSelectedFileReadsView({
  reads
}: {
  reads?: SelectedFileReadsMeta
}): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const files = reads?.files ?? []
  if (files.length === 0) return null

  return (
    <div className="mt-3 border-t border-border/60 pt-2">
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <FileText className="size-3.5 shrink-0" />
        <span>{t('userMessage.selectedFileReadsTitle', { defaultValue: 'Read files' })}</span>
        <span className="rounded-md border border-border/60 bg-background/45 px-1.5 py-0.5 text-[10px] tabular-nums">
          {files.length}
        </span>
      </div>
      <div className="space-y-1">
        {files.map((file, index) => {
          const skipped = file.skipped === true
          const skippedDescription =
            skipped && file.skipReason === 'directory'
              ? t('userMessage.selectedFileReadSkippedDirectory', {
                  defaultValue: 'Directory path reference; contents were not read'
                })
              : skipped && file.skipReason === 'pdf'
              ? t('userMessage.selectedFileReadSkippedPdf', {
                  defaultValue: 'PDF path reference; file was not read directly'
                })
              : skipped && (file.skipReason === 'unresolved' || file.skipReason === 'budget')
                ? t('userMessage.selectedFileReadSkippedNotInjected', {
                    defaultValue: 'Path reference; file content was not injected into this turn'
                  })
                : skipped
                ? t('userMessage.selectedFileReadSkippedNonText', {
                    defaultValue: 'Path reference; binary or document file was not read directly'
                  })
                : ''
          const status = skipped
            ? t('userMessage.selectedFileReadSkipped', { defaultValue: 'Path reference' })
            : file.error
            ? t('userMessage.selectedFileReadFailed', { defaultValue: 'Read failed' })
            : file.truncated
              ? t('userMessage.selectedFileReadTruncated', {
                  count: file.lineCount,
                  maxLines: file.maxLines,
                  defaultValue: 'Read first {{count}} lines'
                })
              : t('userMessage.selectedFileReadLines', {
                  count: file.lineCount,
                  defaultValue: 'Read {{count}} lines'
                })

          return (
            <div
              key={`${file.path}-${index}`}
              className="flex min-w-0 items-center gap-2 rounded-md border border-border/50 bg-background/45 px-2 py-1.5"
              title={file.error || skippedDescription || file.readPath || file.path}
            >
              {file.error ? (
                <AlertCircle className="size-3.5 shrink-0 text-amber-500" />
              ) : skipped ? (
                <FileText className="size-3.5 shrink-0 text-blue-500" />
              ) : (
                <FileText className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium text-foreground/90">
                  {file.name}
                </div>
                <div className="truncate font-mono text-[10px] text-muted-foreground">
                  {file.path}
                </div>
              </div>
              <span
                className={cn(
                  'shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium tabular-nums',
                  skipped
                    ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                    : file.error
                    ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                    : file.truncated
                      ? 'bg-blue-500/10 text-blue-700 dark:text-blue-300'
                      : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                )}
              >
                {status}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export async function copyImageSourceToClipboard(src: string): Promise<void> {
  if (src.startsWith('data:')) {
    await writeImageDataUrlToClipboard(src)
    return
  }

  const response = await fetch(src)
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`)
  await writeImageBlobToClipboard(await response.blob())
}

async function copyImageAttachmentToClipboard(image: ImageAttachment): Promise<void> {
  await copyImageSourceToClipboard(image.dataUrl)
}

export function UserImageAttachmentView({
  image,
  variant,
  onPreview,
  onRemove
}: {
  image: ImageAttachment
  variant: 'edit' | 'display'
  onPreview?: (src: string) => void
  onRemove?: (id: string) => void
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [copied, setCopied] = useState(false)

  const copyImage = useCallback(async (): Promise<void> => {
    try {
      await copyImageAttachmentToClipboard(image)
      setCopied(true)
      toast.success(t('userMessage.imageCopied'))
      window.setTimeout(() => setCopied(false), 1500)
    } catch (error) {
      console.error('[UserMessage] Copy image failed:', error)
      toast.error(t('userMessage.copyImageFailed'))
    }
  }, [image, t])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>): void => {
      if (
        !event.metaKey &&
        !event.ctrlKey &&
        onPreview &&
        (event.key === 'Enter' || event.key === ' ')
      ) {
        event.preventDefault()
        onPreview(image.dataUrl)
        return
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c') return
      event.preventDefault()
      event.stopPropagation()
      void copyImage()
    },
    [copyImage, image.dataUrl, onPreview]
  )

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={t('userMessage.imageAttachment')}
      className={cn(
        'group/img relative shrink-0 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring',
        variant === 'display' && 'cursor-zoom-in'
      )}
      onClick={() => onPreview?.(image.dataUrl)}
      onKeyDown={handleKeyDown}
      title={t('userMessage.copyImageShortcut')}
    >
      <img
        src={image.dataUrl}
        alt=""
        className={
          variant === 'edit'
            ? 'size-16 rounded-lg border border-border/60 object-cover shadow-sm'
            : 'max-h-[180px] max-w-[240px] rounded-lg border border-border/60 object-contain shadow-sm transition-shadow group-hover/img:shadow-md'
        }
      />
      <button
        type="button"
        className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md border border-border/50 bg-background/90 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground group-hover/img:opacity-100 group-focus-within/img:opacity-100"
        aria-label={copied ? t('userMessage.imageCopied') : t('userMessage.copyImage')}
        title={copied ? t('userMessage.imageCopied') : t('userMessage.copyImage')}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void copyImage()
        }}
      >
        {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
      </button>
      {onRemove && (
        <button
          type="button"
          className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground opacity-0 shadow-md transition-opacity group-hover/img:opacity-100 group-focus-within/img:opacity-100"
          aria-label={t('userMessage.removeImage')}
          title={t('userMessage.removeImage')}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            onRemove(image.id)
          }}
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}

