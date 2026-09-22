import 'katex/contrib/mhchem'
import { lazy, Suspense } from 'react'
import type { Components } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import type { PluggableList } from 'unified'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import { useChatStore } from '@renderer/stores/chat-store'
import { LocalPathCode } from '@renderer/components/chat/AssistantMessage/LocalPathCode'
import { WebUrlCode } from '@renderer/components/chat/AssistantMessage/WebUrlCode'
import { LazySyntaxHighlighter } from '@renderer/components/chat/LazySyntaxHighlighter'
import { MONO_FONT } from '@renderer/lib/constants'
import { openLocalTarget } from '@renderer/lib/preview/local-target'
import { isWebUrl, openWebUrl } from '@renderer/lib/preview/web-url'

const MermaidBlock = lazy(async () => {
  const mod = await import('./MermaidBlock')
  return { default: mod.MermaidBlock }
})

/** 需要交给操作系统、而不是我们接管的 scheme。白名单而不是「任意非 http scheme」——
 *  渲染端是主窗口，不该把任意 scheme 都递给系统。 */
const EXTERNAL_APP_SCHEME_RE = /^(?:mailto|tel):/i
const FILE_URL_RE = /^file:\/\//i
const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/
const OTHER_SCHEME_RE = /^[a-zA-Z][a-zA-Z\d+.-]*:/
const ROOT_FILE_NAME_RE =
  /^(?:package(?:-lock)?\.json|pnpm-lock\.yaml|bun\.lock|tsconfig(?:\.[^.]+)?\.json|README(?:\.[A-Za-z0-9_-]+)?\.md|CHANGELOG\.md|LICENSE|AGENTS\.md|CLAUDE\.md|SOUL\.md|USER\.md|MEMORY\.md|Dockerfile|docker-compose(?:\.[A-Za-z0-9_-]+)?\.ya?ml|Makefile|\.env(?:\.[A-Za-z0-9_-]+)?)$/i
const SPECIAL_FILE_NAME_RE = /^(?:Dockerfile|Makefile|LICENSE)$/i
const PAREN_LINE_RE = /\s+\(line\s+(\d+)(?::(\d+))?\)$/i

type MarkdownCodeElementProps = {
  position?: {
    start?: { line?: number }
    end?: { line?: number }
  }
}

/**
 * rehype-sanitize 默认 schema 会把 className 全部剥掉，但有两类必须留下：
 * `language-*`（语法高亮靠它认语言）与 `math-*` / `katex*`（rehype-katex 认公式）。
 * 其余标签与属性沿用默认白名单 —— README 用的 p / h1 / strong / br / a / img
 * 以及居中用的 align 都在白名单里。
 */
const MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), ['className', /^language-/]],
    span: [...(defaultSchema.attributes?.span ?? []), ['className', /^math-/, /^katex/]],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', /^math-/, /^katex/]]
  }
} as typeof defaultSchema

export const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath]
// 顺序有讲究：raw 先把 HTML 解析成元素 → sanitize 按白名单过滤（含上面放宽的
// className）→ katex 最后跑，它生成的是我们自己库的输出，可信，不必再过一遍过滤。
// 显式标注 PluggableList：不加的话「裸插件」与「[插件, 选项] 元组」混在一个数组里，
// 会被推断成联合类型，react-markdown 的 rehypePlugins 接不住。
//
// 【只用在这一个地方】文档预览（markdown-viewer）。README 这类文档靠原生 HTML
// 排版（居中的标题、一排 badge），不解析就是一堆字面标签。聊天窗**刻意不共用**
// 这份 —— 那是对流式渲染敏感的界面，见下面的 CHAT_REHYPE_PLUGINS。
export const MARKDOWN_REHYPE_PLUGINS: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA],
  rehypeKatex
]

/**
 * 聊天窗专用：不解析 markdown 里的原生 HTML，保持历史行为。
 *
 * agent 回复是流式写入的，半截 HTML 标签会让整段渲染反复闪；而且对话里出现的
 * HTML 标签当字面文本显示也无害。要让它也支持，把它换成上面那份即可 —— 但那是
 * 聊天窗的行为变更，得单独验。
 */
