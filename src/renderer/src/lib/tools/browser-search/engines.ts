import type { BrowserSearchSettings, CustomSearchEngine } from '@renderer/stores/settings-store-types'
import { translateOr } from '@renderer/lib/i18n-text'
import type { EngineConfig, IntentConfig, SearchPlan } from './types'

// ── Built-in engine registry ──
//
// Mixed fetch strategy: 'http' for plain HTTP (served by the Worker's WebFetch
// executor, which already sends a desktop Chrome UA and a zh-CN Accept-Language),
// 'rendered' for engines that block non-browser requests or need JS rendering
// (served by a hidden BrowserWindow in the main process).
//
// `cn.bing.com` used to be a member. It is gone on purpose: over plain HTTP the
// endpoint serves dictionary/translation cards and near-empty organic results for
// Chinese queries, so it was a pure noise source. `bing_intl` covers Bing.

export const BUILTIN_ENGINES: Record<string, EngineConfig> = {
  // ── Chinese general ──
  baidu: {
    id: 'baidu',
    nameKey: 'browserSearch.engines.baidu',
    name: '百度',
    searchUrl: 'https://www.baidu.com/s?wd={query}&rn=10',
    type: 'general',
    timeout: 15000,
    extractor: 'dom',
    renderMode: 'rendered',
    renderWaitMs: 3000
  },
  sogou: {
    id: 'sogou',
    nameKey: 'browserSearch.engines.sogou',
    name: '搜狗',
    searchUrl: 'https://www.sogou.com/web?query={query}',
    type: 'general',
    timeout: 10000,
    baseUrl: 'https://www.sogou.com',
    extractor: 'dom'
  },
  so_360: {
    id: 'so_360',
    nameKey: 'browserSearch.engines.so_360',
    name: '360搜索',
    searchUrl: 'https://m.so.com/s?q={query}',
    type: 'general',
    timeout: 10000,
    extractor: 'dom'
  },
  toutiao: {
    id: 'toutiao',
    nameKey: 'browserSearch.engines.toutiao',
    name: '头条搜索',
    searchUrl: 'https://so.toutiao.com/search?keyword={query}',
    type: 'general',
    timeout: 10000,
    baseUrl: 'https://so.toutiao.com',
    extractor: 'toutiao_ssr'
  },

  // ── International ──
  bing_intl: {
    id: 'bing_intl',
    nameKey: 'browserSearch.engines.bing_intl',
    name: '必应国际',
    searchUrl: 'https://www.bing.com/search?q={query}',
    type: 'general',
    timeout: 10000,
    extractor: 'dom'
  },

  // ── Tech (requires browser rendering) ──
  github: {
    id: 'github',
    nameKey: 'browserSearch.engines.github',
    name: 'GitHub',
    searchUrl: 'https://github.com/search?q={query}&type=repositories',
    type: 'tech',
    timeout: 15000,
    extractor: 'dom',
    renderMode: 'rendered',
    renderWaitMs: 4000
  },

  // ── Social / WeChat ──
  sogou_wechat: {
    id: 'sogou_wechat',
    nameKey: 'browserSearch.engines.sogou_wechat',
    name: '搜狗微信',
    searchUrl: 'https://weixin.sogou.com/weixin?type=2&query={query}&page=1',
    type: 'social',
    timeout: 10000,
    baseUrl: 'https://weixin.sogou.com',
    extractor: 'dom'
  },

  // ── Academic ──
  arxiv: {
    id: 'arxiv',
    nameKey: 'browserSearch.engines.arxiv',
    name: 'ArXiv',
    searchUrl: 'http://export.arxiv.org/api/query?search_query=all:{query}&max_results=10',
    type: 'academic',
    timeout: 15000,
    extractor: 'xml'
  },

  // ── Knowledge ──
  wikipedia_zh: {
    id: 'wikipedia_zh',
    nameKey: 'browserSearch.engines.wikipedia_zh',
    name: '维基百科(中文)',
    searchUrl: 'https://zh.wikipedia.org/w/index.php?search={query}&title=Special:Search',
    type: 'knowledge',
    timeout: 10000,
    extractor: 'dom'
  },
  wikipedia_en: {
    id: 'wikipedia_en',
    nameKey: 'browserSearch.engines.wikipedia_en',
    name: 'Wikipedia(EN)',
    searchUrl: 'https://en.wikipedia.org/w/index.php?search={query}&title=Special:Search',
    type: 'knowledge',
    timeout: 10000,
    extractor: 'dom'
  }
}

