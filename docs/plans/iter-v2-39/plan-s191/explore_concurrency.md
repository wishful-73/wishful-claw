# 并发后台子 agent「返回后卡片不收敛」竞态勘测（只读）

日期：2026-10-12 ｜ 范围：`src/renderer/src`（不改码、不 commit、不构建）
现象：同时跑 3 个后台子 agent，其中第一个返回后，其余两个返回时渲染不了卡片（停在「工作中」）。
补充事实：父 run 已 finalize 时，**单个**子 agent 完成仍能渲染卡片并唤醒父 run ⇒「事件发不出」不是主因。

---

## ① 一句话结论

**唤醒 hook 在子1完成时调用 `chatStore.sendMessage` 启动新一轮主 run，而 `sendMessage` 内部无条件做了 `resetLiveSessionExecution(sessionId)` + `switchToolCallSession(null, sessionId)`，把该会话的 `activeSubAgents`（连同 `sessionSubAgentLiveCache[sessionId]`）整体清空** —— 于是仍在跑的**子2/子3 的 `activeSubAgents[id]` 就此消失**；它们各自的 `sub_agent_end` 到达时 `findSubAgentState` 返回 `null`，整个落地分支被静默跳过（既不写 `completedSubAgents`、也不刷新 `subAgentHistory`/摘要），卡片永远停在清空前的最后一份「工作中」快照。

---

## ② 逐问题证据

### 问题 1：`findSubAgentState(state, id, sessionId)` 的完整实现

`src/renderer/src/stores/agent-store/utils/sub-agent-utils.ts:438-456`

```ts
export function findSubAgentState(
  state: {
    activeSubAgents: Record<string, SubAgentState>
    completedSubAgents: Record<string, SubAgentState>
    sessionSubAgentLiveCache: Record<string, SessionSubAgentLiveState>
  },
  id: string,
  sessionId?: string
): SubAgentState | null {
  const direct = state.activeSubAgents[id] ?? state.completedSubAgents[id]
  if (direct && (!sessionId || direct.sessionId === sessionId)) {
    syncSessionSubAgentState(state, sessionId, id, direct)
    return direct
  }

  if (!sessionId) return null
  const liveState = ensureSessionSubAgentLiveState(state, sessionId)
  return liveState.active[id] ?? liveState.completed[id] ?? null
}
```

- **查找顺序**：`activeSubAgents[id]` → `completedSubAgents[id]`（都要过 `sessionId` 过滤）→ 若带 `sessionId`，再兜底到 `sessionSubAgentLiveCache[sessionId].active[id] ?? .completed[id]`。
- **`subAgentHistory` 不参与查找**（它是数组，只能按 `toolUseId` 线性扫，这里根本没碰）。
- **找不到返回 `null`。**
- **「事件到达但 sa 不存在」后果**：`sub-agent-slice.ts` 各 `case` 一律以 `if (sa?.isRunning)` / `if (sa)` 包裹，`sa=null` 时**整块跳过**。尤其 `case 'sub_agent_end'`（`:343` `if (sa) { ... }`）的落地点全被跳过 —— 不写 `state.completedSubAgents[id]`、不 `upsertSubAgentHistory`、不刷 `sessionSubAgentSummaries`、不 `rebuildRunningSubAgentDerived`、也不 `queueAgentHistoryPersistence`。**即 end 事件被完全静默丢弃。**

### 问题 2：`rebuildRunningSubAgentDerived(state)` 做什么

`src/renderer/src/stores/agent-store/utils/sub-agent-utils.ts:320-343`

```ts
export function rebuildRunningSubAgentDerived(state: {
  activeSubAgents, sessionSubAgentSummaries, runningSubAgentNamesSig, runningSubAgentSessionIdsSig
}): void {
  const runningNames: string[] = []
  const runningSessionIds = new Set<string>()
  for (const subAgent of Object.values(state.activeSubAgents)) {
    if (!subAgent.isRunning) continue
    runningNames.push(subAgent.name)
    if (subAgent.sessionId) runningSessionIds.add(subAgent.sessionId)
  }
  for (const [sessionId, summaries] of Object.entries(state.sessionSubAgentSummaries)) {
    if (summaries.some((subAgent) => subAgent.isRunning)) runningSessionIds.add(sessionId)
  }
  state.runningSubAgentNamesSig = runningNames.join('\u0000')
  state.runningSubAgentSessionIdsSig = Array.from(runningSessionIds).sort().join('\u0000')
}
```

