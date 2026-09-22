# v2-iter-19：Goal 编排记录可视化


**目标**：Goal 自动编排过程记库，右侧面板可查看每轮计划及执行详情。当前 Goal 运行只能看最终结果，编排过程是黑箱。

**背景**：涉及数据库新建表 + 运行时记录 + 前端面板，范围较大。原计划在 v2-iter-16，因实际优先级调整推后。

| 步骤 | 内容 | 文件 |
|------|------|------|
| 1 | DB 建表 — `goal_orchestrations`（编排记录：goalId/sessionId/createdAt/status）+ `goal_plan_tasks`（计划任务：orchestrationId/planIndex/title/status/result/startedAt/completedAt） | `Infrastructure/Db/DbClient.cs` |
| 2 | 后端记录 — GoalOrchestrator 每轮分解/执行/验证时写入 `goal_orchestrations` 和 `goal_plan_tasks` | `Agent/GoalOrchestrator*.cs` |
| 3 | IPC 端点 — `goal:list-orchestrations` / `goal:get-orchestration-detail` 分页查询编排记录 | `Agent/Modules/GoalModule.cs` |
| 4 | 前端面板 — RightPanel 新增 Goal 编排记录 tab，展示编排列表 + 点击查看计划步骤详情 | `renderer/src/components/goal/GoalOrchestrationPanel.tsx` |
| 5 | 实时更新 — Goal 运行时面板实时更新当前编排状态 | 同上 |
| 6 | 历史查看 — 已完成的 Goal 也能查看编排记录 | 同上 |

**验证标准**：创建并运行 Goal → 右侧面板 Goal 编排 tab 实时显示编排进度 → 每轮计划标题、状态、执行结果可见 → Goal 完成后可回看完整编排历史。

**分支**：`dev/v2-iter-19`　**产品版本**：`0.2.19`　**Tag**：`v0.2.19`
