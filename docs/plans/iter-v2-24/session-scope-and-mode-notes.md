# v2-iter-24：会话层级、运行模式与工具可见性设计记录

> 状态：产品模型已确认；共同会话上下文前置已实现并处于最终验证阶段
>
> 日期：2026-08-30
>
> 适用范围：全局 Agent、项目会话 Agent、Goal、设置默认值、权限审批、工具筛选、Prompt 与记忆作用域

## 1. 记录目的

本记录用于收束迭代 24 已确认的产品语义、当前实现事实、已发现缺陷和实施约束，并作为 `plan.md`、Plan A、Plan B 与合规报告的统一设计基线。

本记录确认会话层级、协作模式、权限模式、Goal 定位和设置默认值的产品模型。老大已授权执行，共同前置的字段落点、数据库迁移、Renderer/Worker 请求链和工具策略已实现；后续仍需完成最终 C#/AOT 验证，并继续执行 Plan A / Plan B 未完成部分。

## 2. 已确认的产品语义

### 2.1 会话必须明确知道自己的层级

会话应拥有独立、持久化的层级身份，例如：

```text
global  = 全局会话
project = 项目级会话
```

该身份由会话自身保存，创建时确定，加载历史会话时直接恢复。

`projectId` 只是项目级会话关联到具体项目的数据，不应兼任会话层级判定字段。因此，运行时不得继续使用以下规则判断全局会话：

```text
projectId 为空 => 全局会话
```

允许在旧数据的一次性迁移中根据 `projectId` 补齐历史会话层级，但迁移完成后不能继续依靠该关系动态推导。

### 2.2 全局会话目前只有 Chat

全局会话当前只承担通用助手/产品经理 Agent 职责，其产品形态固定为 Chat。

```text
全局会话层级：global
全局会话模式：chat
```

当前没有为全局会话提供编程、计划、ACP 或其他并列会话模式的产品需求。

全局会话是否能使用项目查询、全局任务、跨会话分派等能力，应由其明确的全局身份和工具可见性规则决定，而不是通过“没有项目”临时猜测。

### 2.3 协作模式只表达能力范围

会话的用户可见协作模式固定为：

```text
chat   = 只读协作
cowork = 完整协作
```

- `chat` 可以聊天、联网搜索、网页读取、项目搜索、文件读取、CodeGraph 和分析，但不能新建、修改或删除文件，也不能执行有副作用的 Shell、Git 等工具。
- `cowork` 可以使用完整项目工作能力，包括文件修改、Shell、Git 和子 Agent 等。
- 全局会话固定为 `global:chat`；全局 Chat 可以管理全局 Agent 自己的数据，例如项目/会话查询、全局任务、分派记录、向项目会话发消息和全局记忆，但不能直接修改项目工作区。
- 项目会话允许 `project:chat` 和 `project:cowork`。

计划、编程和 ACP 不再作为与 Chat/Cowork 并列的协作模式：Plan 是交互/执行策略，编程是任务内容，ACP 是具体执行后端或集成形态。现有 `Session.mode` 中的 `clarify`、`code`、`acp` 需要在迁移中拆回各自真实维度。

### 2.4 权限模式只适用于 Cowork

权限模式固定为：

```text
default    = 风险工具按策略审批
fullAccess = YOLO，在已开放能力范围内自动执行
```

协作模式决定模型能看到、能调用哪些工具；权限模式只决定 Cowork 中已允许的工具是否需要审批。权限模式不得扩大协作模式的能力范围。

- Chat 不显示权限按钮，也不读取 `fullAccess` 来开放写入或执行能力。
- Cowork 显示默认审批/YOLO 权限按钮。
- 即使收到非法组合 `chat + fullAccess`，Renderer 和 Worker 也必须按 Chat 能力上限处理，不能暴露或执行 Cowork 专属工具。
- 权限状态需要成为 Cowork 会话的显式持久状态；现有全局 `autoApprove` 仅是旧实现，不能继续作为所有现有会话实时共享的权限事实。

