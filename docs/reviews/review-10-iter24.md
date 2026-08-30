# 代码审查报告 10：v2-iter-24 全面复核

> 审查范围：`v0.2.23..HEAD`（22 commits，126 文件，+8546/-805）——会话作用域/协作模式模型、Plan A 全局代理与 Task Board、Plan B 会话 Todo、工具可见性策略
> 审查时间：2026-08-30
> 审查基线：`dev/v2-iter-24`，HEAD `48bf595 refactor(persona): 精简内置人格文件，保持语义一致`
> 审查方式：5 路并行审查——① C# 数据层（DDL/迁移/Entity/AOT/级联）② C# Agent 层（执行器/策略/提示词/事件）③ 前端功能层（Task Board/Stores/InputArea）④ 前端连线与主进程（IPC/通道/生命周期）⑤ 工具体系盘点（作为精简分析的输入，单独成文）
> 说明：本报告只记录审查结论，不修改业务代码。修复顺序建议见 §7。

---

## §1 总体结论

迭代主干质量良好：两套任务体系（全局任务 / 会话 Todo）隔离边界执行干净，迁移对老库安全幂等，AOT/注入/级联/事件链路端到端核对一致，i18n 完整，无监听器泄漏。

**但存在 2 个建议合并前修复的阻断项**：

1. use_capability 代理路径绕过 `AgentRunContextPolicy`，全局 Agent 可经 `builtin:Task*` 读写会话 Todo——直接违反本迭代核心边界「全局 Agent 不读不写会话 Todo」；
2. Task Board 部分更新会把 `undefined` 字段经 MessagePack 序列化为 nil，与 Worker ApplyPatch 语义叠加后造成数据损坏（改状态清截止日期、编辑保存静默解除归档）。

另有 10 个重要项（⚠️）与若干建议项（💡），详见下文。

---

## §2 ❌ 阻断项

### I24-1 use_capability 代理绕过上下文策略，全局 Agent 可读写会话 Todo

**位置**：

- `src/runtime/WishfulClaw.Agent/AgentRuntimeUseCapabilityExecutor.cs:299-313`、`AgentRuntimeUseCapabilityDiscovery.cs:142-160`
- `src/runtime/WishfulClaw.Agent/Tools/Providers/TaskToolProvider.cs:23-74`

**问题**：

本迭代把 `"task"` 加入代理的 ProxiedCategories（Executor:37），但代理的 list/call 只校验 `registry.IsAvailableInMode()`，不套用 `AgentRunContextPolicy.IsToolAllowed`。而 TaskToolProvider 注册 TaskCreate/Get/Update/List 时未声明 availableModes → `IsAvailableInMode` 对空 modes 恒返回 true。

后果：全局会话 `use_capability list` 会列出 `builtin:TaskCreate` 等 4 个工具，`action=call` 可直接执行——全局 Agent 能创建/读取/修改/删除会话 Todo 行。反向（项目会话 → global_tasks）被 availableModes=["global"] 正确挡住，无问题。

**修复方向**：代理的 call 与 list 同样套用 `AgentRunContextPolicy.IsToolAllowed(runContext, toolName, category)`（ToolCallProcessor 直接调用路径已有此检查，代理路径缺失）。一行级改动。**此项是后续「更多工具移入代理」精简方案（见 `docs/tool-slimming-analysis.md`）的先决条件。**

### I24-2 Task Board 部分更新经 MessagePack nil 语义造成数据损坏

**位置**：

- `src/renderer/src/stores/task-board-store.ts:164-175`
- `src/runtime/WishfulClaw.Infrastructure/Db/DbGlobalTaskTools.cs:180-183`（ApplyPatch）

**问题**：

`updateTask` 无条件序列化全部 7 个 patch 字段，`undefined` 经 MessagePack 变 `nil`（→ Worker 侧 JSON `null`）；而 ApplyPatch 对「存在但非数字」的 `dueAt` 置 null、对「存在但非 true」的 `archived` 置 0。

后果：

- 详情面板只改状态/优先级就会**清掉任务截止日期**；
- 对已归档任务改状态、或在编辑对话框保存（不传 archived）会**静默解除归档**。

**修复方向**：前端只发送有定义的键（最省事）；或 Worker 把 null 视为「不变」、用显式标志表达 `dueAt:=null` 语义。

---

## §3 ⚠️ 重要项

### A. 隔离与安全纵深

