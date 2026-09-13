/*
 * Wishful Claw 自研：IPC MessagePack 路由对账测试。
 *
 * 背景：src/main 里 registerMessagePackHandler / registerChannelMessagePackHandler /
 * registerGitMessagePackHandler 只 handle `<channel>:msgpack`，不注册裸通道。渲染端
 * ipc-client 只有在 shouldUseMessagePackInvoke() 命中 MESSAGEPACK_INVOKE_CHANNELS 时才走
 * 二进制桥，否则退回 ipcRenderer.invoke(裸通道) → "No handler registered"。
 * 迭代 28 需求 R-2 的 plugin:settings-get / plugin:settings-set 就是这样静默失败的，
 * 而 agent:drain-sub-agent-notifications 在同一条链上已经坏了很久（catch 把错误吞掉）。
 *
 * 本测试钉住三件事：
 *   1. 扫描器本身没有静默失灵（注册数 + 已知通道存在）。
 *   2. 每个只在 msgpack 上注册的通道都必须被"解释"：走 invoke 路由、走 send/event 路由、
 *      只经 preload 的 window.api 调用，或者当前没有任何调用方。新增注册若四种都不满足即失败。
 *   3. 两个已知回归点必须真的被路由。
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  shouldUseMessagePackEvent,
  shouldUseMessagePackInvoke,
  shouldUseMessagePackSend
} from '../../src/renderer/src/lib/ipc/messagepack-channel-routing'

let assertions = 0
function assert(condition: boolean, message: string): void {
  assertions += 1
  if (!condition) throw new Error(message)
}

const ROOT = path.resolve(__dirname, '..', '..', '..')

/**
 * Channels called through preload's `window.api.invoke`, which encodes MessagePack
 * unconditionally and never consults the routing list. Adding one here means: the
 * only callers live in a standalone window (clipboard / launcher) or use window.api.
 */
const PRELOAD_BINARY_ONLY = new Set([
  'app:get-login-item-settings',
  'app:set-login-item-settings',
  'clipboard:clear',
  'clipboard:copy',
  'clipboard:delete',
  'clipboard:get-config',
  'clipboard:get-history',
  'clipboard:hide',
  'clipboard:toggle-pin',
  'clipboard:update-config',
  'dialog:openFolder',
  'launcher:add-custom-app',
  'launcher:get-config',
  'launcher:get-custom-apps',
  'launcher:get-recent',
  'launcher:hide',
  'launcher:launch',
  'launcher:pick-exe',
  'launcher:remove-custom-app',
  'launcher:search',
  'launcher:update-config',
  'log:cleanup',
  'log:list-files',
  'log:read-file',
  'worker:request:cancel',
  'worker:request:with-id'
])

/** Registered in main but no caller exists anywhere in src/. Dead until someone wires it. */
const NO_CALLER = new Set(['skills:cleanup-temp', 'video:cancel', 'video:start', 'video:status'])

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'out') listTsFiles(full, out)
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** Walks past `<A, B>` including inline object types, so the channel literal after `(` is found. */
function skipGenerics(source: string, start: number): number {
  let angle = 0
  let brace = 0
  let paren = 0
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    if (c === '{') brace++
    else if (c === '}') brace--
    else if (c === '(') paren++
    else if (c === ')') paren--
    else if (brace === 0 && paren === 0) {
      if (c === '<') angle++
      else if (c === '>') {
        angle--
        if (angle === 0) return i + 1
      } else if (c === ';') return -1
    }
  }
  return -1
}

function channelAt(source: string, from: number): string | null {
  const quote = source[from]
  if (quote !== "'" && quote !== '"' && quote !== '`') return null
  const end = source.indexOf(quote, from + 1)
  return end < 0 ? null : source.slice(from + 1, end)
}

