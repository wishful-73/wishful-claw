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
