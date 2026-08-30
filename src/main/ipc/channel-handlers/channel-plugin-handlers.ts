/**
 * Plugin CRUD + session management + streaming IPC handlers.
 *
 * Extracted from channel-handlers.ts.
 */

import type { ChannelInstance, MessagingChannelService } from '../../channels/channel-types'
import { ChannelManager } from '../../channels/channel-manager'
import { extractMessage, extractStack, logError, logInfo } from '../../lib/logger'
import {
  activeChannelManager,
  setActiveChannelManager,
  registerChannelMessagePackHandler,
  assertNativeMutation,
  requestNativeDb,
  normalizeQrDisplayUrl,
  buildToolsMap,
  readPlugins,
  writePlugins,
  notifyRenderer,
  isPluginToolEnabledHandler,
  nanoid,
  CHANNEL_PROVIDERS,
  type NativePluginSessionMutationResult,
} from './channel-handler-utils'
import { registerPluginSessionHandlers } from './channel-plugin-session-handlers'
import { registerPluginStreamHandlers } from './channel-plugin-stream-handlers'
import {
  startWeixinLoginWithQr,
  waitForWeixinLogin,
  DEFAULT_WEIXIN_BASE_URL
} from '../../channels/providers/weixin/weixin-login'

let _handlersRegistered = false

// ── Exported action executors (used by reverse-request dispatch) ──

export interface SendChannelMessageArgs {
  pluginId: string
  /** Optional assertion used by background callers to avoid sending through a mismatched channel. */
  pluginType?: string
  chatId: string
  content: string
  isWakeup?: boolean
  taskId?: string
}

/**
 * Resolve the running service that should deliver this message: prefer the
 * recorded instance, fall back to any other running instance of the same
 * channel type so scheduled replies survive instance replacement/rebinding.
 */
async function resolveSendService(
  pluginId: string,
  pluginTypeHint?: string
): Promise<MessagingChannelService> {
  const manager = activeChannelManager
  const primary = manager?.getService(pluginId)
  if (primary?.isRunning()) return primary

  let type = pluginTypeHint
  try {
    const plugins = await readPlugins()
    type = type || plugins.find((candidate) => candidate.id === pluginId)?.type
    const fallback = plugins.find(
      (candidate) =>
        candidate.type === type &&
        candidate.enabled &&
        candidate.id !== pluginId &&
        manager?.getService(candidate.id)?.isRunning()
    )
    if (fallback) {
      console.warn(
        `[ChannelSend] Primary plugin ${pluginId} unavailable; falling back to ${fallback.id} (${fallback.type})`
      )
      return manager!.getService(fallback.id)!
    }
  } catch {
    /* fall through to the primary-not-running error */
  }

  throw new Error(`Plugin ${pluginId} is not running`)
}

/** Send a message through a running channel without depending on a renderer window. */
export async function sendChannelMessage(args: SendChannelMessageArgs): Promise<{ messageId: string }> {
  const taskId = args.taskId?.trim() || 'background'
  const pluginId = args.pluginId.trim()
  const pluginType = args.pluginType?.trim()
  const chatId = args.chatId.trim()
  const content = args.content.trim()

  if (!pluginId) throw new Error('Missing pluginId for channel message')
  if (!chatId) throw new Error('Missing chatId for channel message')
  if (!content) throw new Error('Message content is empty')

  const service = await resolveSendService(pluginId, pluginType)
  if (pluginType && service.pluginType !== pluginType) {
    const error = new Error(`Plugin ${pluginId} is type ${service.pluginType}, expected ${pluginType}`)
    logError('main', `[ChannelSend] Failed task=${taskId}`, {
      stack: error.stack,
      extra: { taskId, pluginId, pluginType, chatId, contentLength: content.length, error: error.message }
    })
    throw error
  }

  try {
    const target = service as typeof service & {
      sendWakeupMessage?: (chatId: string, content: string) => Promise<{ messageId: string }>
    }
    const result =
      args.isWakeup === true && typeof target.sendWakeupMessage === 'function'
        ? await target.sendWakeupMessage(chatId, content)
        : await service.sendMessage(chatId, content)
    logInfo('main', `[ChannelSend] Succeeded task=${taskId}`, {
      extra: { taskId, pluginId, pluginType: service.pluginType, chatId, contentLength: content.length, messageId: result.messageId }
    })
    return result
  } catch (err) {
    const error = extractMessage(err)
    logError('main', `[ChannelSend] Failed task=${taskId}`, {
      stack: extractStack(err),
      extra: { taskId, pluginId, pluginType: service.pluginType, chatId, contentLength: content.length, error }
    })
    throw err
  }
}