- **只重算两个签名字符串**（`runningSubAgentNamesSig` / `runningSubAgentSessionIdsSig`）——注意**没有 `runningSubAgents` 派生集合**，只有这两个 sig。
- **不会移除/重置 `activeSubAgents` 里的条目**，只**读**它。
- sig 供 `isSessionActive`（`session-slice.ts:79` `sigHasEntry(state.runningSubAgentSessionIdsSig, sessionId)`）判定会话「是否还活着」。
- **注意**：它把 `sessionSubAgentSummaries` 里仍有 `isRunning` 的会话也计入 sig —— 这条**不依赖 `activeSubAgents`**，所以即便 `activeSubAgents` 被清空，只要摘要有 running 快照，`isSessionActive` 仍可能为真（与本次卡片 bug 正交，但值得记）。

### 问题 3：唤醒主 run（`sendMessage`）时的清理 —— **关键**

`src/renderer/src/stores/chat-store/index.ts:359-367`（`sendMessage` 内部，`agent/run` 之前）

```ts
// Reset agentStore live session — clear leftover tool calls from previous runs
const agentStore = useAgentStore.getState()
agentStore.resetLiveSessionExecution(sessionId)
agentStore.switchToolCallSession(null, sessionId)
```

`src/renderer/src/stores/agent-store/slices/session-slice.ts:140-152`（`resetLiveSessionExecution`）

```ts
resetLiveSessionExecution: (sessionId) => {
  set((state) => {
    delete state.sessionToolCallsCache[sessionId]
    delete state.sessionSubAgentLiveCache[sessionId]   // ← 无条件删该会话 live 缓存
    if (state.liveSessionId !== sessionId) return        // ← 只有当前会话才继续
    state.pendingToolCalls = []
    state.executedToolCalls = []
    state.activeSubAgents = {}                           // ← 整体清空
    state.completedSubAgents = {}                        // ← 整体清空
    rebuildRunningSubAgentDerived(state)
  })
}
```

`src/renderer/src/stores/agent-store/slices/session-slice.ts:90-134`（`switchToolCallSession`，摘关键行）

```ts
switchToolCallSession: (prevSessionId, nextSessionId) => {
  set((state) => {
    // prevSessionId === null ⇒ 不写回 cache
    const subAgentCache = nextSessionId ? state.sessionSubAgentLiveCache[nextSessionId] : undefined
    state.liveSessionId = nextSessionId
    ...
    state.activeSubAgents = cloneSubAgentMap(subAgentCache?.active ?? {})     // :122
    state.completedSubAgents = cloneSubAgentMap(subAgentCache?.completed ?? {}) // :123
```

**推理链**：`sendMessage` 先 `resetLiveSessionExecution(sessionId)`，其中 **`:143` 无条件 `delete sessionSubAgentLiveCache[sessionId]`**；紧接着 `switchToolCallSession(null, sessionId)` 读 `sessionSubAgentLiveCache[sessionId]` —— **此时已是 `undefined`** ⇒ `cloneSubAgentMap(undefined?.active ?? {}) === {}`，**无条件把 `activeSubAgents` 置空**。

⇒ **结论：第一个子 agent 完成触发唤醒（`sendMessage`）后，仍在跑的其它子 agent 的 `activeSubAgents[id]` 不在。**（不论 `liveSessionId` 是否等于该 `sessionId`：`resetLiveSessionExecution` 的 `{}` 分支可能不跑，但 `delete live cache` + `switchToolCallSession` 的置空两条都跑。）

**渲染端对 `activeSubAgents` 的全部写/删点**（grep 全量）：

| 位置 | 动作 |
|---|---|
| `sub-agent-slice.ts:54` / `:134` | `sub_agent_queued`/`sub_agent_start` 时**新建** `activeSubAgents[id]` |
| `sub-agent-slice.ts:99` | `sub_agent_dequeued` 时 `delete activeSubAgents[id]` |
| `sub-agent-slice.ts:389` | `sub_agent_end` 时 `delete activeSubAgents[id]` |
| `sub-agent-slice.ts:407-408` | `clearSessionData`：遍历删除该会话的条目 |
| `sub-agent-slice.ts:422` | `clearSessionData`：`liveSessionId===sessionId` 时 `= {}` |
| `session-slice.ts:122` | `switchToolCallSession`：从 live cache **重建**（本次bug即此处读到空） |
| `session-slice.ts:148` | `resetLiveSessionExecution`：`= {}` |
| `session-slice.ts:158` | `clearToolCalls`：`= {}` |

`sendMessage` 的调用点/等价重置还有：`:497`、`:522`（run 未启动 / 异常分支）、`:584`（cancelStream）、`:1862`（run `error` 事件）。

