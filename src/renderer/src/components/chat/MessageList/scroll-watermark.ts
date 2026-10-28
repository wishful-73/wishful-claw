/**
 * S-176 — 流式留白封顶：内容底的「真收缩」采信 + 回收触发线。
 *
 * 症状（老大 2026-10-08）：异步并发工具（同时读三个文件）在**会话仍在输出时**展开三个卡片、
 * 各自折叠，每折一次就把可见留白撑出几百 px。
 *
 * 两处叠加（plan-s176 §三）：
 * - 下界「只增不减」让**真实收缩永远不被承认** —— 卡片折叠降下去的高度被当成「虚拟行卸载
 *   噪声」滤掉了，系统仍按历史最高点摆视口，差值全变留白；
 * - 回收触发线给到**半屏**（`gapCeiling`），留白要涨过半屏才被清理。
 *
 * 本模块给出四件事的纯判定：
 * 1. `observeFloor` / `shouldRefloor` —— 噪声与真收缩的区分。噪声的特征是**一帧内往返**；
 *    真收缩的特征是**持续偏低**。于是：上抬立即采信，回落要偏低**持续 `refloorHoldMs`**。
 * 2. `resolveGapTarget` —— 留白基准（同时是留白上限）：`min(CHUNK, 半屏, maxGap)`。
 * 3. `shouldReclaim` —— 回收触发线从半屏降到 `gapTarget + ε`。
 * 4. `resolveReclaimPlan` —— 回收动作的**顺序契约**：先对齐 `scrollTop`、再压 `min-height`，
 *    且两者配对（`scrollTop + clientHeight === minHeight`）⇒ 压完 `maxScrollTop == scrollTop`
 *    ⇒ 浏览器没有可 clamp 的余量 ⇒ 不回跳。这是与 iter-30 被推翻那次的**唯一区别**。
 *
 * 另有两条编排用的延迟计算（`shrinkProbeDelay` / `collapseRetryDelay`）—— 它们把「等下一次
 * 调用」变成「自己排一次调用」，治的是 S-176 真机反馈的「空白期 0.3~0.5s」。
 *
 * 纯函数、零 React / DOM 依赖 —— 与 `tests/scroll-watermark` 跑同一份代码
 * （同 `scroll-collapse-gate.ts` / S-146 `updater-error-format` 的做法）。
 */

export interface WatermarkConfig {
  /**
   * 持续偏低多久（**毫秒**）才认「真收缩」。
   *
   * 为什么是时间不是帧数：判定原先写的是「连续 K 帧」，可喂帧的只有 bottom-anchor effect，
   * 而它**只在 re-render 之后跑**。折叠动画一停、又没有新内容到达 ⇒ 没人喂帧 ⇒ 计数冻在
   * 1~2 ⇒ 永远凑不满 ⇒ 下界不降 ⇒ 留白挂着。老大 08:44 实测的 0.3~0.5s 空白期、
   * 「当渲染新的输出和组件的时候又正常了」—— 那个「又正常了」正是新 render 来喂帧的时刻。
   *
   * 换成时间之后：同一个 `performance.now()` 喂几次都只算一次（不吃帧率），而且**任何一次
   * 后续调用**（哪怕 500ms 后）都能立刻判定 —— 不再依赖喂帧频率。
   *
   * 取值 48ms ≈ 3 帧 @60fps：噪声是「一帧往返」（≈16ms），48ms 要连续 3 帧偏低才可能误认，
   * 而一帧往返的噪声根本不会连续 3 帧偏低。
   */
  refloorHoldMs: number
  /** 低于当前下界不足这个幅度（px）就不认 —— 免去抖动式微调。 */
  shrinkEpsilon: number
  /** 留白上限（px）：视口内给后续内容占位的「待填充区」最深到这儿。 */
  maxGap: number
}

/**
 * 初值（真机可调，plan-s176 §八）：
 * - `refloorHoldMs = 48`（≈3 帧）—— 真机若仍见留白不消就降到 32，见抖动就升到 64~80。
 * - `shrinkEpsilon = 24`，与 `STREAMING_BOTTOM_FOLLOW_REFILL_AT` 同值，免得与补缓冲打架。
 * - `maxGap = 240`，先复用 `STREAMING_BOTTOM_FOLLOW_CHUNK`。老大口径是「200 只是举例、
 *   不全屏白着就能接受」，所以不引入新数字；真机觉得仍大再降。
 */
export const WATERMARK_CONFIG: WatermarkConfig = {
  refloorHoldMs: 48,
  shrinkEpsilon: 24,
  maxGap: 240
}

