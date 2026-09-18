// Markdown rendering: code blocks, mermaid, streaming markdown content

import * as React from 'react'
import { useState, useCallback } from 'react'
import Markdown, { type Components } from 'react-markdown'
import { Check, ImageDown, ZoomIn } from 'lucide-react'
import {
  applyMermaidTheme, copyMermaidToClipboard, useMermaidThemeVersion
} from '@renderer/lib/utils/mermaid-theme'
import { LazySyntaxHighlighter } from '../LazySyntaxHighlighter'
import { MONO_FONT } from '@renderer/lib/constants'
import {
  CHAT_REHYPE_PLUGINS, MARKDOWN_REMARK_PLUGINS,
  resolveLocalFilePath, openMarkdownHref
} from '@renderer/lib/preview/viewers/markdown-components'
import { LocalPathCode } from './LocalPathCode'
import { useStreamingRenderPool } from '@renderer/hooks/use-typewriter'
import { useStreamingMarkdownBlocks } from '@renderer/hooks/use-streaming-markdown-blocks'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { CopyButton } from './ui-buttons'
import { useEffect, useId } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/components/ui/dialog'

function MermaidImageCopyButton({ svg }: { svg: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const handleCopy = useCallback(async () => {
    if (!svg.trim()) return
    setBusy(true)
    try {
      await copyMermaidToClipboard(svg)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('[Mermaid] Copy image failed:', err)
    } finally {
      setBusy(false)
    }
  }, [svg])

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      disabled={busy || !svg.trim()}
      title="Copy Mermaid diagram to clipboard"
      className="flex items-center rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
    >
      {copied ? <Check className="size-3" /> : <ImageDown className="size-3" />}
      <span>{copied ? 'Copied' : 'Download'}</span>
    </button>
  )
}

