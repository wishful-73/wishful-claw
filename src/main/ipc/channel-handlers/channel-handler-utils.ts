/**
 * Shared utilities, types, and state for channel IPC handlers.
 *
 * Extracted from channel-handlers.ts to keep files under AGENTS.md limits.
 */

import { ipcMain } from 'electron'
import { nanoid } from 'nanoid'
import { ChannelManager } from '../../channels/channel-manager'
import {
  readChannelPlugins,
  readGlobalChannelSettings,
  writeChannelPlugins,
  writeGlobalChannelSettings
} from '../../channels/channel-config-store'
import { safeSendMessagePackToAllWindows } from '../../window-ipc'
import { logError, extractMessage, extractStack } from '../../lib/logger'
import {
  decodeMessagePackPayload,
  encodeMessagePackPayload,
  toMessagePackChannel
} from '../../../shared/messagepack/binary-ipc'
import { CHANNEL_PROVIDERS } from '../../channels/channel-descriptors'
import { getNativeWorker } from '../../lib/native-worker'
import { handleChannelAutoReply } from '../../channels/auto-reply'
import {
  decodeHtmlDataUrl,
  extractQrImageSource,
  isHtmlContent,
  normalizeInlineImageSource
} from './qr-display-url'
import { captureQrElementAsDataUrl } from './qr-page-capture'
import type {
  ChannelInstance,
  ChannelEvent,
  GlobalChannelSettings
} from '../../channels/channel-types'

// ── Shared state ──

export let activeChannelManager: ChannelManager | null = null

export function setActiveChannelManager(mgr: ChannelManager): void {
  activeChannelManager = mgr
}

// ── Shared types ──

export interface NativeProjectRow {
  id: string
  name: string
  working_folder: string | null
  ssh_connection_id: string | null
  plugin_id?: string | null
  pinned: number
  created_at: number
  updated_at: number
}

export interface NativePluginSessionRow {
  id: string
  title: string
  icon: string | null
  mode: string
  created_at: number
  updated_at: number
  project_id?: string | null
  working_folder: string | null
  ssh_connection_id?: string | null
  plan_id?: string | null
  pinned: number
  message_count?: number
  plugin_id?: string | null
  external_chat_id?: string | null
  provider_id?: string | null
  model_id?: string | null
  model_selection_mode?: string | null
}

export interface NativePluginSessionMessageRow {
  id: string
  role: string
  content: string
  created_at: number
}

export interface NativePluginSessionMutationResult {
  success: boolean
  changed: number
  deleted: number
  error?: string | null
}

export interface NativePluginSessionFindResult {
  success: boolean
  session?: NativePluginSessionRow | null
  error?: string | null
}

// ── Shared functions ──

export async function requestNativeDb<T>(
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  return await getNativeWorker().request<T>(method, params, 120_000)
}

export function registerChannelMessagePackHandler<TArgs>(
  channel: string,
  handler: (args: TArgs) => Promise<unknown>
): void {
  ipcMain.handle(toMessagePackChannel(channel), async (_event, bytes: Uint8Array) => {
    try {
      const args = decodeMessagePackPayload<TArgs>(bytes)
      return encodeMessagePackPayload(await handler(args))
    } catch (err) {
      // Match registerMessagePackHandler's contract: return an { error }
      // payload instead of rejecting, so renderer consumers of plugin:* channels
      // that check result.error see the failure instead of a thrown invoke.
      const msg = extractMessage(err)
      const stack = extractStack(err)
      console.error(`[IPC] Channel handler error for '${channel}':`, msg)
      logError('ipc', `Channel handler error for '${channel}': ${msg}`, { stack, extra: { channel } })
      return encodeMessagePackPayload({ error: msg })
    }
  })
}

export function assertNativeMutation(
  result: NativePluginSessionMutationResult,
  label: string
): NativePluginSessionMutationResult {
  if (!result.success) {
    throw new Error(result.error || `${label} failed`)
  }
  return result
}

async function fetchQrImageAsDataUrl(
  source: string,
  baseUrl?: string,
  depth = 0
): Promise<string | undefined> {
  if (depth > 2) return undefined

  const normalized = normalizeInlineImageSource(source, baseUrl)
  if (!normalized) return undefined
  if (normalized.startsWith('data:image/')) return normalized

  try {
    const response = await fetch(normalized)
    if (!response.ok) return undefined

    const contentType = response.headers.get('content-type') || ''
    if (contentType.startsWith('image/')) {
      const buffer = Buffer.from(await response.arrayBuffer())
      return `data:${contentType};base64,${buffer.toString('base64')}`
    }

    const html = await response.text()
    const nestedSource = extractQrImageSource(html)
    return nestedSource
      ? await fetchQrImageAsDataUrl(nestedSource, normalized, depth + 1)
      : undefined
  } catch {
    return undefined
  }
}

export async function normalizeQrDisplayUrl(
  source?: string,
  baseUrl?: string
): Promise<string | undefined> {
  const value = source?.trim()
  if (!value) return undefined

  const decodedHtmlDataUrl = decodeHtmlDataUrl(value)
  const inlineHtml = decodedHtmlDataUrl ?? (isHtmlContent(value) ? value : undefined)
  if (inlineHtml) {
    const imageSource = extractQrImageSource(inlineHtml)
    if (imageSource) {
      const imageDataUrl = await fetchQrImageAsDataUrl(imageSource, baseUrl)
      if (imageDataUrl) return imageDataUrl
    }

    const captureUrl = decodedHtmlDataUrl
      ? value
      : `data:text/html;charset=utf-8,${encodeURIComponent(inlineHtml)}`
    return await captureQrElementAsDataUrl(captureUrl)
  }

  const normalized = normalizeInlineImageSource(value, baseUrl)
  if (!normalized) return undefined
  if (normalized.startsWith('data:image/')) return normalized

  const imageDataUrl = await fetchQrImageAsDataUrl(normalized)
  if (imageDataUrl) return imageDataUrl

  return await captureQrElementAsDataUrl(normalized)
}

// 媒体来源读取在渠道层：`channels/channel-media-source.ts`。
// 刀 1 期间这里留过一条 re-export 让调用方零改动；刀 2 把最后两个调用方（飞书、微信的
// IPC handler）也改走 `service.sendMedia` 之后，re-export 已零引用，删掉 —— 否则它自己
// 就成了「渠道层代码长在 IPC 层」的新入口。

export async function readPlugins(): Promise<ChannelInstance[]> {
  return await readChannelPlugins()
}

export async function writePlugins(plugins: ChannelInstance[]): Promise<void> {
  await writeChannelPlugins(plugins)
}

export async function readGlobalSettings(): Promise<GlobalChannelSettings> {
  return await readGlobalChannelSettings()
}

export async function writeGlobalSettings(
  settings: GlobalChannelSettings
): Promise<GlobalChannelSettings> {
  return await writeGlobalChannelSettings(settings)
}

export function notifyRenderer(event: ChannelEvent): void {
  safeSendMessagePackToAllWindows('plugin:incoming-message', event)

  if (event.type === 'incoming_message') {
    handleChannelAutoReply(event)
  }
}

export { nanoid, CHANNEL_PROVIDERS }
