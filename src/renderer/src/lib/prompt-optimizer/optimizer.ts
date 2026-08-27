/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import type { ProviderConfig } from '../api/types'
import { resolveLanguageName, type AppLanguage } from '../i18n-language'

export interface OptimizationOption {
  title: string
  content: string
  focus: string
}

export interface OptimizationResult {
  options: OptimizationOption[]
  success: boolean
}

const OPTIMIZER_SYSTEM_PROMPT = `You are a professional prompt engineering expert. Optimize the user's prompt and return the results via the WriteOptimizedPrompts tool.

Requirements for each optimized prompt option:
- A clear, action-oriented title describing its focus (e.g. "Clarity-Focused", "Efficiency-Focused")
- Structured content: context/objective/requirements/acceptance criteria as appropriate
- Preserve the user's original intent; be specific and actionable
- Provide EXACTLY 3 options, each taking a clearly DIFFERENT approach
  (e.g. one clarity/structure-focused, one detail/spec-focused, one concise/action-focused)
- Never merge two approaches into one option; never repeat the same angle twice

You MUST call the WriteOptimizedPrompts tool with the final result.`

interface CompletionToolCall {
  id: string
  name: string
  argumentsJson: string
}

interface CompletionResult {
  ok: boolean
  text?: string | null
  toolCalls?: CompletionToolCall[] | null
  error?: string | null
}

