/**
 * Weixin-specific IPC handlers (media send).
 *
 * Extracted from channel-handlers.ts.
 */

import type { WeixinService } from '../../channels/providers/weixin/weixin-service'
import { buildMediaFallbackText, sendMediaOrText } from '../../channels/channel-media'
import { activeChannelManager, registerChannelMessagePackHandler } from './channel-handler-utils'

export function registerWeixinHandlers(): void {
  registerChannelMessagePackHandler<{
    pluginId: string
    chatId: string
    filePath: string
    content?: string
  }>('plugin:weixin:send-image', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as
      | WeixinService
      | undefined
    if (!service) return { error: 'Weixin plugin not running or not found' }

    try {
      const result = await sendMediaOrText(
        service,
        args.chatId,
        { kind: 'image', source: args.filePath, caption: args.content },
        buildMediaFallbackText('image', args.content)
      )
      return { ok: true, messageId: result.messageId, sentAs: result.sentAs }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerChannelMessagePackHandler<{
    pluginId: string
    chatId: string
    filePath: string
    content?: string
  }>('plugin:weixin:send-file', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as
      | WeixinService
      | undefined
    if (!service) return { error: 'Weixin plugin not running or not found' }

    try {
      const result = await sendMediaOrText(
        service,
        args.chatId,
        { kind: 'file', source: args.filePath, caption: args.content },
        buildMediaFallbackText('file', args.content)
      )
      return { ok: true, messageId: result.messageId, sentAs: result.sentAs }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerChannelMessagePackHandler<{
    pluginId: string
    chatId: string
    filePath: string
    content?: string
    durationMs?: number
  }>('plugin:weixin:send-audio', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as
      | WeixinService
      | undefined
    if (!service) return { error: 'Weixin plugin not running or not found' }

    try {
      const result = await sendMediaOrText(
        service,
        args.chatId,
        {
          kind: 'audio',
          source: args.filePath,
          caption: args.content,
          durationMs: args.durationMs
        },
        buildMediaFallbackText('audio', args.content)
      )
      return { ok: true, messageId: result.messageId, sentAs: result.sentAs }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
}

// ── Channel-specific tool executor (used by reverse-request dispatch) ──

export async function executeWeixinChannelTool(
  method: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const pluginId = typeof args.pluginId === 'string' ? args.pluginId : ''
  if (!pluginId) return { error: 'Missing pluginId' }

  const service = activeChannelManager?.getService(pluginId) as WeixinService | undefined

  switch (method) {
    case 'plugin:weixin:send-image': {
      if (!service) return { error: 'Weixin plugin not running or not found' }
      try {
        const result = await sendMediaOrText(
          service,
          String(args.chatId ?? ''),
          {
            kind: 'image',
            source: String(args.filePath ?? ''),
            caption: typeof args.content === 'string' ? args.content : undefined
          },
          buildMediaFallbackText(
            'image',
            typeof args.content === 'string' ? args.content : undefined
          )
        )
        return { ok: true, messageId: result.messageId, sentAs: result.sentAs }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
    case 'plugin:weixin:send-file': {
      if (!service) return { error: 'Weixin plugin not running or not found' }
      try {
        const result = await sendMediaOrText(
          service,
          String(args.chatId ?? ''),
          {
            kind: 'file',
            source: String(args.filePath ?? ''),
            caption: typeof args.content === 'string' ? args.content : undefined
          },
          buildMediaFallbackText(
            'file',
            typeof args.content === 'string' ? args.content : undefined
          )
        )
        return { ok: true, messageId: result.messageId, sentAs: result.sentAs }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
    case 'plugin:weixin:send-audio': {
      if (!service) return { error: 'Weixin plugin not running or not found' }
      try {
        const result = await sendMediaOrText(
          service,
          String(args.chatId ?? ''),
          {
            kind: 'audio',
            source: String(args.filePath ?? ''),
            caption: typeof args.content === 'string' ? args.content : undefined,
            durationMs: typeof args.durationMs === 'number' ? args.durationMs : undefined
          },
          buildMediaFallbackText(
            'audio',
            typeof args.content === 'string' ? args.content : undefined
          )
        )
        return { ok: true, messageId: result.messageId, sentAs: result.sentAs }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
    default:
      return { error: `Unknown Weixin method: ${method}` }
  }
}
