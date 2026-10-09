# S-178 规划验证报告（compliance_report.md）

- 审查对象：docs/plans/iter-v2-38/plan-s178/plan.md
- 审查时间：2026-10-09
- 审查者：独立 subagent（code-reviewer，只读）
- 结论：❌ 0 / ⚠️ 3 / ℹ️ 3 —— 【可以进入用户确认】

> 说明：本轮只读核对 plan 的事实陈述与 10 条行号/行为断言，**未跑编译、未跑测试、未改任何代码**。唯一写入的是本报告自身。

---

## 一、九条检查项结论

| # | 检查项 | 判定 | 依据 |
|---|---|---|---|
| 1 | 目标覆盖 | ✅ | 步骤 1~6（实施+门禁）+ 步骤 7（真机复验）覆盖 §一「真在跑显示工作中 / 排队显示等待中 / 跑完自动转工作中」；自动转态由 limiter `Pump()`→lease→`sub_agent_start`（步骤 2/3 挪位后）隐式承接 |
| 2 | 验证检查点 | ⚠️ | 每步均有检查点，但步骤 2/3 仅「编译 0 错」，缺行为断言；「queued 先于 start」正是本需求命门，见 §三.⚠️1 |
| 3 | 路径合规 | ✅ | `docs/plans/iter-v2-38/plan-s178/plan.md`、`requirements/S-178.md`、`src/runtime/WishfulClaw.Agent/*.cs`、`src/renderer/src/stores/**`、`tests/**` 全部符合 `docs/dev-workflow.md`「目录约定」节 |
| 4 | 分层依赖 | ✅ | 改动仅在 Agent 层（C#）与 renderer 层（TS），无跨层；未见 Core→Workspace 之类越层 |
| 5 | 行号属实 | ✅ | 10/10 条实读核对全部属实（见 §二） |
| 6 | 现状描述与代码一致 | ✅ | §二 5 段链路表、§三 行为表逐格与真实代码一致（range 引用偏短处见 ℹ️1） |
| 7 | 边界与不倒退 | ⚠️ | 「立即返回」承诺**不破**（start 挪入 `Task.Run` 内）；但 Register 时序翻转（⚠️2）与取消补发 dequeued 的幽灵卡边界（⚠️3）未在 §七 显式分析 |
| 8 | 顺序契约成立性 | ✅ | 代码证实「queued 必须先于 start」（见 §二 第 6 条与 §四） |
| 9 | CRLF 无 BOM | ✅ | `plan.md` crlf=172/barelf=0/bom=False；`S-178.md` crlf=120/barelf=0/bom=False |

**阻断规则判定：❌ = 0 ⇒ 不触发「禁止进入用户确认」。**

---

## 二、行号与事实核实（对照 plan §二/§三）

