/**
 * Shared utilities, types, and state for channel IPC handlers.
 *
 * Extracted from channel-handlers.ts to keep files under AGENTS.md limits.
 */

import { ipcMain, BrowserWindow } from 'electron'
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

export async function captureQrPageAsDataUrl(url: string): Promise<string | undefined> {
  const win = new BrowserWindow({
    show: false,
    width: 720,
    height: 960,
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: false,
      offscreen: false
    }
  })

  try {
    await win.loadURL(url)
    await new Promise((resolve) => setTimeout(resolve, 1800))
    const image = await win.webContents.capturePage()
    const png = image.toPNG()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return undefined
  } finally {
    if (!win.isDestroyed()) {
      win.destroy()
    }
  }
}

export async function normalizeQrDisplayUrl(url?: string): Promise<string | undefined> {
  const value = url?.trim()
  if (!value) return undefined
  if (value.startsWith('data:image/')) return value
  if (!/^https?:\/\//i.test(value)) return value

  try {
    const response = await fetch(value)
    if (!response.ok) {
      return (await captureQrPageAsDataUrl(value)) || value
    }

    const contentType = response.headers.get('content-type') || ''

    if (contentType.startsWith('image/')) {
      const buffer = Buffer.from(await response.arrayBuffer())
      return `data:${contentType};base64,${buffer.toString('base64')}`
    }

    const html = await response.text()
    const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i)
    if (imgMatch?.[1]) {
      const imgSrc = new URL(imgMatch[1], value).toString()
      const imageResponse = await fetch(imgSrc)
      if (imageResponse.ok) {
        const imageType = imageResponse.headers.get('content-type') || 'image/png'
        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
        return `data:${imageType};base64,${imageBuffer.toString('base64')}`
      }
    }

    return (await captureQrPageAsDataUrl(value)) || value
  } catch {
    return (await captureQrPageAsDataUrl(value)) || value
  }
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