/** Every channel name main binds on `<channel>:msgpack` only. */
function collectMessagePackChannels(): Map<string, string> {
  const found = new Map<string, string>()
  for (const file of listTsFiles(path.join(ROOT, 'src', 'main'))) {
    const source = fs.readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\bregister\w*MessagePackHandler\b/g)) {
      let i = match.index + match[0].length
      while (/\s/.test(source[i] ?? '')) i++
      if (source[i] === '<') {
        const afterGenerics = skipGenerics(source, i)
        if (afterGenerics < 0) continue
        i = afterGenerics
      }
      while (/\s/.test(source[i] ?? '')) i++
      if (source[i] !== '(') continue
      i++
      while (/\s/.test(source[i] ?? '')) i++
      const channel = channelAt(source, i)
      // Channels already ending in ':msgpack' are literal binary names called through
      // invokeMessagePackBinary directly, so they never appear in the routing list.
      if (channel && !channel.endsWith(':msgpack') && !found.has(channel)) {
        found.set(channel, path.relative(ROOT, file))
      }
    }
  }
  return found
}

const registered = collectMessagePackChannels()

const corpus: Array<[string, string]> = ['src/renderer', 'src/preload', 'src/shared']
  .flatMap((dir) => listTsFiles(path.join(ROOT, dir)))
  .map((file) => [path.relative(ROOT, file), fs.readFileSync(file, 'utf8')] as [string, string])

/** First file outside src/main that mentions the channel as a string literal. */
function callerOf(channel: string): string | null {
  const quoted = [`'${channel}'`, `"${channel}"`]
  for (const [file, source] of corpus) {
    if (quoted.some((needle) => source.includes(needle))) return file
  }
  return null
}

// Group 1: the scanner itself. A parser that silently returns nothing would make every
// later assertion pass vacuously, so pin its output.
assert(registered.size >= 250, `scanner should find every msgpack registration, got ${registered.size}`)
for (const known of ['fs:read-file', 'plugin:settings-set', 'git:get-status', 'agent:drain-sub-agent-notifications']) {
  assert(registered.has(known), `scanner lost a known msgpack registration: ${known}`)
}

// Group 2: no registered channel may be unexplained.
const unexplained: string[] = []
for (const [channel, file] of registered) {
  const routed =
    shouldUseMessagePackInvoke(channel, 1) ||
    shouldUseMessagePackSend(channel) ||
    shouldUseMessagePackEvent(channel) ||
    PRELOAD_BINARY_ONLY.has(channel) ||
    NO_CALLER.has(channel)
  if (!routed) unexplained.push(`${channel} (${file})`)
}
assert(
  unexplained.length === 0,
  'registered on <channel>:msgpack only but nothing routes to it — ipcClient.invoke would hit ' +
    `"No handler registered". Add the channel to MESSAGEPACK_INVOKE_CHANNELS, or classify it:\n  ${unexplained.join('\n  ')}`
)

// Group 3: the allowlists must not drift into a junk drawer.
for (const channel of PRELOAD_BINARY_ONLY) {
  assert(
    !shouldUseMessagePackInvoke(channel, 1),
    `${channel} is classified preload-only yet is also in the invoke list — drop one`
  )
  assert(registered.has(channel), `${channel} is classified preload-only but main no longer registers it`)
  assert(callerOf(channel) !== null, `${channel} is classified preload-only but nothing calls it any more`)
}
for (const channel of NO_CALLER) {
  assert(registered.has(channel), `${channel} is classified as uncalled but main no longer registers it`)
  const caller = callerOf(channel)
  assert(
    caller === null,
    `${channel} was classified as having no caller but is now used in ${caller} — route it in MESSAGEPACK_INVOKE_CHANNELS`
  )
}

// Group 4: named regressions.
for (const channel of ['plugin:settings-get', 'plugin:settings-set']) {
  assert(
    shouldUseMessagePackInvoke(channel, 1),
    `${channel} must route through MessagePack — the global channel settings panel is unreadable without it`
  )
}
assert(
  shouldUseMessagePackInvoke('agent:drain-sub-agent-notifications', 1),
  'agent:drain-sub-agent-notifications must route through MessagePack — otherwise buffered ' +
    'background sub-agent reports are never drained and the wake-up feature is dead'
)
// Two arguments make ipc-client fall back to the plain bridge, which main never registers.
assert(
  !shouldUseMessagePackInvoke('plugin:settings-set', 2),
  'a msgpack channel invoked with two arguments must not be treated as routable'
)

console.log(
  `IPC MessagePack routing checks passed (${assertions} assertions, ${registered.size} registered channels).`
)
