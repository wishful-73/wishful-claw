/**
 * 合并应用列表：历史 → 自定义 → 开始菜单 → AppsFolder → 系统设置，再算匹配变体、取图标、打分排序。
 *
 * S-249 从 `quick-launcher.ts` 搬出。相对原文件的改动只有三处，都是拆分必需的机械替换：
 * `config.` → `getConfig().`；`appListCache` 的读写改走 `cache.ts` 的访问器（合并结果先落局部变量再回写槽）；
 * 三个对外函数补 `export`。打分权重、去重顺序、缓存时长一个字未动。
 */

import { app, shell } from 'electron'
import * as fs from 'fs'
import { pinyin } from 'pinyin-pro'
import { WINDOWS_SETTINGS } from '../launcher-system-settings'
import { extractPeIcon } from '../pe-icon-extractor'
import { getAppListCache, setAppListCache } from './cache'
import { getConfig } from './config'
import { CACHE_TTL_MS, SYS_CMD_PREFIX } from './constants'
import {
  computeInitials,
  isAppsFolderPath,
  isSystemCommandPath,
  resolveTargetKey,
  scanStartMenuApps
} from './app-scan'
import { loadUwpApps } from './uwp'
import type { AppShortcut, ScoredApp } from './types'

let cacheTime = 0
const iconCache = new Map<string, string | null>()

export function getOrRefreshAppList(): AppShortcut[] {
  const now = Date.now()
  const cached = getAppListCache()
  if (cached && now - cacheTime < CACHE_TTL_MS) {
    return cached
  }

  const historyEntries: AppShortcut[] = []
  const rest: AppShortcut[] = []
  const seenNames = new Set<string>()
  const seenTargets = new Set<string>()

  // Push into the given bucket with name + real-target dedupe. History entries
  // go first so the same app registered elsewhere (different display name but
  // same .lnk target) keeps its history slot and priority.
  const push = (bucket: AppShortcut[], entry: AppShortcut, isHistory: boolean): void => {
    const nameKey = entry.name.toLowerCase()
    if (seenNames.has(nameKey)) return
    const targetKey = resolveTargetKey(entry.path)
    if (seenTargets.has(targetKey)) return
    seenNames.add(nameKey)
    seenTargets.add(targetKey)
    bucket.push({ ...entry, isHistory })
  }

  // 1) Launch history first (user-launched apps should lead search results)
  for (const hist of getConfig().launchHistory) {
    if (fs.existsSync(hist.path) || isAppsFolderPath(hist.path) || isSystemCommandPath(hist.path)) {
      push(historyEntries, { name: hist.name, path: hist.path }, true)
    }
  }

  // 2) Custom apps
  for (const custom of getConfig().customApps) {
    if (fs.existsSync(custom.path)) {
      push(rest, { name: custom.name, path: custom.path }, false)
    }
  }

  // 3) Start Menu .lnk shortcuts
  for (const shortcut of scanStartMenuApps()) {
    push(rest, shortcut, false)
  }

  // 4) AppsFolder entries (UWP + registered desktop apps; 便签 etc. have no
  // .lnk in Start Menu). Path-like ids are plain executables — keep the raw
  // path so they dedupe against Start Menu .lnk targets.
  const uwpApps = loadUwpApps()
  const uwpIconByPath = new Map<string, string>()
  for (const uwp of uwpApps) {
    const path = /^[a-z]:\\/i.test(uwp.appId) ? uwp.appId : `shell:AppsFolder\\${uwp.appId}`
    if (uwp.iconPath) uwpIconByPath.set(path, uwp.iconPath)
    push(rest, { name: uwp.name, path, iconFile: uwp.iconPath }, false)
  }

  // 5) Windows system settings & tools (ported from ZTools)
  for (const setting of WINDOWS_SETTINGS) {
    const entry: AppShortcut = { name: setting.name, path: SYS_CMD_PREFIX + setting.command, isSystem: true }
    push(rest, entry, false)
  }

  // Pre-compute matching variants (initials / compact form for all entries,
  // pinyin only for Chinese names). History entries pointing at an AppsFolder
  // app inherit the icon extracted during the UWP scan.
  for (const s of [...historyEntries, ...rest]) {
    if (!s.iconFile) {
      const iconFile = uwpIconByPath.get(s.path)
      if (iconFile) s.iconFile = iconFile
    }
    if (!s.initials) s.initials = computeInitials(s.name)
    if (!s.compact) s.compact = s.name.replace(/[\s\-_.]+/g, '').toLowerCase()
    if (!s.pinyinFull && /[\u4e00-\u9fff]/.test(s.name)) {
      s.pinyinFull = pinyin(s.name, { toneType: 'none', type: 'array' }).join('')
      s.pinyinInitials = pinyin(s.name, { toneType: 'none', pattern: 'first', type: 'array' }).join('')
    }
  }

  rest.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  const merged = [...historyEntries, ...rest]
  setAppListCache(merged)
  cacheTime = now
  return merged
}

