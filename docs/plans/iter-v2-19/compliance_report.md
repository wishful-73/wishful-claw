# Compliance Report — v2-iter-19 Plan

检查时间：2026-08-20　检查方式：基于探索态代码证据的规范核对

| 检查项 | 结果 | 说明 |
|--------|------|------|
| 步骤是否完整覆盖任务目标 | ✅ | 表结构 → 编排写入 → 端点 → 前端查询 → UI 展开 → 回归验证，链路完整；覆盖排期"每轮计划及执行详情" |
| 每步是否有明确验证检查点 | ✅ | 步骤1-3 dotnet build；步骤4-5 tsc 零错误；步骤6 三配置 + 运行证据 |
| 文件路径是否符合 AGENTS.md 结构 | ✅ | Db 迁移/Entity 归 Infrastructure/Db；编排写入归 Agent/Goal；前端归 stores/components/goal |
| 分层依赖是否正确 | ✅ | Agent → Infrastructure（DbGoalTools）为既有合法方向；Contracts/Core 不受影响 |
| 是否参考了正确的源码文件 | ✅ | 参考本项目 DbGoalTools/goal_events 既有链路；OpenCowork 无对应实现，已在计划中注明 |
| 大文件拆分规则 | ✅ | 新写入口封装到新文件 GoalPlanRecorder.cs / DbGoalTaskTools.cs，不膨胀 GoalOrchestratorLoop.cs（现 470 行）与 DbGoalTools.cs |

关键依赖核实（探索态证据）：
- `GoalOrchestratorLoop.SyncGoalToDb` 已示范 Agent 层直接静态调用 `DbGoalTools.Update(JsonElement)` 模式 → 步骤2 的 GoalPlanRecorder 写入方案可行 ✅
- `DbClientGoalMigrations.cs` 为 partial class 且含既有 CREATE TABLE IF NOT EXISTS 模式 → 步骤1 迁移方案可行 ✅
- GoalHistoryPanel 已有 plans 摘要区与事件分页加载模式（loadMoreGoalEvents）→ 步骤4/5 可复用既有 store 模式 ✅

偏离排期说明：
- 排期提"goal_orchestrations + goal_plan_tasks 两张表"，计划改为单表 goal_plan_tasks。理由：编排轮次与计划执行记录是同一实体（一行 = 一个计划的一轮），拆两表会导致其中一表语义空洞/纯冗余外键。此为设计决策，需老大在确认时认可。

❌ 项计数：0 → 允许进入用户确认环节

**待用户确认事项**：
1. 计划整体方向与范围（6 个步骤）
2. 单表设计（偏离排期的两表方案）
