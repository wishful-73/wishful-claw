# Verification Report — v2-iter-19

验证时间：2026-08-20

## 编译验证（工具证据）

- C#：`dotnet build src/runtime/WishfulClaw.sln -v q` → **0 个错误**（步骤1/2/3 各跑一次均通过）
- TypeScript（三配置全零错误）：
  - `npx tsc --noEmit -p tsconfig.web.json` → PASS
  - `npx tsc --noEmit -p tsconfig.node.json` → PASS
  - `npx tsc --noEmit -p tsconfig.json` → PASS

## 静态链路核验

- 端点链路：`DbModule: db/goal-plan-tasks-list` → `main/index.ts: db:goal-plan-tasks:list:msgpack` → `shared/binary-ipc.ts: DB_GOAL_PLAN_TASKS_LIST_MSGPACK_CHANNEL` → `goal-history-store.loadGoalPlanTasks` —— 四段通道名一致（grep 逐段核对）
- 写入链路：GoalOrchestratorLoop 四个节点（轮开始 insert / completed / maxRetries failed / retry-adjust failed）均调用 GoalPlanRecorder，best-effort 不阻断
- 迁移：`CREATE TABLE IF NOT EXISTS goal_plan_tasks` + 索引，幂等，与既有表创建模式一致

## 补充验证（步骤 7/8/9，2026-08-20）

- 步骤7：GoalOrchestratorLoop 拆分节点后立即调用 SyncGoalToDb，plans 全量入库（静态核对调用点）
- 步骤8/9 编译：C# `dotnet build` 0 错误；TS 三配置全零错误（含 goal-store / chat-store / GoalHistoryPanel 改动）
- goal_activity 事件链：SubAgentExecutor.CreateCollector 转发（带 GoalEventContext 的 run）→ AgentRuntimeStreamEvent.Input(JsonElement) 携带 goalId/planId/round/kind/toolName → chat-store index.ts 分流 → useGoalStore.applyGoalActivity → GoalHistoryPanel 计划卡片活动流（链根 planId 过滤，最近 30 条）
- 降噪：Goal 运行时 CreateCollector 跳过 text_delta 逐条转发（静态核对）

## 补充验证（review-06 修复功能单元，2026-08-21）

commit `1af53c1`（GL-1..16）+ 审查修正 commit：

- C#：`dotnet build src/runtime/WishfulClaw.sln -v q` → **0 警告 0 错误**（修复后 + 审查修正后各一次）
- TypeScript 三配置全零错误（本次未改前端，按规范照跑）：web / node / root 均 PASS
- BOM 扫描：Edit 工具两次引入 BOM 回归（13 文件 + 4 文件），均在 commit 前按字节剥离，HEAD 对比确认非历史遗留
- 独立 subagent 审查：见 `review_report_review06_fixes.md`，❌ 项 0
- 静态核验：前端 `envelope.runId` 仅用于 seq 连续性检测与消息匹配（agent-stream-receiver.ts:109-137），goal 事件按 payload 字段路由（chat-store index.ts:442-465），runId 格式变更无消费方影响

## 补充验证（plan-2 运行时真实性与评估强化，2026-08-22）

commit `7a23d6f`（用户实测 4 问题）：

- C# `dotnet build` 0 警告 0 错误；TS 三配置全零错误
- 步骤1：confirm 工具路径补发 started/running 事件；StartAsync 事件移至 StartOrResumeRun 之后（首发事件 runState=running）
- 步骤2：面板头部徽章 terminal 用 DB 徽章、其余按 runState 渲染（新增 goal.status.idle zh/en）；计划卡片 active+非 running 显示 interrupted
- 步骤3：分解提示词禁止单探索计划；任务执行要求逐条 Verification: PASS/FAIL(evidence)；评估器无证据判不满足；任务结果截断 500→2000
- BOM：7 个触碰文件全部被 Edit 工具注入，已剥离后复验编译

## 补充验证（plan-2 步骤5：任务结果回传规范化，2026-08-22）

参照 DeepSeek-Reasonix task.go/evidence 设计（用户拍板方案 B）：

- C# `dotnet build` 0 警告 0 错误（BOM 剥离前后各验一次）
- 5a 去截断：ExecuteTaskAsync 完整结果入 PlanExecutionResult.Summary → goal_plan_tasks.summary / goal_execution_runs
- 5b head+tail：GoalOrchestratorLLM.HeadTail(12000) 保留报告首尾（Verification 行在尾部永不丢），替代头部 Substring
- 5c EvidenceDigest：AgentRuntimeRunState.GoalEvidenceSink（新）← SubAgentExecutor 从 collector.ToolCallSummaries 喂收据 → GoalTaskEvidence.ToDigest()（mutations/reads 分组、40 行上限）→ PlanExecutionResult.EvidenceDigest → 评估提示词"Host-observed evidence"段；评估提示词新增规则 5（宿主证据与自报矛盾时信宿主）
- AOT：GoalTaskEvidence 纯内存对象无序列化，无需 JsonContext 注册

## 补充验证（plan-3：自由编排 + 后台优先重构，2026-08-22）

用户定位修正：Goal = 纯后台自治任务，面板 = 按需查询器（轮询可、推送不要），计划/任务随执行自行调整。

