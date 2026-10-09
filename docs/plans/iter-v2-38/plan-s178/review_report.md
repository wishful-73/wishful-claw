# 审查报告：plan-s178（阶段五 · 审查态）

> 被审查对象：需求 `docs/plans/iter-v2-38/requirements/S-178.md`；计划 `docs/plans/iter-v2-38/plan-s178/plan.md`；未提交工作区改动（`git diff HEAD`，5 个源码文件 + 文档）。
> 审查方式：独立 subagent（code-reviewer，只读源码）；**未改任何文件、未跑构建/测试**，全部结论基于静态实读。
> 时间：2026-10-09

---

## 一、总体结论

**❌ 0 项 = 0 ・ 可进入验证态（阶段六）。**

改动与需求/计划一致，且**三层都补**（`limiter.onQueued` → `executor` 发 queued/start/dequeued → 渲染端适配两 case），符合「只补一层没用」的判断。并发语义**逐行等价**、无倒退；旧签名兼容（`onQueued = null`），Goal 与既有调用点零改动；无新依赖、无硬编码密钥、无魔法数字、无越层。

仅余 3 条 ⚠️（1 条潜在契约风险·当前调用方不可达 / 1 条测试覆盖缺口 / 1 条**新发现的既有路径被新行为点亮**）+ 5 条 ℹ️，均不阻断。

---

## 二、逐项结论（审查项 10 条）

| # | 审查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 并发语义等价（无倒退） | ✅ | `SubAgentConcurrencyLimiter.cs:70-100` `AcquireWithFlag` 与原 `AcquireAsync` **四分支逐一对应**（预取消 → `FromCanceled`；`_running<_max && _queue.Count==0` → `_running++`+`FromResult`；否则入队+挂注册），仅多返回 `Queued` 标志；`Pump`/`Release`/`Cancel`/`Remove`/`SetLimit` **未改动** |
| 2 | 「是否入队」判定与入队同锁原子 | ✅ | 判定与 `_queue.Enqueue` 同在 `lock (_sync)`（`:71-99`），返回值 `Queued=true` 仅出自入队分支 ⇒ 无「判完不放行」的窗口 |
| 3 | queued 必须先于 start（命门顺序契约） | ✅ | `SubAgentExecutor.cs:113-124`：`await onQueued()` 在 **锁外**且**先于** `return await pending`；start 仅在 `AcquireSubAgentSlotAsync` 返回后（lease 到手）发（`:136-140`）⇒ queued 必然先于 start |
| 4 | 锁纪律 / 无死锁 | ✅ | 静态锁序恒为 `Sync`→`_sync`（`Configure`→`SetLimit` 与 `AcquireAsync`→`AcquireWithFlag` 同向），无逆序获取 |
| 5 | 续体不在锁内运行（「锁外 await」承诺） | ✅ | `Waiter.Completion` 用 `TaskCreationOptions.RunContinuationsAsynchronously`（`:201-202`）⇒ 即便 `Pump()` 在 `_sync` 内 `TrySetResult`，续体（含 start emit 的 IO）也不在锁内执行 |
| 6 | 取消路径（queued→dequeued） | ✅ | `:127-131` `catch (OperationCanceledException)` 仅在 `queued` 为真时补发 dequeued 且 `throw;` 保栈；预取消（`Queued=false`）不补发，与 `Program.SubAgentConcurrency.cs` 断言一致 |
| 7 | 错误处理 | ✅ | `TryEmitSubAgentEventAsync`（`:143-160`）吞 `Exception` + `WorkerLog.Warn`（`WorkerLog.Warn(string)` 实存于 `WishfulClaw.Core/Protocol/WorkerLog.cs:42`）⇒ 事件为观测通道，不反噬主流程 |
| 8 | 渲染端适配补齐 | ✅ | `adapt-sub-agent-event.ts:23-37` 补 `sub_agent_queued`（带 `input`）/`sub_agent_dequeued`；`types.ts:98-109` union 已备；`chat-store/index.ts:842-846` `if (subEvent)` 不再拦掉 |
| 9 | 渲染端幂等（错序/重复事件） | ✅ | `sub-agent-slice.ts:53`（已存在卡 ⇒ 忽略 queued）、`:112`（仅 `isQueued` 卡转态）、`:133`（已存在非 queued ⇒ 忽略 start）、`:96-99`（dequeued 仅 `isQueued` 删卡）、`:341-343`（end 对已删卡 `if (sa)` no-op） |
| 10 | 无新依赖 / 无越层 / 无硬编码 | ✅ | diff 仅 `System`（`Func<Task>`）+ 既有 `WorkerLog`；C# 改动全在 Agent 层，TS 改动全在 renderer store 层；无路径/密钥/魔法数 |

