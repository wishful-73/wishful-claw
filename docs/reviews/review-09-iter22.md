# 代码审查报告 9：v2-iter-22 全面复核

> 审查范围：v2-iter-22 已提交的渠道、Cron、SQLite、Renderer Automation 实现，以及当前工作区未提交的子 Agent FIFO 并发排队改动
> 审查时间：2026-08-25
> 审查基线：`dev/v2-iter-22`，HEAD `cba0f7d8 docs(v2-iter-22): record final review and verification`
> 审查方式：计划与历史报告核对、逐文件全文阅读、跨 Main/Renderer/Worker 调用链复核、现有回归测试重跑
> 说明：本报告只记录本轮复核结论，不修改业务代码。已提交迭代代码与本地未提交改动分别评价。

---

## §1 总体结论

当前不建议将工作区直接视为“可完成交付”。

原因：

1. 已提交的 v2-iter-22 存在 Cron 更新一致性问题，以及 UI/工具入口对一次性任务默认行为不一致的问题。
2. 本地未提交的并发排队实现存在全局并发上限被不同运行参数互相覆盖的高风险设计问题。
3. 现有 Cron 回归主要覆盖 Native Schema、SQLite DDL、迁移和 CRUD，尚未自动覆盖 Main 调度器与 Renderer 运行事件闭环；新的 FIFO limiter 也没有独立回归测试。
4. `plan.md` 的步骤 15 仍未勾选，历史验证报告明确写明用户最终 VERDICT 待确认。因此只能判定技术复核完成，不能自行判定迭代完结。

---

## §2 已提交 v2-iter-22：高优先级

### I22-1 Cron 更新成功后重新调度失败，数据库和内存状态不回滚

**位置**：

- `src/main/ipc/reverse-handlers/cron-reverse-handler.ts:434-445`

**问题**：

`handleCronUpdate` 当前按以下顺序执行：

1. 调用 `db/crons-update`，持久化新配置；
2. 清理旧 timer；
3. 将内存 `jobs` 替换为新配置；
4. 调用 `scheduleJob(next)`；
5. 调度失败时返回 `{ error }`。

调度失败后没有恢复数据库、内存和旧 timer。调用方收到失败响应，但新配置实际已经写入，旧调度也已经移除。

**影响**：

- UI 显示保存失败，刷新后却可能读到已保存的新配置。
- 任务可能处于“数据库配置已更新，但 Main 没有有效 timer”的状态。
- 后续是否恢复取决于重新编辑、重新启用或应用重启，行为不稳定。

**建议**：

- 数据库写入前完成全部调度参数校验；或
- 保存旧配置和旧调度，在重排失败时恢复数据库、内存和 timer；或
- 将“验证/构造调度计划”和“注册 timer”拆开，使数据库更新前已排除可预见失败。

**等级**：高。

---

## §3 已提交 v2-iter-22：中优先级

### I22-2 `at` 任务的 `deleteAfterRun` 默认语义在工具入口与 UI 入口不一致

**位置**：

- `src/main/ipc/reverse-handlers/cron-reverse-handler.ts:350-370`
- `src/renderer/src/components/automation/CronJobFormDialog.tsx:51-67`
- `src/renderer/src/components/automation/CronJobFormDialog.tsx:173-179`
- `src/renderer/src/lib/tools/cron-tool.ts:23-32`
- `src/renderer/src/lib/tools/cron-tool.ts:115-117`

**问题**：

Main 端仅在调用方没有传 `deleteAfterRun` 时，才对 `kind === 'at'` 默认设为 `true`：

```ts
deleteAfterRun:
  (params.deleteAfterRun as boolean | undefined) ?? (schedule.kind === 'at')
```

但 Automation 表单初始值为 `false`，保存时始终显式发送该字段。因此：

- Agent 工具未传字段创建 `at` 任务：默认自动删除；
- UI 创建 `at` 任务：默认不会自动删除。

Native 工具文案仍声明 `at` 是一次性且默认自动删除，导致同一任务类型在不同入口具有不同生命周期行为。

**影响**：用户从 UI 创建的一次性任务可能长期保留，与工具说明和后端隐式默认不一致。

