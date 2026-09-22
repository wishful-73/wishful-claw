import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@renderer/components/ui/dropdown-menu'
import { Pencil, Check, Copy, Ellipsis, Volume2, Share2, ChevronsUpDown, ChevronsDownUp, CornerDownRight } from 'lucide-react'
import { formatTokens } from '@renderer/lib/format-tokens'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { isSpeechSupported, speakMessage } from '@renderer/lib/speech'
import { useMemoizedTokens } from '@renderer/hooks/use-estimated-tokens'
import type { ContentBlock, MessageMeta, UnifiedMessage } from '@renderer/lib/api/types'
import {
  extractEditableUserMessageDraft,
  type EditableUserMessageDraft
} from '@renderer/lib/image-attachments'
import { expandPastedBlocks, selectFileTextToPlainText } from '@renderer/lib/select-file-tags'
import { SystemCommandCard } from './SystemCommandCard'
import { SelectFileInlineText } from './SelectFileInlineText'

interface UserMessageProps {
  messageId: string
  content: string | ContentBlock[]
  meta?: MessageMeta
  source?: UnifiedMessage['source']
  isLast?: boolean
  createdAt?: number
  compact?: boolean
  onClick?: () => void
  onEdit?: (messageId: string, draft: EditableUserMessageDraft) => void
}
import { ActionIconButton, UserSkillBadge, parseUserSkillDirective, USER_MESSAGE_WIDTH_CLASS, USER_MESSAGE_BUBBLE_CLASS } from './user-message-helpers'
import { UserSelectedFileReadsView, UserImageAttachmentView, copyImageSourceToClipboard } from './user-message-views'

