# v2-iter-27 探索记录

> 阶段：探索态
> 日期：2026-09-09
> 基线：`v0.2.26` / `main` commit `59d86e6209c4621fe646d108995bae8233b257f1`
> 开发分支：`dev/v2-iter-27`

## 1. 工作流与仓库状态

- 已读取 `docs/dev-workflow.md`，本迭代遵循六阶段：探索 → 规划 → 规划验证 → 执行 → 审查 → 验证。
- 当前工作区在 `dev/v2-iter-27`，工作区干净。
- `main` 与 `origin/main` 均指向 v0.2.26 收尾提交；iter-27 分支从该基线切出，当前只有迭代开工协议相关文档提交。
- `docs/PROGRESS.md` 当前最新记录为 v2-iter-26 / v0.2.26。
- 协议要求读取的 `docs/data-storage.md`、`docs/mvp-scope.md`、`docs/iteration-plan.md` 当前不存在；本计划以 `docs/dev-workflow.md`、`docs/PROGRESS.md`、`docs/progress/v2-iter-26.md`、iter-26 计划/报告和代码现状为依据。

## 2. 知识库输入

知识库路径：`D:\koda\Obsidian\02-AI教学\wishfulclaw`

- `issues/bugs.md` 当前仅保留 1 个未修复缺陷：扩展下自动化、任务面板等子项进入后，点击其他子项无法切换。
- `issues/改进.md` 当前保留 3 项：
  1. 更新弹窗扩大并支持全屏阅读；
  2. 全局会话/任务追踪，任务发出后自动跟进结果；
  3. 多服务商限额自动切换。
- `issues/历史记录.md` 表明 iter-26 已完成渠道会话、飞书绑定、服务商预设、OpenCode Go header、项目变更面板和服务商双页签等前序工作。
- `docs/progress/v2-iter-26.md` 明确将“更新板块真机升级验证”移交 iter-27。

## 3. 扩展导航现状

相关文件：

- `src/renderer/src/components/layout/WorkspaceSidebar.tsx`
- `src/renderer/src/stores/ui-store.ts`
- `src/renderer/src/components/layout/MainLayout.tsx`

已核验事实：

- Sidebar 的扩展项为 `draw`、`automation`、`taskboard`，分别调用 `openDrawPage`、`openTasksPage`、`openTaskBoardPage`。
- `ui-store.ts` 当前使用 `drawPageOpen`、`tasksPageOpen`、`taskBoardPageOpen` 三个独立布尔状态，各 `openXxxPage()` 只把自己的状态置为 `true`。
- `MainLayout.tsx` 按固定顺序判断这些开关；前一个页面开关仍为 `true` 时，会遮挡后续页面。
- 最小修法是引入单一活动扩展页状态，或让打开操作互斥；计划优先选择单一状态模型，但需保留兼容现有调用方的关闭入口。

## 4. 会话 Todo 现状

相关文件：

- `src/renderer/src/stores/task-store.ts`
- `src/renderer/src/stores/task-store-helpers.ts`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbTaskTools.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/TaskEntity.cs`
- `src/renderer/src/lib/agent-runtime-sync.ts`

已核验事实：

- 会话 Todo 使用 `tasks` 表，按 `session_id` 查询并持久化。
- Renderer 已有 `tasksBySession` 缓存、`loadTasksForSession`、`addTask`、`updateTask`、删除和同步事件处理。
- Todo 状态已有 `pending`、`in_progress`、`completed`、`blocked` 等语义，并带排序、依赖、描述、负责人、元数据等字段。
- Agent runtime 同步目前覆盖 task add/update/delete；会话切换时能恢复当前会话 Todo。
- 当前 Todo 模型没有“目标会话”“下次跟进时间”“跟进状态”等临时跨会话跟进字段。
- 因此临时倒计时应新增独立的轻量跟进持久化记录/服务，而不是把全局任务字段塞进 `tasks` 表，也不是把简单任务复制为全局任务。

## 5. 现有临时调度基础

相关文件：

- `src/main/ipc/reverse-handlers/cron-reverse-handler.ts`
- `src/main/ipc/reverse-handlers/cron-execution-coordinator.ts`
- `src/renderer/src/lib/tools/cron-runtime.ts`
- `src/runtime/WishfulClaw.Agent/Tools/Providers/CronToolProvider.cs`

已核验事实：

- Main 侧已有内存 Map、`setTimeout`、`setInterval`、node-cron 和持久化恢复机制。
- Main 侧已有 `CronRunLock`、fireId 去重、运行状态保存和 `cron:fire` 事件。
- Renderer 侧已有 `initializeCronRuntime`，可以通过正常会话消息或 sidecar Agent 执行任务，并能向 session/plugin 投递结果。
- 现有 Cron 面向用户可见的长期/重复自动化任务，数据结构和 UI 较重；临时 Todo 倒计时不应直接复用整套 Cron UI。
- 但其 Main 调度、持久化恢复、单飞锁、事件投递和渠道发送路径可作为实现临时跟进器的基础参考，计划要求抽出可复用的调度能力，避免复制定时器可靠性逻辑。

## 6. 简单跨会话临时跟进路径

现有普通跨会话发送入口：

- `src/renderer/src/lib/tools/project-send-message.ts`
- Agent 工具入口为 `send_session_message`。

已核验事实：

- `handleProjectSendSessionMessage` 会确保目标 session 已加载到 Renderer store，然后通过正常 `sendMessage` pipeline 异步发送。
- 该入口返回“已发送、目标会话正在处理”，不等待目标会话完成；这正适合“让 A 项目会话汇总文档，几分钟后当前会话再查询”的临时任务。
- 该路径当前没有返回一个可供后续查询的跟进 ID，也没有持久化 source session / target session / Todo / follow-upAt 关联。
- 计划会在不改变普通 `send_session_message` 语义的前提下，为临时任务增加显式跟进记录和查询入口；不能把它改成 `send_work_request`。

## 7. 全局任务与 dispatch 现状

相关文件：

- `src/renderer/src/stores/task-board-store.ts`
- `src/renderer/src/components/taskboard/task-board-types.ts`
- `src/runtime/WishfulClaw.Agent/Tools/Providers/GlobalTaskToolsProvider.cs`
- `src/runtime/WishfulClaw.Agent/AgentRuntimeGlobalDispatchReplyExecutor.cs`
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/GlobalTaskDispatchEntity.cs`

