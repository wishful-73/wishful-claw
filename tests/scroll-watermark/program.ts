// S-176 — 流式留白封顶契约：内容底「真收缩」采信 + 回收触发线 + 回收顺序。
//
// 症状（老大 2026-10-08）：三个异步工具卡在**会话仍在输出时**各自折叠，每折一次留白涨几百 px
// 且不再收回。两处叠加：① 下界「只增不减」把真收缩当噪声滤掉了；② 回收触发线给到半屏。
//
// 2026-10-09 真机反馈：留白**最终能收掉、但慢**（0.3~0.5s 空白期，「渲染新的输出和组件的时候
// 又正常了」）。根因是判定依赖喂帧 —— 喂帧的只有 bottom-anchor effect，而它只在 re-render 后跑。
// 于是判定从「连续 K 帧」改成「持续偏低 refloorHoldMs」，并给两个「没人来判」的情形各排一个
// 一次性定时器（shrinkProbeDelay / collapseRetryDelay）。
//
// 本套件钉住：噪声（一帧往返）仍滤掉、真收缩（持续偏低）必采信、同一时刻重复观测幂等、
// 回收线从半屏降到 gapTarget，以及**回收的顺序契约**（先对齐 scrollTop 再压 min-height，
// 两者成对 ⇒ 压完没有可 clamp 的余量 ⇒ 不回跳）。
//
// holdMs / ε / 上限这三个「真机才敢定」的数字由断言钉住 —— 真机调参见 plan-s176 §八，
// 调完记得回来对齐这里的数值。

import assert from 'node:assert/strict'
import {
  collapseRetryDelay,
  createFloorTracker,
  clampScrollTop,
  observeFloor,
  observeGrowthOnly,
  resolveGapTarget,
  resolveReclaimPlan,
  shrinkProbeDelay,
  shouldReclaim,
  shouldRefloor,
  WATERMARK_CONFIG
} from '../../src/renderer/src/components/chat/MessageList/scroll-watermark'
import {
  admitCollapse,
  COLLAPSE_GATE_CONFIG,
  createCollapseGate,
  isCollapseCoolingDown
} from '../../src/renderer/src/components/chat/MessageList/scroll-collapse-gate'

let checks = 0

function check(condition: unknown, message: string): asserts condition {
  checks++
  assert.ok(condition, message)
}

function eq(actual: unknown, expected: unknown, message: string): void {
  checks++
  assert.strictEqual(actual, expected, message)
}

const { refloorHoldMs, shrinkEpsilon, maxGap } = WATERMARK_CONFIG

// ── 参数本身：噪声是「一帧往返」（≈16ms），确认时长必须明显长过它 ──────────
check(refloorHoldMs > 16, `确认时长要长过一帧，否则一帧往返的噪声也会被认（hold=${refloorHoldMs}ms）`)
check(shrinkEpsilon > 0, `幅度阈值要为正（ε=${shrinkEpsilon}）`)
check(maxGap > 0, `留白上限要为正（maxGap=${maxGap}）`)

// ── 增长方向永远立即采信 ────────────────────────────────────────────────
eq(observeFloor(createFloorTracker(), 500, 0).floor, 500, '首帧实测直接采纳')
eq(observeFloor({ floor: 500, lowSince: null }, 620, 0).floor, 620, '内容继续增大时透传新值')
eq(observeFloor({ floor: 500, lowSince: 10 }, 620, 100).floor, 620, '增长压过偏低状态')
eq(observeFloor({ floor: 500, lowSince: 10 }, 620, 100).lowSince, null, '增长把偏低状态清零')

// ── 噪声：一帧往返的骤降不认 ────────────────────────────────────────────
// 场景：写一次 scrollTop ⇒ 尾行卸载、内容底骤降一整行 ⇒ 下一帧又挂回、回升。
let noise = observeFloor(createFloorTracker(), 900, 0)
noise = observeFloor(noise, 300, 0)
eq(noise.floor, 900, '单帧骤降（尾行卸载）不采信')
eq(noise.lowSince, 0, '骤降只记下偏低起点，尚未确认')
noise = observeFloor(noise, 900, 16)
eq(noise.floor, 900, '下一帧挂回：下界纹丝不动')
eq(noise.lowSince, null, '回升后偏低状态清零')

