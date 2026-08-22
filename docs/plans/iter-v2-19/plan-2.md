# Plan 2: Goal 编排运行时真实性与评估强化（用户实测反馈 4 问题）

## 目标
修复用户实测发现的 4 个 Goal 模式缺陷：确认后运行态延迟、面板状态语义错误、评估过松导致目标提前完成、计划状态与任务进度脱节。

## 探索结论（证据）

### 问题 1：确认创建后前端显示空闲约 10 秒才变执行中
根因（两处叠加）：
- **工具路径 confirm 不发 run-state 事件**：`AgentRuntimeGoalExecutor.AwaitGoalConfirmationAsync`（约 L189-206）确认成功后直接调 `ConfirmGoalAsync`，不像 `GoalModule.ConfirmGoal`（HTTP 路径）那样补发 `EmitRunStateChangedAsync`——GL-8 同款缺口，上次只修了 pause/resume，漏了 confirm。
- **StartAsync 事件竞态**：`GoalOrchestratorLifecycle.cs:50-53` 先 fire-and-forget 发 "Goal created" 事件、后调 `StartOrResumeRun`（内部才置 `RunState=Running`）。首发事件的 runState 字段几乎总是 idle。下一个 goal_progress 事件要等分解 LLM 返回（≈10s）才发出，期间前端一直显示空闲。

### 问题 2：DB 状态进行中时，面板标题旁应显示运行时状态而非 DB 状态
`GoalHistoryPanel.tsx:321-332` 徽章逻辑：running→运行徽章、paused→暂停徽章、**其余一律落回 `GoalStatusBadge(goal.status)`**。当 goal active 但 runState=idle（如启动失败后、或确认瞬间）显示"进行中"，语义误导。i18n 已有 `goal.history.idleTitle`（zh "空闲"）可复用或补 `goal.status.idle`。

### 问题 3：探索计划只查了文件存在，整个目标被标记完成
三因素叠加：
- `ExecuteTaskAsync`（TaskLoop.cs:141-163）：子 agent 输出非 429 即记 `Complete`，从不程序化核对 description 里的验证标准；
- 评估器只看 500 字符截断的自报摘要（`Summary = output.Substring(0, 500)`），`EvaluationSystemPrompt` 无"逐条核对验证标准、无证据判不满足"约束；
- `DecompositionSystemPrompt` 允许模型把目标坍缩成单个探索计划（日志证实该次编排只有 1 个 plan，eval 完即 allCompleted）。

### 问题 4：任务执行完毕后计划仍显示执行中
两层：
- 设计上 plan 只在"全部任务完成且评估 satisfied"后才翻 Complete（Loop.cs:236），评估 LLM 耗时窗口内确实仍是 active——正常；
- 但**评估不满足重试耗尽后 plan 故意保持 Active**（Loop.cs:248-256，failed-but-active 供 Resume），且 Goal 停止后（runState=idle）UI 仍渲染"执行中"，无法区分"在跑"和"等待恢复"。UI 真实性问题，与问题 2 同根。

## 步骤清单

- [x] 步骤1：工具路径 confirm 补发 run-state + 消除 StartAsync 竞态
  - `AwaitGoalConfirmationAsync` 确认成功后 `await EmitRunStateChangedAsync(sessionId, new GoalActionResult(true,"started",Active,Running,goalId), context)`
  - `StartAsync` 把 "Goal created" 事件移到 `StartOrResumeRun` 之后发（此时 RunState 已是 Running）
  - 验证：`dotnet build` 0 错误
- [x] 步骤2：面板状态徽章按运行态渲染（问题 2+4）
  - 详情页头徽章：terminal（complete/aborted）→ DB 徽章；否则按 runState 显示 运行中/已暂停/空闲（新增 `goal.status.idle` i18n，en+zh）
  - 计划卡片状态：`plan.status==='active' && selectedRunState!=='running'` 时显示为 interrupted（复用现有 `taskStatus.interrupted` 文案），如实表达"未在跑"
  - 验证：tsc 三配置 0 错误
- [x] 步骤3：评估链路强化（问题 3）
  - `DecompositionSystemPrompt`：实现类目标禁止坍缩为单一探索计划，必须含 implement + verify 计划（最少 2 个）
  - `TaskExecutionSystemPrompt`/`BuildTaskExecutionUserPrompt`：要求逐条核对验证标准，输出 `Verification: <标准> PASS/FAIL <证据>`；无证据禁止宣称完成
  - `EvaluationSystemPrompt`/`BuildEvaluationUserPrompt`：逐条对照验证标准；结果缺证据 → satisfied=false + retry；纯浏览/读取不满足实现类声明
  - 任务结果截断 500→2000 字符，给评估器更完整证据
  - 验证：`dotnet build` 0 错误
- [x] 步骤4：收尾验证
  - C# build + tsc 三配置 + 触碰文件 BOM 扫描
  - 更新 verification_report.md 补充段
- [x] 步骤5：任务结果回传规范化（参照 DeepSeek-Reasonix task.go/evidence 设计，用户拍板方案 B）
  - 5a. 去掉 ExecuteTaskAsync 的 Substring(0,2000)：完整结果入库（goal_plan_tasks.summary / goal_execution_runs），DB TEXT 无长度压力
  - 5b. 评估器入参兜底改 head+tail 截断（参照 Reasonix truncateToolOutput：保留首尾各半 + 省略标注），Verification 行在尾部永不丢失
  - 5c. EvidenceDigest：TaskLoop 执行任务期间聚合宿主收据（写文件路径、shell 命令及成败），附到 PlanExecutionResult.Evidence，评估提示词同看"模型自报 + 宿主事实"
  - 验证：dotnet build 0 错误
- [x] 步骤6：收尾验证（同步骤4）

## 涉及文件
- `src/runtime/WishfulClaw.Agent/AgentRuntimeGoalExecutor.cs` — 步骤1
- `src/runtime/WishfulClaw.Agent/Goal/GoalOrchestratorLifecycle.cs` — 步骤1
- `src/runtime/WishfulClaw.Agent/Goal/GoalPromptTemplates.cs` — 步骤3
- `src/runtime/WishfulClaw.Agent/Goal/GoalOrchestratorTaskLoop.cs` — 步骤3（截断长度）
- `src/renderer/src/components/goal/GoalHistoryPanel.tsx` — 步骤2
- `src/renderer/src/locales/{zh,en}/chat.json` — 步骤2（idle key）

## 验证标准
1. 确认创建后 ≤2s 内面板/横幅显示运行中（不再等分解完成）
2. goal active + 未在跑 → 标题旁显示"空闲"；跑动中显示"运行中"
3. 含实现声明的目标不会被单探索计划直接标记完成（评估提示词约束，需实测复跑验证）
4. 计划卡片在 Goal 停止时不显示"执行中"

## 参考源码
- 自研逻辑，无外部参考；状态词汇表见 `WishfulClaw.Contracts/GoalStatusValues.cs`
