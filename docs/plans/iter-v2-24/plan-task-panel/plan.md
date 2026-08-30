# Plan A：全局 Agent 产品经理与全局任务工作台

> v2-iter-24 · Plan A
> 本 Plan 负责全局 Agent、全局任务、跨项目会话分派和 Task Board。
> 会话 Agent 的内部临时 Todo 由 Plan B 负责，完全参考 OpenCowork；本 Plan 不读取、不管理、不统计目标会话的 `tasks`。

## 目标

将左侧“扩展”区已有的 Task Board 入口从 PlaceholderPage 落地为全局 Agent 的工作台。

全局 Agent 是一个独立的通用小助手/产品经理，拥有跨项目视野，负责维护自己的全局任务，并通过消息和工作请求协调具体项目会话。目标会话收到消息后，仍由目标会话 Agent 自己决定如何执行、是否建立临时 Todo，以及何时回复结果。

## 核心概念

### 全局 Agent

- 全局 Agent 是显式 `SessionScope='global'` 的独立会话角色，不通过“无 `projectId`”动态推导。
- 全局会话固定使用 `CollaborationMode='chat'`，不允许切换为 Cowork，也不显示权限按钮。
- 全局 Chat 面向跨项目目标、产品事项和协调工作，可以管理全局 Agent 自己的数据：全局任务、分派记录、项目/会话查询、跨会话消息和全局记忆。
- 全局 Chat 不能直接修改项目工作区，不能因 `fullAccess`、ToolPreset 或导航状态获得项目文件写入、Shell、Git 等 Cowork 能力。
- 全局 Agent 可以查看项目和会话的基础信息、选择目标会话、发送消息/工作请求、接收会话回复并继续推动。
- 全局 Agent 不读取目标会话的 `TaskList`，不读取 `tasks` 表，不读取 TodoCard，不计算会话内部 Todo 完成率。
- 全局 Agent 不直接调用目标会话的 `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList`。

### 全局任务

全局任务是全局 Agent 的高层工作对象，例如产品目标、跨项目事项、持续跟进事项。它不代表某个会话内部的执行步骤，也不自动映射为会话 Todo。

建议字段：

`id, title, description, status, priority, tags, due_at, archived, created_at, updated_at`

其中 `archived` 为归档标记（0/1）：**全局任务没有删除，只有归档**；分派记录永久保留，不随任务生命周期清理。

状态：

`pending / in_progress / blocked / completed / cancelled`

### 全局任务分派

一个全局任务可以分派给多个项目和多个会话。分派记录独立于会话 Todo，建议字段：

`id, global_task_id, project_id, session_id, kind, instruction, status, latest_report, created_at, updated_at, completed_at`

其中 `kind` 区分：

- `message`：普通沟通、询问、提醒或追问；
- `work_request`：要求目标会话处理一项明确工作。

分派状态：

`pending / sent / acknowledged / in_progress / completed / blocked / failed / cancelled`

`latest_report` 记录目标会话 Agent 最近一次显式回复或结果摘要。它是全局 Agent 的跟进依据，不是目标会话 Todo 的自动汇总。

## 任务与消息边界

```text
global_tasks
    ↓
global_task_dispatches
    ↓ 外部消息/工作请求
目标项目会话
    ↓
目标会话 Agent 自主处理
    ↓ 显式回复/结果/阻塞说明
全局 Agent 更新 global_task / dispatch 状态
```

目标会话收到外部工作请求后：

- 以普通进入会话的工作消息处理；
- 自己判断是否建立 OpenCowork 风格临时 Todo；
- 不因消息类型被强制创建 Todo；
- 不要求把内部 Todo 状态同步给全局 Agent；
- 不允许全局 Agent直接修改目标会话内部 Todo。

全局任务完成依据是全局 Agent 对目标会话显式回复的判断，不根据 `tasks` 状态自动推导。

## 现状与缺口