**I24-3 TaskGet/TaskUpdate 缺 sessionId 时退化为跨会话查询**
`AgentRuntimeTaskExecutor.cs:90-138` + `.Db.cs:155-163`：`LoadTask` 在 sessionId 为空时按 `WHERE id=@id` 无会话过滤查库，可读/改/删（status="deleted" 物理删除）任意会话 Todo。taskId 为 8 字符随机不易猜中，但属隔离纵深的洞。修复：Get/Update 对空 sessionId 直接报错。

**I24-4 dispatch 目标会话只校验存在性，不校验 scope**
`DbGlobalTaskDispatchTools.cs:98-112`：可把 work request 发给 `scope='global'` 的会话。投递走 `project-send-message.ts:105` 默认 `sessionMode='normal'`，该轮全局宿主退化为 normal 身份（无 global prompt/工具），且目标收不到 `reply_global_dispatch`（modes 仅 normal/goal）→ dispatch 永远等不到回复。修复：Create 拒绝非 project scope 目标。

**I24-5 reply_global_dispatch 不校验调用方即目标会话**
`AgentRuntimeGlobalDispatchReplyExecutor.cs:41-56`：任意持有 dispatchId 的会话都能回复任意 dispatch，且投递给全局会话的 `from_session` 取自 dispatch 行——A 会话可让全局 Agent 误以为是 B 会话的汇报。修复：校验 `parameters.sessionId == dispatch.session_id`（一行）。

**I24-6 身份回退静默化，违反设计约束 12**
`AgentRunContextPolicy.cs:82-91`：无显式 scope 时用「projectId 与 workingFolder 均空 ⇒ global」推导（设计文档 §2.1 明令运行时禁用该启发式）；显式 `scope=project` 但 projectId 空时被静默改写为 global（丢失项目记忆作用域与 Todo 工具、获得全局工具）。至少应记 WorkerLog.Warn，显式冲突应返回错误。

**I24-7 PromptBuilder 未按 scope 清洗原始参数**
`PromptBuilder.cs:49-57,186-211`：AgentLoop/ToolCallProcessor 已对 scope=global 置空 projectId/workingFolder/sshConnectionId，但 PromptBuilder 的 SSH/项目上下文段与 `BuildMemoryContext`（MEMORY.md 注入）仍读原始 parameters。若 global 请求夹带 workingFolder，会向全局 Agent 注入项目上下文并召回项目 MEMORY.md。修复：复用 AgentRunContextPolicy 做同样置空。

### B. 数据一致性与并发

**I24-8 Update 为跨连接无事务全行覆写，并发写静默丢失**
`DbGlobalTaskDispatchTools.cs:139-175`、`DbGlobalTaskTools.cs:103-140`、`DbTaskTools.cs:100-139`：read-modify-write 分属两个连接、无事务/乐观并发。dispatch 行会同时被 Agent 回复路径（latest_report/status）与 Task Board UI（cancel/改状态）写入，并发时一方 patch 被静默丢弃。修复：`ExecuteInTransaction` 内读改写，或改为只 SET 目标列的局部更新。

**I24-9 dispatch Create 存在 check-then-insert TOCTOU**
`DbGlobalTaskDispatchTools.cs:93-132`：三次存在性/一致性校验与 INSERT 分属 4 个独立连接，目标会话中途被删会留下悬空分派（虽有投递失败兜底，应在写入时拦截）。修复：包进单个 `ExecuteInTransaction`。

**I24-10 Archive 对不存在 id 返回成功**
`DbGlobalTaskTools.cs:143-164`：`Success=true, Changed=0`，与 Update 的「not found」语义不一致，UI 会误报归档成功。参照 Cancel（`DbGlobalTaskDispatchTools.cs:198-199`）在 changed==0 时返回错误。

### C. 行为与承诺一致性

**I24-11 automation 权限承诺与实现不一致**
`src/renderer/src/lib/tools/cron-runtime.ts:418` 把 Automation 运行的 `permissionMode` 从硬编码 `'fullAccess'` 改为 `targetSession.permissionMode`，但 `AutomationTaskFormDialog.tsx:450-454` 仍静态展示「YOLO/完全访问」文案。若复用会话是 cowork+default，非交互定时运行会撞审批门停摆。修复：恢复 fullAccess 语义，或文案反映真实权限。

**I24-12 分派投递 fire-and-forget 误报成功**
`src/renderer/src/lib/tools/project-send-message.ts:104-134`：`sendMessage` 返回的 `Promise<boolean>` 完全未检查即返回 `{ success: true }`；Worker 端 `ExtractDeliveryFailure` 只能捕获同步失败。目标会话随后启动 turn 失败（无 provider、会话被删）时分派仍记 `sent`，Task Board 误报。修复：至少检查布尔结果并经 `refreshDispatchStatus` 回写；建议 await 入队结果。

