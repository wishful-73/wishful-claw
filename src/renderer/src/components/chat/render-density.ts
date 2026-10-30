/*
 * S-225：聊天窗时间轴渲染详细度（3 档）。
 *
 * 这个文件只放**纯函数**，不 import React、不读 store —— 目的只有一个：能直接在 node 里跑单测。
 * 组件侧通过 `use-density-override.ts` 的 `useDensityPolicy()` 拿 policy，再交给这里的
 * `derive*` 函数算默认折叠态。
 *
 * 为什么要有这一层：档位矩阵原本散在 7 个组件里各写一套 if，改一处漏三处。
 * 收敛成「policy 对象 + 7 个派生函数」之后，矩阵只有本文件这一份真源。
 */

import type { ChatRenderDensity } from '@renderer/stores/settings-store-types'

/** 三档的固定顺序，滑块刻度与循环切换都依赖它。 */
export const CHAT_RENDER_DENSITIES = ['text', 'compact', 'detail'] as const

export const DEFAULT_CHAT_RENDER_DENSITY: ChatRenderDensity = 'compact'

/** 任何来路不明的值（旧配置、手改 JSON、未来新增的档位）一律回落 compact。 */
export function normalizeChatRenderDensity(value: unknown): ChatRenderDensity {
  return value === 'text' || value === 'compact' || value === 'detail'
    ? value
    : DEFAULT_CHAT_RENDER_DENSITY
}

export function isChatRenderDensity(value: unknown): value is ChatRenderDensity {
  return value === 'text' || value === 'compact' || value === 'detail'
}

/**
 * 某一档下各渲染单元的默认开合策略。
 *
 * 命名统一用「折叠 / 展开」而不是「true / false」—— 布尔值本身说明不了方向，
 * 五个 true 排在一起没人看得出这档到底藏了多少东西。
 */
export interface ChatRenderDensityPolicy {
  /** 工具 run 分组：有工具正在跑时是否折叠。 */
  runCollapseWhileActive: boolean
  /** 工具 run 分组：全部跑完之后是否折叠。 */
  runCollapseWhenDone: boolean
  /** 单个工具卡的输出区：默认是否展开。 */
  toolOutputOpen: boolean
  /** 思考块：正在思考时是否展开。 */
  thinkingOpenWhileActive: boolean
  /** 思考块：思考结束之后是否折叠。 */
  thinkingCollapseWhenDone: boolean
  /** 子 Agent 卡：正在跑时是否展开。 */
  subAgentOpenWhileActive: boolean
  /** 子 Agent 卡：跑完之后是否折叠。 */
  subAgentCollapseWhenDone: boolean
  /** 文件变更卡：默认是否展开。 */
  fileChangeOpen: boolean
}

const POLICIES: Record<ChatRenderDensity, ChatRenderDensityPolicy> = {
  // 纯文本：只看消息。过程层一律收起，执行中也不展开。
  text: {
    runCollapseWhileActive: true,
    runCollapseWhenDone: true,
    toolOutputOpen: false,
    thinkingOpenWhileActive: false,
    thinkingCollapseWhenDone: true,
    subAgentOpenWhileActive: false,
    subAgentCollapseWhenDone: true,
    fileChangeOpen: false
  },
  // 紧凑（默认）：与 1.0.1 线上行为等价 —— 升级后观感零变化。
  compact: {
    runCollapseWhileActive: false,
    runCollapseWhenDone: true,
    toolOutputOpen: false,
    thinkingOpenWhileActive: true,
    thinkingCollapseWhenDone: true,
    subAgentOpenWhileActive: true,
    subAgentCollapseWhenDone: true,
    fileChangeOpen: false
  },
  // 详情：过程层全摊开，跑完也不收。
  detail: {
    runCollapseWhileActive: false,
    runCollapseWhenDone: false,
    toolOutputOpen: true,
    thinkingOpenWhileActive: true,
    thinkingCollapseWhenDone: false,
    subAgentOpenWhileActive: true,
    subAgentCollapseWhenDone: false,
    fileChangeOpen: true
  }
}

export function getDensityPolicy(density: ChatRenderDensity): ChatRenderDensityPolicy {
  return POLICIES[density] ?? POLICIES[DEFAULT_CHAT_RENDER_DENSITY]
}

/**
 * 工具 run 分组是否折叠。
 *
 * `ordinaryCount === 0` 的 run 没有可折叠内容（只有 force / attention 项），
 * 本来就不出折叠条，恒返回 false —— 这个判断必须在这里，不然 text 档会把
 * 单独的报错卡也包进一个没有标题的空壳里。
 */
export function deriveToolRunCollapsed(
  density: ChatRenderDensity,
  ordinaryCount: number,
  activeCount: number
): boolean {
  if (ordinaryCount <= 0) return false
  const policy = getDensityPolicy(density)
  return activeCount > 0 ? policy.runCollapseWhileActive : policy.runCollapseWhenDone
}

/**
 * 思考块是否折叠。
 *
 * 没有思考内容时恒 false —— 此时组件本身就 return null，这里的返回值不会被看到，
 * 但保持 false 让调用点的 `expanded` 计算保持单调。
 */
