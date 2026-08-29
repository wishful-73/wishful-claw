# 规划合规审查报告 — v2-iter-24（Plan A / Plan B）

> 审查日期：2026-08-29
> 审查对象：
> - Plan A：`docs/plans/iter-v2-24/plan-task-panel/plan.md`（全局 Agent、全局任务与 Task Board）
> - Plan B：`docs/plans/iter-v2-24/plan-session-tasks/plan.md`（会话 Agent 临时 Todo）
> - 总览：`docs/plans/iter-v2-24/plan.md`
>
> 审查依据：`AGENTS.md`（分层架构、AOT 规范、目录约定）、`docs/dev-workflow.md`（Plan 格式与验证要求）、当前代码库已有项目/会话查询、消息发送和会话任务链路。
> 审查方式：读取计划文档、核对当前代码结构与既有能力、全目录检索旧表述；本次只修改计划文档，不修改业务代码。

---

## 一、最终产品模型

v2-iter-24 明确维护两套完全隔离的任务体系：

```text
global_tasks
= 全局 Agent 的长期目标、产品事项和跨项目协调任务

global_task_dispatches
= 全局 Agent 发给项目/会话的外部消息、工作请求、状态和显式结果记录

tasks
= 当前项目会话 Agent 的内部临时 Todo
```

三者不建立父子 Todo 关系，不自动同步状态，也不互相聚合。

- 会话 Todo 绑定当前 `sessionId`，由当前会话 Agent 自主决定是否创建、如何拆解和如何完成；用户消息、全局 Agent 消息及其他触发消息使用同一判断规则。
- 会话 Todo 可以一轮完成，也可以跨多轮推进；持久化、重启恢复、会话删除清理和后续完成项清理均属于 Plan B。
- 全局 Agent 只维护 `global_tasks` 和 `global_task_dispatches`，通过已有项目/会话查询与消息发送能力推动工作，并根据目标会话的显式回复、汇报或阻塞说明维护状态。
- 全局 Agent 不读取 `tasks` 表、`TaskList`、TodoCard 或会话 Todo 完成率，也不直接调用目标会话的 `TaskCreate/Get/Update/List`。
- Task Board 只以 `global_tasks` 和 `global_task_dispatches` 为主数据源，不展示、不聚合、不统计会话内部 Todo。

---

## 二、逐检查项结论表

| # | 检查项 | Plan A | Plan B | 当前结论 |
|---|---|:---:|:---:|---|
| 1 | 产品边界与职责清晰 | ✅ | ✅ | Plan A 负责全局 Agent、全局任务、分派和工作台；Plan B 只负责当前会话 Agent 的临时 Todo。两者均明确禁止跨系统读取、管理和自动同步。 |
| 2 | 数据模型隔离 | ✅ | ✅ | Plan A 新增 `global_tasks`、`global_task_dispatches`；Plan B 使用 `tasks`。`global_task_dispatches` 不引用 `tasks.id`，不建立父子 Todo 关系。 |
| 3 | 既有能力复用 | ✅ | ✅ | Plan A 复用已有 `list_projects`、`get_project_details`、`send_session_message`，不再规划新建项目/会话查询和消息发送基础设施；Plan B 复用既有四个任务工具、`task-store`、`TodoCard` 和 `db:tasks:*` 契约。 |
| 4 | 步骤与验证完整性 | ✅ | ✅ | Plan A 覆盖宿主身份、数据层、工具、外部消息/工作请求、Task Board、事件同步和端到端场景；Plan B 覆盖 SQLite、四工具改造、IPC、TodoCard、Prompt、生命周期和回归。每步均有验证点。 |
| 5 | 会话 Todo 生命周期 | 不适用 | ✅ | Plan B 明确支持当前会话绑定、跨多轮推进、重启恢复、会话删除清理，以及后续普通新一轮开始时清理已完成项；未完成/阻塞/待审核项不得误清理。 |
| 6 | 全局分派与显式回复闭环 | ✅ | 不适用 | Plan A 支持一个全局任务分派到多个项目/会话，记录目标、指令、状态、最新汇报和时间字段；完成依据是显式回复/汇报，不是会话 Todo 状态。 |
| 7 | Task Board 数据边界 | ✅ | ✅ | Plan A 的 Task Board 只展示全局任务和分派记录；Plan B 明确 TodoCard 仅在聊天输入框上方/聊天区域呈现，不进入全局任务状态计算。 |
| 8 | 架构、IPC 与 AOT 计划 | ✅ | ✅ | 两份计划均列出 DB Entity/工具、Worker 注册、IPC/前端契约和 AOT 类型注册要求；执行时需继续遵守现有分层和显式注册规范。 |
| 9 | 自动唤醒边界 | ✅ | 不适用 | Plan A 明确本迭代默认只实现可靠投递和可见回复，不未经单独确认自动唤醒空闲目标会话；该策略未被隐藏在实现假设中。 |

