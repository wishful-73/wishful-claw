/**
 * 快速启动器的共享类型。
 *
 * S-249 从 `quick-launcher.ts`（2205 行）搬出。原文件里这些接口都是文件内私有，
 * 拆开后必须跨文件可见，故一并 export —— **只加可见性，字段一字未改**。
 */

import type { EverythingExeSource } from '../lib/everything-search'
import type { EsCategory, EsExeSource, EsFailure, EsSort, FileHit } from '../lib/es-search'

export interface AppShortcut {
  name: string
  path: string
  iconDataUrl?: string
  pinyinFull?: string
  pinyinInitials?: string
  /** Lowercased word/camel initials, e.g. "Wishful Claw" / "wishfulClaw" → "wc". */
  initials?: string
  /** Name with separators removed, lowercased, e.g. "Wishful Claw" → "wishfulclaw". */
  compact?: string
  isHistory?: boolean
  /** System settings/tools entry — renderer shows a "系统" badge. */
  isSystem?: boolean
  /** Pre-extracted icon file (PNG on disk) — used when the path itself
   * can't be resolved by app.getFileIcon (e.g. shell:AppsFolder\...). */
  iconFile?: string
}

export interface CustomApp {
  name: string
  path: string
}

export interface UwpApp {
  name: string
  appId: string
  /** Absolute path of the icon PNG extracted during the scan (may be missing). */
  iconPath?: string
}

export interface UwpCacheFile {
  /** Bump to force a rescan of stale caches written by older builds. */
  version: number
  time: number
  apps: UwpApp[]
}

export interface LauncherConfig {
  enabled: boolean
  accelerators: string[]
  customApps: CustomApp[]
  launchHistory: CustomApp[]
  /** S-151：用户手动指定的 Everything.exe。空串 = 未指定，走自动探测。 */
  everythingExePath: string
  /**
   * S-151 二轮：`everythingExePath` 是「本机检测」自动绑定的（true）还是用户手选的（false）。
   *
   * 两者占同一个槽位（用户手选永远最高优先级），只在设置页文案上区分 —— 不然自动绑上的路径
   * 会被标成「手动指定」，用户看着莫名其妙。
   */
  everythingExePathAuto: boolean
  /**
   * S-155：取数用的 es.exe。空串 = 未指定，走自动探测（Everything 同目录 / 常见安装位 / PATH）。
   *
   * 与 `everythingExePath` 是两个槽位 —— 一个指 GUI 本体（索引靠它跑），一个指命令行版
   * （取数靠它），两者可以只有一个存在。
   */
  esExePath: string
  /** S-155：`esExePath` 是「本机检测」自动绑定的（true）还是用户手选的（false）。 */
  esExePathAuto: boolean
}

export interface ScoredApp {
  item: AppShortcut
  score: number
}

export interface EverythingStatus {
  /** 平台是否支持（本需求只做 Windows）。 */
  supported: boolean
  /** 探到了可用的 Everything.exe。 */
  ready: boolean
  exePath: string | null
  source: EverythingExeSource | null
  /** exePath 是「本机检测」自动绑定的 —— 设置页文案要跟「手动指定」分开，不然用户看着莫名其妙。 */
  detected: boolean
}

export interface EsStatus {
  /** 平台是否支持（本需求只做 Windows）。 */
  supported: boolean
  /** 探到了可用的 es.exe。 */
  ready: boolean
  exePath: string | null
  source: EsExeSource | null
  /** exePath 是「本机检测」自动绑定的 —— 设置页文案要跟「手动指定」分开。 */
  detected: boolean
}

/** 取数结果。`ok: true` + 空 `hits` = **成功但没搜到**（不是失败）。 */
export interface EsSearchResult {
  ok: boolean
  hits: FileHit[]
  failure?: EsFailure
  error?: string
}

/**
 * 一次取数的入参（都来自渲染端，逐项当不可信数据看）。
 *
 * 与 `EsQueryOptions` 的区别：那边是纯函数层要的（已经归一化），这边是 IPC 边界上的原始值，
 * 所以一律给宽松类型 —— 越界值由纯函数层夹紧，第一道 `typeof` 判在这里。
 */
export interface EsQueryRequest {
  keyword?: string
  category?: EsCategory
  sort?: EsSort
  offset?: number
  pageSize?: number
}
