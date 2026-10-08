# Plan-S176：聊天窗留白封顶（② 真修 —— 先对齐、再压水位线）

> 归属 iter-v2-38。需求正文见 [`../requirements/S-176.md`](../requirements/S-176.md)。
> 状态：**口径已定（走 ② 真修），待老大下令开工**（2026-10-08 16:44）。参数「200px」只是老大的举例，实际口径 = **只要不全屏白着就行**。
> 老大的口径演变（三轮，都记在这儿免得再走回去）：① iter-28「高度撑住，不回收」→ 底下整片白；② iter-30「超半屏就收 `min-height`」→ 跳得更凶，被推翻；③ 「不回收完，留一部分当输出缓冲」= **现状**；④ 16:44 定 **② 真修**。

---

## 一、目标

异步并发工具（如同时读三个文件）在**会话仍在输出时**展开三个卡片、执行完各自折叠。当前每次折叠都会把「可见留白」撑出几百 px 且**不再收回**。本需求让留白**有上限且能回落**，同时不制造回跳。

**触发场景（老大 16:44 确认）**：折叠瞬间**会话仍在输出** ⇒ 走**流式分支**（水位线那条），不是流式结束分支。

---

## 二、现状机制（实读，行号为准）

留白由 `src/renderer/src/components/chat/MessageList/useMessageListScroll.ts` 的两段逻辑共同决定，**全程只动 `scrollTop`、不碰 `min-height`**：

| 环节 | 位置 | 作用 |
|---|---|---|
| 水位线（`min-height`） | `:122`（ref）/ `:127-130`（`applyMinHeight`，直写 DOM） | 撑住 `scrollHeight`，挡 clamp |
| 水位线上抬 | bottom-anchor effect 流式分支 `:656-682` | `needed = realBottom + gapTarget`，**仅在 `needed > 当前水位线` 时抬** |
| 单调下界 | `:137`（ref）+ `trackContentBottom`（`scroll-collapse-gate.ts:79-82`） | `realBottom` 流式期内**取历史最大值，只增不减** |
| 双向跟随（`scrollTop`） | `scrollToBottomImmediate:191-241` | 余量 `< 24` 补到 `gapTarget`；余量 `> gapCeiling` 才回收到 `gapTarget` |
| 冷却锁 | `scroll-collapse-gate.ts`（240ms） | 抑制回收方向的连续触发 |

**常数额度**（`utils.ts:221,224`）：`STREAMING_BOTTOM_FOLLOW_CHUNK = 240`、`STREAMING_BOTTOM_FOLLOW_REFILL_AT = 24`；天花板 `gapCeiling = clientHeight / 2`（半屏，两处：`:193-195`、`:666-668`）。

---

## 三、根因：两个叠加，缺一不可

**根因 ①：单调下界让「真实收缩」永远不被承认。**
`streamingBottomFloorRef` 在流式期只增不减（`:137`、`:184-189`、`trackContentBottom`），本意是滤掉「虚拟行卸载导致内容底骤降一整行、下一帧又回升」的自激噪声（S-150 加）。**代价是：三个卡片各折叠 100px，内容底真实降了 300px，`realBottom` 却纹丝不动** —— 系统仍按历史最高点摆视口，于是那 300px 全变成可见留白。

**根因 ②：回收触发线给到了半屏。**
双向跟随在 `24 ≤ 余量 ≤ 半屏` 期间**什么都不做**（`:228` 直接 `return`）。所以即使内容底下来了，也要等余量涨过**半屏**（1080p 视口约 400+px）才回收到 `gapTarget`。

⇒ **①** 让留白必然产生（而且是累计的），**②** 让留白可以涨到半屏才被清理。老大看到的「几百 px、不回收」正是两者叠加。

---

## 四、做法（② 真修，与 iter-30 的区别在顺序）

两处一起改，**都在 `scrollTop` 已经对齐之后**再做，所以不产生 clamp：

