# S-191 规划验证报告（compliance_report.md）

> 阶段三「规划验证」产物。验证对象：`docs/plans/iter-v2-39/plan-s191/plan.md`。
> 判据：行号错 / 机制说不通 / 步骤覆盖不到目标 = ❌；措辞不精确、可优化 = ⚠️。
> 方法：逐条 Read 核实 plan 引用的每一个 `文件:行号`；对"机制"类断言读源码走通调用序。
> 执行者：独立验证 subagent。**只读，不改任何文件、不 commit、不跑构建/测试。**

---

## ① 一句话结论

plan.md 与规范、与代码实际**高度吻合**：其引用的 `文件:行号` 逐个核实**全部命中**（仅 2 处区间端点各差 1 行，所指内容无误），真因链、改动 1 的缓存恢复机制、改动 2/3 的可行性**均成立**。

**❌ = 0，⚠️ = 5。** 未触发阻断规则（❌ > 0 才阻断），可进入用户确认环节。

---

## ② 逐检查项结论与证据

### 检查项 1 — 步骤完整性：**通过（覆盖完整）**

- 目标两条 ——（a）并发竞态卡片永挂、（b）Worker 异常退出收敛 —— 分别由改动 1/2（步骤 1/2）与改动 3（步骤 3）+ 步骤 7 承接。
- 四处改动契约 → 步骤 1（改动 1）/ 步骤 2（改动 2）/ 步骤 3（改动 3）/ 步骤 4（改动 4）**一一对应**，无"目标写了、步骤没接住"的落空项。
- 步骤 5（自动化断言）、步骤 6（门禁）、步骤 7（实机验证）补齐验证要求。
- 结论：步骤 1~7 完整覆盖目标与全部改动契约，**无缺口**。

### 检查项 2 — 验证检查点：**通过（每步均有可判定检查点）**

