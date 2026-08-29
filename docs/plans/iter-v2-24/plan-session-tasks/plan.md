# Plan: 会话级任务（Session Tasks）

> v2-iter-24 · Plan B（共 2 个 Plan：A 全局任务 / B 会话级任务）
> 实现方式参考 OpenCowork（`D:\koda\OpenCowork`），与 Goal 模式的 `goal_plans` / `goal_tasks` 表**完全无关**。

## 目标

会话级任务是 **agent 在会话中自行创建维护的临时任务队列**——用于拆解复杂请求、跟踪推进进度，会话结束/任务清空后不再占用。落地：独立 `session_tasks` 表 + 四个会话任务工具（`TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList`）+ system prompt 引导 + 前端展示。

## 需求决策记录（老大已确认，2026-08-29）

| 决策点 | 结论 |
|--------|------|
| 定位 | agent 自行创建、自行拆解、方便推进的临时队列（非用户手动创建） |
| 实现参考 | `D:\koda\OpenCowork` 的 tasks 表 + Task 工具链 |
| 数据结构 | 独立 `session_tasks` 表（`session_id` 外键，会话删除级联清理），与 Goal 表系零关系 |
| 工具命名 | `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList`（与现有子 Agent 的 `Task` 工具不冲突） |

## 步骤清单

- [ ] **步骤1：DB 层 — `session_tasks` 表 + Entity**
  - `DbClient.cs` 的 tableSqls 追加 `session_tasks` DDL（参考 OpenCowork tasks 表，简化版）：
    `id TEXT PK, session_id TEXT NOT NULL, subject TEXT NOT NULL, description TEXT DEFAULT '', active_form TEXT, status TEXT DEFAULT 'pending', sort_order INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER`
    + 索引 `ix_session_tasks_session(session_id)`；session 删除时级联清理
  - 新建 `Infrastructure/Db/Entities/SessionTaskEntity.cs`
  - 状态：`pending / in_progress / completed`（`TaskUpdate` 传 `deleted` 时物理删除）
  - 验证：`dotnet build` 零错误；冷启动建表正常

- [ ] **步骤2：会话任务工具（Agent 层）**
  - 新建 `Tools/SessionTaskTools/`：`SessionTaskCreateTool` / `SessionTaskGetTool` / `SessionTaskUpdateTool` / `SessionTaskListTool`，实现 `IToolExecutor`（对 agent 暴露名用 `TaskCreate` 等），注册进对应 Module
  - 工具经 `DbClient` 直读 `session_tasks`，自动绑定当前 `sessionId`；创建后返回全量会话任务列表（供 agent 感知全局进度，参考 OpenCowork `EncodeTaskCreateResult`）
  - AOT：序列化类型注册进 `JsonSerializerContext`（含 `List<SessionTaskRow>`）
  - 验证：`dotnet build` 零错误 + AOT 0 警告

- [ ] **步骤3：IPC 通道 + 渲染进程 store**
  - `messagepack-handler` 注册 `db:session-tasks:list/create/update/delete/delete-by-session` 通道，preload 暴露
  - 新建 `stores/session-task-store.ts`：按 session 加载/缓存（参考 OpenCowork `tasksBySession` 模式）、切换会话时加载、删除会话时清理
  - 验证：TS 三配置编译零错误

- [ ] **步骤4：前端展示（会话任务卡片）**
  - 聊天流中渲染会话任务卡片（参考 OpenCowork `TodoCard` / `StepsPanel` 的 TodoList）：进度条、每项状态图标、`in_progress` 项显示 `activeForm` 动效文案、可折叠
  - 工具调用产生的任务变更经流式事件同步卡片状态（复用现有工具结果渲染 + `session_task_changed` 事件）
  - 验证：会话中让 agent 拆解一个多步请求，卡片实时出现并随进度更新

- [ ] **步骤5：Prompt 引导**
  - PromptBuilder 增加 `<task_management>` 会话任务段（参考 OpenCowork 文案）：复杂请求（3+ 步或多文件）先用 `TaskCreate` 建任务；开始前置 `in_progress`；全部完成才能标 `completed`；先 `TaskList` 查已有任务防重复
  - 验证：system prompt 含该段（日志核验）

- [ ] **步骤6：生命周期清理**
  - 会话删除时清理 `session_tasks`（跟随现有会话删除链路）；会话全部任务 `completed` 后由 agent 视情况清理（`TaskUpdate` status=deleted 逐条或整体清空，参考 OpenCowork `shouldClearCompletedSessionTasks`）
  - 验证：删除会话后库中无残留任务行

## 涉及文件

- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs` — 修改（DDL）
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/SessionTaskEntity.cs` — 新建
- `src/runtime/WishfulClaw.Agent/Tools/SessionTaskTools/*.cs` — 新建（4 个工具）
- `src/runtime/WishfulClaw.Worker/WorkerModuleCatalog.cs` — 修改（注册）
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` — 修改（task_management 会话段）
- `src/main/ipc/messagepack-handler.ts` — 修改（通道注册）
- `src/preload/index.ts` + `index.d.ts` — 修改（暴露）
- `src/renderer/src/stores/session-task-store.ts` — 新建
- `src/renderer/src/components/chat/session-task-card.tsx` — 新建（含配套样式/子组件）
- 会话删除链路相关文件 — 修改（级联清理）

## 参考源码

- OpenCowork `sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeTaskExecutor.cs` — 工具直读 DB、结果编码、删除即物理删除
- OpenCowork `sidecars\...\Modules\Db\DbSchemaMigrator.cs` L328 — tasks 表 DDL
- OpenCowork `src\renderer\src\stores\task-store.ts` — 按会话缓存的 store 模式
- OpenCowork `src\renderer\src\components\chat\TodoCard.tsx` / `cowork\StepsPanel.tsx` — 前端卡片展示
- OpenCowork `src\renderer\src\lib\agent\system-prompt.ts` L409 — `<task_management>` prompt 文案

## 验证标准

- TypeScript 三配置 + `dotnet build` + AOT 发布全部零错误零警告
- 手工验收：多步请求触发任务拆解 → 卡片实时展示 → 完成后状态正确 → 会话删除无残留
