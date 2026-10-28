/**
 * 开始菜单 / 桌面 .lnk 扫描，以及系统设置条目的启动。
 *
 * S-249 从 `quick-launcher.ts` 搬出，整段原样平移。相对原文件唯一的变化是函数前的 `export`
 * （原来同文件内调用无需导出，拆开后 IPC 层与 app-list 都要用）。
 */

import { app, shell } from 'electron'
import { spawn } from 'child_process'
import { join } from 'path'
import * as fs from 'fs'
import { pinyin } from 'pinyin-pro'
import { SKIP_FOLDERS, SKIP_NAME_PATTERN, SYS_CMD_PREFIX } from './constants'
import type { AppShortcut } from './types'

/** Scan Windows Start Menu directories for .lnk shortcut files. */
export function scanStartMenuApps(): AppShortcut[] {
  const homeDir = app.getPath('home')
  const programs = [
    join(homeDir, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs'
  ]
  // Desktop shortcuts are a common launch source too; scan them flat (no
  // recursion into folders placed on the desktop).
  const desktops = [app.getPath('desktop'), 'C:\\Users\\Public\\Desktop']

  const shortcuts: AppShortcut[] = []
  const seen = new Set<string>()

  for (const dir of programs) {
    if (!fs.existsSync(dir)) continue
    walkLnkFiles(dir, shortcuts, seen, true)
  }
  for (const dir of desktops) {
    if (!fs.existsSync(dir)) continue
    walkLnkFiles(dir, shortcuts, seen, false)
  }

  shortcuts.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

  // Pre-compute pinyin for Chinese names
  for (const s of shortcuts) {
    if (/[\u4e00-\u9fff]/.test(s.name)) {
      const full = pinyin(s.name, { toneType: 'none', type: 'array' }).join('')
      const initials = pinyin(s.name, { toneType: 'none', pattern: 'first', type: 'array' }).join('')
      s.pinyinFull = full
      s.pinyinInitials = initials
    }
  }

  return shortcuts
}

export function walkLnkFiles(dir: string, results: AppShortcut[], seen: Set<string>, recursive: boolean): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (!recursive) continue
      if (SKIP_FOLDERS.includes(entry.name.toLowerCase())) continue
      walkLnkFiles(fullPath, results, seen, recursive)
    } else if (entry.name.toLowerCase().endsWith('.lnk')) {
      const name = entry.name.replace(/\.lnk$/i, '')
      if (SKIP_NAME_PATTERN.test(name)) continue
      const key = name.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      results.push({ name, path: fullPath })
    }
  }
}

/** Resolve the real target of an entry (.lnk → its target exe) as a dedupe key. */
export function resolveTargetKey(path: string): string {
  if (path.toLowerCase().endsWith('.lnk')) {
    try {
      const details = shell.readShortcutLink(path)
      if (details.target) return details.target.toLowerCase()
    } catch {
      // fall through to the .lnk path itself
    }
  }
  return path.toLowerCase()
}

export function isAppsFolderPath(path: string): boolean {
  return path.toLowerCase().startsWith('shell:appsfolder')
}

/** spawn with an error listener — without one, ENOENT etc. throw uncaught. */
export function spawnHidden(command: string, args: string[]): void {
  const child = spawn(command, args, { windowsHide: true })
  child.on('error', (err) => {
    console.warn(`[QuickLauncher] Failed to spawn ${command}: ${err.message}`)
  })
}

export function isSystemCommandPath(path: string): boolean {
  return path.startsWith(SYS_CMD_PREFIX)
}

/** Launch a system settings/tools command (ms-settings URI, exe, .cpl/.msc
 * or rundll32-style command line). */
export function launchSystemCommand(command: string): void {
  if (command.startsWith('ms-settings')) {
    void shell.openExternal(command)
    return
  }
  if (command.toLowerCase().startsWith('shell:')) {
    spawnHidden('explorer.exe', [command])
    return
  }
  const space = command.indexOf(' ')
  if (space > 0) {
    // Command line with arguments (rundll32 sysdm.cpl,..., control.exe keyboard)
    spawnHidden(command.slice(0, space), [command.slice(space + 1)])
    return
  }
  const lower = command.toLowerCase()
  if (lower.endsWith('.msc')) {
    spawnHidden('mmc.exe', [command])
    return
  }
  if (lower.endsWith('.cpl')) {
    spawnHidden('control.exe', [command])
    return
  }
  shell.openPath(command)
}

/**
 * Word-initial / camelCase initials (utools-style): collect the character at
 * every word start — after a separator or at a camelCase boundary — lowercased.
 * e.g. "Wishful Claw" / "wishfulClaw" / "WeChat" → "wc".
 */
export function computeInitials(name: string): string {
  let initials = ''
  let prev = ' '
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]
    const isBoundary =
      i === 0 ||
      prev === ' ' || prev === '-' || prev === '_' || prev === '.' ||
      (/[a-z\u4e00-\u9fff]/.test(prev) && /[A-Z]/.test(ch))
    if (isBoundary) initials += ch
    prev = ch
  }
  return initials.toLowerCase()
}