已核验事实：

- `global_tasks` 与 `global_task_dispatches` 已有完整的创建、更新、取消、查询和任务面板展示基础。
- dispatch 已保存 `source_session_id`、目标 `session_id`、`latest_report`、状态、完成时间和错误信息。
- `reply_global_dispatch` 会校验调用者必须是目标 session，写回 dispatch 结果，并通过 `project/send-session-message` 将结果投递到 source session。
- 该回传路径已经是“目标项目会话完成 → 全局任务记录更新 → 唤醒来源全局会话”的历史实现，不应被临时 Todo 路径替代。
- 复杂任务仍然直接使用 `create_global_task` + `send_work_request` + `reply_global_dispatch`；不经过会话 Todo 升级步骤。

## 8. 任务体系目标边界

本迭代确认采用两条既有路径：

```text
简单临时跨会话任务：
当前会话 → send_session_message → 会话 Todo + 临时倒计时
           → 到点唤醒当前会话 Agent 查询目标会话
           → 完成 Todo / 反馈用户或渠道

复杂全局任务：
全局会话 → create_global_task → send_work_request
          → 目标会话 reply_global_dispatch
          → 更新 global task/dispatch
          → 唤醒来源全局会话 / 回推渠道
```

关键边界：

- 跨会话不等于全局任务。
- 临时倒计时是跟进机制，不是第三种任务类型。
- 简单任务不创建 `global_tasks` 或 `global_task_dispatches`。
- 复杂任务不先创建临时 Todo 再升级，而是直接走全局任务路径。
- 临时倒计时到点后按用户确认的方案自动唤醒来源 Agent 查询，不只是给用户提示。

## 9. 多服务商 fallback 现状

相关文件：

- `src/runtime/WishfulClaw.Agent/ProviderRetryPolicy.cs`
- `src/runtime/WishfulClaw.Agent/AgentLoop*.cs`
- `src/runtime/WishfulClaw.Agent/Providers/*`
- `src/shared/types/provider.ts`
- `src/renderer/src/stores/provider-store.ts`
- `src/renderer/src/stores/quota-store.ts`
- `src/renderer/src/components/settings/ProviderPanel.tsx`

已核验事实：

- `ProviderRetryPolicy` 已实现当前 Provider 内的 429/400/5xx/超时重试、指数退避、Retry-After、取消令牌和 `requestMaxRetries` 配置。
- `requestMaxRetries=0` 当前表示无限重试；用户已确认该语义保持严格无限，不触发 fallback。
- `AIProvider` 当前没有 fallback 排序、fallback 开关或统一限额状态字段。
- `quota-store.ts` 明确写着“no backend quota system yet”，不能假定已经存在可复用的配额监控后端。
- Provider 设置已有 Provider 列表和模型管理双页签，可作为排序/状态配置入口。
- 本迭代规则是：当前 Provider 先按现有重试策略重试；有限重试达到上限后才切下一个 Provider；下一次新请求重新从首选开始；同一逻辑请求中不得循环切换；取消后不再切换。
- 不同服务商的 5 小时/周限额格式不统一；本迭代不要求提前解析并切换，统一按现有重试策略执行，达到有限上限后再切换。解析到的配额信息只能作为状态/日志增强，解析不到不能阻塞 fallback。

## 10. 主要风险与依赖

1. 临时跟进自动唤醒会复用 Agent run 生命周期，必须防止与同一来源会话正在进行的用户回合并发；忙时应延迟/重排，而不是打断当前回合。
2. 临时跟进结果查询需要可靠区分目标会话“仍运行 / 已完成 / 失败 / 不存在”，不能只依赖当前 Renderer 是否挂载目标页面。
3. 应用重启后 Main 调度器必须恢复未到期跟进，且需防止到期事件重复唤醒。
4. 渠道回推需要复用现有渠道发送路径；发送失败不能被当作任务完成。
5. 全局 dispatch 回传已经是运行中路径，iter-27 只补来源会话唤醒与任务追踪衔接的缺口，不重写全局任务状态机。
6. Provider fallback 涉及 C# Agent Loop、Provider 请求上下文、IPC payload、Renderer 配置和 AOT 序列化，必须先建立纯函数/状态机回归，再接运行时。
7. 更新真机升级依赖旧版本安装包、GitHub Release 资产和用户手动确认；不能用代码走查替代。

## 11. 不纳入本迭代

- v3 快速启动器插件化、URL 插件、ZIP 轻应用、QwenASR。
- Windows 发布者签名与发布自动化。
- 已在历史记录标记完成的 iter-26 事项。
- ToolRegistry 大小写兼容性、Task 子 Agent fast-model header、OpenAIChat providerId/id 命名整理等 iter-26 备查项。
