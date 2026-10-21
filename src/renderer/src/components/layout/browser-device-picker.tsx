import { useEffect, useState } from 'react'
import { Monitor, Smartphone, Tablet, SlidersHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/components/ui/popover'
import {
  BROWSER_DEVICE_MODES,
  CUSTOM_VIEWPORT_MAX,
  CUSTOM_VIEWPORT_MIN,
  DEFAULT_CUSTOM_VIEWPORT,
  normalizeViewportSide,
  type BrowserDeviceMode
} from '@shared/browser-device-presets'

export interface BrowserDevicePickerProps {
  mode: BrowserDeviceMode
  customViewport: { width: number; height: number } | null
  onChange: (next: {
    mode: BrowserDeviceMode
    customViewport: { width: number; height: number } | null
  }) => void
}

const DEVICE_ICONS: Record<BrowserDeviceMode, typeof Monitor> = {
  pc: Monitor,
  iphone: Smartphone,
  pixel: Smartphone,
  ipad: Tablet,
  custom: SlidersHorizontal
}

export function BrowserDevicePicker({
  mode,
  customViewport,
  onChange
}: BrowserDevicePickerProps): React.JSX.Element {
  const { t } = useTranslation('layout')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(() => ({
    width: String(customViewport?.width ?? DEFAULT_CUSTOM_VIEWPORT.width),
    height: String(customViewport?.height ?? DEFAULT_CUSTOM_VIEWPORT.height)
  }))

  // agent 也能改设备尺寸：每次打开面板按 store 最新值重来，
  // 否则用户会在输入框里看到上一次的陈旧数字并据此覆盖。
  useEffect(() => {
    if (!open) return
    setDraft({
      width: String(customViewport?.width ?? DEFAULT_CUSTOM_VIEWPORT.width),
      height: String(customViewport?.height ?? DEFAULT_CUSTOM_VIEWPORT.height)
    })
  }, [open, customViewport])

  const CurrentIcon = DEVICE_ICONS[mode]

  const selectMode = (next: BrowserDeviceMode): void => {
    if (next === 'custom') {
      const resolved = {
        width: normalizeViewportSide(draft.width, DEFAULT_CUSTOM_VIEWPORT.width),
        height: normalizeViewportSide(draft.height, DEFAULT_CUSTOM_VIEWPORT.height)
      }
      onChange({ mode: 'custom', customViewport: resolved })
      return
    }
    onChange({ mode: next, customViewport: null })
  }

  const commitCustom = (): void => {
    const resolved = {
      width: normalizeViewportSide(draft.width, DEFAULT_CUSTOM_VIEWPORT.width),
      height: normalizeViewportSide(draft.height, DEFAULT_CUSTOM_VIEWPORT.height)
    }
    // 输入值回写成夹取后的整数，避免「填 99999、框里还显示 99999」
    setDraft({ width: String(resolved.width), height: String(resolved.height) })
    if (mode === 'custom') onChange({ mode: 'custom', customViewport: resolved })
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          title={t('browser.device.title')}
          aria-label={t('browser.device.title')}
        >
          <CurrentIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-1">
        <div className="flex flex-col">
          {BROWSER_DEVICE_MODES.map((item) => {
            const Icon = DEVICE_ICONS[item]
            const active = item === mode
            return (
              <button
                key={item}
                type="button"
                onClick={() => selectMode(item)}
                className={
                  'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent ' +
                  (active ? 'bg-accent text-accent-foreground' : '')
                }
              >
                <Icon className="size-3.5 shrink-0 opacity-70" />
                <span className="flex-1">{t(`browser.device.${item}`)}</span>
              </button>
            )
          })}

          <div className="mt-1 border-t border-border/60 px-2 pb-1 pt-2">
            <div className="flex items-center gap-1">
              <input
                className="h-6 w-full min-w-0 rounded border border-border/60 bg-transparent px-1 text-[11px] outline-none"
                value={draft.width}
                inputMode="numeric"
                min={CUSTOM_VIEWPORT_MIN}
                max={CUSTOM_VIEWPORT_MAX}
                aria-label={t('browser.device.width')}
                onChange={(e) => setDraft((prev) => ({ ...prev, width: e.target.value }))}
                onBlur={commitCustom}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCustom()
                }}
              />
              <span className="text-[11px] text-muted-foreground">×</span>
              <input
                className="h-6 w-full min-w-0 rounded border border-border/60 bg-transparent px-1 text-[11px] outline-none"
                value={draft.height}
                inputMode="numeric"
                min={CUSTOM_VIEWPORT_MIN}
                max={CUSTOM_VIEWPORT_MAX}
                aria-label={t('browser.device.height')}
                onChange={(e) => setDraft((prev) => ({ ...prev, height: e.target.value }))}
                onBlur={commitCustom}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCustom()
                }}
              />
            </div>
            <p className="mt-1 text-[10px] leading-tight text-muted-foreground">
              {t('browser.device.customHint', {
                min: CUSTOM_VIEWPORT_MIN,
                max: CUSTOM_VIEWPORT_MAX
              })}
            </p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