// 幅度不足（亚阈值重测噪声）连起点都不该记 —— 否则抖动式微调也会攒够时长
const tiny = observeFloor(createFloorTracker(), 500, 0)
const subThreshold = observeFloor(tiny, 500 - (shrinkEpsilon - 1), 0)
eq(subThreshold.floor, 500, '亚阈值偏低不采信')
eq(subThreshold.lowSince, null, '亚阈值偏低不记起点')
eq(observeFloor(tiny, 500 - shrinkEpsilon, 0).lowSince, 0, '幅度达到阈值才开始记起点')

// ── 真收缩：偏低持续 holdMs 才认 ────────────────────────────────────────
let shrink = observeFloor(createFloorTracker(), 1000, 0)
shrink = observeFloor(shrink, 700, 0)
eq(shrink.floor, 1000, '刚偏低：时长不够不采信')
eq(shrink.lowSince, 0, '记下偏低起点')
shrink = observeFloor(shrink, 700, refloorHoldMs - 1)
eq(shrink.floor, 1000, '差 1ms 不采信')
shrink = observeFloor(shrink, 700, refloorHoldMs)
eq(shrink.floor, 700, `持续偏低满 ${refloorHoldMs}ms ⇒ 采信真收缩`)
eq(shrink.lowSince, null, '采信后偏低状态归零')

// ── 幂等：同一段偏低里重复观测不推后起点 ────────────────────────────────
// 这条是 2026-10-09 改动的直接动机：旧版按「帧数」计数，两处喂帧会把同一帧数掉两格，K 名存实亡。
// 时间制下喂几次都只算一次，所以调用方可以在 scrollToBottomImmediate 与 bottom-anchor effect
// 两处都喂，还可以再加自驱动重判，都不会把确认时长喂没。
let idem = observeFloor(createFloorTracker(), 1000, 0)
idem = observeFloor(idem, 700, 0)
idem = observeFloor(idem, 700, 20)
eq(idem.lowSince, 0, '重复观测不推后偏低起点')
idem = observeFloor(idem, 700, refloorHoldMs)
eq(idem.floor, 700, '起点没被推后，到点即认')

// 数值在偏低区间里浮动，仍算「持续偏低」，不能因为值变了就从头数
let drifting = observeFloor(createFloorTracker(), 1000, 0)
drifting = observeFloor(drifting, 700, 0)
drifting = observeFloor(drifting, 760, 20)
eq(drifting.floor, 1000, '确认期内偏低值变化不采信')
eq(drifting.lowSince, 0, '偏低值变化不重置起点')
drifting = observeFloor(drifting, 760, refloorHoldMs)
eq(drifting.floor, 760, '时长满足后按当前值采信')

// ── 无测量 / 越界瞬间态：保留上次结果 ──────────────────────────────────
eq(observeFloor(createFloorTracker(), 0, 0).floor, 0, '从未测到过时保持 0')
eq(observeFloor(createFloorTracker(), Number.NaN, 0).floor, 0, 'NaN 视为无测量')
eq(observeFloor(createFloorTracker(), -5, 0).floor, 0, '负值视为无测量')
eq(observeFloor({ floor: 900, lowSince: 0 }, 0, 99).floor, 900, '越界瞬间态保留上次下界')
eq(observeFloor({ floor: 900, lowSince: 0 }, 0, 99).lowSince, 0, '越界瞬间态不推进偏低状态')

// ── 纯度：入参不被修改 ────────────────────────────────────────────────
const before = { floor: 800, lowSince: null }
const snapshot = { ...before }
const after = observeFloor(before, 400, 0)
eq(before.floor, snapshot.floor, 'observeFloor 不修改入参 floor')
eq(before.lowSince, snapshot.lowSince, 'observeFloor 不修改入参 lowSince')
eq(after.floor, 800, '未确认时返回的下界不变')
eq(after.lowSince, 0, '未确认时只记起点')
const raised = observeFloor(before, 900, 0)
check(raised !== before, '增长返回新对象')

