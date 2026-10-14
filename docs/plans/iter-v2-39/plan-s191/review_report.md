# S-191 审查报告（阶段五）

> 审查人：主会话自审（老大 2026-10-12 19:35 口径「子 agent 有问题，主会话直接处理」；本需求不再派 subagent 出报告）。
> 审查对象：S-191 四处改动 + 新增断言，工作区未提交（`dev/v2-iter-39`，base `2c925c88`）。
> 规划依据：`plan-s191/plan.md`、`plan-s191/compliance_report.md`（阶段三 ❌ 0 / ⚠️ 5）。
> 出报告：2026-10-12。**复查更新：2026-10-13（❌-1 已按方案 A 修复）。**
> **结论：❌ 1（已修复，见 §二）/ ⚠️ 6 —— 无阻断项，可进验证态。**

## 一、审查范围

改动文件（`git diff --stat` 实测）：

| 文件 | 增删 | 对应改动 |
|---|---|---|
| `src/renderer/src/stores/agent-store/slices/session-slice.ts` | +26 / −2 | 改动 1 |
| `src/renderer/src/stores/agent-store/slices/sub-agent-slice.ts` | +76 / −2 | 改动 2、3 |
| `src/renderer/src/stores/agent-store/types.ts` | +6 | 改动 3 |
| `src/renderer/src/App.tsx` | +4 | 改动 3 |
| `src/runtime/WishfulClaw.Agent/BackgroundSubAgentRegistry.cs` | +26 / −2 | 改动 4 |
| `src/runtime/WishfulClaw.Agent/SubAgentExecutor.cs` | +2 / −1 | 改动 4 |
| `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs` | +1 / −1 | 改动 4 |
| `src/runtime/WishfulClaw.Agent/Tools/SubAgentStatusTool.cs` | +24 / −2 | 改动 4 |
| `package.json` | +1 | 测试登记 |
| `tests/subagent-concurrency/`（新增） | 25 断言 | 步骤 5 |

**不属于本需求、须排除在本刀之外的两处**（先前攒下的）：`src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionTools.cs`（S-189 注释订正）、`tests/WishfulClaw.SessionTaskCascadeRegressionTests/CreateSessionInsertTests.cs`（S-189 夹具补 `scope`）。两者留收尾刀。

## 二、❌ 阻断项（2026-10-13 复查：❌-1 已按方案 A 修复）

### ❌-1 改动 3 挂在死通道上，「Worker 异常退出」场景实际未覆盖 —— **已修复（方案 A）**

`App.tsx:191` 的收敛钩在 `sidecar:lifecycle` 的 `state === 'disconnected'` 上，但该事件**在当前代码里没有任何发出方**：

- `git grep -n "sidecar:lifecycle"` 全仓库仅 3 命中，**全是消费侧**：`App.tsx:186`、`agent-bridge.ts:142`、`messagepack-channel-routing.ts:415`（通道白名单）。
- `git grep -n "sidecar:" -- src/main`（递归）→ **0 命中**。主进程向渲染端推送的全部 27 处 `safeSendMessagePack*` 调用（`agent:stream` / `global:task-changed` / `plugin:*` / `cron:fire` / `update:*` … 逐条核过）里没有该通道。
- `native-worker.ts:403` 的 `closeWorker()` 只做 destroy socket / kill child / reject 挂起请求，**不通知渲染端**；`exit` / `error` / `socket close` 三条死路都汇到这里（`:224-234`、`:282-293`）。
- 无拼接式通道名可绕过上述检索（`sidecar:` 字面量在 `src/main` 全域 0 命中）。
- 连带之前的既有欠账：`App.tsx:188` 的 `reconnected → syncHydratedRuntimeSettings()` 与 `agent-bridge.ts:146` 的 `markRuntimeRestarted()` 同样是死订阅（**非本次引入**，但说明这条通道一直是空的）。

影响：`abortOrphanedSubAgents()` 永不执行，plan「目标」第二条（“并使卡片状态在 Worker 异常退出时也能收敛”）**未达成**；且 Worker 崩溃后不会再有 `sub_agent_end`，改动 2 的幂等兜底也救不了这一幕 —— 该场景卡片仍会永挂。

定级理由：不是「实现有瑕疵」而是「触发条件不存在」；留一段永不执行的代码比不写更误导（后人会以为已覆盖）。

候选处理（**涉及超出 plan 改动面的新实现，等老大裁定**）：

- **A. 补发事件（推荐）** —— 在 `native-worker.ts` 的 `closeWorker()` 发 `sidecar:lifecycle {state:'disconnected'}`，重启成功后再发 `{state:'reconnected'}`（走 `safeSendMessagePackToAllWindows`，通道已在白名单，无需改路由表）。顺带救活 `reconnected` 那条死订阅。代价：改动面 +1 个 main 文件，且属实机验证项。
- **B. 撤掉改动 3** —— `App.tsx` / `types.ts` / `sub-agent-slice.ts` 的 `abortOrphanedSubAgents` 一并撤回，plan 与 changelog 如实记「进程级兜底未做（无信号源）」。代价：Worker 崩溃场景继续永挂。

**修复落地（2026-10-13，方案 A）** —— `src/main/lib/native-worker.ts` 补发两态信号：

| 位置 | 改动 |
|---|---|
| 类字段 | 新增 `everConnected`（首启失败不算「断开」）/ `disconnectedNotified`（防重复发，退出与断连多路汇聚 `closeWorker`）/ `shuttingDown`（主动退出静默） |
| `start()` ping 成功后 | `everConnected` 为真 ⇒ 本次是重启，发 `reconnected` 并清 `disconnectedNotified` |
| `closeWorker()` 开头 | `everConnected && !disconnectedNotified && !shuttingDown` 时发 `disconnected` |
| `shutdown()` 开头 | 置 `shuttingDown`，使主动退出的 child exit 不误报为异常断连 |

