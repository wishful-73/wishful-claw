import {
  DEFAULT_PROVIDER_FALLBACK,
  normalizeProviderFallback
} from '../../src/renderer/src/stores/settings-store-types'
import { isQuotaFailure, isQuotaFailureSignal } from '../../src/renderer/src/lib/agent/quota-failure'

/**
 * iter-29 / S-21: the fallback config is persisted with the rest of the settings
 * (version bump + partialize + migration), so a malformed value survives a reload
 * and would silently disable failover. These checks pin the normalization rules.
 */
let assertions = 0
function assert(condition: boolean, message: string): void {
  assertions += 1
  if (!condition) throw new Error(message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${message} (got ${JSON.stringify(actual)})`)
}

// Defaults
assert(DEFAULT_PROVIDER_FALLBACK.enabled === false, 'fallback should default to off')
eq(DEFAULT_PROVIDER_FALLBACK.candidates, [], 'fallback should default to no candidates')

// Missing / malformed values fall back to the default shape
for (const bad of [null, undefined, 'nope', 42, true]) {
  eq(normalizeProviderFallback(bad), { enabled: false, candidates: [] }, `non-object input should reset: ${String(bad)}`)
}
eq(normalizeProviderFallback({}), { enabled: false, candidates: [] }, 'empty object should reset')
eq(
  normalizeProviderFallback({ enabled: 'yes', candidates: 'nope' }),
  { enabled: false, candidates: [] },
  'wrong field types should reset'
)

// Well-formed values survive, in order
eq(
  normalizeProviderFallback({
    enabled: true,
    candidates: [
      { providerId: 'b', modelId: 'b1' },
      { providerId: 'a', modelId: 'a1' },
      { providerId: 'c', modelId: 'c1' }
    ]
  }),
  {
    enabled: true,
    candidates: [
      { providerId: 'b', modelId: 'b1' },
      { providerId: 'a', modelId: 'a1' },
      { providerId: 'c', modelId: 'c1' }
    ]
  },
  'explicit candidate order and models should be preserved verbatim'
)

// A provider bills all of its models from one quota, so a second entry is a no-op
eq(
  normalizeProviderFallback({
    enabled: true,
    candidates: [
      { providerId: 'a', modelId: 'a1' },
      { providerId: 'b', modelId: 'b1' },
      { providerId: 'a', modelId: 'a2' }
    ]
  }).candidates,
  [
    { providerId: 'a', modelId: 'a1' },
    { providerId: 'b', modelId: 'b1' }
  ],
  'a repeated provider should collapse to its first occurrence'
)

// Junk entries are dropped, a missing model is tolerated (the user picks it later)
eq(
  normalizeProviderFallback({
    enabled: true,
    candidates: [
      { providerId: 'a' },
      { providerId: 42, modelId: 'x' },
      null,
      { modelId: 'no-provider' },
      { providerId: '  ', modelId: 'x' },
      { providerId: 'b', modelId: 7 }
    ]
  }).candidates,
  [
    { providerId: 'a', modelId: '' },
    { providerId: 'b', modelId: '' }
  ],
  'entries without a usable provider id should be dropped; a bad model becomes empty'
)

// The pre-model shape (`priority: string[]`) upgrades with an EMPTY model: the runtime
// skips an empty model rather than guessing one, which is the whole point of the change.
eq(
  normalizeProviderFallback({ enabled: true, priority: ['a', 'b'] }),
  {
    enabled: true,
    candidates: [
      { providerId: 'a', modelId: '' },
      { providerId: 'b', modelId: '' }
    ]
  },
  'the legacy priority list should migrate to candidates with no model chosen'
)

// `candidates` wins when both shapes are somehow present
eq(
  normalizeProviderFallback({
    enabled: true,
    candidates: [{ providerId: 'new', modelId: 'm' }],
    priority: ['old']
  }).candidates,
  [{ providerId: 'new', modelId: 'm' }],
  'candidates should take precedence over a leftover priority list'
)

// A non-boolean `enabled` must never read as truthy by accident
assert(normalizeProviderFallback({ enabled: 1 }).enabled === false, 'numeric enabled should not be truthy')
assert(normalizeProviderFallback({ enabled: 'true' }).enabled === false, 'string enabled should not be truthy')
assert(normalizeProviderFallback({ enabled: true }).enabled === true, 'boolean true should be preserved')

// The default object must not be handed out by reference — callers mutate the result
const first = normalizeProviderFallback(null)
first.candidates.push({ providerId: 'mutated', modelId: '' })
eq(DEFAULT_PROVIDER_FALLBACK.candidates, [], 'default candidates must not be shared by reference')
eq(normalizeProviderFallback(null).candidates, [], 'a fresh copy must be returned each call')

// ── Quota detection ──────────────────────────────────────────────────────────
// The phrase fallback used to accept bare `overload` and `capacity`, which are
// generic words: a TypeScript "No overload matches this call" in tool output would
// have switched the user's provider and auto-sent a follow-up message. Pin the
// narrow set, and the context-window exclusion that stops a pointless walk to the
// end of the candidate list.
assert(isQuotaFailure('provider request failed HTTP 429: rate limited'), 'a 429 status must count')
assert(isQuotaFailure('provider request failed HTTP 503: down'), 'a 503 status must count')
assert(isQuotaFailure('You exceeded your current quota, please check your plan'), 'quota text must count')
assert(isQuotaFailure('Rate limit reached for gpt-5 in organization'), 'rate limit text must count')
assert(isQuotaFailure('We are currently overloaded, try again later'), 'overloaded must count')
assert(isQuotaFailure('429 Too Many Requests'), 'the standard 429 phrasing must count')

assert(!isQuotaFailure('No overload matches this call.'), 'a TypeScript overload error must not count')
assert(!isQuotaFailure('the server is at capacity'), 'bare "capacity" must not count')
assert(!isQuotaFailure('Connection refused'), 'an unrelated network error must not count')
assert(!isQuotaFailure(''), 'an empty message must not count')
assert(!isQuotaFailure(undefined), 'a missing message must not count')
assert(
  !isQuotaFailure('HTTP 429: context_length_exceeded'),
  'a context-window error must be excluded even when it arrives as a 429'
)
assert(
  !isQuotaFailure('This model\u2019s maximum context length is 400000 tokens'),
  'context window phrasing must be excluded'
)

// ── Structured quota signal ──────────────────────────────────────────────────
// The Worker escapes ProviderRetryPolicy with the original ProviderHttpException once
// its retries are exhausted, and that exception carries the status code. Reading it is
// how "gave up on a 429" is decided from data instead of from the message text — the
// message is not a dedicated channel (tool output lands in it too).
assert(
  isQuotaFailureSignal({ errorType: 'ProviderHttpException', statusCode: 429 }),
  'a ProviderHttpException with 429 must count'
)
assert(
  isQuotaFailureSignal({ errorType: 'ProviderHttpException', statusCode: 503 }),
  'a ProviderHttpException with 503 must count'
)
assert(
  !isQuotaFailureSignal({ errorType: 'ProviderHttpException', statusCode: 400 }),
  'a ProviderHttpException with 400 must not count'
)
assert(
  !isQuotaFailureSignal({ errorType: 'InvalidOperationException', statusCode: 429 }),
  'the status code alone is not enough — the error type must agree'
)
assert(
  isQuotaFailureSignal({ message: 'HTTP 429: rate limited' }),
  'text matching stays as the fallback when no structured fields are present'
)
assert(
  isQuotaFailureSignal({ errorType: 'ProviderHttpException', statusCode: 429, message: 'context_length_exceeded' }),
  'a structured quota signal outranks the message text'
)
assert(!isQuotaFailureSignal(null), 'a missing signal must not count')
assert(!isQuotaFailureSignal({}), 'an empty signal must not count')

console.log(`Provider fallback config checks passed (${assertions} assertions).`)