# v2-iter-24 迭代总览：显式会话上下文 + 全局产品经理 Agent + 会话临时 Todo

> 状态：共同会话上下文前置已实现并完成技术验证；Plan A / Plan B 按各自子计划继续跟踪，待老大确认迭代结束
>
> 日期：2026-08-30
>
> 本迭代先统一会话层级、协作模式、权限模式与运行角色，再实现两个相互隔离的任务体系：全局 Agent 的全局任务，以及项目会话 Agent 的临时 Todo。

## 目标

建立一个全局 Agent 作为通用小助手/产品经理，能够跨项目查看工作上下文、维护自己的全局任务、向具体项目会话发送消息和工作请求，并根据会话回复继续推动工作。

同时，补齐项目会话 Agent 的 OpenCowork 风格临时 Todo：会话 Agent 面对用户消息或全局 Agent 消息时，自主判断是否需要拆解为多步任务，任务可以在当前轮完成，也可以跨多轮消息持续推进。

## 统一会话与运行模型

本迭代所有功能共同使用以下正交模型：

```text
SessionScope      = global | project
CollaborationMode = chat | cowork
PermissionMode    = default | fullAccess
RuntimeRole       = sessionAgent | goalRunner | subAgent | goalSubAgent | ...
```

- 会话显式持久化 scope；`projectId` 只保存项目关联，不再推导会话身份。
- 合法核心会话组合为 `global:chat`、`project:chat`、`project:cowork`。
- Chat 是只读协作，可以搜索、浏览、读取和分析，但不能修改项目工作区或执行有副作用的 Shell/Git；Chat 不显示权限按钮。
- Cowork 是完整协作，才允许 `default`（按策略审批）或 `fullAccess`（YOLO）权限。
- 权限模式不扩大能力范围；非法的 `chat + fullAccess` 也必须按 Chat 上限处理。
- Goal 是项目会话发起的后台运行实体，Plan 是交互/执行策略，编程是任务内容，SubAgent 是运行角色，均不作为协作模式。
- 工具按 scope → collaboration mode → runtime role → preset → 用户功能设置筛选；permission mode 只决定调用后是否审批。

### “运行与性能”默认值

在现有“运行与性能”设置页新增“会话默认值”区域：

- 项目会话默认协作模式：`chat | cowork`；
- Cowork 默认权限模式：`default | fullAccess`；
- 本次产品默认按用户偏好设为 `cowork + fullAccess`，UI 表达为“协作模式 + YOLO”；
- 默认值只用于新建项目会话或一次性初始化缺少显式状态的项目会话，不覆盖已有会话；
- 全局会话固定 `global:chat`，不受上述项目默认值影响。

## 核心边界

### 会话临时 Todo

会话临时 Todo 使用 OpenCowork 的 `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList` 工具和 `tasks` 表模型。

- 所属者是当前项目会话 Agent。
- 输入来源不影响规则：用户消息、全局 Agent 消息或其他进入该会话的工作请求，都由会话 Agent 自主判断是否创建 Todo。
- Todo 只用于当前会话 Agent 的内部执行辅助。
- Todo 可以一轮完成，也可以跨多轮完成。
- Todo 可以持久化并在应用重启后恢复。
- Todo 在聊天输入框上方以任务卡片/TodoCard 呈现，但这只是会话内执行反馈。
- 用户不能直接管理 Todo，也不需要管理。
- 全局 Agent 不读取、不统计、不聚合、不依赖会话 Todo 状态。
- 全局 Agent 发送任务时，不直接调用目标会话的 `TaskCreate`，只发送外部消息/工作请求。

### 全局 Agent 与全局任务

全局 Agent 是一个独立的全局会话角色，面向跨项目协调，不等同于普通无项目聊天。

- 全局 Agent 维护 `global_tasks`，任务可以跨多个项目和多个会话推进。
- 全局任务表达高层目标、产品事项或跨项目推进事项，不表达目标会话内部的执行步骤。
- 全局 Agent 可以查询项目和会话，选择目标会话发送消息或下发工作请求。
- 每次下发工作请求形成 `global_task_dispatches` 记录，记录目标项目/会话、指令、状态和最近一次会话回复。
- 目标会话是否建立内部 Todo、如何拆解、拆成多少步，完全由目标会话 Agent 决定。
- 全局任务状态根据目标会话的显式回复、阻塞说明和完成汇报维护，不根据会话 Todo 状态自动推导。
- 全局 Agent 不读取 `tasks` 表，不读取 TodoCard，不计算会话 Todo 完成率。
- 本迭代只实现向目标会话写入外部消息/工作请求和记录分派，不自动唤醒空闲会话开始执行。

### 与已有任务体系的边界

