# v2-iter-12：Goal 系统全面修复 — 自动编排 + 中断重启


**目标**：全面修复 Goal 执行链路，让 Goal 真正能"自动编排、可暂停/恢复、进程重启后自动续跑、不丢进度"。一次性解决当前 Goal 系统"创建后不推进、重启后接不上、UI 与底层状态不匹配"的多重问题。

**背景**：当前 Goal 系统存在 4 层独立状态存储，Orchestrator 状态纯内存导致 6 个断点：goalId 不一致、无恢复机制、Resume 不认 DB、RunAsync 不能续跑、前端 Resume 空壳、进程重启后无自动恢复入口。

**详细设计**：`docs/plans/iter-v2-12/plan.md`

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | goalId 对齐 — `StartAsync` 增加 goalId 参数，不再生成新 ID，确认后 DB 与 ActiveGoals 用同一 ID | `GoalOrchestrator.cs`、`AgentRuntimeGoalExecutor.cs` |
| 2 | 新增 `ResumeFromDb` — 从 DB 读回 goal 构建 GoalContext 并启动 RunAsync；`Resume` 找不到时回退到它 | `GoalOrchestrator.cs` |
| 3 | `RunAsync` 支持续跑 — 已有 plans 时跳过分解，从 currentPlanIndex+1 续跑 | `GoalOrchestratorLoop.cs` |
| 4 | Worker 启动自动恢复 — 扫描 DB 中 active/paused 的 goals，恢复编排 | `GoalModule.cs` |
| 5 | 前端 Resume 修正 — 移除对空实现 `dispatchNextQueuedMessageForSession` 的依赖 | `goal-session-views.tsx` |

**验证标准**：
1. 编译通过（C# 0 错误，TypeScript 3/3 配置 0 错误）
2. 创建并确认 goal 后 Orchestrator 自动分解并执行 plans
3. 编排运行时 Pause 暂停循环，Resume 继续循环
4. 进程重启后正在执行/暂停的 goal 自动恢复续跑，不重复分解，从断点继续
5. DB goalId 与 ActiveGoals key 一致
6. 已有的 active goal 通过恢复机制续跑，无需重新创建

**分支**：`dev/v2-iter-12`　**产品版本**：`0.2.12`　**Tag**：`v0.2.12`
