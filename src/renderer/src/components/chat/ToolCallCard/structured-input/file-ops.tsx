/**
 * 文件类工具（读 / 编辑 / 写 / 保存计划 / 列目录）的入参陈列。
 *
 * S-250 从 `structured-input.tsx` 搬出，JSX 与类名逐字平移。
 */

import { useTranslation } from 'react-i18next'
import { MONO_FONT } from '@renderer/lib/constants'
import { FileCode, Folder } from 'lucide-react'
import { detectLang, lineCount } from '../../FileChangeCard/utils'
import { EditPayloadPane } from '../input-renderers'

export function ReadPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const filePath = String(input.file_path ?? input.path ?? '')
  const offset = input.offset != null ? String(input.offset) : null
  const limit = input.limit != null ? String(input.limit) : null
  return (
    <div className="space-y-0.5">
      <div className="flex items-center gap-1.5 text-xs">
        <FileCode className="size-3 text-blue-400" />
        <span className="font-mono text-[11px] break-all" style={{ fontFamily: MONO_FONT }}>
          {filePath}
        </span>
      </div>
      {(offset || limit) && (
        <div className="flex items-center gap-2 pl-[18px]">
          {offset && (
            <span className="text-[10px] text-muted-foreground/55">offset: {offset}</span>
          )}
          {limit && <span className="text-[10px] text-muted-foreground/55">limit: {limit}</span>}
        </div>
      )}
    </div>
  )
}

export function EditPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const filePath = String(input.file_path ?? input.path ?? '')
  const explanation = input.explanation ? String(input.explanation) : null
  const oldStr = typeof input.old_string === 'string' ? input.old_string : ''
  const newStr = typeof input.new_string === 'string' ? input.new_string : ''
  const oldPreview = typeof input.old_string_preview === 'string' ? input.old_string_preview : ''
  const newPreview = typeof input.new_string_preview === 'string' ? input.new_string_preview : ''
  const replaceAll = input.replace_all === true
  const visibleOld = oldStr || oldPreview
  const visibleNew = newStr || newPreview
  const oldTruncated = !oldStr && !!oldPreview
  const newTruncated = !newStr && !!newPreview
  const oldLineTotal =
    typeof input.old_string_lines === 'number'
      ? input.old_string_lines
      : visibleOld
        ? lineCount(visibleOld)
        : null
  const newLineTotal =
    typeof input.new_string_lines === 'number'
      ? input.new_string_lines
      : visibleNew
        ? lineCount(visibleNew)
        : null
  const oldCharTotal = typeof input.old_string_chars === 'number' ? input.old_string_chars : null
  const newCharTotal = typeof input.new_string_chars === 'number' ? input.new_string_chars : null

  return (
    <div className="space-y-1">
      {filePath && (
        <div className="flex items-center gap-1.5 text-xs">
          <FileCode className="size-3 text-amber-500 dark:text-amber-400" />
          <span className="font-mono text-[11px] break-all" style={{ fontFamily: MONO_FONT }}>
            {filePath}
          </span>
          {replaceAll && (
            <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-600/80 dark:text-amber-400/80">
              replace_all
            </span>
          )}
        </div>
      )}
      {explanation && (
        <p className="pl-[18px] text-[11px] text-muted-foreground/60">{explanation}</p>
      )}
      {(oldLineTotal !== null ||
        newLineTotal !== null ||
        oldCharTotal !== null ||
        newCharTotal !== null) && (
        <div className="pl-[18px] text-[10px] text-muted-foreground/55">
          {t('toolCall.lineDelta', {
            old: oldLineTotal !== null ? oldLineTotal : '?',
            next: newLineTotal !== null ? newLineTotal : '?'
          })}
          {(oldCharTotal !== null || newCharTotal !== null) && (
            <>
              {' · '}
              {t('toolCall.charDelta', {
                old: oldCharTotal !== null ? oldCharTotal : '?',
                next: newCharTotal !== null ? newCharTotal : '?'
              })}
            </>
          )}
        </div>
      )}
      {(visibleOld || visibleNew) && (
        <div className="space-y-2 pl-[18px]">
          {visibleOld && (
            <EditPayloadPane
              label="old_string"
              value={visibleOld}
              language={detectLang(filePath)}
              tone="old"
              truncated={oldTruncated}
            />
          )}
          {visibleNew && (
            <EditPayloadPane
              label="new_string"
              value={visibleNew}
              language={detectLang(filePath)}
              tone="new"
              truncated={newTruncated}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * 写入类工具。带完整 content 时不渲染（由 FileChangeCard 走差异视图），
 * 只渲染省略态或预览态 —— 这是原分支的既有行为，保持不动。
 */
export function WritePane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const filePath = String(input.file_path ?? input.path ?? '')
  const content = typeof input.content === 'string' ? input.content : null
  const preview = typeof input.content_preview === 'string' ? input.content_preview : null
  const lineTotal =
    typeof input.content_lines === 'number'
      ? input.content_lines
      : content !== null
        ? lineCount(content)
        : null
  const charTotal =
    typeof input.content_chars === 'number'
      ? input.content_chars
      : content !== null
        ? content.length
        : null
  const visiblePreview = content ?? preview

  return (
    <div className="space-y-1">
      {filePath && (
        <div className="flex items-center gap-1.5 text-xs">
          <FileCode className="size-3 text-emerald-500 dark:text-green-400" />
          <span className="font-mono text-[11px] break-all" style={{ fontFamily: MONO_FONT }}>
            {filePath}
          </span>
        </div>
      )}
      {(lineTotal !== null || charTotal !== null) && (
        <div className="pl-[18px] text-[10px] text-muted-foreground/55">
          {lineTotal !== null ? t('toolCall.lineCount', { count: lineTotal }) : ''}
          {lineTotal !== null && charTotal !== null ? ' · ' : ''}
          {charTotal !== null ? t('toolCall.charCount', { count: charTotal }) : ''}
        </div>
      )}
      {visiblePreview && (
        <pre
          className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-zinc-50 px-2.5 py-2 text-[11px] text-foreground/80 dark:bg-zinc-950 dark:text-zinc-300/80"
          style={{ fontFamily: MONO_FONT }}
        >
          {visiblePreview}
          {input.content_truncated ? '\n…' : ''}
        </pre>
      )}
    </div>
  )
}

export function SavePlanPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const preview =
    (typeof input.content_preview === 'string' && input.content_preview) ||
    (typeof input.content === 'string' && input.content) ||
    ''
  if (!preview) return <></>
  return (
    <div className="space-y-1">
      <pre
        className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border/70 bg-zinc-50 px-2.5 py-2 text-[11px] text-foreground/80 dark:bg-zinc-950 dark:text-zinc-300/80"
        style={{ fontFamily: MONO_FONT }}
      >
        {preview}
      </pre>
    </div>
  )
}

export function LsPane({ input }: { input: Record<string, unknown> }): React.JSX.Element {
  const path = String(input.path ?? '')
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Folder className="size-3 text-amber-400" />
      <span className="font-mono text-[11px]" style={{ fontFamily: MONO_FONT }}>
        {path}
      </span>
    </div>
  )
}
