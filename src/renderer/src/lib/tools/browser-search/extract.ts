import type { EngineConfig, SearchResultItem } from './types'

// ── Low-quality card filtering ──
//
// Chinese search pages answer a query with dictionary / translation / encyclopedia
// cards that look like organic results. When the query is not a word lookup those
// cards are pure noise, and they were the reason Chinese queries came back full of
// dictionary entries. Match them by host and by path, but never censor an engine's
// own site (that is how `wikipedia_zh` keeps its own hits).

const CARD_HOSTS = [
  'dict.youdao.com',
  'fanyi.youdao.com',
  'fanyi.baidu.com',
  'hanyu.baidu.com',
  'iciba.com',
  'zdic.net',
  'cidian.qq.com',
  'translate.google.com',
  'translate.google.cn',
  'baike.baidu.com',
  'baike.sogou.com',
  'baike.so.com'
]

const CARD_PATH_FRAGMENTS = ['/dict/', '/translate', '/translator', '/fanyi', '/cidian']

function engineHostOf(engine: EngineConfig): string | undefined {
  const source = engine.baseUrl || engine.searchUrl
  try {
    return new URL(source).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return undefined
  }
}

export function isLowQualityCard(url: string, engineHost?: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  if (engineHost && host === engineHost) return false

  if (CARD_HOSTS.some((card) => host === card || host.endsWith(`.${card}`))) return true

  const path = parsed.pathname.toLowerCase()
  return CARD_PATH_FRAGMENTS.some((fragment) => path.includes(fragment))
}

// ── Toutiao SSR extraction ──
// Toutiao embeds search results in <script> tags as:
//   window.T && T.flow({ data: {JSON}, src_id: "..." })
// We parse each JSON object and extract title/url/abstract.

function extractFromToutiaoSsr(html: string, engineName: string): SearchResultItem[] {
  const results: SearchResultItem[] = []
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi
  let match: RegExpExecArray | null

  while ((match = scriptRegex.exec(html)) !== null) {
    const scriptContent = match[1]
    if (!scriptContent.includes('T.flow') || !scriptContent.includes('window.T')) continue

    // Find "data:" and extract the JSON value that follows
    const dataIdx = scriptContent.indexOf('data:')
    if (dataIdx < 0) continue
    const raw = scriptContent.slice(dataIdx + 5).trim()
    if (!raw.startsWith('{')) continue

    // Parse JSON with a manual scanner to handle nested objects
    let jsonStr: string | null = null
    let depth = 0
    let inString = false
    let escape = false
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (escape) {
        escape = false
        continue
      }
      if (ch === '\\') {
        escape = true
        continue
      }
      if (ch === '"') {
        inString = !inString
        continue
      }
      if (inString) continue
      if (ch === '{') depth++
      else if (ch === '}') {
        depth--
        if (depth === 0) {
          jsonStr = raw.slice(0, i + 1)
          break
        }
      }
    }

    if (!jsonStr) continue

    let data: Record<string, unknown>
    try {
      data = JSON.parse(jsonStr)
    } catch {
      continue
    }

    // Extract title, url, abstract from various data shapes
    let title = ''
    let url = ''
    let abstract = ''

    const disp = data.display
    if (disp && typeof disp === 'object' && !Array.isArray(disp)) {
      const d = disp as Record<string, unknown>
      const t = d.title
      if (t && typeof t === 'object') {
        title = ((t as Record<string, unknown>).text as string) ?? ''
      } else if (typeof t === 'string') {
        title = t
      }
      abstract = (d.abstract as string) ?? (d.summary_text as string) ?? ''
    } else if (Array.isArray(disp) && disp.length > 0) {
      const first = disp[0] as Record<string, unknown>
      title = (first.title as string) ?? ''
      abstract = (first.abstract as string) ?? ''
      url = (first.item_source_url as string) ?? (first.url as string) ?? ''
    }

    if (!title) title = (data.title as string) ?? ''
    if (!abstract) abstract = (data.abstract as string) ?? ''
    if (!url) {
      url = (data.url as string) ?? (data.share_url as string) ?? (data.article_url as string) ?? ''
    }

    // Clean HTML tags from title
    title = title.replace(/<[^>]+>/g, '').trim()

    if (title.length > 5 && url) {
      if (url.startsWith('/')) url = 'https://so.toutiao.com' + url
      results.push({
        title: title.slice(0, 200),
        url: url.slice(0, 500),
        snippet: abstract.slice(0, 300),
        source_engine: engineName
      })
    }
  }

  return results.slice(0, 10)
}

