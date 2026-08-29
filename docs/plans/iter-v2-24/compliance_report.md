# 规划合规审查报告 — v2-iter-24（Plan A / Plan B）

> 审查对象：
> - Plan A：`docs/plans/iter-v2-24/plan-task-panel/plan.md`（全局任务面板）
> - Plan B：`docs/plans/iter-v2-24/plan-session-tasks/plan.md`（会话级任务）
>
> 审查依据：`AGENTS.md`（7 层架构 / AOT 规范 / 目录约定）、`docs/dev-workflow.md`（plan.md 格式）
> 审查方式：只读核实，全部结论均有代码库实证。

---

## 逐检查项结论表

| # | 检查项 | Plan A | Plan B | 理由与实证 |
|---|--------|:------:|:------:|------------|
| 1 | 步骤完整覆盖任务目标 | ✅ | ❌ | **Plan A**：DB→IPC→store→UI→agent 工具→prompt→实时同步，闭环完整，无遗漏。**Plan B**：六步本身覆盖流程，但**漏掉了与既有实现的对接/替换环节**（详见检查项 7）：项目内已存在 `TaskCreate/TaskGet/TaskUpdate/TaskList` 工具链（内存版）与前端配套组件，计划通篇未提及移除、改造或复用，直接"新建"会产生双份实现与重复注册。 |
| 2 | 每步有明确验证检查点 | ✅ | ✅ | 两份计划的每个步骤均带"验证："行（编译零错误 / AOT 0 警告 / 手工走通 / 日志核验），且文末有整体验证标准，符合 dev-workflow.md 要求。 |
| 3 | 文件路径符合项目结构 | ✅ | ⚠️ | 抽查全部真实存在：`DbClient.cs`、`Persona/PromptBuilder.cs`、`main/ipc/messagepack-handler.ts`、`MainLayout.tsx`（`taskBoardPageOpen` → PlaceholderPage 见 L89）✅；`Infrastructure/Db/Entities/` 目录、`Agent/Tools/<分类>/` 子目录惯例均存在 ✅。**⚠️ 两点**：(a) 两份计划均未列入 `src/shared/messagepack/binary-ipc.ts`——项目惯例是通道常量定义于此（见 `DB_PLANS_DELETE_MSGPACK_CHANNEL` 等），handler 用 `registerMessagePackHandler` 注册；(b) Plan B 新建 `session-task-store.ts` / `session-task-card.tsx` 与**已存在**的 `stores/task-store.ts`（417 行）、`components/chat/TodoCard.tsx` 重复。 |
| 4 | 分层依赖正确性 | ✅ | ✅ | ① Agent 工具直读 `DbClient`（Infrastructure）：Agent 依赖 Infrastructure 属允许方向，且与 Goal 链路同构 ✅；② PromptBuilder（Persona）注入 `<task_management>` 段：PromptBuilder 已有参数驱动注入先例（`sessionMode=goal → BuildGoalModePrompt()`、`BuildToolCapability(parameters)`），只读 `JsonElement` 参数、不反向依赖 Agent，**无分层问题**（注意需由调用方传入工具可用标记，计划未写明传参链路，执行时留意）✅；③ `DbGlobalTaskTools` 放 Infrastructure/Db：该目录已有 17 个 `Db*Tools`（DbGoalTaskTools / DbSessionTools / DbCronTools…），惯例吻合；Session/Global 业务工具放 Agent/Tools 与 Goal 工具分布一致 ✅。 |
| 5 | AOT 规范覆盖 | ✅ | ✅ | 两份计划均明确：具名 Entity 类、序列化类型注册进对应 `JsonSerializerContext`（含 `List<GlobalTaskRow>` / `List<SessionTaskRow>` 泛型）、`dotnet build` 0 错误 + `scripts/publish-aot-worker.mjs` AOT 0 警告。三个 Context（`WishfulClawJsonContext` / `AgentRuntimeJsonContext` / `InfrastructureJsonContext`）均真实存在，注册落点明确。 |
| 6 | 参考源码真实存在 | ✅ | ✅ | 实测 `D:\koda\OpenCowork` 全部命中：`sidecars\OpenCowork.Native.Worker\Modules\AgentRuntime\AgentRuntimeTaskExecutor.cs`（32KB）、`src\renderer\src\stores\task-store.ts`（18KB）、`Modules\Db\DbSchemaMigrator.cs`、`components\chat\TodoCard.tsx`、`components\cowork\StepsPanel.tsx`、`lib\agent\system-prompt.ts` 均存在（行号 L328/L409 未逐一核验，不影响结论）。 |
| 7 | 工具命名冲突 | ✅ | ❌ | **Plan A**：全库检索无 `GlobalTask` / `global_tasks`，无冲突；现有子 Agent 分派工具名确认为 `"Task"`（`TaskTool.cs` L23 `Name => "Task"`），`GlobalTask*` 前缀不撞车 ✅。**Plan B 阻断**：`TaskCreate/TaskGet/TaskUpdate/TaskList` **四个名字已被占用**——`Tools/Providers/TaskToolProvider.cs` 已在 `ToolModule.cs` L53 注册，`ToolDispatchRouter.cs` L212 已把四工具路由到 `AgentRuntimeTaskExecutor`（内存版 ConcurrentDictionary 实现）；前端 `lib/tools/todo-tool.ts`（`registerTaskTools`）、`TodoCard.tsx`、`execution-outline.ts`、`tool-call-summary.ts`、`TeamEventCard.tsx` 均已按这些名字渲染。计划决策记录只写了"与现有子 Agent 的 Task 工具不冲突"，**误判了冲突对象**。另：`shared/messagepack/binary-ipc.ts` L90-95 已定义 `db:tasks:*` 全套通道常量且 `task-store.ts` 已在使用（主进程侧尚未注册 handler，属半截迁移），计划拟新建 `db:session-tasks:*` 通道与之重复。 |
| 8 | 流式事件扩展点 | ✅ | ✅ | 实证存在可用扩展点：`Agent/Models/StreamEventModels.cs` 的 `AgentRuntimeStreamEvent` 为扁平 record + `Type` 字符串，新增事件类型有充分先例（`memory_recall`（`AgentLoop.MemoryRecall.cs` L123）、sub-agent 事件、`context_compression` 事件均为同款增量字段扩展）。`global_task_changed` / `session_task_changed` 可照此扩展。**备注**：Plan A"涉及文件"未列入流式事件编码器与前端事件 codec 的改动，执行时需补。 |