### 2.5 Goal 是后台运行实体，不是协作模式

Goal 由项目会话发起，但会话本身仍保持原有 `chat` 或 `cowork` 状态，不切换为“目标协作模式”。

Goal 应建模为独立的后台自主编排实体/运行实例：

- 运行角色可表达为 `goalRunner`、`goalSubAgent`；
- Goal 的重点过程、暂停、恢复和终止继续由右侧面板承载；
- Goal 权限在创建时从发起上下文确定并持久化到 Goal 实例，之后不随当前会话权限开关漂移；
- Goal Prompt、状态机和工具可见性由 runtime role 决定，不再通过用户会话的协作模式表达；
- SubAgent 同样是运行角色，不是用户可选协作模式。

本迭代不要求重做现有 Goal 任务表，但所有会话范围与工具筛选改造都必须避免继续强化 `goal` 是会话模式的旧模型。

### 2.6 “运行与性能”提供新会话默认值

现有设置页面准确名称为“运行与性能”，组件为 `RuntimePanel`。计划在该页面新增“会话默认值”设置：

```text
项目会话默认协作模式：chat | cowork
Cowork 默认权限模式：default | fullAccess
```

- 用户可以配置新建项目会话的默认组合；本次用户期望默认值为 `cowork + fullAccess`（UI 展示为“协作模式 + YOLO”）。
- 这些设置只用于创建新项目会话或首次初始化尚无显式状态的项目会话，不得覆盖已有会话持久化的 `collaborationMode` / `permissionMode`。
- 全局会话始终固定为 `global:chat`，不受项目会话默认 Cowork 设置影响。
- 当项目默认协作模式为 Chat 时，Cowork 默认权限仍可保留为下次切换/新建 Cowork 会话的默认值，但 Chat UI 不显示权限按钮。
- 设置字段应新增为语义明确的默认值字段；不得直接复用现有 `autoApprove` 作为新会话默认权限和当前会话权限的双重事实。

## 3. 当前实现中的概念混用

目前至少有四组不同语义共用了 `mode` 或相近名称。

### 3.1 前端持久化 `Session.mode`

当前类型：

```text
chat | clarify | cowork | code | acp
```

它主要描述前端会话/交互形态，但并没有明确表达会话是全局级还是项目级。

### 3.2 Agent 请求 `sessionMode`

当前常见值：

```text
normal | goal | global | subAgent | goalSubAgent
```

这里同时混入了：

- 会话层级：`global`；
- 普通运行状态：`normal`；
- Goal 运行状态：`goal`；
- 内部执行角色：`subAgent`、`goalSubAgent`。

这些值并不处于同一个维度。

### 3.3 `projectId`

当前部分前端代码通过目标会话是否有 `projectId`，或当前 Store 是否有 `activeProjectId`，推导请求应使用 `global` 还是 `normal`。

这使项目导航状态参与了会话身份判断。

### 3.4 工具 `availableModes`

当前工具通过以下形式声明可见性：

```text
availableModes: ["global"]
availableModes: ["goal"]
availableModes: ["normal", "goal", "global"]
```

由于 `availableModes` 同时接受会话层级、运行状态和内部 Agent 角色，它无法清晰表达一个工具究竟是：

- 只属于全局会话；
- 只属于项目会话；
- 只在 Goal 状态出现；
- 只供子 Agent 使用；
- 在所有层级的普通 Agent 中可用。

## 4. 已确认的历史全局会话缺陷

### 4.1 问题表现

加载历史全局会话后发送消息，运行时可能把它当成普通项目会话，导致：

- 请求携带项目 `projectId`；
- `sessionMode` 变成 `normal`；
- 全局 Agent Prompt 不再注入；
- 仅限全局会话的项目管理、全局任务和分派工具不可见；
- 记忆作用域进入具体项目，而不是全局作用域。

2026-08-29 的运行日志已经出现历史会话发送后进入具体项目作用域的记录。

