# Plan: 工具并发超限改为等待队列

> 迭代：v2-iter-24
>
> 日期：2026-09-01
>
> 状态：规划验证中，用户确认前不得进入执行态

## 目标

将工具批次执行从“超过配置数量的调用直接返回 skipped error”改为“同时只运行设置允许的数量，超出的调用在 Worker 内等待槽位释放后继续执行”。设置页只保留“最大并行工具数”作为用户可见的执行数量限制；不重写现有 semaphore 调度器，不改变子 Agent 独立并发限制。

## 根因

`ToolCallProcessor.ExecuteAsync(...)` 已使用 `SemaphoreSlim(maxParallelTools)` 和 `WaitAsync(...)` 实现等待槽位，但在进入 semaphore 前还使用 `maxToolCallsPerTurn` 对工具批次执行 `Take(...)`，并为超出部分生成：

```text
Skipped: {max} tool calls per turn max. Retry this call next turn.
```

因此超量调用没有机会进入已有等待队列。

## 范围决策

- `maxParallelToolCalls` / `maxParallelTools` 是唯一用户可见的普通工具并发上限。
- 完整 tool call batch 都进入 Worker 现有 semaphore；同时运行数不超过设置值。
- 移除 `maxToolCallsPerTurn` 的 Worker 硬截断、skipped error 和请求透传。
- 设置页移除“每轮最大工具调用数”控件，避免继续暴露与目标语义冲突的配置。
- 为兼容旧用户配置，本计划不要求立即删除 settings 持久化对象中的旧 `maxToolCallsPerTurn` 字段；可保留读取/迁移兼容，但新请求不再使用它。
- 不修改 `SubAgentConcurrencyLimiter`：Task/子 Agent 继续使用独立的 `maxConcurrentSubAgents`。
- 不修改单个工具执行器、权限审批屏障、工具输出截断和工具结果持久化。
- 不提交或 push 业务代码，直到编译、回归测试和用户运行验证完成。

## 步骤清单

- [ ] 步骤 1：移除 Worker 的每轮工具调用硬截断
  - 修改 `ToolCallProcessor.ExecuteAsync(...)`，不再读取 `maxToolCallsPerTurn` 作为执行拒绝条件。
  - 删除 `toolCallsToExecute = Take(...)`、`skippedToolCalls` 和 skipped error 事件/result 生成。
  - 所有 `toolCalls` 按原始顺序进入现有循环；普通工具在 `SemaphoreSlim.WaitAsync` 等待槽位，Task 工具继续走独立子 Agent limiter。
  - 保留取消检查、approval barrier、`finally` release 和 `Task.WhenAll` 汇总。
  - 验证检查点：当一轮产生 5 个普通工具且 `maxParallelTools=2` 时，5 个工具均执行、任意时刻最多 2 个运行、无 `Skipped` error result。

- [ ] 步骤 2：收敛设置页和请求协议
  - 从 `RuntimePanel.tsx` 移除“每轮最大工具调用数”控件，只保留“最大并行工具数”和“子 Agent 并发上限”。
  - 从所有 Agent 请求构造路径停止发送 `maxToolCallsPerTurn`：普通聊天、继续/重试、后台子 Agent 唤醒、渠道自动回复、跨会话消息等。
  - 从 renderer 请求类型和 sidecar mapping 中移除执行请求的 `maxToolCallsPerTurn` 字段。
  - 旧 settings 持久化字段暂保留兼容，不触发迁移删除，避免扩大数据迁移范围；后续可单独清理死字段。
  - 更新中英文设置页文案，使“工具执行”描述只表达并发槽位和子 Agent 并发，不再暗示每轮总量拒绝。
  - 验证检查点：设置页只展示并发数量；任一 Agent 请求不再携带 `maxToolCallsPerTurn`；旧配置文件包含该字段时应用仍能正常启动。

- [ ] 步骤 3：增加工具并发等待回归测试
  - 在现有 C# 回归测试体系中增加可控 fake tool executor/测试入口，覆盖：
    - 批次数量大于 `maxParallelTools` 时全部执行；
    - 峰值同时运行数不超过设置值；
    - 前一批工具完成后等待调用继续；
    - 单个工具失败后 semaphore 仍释放，后续调用继续；
    - 取消时未开始的等待调用不再启动；
    - 不生成旧 `Skipped: ... tool calls per turn max` 错误。
  - 测试不得依赖真实网络、浏览器或文件写入。
  - 验证检查点：新回归测试稳定通过，能够在旧硬截断实现下失败。