// ── Generic result collection ──

interface Collector {
  results: SearchResultItem[]
  add: (title: string, url: string, snippet: string) => void
}

function createCollector(
  engineName: string,
  engineHost?: string,
  lowConfidence?: boolean
): Collector {
  const results: SearchResultItem[] = []
  const add = (title: string, url: string, snippet: string): void => {
    const cleanTitle = (title ?? '').replace(/\s+/g, ' ').trim()
    if (!cleanTitle || !url || cleanTitle.length < 5) return
    if (isLowQualityCard(url, engineHost)) return
    results.push({
      title: cleanTitle.slice(0, 200),
      url: url.slice(0, 500),
      snippet: (snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 300),
      source_engine: engineName,
      ...(lowConfidence ? { confidence: 'low' as const } : {})
    })
  }
  return { results, add }
}

/** Resolve a relative `href` against the document base (the parser already
 *  honours an injected `<base>`), returning '' when it is not a usable link. */
function anchorHref(anchor: HTMLAnchorElement): string {
  const href = anchor.href
  if (!href || href.startsWith('javascript:') || href.startsWith('#')) return ''
  return href
}

function extractWithSelectors(
  doc: Document,
  engine: EngineConfig,
  collector: Collector
): void {
  const selectors = engine.selectors
  if (!selectors?.item) return

  doc.querySelectorAll(selectors.item).forEach((item) => {
    const titleEl = selectors.title
      ? item.querySelector(selectors.title)
      : item.querySelector('a[href]')
    if (!titleEl) return
    const anchor = (selectors.url
      ? item.querySelector(selectors.url)
      : titleEl.tagName === 'A'
        ? titleEl
        : item.querySelector('a[href]')) as HTMLAnchorElement | null
    if (!anchor) return
    const snippetEl = selectors.snippet ? item.querySelector(selectors.snippet) : null
    collector.add(titleEl.textContent ?? '', anchorHref(anchor), snippetEl?.textContent ?? '')
  })
}

