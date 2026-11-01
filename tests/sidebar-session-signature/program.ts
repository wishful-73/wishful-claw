// iter-v3-5 S-247 —— 左侧栏会话签名回归。
//
// 背景：侧栏从「直接订 `s.sessions` 数组」改成「订元数据签名字符串」，
// 把每帧全侧栏重渲染砍掉 95.6%（450 KB/帧 → 20 KB/帧）。代价是
// **签名漏字段 = 侧栏显示陈旧数据**（改了不刷新、不报错，最难查的那一类）。
//
// 所以这里把两件事钉死：
//   1. `Session` 的**每一个**字段必须被显式分类 —— 进签名，或进「明确忽略」表并写理由。
//      加字段忘了分类 ⇒ 本文件红；连 fixture 都不补 ⇒ typecheck 红（`satisfies Required<Session>`）。
//   2. 分类的结果要和实现一致 —— 进签名的字段变了签名必须变，没进签名的变了必须不变。
//
// 第 2 条是双向的：既防「漏字段」（功能坏），也防「把 messages 塞进签名」（性能修复白做）。
//
// ⚠️ 判据（两张字段表）改了必须同步改这个文件，否则下次漏字段照样绿。

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildSidebarSessionsSignature,
  SIDEBAR_IGNORED_SESSION_FIELDS,
  SIDEBAR_SESSION_FIELDS
} from '../../src/renderer/src/components/layout/sidebar-sessions-signature'
import type { Session } from '../../src/renderer/src/stores/chat-store/types'

/**
 * 全字段 fixture。
 * `satisfies Required<Session>` ⇒ Session 新增字段而这里没补，**typecheck 直接红**，
 * 不会等到运行时才靠 Object.keys 兜底。
 */
const baseSession = {
  id: 'sess-1',
  title: '会话一',
  icon: 'star',
  mode: 'chat',
  scope: 'project',
  collaborationMode: 'chat',
  permissionMode: 'default',
  contextCapTokens: 120000,
  contextCapModelId: 'claude-sonnet-4',
  compressionThreshold: 0.8,
  messages: [],
  messageCount: 3,
  messagesLoaded: true,
  loadedRangeStart: 0,
  loadedRangeEnd: 3,
  totalTurns: 2,
  lastKnownMessageCount: 3,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_900_000,
  projectId: 'proj-1',
  workingFolder: 'D:/work',
  sshConnectionId: 'ssh-1',
  planId: 'plan-1',
  pinned: true,
  pluginId: 'plugin-1',
  pluginType: 'channel',
  externalChatId: 'ext-1',
  pluginChatType: 'p2p',
  pluginSenderId: 'sender-1',
  pluginSenderName: '张三',
  modelSelectionMode: 'manual',
  providerId: 'prov-1',
  modelId: 'model-1',
  personaId: 'persona-1',
  sessionCacheHit: 100,
  sessionCacheMiss: 10,
  usageBaseline: { inputTokens: 100, outputTokens: 20 },
  sessionUsageTotals: { inputTokens: 200, outputTokens: 40 },
  isRuntimeResident: true
} satisfies Required<Session>

const ALL_SESSION_FIELDS = Object.keys(baseSession) as string[]
const ALL_SESSION_FIELD_SET = new Set(ALL_SESSION_FIELDS)

function cloneSession(): Record<string, unknown> {
  return { ...baseSession } as unknown as Record<string, unknown>
}

function asSessions(...sessions: Array<Record<string, unknown>>): Session[] {
  return sessions as unknown as Session[]
}

/**
 * 造一个「不同的值」。对象换**新引用**、内容不变（immer 换引用的形状）；
 * 数组同时换引用**并加一项** —— 只换引用的话，`messages.length` 这类
 * 长度派生的读取点测不出来。
 */
function bumpValue(value: unknown): unknown {
  if (value === undefined || value === null) return 'set-by-test'
  if (typeof value === 'string') return `${value}-changed`
  if (typeof value === 'number') return value + 1
  if (typeof value === 'boolean') return !value
  if (Array.isArray(value)) return [...value, { id: 'bump', role: 'user', text: 'x', createdAt: 1 }]
  if (typeof value === 'object') return { ...(value as Record<string, unknown>) }
  return value
}

function signatureOfOne(patch: Record<string, unknown> = {}): string {
  return buildSidebarSessionsSignature(asSessions({ ...cloneSession(), ...patch }))
}