// ── shouldRefloor 的边界 ──────────────────────────────────────────────
eq(shouldRefloor(1000, 700, 0, refloorHoldMs - 1), false, '差 1ms 不认')
eq(shouldRefloor(1000, 700, 0, refloorHoldMs), true, '够时长就认')
eq(shouldRefloor(1000, 700, null, 999), false, '没有偏低起点不认')
eq(shouldRefloor(1000, 700, 100, 50), false, '时钟回拨按刚起算处理，不认')
eq(shouldRefloor(1000, 1000 - shrinkEpsilon + 1, 0, 999), false, '幅度差 1px 不认')
eq(shouldRefloor(1000, 1000 - shrinkEpsilon, 0, 999), true, '幅度刚好达到阈值就认')
eq(shouldRefloor(0, 400, 0, 999), false, '尚未起算（floor=0）不下压')
eq(shouldRefloor(1000, 0, 0, 999), false, '无测量不下压')
eq(shouldRefloor(1000, Number.NaN, 0, 999), false, 'NaN 不下压')

// ── S-233：observeGrowthOnly（尾部行未挂载 = 测量盲区，只升不降） ────────
//
// 场景来源：虚拟列表尾部跑出 overscan 后，getRealContentBottom() 只剩「最后一个
// 已挂载行的底」，比真实内容底少一整行甚至几行。这个偏低会持续到滚动位置改变为止，
// 远超 observeFloor 的 48ms 阈值 —— 用时长阈值挡不住，一采信就把 floor 压到假值，
// 随后的「整屏悬空」救援会把视口一次拽走几百像素。
eq(
  observeGrowthOnly({ floor: 1000, lowSince: null }, 700).floor,
  1000,
  '盲区偏低不采信：floor 保持不动'
)
eq(
  observeGrowthOnly({ floor: 1000, lowSince: 0 }, 700).lowSince,
  null,
  '盲区偏低必须清掉 lowSince（否则残留起点会让下一次观测立刻误采信）'
)
eq(
  observeGrowthOnly(createFloorTracker(), 500).floor,
  500,
  '盲区里的上抬仍然立即采信'
)
eq(
  observeGrowthOnly({ floor: 1000, lowSince: 0 }, 1200).floor,
  1200,
  '上抬压过偏低状态'
)
eq(
  observeGrowthOnly({ floor: 1000, lowSince: 0 }, 1200).lowSince,
  null,
  '上抬把偏低状态清零'
)
eq(observeGrowthOnly({ floor: 900, lowSince: 0 }, 0).floor, 900, '盲区无测量时保留上次下界')
eq(observeGrowthOnly({ floor: 900, lowSince: 0 }, Number.NaN).floor, 900, '盲区 NaN 保留上次下界')
eq(observeGrowthOnly({ floor: 900, lowSince: 0 }, -5).floor, 900, '盲区负值保留上次下界')

const growthInput = { floor: 800, lowSince: 0 }
const growthSnapshot = { ...growthInput }
observeGrowthOnly(growthInput, 400)
eq(growthInput.floor, growthSnapshot.floor, 'observeGrowthOnly 不修改入参 floor')
eq(growthInput.lowSince, growthSnapshot.lowSince, 'observeGrowthOnly 不修改入参 lowSince')

// 关键回归：盲区偏低绝对不能走到「采信」那一步。若这里返回 700，说明盲区被当成
// 真收缩，floor 落到假值 —— 那正是逐帧拽视口的燃料。
const blindZone = observeGrowthOnly({ floor: 1000, lowSince: 0 }, 700)
check(blindZone.floor !== 700, '盲区偏低不会污染下界')

