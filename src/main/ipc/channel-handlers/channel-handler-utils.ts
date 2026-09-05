/**
 * Shared utilities, types, and state for channel IPC handlers.
 *
 * Extracted from channel-handlers.ts to keep files under AGENTS.md limits.
 */

import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { nanoid } from 'nanoid'
import { ChannelManager } from '../../channels/channel-manager'
import {
  isChannelPluginToolEnabled,
  readChannelPlugins,
  writeChannelPlugins
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
  ChannelProviderDescriptor
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

export function resolveSourceFileName(source: string, fallback: string): string {
  const value = source.trim()
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const fileName = path.basename(url.pathname)
      return decodeURIComponent(fileName || fallback)
    } catch {
      return fallback
    }
  }

  const sanitized = value.split('?')[0]
  return path.basename(sanitized) || fallback
}

export async function readBinarySource(
  source: string,
  fallbackName: string
): Promise<{ buffer: Buffer; fileName: string }> {
  const value = source.trim()
  if (!value) {
    throw new Error('File path is empty')
  }

  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value)
    if (!response.ok) {
      throw new Error(`Download URL failed: HTTP ${response.status}`)
    }
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      fileName: resolveSourceFileName(value, fallbackName)
    }
  }

  if (!fs.existsSync(value)) {
    throw new Error(`File not found: ${value}`)
  }

  return {
    buffer: fs.readFileSync(value),
    fileName: resolveSourceFileName(value, fallbackName)
  }
}

export function buildToolsMap(
  descriptor?: ChannelProviderDescriptor,
  existing?: Record<string, boolean>
): Record<string, boolean> | undefined {
  if (!descriptor?.tools || descriptor.tools.length === 0) {
    return existing
  }
  const next: Record<string, boolean> = {}
  for (const toolName of descriptor.tools) {
    next[toolName] = existing?.[toolName] ?? true
  }
  return next
}

export async function readPlugins(): Promise<ChannelInstance[]> {
  return await readChannelPlugins()
}

export async function isPluginToolEnabledHandler(pluginId: string, toolName: string): Promise<boolean> {
  return await isChannelPluginToolEnabled(pluginId, toolName)
}

export async function writePlugins(plugins: ChannelInstance[]): Promise<void> {
  await writeChannelPlugins(plugins)
}

export function notifyRenderer(event: ChannelEvent): void {
  safeSendMessagePackToAllWindows('plugin:incoming-message', event)

  if (event.type === 'incoming_message') {
    handleChannelAutoReply(event)
  }
}

export { nanoid, CHANNEL_PROVIDERS }
