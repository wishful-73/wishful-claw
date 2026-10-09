# Plan-S178：子 Agent「排队态」可见 —— 补齐 queued/dequeued 事件 + start 时序归位

> 归属 iter-v2-38。需求正文见 [`../requirements/S-178.md`](../requirements/S-178.md)。
> 状态：**已完成**（2026-10-09）。方案取向已定 = **①「亮出等待中」**（老大 2026-10-09 11:31）；步骤 1~6 已实施并过门禁（`npm test` 67/67），步骤 7 真机复验**已通过**（老大 2026-10-09 13:45：「178和179都测试通过了」）。
> 一句话：并发限制一直是真的，只是**没人把「排队」这件事告诉界面** —— 补上传递，并把「点亮卡片」从「发起了」改成「真开跑了」。

---

## 一、目标

设置「子 Agent 并发上限 = 2」时，一次出现 5 个 Task 卡片不再全部显示「工作中」：**真在跑的显示「工作中」，排在后面的显示「等待中」**；前面的跑完，等待卡自动转「工作中」。

---

## 二、现状（全部实读，行号为 2026-10-09 快照）

链路 5 段，**前 4 段是坏的**：

| # | 环节 | 位置 | 现状 |
|---|---|---|---|
| ① | 闸门 | `SubAgentConcurrencyLimiter.cs:22` `:61` | ✅ FIFO，容量 = 设置值；`_running < _max && _queue.Count == 0` 才立即放行，否则入队等 `Pump()` |
| ② | 点亮卡片 | `SubAgentExecutor.cs:74-81` | ❌ `sub_agent_start` 在**取闸门之前**无条件发（闸门在 `:138`） |
| ③ | 排队事件 | C# 全仓 | ❌ **从不 emit** `sub_agent_queued` / `sub_agent_dequeued` |
| ④ | 事件适配 | `adapt-sub-agent-event.ts:18-149` | ❌ switch **没有这两个 case** ⇒ 走 `default: return null` ⇒ **事件被丢** |
| ⑤ | 渲染 | `sub-agent-slice.ts:52-110` · `SubAgentCard.tsx:322` · `SubAgentsPanel.tsx:66` | ✅ **完整**（建等待卡 / 转工作中 / 删等待卡 / 琥珀色边框 / 「Queued」文案）—— 但永远收不到输入 |

⇒ **双层死代码**：C# 不发，渲染端的适配层也不放行。**只补一层没用，两层都得补。**

> 第 ④ 层是 2026-10-09 规划期新发现的，登记 S-178 正文时只记到第 ③ 层。

---

## 三、渲染端已有语义（决定 C# 必须按什么顺序发）

`sub-agent-slice.ts:52-110` 三个 case 的行为**已经写死**：

| 事件 | 条件 | 行为 |
|---|---|---|
| `sub_agent_queued` | 卡不存在 | 建卡：`isRunning=false`、`isQueued=true`、`reportStatus='queued'` |
| `sub_agent_queued` | **卡已存在** | **直接 return（忽略）** |
| `sub_agent_start` | 卡是 `isQueued` | 转 `isRunning=true`、`isQueued=false`、`reportStatus='pending'` |
| `sub_agent_start` | 卡已存在且非 queued | 忽略 |
| `sub_agent_start` | 卡不存在 | 建卡（running） |
| `sub_agent_dequeued` | 卡是 `isQueued` | **删卡**（语义 = 排队中被取消，不是「排到了」） |

⇒ **顺序契约：`queued` 必须先于 `start`。**

⇒ 所以 `start` **不能继续留在 `ExecuteAsync` 顶部无条件发**，必须挪到「拿到 lease 之后」。这是硬要求 —— 与选 ① ② ③ 哪个方案无关；否则 queued 卡刚建出来就被「已存在 ⇒ 忽略」吃掉。

---

## 四、做法（按候选 ① 展开）

### 4.1 C# 侧

#### (1) limiter 增加「是否入队」的通知 —— `SubAgentConcurrencyLimiter.cs`

`AcquireAsync` 加一个可选回调：

```csharp
public static async ValueTask<IDisposable> AcquireAsync(
    CancellationToken cancellationToken,
    Func<ValueTask>? onQueued = null)
{
    ValueTask<IDisposable> pending;
    bool queued;
    lock (Sync)
    {
        (pending, queued) = _limiter.AcquireWithFlag(cancellationToken);
    }
    if (queued && onQueued is not null)
    {
        await onQueued();   // 必须在锁外 await（回调里要 emit IO）
    }
    return await pending;
}
```

- 底层 `FifoLimiter` 新增 `AcquireWithFlag(ct)`：逻辑与现有 `AcquireAsync` **逐行一致**，只多返回一个 `queued`（= 走了 `else` 入队分支）。
- 旧签名 `AcquireAsync(ct)` 保留（`onQueued = null`）⇒ 既有测试 `tests/WishfulClaw.GoalRegressionTests/Program.SubAgentConcurrency.cs:64` **零改动**。
- **原子性**：「是否入队」的判定与真正入队**在同一把锁内**完成 ⇒ 没有「查完再判断」的竞态窗口。