### 4.2 直接原因

当前输入区优先读取目标会话的 `projectId`，但当其为空时会回退到全局 Store 的 `activeProjectId`：

```text
targetSession.projectId ?? store.activeProjectId
```

对于明确无项目关联的历史会话，这个回退会把其他项目的导航状态误认为当前会话身份。

应用启动恢复时还会在首个会话没有 `projectId` 的情况下，把 `activeProjectId` 设置为第一个项目，进一步稳定触发该问题。

### 4.3 根本原因

根本原因不是某一个 fallback 写错，而是会话没有独立持久化自己的层级身份，运行时只能从 `projectId`、`activeProjectId`、工作目录和 UI 状态反向猜测。

只修复当前 fallback 可以缓解现象，但不能保证侧栏切换、历史恢复、后台投递、自动化、子 Agent 和后续新入口不会再次发生身份漂移。

## 5. 当前认可的设计方向

### 5.1 三个正交维度

后续设计必须拆分并强类型表达：

```text
SessionScope       = global | project
CollaborationMode  = chat | cowork
RuntimeRole        = sessionAgent | goalRunner | subAgent | goalSubAgent | ...
```

- `SessionScope` 是会话持久身份。
- `CollaborationMode` 是用户可见、会话持久化的能力范围。
- `RuntimeRole` 是一次运行或后台实例的执行角色，不等同于会话模式。
- `PermissionMode = default | fullAccess` 是 Cowork 会话或后台实例的审批策略，不参与能力扩张。

合法的核心会话组合为：

```text
global:chat
project:chat
project:cowork
```

`global:cowork` 当前不是合法产品组合。`goalRunner`、`goalSubAgent` 和 `subAgent` 通过独立 runtime role 表达。

### 5.2 工具使用分维度声明与固定筛选顺序

工具元数据中混杂的 `availableModes` 应迁移为：

```text
AvailableScopes
AvailableCollaborationModes
AvailableRuntimeRoles
```

Worker 的工具可见性按以下顺序求交集：

1. Session scope；
2. Collaboration mode；
3. Runtime role；
4. Tool preset；
5. 用户功能设置；
6. Permission mode 仅在调用阶段决定是否审批，不决定模型是否看见工具。

这保证 Chat 即使携带 `fullAccess` 也看不到写文件、Shell、Git 等 Cowork 专属工具；Goal 工具也只会在匹配的 runtime role 中出现。

### 5.3 ToolPreset 与身份筛选职责分离

`ToolPreset` 与会话身份不是同一概念：

- scope、collaboration mode 和 runtime role 决定 Agent 是否有资格看到工具；
- ToolPreset 决定当前场景装载哪些能力类别；
- 用户设置再决定 WebSearch、CodeGraph 等可选能力是否启用；
- permission mode 只处理审批。

当前全局会话复用 `chat` preset，但 `chat` preset 没有允许 `global-task` 类别，导致部分全局任务工具即使声明为 `availableModes: ["global"]`，仍会在 mode 筛选前被 preset 排除。

后续需要为 `global:chat` 明确工具能力集合：允许管理全局 Agent 自身数据和跨会话协调，但不得因为调整 preset 而获得项目工作区写入能力。

### 5.4 Prompt 和记忆作用域使用明确层级

全局 Prompt、项目 Prompt以及全局/项目记忆作用域，都应读取会话自身保存的层级。

不得继续根据以下信息猜测会话身份：

- `activeProjectId`；
- 是否有工作目录；
- 当前打开了哪个侧栏项目；
- 当前 UI 是 Chat 还是 Cowork；
- 某个请求是否临时携带 `projectId`。

## 6. 需要修订的迭代 24 旧假设

迭代 24 的现有 Plan A 和合规报告仍包含以下旧表述：

```text
无项目会话即全局 Agent
全局 Agent 复用 sessionMode='global'
不新增会话身份字段
```

这些表述基于旧实现，已不能作为后续实施依据。

