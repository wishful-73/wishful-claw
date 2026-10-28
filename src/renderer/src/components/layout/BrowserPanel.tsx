// 500 行豁免（2026-10-28，行数以实际为准）：内置浏览器面板是**单一组件** —— 地址栏、`<webview>` 命令桥、
// 导航序号（`navigationSeq` / `committedUrl`）、下载与权限提示全部共享同一份组件内 state；
// 拆出去每块都要搬 state 并加一层 props 透传，排查反而更难。豁免依据：AGENTS.md §大文件拆分 第 5 条第 3 类（拆分需大量 props 透传或 state 搬运的组件）。

import { useEffect, useRef, useState, useCallback } from 'react'
import { Globe, AlertCircle } from 'lucide-react'
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
import { isSameBrowserUrl, nextCommittedUrl } from '@renderer/lib/browser/committed-url'
import { forgetBrowserDeviceState } from '@renderer/lib/browser/apply-browser-device'
import { clearBrowserCache } from '@renderer/lib/browser/clear-browser-cache'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  BUILTIN_BROWSER_PARTITION,
  stripElectronFromUserAgent
} from '@shared/browser-plugin'
import { resolveBrowserDeviceViewport } from '@shared/browser-device-presets'
import { BrowserToolbar } from './browser-toolbar'
import { useBrowserDeviceEmulation } from './use-browser-device-emulation'

