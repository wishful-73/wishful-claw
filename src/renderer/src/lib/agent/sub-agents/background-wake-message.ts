/**
 * 后台子 agent 完成后的唤醒消息。
 *
 * 它有两个身份：一是发给模型的一轮新输入（主 run 早已 finalize，只能靠新起一轮把
 * 报告交回去），二是聊天窗里的一条记录。它**绝不能**渲染成用户气泡 —— 用户没发过
 * 这条消息。
 *
 * 所以格式在这里只定义一次，生产端（唤醒 hook）和消费端（消息渲染）共用。前缀形状
 * 与 MessageItem 的 AgentWakeNotification 解析规则绑定，改这里是唯一的入口。
 */

import type { UnifiedMessage } from '@renderer/lib/api/types'
import { extractUnifiedMessageText } from '@renderer/lib/agent/context-compression'

/** 卡片识别用的前缀。解析方只看行首这一段的形状。 */
const WAKE_PREFIX_PATTERN = /^\[Background sub-agent (.+?)\]:\n?/

/**
 * 尾部的指令句：告诉模型这一轮是「子 agent 交回报告」而不是用户新指令。
 * 不点明的话它可能当成一段普通上下文读完就停。
 */
const WAKE_TRAILER = '后台子 agent 已完成，请基于上面的报告继续处理，如有需要可向用户总结结果。'

/** 前缀里解析不出名字时的兜底。 */
const FALLBACK_AGENT_NAME = 'sub-agent'

/** 构造唤醒消息正文。`agentName` 为空时用兜底名，保证前缀始终可解析。 */
export function buildBackgroundWakeMessage(agentName: string, reportText: string): string {
  const name = agentName.trim() || FALLBACK_AGENT_NAME
  return `[Background sub-agent ${name}]:\n${reportText}\n\n${WAKE_TRAILER}`
}

/**
 * 这条消息是不是后台子 agent 唤醒消息。
 *
 * 按内容前缀判定而不是靠 meta 标记：落库链路里 meta 和 content 都完整保留，但内容
 * 判定能顺带把已经存在的老消息也修对，不必等它被重新生成。
 */
export function isBackgroundWakeMessage(message: UnifiedMessage | null | undefined): boolean {
  if (!message || message.role !== 'user') return false
  return WAKE_PREFIX_PATTERN.test(extractUnifiedMessageText(message))
}

/**
 * 剥掉尾部的指令句，只留给人看的部分。
 *
 * 指令是写给模型的，卡片里显示出来纯属噪音。仅当尾部确实是那一句时才剥，避免误伤
 * 报告正文（报告由子 agent 生成，理论上可能以任意文本结尾）。
 */
export function stripBackgroundWakeTrailer(text: string): string {
  const trimmed = text.trimEnd()
  if (!trimmed.endsWith(WAKE_TRAILER)) return text
  return trimmed.slice(0, -WAKE_TRAILER.length).trimEnd()
}

/**
 * 从 Worker 的通知信封里取子 agent 名。
 *
 * 信封由 SubAgentExecutor.Background.cs 的 BuildSubAgentCompletionMessage 生成，带一行
 * `  Agent: <名字>`。取不到就返回空串，由调用方决定兜底 —— Worker 换格式时不该让唤醒
 * 整个失败。
 */
export function extractWorkerReportAgentName(reportText: string): string {
  return /^[ \t]*Agent:[ \t]*(.+?)[ \t]*$/m.exec(reportText)?.[1] ?? ''
}

/**
 * 卡片标题。优先用任务描述，与右侧面板 SubAgentsPanel 的子 agent tab 标题同口径
 * （描述 → 名字）：agent 名常常只是一个没有信息量的类型名，实测出现过 "custom"，
 * 拿它当标题等于什么也没说。
 *
 * 只认第一个匹配 —— 信封排在正文之前，报告正文里若恰好也有 "Description:" 不会抢到。
 * 描述为空时回落到名字。
 */
export function resolveBackgroundWakeTitle(content: string, fallbackName: string): string {
  const description = /^[ \t]*Description:[ \t]*(.+?)[ \t]*$/m.exec(content)?.[1]
  return description?.trim() || fallbackName
}