**建议**：

- UI 在切换到 `at` 时默认设置 `deleteAfterRun=true`，允许用户主动关闭；或
- 取消隐式默认，要求所有入口显式选择，并同步修改工具文案与测试。

**等级**：中。

### I22-3 Main 调度器与 Renderer 事件闭环缺少自动回归覆盖

**位置**：

- `src/main/ipc/reverse-handlers/cron-reverse-handler.ts:232-334`
- `src/main/ipc/reverse-handlers/cron-reverse-handler.ts:504-544`
- `src/renderer/src/lib/tools/cron-runtime.ts:187-283`
- `tests/WishfulClaw.CronRegressionTests/Program.cs`

**问题**：

现有 Cron 回归覆盖：

- Native 工具 Schema；
- SQLite DDL 和旧库迁移；
- create/get/list/update/toggle/delete；
- `mark-fired` 和 `mark-run-finished`；
- 子进程重开持久化。

但没有自动覆盖：

- Main `fireJob()` → Renderer `cron:fire` → Agent → `cron:run-complete` 的真实闭环；
- `fireId` 错配不能释放新运行锁；
- Renderer 退出后的运行锁清理；
- `deleteAfterRun` 在成功、失败和通知失败路径上的归档；
- desktop/session/plugin/none 四种 delivery 行为；
- `cron:update` 重排失败；
- 周期任务在执行或通知失败后是否继续触发。

**影响**：历史“技术验证通过”证明编译、SQLite 和单次隔离冒烟有效，但不能替代调度器与 UI 全链路回归。

**建议**：增加最小 Main/Renderer 集成 harness，至少覆盖运行锁、`fireId`、一次性归档和更新重排失败。

**等级**：中，属于验收覆盖缺口。

---

## §4 已提交 v2-iter-22：低优先级

### I22-4 UI 操作失败后缺少主动重新同步

**位置**：

- `src/renderer/src/components/automation/AutomationPage.tsx:97-128`

**问题**：

`toggleJob` 和 `deleteJob` 都是在确认后端无 `error` 后才更新本地状态，因此不是“先乐观更新、后请求”的确定性缺陷。

但请求失败时只显示 toast，没有调用 `refresh()`。若失败来源是响应丢失、页面状态过期或 Main/DB 暂时不一致，UI 可能继续展示旧状态，直到用户手动刷新或收到后续 Cron 事件。

**建议**：失败后按需执行一次 `refresh()`，或让后端返回完整任务状态并以返回值更新本地数据。

**等级**：低。

### I22-5 Automation 表单未暴露 `agentId`

**位置**：

- `src/main/ipc/reverse-handlers/cron-reverse-handler.ts:34,362,417`
- `src/renderer/src/lib/tools/cron-tool.ts:93-95`
- `src/renderer/src/components/automation/CronJobFormDialog.tsx:28-45`

**问题**：Main 和 Native 工具均支持 `agentId`，但 Automation 表单值、输入控件和保存 payload 中没有该字段。

**影响**：通过 UI 无法选择特定 Agent，只能依赖默认解析逻辑；工具入口与 UI 能力不对齐。

**等级**：低到中，取决于产品是否承诺 UI 支持 Agent 选择。

### I22-6 `plan.md` 对步骤 15 的状态表达不一致

**位置**：

- `docs/plans/iter-v2-22/plan.md:48-58`
- `docs/plans/iter-v2-22/verification_report.md:9-13`

**问题**：步骤 15 未勾选，但后文写“步骤 15 的技术验证已通过”。验证报告同时明确用户最终 VERDICT 待确认，未执行 merge/tag/push/release。

**建议**：统一表述为“步骤 15 技术验证完成，人工验收和最终裁定待用户确认”。

**等级**：低，文档一致性问题。

---

## §5 本地未提交并发排队改动：高优先级

### SAQ-1 全局 limiter 的并发上限被不同运行参数互相覆盖

**位置**：

- `src/runtime/WishfulClaw.Agent/SubAgentConcurrencyLimiter.cs:13-18`
- `src/runtime/WishfulClaw.Agent/SubAgentConcurrencyLimiter.cs:28-38`

