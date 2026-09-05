# v2-iter-24 工具并发等待队列探索报告

> 阶段：探索态（只读）
>
> 日期：2026-09-01
>
> 分支：`dev/v2-iter-24`
>
> 说明：本报告基于当前 Wishful Claw 源码、`docs/dev-workflow.md`、现有设置页和 Git 历史整理。探索阶段未修改产品代码。当前工作区已有压缩显示专项 7 个未提交文件，本专项后续必须避开这些文件。

## 一、需求理解

设置页当前提供工具执行相关配置：

- 最大并行工具数：控制同一轮中同时执行的工具数量。
- 每轮最大工具调用数：控制单次模型回复允许处理的工具调用总数。

用户希望恢复此前的等待队列语义：当待执行工具数量超过配置的并行数量时，超出的调用进入等待队列；已有工具完成并释放槽位后，队列中的下一个调用继续执行；不因为超过并行数量直接生成错误结果。

## 二、当前设置与协议链路

设置页位置：

- `src/renderer/src/components/settings/RuntimePanel.tsx:298-356`
  - `maxParallelToolCalls` 显示为“最大并行工具数”，范围 1-16。
  - `maxToolCallsPerTurn` 显示为“每轮最大工具调用数”，范围 1-100。

设置存储与默认值：

- `src/renderer/src/stores/settings-store-types.ts:75-77`
  - `DEFAULT_MAX_PARALLEL_TOOL_CALLS = 3`
  - 并行数量范围 1-16。
- `src/renderer/src/stores/settings-store.ts` 和 `settings-store-migrate.ts`
  - 两项配置均持久化并在发送请求时透传。

请求透传：

- `src/renderer/src/hooks/use-chat-actions.ts`
- `src/renderer/src/hooks/use-background-subagent-wakeup.ts`
- `src/renderer/src/hooks/use-channel-auto-reply.ts`
- `src/renderer/src/lib/tools/project-send-message.ts`
- `src/renderer/src/lib/ipc/sidecar-mapping.ts:231-335`

前端配置最终作为以下字段发送给 Worker：

```text
maxParallelToolCalls
  → maxParallelTools

maxToolCallsPerTurn
  → maxToolCallsPerTurn
```

## 三、当前执行行为与根因

核心文件：`src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs`。

当前流程：

```text
toolCalls
  → 读取 maxParallelTools / maxToolCallsPerTurn
  → maxToolCallsPerTurn > 0 时先 Take(maxToolCallsPerTurn)
  → 超出的调用进入 skippedToolCalls
  → 仅保留的调用进入 SemaphoreSlim(maxParallelTools)
  → WaitAsync 获取槽位后创建执行任务
  → 槽位释放后下一个等待调用继续
  → skippedToolCalls 被生成 error tool result
```

关键位置：

- `ToolCallProcessor.cs:117-118`：读取两个限制。
- `ToolCallProcessor.cs:127-140`：在并发队列之前截断工具调用。
- `ToolCallProcessor.cs:152`：创建 `SemaphoreSlim(maxParallelTools, maxParallelTools)`。
- `ToolCallProcessor.cs:190-205`：通过 `WaitAsync` 获取槽位；超出并发槽位的调用本来会等待。
- `ToolCallProcessor.cs:220-267`：为被 per-turn 截断的调用发出 error 结果，错误文案包含 `Skipped: ... tool calls per turn max. Retry this call next turn.`。

结论：

- `maxParallelTools` 的 semaphore 路径已经是等待队列语义，不需要重写调度器。
- 用户感知的“超出直接报错”来自 `maxToolCallsPerTurn` 的前置硬截断，而不是并行槽位等待。
- 只修改 `maxParallelTools` 的 semaphore 行为无法消除该错误，因为调用在到达 semaphore 前已经被截断。

## 四、历史依据

Git 历史显示硬截断和 semaphore 是在同一提交引入的：

- `43c1b653 feat: add tool concurrency control and maxToolCallsPerTurn`

该提交同时加入：

1. `SemaphoreSlim.WaitAsync` 并发控制；
2. `maxToolCallsPerTurn` 前置 `Take(...)` 截断；
3. 超出调用生成 error result。

因此当前实现并不是“等待队列被删除”，而是等待队列前新增了一个会阻断超量调用的总量限制。

## 五、相关代码与边界

### 5.1 不需要修改的部分

- `src/renderer/src/lib/agent/concurrency-limiter.ts`
  - 前端通用 limiter 已实现 FIFO 等待、动态调高上限、取消等待和 finally release。
  - 本次实际 Agent 工具批次在 C# Worker 执行，不应再叠加第二个前端工具调度器。
- `src/runtime/WishfulClaw.Agent/SubAgentConcurrencyLimiter.cs`
  - 这是子 Agent/Task 工具的独立并发限制，不等同于普通工具批次并行数。
- `AgentLoop.cs`
  - 只负责调用 `ToolCallProcessor.ExecuteAsync`，不是本次根因位置。
- 工具执行器本身
  - 不改变工具功能和错误处理；只改变批次调用是否被提前跳过。

### 5.2 需要评估的部分

- `ToolCallProcessor.cs`
  - 移除 `maxToolCallsPerTurn` 的前置截断、`skippedToolCalls` 收集和 skipped error 结果生成。
  - 保留 `maxParallelTools` 的规范化和 semaphore 等待。
  - 保留取消检查：取消时未开始的排队调用应不再启动，已有执行按现有取消语义结束。
- `RuntimePanel.tsx`、设置类型/迁移/文案
  - 评估是否移除“每轮最大工具调用数”设置及其持久化字段。
  - 若保留兼容读取，应停止将其作为执行拒绝条件，避免用户继续看到一个无效/误导配置。
- 测试
  - 当前没有 ToolCallProcessor 并发队列回归测试。
  - 现有 `tests/WishfulClaw.GoalRegressionTests` 可作为 C# 回归测试组织参考，但需要确认是否适合增加可测试的 limiter/批次辅助。

## 六、风险

1. **无限批次风险**：取消 per-turn 总量限制后，模型一次回复可能产生较大的 tool call 批次；并发槽位仍限制同时运行数量，但总等待队列长度不再限制。
2. **设置兼容风险**：直接删除持久化字段会影响旧配置迁移；更稳妥的方案是保留读取兼容，但不再将该字段用于跳过调用，或将其改名为明确的队列长度/批次保护配置。
3. **取消语义**：等待中的调用必须响应 `CancellationToken`，不能因移除 skipped 分支而在取消后继续启动。
4. **事件顺序**：工具开始/完成事件按现有 `ExecuteSingleAsync` 路径发送，不能为了排队改成一次性发出全部“running”事件。
5. **前端并发与后端并发边界**：普通工具由 Worker 的 `ToolCallProcessor` 控制；子 Agent 仍由 `SubAgentConcurrencyLimiter` 单独控制，不能混为一个上限。
6. **工作区隔离**：压缩显示专项的未提交差异属于用户当前工作，不能 stash、reset、checkout 或批量重写。

## 七、探索结论

本次最小正确修复不是重写等待队列，而是移除 semaphore 前的 `maxToolCallsPerTurn` 硬截断，使完整的 tool call batch 都进入已有 `SemaphoreSlim.WaitAsync` 队列；并同步处理设置页中“每轮最大工具调用数”的兼容/文案，避免该配置继续造成直接报错或语义混乱。
