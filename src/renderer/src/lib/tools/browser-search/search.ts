import { useSettingsStore } from '@renderer/stores/settings-store'
import { encodeStructuredToolResult, encodeToolError } from '../tool-result-format'
import type { ToolContext } from '../tool-types'
import type { ToolResultContent } from '../../api/types'
import { interleaveByEngine, deduplicate } from './dedupe'
import { clampSearchMaxResults, engineDisplayName, resolveSearchPlan } from './engines'
import { extractFromHtml } from './extract'
import type { EngineConfig, EngineStatus, SearchResultItem } from './types'

/** Fetch one engine's search page and parse it. Never throws — a broken engine
 *  must not take the whole search down. */
async function runEngine(
  engine: EngineConfig,
  query: string,
  ctx: ToolContext
): Promise<{ items: SearchResultItem[]; status: EngineStatus }> {
  const engineName = engineDisplayName(engine)
  const url = engine.searchUrl.replace('{query}', encodeURIComponent(query))

  try {
    let html: string

    if (engine.renderMode === 'rendered') {
      // Hidden BrowserWindow, for engines that block plain HTTP or need JS.
      const rendered = (await ctx.ipc.invoke('web:fetch-rendered', {
        url,
        waitMs: engine.renderWaitMs ?? 3000
      })) as { content?: string; error?: string }

      if (rendered.error) {
        return { items: [], status: { engine: engineName, status: 'error', count: 0, error: rendered.error } }
      }
      html = rendered.content ?? ''
    } else {
      // Plain HTTP through the Worker. Its WebFetch executor already sends a
      // desktop Chrome UA and a zh-CN Accept-Language, so Chinese engines answer
      // in Chinese without the renderer having to set anything.
      const fetched = (await ctx.ipc.invoke('web:fetch', {
        url,
        format: 'html',
        timeout: engine.timeout
      })) as { results?: Array<{ content?: string; error?: string }>; error?: string }

      if (fetched.error) {
        return { items: [], status: { engine: engineName, status: 'error', count: 0, error: fetched.error } }
      }
      const first = fetched.results?.[0]
      if (first?.error) {
        return { items: [], status: { engine: engineName, status: 'error', count: 0, error: first.error } }
      }
      html = first?.content ?? ''
    }

    if (!html) {
      return { items: [], status: { engine: engineName, status: 'empty', count: 0 } }
    }

    const items = extractFromHtml(html, engine, engineName)
    return {
      items,
      status: { engine: engineName, status: items.length > 0 ? 'ok' : 'empty', count: items.length }
    }
  } catch (err) {
    return {
      items: [],
      status: {
        engine: engineName,
        status: 'error',
        count: 0,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  }
}

export async function executeBrowserSearch(
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResultContent> {
  const query = (input.query as string)?.trim()
  if (!query) {
    return encodeToolError('query is required')
  }

  const settings = useSettingsStore.getState().browserSearch
  const requestedMax = (input.maxResults as number) ?? settings?.maxResults ?? 10
  const maxResults = clampSearchMaxResults(requestedMax)
  const intentOverride = (input.intent as string)?.trim()
  const plan = resolveSearchPlan(query, settings, intentOverride)

  // Concurrency-limited parallel fetch. Results are kept per engine so they can
  // be interleaved afterwards — appending in completion order would let the
  // fastest engine take every slot.
  const queue = plan.engines.map((engine, index) => ({ engine, index }))
  const groups = new Map<number, SearchResultItem[]>()
  const statuses = new Map<number, EngineStatus>()

  async function pump(): Promise<void> {
    for (;;) {
      const next = queue.shift()
      if (!next) return
      const { items, status } = await runEngine(next.engine, query, ctx)
      groups.set(next.index, items)
      statuses.set(next.index, status)
    }
  }

  const workerCount = Math.max(1, Math.min(plan.maxConcurrent, plan.engines.length))
  await Promise.all(Array.from({ length: workerCount }, () => pump()))

  const ordered = plan.engines.map((_, index) => groups.get(index) ?? [])
  const engineStatus = plan.engines
    .map((_, index) => statuses.get(index))
    .filter((status): status is EngineStatus => Boolean(status))

  const totalFetched = ordered.reduce((sum, items) => sum + items.length, 0)
  const aggregated = deduplicate(interleaveByEngine(ordered), maxResults, query)

  const okEngines = engineStatus.filter((status) => status.status === 'ok')

  return encodeStructuredToolResult({
    query,
    intent: plan.intent,
    routing: plan.routing,
    results: aggregated,
    count: aggregated.length,
    engines_queried: plan.engines.length,
    engines_succeeded: okEngines.length,
    engines_failed: engineStatus.filter((status) => status.status !== 'ok').length,
    engine_details: engineStatus,
    total_fetched: totalFetched,
    after_deduplication: aggregated.length
  })
}