---

## 汇总

| 结论 | 数量 | 明细 |
|------|:----:|------|
| ✅ | 13 | 检查项 2/4/5/6/8（双计划）、1-A、3-A、7-A |
| ⚠️ | 1 | 检查项 3（Plan B：与既有前端文件重复 + 两份计划均漏列 `binary-ipc.ts`） |
| ❌ | 2 | 检查项 1（Plan B）、检查项 7（Plan B） |

> 按检查项 × 计划共 16 格计。

---

## 阻断项清单（❌）

**阻断项 1（检查项 7）：Plan B 工具名与已注册工具链直接冲突**

- 事实：`TaskCreate/TaskGet/TaskUpdate/TaskList` 已由 `TaskToolProvider`（注册于 `ToolModule.cs`）+ `AgentRuntimeTaskExecutor`（内存实现，`ToolDispatchRouter` 路由）占用；前端 `todo-tool.ts` / `TodoCard.tsx` 等亦按此名字工作。
- 后果：若按计划"新建 `Tools/SessionTaskTools/` 并以同名对 agent 暴露"，将出现工具重复注册与路由二义性；现有内存实现与前端组件悬空。
- 处置建议（二选一，写进 plan）：
  1. **改造式**：复用现有 `TaskToolProvider` 的四个工具名与 schema，把 `AgentRuntimeTaskExecutor` 的内存存储替换为 `session_tasks` 表读写（即计划步骤 2 的落点改为"改造"而非"新建"），同时移除 `todo-tool.ts` 的 native-only 占位。
  2. **替换式**：保留新建方案，但必须在步骤中显式列出：移除/改造 `TaskToolProvider`、`AgentRuntimeTaskExecutor`、`ToolDispatchRouter` 路由分支、`todo-tool.ts` 注册、`TodoCard`/`execution-outline`/`tool-call-summary`/`TeamEventCard` 中的既有引用。

**阻断项 2（检查项 1）：Plan B 步骤清单遗漏既有资产处置环节**

- 事实：项目内已存在半截迁移成果——渲染进程 `stores/task-store.ts`（417 行，含 `tasksBySession` 缓存、会话清理）+ `task-store-helpers.ts` + `shared/messagepack/binary-ipc.ts` 的 `db:tasks:*` 六通道常量（主进程侧无 handler 注册）。
- 后果：按计划新建 `session-task-store.ts` + `db:session-tasks:*` 通道，会形成两套并存的会话任务前端/通道，后续维护与排查成本翻倍。
- 处置建议：在步骤清单中增加"既有任务链路处置"步骤——复用并补全 `task-store.ts` 与 `db:tasks:*` 常量（注册对应主进程 handler），删除冗余新建；或明确废弃并删除上述文件，二选一并写清验证检查点。

---

## 非阻断建议（⚠️）

1. 两份计划的"涉及文件"补充 `src/shared/messagepack/binary-ipc.ts`（通道常量定义惯例所在）。
2. Plan A 步骤 7 补充流式事件编码器 / 前端事件 codec 的涉及文件。
3. 两份计划的 Prompt 注入步骤补充"工具可用标记如何从 Agent/Worker 传入 PromptBuilder 的 `parameters`"（PromptBuilder 只读参数，不会主动感知工具注册状态）。
4. Plan B 参考源码中的行号（DbSchemaMigrator.cs L328、system-prompt.ts L409）建议执行前复核，防止参考版本漂移。

---

**审查结论：Plan A 合规，可进入用户确认环节；Plan B 存在 2 个阻断项（❌），按阻断规则（❌ > 0 禁止进入用户确认）须先修订计划再送审。**

---

## 复审记录（2026-08-29，Plan B 修订后）

Plan B 已按“改造式”建议修订（复用四工具名与既有前端链路，新建 `tasks` 表 + 补全 `db:tasks:*` handler，不新建并行实现）。复审结论：**通过**。

- 阻断项已消除：无重复注册/重复通道；实测 `src/main` 无任何 `db:tasks:*` handler，属补全而非重复。
- 自洽性成立：步骤1 DDL 14 字段与 `task-store-helpers.ts` 的 `TaskRow` 逐字段对齐；`ToolDispatchRouter` 同步调用签名可保持不变；sessionId 经 `parameters` 传入、`DbClient.GetClient(parameters)` 取库，兼容。
- 非阻断提醒已并入计划：`TaskToolProvider` inputSchema 需同步补可选参数（仅加参数不改工具名）；`DbTaskTools` 契约注意前端入参 camelCase / 返回行 snake_case。

**最终结论：Plan A + Plan B 均合规，可进入用户确认环节。**
