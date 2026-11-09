/**
 * Feishu-specific IPC handlers (media, mention, urgent, bitable, download).
 *
 * Extracted from channel-handlers.ts.
 */

import type { FeishuService } from '../../channels/providers/feishu/feishu-service'
import { activeChannelManager, registerChannelMessagePackHandler } from './channel-handler-utils'
import { startFeishuInstall, pollFeishuInstall } from '../../channels/providers/feishu/feishu-install'

export function registerFeishuHandlers(): void {
  // Send image
  registerChannelMessagePackHandler<{ pluginId: string; chatId: string; filePath: string }>(
    'plugin:feishu:send-image',
    async (args) => {
      const service = activeChannelManager?.getService(args.pluginId) as
        | FeishuService
        | undefined
      if (!service?.api) return { error: 'Feishu plugin not running or not found' }

      try {
        const result = await service.sendMedia(args.chatId, {
          kind: 'image',
          source: args.filePath
        })
        return { ok: true, messageId: result.messageId }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Send file
  registerChannelMessagePackHandler<{
    pluginId: string
    chatId: string
    filePath: string
    /**
     * @deprecated 从未有调用方传过。统一入口 `sendMedia` 按扩展名推飞书的
     * `file_type`；需要精确控制请直接用 `service.api.media.uploadFile`。
     */
    fileType?: string
  }>('plugin:feishu:send-file', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as
      | FeishuService
      | undefined
    if (!service?.api) return { error: 'Feishu plugin not running or not found' }

    try {
      const result = await service.sendMedia(args.chatId, {
        kind: 'file',
        source: args.filePath
      })
      return { ok: true, messageId: result.messageId }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Send voice — Feishu only accepts opus; the upload API rejects other formats
  registerChannelMessagePackHandler<{ pluginId: string; chatId: string; filePath: string }>(
    'plugin:feishu:send-audio',
    async (args) => {
      const service = activeChannelManager?.getService(args.pluginId) as
        | FeishuService
        | undefined
      if (!service?.api) return { error: 'Feishu plugin not running or not found' }

      try {
        const result = await service.sendMedia(args.chatId, {
          kind: 'audio',
          source: args.filePath
        })
        return { ok: true, messageId: result.messageId }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  // Send mention
  registerChannelMessagePackHandler<{
    pluginId: string
    chatId?: string
    userIds?: string[]
    atAll?: boolean
    text?: string
  }>('plugin:feishu:send-mention', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as
      | FeishuService
      | undefined
    if (!service?.api) return { error: 'Feishu plugin not running or not found' }

    try {
      const chatId = args.chatId?.trim()
      if (!chatId) return { error: 'Missing chatId' }
      const info = await service.api.getChatInfo(chatId)
      if (info?.chatType !== 'group') {
        return { error: 'FeishuAtMember is only available in group chats.' }
      }

      const userIds = Array.isArray(args.userIds) ? args.userIds.filter(Boolean) : []
      const text = args.text?.trim() ?? ''
      const elements: Array<Record<string, string>> = []
      if (args.atAll) elements.push({ tag: 'at', user_id: 'all' })
      for (const uid of userIds) elements.push({ tag: 'at', user_id: uid })
      if (text) {
        const textValue = elements.length > 0 ? ` ${text}` : text
        elements.push({ tag: 'text', text: textValue })
      }
      if (elements.length === 0) return { error: 'Message content is empty' }

      const postContent = { zh_cn: { content: [elements] } }
      const result = await service.api.sendMessage(chatId, JSON.stringify(postContent), 'post')
      return { ok: true, messageId: result.messageId }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // List members
  registerChannelMessagePackHandler<{
    pluginId: string
    chatId?: string
    pageToken?: string
    pageSize?: number
    memberIdType?: 'open_id' | 'user_id' | 'union_id'
  }>('plugin:feishu:list-members', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as
      | FeishuService
      | undefined
    if (!service?.api) return { error: 'Feishu plugin not running or not found' }

    try {
      const chatId = args.chatId?.trim()
      if (!chatId) return { error: 'Missing chatId' }
      return await service.api.listChatMembers({
        chatId,
        pageToken: args.pageToken,
        pageSize: args.pageSize,
        memberIdType: args.memberIdType
      })
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Send urgent
  registerChannelMessagePackHandler<{
    pluginId: string
    messageId: string
    userIds: string[]
    urgentTypes: Array<'app' | 'sms'>
  }>('plugin:feishu:send-urgent', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as
      | FeishuService
      | undefined
    if (!service?.api) return { error: 'Feishu plugin not running or not found' }

    try {
      const types = Array.isArray(args.urgentTypes)
        ? args.urgentTypes.filter((t) => t === 'app' || t === 'sms')
        : []
      if (!args.messageId || !args.userIds?.length || types.length === 0) {
        return { error: 'Missing messageId, userIds, or urgentTypes' }
      }
      for (const t of types) {
        await service.api.media.sendUrgent(args.messageId, args.userIds, t, 'user_id')
      }
      return { ok: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Download resource
  registerChannelMessagePackHandler<{
    pluginId: string
    messageId: string
    fileKey: string
    type?: 'image' | 'file'
    mediaType?: string
  }>('plugin:feishu:download-resource', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as
      | FeishuService
      | undefined
    if (!service?.api) return { error: 'Feishu plugin not running or not found' }

    try {
      const buf = await service.api.media.downloadMessageResource(
        args.messageId,
        args.fileKey,
        args.type ?? 'file'
      )
      return {
        ok: true,
        base64: buf.toString('base64'),
        mediaType: args.mediaType ?? 'application/octet-stream'
      }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ── Feishu Bitable ──

  registerChannelMessagePackHandler<{ pluginId: string }>(
    'plugin:feishu:bitable:list-apps',
    async (args) => {
      const service = activeChannelManager?.getService(args.pluginId) as FeishuService | undefined
      if (!service?.api) return { error: 'Feishu plugin not running or not found' }
      try {
        return { ok: true, data: await service.api.bitable.listApps() }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  registerChannelMessagePackHandler<{ pluginId: string; appToken: string }>(
    'plugin:feishu:bitable:list-tables',
    async (args) => {
      const service = activeChannelManager?.getService(args.pluginId) as FeishuService | undefined
      if (!service?.api) return { error: 'Feishu plugin not running or not found' }
      try {
        return { ok: true, data: await service.api.bitable.listTables(args.appToken) }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  registerChannelMessagePackHandler<{ pluginId: string; appToken: string; tableId: string }>(
    'plugin:feishu:bitable:list-fields',
    async (args) => {
      const service = activeChannelManager?.getService(args.pluginId) as FeishuService | undefined
      if (!service?.api) return { error: 'Feishu plugin not running or not found' }
      try {
        return { ok: true, data: await service.api.bitable.listFields(args.appToken, args.tableId) }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  registerChannelMessagePackHandler<{
    pluginId: string
    appToken: string
    tableId: string
    filter?: string
    pageSize?: number
    pageToken?: string
  }>('plugin:feishu:bitable:get-records', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as FeishuService | undefined
    if (!service?.api) return { error: 'Feishu plugin not running or not found' }
    try {
      const data = await service.api.bitable.getRecords(args.appToken, args.tableId, {
        filter: args.filter,
        pageSize: args.pageSize,
        pageToken: args.pageToken
      })
      return { ok: true, data }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerChannelMessagePackHandler<{
    pluginId: string
    appToken: string
    tableId: string
    records: unknown[]
  }>('plugin:feishu:bitable:create-records', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as FeishuService | undefined
    if (!service?.api) return { error: 'Feishu plugin not running or not found' }
    try {
      return { ok: true, data: await service.api.bitable.createRecords(args.appToken, args.tableId, args.records) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerChannelMessagePackHandler<{
    pluginId: string
    appToken: string
    tableId: string
    records: unknown[]
  }>('plugin:feishu:bitable:update-records', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as FeishuService | undefined
    if (!service?.api) return { error: 'Feishu plugin not running or not found' }
    try {
      return { ok: true, data: await service.api.bitable.updateRecords(args.appToken, args.tableId, args.records) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerChannelMessagePackHandler<{
    pluginId: string
    appToken: string
    tableId: string
    recordIds: string[]
  }>('plugin:feishu:bitable:delete-records', async (args) => {
    const service = activeChannelManager?.getService(args.pluginId) as FeishuService | undefined
    if (!service?.api) return { error: 'Feishu plugin not running or not found' }
    try {
      return { ok: true, data: await service.api.bitable.deleteRecords(args.appToken, args.tableId, args.recordIds) }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  // -- Feishu OAuth Device Flow: scan-to-bind --
  registerChannelMessagePackHandler<{ domain?: 'feishu' | 'lark' }>(
    'plugin:feishu:install-start',
    async (args) => {
      return await startFeishuInstall(args?.domain ?? 'feishu')
    }
  )

  registerChannelMessagePackHandler<string>(
    'plugin:feishu:install-poll',
    async (installId) => {
      return await pollFeishuInstall(installId)
    }
  )
}

// ── Channel-specific tool executor (used by reverse-request dispatch) ──

export async function executeFeishuChannelTool(
  method: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const pluginId = typeof args.pluginId === 'string' ? args.pluginId : ''
  if (!pluginId) return { error: 'Missing pluginId' }

  const service = activeChannelManager?.getService(pluginId) as FeishuService | undefined

  switch (method) {
    case 'plugin:feishu:send-image': {
      if (!service?.api) return { error: 'Feishu plugin not running or not found' }
      try {
        const result = await service.sendMedia(String(args.chatId ?? ''), {
          kind: 'image',
          source: String(args.filePath ?? '')
        })
        return { ok: true, messageId: result.messageId }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
    case 'plugin:feishu:send-file': {
      if (!service?.api) return { error: 'Feishu plugin not running or not found' }
      try {
        const result = await service.sendMedia(String(args.chatId ?? ''), {
          kind: 'file',
          source: String(args.filePath ?? '')
        })
        return { ok: true, messageId: result.messageId }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
    case 'plugin:feishu:send-audio': {
      if (!service?.api) return { error: 'Feishu plugin not running or not found' }
      try {
        const result = await service.sendMedia(String(args.chatId ?? ''), {
          kind: 'audio',
          source: String(args.filePath ?? '')
        })
        return { ok: true, messageId: result.messageId }
      } catch (err) {
        return { error: err instanceof Error ? err.message : String(err) }
      }
    }
    default:
      return { error: `Unknown Feishu method: ${method}` }
  }
}