受影响文档至少包括：

- `docs/plans/iter-v2-24/plan-task-panel/plan.md`；
- `docs/plans/iter-v2-24/compliance_report.md`；
- 可能引用同一结论的进度和新会话提示文档。

这些文档必须在代码实施前统一修订，避免计划继续指导实现使用 `projectId` 推导全局身份；本轮已经同步更新迭代总览、Plan A、Plan B 和合规报告。

## 7. 实施前仍需细化的问题

### 7.1 Plan/Clarify/ACP 的字段归属

已确认 Plan、编程和 ACP 不是协作模式。实施时仍需逐一盘点现有 `Session.mode` 使用点，将它们迁移到交互策略、任务内容或执行后端等真实字段，避免一次性删除造成历史会话和 UI 回归。

### 7.2 内部 Agent 上下文

`subAgent`、`goalSubAgent`、Automation、Channel、Pet 等路径需要逐一映射到 `RuntimeRole`，并明确继承哪个 scope、collaboration mode 和 permission mode。它们不是用户可见的协作模式。

Goal 的既有数据表本迭代不重做，但 Goal 创建时的权限快照、后台运行恢复和工具角色筛选必须进入实施设计。

### 7.3 历史数据迁移

需要确认：

- 新增层级字段的最终名称；
- 旧数据如何一次性补齐；
- 项目级但历史 `projectId` 异常为空的数据如何处理；
- 插件/频道会话默认属于哪个层级；
- Worker 收到身份与 `projectId` 不一致的请求时，是拒绝、修复还是记录错误。

## 8. 后续方案必须满足的约束

后续无论采用哪一种字段名和工具匹配实现，都必须满足：

1. 历史全局会话重启后仍明确是全局会话；
2. 从项目会话切换到全局会话不会继承旧项目身份；
3. 全局会话固定使用 Chat 产品形态，且不能直接修改项目工作区；
4. 项目会话明确持久化 Chat/Cowork，计划和编程不再是协作模式；
5. Chat 只获得只读能力，且完全不显示权限按钮；
6. Cowork 才允许 `default/fullAccess`，`fullAccess` 不得突破 Cowork 已开放的能力边界；
7. “运行与性能”的默认协作模式和默认权限只影响新项目会话，不覆盖已有会话；
8. 全局专属工具不会出现在项目会话，项目写入工具不会泄露给全局 Chat；
9. Goal 作为后台运行实体持久化自己的权限，工具可见性由 runtime role 决定；
10. Prompt、记忆、工具和工作目录使用同一份会话层级事实；
11. Renderer、Worker 和数据库对 scope、collaboration mode、runtime role 的理解一致；
12. 缺少、冲突或非法身份组合时不得静默回退为其他身份。

## 9. 当前结论

当前已经确定：

- 会话必须显式持久化 `SessionScope = global | project`；
- 协作模式为 `CollaborationMode = chat | cowork`，合法核心组合是 `global:chat`、`project:chat`、`project:cowork`；
- Chat 是只读协作且不显示权限按钮，Cowork 是完整协作；
- `PermissionMode = default | fullAccess` 只适用于 Cowork，不能扩张工具能力范围；
- “运行与性能”提供新项目会话的默认协作模式和 Cowork 默认权限，用户期望默认 `cowork + fullAccess/YOLO`；
- 默认设置不得覆盖已有会话的显式状态，全局会话不受项目默认值影响；
- Goal 是后台运行实体，Plan 是交互/执行策略，编程是任务内容，SubAgent 是运行角色，均不是协作模式；
- 当前 `sessionMode` 和 `availableModes` 混合多个维度，必须拆成 scope、collaboration mode 和 runtime role；
- 工具筛选按 scope → collaboration mode → runtime role → preset → 功能设置求交集，permission mode 只负责审批。

迭代 24 后续实现不得继续沿用“无项目会话自动等于全局会话”或“Goal 是会话协作模式”的旧假设。