/**
 * 从 `types.ts` 源码里解析 `interface Session` 的字段名。
 *
 * 为什么要解析源码：`tests/**` 不在任何 tsconfig 的 include 里，`npm run typecheck`
 * 根本不编译这个文件 —— 上面 `satisfies Required<Session>` 那条保险只在编辑器里有效，
 * 门禁上是哑的。而 `Object.keys(baseSession)` 只知道 fixture 的字段，Session 真加了
 * 字段、fixture 没跟着补，两边都绿。所以字段清单必须从类型定义本体读。
 */
function parseSessionInterfaceFields(): string[] {
  const source = readFileSync(
    join(process.cwd(), 'src/renderer/src/stores/chat-store/types.ts'),
    'utf8'
  )
  const marker = 'export interface Session {'
  const start = source.indexOf(marker)
  assert.ok(start >= 0, 'types.ts 里没找到 `export interface Session {`')
  const body = source.slice(start + marker.length)
  const end = body.indexOf('\n}')
  assert.ok(end > 0, 'Session 接口体没有正常闭合')
  const fields: string[] = []
  let inBlockComment = false
  for (const raw of body.slice(0, end).split('\n')) {
    const line = raw.trim()
    if (inBlockComment) {
      if (line.includes('*/')) inBlockComment = false
      continue
    }
    if (line.startsWith('/*')) {
      if (!line.includes('*/')) inBlockComment = true
      continue
    }
    if (line === '' || line.startsWith('//')) continue
    const match = /^([A-Za-z_$][\w$]*)\s*\??\s*:/.exec(line)
    if (match) fields.push(match[1])
  }
  return fields
}

