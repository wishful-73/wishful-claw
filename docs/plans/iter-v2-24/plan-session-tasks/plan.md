# Plan: 会话级任务（Session Tasks）——既有链路持久化改造

> v2-iter-24 · Plan B（共 2 个 Plan：A 全局任务 / B 会话级任务）
> 实现方式参考 OpenCowork（`D:\koda\OpenCowork`），与 Goal 模式的 `goal_plans` / `goal_tasks` 表**完全无关**。
> **修订说明（2026-08-29）**：合规审查发现项目已有 OpenCowork 迁移的"半截"任务链路——后端内存版工具 + 前端 store/UI 已就位，但存储未落库、主进程通道未注册。本计划改为**改造既有链路**，不新建并行实现。

## 目标

会话级任务是 **agent 在会话中自行创建维护的临时任务队列**——用于拆解复杂请求、跟踪推进进度。落地：把现有内存版 `TaskCreate/TaskGet/TaskUpdate/TaskList` 工具链升级为 SQLite 持久化（`tasks` 表），补全主进程 `db:tasks:*` handler，复用既有前端 `task-store` 与 `TodoCard`，并注入 system prompt 引导。

## 现状盘点（合规审查实证，2026-08-29）

| 层 | 已有资产 | 缺什么 |
|----|----------|--------|
| Agent 工具 | `TaskToolProvider`（已注册 `ToolModule.cs`）+ `AgentRuntimeTaskExecutor`（内存 ConcurrentDictionary，`ToolDispatchRouter.cs` L212 路由）+ 字段仅 title/description/status | 无持久化、无 activeForm/依赖等字段、进程重启即丢 |
| 主进程通道 | `shared/messagepack/binary-ipc.ts` L90-95 已定义 `db:tasks:*` 六通道常量 | 主进程侧**未注册任何 handler**（半截迁移） |
| 渲染进程 | `stores/task-store.ts`（417 行，含 `tasksBySession` 缓存）+ `task-store-helpers.ts`（`TaskRow` 映射含 plan_id/owner/blocks/blocked_by/metadata/active_form）+ `components/chat/TodoCard.tsx` | `loadTasksForSession` 走 `db:tasks:*` 会失败（无 handler） |
| DB | 无 tasks 表 | 全部缺失 |

## 需求决策记录（老大已确认，2026-08-29）

| 决策点 | 结论 |
|--------|------|
| 定位 | agent 自行创建、自行拆解、方便推进的临时队列（非用户手动创建） |
| 实现参考 | `D:\koda\OpenCowork` 的 tasks 表 + Task 工具链（本项目的工具名/前端组件与其天然一致） |
| 数据结构 | 新建独立 `tasks` 表（`session_id` 外键，会话删除级联清理），与 Goal 表系零关系 |
| 工具命名 | 复用现有 `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList`（改造而非新建，与子 Agent 的 `"Task"` 工具不冲突） |

## 步骤清单

- [ ] **步骤1：DB 层 — `tasks` 表 + Entity**
  - `DbClient.cs` 的 tableSqls 追加 `tasks` DDL，**字段与前端 `TaskRow` 映射严格对齐**：
    `id TEXT PK, session_id TEXT NOT NULL, plan_id TEXT, subject TEXT NOT NULL, description TEXT DEFAULT '', active_form TEXT, status TEXT DEFAULT 'pending', owner TEXT, blocks TEXT DEFAULT '[]', blocked_by TEXT DEFAULT '[]', metadata TEXT, sort_order INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER`
    + 索引 `ix_tasks_session(session_id)`；session 删除时级联清理
  - 新建 `Infrastructure/Db/Entities/TaskEntity.cs`（具名类，符合 AOT 规范）
  - 状态：`pending / in_progress / completed`（`TaskUpdate` 传 `deleted` 时物理删除并清理依赖引用）
  - 验证：`dotnet build` 零错误；冷启动建表正常

- [ ] **步骤2：改造 `AgentRuntimeTaskExecutor` 为 SQLite 版**
  - 内存存储替换为 `DbClient` 读写 `tasks` 表；四个工具名与路由分支零改动（`ToolDispatchRouter` 调用签名不变）
  - 字段补齐至 OpenCowork 对齐：`activeForm`、`owner`、`addBlocks`/`addBlockedBy`、`metadata`（key=null 删除）、`status=deleted` 物理删除（参考 `AgentRuntimeTaskExecutor.cs` L98-120）；`TaskToolProvider` 的 inputSchema 同步补可选参数（仅加参数，不改工具名）
  - 创建/更新后返回全量会话任务列表（供 agent 感知全局进度，参考 `EncodeTaskCreateResult`）
  - AOT：序列化类型注册进对应 `JsonSerializerContext`（含 `List<TaskRow>` 泛型版本）
  - 验证：`dotnet build` 零错误 + AOT 0 警告（`scripts/publish-aot-worker.mjs`）；会话中 TaskCreate 后重启应用，TaskList 仍可见

