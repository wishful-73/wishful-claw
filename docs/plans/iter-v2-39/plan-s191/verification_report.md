# S-191 验证报告（阶段六）

**VERDICT: PARTIAL**

一句话结论：全量门禁三绿、S-191 专属断言套件（25/25）通过、四处改动与方案 A 的静态链路逐条核实闭环；但「并发 3 个子 Agent 的卡片收敛 / 唤醒」「Worker 崩溃收敛」「断连后重连自愈」三类核心验收**必须实机**才能兑现 ⇒ 判 **PARTIAL**，无 FAIL、无阻断项。

> 验证者：主会话（老大 2026-10-12 19:35 口径「子 agent 有问题，主会话直接处理」，本需求不派 subagent）。
> 范围：`dev/v2-iter-39`（base `2c925c88`），工作区未提交。
> 基准：`plan-s191/plan.md` + `plan-s191/review_report.md`（❌ 1 已按方案 A 修复，❌ 清零）。

---

## 一、门禁证据

**环境前置**：按 `ExecutablePath` 过滤，仓库内**无** dev 实例命中 —— 仅打包版 `C:\Program Files\WishfulClaw\WishfulClaw.exe`（4 个进程，不锁仓库 `bin\`）⇒ 门禁可跑。

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run typecheck` | **0 错误** | `typecheck:node` / `typecheck:web` 两段均无诊断输出 |
| `npm test` | **69 / 69 通过**（TS 52 + C# 17） | 汇总行 `69/69 通过` |
| `npm run test:subagent-concurrency` | **25 断言通过, 0 失败** | 新增套件，见 §二 |
| `dotnet build src/runtime/WishfulClaw.sln` | **0 警告 0 错误** | `已成功生成。0 个警告 0 个错误` |

三条基线门禁（typecheck / npm test / dotnet build）与 `plan.md` §四一致，无回归。

---

## 二、静态验证（逐改动）

| 改动 | 位置 | 验证结论 |
|---|---|---|
| 1 · live 重置收窄 | `stores/agent-store/slices/session-slice.ts` `resetLiveSessionExecution` | 只清 `!isRunning && !isQueued` 的项；保留集写回 `sessionSubAgentLiveCache[sessionId].active`，使随后的 `switchToolCallSession` 恢复保留集而非空表。**5 个调用点语义一致**（起 run 前 / 失败 / 异常 / 终态 / error） |
| 2 · 终态幂等 upsert | `stores/agent-store/slices/sub-agent-slice.ts` `case 'sub_agent_end'` | `findSubAgentState` 为 `null` 时用事件自带信息补一条终态记录，随后走同一收敛路径 ⇒ **事件不再静默丢弃** |
| 3 · 断连收敛 | `App.tsx:186-192` + `sub-agent-slice.ts` `abortOrphanedSubAgents` + `types.ts` | **触发条件已由方案 A 补齐**（见改动 5）：running / queued ⇒ `aborted` + 落 `completedSubAgents` + 落 history；已完成卡片不改写 |
| 4 · 会话维度查询 | `BackgroundSubAgentRegistry.cs` / `SubAgentStatusTool.cs` / 两个注册点 | 记录新增 `SessionId`；`GetForSession` 会话精确过滤、空串回落 `GetAll()`；`scope: 'session'（默认） \| 'all'`。工具非新增 ⇒ 无需动主进程白名单 / 渲染端桥 |
| 5 · **方案 A：补发 `sidecar:lifecycle`** | `src/main/lib/native-worker.ts`（4 处 + import） | `everConnected` / `disconnectedNotified` / `shuttingDown` 三态位；`closeWorker()` 广播 `disconnected`、`start()` ping 成功后（重启时）广播 `reconnected`、`shutdown()` 置静默位。**通道已在白名单**（`messagepack-channel-routing.ts:415`），发出走 `safeSendMessagePackToAllWindows` |
| 断言 | `tests/subagent-concurrency/program.ts`（`package.json` 登记 `test:subagent-concurrency`） | 25 断言覆盖：并发三子 Agent 起新一轮的保留 / 缓存回写 / `switchToolCallSession` 恢复、无 `start` 的终态事件不丢弃、断连收敛与「已完成不被改写」 |

**链路闭环核实**：改动 3 的收敛钩挂在 `sidecar:lifecycle` 的 `disconnected` 上，此前**全仓无发出方**（审查 ❌-1）；方案 A 之后 `closeWorker()` 成为发出方 ⇒ 钩子生效。同时救活两条既有死订阅：`App.tsx:188`（`reconnected → syncHydratedRuntimeSettings()`）、`agent-bridge.ts:146`（`markRuntimeRestarted()`）。

**顺带修复**：`native-worker.ts` 与 `BackgroundSubAgentRegistry.cs` 首行 BOM 被编辑工具吃掉（HEAD 均带 BOM），按仓库主流约定（无 BOM：cs 61/558、ts 44/631、tsx 20/311）**去掉**，`bareLF=0`。

---

## 三、实机验证项（**分级**；PARTIAL 的来源）

| 项 | 场景 | 期望 | 级别 |
|---|---|---|---|
| E-1 | 同时后台跑 3 个子 Agent，其中一个先返回 | 其余两个返回时**仍能渲染卡片并唤醒父 run**（老大 20:10 现象口径） | **必须** |
| E-2 | 上述过程中刷新页面 / 重启应用 | 卡片**不得**复活「工作中」 | **必须** |
| E-3 | 杀 Worker / 断连 | 本会话仍 running / queued 的卡片**有限时间内**收敛为 `aborted` | **必须** |
| E-4 | 断连后 Worker 自动重启 | 发 `reconnected` ⇒ 运行时设置重新同步；误标的 `aborted` 被随后到达的 `sub_agent_end` 经改动 2 幂等路径改回 `completed`（审查 ⚠️-4） | 建议 |
| E-5 | `SubAgentStatus` 带 `scope` 参数调用（PM / 诊断） | 默认只列本会话；显式 `scope: 'all'` 列全进程 | 建议 |

E-1 ~ E-3 无法用单元测试覆盖（需真实触发并发 / 进程级异常），故整体 PARTIAL。

---

## 四、遗留（不阻断）

- **审查 ⚠️-1 未处理**：`abortOrphanedSubAgents` 只收敛**当前 live 会话**的 `activeSubAgents`；`sessionSubAgentLiveCache[其它会话].active` 里缓存着的 running / queued 卡片不会被收敛 —— 切回那个会话时它们仍挂「工作中」。**属多会话 × Worker 崩溃的复合场景**，改动面超出「补发方」，老大未裁定 ⇒ **如实遗留**。
- **审查 ⚠️-3**：改动 2 补卡片的 `startedAt` 只能取 `Date.now()`（仅影响卡片时长显示），已注释说明。
- **审查 ⚠️-5**：C# 侧 `GetForSession` 无独立回归套件（`BackgroundSubAgentRegistry` 为 `static`，无状态注入点）。
- **审查 ⚠️-6**：`changelog.md` 里「父 run finalize ⇒ 事件必丢」的旧结论须按本次勘测订正（随收尾刀落）。
