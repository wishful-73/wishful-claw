# S-191 勘测：子 agent 查询工具（SubAgentStatus / SubAgentDetail）现状

> 类型：只读勘测（未改任何文件、未 commit、未跑构建/测试）。
> 日期：2026-10-12。工作目录：`D:\claw\wishful-claw`（Windows / PowerShell 5.1）。
> 触发：老大提出「感觉可以增加一个方法查看当前会话活跃子 agent 列表，或者最近子 agent 列表」。
> 对象：内置 `Task` 工具说明里提到的两个查询工具 —— `SubAgentStatus` / `SubAgentDetail`。

---

## ① 一句话结论

两个工具**已存在且可用**（Worker 侧 C# 实现，类别 `task`，经 `use_capability` 代理可达），数据源是 **Worker 进程内的一张静态内存表 `BackgroundSubAgentRegistry`**；该表**没有 sessionId、不持久化**，所以主 agent 调 `SubAgentStatus`（省略 `toolUseId`）**只能列出「本进程内全部子 agent」，没有「当前会话」这个维度**，「最近」也只在内存里保留最后 100 条终态记录；**唯一带 `session_id` 的权威记录在 DB 表 `sub_agent_runs`，但那条通路只对渲染端（IPC）开放，主 agent 拿不到**。

---

## ② 逐问题证据

### Q1. 两个工具现在是否存在？定义在哪、给谁用、参数是什么、返回什么？

**存在。** 定义在 Worker 侧同一个文件里，两个 `IToolExecutor`：

- `src/runtime/WishfulClaw.Agent/Tools/SubAgentStatusTool.cs:11-65` —— `SubAgentStatusTool`
  - `:13` `public string Name => "SubAgentStatus";`
  - `:15-17` 描述：`"Check a sub-agent's status by toolUseId; includes its final report (truncated) when finished. Omit toolUseId to list all sub-agents. Use SubAgentDetail for the full report and tool call log."`
  - `:19` `public string[]? VisibleScopes => ToolVisibilityScopes.Everywhere;`
  - `:21-33` schema：唯一可选参数 `toolUseId`（string），`"required": []`
  - `:35-64` `ExecuteAsync`：省略 `toolUseId` → `GetAll()` 全量列表（`:41-52`）；带 `toolUseId` → `Get(toolUseId)` 单条（`:55-63`），查不到返回 `IsError=true`
- `src/runtime/WishfulClaw.Agent/Tools/SubAgentStatusTool.cs:71-114` —— `SubAgentDetailTool`
  - `:73` `public string Name => "SubAgentDetail";`
  - `:79` `VisibleScopes => ToolVisibilityScopes.Everywhere;`
  - `:81-93` schema：`toolUseId` **必填**（`:91` `"required": ["toolUseId"]`）
  - `:95-113`：只按 id 查单条，返回 `FormatDetail(record)`；无 id 直接报错（`:98-102`）

**给谁用 —— 工具面准入（三层）**：

- **注册点**：`src/runtime/WishfulClaw.Agent/Tools/ToolModule.cs:155-159`
  ```
  155  registry.Register(new TaskTool(), "task");
  158  registry.Register(new SubAgentStatusTool(), "task");
  159  registry.Register(new SubAgentDetailTool(), "task");
  ```
  两者都归 **`task` 类别**。
- **可见范围 = 任何运行上下文**：`src/runtime/WishfulClaw.Core/Tools/ToolVisibilityScopes.cs:24`
  `public static readonly string[] Everywhere = ["*"];`（注释 `:19-24`：读/查/回忆类，子 agent 也可用）。所以按 `VisibleScopes` 判定，主 agent、全局侧、项目会话、子 agent 本身**都允许**。