- [ ] **步骤3：主进程 `db:tasks:*` handler 注册（补全半截迁移）**
  - `messagepack-handler` 按 `binary-ipc.ts` 既有常量注册六通道（list-by-session/get/create/update/delete/delete-by-session），Worker DB 工具侧新建 `DbTaskTools`（参考现有 `Db*Tools` 模式，放 `Infrastructure/Db`）
  - 契约注意：前端 create 入参为 camelCase（对齐 `task-store-helpers.dbCreateTask`），返回行为 snake_case（对齐 `TaskRow`）
  - 常量已在 `binary-ipc.ts`，**不新建 `db:session-tasks:*` 通道**
  - 验证：前端 `task-store.loadTasksForSession` 走通（日志核验）；TS node 配置编译零错误

- [ ] **步骤4：前端复用核验（不新建并行 store/卡片）**
  - 复用 `stores/task-store.ts` + `TodoCard.tsx`；按步骤2/3 联调后核验：切换会话加载、工具调用产生的任务经流式事件/工具结果渲染同步卡片（现有 `agent-runtime-sync.ts` 的 `task_add`/`task_update` 链路）
  - 如发现渲染进程有残留的 native-only 占位工具注册（如 `todo-tool.ts` 式占位），执行时核实并清理
  - 验证：会话中让 agent 拆解多步请求，TodoCard 实时出现并随进度更新；切换会话任务列表正确

- [ ] **步骤5：Prompt 引导**
  - PromptBuilder 增加 `<task_management>` 会话任务段（参考 OpenCowork `system-prompt.ts` L409 文案）：复杂请求（3+ 步或多文件）先 `TaskCreate` 建任务；开始前置 `in_progress`；全部完成才能标 `completed`；先查已有任务防重复
  - 工具可用标记由调用方（Worker/AgentLoop）经 `parameters` 传入 PromptBuilder（PromptBuilder 只读参数，不感知工具注册状态）
  - 验证：会话中 system prompt 含该段（日志核验）

- [ ] **步骤6：生命周期清理**
  - 会话删除时清理 `tasks` 行（跟随现有会话删除链路）
  - 会话全部任务 `completed` 后由 agent 视情况清理（参考 OpenCowork `shouldClearCompletedSessionTasks`）
  - 验证：删除会话后库中无残留任务行

## 涉及文件

- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs` — 修改（DDL）
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/TaskEntity.cs` — 新建
- `src/runtime/WishfulClaw.Infrastructure/Db/DbTaskTools.cs` — 新建
- `src/runtime/WishfulClaw.Agent/AgentRuntimeTaskExecutor.cs` — 修改（内存 → SQLite + 字段补齐）
- `src/runtime/WishfulClaw.Agent/Tools/Providers/TaskToolProvider.cs` — 修改（inputSchema 补可选参数）
- `src/runtime/WishfulClaw.Worker/WorkerModuleCatalog.cs` — 修改（DbTaskTools 注册）
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` — 修改（task_management 段 + 参数传入链路）
- `src/main/ipc/messagepack-handler.ts` — 修改（六通道 handler 注册）
- `src/preload/index.ts` + `index.d.ts` — 修改（如需补充暴露）
- `src/renderer/src/stores/task-store*.ts`、`components/chat/TodoCard.tsx` — 复用核验（原则上零改动）

## 参考源码

- OpenCowork `sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeTaskExecutor.cs` — SQLite 版工具完整实现（字段/删除/结果编码）
- OpenCowork `sidecars\...\Modules\Db\DbSchemaMigrator.cs` L328 — tasks 表 DDL（执行前复核行号）
- OpenCowork `src\renderer\src\lib\agent\system-prompt.ts` L409 — `<task_management>` prompt 文案（执行前复核行号）
- 本项目现有 `task-store.ts` 的 `TaskRow` 映射 — DDL 字段对齐基准

## 验证标准

- TypeScript 三配置 + `dotnet build` + AOT 发布全部零错误零警告
- 手工验收：多步请求触发任务拆解 → TodoCard 实时展示 → 重启不丢 → 会话删除无残留
