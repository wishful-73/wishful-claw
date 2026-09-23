import type { ContentSegment } from './types'

/**
 * 流式段的落位规则（iter-35 S-142 重开）。
 *
 * 一条 assistant 消息跨多轮 iteration，`segments` 是它在气泡里的时序骨架。
 * 段的身份是 **(iteration, type)**，不是「到达顺序」—— 上游把思考与正文当两条
 * 独立通道发（思考 1_1 / 正文 2_1 / 思考 1_2 …），分片交错到达；按到达顺序 push
 * 会把一段思考或正文劈成多段。伤害不止于「多一条空思考」：劈开后末段变成
 * thinking，`splitProcessAndFinal` 从末尾倒扫第一项就停下，正文会被整段划进
 * 「执行过程」折叠收起（S-133 / S-142 的真症状）。
 *
 * 参照 Reasonix（`desktop/frontend/src/lib/types.ts` 的 `HistoryMessage`）：它按
 * 类型分槽（content / reasoning 两个字段，delta 各 append 到自己的槽），天然免疫
 * 交错；我们多一层 iteration 分组，用来保留轮内时序。
 */

/** 段在本 iteration 段组内的固定次序：思考 → 正文 → 工具卡。与到达顺序无关。 */
export const SEGMENT_KIND_ORDER: Record<ContentSegment['type'], number> = {
  thinking: 0,
  text: 1,
  tool_use: 2
}

/** 取本 iteration 里指定类型的槽（thinking / text 每轮各一个）。 */
export function findSegmentSlot(
  segments: ContentSegment[],
  iteration: number,
  type: ContentSegment['type']
): ContentSegment | undefined {
  return segments.find((seg) => seg.type === type && seg.iteration === iteration)
}

/**
 * 把新段插进「本 iteration 段组」里按 kind 固定序的位置。
 *
 * 同一 iteration 的段天然连续（都由这里落位）；该轮还没有任何段时直接追加到末尾，
 * 跨轮时序因此保持不变。同类多段（并行工具卡）保持到达顺序 —— 比较在遇到同类段时
 * 就停，新段排在最后一个同类段之后。
 */
export function insertSegment(segments: ContentSegment[], seg: ContentSegment): void {
  let last = -1
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i].iteration === seg.iteration) {
      last = i
      break
    }
  }
  if (last < 0) {
    segments.push(seg)
    return
  }

  const order = SEGMENT_KIND_ORDER[seg.type]
  let at = last + 1
  for (let i = last; i >= 0 && segments[i].iteration === seg.iteration; i--) {
    if (SEGMENT_KIND_ORDER[segments[i].type] > order) {
      at = i
    } else {
      break
    }
  }
  segments.splice(at, 0, seg)
}

/**
 * 给本 iteration 的思考段打完成标记（没有就跳过）。
 *
 * 只认本 iteration：段不再只追加到数组末尾，倒扫会先撞上后面轮次的段。
 */
export function closeThinkingSegmentOfIteration(
  segments: ContentSegment[] | undefined,
  iteration: number,
  at: number
): void {
  if (!segments) return
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]
    if (segment.type !== 'thinking') continue
    if (segment.iteration !== iteration) continue
    if (!segment.completedAt) segment.completedAt = at
    return
  }
}

/**
 * 把一条 delta 落到本 iteration 的对应槽，返回该槽（调用方据此同步 `msg.text` / `msg.thinking`）。
 *
 * 这就是 `flushStreamDeltas` 的循环体 —— 抽出来是为了让 store 与回归套件跑同一份代码。
 */
export function applyStreamDelta(
  segments: ContentSegment[],
  iteration: number,
  delta: { kind: 'text' | 'thinking'; value: string },
  now: number
): ContentSegment {
  let seg = findSegmentSlot(segments, iteration, delta.kind)
  if (!seg) {
    seg = { type: delta.kind, iteration, startedAt: now }
    insertSegment(segments, seg)
  }

  if (delta.kind === 'text') {
    seg.text = (seg.text ?? '') + delta.value
    // 正文一开始，本轮思考即完结（等价 Reasonix 的 reasoningComplete）。
    closeThinkingSegmentOfIteration(segments, iteration, now)
  } else {
    seg.thinking = (seg.thinking ?? '') + delta.value
    // 续写 ⇒ 撤回「已完成」（正文/工具卡曾在中间把它标记成完结）。
    if (seg.completedAt) delete seg.completedAt
  }

  return seg
}