- 当前已有全局 Agent 的项目管理工具 `AgentRuntimeProjectExecutor`：`list_projects` 获取项目列表及会话/活跃会话数量；`get_project_details` 获取项目下最近会话并返回可用的 `activeSessionId`；`create_session` 可按项目创建会话。
- 当前已有 `send_session_message` 工具：通过 `project/send-session-message` reverse-request 复用渲染端现有 `sendMessage` 链路，能够向项目下具体会话发送消息。Plan A 复用该能力，不新建第二套跨会话发送基础设施。
- 当前已有项目、会话和消息的 SQLite/IPC 读写基础。
- 当前已有 `sessionMode='global'`、`availableModes` 和按模式注入 Prompt 的基础，但它把 scope、协作模式和 runtime role 混在同一字段中，只能作为迁移来源，不能作为目标模型。
- 当前历史全局会话会被 `activeProjectId` fallback 污染，Worker 可能收到项目 `projectId` 并进入项目记忆作用域；必须先修复显式 scope 的持久化与恢复。
- 当前 `chat` ToolPreset 不包含 `global-task` 类别，不能只依赖 `availableModes: ["global"]`；需要同时调整复合筛选和全局 Chat 能力集合。
- 当前 Task Board 入口仍为 PlaceholderPage。
- 当前没有全局任务表、全局任务与已有 `send_session_message` 的关联记录、全局任务工具和全局任务工作台。
- 当前已有会话内 `TaskCreate/Get/Update/List` 链路，属于 Plan B，不作为本 Plan 的数据源。

## 步骤清单

- [x] **步骤1：显式会话上下文、默认设置与工具可见性**（2026-08-30 已实现并完成最终 TS/C#/AOT 验证）
  - 为会话新增并持久化 `SessionScope = 'global' | 'project'`；`projectId` 只作为项目关联字段。
  - 将用户可见协作模式收敛为 `CollaborationMode = 'chat' | 'cowork'`：全局固定 Chat，项目允许 Chat/Cowork；Plan、编程、ACP、Goal 和 SubAgent 不再作为并列协作模式。
  - Cowork 会话持久化 `PermissionMode = 'default' | 'fullAccess'`；Chat 不显示权限按钮，非法 `chat + fullAccess` 也不得扩大能力。
  - 在现有“运行与性能”页面（`RuntimePanel`）新增“会话默认值”：项目会话默认协作模式、Cowork 默认权限模式；产品默认按用户偏好为 `cowork + fullAccess/YOLO`。设置只影响新项目会话或一次性迁移缺失状态的数据，不覆盖已有会话；全局会话不受影响。
  - 历史数据一次性迁移：可根据旧 `projectId` 补齐 scope；已有项目会话的 collaboration/permission 按兼容规则补齐后即持久化，运行时不得再动态推导。
  - 修复启动恢复、侧栏导航、`navigateToSession`、输入区目标会话解析和请求构造，保证目标会话自身状态是唯一事实，不能回退到其他项目的 `activeProjectId`。
  - Worker 请求上下文拆分为 scope、collaboration mode、runtime role；工具元数据从混杂的 `availableModes` 迁移为 `AvailableScopes`、`AvailableCollaborationModes`、`AvailableRuntimeRoles`。
  - 工具按 scope → collaboration mode → runtime role → ToolPreset → 用户功能设置求交集；permission mode 只决定调用后的审批。为 `global:chat` 明确允许全局任务、分派、项目/会话查询、跨会话消息和全局记忆，明确禁止项目工作区写入工具。
  - Prompt 和记忆作用域读取显式 scope；全局 Prompt 仅对 `global:chat` 注入。Goal 通过 `goalRunner/goalSubAgent` runtime role 注入 Goal Prompt，不再作为会话协作模式。
  - Goal 实例创建时持久化自身权限快照，不随发起会话后续权限切换漂移；本步骤不重做 Goal 任务表。
  - 验证：历史全局会话重启后仍为 `global:chat`；项目 Chat 只读且无权限按钮；项目 Cowork 可在默认审批/YOLO 间切换；新项目会话默认 `cowork + fullAccess`；修改设置不改变已有会话；普通项目会话看不到全局工具，全局 Chat 看不到项目写入工具。
  - 实际验证：三套 TypeScript、前端生产构建、E2E TypeScript、Worker 独立输出 build（0 warning / 0 error）与独立输出 Native AOT（无 IL/AOT warning）均通过。Goal 回归 113 项、SessionTaskCascade 124 项、MemoryRecall 18 项、CompactionSnapshot 全部通过。Cron 仅剩既有的 25/30 列陈旧断言。真实 E2E 因测试使用真实用户数据、会启动新的 Electron/Worker 并在清理阶段强制终止新增 Worker而未运行。