- **但不在「直连注入」名单里**：`src/runtime/WishfulClaw.Core/Tools/ToolCategoryCatalog.cs:93-96`
  ```
  93  public static IReadOnlyList<string> Core { get; } =
  94  [ "file", "search", "shell", "todo", "memory", "plan", "capability", "codegraph" ];
  ```
  `task` **不在** `Core`。`ToolCategoryCatalog.cs:37-42` 注释明写：iter-30 把 `todo` 拆出后，`Task / SubAgentStatus / SubAgentDetail`「留在代理后面」。
  ⇒ 两个工具**不进模型直连工具表**，只能经 `use_capability` 代理调用（`builtin:SubAgentStatus` / `builtin:SubAgentDetail`），见 `AgentRuntimeUseCapabilityDiscovery.cs:140-157`（非 `IsCore` 才进代理类别）与 `AgentRuntimeUseCapabilityExecutor.cs:51-57`（`builtin:` 前缀解析）。`src/runtime/WishfulClaw.Agent/Tools/Providers/TaskToolProvider.cs:19` 注释亦确认「keep their own "task" category and stay proxy-reachable」。
- **不是渲染端 IPC**：这两个名字在 Electron/渲染端**完全搜不到**（全仓 `*.ts` 无 `SubAgentStatus`/`SubAgentDetail` 命中）。渲染端走的是另一套 `agent-history:*` 通道（见 Q3）。

**参数 / 返回**：

| 工具 | 参数 | 返回 |
|---|---|---|
| `SubAgentStatus` | `toolUseId?`（可省略） | 省略：`Sub-Agents (N):` + 每行 `FormatBrief`；给了：`FormatStatusInfo`（ID/名称/描述/mode/状态/耗时/工具调用数/迭代数，终态附截断 2000 字的最终报告） |
| `SubAgentDetail` | `toolUseId`（必填） | `FormatDetail` = `FormatStatusInfo` + 完整 output（截断 4000 字）+ 逐步 tool call log |

格式化实现：`BackgroundSubAgentRegistry.cs:193-197`（`FormatBrief`）、`:205-237`（`FormatStatusInfo`）、`:243-273`（`FormatDetail`）。

---

### Q2. 数据来源是什么？有没有「会话 ID / 运行状态 / 开始结束时间」字段？

**数据源 = Worker 进程内的静态内存表**（不是 DB、不是渲染端 store）：

- `src/runtime/WishfulClaw.Agent/BackgroundSubAgentRegistry.cs:11` `public static class BackgroundSubAgentRegistry`
- `:46` `private static readonly ConcurrentDictionary<string, SubAgentRecord> _records = new();`

记录结构 `:31-44`：

```csharp
public sealed record SubAgentRecord(
    string ToolUseId,
    string AgentName,
    string Description,
    string Prompt,
    DateTimeOffset StartedAt,
    SubAgentRunStatus Status,
    string? Output,
    int ToolCallCount,
    int Iterations,
    string? Error,
    DateTimeOffset? CompletedAt,
    bool IsBackground,
    IReadOnlyList<SubAgentToolCallEntry> ToolCallEntries);
```

逐条对照问题的三个字段：

| 字段 | 有无 | 证据 |
|---|---|---|
| **会话 ID** | **没有** | `SubAgentRecord` 无 `SessionId`；`Register(...)`（`:77-98`）签名里也没有 session 参数。调用处只传 `toolUseId/agentName/description/prompt/isBackground`（`SubAgentExecutor.cs:230-232`、`SubAgentExecutor.Background.cs:25`）。**注意**：工具执行时 `context.SessionId` 其实是拿得到的（见 Q3 末），但 registry 没存。 |
| **运行状态** | **有** | `:13-19` 枚举 `SubAgentRunStatus { Running, Completed, Failed, Cancelled }`；`Status` 字段。 |
| **开始/结束时间** | **有** | `StartedAt`（`Register` 时 `DateTimeOffset.UtcNow`，`:89`）；`CompletedAt`（`Complete`/`Fail`/`Cancel` 时置，`:133 / :155 / :168`）。`FormatElapsed`（`:289-295`）用它算耗时。 |

**生命周期钩子**（谁写这张表）：`Register` :77 → `UpdateProgress` :100 → `Complete` :117 / `Fail` :139 / `Cancel` :161。
**容量**：`:51` `MaxTerminalRecords = 100`，`:53-75` `EvictOldTerminalRecords()` 只保留最近 100 条**终态**记录（Running 的不淘汰）。⇒ 「最近」在内存里天然只到 100 条。
**排序**：`:179-186` `GetAll()` 按 `StartedAt` **降序**（新→旧），注释标 `SA-7`，为的是让 LLM 反复调用拿到稳定顺序。

