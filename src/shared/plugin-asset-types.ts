/*
 * 插件资产的共享契约（S-242）。
 *
 * 主进程与渲染端都要知道「这个资产现在什么状态」，所以类型放这里 —— 渲染端
 * 直接 import 主进程的 `plugin-assets.ts` 会把 fs / crypto 拖进 web 构建。
 *
 * 目录表里的 `urls` 与 `sha256` **不进这个文件**：渲染端不需要知道文件从哪下、
 * 哈希是多少，它只需要展示「多大、叫什么、什么状态」。把地址交给渲染进程等于
 * 给它一条绕过主进程直接下载的路径。
 */

export type PluginAssetState =
  | 'unknown'
  | 'absent'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'failed'

/** 渲染端可见的资产元信息（目录表投影，去掉 url / sha256）。 */
export interface PluginAssetPublicInfo {
  id: string
  /** 用户看到的名字。 */
  name: string
  /** 一句话用途 —— 下载前必须让用户知道自己在下什么。 */
  desc: string
  kind: 'binary' | 'model' | 'data'
  /** 字节。用户点下载之前必须看到这个数。 */
  size: number
}

export interface PluginAssetStatus {
  id: string
  state: PluginAssetState
  /** 目录表里的展示名；未知 id 时缺省。 */
  name?: string
  /** 目录表里的体积（字节）。 */
  size?: number
  /** 磁盘上已收到的字节（含 `.part`）。 */
  receivedBytes: number
  /** 就绪时的绝对路径。 */
  path?: string
  error?: string
}

export interface PluginAssetProgressEvent {
  id: string
  state: PluginAssetState
  receivedBytes: number
  totalBytes: number
  /** 0 ~ 1。 */
  percent: number
  error?: string
}

/** 「489 MB」这种给人看的体积。目录表存字节，展示时换算。 */
export function formatAssetSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  // 小于 10 的留一位小数（4.7 MB），大了取整（489 MB）—— 用户不需要三位精度
  const rounded = value < 10 && unitIndex > 0 ? value.toFixed(1) : String(Math.round(value))
  return `${rounded} ${units[unitIndex]}`
}
