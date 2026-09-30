/**
 * Image generation reverse-request handler.
 *
 * Calls an OpenAI-compatible Images API (`POST {baseUrl}/images/generations`).
 * The endpoint is resolved from the AI provider store, preferring the provider
 * the user is currently talking to, so a dedicated image provider is not
 * required as long as some configured provider exposes image generation.
 */

import { readPersistedProviderStore } from '../../lib/ai-provider-store'
import {
  readString,
  resolveImageEndpoint,
  summarizeApiError,
  type ProviderRecord
} from '../../lib/image-endpoint'

interface ImageGenerateParams {
  prompt: string
  model?: string
  size?: '256x256' | '512x512' | '1024x1024' | '1792x1024' | '1024x1792' | 'auto'
  quality?: 'standard' | 'hd'
  style?: 'vivid' | 'natural'
  n?: number
}

interface ImageGenerateResult {
  success: boolean
  images?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>
  error?: string
}

// Image generation is slow, but a hung network must not block the reverse
// request (and its tool slot) forever.
const IMAGE_REQUEST_TIMEOUT_MS = 120_000

export async function handleImageGenerate(
  params: Record<string, unknown>
): Promise<ImageGenerateResult> {
  const prompt = params.prompt as string | undefined
  if (!prompt) {
    return { success: false, error: 'prompt is required' }
  }

  const size = (params.size as ImageGenerateParams['size']) || '1024x1024'
  const quality = (params.quality as ImageGenerateParams['quality']) || 'standard'
  const style = (params.style as ImageGenerateParams['style']) || 'vivid'
  // The tool executor sends `count`; `n` is kept for older callers.
  const requestedCount = (params.count as number) ?? (params.n as number)
  const n = Math.min(typeof requestedCount === 'number' && requestedCount > 0 ? requestedCount : 1, 4)

  const store = readPersistedProviderStore()
  const state = store?.state ?? {}
  const providers = Array.isArray(state.providers) ? (state.providers as ProviderRecord[]) : []
  const endpoint = resolveImageEndpoint(
    providers,
    readString(state.activeProviderId),
    readString(params.model)
  )

  if (!endpoint) {
    return {
      success: false,
      error:
        'Image generation is unavailable: no configured provider exposes image generation. ' +
        'Add an image model to a provider under Settings → Models, or switch to a provider that offers one.'
    }
  }

  const url = `${endpoint.baseUrl}/images/generations`
  // `quality` / `style` / `n` are OpenAI-only fields; compatible endpoints
  // reject or misread them, so only the official endpoint gets the full body.
  const body = endpoint.officialOpenAI
    ? { model: endpoint.model, prompt, size, quality, style, n }
    : { model: endpoint.model, prompt, size }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${endpoint.apiKey}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText)
      return {
        success: false,
        error: `Image generation failed (HTTP ${response.status} via ${endpoint.providerName}): ${summarizeApiError(errorText)}`
      }
    }

    const data = await response.json() as {
      data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>
    }

    return {
      success: true,
      images: data.data?.map((img) => ({
        url: img.url,
        b64_json: img.b64_json,
        revised_prompt: img.revised_prompt
      })) ?? []
    }
  } catch (err) {
    if (controller.signal.aborted) {
      return {
        success: false,
        error: `Image generation timed out after ${IMAGE_REQUEST_TIMEOUT_MS / 1000}s`
      }
    }
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Image generation request failed: ${msg}` }
  } finally {
    clearTimeout(timer)
  }
}