export async function withIcon(appShortcut: AppShortcut): Promise<AppShortcut> {
  if (iconCache.has(appShortcut.path)) {
    return { ...appShortcut, iconDataUrl: iconCache.get(appShortcut.path) ?? undefined }
  }

  try {
    // Pre-extracted icon PNG (AppsFolder entries): read the image content
    // directly — app.getFileIcon only extracts the *associated* icon of a
    // file, which for a .png is the generic image-file icon, not the bitmap.
    let pngPath: string | undefined
    if (appShortcut.iconFile && fs.existsSync(appShortcut.iconFile)) {
      pngPath = appShortcut.iconFile
    } else if (isAppsFolderPath(appShortcut.path)) {
      // History entries may not carry iconFile — look it up in the UWP cache.
      pngPath = loadUwpApps().find(
        (u) =>
          u.iconPath &&
          !/^[a-z]:\\/i.test(u.appId) &&
          `shell:AppsFolder\\${u.appId}` === appShortcut.path &&
          fs.existsSync(u.iconPath)
      )?.iconPath
    }
    if (pngPath) {
      const dataUrl = `data:image/png;base64,${fs.readFileSync(pngPath).toString('base64')}`
      iconCache.set(appShortcut.path, dataUrl)
      return { ...appShortcut, iconDataUrl: dataUrl }
    }

    let iconSource = appShortcut.path
    if (appShortcut.path.toLowerCase().endsWith('.lnk')) {
      // For .lnk files, resolve the target EXE and extract its icon for better quality
      try {
        const details = shell.readShortcutLink(appShortcut.path)
        if (details.target && fs.existsSync(details.target)) {
          iconSource = details.target
        }
      } catch {
        // Fall back to the .lnk itself
      }
    }

    // Electron's getFileIcon (IImageList::GetIcon) cannot render PNG-compressed
    // icon entries — every electron-builder exe (all Electron apps) hits this
    // and gets the generic default icon. Parse the PE resource section first
    // and fall back to getFileIcon for everything else.
    if (/\.exe$/i.test(iconSource)) {
      const peIcon = extractPeIcon(iconSource)
      if (peIcon) {
        iconCache.set(appShortcut.path, peIcon)
        return { ...appShortcut, iconDataUrl: peIcon }
      }
    }

    const icon = await app.getFileIcon(iconSource, { size: 'normal' })
    const iconDataUrl = icon.isEmpty() ? null : icon.toDataURL()
    iconCache.set(appShortcut.path, iconDataUrl)
    return { ...appShortcut, iconDataUrl: iconDataUrl ?? undefined }
  } catch {
    iconCache.set(appShortcut.path, null)
    return appShortcut
  }
}

export async function searchApps(query: string): Promise<AppShortcut[]> {
  const normalizedQuery = query.trim().toLowerCase()
  if (normalizedQuery.length === 0) return []
  const apps = getOrRefreshAppList()

  const scored: ScoredApp[] = []
  for (const item of apps) {
    const name = item.name.toLowerCase()
    let score = -1
    if (name === normalizedQuery) {
      score = 100
    } else if (name.startsWith(normalizedQuery)) {
      score = 90
    } else if (item.pinyinFull && item.pinyinFull.toLowerCase().startsWith(normalizedQuery)) {
      score = 88
    } else if (item.pinyinInitials && item.pinyinInitials.toLowerCase().startsWith(normalizedQuery)) {
      score = 86
    } else if (item.initials === normalizedQuery || item.compact === normalizedQuery) {
      // Full initials/compact hit ("gc" === Google Chrome's initials) must beat
      // a substring landing somewhere mid-name.
      score = 85
    } else {
      const position = name.indexOf(normalizedQuery)
      if (position >= 0) {
        score = 80 - Math.min(position, 30)
      } else if (item.compact && item.compact.includes(normalizedQuery)) {
        score = 75
      } else if (item.initials && item.initials.includes(normalizedQuery)) {
        score = 70
      } else if (item.pinyinFull && item.pinyinFull.toLowerCase().includes(normalizedQuery)) {
        score = 60
      } else if (item.pinyinInitials && item.pinyinInitials.toLowerCase().includes(normalizedQuery)) {
        score = 58
      }
    }
    if (score < 0) continue
    // History entries always lead, then by match quality.
    if (item.isHistory) score += 1000
    scored.push({ item, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return Promise.all(scored.slice(0, 50).map((entry) => withIcon(entry.item)))
}