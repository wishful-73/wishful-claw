# iter-v2-19 代码审查 Bug 清单

> 审查范围：`HEAD~19..HEAD`（2588 insertions / 197 deletions，48 files）
> 审查时间：2026-08-21 14:19–14:30
> 审查方式：人工逐文件读 diff + 全文交叉验证。两个 code-reviewer 子代理因输出丢失未贡献结论（见 §3）。
> 构建验证：`npm run typecheck` 与 `dotnet build` 已发起但未跑完（当前软件运行中占用源码），**编译通过性待外部环境确认**。

---

## §1 严重（功能错误，建议下一迭代优先修）

### BUG-1 重启清扫 SQL 是 no-op，goal_plans/goal_tasks 假"执行中"不会被清除

**位置**：`src/runtime/WishfulClaw.Infrastructure/Db/DbClientGoalMigrations.cs` — `SweepInterruptedGoals()`

```sql
-- 现状：SET 和 WHERE 都是 'active'，只刷新了 updated_at，状态根本没变
UPDATE goal_plans SET status = 'active', updated_at = @now
WHERE status = 'active' AND started_at IS NOT NULL;

UPDATE goal_tasks SET status = 'active', updated_at = @now
WHERE status = 'active' AND started_at IS NOT NULL;
```

**问题**：
1. 注释写的是 "any plan still 'active' was interrupted by the shutdown"，意图是标记中断，但 SET 值写成了 `'active'` 自身——纯空转 UPDATE。
2. 同函数内 `goal_plan_tasks` 和 `goal_execution_runs` 都正确设置了 `'interrupted'`，唯独这两条漏了，三层行为不一致。
3. 后果正是注释里说要消除的："the panel no longer shows fake executing entries" —— 重启后面板继续显示假"执行中"的计划和任务。

**连带问题**：前端 `goal-store-helpers.ts` 中 `SessionGoalPlan['status']` 白名单是 `pending | active | complete | aborted`，`rowToPlan` 对未知状态 fallback 到 `'pending'`。即使把 SQL 改成 `'interrupted'`，前端也会显示成"待执行"，同样是错的。**前后端必须一起改**：SQL 改为 `'interrupted'`，前端 `SessionGoalPlan`/`SessionGoalTask` 的 status 联合类型加 `'interrupted'`，`rowToPlan`/`rowToTask` 的白名单同步，i18n 的 `taskStatus` 已有 `interrupted` 键可直接复用。

---

### BUG-2 Plan adjust 换 PlanId 后，DB 三层结构断链，后续状态更新全部静默失败

**位置**：`src/runtime/WishfulClaw.Agent/Goal/GoalOrchestratorLoop.cs` L256–264 + `GoalOrchestratorMaterialize.cs` + `DbGoalPlanTools.cs`

**链条**：
1. `ExecutePlanWithRetryAsync` 中 evaluation 返回 `NextAction == "adjust"` 时：
   ```csharp
   plan.OriginalPlanId ??= plan.PlanId;
   plan.PlanId = $"plan-{Guid.NewGuid():N}".Substring(0, 16);  // 换新 id
   ```
2. 旧 planId 的 `goal_plans` 行**无人收尾**——不标 aborted/superseded，永远卡在 active。
3. 新 planId **从未 INSERT**——`MaterializePlans` 只在 goal 首次分解时调用一次（Loop L49），adjust 后不再物化。
4. 后续所有 `UpdatePlanStatus` / `UpdateTaskStatus` / `StartExecutionAttempt` 都用新 PlanId 查询 → 找不到行 → `UpdatePlanStatusInternal` 里 `changed != 1` 抛 `InvalidOperationException` → 被 Materialize 层 catch 吞掉只打 Warn → **静默失败**。
5. `goal_tasks` 物化时挂在旧 planId 下（`MaterializeTasks` 在换 id 之前执行），任务状态跟踪整体失效。

**前端表现**：面板优先读 `goal_plans` 表（plansJson 仅 fallback），读到的是卡死的旧行；adjust 后的真实进度只存在于内存和 `session_goals.plans_json`，面板看不到。

**修复建议**：adjust 时同步做三件事——① 旧行 `UpdatePlanStatus(旧id, superseded 或 aborted)`；② 新行 INSERT 进 `goal_plans`（带 `original_plan_id`）；③ 已物化的 `goal_tasks` 若要复用需 re-parent 到新 planId，否则重新物化。另外建议 Materialize 层对 "affected rows = 0" 的更新加一条 Warn 计数，连续失败时上抛，避免再次静默。

