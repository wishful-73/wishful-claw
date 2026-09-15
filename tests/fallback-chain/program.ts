/*
 * The rules behind the quota-failover chain.
 *
 * These live in a store-free module so they can be loaded here at all — and they are
 * precisely the rules that decide whether a handover happens, to whom, and with which
 * model. Getting one of them wrong means either a handover that should not have happened
 * or a session that gets stuck on a provider that just refused it.
 */

import assert from 'node:assert/strict'
import {
  isProviderUsable,
  pickNextFallbackCandidate,
  resolveCandidateModelId,
  resolveFallbackChain
} from '../../src/renderer/src/lib/agent/fallback-chain'
import type { AIProvider, ProviderFallbackCandidate } from '../../src/shared/types/provider'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.deepStrictEqual(actual, expected, `${message} (got ${JSON.stringify(actual)})`)
}

function provider(
  id: string,
  models: Array<{ id: string; enabled?: boolean; category?: string }>,
  overrides: Record<string, unknown> = {}
): AIProvider {
  return {
    id,
    name: `Provider ${id}`,
    type: 'openai-chat',
    apiKey: 'sk-test',
    baseUrl: 'https://example.test/v1',
    enabled: true,
    models: models.map((model) => ({
      id: model.id,
      name: model.id,
      enabled: model.enabled !== false,
      ...(model.category ? { category: model.category } : {})
    })),
    createdAt: 0,
    ...overrides
  } as unknown as AIProvider
}

const candidate = (providerId: string, modelId: string): ProviderFallbackCandidate => ({
  providerId,
  modelId
})

// ── Which chain applies ──────────────────────────────────────────────────────
{
  const defaults = [candidate('a', 'a1')]

  eq(
    resolveFallbackChain(null, defaults),
    defaults,
    'no override means the session walks the default chain'
  )
  eq(
    resolveFallbackChain(undefined, defaults),
    defaults,
    'a missing override behaves like no override'
  )

  const own = [candidate('b', 'b1')]
  eq(resolveFallbackChain(own, defaults), own, 'an override replaces the default chain')

  // The one that matters: switching every candidate off must NOT fall back to the
  // default, which would hand over against the user's explicit wish.
  eq(
    resolveFallbackChain([], defaults),
    [],
    'an empty override means "do not hand over here", not "use the default"'
  )
}

// ── Provider usability ───────────────────────────────────────────────────────
{
  check(isProviderUsable(provider('a', [{ id: 'a1' }])), 'an enabled provider with a key is usable')
  check(
    isProviderUsable(provider('a', [{ id: 'a1' }], { requiresApiKey: false, apiKey: '' })),
    'a provider that needs no key is usable without one'
  )
  check(
    !isProviderUsable(provider('a', [{ id: 'a1' }], { apiKey: '' })),
    'a provider that needs a key is unusable without one'
  )
  check(
    !isProviderUsable(provider('a', [{ id: 'a1' }], { enabled: false })),
    'a disabled provider is unusable'
  )
}

// ── Candidate model validity: read from config, never guessed ────────────────
{
  const p = provider('a', [
    { id: 'a1' },
    { id: 'off', enabled: false },
    { id: 'img', category: 'image' }
  ])

  eq(resolveCandidateModelId(p, 'a1'), 'a1', 'a listed, enabled chat model is usable')
  eq(resolveCandidateModelId(p, ''), null, 'an unchosen model is skipped rather than substituted')
  eq(resolveCandidateModelId(p, 'nope'), null, 'a model the provider does not have is skipped')
  eq(resolveCandidateModelId(p, 'off'), null, 'a disabled model is skipped')
  eq(resolveCandidateModelId(p, 'img'), null, 'a non-chat model cannot serve the continuation turn')
  eq(
    resolveCandidateModelId(provider('b', [{ id: 'a1' }]), 'a1'),
    'a1',
    'the same model id on another provider resolves there — the name is not the identity'
  )
}

// ── Walking the chain ────────────────────────────────────────────────────────
{
  const a = provider('a', [{ id: 'a1' }])
  const b = provider('b', [{ id: 'b1' }])
  const c = provider('c', [{ id: 'c1' }])
  const chain = [candidate('a', 'a1'), candidate('b', 'b1'), candidate('c', 'c1')]

  const first = pickNextFallbackCandidate(chain, [a, b, c], new Set())
  eq(first?.provider.id, 'a', 'the walk takes the first usable candidate')
  eq(first?.modelId, 'a1', 'and its configured model')

  // The provider that just failed is in `skip`, so the walk moves past it.
  const afterA = pickNextFallbackCandidate(chain, [a, b, c], new Set(['a']))
  eq(afterA?.provider.id, 'b', 'a skipped provider is not revisited')

  // Everything tried → nothing left, and the caller reports the quota error.
  eq(
    pickNextFallbackCandidate(chain, [a, b, c], new Set(['a', 'b', 'c'])),
    null,
    'an exhausted chain yields no target'
  )
  eq(pickNextFallbackCandidate([], [a, b, c], new Set()), null, 'an empty chain yields no target')
}

// ── Skipping is by capability, not just by presence ──────────────────────────
{
  const noKey = provider('a', [{ id: 'a1' }], { apiKey: '' })
  const disabled = provider('b', [{ id: 'b1' }], { enabled: false })
  const noModel = provider('c', [{ id: 'c1' }])
  const good = provider('d', [{ id: 'd1' }])
  const chain = [
    candidate('a', 'a1'),
    candidate('b', 'b1'),
    candidate('c', 'unchosen'),
    candidate('d', 'd1')
  ]

  const match = pickNextFallbackCandidate(chain, [noKey, disabled, noModel, good], new Set())
  eq(
    match?.provider.id,
    'd',
    'providers without a key, disabled providers, and candidates without a usable model are all skipped'
  )

  const missing = pickNextFallbackCandidate([candidate('ghost', 'g1')], [good], new Set())
  eq(missing, null, 'a candidate whose provider no longer exists is skipped')
}

// ── Order is the user's, and it decides ─────────────────────────────────────
{
  const a = provider('a', [{ id: 'a1' }])
  const b = provider('b', [{ id: 'b1' }])
  const reordered = [candidate('b', 'b1'), candidate('a', 'a1')]

  eq(
    pickNextFallbackCandidate(reordered, [a, b], new Set())?.provider.id,
    'b',
    'the chain order decides who takes over first'
  )
}

console.log(`fallback chain checks passed: ${checks}`)
