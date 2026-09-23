import type { AgentStreamEvent } from '../../../shared/agent-stream-protocol'

/**
 * 一个 run（一次 agent 循环）的累积缓冲（iter-34 S-135）。
 *
 * 只装可加事件：正文 / 思考 / 工具参数。控制类事件不进这里，由 batcher
 * 直通 —— 否则会打乱渲染层看到的事件顺序。
 */
export interface BatcherAccumulator {
  readonly runId: string
  readonly sessionId: string
  /** 出站信封序号，每个 run 从 0 单调递增。渲染层按它检测丢包。 */
  seq: number
  textDelta: string
  thinkingDelta: string
  /** toolCallId → 最新一次 partialInput 快照。 */
  toolArgsDelta: Map<string, Record<string, unknown>>
  lastEventAt: number
}

export function createAccumulator(runId: string, sessionId: string): BatcherAccumulator {
  return {
    runId,
    sessionId,
    seq: 0,
    textDelta: '',
    thinkingDelta: '',
    toolArgsDelta: new Map(),
    lastEventAt: Date.now()
  }
}

/**
 * 把一个事件并进缓冲。返回 true 表示已并入（调用方继续攒），false 表示这
 * 不是可加事件、或者它和缓冲里已有的内容**不同类**（kind 冲突），调用方应
 * 先 flush 再直通。
 *
 * kind 冲突必须交还给调用方：`drainAccumulator` 的倒出顺序是固定的
 * （正文 → 思考 → 工具参数），若把不同类的 delta 攒进同一个窗口，倒出时就会
 * 重排到达顺序 —— iter-34 S-135 的成因，表现为同一段思考流被中间的正文劈成
 * 两截（iter-35 S-142）。
 *
 * 段边界事件（`text_start` / `thinking_start` / `thinking_end`）走 default
 * 分支：它们是控制类事件，前端靠它们决定「续段还是开段」，顺序不许被攒批打乱。
 */
export function accumulateEvent(acc: BatcherAccumulator, event: AgentStreamEvent): boolean {
  switch (event.type) {
    case 'text_delta':
      if (acc.thinkingDelta.length > 0) return false
      acc.textDelta += event.text
      return true
    case 'thinking_delta':
      if (acc.textDelta.length > 0) return false
      acc.thinkingDelta += event.thinking
      return true
    case 'tool_use_args_delta':
      // partialInput 是模型侧持续重写的累计快照（不是增量片段），
      // 所以后到的天然覆盖先到的。
      acc.toolArgsDelta.set(event.toolCallId, event.partialInput)
      return true
    default:
      return false
  }
}

/** 缓冲的「体积」：字符数 + 工具参数条数。 */
export function accumulatedSize(acc: BatcherAccumulator): number {
  return acc.textDelta.length + acc.thinkingDelta.length + acc.toolArgsDelta.size
}

/**
 * 把缓冲倒成一组事件并清空。固定顺序：正文 → 思考 → 工具参数。
 * 调用方负责把返回的数组包进信封。
 *
 * 这个固定顺序**只在窗口内同类时**才是安全的 —— 那由 `accumulateEvent` 的
 * kind 冲突判定保证：正文和思考不会同时留在缓冲里（第二个不同类的 delta
 * 会让调用方先 flush 再直通）。工具参数的 partialInput 是累计快照，
 * 相对正文/思考的位置不影响渲染。
 */
export function drainAccumulator(acc: BatcherAccumulator): AgentStreamEvent[] {
  const events: AgentStreamEvent[] = []

  if (acc.textDelta) {
    events.push({ type: 'text_delta', text: acc.textDelta })
    acc.textDelta = ''
  }

  if (acc.thinkingDelta) {
    events.push({ type: 'thinking_delta', thinking: acc.thinkingDelta })
    acc.thinkingDelta = ''
  }

  for (const [toolCallId, partialInput] of acc.toolArgsDelta) {
    events.push({ type: 'tool_use_args_delta', toolCallId, partialInput })
  }
  acc.toolArgsDelta.clear()

  return events
}
