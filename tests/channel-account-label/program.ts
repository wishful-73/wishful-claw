/*
 * What a collapsed channel row shows as its account identifier.
 *
 * The summary row exists so that "which account is this bound to?" is answerable without
 * opening the block — so what it picks matters, and so does what it refuses to pick.
 */

import assert from 'node:assert/strict'
import { channelAccountLabel } from '../../src/renderer/src/components/settings/channel-account'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.deepStrictEqual(actual, expected, `${message} (got ${JSON.stringify(actual)})`)
}

// ── Each channel type reports its own identifier ─────────────────────────────
{
  const cases: Array<[string, Record<string, string>, string]> = [
    ['feishu-bot', { appId: 'cli_a1b2c3', appSecret: 'shhh' }, 'cli_a1b2c3'],
    ['dingtalk-bot', { appKey: 'ding_xyz', appSecret: 'shhh' }, 'ding_xyz'],
    ['wecom-bot', { corpId: 'corp_9f2', secret: 'shhh', agentId: '1' }, 'corp_9f2'],
    ['qq-bot', { appId: '102000', clientSecret: 'shhh' }, '102000'],
    ['whatsapp-bot', { phoneNumberId: '1099', accessToken: 'shhh' }, '1099'],
    ['weixin-official', { accountId: 'gh_abc', token: 'shhh' }, 'gh_abc']
  ]

  for (const [type, config, expected] of cases) {
    eq(channelAccountLabel({ type, config }), expected, `${type} reports its own identifier`)
  }
}

// ── Never a secret ──────────────────────────────────────────────────────────
{
  // The row is visible at a glance and gets screenshotted, so a secret must never be the
  // fallback when the identifier field is missing.
  eq(
    channelAccountLabel({ type: 'feishu-bot', config: { appSecret: 'shhh' } }),
    null,
    'a missing identifier does not fall back to the secret'
  )
  eq(
    channelAccountLabel({ type: 'weixin-official', config: { token: 'shhh' } }),
    null,
    'a token is not an identifier'
  )
}

// ── Missing / blank / unknown ───────────────────────────────────────────────
{
  eq(channelAccountLabel({ type: 'feishu-bot', config: {} }), null, 'an unconfigured channel has no label')
  eq(
    channelAccountLabel({ type: 'feishu-bot', config: { appId: '   ' } }),
    null,
    'a blank identifier counts as missing, so the row falls back to "unconfigured"'
  )
  eq(
    channelAccountLabel({ type: 'feishu-bot', config: { appId: '  cli_x  ' } }),
    'cli_x',
    'surrounding whitespace is trimmed'
  )
  eq(
    channelAccountLabel({ type: 'some-future-bot', config: { appId: 'x' } }),
    null,
    'an unknown channel type reports nothing rather than guessing a field'
  )
}

console.log(`channel account label checks passed: ${checks}`)