export const CHAT_REHYPE_PLUGINS: PluggableList = [rehypeKatex]

function isMarkdownCodeBlock(rawCode: string, node?: MarkdownCodeElementProps): boolean {
  const startLine = node?.position?.start?.line
  const endLine = node?.position?.end?.line
  return (
    (typeof startLine === 'number' && typeof endLine === 'number' && startLine !== endLine) ||
    rawCode.includes('\n')
  )
}

function getActiveSessionContext(): { workingFolder?: string } {
  const chatState = useChatStore.getState()
  const activeSession = chatState.sessions.find(
    (session) => session.id === chatState.activeSessionId
  )

  return {
    workingFolder: activeSession?.workingFolder?.trim()
  }
}

function stripLocalPathDecorators(value: string): string {
  let normalized = value.trim()
  normalized = normalized.replace(PAREN_LINE_RE, '')
  const queryIndex = normalized.indexOf('?')
  if (queryIndex >= 0) normalized = normalized.slice(0, queryIndex)
  const hashIndex = normalized.indexOf('#')
  if (hashIndex >= 0) normalized = normalized.slice(0, hashIndex)
  // Strip trailing :line:col but not from drive letters (C:\path)
  if (!/^[a-zA-Z]:[\\/]/.test(normalized) && /:\d+(?::\d+)?$/.test(normalized)) {
    normalized = normalized.replace(/:\d+(?::\d+)?$/, '')
  }
  return normalized
}


function decodeFileUrlPath(value: string): string {
  try {
    const url = new URL(value)
    let pathname = decodeURIComponent(url.pathname || '')
    if (/^\/[a-zA-Z]:/.test(pathname)) pathname = pathname.slice(1)
    if (url.host) {
      return `//${decodeURIComponent(url.host)}${pathname}`
    }
    return pathname
  } catch {
    const raw = value.replace(FILE_URL_RE, '')
    const normalized = raw.startsWith('/') && /^\/[a-zA-Z]:/.test(raw) ? raw.slice(1) : raw
    try {
      return decodeURIComponent(normalized)
    } catch {
      return normalized
    }
  }
}

function hasFileLikeName(value: string): boolean {
  const lastSegment = value.split(/[\\/]/).pop()?.trim() ?? ''
  if (!lastSegment) return false
  return /\.[A-Za-z0-9._-]+$/.test(lastSegment) || SPECIAL_FILE_NAME_RE.test(lastSegment)
}

function joinPath(baseDir: string, relativePath: string): string {
  const trimmedBase = baseDir.replace(/[\\/]+$/, '')
  const trimmedRelative = relativePath.replace(/^\.[\\/]/, '')
  const separator = trimmedBase.includes('\\') && !trimmedBase.includes('/') ? '\\' : '/'
  return `${trimmedBase}${separator}${trimmedRelative}`
}

export function isLikelyLocalFilePath(value: string): boolean {
  const raw = value.trim()
  if (!raw || raw.startsWith('#') || isWebUrl(raw)) return false
  if (FILE_URL_RE.test(raw)) return true

  const normalized = stripLocalPathDecorators(raw)
  if (!normalized) return false
  if (OTHER_SCHEME_RE.test(normalized) && !WINDOWS_ABSOLUTE_PATH_RE.test(normalized)) return false

  if (
    WINDOWS_ABSOLUTE_PATH_RE.test(normalized) ||
    normalized.startsWith('\\\\') ||
    normalized.startsWith('/') ||
    normalized.startsWith('./') ||
    normalized.startsWith('../')
  ) {
    return hasFileLikeName(normalized)
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    return hasFileLikeName(normalized)
  }

  return ROOT_FILE_NAME_RE.test(normalized)
}

