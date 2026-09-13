import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@renderer/components/ui/button'
import { useTheme } from 'next-themes'
import { writeSvgStringToClipboard } from '@renderer/lib/utils/image-clipboard'
import { useChatActions } from '@renderer/hooks/use-chat-actions'
import type { ToolCallStatus } from '@renderer/lib/agent/types'
import { WIDGET_BRIDGE_SOURCE } from '../types'
import { normalizeWidgetPayload, buildWidgetDocument } from '../utils'

function SvgWidgetCopyButton({ svg }: { svg: string }): React.JSX.Element {
  const { t } = useTranslation('chat')
  const [copied, setCopied] = React.useState(false)
  const [copying, setCopying] = React.useState(false)
  const resetTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  const handleCopy = React.useCallback(async (): Promise<void> => {
    if (copying || !svg.trim()) return

    try {
      setCopying(true)
      await writeSvgStringToClipboard(svg)
      setCopied(true)
      toast.success(t('toolCall.widget.imageCopied'))

      if (resetTimerRef.current != null) {
        window.clearTimeout(resetTimerRef.current)
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        resetTimerRef.current = null
      }, 1500)
    } catch (error) {
      console.error('[Widget] Copy SVG image failed:', error)
      toast.error(t('toolCall.widget.copyImageFailed'))
    } finally {
      setCopying(false)
    }
  }, [copying, svg, t])

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      className="absolute right-2 top-2 z-20 size-8 border border-border/60 bg-background/85 text-muted-foreground shadow-sm backdrop-blur hover:bg-background hover:text-foreground disabled:opacity-60"
      onClick={() => void handleCopy()}
      disabled={copying || !svg.trim()}
      title={copied ? t('toolCall.widget.copied') : t('toolCall.widget.copyImage')}
      aria-label={copied ? t('toolCall.widget.copied') : t('toolCall.widget.copyImage')}
    >
      {copied ? <Check className="size-3.5 text-green-500" /> : <Copy className="size-3.5" />}
    </Button>
  )
}

