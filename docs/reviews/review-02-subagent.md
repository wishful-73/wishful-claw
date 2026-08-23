# 代码审查报告 2：子 agent 模块

> 审查范围：`SubAgentExecutor.cs / .Background / .Results / .Parameters`、`SubAgentRunCollector.cs`、`BackgroundSubAgentRegistry.cs`、`BackgroundSubAgentNotifications.cs`、`Tools/SubAgentStatusTool.cs`、`SubAgentDefinition.cs`、`SubAgentRegistry.cs`、`Tools/TaskTool.cs`
> 审查时间：2026-08-21 晚
> 审查方式：逐文件全文阅读 + 跨文件调用链交叉验证
> 说明：本报告为全项目持续审查的一部分，只记录问题，不附带修复。

---

## §1 高优先级

### SA-1 BackgroundSubAgentRegistry 无限增长，无淘汰机制

**位置**：`BackgroundSubAgentRegistry.cs:46`（`_records` 字典）

**问题**：
- `_records` 是静态 `ConcurrentDictionary`，只有 `Register/Complete/Fail/Cancel/UpdateProgress` 写入和覆盖，**没有任何删除或过期清理路径**。
- 每个 Task 工具调用（前台+后台）都注册一条记录，含完整 `Output`（最长可达数万字符）和 `ToolCallEntries` 列表。
- Worker 是长驻进程：跑一天几十上百个子 agent 后，所有历史记录（含大字符串）常驻内存，永不释放。
- 对比：渲染端 `agent-store` 的 `completedSubAgents` 有 `trimCompletedSubAgentsMap` 做上限裁剪；Worker 端没有对应机制。

**影响**：长会话重度使用下内存缓慢泄漏。单条记录不大，但无上限累积在数天不重启的场景下可观。

**建议**：终态记录保留 N 条或 TTL 过期后移除（如保留最近 100 条，或完成超过 24h 清理）；`GetAll()` 列表视图同样受益于上限。

---

### SA-2 后台子 agent 的取消注册泄漏

**位置**：`SubAgentExecutor.Background.cs:39-41`

```csharp
parentState.CancellationToken.Register(
    static state => ((AgentRuntimeRunState)state!).Cancel("parent"),
    childState);
```

**问题**：
- `CancellationToken.Register` 返回的 `CancellationTokenRegistration` **被丢弃**，从未 Dispose。
- 前台路径（`SubAgentExecutor.cs:125`）用了 `using var` 正确释放；后台路径没有。
- 后果分两种情况：
  - 子 agent 先结束、父 run 还活着：注册回调仍挂在父 token 上，闭包引用 `childState`（已 Dispose）。父 run 后续取消时会对已 Dispose 的 childState 调 `Cancel()`——`_cancellation.Cancel()` 在 CTS Dispose 后调用会抛 `ObjectDisposedException`。该异常发生在取消回调里，可能中断同一 token 上其它注册回调的执行。
  - 父 run 结束：整个 token 源被 Dispose，注册随之失效，这条泄漏随父 state 一起消失，无害。
- 长会话中大量后台子 agent 先于父 run 结束时，第一种情况会在用户点停止时触发。

**建议**：保存 registration 并在后台任务的 finally 中 `await using`/Dispose 释放；或在 Cancel 回调内 try-catch ObjectDisposedException。

---

### SA-3 SubAgentRegistry 非线程安全

**位置**：`SubAgentRegistry.cs:18`

**问题**：
- `_agents` 是普通 `Dictionary`，但存在并发访问场景：主 loop 的工具执行在多线程进行（ToolCallProcessor 并发派发），同时 `Register/Unregister/Clear` 可由技能管理等模块在运行期调用。
- `Dictionary` 并发写会抛异常或损坏内部状态；`InvalidateCache` 与 `GetAll/GetNames` 的懒加载缓存也存在竞态（两个线程同时看到 null 缓存各自构建，虽然结果幂等但 `_allCache ??=` 不是原子读改写，可能返回不同实例）。
- 当前实际风险低（启动后很少动态增删），但接口是公开的，属于埋雷。

**建议**：换 `ConcurrentDictionary`，或所有读写加锁；缓存字段用 `Volatile.Read`/`Interlocked` 维护。

---

## §2 中优先级

### SA-4 GetFinalOutput 把全程文本拼接当作"最终报告"

**位置**：`SubAgentRunCollector.cs:124-132`

**问题**：
- 注释说 "The last text before a loop_end (with no tool calls after it) is the final report"，但实现是 `string.Concat(_textParts)` —— **把所有轮次的全部文本增量拼在一起**。
- 子 agent 多轮迭代时（读文件→思考→再读→总结），中间轮的"我来看一下…"等过程性文本全部混入最终报告。
- 该输出用于三处：工具结果回传给主 agent、registry 的 Output（SubAgentStatus 报告）、sub_agent_end 事件。污染是全链路的。
- 主 agent 收到的报告因此冗长且含噪音，浪费上下文窗口。

**建议**：记录"最后一次无后续 tool_call 的 text 事件起点"，从那里开始拼接；或至少在 tool_call_start 时清空已积累文本（最后一段文本即最终报告）。

---

### SA-5 BuildChildParameters 未剥离 subAgentDepth 之外的危险继承字段

**位置**：`SubAgentExecutor.Parameters.cs:52-62`

