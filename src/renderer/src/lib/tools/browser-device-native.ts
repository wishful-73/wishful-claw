import {
  DEFAULT_CUSTOM_VIEWPORT,
  isBrowserDeviceMode,
  normalizeViewportSide
} from '@shared/browser-device-presets'
import { stripElectronFromUserAgent } from '@shared/browser-plugin'
import { useUIStore } from '@renderer/stores/ui-store'
import { applyBrowserDevice } from '@renderer/lib/browser/apply-browser-device'
import { encodeStructuredToolResult } from './tool-result-format'
import { getWebview } from './browser-webview-helpers'
import type { ToolContext } from './tool-types'

/**
 * agent 侧的设备切换入口。
 *
 * 先写 store 意图，再尝试当场应用：面板没挂载时也不能丢请求 ——
 * 下次挂载的 dom-ready 会按 store 里的设备补仿真。
 */
export async function executeBrowserSetDevice(
  input: unknown,
  ctx: ToolContext
): Promise<string> {
  const args = (input ?? {}) as { device?: unknown; width?: unknown; height?: unknown }
  if (!isBrowserDeviceMode(args.device)) {
    return encodeStructuredToolResult({
      success: false,
      error: `未知设备：${String(args.device)}`
    })
  }

  const mode = args.device
  const customViewport =
    mode === 'custom'
      ? {
          width: normalizeViewportSide(args.width, DEFAULT_CUSTOM_VIEWPORT.width),
          height: normalizeViewportSide(args.height, DEFAULT_CUSTOM_VIEWPORT.height)
        }
      : null

  useUIStore.getState().setBrowserDevice({ mode, customViewport }, ctx.sessionId)

  const webview = getWebview(ctx)
  if (!webview) {
    return encodeStructuredToolResult({
      success: true,
      device: mode,
      viewport: null,
      note: '已记录设备设置，浏览器面板打开后自动生效'
    })
  }

  const applied = await applyBrowserDevice({
    webview,
    mode,
    customViewport,
    desktopUserAgent: stripElectronFromUserAgent(navigator.userAgent)
  })

  return encodeStructuredToolResult(
    applied.ok
      ? { success: true, device: mode, viewport: applied.viewport }
      : { success: false, error: applied.error }
  )
}