- C# `dotnet build` 0 警告 0 错误；TS 三配置全零错误（BOM 剥离前后各验一次）
- 后端：新 GoalOrchestratorAdaptive.RunAdaptiveAsync — 不预分解计划，每步 DecideNextActionAsync（execute/complete/failed JSON 决策）；单合成计划"Adaptive execution"兼容现有 DB 三层表与面板查询；复用 ExecuteTaskAsync（Verification 行）+ 429 退避 + ReachSafePoint 暂停/取消；决策连续失败 3 次熔断；24 步上限；步骤历史 HeadTail(3000/条) 回喂
- RunAsync 路由到自适应循环；旧固定管线改名 RunLegacyFixedPipelineAsync 标注 superseded 保留（iter-20 清理）
- 前端去推送：SubAgentExecutor goal 运行时不再转发任何事件（goal_activity 断供）；chat-store 移除 goal_activity 路由；面板移除实时活动流块 + 死代码清理；轮询 10s→5s 仅选中运行中时

## 补充验证（plan-3 追加：1s 内存 live 轮询，2026-08-22）

用户要求：面板轮询查内存而非 DB。

- 后端：GoalContext.AdaptiveLive（GoalAdaptiveLiveState，纯内存）← RunAdaptiveAsync 每步 SetCurrent/AddStep；GoalOrchestrator.GetLiveSnapshot；GoalModule 新端点 goal/live（GoalLiveResponse + JsonContext 注册，AOT 合规）
- 前端：goal/live msgpack 通道（main 桥接 + binary-ipc 常量）；goal-history-store.liveByGoal + loadGoalLive；面板选中运行中 goal 时 1s 拉 live 快照（当前动作 + 步骤列表倒序渲染），DB 轮询降为 15s 兜底
- C# build 0 警告 0 错误；TS 三配置全零错误；BOM 已剥离

## 补充验证（plan-4：长时自治化，2026-08-22）

用户定位再修正：Goal = 可跑几天的自治子 agent，基础设施失败永不判死。

- C# `dotnet build` 0 警告 0 错误（BOM 剥离前后各验一次）
- 无限重试：删 AdaptiveMaxSteps 步数上限与决策熔断；决策失败指数退避 2s→…→600s 封顶、成功归零；429 保持共享退避（不占重试计数）；终止条件收敛为 LLM 自主 complete/failed 或用户 abort
- 提醒制防打转：连续 5 次标题归一化相同且全部失败 → RenderStepLog 注入 system-reminder 让 LLM 自行换方法/拆细/宣告失败；成功中的重复不算打转
- 里程碑时间线：每 5 个成功步骤写一条 goal_event（eventType=goal_milestone，聚合近 5 步标题），复用现有 goal_events 表与面板时间线
- 决策提示词补长时运行语义（瞬态失败由宿主处理勿重启已完成工作）

## 补充验证（全面审查修正，2026-08-22）

独立 subagent 全链路审查后修复（P0×2 + P1×2）：

- **P0 429 结果丢弃**：execute 遇 429 时子 agent 已真实执行（有副作用），原代码只退避不记录 → 决策器看不到该次尝试导致重复执行。现在 429 尝试照常入 log/live/DB（标记 INTERRUPTED），退避后重新决策时能看到完整历史
- **P0 429 语义错位**：429 检测在执行完成后才判定（子 agent 跑完才告知限流）。根治需 provider 层短路（大改），本轮先保证结果不丢；provider 层短路列入 iter-20
- **P1 JSON 取块顺序**：JsonCandidates 从左到右取第一个，reasoning 模型的 thinking JSON 在前会被误取。改为取**最后一个**含合法 action 的块（最终决策在末尾）
- **P1 MaxTurns=2 饿死 reasoning 模型**：结构化子 agent 2 轮上限，reasoning 模型首轮 thinking 无文本输出 → "completed but produced no output"。提到 6 轮
- P2 采纳：execute 缺 description 时 fallback 截断 2000 字符；提示词示例加"勿照抄"语境（随 few-shot 重写已覆盖）
- P2 记录待办：FailAdaptive 的 failed-but-active 面板语义、评估器死代码清理、provider 层 429 短路 → iter-20

## 运行时验证（待用户实测）

以下需要真实模型调用，无法自动完成，留待用户人工验证：

1. 启动应用 → 创建一个 Goal（含可自检的计划）→ Goal 历史面板选中该 goal
2. 计划卡片点击展开：应显示每轮记录（轮次/状态/耗时/评估理由），进行中 goal 每 10s 刷新
3. 触发一次 retry/adjust：确认多轮记录归到同一计划卡片（链根 planId 匹配），adjust 轮带"已调整"标记
4. 旧 goal（0.2.18 及之前）：展开显示"暂无每轮执行记录"占位，不报错
5. 步骤7：计划生成后（decomposer 拆分完成）面板应立即出现计划列表，而非整轮执行完才可见
6. 步骤8：计划卡片展开后应实时滚动显示子 agent 工具调用/结果/迭代条目；控制台 seq 不再疯狂增长（text_delta 已降噪）

## 结论

- 编译验证：PASS
- 运行时验证：**待用户实测**（VERDICT 由老大裁定）