**另一个独立数据源（DB）**：`sub_agent_runs` 表 —— 见 Q4，**带 `session_id`**，是唯一能做「会话维」的数据。

**不在这张表里的**：Goal 子 agent。`src/runtime/WishfulClaw.Agent/Goal/GoalSubAgentExecutor.cs:17-32` 只用 `SubAgentRunCollector`，**全程没有 `BackgroundSubAgentRegistry.Register`**（全仓 `BackgroundSubAgentRegistry.` 的写法只出现在 `SubAgentExecutor*.cs` 与 `SubAgentStatusTool.cs`）。

---

### Q3. 现在能不能枚举「当前会话下所有子 agent（含活跃、含最近完成）」？

**主 agent 侧：半个。** 能枚举，但**没有「当前会话」维度**。

- 入口：`SubAgentStatusTool.cs:39-52` —— 省略 `toolUseId` 即列全部。
- 但它读的是进程级静态表（Q2），记录里没有 sessionId ⇒ **返回的是「本 Worker 进程内所有会话的子 agent」混在一起**，无法只说「本会话」。
- 「最近」的边界 = 内存里最后 100 条终态（`:51`），更早的被淘汰，**拿不回来**。
- 另：**主 agent 侧只能看到 chat/cowork 的 `Task` 派遣子 agent**，看不到 Goal 子 agent（Q2 末）。

**用户 / 渲染端侧：能，且是会话维的。**

- UI 面板：`src/renderer/src/components/layout/SubAgentsPanel.tsx:225-286`
  - `:257-273` `mergeSessionSubAgents({ sessionId: activeSessionId, ... })` 后按「活跃优先、时间倒序」排
  - `:279-286` 拆 `activeAgents` / `completedAgents`
- 合并逻辑：`src/renderer/src/components/layout/sub-agent-run-data.ts:284-315` —— 四条来源按 `agent.sessionId === sessionId` 过滤后合并：
  `buildMessageSubAgents(messages)` + `subAgentHistory` + `completedSubAgents` + `activeSubAgents`。
- 状态字段：`src/renderer/src/stores/agent-store/types.ts:19-81` `SubAgentState` 含 `sessionId?`（`:27`）、`isRunning`（`:33`）、`isQueued?`（`:35`）、`success`（`:43`）、`startedAt`（`:77`）、`completedAt`（`:79`）。
- 状态收敛靠事件：`sub-agent-slice.ts:341` 消费 `sub_agent_end`（这正是 S-191 的病灶，代码里**无超时/心跳兜底**）。

**缺什么**：

1. **数据**：`SubAgentRecord` 缺 `sessionId` ⇒ 模型侧无法按会话过滤（`ToolExecutionContext` 里其实**有** `SessionId`，`src/runtime/WishfulClaw.Core/Tools/ToolTypes.cs:73-75`；装配处在 `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs:548-550` 传的是 `state.SessionId` —— 也就是说**上下文够用，是 registry 没记**）。
2. **工具**：没有任何「按会话/按最近」的模型侧工具。DB 侧虽有 `db/sub-agent-read-session`（**天然按 session 过滤 + `ORDER BY started_at DESC`**，见 Q4），但**没有包成 agent 工具**，只挂了 IPC。
3. **UI**：面板已有「本会话」列表（含活跃 + 已完成），没有「跨会话 / 最近」的聚合视图；且卡片状态本身有 S-191 的挂死问题。

---

### Q4. 子 agent 的状态 / 报告有没有落库？表名、写入点、字段？

**有落库。表名 `sub_agent_runs`。**

**建表**：`src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs:125-133`

```sql
CREATE TABLE IF NOT EXISTS sub_agent_runs (
    tool_use_id TEXT PRIMARY KEY NOT NULL,
    session_id  TEXT NOT NULL,
    agent_name  TEXT NOT NULL DEFAULT '',
    data        TEXT NOT NULL DEFAULT '',
    started_at  INTEGER NOT NULL,
    completed_at INTEGER,
    success     INTEGER
);
```

