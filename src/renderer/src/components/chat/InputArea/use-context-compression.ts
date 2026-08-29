import * as React from 'react'
import type { TFunction } from 'i18next'
import type { ContextCompressionStatus } from './types'
import type { ManualCompressionResult } from '@renderer/hooks/use-chat-actions'

interface UseContextCompressionOptions {
  onCompressContext?: () => ManualCompressionResult | void | Promise<ManualCompressionResult | void>
  t: TFunction
}

export function useContextCompression(opts: UseContextCompressionOptions) {
  const [contextCompressionStatus, setContextCompressionStatus] =
    React.useState<ContextCompressionStatus>('idle')
  const contextCompressionStatusTimerRef = React.useRef<ReturnType<typeof setTimeout>>(undefined)
  const contextCompressionInFlightRef = React.useRef(false)
  const isContextCompressing = contextCompressionStatus === 'compressing'

  const handleCompressContext = React.useCallback(() => {
    if (!opts.onCompressContext || isContextCompressing || contextCompressionInFlightRef.current) return

    contextCompressionInFlightRef.current = true
    clearTimeout(contextCompressionStatusTimerRef.current)
    setContextCompressionStatus('compressing')
    void Promise.resolve()
      .then(() => opts.onCompressContext!())
      .then((result) => {
        setContextCompressionStatus(result ?? 'compressed')
      })
      .catch((error) => {
        console.error('[InputArea] Context compression failed', error)
        setContextCompressionStatus('failed')
      })
      .finally(() => {
        contextCompressionInFlightRef.current = false
        contextCompressionStatusTimerRef.current = setTimeout(() => {
          setContextCompressionStatus('idle')
        }, 3200)
      })
  }, [isContextCompressing, opts.onCompressContext])

  const contextCompressionStatusLabel = React.useMemo(() => {
    switch (contextCompressionStatus) {
      case 'compressing':
        return opts.t('input.compressingContext', { defaultValue: 'Compressing context...' })
      case 'compressed':
        return opts.t('input.contextCompressed', { defaultValue: 'Context compressed' })
      case 'skipped':
        return opts.t('input.contextCompressionSkipped', { defaultValue: 'No compression needed' })
      case 'blocked':
        return opts.t('input.contextCompressionBlocked', {
          defaultValue: 'Compression temporarily unavailable'
        })
      case 'failed':
        return opts.t('input.contextCompressionFailed', { defaultValue: 'Compression failed' })
      default:
        return ''
    }
  }, [contextCompressionStatus, opts.t])

  return {
    contextCompressionStatus,
    isContextCompressing,
    handleCompressContext,
    contextCompressionStatusLabel
  }
}