const cases: Array<[string, () => void]> = [
  [
    'types.ts 里 Session 的每个字段都在分类表里，且 fixture 也覆盖到',
    () => {
      const declared = parseSessionInterfaceFields()
      assert.ok(
        declared.length >= 30,
        `只解析出 ${declared.length} 个字段，解析器可能失效了（预期 >= 30）`
      )
      const classified = new Set<string>([
        ...SIDEBAR_SESSION_FIELDS,
        ...Object.keys(SIDEBAR_IGNORED_SESSION_FIELDS)
      ])
      const unclassified = declared.filter((f) => !classified.has(f))
      assert.deepEqual(
        unclassified,
        [],
        `Session 新增了字段但没分类 —— 进 SIDEBAR_SESSION_FIELDS 或 SIDEBAR_IGNORED_SESSION_FIELDS 并写理由：${unclassified.join(', ')}`
      )
      const missingInFixture = declared.filter((f) => !ALL_SESSION_FIELD_SET.has(f))
      assert.deepEqual(
        missingInFixture,
        [],
        `这些字段没进本文件的 fixture（补上，否则上面那几条逐字段断言覆盖不到）：${missingInFixture.join(', ')}`
      )
    }
  ],
  [
    'Session 每个字段都被显式分类（进签名 / 明确忽略），且分类表里没有不存在的字段',
    () => {
      const classified = new Set<string>([
        ...SIDEBAR_SESSION_FIELDS,
        ...Object.keys(SIDEBAR_IGNORED_SESSION_FIELDS)
      ])
      const unclassified = ALL_SESSION_FIELDS.filter((f) => !classified.has(f))
      assert.deepEqual(
        unclassified,
        [],
        `这些 Session 字段没分类 —— 进 SIDEBAR_SESSION_FIELDS 或 SIDEBAR_IGNORED_SESSION_FIELDS 并写理由：${unclassified.join(', ')}`
      )
      const ghost = [...classified].filter((f) => !ALL_SESSION_FIELD_SET.has(f))
      assert.deepEqual(
        ghost,
        [],
        `分类表里这些字段在 Session 上不存在（拼错或字段已删）：${ghost.join(', ')}`
      )
    }
  ],
  [
    '签名里没有重复字段',
    () => {
      assert.equal(
        new Set(SIDEBAR_SESSION_FIELDS).size,
        SIDEBAR_SESSION_FIELDS.length,
        'SIDEBAR_SESSION_FIELDS 有重复项'
      )
    }
  ],
  [
    '每个「进签名」的字段变了，签名必须变（漏一个就是侧栏显示陈旧数据）',
    () => {
      for (const field of SIDEBAR_SESSION_FIELDS) {
        const before = signatureOfOne()
        const after = signatureOfOne({ [field]: bumpValue(baseSession[field]) })
        assert.notEqual(after, before, `${field} 变了但签名没变`)
      }
    }
  ],
  [
    '每个「明确忽略」的字段变了，签名必须不变（否则 S-247 的性能修复被抵消）',
    () => {
      const before = signatureOfOne()
      const baseView = baseSession as unknown as Record<string, unknown>
      for (const field of Object.keys(SIDEBAR_IGNORED_SESSION_FIELDS)) {
        const after = signatureOfOne({ [field]: bumpValue(baseView[field]) })
        assert.equal(after, before, `${field} 不在签名里，但它变了签名跟着变了`)
      }
    }
  ],
  [
    '流式 churn：messages / messageCount / sessionUsageTotals 变、元数据没变 ⇒ 签名必须不变',
    () => {
      const before = signatureOfOne()
      const churned = signatureOfOne({
        messages: [{ id: 'm1', role: 'user', text: '你好', createdAt: 1 }],
        messageCount: 4,
        sessionUsageTotals: { inputTokens: 999, outputTokens: 888 },
        sessionCacheHit: 777,
        messagesLoaded: false
      })
      assert.equal(churned, before, '只有消息体在变，签名不该变 —— 侧栏不该跟着重渲染')
    }
  ],
  [
    '同样的字段值、不同的对象引用 ⇒ 签名相同（签名字符串不掺引用）',
    () => {
      const one = buildSidebarSessionsSignature(asSessions(cloneSession()))
      const anotherEqualOne = buildSidebarSessionsSignature(asSessions(cloneSession()))
      const two = buildSidebarSessionsSignature(asSessions(cloneSession(), cloneSession()))
      assert.equal(anotherEqualOne, one, '同值不同引用应当同签名')
      assert.notEqual(two, one, '多一个会话，签名必须变')
    }
  ],
  [
    '顺序变化 ⇒ 签名必须变（否则置顶/时间排序改了侧栏不重排）',
    () => {
      const first = { ...cloneSession(), id: 'a', updatedAt: 200 }
      const second = { ...cloneSession(), id: 'b', updatedAt: 100 }
      assert.notEqual(
        buildSidebarSessionsSignature(asSessions(first, second)),
        buildSidebarSessionsSignature(asSessions(second, first)),
        '顺序变了但签名没变'
      )
    }
  ],
  [
    'projectId 从有到无（会话移出项目）⇒ 签名必须变，且与「projectId 为空」可区分',
    () => {
      const withProject = signatureOfOne({ projectId: 'proj-1' })
      const withoutProject = signatureOfOne({ projectId: undefined })
      assert.notEqual(withProject, withoutProject, '会话移出项目后签名没变 —— 分组会停旧位置')
    }
  ],
  [
    '源码守卫：WorkspaceSidebar 不许再直订 s.sessions，必须走签名',
    () => {
      const source = readFileSync(
        join(process.cwd(), 'src/renderer/src/components/layout/WorkspaceSidebar.tsx'),
        'utf8'
      )
      assert.doesNotMatch(
        source,
        /useChatStore\(\s*\(\s*s\s*\)\s*=>\s*s\.sessions\s*\)/,
        'WorkspaceSidebar 又直接订了 s.sessions 数组 —— 每帧全侧栏重渲染会回来（S-247）'
      )
      assert.match(
        source,
        /buildSidebarSessionsSignature\(/,
        'WorkspaceSidebar 没有用 buildSidebarSessionsSignature'
      )
    }
  ]
]

let passed = 0
const failures: string[] = []
for (const [name, fn] of cases) {
  try {
    fn()
    passed += 1
    console.log(`  ok   ${name}`)
  } catch (error) {
    failures.push(name)
    console.error(`  FAIL ${name}`)
    console.error(`       ${(error as Error).message}`)
  }
}

console.log(
  `\n== 汇总 ==\n  ${passed}/${cases.length} 通过` +
    `\n  签名字段 ${SIDEBAR_SESSION_FIELDS.length} 个 / 明确忽略 ${Object.keys(SIDEBAR_IGNORED_SESSION_FIELDS).length} 个 / Session 共 ${ALL_SESSION_FIELDS.length} 个`
)
if (failures.length > 0) {
  console.error(`\n失败项：\n${failures.map((f) => `  - ${f}`).join('\n')}`)
  process.exit(1)
}
