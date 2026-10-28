/**
 * 优先快捷键的共享类型。
 *
 * S-249 从 `priority-shortcuts.ts` 搬出 —— 原来 `ShortcutRegistration` / `BridgeMessage` 是文件内
 * 私有接口，拆成三个文件后必须跨文件可见，故一并 export（**只加可见性，结构一字未改**）。
 */

export interface ShortcutRect {
  x: number
  y: number
  width: number
  height: number
}

export interface ShortcutPoint {
  x: number
  y: number
}

export interface ShortcutContext {
  foregroundWindow: string | null
  focusWindow: string | null
  foregroundWindowRect: ShortcutRect | null
  focusWindowRect: ShortcutRect | null
  caretRect: ShortcutRect | null
  mousePoint: ShortcutPoint | null
}

export interface ShortcutRegistration {
  accelerator: string
  callback: (context: ShortcutContext) => void
}

export interface BridgeMessage {
  type?: string
  id?: string
  foregroundWindow?: string
  focusWindow?: string
  foregroundWindowRect?: ShortcutRect | null
  focusWindowRect?: ShortcutRect | null
  caretRect?: ShortcutRect | null
  mousePoint?: ShortcutPoint | null
}
