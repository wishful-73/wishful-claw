import { randomUUID } from 'crypto'
import { getNativeWorker } from '../lib/native-worker'
import { readChannelPlugins } from './channel-config-store'
import { safeSendMessagePackToAllWindows } from '../window-ipc'
import type { ChannelEvent, ChannelInstance, ChannelIncomingMessageData } from './channel-types'
import type { ChannelManager } from './channel-manager'
import { isChannelCancelCommand, tryHandleCommand } from './plugin-commands'

interface NativePluginRouteSessionResult {
  success: boolean
  sessionId?: string | null
  sessionTitle?: string | null
  projectId?: string | null
  workingFolder?: string | null
  sshConnectionId?: string | null
  error?: string | null
}

let _pluginManager: ChannelManager | null = null

interface QueuedChannelEvent {
  id: string
  event: ChannelEvent
}

const channelEventQueues = new Map<string, QueuedChannelEvent[]>()
const activeChannelTasks = new Map<string, string>()
const activeChannelTaskSessions = new Map<string, string>()
const pendingChannelCancels = new Set<string>()
const channelTaskQueueKeys = new Map<string, string>()

const CHANNEL_DISPLAY_NAMES: Record<string, string> = {
  'feishu-bot': '飞书',
  'weixin-official': '微信',
  'qq-bot': 'QQ',
  'dingtalk-bot': '钉钉',
  'wecom-bot': '企业微信',
  'telegram-bot': 'Telegram',
  'discord-bot': 'Discord',
  'whatsapp-bot': 'WhatsApp'
}

function buildInitialChannelSessionTitle(pluginType: string, botName?: string): string {
  const prefix = CHANNEL_DISPLAY_NAMES[pluginType] ?? ''
  const normalizedBotName = botName?.trim()
  if (!prefix) return normalizedBotName || `${pluginType}对话`
  return normalizedBotName ? `${prefix}:${normalizedBotName}` : `${prefix}对话`
}

/** Must be called once at startup to wire the plugin manager */
export function setPluginManager(pm: ChannelManager): void {
  _pluginManager = pm
}

/**
 * Handle a channel-side cancellation before it enters the serialized Agent queue.
 * The renderer owns the runId, so it receives the stable session target and reuses
 * the exact same cancelStream path as the desktop stop button.
 */
async function handleChannelCancel(event: ChannelEvent): Promise<void> {
  const data = event.data as ChannelIncomingMessageData
  const queueKey = `${event.pluginId}:${data.chatId}`
  const activeTaskId = activeChannelTasks.get(queueKey)
  const queuedEvents = channelEventQueues.get(queueKey)
  const hasWork = Boolean(activeTaskId || queuedEvents?.length)

  if (queuedEvents?.length) {
    channelEventQueues.delete(queueKey)
  }

  if (activeTaskId) {
    pendingChannelCancels.add(queueKey)
    const sessionId = activeChannelTaskSessions.get(activeTaskId)
    if (sessionId) {
      safeSendMessagePackToAllWindows('plugin:session-cancel', {
        pluginId: event.pluginId,
        chatId: data.chatId,
        sessionId,
        taskId: activeTaskId
      })
    }
  }

  const service = _pluginManager?.getService(event.pluginId)
  if (!service) return

  const reply = hasWork ? '已停止执行。' : '当前没有正在执行的任务。'
  try {
    await service.sendMessage(data.chatId, reply)
  } catch (err) {
    console.error('[AutoReply] Failed to send cancellation reply:', err)
  }
}

/**
 * Auto-reply pipeline: routes incoming plugin messages to per-user/per-group sessions
 * and notifies the renderer to trigger the Agent Loop for auto-reply.
 */
export function handleChannelAutoReply(event: ChannelEvent): void {
  if (event.type !== 'incoming_message') return

  const data = event.data as ChannelIncomingMessageData
  if (!data || !data.chatId || (!data.content && !data.images?.length && !data.audio)) return

  if (isChannelCancelCommand(data.content)) {
    void handleChannelCancel(event)
    return
  }

  const queueKey = `${event.pluginId}:${data.chatId}`
  const queue = channelEventQueues.get(queueKey) ?? []
  queue.push({ id: randomUUID(), event })
  channelEventQueues.set(queueKey, queue)
  void dispatchNextChannelEvent(queueKey)
}

export function completeChannelAutoReplyTask(taskId: string): boolean {
  const queueKey = channelTaskQueueKeys.get(taskId)
  if (!queueKey || activeChannelTasks.get(queueKey) !== taskId) return false

  channelTaskQueueKeys.delete(taskId)
  activeChannelTaskSessions.delete(taskId)
  pendingChannelCancels.delete(queueKey)
  activeChannelTasks.delete(queueKey)
  void dispatchNextChannelEvent(queueKey)
  return true
}