/**
 * `cn.bing.com` used to be a member here. It is gone on purpose: over plain HTTP
 * the endpoint serves dictionary/translation cards and near-empty organic
 * results for Chinese queries, so it was a pure noise source. `bing_intl`
 * covers Bing.
 */
export const BUILTIN_ENGINE_IDS: string[] = Object.keys(BUILTIN_ENGINES)

// ── Intent routing ──

export const BUILTIN_INTENT_CONFIG: Record<string, IntentConfig> = {
  general: {
    engines: ['baidu', 'bing_intl', 'sogou', 'so_360', 'toutiao'],
    maxConcurrent: 5
  },
  tech: {
    engines: ['github', 'bing_intl', 'sogou', 'toutiao'],
    maxConcurrent: 4
  },
  academic: {
    engines: ['arxiv', 'bing_intl', 'wikipedia_en'],
    maxConcurrent: 3
  },
  finance: {
    engines: ['baidu', 'bing_intl', 'sogou', 'toutiao'],
    maxConcurrent: 4
  },
  social: {
    engines: ['sogou_wechat', 'sogou', 'baidu'],
    maxConcurrent: 3
  },
  knowledge: {
    engines: ['wikipedia_zh', 'wikipedia_en', 'bing_intl'],
    maxConcurrent: 3
  }
}

export const INTENT_IDS: string[] = Object.keys(BUILTIN_INTENT_CONFIG)

/** Result cap bounds, shared by the settings UI and the tool executor. */
export const MIN_SEARCH_RESULTS = 1
export const MAX_SEARCH_RESULTS = 30

export function clampSearchMaxResults(value: number): number {
  if (!Number.isFinite(value)) return MAX_SEARCH_RESULTS
  return Math.min(Math.max(Math.trunc(value), MIN_SEARCH_RESULTS), MAX_SEARCH_RESULTS)
}

/** Toggle one built-in engine, keeping the persisted list in canonical registry
 *  order so toggling on/off/on round-trips to the same value. */
export function toggleEnabledEngine(
  enabledEngineIds: string[],
  id: string,
  enabled: boolean
): string[] {
  const next = enabled
    ? [...enabledEngineIds, id]
    : enabledEngineIds.filter((existing) => existing !== id)
  return BUILTIN_ENGINE_IDS.filter((engineId) => next.includes(engineId))
}

/** The engines an intent currently routes to — the user's override when set,
 *  otherwise the built-in routing. */
export function resolveIntentEngines(
  intentEngines: Record<string, string[]>,
  intent: string
): string[] {
  return intentEngines[intent] ?? BUILTIN_INTENT_CONFIG[intent]?.engines ?? []
}

export function isIntentCustomized(
  intentEngines: Record<string, string[]>,
  intent: string
): boolean {
  return Boolean(intentEngines[intent]?.length)
}

/**
 * Toggle one engine inside an intent's routing.
 *
 * Two deliberate rules: an intent may not be emptied (an empty override is read
 * as "no override" by `resolveSearchPlan`, so showing it would be a lie), and a
 * selection that happens to equal the built-in set is stored as "no override"
 * again so the row goes back to showing 默认.
 */
export function toggleIntentEngine(
  intentEngines: Record<string, string[]>,
  intent: string,
  engineId: string
): Record<string, string[]> {
  const current = resolveIntentEngines(intentEngines, intent)
  const next = current.includes(engineId)
    ? current.filter((id) => id !== engineId)
    : [...current, engineId]
  if (next.length === 0) return intentEngines

  const builtin = BUILTIN_INTENT_CONFIG[intent]?.engines ?? []
  const matchesBuiltin = next.length === builtin.length && next.every((id) => builtin.includes(id))

  const updated = { ...intentEngines }
  if (matchesBuiltin) delete updated[intent]
  else updated[intent] = next
  return updated
}

export function resetIntentEngines(
  intentEngines: Record<string, string[]>,
  intent: string
): Record<string, string[]> {
  const updated = { ...intentEngines }
  delete updated[intent]
  return updated
}

/** Broadest engine set the user can pick from: every built-in. */
export const DEFAULT_BROWSER_SEARCH_SETTINGS: BrowserSearchSettings = {
  enabledEngineIds: [...BUILTIN_ENGINE_IDS],
  intentEngines: {},
  autoRoute: true,
  maxResults: 10,
  customEngines: []
}

