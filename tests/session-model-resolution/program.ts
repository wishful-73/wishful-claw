/*
 * Session model resolution — which provider/model a session will actually use.
 *
 * Pins the `auto` branch in particular. `auto` means "let a quota failure hand this
 * session over", so a usable session binding has to win over the global selection:
 * that binding is what the user picked, and it is what a handover writes. The whole
 * "switched provider but the next message went back to the limited one" defect came
 * from this branch ignoring the binding and reading the global selection instead.
 */

import assert from 'node:assert/strict'
import { resolveSessionModelSelection } from '../../src/renderer/src/lib/session-model-resolution'
import type { AIProvider } from '../../src/shared/types/provider'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.deepStrictEqual(actual, expected, `${message} (got ${JSON.stringify(actual)})`)
}

function provider(id: string, modelIds: string[]): AIProvider {
  return {
    id,
    name: `Provider ${id}`,
    type: 'openai-chat',
    apiKey: 'sk-test',
    baseUrl: 'https://example.test/v1',
    enabled: true,
    models: modelIds.map((modelId) => ({ id: modelId, name: modelId, enabled: true })),
    createdAt: 0
  } as unknown as AIProvider
}

const providers = [provider('a', ['a1', 'a2']), provider('b', ['b1'])]

function resolve(session: Record<string, unknown> | null, globalProviderId = 'b', globalModelId = 'b1') {
  return resolveSessionModelSelection({
    session: session as never,
    providers,
    activeProviderId: globalProviderId,
    activeModelId: globalModelId,
    globalMode: 'manual'
  })
}

// ── auto: the session's own binding wins ─────────────────────────────────────
{
  const bound = resolve({ modelSelectionMode: 'auto', providerId: 'a', modelId: 'a1' })
  eq(bound.providerId, 'a', 'auto with a binding uses the bound provider')
  eq(bound.modelId, 'a1', 'auto with a binding uses the bound model')
  eq(bound.isAutoModeActive, true, 'auto stays auto mode')
  eq(bound.mode, 'auto', 'the mode is reported as auto, not collapsed to manual')
  eq(bound.isSessionBound, true, 'a bound auto session counts as session-bound')
}

// ── auto: no binding yet falls back to the global selection ──────────────────
{
  const fresh = resolve({ modelSelectionMode: 'auto' })
  eq(fresh.providerId, 'b', 'a fresh auto session follows the global provider')
  eq(fresh.modelId, 'b1', 'a fresh auto session follows the global model')
  eq(fresh.isSessionBound, false, 'a fresh auto session is not session-bound')
  eq(
    fresh.isAutoModeActive,
    true,
    'a fresh auto session is still in auto mode — it can take a handover'
  )
}

// ── auto: a binding that no longer resolves must not strand the session ──────
{
  const dangling = resolve({ modelSelectionMode: 'auto', providerId: 'a', modelId: 'gone' })
  eq(dangling.providerId, 'b', 'an unresolvable bound model falls back to the global provider')

  const missingProvider = resolve({
    modelSelectionMode: 'auto',
    providerId: 'nope',
    modelId: 'x'
  })
  eq(missingProvider.providerId, 'b', 'an unknown bound provider falls back to the global one')

  const halfBound = resolve({ modelSelectionMode: 'auto', providerId: 'a' })
  eq(halfBound.providerId, 'b', 'a provider without a model is not a usable binding')
}

// ── inherit / manual / plugin keep their meanings ────────────────────────────
{
  const inherit = resolve({ modelSelectionMode: 'inherit' })
  eq(inherit.providerId, 'b', 'inherit follows the global selection')
  eq(inherit.mode, 'inherit', 'inherit reports inherit')
  eq(inherit.isSessionBound, false, 'inherit is not session-bound')

  const manual = resolve({ modelSelectionMode: 'manual', providerId: 'a', modelId: 'a2' })
  eq(manual.providerId, 'a', 'manual uses its own binding')
  eq(manual.modelId, 'a2', 'manual uses its own model')
  eq(manual.isAutoModeActive, false, 'manual is not auto')

  const plugin = resolveSessionModelSelection({
    session: { pluginId: 'feishu', modelSelectionMode: 'inherit' } as never,
    providers,
    activeProviderId: 'b',
    activeModelId: 'b1',
    globalMode: 'manual',
    channelProviderId: 'a',
    channelModelId: 'a1'
  })
  eq(plugin.providerId, 'a', 'a channel-bound session uses the channel binding')
  eq(plugin.source, 'plugin', 'the channel binding is reported as the plugin source')
}

// ── The handover property: writing the binding is enough to make it stick ────
// This is exactly what the old design got wrong — it wrote the session and then
// resolved against a different table, so the next message used the limited provider.
{
  const session = { modelSelectionMode: 'auto' }
  eq(resolve(session).providerId, 'b', 'before a handover the session follows the global provider')

  const handedOver = { ...session, providerId: 'a', modelId: 'a1' }
  eq(
    resolve(handedOver).providerId,
    'a',
    'after writing the handover target, resolution returns it — the switch sticks'
  )
  eq(
    resolve(handedOver).isAutoModeActive,
    true,
    'the session is still auto, so a later quota failure can hand it over again'
  )
}

console.log(`session model resolution checks passed: ${checks}`)