async function dispatchNextChannelEvent(queueKey: string): Promise<void> {
  if (activeChannelTasks.has(queueKey)) return

  const queue = channelEventQueues.get(queueKey)
  const queued = queue?.shift()
  if (!queued) {
    channelEventQueues.delete(queueKey)
    return
  }
  if (queue?.length === 0) {
    channelEventQueues.delete(queueKey)
  }

  activeChannelTasks.set(queueKey, queued.id)
  channelTaskQueueKeys.set(queued.id, queueKey)

  const dispatched = await handleChannelAutoReplyAsync(queued.event, queued.id)
  if (!dispatched) {
    completeChannelAutoReplyTask(queued.id)
  }
}

async function handleChannelAutoReplyAsync(event: ChannelEvent, channelTaskId: string): Promise<boolean> {
  const data = event.data as ChannelIncomingMessageData
  const pluginId = event.pluginId

  try {
    let pluginInstance: ChannelInstance | undefined
    try {
      const plugins = await readChannelPlugins()
      pluginInstance = plugins.find((p) => p.id === pluginId)
    } catch {
      /* ignore read errors */
    }

    const routedSession = await getNativeWorker().request<NativePluginRouteSessionResult>(
      'db/plugin-route-session',
      {
        pluginId,
        pluginType: event.pluginType,
        chatId: data.chatId,
        chatType: data.chatType ?? null,
        initialTitle: buildInitialChannelSessionTitle(
          event.pluginType,
          _pluginManager?.getService(pluginId)?.botName || pluginInstance?.name
        ),
        chatName: data.chatName ?? null,
        senderName: data.senderName ?? null,
        projectId: null,
        providerId: pluginInstance?.providerId ?? null,
        modelId: pluginInstance?.model ?? null
      },
      120_000
    )

    if (!routedSession.success || !routedSession.sessionId) {
      throw new Error(routedSession.error || 'Native plugin session routing failed')
    }

    const sessionId = routedSession.sessionId
    const queueKey = `${pluginId}:${data.chatId}`
    const hadSessionBeforeCancel = activeChannelTaskSessions.has(channelTaskId)
    const cancelWasPending = pendingChannelCancels.has(queueKey)
    activeChannelTaskSessions.set(channelTaskId, sessionId)
    if (cancelWasPending && !hadSessionBeforeCancel) {
      // A cancel command may arrive while this task is still being routed. Do
      // not dispatch a new Agent run after the user has already cancelled it.
      pendingChannelCancels.delete(queueKey)
      return false
    }
    // The Worker creates the title once; every later message reuses the stored title.
    const sessionTitle =
      routedSession.sessionTitle || buildInitialChannelSessionTitle(event.pluginType, pluginInstance?.name)
    const pluginWorkDir = routedSession.workingFolder ?? ''
    const pluginSshConnectionId = routedSession.sshConnectionId ?? null

    // ── Command interception: handle /help, /new, /init, /status etc. before agent loop ──
    // Always attempt command parsing — tryHandleCommand handles @mention stripping internally
    if (_pluginManager && data.content?.trim()) {
      const commandResult = await tryHandleCommand({
        pluginId,
        pluginType: event.pluginType,
        chatId: data.chatId,
        data,
        sessionId,
        pluginWorkDir,
        pluginManager: _pluginManager
      })
      // true = fully handled, skip agent loop
      if (commandResult === true) return false
      // string = command rewrote the message, pass to agent loop with new content
      if (typeof commandResult === 'string') {
        data.content = commandResult
      }
      // false = not a command, proceed with original content
    }

    // Re-check after awaited command handling; cancellation may have arrived
    // while routing this task and must prevent the Agent event from being sent.
    if (pendingChannelCancels.delete(queueKey)) {
      return false
    }

    // NOTE: We do NOT insert the user message here — the renderer's sendMessage
    // will handle it (via triggerSendMessage) to avoid duplicate messages and
    // ensure proper multi-modal content handling.

    // Check if the plugin service supports streaming
    const service = _pluginManager?.getService(pluginId)
    const supportsStreaming = !!(service?.supportsStreaming && service?.sendStreamingMessage)

    // Notify renderer to trigger Agent Loop auto-reply
    const taskPayload = {
      channelTaskId,
      sessionId,
      pluginId,
      pluginType: event.pluginType,
      chatId: data.chatId,
      senderId: data.senderId,
      senderName: data.senderName,
      chatName: data.chatName,
      sessionTitle,
      content:
        data.content ||
        (data.images?.length ? '[User sent an image]' : '') ||
        (data.audio ? '[User sent an audio message]' : ''),
      messageId: data.messageId,
      supportsStreaming,
      images: data.images,
      audio: data.audio,
      chatType: data.chatType,
      projectId: routedSession.projectId ?? undefined,
      workingFolder: pluginWorkDir || undefined,
      sshConnectionId: pluginSshConnectionId
    }
    safeSendMessagePackToAllWindows('plugin:session-task', taskPayload)

    console.log(
      `[AutoReply] Routed message from ${data.senderName || data.senderId} ` +
        `in chat ${data.chatId} to session ${sessionId}`
    )
    return true
  } catch (err) {
    console.error('[AutoReply] Failed to route incoming message:', err)
    return false
  }
}