### 问题 4：`state.sessionSubAgentLiveCache` 的作用与清理

类型：`Record<sessionId, { active: Record<id, SubAgentState>; completed: Record<id, SubAgentState> }>`（`stores/agent-store/types.ts:373`）。

- **写入点**：`ensureSessionSubAgentLiveState`（`sub-agent-utils.ts:408-417`）、`syncSessionSubAgentState`（`:419-436`，按 `isRunning` 决定落 `active` 还是 `completed`）。`syncSessionSubAgentState` 由 `findSubAgentState`（`:449`）与 `sub-agent-slice.ts` 的 queued/start/end（`:85`/`:122`/`:168`/`:379`）调用。
- **读取点**：`findSubAgentState` 的兜底（`:454-455`）；输入区状态条 `runtime-status.tsx:196-201`、`composer-status-indicator.tsx:62-65`（算 `activeSubAgentCount`）。
- **清理点**：`resetLiveSessionExecution:143`、`clearSessionData:417`、`releaseDormantSessionData:498`、`switchToolCallSession` 的写回（`:97`/`:131`）、`clearToolCalls:165`。
- **是否参与卡片状态判定**：**面板卡片（`SubAgentsPanel` → `mergeSessionSubAgents`）不读它**。它参与的是①输入区 running 计数、②`findSubAgentState` 的兜底查找。但它**间接决定卡片**：一旦被 `resetLiveSessionExecution` 删除，`findSubAgentState` 的兜底也一并失效（返回 `null`），事件被丢弃 → 卡片不收敛。

### 问题 5：面板取数 —— 卡片最终从哪个源来、`isRunning` 取什么

`src/renderer/src/components/layout/sub-agent-run-data.ts:284-315`（`mergeSessionSubAgents`）

```ts
const merged = new Map<string, SubAgentState>()
for (const agent of buildMessageSubAgents(messages, sessionId)) merged.set(agent.toolUseId, agent) // 源1
for (const agent of subAgentHistory) { if (agent.sessionId === sessionId) merged.set(...) }        // 源2
for (const agent of Object.values(completedSubAgents)) { if (agent.sessionId === sessionId) merged.set(...) } // 源3
for (const agent of Object.values(activeSubAgents)) { if (agent.sessionId === sessionId) merged.set(...) }    // 源4
return [...merged.values()].sort(...)
```

- 消费方：`SubAgentsPanel.tsx:238-264` 直接读 `activeSubAgents` / `completedSubAgents` / `subAgentHistory`（**不读** `sessionSubAgentSummaries`）。
- **源1（messages）对后台子 agent 无效**：`buildMessageSubAgents` 在 `:220` `if (block.input.run_in_background === true) continue` —— 后台子 agent 根本不从消息里建卡。
- **`Map.set` 后者覆盖前者**：`active`（源4）优先级最高，接着 `completed`（源3）、`history`（源2）、`messages`（源1）。
- **若 `activeSubAgents` 已无该条目**（被 `sendMessage` 清空）**且 end 事件已 no-op**（`completedSubAgents` 也没写、`history` 也没刷新）⇒ 卡片回落到 **源2 `subAgentHistory` 里清空前最后那份快照**；该快照是「运行中」时 `upsertSubAgentHistory` 落的（`sub-agent-slice.ts:267` message_end / `:302` report_update），**其中 `isRunning: true`** ⇒ **正好解释「永久显示工作中」**。（若在被清空前从未 upsert 过任何历史快照，则整张卡片直接消失 —— 两种表现同源。）

### 问题 6：最可能的竞态链（一句话）

**主 run 派发 3 个后台子 agent 后 finalize → 子1 `sub_agent_end` 触发 completion emit，400ms 后 `wakeSession` 调 `sendMessage`，其中 `resetLiveSessionExecution`+`switchToolCallSession` 把该会话 `activeSubAgents`/`live cache` 清空 → 子2/子3 的 `sub_agent_end` 到达时 `findSubAgentState` 返回 `null`，落地分支被静默跳过，卡片与报告双双「卡死」在子1唤醒的那一刻。**

---

## ③ 竞态时序（文字）

