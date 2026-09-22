import * as React from 'react'
import { useTranslation } from 'react-i18next'
import Markdown, { type Components } from 'react-markdown'
import { FileCode } from 'lucide-react'
import {
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  openMarkdownHref
} from '@renderer/lib/preview/viewers/markdown-components'
import { MONO_FONT } from '@renderer/lib/constants'
import type { ImageBlock, TextBlock, ToolResultContent } from '@renderer/lib/api/types'
import { ImagePreview } from '../../ImagePreview'
import { LazySyntaxHighlighter } from '../../LazySyntaxHighlighter'
import {
  CopyBtn
} from '../shared'
import { getImageBlockPreviewSrc } from '../utils'
import {
  detectLang
} from '../utils'
import { stripReadLineNumbers } from '../utils'

// ── ImageOutputBlock ──

export function ImageOutputBlock({ output }: { output: ToolResultContent }): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  if (!Array.isArray(output)) return null
  const images = output.filter((b): b is ImageBlock => b.type === 'image')
  const notes = output.filter((b): b is TextBlock => b.type === 'text' && b.text.trim().length > 0)
  if (images.length === 0) return null
  return (
    <div className="space-y-3">
      {images.map((img, i) => {
        const src = getImageBlockPreviewSrc(img)
        if (!src && !img.source.filePath) return null
        return (
          <div
            key={`${img.source.filePath ?? img.source.url ?? img.source.data?.slice(0, 48) ?? i}-${i}`}
          >
            <div className="mb-1 flex items-center gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">{t('toolCall.image')}</p>
              <span className="text-[9px] text-muted-foreground/55">{img.source.mediaType}</span>
            </div>
            <ImagePreview src={src} alt="Tool output" filePath={img.source.filePath} />
          </div>
        )
      })}
      {notes.length > 0 && (
        <div className="space-y-1">
          {notes.map((note, index) => (
            <p
              key={`${note.text}-${index}`}
              className="rounded-md bg-muted/20 px-2.5 py-2 text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-words"
            >
              {note.text}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// ── MarkdownOutputBlock ──

/**
 * 工具输出里的链接必须自己接住。react-markdown 默认渲染的 `<a href>` 点在 Electron
 * 主窗口上就是**当前帧导航** —— 主进程只拦了 window.open（setWindowOpenHandler），
 * 没有 will-navigate 兜底，于是一条 `http://localhost:3000` 的输出被点一下，整个应用
 * 就变成那个网页。归宿与正文一致：走 openMarkdownHref（网址 → 右侧浏览器面板，
 * 本地路径 → 预览面板）。
 */
const TOOL_OUTPUT_MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-primary underline underline-offset-2 hover:text-primary/80 break-all"
      onClick={(event) => {
        if (!href || href.startsWith('#')) return
        if (openMarkdownHref(href)) event.preventDefault()
      }}
    >
      {children}
    </a>
  )
}

export function MarkdownOutputBlock({ output }: { output: string }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [expanded, setExpanded] = React.useState(false)
  const isLong = output.length > 800 || output.split('\n').length > 16
  return (
    <div>
      <div className="mb-1 flex items-center">
        <p className="text-xs font-medium text-muted-foreground">{t('toolCall.output')}</p>
        <CopyBtn text={output} />
      </div>
      <div
        className={`overflow-auto rounded-md border border-border/50 bg-muted/10 px-3 py-2 ${
          isLong && !expanded ? 'max-h-48' : 'max-h-[480px]'
        }`}
      >
        <div className="prose prose-sm dark:prose-invert max-w-none text-xs prose-headings:mb-1.5 prose-headings:mt-3 prose-headings:text-sm prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-pre:bg-muted prose-pre:px-2.5 prose-pre:py-2 prose-code:before:content-none prose-code:after:content-none">
          <Markdown
            remarkPlugins={MARKDOWN_REMARK_PLUGINS}
            rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
            components={TOOL_OUTPUT_MARKDOWN_COMPONENTS}
          >
            {output}
          </Markdown>
        </div>
      </div>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded
            ? t('action.showLess', { ns: 'common' })
            : t('toolCall.showAll', { chars: output.length, lines: output.split('\n').length })}
        </button>
      )}
    </div>
  )
}

// ── OutputBlock (generic) ──

export function OutputBlock({ output }: { output: string }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [expanded, setExpanded] = React.useState(false)
  const isLong = output.length > 500
  const displayed = isLong && !expanded ? output.slice(0, 500) + '…' : output
  return (
    <div>
      <div className="mb-1 flex items-center">
        <p className="text-xs font-medium text-muted-foreground">{t('toolCall.output')}</p>
        <CopyBtn text={output} />
      </div>
      <pre
        className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs font-mono"
        style={{ fontFamily: MONO_FONT }}
      >
        {displayed}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded
            ? t('action.showLess', { ns: 'common' })
            : t('toolCall.showAll', { chars: output.length, lines: output.split('\n').length })}
        </button>
      )}
    </div>
  )
}

// ── ReadOutputBlock ──

export function ReadOutputBlock({
  output,
  filePath
}: {
  output: string
  filePath: string
}): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [expanded, setExpanded] = React.useState(false)
  const rawContent = stripReadLineNumbers(output)
  const lines = rawContent.split('\n')
  const isLong = lines.length > 40
  const displayed = isLong && !expanded ? lines.slice(0, 40).join('\n') : rawContent
  const lang = detectLang(filePath)
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <FileCode className="size-3 text-blue-500 dark:text-blue-400" />
        <span
          className="cursor-pointer truncate text-xs font-medium text-sky-600 transition-colors hover:text-sky-700 dark:text-muted-foreground dark:hover:text-blue-400"
          title={t('toolCall.clickToInsert', { path: filePath })}
          onClick={() => {
            const short = filePath.split(/[\\/]/).slice(-2).join('/')
            import('@renderer/stores/ui-store').then(({ useUIStore }) =>
              useUIStore.getState().setPendingInsertText(short)
            )
          }}
        >
          {filePath.split(/[\\/]/).slice(-2).join('/')}
        </span>
        <span className="text-[9px] text-muted-foreground/55 font-mono">
          {lang} · {t('toolCall.lineCount', { count: lines.length })}
        </span>
        <CopyBtn text={rawContent} />
      </div>
      <LazySyntaxHighlighter
        language={lang}
        showLineNumbers
        customStyle={{
          margin: 0,
          padding: '0.5rem',
          borderRadius: '0.375rem',
          fontSize: '11px',
          maxHeight: '300px',
          overflow: 'auto',
          fontFamily: MONO_FONT
        }}
        codeTagProps={{ style: { fontFamily: 'inherit' } }}
      >
        {displayed}
      </LazySyntaxHighlighter>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {expanded
            ? t('toolCall.showFirst40')
            : t('toolCall.showAllLines', { count: lines.length })}
        </button>
      )}
    </div>
  )
}