export async function executePluginAction(args: {
  pluginId: string
  action: string
  params: Record<string, unknown>
}): Promise<unknown> {
  const { pluginId, action, params } = args
  const service = activeChannelManager?.getService(pluginId)
  if (!service) {
    throw new Error(`Plugin ${pluginId} is not running`)
  }

  switch (action) {
    case 'sendMessage': {
      return await sendChannelMessage({
        pluginId,
        pluginType: typeof params.pluginType === 'string' ? params.pluginType : undefined,
        chatId: typeof params.chatId === 'string' ? params.chatId : '',
        content: typeof params.content === 'string' ? params.content : '',
        isWakeup: params.isWakeup === true,
        taskId: typeof params.taskId === 'string' ? params.taskId : undefined
      })
    }
    case 'replyMessage':
      return await service.replyMessage(params.messageId as string, params.content as string)
    case 'getGroupMessages':
      return await service.getGroupMessages(params.chatId as string, (params.count as number) ?? 20)
    case 'listGroups':
      return await service.listGroups()
    default:
      throw new Error(`Unknown action: ${action}`)
  }
}

export async function isPluginToolEnabled(pluginId: string, toolName: string): Promise<boolean> {
  return await isPluginToolEnabledHandler(pluginId, toolName)
}

export async function autoStartChannels(channelManager: ChannelManager): Promise<void> {
  const channels = await readPlugins()
  const toStart = channels.filter(
    (p) => p.enabled && (p.features?.autoStart ?? true)
  )
  for (const instance of toStart) {
    try {
      await channelManager.startPlugin(instance, notifyRenderer)
      console.log(`[Channel Manager] Auto-started: ${instance.name} (${instance.type})`)
    } catch (err) {
      console.error(`[Channel Manager] Auto-start failed for ${instance.name}:`, err)
    }
  }
}

// ── Registration ──

