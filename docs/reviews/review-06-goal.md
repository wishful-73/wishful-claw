# 代码审查报告 6：Goal 编排模块

> 审查范围：`Goal/` 目录全部（Orchestrator/Models/Lifecycle/OwnedRun/Completion/Loop/TaskLoop/LLM/Materialize/Recorder/FileTools/PlanTracker/PromptTemplates/BackoffStrategy）+ `AgentRuntimeGoalExecutor.cs`
> 审查时间：2026-08-21 深夜
> 审查方式：逐文件全文阅读 + 状态词汇表交叉比对
> 说明：全项目持续审查第 6 部分。iter-19 已修复的问题（adjust 闭环、评估器容错、round 去重等）不再重复记录。

---

## §1 高优先级

### GL-1 goal_progress 事件的 completedPlans 永远为 0（状态词汇表错位）

**位置**：`GoalOrchestrator.cs:120`

```csharp
w.WriteNumber("completedPlans", goal.Plans.Count(p => p.Status == "completed"));
```

**问题**：
- 计划状态的实际值域是 `GoalPlanStatusValues`：`pending / active / complete / aborted / superseded / interrupted`——**没有 "completed"**。
- 该字段永远输出 0。前端 goal_progress 事件驱动的实时进度条（聊天运行条等消费方）拿到的完成计划数恒为 0，只能靠面板自己查 DB 纠正。
- 同文件 L44 `GetActiveGoalId` 用硬编码 `"active"`（值恰好对，但绕过了常量，状态值一改就静默漂移）。

**建议**：改用 `GoalPlanStatusValues.Complete`；全文件 grep 字符串字面量状态值统一走常量。

### GL-2 EmitGoalEventAsync 每个事件新建 AgentRuntimeRunState：seq 重置 + CTS 泄漏

**位置**：`GoalOrchestrator.cs:125-128`（EmitGoalEventAsync）、`GoalOrchestrator.cs:193-196`（EmitPendingGoalAsync 同款）

**问题**：
```csharp
await AgentRuntimeTools.EmitAsync(
    new AgentRuntimeRunState($"goal-{goal.GoalId}", goal.SessionId),
    context, eventPayload);
```
- 每发一个事件就 `new AgentRuntimeRunState(...)`：runId 相同但 **`_seq` 从 0 重新计数**——前端若按 (runId, seq) 排序/去重，事件顺序错乱。
- `AgentRuntimeRunState` 持有 `CancellationTokenSource`（IDisposable），这些临时实例**从不 Dispose**——长跑 Goal 每个事件泄漏一个 CTS，一次编排几百个事件。
- 每个事件一个 envelope，seq 全是 1，也使前端"乱序/丢包检测"失效。

**建议**：GoalContext 持有一个专用的长驻 run state（或复用 RuntimeState），事件走它发出；至少要 Dispose 临时实例。

---

## §2 中优先级

### GL-3 GoalFileTools 状态图标映射用错误的状态词汇表

**位置**：`GoalFileTools.cs:54-61`

**问题**：
```csharp
var statusIcon = plan.Status switch
{
    "pending" => "[ ]",
    "executing" => "[~]",      // 实际值是 active
    "completed" => "[x]",      // 实际值是 complete
    "failed" => "[!]",         // 实际值没有 failed（失败保持 active + resultSummary）
    _ => "[ ]"
};
```
- 四个映射键中三个对不上实际值——markdown 归档文件的计划**永远显示 `[ ]`**，状态行也永远写原始值。该文件是"工作文件夹里的 md 归档"，用户打开看到的进度全是待办。
- 与 GL-1 同根：状态词汇表没有单一事实来源，各处手写字符串。

### GL-4 ExecutePlanAsync 是死代码

**位置**：`GoalOrchestratorLoop.cs:418-503`

**问题**：
- 全仓无调用方（task 化重构后 foreach 直接调 ExecuteTaskAsync）。函数内还保留着旧的 `GoalPlanTracker.StartPlan`、GoalEventContext 设置、429 文本检测等逻辑。
- 死代码持有与活代码相似但**不同步**的逻辑（如它写 `Status = GoalPlanStatusValues.Complete` 于成功路径），未来维护者极易误改死代码以为生效，或从死代码复制过时模式。

**建议**：删除（连同其专属的 BuildPlanExecutionPrompt 转发若再无他人使用）。

### GL-5 GoalPlanTracker / WriteGoalState 的文件 I/O 无异常保护，可炸掉编排循环

**位置**：`GoalPlanTracker.cs:38-82 StartPlan`、`GoalPlanTracker.cs:88-124 FinishPlan`、`GoalOrchestratorLoop.cs:508-525 WriteGoalState`

**问题**：
- `StartPlan`/`FinishPlan`/`AppendLog` 直接 `Directory.CreateDirectory` / `File.WriteAllText` / `File.ReadAllText`，无 try-catch。工作文件夹只读、磁盘满、文件被占用（杀软扫描）时抛异常，沿编排循环上抛，整个 Goal 标记失败。
- 对比：DB 侧 Materialize 层有连续失败计数上抛的精细设计，文件侧（同为 best-effort 归档）却是一炸全炸。
- `WriteGoalState` 在 Loop 主路径上被频繁调用（每个状态变化点），同样裸奔。

**建议**：文件归档统一包 try-catch + Warn，与"DB best-effort、文件 best-effort"的定位对齐。

### GL-6 RestoreGoalContext 的 PlanId 仍截断到 16 字符

**位置**：`GoalOrchestratorLifecycle.cs:389`