**I24-13 InputArea TodoStatusList 数据源与渲染守卫会话不一致**
`src/renderer/src/components/chat/InputArea/index.tsx:83,383-386`：数据源 `useTaskStore.tasks` 跟随 `currentSessionId`（只与全局 `activeSessionId` 同步），渲染守卫却用 `draftSessionId`。InputArea 带 `sessionId` prop 指向非活动会话时（如 `settings/floating-chat-window.tsx:120`）会显示错会话的 Todo。修复：改用 `getTasksBySession(draftSessionId)`。

**I24-14 Task Board「打开目标会话」对已删除会话仍可点击**
`src/renderer/src/components/taskboard/TaskDetailPane.tsx:231-238`：`navigateToSession` 会把 `activeSessionId` 指向不存在的会话导致空白聊天区。修复：会话不存在时禁用按钮。

### D. 可观测性与工程规范

**I24-15 主进程分派回复失败路径不进统一日志**
`src/main/ipc/native-agent-runtime.ts:298-304`（及 155/187 行）：reverse-response 发送失败只 `console.warn`，主进程无 console 拦截器——该路径是分派回复路由的关键失败点，排障时无迹可寻。修复：改用 `logWarn('main', ...)`（一行）。

**I24-16 PromptBuilder 身份 prompt 与工具过滤依据脱钩**
`PromptBuilder.cs:60-70` vs `AgentLoop.cs:151-155`：AgentLoop 用解析后的 mode 做工具过滤与缓存键，PromptBuilder 读原始 `parameters.sessionMode`。若请求带 `scope=global` 而无 `sessionMode`：工具集按 global 收敛、Todo 段被豁免，但 `<global_agent>` 身份段不注入——全局 Agent 无身份说明却拿到全局工具。修复：把解析后的 sessionMode 传入 PromptBuilder。

**I24-17 InputArea 559 行超红线**
`src/renderer/src/components/chat/InputArea/index.tsx`：超 agents.md「超 500 行必须拆分」。方向：把协作/权限模式推导（84-88、295-302、324-329）或 Todo 展示块抽出。

**I24-18 qr-page-capture 无超时，隐藏窗口可能泄漏**
`src/main/ipc/channel-handlers/qr-page-capture.ts:123`：`win.loadURL(url)` 无超时，远端挂起时 Promise 永不 settle，`finally` 不执行 → BrowserWindow 泄漏。修复：`Promise.race` 超时后 `win.destroy()`。`channel-handler-utils.ts` 的 fetch 同样无超时。

---

## §4 💡 建议项（择要）

1. **枚举白名单缺失**：三个 ApplyPatch 的 status/priority/kind 接受任意字符串入库；dispatch 可在 status≠completed 时写 completedAt（`DbTaskTools.cs:175`、`DbGlobalTaskTools.cs:168`、`DbGlobalTaskDispatchTools.cs:208`）。
2. **LIKE 通配符未转义**：`DbGlobalTaskTools.cs:44` 关键字含 `%`/`_` 时行为异常（非安全问题，已参数化）。
3. **索引与查询不匹配**：`ix_global_tasks_status/archived` 为单列索引，实际按 `archived+status` 过滤、`updated_at` 排序——建议复合索引 `(archived, status, updated_at)`；`ix_tasks_plan` 基本无查询收益低（`DbClient.cs:371,384-385`）。
4. **"sent" 覆盖竞态**：投递成功无条件 patch status="sent"，极速回复会把 in_progress 改回 sent；取消时 dispatch 留 pending 无失败记录（`AgentRuntimeGlobalTaskExecutor.cs:267-279,287`）。
5. **孤儿行**：`DbTaskTools.cs` Create 不校验 sessionId 存在，可对已删会话写入永不被级联清理的行；`GlobalTaskListResult/DispatchListResult` 已注册但端点返回裸 `List<T>`，属死注册（无害）。
6. **日志惯例不一致**：Task/GlobalTask 系 catch 只记 `ex.Message`，`DbSessionTools.cs:62` 记了 StackTrace，建议统一；`NormalizeSessionContext` 的校验错误直接透出异常消息，建议结构化。
7. **task-store-helpers 全静默**：`task-store-helpers.ts:42-54` 全部 `.catch(() => {})`，叠加 main handler 返回 `{ error }` 信封——会话 Todo 持久化失败完全无日志；且 `DbTaskTools.cs:30` 错误信封形状与 renderer 期望的 `TaskRow[]` 不一致。
8. **文件过长**：`AgentRuntimeGlobalTaskExecutor.cs` 544 行超红线，建议拆 partial。
9. **Task 工具描述动态增长**：随子代理定义数增长，除字符膨胀外会击穿 prefix cache 稳定性。
10. **小项**：use-permission-mode.ts:39 useCallback 依赖 `[opts]` 每渲染重建；TaskFormDialog.tsx:88 dueAt NaN 无校验；TaskBoardPage handleTaskSaved 冗余重载分派；db:tasks:get:msgpack 死端点；事件广播到辅助窗口（无害噪音）。