export function registerPluginHandlers(channelManager: ChannelManager): void {
  setActiveChannelManager(channelManager)
  if (_handlersRegistered) return
  _handlersRegistered = true

  // List available provider descriptors
  registerChannelMessagePackHandler<undefined>('plugin:list-providers', async () => {
    return CHANNEL_PROVIDERS
  })

  // Weixin QR login
  registerChannelMessagePackHandler<{
    pluginId: string
    baseUrl?: string
    routeTag?: string
    accountId?: string
    force?: boolean
  }>('plugin:weixin:login-start', async (args) => {
    try {
      const result = await startWeixinLoginWithQr({
        accountId: args.accountId,
        apiBaseUrl: args.baseUrl || DEFAULT_WEIXIN_BASE_URL,
        routeTag: args.routeTag,
        force: args.force
      })
      return {
        qrDataUrl: await normalizeQrDisplayUrl(
          result.qrcodeUrl,
          args.baseUrl || DEFAULT_WEIXIN_BASE_URL
        ),
        qrUrl: result.qrcodeUrl,
        message: result.message,
        sessionKey: result.sessionKey
      }
    } catch (err) {
      return {
        message: err instanceof Error ? err.message : String(err),
        sessionKey: args.accountId || ''
      }
    }
  })

  registerChannelMessagePackHandler<{
    pluginId: string
    baseUrl?: string
    routeTag?: string
    sessionKey: string
    timeoutMs?: number
  }>('plugin:weixin:login-wait', async (args) => {
    try {
      return await waitForWeixinLogin({
        sessionKey: args.sessionKey,
        apiBaseUrl: args.baseUrl || DEFAULT_WEIXIN_BASE_URL,
        routeTag: args.routeTag,
        timeoutMs: args.timeoutMs
      })
    } catch (err) {
      return {
        connected: false,
        message: err instanceof Error ? err.message : String(err)
      }
    }
  })

  // List persisted plugin instances (global, not per-project)
  registerChannelMessagePackHandler<undefined>('plugin:list', async () => {
    let plugins = await readPlugins()
    let changed = false

    // Deduplicate: keep only one instance per provider type (prefer projectId=null).
    // Old OpenCowork data may have per-project instances that should be removed.
    plugins.sort((a, b) => {
      if (a.projectId && !b.projectId) return 1
      if (!a.projectId && b.projectId) return -1
      return 0
    })
    const _seenTypes = new Set<string>()
    const _deduped = plugins.filter((p) => {
      if (_seenTypes.has(p.type)) return false
      _seenTypes.add(p.type)
      return true
    })
    if (_deduped.length !== plugins.length) {
      plugins = _deduped
      changed = true
    }

    // Auto-seed: ensure each provider type has exactly one global instance
    for (const descriptor of CHANNEL_PROVIDERS) {
      const existing = plugins.find((p) => p.type === descriptor.type)
      if (!existing) {
        const config: Record<string, string> = {}
        for (const field of descriptor.configSchema) {
          config[field.key] =
            descriptor.type === 'weixin-official' && field.key === 'baseUrl'
              ? DEFAULT_WEIXIN_BASE_URL
              : ''
        }
        plugins.push({
          id: nanoid(),
          type: descriptor.type,
          name: descriptor.displayName,
          enabled: false,
          builtin: true,
          config,
          createdAt: Date.now(),
          projectId: null,
          tools: buildToolsMap(descriptor),
          features: { autoReply: true, streamingReply: true, autoStart: false },
          permissions: {
            allowReadHome: false,
            readablePathPrefixes: [],
            allowWriteOutside: false,
            allowShell: false,
            allowSubAgents: false
          }
        })
        changed = true
      } else {
        // Migrate: clear projectId from existing instances (global mode)
        if (existing.projectId) {
          existing.projectId = null
          changed = true
        }
        if (!existing.builtin) {
          existing.builtin = true
          changed = true
        }
        if (existing.name !== descriptor.displayName) {
          existing.name = descriptor.displayName
          changed = true
        }
      }
    }

    // Sync config schema and clean up stale keys
    for (const p of plugins) {
      const desc = CHANNEL_PROVIDERS.find((d) => d.type === p.type)
      if (!desc) continue
      const schemaKeys = new Set(desc.configSchema.map((f) => f.key))
      for (const field of desc.configSchema) {
        if (!(field.key in p.config)) {
          p.config[field.key] =
            desc.type === 'weixin-official' && field.key === 'baseUrl'
              ? DEFAULT_WEIXIN_BASE_URL
              : ''
          changed = true
        }
      }
      if (desc.type === 'weixin-official' && !p.config.baseUrl) {
        p.config.baseUrl = DEFAULT_WEIXIN_BASE_URL
        changed = true
      }
      for (const key of Object.keys(p.config)) {
        if (!schemaKeys.has(key)) {
          delete p.config[key]
          changed = true
        }
      }
      for (const key of Object.keys(p)) {
        if (
          ![
            'id', 'type', 'name', 'enabled', 'builtin', 'config', 'createdAt',
            'projectId', 'tools', 'providerId', 'model', 'features', 'permissions'
          ].includes(key)
        ) {
          delete (p as unknown as Record<string, unknown>)[key]
          changed = true
        }
      }
      const nextTools = buildToolsMap(desc, p.tools)
      if (nextTools && JSON.stringify(nextTools) !== JSON.stringify(p.tools)) {
        p.tools = nextTools
        changed = true
      }
    }

    // Sort by CHANNEL_PROVIDERS order
    plugins.sort((a, b) => {
      const ai = CHANNEL_PROVIDERS.findIndex((d) => d.type === a.type)
      const bi = CHANNEL_PROVIDERS.findIndex((d) => d.type === b.type)
      if (ai === -1 && bi === -1) return 0
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })

    if (changed) await writePlugins(plugins)
    return plugins
  })

  // Add a new plugin instance
  registerChannelMessagePackHandler<ChannelInstance>('plugin:add', async (instance) => {
    const plugins = await readPlugins()
    const desc = CHANNEL_PROVIDERS.find((d) => d.type === instance.type)
    const nextTools = buildToolsMap(desc, instance.tools)
    plugins.push({ ...instance, ...(nextTools ? { tools: nextTools } : {}) })
    await writePlugins(plugins)
    return { success: true }
  })

  // Update a plugin instance
  registerChannelMessagePackHandler<{ id: string; patch: Partial<ChannelInstance> }>(
    'plugin:update',
    async ({ id, patch }) => {
      const plugins = await readPlugins()
      const idx = plugins.findIndex((p) => p.id === id)
      if (idx === -1) return { success: false, error: 'Plugin not found' }
      const next = { ...plugins[idx], ...patch }
      if ('providerId' in patch && patch.providerId == null) {
        next.model = null
      }
      plugins[idx] = next
      await writePlugins(plugins)

      if ('providerId' in patch || 'model' in patch) {
        try {
          const providerId = next.providerId ?? null
          const modelId = providerId ? (next.model ?? null) : null
          assertNativeMutation(
            await requestNativeDb<NativePluginSessionMutationResult>(
              'db/plugin-sync-session-models',
              { pluginId: id, providerId, modelId }
            ),
            'Sync channel session model'
          )
        } catch (err) {
          console.error('[Channels] Failed to sync channel session model:', err)
        }
      }

      return { success: true }
    }
  )

  // Remove a plugin instance
  registerChannelMessagePackHandler<string>('plugin:remove', async (id) => {
    const allPlugins = await readPlugins()
    const target = allPlugins.find((p) => p.id === id)
    if (target?.builtin) {
      return { success: false, error: 'Built-in plugins cannot be removed' }
    }
    await channelManager.stopPlugin(id)
    const plugins = allPlugins.filter((p) => p.id !== id)
    await writePlugins(plugins)
    try {
      assertNativeMutation(
        await requestNativeDb<NativePluginSessionMutationResult>('db/plugin-remove-data', {
          pluginId: id
        }),
        'Remove channel data'
      )
    } catch (err) {
      console.error('[Channels] Failed to cascade-delete sessions:', err)
    }
    return { success: true }
  })

  // Start / Stop / Status
  registerChannelMessagePackHandler<string>('plugin:start', async (id) => {
    const plugins = await readPlugins()
    const instance = plugins.find((p) => p.id === id)
    if (!instance) return { success: false, error: 'Plugin not found' }
    try {
      await channelManager.startPlugin(instance, notifyRenderer)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  registerChannelMessagePackHandler<string>('plugin:stop', async (id) => {
    await channelManager.stopPlugin(id)
    return { success: true }
  })

  registerChannelMessagePackHandler<string>('plugin:status', async (id) => {
    return channelManager.getStatus(id)
  })

  // Unified action dispatch
  registerChannelMessagePackHandler<{
    pluginId: string
    action: string
    params: Record<string, unknown>
  }>('plugin:exec', async ({ pluginId, action, params }) => {
    return await executePluginAction({ pluginId, action, params })
  })

  // ── Plugin Session Management (extracted) ──
  registerPluginSessionHandlers()

  // ── Streaming output IPC (extracted) ──
  registerPluginStreamHandlers(channelManager)
}
