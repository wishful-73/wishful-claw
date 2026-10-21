import { ArrowLeft, ArrowRight, RefreshCw, Square, Globe } from 'lucide-react'
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

      <BrowserDevicePicker
        mode={deviceMode}
        customViewport={customViewport}
        onChange={onDeviceChange}
      />
    </div>
  )
}
