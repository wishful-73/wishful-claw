/**
 * 快速启动器的配置持久化与数据目录落点。
 *
 * S-249 从 `quick-launcher.ts` 搬出。`config` 是模块级可变变量（IPC 的 update-config 会整体替换它），
 * 所以对外只给两个访问器：`getConfig()` 拿引用（调用方原地 push/unshift 的写法一字不变），
 * `setConfig()` 供整体替换。这层访问器是拆分必需的 —— 不搬它就没法让 app-list / 探测 / IPC 同时看见配置。
 */

import { join } from 'path'
import * as fs from 'fs'
import { resolveDataDir } from '../lib/data-dir'
import type { LauncherConfig } from './types'

export const DATA_DIR = resolveDataDir()
export const CONFIG_FILE = join(DATA_DIR, 'launcher-config.json')
export const UWP_CACHE_FILE = join(DATA_DIR, 'uwp-apps.json')
export const UWP_ICON_DIR = join(DATA_DIR, 'uwp-icons')

export const DEFAULT_CONFIG: LauncherConfig = {
  enabled: true,
  accelerators: ['Alt+Space'],
  customApps: [],
  launchHistory: [],
  everythingExePath: '',
  everythingExePathAuto: false,
  esExePath: '',
  esExePathAuto: false
}

let config: LauncherConfig

export function getConfig(): LauncherConfig {
  return config
}

export function setConfig(next: LauncherConfig): void {
  config = next
}

export function loadConfig(): LauncherConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, 'utf8')
      const parsed = JSON.parse(raw)
      // Migrate old single accelerator to array
      let accelerators = DEFAULT_CONFIG.accelerators
      if (Array.isArray(parsed.accelerators)) {
        accelerators = parsed.accelerators.filter((value: unknown): value is string => typeof value === 'string')
        accelerators = accelerators.filter((value, index) => accelerators.indexOf(value) === index)
      } else if (typeof parsed.accelerator === 'string') {
        accelerators = [parsed.accelerator]
      }
      return {
        enabled: parsed.enabled ?? DEFAULT_CONFIG.enabled,
        accelerators: accelerators.length > 0 ? accelerators : DEFAULT_CONFIG.accelerators,
        customApps: Array.isArray(parsed.customApps) ? parsed.customApps : [],
        launchHistory: Array.isArray(parsed.launchHistory) ? parsed.launchHistory : [],
        everythingExePath:
          typeof parsed.everythingExePath === 'string' ? parsed.everythingExePath : DEFAULT_CONFIG.everythingExePath,
        everythingExePathAuto: parsed.everythingExePathAuto === true,
        esExePath: typeof parsed.esExePath === 'string' ? parsed.esExePath : DEFAULT_CONFIG.esExePath,
        esExePathAuto: parsed.esExePathAuto === true
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_CONFIG }
}

export function saveConfig(): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 })
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), {
      encoding: 'utf8',
      mode: 0o600
    })
  } catch {
    // ignore
  }
}
