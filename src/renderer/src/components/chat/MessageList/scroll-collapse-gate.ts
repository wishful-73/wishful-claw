/**
 * S-150 — 高度回收冷却锁。
 *
 * 症状：聊天窗视口上下回跳，最难受的是**回跳**（`scrollTop` 反向变小）。
 *
 * 单次高度回收本身已经能做成单向、一次到位（iter-30 S-32 的「先对齐真底再撤水位线」）。
 * 疼的是**同一瞬间连着收几次**：折叠动画（0.2s）、虚拟行重测、水位线撤销各自报一次高度
 * 回缩，每一报都让跟随逻辑把 `scrollTop` 往小推一把 —— 而 `scrollHeight` 又在同一段时间
 * 里变化，浏览器 clamp 一下、跟随逻辑补一下，来回拉锯就是抖动。
 *
 * 对策：把「回收」当排他动作。一次回收之后开一个冷却窗口，窗口内不再启动新的回收
 * （视口只允许往下走，绝不往回收），窗口结束再从**当时的**真实几何重新判定，而不是把
 * 窗口内被压掉的那几次补做一遍。一串连续收缩于是被合并成一次位移。
 *
 * 纯函数、零依赖 —— 与回归套件跑同一份代码（同 S-146 `updater-error-format` 的做法），
 * 冷却语义由断言钉住，而不是只活在滚动逻辑的注释里。
 */

export interface CollapseGateConfig {
  /** 两次高度回收之间的最小间隔（ms）。 */
  cooldownMs: number
}

export interface CollapseGate {
  /** 最近一次受理的回收时刻（`performance.now()` 坐标系）；负无穷表示从未回收。 */
  lastCollapseAt: number
}

/**
 * 冷却时长 **240ms**：比折叠动画（200ms）略长。
 *
 * 一串收缩事件整个落在窗口内，窗口结束时几何已稳定，只补一次就到目标；窗口再短会在动画
 * 中途又收一次，那一下照样看得出抖动。再长则「内容缩了、视口迟迟不跟」，留白顶到头。
 */
export const COLLAPSE_GATE_CONFIG: CollapseGateConfig = {
  cooldownMs: 240
}

export function createCollapseGate(): CollapseGate {
  return { lastCollapseAt: Number.NEGATIVE_INFINITY }
}

/**
 * 冷却中吗？是则调用方**跳过**本次回收，等窗口过了再按当时的几何重判一次。
 *
 * 时钟异常一律按「不在冷却」处理（`elapsed` 为负或 NaN）：宁可多收一次，也不能把视口
 * 永久锁死在冷却里 —— 那会变成内容长出去视口也不跟，比抖动更糟。
 */
export function isCollapseCoolingDown(
  gate: CollapseGate,
  now: number,
  config: CollapseGateConfig = COLLAPSE_GATE_CONFIG
): boolean {
  const elapsed = now - gate.lastCollapseAt
  if (!(elapsed >= 0)) return false
  return elapsed < config.cooldownMs
}

/** 受理一次回收：刷新时间戳。入参不被修改。 */
export function admitCollapse(gate: CollapseGate, now: number): CollapseGate {
  if (gate.lastCollapseAt === now) return gate
  return { lastCollapseAt: now }
}

// S-176（2026-10-09）：本文件原先的 `trackContentBottom`（内容底「只增不减」过滤）已删除，
// 职责移到 `scroll-watermark.ts` 的 `observeFloor`。
//
// 删它的原因不是噪声过滤不需要了 —— 那个过滤仍然是必需的（`getRealContentBottom` 遍历的是
// **当前挂载的行**，尾行在可见范围边界进出会让内容底骤降一整行、下帧回升）。问题是「只增不减」
// 把**真收缩**一并滤掉了：三张工具卡折叠各降 100px，下界纹丝不动 ⇒ 那 300px 全变成可见留白
// 且永不收回（S-176 的根因 ①）。新实现把区分依据从「方向」换成「持续时长」：上抬立即，
// 回落要偏低持续 `refloorHoldMs` 才认 —— 噪声是「一帧往返」，真收缩是「持续偏低」。
// （2026-10-09 真机反馈后又从「连续 K 帧」改成时间制：帧计数依赖 re-render 喂帧，
// 动画停下就冻住，确认迟迟到不了。）
