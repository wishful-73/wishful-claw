/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

export type ExtensionToolKind = 'http' | 'js'
export type ExtensionUiKind = 'card' | 'table' | 'form' | 'chart' | 'html' | 'component'

export interface ExtensionConfigFieldSchema {
  key: string
  label: string
  type: 'text' | 'secret'
  required?: boolean
  description?: string
  placeholder?: string
  defaultValue?: string
}

export interface ExtensionHttpDefinition {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}

export interface ExtensionToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  kind: ExtensionToolKind
  http?: ExtensionHttpDefinition
  handler?: string
  readOnly?: boolean
}

export interface ExtensionFetchRequest {
  method?: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}

export interface ExtensionFetchResponse {
  ok: boolean
  status: number
  statusText: string
  headers: Record<string, string>
  text: string
  json?: unknown
}

export interface ExtensionRendererDefinition {
  name: string
  type: 'html'
  entry: string
}

export interface ExtensionComponentDefinition {
  name: string
  type: 'html'
  entry: string
  title?: string
  description?: string
}

export interface ExtensionMcpServerDefinition {
  transport?: 'stdio' | 'sse' | 'streamable-http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  url?: string
  headers?: Record<string, string>
  description?: string
}

/**
 * 插件视图 —— 用户点得到的一页功能（不是聊天窗内卡片，那是 components）。
 * `entry` 是相对插件根的 html 路径，归一化时强校验不能越出插件根目录。
 */
export interface ExtensionViewDefinition {
  id: string
  title: string
  entry: string
  /** 本迭代只支持 'window'（独立窗口）。'panel'（主区内嵌）留待以后。 */
  mode?: 'window'
  nav?: {
    /** 导轨下拉里显示的名字，缺省用 title */
    label?: string
    /** 排序，小的在前，缺省 100 */
    order?: number
  }
  window?: {
    width?: number
    height?: number
    minWidth?: number
    minHeight?: number
    resizable?: boolean
  }
}

/**
 * 需要下载的资产 —— **只声明 id，不出现 URL / 体积 / 哈希**。
 * 那张表由主程序内置（见 S-242），好处是换源、下架、国内分流都不用让插件跟着发版。
 */
export interface ExtensionAssetDefinition {
  /** 全程序唯一键，带命名空间前缀，如 `asr/qwen3-asr-0.6b` */
  id: string
  /** true = 不装也能用插件，只是相关功能不可用 */
  optional?: boolean
}

export interface ExtensionInterfaceMeta {
  displayName?: string
  category?: string
  defaultPrompt?: string[]
  icon?: string
  brandColor?: string
}

export interface ExtensionManifest {
  schemaVersion: 1
  id: string
  name: string
  version: string
  description?: string
  entry?: string
  configSchema?: ExtensionConfigFieldSchema[]
  permissions?: {
    network?: string[]
  }
  tools: ExtensionToolDefinition[]
  renderers?: ExtensionRendererDefinition[]
  components?: ExtensionComponentDefinition[]
  // 插件视图入口（导轨下拉）。`extension.json` 里 tools 与 views 至少声明一项，
  // 归一化后 tools 永远是数组、views 可能不出现。
  views?: ExtensionViewDefinition[]
  // 需要下载的资产声明，只有 id，不含 URL。
  assets?: ExtensionAssetDefinition[]
  // Aggregate resources: bundled content synced into the user content
  // directories while the extension is enabled. Paths are relative to the
  // extension root. Parsed from the on-disk extension.json by the main
  // process; instances returned by the native worker may omit these fields.
  skills?: string
  agents?: string
  commands?: string
  mcpServers?: Record<string, ExtensionMcpServerDefinition>
  state?: boolean
  interface?: ExtensionInterfaceMeta
}

export interface ExtensionInstance {
  id: string
  enabled: boolean
  installedAt: number
  updatedAt: number
  config: Record<string, string>
  manifest: ExtensionManifest
}

export interface ExtensionToolResult {
  __wishfulClawExtensionResult: true
  extensionId: string
  toolName?: string
  text?: string
  data?: unknown
  ui?: {
    kind: ExtensionUiKind
    [key: string]: unknown
  }
}