| # | plan 的说法 | 实际代码（2026-10-09 快照） | 判定 |
|---|---|---|---|
| 1 | `SubAgentConcurrencyLimiter.cs`：`AcquireAsync` 在 :22；判定 `_running < _max && _queue.Count == 0` 在 :61 | `:22 public static ValueTask<IDisposable> AcquireAsync(CancellationToken cancellationToken)`；`:61 else if (_running < _max && _queue.Count == 0)` | ✅ 属实 |
| 2 | `SubAgentExecutor.cs`：无条件 `sub_agent_start` emit 在 :74-81；前台闸门 `AcquireAsync` 在 :138；:257 `GoalEventContext` 提前 return | 注释 `:74`＋emit 语句 `:75-81`（`Input: input.Clone()` 在 :81）；`:138 using var concurrencyLease = await SubAgentConcurrencyLimiter.AcquireAsync(`；`:257 if (parentState.GoalEventContext is not null)` → `:259 return;` | ✅ 属实（:74-81 含注释行，正文起于 :75，与 plan §3.3 的 ':75-81' 自洽） |
| 3 | `SubAgentExecutor.Background.cs`：后台闸门在 :53 且位于 `Task.Run` 内 | `:49 _ = Task.Run(async () =>`；`:53 using var concurrencyLease = await SubAgentConcurrencyLimiter.AcquireAsync(` | ✅ 属实 |
| 4 | `Goal/GoalSubAgentExecutor.cs`：闸门在 :50、且**不发** `sub_agent_start` | `:50 using var concurrencyLease = await SubAgentConcurrencyLimiter.AcquireAsync(`；全文件无任何 `AgentRuntimeTools.EmitAsync` / `sub_agent_start` | ✅ 属实 |
| 5 | `adapt-sub-agent-event.ts`：switch **无** `sub_agent_queued`/`sub_agent_dequeued` case，`default: return null` | `:18-149` switch 覆盖 start/end/text_delta/iteration/thinking_delta/tool_call/report_update/tool_use_*/message_end；`:147-148 default: return null` | ✅ 属实 |
| 6 | `sub-agent-slice.ts`：queued/dequeued/start 三 case 行为与 §三 逐格一致 | `:52 sub_agent_queued`（卡不存在→建 `isRunning=false,isQueued=true,reportStatus='queued'`；`:53 if (existing) return` 卡存在即忽略）；`:96 sub_agent_dequeued`（`:98 if (sa?.isQueued)`→ 删卡）；`:111 sub_agent_start`（`:112 if (existing?.isQueued)`→ 转 running/`reportStatus='pending'`；`:133 if (existing) return`；否则 `:134` 建 running 卡） | ✅ 行为逐格属实（行区间小瑕疵见 ℹ️1） |
| 7 | `chat-store/index.ts` :842-872：`adaptSubAgentEvent` 返回 null 时事件被丢弃 | `:844 const subEvent = adaptSubAgentEvent(event)`；`:846 if (subEvent) {`；`:868 }`；`:870 continue` —— null 时跳过 if 于 :870 `continue`，事件被丢 | ✅ 属实（plan 引用的 `:846` 正是 `if (subEvent)`） |
| 8 | `Program.SubAgentConcurrency.cs` :64 调用形式为 `AcquireAsync(cancellationToken)` | `:64 return await SubAgentConcurrencyLimiter.AcquireAsync(cancellationToken);`（单一位置参数） | ✅ 属实，⇒「新签名加可选 `onQueued = null` ⇒ 既有测试零改动」成立（其余既有呼叫点 `SubAgentExecutor.cs:138`/`Background.cs:53`/`GoalSubAgentExecutor.cs:50` 同为单参，亦零改动） |
| 9 | `SubAgentCard.tsx:322`、`SubAgentsPanel.tsx:66` | `SubAgentCard.tsx:322 const statusText = isQueued`（`:323`「Queued」）；`:418`/`:449` 琥珀色（`border-amber-500/30` / `bg-amber-500`）。`SubAgentsPanel.tsx:66 if (agent.isQueued) return t('subAgentsPanel.queued'…)` | ✅ 属实 |
| 10 | `AgentRuntimeStreamEvent` 构造参数名 `SubAgentName:` / `ToolUseId:` / `Input:` | `Models/StreamEventModels.cs:63 string? SubAgentName = null`、`:57 string? ToolUseId = null`、`:66 JsonElement? Input = null` | ✅ 属实 |

### 附加核对（支撑性，非 10 条内）

- **事件确实能从 C# 出网**：`AgentStreamMessagePackEmitter.cs` 序列化 `subAgentName`(:98)、`toolUseId`(:92)、`input`(:101)。⇒ plan §4.1(2) 声明的 queued 字段（`SubAgentName`/`ToolUseId`/`Input`）可完整抵达渲染端，无「字段被发射器吞掉」的隐藏缺口。
- **渲染端类型已备**：`lib/agent/sub-agents/types.ts:100`（`sub_agent_queued`）、`:106`（`sub_agent_dequeued`）已在 `SubAgentEvent` union 中，补 case 后类型自洽。
- **C# 侧全仓确无 queued/dequeued**：对 `src`+`tests` 全 `*.cs` grep `sub_agent_queued|sub_agent_dequeued` **零命中** ⇒ plan 第 ③ 层「从不 emit」属实。
- **门禁基线属实**：`docs/plans/iter-v2-38/plan.md` §四记 `npm test` = **67/67**（TS 51 + C# 16）；plan 步骤 5 的「基线 67 → 68」与迭代基线一致。

---

## 三、发现的问题（按严重度分组）

### ❌ 必须修
- **无。** 10 条行号/行为断言全部属实，目标未被漏覆盖，分层无越界，路径合规。按 `docs/dev-workflow.md`「阻断规则（❌ > 0 才阻断）」，不阻断进入用户确认。

### ⚠️ 建议修
1. **「queued 先于 start」这条命门缺自动化断言。**
   plan 步骤 5 只断言 **limiter** 的 `onQueued`（恰好一次 / 不排队零次 / 取消零次），但没有任何测试断言 **子 Agent 执行器真的先发 queued、后发 start**。而本需求的整个正确性就压在这条顺序契约上（见 §四）。建议步骤 5 增一条：以可观测的 emit 记录核对「同一次 Task 调用内 `sub_agent_queued` 必先于 `sub_agent_start`，且立即放行时只发 start 不发 queued」。若不便在既有 C# 套件内造执行器场景，至少在 plan 里显式写明「顺序仅由结构（删除顶部 emit + 挪到 lease 之后）保证、无回归测试」，把缺口摆明。