- [ ] **步骤2：全局任务数据层**
  - 在 `DbClient.cs` 增加 `global_tasks` 表，字段覆盖标题、描述、状态、优先级、标签、截止时间和时间戳。
  - 增加 `global_task_dispatches` 表，记录全局任务与项目/会话的分派关系、消息类型、指令、分派状态、最近回复和完成时间。
  - `global_task_dispatches` 不引用 `tasks.id`，不建立全局任务与会话内部 Todo 的父子关系。
  - 约束：目标 session 必须存在；项目字段从目标会话/项目关系校验；**全局任务不删除只归档**（`archived=1`），分派记录永久保留；归档任务默认不在工作台主列表展示，提供单独的归档视图。
  - 新建具名 Entity/Row/Result，注册所有 AOT JSON 类型及 `List<T>` 类型。
  - 验证：新库冷启动建表；旧库初始化迁移正常；全局任务和分派 CRUD 的数据关系符合约束；`dotnet build` 零错误。

- [ ] **步骤3：Worker DB 工具与查询接口**
  - 在 `Infrastructure/Db` 新建全局任务和分派 DB 工具，提供：全局任务列表/详情/创建/更新/归档（不提供删除）、分派列表/详情/创建/更新/取消、按项目或会话筛选。
  - 查询全局任务时可以返回分派摘要、目标项目、目标会话标题和最近回复，但不得返回目标会话内部 `tasks` 明细或完成率。
  - 统一状态枚举、时间戳、标签/元数据 JSON 和错误返回契约。
  - 在 Worker 模块目录中显式注册，不使用反射扫描。
  - 验证：CRUD、筛选、关联查询和 AOT 编译通过；普通会话无法调用全局管理端点。

- [ ] **步骤4：全局 Agent 工具集**
  - 新增仅对全局 Agent 可见的工具，至少包括：
    - 查询项目；
    - 查询会话；
    - 创建/查询/更新全局任务；
    - 向目标会话发送普通消息；
    - 向目标会话发送工作请求并创建/更新 dispatch；
    - 查询自己的分派记录和最近会话回复。
  - 全局 Agent 通过这些工具选择目标项目和目标会话，不直接操作目标会话的临时 Todo。
  - 工具描述明确区分 `message` 与 `work_request`：前者用于沟通/追问，后者用于可追踪的工作分派。
  - 目标会话的回复需要能映射到对应 dispatch；无法可靠映射时不得静默标记完成。
  - 验证：全局 Agent 可以创建一个全局任务并向不同项目的多个会话发送不同工作请求；普通项目 Agent 看不到这些工具。

- [ ] **步骤5：跨会话外部消息/工作请求协议**
  - 设计消息持久化和投递协议：保存发送者为全局 Agent、目标 `sessionId`、消息类型、关联 `globalTaskId/dispatchId`、正文、创建时间和投递状态。
  - 外部消息进入目标会话后，必须沿现有消息持久化/恢复链路可见，并明确标识为全局 Agent 发来的消息或工作请求。
  - 目标会话回复中保留关联信息，使全局 Agent 可以收到显式结果、阻塞原因或追问请求。
  - 消息投递失败、目标会话不存在、目标会话已删除时，dispatch 必须得到明确失败状态和错误原因。
  - 自动唤醒空闲目标会话：实现前单独确认产品策略；本 Plan 默认先完成可靠投递和可见闭环，不隐式新增后台自动执行。
  - 验证：全局 Agent 发消息后目标会话可见；目标会话回复可回到全局 Agent；重启后未处理外部消息不丢失；失败状态可追踪。

