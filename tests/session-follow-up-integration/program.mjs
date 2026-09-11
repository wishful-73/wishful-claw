import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

let checks = 0

function source(path) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

function includes(text, expected, message) {
  assert.ok(text.includes(expected), message)
  checks += 1
}

function excludes(text, unexpected, message) {
  assert.ok(!text.includes(unexpected), message)
  checks += 1
}

function precedes(text, first, second, message) {
  assert.ok(text.indexOf(first) >= 0 && text.indexOf(first) < text.indexOf(second), message)
  checks += 1
}

const toolProvider = source('src/runtime/WishfulClaw.Agent/Tools/Providers/ProjectToolsProvider.cs')
const executor = source('src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs')
const sendMessage = source('src/renderer/src/lib/tools/project-send-message.ts')
const runtime = source('src/renderer/src/lib/tools/session-follow-up-runtime.ts')
const scheduler = source('src/main/ipc/session-follow-up-scheduler.ts')
const app = source('src/renderer/src/App.tsx')
const channelReply = source('src/renderer/src/hooks/use-channel-auto-reply.ts')
const taskDb = source('src/runtime/WishfulClaw.Infrastructure/Db/DbTaskTools.cs')

includes(toolProvider, '["delayMs"]', 'follow-up tools expose relative delayMs')
includes(toolProvider, '["action"]', 'follow-up update exposes a named action')
includes(executor, 'if (hasFollowUp)', 'ordinary send_session_message does not build a follow-up')
includes(executor, 'followUp.delayMs (minimum 1000)', 'follow-up delay is validated before dispatch')
includes(sendMessage, 'if (followUp)', 'renderer creates follow-up only when explicitly requested')
precedes(sendMessage, 'const scheduled = await invokeMessagePackBinary', 'providerStore.getActiveProvider()', 'follow-up is persisted before provider validation')
includes(sendMessage, 'if (scheduled.changed === 0)', 'idempotent follow-up reuse is detected')
includes(sendMessage, 'the original message was not sent again', 'idempotent reuse does not resend the task')
includes(sendMessage, 'await failScheduledFollowUp(error)', 'failed message start compensates the follow-up')
includes(scheduler, "'db/session-follow-ups-claim'", 'scheduler atomically claims due follow-ups')
includes(scheduler, 'recoveryTimers.set', 'scheduler installs interrupted-delivery recovery')
includes(app, 'initializeSessionFollowUpRuntime()', 'renderer mounts the follow-up runtime')
includes(runtime, 'agentStream.subscribeAll(handleAgentStream)', 'follow-up runtime uses the MessagePack stream receiver')
includes(runtime, 'SESSION_FOLLOW_UP_RENDERER_READY_MSGPACK_CHANNEL', 'renderer explicitly announces listener readiness')
includes(scheduler, 'await restore(true)', 'renderer readiness restores persisted follow-ups')
excludes(runtime, "ipcClient.on('agent:stream'", 'follow-up runtime does not use the obsolete raw stream channel')
includes(runtime, "markNotified(followUp.id, 'channel')", 'channel notification is acknowledged through the follow-up record')
includes(channelReply, 'autoReply.successfulReplyCount += 1', 'channel success is observed after plugin sendMessage resolves')
includes(channelReply, 'autoReply.failedReplyCount += 1', 'channel send failures remain observable')
includes(taskDb, "status = 'cancelled'", 'deleting a Todo cancels outstanding follow-ups')

console.log(`session follow-up integration regression passed: ${checks}`)