#### (2) `sub_agent_start` 挪位 + 发 queued —— `SubAgentExecutor.cs` / `.Background.cs`

| 位置 | 改动 |
|---|---|
| `SubAgentExecutor.cs:74-81` | **删掉**这段无条件 `start` emit |
| `SubAgentExecutor.cs:138`（前台 acquire） | 传 `onQueued`（emit `sub_agent_queued`）；lease 拿到后 emit `sub_agent_start`（构造与原来一致） |
| `SubAgentExecutor.Background.cs:53`（后台 acquire） | 同上（在 `Task.Run` 内，不影响「立即返回」的承诺） |

queued 事件字段：`SubAgentName: definition.Name`、`ToolUseId: toolCallId`、`Input: input.Clone()` —— 渲染端 reducer 读 `input`（`subagent_type` / `description` / `prompt`）。

**取消路径**：`AcquireAsync` 抛 `OperationCanceledException` 时，若**本次曾发过 queued**（局部 `bool` 标记），补发 `sub_agent_dequeued` 删掉等待卡。

#### (3) Goal 子 Agent —— 不动

`GoalSubAgentExecutor.cs:50` 也取闸门，但它**本来就不发 `sub_agent_start`**（`GoalEventContext` 下所有子 agent 事件都不转发，见 `SubAgentExecutor.cs:257`），Goal 面板是 pull-based（轮询 DB），没有 Task 卡片。本刀不改 Goal（见 §七.2）。

### 4.2 渲染端

#### (4) `adapt-sub-agent-event.ts` 补两个 case

```ts
case 'sub_agent_queued':
  return {
    type: 'sub_agent_queued',
    subAgentName,
    toolUseId,
    input: (event.input as Record<string, unknown>) ?? {}
  }
case 'sub_agent_dequeued':
  return { type: 'sub_agent_dequeued', subAgentName, toolUseId }
```

**不补这一步前面全白干** —— `chat-store/index.ts:846` 的 `if (subEvent)` 会拦掉 null。

---

## 五、步骤清单

- [x] **步骤 1：`SubAgentConcurrencyLimiter` 加 `AcquireWithFlag` + `onQueued` 回调**（保持旧签名兼容）
  - 验证：`dotnet build src/runtime/WishfulClaw.sln` 0 错；既有 `Program.SubAgentConcurrency.cs` 套件仍绿 —— ✅ 已过
- [x] **步骤 2：`SubAgentExecutor.cs` 删顶部 start + 前台 acquire 前后发 queued/start**
  - 验证：编译 0 错 —— ✅ 已过（实现落在新增私有 helper `AcquireSubAgentSlotAsync`）
- [x] **步骤 3：`SubAgentExecutor.Background.cs` 同样处理**
  - 验证：编译 0 错 —— ✅ 已过
- [x] **步骤 4：`adapt-sub-agent-event.ts` 补两个 case**
  - 验证：`npm run typecheck` 0 错 —— ✅ 已过
- [x] **步骤 5：补 limiter 的 `onQueued` 断言**（真正入队时恰好回调一次；不排队时零回调；取消时不回调）
  - 验证：`npm test` 全绿。**口径订正**：断言并入既有 Goal 套件 ⇒ **套件总数不变，仍 67/67**（非「67 → 68」；该套件断言论 331 → 335，新增 4 条）—— ✅ 已过
  - 另补合规报告 ⚠️1 要求的**顺序契约断言** `AssertQueuedPrecedesLeaseAsync`：`onQueued` 必须在 lease 交出**之前**完成，否则 queued 卡会被随后的 start 吃掉
- [x] **步骤 6：整体门禁** —— `npm run typecheck`（node / web 两配置）＋ `dotnet build` ＋ `npm test`
  - 验证：全绿 ⇒ 本刀测通，按一需求一刀提交 —— ✅ 已过（typecheck 0 错 / dotnet build 0 错 0 警 / `npm test` 67/67 退出码 0）
- [x] **步骤 7：真机复验（老大侧）** —— 并发上限 2，发 5 个 Task ⇒ **2 张「工作中」+ 3 张「等待中」**；第 1 个完成 ⇒ 等待卡陆续转「工作中」
  - ✅ **已通过**（老大 2026-10-09 13:45：「178和179都测试通过了」）

---

## 六、涉及文件