---

## 三、发现的问题

### ❌ 必须修

**无。**

### ⚠️ 建议修

**⚠️1. `AcquireAsync` 的 `onQueued` 若抛异常 ⇒ 槽位 + 队列双泄漏（潜在契约风险）。**

`SubAgentConcurrencyLimiter.cs:113-124`：

```csharp
if (queued && onQueued is not null)
{
    await onQueued();          // ← 若此处抛出，下面这行永不执行
}
return await pending;
```

一旦 `onQueued` 抛出：
1. `return await pending` 不可达 ⇒ 该 waiter 的 `ValueTask` **永不被 await**；
2. waiter 仍留在 `_queue` 中（`Queued=true` 时已 `Enqueue`），随后 `Pump()` 会为其 `_running++` 并 `TrySetResult(new Releaser(...))` —— 但无人持有该 Releaser ⇒ **永不 `Dispose`** ⇒ `_running` 永久 +1，**并发容量永久缩水**（且队首这张「死 waiter」会持续吃掉名额）。

**可达性判定：当前唯一调用方不可达。** 唯一调用点 `SubAgentExecutor.cs:113-124` 的 lambda 内只有两个语句：`queued = true`（不会抛）与 `await TryEmitSubAgentEventAsync(...)`（内部 `try/catch(Exception)` 全吞）；其余调用点（`GoalSubAgentExecutor.cs:50`、测试）传 `null` 或非抛出 lambda。故**不判 ❌**。但这是新的**契约隐患**：`AcquireAsync` 此前是「不可能因回调失败而让步」的纯闸门，现在多了一个「回调可致容量泄漏」的入口 —— 下一个复用 `onQueued` 的调用方未必记得「回调绝不能抛」。

建议（二选一，成本都极低）：

```csharp
// 甲：把这条契约在闸门内部兜住（推荐 —— 与既有「事件失败不反噬」的哲学一致）
if (queued && onQueued is not null)
{
    try { await onQueued(); }
    catch (Exception ex)
    {
        WorkerLog.Warn($"sub-agent onQueued callback failed error={ex.GetType().Name}: {ex.Message}");
    }
}
```

```csharp
// 乙：至少在 XML 注释里写死契约
/// <param name="onQueued">… ∈ 不得抛出异常；抛出将导致该调用者通过队列路径获取的租约泄漏。</param>
```

**⚠️2. 新增断言只覆盖 limiter 层；执行器层「queued 必先于 start / 立即放行只发 start」无回归网。**

`Program.SubAgentConcurrency.cs` 新增 5 条真实断言（不排队零回调 / 恰好一次 / 取消一次 / `AssertQueuedPrecedesLeaseAsync` 顺序 / 预取消零）—— **非恒真，质量合格**（逐条推演：`onQueued` 与 `AcquireAsync` 首段同步执行 ⇒ 计数/顺序在 `await Task.Delay(25)` 前即已确定，不 flaky）。但这仍是 **limiter 层**的断言；compliance ⚠️1 要的「queued 先于 start」在**执行器层**只有**结构保证**（删顶部 emit + 挪到 lease 之后），无任何自动化断言。若日后有人把 `start` 挪回 `ExecuteAsync` 顶部，本套件全绿而需求静默回归。

