import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@renderer/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@renderer/components/ui/dropdown-menu'
import { useProviderStore, modelSupportsVision } from '@renderer/stores/provider-store'
import { Pencil, Check, X, Copy, ImagePlus, Trash2, Ellipsis, Languages, Volume2, Share2, ChevronsUpDown, ChevronsDownUp, CornerDownRight } from 'lucide-react'
import { formatTokens } from '@renderer/lib/format-tokens'
import { useMemoizedTokens } from '@renderer/hooks/use-estimated-tokens'
import type {
  AIModelConfig,
  ContentBlock,
  MessageMeta,
  UnifiedMessage
} from '@renderer/lib/api/types'
import {
  ACCEPTED_IMAGE_TYPES,
  cloneImageAttachments,
  extractEditableUserMessageDraft,
  fileToImageAttachment,
  hasEditableDraftContent,
  type EditableUserMessageDraft,
  type ImageAttachment
} from '@renderer/lib/image-attachments'
import { selectFileTextToPlainText } from '@renderer/lib/select-file-tags'
import { useTranslateStore } from '@renderer/stores/translate-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSkillsStore } from '@renderer/stores/skills-store'
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
  onDelete?: (messageId: string) => void
}
import { ActionIconButton, UserSkillBadge, parseUserSkillDirective, USER_MESSAGE_WIDTH_CLASS, USER_MESSAGE_BUBBLE_CLASS, serializeUserSkillDirective } from './user-message-helpers'
import { UserSelectedFileReadsView, UserSkillEditControl, UserImageAttachmentView } from './user-message-views'
import { copyImageSourceToClipboard } from './user-message-views'

