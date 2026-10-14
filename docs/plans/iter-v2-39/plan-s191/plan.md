# Plan: S-191 —— 子 Agent 卡片永挂「工作中」（并发竞态）

> 归口：`docs/plans/iter-v2-39/requirements/S-191.md`（原文 / 现象 / 静态定位 / 修复方向）。
> 口径：2026-10-12 19:31 登记（定性 **bug**）；**20:10 老大修正现象口径** —— 「父 run finalize 仍能渲染卡片并唤醒父 run，问题出在**同时跑多个**：同时跑 3 个，其中一个返回后，其它的返回就渲染不了卡片了」。
> 探明：`plan-s191/explore_concurrency.md`（竞态链，依据强）+ `plan-s191/explore_delivery.md`（投递链证伪，依据强）。
> 开工：老大 2026-10-12 20:00「根据开发工作流推进191的修复，样本就是你刚刚的工作过程啊」。

## 目标

修掉「同一会话并发多个后台子 Agent 时，除最先完成的那个以外，其余卡片永久停在『工作中』」的竞态故障；并使卡片状态在 Worker 异常退出时也能收敛。

## 根因（已钉死，**推翻登记时的推定**）

登记时（`S-191.md` §3.2、`changelog.md:664`）推定「父 run finalize ⇒ `sub_agent_end` 发不出」。**该推定不成立**，本轮两条独立勘测已证伪并给出真因。

### 证伪：投递链没问题

- `AgentRuntimeTools.EmitAsync` 写的是**连接级** transport，父 run finalize 只 `state.Dispose()`（关队列 + 释放 CTS），**不阻断 emit**；后台路径用 `backgroundContext`（`AgentRuntimeTools.cs:88`），其 token 只在**主进程断连**时取消。
- 主进程 `registerAgentStreamForwarder`（`agent-stream-handler.ts:16-31`）是**全局订阅广播**给所有窗口，**无 per-run 门**；渲染端 `targetSessionId` 优先取 `envelope.sessionId`（`chat-store/index.ts:669`），与 run 并发无关。
- 唯一会落盘的 emit 失败痕迹 `background sub-agent failure emit also failed`（Warn 级）**全库 0 命中**。

### 真因：唤醒机制把并发兄弟的状态清了

| # | 位置 | 行为 |
|---|---|---|
| 1 | `use-background-subagent-wakeup.ts:103` | 子1 完成 ⇒ 调 `chatStore.sendMessage` 唤起空闲主会话 |
| 2 | `chat-store/index.ts:363-367` | 起 run 前**无条件** `resetLiveSessionExecution(sessionId)` + `switchToolCallSession(null, sessionId)`（注释只写「clear leftover tool calls from previous runs」） |
| 3 | `session-slice.ts:143` | `delete state.sessionSubAgentLiveCache[sessionId]` |
| 4 | `session-slice.ts:145-149` | `liveSessionId === sessionId` ⇒ `state.activeSubAgents = {}`、`completedSubAgents = {}` |
| 5 | `session-slice.ts:122` | 紧接着 `switchToolCallSession(null, sessionId)` 从**刚被删的**缓存恢复 ⇒ `activeSubAgents = {}`（**二次清空**） |
| 6 | ⇒ | 仍在跑的子2/子3 的 `activeSubAgents[id]` 消失 |
| 7 | `sub-agent-slice.ts:342-343` | 子2/子3 的 `sub_agent_end` 到达 ⇒ `findSubAgentState` 返回 `null`（查找只覆盖 `activeSubAgents` / `completedSubAgents` / liveCache，**不含 `subAgentHistory`**）⇒ `if (sa)` 整块跳过 ⇒ **事件静默丢弃** |
| 8 | `sub-agent-run-data.ts:284-315` | 卡片回落 `subAgentHistory` 的旧「运行中」快照 ⇒ **永久「工作中」** |

**连带放大**：`chat-store/index.ts:852-863` 的唤醒 emit 也 keyed on `activeSubAgents[id]?.isBackground` ⇒ 被清后子2/子3 的**报告不会被唤醒回传**（`BackgroundSubAgentNotifications` 里没人 drain）。

**与现象的一致性**：单个子 Agent 正常（没有「第一个回来触发唤醒」这一步）；并发 ≥2 必炸。✔

## 已拍定的实施契约

### 改动 1（主修）—— 起新 run 不再误清仍在运行的子 Agent

`src/renderer/src/stores/agent-store/slices/session-slice.ts` 的 `resetLiveSessionExecution`（`:140-152`）：

- 语义收窄为「清 tool calls + 清**已结束**的子 Agent」，**保留 `isRunning || isQueued` 的 `activeSubAgents` 条目**。
- 保留集**同时写回 `sessionSubAgentLiveCache[sessionId].active`**，使随后的 `switchToolCallSession(null, sessionId)`（`:90-134`，`:122`）恢复的是保留集而不是空表。
- `completedSubAgents` 的清理**保持不变** —— 已结束的子 Agent 卡片仍可从 `subAgentHistory` 取到，且状态正确。
- 该函数有 **5 个调用点**，全部在 `chat-store/index.ts`：`:365`（起 run 前）、`:497` / `:522`（终态）、`:584`（abort）、`:1862`（error）。收窄后**五处语义同时变正确**：真在跑的不会被清，其余照旧。

### 改动 2（兜底）—— `sub_agent_end` 改幂等 upsert，不再静默丢

`src/renderer/src/stores/agent-store/slices/sub-agent-slice.ts` 的 `case 'sub_agent_end'`（`:341-393`）：