export function UserMessage({
  messageId,
  content,
  meta,
  source,
  createdAt,
  compact = false,
  onClick,
  onEdit
}: UserMessageProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const currentDraft = useMemo(() => extractEditableUserMessageDraft(content), [content])
  const plainText = currentDraft.text
  const allImages = currentDraft.images
  const command = currentDraft.command
  const skillDirective = useMemo(() => parseUserSkillDirective(plainText), [plainText])
  const displayText = skillDirective?.body ?? plainText
  // T-13: `displayText` keeps the `<pasted-block>` chips for the transcript;
  // every consumer that needs what the user actually wrote (copy, edit, read
  // aloud, token estimate) works on the expanded text instead.
  const expandedText = useMemo(() => expandPastedBlocks(displayText), [displayText])
  const copyBodyText = selectFileTextToPlainText(expandedText)
  const copyText = command
    ? `/${command.name}${copyBodyText ? ` ${copyBodyText}` : ''}`
    : skillDirective
      ? [`[Skill: ${skillDirective.name}]`, copyBodyText].filter(Boolean).join('\n')
      : copyBodyText

  const memoizedTokens = useMemoizedTokens(expandedText)

  const [collapsed, setCollapsed] = useState(false)
  const [copied, setCopied] = useState(false)
  const [previewCopied, setPreviewCopied] = useState(false)
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null)

  // 编辑 = 把这条消息的内容回填到底部输入框（追加），不截断、不自动重发。
  // 前缀要对齐 copyText：命令 `/名字 正文`、技能 `[Skill: 名字]\n正文`、普通为展开正文。
  const handleStartEdit = useCallback((): void => {
    onEdit?.(messageId, { text: copyText, images: allImages, command })
  }, [allImages, command, copyText, messageId, onEdit])

  const handleCopy = useCallback((): void => {
    navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [copyText])

  const handleSpeak = useCallback((): void => {
    const text = expandedText.trim()
    if (!text) return
    if (!isSpeechSupported()) {
      toast.error(t('messageActions.speechNotSupported'))
      return
    }
    // 在回调里读最新设置：音色 / 语速随时可改，不必让每条消息都订阅一遍。
    const { speechVoice, speechRate, speechPitch } = useSettingsStore.getState()
    speakMessage(text, {
      voice: speechVoice ?? '',
      rate: speechRate ?? 1,
      pitch: speechPitch ?? 1
    })
  }, [expandedText, t])

  const handleShare = useCallback(async (): Promise<void> => {
    const text = expandedText.trim()
    if (!text) return
    try {
      if (navigator.share) {
        await navigator.share({ text })
        return
      }
      await navigator.clipboard.writeText(text)
      toast.success(t('messageActions.copiedForShare'))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      toast.error(t('messageActions.shareFailed'))
    }
  }, [expandedText, t])

  const handleCopyPreviewImage = useCallback(async (): Promise<void> => {
    if (!previewImageSrc) return

    try {
      await copyImageSourceToClipboard(previewImageSrc)
      setPreviewCopied(true)
      toast.success(t('userMessage.imageCopied'))
      window.setTimeout(() => setPreviewCopied(false), 1500)
    } catch (error) {
      console.error('[UserMessage] Copy preview image failed:', error)
      toast.error(t('userMessage.copyImageFailed'))
    }
  }, [previewImageSrc, t])

  return (
    <div
      className="group/user flex flex-col items-end"
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <div className={USER_MESSAGE_WIDTH_CLASS}>
        {source === 'quoted' && (
          <div className="mb-1 flex justify-end pr-1">
            <span className="inline-flex items-center gap-1 text-[11px] leading-none text-muted-foreground/70">
              <CornerDownRight className="size-3" />
              {t('userMessage.quotedLabel', { defaultValue: 'Quoted' })}
            </span>
          </div>
        )}
        {collapsed ? (
          <div
            className={`${USER_MESSAGE_BUBBLE_CLASS} ml-auto w-fit max-w-full text-xs text-muted-foreground`}
          >
            <div className="max-h-10 overflow-hidden whitespace-pre-wrap break-words">
              {expandedText.trim()
                ? expandedText.trim()
                : skillDirective
                  ? `${t('userMessage.skillLabel')}: ${skillDirective.name}`
                  : t('messageActions.imagesCollapsed', {
                      count: allImages.length,
                      defaultValue: `${allImages.length} images`
                    })}
            </div>
          </div>
        ) : (
          <div className={`${USER_MESSAGE_BUBBLE_CLASS} ml-auto w-fit max-w-full`}>
            {command && <SystemCommandCard command={command} />}
            {skillDirective && <UserSkillBadge name={skillDirective.name} />}
            {displayText && (
              <div className="text-sm leading-relaxed">
                <SelectFileInlineText text={displayText} />
              </div>
            )}
            <UserSelectedFileReadsView reads={meta?.selectedFileReads} />
            {allImages.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {allImages.map((img) => (
                  <UserImageAttachmentView
                    key={img.id}
                    image={img}
                    variant="display"
                    onPreview={setPreviewImageSrc}
                  />
                ))}
              </div>
            )}

            <Dialog
              open={Boolean(previewImageSrc)}
              onOpenChange={(open) => {
                if (!open) setPreviewImageSrc(null)
              }}
            >
              <DialogContent className="max-h-[90vh] !w-fit !max-w-[min(96vw,1100px)] overflow-hidden p-2 sm:!max-w-[min(96vw,1100px)]">
                <DialogTitle className="sr-only">{t('userMessage.imagePreview')}</DialogTitle>
                {previewImageSrc && (
                  <div
                    tabIndex={0}
                    className="relative flex max-w-full items-center justify-center overflow-hidden outline-none"
                    onKeyDown={(event) => {
                      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'c') {
                        return
                      }
                      event.preventDefault()
                      event.stopPropagation()
                      void handleCopyPreviewImage()
                    }}
                    title={t('userMessage.copyImageShortcut')}
                  >
                    <button
                      type="button"
                      className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-md border border-border/50 bg-background/90 text-muted-foreground shadow-sm transition-colors hover:text-foreground"
                      aria-label={
                        previewCopied ? t('userMessage.imageCopied') : t('userMessage.copyImage')
                      }
                      title={
                        previewCopied ? t('userMessage.imageCopied') : t('userMessage.copyImage')
                      }
                      onClick={() => void handleCopyPreviewImage()}
                    >
                      {previewCopied ? (
                        <Check className="size-4 text-green-500" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                    <img
                      src={previewImageSrc}
                      alt={t('userMessage.imagePreview')}
                      className="block h-auto max-h-[calc(90vh-3rem)] w-auto max-w-[min(92vw,1068px)] rounded object-contain"
                    />
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        )}
        {!compact && createdAt && (
          <p className="mt-1 pr-1 text-right text-[10px] text-muted-foreground/50 tabular-nums">
            {new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {!compact && expandedText.length > 50 && (
          <p className="mt-1 pr-1 text-right text-[10px] text-muted-foreground/0 transition-colors tabular-nums group-hover/user:text-muted-foreground/40">
            {formatTokens(memoizedTokens)} {t('unit.tokens', { ns: 'common' })}
          </p>
        )}
        {!compact && (
          <div className="mt-2 flex w-full items-center justify-end gap-1 opacity-0 transition-opacity group-hover/user:opacity-100">
            <ActionIconButton
              label={copied ? t('userMessage.copied') : t('action.copy', { ns: 'common' })}
              icon={copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              onClick={handleCopy}
            />
            {onEdit && (
              <ActionIconButton
                label={t('userMessage.edit')}
                icon={<Pencil className="size-3.5" />}
                onClick={handleStartEdit}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('action.showMore', { ns: 'common' })}
                  title={t('action.showMore', { ns: 'common' })}
                  className="flex size-7 items-center justify-center rounded-md border border-border/50 bg-background/80 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
                >
                  <Ellipsis className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={handleCopy}>
                  <Copy className="size-4" />
                  {t('action.copy', { ns: 'common' })}
                </DropdownMenuItem>
                {onEdit && (
                  <DropdownMenuItem onSelect={handleStartEdit}>
                    <Pencil className="size-4" />
                    {t('userMessage.edit')}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={handleSpeak} disabled={!expandedText.trim()}>
                  <Volume2 className="size-4" />
                  {t('messageActions.readAloud')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void handleShare()}
                  disabled={!expandedText.trim()}
                >
                  <Share2 className="size-4" />
                  {t('messageActions.share')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setCollapsed((value) => !value)}>
                  {collapsed ? (
                    <ChevronsDownUp className="size-4" />
                  ) : (
                    <ChevronsUpDown className="size-4" />
                  )}
                  {collapsed ? t('messageActions.expand') : t('messageActions.collapse')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}