- **t0**：主 run 起，派发 background 子1/子2/子3（三个 `toolUseId` 均在 `activeSubAgents` + `sessionSubAgentLiveCache[sid].active` + `sessionSubAgentSummaries[sid]`）。主 run 随后 finalize（`streamingMessages[sid]` 清空、`runningSessions[sid]` 无 `running/retrying`）⇒ `hasActiveSessionRunForSession(sid) === false`。
- **t1**：子1 完成 → `sub_agent_end(子1)`。
  - `chat-store/index.ts:853` 读到 `activeSubAgents[子1]`（`isBackground===true`）⇒ `:855` `backgroundSubAgentCompletions.emit(...)`。
  - `use-background-subagent-wakeup.ts:160` `pendingSessions.add(sid)` + `scheduleDrain()`（`DRAIN_DELAY_MS=400`）。
  - `chat-store/index.ts:866` `handleSubAgentEvent(子1 end)` → 子1 入 `completedSubAgents`、从 `activeSubAgents` 删除（**子2/子3 仍在**）。
- **t1+400ms**：`drainPendingSessions()`（`use-background-subagent-wakeup.ts:126`）→ `hasActiveSessionRunForSession(sid)===false` → `wakeSession(sid)`：
  - `:94` **破坏性** drain 通知区（`drainBufferedReports` 取走该 session 全部缓冲 = 子1 报告）。
  - `:103` `chatStore.sendMessage({...})`：
    - `chat-store/index.ts:365` `resetLiveSessionExecution(sid)` → `:143` 删 `sessionSubAgentLiveCache[sid]`；若 `liveSessionId===sid` 再 `activeSubAgents={}`、`completedSubAgents={}` —— **子2/子3 的 active 条目在此蒸发**。
    - `chat-store/index.ts:367` `switchToolCallSession(null, sid)` → `subAgentCache===undefined` ⇒ `activeSubAgents={}`（二次确认）。
    - 新一轮主 run 起（`streamingMessages[sid]=新 runId`）。
- **t2**：子2 完成 → `sub_agent_end(子2)`。
  - `chat-store/index.ts:853` `activeSubAgents[子2]===undefined` ⇒ `:855` 条件不成立 ⇒ **不 emit**（无唤醒；通知区里子2的报告无人来取）。
  - `chat-store/index.ts:866` `handleSubAgentEvent(子2 end)` → `findSubAgentState`：`active[子2]??completed[子2]===undefined`；`ensureSessionSubAgentLiveState` 新建空 `{active:{},completed:{}}` ⇒ 返回 `null`。
  - ⇒ `sa===null` ⇒ `sub-agent-slice.ts:343` `if (sa)` 整块跳过 ⇒ 不写 `completedSubAgents`、不 `upsertSubAgentHistory`、不刷摘要、不 `rebuild`。
- **t3**：子3 同 t2。
- **渲染**：`mergeSessionSubAgents` 只剩 `subAgentHistory` 里子2/子3 的旧快照（`isRunning:true`）⇒ 卡片停在「工作中」；子2/子3 的最终报告永久留在 Worker 通知区。

---

## ④ 待验证点

1. **`liveSessionId` 实值**：若 `liveSessionId !== sid`，`resetLiveSessionExecution` 的 `activeSubAgents={}` 分支不跑；但 `:143` 删 live 缓存 + `switchToolCallSession:122` 置空两条仍成立 —— 需在真机确认两处的**实际覆盖面**（是否真的净置空）。
2. **子2/子3 在被清空前是否已落过 `subAgentHistory` 的 `isRunning:true` 快照**（决定卡片表现是「永久工作中」还是「整块消失」）。看 `sub_agent_message_end`/`sub_agent_report_update` 相对唤醒的时序。
3. **Worker 通知区在多 completion 下的缓冲/drain 语义**：同一 session 一份还是每条报告一份；`:94` 的破坏性 drain 是否一次吞掉多份（`agent:drain-sub-agent-notifications` 的实现）。
4. **是否存在唤醒后重建子2/子3 active 条目的其它路径**（如 Worker 重发 `sub_agent_start` / 会话重同步 / `switchToolCallSession` 从别的缓存恢复）。
5. **`pendingSessions` 以 `sessionId` 为键的次要放大**：即便 emit 正常，子2/子3 的 completion 也只 `add` 同一个 `sid`；drain 时若子1唤醒的新 run 正跑，会被 `hasActiveSessionRunForSession` 挡回（`use-background-subagent-wakeup.ts:134`），报告再次滞留。
6. **`rebuildRunningSubAgentDerived` 计入 `sessionSubAgentSummaries` 的 running 快照**（`:335-339`）：摘要未被 `resetLiveSessionExecution` 清空（只清 `activeSubAgents`/`completedSubAgents`/`live cache`），故子2/子3 的摘要仍标 `isRunning:true` —— 确认它是否会经 `isSessionActive` 造成「会话永远显示在跑」的连带现象。