export function engineDisplayName(engine: EngineConfig): string {
  return translateOr(engine.nameKey, { ns: 'common' }, engine.name)
}

export function intentDisplayName(intent: string): string {
  return translateOr(`browserSearch.intents.${intent}`, { ns: 'common' }, intent)
}

export function detectIntent(query: string): string {
  const lower = query.toLowerCase()

  if (['site:', 'filetype:', 'intitle:', 'inurl:'].some((x) => query.includes(x))) {
    return 'general'
  }

  const academicKeywords = ['论文', 'paper', 'arxiv', '学术', '期刊', 'research', 'study', 'journal']
  if (academicKeywords.some((k) => lower.includes(k))) return 'academic'

  const techKeywords = [
    'python',
    'javascript',
    '代码',
    'github',
    'stackoverflow',
    '编程',
    '开发',
    'code',
    'bug',
    'error'
  ]
  if (techKeywords.some((k) => lower.includes(k))) return 'tech'

  const financeKeywords = ['股票', '基金', '财报', 'a股', '投资', '理财', '股市', 'stock', 'finance']
  if (financeKeywords.some((k) => lower.includes(k))) return 'finance'

  const socialKeywords = ['公众号', '微信', '知乎', '微博', '小红书', 'wechat']
  if (socialKeywords.some((k) => lower.includes(k))) return 'social'

  return 'general'
}

/** Turn a user-defined engine into something the search loop can run. */
export function toEngineConfig(engine: CustomSearchEngine): EngineConfig {
  return {
    id: engine.id,
    nameKey: '',
    name: engine.name || engine.id,
    searchUrl: engine.urlTemplate,
    type: engine.intent || 'general',
    timeout: 15000,
    extractor: 'dom',
    renderMode: engine.renderMode,
    renderWaitMs: 3000,
    selectors:
      engine.tier === 'selector' && engine.selectors.item ? engine.selectors : undefined,
    // Tier 1 has no selectors, so its hits come from the generic h2/h3 heuristic.
    lowConfidence: engine.tier === 'basic'
  }
}

/** Resolve the enabled engine set and the intent plan for one query. */
export function resolveSearchPlan(
  query: string,
  options?: Partial<BrowserSearchSettings>,
  intentOverride?: string
): SearchPlan {
  const enabledIds =
    options?.enabledEngineIds && options.enabledEngineIds.length > 0
      ? options.enabledEngineIds
      : BUILTIN_ENGINE_IDS
  const custom = (options?.customEngines ?? []).filter((engine) => engine.enabled)

  const available = new Map<string, EngineConfig>()
  for (const id of enabledIds) {
    const builtin = BUILTIN_ENGINES[id]
    if (builtin) available.set(id, builtin)
  }
  for (const engine of custom) available.set(engine.id, toEngineConfig(engine))

  // Every engine off (or every id unknown) — never query nothing.
  if (available.size === 0) {
    for (const id of BUILTIN_ENGINE_IDS) {
      const builtin = BUILTIN_ENGINES[id]
      if (builtin) available.set(id, builtin)
    }
  }

  const intent =
    intentOverride && BUILTIN_INTENT_CONFIG[intentOverride] ? intentOverride : detectIntent(query)

  const autoRoute = options?.autoRoute !== false
  if (!autoRoute) {
    return {
      intent,
      routing: 'all',
      engines: [...available.values()],
      maxConcurrent: Math.min(6, available.size)
    }
  }

  const override = options?.intentEngines?.[intent]
  const routedIds =
    override && override.length > 0
      ? [...override]
      : [...(BUILTIN_INTENT_CONFIG[intent]?.engines ?? [])]

  for (const engine of custom) {
    if (engine.intent === intent && !routedIds.includes(engine.id)) routedIds.push(engine.id)
  }

  let engines = routedIds
    .map((id) => available.get(id))
    .filter((engine): engine is EngineConfig => Boolean(engine))

  // The user turned off every engine this intent routes to — widen to all of
  // their enabled engines rather than returning an empty search.
  if (engines.length === 0) engines = [...available.values()]

  const maxConcurrent = Math.max(
    1,
    Math.min(BUILTIN_INTENT_CONFIG[intent]?.maxConcurrent ?? 5, engines.length)
  )

  return { intent, routing: 'intent', engines, maxConcurrent }
}
