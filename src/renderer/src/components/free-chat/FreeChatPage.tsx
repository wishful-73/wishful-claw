import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import { cn } from '@renderer/lib/utils'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import { BUILTIN_BROWSER_PARTITION, stripElectronFromUserAgent } from '@shared/browser-plugin'

/**
 * Free Chat page (v2-iter-30 / S-27).
 *
 * Embeds the built-in browser — same webview partition as the right-panel
 * browser, so logins are shared — and pins it to one of the user-configured
 * free chat sites. Signing in is done by the user inside the page; the app
 * only provides a fixed browser target.
 */
export function FreeChatPage(): React.JSX.Element {
  const { t } = useTranslation('layout')
  const closeFreeChatPage = useUIStore((s) => s.closeFreeChatPage)
  const sites = useSettingsStore((s) => s.freeChatSites)
  const browserUserDataReuseEnabled = useSettingsStore((s) => s.browserUserDataReuseEnabled)

  const [activeSiteId, setActiveSiteId] = useState(() => sites[0]?.id ?? '')
  const [reloadToken, setReloadToken] = useState(0)
  const [runtimeReuseEnabled, setRuntimeReuseEnabled] = useState(browserUserDataReuseEnabled)
  const [runtimeUserAgent, setRuntimeUserAgent] = useState<string | undefined>(
    browserUserDataReuseEnabled ? stripElectronFromUserAgent(navigator.userAgent) : undefined
  )
  const webviewRef = useRef<Electron.WebviewTag | null>(null)

  const activeSite = sites.find((site) => site.id === activeSiteId) ?? sites[0]

  // Keep the selection valid when the site list is edited in settings.
  useEffect(() => {
    if (!sites.some((site) => site.id === activeSiteId)) {
      setActiveSiteId(sites[0]?.id ?? '')
    }
  }, [sites, activeSiteId])

  // Mirror BrowserPanel: the main process owns the effective browser profile mode.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const result = (await ipcClient.invoke(IPC.BROWSER_EMULATION_STATUS)) as
          | { success: true; status: { reuseEnabled: boolean; userAgent: string } }
          | { success: false; error?: string }
        if (!cancelled && result.success) {
          setRuntimeReuseEnabled(result.status.reuseEnabled)
          setRuntimeUserAgent(result.status.userAgent)
        }
      } catch {
        // Fall back to the values already read from the settings store.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleWebviewRef = useCallback((node: Electron.WebviewTag | null) => {
    webviewRef.current = node
  }, [])

  const webviewUserAgent = runtimeReuseEnabled ? runtimeUserAgent : undefined
  const webviewSessionProps: {
    partition?: string
    allowpopups: boolean
    useragent?: string
  } = {
    ...(runtimeReuseEnabled ? {} : { partition: BUILTIN_BROWSER_PARTITION }),
    allowpopups: true,
    ...(webviewUserAgent ? { useragent: webviewUserAgent } : {})
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar: close + site switcher (radio) + reload. No address bar by design. */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2">
        <button
          type="button"
          onClick={closeFreeChatPage}
          title={t('freeChat.close', { defaultValue: '返回' })}
          aria-label={t('freeChat.close', { defaultValue: '返回' })}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="size-4" />
        </button>

        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          {sites.map((site) => (
            <button
              key={site.id}
              type="button"
              onClick={() => setActiveSiteId(site.id)}
              title={site.url}
              className={cn(
                'h-6 shrink-0 rounded-md px-2 text-xs font-medium transition-colors',
                site.id === activeSite?.id
                  ? 'bg-accent text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
              )}
            >
              {site.name}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setReloadToken((token) => token + 1)}
          disabled={!activeSite}
          title={t('freeChat.reload', { defaultValue: '重新加载' })}
          aria-label={t('freeChat.reload', { defaultValue: '重新加载' })}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 bg-background">
        {activeSite ? (
          <webview
            key={`${activeSite.id}-${reloadToken}`}
            ref={handleWebviewRef as React.Ref<Electron.WebviewTag>}
            src={activeSite.url}
            className="size-full"
            {...webviewSessionProps}
          />
        ) : (
          <div className="flex size-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {t('freeChat.empty', {
              defaultValue: '尚未配置免费对话站点，请在「设置 → AI 服务 → 免费对话清单」中添加。'
            })}
          </div>
        )}
      </div>
    </div>
  )
}