| 步骤 | 检查点 | 可判定性 |
|---|---|---|
| 1 | `npm run typecheck` 0 错误；`git diff` 确认只动 `resetLiveSessionExecution` | ✓ |
| 2 | 先读 `adapt-sub-agent-event.ts`；`npm run typecheck` 0 错误 | ✓ |
| 3 | `npm run typecheck` 0 错误 | ✓ |
| 4 | `dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误 | ✓ |
| 5 | `npm test` 全绿 | ✓ |
| 6 | typecheck + test + build 三条命令退出码 0 | ✓ |
| 7 | 实机并发 3 子 Agent 收敛；杀 Worker 收敛为 aborted；无 dev 实例记 PARTIAL | ✓ |

- 每步检查点均为命令 + 退出码/断言，明确可判定。**无缺检查点的步骤**。
- ⚠️ 见 ④-5：步骤 6 门禁用 `npm run typecheck`，而 `dev-workflow.md` 阶段六写「三个配置全部零错误」。经核实 `package.json:21` `typecheck = typecheck:node && typecheck:web`（两配置），`tsconfig.json` 为 solution 型（`files: []` + references 指向上两配置），实质等价，故只记措辞/形式 ⚠️。

### 检查项 3 — 行号真实性：**通过（全部命中，逐条见 ③ 表）**

关键锚点（含 6 个重点核）**全部核实无误**：

- `session-slice.ts:363-367` 不适用（属 chat-store）；`chat-store/index.ts:363-367` = `const agentStore`(:363) + `resetLiveSessionExecution`(:365) + `switchToolCallSession(null, sessionId)`(:367)，两调用**无条件**（无 guard）—— ✔ 与 plan 描述一致。
- `resetLiveSessionExecution` 的 **5 个调用点**，`grep` 全库确认恰为 `chat-store/index.ts:365 / 497 / 522 / 584 / 1862`—— ✔ 数目与位置精确。
- `sub-agent-utils.ts` `findSubAgentState`（:438-456）：只查 `activeSubAgents[id]`、`completedSubAgents[id]`，再落到 `liveState.active[id] ?? liveState.completed[id]`；**确不查 `subAgentHistory`** —— plan 的括注**属实**。
- `BackgroundSubAgentRegistry.SubAgentRecord`（:31-44）：字段为 ToolUseId/AgentName/Description/Prompt/StartedAt/Status/Output/ToolCallCount/Iterations/Error/CompletedAt/IsBackground/ToolCallEntries —— **确无 `sessionId`** —— plan 断言**属实**。
- `Sidecar:lifecycle` 场景：`App.tsx:185-187` 仅 `if (state === 'reconnected')` 做事 —— plan 断言「目前只在 reconnected 时做事」**属实**；且 `agent-bridge.ts:144` 证 `sidecar:lifecycle` 亦会发 `disconnected`，改动 3 的触发源**真实存在**。
- 附验：`data.db` 无 `sub_agent_runs` 表 —— 实测本地 `~/.wishful-claw/data.db`（39.7 MB）与其 WAL 均**无** `sub_agent_runs`（`sessions` / `messages` 存在）—— plan 的「对账路线走不通」**依据属实**。

- 仅 2 处**区间端点各差 1 行**（内容无误）→ ⚠️，见 ④-1。

### 检查项 4 — 方案可行性：**通过**

**(a) 改动 1 的"写回缓存供 switch 恢复"机制 —— 成立。**
- `switchToolCallSession`（`session-slice.ts:90-134`）：`nextSessionId` 非空时 `activeSubAgents = cloneSubAgentMap(subAgentCache?.active ?? {})`（:122）、`completedSubAgents = …subAgentCache?.completed ?? {}`（:123），`subAgentCache` 取自 `state.sessionSubAgentLiveCache[nextSessionId]`（:116-118）。→ **确实从缓存恢复**。
- `resetLiveSessionExecution`（:140-152）：当前 :143 直接 `delete state.sessionSubAgentLiveCache[sessionId]`，故 reset 后紧接着的 switch 恢复出**空表** ⇒ plan 所述"二次清空"**成立**。
- 调用序（`chat-store/index.ts:365` reset → `:367` switch）中间**无其他删缓存环节**。只要在删除后把保留集（`isRunning || isQueued` 的 `activeSubAgents` 条目）**写回** `sessionSubAgentLiveCache[sessionId].active`，switch 即恢复保留集。**机制成立**。
- 补充核实：`switchToolCallSession` 自身仅在缓存键 > 10 时裁剪（:126-131），刚写回的键位于末尾不会被裁 —— **无覆盖/删除风险**。

**(b) 改动 2「sa 不存在时用事件信息补终态记录」—— 可建记录，但字段需补齐。**
- `adaptSubAgentEvent` 在 `sub_agent_end`（`adapt-sub-agent-event.ts:55-85`）产出：事件级 `subAgentName` / `toolUseId`；`result.{ success, output, reportSubmitted, toolCallCount, iterations, endReason(completed|max_iterations|error), usage{0,0}, error? }`。
- plan 取 `name/displayName=event.subAgentName`、`isRunning:false`、`success/endReason/errorMessage/report=event.result.*` —— 这些字段**够用**。
- 但一条完整 `SubAgentState`（`types.ts:19-81`）还缺 `description / prompt / transcript / toolCalls / streamingText / currentAssistantMessageId / startedAt / iteration / reportStatus` 等（多处为必填）。plan 已显式写「⚠️ 缺的字段留空，不编造」——**方向可行**，仅实施时须补默认值（⚠️ 见 ④-2）。
- `endReason` 取值域与卡片文案对齐（`SubAgentsPanel.tsx:66-77`：queued/running/max_iterations/aborted/failed/completed），改动 2/3 产出 `aborted`/`error` 均可被正确渲染。

### 检查项 5 — 分层 / 路径合规：**通过**

- 渲染端改动落点 `stores/agent-store/slices/session-slice.ts`、`slices/sub-agent-slice.ts`、`App.tsx`、`stores/chat-store/*` —— 与 `AGENTS.md` 目录约定（stores 分 slice、组件归 layout）**一致**。
- C# 改动落点 `WishfulClaw.Agent/BackgroundSubAgentRegistry.cs`、`WishfulClaw.Agent/Tools/SubAgentStatusTool.cs` —— 均在 **Agent 层**；只读引用 `WishfulClaw.Core/Tools/ToolTypes.cs`（Core 被 Agent 依赖）—— 依赖方向 **Core ← Agent，正确**，无跨层违规。
- 无硬编码路径、无越层 import。

### 检查项 6 — 缺口：**无阻断缺口**

- **类型定义 `types.ts`**：`SubAgentState` 现有字段已足够容纳改动 2/3 的产出，**无需**改动类型 —— plan 未列入"涉及文件"**正确**。
- **i18n**：改动 3 把卡片收敛为 `endReason='aborted'`，文案 `subAgentsPanel.aborted` 已存在（`SubAgentsPanel.tsx:71-72`），**无需新增**。
- **持久化**：改动 2 新分支写 `subAgentHistory` 后，须与既有 `sub_agent_end` 分支一样置 `shouldPersistSubAgentHistory = true` 并调 `rebuildRunningSubAgentDerived` / `trimCompletedSubAgentsMap` —— plan 未提，属实施提醒（⚠️ 见 ④-3）。
- **测试脚手架**：plan 步骤 5 拟新建 `tests/<名字>/program.ts` + `test:<名字>` —— 与仓内既有约定吻合（`package.json:23-73`、`tests/*/program.ts` 大量存在）；`npm test` 走 `scripts/run-tests.mjs`，**真实存在**。

---

## ③ 行号核对表

| # | plan 写的（文件:行号） | 实际（Read 核实） | 判定 |
|---|---|---|---|
| 1 | chat-store/index.ts:363-367 | :363 `const agentStore…`、:365 reset、:367 switch | ✓ |
| 2 | chat-store/index.ts:365 | :365 `resetLiveSessionExecution(sessionId)` | ✓ |
| 3 | chat-store/index.ts:497 | :497 reset（`!result.started` 分支） | ✓ |
| 4 | chat-store/index.ts:522 | :522 reset（catch 分支） | ✓ |
| 5 | chat-store/index.ts:584 | :584 reset（abort 段） | ✓ |
| 6 | chat-store/index.ts:1862 | :1862 reset（error 段） | ✓ |
| 7 | chat-store/index.ts:669 | :669 `targetSessionId = (envelope.sessionId ?? '').trim() || null` | ✓ |
| 8 | chat-store/index.ts:852-863（唤醒 emit） | 外层 if 为 :852-864（emit 主体 :855-863） | ⚠ 端点差 1 行，内容无误 |
| 9 | session-slice.ts:90-134（switchToolCallSession） | 函数体 :90-134 | ✓ |
| 10 | session-slice.ts:122 | :122 `state.activeSubAgents = cloneSubAgentMap(subAgentCache?.active ?? {})` | ✓ |
| 11 | session-slice.ts:140-152（resetLiveSessionExecution） | 函数体 :140-152 | ✓ |
| 12 | session-slice.ts:143 | :143 `delete state.sessionSubAgentLiveCache[sessionId]` | ✓ |
| 13 | session-slice.ts:145-149 | :145 guard `if (state.liveSessionId !== sessionId) return`；:146-149 清 tool calls/active/completed | ✓ |
| 14 | sub-agent-slice.ts:341-393（case 'sub_agent_end'） | :341 case 起、:392 break、:393 `}` | ✓ |
| 15 | sub-agent-slice.ts:342-343 | :342 `findSubAgentState`；:343 `if (sa) {` | ✓ |
| 16 | sub-agent-utils.ts `findSubAgentState` | :438-456；覆盖 active/completed/liveCache，**不含 subAgentHistory** | ✓（描述属实） |
| 17 | adapt-sub-agent-event.ts:55 | :55 `case 'sub_agent_end': {` | ✓ |
| 18 | App.tsx:185-187 | :185 `ipcClient.on('sidecar:lifecycle', …)`；:187 仅 `reconnected` | ✓ |
| 19 | use-background-subagent-wakeup.ts:103 | :103 `void chatStore.sendMessage({` | ✓ |
| 20 | sub-agent-run-data.ts:284-315 | :284-315 `mergeSessionSubAgents`（merge 序：messages→history→completed→active） | ✓ |
| 21 | SubAgentStatusTool.cs:11-65 / :71-114 | :11-65 `SubAgentStatusTool` / :71-114 `SubAgentDetailTool` | ✓ |
| 22 | Tools/ToolModule.cs:158-159 | :158 注册 `SubAgentStatusTool`、:159 `SubAgentDetailTool` | ✓ |
| 23 | BackgroundSubAgentRegistry.cs:31-44 | :31-44 `SubAgentRecord`，**无 sessionId** | ✓ |
| 24 | Core/Tools/ToolTypes.cs:73-75 | :73 `ToolExecutionContext`；:75 `string? SessionId` | ✓ |
| 25 | ToolDispatchRouter.cs:548-550 | :548-550 `new ToolExecutionContext(workingFolder, state.SessionId, …)` | ✓ |
| 26 | AgentRuntimeTools.cs:88（附） | :88 `var backgroundContext = context.ForBackgroundOperation();` | ✓ |
| 27 | agent-stream-handler.ts:16-31（附） | 函数 :16-32（全局广播循环 :20-24，无 per-run 门） | ⚠ 端点差 1 行，内容无误 |
| 28 | changelog.md:664（附） | :664 结论①「父 run finalize 后 stream 不可用」确存 | ✓ |
| 29 | 本地 data.db 无 sub_agent_runs（附） | 实测 data.db 与 WAL 均无；sessions/messages 存在 | ✓ |

---

## ④ 清单

### ❌ 清单（阻断项）

**无。**

### ⚠️ 清单（建议项）

1. **两处区间端点各差 1 行**：`chat-store/index.ts:852-863` → 实际 `:852-864`；`agent-stream-handler.ts:16-31` → 实际 `:16-32`。所指内容无误，建议顺手改准。
2. **改动 2 补记录需补齐必填字段**：合成 `SubAgentState` 缺 `description/prompt/transcript/toolCalls/streamingText/currentAssistantMessageId/startedAt/iteration/reportStatus`，plan 已声明「缺的留空、不编造」——实施时按 `types.ts:19-81` 补齐默认值即可，勿臆造内容。
3. **改动 2 新增分支须同步派生/持久化**：与既有 `if (sa)` 分支一样，需 `shouldPersistSubAgentHistory = true` + `rebuildRunningSubAgentDerived(state)` + `trimCompletedSubAgentsMap(state.completedSubAgents)`，否则终态记录不入历史/不持久化。plan 未提，实施勿漏。
4. **改动 3「本会话」作用域待明确**：`App.tsx` 的 `sidecar:lifecycle` 监听是全局的（payload 无 sessionId），`disconnected` 时需自行遍历受影响会话/全部 `activeSubAgents` 收敛为 `aborted`。
5. **步骤 6 门禁表述与文档不一致**：plan 用 `npm run typecheck`（node + web 两配置），`dev-workflow.md` 阶段六写「三个配置」。因 `tsconfig.json` 为 solution 型（`files: []` + references）实质等价，属形式 ⚠️，建议 plan 补一句说明。

---

## 附：验证足迹（读了哪些、依据是什么）

- plan：`docs/plans/iter-v2-39/plan-s191/plan.md`
- 规范：`docs/dev-workflow.md`（阶段三 :397-416、文档组织 :509-576）
- 需求/流水：`requirements/S-191.md`、`changelog.md:658-664`
- 渲染端：`stores/agent-store/slices/session-slice.ts`、`slices/sub-agent-slice.ts`、`utils/sub-agent-utils.ts`、`stores/agent-store/types.ts`、`stores/chat-store/index.ts`、`stores/chat-store/adapt-sub-agent-event.ts`、`App.tsx`、`hooks/use-background-subagent-wakeup.ts`、`components/layout/sub-agent-run-data.ts`、`components/layout/SubAgentsPanel.tsx`、`lib/ipc/agent-bridge.ts`、`lib/agent/sub-agents/types.ts`
- C#：`WishfulClaw.Agent/Tools/SubAgentStatusTool.cs`、`Tools/ToolModule.cs`、`BackgroundSubAgentRegistry.cs`、`AgentRuntimeTools.cs`、`ToolDispatchRouter.cs`、`WishfulClaw.Core/Tools/ToolTypes.cs`
- 环境：`package.json`、`tsconfig.json`、本地 `~/.wishful-claw/data.db`（只读字节检索）

**判定：❌ = 0，⚠️ = 5。可进入用户确认环节。**
