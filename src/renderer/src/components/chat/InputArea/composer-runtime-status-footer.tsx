import * as React from 'react'
import { ComposerRuntimeStatus } from './runtime-status'
import type { AIModelConfig } from '@renderer/lib/api/types'
import type { ContextCompressionStatus } from './types'

interface ComposerRuntimeStatusFooterProps {
  sessionId: string
  isStreaming: boolean
  draftInputTokens: number
  isOptimizing: boolean
  pendingImageReads: number
  contextCompressionStatus: ContextCompressionStatus
  contextCompressionStatusLabel: string
  model: AIModelConfig | null | undefined
  /** `服务商 · 模型` for auto sessions; null in manual mode (the switcher already names it). */
  autoModelLabel?: string | null
}

export function ComposerRuntimeStatusFooter({
  sessionId,
  isStreaming,
  draftInputTokens,
  isOptimizing,
  pendingImageReads,
  contextCompressionStatus,
  contextCompressionStatusLabel,
  model,
  autoModelLabel
}: ComposerRuntimeStatusFooterProps): React.JSX.Element {
  return (
    <ComposerRuntimeStatus
      sessionId={sessionId}
      isStreaming={isStreaming}
      draftInputTokens={draftInputTokens}
      isOptimizing={isOptimizing}
      pendingImageReads={pendingImageReads}
      contextCompressionStatus={contextCompressionStatus}
      contextCompressionStatusLabel={contextCompressionStatusLabel}
      model={model}
      autoModelLabel={autoModelLabel}
      className="mt-1.5 px-3"
      showStatus={false}
    />
  )
}