通道 `sidecar:lifecycle` 已在白名单（`messagepack-channel-routing.ts:415`），无需改路由；发出走 `safeSendMessagePackToAllWindows`。**改动 3 的收敛钩（`App.tsx:191`）随之生效**，`App.tsx:188` / `agent-bridge.ts:146` 的既有死订阅一并救活。

连带修复：`native-worker.ts` 与 `BackgroundSubAgentRegistry.cs` 的**首行 BOM 被编辑工具吃掉**（两文件 HEAD 均带 BOM），已按原样补回。

**遗留**：⚠️-1（多会话收敛）未动 —— 改动面超出「补发方」，留待老大裁定。

## 三、⚠️ 观察项（不阻断）

- **⚠️-1 `abortOrphanedSubAgents` 只收敛当前 live 会话**：它只看 `state.activeSubAgents`，而 `sessionSubAgentLiveCache[其它会话].active` 里缓存着的 running / queued 卡片不会被收敛 —— 切回那个会话时它们依旧挂「工作中」。建议收敛时一并遍历 liveCache。**（若走 ❌-1 方案 B，此项随之消失。）**
- **⚠️-2 改动 4 是行为变更**：`SubAgentStatus` 原来无参即列**全进程**子 agent，现默认 `scope: 'session'` 只列本会话；PM / 管理类用法需显式传 `scope: 'all'`。工具描述已写明，但既有 prompt 若依赖旧口径会少看到东西。建议在 changelog 记明。
- **⚠️-3 改动 2 补卡片的 `startedAt` 只能取 `Date.now()`**，缺事件来源 ⇒ 卡片时长显示偏短（已注释说明，仅影响展示）。
- **⚠️-4 断连误报可自愈**：若 `disconnected` 只是通道瞬断而 Worker 还活着（方案 A 落地后），误标的 `aborted` 会被随后到达的 `sub_agent_end` 经改动 2 的幂等路径改回 `completed`。风险可控，但需在实机项里确认。
- **⚠️-5 C# 侧 `GetForSession` 无回归套件覆盖**：`tests/` 下 C# 套件均为独立 console 项目，本需求未新建套件（`BackgroundSubAgentRegistry` 为 `static` 无状态注入点）。TS 侧 store 三条契约已由 `tests/subagent-concurrency` 覆盖。
- **⚠️-6 文档欠账未清**：`docs/plans/iter-v2-39/changelog.md:664` 的「父 run finalize ⇒ 事件必丢」结论须按本 plan 订正；`requirements/S-191.md` §3.2 / §五 / §七 需同步。随本需求提交一并落。

## 四、逐改动核对

| 改动 | 位置 | 核对结果 |
|---|---|---|
| 1 | `session-slice.ts:140-173` `resetLiveSessionExecution` | ✅ 只清 `isRunning \|\| isQueued` 之外的项；保留集同时写回 `sessionSubAgentLiveCache[sessionId].active`（`:158-160`、`:168-171`），使随后的 `switchToolCallSession` 恢复保留集。5 个调用点（`chat-store/index.ts` 起 run 前 / 起 run 失败 / 异常 / 终态 / error）语义逐处核过 —— 收窄后「真在跑的不被清」在五处均成立。`completedSubAgents` 清理保持不变。 |
| 2 | `sub-agent-slice.ts:341-373` `sub_agent_end` | ✅ `findSubAgentState` 返回 `null` 时用事件自带信息补一条终态记录（`name` / `displayName` 取自 `event.subAgentName`，`report` 取 `event.result.output`，`reportStatus` 由 `reportSubmitted` 决定），随后走同一收敛路径。未编造任何字段。 |
| 3 | `App.tsx:186-192` + `sub-agent-slice.ts` `abortOrphanedSubAgents` + `types.ts` | ❌ 触发条件不存在（见 ❌-1）；收敛实现本身 ✅（running / queued ⇒ `aborted` + 落 `completedSubAgents` + 落 history，已完成的卡片不改写）。 |
| 4 | `BackgroundSubAgentRegistry.cs` / `SubAgentStatusTool.cs` / 两个调用点 | ✅ 记录新增 `SessionId`，注册点传 `parentState.SessionId`；`GetForSession` 会话精确过滤、空串回落 `GetAll()`；`scope: 'session'（默认）\| 'all'`。`context.SessionId` 与 `parentState.SessionId` 同源已核（`AgentRuntimeTools.cs:51` → `ToolDispatchRouter.cs:549`）。工具非新增 ⇒ 无需动主进程白名单 / 渲染端桥。 |
| 步骤 5 | `tests/subagent-concurrency/program.ts`（新增，`package.json` 登记 `test:subagent-concurrency`） | ✅ 25 断言覆盖：并发三子 agent 起新一轮的保留 / 缓存回写 / `switchToolCallSession` 恢复、无 `start` 的终态事件不丢弃、断连收敛与「已完成不被改写」。 |

## 五、门禁证据（阶段六复跑前）

- `npm run typecheck` → 退出码 0，无输出错误。
- `npm test` → **69/69**（TS 52 + C# 17）。
- `& "C:\Program Files\dotnet\dotnet.exe" build src/runtime/WishfulClaw.sln` → **0 警告 0 错误**。
- `node tests/subagent-concurrency/out/program.cjs` → `25 断言通过, 0 失败`。

## 六、提交范围提示（阶段六用）

本需求一刀 = 上表 9 个改动文件 + 新增 `tests/subagent-concurrency/`；**排除** `DbPluginSessionTools.cs`、`CreateSessionInsertTests.cs`（S-189 攒账）与 `docs/plans/iter-v2-39/**`（文档随收尾刀）。