export interface FloorTracker {
  /** 当前采信的内容底（`getRealContentBottom` 坐标系）。 */
  floor: number
  /** 偏低起始时刻（`performance.now()` 坐标系）；`null` = 此刻不在偏低状态。 */
  lowSince: number | null
}

export function createFloorTracker(): FloorTracker {
  return { floor: 0, lowSince: null }
}

/**
 * 这一刻的实测值该不该把下界压低？**偏低持续 `refloorHoldMs` 且幅度过阈**才认。
 *
 * `raw <= 0` 是「无挂载行 / 越界瞬间态」，不参与比较（同已删除的 `trackContentBottom` 口径）。
 * `floor <= 0`（还没起算）一律不认 —— 第一次实测交给增长分支直接采纳。
 * 时钟异常（`now < lowSince`）按「刚起算」处理，绝不把下界永久锁死。
 */
export function shouldRefloor(
  floor: number,
  raw: number,
  lowSince: number | null,
  now: number,
  config: WatermarkConfig = WATERMARK_CONFIG
): boolean {
  if (!(raw > 0)) return false
  if (!(floor > 0)) return false
  if (floor - raw < config.shrinkEpsilon) return false
  if (lowSince === null) return false
  if (!(now >= lowSince)) return false
  return now - lowSince >= config.refloorHoldMs
}

/**
 * 观测一次。入参不被修改。
 *
 * - 上抬**立即**采信 —— 内容在长，跟迟了就是丢帧；
 * - 回落走 `shouldRefloor`：偏低不足 `shrinkEpsilon` 视作平移噪声（`lowSince` 清空），
 *   幅度够但时长不够只记起点、`floor` 保持不动（那一帧视口纹丝不动，噪声不会引起位移）。
 *
 * 同一时刻重复观测是幂等的（`lowSince` 不会被推后）—— 调用方因此可以放心地在多处喂帧，
 * 不必担心把确认时长喂没了。
 */
export function observeFloor(
  tracker: FloorTracker,
  raw: number,
  now: number,
  config: WatermarkConfig = WATERMARK_CONFIG
): FloorTracker {
  if (!(raw > 0)) return tracker
  const { floor, lowSince } = tracker
  if (raw > floor) return { floor: raw, lowSince: null }
  if (floor - raw < config.shrinkEpsilon) return { floor, lowSince: null }
  const since = lowSince === null || !(now >= lowSince) ? now : lowSince
  if (shouldRefloor(floor, raw, since, now, config)) return { floor: raw, lowSince: null }
  return { floor, lowSince: since }
}

/**
 * S-233（2026-10-27）：**只升不降**的观测 —— 「实测底不可信」时专用。
 *
 * 什么时候不可信：`getRealContentBottom()` 只遍历**已挂载**的行，尾部行一旦跑出
 * 虚拟器的 overscan 范围，实测底就掉到「最后一个已挂载行」的底 —— 比真实内容底少
 * 一整行甚至几行。此时它不是内容底，是**测量盲区**。
 *
 * 为什么不能靠 `observeFloor` 的时长阈值挡：S-176 的注释写着「噪声是**一帧往返**
 * （≈16ms），48ms 要连续 3 帧偏低才可能误认」。这个前提对挂载缺失不成立 ——
 * 盲区会**持续到滚动位置改变为止**，远不止 3 帧。于是 `lowSince` 一到 48ms 就被采信，
 * floor 被压到假值，跟随目标跟着骤降 ⇒ 视口被拽动 ⇒ 一滚就又挂载回尾部 ⇒
 * 实测底回升 ⇒ floor 上抬 ⇒ 再拽回。**自持极限环，不需要任何新内容。**
 *
 * 这也是「多轮之后才出现、不是一开始就跳」的机械解释：行数少时全部行都在 overscan
 * 内、尾部永远挂载，盲区根本不存在；行数一多，尾部才可能缺席。
 *
 * 与 `observeFloor` 的两点差别：
 * 1. 偏低**不采信**（floor 保持不动）；
 * 2. `lowSince` **必须清空** —— 否则不可信期之前记的起点会残留在那里，等下一次
 *    可信观测时 `shouldRefloor` 立刻判为「已经等够了」而误采信。
 */
export function observeGrowthOnly(tracker: FloorTracker, raw: number): FloorTracker {
  if (!(raw > 0)) return tracker
  if (raw > tracker.floor) return { floor: raw, lowSince: null }
  return { floor: tracker.floor, lowSince: null }
}

