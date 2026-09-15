/** One aggregated hit. `source_engine` is the localized engine display name. */
export interface SearchResultItem {
  title: string
  url: string
  snippet: string
  source_engine: string
  /** Set when the hit came from a tier-1 custom engine, whose parsing is only
   *  the generic h2/h3 heuristic and therefore may be off. */
  confidence?: 'low'
}

/** CSS selector overrides for a user-defined engine (tier 2). Empty fields fall
 *  back to the generic `h2 a[href], h3 a[href]` heuristic. */
export interface EngineSelectors {
  item: string
  title: string
  url: string
  snippet: string
}

export interface EngineConfig {
  id: string
  /** i18n key for the display name. Empty for user-defined engines. */
  nameKey: string
  /** Literal fallback when the i18n namespace is not loaded yet. */
  name: string
  searchUrl: string
  type: string
  timeout: number
  /** Base URL for resolving relative links in search results. */
  baseUrl?: string
  /** Special extraction mode for non-DOM engines. */
  extractor?: 'dom' | 'toutiao_ssr' | 'xml'
  /** Fetch method: 'http' for plain HTTP, 'rendered' for headless browser. */
  renderMode?: 'http' | 'rendered'
  /** Wait time after page load for rendered mode (ms). */
  renderWaitMs?: number
  /** User-defined engine (tier 2) selector overrides. */
  selectors?: EngineSelectors
  /** Mark every hit from this engine as low confidence (tier 1 custom engines). */
  lowConfidence?: boolean
}

export interface IntentConfig {
  engines: string[]
  maxConcurrent: number
}

export interface EngineStatus {
  engine: string
  status: 'ok' | 'empty' | 'error'
  count: number
  error?: string
}

export interface SearchPlan {
  intent: string
  /** `intent` = intent routing was used, `all` = auto-routing is off. */
  routing: 'intent' | 'all'
  engines: EngineConfig[]
  maxConcurrent: number
}
