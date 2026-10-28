/**
 * 优先快捷键的注册表与 globalShortcut 兜底。
 *
 * S-249 从 `priority-shortcuts.ts` 搬出。这里只管「谁注册了哪个加速键」，不碰桥接进程 ——
 * 依赖方向是单向的：`bridge.ts` 与本模块的调用方都往这里看，本模块不反过来 import 它们。
 */

import { globalShortcut } from 'electron'
import type { ShortcutRegistration } from './types'

export const registrations = new Map<string, ShortcutRegistration>()
export const fallbackAccelerators = new Map<string, string>()

export function normalizeAccelerator(accelerator: string): string {
  return accelerator.split('+').map((part) => part.trim().toLowerCase()).sort().join('+')
}

export function getWinningRegistrations(): Array<{ id: string; accelerator: string }> {
  const winners = new Map<string, { id: string; accelerator: string }>()
  for (const [id, registration] of registrations) {
    winners.set(normalizeAccelerator(registration.accelerator), { id, accelerator: registration.accelerator })
  }
  return [...winners.values()]
}

export function registerAllFallbacks(): void {
  for (const [id, registration] of registrations) {
    registerFallback(id, registration)
  }
}

export function unregisterAllFallbacks(): void {
  for (const [id, accelerator] of fallbackAccelerators) {
    globalShortcut.unregister(accelerator)
    fallbackAccelerators.delete(id)
  }
}

export function registerFallback(id: string, registration: ShortcutRegistration): boolean {
  const oldAccelerator = fallbackAccelerators.get(id)
  if (oldAccelerator) globalShortcut.unregister(oldAccelerator)
  const registered = globalShortcut.register(registration.accelerator, () => {
    registration.callback({
      foregroundWindow: null,
      focusWindow: null,
      foregroundWindowRect: null,
      focusWindowRect: null,
      caretRect: null,
      mousePoint: null
    })
  })
  if (registered) fallbackAccelerators.set(id, registration.accelerator)
  else fallbackAccelerators.delete(id)
  return registered
}