---

### BUG-3 429 恢复路径未适配 task 化结构：整个 plan 双重执行 + 已完成任务全量重跑

**位置**：`src/runtime/WishfulClaw.Agent/Goal/GoalOrchestratorLoop.cs` L142–216、L281–335

**链条**：
1. task 循环中某 task 429 → `break` 出 foreach → 进入 `Handle429BackoffAsync`。
2. backoff 轮询里用 **`ExecutePlanAsync`（旧的"整个 plan 一个 sub-agent"路径）** 做测试请求——这个调用会真实执行整个 plan，产生完整副作用。
3. resolved 后返回 `retryResult`，但调用方 L210–215：
   ```csharp
   if (backoffResult != null) { continue; }  // 结果被丢弃
   continue;                                  // 两个分支干的事一模一样
   ```
4. `continue` 回 while 顶部，foreach **从 task 1 重新开始**——foreach 内没有跳过已完成任务的逻辑，task 1、2 被再次执行。
5. 净效果：旧路径执行一遍 plan + 新路径全量重跑所有 tasks。token 双倍浪费，文件/外部副作用重复。
6. 非 429 失败的重试路径同理：task 3 失败 → retry → foreach 从 task 1 全量重跑。

**修复建议**：
- foreach 跳过 `status == Complete` 的 task（以内存 tasks 列表或 goal_tasks 表状态为准），实现断点续跑；
- `Handle429BackoffAsync` 的测试请求不应走 `ExecutePlanAsync` 整 plan 执行——换成轻量探针（如一次最小 LLM ping），或至少把 `retryResult` 用于抵消后续执行；
- L210–215 的重复 `continue` 合并，`backoffResult` 要么用起来要么删掉。

---

## §2 中等

### BUG-4 429 检测靠字符串子串匹配，存在误判

**位置**：`GoalOrchestratorTaskLoop.cs` L119、L157；`GoalOrchestratorLoop.cs` L406、L444

```csharp
if (output.Contains("429") || output.Contains("Too Many Requests", ...))
```

任务输出内容里恰好出现 "429"（讨论 HTTP 状态码、金额、编号）就会被误判为限流，触发最长 6 小时的 backoff 循环。应基于异常类型 / 结构化的 HTTP 状态码判断，而不是对 sub-agent 的自然语言输出做子串匹配。至少要把检测范围收窄到错误前缀模式（如 `"HTTP 429"`）。

### BUG-5 GoalEventContext 异常路径残留，goal_activity 事件错标

**位置**：`GoalOrchestratorTaskLoop.cs` L106–113；`GoalOrchestratorLoop.cs` L393–400

`parentState.GoalEventContext = null` 只在 `SubAgentExecutor.ExecuteAsync` 正常返回后执行；抛异常时 catch 分支不清理。残留的 context 会把**下一个不属于该 goal 的 sub-agent 调用**的事件错标成 goal_activity（错误的 goalId/planId）。建议用 try/finally 包裹，或在 `SubAgentExecutor.ExecuteAsync` 入口强制覆盖。

### BUG-6 面板轮询 useEffect 依赖数组引用，定时器不断重建

**位置**：`GoalHistoryPanel.tsx` 轮询 effect（约 L201–221）

依赖数组含 `goalPlans`（zustand 里每次 `loadGoalPlans` 都 set 新数组引用）。轮询回调里 `loadGoalPlans(force=true)` → 新引用 → effect 重建 → `clearInterval` + `setInterval` 重置 → 计时周期漂移，形成"轮询结果重置轮询计时器"的自触发循环。功能勉强能用，但属于 React 反模式。建议依赖只留原始值（`goalPlans.length` 或 planId 串），或在回调内用 ref 读最新值。

### BUG-7 三层树中 task 状态未走 i18n

**位置**：`GoalHistoryPanel.tsx` 展开区 task 列表

plan 状态用了 `t('goal.history.taskStatus.${plan.status}')`，同一棵树里 task 状态直接输出原始英文（`{task.status}`）。中文界面下状态列中英混杂。i18n 键已存在（`taskStatus.pending/executing/completed/...`），补上 `t()` 即可；注意 `goal.history.tasks` 用了 `defaultValue` 兜底但 zh/en 的 chat.json 里未见该键（en 侧需确认）。

---

## §3 流程问题（本次审查过程中发现）

### ISSUE-1 子代理最终报告丢失

