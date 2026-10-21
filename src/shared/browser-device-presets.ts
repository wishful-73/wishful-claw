/**
 * 内置浏览器的设备预设表。
 *
 * 这里只放纯数据与纯函数：不依赖 Electron、不依赖 store、不依赖 DOM，
 * 因此渲染进程、主进程和单元测试可以共用同一份定义。
 */

export const BROWSER_DEVICE_MODES = ['pc', 'iphone', 'pixel', 'ipad', 'custom'] as const

export type BrowserDeviceMode = (typeof BROWSER_DEVICE_MODES)[number]

export const DEFAULT_BROWSER_DEVICE_MODE: BrowserDeviceMode = 'pc'

export const DEFAULT_CUSTOM_VIEWPORT = { width: 390, height: 844 } as const

export const CUSTOM_VIEWPORT_MIN = 320
export const CUSTOM_VIEWPORT_MAX = 2560

/** `custom` 模式的 DPR 固定值。不暴露给工具调用方。 */
export const CUSTOM_DEVICE_SCALE_FACTOR = 3

export interface BrowserDeviceViewport {
  width: number
  height: number
  deviceScaleFactor: number
  userAgent: string
}

const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

const IPAD_USER_AGENT =
  'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'

const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'

/**
 * 把宽/高规整到 [CUSTOM_VIEWPORT_MIN, CUSTOM_VIEWPORT_MAX] 的整数。
 * 非法值（0、负数、NaN、非数字）回落 fallback。
 */
export function normalizeViewportSide(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(CUSTOM_VIEWPORT_MAX, Math.max(CUSTOM_VIEWPORT_MIN, Math.round(parsed)))
}

export function isBrowserDeviceMode(value: unknown): value is BrowserDeviceMode {
  return typeof value === 'string' && (BROWSER_DEVICE_MODES as readonly string[]).includes(value)
}

/**
 * 解析某个设备模式对应的仿真视口。
 * `pc` 返回 null —— 表示「取消仿真、回到桌面形态」，不是缺省值。
 */
export function resolveBrowserDeviceViewport(
  mode: BrowserDeviceMode,
  custom?: { width?: number; height?: number } | null
): BrowserDeviceViewport | null {
  switch (mode) {
    case 'pc':
      return null
    case 'iphone':
      return { width: 390, height: 844, deviceScaleFactor: 3, userAgent: IOS_USER_AGENT }
    case 'pixel':
      return {
        width: 412,
        height: 915,
        deviceScaleFactor: 2.625,
        userAgent: ANDROID_USER_AGENT
      }
    case 'ipad':
      return { width: 820, height: 1180, deviceScaleFactor: 2, userAgent: IPAD_USER_AGENT }
    case 'custom':
      return {
        width: normalizeViewportSide(custom?.width, DEFAULT_CUSTOM_VIEWPORT.width),
        height: normalizeViewportSide(custom?.height, DEFAULT_CUSTOM_VIEWPORT.height),
        deviceScaleFactor: CUSTOM_DEVICE_SCALE_FACTOR,
        userAgent: IOS_USER_AGENT
      }
    default:
      return null
  }
}

/**
 * 去重键。由**夹取后**的视口派生，保证「传 99999 宽的 custom」与
 * 「传 2560 宽的 custom」得到同一个键 —— 它们实际生效的值相同。
 */
export function browserDeviceKey(
  mode: BrowserDeviceMode,
  custom?: { width?: number; height?: number } | null
): string {
  const viewport = resolveBrowserDeviceViewport(mode, custom)
  return viewport ? `${mode}:${viewport.width}x${viewport.height}` : mode
}
