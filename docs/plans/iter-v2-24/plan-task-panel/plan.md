# Plan: 全局任务面板（Task Board）

> v2-iter-24 · Plan A（共 2 个 Plan：A 全局任务 / B 会话级任务）
> 本 Plan 与 Goal 模式的 `goal_plans` / `goal_tasks` 表**完全无关**，全部新建独立表。

## 目标

落地左侧"扩展"区已有的 Task Board 入口（当前是 PlaceholderPage）：全局任务的完整管理面板（查询/新建/修改/状态流转），并让 agent 通过任务工具在任意会话中自主维护全局任务（接到用户任务后自行建任务、推进、回写状态）。**本迭代不做"一键执行"（自动开会话跑任务）。**

## 需求决策记录（老大已确认，2026-08-29）

| 决策点 | 结论 |
|--------|------|
| 本迭代范围 | 完整方案（全局任务 + 会话级任务） |
| 全局任务字段 | 完整版：标题/状态/标签/优先级/截止时间/描述/关联会话·项目 |
| agent 维护方式 | 工具自主维护（新增全局任务工具 + system prompt 引导） |
| 任务执行 | 本迭代不做，仅回写状态 |
| 面板入口 | 左侧面板"扩展"区已有的 Task Board 项（`openTaskBoardPage`） |
| 数据结构 | 独立 `global_tasks` 表，与 Goal 表系零关系 |

## 步骤清单

- [ ] **步骤1：DB 层 — `global_tasks` 表 + Entity**
  - `DbClient.cs` 的 tableSqls 追加 `global_tasks` DDL：
    `id TEXT PK, project_id TEXT, session_id TEXT, title TEXT, description TEXT DEFAULT '', status TEXT DEFAULT 'pending', priority TEXT DEFAULT 'normal', due_at INTEGER, tags TEXT DEFAULT '[]', sort_order INTEGER DEFAULT 0, created_at INTEGER, updated_at INTEGER`
    + 索引 `ix_global_tasks_status`、`ix_global_tasks_project`
  - 新建 `Infrastructure/Db/Entities/GlobalTaskEntity.cs`（具名类，符合 AOT 规范）
  - 状态枚举：`pending / in_progress / completed / cancelled`
  - 验证：`dotnet build src/runtime/WishfulClaw.sln` 零错误；删库冷启动后表自动创建

- [ ] **步骤2：Worker DB 工具 + IPC 通道**
  - 参考现有 `Db*Tools` 模式，新建 `DbGlobalTaskTools`（list / create / update / delete），注册进 `WorkerModuleCatalog`
  - 主进程 `messagepack-handler` 注册 `db:global-tasks:list/create/update/delete` 通道，preload 暴露给渲染进程
  - 验证：TS node 配置编译零错误；手工 invoke 通道 CRUD 正常（日志核验）

- [ ] **步骤3：渲染进程 store**
  - 新建 `stores/task-board-store.ts`：按筛选条件加载列表、乐观更新、删除会话时联动清理关联字段
  - 验证：web 配置编译零错误

- [ ] **步骤4：TaskBoardPage UI（完整版字段）**
  - 新建 `components/taskboard/TaskBoardPage.tsx`（按职责拆文件，单文件 ≤500 行）：
    - 列表视图：状态分组/筛选、标签筛选、优先级标识、截止时间（逾期标红）
    - 新建/编辑对话框：标题、描述、状态、优先级、截止时间、标签、关联项目/会话
    - 状态快捷切换（勾选完成 / 下拉改状态）
  - `MainLayout.tsx` 中把 `taskBoardPageOpen` 的 PlaceholderPage 替换为 TaskBoardPage
  - 验证：启动应用，从左侧"扩展"进入，增删改查 + 筛选全流程手工走通

- [ ] **步骤5：agent 全局任务工具（工具自主维护）**
  - Agent 层新建 `Tools/GlobalTaskTools/`：`GlobalTaskCreateTool` / `GlobalTaskUpdateTool` / `GlobalTaskListTool` / `GlobalTaskGetTool`，实现 `IToolExecutor`，在对应 Module 注册
  - 工具直接读写 `global_tasks` 表（经 DbClient），工具描述中引导：接到用户多步任务时先建任务、推进时改状态、完成后回写
  - AOT：涉及的序列化类型全部注册进对应 `JsonSerializerContext`（含 `List<GlobalTaskRow>` 泛型版本）
  - 验证：`dotnet build` 零错误 + AOT 0 警告（`scripts/publish-aot-worker.mjs`）；会话中让 agent 调用工具建任务成功

- [ ] **步骤6：Prompt 引导**
  - PromptBuilder 增加 `<task_management>` 段（仅当全局任务工具可用时注入）：接到用户任务先查已有任务（防重复）→ 复杂任务建全局任务 → 完成后回写状态，未完成不得标 completed
  - 验证：会话中观察 system prompt 含该段（日志核验）

- [ ] **步骤7：工具写入后的实时同步**
  - 工具写库成功后经现有流式事件机制广播 `global_task_changed` 事件；`task-board-store` 监听并刷新
  - 验证：agent 工具建任务后，不刷新页面，Task Board 面板即时出现新任务

## 涉及文件

- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs` — 修改（DDL）
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/GlobalTaskEntity.cs` — 新建
- `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskTools.cs` — 新建
- `src/runtime/WishfulClaw.Agent/Tools/GlobalTaskTools/*.cs` — 新建（4 个工具，一文件一工具）
- `src/runtime/WishfulClaw.Worker/WorkerModuleCatalog.cs` — 修改（注册）
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` — 修改（task_management 段）
- `src/main/ipc/messagepack-handler.ts` — 修改（通道注册）
- `src/preload/index.ts` + `index.d.ts` — 修改（暴露）
- `src/renderer/src/stores/task-board-store.ts` — 新建
- `src/renderer/src/components/taskboard/*.tsx` — 新建
- `src/renderer/src/components/layout/MainLayout.tsx` — 修改（替换占位页）

## 参考源码

- OpenCowork `sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeTaskExecutor.cs` — 任务工具直读 DB + 结果编码的参考
- OpenCowork `src\renderer\src\stores\task-store.ts` — store 分层与按会话缓存的参考
- 本项目现有 `Db*Tools` / `GoalPanel` 相关链路 — 分层与 IPC 模式对齐

## 验证标准

- TypeScript 三配置 + `dotnet build` + AOT 发布全部零错误零警告
- 手工验收：UI 增删改查闭环；会话中 agent 能自主建任务并回写状态；面板实时同步
