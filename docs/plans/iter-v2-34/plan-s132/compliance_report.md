# compliance report: plan-s132

> 2026-09-22 生成。**本报告由主实例自行完成** —— 原计划派 `reviewer` 子代理做独立验证，但该子代理**第 4 次撞 8 轮上限被截断、产物未落盘、状态仍报 `completed`**（`call_00_bwCB9jKIBBkrbhrpn7MV8791`：20 calls / 8 iterations / 无报告文件）。**这恰是 S-132 要修的 bug 的现场复现**，故改由主实例逐点取证（每条给「文件:行」依据，可复核）。
> 被验证对象：`docs/plans/iter-v2-34/plan-s132/plan.md`（`bytes=10766 CRLF=175 bareLF=0 无 BOM`）。

## 结论

**PASS（❌ 0 / ⚠️ 2）**

## 逐项核查

| # | 核查点 | 结论 | 依据（文件:行） |
|:--:|---|:--:|---|
| 1 | C# 里 `MaxTurns` 的**唯一运行消费点**是 `SubAgentExecutor.Parameters.cs:68` | ✅ | 全仓 `\.MaxTurns` 命中：定义 `SubAgentDefinition.cs:22`；解析 `:108`；**运行消费仅 `SubAgentExecutor.Parameters.cs:68`**；其余 4 处均为测试断言 `Program.SubAgentReminder.cs:54/55/57/59` |
| 2a | `isSubAgentLoop` / `isGoalSubAgentLoop` 在 `:249` 之前已定义 | ✅ | `AgentLoop.cs:59-60` 定义，`:249` 使用，同一方法内且行序在前 |
| 2b | 子代理入口是否只有 `subAgent` / `goalSubAgent` 两种（有无第三种会被漏） | ✅ | 全仓写 `sessionMode` 仅 4 处：`SubAgentExecutor.Parameters.cs:77`（`subAgent` / `goalSubAgent`）、`GoalSubAgentExecutor.cs:101`（`goalSubAgent`）、`AgentRuntimeGlobalDispatchReplyExecutor.cs:178`（`global`，非子代理）、`AgentLoop.Helpers.cs:183/194`（写回归一化值）。子代理取值域封闭 |
| 2c | **判据的取值时机与大小写敏感性** | ⚠️ | `AgentLoop.cs:58` 读参数 **早于** `:171` 的 `NormalizeRuntimeParameters` ⇒ `:59-60` 用的是**归一化前**的原始值，且比较用 `StringComparison.Ordinal`（大小写敏感）。实际两处调用方都写正确大小写（`"subAgent"` / `"goalSubAgent"`）故无现实风险（`AgentRunContextPolicy.cs:111-112` 的 `"subagent"→"subAgent"` 归一化走的是**空参数 + `RuntimeRole`** 分支，子代理总会显式写 `sessionMode`）。但这是**隐式约定**，见 ⚠️1 |
| 3 | 「不变量」推理是否自洽（不误伤 sidecar 单轮语义） | ✅ | sidecar / 辅助请求的 `sessionMode` 不是 `subAgent` / `goalSubAgent`（取值域见 `AgentRunContextPolicy.cs:92-114`）⇒ `hasIterationLimit` 保持 `requestedMaxIterations > 0` ⇒ `maxIterations: 1` 语义不受影响 |
| 3b | 存不存在「子代理 + `providerTurnOnly`」组合被改动点 2 意外放开 | ✅ 无风险 | `SubAgentDefinition.cs:141-146`：结构化子代理（`ProviderTurnOnly: true`）**本就 `MaxTurns: 0`**（`:146` 第 4 参），改动前后一致；`providerTurnOnly` 的终止由 `AgentLoop.cs:462-463` 自身逻辑承担，不依赖 `maxIterations` |
| 4 | 步骤 4（`BuildChildParameters` 改 `internal`）+ 步骤 5（新增断言）与「解析断言不动」是否矛盾 | ✅ 不矛盾 | `WishfulClaw.Agent.csproj:18` 已有 `<InternalsVisibleTo Include="WishfulClaw.GoalRegressionTests" />` ⇒ 步骤 4 可行；测试既有 4 条断言（`Program.SubAgentReminder.cs:54-59`）是**解析层**断言，本刀不动解析层 ⇒ 应继续通过；步骤 5 是**另起一节**新增，非改这些行 |
| 5 | 500 行红线表行数与其自述一致、豁免理由是否站得住 | ✅ | 实测复核：`SubAgentExecutor.Parameters.cs`=145、`AgentLoop.cs`=635、`SubAgentDefinition.cs`=166、`limits.ts`=13、`catalog.ts`=121、`types.ts`=192 —— 与计划表一致；`AgentLoop` 有 **6 个 `partial` 分片**（`AgentLoop.cs` / `.ContextCompression` / `.Helpers` / `.MemoryRecall` / `.SessionTodo` / `.SubAgentReminder`）⇒ 「已分片」豁免理由成立 |

## 必须修正项（❌）

无。

## 建议项（⚠️）

| # | 建议 | 理由 | 落地 |
|:--:|---|---|---|
| ⚠️1 | 改动点 2 的判据**不要直接复用 `:59-60` 的变量**，改为本刀内联 `OrdinalIgnoreCase` 自算 | 复用会继承「归一化前 + 大小写敏感 + 依赖调用方写对」的隐式约定；内联自算把这条契约显式化，且**不触碰** `:59-60`（避免改变 `conversationKey` 行为 ⇒ 不扩大范围） | 见下方「建议的判据写法」 |
| ⚠️2 | 步骤 6 的回归**显式跑一次**「生成标题 / 翻译 / 记忆整合」 | 计划「不变量」表列的 5 个调用方都在**渲染层**，C# 侧无法静态核对；需要一个真实 sidecar 请求作行为证据 | 步骤 6 补充为：编译通过后，真机各触发一次生成标题与记忆整合，确认仍为单轮 |

### 建议的判据写法（⚠️1 落地）

```csharp
var requestedMaxIterations = JsonHelpers.GetInt(parameters, "maxIterations", 0); // 0 = unlimited
// S-132：真子代理 run 不接受轮次上限。这里自算判据（不复用 :59-60），
// 因为那对变量读的是归一化前的参数且大小写敏感；sidecar 单轮语义不受影响。
var isSubAgentRun =
    sessionModeForConv.Equals("subAgent", StringComparison.OrdinalIgnoreCase) ||
    sessionModeForConv.Equals("goalSubAgent", StringComparison.OrdinalIgnoreCase);
var hasIterationLimit = requestedMaxIterations > 0 && !isSubAgentRun;
```

> `sessionModeForConv` 在 `:58` 已就绪，可直接引用。

## 附：验证过程自证据

- 本次独立验证的子代理 `call_00_bwCB9jKIBBkrbhrpn7MV8791`：**Status=completed / Iterations=8 / Tool calls=20 / Report 为叙述拼接 / 报告文件未生成**（`Test-Path` 为 false）。
- 其 tool call log 显示方向正确（已读全部白名单文件、已 `Grep(\.MaxTurns)`、已 `Grep(sessionMode...)`、已 `Glob(AgentLoop*)`），**在第 8 轮被硬截断**，四项核查成果全部丢失。
- ⇒ 与 `raw-requirements.md` 的 `### S-132` 根因描述**完全吻合**，为该需求的必要性提供了新的实机证据。