- 当前是 `if (sa) { ... }` —— 找不到就**什么都不做**。改为：`sa` 不存在时，**用事件自带信息补一条终态记录**（`name` / `displayName` 取 `event.subAgentName`，`isRunning: false`，`success` / `endReason` / `errorMessage` / `report` 取 `event.result.*`），写入 `completedSubAgents` + `subAgentHistory`。
- 覆盖面：状态被清、刷新 / 重连后 `activeSubAgents` 为空、事件乱序到达。
- ⚠️ 实施前先核实 `adaptSubAgentEvent`（`chat-store/adapt-sub-agent-event.ts:55`）在 `sub_agent_end` 上能给出哪些字段；缺的字段留空，**不编造**。

### 改动 3（覆盖登记稿「异常退出」本意，**建议做**）—— 进程级异常时收敛

- 渲染端在 Worker **断连 / 退出**（而非仅 `reconnected`）时，把本会话仍在 `isRunning` 的子 Agent 卡片收敛为 `aborted`。
- 落点：`src/renderer/src/App.tsx:185-187`（已有 `sidecar:lifecycle` 订阅，目前只在 `reconnected` 时做事）。
- 纯渲染端，**不依赖 DB**（本地 `data.db` 实测**无 `sub_agent_runs` 表**，对账路线走不通）。

### 改动 4（老大 20:00 追加诉求）—— 「查看当前会话活跃 / 最近子 Agent」能力

- `SubAgentStatus` / `SubAgentDetail` **已存在**（`Tools/SubAgentStatusTool.cs:11-65` / `:71-114`，注册于 `Tools/ToolModule.cs:158-159`），无参调用即列本进程全部子 Agent。
- **缺的只是会话维度**：`BackgroundSubAgentRegistry` 记录（`:31-44`）**没存 `sessionId`**，而 `ToolExecutionContext.SessionId` 现成（`ToolTypes.cs:73-75`，装配处 `ToolDispatchRouter.cs:548-550`）。
- 方案：注册时补 `sessionId`；`SubAgentStatus` 增加按会话过滤（用上下文里的 `sessionId`，或加 `scope: "session" | "all"` 参数）。
- 价值：registry 记的是 **Worker 真实状态**，**不受本 bug 影响**，正好当诊断兜底。
- ⚠️ 形态待老大确认（只给模型，还是面板也加入口）。

## 步骤清单

- [ ] **步骤 1 —— 改动 1（`session-slice.ts`）**
  - 验证检查点：`npm run typecheck` 0 错误；`git diff` 确认只动 `resetLiveSessionExecution`（及必要处）。

- [ ] **步骤 2 —— 改动 2（`sub-agent-slice.ts`）**
  - 先读 `adapt-sub-agent-event.ts` 确认 `sub_agent_end` 可用字段。
  - 验证检查点：`npm run typecheck` 0 错误。

- [ ] **步骤 3 —— 改动 3（`App.tsx` 断连收敛）**
  - 验证检查点：`npm run typecheck` 0 错误。

- [ ] **步骤 4 —— 改动 4（C# 侧：registry 补 `sessionId` + `SubAgentStatus` 会话过滤）**
  - 验证检查点：`& "C:\Program Files\dotnet\dotnet.exe" build src/runtime/WishfulClaw.sln` 0 警告 0 错误。

- [ ] **步骤 5 —— 自动化断言（能加就加）**
  - 渲染端 store 层：`sub_agent_end` 在 `activeSubAgents` 为空时仍产出终态记录（TS 脚本测试，新建 `tests/<名字>/program.ts` 并加 `test:<名字>`）。
  - 验证检查点：`npm test` 全绿。

- [ ] **步骤 6 —— 门禁**
  - `npm run typecheck` 0 错误；`npm test` 全绿；`dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误（**先读 `dev-workflow.md` §「编译环境」**）。
  - 验证检查点：三条命令退出码 0。

- [ ] **步骤 7 —— 实机验证（留验证态）**
  - 并发 3 个后台子 Agent：子1 返回后，子2/子3 应在其各自完成时**正常收敛**（不再永挂）；主会话应收齐 3 份报告。
  - 杀 Worker 进程：卡片应在有限时间内收敛为 `aborted`。
  - 无 dev 实例则记 **PARTIAL**，写进 `verification_report.md`。

## 涉及文件

- `src/renderer/src/stores/agent-store/slices/session-slice.ts` — 改（改动 1）
- `src/renderer/src/stores/agent-store/slices/sub-agent-slice.ts` — 改（改动 2）
- `src/renderer/src/App.tsx` — 改（改动 3）
- `src/runtime/WishfulClaw.Agent/BackgroundSubAgentRegistry.cs`、`Tools/SubAgentStatusTool.cs` — 改（改动 4）
- 只读参照（不改）：`chat-store/index.ts`（5 个调用点）、`agent-store/utils/sub-agent-utils.ts`（`findSubAgentState`）、`hooks/use-background-subagent-wakeup.ts`

## 参考源码

无（本地缺陷修复，不涉及 OpenCowork / KodaClaw 搬码）。

## 风险与边界

- **改动 1 是本需求唯一有回归风险的点**：`resetLiveSessionExecution` 的「清空」行为被 5 处依赖，收窄后须逐处确认语义（终态 / abort / error 三处「清掉已结束」仍成立）。
- **不改**：`BackgroundSubAgentNotifications` / `BackgroundSubAgentRegistry` 的生命周期、`use-background-subagent-wakeup.ts` 的唤醒逻辑本身（本次不动唤醒机制）。
- **不做**：DB 对账兜底（本地 `data.db` 无 `sub_agent_runs` 表）；**超时兜底（登记稿方案 B）不做** —— 阈值无从定，改动 3 已覆盖进程级异常这一主场景。
- **文档欠账**：`changelog.md:664` 的结论须订正（父 run finalize 不是根因）；`S-191.md` §3.2 / §五 / §七 需按本 plan 同步。随本需求提交一并改。