export function WidgetOutputBlock({
  input,
  status
}: {
  input: Record<string, unknown>
  status: ToolCallStatus | 'completed'
}): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const { resolvedTheme } = useTheme()
  const isExecuting = status === 'streaming' || status === 'running'
  const payload = normalizeWidgetPayload(input)
  // Opaque canvas that follows the app theme — widgets are authored for a real
  // background, a transparent frame over the dark chat surface washed them out.
  const widgetAppearance = React.useMemo(() => {
    const isDark = resolvedTheme !== 'light'
    const hostBg = getComputedStyle(document.documentElement).backgroundColor
    const bg = hostBg && hostBg !== 'rgba(0, 0, 0, 0)' && hostBg !== 'transparent'
      ? hostBg
      : isDark
        ? '#1c1c1c'
        : '#ffffff'
    return { bg, colorScheme: (isDark ? 'dark' : 'light') as 'light' | 'dark' }
  }, [resolvedTheme])
  const hasPayload = Boolean(payload)
  const defaultLoadingMessage = t('toolCall.widget.rendering')
  const loadingMessages =
    payload?.loadingMessages && payload.loadingMessages.length > 0
      ? payload.loadingMessages
      : [defaultLoadingMessage]
  const iframeRef = React.useRef<HTMLIFrameElement>(null)
  const resizeRafRef = React.useRef<number | null>(null)
  const lastAppliedHeightRef = React.useRef<number>(0)
  const [loaded, setLoaded] = React.useState(false)
  const [frameHeight, setFrameHeight] = React.useState(240)
  const [loadingIndex, setLoadingIndex] = React.useState(0)
  const frameKey = payload ? `${payload.title}:${payload.kind}:${widgetAppearance.colorScheme}` : 'widget-empty'
  const pendingWidgetCodeRef = React.useRef('')
  const lastPostedWidgetCodeRef = React.useRef('')
  const { sendMessage } = useChatActions()

  const postWidgetCode = React.useCallback((code: string): void => {
    const frameWindow = iframeRef.current?.contentWindow
    if (!frameWindow || !code || code === lastPostedWidgetCodeRef.current) return
    lastPostedWidgetCodeRef.current = code
    frameWindow.postMessage(
      {
        source: WIDGET_BRIDGE_SOURCE,
        type: 'update_code',
        code
      },
      '*'
    )
  }, [])

  React.useEffect(() => {
    setLoaded(false)
    setLoadingIndex(0)
    setFrameHeight(payload?.kind === 'svg' ? 320 : 420)
    lastPostedWidgetCodeRef.current = ''
  }, [payload?.title, payload?.kind])

  React.useEffect(() => {
    pendingWidgetCodeRef.current = payload?.widgetCode ?? ''
    if (loaded && payload?.widgetCode) {
      postWidgetCode(payload.widgetCode)
    }
  }, [loaded, payload?.widgetCode, postWidgetCode])

  React.useEffect(() => {
    if (!hasPayload || loadingMessages.length <= 1 || loaded) return
    const timer = window.setInterval(() => {
      setLoadingIndex((index) => (index + 1) % loadingMessages.length)
    }, 1400)
    return () => window.clearInterval(timer)
  }, [hasPayload, loaded, loadingMessages.length])

  React.useEffect(() => {
    const handleMessage = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (!data || typeof data !== 'object') return
      if ((data as { source?: unknown }).source !== WIDGET_BRIDGE_SOURCE) return

      const type = (data as { type?: unknown }).type
      if (type === 'ready') {
        setLoaded(true)
        postWidgetCode(pendingWidgetCodeRef.current)
        return
      }

      if (type === 'resize') {
        const nextHeight = (data as { height?: unknown }).height
        if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
          const normalizedHeight = Math.max(80, nextHeight)
          if (Math.abs(normalizedHeight - lastAppliedHeightRef.current) >= 0.5) {
            lastAppliedHeightRef.current = normalizedHeight
            if (resizeRafRef.current != null) {
              window.cancelAnimationFrame(resizeRafRef.current)
            }
            resizeRafRef.current = window.requestAnimationFrame(() => {
              setFrameHeight(normalizedHeight)
              resizeRafRef.current = null
            })
          }
        }
        return
      }

      if (type === 'send_prompt') {
        const text = (data as { text?: unknown }).text
        if (typeof text === 'string' && text.trim()) {
          void sendMessage({ text: text.trim() })
        }
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      if (resizeRafRef.current != null) {
        window.cancelAnimationFrame(resizeRafRef.current)
        resizeRafRef.current = null
      }
    }
  }, [postWidgetCode, sendMessage])

  if (!payload) return null
  if (!payload.widgetCode) {
    return isExecuting ? null : (
      <div className="my-2 text-xs text-muted-foreground/60">
        {t('toolCall.widget.waitingCode')}
      </div>
    )
  }

  const isPending = isExecuting && !loaded
  const loadingMessage = loadingMessages[loadingIndex] ?? defaultLoadingMessage

  return (
    <div className="my-2">
      <div
        className="relative overflow-hidden bg-transparent"
        style={{ width: '100%', border: 'none', backgroundColor: 'transparent' }}
      >
        <div
          className="w-full overflow-hidden bg-transparent leading-none"
          style={{ lineHeight: 0, fontSize: 0 }}
        >
          <iframe
            key={frameKey}
            ref={iframeRef}
            title={payload.title}
            sandbox="allow-scripts allow-forms"
            srcDoc={buildWidgetDocument(payload, widgetAppearance)}
            className="block border-0 bg-transparent transition-[height] duration-200"
            style={{
              width: 'calc(100% + 1px)',
              height: `${frameHeight}px`,
              marginRight: '-1px',
              verticalAlign: 'top',
              backgroundColor: 'transparent',
              colorScheme: widgetAppearance.colorScheme
            }}
          />
          {payload.kind === 'svg' ? <SvgWidgetCopyButton svg={payload.widgetCode} /> : null}
        </div>
        {isPending && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-[1px]">
            <div className="rounded-md bg-background/90 px-3 py-2 text-xs text-muted-foreground shadow-sm">
              {loadingMessage}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