export function resolveLocalFilePath(value: string, filePath?: string): string | null {
  if (!isLikelyLocalFilePath(value)) return null

  let target = FILE_URL_RE.test(value) ? decodeFileUrlPath(value) : stripLocalPathDecorators(value)
  try {
    target = decodeURIComponent(target)
  } catch {
    // ignore decode failures
  }

  if (
    WINDOWS_ABSOLUTE_PATH_RE.test(target) ||
    target.startsWith('\\\\') ||
    target.startsWith('/')
  ) {
    return target
  }

  const baseDir =
    (filePath ? filePath.replace(/[\\/][^\\/]*$/, '') : getActiveSessionContext().workingFolder) ||
    ''
  if (!baseDir) return null

  return joinPath(baseDir, target)
}

/**
 * markdown 链接指向本地文件时的打开动作。
 *
 * 行内路径标签走 LocalPathCode（渲染前会 stat 校验存在性）；
 * 这里是显式链接的通道，用户已经写明要打开它，就不再预校验。
 */
export function openLocalFilePath(value: string, filePath?: string): boolean {
  const resolved = resolveLocalFilePath(value, filePath)
  if (!resolved) return false

  openLocalTarget(resolved)
  return true
}

export function openMarkdownHref(href: string, filePath?: string): boolean {
  const link = href.trim()
  if (!link) return false
  if (link.startsWith('#')) return false
  if (isWebUrl(link)) {
    // 网址走内置浏览器面板，不递系统浏览器 —— 归宿与正文里那些可点的网址标签一致。
    openWebUrl(link)
    return true
  }
  // 调用方已统一拦下默认导航，所以这里必须自己把「交给系统」的情况接住，
  // 否则 mailto / tel 会从「浏览器尝试打开」退化成点了没反应。
  if (EXTERNAL_APP_SCHEME_RE.test(link)) {
    if (typeof window !== 'undefined' && (window as any).electron?.shell?.openExternal) {
      void (window as any).electron.shell.openExternal(link)
      return true
    }
    return false
  }
  return openLocalFilePath(link, filePath)
}