**问题**：

当前只有一个进程级共享实例：

```csharp
private static readonly FifoLimiter Limiter = new();
```

每次 Acquire 都从当前任务参数读取 `maxConcurrentSubAgents`，然后直接改写共享 limiter 的 `_max`：

```csharp
var configuredLimit = Math.Max(1, JsonHelpers.GetInt(parameters, "maxConcurrentSubAgents", 2));
return Limiter.AcquireAsync(configuredLimit, cancellationToken);
```

```csharp
_max = max;
```

假设运行 A 配置上限 1，运行 B 配置上限 8，B 的一次 Acquire 会把整个进程的上限改成 8；反向调用也会把所有调用方压到 1。实际全局并发取决于最后一次 Acquire 的参数，而不是稳定配置。

**影响**：

- 不同 Session、Goal、前台和后台 Task 的配置互相影响；
- 可能突破用户期望上限；
- 并发行为具有时序依赖，难以复现；
- FIFO 顺序仍存在，但队列容量语义不稳定。

**建议**：优先确定产品语义后选择一种稳定模型：

1. Worker/进程启动时解析一次全局上限，后续 Acquire 不允许改写；这是最清晰的进程级总并发语义。
2. 按配置值维护独立 `FifoLimiter`，避免配置互相覆盖；但不同配置组之间不共享总并发，需要明确是否符合产品要求。
3. 不建议保留“每次 Acquire 动态改写全局 `_max`”的实现。

**等级**：高。当前未提交实现不应直接合入。

---

## §6 本地未提交并发排队改动：中优先级

### SAQ-2 FIFO limiter 没有独立竞态与取消回归测试

**位置**：

- `src/runtime/WishfulClaw.Agent/SubAgentConcurrencyLimiter.cs`
- `src/runtime/WishfulClaw.Agent/SubAgentExecutor.cs:132-136`
- `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs:48-55`
- `src/runtime/WishfulClaw.Agent/Goal/GoalSubAgentExecutor.cs:48-52`

**问题**：

Acquire 已接入普通前台 Task、后台 Task 和 Goal 子 Agent turn，但没有测试覆盖：

- 上限为 1 时的实际最大并发；
- 多个等待者的严格 FIFO；
- 等待期间取消并移除队列项；
- 取消与 Pump 同时发生；
- lease 完成、异常和取消后的槽位释放；
- 前台、后台、Goal 混合运行；
- 父任务在排队期间和执行期间取消；
- 不同配置值之间的语义。

**影响**：构建通过只能证明类型和语法正确，不能证明并发竞态正确。

**建议**：在现有 console regression harness 中补最小可重复测试；若需要直接测试内部类型，可通过 `InternalsVisibleTo` 或抽出可测试的 internal limiter 实例。

**等级**：中。

### SAQ-3 后台取消注册与 child dispose 当前方向正确，但需要竞态验证

**位置**：

- `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs:38-49`
- `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs:177-185`
- `src/runtime/WishfulClaw.Agent/AgentRuntimeRunState.cs:170-187`

**复核结论**：

当前代码保存了 parent cancellation registration，并在 finally 中先 Dispose registration，再 Dispose child state，修复了历史 SA-2 的主要生命周期问题。`Task.Run` 也不再使用父 token 作为调度 token，避免父取消导致委托根本不执行、registry 和 child state 无法清理。

本轮没有足够证据将该路径判定为已确认缺陷，但仍应测试：

- parent 在 Acquire 排队期间取消；
- parent 在 `AgentLoop` 内取消；
- parent 在 finally 附近取消；
- registration 释放后父 token 再取消。

**等级**：中，属于待验证竞态，不是已确认 bug。

---

## §7 渠道发送与敏感日志复核

已核对微信、飞书主动发送链路：

- 微信发送要求已有会话对应的 context token；缺失时明确失败；
- 飞书复用服务发送 API；
- Cron runtime 通过统一 `plugin:exec/sendMessage` 路径发送；
- 本轮未发现直接打印 token、secret 或完整 Cron 通知正文的确定性问题。

验证边界：历史报告明确未执行真实微信/飞书在线发送。因此以下行为仍缺少真实外部服务证据：