- [ ] **步骤6：Task Board 全局工作台**
  - 替换 `MainLayout.tsx` 中的 Task Board PlaceholderPage。
  - 页面主数据源为 `global_tasks` + `global_task_dispatches`，不是会话 `tasks`。
  - 支持：全局任务列表、状态/优先级/标签/截止时间展示、关键词筛选、任务详情、分派列表、目标项目/会话、最近回复、状态修改、任务归档与归档视图、分派取消。
  - 支持从任务详情向已有项目会话发送消息、下发工作请求、追问、打开目标会话。
  - 不展示目标会话内部 Todo 数量、完成百分比、TodoCard 内容或 `TaskList` 结果。
  - 页面需要明确区分“全局任务状态”和“分派状态”，避免把目标会话内部执行状态伪装成全局实时状态。
  - 验证：从左侧扩展区进入 Task Board；创建全局任务；分派给多个项目会话；查看回复；继续推动；刷新/重启后数据保持。

- [ ] **步骤7：全局 Agent 运行结果和同步**
  - 为全局 Agent 的任务/分派变化增加必要的流式事件或 IPC 刷新机制，例如 `global_task_changed`、`global_task_dispatch_changed`、`global_agent_message`。
  - 事件只同步全局任务和分派记录；不把会话 Todo 事件转发给全局 Agent。
  - Task Board 监听变化并刷新；后台目标会话产生回复时，关联分派记录可更新并在 Task Board 显示。
  - 验证：全局任务创建、分派、回复、阻塞和完成操作无需手动重启页面即可反馈；无任务 Todo 泄漏。

- [ ] **步骤8：端到端验收**
  - 场景 A：用户在全局 Agent 会话提出跨项目目标，全局 Agent 创建全局任务。
  - 场景 B：全局 Agent 向项目 A 的会话发送工作请求，目标会话收到消息并自主决定是否创建内部临时 Todo。
  - 场景 C：目标会话 Agent 完成后发送显式结果，全局 Agent 能看到并更新 dispatch，而不读取目标 Todo。
  - 场景 D：全局任务分派到多个项目/会话，其中一个完成、一个阻塞，全局 Agent 能分别处理。
  - 场景 E：目标会话内部 Todo 在聊天中显示，但 Task Board 和全局 Agent 均不显示其明细/完成率。
  - 场景 F：应用重启、目标会话不存在、消息投递失败时，数据和状态可恢复/可诊断。

## 涉及文件

