/**
 * Image generation reverse-request handler.
 *
 * Calls the OpenAI Images API (or compatible endpoint) to generate images.
 * The API key and base URL are read from the AI provider store so that
 * the user's configured provider is used automatically.
 */

import { readPersistedProviderStore } from '../../lib/ai-provider-store'

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

  const model = (params.model as string) || 'dall-e-3'
  const size = (params.size as ImageGenerateParams['size']) || '1024x1024'
  const quality = (params.quality as ImageGenerateParams['quality']) || 'standard'
  const style = (params.style as ImageGenerateParams['style']) || 'vivid'
  const n = Math.min((params.n as number) || 1, 4)

  // Get the configured provider's API key and base URL
  const store = readPersistedProviderStore()
  const providers = (store?.state?.providers as Array<Record<string, unknown>>) ?? []
  const openaiProvider = providers.find(
    (p) => p.type === 'openai' && typeof p.apiKey === 'string' && p.apiKey
  )

  if (!openaiProvider || !openaiProvider.apiKey) {
    return {
      success: false,
      error: 'No OpenAI-compatible provider with API key configured. Configure a provider in Settings first.'
    }
  }

  const baseUrl = ((openaiProvider.baseUrl as string) || 'https://api.openai.com/v1').replace(/\/$/, '')
  const url = `${baseUrl}/images/generations`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), IMAGE_REQUEST_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiProvider.apiKey as string}`
      },
      body: JSON.stringify({
        model,
        prompt,
        size,
        quality,
        style,
        n
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText)
      return { success: false, error: `Image API error (${response.status}): ${errorText}` }
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