/**
 * 留白基准（= 视口底边停在内容底下方多远），**同时就是留白上限**。
 *
 * 三个上限取最小：`chunk`（提前量块）、半屏（视口矮时 240 可能不止半屏）、`maxGap`
 * （老大口径的可见留白封顶）。`viewportHeight <= 0`（尚未布局）时半屏那一条不参与。
 */
export function resolveGapTarget(
  chunk: number,
  viewportHeight: number,
  maxGap: number = WATERMARK_CONFIG.maxGap
): number {
  const ceiling = viewportHeight > 0 ? viewportHeight / 2 : Number.POSITIVE_INFINITY
  const target = Math.min(chunk, ceiling, maxGap)
  return target > 0 ? target : 0
}

/**
 * 该往下收了吗？—— 余量（视口底边超出内容底的距离）涨过 `gapTarget + ε` 才收。
 *
 * S-176 与旧实现的差别就在这条线：旧线是**半屏**（1080p 视口约 400+px，留白就是这么攒出来的），
 * 新线是 `gapTarget` —— 「留一部分当输出缓冲」那条口径保留，但缓冲只有 `gapTarget` 那么厚。
 * ε 兜住亚像素重测噪声，免得差一两 px 也来回写 `scrollTop`。
 */
export function shouldReclaim(
  remaining: number,
  gapTarget: number,
  epsilon: number = WATERMARK_CONFIG.shrinkEpsilon
): boolean {
  if (!Number.isFinite(remaining)) return false
  return remaining > gapTarget + epsilon
}

export interface ReclaimPlan {
  /** 先写的 `scrollTop`。 */
  scrollTop: number
  /** 后压的 `min-height`。 */
  minHeight: number
}

/**
 * 回收动作的**顺序契约**（S-176 的核心，也是与 iter-30 被推翻那次的唯一区别）。
 *
 * 两步必须成对且按序落到 DOM：**先** `scrollTop`、**再** `min-height`。
 * 压完 `scrollHeight == minHeight`、`maxScrollTop == scrollTop` ⇒ 浏览器**没有可 clamp 的余量**
 * ⇒ 这一帧不回跳。iter-30 被否掉的是「**不对齐就撤**」（撤在前、clamp 在后，必然回跳），
 * 不是「撤」本身。流式结束那一帧早就这么干了，本需求只是把它搬进流式中途。
 *
 * 返回值故意做成一对，让断言能钉住 `scrollTop + clientHeight === minHeight` ——
 * 谁把这个配对改坏（比如只改一边、或退回「先压后对齐」），套件立刻红。
 */
export function resolveReclaimPlan(
  realBottom: number,
  gapTarget: number,
  clientHeight: number
): ReclaimPlan {
  const minHeight = Math.max(0, realBottom + gapTarget)
  const scrollTop = Math.max(0, minHeight - clientHeight)
  return { scrollTop, minHeight }
}

/**
 * 偏低但还没确认 ⇒ 还要等多久（ms）再判一次；否则 `null`（不必排）。
 *
 * 治的是「等下一次调用」：判定改时间制之后仍然需要**有人来判**，而 bottom-anchor effect
 * 只在 re-render 后跑。所以偏低未确认时按剩余时长排一次自驱动调用，把 0.3~0.5s 的空白期
 * 压到 ≈ `refloorHoldMs`。
 */
export function shrinkProbeDelay(
  tracker: FloorTracker,
  now: number,
  config: WatermarkConfig = WATERMARK_CONFIG
): number | null {
  if (tracker.lowSince === null) return null
  if (!(now >= tracker.lowSince)) return 0
  const remaining = config.refloorHoldMs - (now - tracker.lowSince)
  return remaining > 0 ? remaining : 0
}

/**
 * 回收被冷却锁压掉 ⇒ 还要等多久（ms）再判一次；否则 `null`。
 *
 * S-150 的注释写着「窗口过了再按当时的几何重判」，但那个「再判」实际依赖**下一次调用** ——
 * 几何已稳定时就永远不再判，回收白白漏掉一次。这里把剩余冷却时长算出来，到期补一次调用。
 * 时钟异常（回拨 / `NaN`）返回 `null`：不排，等自然判定 —— 与 `isCollapseCoolingDown`
 * 「宁可多收一次也不永久锁死」同口径。
 */
export function collapseRetryDelay(
  lastCollapseAt: number,
  now: number,
  cooldownMs: number
): number | null {
  const elapsed = now - lastCollapseAt
  if (!(elapsed >= 0)) return null
  const remaining = cooldownMs - elapsed
  return remaining > 0 ? remaining : null
}