2. **`sub_agent_start` 相对 `BackgroundSubAgentRegistry.Register` 的时序被翻转，plan 未分析。**
   现状（读码）：`sub_agent_start` 在 `ExecuteAsync:74-81` 发出，**先于** `ExecuteForegroundAsync:110` / `ExecuteBackgroundAsync:25` 的 `Register`。改动后 start 挪到 lease 之后，Register 仍在其原位置 ⇒ 相对次序变为 **Register 先、start 后**。已查 `BackgroundSubAgentRegistry`（仅进程内 `ConcurrentDictionary` + 覆写语义，供 `SubAgentStatus` 模型侧查询）与渲染端（卡片由 start 事件独立构建），**未发现对该次序的硬依赖**，故不判 ❌；但这是一个真实且未被 plan 覆盖的副作用。建议 §四/§七 补一句显式结论：「Register 早于 start 无副作用，理由=……」并在真机复验时留意 `SubAgentStatus` 是否出现「已注册但卡片未亮」的错位。

3. **取消路径补发 `sub_agent_dequeued` 的幽灵卡边界依赖 emit 成功，plan 未给兜底。**
   逐路径推演：
   - 排队中被取消 → 发过 queued ⇒ 补发 dequeued ⇒ 渲染端 `sub_agent_dequeued` 命中 `isQueued` → 删卡。✔ 无幽灵。
   - 拿到 lease 后取消 → 已发 start（卡转 running）⇒ 若此后仍误发 dequeued，渲染端只在 `isQueued` 时删卡，**对 running 卡是空操作** ⇒ 不会误删。✔ 渲染端对该类错序/重复事件天然幂等。
   - **残留风险**：若父 transport 已断，**dequeued 的 emit 失败/丢失**，则 queued 卡永不被删除 ⇒ 幽灵「等待中」卡。后台路径的 emit 已有 try/catch 吞异常的先例，前台父 run 存活时概率低。建议：要么在 plan 写明「接受此边界（父 run 结束时整轮会话数据会被清理）」，要么补一条兜底说明。**不判 ❌**：属低概率边界，且渲染端对错序事件是幂等的。

### ℹ️ 提示
1. **行区间偏短**：plan §三 称「`sub-agent-slice.ts:52-110` 三个 case」——实际 `:52-110` 只含 queued（52-95）与 dequeued（96-110）两 case，`sub_agent_start` case 自 `:111` 起、到 `:178` 止。内容表述无误，仅区间应收敛为 `:52-178`（或直接不写死区间）。
2. **步骤 4 检查点口径**：`package.json:21` 的 `typecheck` = `typecheck:node && typecheck:web`（**两**配置，不含根）。步骤 4 单写 `npm run typecheck` 未含根配置；好在步骤 6 已明列「node / web / root 三配置」，整体门禁口径合规，建议步骤 4 追一句「根配置随步骤 6」。
3. **自动转态的验证点**：§一 目标中「前面的跑完，等待卡自动转工作中」靠 limiter `Pump()`→lease→`start` 隐式承接，步骤清单未单列该验证点；步骤 7 真机复验已含「第 1 个完成 ⇒ 等待卡陆续转工作中」，可接受，仅提示其属隐式覆盖。

---

## 四、结论与放行判定

**放行：可以进入用户确认。**

- **顺序契约（检查项 8）经代码证实成立**：`sub_agent_queued` 遇已存在卡即 `return`（`sub-agent-slice.ts:53`）、`sub_agent_start` 遇已存在非 queued 卡即 `return`（`:133`）、仅当卡为 `isQueued` 时才转 running（`:112`）。⇒ 若 start 先到，后续 queued 必被「已存在⇒忽略」吃掉，「等待中」永不出现。故 plan 的核心主张「`start` 必须从 `ExecuteAsync` 顶部挪到拿到 lease 之后」是**代码真证实的硬要求**，判断正确。
- **「立即返回」承诺不破（检查项 7）**：后台 start 挪进 `BackgroundSubAgent.cs` 的 `Task.Run`（:49）之内，`ExecuteBackgroundAsync` 仍在 :201-210 立即返回占位 `ToolResult`；闸门在 :53 也本就在 `Task.Run` 内。plan §4.1(2) 的「不影响立即返回的承诺」属实。
- **事实层面无硬伤**：10/10 条行号属实，§二链路表与 §三行为表与代码一致，C# 全仓确无 queued/dequeued 发射，渲染端类型与适配缺口定位准确，路径/分层合规，两份被审文档全 CRLF、无 BOM。

**给下一阶段（用户确认 → 执行）的建议**：优先落实 ⚠️1（给顺序契约补一条可执行断言），并把 ⚠️2（Register 时序）与 ⚠️3（取消兜底）在 plan 里各补一句显式结论，以免这两处「已知未分析项」在审查/验证阶段被重新翻出来。