---

## 三、关键合规核对

### 1. Plan A 不重复建设已有项目/会话能力

Plan A 已将项目/会话查询与消息发送定义为现有能力复用点：

- `list_projects`：复用已有项目列表、会话数量和活跃会话数量查询。
- `get_project_details`：复用已有项目详情、最近会话和可用 `activeSessionId` 查询。
- `send_session_message`：复用已有 `project/send-session-message` reverse-request，沿 renderer 的正常 `sendMessage` 链路投递。

Plan A 新增的是全局任务关联上下文、`global_task_dispatches` 分派记录、全局 Agent 专用任务能力和 Task Board，不再把上述基础设施列为新建范围。

### 2. Plan B 复用现有会话任务工具链

Plan B 保留 `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList` 的工具名、路由和前端契约，把现有实现改造为 `tasks` SQLite 持久化，并补齐已有 `db:tasks:*` IPC/handler 闭环。

Plan B 不新增独立的会话任务表、并行 IPC 通道、第二套 task store 或第二套 TodoCard；当前会话 Todo 的 UI 只复用既有 `task-store`、辅助函数和 `TodoCard`。

### 3. 全局 Agent 与会话 Agent 的消息边界

全局 Agent 发给目标会话的是普通外部消息或带关联记录的工作请求。目标会话收到后仍由自身 Agent 处理，并自行判断是否创建内部 Todo。全局 Agent 不直接调用目标会话的任务工具；目标会话也不因为消息类型被强制创建 Todo。

目标会话通过正常消息回复结果、阻塞原因或追问请求；全局 Agent 根据这些显式内容更新 dispatch 和 global task。任何无法可靠关联或未收到显式结果的情况，不得静默标记全局任务完成。

### 4. Task Board 与会话 Todo 完全隔离

Task Board 的主数据源固定为 `global_tasks` + `global_task_dispatches`，展示全局任务、分派状态、目标项目/会话、最近回复和推动操作；不得展示 Todo 数量、完成率、TodoCard 内容或 `TaskList` 结果。

会话 Todo 只在聊天输入框上方/聊天区域通过 TodoCard 呈现，本质上是当前会话 Agent 的内部执行反馈，不是全局任务，也不进入 Task Board 的状态计算。

---

## 四、旧模型清理结果

对 `docs` 目录及工作区全目录进行检索后，旧模型中的独立会话任务表、Task Board 聚合会话 Todo、全局 Agent 读取或统计会话 Todo、按会话 Todo 完成率推导全局任务，以及全局任务自动映射会话任务等设计，均已从计划中移除或改写为明确的隔离边界。

当前统一称谓为：会话内部使用 `tasks`，全局任务使用 `global_tasks`，分派记录使用 `global_task_dispatches`。

---

## 五、执行前注意事项

1. 当前状态仍是“需求重写中/待确认”，本报告不代表已授权执行代码改造。
2. Plan A 实现时需先确认全局 Agent 的稳定宿主身份、工具可见范围和回复关联协议；不得通过 `project_id IS NULL` 等不稳定条件猜测身份。
3. 全局任务删除时，需在实现前固定 `global_task_dispatches` 的处理策略（级联清理或转为 `cancelled`），并在迁移与回归中验证。
4. 自动唤醒空闲目标会话暂不默认实现；若要改变该边界，应单独确认并更新 Plan。
5. 代码执行阶段仍需完成 TypeScript 三配置、C# solution、AOT、数据库迁移、IPC、重启恢复和核心端到端验证；本轮仅完成计划文档一致性核对。

---

## 最终结论

**Plan A + Plan B 当前均符合已确认的产品定义，可进入用户确认环节。**

- Plan A：全局 Agent + `global_tasks` + `global_task_dispatches` + Task Board；复用已有项目/会话查询和消息发送能力；只依据显式会话回复推进。
- Plan B：OpenCowork 风格会话临时 Todo；复用 `TaskCreate/Get/Update/List` 和既有前端链路；持久化到 `tasks`，只服务当前会话 Agent。
- 两套系统完全隔离；没有父子 Todo 关系、自动状态同步或 Task Board 聚合。
- 本轮未修改业务代码、数据库或运行时行为。