建议：可选补一条执行器级断言 —— 执行器 emit 走 `AgentRuntimeTools.EmitAsync(parentState, …)`，而该函数在 `parentState.SuppressTransportEvents && EventObserver is not null` 时**把事件路由到 EventObserver 而非传输层**（`AgentRuntimeTools.cs:238-249`），因此可把**父** state 设成该模式并用 `EventObserver` 收集事件名，跑一次 `ExecuteAsync(background:false, max=1 已占满)`，断言「收集到 `sub_agent_queued` 且早于 `sub_agent_start`」。若成本过高，退而求其次：在 plan §五 显式写明「顺序仅由结构保证、无回归测试，改此处必须同步改测试」。现状 plan 只是隐含，未写明。

**⚠️3. 排队卡可被持久化：`buildPersistedSubAgentSnapshot` 未归一化 `isQueued` ⇒ 历史里可能留一张永远「Queued」的卡（**本次改动新点亮的既有路径**）。**

新行为使 `sub_agent_queued` **真的会到**渲染端，而 queued 分支会 `shouldPersistSubAgentHistory = true` 并立即落库（`sub-agent-slice.ts:84-92`）。落库快照走 `buildPersistedSubAgentSnapshot`（`sub-agent-utils.ts:363-374`）：

```ts
const snapshot = buildSubAgentSummary(agent)
if (!snapshot.isRunning) return snapshot      // ← 排队卡 isRunning=false，直接原样返回
return { ...snapshot, isRunning: false, …, reportStatus: snapshot.report.trim() ? … : 'missing' }
```

排队卡 `isRunning=false`、`isQueued=true`、`reportStatus='queued'` ⇒ **早返回，`isQueued`/`reportStatus` 原样持久化**。于是「排队窗口内进程被杀 / 崩溃 / 强制重启」后，会话历史里会还原出一张 `isQueued=true` 的卡：`SubAgentCard.tsx:257/322` ⇒ `isQueued && !isRunning` ⇒ 状态文案永远是**「Queued」**（琥珀色），而它对应的 run 早已不存在。改动前 `isQueued` 永远为 false，故这是**新点亮的状态**。

判定：低危（需在排队窗口内非正常结束；只影响一条历史卡的标签），但**修法一行**，且与 `buildPersistedSubAgentSnapshot` 既有「快照即非存活 ⇒ 抹掉 isRunning」的意图同源：

```ts
export function buildPersistedSubAgentSnapshot(agent: SubAgentState): SubAgentState {
  const snapshot = buildSubAgentSummary(agent)
  // 快照天然非存活：排队态不得还原成历史卡（run 已不存在）。
  if (snapshot.isQueued) {
    return {
      ...snapshot,
      isQueued: false,
      reportStatus: snapshot.report.trim() ? snapshot.reportStatus : 'missing',
      completedAt: snapshot.completedAt ?? snapshot.startedAt
    }
  }
  if (!snapshot.isRunning) return snapshot
  // …原逻辑不变
}
```

（若判为可接受，也请在 plan §七「已知边界」里挂一条，与 ⚠️2/⚠️3 同等对待。）

### ℹ️ 提示

