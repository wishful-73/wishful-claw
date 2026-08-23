# Review Report — v2-iter-19

审查时间：2026-08-20　方式：逐文件代码审查（对照 AGENTS.md 分层与拆分规则）

## 审查项

| 项 | 结果 | 说明 |
|----|------|------|
| 分层约定 | ✅ | 表/实体/查询在 Infrastructure/Db；写入封装在 Agent/Goal；前端在 stores/components/goal。Agent→Infrastructure 依赖方向与既有 SyncGoalToDb 一致 |
| 硬编码/密钥 | ✅ | 无。表名/字段名为常量字符串，与既有代码风格一致 |
| 参考源码逻辑适配 | ✅ | 自研需求；沿用 goal_events 既有链路模式（DbModule 注册 → main IPC → shared 常量 → store） |
| 错误处理 | ✅ | GoalPlanRecorder 全部 try/catch + WorkerLog.Warn，DB 记录失败不阻断编排（md 落盘仍为主记录）；ListPlanTasks 端点有 catch 返回 WorkerResponse.Error |
| 不必要依赖 | ✅ | 无新增 NuGet/npm 依赖 |
| 大文件拆分 | ✅ | 新逻辑在新文件（DbGoalTaskTools.cs 127 行 / GoalPlanRecorder.cs 69 行）；GoalOrchestratorLoop.cs 仅 +8 行（470→478） |

## 审查发现并已修正

1. **❌→✅ 轮次分组缺陷**：adjust 会更换 planId（OriginalPlanId 指向最初 id），原 filter `task.planId === plan.planId` 会导致 adjust 前的轮次（round 1）与摘要卡片对不上。已修正为按"链根 planId"匹配（`originalPlanId ?? planId`），并在 GoalPlanSummary 补充 originalPlanId 字段（plansJson 序列化 WhenWritingNull，字段存在时可见）。
2. **✅ store 对象成员缺逗号**：补丁插入时产生 TS1005，已修正。

## 遗留风险（低）

- 旧版本 Goal（本迭代前创建）无 goal_plan_tasks 记录，展开显示占位文案——符合预期设计。
- 进行中 goal 的面板轮询为 10s 间隔 force 刷新，事件流已有类似模式，无性能顾虑（仅选中 active goal 时轮询）。

❌ 项计数：0 → 允许进入验证态