---

## §5 专项事项

### S1 提交 b0e452b「iter24-workspace-changes」命名与粒度问题

80 文件 +2380/-730 的兜底式提交，混杂至少 5 个功能单元：① 会话作用域/协作模式 context 管道；② 会话默认值设置（settings v34）；③ cron thinking/reasoningEffort 端到端；④ 渠道二维码登录重写（含 sandbox/contextIsolation 安全加固）；⑤ CollabModeSwitcher/InputArea 语义改造与 tasks-store DB 化。违反仓库 `feat/fix(scope): 描述` 规范与「功能单元一提交」约定，且压在 Plan A 功能提交之后，bisect/回滚无法按功能边界切分。**建议后续迭代避免此类工作区倾倒式提交**（本次不改写历史）。

### S2 Worker 项目下的死人格副本

`src/runtime/WishfulClaw.Worker/Resources/Personas/` 存在一份人格文件死副本：无 csproj 资源声明或代码引用（生效的是 `WishfulClaw.Persona/Resources/Personas/`），且 default 内容已与生效版本分叉。建议确认后删除。详见 `docs/persona-slimming-record.md`。

### S3 疑似既有隐患：openai-responses 协议聊天流注入 0 工具

聊天主流程不携带 `parameters.tools`（`use-chat-actions.ts:154-162` 明确丢弃），而 Responses 协议的 InputWriter 直接序列化该字段、不走 registry（`OpenAIResponsesInputWriter.cs:237-263`）——即 Responses 协议的聊天会话可能一个工具都注入不到。超出本迭代范畴，但建议优先核实是否为 bug。

### S4 automation 的 sessionMode:"agent" 不匹配任何 availableModes

`cron-runtime.ts:489`：导致所有带模式限制的工具（包括 Cron*/Desktop* 自身）被排除，属正确性问题。详见 `docs/tool-slimming-analysis.md` §二.2。

---

## §6 已核查、未发现问题的项（摘要）

- **数据层**：3 张新表 `CREATE TABLE IF NOT EXISTS` + EnsureColumn + 幂等 backfill，老库迁移安全；Entity↔Mapper↔Row 逐字段一致；AOT 全注册（含 `List<T>`）；全参数绑定无注入；全库无 `DELETE FROM global*`、级联只删 `tasks` 不碰 dispatch——符合「只归档不删除、分派永久保留」；所有会话删除位点（6 处）事务内同步清理 `tasks`。
- **Agent 层**：AOT 合规；事件全部 await + try/catch 降级、载荷仅含 id 无跨会话泄漏；投递失败两路均落 failed+error，回复投递失败降级为「已记录未送达」；CancellationToken 正确透传。
- **前端功能层**：两套任务体系严格隔离（Task Board 不展示会话 Todo、全局任务无删除入口）；选择器 useShallow 稳定；事件订阅清理与竞态守卫到位；taskboard i18n 103 键 zh/en 对称；Tailwind v4 无动态类名；`tsc --noEmit -p tsconfig.web.json` 0 错误。
- **连线层**：`db:tasks:*` 通道名/参数形状/返回形状三端逐一核对一致；回复路由（`project/send-session-message`）全链路参数匹配、窗口缺失降级完整、30s 超时合理；`global/task-changed`/`dispatch-changed` 编解码链路完整；settings v33→v34 迁移不覆盖已有显式值；监听器无泄漏。

---

## §7 建议修复顺序

1. **I24-1**（代理越权，一行级）——同时是工具精简方案的先决条件
2. **I24-2**（数据损坏）+ **I24-12**（误报成功）——用户可见的行为缺陷
3. **I24-3 ~ I24-7**（隔离纵深五件套，均为小改动）
4. **I24-8 ~ I24-10**（并发与语义一致性）
5. **I24-11、I24-13 ~ I24-18**（行为一致性与工程规范）
6. §4 建议项随手修；§5 专项事项（S1 不改写历史、S2 删除死副本、S3 核实、S4 与工具精简一并处理）
