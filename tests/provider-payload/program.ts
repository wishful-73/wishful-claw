/*
 * iter-29 review (F-8): the payload handed to `agent/run` used to be hand-written as
 * an object literal at every send site, so fields the Worker reads were silently
 * dropped on the chat path — custom request headers, the per-provider User-Agent and
 * the session id behind `{{sessionId}}` only ever reached the sidecar path. These
 * checks pin the single builder that replaced them.
 *
 * The key list below is the set of properties read off `parameters.provider` under
 * src/runtime/WishfulClaw.Agent (grep `provider, "`). If the runtime starts reading a
 * new one, add it here and to the builder — that is the point of the test.
 */

import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  buildProviderPayload,
  type ProviderPayloadSettings
} from '../../src/renderer/src/lib/agent/provider-payload'
import { getDefaultApiUserAgent } from '../../src/renderer/src/lib/api/api-user-agent'
import { openaiPreset } from '../../src/renderer/src/stores/providers/openai'
import type { AIModelConfig, AIProvider } from '../../src/shared/types/provider'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.deepStrictEqual(actual, expected, `${message} (got ${JSON.stringify(actual)})`)
}

function makeSettings(overrides: Record<string, unknown> = {}): ProviderPayloadSettings {
  return {
    temperature: 0.7,
    maxTokens: 4096,
    thinkingEnabled: false,
    reasoningEffort: 'medium',
    reasoningEffortByModel: {},
    apiRequestTimeoutSeconds: 100,
    requestMaxRetries: 10,
    ...overrides
  } as unknown as ProviderPayloadSettings
}

function makeModel(overrides: Record<string, unknown> = {}): AIModelConfig {
  return {
    id: 'model-1',
    name: 'Model One',
    enabled: true,
    ...overrides
  } as unknown as AIModelConfig
}

function makeProvider(overrides: Record<string, unknown> = {}): AIProvider {
  return {
    id: 'prov-1',
    name: 'Test Provider',
    type: 'openai-chat',
    apiKey: 'sk-test',
    baseUrl: 'https://example.test/v1',
    enabled: true,
    models: [],
    createdAt: 0,
    ...overrides
  } as unknown as AIProvider
}

const thinkingConfig = { bodyParams: { thinking: { type: 'enabled' } }, reasoningEffortLevels: ['low', 'high'] }

// ── Contract: every property the Worker reads off `parameters.provider` ────────
const WORKER_READ_KEYS = [
  'type',
  'apiKey',
  'baseUrl',
  'model',
  'contextLength',
  'providerId',
  'providerBuiltinId',
  'userAgent',
  'cacheTtl',
  'responseSummary',
  'reasoningEffort',
  'thinkingEnabled',
  'thinkingConfig',
  'requestOverrides',
  'temperature',
  'maxTokens'
]

{
  const payload = buildProviderPayload(
    makeProvider({ models: [makeModel()], requestOverrides: { headers: { 'x-a': '1' } } }),
    'model-1',
    makeSettings()
  )
  for (const key of WORKER_READ_KEYS) {
    check(key in payload, `payload carries the runtime-read key "${key}"`)
  }

  // Deliberate exclusions, pinned so nobody "fixes" one by accident:
  // sessionId is stamped by the chat store; organization/project have no renderer
  // source (AIProvider has no such fields); serviceTier is unwired (fast mode);
  // systemPrompt is built by the Worker.
  for (const key of ['sessionId', 'organization', 'project', 'serviceTier', 'systemPrompt']) {
    check(!(key in payload), `payload does not claim to own "${key}"`)
  }
}

// ── Identity: providerId is the id the Worker logs against ─────────────────────
{
  const payload = buildProviderPayload(makeProvider({ models: [makeModel()] }), 'model-1', makeSettings())
  eq(payload.providerId, 'prov-1', 'providerId mirrors the provider record id')
  eq(payload.id, 'prov-1', 'id is kept for the usage-log fallback path')
  eq(payload.model, 'model-1', 'model is the resolved model id')
}