function MermaidCodeBlock({ code }: { code: string }): React.JSX.Element {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  const [zoomOpen, setZoomOpen] = useState(false)
  const diagramKey = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const themeVersion = useMermaidThemeVersion()

  useEffect(() => {
    let cancelled = false

    async function renderDiagram(): Promise<void> {
      const source = code.trim()
      if (!source) {
        setSvg('')
        setError('')
        return
      }
      try {
        const mermaid = await applyMermaidTheme()
        const result = await mermaid.render(`mermaid-chat-${diagramKey}-${Date.now()}`, source)
        if (cancelled) return
        setSvg(result.svg)
        setError('')
      } catch (err) {
        if (cancelled) return
        setSvg('')
        setError(err instanceof Error ? err.message : 'Failed to render Mermaid diagram.')
      }
    }

    void renderDiagram()
    return () => {
      cancelled = true
    }
  }, [code, diagramKey, themeVersion])

  return (
    <div className="group relative my-3 overflow-hidden rounded-lg border border-border/60 shadow-sm">
      <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-3 py-1.5">
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70">
          mermaid
        </span>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => setZoomOpen(true)}
            disabled={!svg.trim()}
            title="Zoom in Mermaid diagram"
            className="flex items-center rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          >
            <ZoomIn className="size-3" />
            <span>Zoom in</span>
          </button>
          <MermaidImageCopyButton svg={svg} />
          <CopyButton text={code} />
        </div>
      </div>
      <div className="bg-[hsl(var(--muted))] p-3">
        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-xs font-medium text-destructive/90">Mermaid render failed</p>
            <p className="mt-1 text-xs text-destructive/70">{error}</p>
          </div>
        ) : !svg ? (
          <div className="rounded-md border border-border/60 bg-background/70 p-3 text-xs text-muted-foreground">
            Rendering Mermaid diagram...
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md bg-background p-3">
            <div
              className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        )}
      </div>
      <Dialog open={zoomOpen} onOpenChange={setZoomOpen}>
        <DialogContent className="flex h-[90vh] w-[95vw] max-w-[95vw] flex-col p-4">
          <DialogHeader className="sr-only">
            <DialogTitle>Mermaid zoom preview</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto rounded-md bg-background p-4">
            {svg ? (
              <div
                className="flex min-h-full min-w-max items-start justify-center [&_svg]:h-auto [&_svg]:max-w-none"
                dangerouslySetInnerHTML={{ __html: svg }}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PlainCodeBlock({
  language,
  code
}: {
  language?: string
  code: string
}): React.JSX.Element {
  return (
    <div className="group relative rounded-lg border border-border/60 overflow-hidden my-3 shadow-sm">
      <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5 border-b border-border/60">
        <span className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider">
          {language || 'text'}
        </span>
        <CopyButton text={code} />
      </div>
      <pre
        className="overflow-x-auto bg-[hsl(var(--muted))] px-[14px] py-[14px] text-xs leading-6"
        style={{
          fontFamily: MONO_FONT,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}
      >
        {code}
      </pre>
    </div>
  )
}

function CodeBlock({
  language,
  children,
  isStreaming = false
}: {
  language?: string
  children: string
  isStreaming?: boolean
}): React.JSX.Element {
  const code = String(children).replace(/\n$/, '')
  if (isStreaming) {
    return <PlainCodeBlock language={language} code={code} />
  }
  if (language?.toLowerCase() === 'mermaid') {
    return <MermaidCodeBlock code={code} />
  }
  return (
    <div className="group relative rounded-lg border border-border/60 overflow-hidden my-3 shadow-sm">
      <div className="flex items-center justify-between bg-muted/40 px-3 py-1.5 border-b border-border/60">
        <span className="text-[10px] font-mono text-muted-foreground/70 uppercase tracking-wider">
          {language || 'text'}
        </span>
        <CopyButton text={code} />
      </div>
      <LazySyntaxHighlighter
        language={language || 'text'}
        customStyle={{
          margin: 0,
          padding: '14px',
          fontSize: '12px',
          lineHeight: '1.5',
          background: 'transparent',
          fontFamily: MONO_FONT,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}
        codeTagProps={{
          style: {
            fontFamily: 'inherit',
            fontSize: 'inherit'
          }
        }}
        className="!bg-[hsl(var(--muted))] text-xs"
      >
        {code}
      </LazySyntaxHighlighter>
    </div>
  )
}

// Hoisted once so react-markdown sees a stable `components` reference on every render;
// without this the Markdown AST was being fully rebuilt every time even when `text` was
// unchanged, because React was diffing on the components prop identity.

// isStreaming used to be captured via closure inside the inline `components` object,
// which forced us to recreate the whole object every render. We now pass it through a
// context so the components themselves can be module-level constants.
const IsStreamingContext = React.createContext(false)

type MarkdownCodeElementProps = {
  position?: {
    start?: { line?: number }
    end?: { line?: number }
  }
}

function isMarkdownCodeBlock(rawCode: string, node?: MarkdownCodeElementProps): boolean {
  const startLine = node?.position?.start?.line
  const endLine = node?.position?.end?.line
  return (
    (typeof startLine === 'number' && typeof endLine === 'number' && startLine !== endLine) ||
    rawCode.includes('\n')
  )
}

// Extracted as a proper capitalized component so eslint-plugin-react-hooks lets us call
// useContext inside. The markdown renderer will pass it the standard `code` props.
// eslint-disable-next-line react/prop-types
const MarkdownCode: NonNullable<Components['code']> = ({ children, className, node, ...props }) => {
  const isStreaming = React.useContext(IsStreamingContext)
  const match = /language-([\w-]+)/.exec(className || '')
  const rawCode = String(children ?? '')
  const isInline = !match && !className && !isMarkdownCodeBlock(rawCode, node)
  if (isInline) {
    const code = rawCode.replace(/\n$/, '')
    const resolvedPath = resolveLocalFilePath(code)
    if (resolvedPath) {
      return (
        <LocalPathCode
          resolvedPath={resolvedPath}
          className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
          style={{ fontFamily: MONO_FONT }}
        >
          {children}
        </LocalPathCode>
      )
    }
    return (
      <code
        className="rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
        style={{ fontFamily: MONO_FONT }}
        {...props}
      >
        {children}
      </code>
    )
  }
  return (
    <CodeBlock language={match?.[1]} isStreaming={isStreaming}>
      {rawCode}
    </CodeBlock>
  )
}

const MARKDOWN_COMPONENTS: Components = {
  h1: ({ children, ...props }) => (
    <h1
      className="mt-4 mb-2 first:mt-0 text-lg font-bold text-foreground border-b border-border/40 pb-1"
      {...props}
    >
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 className="mt-3 mb-1.5 first:mt-0 text-base font-semibold text-foreground" {...props}>
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 className="mt-2 mb-1 first:mt-0 text-sm font-semibold text-foreground" {...props}>
      {children}
    </h3>
  ),
  h4: ({ children, ...props }) => (
    <h4 className="mt-2 mb-1 first:mt-0 text-sm font-medium text-foreground/90" {...props}>
      {children}
    </h4>
  ),
  h5: ({ children, ...props }) => (
    <h5
      className="mt-1.5 mb-0.5 first:mt-0 text-xs font-medium text-foreground/80 uppercase tracking-wide"
      {...props}
    >
      {children}
    </h5>
  ),
  h6: ({ children, ...props }) => (
    <h6
      className="mt-1.5 mb-0.5 first:mt-0 text-xs font-medium text-muted-foreground uppercase tracking-wide"
      {...props}
    >
      {children}
    </h6>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote
      className="my-2 border-l-2 border-primary/40 pl-3 text-muted-foreground italic"
      {...props}
    >
      {children}
    </blockquote>
  ),
  hr: ({ ...props }) => <hr className="my-3 border-border/50" {...props} />,
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        if (!href) return
        // 页内锚点保留原生行为，其余一律拦下：markdown 链接只有「外链 / 本地文件」
        // 两种归宿（都由 openMarkdownHref 处理）。识别失败时正确结果是「什么都不做」，
        // 而不是放行给浏览器 —— 渲染端就是 Electron 主窗口，相对路径没解析出 baseDir
        // 时放行会让整个应用被导航走（表现为聊天窗刷一遍）。
        if (href.startsWith('#')) return
        e.preventDefault()
        openMarkdownHref(href)
      }}
      className="text-primary underline underline-offset-2 hover:text-primary/80 cursor-pointer break-all"
      title={href}
    >
      {children}
    </a>
  ),
  p: ({ children, ...props }) => (
    <p
      className="my-1 first:mt-0 last:mb-0 leading-snug whitespace-pre-wrap break-words"
      {...props}
    >
      {children}
    </p>
  ),
  img: ({ src, alt, ...props }) => (
    <img
      {...props}
      src={src || ''}
      alt={alt || ''}
      className="my-3 block max-w-full rounded-lg border border-border/50 shadow-sm"
      loading="lazy"
    />
  ),
  ul: ({ children, ...props }) => (
    <ul className="my-1 last:mb-0 list-disc pl-4 space-y-0.5" {...props}>
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol className="my-1 last:mb-0 list-decimal pl-4 space-y-0.5" {...props}>
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li className="leading-snug break-words [&>p]:m-0 [&>p]:whitespace-pre-wrap" {...props}>
      {children}
    </li>
  ),
  table: ({ children, ...props }) => (
    <div className="my-3 overflow-x-auto max-w-full rounded-lg border border-border/60">
      <table className="min-w-0 w-full border-collapse text-sm" {...props}>
        {children}
      </table>
    </div>
  ),
  thead: ({ children, ...props }) => (
    <thead className="bg-muted/60" {...props}>
      {children}
    </thead>
  ),
  tbody: ({ children, ...props }) => (
    <tbody className="divide-y divide-border/40" {...props}>
      {children}
    </tbody>
  ),
  tr: ({ children, ...props }) => (
    <tr className="hover:bg-muted/30 transition-colors" {...props}>
      {children}
    </tr>
  ),
  th: ({ children, ...props }) => (
    <th
      className="whitespace-pre-wrap break-words px-3 py-2 text-left font-semibold text-foreground/90 border-b border-border/60"
      {...props}
    >
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td
      className="whitespace-pre-wrap break-words px-3 py-2 text-foreground/80 border-r border-border/30 last:border-r-0"
      {...props}
    >
      {children}
    </td>
  ),
  pre: ({ children }) => <>{children}</>,
  code: MarkdownCode
}

const MarkdownContent = React.memo(function MarkdownContent({
  text,
  isStreaming = false
}: {
  text: string
  isStreaming?: boolean
}): React.JSX.Element {
  return (
    <IsStreamingContext.Provider value={isStreaming}>
      <Markdown
        remarkPlugins={MARKDOWN_REMARK_PLUGINS}
        rehypePlugins={CHAT_REHYPE_PLUGINS}
        components={MARKDOWN_COMPONENTS}
      >
        {text}
      </Markdown>
    </IsStreamingContext.Provider>
  )
})

export function StreamingMarkdownContent({
  text,
  isStreaming
}: {
  text: string
  isStreaming: boolean
}): React.JSX.Element {
  const liveOutputAnimationStyle = useSettingsStore((s) => s.liveOutputAnimationStyle)
  const renderPool = useStreamingRenderPool(text, isStreaming, liveOutputAnimationStyle)
  // Settled blocks keep stable strings so the memoized MarkdownContent skips
  // re-parsing them; each render-pool tick only re-parses the small tail.
  const blocks = useStreamingMarkdownBlocks(renderPool.text, isStreaming)

  if (!text.trim()) {
    return <div className="whitespace-pre-wrap break-words leading-relaxed">{text}</div>
  }

  if (isStreaming) {
    return (
      <div
        className="contents"
        data-render-pool-size={renderPool.poolSize}
        data-rendered-length={renderPool.renderedLength}
        data-target-length={renderPool.targetLength}
      >
        {blocks.settled.map((block, index) => (
          <MarkdownContent key={index} text={block} isStreaming={false} />
        ))}
        {blocks.tail.trim() ? <MarkdownContent text={blocks.tail} isStreaming={false} /> : null}
      </div>
    )
  }

  return <MarkdownContent text={text} isStreaming={false} />
}
