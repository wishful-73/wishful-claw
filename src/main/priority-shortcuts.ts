/**
 * 优先快捷键（全局热键）入口。
 *
 * Windows 上走 PowerShell + C# 的 SetWindowsHookEx 桥接进程拿真实前台窗口与光标位置，
 * 桥接挂了才退回 Electron 的 globalShortcut（此时拿不到上下文，回调里全是 null）。
 *
 * 文件组织（S-249 拆分，原 889 行单文件 → 四个文件，对外导出与前缀路径全部不变）：
 *   - `priority-shortcuts/types.ts`                —— 共享类型
 *   - `priority-shortcuts/registry.ts`             —— 注册表与 globalShortcut 兜底
 *   - `priority-shortcuts/bridge.ts`               —— 桥接进程起停与消息泵
 *   - `priority-hotkey-bridge-script.ts`           —— 内嵌脚本常量（第 5 条第 1 类豁免）
 */

import { globalShortcut, type BrowserWindow } from 'electron'
import { closeBridge, ensureWindowsBridge, sendToBridge, syncBridge } from './priority-shortcuts/bridge'
import { fallbackAccelerators, registerFallback, registrations } from './priority-shortcuts/registry'
import type { ShortcutContext } from './priority-shortcuts/types'

export type { ShortcutContext, ShortcutPoint, ShortcutRect } from './priority-shortcuts/types'

export function registerPriorityShortcut(
  id: string,
  accelerator: string,
  callback: (context: ShortcutContext) => void
): boolean {
  registrations.delete(id)
  const registration = { accelerator, callback }
  registrations.set(id, registration)
  if (process.platform === 'win32') {
    if (ensureWindowsBridge()) {
      syncBridge()
      return true
    }
  }
  return registerFallback(id, registration)
}

export function unregisterPriorityShortcut(id: string): void {
  registrations.delete(id)
  const fallbackAccelerator = fallbackAccelerators.get(id)
  if (fallbackAccelerator) {
    globalShortcut.unregister(fallbackAccelerator)
    fallbackAccelerators.delete(id)
  }
  if (process.platform === 'win32') {
    syncBridge()
    if (registrations.size === 0) {
      closeBridge()
    }
  }
}

export function pasteToForegroundWindow(foregroundWindow: string | null, focusWindow: string | null = null, injectKeys = true, clearMenu = false): boolean {
  if (process.platform !== 'win32' || !foregroundWindow || foregroundWindow === '0') return false
  ensureWindowsBridge()
  return sendToBridge({ type: 'paste', foregroundWindow, focusWindow: focusWindow ?? '0', inject: injectKeys, clearMenu })
}

/**
 * Force-activate one of our own windows (quick launcher) even when another
 * process owns the Windows foreground. Uses the PowerShell bridge's
 * EnsureForeground chain (foreground-lock timeout reset + Alt workaround) —
 * plain win.show()/win.focus() loses that race once the launched app or an
 * agent window holds the foreground.
 */
export function forceActivateWindow(win: BrowserWindow): boolean {
  if (process.platform !== 'win32') {
    win.show()
    win.focus()
    return true
  }
  const hwnd = win.getNativeWindowHandle().readBigInt64LE()
  if (!ensureWindowsBridge()) return false
  return sendToBridge({ type: 'activate-self', window: hwnd.toString() })
}
