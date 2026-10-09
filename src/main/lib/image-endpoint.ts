/*
 * Image generation endpoint resolution (iter-37 S-166).
 *
 * Why this exists: `image-reverse-handler.ts` used to pick the first provider
 * whose `type === 'openai'` and fail with "No OpenAI-compatible provider with
 * API key configured" otherwise. So talking to DeepSeek / BigModel / Anthropic
 * meant image generation was simply unavailable — the user had to configure a
 * *second*, OpenAI-typed provider. That is what "requires a dedicated image
 * model" meant in practice.
 *
 * The rule now: prefer the provider the user is currently talking to, fall back
 * to any provider that exposes image generation, and fail with an actionable
 * message when none does. Kept free of electron imports so it stays unit
 * testable (same shape as `generated-image-dir.ts`).
 */

export type ProviderRecord = Record<string, unknown>

export interface ResolvedImageEndpoint {
  baseUrl: string
  apiKey: string
  model: string
  providerName: string
  officialOpenAI: boolean
}

export const OFFICIAL_OPENAI_HOST = 'api.openai.com'

/*
 * Providers whose OpenAI-compatible endpoint serves image generation under a
 * model the user does not have to declare themselves. Keyed by baseUrl host so
 * a renamed provider still matches. Deliberately short: guessing a model that
 * does not exist is worse than asking the user to declare an image model.
 */
export const KNOWN_IMAGE_MODELS: Array<{ host: string; model: string }> = [
  { host: 'open.bigmodel.cn', model: 'cogview-3-flash' },
  { host: OFFICIAL_OPENAI_HOST, model: 'gpt-image-1' }
]

export function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function getHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function findDeclaredImageModel(provider: ProviderRecord, preferredModel: string): string {
  const models = Array.isArray(provider.models) ? provider.models : []
  const imageModels = models.filter(
    (model): model is ProviderRecord =>
      typeof model === 'object' && model !== null && (model as ProviderRecord).category === 'image'
  )
  const enabledModels = imageModels.filter((model) => model.enabled !== false)
  const candidates = enabledModels.length > 0 ? enabledModels : imageModels

  if (preferredModel && candidates.some((model) => readString(model.id) === preferredModel)) {
    return preferredModel
  }
  return readString(candidates[0]?.id)
}

/**
 * Picks the endpoint to call: the active provider first, then any other
 * provider with a usable image model. Providers without an API key are skipped.
 * Returns null when nothing configured can generate images.
 */
export function resolveImageEndpoint(
  providers: ProviderRecord[],
  activeProviderId: string,
  requestedModel = ''
): ResolvedImageEndpoint | null {
  const usableProviders = providers.filter((provider) => readString(provider.apiKey).length > 0)
  const activeProvider = usableProviders.find(
    (provider) => readString(provider.id) === activeProviderId
  )

  const orderedProviders = activeProvider
    ? [activeProvider, ...usableProviders.filter((provider) => provider !== activeProvider)]
    : usableProviders

  for (const provider of orderedProviders) {
    const baseUrl = (readString(provider.baseUrl) || 'https://api.openai.com/v1').replace(/\/+$/, '')
    const host = getHost(baseUrl)
    const knownModel = KNOWN_IMAGE_MODELS.find((entry) => entry.host === host)?.model ?? ''
    const model = findDeclaredImageModel(provider, requestedModel) || requestedModel || knownModel
    if (!model) continue

    return {
      baseUrl,
      apiKey: readString(provider.apiKey),
      model,
      providerName: readString(provider.name) || readString(provider.id) || host,
      officialOpenAI: host === OFFICIAL_OPENAI_HOST
    }
  }

  return null
}

export interface ExplicitImageEndpointResult {
  endpoint: ResolvedImageEndpoint | null
  error: string | null
}

/**
 * Resolves the explicit image route from Settings → 模型管理 (S-173).
 *
 * This is an instruction, not a preference: when it cannot be honoured the
 * caller must report the error, **not** quietly fall back to
 * `resolveImageEndpoint`. Silently generating with someone else's model would
 * erase the user's choice with nothing to see in the UI.
 *
 * Existence is checked here rather than by the Worker because Main owns the
 * provider store the request will actually be sent with.
 */
export function resolveExplicitImageEndpoint(
  providers: ProviderRecord[],
  explicitProviderId: string,
  explicitModelId: string
): ExplicitImageEndpointResult {
  const provider = providers.find((item) => readString(item.id) === explicitProviderId)
  if (!provider) {
    return {
      endpoint: null,
      error: `Image generation model is unavailable: provider '${explicitProviderId}' no longer exists. Pick another one under Settings → 模型管理.`
    }
  }
  if (!readString(provider.apiKey)) {
    return {
      endpoint: null,
      error: `Image generation model is unavailable: provider '${readString(provider.name) || explicitProviderId}' has no API key. Add one under Settings → Providers.`
    }
  }

  const models = Array.isArray(provider.models) ? provider.models : []
  const declared = models.some(
    (model) =>
      typeof model === 'object' &&
      model !== null &&
      readString((model as ProviderRecord).id) === explicitModelId
  )
  if (!declared) {
    return {
      endpoint: null,
      error: `Image generation model is unavailable: model '${explicitModelId}' no longer exists in provider '${readString(provider.name) || explicitProviderId}'. Pick another one under Settings → 模型管理.`
    }
  }

  const baseUrl = (readString(provider.baseUrl) || 'https://api.openai.com/v1').replace(/\/+$/, '')
  const host = getHost(baseUrl)
  return {
    endpoint: {
      baseUrl,
      apiKey: readString(provider.apiKey),
      model: explicitModelId,
      providerName: readString(provider.name) || readString(provider.id) || host,
      officialOpenAI: host === OFFICIAL_OPENAI_HOST
    },
    error: null
  }
}

/**
 * Surfaces the upstream message instead of a raw HTTP dump. The tool card shows
 * this string to the user, so it must stay short and readable.
 */
export function summarizeApiError(raw: string): string {
  const text = raw.trim()
  if (!text) return 'no response body'
  if (text.startsWith('<')) return 'provider returned a non-JSON error page'

  try {
    const parsed = JSON.parse(text) as { error?: unknown; message?: unknown }
    const nestedError = parsed.error
    const message =
      typeof nestedError === 'object' && nestedError !== null
        ? readString((nestedError as ProviderRecord).message)
        : readString(nestedError)
    if (message) return message
    const direct = readString(parsed.message)
    if (direct) return direct
  } catch {
    // Not JSON — fall through to the truncated text.
  }

  return text.length > 300 ? `${text.slice(0, 300)}…` : text
}
