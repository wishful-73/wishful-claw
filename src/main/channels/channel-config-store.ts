/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

import { getNativeWorker } from '../lib/native-worker'
import type { ChannelInstance, GlobalChannelSettings } from './channel-types'

const CHANNEL_CONFIG_TIMEOUT_MS = 60_000

type MutationResult = {
  success: boolean
  error?: string
}

export async function readChannelPlugins(): Promise<ChannelInstance[]> {
  try {
    return await getNativeWorker().request<ChannelInstance[]>(
      'channel/config-list',
      {},
      CHANNEL_CONFIG_TIMEOUT_MS
    )
  } catch (err) {
    console.error('[Channels] Config read error:', err)
    return []
  }
}

export async function writeChannelPlugins(plugins: ChannelInstance[]): Promise<void> {
  const result = await getNativeWorker().request<MutationResult>(
    'channel/config-write',
    plugins,
    CHANNEL_CONFIG_TIMEOUT_MS
  )
  if (!result.success) {
    throw new Error(result.error ?? 'Channel config write failed')
  }
}

export async function getChannelPlugin(id: string): Promise<ChannelInstance | null> {
  const result = await getNativeWorker().request<{ plugin?: ChannelInstance | null }>(
    'channel/config-get',
    id,
    CHANNEL_CONFIG_TIMEOUT_MS
  )
  return result.plugin ?? null
}

export async function isChannelPluginToolEnabled(
  pluginId: string,
  toolName: string
): Promise<boolean> {
  const plugin = await getChannelPlugin(pluginId)
  if (!plugin?.tools) return true
  return plugin.tools[toolName] !== false
}

/**
 * The Worker applies the defaults, so a failed read must not be masked by a
 * local fallback — that is how the retired per-channel flags ended up with
 * five disagreeing default values.
 */
export async function readGlobalChannelSettings(): Promise<GlobalChannelSettings> {
  return await getNativeWorker().request<GlobalChannelSettings>(
    'channel/settings-read',
    {},
    CHANNEL_CONFIG_TIMEOUT_MS
  )
}

export async function writeGlobalChannelSettings(
  settings: GlobalChannelSettings
): Promise<GlobalChannelSettings> {
  const result = await getNativeWorker().request<MutationResult>(
    'channel/settings-write',
    settings,
    CHANNEL_CONFIG_TIMEOUT_MS
  )
  if (!result.success) {
    throw new Error(result.error ?? 'Global channel settings write failed')
  }
  return await readGlobalChannelSettings()
}