两个 code-reviewer 子代理（后端 C# / 前端 TS）各自跑满 12 次迭代后状态 `completed`，但 Output 只剩最后一句话（"现在我来验证…"），**完整审查报告没有产出**。工具调用日志显示它们已读完全部目标文件（18 / 15 次调用），工作量全部白费。

**建议**：
- 子代理协议加硬性约束：剩余迭代 ≤ 2 时必须停止探索、输出报告；
- 或提高默认迭代上限，探索型任务（审查/研究）给足预算；
- 子代理框架考虑在迭代耗尽时把中间发现落盘为文件，而不是只留最后一句输出。

### ISSUE-2 构建验证未完成

`npm run typecheck` 与 `dotnet build src/runtime/WishfulClaw.sln` 已发起，因当前软件运行中占用源码 + 会话中断未拿到结果。**本轮改动的编译通过性未经独立验证**，外部环境接手后请先跑这两个命令再动代码。

---

## §4 轻微（不阻塞，顺手修）

| # | 位置 | 问题 |
|---|------|------|
| L1 | `GoalOrchestratorLoop.cs` L260 | `$"plan-{Guid.NewGuid():N}".Substring(0, 16)` 只留 11 个 hex 字符（44 bit）作 DB 主键，偏短；task 侧 21 字符尚可。建议统一不截断或至少 16 hex |
| L2 | 多个文件 | 本轮 diff 给 `main/index.ts`、`GoalHistoryPanel.tsx`、`goal-store-helpers.ts`、`goal-history-store.ts`、`GoalOrchestratorLifecycle.cs`、`GoalStatusValues.cs`、`DbClientGoalMigrations.cs` 等混入了 UTF-8 BOM，与项目原有无 BOM 文件不一致，建议 `.editorconfig` 加 `charset = utf-8`（无 BOM）并批量清理 |
| L3 | `GoalOrchestratorMaterialize.cs` `AbortSubtree` | SQL 内联 `'aborted'`/`'complete'`/`'interrupted'`/`'executing'` 字面量，未用 `GoalPlanStatusValues`/`GoalExecutionAttemptStatusValues` 常量，状态值漂移时这里不会编译报错 |
| L4 | `SubAgentExecutor.cs` ForwardEvent 注释 | 注释称 "a throttled text snapshot is emitted instead"，实际无任何 throttled snapshot 实现，注释与代码不符 |
| L5 | `SubAgentExecutor.cs` `BuildGoalActivityEvent` | `ToolUseId: goalCtx.GoalId`、`SubAgentName: goalCtx.PlanTitle` 属于字段语义挪用，靠约定不靠类型；前端一旦按 ToolUseId 做关联就会踩坑 |
| L6 | `locales/zh/chat.json` L425 | `"interrupted"` 键缩进多了 2 个空格，JSON 合法但破坏对齐 |
| L7 | `GoalOrchestratorLoop.cs` L142 | decomposition 返回空数组时 tasks 为空，foreach 不执行，evaluate 拿空输入，白白重试 3 轮（每轮 2 次 LLM 调用）。建议 tasks 为空时直接 fallback 单 task = plan 本身 |
| L8 | `DbGoalPlanTools.cs` `UpdatePlanStatusInternal` | UPDATE 与读回 SELECT 不在同一事务，存在竞态窗口（单进程影响小，记录备查） |
| L9 | `DbClientGoalMigrations.cs` `SweepInterruptedGoals` 注释 | "The goal itself stays active... only plans and round tasks are marked interrupted" 与下方 goal_plans/goal_tasks "stays active (resumable)" 注释自相矛盾，配合 BUG-1 一起理清语义 |

---

## §5 总体评价

架构方向是对的：定义（plans/tasks）与执行（execution_runs/rounds）分离、best-effort 物化不阻塞主循环、事件降噪（goal 运行时跳过 text_delta）都是合理设计。DB 层参数化查询、事务使用、幂等物化都规范，前端 store 的 row 校验 fallback 写法统一。

核心风险集中在**状态机的边角**：adjust 换 id、429 恢复、重启清扫这三条"非主干路径"都没有闭环，而且失败模式全是静默的（Materialize 吞异常 + 前端 fallback），出了问题面板只会安静地显示错误状态。建议下一迭代：先修 BUG-1（一行 SQL + 前端类型）和 BUG-2（adjust 闭环），BUG-3 涉及执行语义改动单独排；同时给 Materialize 层加失败计数告警，别再让"best-effort"变成"best-effort 到没人知道它失败了"。