export function BrowserPanel({
  sessionId = null,
  projectId = null
}: {
  sessionId?: string | null
  projectId?: string | null
}): React.JSX.Element {
  const { t } = useTranslation('layout')

  const storedUrl = useUIStore((s) => s.getBrowserState(sessionId, projectId).url)
  const navigationSeq = useUIStore((s) => s.getBrowserState(sessionId, projectId).navigationSeq)
  const deviceMode = useUIStore((s) => s.getBrowserState(sessionId, projectId).deviceMode)
  const customViewport = useUIStore((s) => s.getBrowserState(sessionId, projectId).customViewport)
  const setBrowserDevice = useUIStore((s) => s.setBrowserDevice)
  const requestBrowserNavigation = useUIStore((s) => s.requestBrowserNavigation)
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
  // UA 与「复用浏览器数据」是两件事：复用管的是 partition / userData，UA 管的是「以什么身份出现」。
  // 内置浏览器任何时候都必须是一个普通 Chromium，否则站点会把它认成非标准客户端并拒绝登录。
  const [runtimeBrowserUserAgent, setRuntimeBrowserUserAgent] = useState<string>(() =>
    stripElectronFromUserAgent(navigator.userAgent)
  )
  const webviewRef = useRef<Electron.WebviewTag | null>(null)
  const initialBrowserUserDataReuseEnabledRef = useRef(browserUserDataReuseEnabled)

  // 设备仿真：切换设备时改 UA → 补视口 → 重载；dom-ready 时只补视口（不重载）。
  const { syncOnReady, reapply } = useBrowserDeviceEmulation({
    webviewRef,
    mode: deviceMode,
    customViewport,
    desktopUserAgent: runtimeBrowserUserAgent
  })
  // prop 只管「新元素首次导航前」的身份；运行时切换设备由 setUserAgent 负责。
  const deviceViewport = resolveBrowserDeviceViewport(deviceMode, customViewport)
  const effectiveUserAgent = deviceViewport?.userAgent ?? runtimeBrowserUserAgent
  const webviewSessionProps: Pick<
    React.ComponentProps<'webview'>,
    'partition' | 'allowpopups' | 'useragent'
  > = {
    ...(runtimeBrowserUserDataReuseEnabled ? {} : { partition: BUILTIN_BROWSER_PARTITION }),
    allowpopups: true,
    ...(effectiveUserAgent ? { useragent: effectiveUserAgent } : {})
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
          // 主进程目前拿不到系统浏览器的 UA（该能力未实现，恒回空串）。
          // 空值绝不能覆盖上面算出来的干净 UA —— 那会让 webview 掉回带 Electron 标识的默认 UA。
          if (result.status.userAgent) setRuntimeBrowserUserAgent(result.status.userAgent)
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

  /**
   * 清除浏览数据（S-235）：清 HTTP + 字节码缓存，然后绕过缓存重载。
   *
   * `clearingRef` 才是防连点的闸，`clearing` 只负责让按钮转圈 —— `setClearing` 是异步的，
   * 同一帧内连点三下时后两次仍会读到旧 state。清缓存是异步 IO，放过去就是三次重载。
   */
  const clearingRef = useRef(false)
  const [clearing, setClearing] = useState(false)
  const handleClearCache = useCallback(async (): Promise<void> => {
    if (clearingRef.current) return
    const wv = webviewRef.current
    if (!isWebviewConnected(wv)) {
      toast.error(t('browser.clearCacheUnavailable'))
      return
    }

    clearingRef.current = true
    setClearing(true)
    try {
      const result = await clearBrowserCache(wv)
      if (result.ok) {
        toast.success(t('browser.clearCacheDone'))
      } else {
        toast.error(t('browser.clearCacheFailed', { error: result.error }))
      }
    } finally {
      clearingRef.current = false
      setClearing(false)
    }
  }, [t])

  // 「导航目标」与「页面当前地址」是两条独立的线：
  //   storedUrl  —— 页面当前地址（webview 事件回写，只用于显示与恢复）
  //   committedUrl —— 导航目标（只在明确指令下变化）
  // 站内跳转若也回写成导航目标，就会触发整页重载 —— nextCommittedUrl 负责挡住。
  const prevNavigationSeqRef = useRef(navigationSeq)
  const prevScopeRef = useRef({ sessionId, projectId })
  const prevReuseModeRef = useRef(runtimeBrowserUserDataReuseEnabled)

  useEffect(() => {
    const scopeChanged =
      prevScopeRef.current.sessionId !== sessionId || prevScopeRef.current.projectId !== projectId
    const reuseModeChanged = prevReuseModeRef.current !== runtimeBrowserUserDataReuseEnabled
    prevScopeRef.current = { sessionId, projectId }
    prevReuseModeRef.current = runtimeBrowserUserDataReuseEnabled

    const prevNavigationSeq = prevNavigationSeqRef.current
    prevNavigationSeqRef.current = navigationSeq

    setCommittedUrl((prev) =>
      nextCommittedUrl({
        prev,
        storedUrl,
        navigationSeq,
        prevNavigationSeq,
        scopeChanged,
        reuseModeChanged
      })
    )
    setInputUrl(storedUrl)
  }, [storedUrl, navigationSeq, sessionId, projectId, runtimeBrowserUserDataReuseEnabled])

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
    (rawUrl: string): void => {
      const normalized = normalizeBrowserUrl(rawUrl)
      if (!normalized) return
      setInputUrl(normalized)
      if (!canNavigateTo(normalized)) return
      setBrowserErrorInfo(null, sessionId, projectId)
      if (isSameBrowserUrl(normalized, storedUrl)) {
        // 同址再回车 ⇒ 显式重载（序号变但 committedUrl 不变，React 会 bail out）。
        // 与刷新按钮同一意图，同样走硬刷新（S-220）。
        runWebviewCommand('navigate', (wv) => wv.reloadIgnoringCache())
        return
      }
      requestBrowserNavigation(normalized, sessionId, projectId)
    },
    [
      canNavigateTo,
      projectId,
      requestBrowserNavigation,
      runWebviewCommand,
      sessionId,
      setBrowserErrorInfo,
      storedUrl
    ]
  )

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
    projectId,
    deviceMode,
    customViewport,
    desktopUserAgent: runtimeBrowserUserAgent,
    syncOnReady
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
    projectId,
    deviceMode,
    customViewport,
    desktopUserAgent: runtimeBrowserUserAgent,
    syncOnReady
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

    // dom-ready 每次导航都会触发：这里只补视口仿真，绝不 reload ——
    // 一旦在此 reload，就和「重新加载后的 dom-ready」互相激发，变成无限重载。
    const onDomReady = (): void => {
      latestRef.current.syncOnReady(wv)
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
    wv.addEventListener('dom-ready', onDomReady)

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
      wv.removeEventListener('dom-ready', onDomReady)
      // webview 重建后 guest 进程 id 会变，旧的在途占位必须清掉，防止 id 复用误命中
      forgetBrowserDeviceState(wv)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <BrowserToolbar
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        loading={loading}
        inputUrl={inputUrl}
        onInputChange={setInputUrl}
        onInputCommit={() => navigate(inputUrl)}
        onBack={() => runWebviewCommand('go back', (wv) => wv.goBack())}
        onForward={() => runWebviewCommand('go forward', (wv) => wv.goForward())}
        onStop={() => runWebviewCommand('stop loading', (wv) => wv.stop())}
        // 硬刷新：本地开发服务器常只给 Last-Modified、不给 Cache-Control，
        // reload() 走条件请求会停在 304，拿到的仍是旧版本（S-220）。刷新按钮的
        // 语义就是「我要最新的」，这里直接绕过缓存，并让服务器返回的新内容覆盖旧缓存。
        onReload={() => runWebviewCommand('refresh', (wv) => wv.reloadIgnoringCache())}
        onGo={() => navigate(inputUrl)}
        clearing={clearing}
        onClearCache={() => void handleClearCache()}
        deviceMode={deviceMode}
        customViewport={customViewport}
        onDeviceChange={(next) => {
          setBrowserDevice(next, sessionId, projectId)
          // 重复点同一设备：store 值没变 ⇒ hook 的 effect 不会触发，必须显式重放，
          // 否则「再点一次没反应」。
          if (
            next.mode === deviceMode &&
            (next.customViewport?.width ?? null) === (customViewport?.width ?? null) &&
            (next.customViewport?.height ?? null) === (customViewport?.height ?? null)
          ) {
            reapply()
          }
        }}
      />

      {/* Loading bar */}
      {loading && (
        <div className="h-0.5 w-full overflow-hidden bg-muted">
          <div className="h-full w-full animate-progress bg-primary/60" />
        </div>
      )}

      {/* Content */}
      <div className="relative min-h-0 flex-1">
        {committedUrl && (
          /* 必须常开：Chromium 的 PDF 查看器是插件式实现，plugins 关掉时 file:// 的 .pdf
             会被导航成一张空白页（无 embed、无标题），预览 PDF 就等于失败。
             原先只在「复用浏览器数据」模式下开，导致默认分区下 PDF 一律白屏。 */
          <webview
            key={runtimeBrowserUserDataReuseEnabled ? 'user-browser-profile' : 'wishfulclaw-profile'}
            ref={handleWebviewRef as React.Ref<Electron.WebviewTag>}
            src={committedUrl}
            className="size-full"
            {...webviewSessionProps}
            plugins={'true' as unknown as boolean}
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
                  // 加载失败常因缓存脏，重试同样绕缓存（S-220）。
                  runWebviewCommand('retry load', (wv) => wv.reloadIgnoringCache())
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
