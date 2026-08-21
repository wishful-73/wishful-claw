# Review Report — v2-iter-19 追加功能单元：review-06 Goal 审查修复

审查时间：2026-08-21　方式：独立 subagent 逐项审查 commit `1af53c1` + 主会话复核
审查对象：docs/reviews/review-06-goal.md GL-1~GL-16 共 16 条修复

## 六项审查结果

| 项 | 结果 | 说明 |
|----|------|------|
| 修复完整性 | ✅ | 16 条全部落地；GL-6 附带发现 pending 路径 runId 双重前缀（见下） |
| 分层约定 | ✅ | 改动均在 Agent 层；新增 using WishfulClaw.Core.Protocol 合法；无逆向依赖 |
| 硬编码/密钥 | ✅ | 无新增；GL-12 的 36 已改为常量派生 MinutePollingMaxAttempts |
| 错误处理 | ⚠️→✅ | PersistTerminalState 外层 try-catch 为假兜底（内层已 catch），已删；GL-11 锁范围补 scope 注释说明文件与 DB 是独立 best-effort 通道 |
| AOT 兼容 | ✅ | 无反射、无匿名类型序列化、无新增未注册 JsonTypeInfo |
| 行为回归风险 | ✅ | 死代码删除无调用方；UpdateField 为纯加强；StartPlan 状态行改 plan.Status 与调用方置 Active 语义等价 |

## 审查发现并已修正

1. **⚠️→✅ runId 双重前缀**：`EmitPendingGoalAsync` 与 `GetOrCreateEventRunState` 均用 `$"goal-{goalId}"` 拼接，而 goalId 本身已含 `goal-` 前缀，产生 `goal-goal-<guid>`。审查 subagent 判定为阻断级（pending/active 流不匹配），主会话复核确认**两侧公式一致故流身份实际一致**，且前端按 payload 字段路由 goal 事件、不消费信封 runId——非行为 bug。但格式确实误导，已统一为直接使用 goalId 作为 runId（两处同步修改，pending→active 身份保持连续），并补注释。
2. **⚠️→✅ 假兜底 try-catch**：PersistTerminalState 外层 catch 永不命中（WriteGoalState 内部已全量 catch+Warn），已删除并注明双通道独立性。
3. **⚠️→✅ GL-11 锁范围语义**：GoalStateFileSync 仅护 state.json 读改写；SyncGoalToDb 有意留在锁外。补注释明确"文件归档与 DB 归档是两条独立 best-effort 通道，不要求事务一致"。

## GL 条目核验表

| GL | 状态 | 备注 |
|----|------|------|
| GL-1 | ✅ | completedPlans / GetActiveGoalId 均走常量 |
| GL-2 | ✅ | 长驻 EventRunState + CompareExchange 创建 + 三处 TryRemove 挂 Dispose；runId 规范化 |
| GL-3 | ✅ | 图标映射走 GoalPlanStatusValues |
| GL-4 | ✅ | ExecutePlanAsync + BuildPlanExecutionPrompt 已删 |
| GL-5 | ✅ | Tracker 三方法 + WriteGoalState 全部 best-effort |
| GL-6 | ✅ | GoalIds 工厂收敛 7 处生成点（含报告未列的 LLM.cs:58）；runId 复用 goalId 不再拼接 |
| GL-7 | ✅ | DelayInterruptibleAsync 1s 切片；取消即时；耗时 Stopwatch 实测 |
| GL-8 | ✅ | 工具路径补发 run-state；HTTP 路径未动，无双发 |
| GL-9 | ✅ | 两处 emit 失败均 Warn |
| GL-10 | ✅ | BackoffTimedOut 独立事件类型 |
| GL-11 | ✅ | 文件锁 + 范围语义注释 |
| GL-12 | ✅ | MinutePollingMaxAttempts 派生 |
| GL-13 | ✅ | UpdateField 全行替换 + 缺失追加 |
| GL-14 | ✅ | paused→Active 恢复语义注释 |
| GL-15 | ✅ | 线性扫描有意为之注释 |
| GL-16 | ✅ | 公共 StripCodeFence 替代三处复制 |

❌ 项计数：0 → 允许进入验证态