export function UserMessage({
  messageId,
  content,
  meta,
  source,
  createdAt,
  compact = false,
  onClick,
  onEdit,
  onDelete
}: UserMessageProps): React.JSX.Element {
  const { t } = useTranslation('chat')
  const currentDraft = useMemo(() => extractEditableUserMessageDraft(content), [content])
  const plainText = currentDraft.text
  const allImages = currentDraft.images
  const command = currentDraft.command
  const skillDirective = useMemo(() => parseUserSkillDirective(plainText), [plainText])
  const displayText = skillDirective?.body ?? plainText
  const copyBodyText = selectFileTextToPlainText(displayText)
  const copyText = command
    ? `/${command.name}${copyBodyText ? ` ${copyBodyText}` : ''}`
    : skillDirective
      ? [`[Skill: ${skillDirective.name}]`, copyBodyText].filter(Boolean).join('\n')
      : copyBodyText

  const displayFullText = skillDirective ? displayText : plainText
  const memoizedTokens = useMemoizedTokens(displayFullText)

  const activeProvider = useProviderStore((s) => {
    const { providers, activeProviderId } = s
    if (!activeProviderId) return null
    return providers.find((provider: any) => provider.id === activeProviderId) ?? null
  })
  const activeModelId = useProviderStore((s) => s.activeModelId)
  const supportsVision = useMemo(() => {
    if (!activeProvider) return false
    const model = activeProvider.models.find((item: any) => item.id === activeModelId)
    return modelSupportsVision(model as AIModelConfig | undefined, activeProvider.type)
  }, [activeModelId, activeProvider])
  const openTranslatePage = useUIStore((s) => s.openTranslatePage)
  const setTranslateSourceText = useTranslateStore((s) => s.setSourceText)
  const availableSkills = useSkillsStore((s) => s.skills)
  const skillsLoading = useSkillsStore((s) => s.loading)
  const loadSkills = useSkillsStore((s) => s.loadSkills)

  const [editing, setEditing] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [editText, setEditText] = useState(displayText)
  const [editSkillName, setEditSkillName] = useState(skillDirective?.name ?? '')
  const [editImages, setEditImages] = useState<ImageAttachment[]>(() =>
    cloneImageAttachments(allImages)
  )
  const [copied, setCopied] = useState(false)
  const [previewCopied, setPreviewCopied] = useState(false)
  const [previewImageSrc, setPreviewImageSrc] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus()
      textareaRef.current.selectionStart = textareaRef.current.value.length
    }
  }, [editing])

  useEffect(() => {
    if (editing) {
      void loadSkills()
    }
  }, [editing, loadSkills])

  const nextDraft = useMemo<EditableUserMessageDraft>(() => {
    const skillName = editSkillName.trim()
    return {
      text: skillName ? serializeUserSkillDirective(skillName, editText) : editText.trim(),
      images: cloneImageAttachments(editImages),
      command
    }
  }, [command, editImages, editSkillName, editText])
  const canSave = hasEditableDraftContent(nextDraft)

  const handleStartEdit = (): void => {
    setEditText(displayText)
    setEditSkillName(skillDirective?.name ?? '')
    setEditImages(cloneImageAttachments(allImages))
    setEditing(true)
  }

  const handleSave = (): void => {
    if (!canSave || !onEdit) return
    onEdit(messageId, nextDraft)
    setEditing(false)
  }

  const handleCancel = (): void => {
    setEditText(displayText)
    setEditSkillName(skillDirective?.name ?? '')
    setEditImages(cloneImageAttachments(allImages))
    setEditing(false)
  }

  const handleCopy = useCallback((): void => {
    navigator.clipboard.writeText(copyText)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }, [copyText])

  const handleTranslate = useCallback((): void => {
    const text = displayText.trim()
    if (!text) return
    setTranslateSourceText(text)
    openTranslatePage()
    toast.success(t('messageActions.sentToTranslator'))
  }, [displayText, openTranslatePage, setTranslateSourceText, t])

  const handleSpeak = useCallback((): void => {
    const text = displayText.trim()
    if (!text) return
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      toast.error(t('messageActions.speechNotSupported'))
      return
    }
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = /[\u4e00-\u9fff]/.test(text) ? 'zh-CN' : 'en-US'
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }, [displayText, t])

  const handleShare = useCallback(async (): Promise<void> => {
    const text = displayText.trim()
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
  }, [displayText, t])

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

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape') {
      handleCancel()
    }
  }

  const addImages = async (files: File[]): Promise<void> => {
    const results = await Promise.all(files.map(fileToImageAttachment))
    const valid = results.filter(Boolean) as ImageAttachment[]
    if (valid.length > 0) {
      setEditImages((prev) => [...prev, ...valid])
    }
  }

  const removeImage = (id: string): void => {
    setEditImages((prev) => prev.filter((img) => img.id !== id))
  }

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
        {!editing && source === 'quoted' && (
          <div className="mb-1 flex justify-end pr-1">
            <span className="inline-flex items-center gap-1 text-[11px] leading-none text-muted-foreground/70">
              <CornerDownRight className="size-3" />
              {t('userMessage.quotedLabel', { defaultValue: 'Quoted' })}
            </span>
          </div>
        )}
        {editing ? (
          <div className={`${USER_MESSAGE_BUBBLE_CLASS} space-y-2`}>
            {command && (
              <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-violet-700 dark:text-violet-300">
                <span className="font-medium">/{command.name}</span>
              </div>
            )}
            <UserSkillEditControl
              name={editSkillName}
              skills={availableSkills}
              loading={skillsLoading}
              onChange={setEditSkillName}
              onOpen={loadSkills}
            />
            <textarea
              ref={textareaRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={handleKeyDown}
              className="min-h-[60px] w-full resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              rows={Math.min(editText.split('\n').length + 1, 8)}
            />
            {editImages.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {editImages.map((img) => (
                  <UserImageAttachmentView
                    key={img.id}
                    image={img}
                    variant="edit"
                    onRemove={removeImage}
                  />
                ))}
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES.join(',')}
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files) {
                  void addImages(Array.from(e.target.files))
                }
                e.target.value = ''
              }}
            />
            <div className="flex flex-wrap items-center gap-1.5">
              {supportsVision && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-6 gap-1 px-2 text-xs"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <ImagePlus className="size-3" />
                  {t('input.attachImages')}
                </Button>
              )}
              <Button
                size="sm"
                className="h-6 gap-1 px-2 text-xs"
                onClick={handleSave}
                disabled={!canSave}
              >
                <Check className="size-3" />
                {t('userMessage.saveAndResend')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 gap-1 px-2 text-xs"
                onClick={handleCancel}
              >
                <X className="size-3" />
                {t('action.cancel', { ns: 'common' })}
              </Button>
            </div>
          </div>
        ) : collapsed ? (
          <div
            className={`${USER_MESSAGE_BUBBLE_CLASS} ml-auto w-fit max-w-full text-xs text-muted-foreground`}
          >
            <div className="max-h-10 overflow-hidden whitespace-pre-wrap break-words">
              {displayText.trim()
                ? displayText.trim()
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
                      className="block h-auto max-h-[calc(90vh-1rem)] w-auto max-w-[min(92vw,1068px)] rounded object-contain"
                    />
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </div>
        )}
        {!compact && !editing && createdAt && (
          <p className="mt-1 pr-1 text-right text-[10px] text-muted-foreground/50 tabular-nums">
            {new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {!compact && !editing && displayText.length > 50 && (
          <p className="mt-1 pr-1 text-right text-[10px] text-muted-foreground/0 transition-colors tabular-nums group-hover/user:text-muted-foreground/40">
            {formatTokens(memoizedTokens)} {t('unit.tokens', { ns: 'common' })}
          </p>
        )}
        {!compact && !editing && (
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
                <DropdownMenuItem onSelect={handleTranslate} disabled={!displayText.trim()}>
                  <Languages className="size-4" />
                  {t('messageActions.translate')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleSpeak} disabled={!displayText.trim()}>
                  <Volume2 className="size-4" />
                  {t('messageActions.readAloud')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => void handleShare()}
                  disabled={!displayText.trim()}
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
                {onDelete && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => onDelete(messageId)}>
                      <Trash2 className="size-4" />
                      {t('action.delete', { ns: 'common' })}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
    </div>
  )
}
