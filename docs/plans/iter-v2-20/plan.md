# Plan: v2-iter-20 — 审查修复 · 安全与运行时健壮性

> 来源：docs/reviews/review-02 ~ review-08b 全项目审查。
> 范围：高优先级全修 + 高价值中优先级。SA-5b（子 agent 免审批）经用户确认为有意设计，不修。
> AL-3（无限循环熔断）按用户要求改为软提示方案，归入 iter-21。

## 目标

修复审查报告中全部 13 个高优先级问题及配套中优先级问题，消除安全洞、并发雷和静默错误，编译零错误、行为可验证。

## 步骤清单

### FU1 安全

- [ ] 步骤1（PV-1a）：`WorkerHttpClientFactory.Create` 增加 `allowInsecureTls` 参数（默认 false），仅开启时挂 `ServerCertificateCustomValidationCallback`；验证检查点：`dotnet build` 零错误
- [ ] 步骤2（PV-1b）：AnthropicMessagesProvider / OpenAIChatProvider / ProviderTestService / PersonaGenerator 四处手写 HttpClientHandler 改为统一调用工厂（provider 配置含 `allowInsecureTls` 时传入）；验证检查点：全仓 grep 无无条件 TLS 回调 + `dotnet build` 零错误
- [ ] 步骤3（MB-1）：MemoryPathResolver.ResolveRoot 出口做 `Path.GetFullPath` 前缀校验，拒绝含路径分隔符的 projectId / scope 注入路径；验证检查点：`dotnet build` 零错误 + 构造恶意 scope 单测路径逻辑人工核验
- [ ] 步骤4（TL-6）：ToolCallProcessor.DefaultModeApprovalTools 加入 NotebookEdit；复核 Monitor 是否移出（只读工具）；验证检查点：`dotnet build` 零错误

### FU2 并发与资源

- [ ] 步骤5（AL-1）：AgentRuntimeRunState 入口同 session 活跃 run 互斥（ConcurrentDictionary<string,runId> 记录活跃 session，已有活跃 run 时拒绝新 run 返回明确错误）；验证检查点：`dotnet build` 零错误
- [ ] 步骤6（DB-1）：DbClient 初始化改 `Lazy<T>`（ExecutionAndPublication）；验证检查点：`dotnet build` 零错误
- [ ] 步骤7（SA-1）：BackgroundSubAgentRegistry 终态记录上限裁剪（保留最近 100 条终态，GetAll 按 StartedAt 排序，顺带 SA-7）；验证检查点：`dotnet build` 零错误
- [ ] 步骤8（SA-2）：SubAgentExecutor.Background 后台取消注册 registration 在 finally 中 Dispose；验证检查点：`dotnet build` 零错误
- [ ] 步骤9（SA-3）：SubAgentRegistry._agents 换 ConcurrentDictionary，缓存字段 Interlocked 维护；验证检查点：`dotnet build` 零错误
- [ ] 步骤10（GL-2）：GoalContext 持有长驻 AgentRuntimeRunState 用于事件发射（消灭每事件 new RunState 的 seq 重置 + CTS 泄漏），临时实例 Dispose 兜底；验证检查点：`dotnet build` 零错误
- [ ] 步骤11（MB-3）：MemoryStore 按 scope 加 SemaphoreSlim 保护 Upsert/Delete 读改写；验证检查点：`dotnet build` 零错误

### FU3 静默错误

- [ ] 步骤12（AL-2）：SystemPromptCache 失效机制——PersonaStore 写入与记忆 hot-write 路径调用 Invalidate/Clear；验证检查点：`dotnet build` 零错误
- [ ] 步骤13（GL-1/GL-3）：GoalOrchestrator.completedPlans 改用 GoalPlanStatusValues.Complete；GoalFileTools 状态图标映射改用常量值域（active/complete）；顺带清理 paused 死状态引用（DB-9 关联）；验证检查点：`dotnet build` 零错误 + grep 无 "completed"/"executing" 字面量残留于 Goal 模块
- [ ] 步骤14（PV-2）：AnthropicMessagesEventParser tool_use_streaming_start 的 `_ = EmitAsync(...)` 改 await；验证检查点：`dotnet build` 零错误
- [ ] 步骤15（TL-5）：ToolDispatchRouter.IsJsonError 增加 error 值非 null 且非空字符串判断；验证检查点：`dotnet build` 零错误
- [ ] 步骤16（RC-1）：chat-store handleEnvelope 优先用 envelope.sessionId 定位会话，streamingMessages 反查降级为兜底；goal_progress 字段访问链修正为实际协议载荷；验证检查点：三份 tsconfig tsc --noEmit 全零错误
- [ ] 步骤17（DB-3）：DbService.QueryScalar 特判 Nullable&lt;T&gt;（UnderlyingSystemType），消灭 InvalidCastException 潜伏路径；验证检查点：`dotnet build` 零错误

### 收尾

- [ ] 步骤18：编译总验证（dotnet build sln + 三份 tsconfig）+ 启动冒烟；更新 PROGRESS.md

## 涉及文件

- src/runtime/WishfulClaw.Infrastructure/Http/WorkerHttpClientFactory.cs — 修改（步骤1）
- src/runtime/WishfulClaw.Agent/AnthropicMessagesProvider.cs、OpenAIChatProvider.cs、ProviderTestService.cs — 修改（步骤2）
- src/runtime/WishfulClaw.Persona/PersonaGenerator.cs — 修改（步骤2）
- src/runtime/WishfulClaw.Workspace/Memory/MemoryPathResolver.cs、MemoryStore.cs — 修改（步骤3、11）
- src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs — 修改（步骤4）
- src/runtime/WishfulClaw.Agent/AgentRuntimeTools.cs（RunAsync 入口）— 修改（步骤5）
- src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs、DbService.cs — 修改（步骤6、17）
- src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs、BackgroundSubAgentRegistry.cs、SubAgentRegistry.cs — 修改（步骤7、8、9）
- src/runtime/WishfulClaw.Agent/Goal/* — 修改（步骤10、13）
- src/runtime/WishfulClaw.Persona/PromptBuilder.cs、PersonaStore.cs + SystemPromptCache.cs — 修改（步骤12）
- src/runtime/WishfulClaw.Agent/AnthropicMessagesEventParser.cs — 修改（步骤14）
- src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs — 修改（步骤15）
- src/renderer/.../chat-store/index.ts — 修改（步骤16）

## 参考源码

- 本迭代为审查修复，无外部参考源码搬入；问题定位以 docs/reviews/*.md 中标注的文件行号为准。

## 明确不做（留 iter-21/22）

- EM-1/EM-2（Worker 优雅关闭/自动重启）、RC-2/RC-3、AL-3 软提示、AL-6、TL-1/TL-4、SA-4 → iter-21
- 日志脱敏、死代码清理、结构重构（TL-8/MB-5/RC-9/AL-4/MB-4）→ iter-22
