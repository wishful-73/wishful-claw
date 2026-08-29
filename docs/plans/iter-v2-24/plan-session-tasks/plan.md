# Plan B：会话 Agent 临时 Todo（OpenCowork 语义）

> v2-iter-24 · Plan B
> 本 Plan 只负责项目会话 Agent 的内部临时 Todo，不负责全局 Agent、全局任务或 Task Board。
> 参考实现：`D:\claw\OpenCowork` 的 `tasks` 表、`AgentRuntimeTaskExecutor`、`task-store`、`TodoCard`。

## 目标

将现有会话级 `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList` 工具链从内存版补齐为 SQLite 持久化，使项目会话 Agent 能够在收到任何工作消息后，自主决定是否建立临时 Todo，并在当前轮或后续多轮中持续推进。

这里的“任何工作消息”包括：

- 用户直接发送的消息；
- 全局 Agent 发来的外部工作请求；
- 后续其他进入该会话的工作消息。

消息来源不改变 Todo 规则。Todo 始终由当前会话 Agent 自己判断、自己创建、自己更新。

## 产品边界

- Todo 绑定当前 `sessionId`，属于当前会话 Agent 的内部执行辅助。
- 简单的一步请求可以不创建 Todo；复杂请求是否拆分由 Agent 自主判断，不设硬性步数门槛。
- Todo 可以在一轮消息内创建并完成，也可以跨多轮消息继续推进。
- 应用重启后，未完成 Todo 和仍需展示的任务可以恢复。
- Todo 在聊天输入框上方通过 TodoCard/任务卡片展示，但这不意味着它是全局任务。
- 用户不能直接创建、编辑、删除或干预会话 Todo；当前迭代不提供用户管理入口。
- 全局 Agent 不读取、不修改、不删除、不统计、不聚合会话 Todo，也不根据 Todo 状态判断全局任务状态。
- 全局 Agent 发给目标会话的是外部消息/工作请求，不直接调用目标会话的 `TaskCreate`。
- 会话删除时清理该会话的 Todo；全部完成的 Todo 可按 OpenCowork 语义在后续新一轮开始时清理，未完成 Todo 不得被自动清理。
- 与 Goal 的 `goal_plans` / `goal_tasks` / `goal_plan_tasks` 完全隔离。

## 现状

- 已有 `TaskToolProvider` 和 `AgentRuntimeTaskExecutor` 的四工具链路。
- 已有前端 `task-store.ts`、`task-store-helpers.ts`、`TodoCard.tsx` 及聊天事件同步逻辑。
- `shared/messagepack/binary-ipc.ts` 已存在 `db:tasks:*` 通道常量。
- 当前主要缺口是 `tasks` 表、SQLite 读写、主进程 handler/Worker DB 工具以及重启/删除生命周期闭环。

## 步骤清单

- [ ] **步骤1：DB 层 — `tasks` 表 + Entity/Mapper**
  - `DbClient.cs` 的建表 SQL 追加 `tasks`：
    `id TEXT PRIMARY KEY, session_id TEXT NOT NULL, plan_id TEXT, subject TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', active_form TEXT, status TEXT NOT NULL DEFAULT 'pending', owner TEXT, blocks TEXT DEFAULT '[]', blocked_by TEXT DEFAULT '[]', metadata TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL`。
  - 增加 `session_id` / `plan_id` 索引和会话级外键级联清理。
  - 新建 `Infrastructure/Db/Entities/TaskEntity.cs`，按现有 Entity/Mapper 规范实现。
  - 状态支持 `pending / in_progress / blocked / in_review / completed`；`TaskUpdate(status=deleted)` 物理删除并清理依赖引用。
  - 验证：新库冷启动建表；旧库初始化/迁移不破坏现有数据；`dotnet build` 零错误。

- [ ] **步骤2：改造现有四个会话任务工具为 SQLite 版**
  - 保留现有工具名、路由和前端契约，不新建并行工具链。
  - 将 `AgentRuntimeTaskExecutor` 的内存存储替换为 `DbClient` 的 `tasks` 表读写。
  - 按 OpenCowork 补齐 `activeForm`、`owner`、`addBlocks`、`addBlockedBy`、`metadata` 合并、`deleted` 物理删除和依赖引用清理。
  - `TaskCreate` / `TaskUpdate` 返回当前会话任务结果，供当前会话 Agent 继续判断；该结果只回给当前 Agent，不进入全局 Agent 状态。
  - 同步 `TaskToolProvider` schema 的可选参数，但不修改工具名。
  - AOT：新增 Entity/Row/Result 及 `List<T>` 注册到正确的 `JsonSerializerContext`。
  - 验证：同一会话创建、读取、更新、删除；任务可跨多轮继续；应用重启后仍可恢复；不同会话互不泄漏。

