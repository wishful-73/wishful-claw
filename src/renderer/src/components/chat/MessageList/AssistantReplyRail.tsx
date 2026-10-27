import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import {
  type AssistantReplyRailItem,
  ASSISTANT_RAIL_DENSE_THRESHOLD,
  getCompactRailMarkerY,
  getCompactRailMarkerTop,
  getCompactRailMarkerOffsetPx,
  getCompactRailGapPx,
  splitLocatorPreview,
} from './utils'

export function AssistantReplyRail({
  items,
  activeMessageIds,
  onJump
}: {
  items: AssistantReplyRailItem[]
  activeMessageIds: Set<string>
  onJump: (item: AssistantReplyRailItem) => void
}): React.JSX.Element | null {
  const { t } = useTranslation('chat')
  const [previewMessageId, setPreviewMessageId] = React.useState<string | null>(null)
  const [pointerPosition, setPointerPosition] = React.useState<{
    y: number
    railHeight: number
  } | null>(null)
  const pointerFrameRef = React.useRef<number | null>(null)
  const pendingPointerPositionRef = React.useRef<typeof pointerPosition>(null)
  const dense = items.length >= ASSISTANT_RAIL_DENSE_THRESHOLD

  const getNearestItem = React.useCallback(
    (clientY: number, target: HTMLElement): AssistantReplyRailItem | null => {
      if (items.length === 0) return null
      const rect = target.getBoundingClientRect()
      if (rect.height <= 0) return null
      let nearestItem = items[0]
      let nearestDistance = Number.POSITIVE_INFINITY
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex]
        const markerY = getCompactRailMarkerY(rect, itemIndex, items.length)
        const distance = Math.abs(markerY - clientY)
        if (distance < nearestDistance) {
          nearestDistance = distance
          nearestItem = item
        }
      }
      return nearestItem
    },
    [items]
  )

  const schedulePointerPosition = React.useCallback((position: typeof pointerPosition) => {
    pendingPointerPositionRef.current = position
    if (pointerFrameRef.current !== null) return

    pointerFrameRef.current = window.requestAnimationFrame(() => {
      pointerFrameRef.current = null
      setPointerPosition(pendingPointerPositionRef.current)
    })
  }, [])

  React.useEffect(() => {
    return () => {
      if (pointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerFrameRef.current)
      }
    }
  }, [])

  if (items.length < 2) return null

  const previewItem = previewMessageId
    ? (items.find((item) => item.id === previewMessageId) ?? null)
    : null
  const previewItemIndex = previewItem ? items.findIndex((item) => item.id === previewItem.id) : -1
  const previewCopy = previewItem ? splitLocatorPreview(previewItem.preview) : null
  const previewTop =
    previewItemIndex >= 0 ? getCompactRailMarkerTop(previewItemIndex, items.length) : '50%'

  const getMarkerWaveScale = (itemIndex: number): number => {
    if (!pointerPosition) return 1
    const markerY =
      pointerPosition.railHeight / 2 + getCompactRailMarkerOffsetPx(itemIndex, items.length)
    const distance = Math.abs(markerY - pointerPosition.y)
    const influenceRadius = Math.max(24, getCompactRailGapPx(items.length) * 4.5)
    if (distance >= influenceRadius) return 1

    const normalizedDistance = distance / influenceRadius
    const extension = 7 * Math.exp(-4 * normalizedDistance * normalizedDistance)
    return (12 + extension) / 12
  }

  const renderMarker = (
    item: AssistantReplyRailItem,
    itemIndex: number,
    previewing: boolean
  ): React.JSX.Element => {
    const active = activeMessageIds.has(item.id)
    return (
      <span
        className={cn(
          'block h-0.5 w-3 origin-right rounded-full transition-[color,background-color,opacity,transform] duration-100 ease-out will-change-transform',
          item.kind === 'summary'
            ? 'bg-amber-500/55'
            : item.kind === 'user'
              ? 'bg-primary/45'
              : item.kind === 'streaming'
                ? 'bg-primary/65'
                : 'bg-muted-foreground/35',
          item.kind === 'streaming' && 'animate-pulse',
          active ? 'bg-foreground/85 opacity-100' : 'opacity-65',
          previewing && 'bg-foreground/95 opacity-100'
        )}
        style={{ transform: `scaleX(${getMarkerWaveScale(itemIndex)})` }}
      />
    )
  }

  const getLabel = (item: AssistantReplyRailItem): string => {
    if (activeMessageIds.has(item.id)) {
      return t('messageList.assistantRail.currentLabel', {
        index: item.index,
        preview: item.preview,
        defaultValue: 'Current message {{index}}: {{preview}}'
      })
    }
    if (item.kind === 'user') {
      return t('messageList.assistantRail.userLabel', {
        index: item.index,
        preview: item.preview,
        defaultValue: 'Jump to user message {{index}}: {{preview}}'
      })
    }
    if (item.kind === 'streaming') {
      return t('messageList.assistantRail.streamingLabel', {
        index: item.index,
        preview: item.preview,
        defaultValue: 'Jump to streaming assistant reply {{index}}: {{preview}}'
      })
    }
    if (item.kind === 'summary') {
      return t('messageList.assistantRail.summaryLabel', {
        index: item.index,
        preview: item.preview,
        defaultValue: 'Jump to compressed history summary {{index}}: {{preview}}'
      })
    }
    return t('messageList.assistantRail.jumpLabel', {
      index: item.index,
      preview: item.preview,
      defaultValue: 'Jump to message {{index}}: {{preview}}'
    })
  }

  return (
    // top-12 而不是 top-5：正上方那 28px 留给右上角会话操作块里最下面那颗按钮
    // （该块 `right-3 top-3 z-30`，绝对定位，会盖住本条导轨的顶部）。S-225 的渲染档位钮
    // 现在也在那块里，不再单独占这条竖线，见 RenderDensityToggle 文件头。
    <div className="pointer-events-none absolute bottom-5 right-4 top-12 z-20 hidden md:block">
      <div className="pointer-events-none relative h-full w-[min(320px,calc(100vw-3rem))]">
        {previewItem && previewCopy ? (
          <div
            className="absolute right-8 w-[min(276px,calc(100vw-5rem))] -translate-y-1/2 animate-in fade-in-0 slide-in-from-right-1 duration-150"
            style={{ top: previewTop }}
          >
            <div className="overflow-hidden rounded-xl border border-border/70 bg-popover/95 px-3 py-2.5 text-popover-foreground shadow-xl backdrop-blur-xl">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    previewItem.kind === 'summary'
                      ? 'bg-amber-500/80'
                      : previewItem.kind === 'user'
                        ? 'bg-primary/80'
                        : previewItem.kind === 'streaming'
                          ? 'bg-primary/80'
                          : 'bg-muted-foreground/70'
                  )}
                />
                <div className="min-w-0 flex-1 line-clamp-1 text-[12px] font-semibold leading-5">
                  {previewCopy.title}
                </div>
              </div>
              {previewCopy.detail ? (
                <div className="mt-0.5 line-clamp-2 text-[11px] leading-[18px] text-muted-foreground">
                  {previewCopy.detail}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            'pointer-events-auto absolute right-0 top-0 h-full w-6',
            dense && 'cursor-pointer'
          )}
          onPointerMove={(event) => {
            const rect = event.currentTarget.getBoundingClientRect()
            schedulePointerPosition({
              y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
              railHeight: rect.height
            })
            if (dense) {
              const item = getNearestItem(event.clientY, event.currentTarget)
              setPreviewMessageId((prev) => (prev === item?.id ? prev : (item?.id ?? null)))
            }
          }}
          onPointerLeave={() => {
            pendingPointerPositionRef.current = null
            if (pointerFrameRef.current !== null) {
              window.cancelAnimationFrame(pointerFrameRef.current)
              pointerFrameRef.current = null
            }
            setPointerPosition(null)
            if (dense) setPreviewMessageId(null)
          }}
          onClick={
            dense
              ? (event) => {
                  const item = getNearestItem(event.clientY, event.currentTarget)
                  if (item) onJump(item)
                }
              : undefined
          }
        >
          {items.map((item, itemIndex) => {
            const previewing = previewMessageId === item.id
            return dense ? (
              <span
                key={item.id}
                className="absolute right-0 flex h-3 w-6 -translate-y-1/2 items-center justify-end"
                style={{ top: getCompactRailMarkerTop(itemIndex, items.length) }}
              >
                {renderMarker(item, itemIndex, previewing)}
              </span>
            ) : (
              <button
                key={item.id}
                type="button"
                aria-current={activeMessageIds.has(item.id) ? 'true' : undefined}
                aria-label={getLabel(item)}
                title={item.preview}
                className="pointer-events-auto group/assistant-marker absolute right-0 flex w-6 -translate-y-1/2 items-center justify-end rounded-sm outline-none"
                style={{
                  top: getCompactRailMarkerTop(itemIndex, items.length),
                  height: getCompactRailGapPx(items.length)
                }}
                onPointerEnter={() => setPreviewMessageId(item.id)}
                onPointerLeave={() => setPreviewMessageId(null)}
                onFocus={() => setPreviewMessageId(item.id)}
                onBlur={() => setPreviewMessageId(null)}
                onClick={() => onJump(item)}
              >
                {renderMarker(item, itemIndex, previewing)}
              </button>
            )
          })}
        </div>

        {dense ? (
          <div className="sr-only">
            {items.map((item) => (
              <button
                key={`assistant-rail-keyboard-${item.id}`}
                type="button"
                aria-current={activeMessageIds.has(item.id) ? 'true' : undefined}
                aria-label={getLabel(item)}
                onFocus={() => setPreviewMessageId(item.id)}
                onBlur={() => setPreviewMessageId(null)}
                onClick={() => onJump(item)}
              >
                {item.preview}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
