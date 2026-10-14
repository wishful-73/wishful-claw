/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

// Import the encoding directly. The package root also includes the much larger
// o200k model catalog, even though this estimator is intentionally cl100k-based.
import { encode } from 'gpt-tokenizer/encoding/cl100k_base'
import type { TokenUsage, AIModelConfig, ProviderType } from './api/types'

/**
 * Token count unit ladder. `k` stays lowercase (SI prefix, and it is what the
 * largest share of the UI already showed); `M` / `G` / `T` are uppercase.
 */
const TOKEN_UNITS: ReadonlyArray<{ divisor: number; suffix: string }> = [
  { divisor: 1_000, suffix: 'k' },
  { divisor: 1_000_000, suffix: 'M' },
  { divisor: 1_000_000_000, suffix: 'G' },
  { divisor: 1_000_000_000_000, suffix: 'T' }
]

/**
 * Precision inside one unit: `< 10` two decimals, `< 100` one, `>= 100` none.
 * The bucket is picked from the *rounded* value so `9.999` renders `10.0k`
 * rather than `10.00k`.
 */
function formatScaledUnit(scaled: number): string {
  if (Math.round(scaled * 100) / 100 < 10) return scaled.toFixed(2)
  if (Math.round(scaled * 10) / 10 < 100) return scaled.toFixed(1)
  return scaled.toFixed(0)
}

/**
 * Format a token count into a compact, human-readable string.
 *
 * **The only implementation in the repo** (S-194) — the context ring, the
 * composer counter and every usage panel go through it, so one number never
 * renders as two different strings.
 *
 * Rules: ladder `k` / `M` / `G` / `T`; `< 1000` prints the plain integer; inside
 * a unit `< 10` two decimals, `< 100` one, `>= 100` none; and if rounding crosses
 * 1000 the whole thing is recomputed one unit up (`999999` → `1.00M`, not `1000k`).
 *
 * Examples: 0 → "0", 850 → "850", 1000 → "1.00k", 1234 → "1.23k", 12500 → "12.5k",
 * 123456 → "123k", 999999 → "1.00M", 1127850000 → "1.13G", 1e12 → "1.00T"
 */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  const value = Math.round(n)
  if (value < 1_000) return String(value)
  for (let index = 0; index < TOKEN_UNITS.length; index += 1) {
    const { divisor, suffix } = TOKEN_UNITS[index]
    const text = formatScaledUnit(value / divisor)
    // Rounding carried into a fourth digit (`999999` → `1000k`) — redo it one unit up.
    if (Number(text) >= 1_000 && index < TOKEN_UNITS.length - 1) continue
    return `${text}${suffix}`
  }
  return String(value)
}

export function getBillableInputTokens(
  usage: TokenUsage,
  _requestType?: ProviderType | AIModelConfig['type']
): number {
  if (usage.billableInputTokens != null) return usage.billableInputTokens
  return Math.max(
    0,
    (usage.inputTokens ?? 0) -
      Math.max(0, usage.cacheReadTokens ?? 0) -
      getCacheCreationTokens(usage)
  )
}

export function getCacheCreationTokens(usage: Partial<TokenUsage> | null | undefined): number {
  if (!usage) return 0
  const direct = Math.max(0, usage.cacheCreationTokens ?? 0)
  const detailed =
    Math.max(0, usage.cacheCreation5mTokens ?? 0) + Math.max(0, usage.cacheCreation1hTokens ?? 0)
  return Math.max(direct, detailed)
}

/**
 * Split cache-creation (cache write) tokens into 5-minute and 1-hour TTL buckets.
 * When a provider reports a detailed breakdown (Anthropic's
 * `cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens`), those
 * values are used; OpenAI's `cache_write_tokens` arrives as the combined total with
 * no TTL split. Any remainder between the combined total and the detailed sum is
 * attributed to the 5-minute bucket (the default ephemeral TTL). When no breakdown is
 * available, the whole combined total is treated as 5-minute. The two buckets always
 * sum back to {@link getCacheCreationTokens}.
 */