**问题**：
```csharp
plan.PlanId = $"plan-{Guid.NewGuid():N}".Substring(0, 16);
```
- iter-19 已把分解路径的 PlanId 改为全长 Guid（L1 修复），但**重启恢复路径**（PlansJson 里 PlanId 为空时的兜底）仍截断到 16 字符（11 个 hex，44 bit）。
- 两处生成逻辑不一致；截断值与 DB 中已有行冲突概率虽低但存在，且修复不完整说明缺少统一的 PlanId 工厂。

**建议**：抽 `GoalPlanId.New()` 之类的统一工厂，两处共用。同款问题：`AgentRuntimeGoalExecutor.cs:120` goalId 截断到 21 字符、`TaskLoop.cs` taskId 截断 21 字符——统一评估是否需要截断。

### GL-7 暂停在 429 分钟轮询期间最长 10 分钟无响应

**位置**：`GoalOrchestratorLoop.cs:329` + `GoalOrchestrator.cs:517-532 ReachSafePointAsync`

**问题**：
- 退避等待用 `Task.Delay(delaySeconds * 1000, ct)`——ct 只响应**取消**，不响应**暂停**。Pause 只在 delay 结束后的下一个 ReachSafePoint 生效。
- 分钟轮询阶段 delay=600s：用户点暂停，界面（若显示已暂停）与实际行为脱节最长 10 分钟；期间探针还会继续打 provider。
- 快速退避阶段（2-16s）影响小，但 6 小时超时前的整个分钟轮询阶段都受影响。

**建议**：退避等待改为可中断等待（如 `WaitHandle` 轮询 RunState，或 delay 切片 + 每片检查暂停），暂停后停在安全点而不是等完整个退避周期。

### GL-8 pause_goal/resume_goal 工具路径不发 run-state 事件

**位置**：`AgentRuntimeGoalExecutor.cs:482-506` vs `Worker/Modules/GoalModule.cs:126/134`

**问题**：
- HTTP 端点路径（面板按钮）调用后由 GoalModule 补发 `goal:run-state` 事件，前端运行状态徽章实时更新。
- 但 agent 通过 **pause_goal/resume_goal 工具**执行同样操作时，Executor 只返回结果文本，不发 run-state 事件——前端运行态徽章停留在旧值，直到下次轮询或其它事件纠正。同一动作两条路径，事件语义不一致。

**建议**：工具路径也补发 EmitRunStateChangedAsync，或把事件发送下沉到 Orchestrator 动作内部统一执行。

---

## §3 低优先级

| # | 位置 | 问题 |
|---|------|------|
| GL-9 | `GoalOrchestrator.cs:130-133` | EmitGoalEventAsync `catch {}` 全静默——事件通道持续故障时无任何日志痕迹，排障只能靠"面板没数据"反推。至少 Warn 一次（可带去重） |
| GL-10 | `GoalOrchestratorLoop.cs:320-323` | 退避 timeout 分支复用 `BackoffStarted` 事件类型承载"最终超时"语义，消费方无法从事件类型区分"开始退避"与"退避放弃"，只能解析 message 文本 |
| GL-11 | `GoalOrchestratorLoop.cs:508-525 WriteGoalState` | 读-改-写 state.json 无锁；同工作文件夹两个 Goal 并发时互相覆盖（单 Goal 单会话场景下不触发） |
| GL-12 | `GoalBackoffStrategy.cs:41` | 超时判定硬编码 `36`，与常量 `MinutePollingMaxHours=6` 的换算关系只存在于注释；改常量不改 36 会静默漂移。应写 `MinutePollingMaxHours * 3600 / MinutePollingIntervalSeconds` |
| GL-13 | `GoalPlanTracker.cs:148-160 UpdateField` | 只替换首个匹配行且不校验格式；plan 文件被用户手工编辑后状态行可能重复/错位，静默更新到错误行 |
| GL-14 | `GoalOrchestratorLifecycle.cs:404` | 恢复时 `paused → Active` 的转换是隐式约定，注释未说明为何不保留 paused；用户暂停后重启应用，Goal 变回 active-idle，语义上"暂停"丢失（行为可接受但应显式记录） |
| GL-15 | `GoalOrchestrator.cs:44` | GetActiveGoalId 线性扫 ActiveGoals；量小无碍，但与 GetPendingGoalId 同款模式，Goal 数量大时可按 session 建索引 |
| GL-16 | `GoalPromptTemplates.cs` 各模板 | 分解/评估提示词要求"Return ONLY a JSON array"但模型输出常带 code fence——三处调用点各自复制粘贴剥 fence 逻辑（LLM.cs:41-49、TaskLoop.cs:60-68、LLM 评估段），应抽公共 `StripCodeFence` |

---

## 附：确认无误的设计点

- adjust 换 PlanId 的三步闭环（superseded → re-parent → insert）顺序正确，且新 id 先生成再落库，失败窗口小
- 429 探针是独立最小 LLM ping，不重跑计划；"非 429 即视为恢复"的有意放宽有清晰注释
- Materialize 层连续失败 5 次上抛的设计让"best-effort 不等于静默丢失"
- Lifecycle 的 lock(LifecycleSync) + RunGeneration 代际校验正确防止旧 loop 收尾覆盖新 loop 状态
- ReachSafePointAsync 的暂停/恢复事件成对发出，取消路径先 ThrowIfCancellationRequested
- Resume 参数四级回退（override → OriginalParameters → 会话活跃参数 → workingFolder）链路完整
- AbortAsync 等待 owned loop 退出后再返回，保证 aborted 状态落库时序
