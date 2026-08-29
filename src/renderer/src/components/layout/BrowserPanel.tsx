import { useEffect, useRef, useState, useCallback } from 'react'
import { ArrowLeft, ArrowRight, RefreshCw, Square, Globe, AlertCircle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { useUIStore } from '@renderer/stores/ui-store'
import { useSettingsStore } from '@renderer/stores/settings-store'
import {
  getBrowserAccessDecision,
  normalizeBrowserUrl
} from '@renderer/lib/app-plugin/browser-access'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import {
  describeWebviewOperationError,
  isPromiseLike,
  isWebviewConnected,
  type MaybePromise
} from '@renderer/lib/browser/webview-helpers'
import { useTranslation } from 'react-i18next'
import {
  BUILTIN_BROWSER_PARTITION,
  stripElectronFromUserAgent
} from '@shared/browser-plugin'

export function BrowserPanel({
  sessionId = null,
  projectId = null
}: {
  sessionId?: string | null
  projectId?: string | null
}): React.JSX.Element {
  const { t } = useTranslation('layout')

  const storedUrl = useUIStore((s) => s.getBrowserState(sessionId, projectId).url)
  const setBrowserUrl = useUIStore((s) => s.setBrowserUrl)
  const loading = useUIStore((s) => s.getBrowserState(sessionId, projectId).loading)
  const setBrowserLoading = useUIStore((s) => s.setBrowserLoading)
  const setBrowserPageTitle = useUIStore((s) => s.setBrowserPageTitle)
  const canGoBack = useUIStore((s) => s.getBrowserState(sessionId, projectId).canGoBack)
  const setBrowserCanGoBack = useUIStore((s) => s.setBrowserCanGoBack)
  const canGoForward = useUIStore((s) => s.getBrowserState(sessionId, projectId).canGoForward)
  const setBrowserCanGoForward = useUIStore((s) => s.setBrowserCanGoForward)
  const errorInfo = useUIStore((s) => s.getBrowserState(sessionId, projectId).errorInfo)
  const setBrowserErrorInfo = useUIStore((s) => s.setBrowserErrorInfo)
  const setBrowserWebviewRef = useUIStore((s) => s.setBrowserWebviewRef)
  const browserUserDataReuseEnabled = useSettingsStore((s) => s.browserUserDataReuseEnabled)

  const [inputUrl, setInputUrl] = useState(storedUrl)
  const [committedUrl, setCommittedUrl] = useState(storedUrl)
  const [runtimeBrowserUserDataReuseEnabled, setRuntimeBrowserUserDataReuseEnabled] = useState(
    browserUserDataReuseEnabled
  )
  const [runtimeBrowserUserAgent, setRuntimeBrowserUserAgent] = useState<string | undefined>(
    browserUserDataReuseEnabled ? stripElectronFromUserAgent(navigator.userAgent) : undefined
  )
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const initialBrowserUserDataReuseEnabledRef = useRef(browserUserDataReuseEnabled)
  const webviewUserAgent = runtimeBrowserUserDataReuseEnabled ? runtimeBrowserUserAgent : undefined
  const webviewSessionProps: Pick<
    React.ComponentProps<'webview'>,
    'partition' | 'allowpopups' | 'useragent'
  > = {
    ...(runtimeBrowserUserDataReuseEnabled ? {} : { partition: BUILTIN_BROWSER_PARTITION }),
    allowpopups: true,
    ...(webviewUserAgent ? { useragent: webviewUserAgent } : {})
  }

  useEffect(() => {
    let cancelled = false

    async function loadRuntimeBrowserMode(): Promise<void> {
      try {
        const result = (await ipcClient.invoke(IPC.BROWSER_EMULATION_STATUS)) as
          | { success: true; status: { reuseEnabled: boolean; userAgent: string } }
          | { success: false; error?: string }
        if (!cancelled && result.success) {
          setRuntimeBrowserUserDataReuseEnabled(result.status.reuseEnabled)
          setRuntimeBrowserUserAgent(result.status.userAgent)
        }
      } catch {
        if (!cancelled) {
          setRuntimeBrowserUserDataReuseEnabled(initialBrowserUserDataReuseEnabledRef.current)
          setRuntimeBrowserUserAgent(stripElectronFromUserAgent(navigator.userAgent))
        }
      }
    }

    void loadRuntimeBrowserMode()
    return () => {
      cancelled = true
    }
  }, [])

  const handleWebviewOperationError = useCallback(
    (action: string, error: unknown): void => {
      console.warn('[BrowserPanel] Webview operation failed:', {
        action,
        message: describeWebviewOperationError(action, error)
      })
      setBrowserLoading(false, sessionId, projectId)
      setBrowserCanGoBack(false, sessionId, projectId)
      setBrowserCanGoForward(false, sessionId, projectId)
    },
    [projectId, sessionId, setBrowserCanGoBack, setBrowserCanGoForward, setBrowserLoading]
  )

  const runWebviewCommand = useCallback(
    (action: string, command: (webview: Electron.WebviewTag) => MaybePromise<void>): void => {
      const wv = webviewRef.current
      if (!isWebviewConnected(wv)) return

      try {
        const result = command(wv)
        if (isPromiseLike(result)) {
          void Promise.resolve(result).catch((error) => handleWebviewOperationError(action, error))
        }
      } catch (error) {
        handleWebviewOperationError(action, error)
      }
    },
    [handleWebviewOperationError]
  )

  useEffect(() => {
    setInputUrl(storedUrl)
    setCommittedUrl(storedUrl)
  }, [storedUrl])

  const blockNavigation = useCallback(
    (url: string, reason?: string): void => {
      setBrowserErrorInfo(
        {
          code: -10,
          desc: reason ?? t('browser.blockedByRules'),
          url
        },
        sessionId,
        projectId
      )
      setBrowserLoading(false, sessionId, projectId)
    },
    [projectId, sessionId, setBrowserErrorInfo, setBrowserLoading, t]
  )

  const canNavigateTo = useCallback(
    (url: string): boolean => {
      const decision = getBrowserAccessDecision(url)
      if (decision.allowed) return true
      blockNavigation(url, decision.reason)
      return false
    },
    [blockNavigation]
  )

  const navigate = useCallback(
    (url: string): void => {
      const normalized = normalizeBrowserUrl(url)
      if (!normalized) return
      setInputUrl(normalized)
      if (!canNavigateTo(normalized)) return
      setCommittedUrl(normalized)
      setBrowserUrl(normalized, sessionId, projectId)
      setBrowserErrorInfo(null, sessionId, projectId)
      const wv = webviewRef.current
      if (isWebviewConnected(wv)) {
        try {
          wv.src = normalized
        } catch (error) {
          handleWebviewOperationError('navigate', error)
        }
      }
    },
    [
      canNavigateTo,
      handleWebviewOperationError,
      projectId,
      sessionId,
      setBrowserErrorInfo,
      setBrowserUrl
    ]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') navigate(inputUrl)
  }

  const updateNavState = useCallback(() => {
    const wv = webviewRef.current
    if (!isWebviewConnected(wv)) return

    try {
      setBrowserCanGoBack(wv.canGoBack(), sessionId, projectId)
      setBrowserCanGoForward(wv.canGoForward(), sessionId, projectId)
    } catch (error) {
      handleWebviewOperationError('read navigation state', error)
    }
  }, [
    handleWebviewOperationError,
    projectId,
    sessionId,
    setBrowserCanGoBack,
    setBrowserCanGoForward
  ])

  // --- Event binding via callback ref ---
  //
  // Previous approach used a useEffect that checked `isWebviewConnected(wv)` and
  // bailed out when the webview wasn't connected yet. This meant events were
  // never bound on first mount (the effect didn't re-run after the guest
  // connected), and key changes (reuse-mode toggle) left the new webview
  // without listeners.
  //
  // The callback ref fires the moment React attaches the DOM element, before
  // the guest process connects. addEventListener works on the DOM element
  // regardless of guest connection state, so we bind immediately.
  //
  // latestRef holds the newest callbacks so that event listeners always call
  // up-to-date store actions without needing to re-bind on every render.

  const latestRef = useRef({
    canNavigateTo,
    setBrowserLoading,
    setBrowserUrl,
    setBrowserErrorInfo,
    setBrowserPageTitle,
    setBrowserCanGoBack,
    setBrowserCanGoForward,
    setBrowserWebviewRef,
    updateNavState,
    sessionId,
    projectId
  })
  latestRef.current = {
    canNavigateTo,
    setBrowserLoading,
    setBrowserUrl,
    setBrowserErrorInfo,
    setBrowserPageTitle,
    setBrowserCanGoBack,
    setBrowserCanGoForward,
    setBrowserWebviewRef,
    updateNavState,
    sessionId,
    projectId
  }

  const webviewCleanupRef = useRef<(() => void) | null>(null)

  const handleWebviewRef = useCallback((wv: Electron.WebviewTag | null) => {
    // Clean up listeners from the previous webview element (if any).
    if (webviewCleanupRef.current) {
      webviewCleanupRef.current()
      webviewCleanupRef.current = null
    }

    webviewRef.current = wv

    const R = latestRef.current
    R.setBrowserWebviewRef(webviewRef, R.sessionId, R.projectId)

    if (!wv) {
      R.setBrowserLoading(false, R.sessionId, R.projectId)
      return
    }

    const onStartLoading = (): void => {
      R.setBrowserLoading(true, R.sessionId, R.projectId)
      R.setBrowserErrorInfo(null, R.sessionId, R.projectId)
    }

    const onStopLoading = (): void => {
      R.setBrowserLoading(false, R.sessionId, R.projectId)
      R.updateNavState()
    }

    const onNavigate = (e: Electron.DidNavigateEvent): void => {
      setInputUrl(e.url)
      R.setBrowserUrl(e.url, R.sessionId, R.projectId)
      R.updateNavState()
    }

    const onNavigateInPage = (e: Electron.DidNavigateInPageEvent): void => {
      setInputUrl(e.url)
      R.setBrowserUrl(e.url, R.sessionId, R.projectId)
      R.updateNavState()
    }

    const onTitleUpdated = (e: Electron.PageTitleUpdatedEvent): void => {
      R.setBrowserPageTitle(e.title, R.sessionId, R.projectId)
    }

    const onFailLoad = (e: Electron.DidFailLoadEvent): void => {
      if (!e.isMainFrame || e.errorCode === -3) return
      R.setBrowserErrorInfo(
        { code: e.errorCode, desc: e.errorDescription, url: e.validatedURL },
        R.sessionId,
        R.projectId
      )
      R.setBrowserLoading(false, R.sessionId, R.projectId)
    }

    const onWillNavigate = (e: Event & { url?: string; preventDefault: () => void }): void => {
      if (!e.url || latestRef.current.canNavigateTo(e.url)) return
      e.preventDefault()
    }

    const onNewWindow = (e: Event & { url: string; preventDefault: () => void }): void => {
      e.preventDefault()
      if (!latestRef.current.canNavigateTo(e.url)) return
      ipcClient.invoke(IPC.SHELL_OPEN_EXTERNAL, e.url).catch((err) => {
        console.error('[BrowserPanel] Failed to open external URL:', err)
      })
    }

    const onRenderProcessGone = (e: Event & { reason?: string }): void => {
      const LR = latestRef.current
      LR.setBrowserLoading(false, LR.sessionId, LR.projectId)
      LR.setBrowserErrorInfo(
        {
          code: -20,
          desc: `Render process gone: ${e.reason ?? 'unknown'}`,
          url: wv.src ?? ''
        },
        LR.sessionId,
        LR.projectId
      )
      // Auto-reload after a brief delay so the user doesn't get stuck
      // on a blank panel after a crash.
      setTimeout(() => {
        if (webviewRef.current === wv) {
          try {
            wv.reload()
          } catch {
            // webview may have been removed
          }
        }
      }, 500)
    }

    wv.addEventListener('did-start-loading', onStartLoading)
    wv.addEventListener('did-stop-loading', onStopLoading)
    wv.addEventListener('did-navigate', onNavigate as EventListener)
    wv.addEventListener('did-navigate-in-page', onNavigateInPage as EventListener)
    wv.addEventListener('page-title-updated', onTitleUpdated as EventListener)
    wv.addEventListener('did-fail-load', onFailLoad as EventListener)
    wv.addEventListener('will-navigate', onWillNavigate as EventListener)
    wv.addEventListener('new-window', onNewWindow as EventListener)
    wv.addEventListener('render-process-gone', onRenderProcessGone as EventListener)

    webviewCleanupRef.current = () => {
      wv.removeEventListener('did-start-loading', onStartLoading)
      wv.removeEventListener('did-stop-loading', onStopLoading)
      wv.removeEventListener('did-navigate', onNavigate as EventListener)
      wv.removeEventListener('did-navigate-in-page', onNavigateInPage as EventListener)
      wv.removeEventListener('page-title-updated', onTitleUpdated as EventListener)
      wv.removeEventListener('did-fail-load', onFailLoad as EventListener)
      wv.removeEventListener('will-navigate', onWillNavigate as EventListener)
      wv.removeEventListener('new-window', onNewWindow as EventListener)
      wv.removeEventListener('render-process-gone', onRenderProcessGone as EventListener)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border/50 px-2">
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => runWebviewCommand('go back', (wv) => wv.goBack())}
          disabled={!canGoBack}
          title={t('browser.back')}
        >
          <ArrowLeft className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={() => runWebviewCommand('go forward', (wv) => wv.goForward())}
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
            onClick={() => runWebviewCommand('stop loading', (wv) => wv.stop())}
            title={t('browser.stop')}
          >
            <Square className="size-3" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            onClick={() => runWebviewCommand('refresh', (wv) => wv.reload())}
            title={t('browser.refresh')}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        )}

        <div className="flex flex-1 items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 h-6">
          <Globe className="size-3 shrink-0 text-muted-foreground" />
          <input
            className="flex-1 bg-transparent text-[11px] outline-none placeholder:text-muted-foreground"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('browser.urlPlaceholder')}
            spellCheck={false}
          />
        </div>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={() => navigate(inputUrl)}
        >
          {t('browser.go')}
        </Button>
      </div>

      {/* Loading bar */}
      {loading && (
        <div className="h-0.5 w-full overflow-hidden bg-muted">
          <div className="h-full w-full animate-progress bg-primary/60" />
        </div>
      )}

      {/* Content */}
      <div className="relative min-h-0 flex-1">
        {committedUrl && (
          <webview
            key={runtimeBrowserUserDataReuseEnabled ? 'user-browser-profile' : 'wishfulclaw-profile'}
            ref={handleWebviewRef as React.Ref<Electron.WebviewTag>}
            src={committedUrl}
            className="size-full"
            {...webviewSessionProps}
            {...(runtimeBrowserUserDataReuseEnabled ? { plugins: 'true' as unknown as boolean } : {})}
          />
        )}
        {errorInfo ? (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background text-sm text-muted-foreground">
              <AlertCircle className="size-10 opacity-30" />
              <p className="font-medium">{t('rightPanel.browserLoadFailed')}</p>
              <p className="text-xs opacity-70">
                {errorInfo.desc} ({errorInfo.code})
              </p>
              <p className="max-w-[80%] truncate text-xs opacity-50">{errorInfo.url}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBrowserErrorInfo(null, sessionId, projectId)
                  runWebviewCommand('retry load', (wv) => wv.reload())
                }}
              >
                {t('rightPanel.browserRetry')}
              </Button>
            </div>
          </>
        ) : !committedUrl ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-xs text-muted-foreground">
            <Globe className="size-8 opacity-20" />
            <span>{t('rightPanel.browserEmptyState')}</span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
