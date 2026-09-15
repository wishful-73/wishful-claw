import type { SearchResultItem } from './types'

export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

export function titleSimilarity(a: string, b: string): number {
  const na = a.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase()
  const nb = b.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase()
  if (!na || !nb) return 0
  // Simple Jaccard on character bigrams
  const bigramsA = new Set<string>()
  for (let i = 0; i < na.length - 1; i++) bigramsA.add(na.slice(i, i + 2))
  const bigramsB = new Set<string>()
  for (let i = 0; i < nb.length - 1; i++) bigramsB.add(nb.slice(i, i + 2))
  let intersection = 0
  for (const bg of bigramsA) if (bigramsB.has(bg)) intersection++
  const union = bigramsA.size + bigramsB.size - intersection
  return union > 0 ? intersection / union : 0
}

/**
 * Round-robin across engines instead of concatenating completion order.
 *
 * This is the fix for "the fastest engine eats the whole result quota": engines
 * finish at wildly different speeds, so appending as they land let whichever
 * returned first fill every slot before a slower but better engine contributed
 * anything. Interleaving gives each engine the first slot before any engine gets
 * a second one.
 */
export function interleaveByEngine(groups: SearchResultItem[][]): SearchResultItem[] {
  const longest = groups.reduce((max, group) => Math.max(max, group.length), 0)
  const merged: SearchResultItem[] = []
  for (let index = 0; index < longest; index++) {
    for (const group of groups) {
      const item = group[index]
      if (item) merged.push(item)
    }
  }
  return merged
}

/** Query tokens used to prefer on-topic hits: CJK bigrams plus Latin words. */
export function queryTokens(query: string): string[] {
  const tokens = new Set<string>()
  for (const word of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue
    if (/[\u4e00-\u9fa5]/.test(word)) {
      tokens.add(word)
      for (let i = 0; i < word.length - 1; i++) tokens.add(word.slice(i, i + 2))
    } else if (word.length > 2) {
      tokens.add(word)
    }
  }
  return [...tokens]
}

function sharesToken(result: SearchResultItem, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const haystack = `${result.title} ${result.snippet}`.toLowerCase()
  return tokens.some((token) => haystack.includes(token))
}

/**
 * Deduplicate by URL and by title similarity, preferring on-topic hits.
 *
 * Relevance is a *priority*, not a hard filter: results that share no token with
 * the query are held back and only used to fill leftover slots. Dropping them
 * outright would throw away legitimate hits whose wording simply differs from
 * the query.
 */
export function deduplicate(
  results: SearchResultItem[],
  maxResults: number,
  query?: string
): SearchResultItem[] {
  const TITLE_THRESHOLD = 0.82
  const tokens = query ? queryTokens(query) : []
  const seenUrls = new Set<string>()
  const kept: SearchResultItem[] = []
  const deferred: SearchResultItem[] = []

  const isDuplicateTitle = (candidate: SearchResultItem): boolean =>
    kept.some((existing) => titleSimilarity(candidate.title, existing.title) >= TITLE_THRESHOLD)

  for (const result of results) {
    const urlKey = normalizeUrl(result.url)
    if (seenUrls.has(urlKey)) continue
    if (isDuplicateTitle(result)) continue

    seenUrls.add(urlKey)

    if (!sharesToken(result, tokens)) {
      deferred.push(result)
      continue
    }

    kept.push(result)
    if (kept.length >= maxResults) return kept
  }

  for (const result of deferred) {
    if (kept.length >= maxResults) break
    kept.push(result)
  }

  return kept
}