export function getCacheCreationSplit(usage: Partial<TokenUsage> | null | undefined): {
  fiveMinuteTokens: number
  oneHourTokens: number
} {
  const total = getCacheCreationTokens(usage)
  if (!usage || total <= 0) return { fiveMinuteTokens: 0, oneHourTokens: 0 }
  const oneHourTokens = Math.max(0, usage.cacheCreation1hTokens ?? 0)
  const hasDetailedBreakdown =
    usage.cacheCreation5mTokens != null || usage.cacheCreation1hTokens != null
  const detailedTotal = Math.max(0, usage.cacheCreation5mTokens ?? 0) + oneHourTokens
  const fiveMinuteTokens = hasDetailedBreakdown
    ? Math.max(0, usage.cacheCreation5mTokens ?? 0) + Math.max(total - detailedTotal, 0)
    : total
  return { fiveMinuteTokens, oneHourTokens }
}

export function getCacheHitRate(
  billableInputTokens: number,
  cacheReadTokens: number,
  cacheCreationTokens = 0
): number {
  const safeBillableInputTokens = Number.isFinite(billableInputTokens)
    ? Math.max(0, billableInputTokens)
    : 0
  const safeCacheReadTokens = Number.isFinite(cacheReadTokens) ? Math.max(0, cacheReadTokens) : 0
  const safeCacheCreationTokens = Number.isFinite(cacheCreationTokens)
    ? Math.max(0, cacheCreationTokens)
    : 0
  // Cache-creation tokens are cache misses billed at write price, so they belong in the
  // denominator: the hit rate reflects the share of all input tokens served from cache.
  const totalInputTokens = safeBillableInputTokens + safeCacheReadTokens + safeCacheCreationTokens

  if (totalInputTokens <= 0) return 0
  return safeCacheReadTokens / totalInputTokens
}

export function getCacheReadRatio(inputTokens: number, cacheReadTokens: number): number {
  const safeInputTokens = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0
  const safeCacheReadTokens = Number.isFinite(cacheReadTokens) ? Math.max(0, cacheReadTokens) : 0

  if (safeInputTokens <= 0) return 0
  return Math.min(1, safeCacheReadTokens / safeInputTokens)
}

