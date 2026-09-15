/*
 * Pure decisions behind the quota-failover chain.
 *
 * Split out of `provider-auto-fallback` because that module imports three stores, which
 * makes it impossible to load from a plain node test — and these are exactly the rules
 * that need pinning: which chain applies, who is skipped, and what counts as a usable
 * model. The same reason `quota-failure.ts` exists.
 */

import type { AIProvider, ProviderFallbackCandidate } from '../../../../shared/types/provider'

/**
 * The chain a session actually walks.
 *
 * `null`/`undefined` means "never adjusted here" → the default chain. An **empty array is
 * a real answer**: the session switched every candidate off, so it must be taken as-is.
 * Falling through to the default on an empty override would hand a session over against
 * the user's explicit wish, which is the bug this function exists to prevent.
 */
export function resolveFallbackChain(
  override: ProviderFallbackCandidate[] | null | undefined,
  defaults: ProviderFallbackCandidate[]
): ProviderFallbackCandidate[] {
  return override ?? defaults
}

/** A provider that could actually serve a request right now. */
export function isProviderUsable(provider: AIProvider): boolean {
  if (!provider.enabled) return false
  return provider.requiresApiKey === false || Boolean(provider.apiKey)
}

/**
 * Whether the model a candidate names can serve the handover.
 *
 * The model is read **straight from the configuration** — there is deliberately no
 * guessing branch. The previous policy fell back to "the same model id", then the
 * provider default, then its first model; with providers billing their models from one
 * shared quota, which model to use on the next provider is the user's call, not
 * something to infer from a name collision.
 *
 * A non-chat model (image/video/embedding) cannot run the continuation turn either.
 */
export function resolveCandidateModelId(provider: AIProvider, configuredModelId: string): string | null {
  if (!configuredModelId) return null
  const model = (provider.models ?? []).find((item) => item.id === configuredModelId)
  if (!model || model.enabled === false) return null
  if (model.category !== undefined && model.category !== 'chat') return null
  return model.id
}

export interface FallbackCandidateMatch {
  candidate: ProviderFallbackCandidate
  provider: AIProvider
  modelId: string
}

/**
 * First candidate that can take over, walking the chain in order.
 *
 * `skip` holds the provider currently in use plus everything already tried on this
 * chain, so a handover never goes back to the provider that just failed and never
 * cycles. Returns null when nothing is left — the caller then reports the quota error
 * instead of pretending something happened.
 */
export function pickNextFallbackCandidate(
  candidates: readonly ProviderFallbackCandidate[],
  providers: readonly AIProvider[],
  skip: ReadonlySet<string>
): FallbackCandidateMatch | null {
  for (const candidate of candidates) {
    if (skip.has(candidate.providerId)) continue
    const provider = providers.find((item) => item.id === candidate.providerId)
    if (!provider || !isProviderUsable(provider)) continue
    const modelId = resolveCandidateModelId(provider, candidate.modelId)
    if (!modelId) continue
    return { candidate, provider, modelId }
  }
  return null
}