// ── F-8 core: request overrides, model-level first ────────────────────────────
{
  const providerOverrides = { headers: { 'x-provider': 'p' } }
  const modelOverrides = { headers: { 'x-model': 'm' }, omitBodyKeys: ['temperature'] }

  const fromModel = buildProviderPayload(
    makeProvider({ models: [makeModel({ requestOverrides: modelOverrides })], requestOverrides: providerOverrides }),
    'model-1',
    makeSettings()
  )
  eq(fromModel.requestOverrides, modelOverrides, 'a model-level override wins over the provider-level one')

  const fromProvider = buildProviderPayload(
    makeProvider({ models: [makeModel()], requestOverrides: providerOverrides }),
    'model-1',
    makeSettings()
  )
  eq(fromProvider.requestOverrides, providerOverrides, 'the provider-level override is used when the model has none')

  const fromNeither = buildProviderPayload(makeProvider({ models: [makeModel()] }), 'model-1', makeSettings())
  eq(fromNeither.requestOverrides, undefined, 'no override config stays undefined')
}

// ── F-8 sibling: the custom User-Agent ────────────────────────────────────────
{
  const custom = buildProviderPayload(
    makeProvider({ models: [makeModel()], userAgent: 'GitHubCopilotChat/0.26.7' }),
    'model-1',
    makeSettings()
  )
  eq(custom.userAgent, 'GitHubCopilotChat/0.26.7', 'a configured User-Agent is passed through')

  // The placeholder values presets carry mean "use the app default", not "send this".
  const placeholder = buildProviderPayload(
    makeProvider({ models: [makeModel()], userAgent: 'WishfulClaw' }),
    'model-1',
    makeSettings()
  )
  eq(placeholder.userAgent, getDefaultApiUserAgent(), 'the placeholder User-Agent resolves to the app default')

  const unset = buildProviderPayload(makeProvider({ models: [makeModel()] }), 'model-1', makeSettings())
  eq(unset.userAgent, getDefaultApiUserAgent(), 'an absent User-Agent resolves to the app default')
}

// ── Anthropic cache TTL: model-level first, same as the other builders ─────────
{
  const payload = buildProviderPayload(
    makeProvider({ models: [makeModel({ cacheTtl: '1h' })], cacheTtl: '5m' }),
    'model-1',
    makeSettings()
  )
  eq(payload.cacheTtl, '1h', 'a model-level cache TTL wins')
}

// ── Reasoning summary is model-level and reaches the request ──────────────────
{
  const payload = buildProviderPayload(
    makeProvider({ models: [makeModel({ responseSummary: 'concise' })] }),
    'model-1',
    makeSettings()
  )
  eq(payload.responseSummary, 'concise', 'the model-level response summary is forwarded')
}

// ── Thinking flags: derived from settings, overridable per call site ──────────
{
  const model = makeModel({ thinkingConfig })

  const offByDefault = buildProviderPayload(makeProvider({ models: [model] }), 'model-1', makeSettings())
  eq(offByDefault.thinkingEnabled, false, 'thinking stays off when the setting is off')
  check(offByDefault.thinkingConfig === thinkingConfig, 'the model thinking config is still forwarded')

  const onBySetting = buildProviderPayload(
    makeProvider({ models: [model] }),
    'model-1',
    makeSettings({ thinkingEnabled: true })
  )
  eq(onBySetting.thinkingEnabled, true, 'thinking follows the setting when the model supports it')

  const unsupported = buildProviderPayload(
    makeProvider({ models: [makeModel()] }),
    'model-1',
    makeSettings({ thinkingEnabled: true })
  )
  eq(unsupported.thinkingEnabled, false, 'a model without thinking config never reports thinking on')

  // The project dispatch path has always forced this off.
  const forced = buildProviderPayload(
    makeProvider({ models: [model] }),
    'model-1',
    makeSettings({ thinkingEnabled: true }),
    { thinkingEnabled: false }
  )
  eq(forced.thinkingEnabled, false, 'an explicit override beats the setting')
}