export function createMarkdownComponents(filePath?: string): Components {
  const fileDir = filePath ? filePath.replace(/[\\/][^\\/]*$/, '') : ''

  return {
    h1: ({ children, ...props }) => (
      <h1
        className="mt-6 mb-3 first:mt-0 text-2xl font-bold text-foreground border-b border-border/40 pb-2"
        {...props}
      >
        {children}
      </h1>
    ),
    h2: ({ children, ...props }) => (
      <h2
        className="mt-5 mb-2 first:mt-0 text-xl font-semibold text-foreground border-b border-border/30 pb-1"
        {...props}
      >
        {children}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3 className="mt-4 mb-2 first:mt-0 text-lg font-semibold text-foreground" {...props}>
        {children}
      </h3>
    ),
    h4: ({ children, ...props }) => (
      <h4 className="mt-3 mb-1 first:mt-0 text-base font-medium text-foreground/90" {...props}>
        {children}
      </h4>
    ),
    h5: ({ children, ...props }) => (
      <h5
        className="mt-2 mb-1 first:mt-0 text-sm font-medium text-foreground/80 uppercase tracking-wide"
        {...props}
      >
        {children}
      </h5>
    ),
    h6: ({ children, ...props }) => (
      <h6
        className="mt-2 mb-1 first:mt-0 text-sm font-medium text-muted-foreground uppercase tracking-wide"
        {...props}
      >
        {children}
      </h6>
    ),
    blockquote: ({ children, ...props }) => (
      <blockquote
        className="my-3 border-l-2 border-primary/40 pl-4 text-muted-foreground italic"
        {...props}
      >
        {children}
      </blockquote>
    ),
    hr: ({ ...props }) => <hr className="my-4 border-border/50" {...props} />,
    a: ({ href, children, ...props }) => {
      const link = href?.trim() || ''

      return (
        <a
          {...props}
          href={link || href}
          className="text-primary underline underline-offset-2 hover:text-primary/80 break-all"
          title={link || href}
          onClick={(event) => {
            if (!link) return
            // 见 markdown-renderer.tsx 同款注释：除页内锚点外一律拦下默认导航，
            // 否则识别失败（如相对路径拿不到 baseDir）会把整个应用导航走。
            if (link.startsWith('#')) return
            event.preventDefault()
            openMarkdownHref(link, filePath)
          }}
        >
          {children}
        </a>
      )
    },
    // 不要给 p / li 加 whitespace-pre-wrap：文档预览会渲染 markdown 里的原生
    // HTML（rehype-raw），而 HTML 源码的缩进换行按标准应折叠成一个空格。
    // 加了 pre-wrap 就会把缩进保留下来 —— README 里一排居中的 badge
    // 会变成「一个元素占一行」。软换行同理，标准行为就是不换行。
    p: ({ children, ...props }) => (
      <p className="break-words" {...props}>
        {children}
      </p>
    ),
    li: ({ children, ...props }) => (
      <li className="break-words" {...props}>
        {children}
      </li>
    ),
    table: ({ children, ...props }) => (
      <div className="my-3 overflow-x-auto rounded-lg border border-border/60">
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
    img: ({ src, alt, ...props }) => {
      let resolvedSrc = src || ''
      if (
        fileDir &&
        resolvedSrc &&
        !resolvedSrc.startsWith('http') &&
        !resolvedSrc.startsWith('data:') &&
        !resolvedSrc.startsWith('file://')
      ) {
        const sep = fileDir.includes('/') ? '/' : '\\'
        resolvedSrc = `file://${fileDir}${sep}${resolvedSrc.replace(/^\.[/\\]/, '')}`
      }
      return (
        <img
          {...props}
          src={resolvedSrc}
          alt={alt || ''}
          // display 交给 .markdown-doc 那一层统一管（main.css 的「排版语义复位」），
          // 组件这层只负责视觉样式。这里千万别写 block —— 文档里并排铺的一排图
          // （README 顶部的 badge）会当场散成一行一个。
          className="my-4 max-w-full rounded-lg border border-border/50 shadow-sm"
          loading="lazy"
        />
      )
    },
    pre: ({ children }) => <>{children}</>,
    code: ({ children, className, node }) => {
      const rawCode = String(children ?? '')
      const code = rawCode.replace(/\n$/, '')
      const languageMatch = /language-([\w-]+)/.exec(className || '')
      const language = languageMatch?.[1]?.toLowerCase()

      if (!className && !isMarkdownCodeBlock(rawCode, node)) {
        if (isWebUrl(code)) {
          return <WebUrlCode url={code} />
        }
        const resolvedPath = resolveLocalFilePath(code, filePath)
        if (resolvedPath) {
          return (
            <LocalPathCode
              resolvedPath={resolvedPath}
              className="not-prose rounded bg-muted px-1 py-0.5 text-xs font-mono text-foreground"
            >
              {children}
            </LocalPathCode>
          )
        }
        return (
          <code className="not-prose rounded bg-muted px-1 py-0.5 text-xs text-foreground">
            {children}
          </code>
        )
      }

      if (language === 'mermaid') {
        return (
          <Suspense
            fallback={
              <pre className="not-prose my-3 overflow-x-auto rounded-md border border-border/50 bg-muted/60 p-3 text-xs leading-relaxed text-foreground">
                <code className="font-mono text-inherit">{code}</code>
              </pre>
            }
          >
            <MermaidBlock code={code} />
          </Suspense>
        )
      }

      // 与聊天窗的 CodeBlock 走同一个高亮器 —— 预览面板此前直接吐裸 <pre><code>，
      // README 之类的文档在预览里是没有语法高亮的。
      // 但不要抄聊天窗的 whiteSpace/wordBreak：聊天窗是对话流（宽度有限、折行免得
      // 横向拖动），文档预览的代码块跟 GitHub 一致 —— 不折行、横向滚动。
      return (
        <div className="not-prose my-3 overflow-hidden rounded-md border border-border/50 bg-muted/60">
          <LazySyntaxHighlighter
            language={language || 'text'}
            customStyle={{
              margin: 0,
              padding: '12px',
              fontSize: '12px',
              lineHeight: '1.5',
              background: 'transparent',
              overflowX: 'auto',
              fontFamily: MONO_FONT
            }}
            codeTagProps={{ style: { fontFamily: 'inherit', fontSize: 'inherit' } }}
            className="text-xs"
          >
            {code}
          </LazySyntaxHighlighter>
        </div>
      )
    }
  }
}