- [ ] 步骤 4：静态审查与完整验证
  - 核对普通聊天、continue/retry、渠道、后台唤醒、跨会话分派的请求构造路径，确保无遗漏透传。
  - 核对 `ToolCallProcessor` 的 approval barrier：需要审批的工具仍按既有顺序门控，不因队列改动并发越序。
  - 核对子 Agent Task 工具不占用普通工具 semaphore，仍由 `SubAgentConcurrencyLimiter` 排队。
  - 运行：
    - `npx tsc --noEmit -p tsconfig.web.json`
    - `npx tsc --noEmit -p tsconfig.node.json`
    - `npx tsc --noEmit -p tsconfig.json`
    - 相关 C# 回归测试
    - `dotnet build src/runtime/WishfulClaw.Agent/WishfulClaw.Agent.csproj --no-restore`
    - `dotnet build src/runtime/WishfulClaw.sln`；若正在运行的 Worker 锁定输出目录，则使用独立 `-o` 临时输出路径验证，不能强杀用户进程。
    - `git diff --check`
  - 验证检查点：三套 TS 零错误；相关回归测试通过；Agent 项目构建 0 warning/0 error；solution 构建或隔离输出构建通过；无本次引入的格式问题。

## 预计修改文件

### Worker 执行

- `src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs`
  - 删除 per-turn 截断和 skipped error；保留 semaphore 等待队列。

### Renderer 设置与请求透传

- `src/renderer/src/components/settings/RuntimePanel.tsx`
  - 移除“每轮最大工具调用数”控件。
- `src/renderer/src/locales/zh/settings.json`
  - 收敛工具执行描述。
- `src/renderer/src/locales/en/settings.json`
  - 收敛工具执行描述。
- `src/renderer/src/hooks/use-chat-actions.ts`
- `src/renderer/src/hooks/use-background-subagent-wakeup.ts`
- `src/renderer/src/hooks/use-channel-auto-reply.ts`
- `src/renderer/src/lib/tools/project-send-message.ts`
  - 停止请求透传 `maxToolCallsPerTurn`。
- `src/renderer/src/lib/ipc/sidecar-mapping.ts`
- `src/renderer/src/lib/ipc/sidecar-protocol-types.ts`
- `src/renderer/src/lib/agent/types.ts`
- `src/renderer/src/stores/chat-store/index.ts`
  - 清理运行请求类型中的旧字段；修改时必须避开当前压缩专项在 `chat-store/index.ts` 的未提交差异。如无法安全隔离，则保留局部兼容类型，不在本专项强行清理。

### 测试

- 优先扩展现有 `tests/WishfulClaw.GoalRegressionTests/` 或新增职责明确的工具并发回归测试项目/文件。
- 若为可测试性提取小型内部调度辅助，只允许位于 `WishfulClaw.Agent`，不得引入 Worker 反向依赖。

## 预计不修改

- `src/renderer/src/lib/agent/concurrency-limiter.ts`：不是当前 Worker 工具批次执行入口。
- `src/runtime/WishfulClaw.Agent/SubAgentConcurrencyLimiter.cs`：子 Agent 独立并发队列保持现状。
- 各具体 Tool Executor：本次不改变工具功能。
- 数据库 schema、消息协议、工具结果持久化。
- 当前压缩显示专项的 7 个未提交文件；若请求类型清理不可避免触及 `chat-store/index.ts`，仅做可逐行隔离的最小编辑，并在验证报告单独列出。

## 兼容策略

- 旧 `maxToolCallsPerTurn` settings 字段可以继续存在于已持久化 JSON 中，但不再影响 Worker 执行。
- 新版 UI 不再展示该设置，新请求不再发送该字段。
- Worker 即使收到旧客户端发送的 `maxToolCallsPerTurn`，也忽略该字段，不跳过工具调用。
- 不新增数据库迁移，不删除用户配置文件中的历史字段。

## 验收标准

1. `maxParallelTools=N` 时，普通工具任意时刻最多 N 个同时运行。
2. 一轮工具数量超过 N 时，超出部分等待槽位，不返回“超过上限/下轮重试”错误。
3. 同一轮所有合法工具最终都有真实执行结果，除非用户取消或工具本身失败。
4. 单个工具失败不会泄漏 semaphore 槽位，后续等待工具继续执行。
5. default 权限模式审批顺序保持现状；Task/子 Agent 并发限制保持独立。
6. 设置页不再展示“每轮最大工具调用数”，只展示最大并行工具数和子 Agent 并发上限。
7. 旧配置包含 `maxToolCallsPerTurn` 时不报错、不影响执行。
8. 三套 TypeScript、相关 C# 回归测试、Agent build、solution/隔离 build 和 `git diff --check` 通过。
9. 未经用户运行确认，不提交或 push 本次业务代码。

## Git 与工作区隔离

- 当前工作区已有压缩显示专项 7 个未提交文件，属于用户工作，禁止 stash、reset、checkout 或覆盖。
- 本专项规划文档位于独立目录 `docs/plans/iter-v2-24/plan-tool-concurrency-queue/`。
- 执行阶段优先避开压缩专项文件；必须触及时先重新读取目标文件并只做可分离的局部编辑。
- 规划确认前不修改业务代码。