**问题**：
- 从父参数复制时排除了 `messages/personaId/userRules/providerTurnOnly`，但以下字段原样继承给子 agent，值得逐一确认是否合理：
  - `enablePlanMode` / plan 相关状态：子 agent 带 plan 工具集可能与 `sessionMode: "subAgent"` 的工具过滤冲突（依赖下游过滤逻辑正确性）。
  - `sshConnectionId`、`projectId`：有意继承（工作目录语义），合理。
  - `permissionMode`：注释说 default-mode 审批只作用于主 loop（`RequiresApprovalBeforeExecution` 里 `!state.SuppressTransportEvents` 条件），所以子 agent 继承 `default` 也全自动放行——**这是有意的安全策略还是疏漏？** 用户在 default 模式下明确要求写操作需确认，但委托给子 agent 就绕过了确认。建议与产品语义核对。
- `maxIterations` 被定义的 `MaxTurns` 覆盖，但 `maxToolCallsPerTurn`/`maxParallelTools` 继承父值，未按子 agent 场景收紧。

**影响**：SA-5b（权限绕过）取决于产品意图，若非有意则是安全边界缺口。

---

### SA-6 后台任务异常时 EmitAsync 可能二次抛出

**位置**：`SubAgentExecutor.Background.cs:107-126`

**问题**：
- `catch (Exception ex)` 块内调用 `EmitAsync(sub_agent_end)` 和 `WorkerLog.Warn`。如果失败原因正是 transport 已断（客户端断连），`EmitAsync` 会再抛，这个异常发生在 `Task.Run` 的 catch 块里，成为 unobserved task exception。
- 外层 `Task.Run` 没有 finally 兜底 catch（finally 只做资源清理，不捕异常）。
- 概率低（需要"子 agent 异常 + 父流同时死亡"叠加），但一旦发生是进程级 unobserved exception（.NET 默认仅记录，不崩溃，但日志脏）。

**建议**：catch 块内的 Emit 包一层 try-catch；或整个后台 lambda 最外层再加一个兜底 catch。

---

### SA-7 FormatBrief 不区分运行/完成态的时间语义

**位置**：`BackgroundSubAgentRegistry.cs:157-161`

**问题**：
- 列表行只有 `[id] name — status — N calls — description`，不含 elapsed。信息量尚可，但 `GetAll()` 无排序保证（`ConcurrentDictionary.Values` 顺序不定），主 agent 调 SubAgentStatus 不带 id 时看到的列表顺序随机，多次调用顺序可能变化，对 LLM 的稳定性不友好。

**建议**：`GetAll()` 按 StartedAt 排序（新的在前）。

---

## §3 低优先级

| # | 位置 | 问题 |
|---|------|------|
| L1 | `SubAgentDefinitionLoader.ParseAgentFile` | frontmatter 解析用正则逐 key 匹配，不支持引号内冒号、多行值；`temperature` 无范围校验（可填 99）；`maxTurns=0` 含义不明（0 会被 `<0` 守卫放过，导致子 agent 零轮直接结束） |
| L2 | `SubAgentDefinitionLoader.LoadAll` | 只扫 TopDirectoryOnly，不支持项目级 `.wishful-claw/agents/`（workingFolder 参数只在 custom 定义里用作提示文案，不加载项目级定义） |
| L3 | `TaskTool.BuildSchema` | `additionalProperties: false` 但 `run_in_background`（渲染端 buildMessageSubAgents 检查的字段名）与 schema 的 `background` 不一致——渲染端认 `run_in_background`，C# 端认 `background`。若 LLM 按 schema 输出 `background:true`，渲染端历史重建会把后台任务当 foreground 处理（isRunning 判定错误）。跨端字段名不一致 |
| L4 | `SubAgentExecutor.cs:30` MaxSubAgentDepth=2 | 深度限制硬编码，无法配置；且 depth 由参数传递而非运行时栈校验，伪造 `subAgentDepth` 参数可绕过（本地场景威胁有限） |
| L5 | `BuildResultJson` | output 全量放入 JSON（可能很大），经 MessagePack 发给前端；前端 sub_agent_end 处理器直接存 store。超大报告（如子 agent 读了大文件拼接输出）会造成 IPC 与内存峰值。建议与 SA-4 一并处理：报告截断到合理长度 |
| L6 | `BackgroundSubAgentNotifications` | 缓冲区无上限：若渲染端长期不 drain（如会话已删除），消息永久驻留。建议加 TTL 或容量上限 |

---

## §4 总体评价

子 agent 模块架构清晰：前台/后台统一入口、depth 限制、事件收集器模式、registry 查询工具链完整。本轮实测暴露的两个问题（父 run 结束杀子 agent、报告丢失）已修复，修复质量良好。

剩余风险集中在**生命周期卫生**上：registry 无淘汰（SA-1）、取消注册泄漏（SA-2）、通知缓冲无上限（L6）都是"长驻进程 + 无限累积"同一类问题，建议统一做一轮资源治理。其次是 GetFinalOutput 的报告语义（SA-4），它直接影响主 agent 拿到的信息质量，值得优先修。

---

## 附：确认无误的设计点

- 前台路径 cancellation registration 用 `using var` 正确释放
- `SessionConversationManager.Remove($"__subagent__{childRunId}")` 在前后台 finally 都有调用，隔离会话不泄漏
- 双信号量（常规工具 vs Task）防止互相饥饿的设计合理
- per-turn 超限的工具调用返回错误结果而非静默丢弃，LLM 可感知重试
- UTF-8 安全的头尾截断实现正确（处理了代理对）
