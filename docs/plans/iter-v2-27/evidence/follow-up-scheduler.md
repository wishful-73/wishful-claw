# FU-C 临时跟进调度证据

## 实现边界

- `session_follow_ups` 是独立持久化表，不创建 `global_tasks` 或 `global_task_dispatches`。
- Main 调度器通过 Worker DB endpoint 恢复 `waiting` 记录，到点使用 claim token 原子领取，再经 MessagePack `session-follow-up:fire` 投递到 Renderer。
- Renderer 安装 `agentStream.subscribeAll` 和 follow-up fire listener 后，通过 `session-follow-up:renderer-ready:msgpack` 通知 Main 才触发恢复，避免启动竞态。
- 来源 session 忙时按 30 秒重排；Renderer 不可用时按 30 秒重排；triggered claim 通过 5 分钟 lease 恢复。
- follow-up 查询只唤醒 source session，不重复发送原始任务。Agent 使用 `update_session_follow_up` 的 `complete`、`reschedule`、`fail` 三种 action 闭环。
- Todo 完成/失败与 follow-up 终态在 Worker SQLite 事务内同步更新；删除 Todo 或 session 会取消未完成 follow-up。
- 应用内 desktop 与渠道 channel 通知分别记录。渠道 ack 仅在现有 `plugin:exec/sendMessage` Promise 成功后写入；发送失败保留日志且不写成功标记。

## 验证结果

- `npm run test:session-follow-up`：20 项静态 Main/Renderer 集成断言通过。
- `dotnet run --project tests/WishfulClaw.SessionTaskCascadeRegressionTests/WishfulClaw.SessionTaskCascadeRegressionTests.csproj`：180 项通过，覆盖建表、索引、幂等创建、单飞 claim、重排、恢复、取消、Todo 原子状态更新及 global 表数量不变。
- `npm run typecheck:web`：通过。
- `npm run typecheck:node`：通过。
- `npx tsc --noEmit -p tsconfig.json`：通过。
- `npm run build`：通过；仅有既存 Vite 动态/静态 import 提示。
- `npm run build:worker:prod`：AOT Worker 发布通过；无编译错误、IL2026/IL3050/IL3051 警告。
- `git diff --check`：通过。

## 未覆盖的人工验证

- 真实 Electron UI 中 source busy、重启恢复、渠道实际回推与重复到期事件的端到端点击/截图验证，需在发布前由 FU-E 执行。