// ── Reasoning effort resolution ──────────────────────────────────────────────
{
  const model = makeModel({ thinkingConfig })

  const defaulted = buildProviderPayload(makeProvider({ models: [model] }), 'model-1', makeSettings())
  eq(defaulted.reasoningEffort, 'medium', 'with no saved level the global effort is used')

  const saved = buildProviderPayload(
    makeProvider({ models: [model] }),
    'model-1',
    makeSettings({ reasoningEffortByModel: { 'prov-1:model-1': 'high' } })
  )
  eq(saved.reasoningEffort, 'high', 'a saved per-model level wins')

  const rejected = buildProviderPayload(
    makeProvider({ models: [model] }),
    'model-1',
    makeSettings({ reasoningEffortByModel: { 'prov-1:model-1': 'medium' } })
  )
  eq(rejected.reasoningEffort, 'medium', 'a saved level the model does not list falls back')

  const noConfig = buildProviderPayload(makeProvider({ models: [makeModel()] }), 'model-1', makeSettings())
  eq(noConfig.reasoningEffort, undefined, 'no thinking config means no reasoning effort')
}

// ── Protocol: a model-level `type` overrides the provider's ───────────────────
// `AIModelConfig.type` is documented as "Optional protocol override for this model;
// falls back to provider.type when omitted", and every other consumer in the app
// reads it that way. The chat path used to send the provider type unconditionally,
// so the same model ran on one protocol in chat and another under cron.
{
  const followsProvider = buildProviderPayload(
    makeProvider({ type: 'openai-chat', models: [makeModel()] }),
    'model-1',
    makeSettings()
  )
  eq(followsProvider.type, 'openai-chat', 'a model that sets no type follows its provider')

  const overridden = buildProviderPayload(
    makeProvider({ type: 'openai-chat', models: [makeModel({ type: 'openai-responses' })] }),
    'model-1',
    makeSettings()
  )
  eq(overridden.type, 'openai-responses', 'a model-level type wins over the provider type')

  const anthropicOverride = buildProviderPayload(
    makeProvider({ type: 'anthropic', models: [makeModel({ type: 'openai-chat' })] }),
    'model-1',
    makeSettings()
  )
  eq(anthropicOverride.type, 'openai-chat', 'the override works in both directions')
}

// ── The real-world case: preset data, not a synthetic model ───────────────────
// The openai preset declares `openai-chat` at the provider but `openai-responses`
// on its gpt-5/gpt-6 models — exactly where the two readings disagreed.
{
  const presetProvider = {
    id: 'openai',
    name: openaiPreset.name,
    type: openaiPreset.type,
    apiKey: 'sk-test',
    baseUrl: openaiPreset.defaultBaseUrl,
    enabled: true,
    models: openaiPreset.defaultModels,
    createdAt: 0
  } as unknown as AIProvider

  const payload = buildProviderPayload(presetProvider, 'gpt-5.2', makeSettings())
  eq(payload.type, 'openai-responses', 'the openai preset gpt-5.2 resolves to the responses protocol')

  const codex = buildProviderPayload(presetProvider, 'gpt-5.3-codex', makeSettings())
  eq(codex.type, 'openai-responses', 'the openai preset codex model resolves to the responses protocol')
}

// ── Structural guard: send sites go through the builder ───────────────────────
// The bug this whole change fixes was four object literals drifting apart. If a
// fifth appears, fail here rather than discovering it in a bug report.
{
  const repoRoot = path.resolve(__dirname, '../../..')
  const sendSites = [
    'src/renderer/src/hooks/use-chat-actions.ts',
    'src/renderer/src/hooks/use-channel-auto-reply.ts',
    'src/renderer/src/lib/tools/project-send-message.ts',
    'src/renderer/src/lib/agent/provider-auto-fallback.ts'
  ]

  for (const relative of sendSites) {
    const source = fs.readFileSync(path.join(repoRoot, relative), 'utf8')
    check(
      source.includes('buildProviderPayload('),
      `${relative} builds the agent/run payload through the shared builder`
    )
    check(
      !source.includes('apiKey:'),
      `${relative} does not hand-write a provider payload literal`
    )
  }
}

console.log(`provider payload checks passed: ${checks}`)