function extractByEngine(doc: Document, engine: EngineConfig, collector: Collector): void {
  switch (engine.id) {
    case 'baidu':
      doc.querySelectorAll('.result.c-container, .c-container, .result').forEach((item) => {
        const titleEl = item.querySelector('h3 a, .t a')
        if (!titleEl) return
        const anchor = titleEl as HTMLAnchorElement
        const snippetEl = item.querySelector(
          '.c-abstract, [class*="content-right"], [class*="abstract"]'
        )
        collector.add(anchor.textContent ?? '', anchorHref(anchor), snippetEl?.textContent ?? '')
      })
      break

    case 'bing_intl':
      doc.querySelectorAll('#b_results > li.b_algo, #b_results .b_algo').forEach((item) => {
        const titleEl = item.querySelector('h2 a[href]')
        if (!titleEl) return
        const anchor = titleEl as HTMLAnchorElement
        const snippetEl = item.querySelector(
          '.b_caption p, .b_lineclamp2, .b_lineclamp3, .b_lineclamp4, p'
        )
        collector.add(anchor.textContent ?? '', anchorHref(anchor), snippetEl?.textContent ?? '')
      })
      // Fallback: any h2 > a
      if (collector.results.length === 0) {
        doc.querySelectorAll('#b_results h2 a[href]').forEach((a) => {
          const anchor = a as HTMLAnchorElement
          collector.add(anchor.textContent ?? '', anchorHref(anchor), '')
        })
      }
      break

    case 'sogou':
      // Sogou uses .vrwrap containers with h3.vr-title > a for title
      doc.querySelectorAll('.vrwrap, .result, .rb').forEach((item) => {
        const titleEl = item.querySelector('h3.vr-title a, h3 a, .vr-title a')
        if (!titleEl) return
        const anchor = titleEl as HTMLAnchorElement
        const snippetEl = item.querySelector('.space-txt, .str-text-info, .fz-mid, p')
        collector.add(anchor.textContent ?? '', anchorHref(anchor), snippetEl?.textContent ?? '')
      })
      break

    case 'so_360':
      doc.querySelectorAll('.result, .g-card').forEach((item) => {
        const titleEl = item.querySelector('a[href]')
        if (!titleEl) return
        const anchor = titleEl as HTMLAnchorElement
        const snippetEl = item.querySelector('p, .res-desc')
        collector.add(anchor.textContent ?? '', anchorHref(anchor), snippetEl?.textContent ?? '')
      })
      break

    case 'sogou_wechat':
      // Sogou WeChat: .news-list li > .txt-box > h3 a for title
      doc.querySelectorAll('.news-list li, .txt-box, .weui_media_box').forEach((item) => {
        const titleEl = item.querySelector('h3 a, h4 a, a[href]')
        if (!titleEl) return
        const anchor = titleEl as HTMLAnchorElement
        const snippetEl = item.querySelector('.txt-info, p, .s-p')
        collector.add(anchor.textContent ?? '', anchorHref(anchor), snippetEl?.textContent ?? '')
      })
      break

    case 'github':
      doc.querySelectorAll('.repo-list-item, [data-testid="results-list"] > div').forEach((item) => {
        const linkEl = item.querySelector('a[href]')
        if (!linkEl) return
        const anchor = linkEl as HTMLAnchorElement
        const snippetEl = item.querySelector('p, .repo-list-description')
        collector.add(anchor.textContent ?? '', anchorHref(anchor), snippetEl?.textContent ?? '')
      })
      break

    case 'arxiv':
      // ArXiv returns Atom XML, parsed by DOMParser
      doc.querySelectorAll('entry').forEach((entry) => {
        const titleEl = entry.querySelector('title')
        const idEl = entry.querySelector('id')
        const summaryEl = entry.querySelector('summary')
        collector.add(
          titleEl?.textContent ?? '',
          idEl?.textContent ?? '',
          summaryEl?.textContent ?? ''
        )
      })
      break

    case 'wikipedia_zh':
    case 'wikipedia_en':
      doc.querySelectorAll('.mw-search-result').forEach((item) => {
        const linkEl = item.querySelector('a[href]')
        if (!linkEl) return
        const anchor = linkEl as HTMLAnchorElement
        const snippetEl = item.querySelector('.mw-search-result-data, .searchresult')
        collector.add(anchor.textContent ?? '', anchorHref(anchor), snippetEl?.textContent ?? '')
      })
      // If no search results, try the article page itself
      if (collector.results.length === 0) {
        const title = doc.querySelector('#firstHeading')?.textContent?.trim() ?? ''
        const body = doc.querySelector('#mw-content-text p')?.textContent?.trim() ?? ''
        if (title) {
          collector.add(title, doc.location?.href ?? engine.searchUrl, body.slice(0, 300))
        }
      }
      break
  }
}

/** Generic `h2 a / h3 a` heuristic, used when the engine-specific extractor
 *  found nothing (and as the whole strategy for tier-1 custom engines). */
function extractGeneric(doc: Document, collector: Collector): void {
  doc.querySelectorAll('h2 a[href], h3 a[href]').forEach((a) => {
    const anchor = a as HTMLAnchorElement
    const href = anchorHref(anchor)
    if (!href) return
    // Skip the engine's own navigation / search links
    if (href.includes('bing.com') && href.includes('search')) return
    if (href.includes('google.com/search')) return
    collector.add(anchor.textContent ?? '', href, '')
  })
}

export function extractFromHtml(
  html: string,
  engine: EngineConfig,
  engineName: string
): SearchResultItem[] {
  if (engine.extractor === 'toutiao_ssr') {
    return extractFromToutiaoSsr(html, engineName)
  }

  // Inject <base> so relative URLs (e.g. /link?url=...) resolve correctly
  const baseUrl = engine.baseUrl
  const htmlWithBase = baseUrl
    ? html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseUrl}">`)
    : html

  const doc = new DOMParser().parseFromString(htmlWithBase, 'text/html')
  const collector = createCollector(engineName, engineHostOf(engine), engine.lowConfidence)

  extractWithSelectors(doc, engine, collector)
  if (collector.results.length === 0) extractByEngine(doc, engine, collector)
  if (collector.results.length === 0) extractGeneric(doc, collector)

  return collector.results.slice(0, 10) // Max 10 per engine
}
