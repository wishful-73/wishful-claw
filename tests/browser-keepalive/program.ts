/*
 * S-260 回归：浏览器保活池的淘汰判据。
 *
 * 断言的重点不是「池能装几个」，而是**三种错了也不报错的场景**：
 *   1. 把用户正在看的那个卸掉 —— 界面直接白掉，用户只会以为软件坏了；
 *   2. 把 agent 正在跑的会话卸掉 —— agent 拿到 "not attached" 后会无脑重试，越重越乱；
 *   3. 该拒绝时静默混过去 —— agent 只能瞎猜，然后去做用户没让它做的事。
 *
 * 这三类都不会抛异常，只会让行为变得没法解释，所以判据必须锁在测试里。
 */

import {
  BROWSER_IDLE_EVICT_MS,
  BROWSER_KEEPALIVE_LIMIT,
  describeIdle,
  describeKeepAliveOccupants,
  planBrowserKeepAlive,
  shouldEvictIdle,
  type BrowserKeepAliveSlot,
  type BrowserKeepAliveOccupant
} from '../../src/renderer/src/lib/browser/browser-keepalive'

let assertions = 0
function assert(condition: boolean, message: string): void {
  assertions += 1
  if (!condition) throw new Error(message)
}

const NOW = 1_700_000_000_000

function slot(scopeId: string, ageMs: number): BrowserKeepAliveSlot {
  return { scopeId, lastAccessAt: NOW - ageMs }
}

function checkLimitIsTwo(): void {
  // 老大的原话是「有两个活着就行了」—— 这个数字是需求，不是调参数
  assert(BROWSER_KEEPALIVE_LIMIT === 2, 'keep-alive limit is 2')
  assert(BROWSER_IDLE_EVICT_MS === 5 * 60_000, 'idle eviction is 5 minutes')
}

function checkAdmit(): void {
  const empty = planBrowserKeepAlive({
    slots: [],
    leases: {},
    visibleScopeId: 'a',
    targetScopeId: 'a',
    explicit: false
  })
  assert(empty.action === 'attach', 'empty pool admits anyone')

  const one = planBrowserKeepAlive({
    slots: [slot('a', 1000)],
    leases: {},
    visibleScopeId: 'a',
    targetScopeId: 'b',
    explicit: false
  })
  assert(one.action === 'attach', 'a half-full pool admits a second scope')

  // 目标已在池里 ⇒ 不占新名额。这条幂等性撑起了「工具自愈重开浏览器」那条路。
  const again = planBrowserKeepAlive({
    slots: [slot('a', 1000), slot('b', 2000)],
    leases: { a: 1, b: 1 },
    visibleScopeId: 'a',
    targetScopeId: 'b',
    explicit: false
  })
  assert(again.action === 'attach', 'an already-pooled scope never needs a slot')
}

function checkReclaimOldest(): void {
  const plan = planBrowserKeepAlive({
    slots: [slot('a', 1000), slot('b', 9000)],
    leases: {},
    visibleScopeId: 'c',
    targetScopeId: 'c',
    explicit: false
  })
  assert(plan.action === 'reclaim', 'a full pool reclaims')
  assert(plan.action === 'reclaim' && plan.evictScopeId === 'b', 'the least recently used one goes')
  assert(plan.action === 'reclaim' && plan.forced === false, 'a soft reclaim is not forced')
}

function checkVisibleScopeProtected(): void {
  const plan = planBrowserKeepAlive({
    slots: [slot('a', 1000), slot('b', 9000)],
    leases: {},
    visibleScopeId: 'a',
    targetScopeId: 'c',
    explicit: false
  })
  assert(
    plan.action === 'reclaim' && plan.evictScopeId === 'b',
    'the visible scope is never the victim, even when the other one is the fresher'
  )

  // 可见的那个恰好最老，也不能动
  const visibleOldest = planBrowserKeepAlive({
    slots: [slot('a', 9000), slot('b', 1000)],
    leases: {},
    visibleScopeId: 'a',
    targetScopeId: 'c',
    explicit: false
  })
  assert(
    visibleOldest.action === 'reclaim' && visibleOldest.evictScopeId === 'b',
    'being visible outranks being idle'
  )
}

function checkLeaseProtection(): void {
  const plan = planBrowserKeepAlive({
    slots: [slot('a', 9000), slot('b', 1000)],
    leases: { a: 1 },
    visibleScopeId: 'c',
    targetScopeId: 'c',
    explicit: false
  })
  assert(plan.action === 'reclaim' && plan.evictScopeId === 'b', 'a leased scope is not evictable')

  const allLeased = planBrowserKeepAlive({
    slots: [slot('a', 9000), slot('b', 1000)],
    leases: { a: 1, b: 2 },
    visibleScopeId: 'c',
    targetScopeId: 'c',
    explicit: false
  })
  assert(allLeased.action === 'reject', 'nothing evictable + agent caller ⇒ reject')
}

