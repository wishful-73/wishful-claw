/**
 * Plugin Command System — dispatcher & public API.
 *
 * Handles slash commands sent by users through messaging plugins.
 * Commands are intercepted before the agent loop and handled directly
 * in the main process, replying via the plugin service.
 *
 * Handler implementations live in plugin-command-handlers.ts.
 */

import {
  type CommandContext,
  type CommandHandler,
  handleHelp,
  handleNew,
  handleInit,
  handleStatus,
  handleCompress,
  handleStats
} from './plugin-command-handlers'
import { stripLeadingAtMention } from './channel-cancel-commands'

// Re-export shared types for external consumers
export type { CommandContext, CommandResult, CommandHandler } from './plugin-command-handlers'
export { isChannelCancelCommand } from './channel-cancel-commands'

// ── Command Registry ──

const commands = new Map<string, CommandHandler>()

commands.set('help', handleHelp)
commands.set('new', handleNew)
commands.set('init', handleInit)
commands.set('status', handleStatus)
commands.set('compress', handleCompress)
commands.set('stats', handleStats)

// ── Utilities ──

/**
 * Strip leading @mention prefixes from message content.
 * In group chats, messages often arrive as "@BotName /command args".
 */
function stripAtMention(content: string): string {
  let stripped = stripLeadingAtMention(content)

  if (!stripped.startsWith('/') && content.includes('/')) {
    const slashIdx = content.indexOf('/')
    stripped = content.slice(slashIdx).trim()
  }

  return stripped
}

// ── Public API ──

/**
 * Try to handle a slash command from the incoming message.
 * Returns:
 *   - `true`    — command was fully handled (skip agent loop)
 *   - `false`   — not a command, proceed normally
 *   - `string`  — command rewrote the message content; pass this string
 *                  to the agent loop instead of the original message
 */
export async function tryHandleCommand(ctx: CommandContext): Promise<boolean | string> {
  const raw = ctx.data.content?.trim()
  if (!raw) return false

  const content = stripAtMention(raw)
  if (!content.startsWith('/')) return false

  console.log(
    `[PluginCommand] Detected command in raw="${raw.slice(0, 80)}" → parsed="${content.slice(0, 80)}"`
  )

  const spaceIdx = content.indexOf(' ')
  const cmd = (spaceIdx === -1 ? content.slice(1) : content.slice(1, spaceIdx)).toLowerCase()
  const args = spaceIdx === -1 ? '' : content.slice(spaceIdx + 1).trim()

  const handler = commands.get(cmd)
  if (!handler) return false

  const result = await handler(ctx, args)

  if (result.rewriteContent) {
    if (result.reply) {
      const service = ctx.pluginManager.getService(ctx.pluginId)
      if (service) {
        const send =
          ctx.pluginType === 'qq-bot' && ctx.data.messageId
            ? service.replyMessage(ctx.data.messageId, result.reply)
            : service.sendMessage(ctx.chatId, result.reply)
        send.catch((err) => {
          console.error(`[PluginCommand] Failed to send ack for /${cmd}:`, err)
        })
      }
    }
    console.log(
      `[PluginCommand] /${cmd} delegating to agent loop for plugin ${ctx.pluginId} chat ${ctx.chatId}`
    )
    return result.rewriteContent
  }

  if (!result.handled) return false

  if (result.reply) {
    const service = ctx.pluginManager.getService(ctx.pluginId)
    if (service) {
      const send =
        ctx.pluginType === 'qq-bot' && ctx.data.messageId
          ? service.replyMessage(ctx.data.messageId, result.reply)
          : service.sendMessage(ctx.chatId, result.reply)
      send.catch((err) => {
        console.error(`[PluginCommand] Failed to send reply for /${cmd}:`, err)
      })
    } else {
      console.warn(`[PluginCommand] No service found for plugin ${ctx.pluginId}, cannot reply`)
    }
  }

  console.log(`[PluginCommand] Handled /${cmd} for plugin ${ctx.pluginId} chat ${ctx.chatId}`)
  return true
}
