import { ArrowLeft, ArrowRight, RefreshCw, Square, Globe, Eraser, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@renderer/components/ui/button'
import type { BrowserDeviceMode } from '@shared/browser-device-presets'
import { BrowserDevicePicker } from './browser-device-picker'

export interface BrowserToolbarProps {
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  inputUrl: string
  onInputChange: (value: string) => void
  onInputCommit: () => void
  onBack: () => void
  onForward: () => void
  onStop: () => void
  onReload: () => void
  onGo: () => void
  /** S-235：清 HTTP + 字节码缓存并重载。`clearing` 期间按钮转圈且禁用，防连点。 */
  clearing: boolean
  onClearCache: () => void
  deviceMode: BrowserDeviceMode
  customViewport: { width: number; height: number } | null
  onDeviceChange: (next: {
    mode: BrowserDeviceMode
    customViewport: { width: number; height: number } | null
  }) => void
}

export function BrowserToolbar({
  canGoBack,
  canGoForward,
  loading,
  inputUrl,
  onInputChange,
  onInputCommit,
  onBack,
  onForward,
  onStop,
  onReload,
  onGo,
  clearing,
  onClearCache,
  deviceMode,
  customViewport,
  onDeviceChange
}: BrowserToolbarProps): React.JSX.Element {
  const { t } = useTranslation('layout')

  return (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-2">
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={onBack}
        disabled={!canGoBack}
        title={t('browser.back')}
      >
        <ArrowLeft className="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={onForward}
        disabled={!canGoForward}
        title={t('browser.forward')}
      >
        <ArrowRight className="size-3.5" />
      </Button>
      {loading ? (
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onStop}
          title={t('browser.stop')}
        >
          <Square className="size-3" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={onReload}
          title={t('browser.refresh')}
        >
          <RefreshCw className="size-3.5" />
        </Button>
      )}

      <div className="flex h-6 flex-1 items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2">
        <Globe className="size-3 shrink-0 text-muted-foreground" />
        <input
          className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
          value={inputUrl}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onInputCommit()
          }}
          placeholder={t('browser.urlPlaceholder')}
          spellCheck={false}
        />
      </div>

      <Button variant="ghost" size="sm" className="h-6 px-2 text-[11px]" onClick={onGo}>
        {t('browser.go')}
      </Button>

      {/* 清缓存放在「动作」这一组里，紧挨页面导航：用户遇到「页面还是旧的」时第一反应
          是在这个工具栏上找，不是去设置页翻。窄面板下地址栏是 flex-1，会先让位。 */}
      <Button
        variant="ghost"
        size="icon"
        className="size-6"
        onClick={onClearCache}
        disabled={clearing}
        title={t('browser.clearCache')}
      >
        {clearing ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Eraser className="size-3.5" />
        )}
      </Button>

      <BrowserDevicePicker
        mode={deviceMode}
        customViewport={customViewport}
        onChange={onDeviceChange}
      />
    </div>
  )
}