> 完整 `SubAgentState`（toolCalls / transcript / report / usage 等）以 JSON 存在 `data` 列，按 `session_id` 索引 —— `Entities/SubAgentRunEntity.cs:4-24`。`data` JSON 里已有 `report` / `reportStatus` / `transcript` / `streamingText` / `usage` 等键（见 `docs/plans/iter-v2-30/raw-requirements.md:765-767` 实测）。

**实体 / 行类型**：`src/runtime/WishfulClaw.Infrastructure/Db/Entities/SubAgentRunEntity.cs:9-24`（`SubAgentRunEntity`）、`:26-43`（`SubAgentRunRow`）。

**两条写入通路**：

1. **Worker 侧（报告权威落库，S-36）** —— `src/runtime/WishfulClaw.Agent/SubAgentReportStore.cs:29-80`
   - 只写两个键：`:31-32` `FinalOutputKey = "finalOutput"`、`FinalReportAtKey = "finalReportAt"`；`:87-120` `MergeFinalOutput` 读-改-写、其余键透传。
   - 插入/更新 SQL：`:56-64`（INSERT，`session_id` 走 `parentState.SessionId`，`?? "_unknown"`）、`:68-72`（UPDATE）。
   - **调用点**：前台 `SubAgentExecutor.cs:294-303`、后台 `SubAgentExecutor.Background.cs:70-75`。**仅当 `reportProduced == true`**（子 agent 真出了报告）才写。
2. **渲染端侧（完整 state upsert）** —— `src/runtime/WishfulClaw.Infrastructure/Db/DbSubAgentTools.cs:70-133` `Apply`
   - `:84-101` 已存在则 UPDATE（`agent_name/data/started_at/completed_at/success`），`:103-105` 否则 `InsertSubAgentRun`。
   - `:183-220` `PreserveFinalOutput`：渲染端 upsert 时**保护 Worker 落的 `finalOutput` 不被冲掉**（S-36）。
   - `Replace`（`:135-175`）整表重建，用于迁移快照。

**读取通路**（全在 `DbSubAgentTools.cs`，注册于 `DbModule.cs:77-81`）：

| Worker 方法 | 位置 | 说明 |
|---|---|---|
| `db/sub-agent-read-by-tool-use-id` | `:12-32` | 按 id 读单条，返回 `SubAgentFindResult` |
| `db/sub-agent-read-session` | `:34-50` | **按 session 读全部**：`SELECT * FROM sub_agent_runs WHERE session_id = @sid ORDER BY started_at DESC`（`:43`） |
| `db/sub-agent-index` | `:52-68` | 跨会话聚合：`GROUP BY session_id`，返回 `(sessionId, count, latest)` + 总数 |
| `db/sub-agent-apply` | `:70-133` | upsert / 按 id 删 / 按 session 删 |
| `db/sub-agent-replace` | `:135-175` | 整表替换 |

**谁消费**：只有 Electron 主进程 → 渲染端 IPC —— `src/main/ipc/worker-forward-handlers.ts:14-37`：

```
15  'agent-history:read-by-tool-use-id'   → db/sub-agent-read-by-tool-use-id
19  'agent-history:index'                 → db/sub-agent-index
23  'agent-history:read'                  → db/sub-agent-read-session
31  'agent-history:apply'                 → db/sub-agent-apply
36  'agent-history:replace'               → db/sub-agent-replace
```

渲染端封装：`src/renderer/src/lib/ipc/agent-history-storage.ts:19-27`。**没有**任何 agent 工具包这层 DB 查询。

---

### Q5. 「最近子 agent 列表」如果要做，最自然的落点？（只给候选与理由，不定方案）

**候选落点**

- **A. 给 `BackgroundSubAgentRegistry.SubAgentRecord` 补 `sessionId`（数据层前置）**
  理由：`ToolExecutionContext.SessionId` 现成（`ToolTypes.cs:73-75`，`ToolDispatchRouter.cs:548-550` 已传 `state.SessionId`），`Register(...)` 加一个参数即可；这是「会话维」所有方案的公共前置。**备注**：不改工具面、不改 UI，单独做用户可见变化为零。
