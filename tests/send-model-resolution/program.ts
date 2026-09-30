/*
 * `resolveSendModel` — the single entry point that resolves which provider/model a
 * send will actually use (S-167).
 *
 * Why this file exists: every send path used to hand-roll its own fallback order
 * and read the *global* provider store, while the UI displayed the *session*
 * binding (`resolveSessionModelSelection`). The two drifted apart, so switching a
 * model in a session showed the new one while the request went out with the old
 * one — and external delivery (global PM → project session) overwrote it outright.
 *
 * These checks pin the precedence order of that entry point. The stores are
 * stubbed (see ./stubs/) because the real ones pull in the Electron IPC storage
 * layer and cannot run outside Electron.
 */

import assert from 'node:assert/strict'
import { resolveSendModel } from '../../src/renderer/src/lib/send-model-resolution'
import type { AIProvider } from '../../src/shared/types/provider'
import { __setProviderState } from './stubs/provider-store'
import { __setChatState } from './stubs/chat-store'
import { __setSettingsState } from './stubs/settings-store'
import { __setChannelState } from './stubs/channel-store'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.deepStrictEqual(actual, expected, `${message} (got ${JSON.stringify(actual)})`)
}

function provider(id: string, modelIds: string[], defaultModel?: string): AIProvider {
  return {
    id,
    name: `Provider ${id}`,
    type: 'openai-chat',
    apiKey: 'sk-test',
    baseUrl: 'https://example.test/v1',
    enabled: true,
    defaultModel,
    models: modelIds.map((modelId) => ({ id: modelId, name: modelId, enabled: true })),
    createdAt: 0
  } as unknown as AIProvider
}

// Two providers, with the global selection parked on `b` so every assertion below
// can tell "session binding won" apart from "fell back to global".
const providers = [provider('a', ['a1', 'a2'], 'a1'), provider('b', ['b1'], 'b1')]

function setup(
  options: {
    providers?: AIProvider[]
    sessions?: unknown[]
    channels?: unknown[]
    activeProviderId?: string
    activeModelId?: string
    globalMode?: string
  } = {}
): void {
  const list = options.providers ?? providers
  const activeProviderId = options.activeProviderId ?? 'b'
  const activeModelId = options.activeModelId ?? 'b1'
  __setProviderState({
    providers: list,
    activeProviderId,
    activeModelId,
    getActiveProvider: () => list.find((item) => item.id === activeProviderId) ?? null
  })
  __setChatState({ sessions: options.sessions ?? [] })
  __setChannelState({ channels: options.channels ?? [] })
  __setSettingsState({ mainModelSelectionMode: options.globalMode ?? 'manual' })
}

function ids(result: ReturnType<typeof resolveSendModel>): { providerId: string; modelId: string } | null {
  return result ? { providerId: result.provider.id, modelId: result.modelId } : null
}

// ── ① A session binding beats the global selection ───────────────────────────
{
  setup({ sessions: [{ id: 's1', providerId: 'a', modelId: 'a2' }] })
  eq(ids(resolveSendModel('s1')), { providerId: 'a', modelId: 'a2' }, 'a session binding wins over global')
}

// ── ①b The binding wins even when the session's mode says `inherit` ──────────
// `normalizeSessionModelSelectionMode` upgrades "has provider + model" to
// `manual`, so a hand-picked binding is never silently dropped by the global
// mode switch — that is exactly the "switched it back" complaint.
{
  setup({ sessions: [{ id: 's1', providerId: 'a', modelId: 'a2', modelSelectionMode: 'inherit' }] })
  eq(
    ids(resolveSendModel('s1')),
    { providerId: 'a', modelId: 'a2' },
    'a binding survives an explicit inherit mode'
  )
}

// ── ② A channel-bound session uses the channel binding ───────────────────────
{
  setup({
    sessions: [{ id: 's1', pluginId: 'ch1' }],
    channels: [{ id: 'ch1', providerId: 'a', model: 'a1' }]
  })
  eq(ids(resolveSendModel('s1')), { providerId: 'a', modelId: 'a1' }, 'a channel binding is used for plugin sessions')
}

// ── ③ Channel with a provider but no model → that provider's default model ───
// Not the global active model: the global one need not even exist in the
// channel provider's model list.
{
  setup({
    sessions: [{ id: 's1', pluginId: 'ch2' }],
    channels: [{ id: 'ch2', providerId: 'a' }]
  })
  eq(
    ids(resolveSendModel('s1')),
    { providerId: 'a', modelId: 'a1' },
    'a channel without a model takes its provider default, not the global model'
  )
}

// ── ④ No binding at all → follow the global selection ────────────────────────
{
  setup({ sessions: [{ id: 's1' }] })
  eq(ids(resolveSendModel('s1')), { providerId: 'b', modelId: 'b1' }, 'a fresh session follows the global selection')
}

// ── ④b Unknown session id behaves like a fresh session ───────────────────────
{
  setup({ sessions: [{ id: 's1' }] })
  eq(ids(resolveSendModel('nope')), { providerId: 'b', modelId: 'b1' }, 'an unknown session id falls back to global')
}

// ── ⑤ A binding pointing at a deleted provider falls back — model included ───
// The model must be re-aligned with the fallback provider: keeping the bound
// model id would send a model the fallback provider does not serve.
{
  setup({ sessions: [{ id: 's1', providerId: 'ghost', modelId: 'g1' }] })
  eq(
    ids(resolveSendModel('s1')),
    { providerId: 'b', modelId: 'b1' },
    'an unresolvable bound provider falls back and re-aligns the model'
  )
}

// ── ⑥ No usable provider anywhere → null ─────────────────────────────────────
{
  setup({ providers: [], sessions: [{ id: 's1' }] })
  eq(resolveSendModel('s1'), null, 'no provider at all resolves to null')
}

// ── ⑦ Provider present but no usable model → null ────────────────────────────
{
  setup({ providers: [provider('b', [], undefined)], activeModelId: '', sessions: [{ id: 's1' }] })
  eq(resolveSendModel('s1'), null, 'a provider without a usable model resolves to null')
}

console.log(`send-model-resolution: ${checks} checks passed`)
