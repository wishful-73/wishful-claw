/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

export const BUILTIN_BROWSER_PARTITION = 'persist:wishfulclaw-browser'
export const BROWSER_SETTINGS_STORAGE_KEY = 'wishfulclaw-settings'
export const BROWSER_USER_DATA_REUSE_SETTING_KEY = 'browserUserDataReuseEnabled'
export const BROWSER_USER_DATA_SOURCE_SETTING_KEY = 'browserUserDataSource'

export const BROWSER_USER_DATA_SOURCES = ['auto', 'chrome', 'edge', 'brave', 'chromium'] as const
export type BrowserUserDataSource = (typeof BROWSER_USER_DATA_SOURCES)[number]
export type ConcreteBrowserUserDataSource = Exclude<BrowserUserDataSource, 'auto'>
export const DEFAULT_BROWSER_USER_DATA_SOURCE: BrowserUserDataSource = 'auto'

export function isBrowserUserDataReuseEnabled(value: unknown): boolean {
  return value !== false
}

export function normalizeBrowserUserDataSource(value: unknown): BrowserUserDataSource {
  return BROWSER_USER_DATA_SOURCES.includes(value as BrowserUserDataSource)
    ? (value as BrowserUserDataSource)
    : DEFAULT_BROWSER_USER_DATA_SOURCE
}

/**
 * 把 Electron 外壳的 UA 洗成一个普通 Chromium UA。
 *
 * Electron 的默认 UA 形如：
 *   Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) wishful-claw/0.2.29 Chrome/142.0.0.0 Electron/43.2.0 Safari/537.36
 * 其中 `<应用名>/<版本>` 与 `Electron/<版本>` 两个 token 会暴露外壳身份，站点据此判定「非标准客户端」并拒绝登录。
 *
 * 只删这两个 token 不保险：应用名会随打包改名，也可能残留其它自定义 token。
 * 因此改为按「平台 + 真实 Chrome 版本」重建 —— 对外只有一个标准 Chromium 的身份，且版本号是真的。
 */
export function stripElectronFromUserAgent(userAgent: string): string {
  const platform = /\(([^)]*)\)/.exec(userAgent)?.[1]
  const chromeVersion = /Chrome\/([\d.]+)/.exec(userAgent)?.[1]
  if (platform && chromeVersion) {
    return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  }
  // 兜底：非 Chromium 内核（正常不该走到）。至少别原样把 Electron token 带出去。
  return userAgent
    .replace(/\sElectron\/[^\s]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}
