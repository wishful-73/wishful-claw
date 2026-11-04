/**
 * S-291：渠道回执的「本次运行区间」取值（纯函数）。
 *
 * 背景：本轮没有任何流式输出时，回执层原先会从**整条会话历史**倒序找最后一条
 * assistant 消息当本次结果 —— 一路翻到上一轮、甚至昨晚那条，于是「昨晚收到一条、
 * 早上又收到一条，内容重复」。
 *
 * 修法：注册回执时记下「本次运行开始前已有多少条消息」，兜底只在这个区间里找；
 * 区间内也没有文本，就返回空串，由调用方回一句明确说明 —— 绝不把历史当本次结果。
 *
 * 抽成纯函数是为了能在 node 下钉死：hook 本身依赖 electron IPC，起不来。
 */

export interface RunReplyMessage {
  role: string
  isStreaming?: boolean
  text?: string
  content?: unknown
}

/** 从消息里取纯文本（字符串 content / 块数组里的 text 块）。 */
export function extractTextFromContent(msg: RunReplyMessage): string {
  if (!msg.content) return ''
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((block): block is { type: string; text?: string } => {
        return typeof block === 'object' && block !== null && (block as { type?: string }).type === 'text'
      })
      .map((block) => block.text ?? '')
      .join('')
  }
  return ''
}

/**
 * 只在 `baseline` 之后的区间里倒序找最后一条**已结束且有文本**的 assistant 消息。
 *
 * `baseline` 超出当前长度（消息被清空 / 重新加载过）时按「空区间」处理，返回空串。
 * 这一侧刻意选保守：宁可这一轮少推一条，也不把历史内容当本次结果推出去 —— 后者
 * 正是 S-291 的现场（早上收到昨晚那条）。区间内没文本时由调用方回一句明确说明。
 */
export function pickRunReplyText(
  messages: readonly RunReplyMessage[],
  baseline: number
): string {
  const start = Math.min(Math.max(baseline, 0), messages.length)
  for (let i = messages.length - 1; i >= start; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant' || msg.isStreaming) continue
    const text = msg.text || extractTextFromContent(msg)
    if (text) return text
  }
  return ''
}
