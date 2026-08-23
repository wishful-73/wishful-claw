# Plan: v2-iter-19 — Goal 编排记录可视化

## 目标

Goal 编排过程结构化记库（新增 goal_plan_tasks 表），Goal 右侧历史面板可查看每个计划的每轮执行详情（执行/评估/重试/调整记录），不再依赖工作文件夹里的 md 文件。

## 现状（探索结论）

- `goals` 表已有 `PlansJson`（摘要级：planId/title/description/status/retryCount/resultSummary），GoalHistoryPanel 已展示摘要列表
- `goal_events` 表有事件时间线（PlanCompleted/PlanFailed/PlanRetried/PlanAdjusted），但只有 message 文本
- 每轮执行详情（steps、评估 reasoning、adjusted description）仅由 `GoalPlanTracker` 写入工作文件夹 `.wishful-claw/goals/{goalId}/plans/{planId}.md`，DB 无结构化记录：
  - 换工作文件夹/清理文件后记录丢失
  - 前端无查询通道，面板看不到"每轮"细节
- 写入点集中在 `GoalOrchestratorLoop.cs`：StartPlan(执行前) / FinishPlan(完成/失败) / AppendLog(重试/调整/退避)

## 设计决策

- 排期原文提"goal_orchestrations + goal_plan_tasks 两张表"；探索后判定**一张 `goal_plan_tasks` 表即可**覆盖需求（每行 = 某计划的一轮执行记录），避免"两表但其中一表语义空洞"的过度设计。字段：
  - id (INTEGER PK AUTOINCREMENT)
  - session_id, goal_id, plan_id (原 planId), original_plan_id (adjust 后溯源), plan_title
  - round (第几轮，从 1 起，retry+1)
  - status: executing | completed | failed
  - description (本轮实际执行的描述，adjust 后为新描述)
  - steps_json (本轮步骤列表，可空)
  - summary (执行结果摘要)
  - evaluation_reasoning (自检评估理由，可空)
  - evaluation_satisfied (0/1，可空)
  - adjusted (0/1，是否为调整轮)
  - started_at, finished_at
- 写入与 GoalPlanTracker 落盘**并行**（文件继续写，DB 作为结构化镜像），不改现有 md 机制，风险最小
- 查询端点：`goal_plan_tasks: list`（按 goalId，round 正序），走既有 DbGoalTools + sidecar IPC 通道
- 前端：GoalHistoryPanel 计划卡片点击展开，显示每轮执行记录（轮次/状态/耗时/评估理由/调整说明）；进行中 goal 也实时可见（loadMore 时刷新）

## 步骤清单

- [✓] 步骤1：DB 迁移 + Entity + 查询/写入工具 — Infrastructure 层
  - `DbClientGoalMigrations.cs` 加 CREATE TABLE IF NOT EXISTS goal_plan_tasks + 索引 (goal_id, round)
  - `Entities/GoalEntity.cs` 加 GoalPlanTaskEntity + GoalPlanTaskRow DTO
  - `DbGoalTools.cs` 新增 ListPlanTasks / InsertPlanTask / UpdatePlanTask（partial 新文件 `DbGoalTaskTools.cs`，避免现有文件膨胀）
  - 验证：`dotnet build` 0 错误
- [✓] 步骤2：编排循环写入 — Agent 层
  - `GoalOrchestratorLoop.cs`：StartPlan 处 insert executing 行（记录 round/description/steps）；完成/失败处 update 为终态（summary/evaluation）；retry/adjust 处更新当前行并下一轮 insert 新行；429 退避处 append 事件不建新行
  - 轮次计数：plan.RetryCount + 1；adjust 后 planId 变化时记录 original_plan_id
  - 验证：`dotnet build` 0 错误
- [✓] 步骤3：sidecar 端点注册
  - 按现有 `goal_events` list 的通道模式注册 `goal_plan_tasks` list 到模块分发（Worker/Agent Runtime Tools）
  - 验证：`dotnet build` 0 错误；grep 确认路由注册
- [✓] 步骤4：前端查询层
  - goal-history-store（或新 hook）增加 loadGoalPlanTasks；类型定义 GoalPlanTask
  - 验证：`npx tsc --noEmit -p tsconfig.web.json` 零错误
- [✓] 步骤5：GoalHistoryPanel 计划详情展开 UI
  - 计划卡片点击展开：每轮记录（轮次徽标/状态/耗时/评估理由/执行摘要/调整标记）；空数据显示占位（旧 goal 无记录属正常）
  - i18n zh/en 文案
  - 验证：tsc 三配置零错误
- [✓] 步骤6：回归验证 + 实测引导
  - C# build + TS 3/3 零错误
  - 启动应用，跑一个 Goal，验证面板能看到每轮记录（日志截图/DB 查询证据）

## 涉及文件

- src/runtime/WishfulClaw.Infrastructure/Db/DbClientGoalMigrations.cs — 修改（加表）
- src/runtime/WishfulClaw.Infrastructure/Db/Entities/GoalEntity.cs — 修改（加 Entity/Row）
- src/runtime/WishfulClaw.Infrastructure/Db/DbGoalTaskTools.cs — 新建
- src/runtime/WishfulClaw.Agent/Goal/GoalOrchestratorLoop.cs — 修改（写入钩子）
- src/runtime/WishfulClaw.Agent/Goal/GoalPlanRecorder.cs — 新建（Agent 层写入封装，保持 Loop 文件不膨胀）
- src/renderer/src/stores/goal-history-store.ts — 修改
- src/renderer/src/components/goal/GoalHistoryPanel.tsx — 修改
- src/renderer/src/locales/{zh,en}/chat.json — 修改

## 参考源码

- 本项目既有模式：DbGoalTools / goal_events 端点链路（Infrastructure → Agent Tools → sidecar → renderer）
- OpenCowork：无直接对应实现（此为自研需求），仅参考其面板交互样式

## 补充（2026-08-20 用户实测反馈，并入本迭代）

实测问题：Goal 确认后面板黑盒 30 分钟，计划/轮次/过程全部执行完才可见；子 agent 工具活动无面板通道。

- [x] 步骤7：拆分即落库 — decomposer 拆完立即 SyncGoalToDb（plans 全量入库），面板立刻显示计划列表与"计划 1 执行中"
- [x] 步骤8：Goal 子 agent 事件携带 goal 上下文（goalId/planId/round），前端 goal 面板实时显示计划卡片内的工具调用活动流（工具名+输入摘要，滚动）
- [x] 步骤9：Goal 子 agent 流式降噪 — text_delta 不逐条转发前端（聚合或仅关键事件），消除 seq 疯狂增长与控制台刷屏
