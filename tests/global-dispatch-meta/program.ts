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

console.log(`global-dispatch-meta: ${checks} checks passed`)