- `src/renderer/src/stores/chat-store/types.ts` 及会话持久化/迁移链路 — 修改（显式 scope、collaboration mode、permission mode）
- `src/renderer/src/stores/settings-store.ts` / `settings-store-types.ts` / `settings-store-migrate.ts` — 修改（新项目会话默认值，不复用当前会话状态）
- `src/renderer/src/components/settings/RuntimePanel.tsx` / `SettingsPage.tsx` / 中英文 `settings.json` — 修改（“运行与性能”会话默认值区域与锚点）
- `src/renderer/src/components/chat/InputArea/*` — 修改（协作模式、Cowork 权限按钮、按目标会话构造上下文）
- `src/renderer/src/components/layout/MainLayout.tsx` / `src/renderer/src/stores/ui-store.ts` — 修改（恢复与导航同步，不用项目 fallback 改写会话身份）
- Worker 工具注册/筛选与请求协议相关文件 — 修改（scope + collaboration mode + runtime role 正交筛选）
- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs` — 修改（DDL/迁移）
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/GlobalTaskEntity.cs` — 新建
- `src/runtime/WishfulClaw.Infrastructure/Db/Entities/GlobalTaskDispatchEntity.cs` — 新建
- `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskTools.cs` — 新建
- `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskDispatchTools.cs` — 新建
- `src/runtime/WishfulClaw.Worker/WorkerModuleCatalog.cs` — 修改（注册）
- `src/runtime/WishfulClaw.Agent/Tools/GlobalTaskTools/*.cs` — 新建（仅全局 Agent 可见）
- `src/runtime/WishfulClaw.Agent/Tools/GlobalAgentTools/*.cs` — 新建（项目/会话查询与分派）
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` — 修改（仅全局 Agent prompt）
- `src/runtime/WishfulClaw.Agent/StreamEventModels.cs` / `ConversationCodec.cs` — 按事件协议需要修改
- `src/shared/messagepack/binary-ipc.ts` — 修改（全局任务/分派/消息通道）
- `src/main/ipc/messagepack-handler.ts` — 修改（handler）
- `src/main/ipc/*session*` / `src/main/ipc/*message*` — 按现有消息投递落点修改
- `src/preload/index.ts` + `index.d.ts` — 按实际桥接缺口修改
- `src/renderer/src/components/layout/MainLayout.tsx` — 修改（替换占位页）
- `src/renderer/src/components/taskboard/*.tsx` — 新建/拆分
- `src/renderer/src/stores/task-board-store.ts` — 新建（全局任务，不复用会话 task-store 作为主数据源）
- `src/renderer/src/locales/zh/taskboard.json` / `en/taskboard.json` — 新建或修改

## 本 Plan 不负责

- 会话 Agent 的 `TaskCreate/Get/Update/List` 工具实现。
- 会话 `tasks` 表持久化和 TodoCard 生命周期。
- 全局 Agent 读取、修改、删除或统计目标会话内部 Todo。
- 将全局任务自动映射成目标会话的 Todo。
- 根据目标会话 Todo 状态自动计算全局任务状态。
- 修改 Goal 任务体系或 Automation/Cron 任务体系。
- 未经单独确认就让全局 Agent 自动并发唤醒所有目标会话执行。

## 参考源码

- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeTaskExecutor.cs` — 仅参考会话临时 Todo 的边界，不照搬为全局任务。
- `D:\claw\OpenCowork\sidecars\OpenCowork.Native.Worker\Modules\Db\DbTaskTools.cs` — 仅参考会话 Todo 字段和 SQLite 工具模式。
- 本项目现有 `DbProjectTools.cs` / `DbSessionTools.cs` — 项目、会话查询和 Worker DB 工具模式。
- 本项目现有消息持久化、Worker IPC 和流式事件链路 — 外部消息/回复关联的实现基础。

## 验证标准

- TypeScript 三配置、`dotnet build`、AOT 发布全部零错误零警告。
- Session scope、collaboration mode 和 Cowork permission mode 均可持久化并在重启后恢复；历史全局会话不再被项目导航状态污染。
- “运行与性能”的项目会话默认值为 `cowork + fullAccess/YOLO`，只影响新项目会话，不覆盖已有会话；全局会话始终固定 Chat。
- Chat 无权限按钮且无法看到/执行项目写入工具；Cowork 的 `default/fullAccess` 只改变审批行为。
- Goal 以后台 runtime role 运行并持久化自身权限快照，不切换会话协作模式。
- 全局 Agent 能跨项目查看项目/会话，创建和维护全局任务。
- 全局 Agent 能向多个项目会话发送消息和可追踪工作请求，并接收显式回复。
- Task Board 展示全局任务和分派记录，不展示或依赖会话内部 Todo。
- 目标会话收到全局 Agent 消息后，仍自主决定是否建立 OpenCowork 风格临时 Todo。
- 全局任务不会因会话 Todo 状态变化而自动改变；状态更新有明确的全局 Agent/会话回复依据。
- 重启、失败投递、目标会话删除等边界场景可诊断、可恢复。