/** Single-shot completion via provider/complete — no agent loop involved. */
async function completeOnce(args: {
  provider: ProviderConfig
  systemPrompt: string
  message: string
  tools: unknown[]
  signal?: AbortSignal
}): Promise<CompletionResult> {
  const { agentBridge } = await import('../ipc/agent-bridge')
  const initialized = await agentBridge.initialize()
  if (!initialized) {
    throw new Error('Sidecar unavailable')
  }

  const params = {
    provider: {
      type: args.provider.type,
      baseUrl: args.provider.baseUrl,
      apiKey: args.provider.apiKey
    },
    model: args.provider.model,
    systemPrompt: args.systemPrompt,
    message: args.message,
    tools: args.tools
  }

  // Abort must cancel the whole chain, not just abandon the wait: renderer
  // promise → main-process forwarder → worker HTTP request (worker/cancel).
  // Without the cancel round-trip the worker keeps burning provider tokens
  // (and retrying rate limits) long after the user closed the dialog.
  // cancelId is generated up front so it is known while the request is still
  // in flight — the internal worker id is never exposed before completion.
  if (args.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const cancelId = `prompt-opt-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let settled = false
  const onAbort = (): void => {
    if (!settled) {
      void window.api.cancelWorkerRequest(cancelId).catch(() => {})
    }
  }
  args.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const response = await window.api.workerRequestWithId<CompletionResult>(
      'provider/complete',
      params,
      cancelId
    )
    return response.result ?? { ok: false, error: 'Empty response from worker' }
  } finally {
    settled = true
    args.signal?.removeEventListener('abort', onAbort)
  }
}

const OPTIMIZER_TOOLS = [
  {
    name: 'WriteOptimizedPrompts',
    description:
      'Write exactly 3 optimized prompt options, each with a different focus/approach. You MUST use this tool to provide the optimized results.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        options: {
          type: 'array',
          description: 'Array of exactly 3 optimized prompt options',
          items: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description:
                  'Short title describing this option (e.g., "Clarity-Focused", "Efficiency-Focused")'
              },
              focus: {
                type: 'string',
                description: "Brief description of this option's focus/approach"
              },
              content: {
                type: 'string',
                description: 'The optimized prompt text following the professional format'
              }
            },
            required: ['title', 'focus', 'content']
          }
        }
      },
      required: ['options']
    }
  }
]

function extractOptions(argumentsJson: string): OptimizationOption[] {
  try {
    const parsed = JSON.parse(argumentsJson) as { options?: unknown[] }
    if (!Array.isArray(parsed.options)) return []
    // Tolerant extraction: models sometimes omit title/focus or emit them as
    // non-strings. Degrade gracefully instead of discarding valid content.
    const options = parsed.options
      .filter((option): option is Record<string, unknown> =>
        Boolean(option) && typeof option === 'object')
      .filter((option) =>
        typeof option.content === 'string' && option.content.trim().length > 0)
      .map((option) => ({
        title: typeof option.title === 'string' && option.title.trim() ? option.title : '优化方案',
        focus: typeof option.focus === 'string' && option.focus.trim() ? option.focus : '',
        content: option.content as string
      }))
    console.log(`[Optimizer] extracted ${options.length}/${parsed.options.length} options from tool args`)
    return options
  } catch (error) {
    console.warn('Optimizer failed to parse tool arguments:', error)
  }
  return []
}

export async function* optimizePrompt(
  userInput: string,
  providerConfig: ProviderConfig,
  language: AppLanguage,
  signal?: AbortSignal
): AsyncGenerator<{
  type: 'text' | 'thinking' | 'tool_call' | 'result'
  content: string
  options?: OptimizationOption[]
  toolCall?: { id: string; name: string; input: Record<string, unknown> }
}> {
  const languageInstruction = `\n\n**CRITICAL LANGUAGE REQUIREMENT**: You MUST respond in ${resolveLanguageName(language)}. All option titles, focus descriptions, and optimized prompt content MUST be in ${resolveLanguageName(language)}.`

  const message = `Optimize this user prompt:

**Original User Input:**
${userInput}
${languageInstruction}`

  let optimizedOptions: OptimizationOption[] = []

  if (signal?.aborted) {
    yield { type: 'result', content: 'Optimization cancelled', options: [] }
    return
  }

  try {
    const result = await completeOnce({
      provider: providerConfig,
      systemPrompt: OPTIMIZER_SYSTEM_PROMPT,
      message,
      tools: OPTIMIZER_TOOLS,
      signal
    })

    // JSON.stringify: the log forwarder flattens object args to "[object Object]".
    const summary = {
      ok: result.ok,
      hasText: Boolean(result.text),
      textLength: result.text?.length ?? 0,
      toolCallCount: result.toolCalls?.length ?? 0,
      toolNames: (result.toolCalls ?? []).map((call) => call.name),
      keys: Object.keys(result),
      firstToolArgsPreview: result.toolCalls?.[0]?.argumentsJson?.slice(0, 300) ?? null
    }
    console.log('[Optimizer] completion response ' + JSON.stringify(summary))

    if (!result.ok) {
      console.error('Optimizer provider error:', result.error)
      yield { type: 'text', content: `\n\n[Error: ${result.error ?? 'Unknown provider error'}]` }
    }

    if (result.text) {
      // Analysis prose — surface it so the user sees progress while waiting.
      yield { type: 'text', content: result.text }
    }

    for (const call of result.toolCalls ?? []) {
      if (call.name !== 'WriteOptimizedPrompts') continue
      const newOptions = extractOptions(call.argumentsJson)
      if (newOptions.length === 0) continue
      optimizedOptions = [...optimizedOptions, ...newOptions]
      yield {
        type: 'tool_call',
        content: 'Generated optimization options',
        options: newOptions,
        toolCall: { id: call.id, name: call.name, input: JSON.parse(call.argumentsJson) }
      }
    }
  } catch (error) {
    if (!signal?.aborted) {
      console.error('Optimization error:', error)
      const detail = error instanceof Error ? error.message : String(error)
      yield { type: 'text', content: `\n\n[Error: ${detail}]` }
    }
  }

  if (optimizedOptions.length === 0 && !signal?.aborted) {
    console.error('Optimizer produced no options — see preceding logs')
  }

  yield { type: 'result', content: 'Optimization complete', options: optimizedOptions }
}