| 体系 | 作用 | 所属者 | 数据 |
|---|---|---|---|
| 会话临时 Todo | 辅助一个会话 Agent 拆解和推进当前工作 | 项目会话 Agent | `tasks` |
| 全局任务 | 跨项目制定目标、协调和推动工作 | 全局 Agent | `global_tasks` |
| 全局分派 | 记录全局 Agent 发给目标会话的工作请求及回复 | 全局 Agent | `global_task_dispatches` |
| Goal 任务 | Goal 自主编排和执行验证 | Goal 运行时 | `goal_plans` / `goal_tasks` / `goal_plan_tasks` |
| Automation | 定时触发 Agent | Cron/Automation | `cron_jobs` |

## Plan 顺序

```text
共同前置：显式 SessionScope / CollaborationMode / PermissionMode / RuntimeRole
         + “运行与性能”新会话默认值   [已实现，待最终全量验证]
  ↓
Plan B：会话临时 Todo 持久化与会话内展示   [后续工作]
  ↓
Plan A：全局 Agent、全局任务、跨项目分派与 Task Board   [后续工作]
```

### 当前实现状态（2026-08-30）

- 共同前置已落地：会话 scope、Chat/Cowork、Cowork permission、runtime role、请求上下文、历史迁移、默认值、导航/恢复、Prompt/记忆 scope、Worker 工具筛选和 Goal/SubAgent 上下文均已接入。
- 已补充全局 scope 项目上下文隔离：global 请求不会把夹带的 `workingFolder`、`projectId` 或 `sshConnectionId` 传入工具执行，也不会召回项目记忆。
- 已补充辅助 runtime role 的显式上下文：Automation、Pet、ProviderTurn、Translation 与子 Agent 不再依赖会话模式隐式扩权。
- 最终验证已完成：三套 TypeScript 配置、E2E 专用 TypeScript、前端生产构建、Worker 独立输出 build（0 warning / 0 error）和独立输出 Native AOT（无 IL/AOT warning）均通过。
- C# 回归已通过：Goal 113 项、SessionTaskCascade 124 项、MemoryRecall 18 项、CompactionSnapshot 全部通过。
- Cron 回归仍有既有陈旧断言：测试期待 `cron_tasks` 25 列，而当前 DDL 已有 30 列；旧库迁移、CRUD 和重启持久化检查均通过，本轮未修改 Cron DDL，故保留为待后续清理的独立问题。
- 真实 Electron E2E 未运行：测试明确使用真实 `~/.wishful-claw`，会启动新的 Electron/Worker，并在清理阶段强制终止本次新增 Worker；该行为与当前“不干扰 PID 28868 或其他运行中 Worker、不影响真实用户数据”的环境约束冲突。E2E 专用 TypeScript 已通过。
- 本任务验收范围是共同会话上下文前置；Plan A / Plan B 的完成状态以各自子计划和后续验收为准，不在此处扩大结论。


共同前置改造必须先消除历史全局会话被项目导航状态污染的问题，并为 Plan A/B 提供统一的工具和 Prompt 上下文。Plan A 可以复用 Plan B 的会话消息和任务执行基础设施，但不得读取或依赖会话 Todo 状态。

## 本迭代不做

- 不把会话 `tasks` 聚合成全局任务进度。
- 不让全局 Agent 读取、修改或删除会话 Agent 的内部 Todo。
- 不让普通项目会话创建或维护 `global_tasks`。
- 不把全局任务自动映射成目标会话的 `TaskCreate`。
- 不自动唤醒空闲目标会话执行全局 Agent 的工作请求。
- 不实现全局任务自动执行器或跨会话并发调度器。
- 不重做 Goal 任务的数据表；但要把 Goal 明确为后台 runtime role，并持久化 Goal 实例自身的权限快照。
- 不把 Plan、编程、ACP、Goal 或 SubAgent继续保留为 Chat/Cowork 的并列协作模式。

## 统一验收

- 历史全局会话重启和切换后仍保持 `global:chat`，不会继承 `activeProjectId` 或项目工作目录。
- 新项目会话按“运行与性能”的默认值创建为 `project:cowork + fullAccess/YOLO`；修改默认值不改变已有会话。
- Chat 会话不显示权限按钮且不能获得项目写入工具；Cowork 权限只决定审批。
- 项目会话 Agent 收到用户消息时，可以按 OpenCowork 语义自主创建和维护临时 Todo。
- 项目会话 Agent 收到全局 Agent 消息时，仍然使用同一套自主判断规则；外部消息不会绕过会话 Agent 直接创建 Todo。
- Todo 能在当前轮或后续多轮中继续推进，重启后可恢复，用户和全局 Agent 不提供管理入口。
- 全局 Agent 能查看项目和会话，创建全局任务，向目标会话发送消息/工作请求，并看到目标会话的显式回复。
- Task Board 展示全局任务、分派记录、目标项目/会话、最近回复和推动操作，不展示会话 Todo 明细或完成率。
- 全局任务不会因为目标会话内部 Todo 的状态变化而自动改变状态。
- TypeScript 三配置、C# solution、AOT 发布和核心流程验证均通过。