- [ ] **步骤3：补齐 `db:tasks:*` IPC 与 Worker DB 工具**
  - 复用 `shared/messagepack/binary-ipc.ts` 已有的 `db:tasks:*` 通道常量，不增加第二套按会话命名的 IPC 通道。
  - 在 `Infrastructure/Db/DbTaskTools.cs` 提供按会话列表、单条查询、创建、更新、删除、按会话删除等端点。
  - 在 `src/main/ipc/messagepack-handler.ts` 注册对应 handler；必要时补齐 preload 类型暴露。
  - 保持前端 camelCase 入参与 DB snake_case 返回行的既有映射契约。
  - 验证：`task-store.loadTasksForSession` 真实走通；TS node 配置零错误；日志无 IPC 静默失败。

- [ ] **步骤4：会话内 Todo 展示与事件同步核验**
  - 复用既有 `task-store.ts`、`task-store-helpers.ts`、`TodoCard.tsx`、`execution-outline` 和任务事件适配，不新建 `session-task-store` 或第二套卡片。
  - 检查任务创建/更新/删除后的流式事件和工具结果是否只更新当前会话 UI。
  - 全局 Agent 的外部工作请求进入目标会话后，目标会话 Agent 仍按普通消息处理；不得绕过 Agent 直接写入 `tasks`。
  - 验证：用户消息和全局 Agent 消息均能触发同一套会话 Todo 行为；切换会话加载正确；Task Board 不因本 Plan 自动读取这些 Todo。

- [ ] **步骤5：会话 Agent 的任务管理 Prompt**
  - `PromptBuilder` 只增加会话 Agent 的临时 Todo 引导，并通过调用方参数控制是否注入。
  - 文案明确：复杂/持续工作由 Agent 自主判断是否使用 `TaskCreate`；开始执行前更新 `in_progress`；遇到阻塞标记 `blocked`；确认真正完成后才标记 `completed`；先检查当前会话任务避免重复。
  - 明确禁止：为简单请求强制创建；把 Todo 当作长期任务；等待外部 Agent 管理内部 Todo。
  - 验证：普通项目会话的 system prompt 含该段；全局 Agent 不注入本段，除非它本身作为普通会话 Agent 执行其他工作。

- [ ] **步骤6：生命周期清理与回归**
  - 会话删除时删除 `tasks` 行及内存缓存。
  - 全部任务完成后，按 OpenCowork 既有语义，在后续普通新一轮开始时可清理已完成 Todo；`continue`、团队/子 Agent 等特殊路径不得误清理。
  - 未完成、阻塞或待审核 Todo 不得因新消息、切换会话或全局 Agent 操作被清理。
  - 验证：删除会话无残留；重启恢复；同一会话跨轮推进；任务与全局任务完全隔离。

## 涉及文件

- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs` — 修改（DDL/迁移）
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/TaskEntity.cs` — 新建
- `src/runtime/WishfulClaw.Infrastructure/Db/DbTaskTools.cs` — 新建
- `src/runtime/WishfulClaw.Agent/AgentRuntimeTaskExecutor.cs` — 修改（内存改 SQLite）
- `src/runtime/WishfulClaw.Agent/Tools/Providers/TaskToolProvider.cs` — 修改（schema 补齐）
- `src/runtime/WishfulClaw.Worker/WorkerModuleCatalog.cs` — 修改（注册 DB 工具）
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` — 修改（会话 Todo 引导）
- `src/shared/messagepack/binary-ipc.ts` — 复用既有常量，必要时修正契约
- `src/main/ipc/messagepack-handler.ts` — 修改（handler）
- `src/preload/index.ts` + `index.d.ts` — 按实际缺口修改
- `src/renderer/src/stores/task-store*.ts` — 复用并联调
- `src/renderer/src/components/chat/TodoCard.tsx` — 复用并联调

## 本 Plan 不负责

- `global_tasks` / `global_task_dispatches`。
- 全局 Agent 宿主和全局 Agent Prompt。
- Task Board 全局任务列表和分派面板。
- 全局 Agent 查询项目/会话。
- 全局 Agent 向会话发消息或发任务。
- 读取所有会话的 Todo 状态或完成率。

## 参考源码（统一为较新副本 `D:\claw\OpenCowork`，2026-08-29 核实）

- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeTaskExecutor.cs` — SQLite 版实现（五状态枚举、依赖双向写入、删除清理）
- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\Db\DbSchemaMigrator.cs` — tasks 表 DDL（L359，已按新副本核实）
- `D:\claw\OpenCowork\src\renderer\src\stores\task-store.ts`
- `D:\claw\OpenCowork\src\renderer\src\components\chat\TodoCard.tsx`
- `D:\claw\OpenCowork\src\renderer\src\lib\tools\todo-tool.ts` — 新版工具描述文案与 `metadata` 约定键（`priority` / `tags` / `dueAt`）；注意新版 OpenCowork 已移除 system-prompt 的 `<task_management>` 段，引导改为工具描述承载（本项目步骤5 仍用 PromptBuilder 注入，文案以新版工具描述为基准）

## 验证标准

- TypeScript 三配置、`dotnet build`、AOT 发布全部零错误零警告。
- 用户消息和全局 Agent 消息都能进入同一会话 Agent 处理链。
- 会话 Agent 能自主选择是否创建临时 Todo，并可跨多轮推进。
- TodoCard 展示和会话隔离正常；重启可恢复；删除会话无残留。
- 全局 Agent 和 Task Board 无法读取、修改或统计会话内部 Todo。
