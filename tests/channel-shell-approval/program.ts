/*
 * The rules behind channel-side shell approval.
 *
 * They live in a store-free module so they can be loaded here at all, and they
 * decide something the user cannot see failing: whether a channel run waits for
 * a reply at all, misreads an unrelated message as a verdict, or hangs forever.
 * The hang is the defect this module exists to fix.
 */

import assert from 'node:assert/strict'
import {
  buildShellApprovalPrompt,
  cancelAllPendingChannelShellApprovals,
  hasPendingChannelShellApproval,
  parseShellApprovalVerdict,
  requestChannelShellApproval,
  resolvePendingChannelShellApproval
} from '../../src/renderer/src/lib/channel/channel-shell-approval'

let checks = 0

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.deepStrictEqual(actual, expected, `${message} (got ${JSON.stringify(actual)})`)
}

function check(condition: boolean, message: string): void {
  checks++
  assert.ok(condition, message)
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function main(): Promise<void> {
  // ── Verdict parsing ──

  for (const word of ['同意', '批准', '允许', '是', 'yes', 'Y', 'ok', 'OK', '1', ' 同意 ']) {
    eq(parseShellApprovalVerdict(word), true, `"${word}" reads as approval`)
  }

  for (const word of ['拒绝', '取消', '否', 'no', 'N', '0', ' 拒绝 ']) {
    eq(parseShellApprovalVerdict(word), false, `"${word}" reads as rejection`)
  }

  for (const word of ['', '   ', '你好', '同意吗', 'yes please', 'run it']) {
    eq(parseShellApprovalVerdict(word), null, `"${word}" is not a verdict`)
  }

  // ── Nothing pending ──

  eq(hasPendingChannelShellApproval('session-none'), false, 'no approval starts pending')
  eq(
    resolvePendingChannelShellApproval('session-none', '同意'),
    false,
    'a reply with nothing pending resolves nothing'
  )

  // ── A verdict resolves the pending approval ──

  const sent: string[] = []
  const send = async (message: string): Promise<void> => {
    sent.push(message)
  }

  const pending = requestChannelShellApproval({
    sessionId: 'session-a',
    toolCallId: 'call-1',
    toolName: 'Bash',
    summary: 'rm -rf build',
    send
  })

  eq(hasPendingChannelShellApproval('session-a'), true, 'the request becomes pending')
  eq(sent.length, 1, 'the prompt reaches the channel immediately')
  check((sent[0] ?? '').includes('rm -rf build'), 'the prompt carries the command summary')
  check((sent[0] ?? '').includes('同意'), 'the prompt tells the user how to answer')

  eq(
    resolvePendingChannelShellApproval('session-a', '帮我看下别的'),
    false,
    'a non-verdict message does not resolve the approval'
  )
  eq(
    hasPendingChannelShellApproval('session-a'),
    true,
    'the approval survives a non-verdict message, which must reach the normal path'
  )

  eq(resolvePendingChannelShellApproval('session-a', '同意'), true, 'a verdict resolves the approval')
  eq(hasPendingChannelShellApproval('session-a'), false, 'a resolved approval is no longer pending')
  eq(await pending, true, 'approval resolves to true')
  await flush()
  check((sent[sent.length - 1] ?? '').includes('已同意'), 'the channel is told the verdict')

  // ── Rejection ──

  const rejected = requestChannelShellApproval({
    sessionId: 'session-b',
    toolCallId: 'call-2',
    toolName: 'PowerShell',
    summary: '',
    send
  })
  eq(await (async () => {
    const consumed = resolvePendingChannelShellApproval('session-b', '拒绝')
    return [consumed, await rejected]
  })(), [true, false], 'a rejection resolves to false')

  // ── A reply from another session resolves nothing ──

  const other = requestChannelShellApproval({
    sessionId: 'session-d',
    toolCallId: 'call-5',
    toolName: 'Bash',
    summary: '',
    send
  })
  eq(
    resolvePendingChannelShellApproval('session-elsewhere', '同意'),
    false,
    'a verdict from a different session resolves nothing'
  )
  eq(resolvePendingChannelShellApproval('session-d', '同意'), true, 'the owning session resolves it')
  eq(await other, true, 'the owning session sees the verdict')

  // ── A second request supersedes a stale pending one ──

  const first = requestChannelShellApproval({
    sessionId: 'session-c',
    toolCallId: 'call-3',
    toolName: 'Bash',
    summary: '',
    send
  })
  const second = requestChannelShellApproval({
    sessionId: 'session-c',
    toolCallId: 'call-4',
    toolName: 'Bash',
    summary: '',
    send
  })
  eq(await first, false, 'a superseded approval resolves to false')
  eq(resolvePendingChannelShellApproval('session-c', '同意'), true, 'the replacement is the live one')
  eq(await second, true, 'the replacement carries the verdict')

  // ── Teardown ──

  void requestChannelShellApproval({
    sessionId: 'session-e',
    toolCallId: 'call-6',
    toolName: 'Bash',
    summary: '',
    send
  })
  cancelAllPendingChannelShellApprovals()
  eq(hasPendingChannelShellApproval('session-e'), false, 'teardown drops every pending approval')

  // ── Prompt shape ──

  check(buildShellApprovalPrompt('Bash', '').includes('Bash'), 'the prompt names the tool')
  check(
    buildShellApprovalPrompt('Bash', 'echo hi').includes('echo hi'),
    'the prompt includes the summary when there is one'
  )
}

main().then(
  () => {
    console.log(`Channel shell approval checks passed: ${checks}`)
  },
  (error) => {
    console.error(error)
    process.exitCode = 1
  }
)
