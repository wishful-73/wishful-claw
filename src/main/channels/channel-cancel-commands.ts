/**
 * Recognize channel-side cancellation commands before they enter the Agent Loop.
 * Keep this intentionally exact so ordinary user text containing these words is
 * not accidentally treated as a cancellation request.
 */
const CHANNEL_CANCEL_COMMANDS = new Set([
  '取消',
  '取消执行',
  '停止',
  '停止执行',
  '终止',
  '终止执行',
  '中断',
  '中断执行',
  '/cancel',
  '/canel',
  '/stop',
  '/interrupt'
])

export function stripLeadingAtMention(content: string): string {
  return content.replace(/^(?:<@[^>]+>\s*|@\S+\s*)+/, '').trim()
}

export function isChannelCancelCommand(content?: string): boolean {
  if (!content) return false

  const normalized = stripLeadingAtMention(content.trim())
    .toLowerCase()
    .replace(/\s+/g, '')

  return CHANNEL_CANCEL_COMMANDS.has(normalized)
}