export function formatCacheHitRate(rate: number): string {
  const safeRate = Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0
  const percent = Math.round(safeRate * 1000) / 10
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(1)}%`
}

/**
 * Session-level cache hit rate using Reasonix's formula:
 * hitRate = sessionCacheHit / (sessionCacheHit + sessionCacheMiss)
 * Returns 0 when no cache data exists.
 */
export function getSessionCacheHitRate(
  sessionCacheHit: number | undefined,
  sessionCacheMiss: number | undefined
): number {
  const hit = Math.max(0, sessionCacheHit ?? 0)
  const miss = Math.max(0, sessionCacheMiss ?? 0)
  const denom = hit + miss
  if (denom <= 0) return 0
  return hit / denom
}

/**
 * Format session cache hit rate as a percentage string.
 * Uses 2 decimal places (matching Reasonix's formatCacheHitRate).
 */
export function formatSessionCacheHitRate(
  sessionCacheHit: number | undefined,
  sessionCacheMiss: number | undefined
): string {
  const hit = Math.max(0, sessionCacheHit ?? 0)
  const miss = Math.max(0, sessionCacheMiss ?? 0)
  const denom = hit + miss
  if (denom <= 0) return '-'
  const pct = (hit / denom) * 100
  return `${pct.toFixed(2)}%`
}

export function getUsageCacheHitRate(
  usage: TokenUsage,
  requestType?: ProviderType | AIModelConfig['type']
): number {
  return getCacheHitRate(
    getBillableInputTokens(usage, requestType),
    usage.cacheReadTokens ?? 0,
    getCacheCreationTokens(usage)
  )
}

export function getBillableTotalTokens(
  usage: TokenUsage,
  requestType?: ProviderType | AIModelConfig['type']
): number {
  return getBillableInputTokens(usage, requestType) + (usage.outputTokens ?? 0)
}

export function resolveCacheCreationCost(
  usage: TokenUsage,
  model: AIModelConfig | null | undefined
): { price: number | null; cost: number | null } {
  const totalCacheCreationTokens = getCacheCreationTokens(usage)

  if (totalCacheCreationTokens <= 0) {
    return {
      price:
        model?.cacheCreationPrice ?? (model?.inputPrice != null ? model.inputPrice * 1.25 : null),
      cost: 0
    }
  }

  const { fiveMinuteTokens: cacheCreation5mTokens, oneHourTokens: cacheCreation1hTokens } =
    getCacheCreationSplit(usage)
  const cacheCreation5mPrice =
    model?.cacheCreationPrice ?? (model?.inputPrice != null ? model.inputPrice * 1.25 : null)
  const cacheCreation1hPrice = model?.inputPrice != null ? model.inputPrice * 2 : null

  if (cacheCreation5mPrice == null || (cacheCreation1hTokens > 0 && cacheCreation1hPrice == null)) {
    return { price: null, cost: null }
  }

  const cost =
    (cacheCreation5mTokens * cacheCreation5mPrice +
      cacheCreation1hTokens * (cacheCreation1hPrice ?? 0)) /
    1_000_000

  return {
    price: cost > 0 ? (cost * 1_000_000) / totalCacheCreationTokens : cacheCreation5mPrice,
    cost
  }
}

export interface TokenCostBreakdown {
  inputCost: number | null
  outputCost: number | null
  cacheCreationCost: number | null
  cacheReadCost: number | null
  totalCost: number | null
}

export function calculateCostBreakdown(
  usage: TokenUsage,
  model: AIModelConfig | null | undefined
): TokenCostBreakdown {
  const inputPrice = model?.inputPrice ?? null
  const outputPrice = model?.outputPrice ?? null
  const cacheCreationTokens = getCacheCreationTokens(usage)
  const billableInput = getBillableInputTokens(usage, model?.type)
  const cacheReadPrice = model?.cacheHitPrice ?? (inputPrice != null ? inputPrice * 0.1 : null)
  const { cost: cacheCreationCost } = resolveCacheCreationCost(usage, model)

  const inputCost = inputPrice == null ? null : (billableInput * inputPrice) / 1_000_000
  const outputCost =
    outputPrice == null ? null : ((usage.outputTokens ?? 0) * outputPrice) / 1_000_000
  const resolvedCacheCreationCost =
    cacheCreationTokens > 0 ? cacheCreationCost : inputPrice == null ? null : 0
  const cacheReadCost =
    cacheReadPrice == null ? null : ((usage.cacheReadTokens ?? 0) * cacheReadPrice) / 1_000_000
  const pieces = [inputCost, outputCost, resolvedCacheCreationCost, cacheReadCost]
  const totalCost = pieces.every((item) => item == null)
    ? null
    : pieces.reduce<number>((sum, item) => sum + (item ?? 0), 0)

  return {
    inputCost,
    outputCost,
    cacheCreationCost: resolvedCacheCreationCost,
    cacheReadCost,
    totalCost
  }
}

/**
 * Calculate the USD cost of a request based on token usage and model pricing.
 * Prices in AIModelConfig are per **million** tokens.
 * Returns null if pricing info is unavailable.
 */
export function calculateCost(
  usage: TokenUsage,
  model: AIModelConfig | null | undefined
): number | null {
  if (!model || model.inputPrice == null || model.outputPrice == null) return null

  const cacheCreationTokens = getCacheCreationTokens(usage)
  const { totalCost, cacheCreationCost } = calculateCostBreakdown(usage, model)
  if (cacheCreationTokens > 0 && cacheCreationCost == null) return null
  return totalCost
}

/**
 * Format a USD cost value into a display string.
 * Examples: 0.001 → "<$0.01", 0.05 → "$0.05", 1.234 → "$1.23"
 */
export function formatCost(cost: number): string {
  if (cost < 0.001) return '<$0.001'
  if (cost < 0.01) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

/**
 * Estimate the number of tokens in a string using OpenAI's tokenizer (cl100k_base).
 * Use this only when the LLM does not provide token usage — prefer API-reported counts.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return encode(text, { allowedSpecial: 'all' }).length
}
