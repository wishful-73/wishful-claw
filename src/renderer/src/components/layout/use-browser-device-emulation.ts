import { useCallback, useEffect, useRef } from 'react'
import type { BrowserDeviceMode } from '@shared/browser-device-presets'
import {
  applyBrowserDevice,
  syncBrowserDeviceEmulation
} from '@renderer/lib/browser/apply-browser-device'

export interface UseBrowserDeviceEmulationOptions {
  webviewRef: React.MutableRefObject<Electron.WebviewTag | null>
  mode: BrowserDeviceMode
  customViewport: { width: number; height: number } | null
  desktopUserAgent: string
}

export interface BrowserDeviceEmulationApi {
  /** 挂到 handleWebviewRef 的 dom-ready：只补仿真，不 reload */
  syncOnReady: (webview: Electron.WebviewTag) => void
  /** 用户重复点同一设备时手动重放 */
  reapply: () => void
}

export function useBrowserDeviceEmulation(
  options: UseBrowserDeviceEmulationOptions
): BrowserDeviceEmulationApi {
  const { webviewRef, mode, customViewport, desktopUserAgent } = options

  // 每次渲染同步刷新，供 dom-ready 回调读最新值（回调本身引用稳定）
  const latestRef = useRef({ mode, customViewport, desktopUserAgent })
  latestRef.current = { mode, customViewport, desktopUserAgent }

  const previousRef = useRef<{
    mode: BrowserDeviceMode
    width: number | null
    height: number | null
  } | null>(null)

  const syncOnReady = useRef((webview: Electron.WebviewTag): void => {
    const latest = latestRef.current
    void syncBrowserDeviceEmulation({
      webview,
      mode: latest.mode,
      customViewport: latest.customViewport
    })
  }).current

  const reapply = useCallback((): void => {
    const webview = webviewRef.current
    if (!webview) return
    const latest = latestRef.current
    void applyBrowserDevice({
      webview,
      mode: latest.mode,
      customViewport: latest.customViewport,
      desktopUserAgent: latest.desktopUserAgent
    })
  }, [webviewRef])

  useEffect(() => {
    const previous = previousRef.current
    previousRef.current = {
      mode,
      width: customViewport?.width ?? null,
      height: customViewport?.height ?? null
    }
    // 首帧只记基线，不触发（否则面板一挂载就白 reload 一次）
    if (!previous) return
    if (
      previous.mode === mode &&
      previous.width === (customViewport?.width ?? null) &&
      previous.height === (customViewport?.height ?? null)
    ) {
      return
    }
    reapply()
  }, [mode, customViewport, reapply])

  return { syncOnReady, reapply }
}