- **B. 扩 `SubAgentStatus` 参数（加 `sessionId` / `scope:"session"` 之类）**
  理由：入口已在、描述已是「Omit toolUseId to list all sub-agents」（`SubAgentStatusTool.cs:17`），扩参是把「全量」收窄成「本会话」的最小改动；模型已有心智模型，不必学新工具名。代价：依赖 A。
- **C. 新加一个工具（如 `SubAgentList`）**
  理由：语义干净（列表 vs 单查分离），可以顺带定义「最近 N 条 / 含活跃 vs 仅终态」的窗口参数。代价：`task` 类不核心、已在代理后面（`ToolCategoryCatalog.cs:93-96` + `TaskToolProvider.cs:19`），多一个工具会再占一份 schema 预算；且与 `SubAgentStatus` 的「省略即列全部」语义重叠，模型可能选错。
- **D. 把 DB 的 `db/sub-agent-read-session` 暴露给模型（包成 agent 工具 / 走 `use_capability`）**
  理由：`sub_agent_runs` 是**唯一带 `session_id` 且持久化**的表（Q4），`read-session` 已天然 `ORDER BY started_at DESC`（`:43`），「最近 + 本会话 + 重启后仍在」一次满足，且不用动内存 registry 的生命周期。代价：得定义工具 schema 与返回形状（`data` 是整块 JSON），并决定读哪几个键。
- **E. 只做面板 UI（`SubAgentsPanel` 加「最近/跨会话」视图，或给卡片状态加兜底）**
  理由：面板已有本会话列表与合并逻辑（`SubAgentsPanel.tsx:225-286`、`sub-agent-run-data.ts:284-315`），「用户看最近子 agent」可能本来就该在 UI 解决而不是给模型加工具；且 `sub_agent_end` 丢事件导致卡片永挂「工作中」正是 S-191 本体（`docs/plans/iter-v2-39/changelog.md:664`）。

**与需求的贴合度备注**

- 老大两条诉求要分开看：**「活跃子 agent 列表」**（= 看 Running）与 **「最近子 agent 列表」**（= 看已完成）。前者内存 registry 已经答得了（只是缺会话维）；后者要考虑内存 100 条淘汰（Q2）与跨会话（只有 DB 有）。
- Goal 子 agent 目前不进 registry（Q2 末），任何走 registry 的方案都**默认不含 Goal 子 agent**；要走 DB 的话需确认 Goal turn 是否落 `sub_agent_runs`（本次勘测未见 Goal 侧写这张表）。

---

## ③ 候选落点与理由（汇总）

见 Q5 的 A–E。一句话倾向性观察（**非结论**）：若只要「本会话」，A + B 最短；若要「重启后仍在 / 跨会话」，只有 D 或「D 的数据源 + 模型侧工具」能覆盖；若诉求其实是给人看，「E」比加工具更对口。

---

## ④ 待决问题

**产品口径（该上呈老大）**：

1. 「查看子 agent 列表」主要是**给模型用**（主 agent 自己查进度/回顾），还是**给用户用**（面板/界面）？
2. 范围是**当前会话**，还是**跨会话**（含历史/重启后）？
3. 「**最近**」的窗口怎么定：按时间（如最近 N 分钟）还是按条数（如最近 10 条）？要不要包含**正在运行**的？
4. 是否要**含 Goal 子 agent**？（现状：registry 不含、面板按会话不含 Goal turn。）

**实施细节（助手自拍，不单独上呈）**：

- 扩参 vs 新工具的取舍；参数命名（`sessionId` / `scope` / `limit`）；返回格式（沿用 `FormatBrief` 行 vs 结构化）；是否复用 `sub_agent_runs` 的 `data` JSON 键。

**勘测遗留（供后续核对）**：

- Goal 子 agent 是否会写 `sub_agent_runs`（本次未找到 Goal 侧写入点，若要「最近含 Goal」需先确认）。
- Worker 是否单进程单 registry（若是，则「本进程全部子 agent」= 「本 App 全部会话的子 agent」），本次仅从 `_records` 为 `static` 推断，未追 Worker 实例化范围。