1. **`Assert(true, "sub-agent limiter releases every queued waiter")` 仍恒真**（`Program.SubAgentConcurrency.cs` 尾部）。既存语句，本刀未引入；但同一套件既然已补 5 条真断言，宜顺手换成 `AssertEqual(3, queuedOrder.Count)`（或校验顺序），以免「恒真断言」在回归时给假绿灯。注：同套件内另一条 `Assert(true, "…removes cancelled waiter")` **已被真断言替换**，方向正确。
2. **`TryEmitSubAgentEventAsync(eventName, toolCallId, emit)` 的 `eventName` 与 `emit` 内真实事件名可漂移**（log 里写 `"queued"`、`emit` 实际发 `"sub_agent_queued"`）；仅日志可读性，建议由同一常量派生或直接内联。
3. **`BackgroundSubAgentRegistry.Register` 仍在闸门之前且置 `SubAgentRunning`**（`BackgroundSubAgentRegistry.cs:84-90`），与本刀把 start 推迟到 lease 之后叠加 ⇒ **排队窗口内模型侧 `SubAgentStatus` 报 Running、而 UI 报 Queued**。需说明：registry「一到就报 Running」是**既有语义**（改动前同样如此），并非本刀引入；但「UI 与 registry 不一致窗口」是本刀的新观测面，与 compliance ⚠️2 同源，**真机复验时按 plan §七.6 留意 `SubAgentStatus`**。
4. **两个 .cs 文件顺带去掉 UTF-8 BOM**（`SubAgentConcurrencyLimiter.cs`、`Program.SubAgentConcurrency.cs` 首行 `-﻿…`）。`.editorconfig` 为 `charset = utf-8`（无 BOM），仓内 `src/runtime` 实测 **61 带 BOM / 633 无**、renderer **43 / 741** ⇒ 去 BOM 方向与仓内主流一致，不违规；只是它把**编码变更混进了行为 diff**，后续 review/blame 会多一层噪音，建议知悉即可（可留到迭代收尾统一处理）。
5. **`AcquireAsync` 由「直接返回 `ValueTask`」改为 `async ValueTask<IDisposable>`**：快路径（无需排队）同步完成，`AsyncValueTaskMethodBuilder` 在同步完成时**不分配堆状态机盒子** ⇒ 无性能退化；且新代码对 `pending` **只 await 一次**，未触 `ValueTask` 多次 await 之忌。提示备案，无需动作。

---

## 四、对 `compliance_report` 三条 ⚠️ 的独立复核

| compliance ⚠️ | plan 回填情况 | 独立复核结论 |
|---|---|---|
| ⚠️1 「queued 先于 start」缺断言 | plan §五 步骤 5 + §七 已补，并引入 `AssertQueuedPrecedesLeaseAsync` | **部分落实**：断言落在 **limiter 层**（`onQueued` 完成先于 lease 交付），**执行器层仍无** ⇒ 见本报告 ⚠️2。结构保证成立（`SubAgentExecutor.cs:113-140` 实读确认） |
| ⚠️2 `Register` 早于 `start` 的次序翻转 | plan §七.6 已显式结论「有次序变化、无副作用」 | **结论成立**：`BackgroundSubAgentRegistry` 为进程内 `ConcurrentDictionary`（覆写语义，`Register:84`），渲染卡由 start 独立构建 ⇒ 无硬依赖。另见本报告 ℹ️3（模型侧状态与 UI 在排队窗口内不一致，属新观测面） |
| ⚠️3 取消补发 `dequeued` 的幽灵卡边界 | plan §七.7 已显式接受 | **成立**：复核渲染端对错序/重复事件幂等（`dequeued` 仅 `isQueued` 删卡；`end` 对已删卡 no-op；拿到 lease 后即使误发 dequeued 也是空操作） |

---

## 五、结论与放行判定

**放行：可以进入验证态（阶段六）。**

- **目标覆盖**：三层补齐 ⇒ 并发上限 2、5 个 Task 时「2 卡工作中 + 3 卡等待中、跑完自动转」在代码路径上成立（见 §二 #3/#8/#9）；自动转态由 `Pump()`→lease→start 承接。
- **事实层面无硬伤**：并发语义逐行等价、「判定与入队同锁」原子、锁外 await（`RunContinuationsAsynchronously` 双保险）、取消路径完备、旧签名兼容、Goal 路径未动。
- **正向项**：`TryEmit*` 吞异常 + 日志（观测通道不反噬）；渲染端幂等让错序/重复事件安全；事件字段（`input`）经 `AgentStreamMessagePackEmitter` 可完整抵达。
- **需带进验证态的 3 条 ⚠️**：⚠️1（回调抛异常致容量泄漏，当前不可达，建议闸门内兜住）、⚠️2（执行器层顺序无回归网，建议补断言或写明缺口）、⚠️3（排队卡持久化未归一化 `isQueued`，建议一行修）。