| 文件 | 动作 |
|---|---|
| `src/runtime/WishfulClaw.Agent/SubAgentConcurrencyLimiter.cs` | 修改：`AcquireWithFlag` + `onQueued` |
| `src/runtime/WishfulClaw.Agent/SubAgentExecutor.cs` | 修改：start 挪位 + queued/dequeued |
| `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs` | 修改：同上 |
| `src/renderer/src/stores/chat-store/adapt-sub-agent-event.ts` | 修改：补两个 case |
| `tests/WishfulClaw.GoalRegressionTests/Program.SubAgentConcurrency.cs` | 修改：`onQueued` 断言 |
| `docs/plans/iter-v2-38/requirements/S-178.md` | 回填：实施记录、状态头 |
| `docs/plans/iter-v2-38/plan-s178/` | 本计划 + `compliance_report.md` + `verification_report.md` + `review_report.md` |

**不动**：`GoalSubAgentExecutor.cs`、`BackgroundSubAgentRegistry`、`SubAgentStatusTool`、`SubAgentRunCollector.cs`，以及渲染端 UI 三件（`SubAgentCard.tsx` / `sub-agent-slice.ts` / `SubAgentsPanel.tsx` —— UI 本来就齐）。

**参考源码**：无 —— 本仓自有的子 Agent 事件链路缺陷，不涉及 OpenCowork / KodaClaw / OpenClaw.net 任一参考项目。

---

## 七、刻意不做（写死免得下一轮走回去）

1. **不改并发语义** —— 限制器照旧 FIFO、容量 = 设置值。本刀**只补「把排队告诉界面」**。明确**不做**候选 ③「超限直接拒绝」。
2. **Goal 子 Agent 不发 queued** —— 它没有 Task 卡片（pull-based 面板，事件全不转发）。Goal 挤占闸门名额是**既有行为**，不在本刀范围。
3. **不动 `sub_agent_start` 的消费语义与字段** —— 只是把它挪到「拿到 lease 之后」，构造与内容不变。
4. **不做「`maxParallelToolCalls` 与 `maxConcurrentSubAgents` 文案区分」** —— 登记时提过，属另一刀（不混入本刀的 UI 文案改动）。
5. **不给 `SubAgentStatusTool` 加 queued 状态** —— 模型侧查询维持现状，本刀只治人眼。

**已知边界（合规报告 ⚠️2 / ⚠️3，实施后回填的显式结论）：**

6. **Register 早于 start 的次序翻转 —— 有次序变化、无副作用。** 改动后 `BackgroundSubAgentRegistry.Register` 仍在其原位置（前台 `ExecuteForegroundAsync` 早于 acquire，后台 `:25` 早于 `Task.Run`），而 `sub_agent_start` 挪到拿到 lease 之后 ⇒ 相对次序由「start → Register」变为「Register → start」。已核两个可能的消费者：`BackgroundSubAgentRegistry` 是进程内 `ConcurrentDictionary`（供 `SubAgentStatus` 模型侧查询，覆写语义）、渲染端卡片由 start 事件独立构建 —— **均不依赖该次序**。真机复验时留意 `SubAgentStatus` 是否出现「已注册但卡片未亮」的错位，出现即回退此步。
7. **取消路径 `dequeued` 的兜底边界 —— 接受。** 排队中被取消时补发 `sub_agent_dequeued` 摘掉等待卡；若此刻父 transport 已断，emit 会失败（`TryEmitSubAgentEventAsync` 吞异常并记 `WorkerLog.Warn`）⇒ 理论上留一张幽灵「等待中」卡。判定接受：父 run 结束时会话数据整体清理，且渲染端对错序/重复事件幂等。不为此额外加兜底通道。
8. **执行器层的「queued 先于 start」无自动化回归网 —— 写明缺口（审查 ⚠️2）。** 断言只覆盖 limiter 层（`onQueued` 完成先于 lease 交付，见 `Program.SubAgentConcurrency.cs` 的 `AssertQueuedPrecedesLeaseAsync`）；**执行器层**的顺序目前**仅由结构保证**（`ExecuteAsync` 顶部的 emit 已删、start 挪到 lease 之后）。补一条执行器级断言需要给 `AgentLoop` 引入 provider stub，会让本刀膨胀成测试基建改动 ⇒ 本刀不做。**约定（改此处必读）**：任何改动 `SubAgentExecutor.ExecuteAsync` 顶部或 `AcquireSubAgentSlotAsync` 的人，必须同步修订 `Program.SubAgentConcurrency.cs` 的顺序断言；否则套件全绿而需求静默回归。

---

## 八、待老大确认

| # | 问题 | 我的建议 |
|---|---|---|
| 1 | **方案取向** | 走 **①「亮出等待中」**（复用渲染端现成 UI，改动最小且最贴直觉）。②③ 不采用 |
| 2 | **「5 个」口径** | 按代码必然 = **5 张卡**（真并发 ≤ 2）。若当时看到 **3 个以上在持续输出内容**，那是另一回事（限制器失效）⇒ 本刀不覆盖，需另开 |
| 3 | **后台子 Agent 排队也显示「等待中」** | 本计划如此（后台同样占闸门名额），确认可接受 |