- 飞书真实 chatId 发送；
- 微信 context token 过期后的错误表现；
- 第三方接口错误载荷兼容；
- 渠道服务未启动时的最终 UI/任务状态。

这属于验证限制，不单独判定为代码缺陷。

---

## §8 验证结果

### 通过

- `dotnet build src/runtime/WishfulClaw.sln --no-restore`：历史复核通过，0 warning / 0 error。
- TypeScript 三配置：历史复核均通过。
- `git diff --check`：本轮工作区通过。
- `dotnet run --project tests/WishfulClaw.CronRegressionTests/WishfulClaw.CronRegressionTests.csproj --no-build`：通过。
  - 父进程 Schema：38 项；
  - 旧库迁移与 CRUD：66 项；
  - 子进程重开：6 项；
  - 新库 DDL：5 项。

### 既有失败

`dotnet run --project tests/WishfulClaw.GoalRegressionTests/WishfulClaw.GoalRegressionTests.csproj --no-build` 稳定失败于：

- `tests/WishfulClaw.GoalRegressionTests/Program.Lifecycle.cs:37`
- `KeyNotFoundException: The given key 'goal' was not present in the dictionary.`

该断言位于未修改的既有 Goal 生命周期测试中；当前没有证据表明它由本轮 Cron 或并发排队改动引入。

### 当前工作区

```text
 M src/runtime/WishfulClaw.Agent/Goal/GoalSubAgentExecutor.cs
 M src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs
 M src/runtime/WishfulClaw.Agent/SubAgentExecutor.cs
?? src/runtime/WishfulClaw.Agent/SubAgentConcurrencyLimiter.cs
```

本轮审查报告新增后，`docs/reviews/review-09-iter22.md` 也将显示为未跟踪文件。未执行 commit、push、merge、tag 或 release。

---

## §9 分级汇总

| 等级 | ID | 问题 |
|---|---|---|
| 高 | I22-1 | `cron:update` 重排失败后不回滚数据库、内存和 timer |
| 高 | SAQ-1 | 全局 limiter 的并发上限被不同调用方动态互相覆盖 |
| 中 | I22-2 | `at.deleteAfterRun` 在工具入口与 UI 入口默认语义不一致 |
| 中 | I22-3 | Main/Renderer Cron 运行闭环缺少自动回归覆盖 |
| 中 | SAQ-2 | FIFO limiter 缺少并发、FIFO、取消和释放测试 |
| 中 | SAQ-3 | 后台父子取消生命周期方向正确，但缺少竞态测试 |
| 低 | I22-4 | UI 操作失败后不主动重新同步 |
| 低/中 | I22-5 | Automation 表单未暴露 `agentId` |
| 低 | I22-6 | 步骤 15 的文档状态表达不一致 |

---

## §10 建议处理顺序

1. 固定 `SubAgentConcurrencyLimiter` 的上限来源，禁止每次 Acquire 改写全局 `_max`。
2. 为 limiter 增加最大并发、严格 FIFO、等待取消、异常释放和混合调用方测试。
3. 修复 Cron 更新失败后的数据库、内存和 timer 一致性。
4. 统一 `at.deleteAfterRun` 的 Main、Native Schema 和 Automation UI 默认语义。
5. 增加 Main/Renderer Cron 最小集成回归，覆盖 `fireId`、运行锁、一次性归档和更新重排失败。
6. 用户完成最终人工验收后，再决定是否裁定 v2-iter-22 完结。

---

## 附：经复核未成立或已修正的审查意见

- `AutomationPage.deleteJob` 并非先移除 UI 再检查后端错误；当前代码在确认 `result.error` 不存在后才执行 `setJobs`。
- `cron:fire` 载荷已包含 `maxIterations`，位于 `cron-reverse-handler.ts:271`。
- 后台子 Agent 的 parent cancellation registration 当前已保存并在 finally 中释放，历史 SA-2 的直接泄漏问题已修正。
- `Task.Run` 中的异常 catch 已对二次 `EmitAsync` 失败进行兜底，历史 SA-6 的未观察异常路径已修正。
