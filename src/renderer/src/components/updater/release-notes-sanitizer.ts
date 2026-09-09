import { createElement, type ReactElement, type ReactNode } from 'react'
import type { Components, Options } from 'react-markdown'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'

const ALLOWED_TAGS = [
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'ul',
  'ol',
  'li',
  'strong',
  'em',
  'code',
  'pre',
  'blockquote',
  'a'
]

// `strip` drops the whole subtree instead of keeping children as text: a sanitized
// <script> or <style> would otherwise leak its source into the rendered notes.
const STRIPPED_TAGS = [
  'script',
  'style',
  'svg',
  'math',
  'iframe',
  'frame',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'img',
  'video',
  'audio',
  'source',
  'link',
  'meta',
  'base'
]

export const RELEASE_NOTES_SANITIZE_SCHEMA: SanitizeSchema = {
  ...defaultSchema,
  tagNames: ALLOWED_TAGS,
  // Only a[href] survives. No className/style/id/name from the feed, so nothing can
  // smuggle layout or clobberable anchors through; styling comes from the components map.
  attributes: { a: ['href'] },
  protocols: { href: ['http', 'https'] },
  strip: STRIPPED_TAGS,
  required: {},
  ancestors: { li: ['ol', 'ul'] }
}

// GitHub Atom feeds hand us rendered HTML; without rehype-raw react-markdown treats it as
// opaque text and the user sees literal <h2>/<li> tags. rehype-raw parses it back into a
// tree, so it must run before the sanitizer or the sanitizer never sees the real nodes.
export const RELEASE_NOTES_REMARK_PLUGINS: NonNullable<Options['remarkPlugins']> = [remarkGfm]
export const RELEASE_NOTES_REHYPE_PLUGINS: NonNullable<Options['rehypePlugins']> = [
  rehypeRaw,
  [rehypeSanitize, RELEASE_NOTES_SANITIZE_SCHEMA]
]

/**
 * Rejects every URL that is not an absolute http(s) address.
 *
 * WHATWG URL parsing already discards embedded tabs/newlines and lowercases the scheme,
 * so `java\nscript:`, `JaVaScRiPt:` and `  https://x  ` all resolve to their real scheme
 * before the allowlist check. C0 controls and DEL are removed first because browsers do
 * not strip those, and relative/protocol-relative inputs fail to parse at all.
 */
export function normalizeReleaseNotesUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = raw.trim().replace(/[\u0000-\u001F\u007F]/g, '')
  if (!cleaned) return null

  let url: URL
  try {
    url = new URL(cleaned)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.toString()
}

export const RELEASE_NOTES_LINK_TARGET = '_blank'
export const RELEASE_NOTES_LINK_REL = 'noopener noreferrer'

/**
 * target/rel are always ours, never the feed's — the schema already strips them, and
 * re-asserting them here keeps the invariant true even if the schema is later relaxed.
 */
export function safeReleaseNotesLinkProps(
  href: unknown
): { href: string; target: string; rel: string } | null {
  const normalized = normalizeReleaseNotesUrl(href)
  if (!normalized) return null
  return {
    href: normalized,
    target: RELEASE_NOTES_LINK_TARGET,
    rel: RELEASE_NOTES_LINK_REL
  }
}

function styled(tag: string, className: string) {
  return ({ children }: { children?: ReactNode }): ReactElement =>
    createElement(tag, { className }, children)
}

function ReleaseNotesLink({
  href,
  children
}: {
  href?: string
  children?: ReactNode
}): ReactElement {
  const safe = safeReleaseNotesLinkProps(href)
  // An unsafe href degrades to plain text rather than disappearing: the user still reads
  // the note, and there is no clickable surface left to exploit.
  if (!safe) return createElement('span', { className: 'break-all' }, children)
  return createElement(
    'a',
    {
      href: safe.href,
      target: safe.target,
      rel: safe.rel,
      title: safe.href,
      className: 'break-all text-primary underline underline-offset-2 hover:text-primary/80'
    },
    children
  )
}

export const RELEASE_NOTES_COMPONENTS: Components = {
  h1: styled('h1', 'mt-3 mb-1.5 text-sm font-semibold first:mt-0'),
  h2: styled('h2', 'mt-3 mb-1.5 text-sm font-semibold first:mt-0'),
  h3: styled('h3', 'mt-2 mb-1 text-xs font-semibold first:mt-0'),
  h4: styled('h4', 'mt-2 mb-1 text-xs font-medium first:mt-0'),
  h5: styled('h5', 'mt-2 mb-1 text-xs font-medium first:mt-0'),
  h6: styled('h6', 'mt-2 mb-1 text-xs font-medium text-muted-foreground first:mt-0'),
  p: styled('p', 'my-1 leading-relaxed first:mt-0 last:mb-0'),
  ul: styled('ul', 'my-1 space-y-0.5 list-disc pl-4'),
  ol: styled('ol', 'my-1 space-y-0.5 list-decimal pl-4'),
  li: styled('li', 'leading-relaxed break-words'),
  blockquote: styled(
    'blockquote',
    'my-1 border-l-2 border-border/60 pl-2 italic text-muted-foreground'
  ),
  pre: styled(
    'pre',
    'my-2 overflow-x-auto whitespace-pre-wrap break-words rounded border bg-muted/40 p-2 font-mono text-[11px]'
  ),
  code: styled('code', 'rounded bg-muted px-1 py-0.5 font-mono text-[11px]'),
  a: ReleaseNotesLink
}
