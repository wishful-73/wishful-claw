import {
  DEFAULT_PROVIDER_FALLBACK,
  normalizeProviderFallback
} from '../../src/renderer/src/stores/settings-store-types'
import { isQuotaFailure } from '../../src/renderer/src/lib/agent/quota-failure'

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
eq(DEFAULT_PROVIDER_FALLBACK.priority, [], 'fallback should default to no candidates')

// Missing / malformed values fall back to the default shape
for (const bad of [null, undefined, 'nope', 42, true]) {
  eq(normalizeProviderFallback(bad), { enabled: false, priority: [] }, `non-object input should reset: ${String(bad)}`)
}
eq(normalizeProviderFallback({}), { enabled: false, priority: [] }, 'empty object should reset')
eq(
  normalizeProviderFallback({ enabled: 'yes', priority: 'nope' }),
  { enabled: false, priority: [] },
  'wrong field types should reset'
)

// Well-formed values survive, in order
eq(
  normalizeProviderFallback({ enabled: true, priority: ['b', 'a', 'c'] }),
  { enabled: true, priority: ['b', 'a', 'c'] },
  'explicit priority order should be preserved verbatim'
)

// Ordering is the whole feature: it must not be sorted or deduped by accident
eq(
  normalizeProviderFallback({ enabled: true, priority: ['z', 'a'] }).priority,
  ['z', 'a'],
  'priority must keep user order'
)

// Duplicates and junk ids are dropped, blanks included
eq(
  normalizeProviderFallback({ enabled: true, priority: ['a', 'b', 'a'] }).priority,
  ['a', 'b'],
  'duplicate ids should collapse to the first occurrence'
)
eq(
  normalizeProviderFallback({ enabled: true, priority: ['a', 42, null, '', '  ', 'b'] }).priority,
  ['a', 'b'],
  'non-string and blank ids should be dropped'
)

// A non-boolean `enabled` must never read as truthy by accident
assert(normalizeProviderFallback({ enabled: 1 }).enabled === false, 'numeric enabled should not be truthy')
assert(normalizeProviderFallback({ enabled: 'true' }).enabled === false, 'string enabled should not be truthy')
assert(normalizeProviderFallback({ enabled: true }).enabled === true, 'boolean true should be preserved')

// The default object must not be handed out by reference — callers mutate the result
const first = normalizeProviderFallback(null)
first.priority.push('mutated')
eq(DEFAULT_PROVIDER_FALLBACK.priority, [], 'default priority must not be shared by reference')
eq(normalizeProviderFallback(null).priority, [], 'a fresh copy must be returned each call')

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

console.log(`Provider fallback config checks passed (${assertions} assertions).`)