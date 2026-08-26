// Prompt optimization state and handlers for InputArea

import * as React from 'react'
import { toast } from 'sonner'
import { useProviderStore } from '@renderer/stores/provider-store'
import type { AppLanguage } from '@renderer/lib/i18n-language'

export interface UsePromptOptimizerOptions {
  text: string
  currentLanguage: AppLanguage
  setText: (value: string | ((prev: string) => string)) => void
  focusInputAtEnd: () => void
}

export interface OptimizationOption {
  title: string
  focus: string
  content: string
}

export function usePromptOptimizer(opts: UsePromptOptimizerOptions) {
  const { text, currentLanguage, setText, focusInputAtEnd } = opts
  const [isOptimizing, setIsOptimizing] = React.useState(false)
  const [optimizingText, setOptimizingText] = React.useState('')
  const [optimizationOptions, setOptimizationOptions] = React.useState<OptimizationOption[]>([])
  const [showOptimizationDialog, setShowOptimizationDialog] = React.useState(false)
  const [selectedOptionIndex, setSelectedOptionIndex] = React.useState(0)
  const contentScrollRef = React.useRef<HTMLDivElement>(null)
  // Abort handle for the in-flight stream — cancel button and timeout both use it,
  // so a hung network request can never lock the input area forever.
  const abortRef = React.useRef<AbortController | null>(null)

  const handleOptimizePrompt = React.useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || isOptimizing) return

    setIsOptimizing(true)
    setOptimizingText('')
    setOptimizationOptions([])
    setSelectedOptionIndex(0)
    // Show dialog immediately — options will load progressively
    setShowOptimizationDialog(true)

    const controller = new AbortController()
    abortRef.current = controller
    // Hard timeout so a hung request cannot keep isOptimizing=true forever.
    // The optimizer runs up to 5 sidecar iterations (analysis + tool-call
    // rounds); the first analysis turn alone can take ~90s on slow models,
    // so budget generously — user cancel still works at any time.
    const timeout = setTimeout(() => controller.abort(new Error('Optimization timed out')), 300_000)

    try {
      const { optimizePrompt } = await import('@renderer/lib/prompt-optimizer/optimizer')

      // Reuse the active provider config (same as normal chat) to avoid
      // baseUrl/model mismatches that cause 404s.
      const providerStore = useProviderStore.getState()
      const activeProvider = providerStore.getActiveProvider()

      if (!activeProvider) {
        toast.error('No AI provider available', {
          description: 'Please configure an AI provider in Settings'
        })
        setIsOptimizing(false)
        setShowOptimizationDialog(false)
        return
      }

      // Use the same model resolution as normal chat: activeModelId first,
      // then defaultModel, then first enabled model.
      const modelId =
        providerStore.activeModelId ||
        activeProvider.defaultModel ||
        activeProvider.models.find((m: { enabled: boolean }) => m.enabled)?.id

      if (!modelId) {
        toast.error('No AI model available', { description: 'Please enable a model in Settings' })
        setIsOptimizing(false)
        setShowOptimizationDialog(false)
        return
      }

      const providerConfig = {
        type: activeProvider.type,
        apiKey: activeProvider.apiKey,
        baseUrl: activeProvider.baseUrl,
        model: modelId,
        providerId: activeProvider.id,
        maxTokens: 4096,
        temperature: 0.7,
        systemPrompt: ''
      }

      for await (const event of optimizePrompt(trimmed, providerConfig, currentLanguage, controller.signal)) {
        if (controller.signal.aborted) break
        if (event.type === 'text') {
          setOptimizingText((prev) => prev + event.content)
        } else if (event.type === 'tool_call' && event.options && event.options.length > 0) {
          // Progressive: add options as they arrive
          setOptimizationOptions((prev) => [...prev, ...event.options!])
        } else if (event.type === 'result' && event.options && event.options.length > 0) {
          // Final batch — only set if we don't already have options from tool_call
          setOptimizationOptions((prev) => prev.length > 0 ? prev : event.options!)
          setSelectedOptionIndex(0)
        }
      }

      // Stream ended without usable options (provider error / model ignored the
      // tool). Close the dialog instead of leaving it spinning forever.
      let producedOptions = false
      setOptimizationOptions((prev) => {
        producedOptions = prev.length > 0
        return prev
      })
      await Promise.resolve()
      if (!producedOptions) {
        setShowOptimizationDialog(false)
        toast.error('Optimization failed', {
          description: 'The model did not return optimized prompt options. Please try again.'
        })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setShowOptimizationDialog(false)
        toast.error('Optimization failed', {
          description: error instanceof Error ? error.message : String(error)
        })
      }
    } finally {
      clearTimeout(timeout)
      abortRef.current = null
      setIsOptimizing(false)
    }
  }, [text, isOptimizing, currentLanguage])

  const handleSelectOption = React.useCallback(
    (content: string) => {
      setText(content)
      setOptimizationOptions([])
      setOptimizingText('')
      setSelectedOptionIndex(0)
      setShowOptimizationDialog(false)
      requestAnimationFrame(() => {
        focusInputAtEnd()
      })
    },
    [focusInputAtEnd, setText]
  )

  const handleCancelOptimization = React.useCallback(() => {
    // Abort the in-flight stream so it cannot keep the input area locked
    abortRef.current?.abort(new Error('Cancelled'))
    setOptimizationOptions([])
    setOptimizingText('')
    setSelectedOptionIndex(0)
    setShowOptimizationDialog(false)
    setIsOptimizing(false)
  }, [])

  // Dialog open-state wrapper: closing via Esc/X/overlay also aborts the stream,
  // otherwise isOptimizing would keep the input area locked until the request ends.
  const handleDialogOpenChange = React.useCallback((open: boolean) => {
    if (!open) {
      abortRef.current?.abort(new Error('Cancelled'))
      setOptimizationOptions([])
      setOptimizingText('')
      setSelectedOptionIndex(0)
      setIsOptimizing(false)
    }
    setShowOptimizationDialog(open)
  }, [])

  return {
    isOptimizing,
    optimizingText,
    optimizationOptions,
    showOptimizationDialog,
    setShowOptimizationDialog: handleDialogOpenChange,
    selectedOptionIndex,
    setSelectedOptionIndex,
    contentScrollRef,
    handleOptimizePrompt,
    handleSelectOption,
    handleCancelOptimization
  }
}