export function deriveThinkingCollapsed(
  density: ChatRenderDensity,
  isThinking: boolean,
  hasContent: boolean
): boolean {
  if (!hasContent) return false
  const policy = getDensityPolicy(density)
  return isThinking ? !policy.thinkingOpenWhileActive : policy.thinkingCollapseWhenDone
}

/**
 * 子 Agent 卡是否展开。
 *
 * 后台子 Agent（background）三档一律收起：它不是「过程层展开深度」的问题，
 * 而是这类子任务本来就不该占用户视线。
 */
export function deriveSubAgentExpanded(
  density: ChatRenderDensity,
  isActive: boolean,
  isBackground: boolean
): boolean {
  if (isBackground) return false
  const policy = getDensityPolicy(density)
  return isActive ? policy.subAgentOpenWhileActive : !policy.subAgentCollapseWhenDone
}

/**
 * 单个工具卡的输出区是否展开。
 *
 * `forceOpen`（错误 / 待审批）三档一律展开 —— 这是安全底线，档位不得藏错误。
 * 图片等可视输出与流式命令的输出也保持展开：它们不是「过程细节」，是结果本身。
 */
export function deriveToolOutputOpen(
  density: ChatRenderDensity,
  options: { forceOpen: boolean; hasVisualOutput: boolean; isLiveCommand: boolean }
): boolean {
  if (options.forceOpen || options.hasVisualOutput || options.isLiveCommand) return true
  return getDensityPolicy(density).toolOutputOpen
}

/** 文件变更卡是否折叠。错误 / 待审批（`forceOpen`）恒展开。 */
export function deriveFileChangeCollapsed(density: ChatRenderDensity, forceOpen: boolean): boolean {
  if (forceOpen) return false
  return !getDensityPolicy(density).fileChangeOpen
}

/**
 * 折叠态下必须提到折叠面板外面单独渲染的项。
 *
 * run 折叠时面板里所有卡片一起下沉，报错/待审批的卡也会跟着消失 —— 用户在
 * 「纯文本」档看不到错误弹窗，只看到一条「运行了 N 个工具」。所以折叠态下
 * `visibility === 'force'` 的项要找出来单独露在外面。
 */
export function shouldPinOutsideCollapsedRun(collapsed: boolean, visibility: string): boolean {
  return collapsed && visibility === 'force'
}

// ── S-248：第二根轴 —— 形态 ──
//
// S-225 只做了「开合深度」，纯文本档照样是一屏带边框的卡片壳，只是全收起了。
// 老大要的是**换形态**：壳整个不存在，过程降级成文本行，且点不动。

/** 过程层的存在形态。`card` = 现有卡片；`line` = 一行一条的纯文本。 */
export type ChatProcessRenderForm = 'card' | 'line'

/**
 * 这一档用哪种形态。
 *
 * **只有 `text` 换形态**：`compact` 是 1.0.1 线上等价形态、`detail` 是全摊开，
 * 两档一个像素都不许动（S-248 §7）。档位切回去形态立刻还原 —— 形态只由档位算出来，
 * 不落任何状态，所以「可逆」是天然成立的。
 */
export function deriveProcessRenderForm(density: ChatRenderDensity): ChatProcessRenderForm {
  return density === 'text' ? 'line' : 'card'
}

/**
 * 这次工具调用能不能降级成一行文本。
 *
 * 判定顺序就是优先级，每一步都对应一条不能让步的理由：
 *
 * 1. 不是 `line` 档 → 一律卡片（保持线上等价形态）；
 * 2. **交互类工具**（答题 / 审批 / 目标确认 / widget）→ 卡片：一行字点不了，功能直接没了；
 * 3. **输出即结果**（生成图 / 截图 / 命令附件）→ 卡片：结果就是那几张图，藏起来等于没做；
 * 4. **待审批** → 卡片：沙箱授权、危险操作授权不能只有一行字，这是安全底线；
 * 5. 其余 → 降级。
 *
 * 注意**错误不拦**：老大 2026-10-28 09:40 定「错误丢了就丢了，文字行显示红色就行」。
 * 所以失败的工具也是一行，只是状态字符是 `✗`、文字是红字（见 `ProcessTextLine`）。
 *
 * `keepAsCardToolNames` 由调用方传（`INTERACTIVE_TOOL_NAMES` 等），本文件不 import
 * 任何工具名常量 —— 那会把组件依赖链拉进来，纯函数就没法在 node 里跑了。
 */
export function shouldRenderToolAsLine(params: {
  density: ChatRenderDensity
  toolName: string
  /** 工具调用状态（`execution-outline` 的 `ToolExecutionItem.status`） */
  status: string
  requiresApproval: boolean
  /** 输出本身就是可视结果（图片 / widget / 截图 / 命令附件） */
  hasVisualResult: boolean
  keepAsCardToolNames: ReadonlySet<string>
}): boolean {
  if (deriveProcessRenderForm(params.density) !== 'line') return false
  if (params.keepAsCardToolNames.has(params.toolName)) return false
  if (params.hasVisualResult) return false
  if (params.requiresApproval || params.status === 'pending_approval') return false
  return true
}