1. **下界允许回落（治根因 ①）** —— 区分「真收缩」与「虚拟行卸载噪声」：
   - 噪声的特征是**一帧内往返**（`trackContentBottom` 注释原话：写一次 `scrollTop` ⇒ 尾行卸载、内容底骤降 ⇒ 下一帧又挂回、回升）；
   - 真收缩的特征是**连续多帧持续偏低**。
   - ⇒ 规则：`raw` 低于当前 `floor` 时**不立刻采信**，连续 **K 帧**（建议 3，与既有 `FOLLOW_BOTTOM_SETTLE_FRAMES` 同量级）仍偏低才判定为真收缩，把 `floor` 重设为 `raw`。
   - 再叠加**幅度阈值**（低于 `floor` 不足 `SHRINK_EPS`，建议 24px，不认）——避免抖动式微调。

2. **回收触发线从半屏降到 `gapTarget`（治根因 ②）** —— 余量一旦超过 `gapTarget + ε` 就回收到 `gapTarget`（不再等到半屏）。「留一部分当输出缓冲」这条口径**保留**：`gapTarget` 就是那个缓冲，回收目标是它，不是 0。

3. **对齐后同步压水位线（真修的关键，也是和 iter-30 的区别）**：
   - 顺序固定：**先**写 `scrollTop = followTarget`（= `realBottom + gapTarget - clientHeight`），**再** `applyMinHeight(realBottom + gapTarget)`；
   - 此时 `scrollHeight == 水位线`、`maxScrollTop == followTarget == 刚写的 scrollTop` ⇒ **浏览器没有可 clamp 的余量 ⇒ 不跳**；
   - 这一「先对齐、再撤」的顺序**不是我新发明的** —— 流式结束那一帧（`:683-705`）已经这么干；本需求只是把它**搬进流式中途**。iter-30 被否掉的是「**不对齐就撤**」，不是「撤」本身。

4. **全部动作过同一把冷却锁**（`scroll-collapse-gate.ts` 的 240ms）：折叠动画 200ms 内 ResizeObserver 每帧回报，锁把一串收缩合并成**一次**回收。向大（内容增长、补缓冲）**永远放行**，不受锁限制。

---

## 五、步骤清单

- [ ] **步骤 1：抽纯函数（可回归）**
  - 新建 `src/renderer/src/components/chat/MessageList/scroll-watermark.ts`，零依赖，放三个判定：
    - `shouldRefloor(floor, raw, lowFrames, config)` —— 连续 K 帧偏低 + 幅度过阈才认（治根因 ①）；
    - `resolveGapTarget(chunk, viewportHeight, maxGap)` —— `min(240, 半屏, maxGap)`；
    - `shouldReclaim(remaining, gapTarget, epsilon)` —— 回收触发线（治根因 ②）。
  - 参数（`cooldownMs` 之外的 K / `SHRINK_EPS` / `maxGap`）集中成一个 `config`，与 `COLLAPSE_GATE_CONFIG` 同形。
  - **验证检查点**：`npm run typecheck` 0 错；纯函数无 React / DOM 依赖（同 `scroll-collapse-gate.ts` 的做法）。

- [ ] **步骤 2：接入 `useMessageListScroll.ts`**
  - 流式分支（`:656-682`）：把 `trackContentBottom` 换成「噪声过滤 + 真收缩采信」两段 —— 上抬立即，回落走 `shouldRefloor`。
  - `scrollToBottomImmediate`（`:191-241`）：回收触发线改 `shouldReclaim`；回收执行时**先写 `scrollTop`、再 `applyMinHeight`**（同帧顺序，见 §四.3）。
  - 冷却锁：新增的回收路径**共用** `collapseGateRef`，不另起一把。
  - 用户在上方阅读（`!canAutoScrollRef.current()`）时**一律不回收、不压水位线** —— 拽了就是抢用户的位置。
  - **验证检查点**：`npm run typecheck` 三配置 0 错；`npm test` 不破基线。

