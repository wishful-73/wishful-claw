// iter-40 S-208 —— 压缩摘要卡片给人看正文的剥离逻辑。
//
// 背景：压缩摘要是「数据 + 显示」两用的同一条消息。Worker 在 <compaction-summary> 里
// 最前面插一段快照，交代用户最后说了什么、什么时候说的、跑到哪一步了（数据面）；
// 卡片上不该把这段再念给用户听（显示面）。
//
// 这里锁三件事：
//   1. 快照块被整段剥掉，只留摘要正文；
//   2. **用户原话里含空行也不漏字** —— 这是第一版「按空行切块 + 逐块看前缀」的
//      B1 缺陷：块 2 不以前缀开头，循环当场停下，后半段和整块压缩时刻漏回卡片；
//   3. 认不出快照就原样返回，不猜位置去截断（旧摘要根本没有这一段，猜错的代价是
//      吃掉用户真正想看的正文）。
//
// `context-compression-display.ts` 是纯模块（不 import IPC），可直接静态 import。

import assert from 'node:assert/strict'
import type { UnifiedMessage } from '../../src/renderer/src/lib/api/types'
import {
  getCompactSummaryDisplayTextWith,
  isCompactBoundaryMessage,
  isCompactSummaryLikeMessage
} from '../../src/renderer/src/lib/agent/context-compression-display'

// 与 Worker 侧 ContextCompression.BuildLatestUserSnapshotBlock 逐字一致
const TERMINATOR = '以上为压缩时刻的快照；此后用户若再有消息，以对话中最新消息为准。'

/** 按 Worker 的真实输出格式拼一条压缩摘要消息。 */
function buildSummary(
  options: {
    userText?: string
    sentAt?: string
    compactedAt?: string
    state?: string
    body?: string
  } = {}
): string {
  const { userText, sentAt = '10-20 08:21', compactedAt = '10-20 08:26', state = '执行中', body = '摘要正文。' } = options
  const snapshot =
    userText === undefined
      ? ''
      : `【用户消息 · ${sentAt}】\n${userText}\n\n【压缩时刻 · ${compactedAt} · ${state}】\n${TERMINATOR}\n\n`
  return `<compaction-summary>\n${snapshot}${body}\n</compaction-summary>`
}

function summaryMessage(content: string, meta: Record<string, unknown> = {}): UnifiedMessage {
  return {
    id: 'compact-summary-1',
    role: 'user',
    content,
    meta: {
      compactSummary: {
        messagesSummarized: 12,
        recentMessagesPreserved: false,
        ...meta
      }
    }
  } as UnifiedMessage
}

/** 渲染端的 t() 替身：只认机械摘要那一个键，其余返回 key。 */
function fakeTranslate(key: string, options?: Record<string, unknown>): string {
  if (key === 'contextCompression.mechanicalFoldDigest') {
    const template = String(options?.defaultValue ?? '')
    return template.replace('{{messageCount}}', String(options?.messageCount ?? ''))
  }
  return key
}

const display = (message: UnifiedMessage): string =>
  getCompactSummaryDisplayTextWith(message, fakeTranslate)

const cases: Array<[string, () => void]> = [
  [
    '单段用户消息：快照整段剥掉，只留摘要正文',
    () => {
      const text = display(
        summaryMessage(buildSummary({ userText: '把官网首屏的背景动画调淡一点', body: '用户要求调整首屏背景动画强度。' }))
      )
      assert.equal(text, '用户要求调整首屏背景动画强度。')
    }
  ],
  [
    '用户原话含空行（多段粘贴）：前半段、后半段、压缩时刻一律不漏回卡片',
    () => {
      const userText = '这两段需求一起做：\n\n第一段是首屏文案，第二段是页脚贴底。'
      const text = display(summaryMessage(buildSummary({ userText, body: '用户同时提了两项官网需求。' })))
      assert.equal(text, '用户同时提了两项官网需求。')
      assert.ok(!text.includes('【压缩时刻'), '压缩时刻不该漏回卡片')
      assert.ok(!text.includes('第二段'), '用户原话后半段不该漏回卡片')
    }
  ],
  [
    '用户原话含空行且摘要本身多段：多段正文全部保留',
    () => {
      const userText = '第一行\n\n第二行\n\n第三行'
      const body = '摘要第一段。\n\n摘要第二段。'
      const text = display(summaryMessage(buildSummary({ userText, body })))
      assert.equal(text, '摘要第一段。\n\n摘要第二段。')
    }
  ],
  [
    '旧摘要没有快照：正文原样返回',
    () => {
      const text = display(summaryMessage(buildSummary({ body: '早先的会话做了三件事。' })))
      assert.equal(text, '早先的会话做了三件事。')
    }
  ],
  [
    '有用户消息前缀但收束句缺失：原样返回，不猜位置截断',
    () => {
      const content = '<compaction-summary>\n【用户消息 · 10-20 08:21】\n原话\n\n【压缩时刻 · 10-20 08:26】\n正文在这里\n</compaction-summary>'
      const text = display(summaryMessage(content))
      // 认不出结束锚点 ⇒ 整段不动，宁可显示多了也不能把正文吃掉
      assert.ok(text.includes('正文在这里'), '收束句缺失时不能吃掉正文')
      assert.ok(text.includes('【用户消息'), '收束句缺失时不剥前缀')
    }
  ],
  [
    '摘要带独立标题段：标题从卡片里剥掉',
    () => {
      // 标题按「独占一段」识别（splitCompactSummaryBlocks 按空行切段）
      const content = '<compaction-summary>\n[上下文摘要]\n\n用户要求调整首屏文案。\n</compaction-summary>'
      const text = display(summaryMessage(content))
      assert.equal(text, '用户要求调整首屏文案。')
    }
  ],
  [
    '旧会话的英文导语：标签剥离时一并去掉',
    () => {
      const content =
        '<compaction-summary>\nSummary of earlier conversation (older messages were compacted to save context): 早先的会话内容。\n</compaction-summary>'
      const text = display(summaryMessage(content))
      assert.equal(text, '早先的会话内容。')
    }
  ],
  [
    '机械降级摘要：走 i18n 键，用 meta 里的条数',
    () => {
      const text = display(
        summaryMessage('<compaction-summary>\n<folded digest>\n</compaction-summary>', {
          summarizerFailed: true,
          messagesSummarized: 37
        })
      )
      assert.equal(text, '37 earlier messages were folded here to free context, but the automatic summary was unavailable.')
    }
  ],
  [
    '普通用户消息：不是摘要，原样返回',
    () => {
      const message = { id: 'u1', role: 'user', content: '帮我把页脚贴底' } as UnifiedMessage
      assert.equal(isCompactSummaryLikeMessage(message), false)
      assert.equal(display(message), '帮我把页脚贴底')
    }
  ],
  [
    '压缩边界消息仍按 meta 识别',
    () => {
      const boundary = {
        id: 'b1',
        role: 'system',
        content: '',
        meta: { compactBoundary: { boundaryId: 'b1' } }
      } as unknown as UnifiedMessage
      assert.equal(isCompactBoundaryMessage(boundary), true)
    }
  ]
]

function main(): void {
  let checks = 0
  for (const [name, run] of cases) {
    run()
    checks += 1
    console.log(`PASS: ${name}`)
  }
  console.log(`compaction-snapshot-display: ${checks} cases passed`)
}

main()
