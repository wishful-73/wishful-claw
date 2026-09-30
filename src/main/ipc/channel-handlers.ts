/**
 * Channel IPC handlers — main entry point.
 *
 * Registers all channel-related IPC handlers by delegating to sub-modules.
 * This file replaces the original monolithic channel-handlers.ts (1601 lines).
 *
 * Sub-modules:
 *   - channel-handler-utils.ts     — shared types, state, utilities
 *   - channel-plugin-handlers.ts   — plugin CRUD, sessions, streaming
 *   - channel-feishu-handlers.ts   — Feishu media, bitable, mention, urgent
 *   - channel-weixin-handlers.ts   — Weixin media send
 */

import type { ChannelManager } from '../channels/channel-manager'
import {
  registerPluginHandlers,
  autoStartChannels,
  executePluginAction
} from './channel-handlers/channel-plugin-handlers'
import { registerFeishuHandlers, executeFeishuChannelTool } from './channel-handlers/channel-feishu-handlers'
import { registerWeixinHandlers, executeWeixinChannelTool } from './channel-handlers/channel-weixin-handlers'

// Re-export for reverse-request dispatch
export { executePluginAction, autoStartChannels }

/**
 * Channel-specific plugin tool executor — dispatched by reverse-handlers/index.ts.
 */
export async function executeChannelSpecificPluginTool(
  channel: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (channel.startsWith('plugin:feishu:') || channel.startsWith('plugin:feishu:bitable:')) {
    return await executeFeishuChannelTool(channel, args)
  }
  if (channel.startsWith('plugin:weixin:')) {
    return await executeWeixinChannelTool(channel, args)
  }
  return { error: `Unknown channel method: ${channel}` }
}

/**
 * Register all channel IPC handlers.
 */
export function registerChannelHandlers(channelManager: ChannelManager): void {
  registerPluginHandlers(channelManager)
  registerFeishuHandlers()
  registerWeixinHandlers()
}