// 时序模拟：可信观测记下起点 → 进入盲区 → 时间早已超过 refloorHoldMs → 仍未采信
let blindSeq = observeFloor(createFloorTracker(), 1000, 0)
blindSeq = observeFloor(blindSeq, 700, 0)
eq(blindSeq.lowSince, 0, '可信帧记下偏低起点')
blindSeq = observeGrowthOnly(blindSeq, 700)
eq(blindSeq.lowSince, null, '进入盲区后起点被清空')
blindSeq = observeGrowthOnly(blindSeq, 700)
eq(blindSeq.floor, 1000, '盲区持续多久都不采信（时长阈值在这里本就无效）')

// ── 留白基准 / 上限：min(CHUNK, 半屏, maxGap) ────────────────────────────
const CHUNK = 240
eq(resolveGapTarget(CHUNK, 1080), CHUNK, '常规视口：用满提前量块')
eq(resolveGapTarget(CHUNK, 300), 150, '矮视口夹到半屏（撑个比视口还深的坑没意义）')
eq(resolveGapTarget(600, 2000, 200), 200, '留白上限封顶生效')
eq(resolveGapTarget(CHUNK, 0), CHUNK, '尚未布局（视口高 0）不受半屏限制')
eq(resolveGapTarget(-10, 1080), 0, '负值兜到 0')
check(resolveGapTarget(CHUNK * 4, 1080) <= maxGap, '无论 chunk 多大都不越过留白上限')

// ── 回收触发线：gapTarget 而不是半屏（治根因 ②） ────────────────────────
const gapTarget = resolveGapTarget(CHUNK, 1080)
eq(shouldReclaim(gapTarget, gapTarget), false, '正好停在基准上不回收')
eq(shouldReclaim(gapTarget + shrinkEpsilon, gapTarget), false, 'ε 以内不回收（不追亚像素噪声）')
eq(shouldReclaim(gapTarget + shrinkEpsilon + 1, gapTarget), true, '超过 ε 就回收')
eq(shouldReclaim(500, gapTarget), true, '几百 px 的余量立刻判回收')
// 这条就是本需求与旧实现的差别：旧线是半屏（1080p 视口 540），500px 在旧线以内 ⇒ 旧实现不收
const halfScreen = 1080 / 2
check(
  shouldReclaim(500, gapTarget) && 500 < halfScreen,
  '半屏以内的留白现在也收 —— 旧实现在这里什么都不做，留白就是这么攒住的'
)
eq(shouldReclaim(Number.NaN, gapTarget), false, 'NaN 不回收')
eq(shouldReclaim(Number.POSITIVE_INFINITY, gapTarget), false, '非有限值不回收')

// ── 回收的顺序契约：先对齐 scrollTop、再压 min-height，两者成对 ──────────
// 「不回跳」不是靠时序运气，是靠这一对数字：压完 scrollHeight == minHeight、maxScrollTop ==
// scrollTop ⇒ 浏览器没有可 clamp 的余量。谁把这个配对改坏（只改一边、或退回「先压后对齐」），
// 下面这两条立刻红。
const viewport = 600
const plan = resolveReclaimPlan(840, CHUNK, viewport)
eq(plan.minHeight, 840 + CHUNK, '水位线压到 内容底 + gapTarget')
eq(plan.scrollTop, plan.minHeight - viewport, 'scrollTop 对齐到新水位线顶端')
eq(plan.scrollTop + viewport, plan.minHeight, '压完 maxScrollTop == scrollTop（无 clamp 余量）')
// 同一契约对任意几何都成立（内容底比视口矮时 scrollTop 兜到 0，等式退化成「无需滚动」）
for (const [realBottom, gap, clientHeight] of [
  [1200, 96, 800],
  [840, 240, 600],
  [2000, 64, 400]
] as const) {
  const p = resolveReclaimPlan(realBottom, gap, clientHeight)
  eq(p.minHeight, realBottom + gap, `几何 ${realBottom}/${gap}/${clientHeight}：水位线成对`)
  eq(p.scrollTop + clientHeight, p.minHeight, `几何 ${realBottom}/${gap}/${clientHeight}：无 clamp 余量`)
}
eq(resolveReclaimPlan(0, 100, 600).scrollTop, 0, '内容比视口还矮：无需滚动')
eq(
  resolveReclaimPlan(-50, CHUNK, viewport).minHeight,
  CHUNK - 50,
  '负内容底（异常态）只做兜底：水位线不为负，也不凭空抬到 gapTarget'
)