- [ ] **步骤 3：回归套件**
  - 新建 `tests/scroll-watermark/program.ts` + `package.json` 注册 `test:scroll-watermark`（同 `tests/scroll-collapse-gate` 的形）。
  - 断言至少覆盖：① 单帧骤降**不**认（噪声）；② 连续 K 帧偏低**认**（真收缩）；③ 增长方向永远采信；④ 回收触发线在 `gapTarget` 而非半屏；⑤ 冷却窗口内压掉重复回收；⑥ 时钟异常（回拨 / `NaN`）按「不冷却」处理（与 `isCollapseCoolingDown` 同口径）。
  - **验证检查点**：新套件全绿；`npm test` 总数 = 基线 + 新套件。

- [ ] **步骤 4：真机验证（本需求的重头，必做）**
  - 复现脚本：发一条会「并发读三个文件」的消息 → 观察每个卡片折叠的瞬间。
  - 逐项确认：① 折叠后留白**不再**累计到几百 px；② 折叠过程中**无回跳**（`scrollTop` 不来回动）；③ 滚动条长度与内容量**大致诚实**（能滚到真底、底下没有滚不到的白）；④ 流式结束后留白归零（现有行为不破）；⑤ 用户手动上滚阅读时**不被拽**。
  - **验证检查点**：以上五条逐条真机确认；不达标则回步骤 1 调 K / `SHRINK_EPS` / `maxGap`（这些值**只信真机，不信推算**）。

- [ ] **步骤 5：整体测通**
  - `npm run typecheck` 三配置 0 错；`npm test` 全绿；`dotnet build` 无关（纯渲染端改动）。
  - **验证检查点**：全绿 ⇒ 本刀测通，按一需求一刀提交。

---

## 六、涉及文件

| 文件 | 动作 |
|---|---|
| `src/renderer/src/components/chat/MessageList/scroll-watermark.ts` | **新建**：三个纯判定函数 + config |
| `src/renderer/src/components/chat/MessageList/useMessageListScroll.ts` | 修改：下界回落 + 回收触发线 + 对齐后压水位线 |
| `src/renderer/src/components/chat/MessageList/utils.ts` | 修改：`STREAMING_BOTTOM_FOLLOW_CHUNK` 的注释（把「不碰 min-height」这条旧结论**改成**「对上齐之后可以压」，否则下一个读代码的人又会被它劝退） |
| `tests/scroll-watermark/program.ts` | **新建**：回归套件 |
| `package.json` | 修改：注册 `test:scroll-watermark` |
| `docs/plans/iter-v2-38/requirements/S-176.md` | 回填现象、根因、实施记录 |

**不动**：`scroll-collapse-gate.ts`（240ms 锁原样复用）、`VirtualListContent.tsx`（`min-height` 直写 DOM 的约定不变）。

---

## 七、刻意不做

- **不动 `maxGap` 之外的「半屏」语义** —— `gapCeiling` 仍取半屏（矮窗口下 `min(240, 半屏)` 的原意保留），只是**回收触发线**另起一条。
- **不为「用户在上方阅读」做内容锚定** —— 用户上滚时内容收缩导致的位移，本次不处理（要处理是另一件事，属锚点维护）。
- **不删 `streamingBottomFloorRef`** —— 只给它加「持续偏低才回落」的条件，噪声过滤本身仍然是必需的。

---

## 八、待定参数（实施时真机调，先给建议值）

| 参数 | 建议初值 | 依据 | 调法 |
|---|---|---|---|
| 连续偏低帧数 K | 3 | 与 `FOLLOW_BOTTOM_SETTLE_FRAMES = 3` 同量级；噪声是「一帧往返」，3 帧足够分开 | 真机若仍见留白不消 ⇒ 降到 2；若见抖动 ⇒ 升到 4~5 |
| 收缩幅度阈值 `SHRINK_EPS` | 24 | 与 `STREAMING_BOTTOM_FOLLOW_REFILL_AT` 同值，避免与补缓冲打架 | 真机微调 |
| 留白上限 `maxGap` | 240（= 现 CHUNK） | 老大「200 只是举例、不全屏白就行」⇒ 不引入新数字，先复用 CHUNK | 老大真机觉得仍大 ⇒ 降到 200 / 160 |
