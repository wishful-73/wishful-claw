/**
 * S-207：agent 申请「临时关闭沙箱模式」的渲染端处理器。
 *
 * Worker 的 RequestSandboxElevation 执行器发一条 reverse-request（sandbox/elevation-request）
 * 过来，这里负责让用户裁决：
 * - 桌面会话 → 独立确认弹窗（confirm）；
 * - 渠道会话（channelSession === true，无桌面 UI）→ 把请求文案发回渠道，用户回「同意 / 拒绝」
 *   由 channel-shell-approval 的文字审批机制裁决。
 *
 * 批准后把到期时刻写进 sandbox-elevation-store 驱动倒计时；真正的放行是 Worker 侧的
 * SandboxElevationStore（进程级、1 小时）。沙箱在 YOLO 之上，这个申请不受权限模式豁免。
 */

import { confirm } from '@renderer/components/ui/confirm-dialog'
import i18n from '@renderer/locales'
import { useChatStore } from '@renderer/stores/chat-store'
import { ipcClient } from '@renderer/lib/ipc/ipc-client'
import { IPC } from '@renderer/lib/ipc/channels'
import {
  requestChannelShellApproval,
  SHELL_APPROVAL_TIMEOUT_MS
} from '@renderer/lib/channel/channel-shell-approval'
import {
  SANDBOX_ELEVATION_DURATION_MS,
  useSandboxElevationStore
} from '@renderer/stores/sandbox-elevation-store'

/** 豁免时长与审批超时的分钟数——文案里的数字全部从这里推，不写字面量。 */
const ELEVATION_HOURS = SANDBOX_ELEVATION_DURATION_MS / (60 * 60 * 1000)
const APPROVAL_TIMEOUT_MINUTES = SHELL_APPROVAL_TIMEOUT_MS / (60 * 1000)

/** 文案统一走 i18n（`agent` 命名空间的 sandboxElevation 段）。 */
function tr(key: string, options: Record<string, unknown> = {}): string {
  return i18n.t(`sandboxElevation.${key}`, { ns: 'agent', ...options })
}

/** Worker 侧带过来的字段，与 AgentRuntimeSandboxElevationExecutor.BuildRequest 对齐。 */
export interface SandboxElevationRequest {
  toolUseId: string
  sessionId?: string
  runId?: string
  reason?: string
  channelSession?: boolean
}

export async function handleSandboxElevationRequest(
  params: unknown
): Promise<{ approved: boolean }> {
  const record = isRecord(params) ? params : {}
  // Worker 发的是 toolUseId，但兼容 toolCallId，免得日后换了个字段名就静默拿不到 id。
  const toolCallId = firstNonEmptyString(record.toolUseId, record.toolCallId)
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId.trim() : ''
  const reason = typeof record.reason === 'string' ? record.reason.trim() : ''

  if (!toolCallId) {
    return { approved: false }
  }

  if (record.channelSession === true) {
    return await handleChannelRequest({ sessionId, toolCallId, reason })
  }

  const approved = await confirm({
    title: tr('dialogTitle', { defaultValue: '请求临时关闭沙箱模式' }),
    description: buildDesktopDescription(reason),
    confirmLabel: tr('dialogConfirm', {
      defaultValue: '临时关闭（{{hours}} 小时）',
      hours: ELEVATION_HOURS
    }),
    cancelLabel: tr('dialogCancel', { defaultValue: '保持开启' }),
    variant: 'warning',
    // 并发弹窗按到达顺序展示（与工具卡片顺序一致）。
    sequence: Date.now()
  })

  if (approved) {
    grantLocal()
  }
  return { approved }
}

/** 渠道会话：没有可点的弹窗，把请求文本发回渠道，用文字审批裁决。 */
async function handleChannelRequest(input: {
  sessionId: string
  toolCallId: string
  reason: string
}): Promise<{ approved: boolean }> {
  const { sessionId, toolCallId, reason } = input
  const session = useChatStore.getState().sessions.find((item) => item.id === sessionId)
  const pluginId = session?.pluginId
  const chatId = session?.externalChatId
  if (!sessionId || !pluginId || !chatId) {
    return { approved: false }
  }

  const summary = reason
    ? tr('channelSummaryWithReason', {
        defaultValue: 'Agent 想访问工作目录外的路径。理由：{{reason}}',
        reason
      })
    : tr('channelSummary', {
        defaultValue: 'Agent 想访问工作目录外的路径，需要你批准临时关闭沙箱模式。'
      })

  const approved = await requestChannelShellApproval({
    sessionId,
    toolCallId,
    toolName: 'RequestSandboxElevation',
    summary,
    prompt: buildChannelPrompt(summary),
    send: async (message) => {
      try {
        await ipcClient.invoke(IPC.PLUGIN_EXEC, {
          pluginId,
          action: 'sendMessage',
          params: { chatId, content: message }
        })
      } catch (error) {
        console.error('[SandboxElevation] Failed to relay channel approval:', error)
      }
    }
  })

  if (approved) {
    grantLocal()
  }
  return { approved }
}

/**
 * 写本地到期时刻。商店状态只是倒计时 UI（渠道会话本就不显示那条 chip，写了也无害），
 * 真正的放行以 Worker 侧的批准结果为准。
 */
function grantLocal(): void {
  useSandboxElevationStore.getState().grant(Date.now() + SANDBOX_ELEVATION_DURATION_MS)
}

function buildDesktopDescription(reason: string): string {
  return reason
    ? tr('dialogDescriptionWithReason', {
        defaultValue:
          'Agent 想访问工作目录之外的路径，请批准临时关闭沙箱模式。' +
          '批准后 {{hours}} 小时内，本机所有会话都可以访问工作目录之外的路径；到期自动恢复，你也可以随时手动恢复。\n\n理由：{{reason}}',
        hours: ELEVATION_HOURS,
        reason
      })
    : tr('dialogDescription', {
        defaultValue:
          'Agent 想访问工作目录之外的路径，请批准临时关闭沙箱模式。' +
          '批准后 {{hours}} 小时内，本机所有会话都可以访问工作目录之外的路径；到期自动恢复，你也可以随时手动恢复。',
        hours: ELEVATION_HOURS
      })
}

function buildChannelPrompt(summary: string): string {
  return tr('channelPrompt', {
    defaultValue:
      'Agent 请求临时关闭沙箱模式（RequestSandboxElevation），需要你确认：\n\n{{summary}}\n\n' +
      '批准后 {{hours}} 小时内，本机所有会话都可以访问工作目录之外的路径；到期自动恢复，也可随时手动恢复。\n\n' +
      '回复「同意」批准，回复「拒绝」保持开启。{{minutes}} 分钟内未回复将按拒绝处理。',
    summary,
    hours: ELEVATION_HOURS,
    minutes: APPROVAL_TIMEOUT_MINUTES
  })
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