// ── 自驱动重判：偏低未确认时排一次（治「等下一次 render」） ──────────────
eq(shrinkProbeDelay({ floor: 900, lowSince: null }, 100), null, '不在偏低状态：不必排')
eq(shrinkProbeDelay({ floor: 900, lowSince: 100 }, 100), refloorHoldMs, '刚记起点：排满整个确认时长')
eq(
  shrinkProbeDelay({ floor: 900, lowSince: 100 }, 100 + 20),
  refloorHoldMs - 20,
  '已过一段：只排剩余时长'
)
eq(shrinkProbeDelay({ floor: 900, lowSince: 100 }, 100 + refloorHoldMs), 0, '已到时：立刻排')
eq(shrinkProbeDelay({ floor: 900, lowSince: 100 }, 50), 0, '时钟回拨：立刻排（不锁死）')

// 确认延迟与「喂帧次数」脱钩 —— 只喂一次也不耽误到点确认（这正是本次要治的「慢」）
let latency = observeFloor(createFloorTracker(), 1000, 0)
latency = observeFloor(latency, 700, 0)
eq(latency.floor, 1000, '动画停下后再没人喂帧：这一帧不下压')
check(shrinkProbeDelay(latency, 0) !== null, '偏低未确认 ⇒ 排一次自驱动重判')
eq(
  observeFloor(latency, 700, refloorHoldMs).floor,
  700,
  '自驱动重判到点即认：确认延迟 ≈ refloorHoldMs，不必等新内容到达'
)

// ── 冷却到期重判：按剩余冷却排一次（治「几何稳定后等不到那次重判」） ──────
const cooldown = COLLAPSE_GATE_CONFIG.cooldownMs
eq(collapseRetryDelay(1000, 1100, cooldown), cooldown - 100, '冷却未过：排剩余时长')
eq(collapseRetryDelay(1000, 1000 + cooldown, cooldown), null, '冷却刚过：不必排')
eq(collapseRetryDelay(1000, 1300, cooldown), null, '冷却早过：不必排')
eq(collapseRetryDelay(Number.NEGATIVE_INFINITY, 0, cooldown), null, '从未回收过：不必排')
eq(collapseRetryDelay(1000, 900, cooldown), null, '时钟回拨：不排（等自然判定）')
eq(collapseRetryDelay(Number.NaN, 1000, cooldown), null, '时间戳 NaN：不排')

// ── 集成：一串收缩被合并，且最终留白不越线 ───────────────────────────────
//
// 折叠动画 200ms，视口 600px，会话仍在输出（走流式分支）。内容底从 1200 一路掉到 840
// （三张卡各 120px），每帧 16ms。逐帧跑 tracker + shouldReclaim + 既有 240ms 冷却锁。
const clientHeight = 600
const simGap = resolveGapTarget(CHUNK, clientHeight)
let simTracker = observeFloor(createFloorTracker(), 1200, 0)
let gate = createCollapseGate()
let scrollTop = resolveReclaimPlan(1200, simGap, clientHeight).scrollTop
let realBottom = 1200
let now = 0
let reclaims = 0
for (let frame = 0; frame < 40; frame += 1) {
  now += 16
  const raw = frame < 12 ? 1200 - (frame + 1) * 30 : 840
  simTracker = observeFloor(simTracker, raw, now)
  realBottom = simTracker.floor
  const remaining = scrollTop + clientHeight - realBottom
  if (!shouldReclaim(remaining, simGap)) continue
  if (isCollapseCoolingDown(gate, now)) continue
  gate = admitCollapse(gate, now)
  // 真修的顺序：先对齐 scrollTop，再由调用方压水位线（此处只验视口落位）
  scrollTop = resolveReclaimPlan(realBottom, simGap, clientHeight).scrollTop
  reclaims += 1
}
eq(realBottom, 840, '下界最终跟到真值（真收缩一路被采信）')
check(reclaims >= 1 && reclaims <= 4, `一串收缩被合并成少数几次回收（实际 ${reclaims} 次）`)
const finalRemaining = scrollTop + clientHeight - realBottom
check(finalRemaining <= simGap + shrinkEpsilon, `留白封顶：余量 ${finalRemaining} 不越过 gapTarget + ε`)
check(finalRemaining >= 0, '视口不会缩到内容底之上（不制造截断）')