function checkForcedReclaim(): void {
  // 用户自己要看：池满且一个都不许动时仍然腾位，弹一句「等别人用完」不可接受
  const plan = planBrowserKeepAlive({
    slots: [slot('a', 1000), slot('b', 9000)],
    leases: { a: 1, b: 1 },
    visibleScopeId: 'a',
    targetScopeId: 'c',
    explicit: true
  })
  assert(plan.action === 'reclaim', 'an explicit caller still gets a slot')
  assert(plan.action === 'reclaim' && plan.forced === true, 'and it is marked forced')
  assert(plan.action === 'reclaim' && plan.evictScopeId === 'b', 'the oldest one pays')

  // 有得选的时候不许顶掉正在跑任务的会话
  const sparing = planBrowserKeepAlive({
    slots: [slot('a', 1000), slot('b', 9000)],
    leases: { b: 1 },
    visibleScopeId: 'b',
    targetScopeId: 'c',
    explicit: true
  })
  assert(
    sparing.action === 'reclaim' && sparing.evictScopeId === 'a',
    'a forced reclaim still prefers a scope no task is using'
  )
}

function checkRejectMessage(): void {
  const occupants: BrowserKeepAliveOccupant[] = [
    {
      scopeId: 'a',
      title: 'Refactor auth',
      url: 'https://example.com/login',
      lastAccessAt: NOW - 120_000,
      leased: true
    },
    {
      scopeId: 'b',
      title: 'Docs',
      url: '',
      lastAccessAt: NOW - 3_600_000,
      leased: false
    }
  ]
  const message = describeKeepAliveOccupants(occupants, NOW)

  // 三样东西少任何一样，agent 就只能瞎猜：谁占着、占的什么页面、能做什么
  assert(message.includes('Refactor auth'), 'the agent is told who holds a slot')
  assert(message.includes('https://example.com/login'), 'and what page it holds')
  assert(message.includes('2 min ago'), 'and how long it has been idle')
  assert(message.includes('a task is using it right now'), 'and whether a task is running')
  assert(message.includes('no page loaded'), 'an empty slot says so instead of printing a blank')
  assert(message.includes('Wait until'), 'and what it can do about it')
  assert(
    message.includes(`(${BROWSER_KEEPALIVE_LIMIT} sessions)`),
    'the limit is stated so the agent can explain it to the user'
  )

  // describeScope 缺省时不能崩，也不能输出空标题
  const plan = planBrowserKeepAlive({
    slots: [slot('a', 1000), slot('b', 2000)],
    leases: { a: 1, b: 1 },
    visibleScopeId: 'c',
    targetScopeId: 'c',
    explicit: false
  })
  assert(plan.action === 'reject', 'two leased slots reject')
  assert(plan.reason.includes('"a"'), 'without a describeScope the scope id stands in for the title')
}

function checkIdle(): void {
  const base = { leases: {} as Record<string, number | undefined>, visibleScopeId: 'visible', now: NOW }

  assert(
    !shouldEvictIdle({ ...base, slot: slot('a', BROWSER_IDLE_EVICT_MS - 1) }),
    'just short of the idle window stays mounted'
  )
  assert(
    shouldEvictIdle({ ...base, slot: slot('a', BROWSER_IDLE_EVICT_MS) }),
    'exactly at the idle window is evicted'
  )
  // 空闲回收和「腾位置」不是一回事：这条不需要池满，但同样不许动可见的和被租的
  assert(
    !shouldEvictIdle({ ...base, slot: slot('visible', BROWSER_IDLE_EVICT_MS * 10) }),
    'the visible scope is idle-proof'
  )
  assert(
    !shouldEvictIdle({
      ...base,
      leases: { a: 1 },
      slot: slot('a', BROWSER_IDLE_EVICT_MS * 10)
    }),
    'a leased scope is idle-proof'
  )
}

function checkDescribeIdle(): void {
  assert(describeIdle(NOW, NOW) === 'just now', 'zero elapsed')
  assert(describeIdle(NOW - 59_000, NOW) === 'just now', 'under a minute is still "just now"')
  assert(describeIdle(NOW - 60_000, NOW) === '1 min ago', 'a minute')
  assert(describeIdle(NOW - 59 * 60_000, NOW) === '59 min ago', 'minutes')
  assert(describeIdle(NOW - 60 * 60_000, NOW) === '1 h ago', 'an hour')
  assert(describeIdle(NOW - 25 * 3_600_000, NOW) === '1 d ago', 'a day')
  // 时钟回拨也不能出现负数
  assert(describeIdle(NOW + 60_000, NOW) === 'just now', 'a clock skew never yields a negative age')
}

checkLimitIsTwo()
checkAdmit()
checkReclaimOldest()
checkVisibleScopeProtected()
checkLeaseProtection()
checkForcedReclaim()
checkRejectMessage()
checkIdle()
checkDescribeIdle()

console.log(`browser-keepalive: ${assertions} assertions passed`)
