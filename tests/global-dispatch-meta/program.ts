/*
 * 全局派活消息的形状（v3-iter-5 S-278）。
 *
 * 存在理由：这条链上出过的两个问题都不会报错 ——
 *   ① 协议说明（给模型看的英文指引）被当成消息正文落库，用户读到一整段指令；
 *   ② 同一套措辞两份实现已经漂移，一份教 `use_capability` 代理调法、一份教直接调工具。
 * 两者都只在真机界面上肉眼看得出，代码里没有任何断言会红。
 *
 * ⚠️ 第 8~10 条是**源码闸**：C# 与 TS 跨语言，共用不了函数（同 S-276 的
 * RealUserTurnPredicate / isRealUserTurn），只能读文件断言两边同时具备
 * `builtin:reply_global_dispatch`、`displayContent`、`globalDispatch`，并且都没有旧措辞。
 * 断言对象是「两份实现不漂移」这件事本身，不是实现的写法。
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildWorkRequestDelivery,
  buildWorkRequestWireText
} from '../../src/renderer/src/lib/tools/global-work-request'

let checks = 0

function check(condition: boolean, description: string): void {
  checks += 1
  assert.ok(condition, description)
}

const DISPATCH_ID = 'gd_3f8a9b2c'
const TASK_ID = 'gt_91c2d4e6'
const INSTRUCTION = '把 iter-v3-5 的文档欠账补齐。'

// ── wire 文本（模型看） ────────────────────────────────────────────────

const wire = buildWorkRequestWireText(DISPATCH_ID, TASK_ID, INSTRUCTION)

// 1. 模型必须看到 dispatch 身份：回执时要把它原样带回来
check(wire.includes(`dispatch_id=${DISPATCH_ID}`), 'wire 文本必须带 dispatch_id')
check(wire.includes(`global_task_id=${TASK_ID}`), 'wire 文本必须带 global_task_id')

// 2. 指令正文在其中
check(wire.includes(INSTRUCTION), 'wire 文本必须包含指令正文')

// 3. 回执指引必须是**代理调法** —— 这个工具本来就只通过 use_capability 暴露，
//    写「直接调 reply_global_dispatch 工具」模型会调失败。
check(wire.includes('builtin:reply_global_dispatch'), '回执指引必须走 builtin:reply_global_dispatch')
check(wire.includes('use_capability'), '回执指引必须说明用 use_capability 代理调用')

// 4. 反向：旧措辞不许留在 TS 里（漂移的那一份就是它）
check(
  !wire.includes('call the reply_global_dispatch'),
  '不许再出现「call the reply_global_dispatch tool」这种直接调法'
)

// 5. 落盘守护路径要写在文本里（模型会照着找笔记目录）
check(wire.includes('.wishful-claw/notes/'), 'wire 文本必须指明笔记目录')

// ── display 文本（人看） ──────────────────────────────────────────────

const delivery = buildWorkRequestDelivery(DISPATCH_ID, TASK_ID, INSTRUCTION, 'v3-iter-5 收尾')

// 6. 落库文本只有 instruction：协议说明一个字都不许进去
check(delivery.displayContent === INSTRUCTION, 'displayContent 必须严格等于 instruction')
check(
  !delivery.displayContent.includes('GLOBAL AGENT WORK REQUEST'),
  'displayContent 不许带派发前缀'
)
check(
  !delivery.displayContent.includes('use_capability'),
  'displayContent 不许带回执指引'
)

// 7. 模型那份与人那份必须是两份，不许退化成同一个字符串
check(delivery.content !== delivery.displayContent, 'wire 文本与 display 文本必须是分开的两份')

// ── meta（渲染端认卡片用） ────────────────────────────────────────────

const meta = delivery.meta.globalDispatch
check(meta !== undefined, 'meta.globalDispatch 必须存在')
if (meta) {
  check(meta.dispatchId === DISPATCH_ID, 'meta.dispatchId 必须原样')
  check(meta.globalTaskId === TASK_ID, 'meta.globalTaskId 必须原样')
  check(meta.kind === 'work_request', 'kind 必须是 work_request（与 DB 的 KindValues 同值域）')
  check(meta.globalTaskTitle === 'v3-iter-5 收尾', '任务标题按派发那一刻快照进 meta')
}

// 8. 拿不到标题时不许造一个空串（卡片靠「有没有这个字段」决定退化成什么）
const withoutTitle = buildWorkRequestDelivery(DISPATCH_ID, TASK_ID, INSTRUCTION).meta.globalDispatch
check(
  withoutTitle !== undefined && !('globalTaskTitle' in withoutTitle),
  '没有标题时 meta 里不许出现 globalTaskTitle 字段'
)

// ── 源码闸：C# 那份不许漂回去 ─────────────────────────────────────────

// out/program.cjs 比 program.ts 深一级 ⇒ 从 __dirname 上溯三级才是仓库根
const repoRoot = join(__dirname, '..', '..', '..')
const csPath = join(
  repoRoot,
  'src',
  'runtime',
  'WishfulClaw.Agent',
  'Executors',
  'AgentRuntimeGlobalTaskExecutor.cs'
)
let csSource = ''
try {
  csSource = readFileSync(csPath, 'utf8')
} catch {
  csSource = ''
}
check(csSource.length > 0, `必须读到 AgentRuntimeGlobalTaskExecutor.cs（root=${repoRoot}）`)

// 9. 措辞一致：C# 也必须教代理调法
check(
  csSource.includes('builtin:reply_global_dispatch'),
  'C# 的派活文本必须也指向 builtin:reply_global_dispatch'
)
check(
  !csSource.includes('call the reply_global_dispatch'),
  'C# 里不许残留旧的直接调法措辞'
)

// 10. meta 通道两边都在写
check(csSource.includes('"displayContent"'), 'C# 必须把 displayContent 送进反向请求')
check(csSource.includes('"globalDispatch"'), 'C# 必须把 globalDispatch 写进 meta')
check(
  csSource.includes('"globalTaskTitle"'),
  'C# 必须把任务标题快照写进 meta（否则卡片永远只有 id）'
)

// ── 源码闸：渲染端两条投递路径都得带 meta ─────────────────────────────

const reversePath = readFileSync(
  join(repoRoot, 'src', 'renderer', 'src', 'lib', 'tools', 'project-send-message.ts'),
  'utf8'
)
check(
  reversePath.includes('displayContent') && reversePath.includes('meta'),
  '反向请求 handler 必须把 displayContent 与 meta 透传给 sendMessage'
)
// 11. displayContent 与 content 相同时不传 —— 老路径必须字节级不变
check(
  reversePath.includes('displayContent !== content'),
  'displayContent 等于 content 时必须不传，保持老路径不变'
)

// ── 源码闸：S-279 收尾（普通消息回执 + 回执卡片化） ────────────────────
//
// 这一组防的是「跨语言半成品」：wire 侧改了、工具描述没改 ⇒ 模型不知道能回执；
// 回执写回了、渲染端没认 meta ⇒ 界面上一坨裸协议文本。
// 每一处都不报错，只有真机看着别扭才发现，所以逐个钉。

const readOrEmpty = (relativePath: string): string => {
  try {
    return readFileSync(join(repoRoot, relativePath), 'utf8')
  } catch {
    return ''
  }
}

// 12. 工具描述必须承认普通消息也能回执，且不许留着禁令
const replyToolSource = readOrEmpty(
  'src/runtime/WishfulClaw.Agent/Tools/Providers/GlobalDispatchReplyToolProvider.cs'
)
check(replyToolSource.length > 0, '必须读到 GlobalDispatchReplyToolProvider.cs')
check(
  replyToolSource.includes('[GLOBAL SESSION MESSAGE]'),
  '工具描述必须提到 [GLOBAL SESSION MESSAGE]（普通消息的 dispatch_id 来源）'
)
check(
  !replyToolSource.includes('Do not use it for ordinary user messages'),
  '工具描述不许残留「不要用于普通消息」的禁令 —— 那会让模型结构上拒绝回执'
)

// 13. 回执反向请求必须带 displayContent + 结构化 meta
const replyExecSource = readOrEmpty(
  'src/runtime/WishfulClaw.Agent/Executors/AgentRuntimeGlobalDispatchReplyExecutor.cs'
)
check(replyExecSource.length > 0, '必须读到 AgentRuntimeGlobalDispatchReplyExecutor.cs')
check(
  replyExecSource.includes('"displayContent"'),
  '回执反向请求必须带 displayContent（否则全局会话收到的是协议文本）'
)
check(
  replyExecSource.includes('"globalDispatchReply"'),
  '回执反向请求必须带 meta.globalDispatchReply（否则渲染端认不出这是回执）'
)

// 14. 项目执行器必须走 BuildSessionMessageWireText，不许直接把原话塞 content
const projectExecSource = readOrEmpty(
  'src/runtime/WishfulClaw.Agent/Executors/AgentRuntimeProjectExecutor.cs'
)
check(projectExecSource.length > 0, '必须读到 AgentRuntimeProjectExecutor.cs')
check(
  projectExecSource.includes('BuildSessionMessageWireText'),
  '项目执行器投递普通消息时必须调用 BuildSessionMessageWireText'
)

// 15. 渲染端必须有回执徽章，且真的挂到用户消息上
const viewsSource = readOrEmpty('src/renderer/src/components/chat/user-message-views.tsx')
check(
  viewsSource.includes('GlobalDispatchReplyBadge'),
  'user-message-views.tsx 必须导出 GlobalDispatchReplyBadge'
)
const userMessageSource = readOrEmpty('src/renderer/src/components/chat/UserMessage.tsx')
check(
  userMessageSource.includes('<GlobalDispatchReplyBadge'),
  'UserMessage.tsx 必须渲染 GlobalDispatchReplyBadge'
)

// 16. 两套语言都得有键，否则英文面会掉出原始 key
const zhChat = readOrEmpty('src/renderer/src/locales/zh/chat.json')
const enChat = readOrEmpty('src/renderer/src/locales/en/chat.json')
check(zhChat.includes('globalDispatchReply'), 'zh/chat.json 缺 globalDispatchReply 键')
check(enChat.includes('globalDispatchReply'), 'en/chat.json 缺 globalDispatchReply 键')

console.log(`global-dispatch-meta: ${checks} checks passed`)