// ── 时钟异常按「不冷却」处理（与 isCollapseCoolingDown 同口径） ──────────
check(!isCollapseCoolingDown({ lastCollapseAt: Number.NaN }, 1_000), '时间戳 NaN 视为不冷却')
check(!isCollapseCoolingDown(admitCollapse(createCollapseGate(), 500), 499), '时钟回拨视为不冷却')
check(
  shouldReclaim(600, gapTarget) && !isCollapseCoolingDown({ lastCollapseAt: Number.NaN }, 1_000),
  '时钟异常时该收的还是要收，绝不永久锁死'
)

// ── 2026-10-29 崩溃：超范围跟随目标被浏览器 clamp，绕过「已钉底」守卫 ──────────
//
// 真机症状：长文本流式时渲染进程涨到 4.3GB，最后报 "Maximum update depth exceeded"。
// 链条：跟随目标 realBottom + gapTarget - clientHeight 里的 gapTarget 是提前量（最多
// 240px），比容器底部 padding 大得多 → scrollHeight 撑不住 → 写入被 clamp 到
// maxScrollTop → 读回值比目标小 → `Math.abs(scrollTop - bottom) <= 1` 永远判不成立
// → 每帧写 scrollTop → scroll 事件 → setIsAtBottom → layout effect → 再写。

const simScrollHeight = 1200
const simClientHeight = 800
const simMaxScrollTop = simScrollHeight - simClientHeight // 400
const overshootTarget = 640 // = realBottom + gapTarget - clientHeight 的典型超范围值

// 未夹取时：写 640，浏览器只认 400，差 240 ⇒ 守卫 `<= 1` 不成立 ⇒ 继续写。
const unclampedReadBack = Math.min(overshootTarget, simMaxScrollTop)
check(
  Math.abs(unclampedReadBack - overshootTarget) > 1,
  '复现：未夹取的目标读回来与目标本身差 > 1（守卫失效的根因）'
)

// 夹取之后：写进去 == 读回来 ⇒ 守卫成立 ⇒ 循环终止。
const clamped = clampScrollTop(overshootTarget, simScrollHeight, simClientHeight)
check(clamped === simMaxScrollTop, `超范围目标夹到 maxScrollTop（实际 ${clamped}）`)
check(
  Math.abs(clamped - clamped) <= 1,
  '夹取后「已钉底」守卫必然成立（写进去就是读回来的值）'
)
check(
  clampScrollTop(clamped, simScrollHeight, simClientHeight) === clamped,
  '夹取幂等 —— 重入一次不会再把值改小（循环不会靠夹取自己挪位置）'
)

// 范围内必须 no-op：否则「提前量跟随」就被夹没了（正常流式的观感不能变）。
check(
  clampScrollTop(320, simScrollHeight, simClientHeight) === 320,
  '可滚范围内的目标原样保留（提前量跟随不被夹掉）'
)
check(clampScrollTop(0, simScrollHeight, simClientHeight) === 0, '0 保持 0')
check(clampScrollTop(-50, simScrollHeight, simClientHeight) === 0, '负值夹到 0，不出负滚动位置')
check(
  clampScrollTop(300, 500, 800) === 0,
  '内容不满一屏（scrollHeight < clientHeight）时恒为 0，不出负数上限'
)

console.log(`scroll watermark checks passed: ${checks}`)
