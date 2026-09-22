# compliance report: plan-s134

> 2026-09-22 生成。阶段三规划验证（`docs/dev-workflow.md`「阶段三：规划验证」）。
> 被验证对象：`docs/plans/iter-v2-34/plan-s134/plan.md`（`bytes=17176 CRLF=192 bareLF=0 无 BOM`）。
> 需求口径权威源：`docs/plans/iter-v2-34/raw-requirements.md` 的 `### S-134`（老大 2026-09-22 拍板三条口径）。
> 验证方式：**逐条打开源码核对**，每条给「文件:行」依据，可复核。所有行号均为本次实测。

## 结论

**PASS（❌ 0 / ⚠️ 5）**

三条口径均有落地；12 处引用抽查中 10 处完全命中、2 处仅行号标注微偏（语义正确，不动结论）；四个「待挑战点」全部结论为「成立」。无阻断项，可进入用户确认环节。

## 逐项核查

| # | 核查点 | 结论 | 证据（文件:行） |
|:--:|---|:--:|---|
| A1 | 口径 1·子条「关 tab = kill」有步骤 + 验证 | ✅ | 坑 3 点明「新 tab kind 必须落在真终端一侧」（`plan.md:72`），步骤 11 要求走 `tab.kind === 'ssh-agent' ? … : <LocalTerminal/>` 后半支（`plan.md:98`）；机制属实：`closeTab` 仅对 `kind !== 'ssh-agent'` 发 `TERMINAL_KILL`（`terminal-store.ts:145-147`）。真机场景 4「手动关 tab 让进程真死」（`plan.md:146`） |
| A2 | 口径 1·子条「退出应用 = kill」有验证 | ✅ | 真机场景 5（`plan.md:147`）；既有行为属实：`app.on('before-quit', …)` 调 `killAllTerminalSessions()`（`src/main/index.ts:439`/`:450`）。本刀不动，无需代码步骤 |
| A3 | 口径 1·子条「切会话 / 会话结束但 tab 还开着 = **不动**」有步骤或验证 | ⚠️ | 口径在 `plan.md:17` 抄了，设计上也确实满足（`killTerminalSession` 全仓只有 `terminal:kill` IPC 一个调用点，无任何「切会话 / 会话结束」触发 kill 的路径 —— 见 B1 证据），**但真机验证清单 6 条场景（`plan.md:143-148`）无一条覆盖它**。见 ⚠️1 |
| A4 | 口径 2「读」有步骤 + 检查点 | ✅ | 步骤 3（三动作分发）/6（剥 ANSI+截尾）/7（反向 `terminal:read`）/13（TS 单测）＋真机场景 3（`plan.md:145`）。上限 12 000 字符对齐 `ShellMaxOutputChars`（`AgentRuntimeSshToolExecutor.cs:33`，实测常量=12_000 ✅） |
| A5 | 口径 2「停」有步骤 + 检查点 | ✅ | 步骤 3/7（`terminal:stop`）＋真机场景 4（`plan.md:146`） |
| A6 | 口径 3「SSH 保持原样」有约束 | ✅ | 「明确不动」表首行（`plan.md:78`）＋设计只做本地（`plan.md:19`）。`ShouldRouteToSsh` 只认 `Bash`/`Shell`/`ShellExec`（见 B9），新工具不会被 SSH 链路接管 |
| A7 | 需求「已知的坑」4 条是否都进了计划 | ✅ | 坑 1（会话归属）→「坑 1」表＋步骤 9（`plan.md:70`/`:96`）；坑 2（剥 ANSI）→「坑 1」表 `terminal-handlers.ts` 那条＋步骤 6（`plan.md:70`/`:93`）；坑 3（两套环境）→「坑 2」＋步骤 1 描述（`plan.md:71`/`:88`）；坑 4（关 tab 清理）→「坑 3」＋步骤 11（`plan.md:72`/`:98`） |
| B | 12 处引用真实性 | ⚠️ | 见下节「引用真实性」：10 ✅ / 2 ⚠️，无 ❌ |
| C1 | 待挑战点 1：`ToolDispatchRouter` 分支顺序不被抢走 | ✅ | 见下节 C1 |
| C2 | 待挑战点 2：`isCore: true` 必要/足够 | ✅ | 见下节 C2 |
| C3 | 待挑战点 3：`terminal:created` 发送目标 | ✅ | 见下节 C3 |
| C4 | 待挑战点 4：C# 测试工程接线 | ✅ | 见下节 C4 |
| D1 | 每步有可机械判定的验证检查点 | ✅ | 步骤 1-14 的检查点多为「`dotnet build` 0 错 0 警」「`npx tsc --noEmit -p …` 0 错」「`grep -n "…"` 命中 N 处」（`plan.md:88-101`），可机械判定，非「看着对」 |
| D2 | 文件路径符合项目结构（AGENTS.md） | ✅ | 新建 C# 落 `src/runtime/WishfulClaw.Agent/`（Tools/Providers、执行器根，与 `AgentRuntimeSshToolExecutor.cs` 同级）✅；main 反向处理器落 `src/main/ipc/reverse-handlers/`（与 `cron-reverse-handler.ts` 等同目录）✅；渲染改 `src/renderer/src/…` ✅；测试落 `tests/` ✅ |
| D3 | 分层依赖正确（跨界守反向请求） | ✅ | C# 侧只新建 provider + 执行器（`WishfulClaw.Agent` 内），不新增对 main/TS 的引用；跨语言只经反向请求 `terminal:start/read/stop`（步骤 3/7/8）。main 侧纯函数 `terminal-output-text.ts` 被要求「无 electron 依赖」（步骤 6 检查点，`plan.md:93`）⇒ 可被 TS 单测直接 import，不引入分层倒置 |
| D4 | 单文件 500 行红线算清楚（抽 3 复核） | ✅ | 计划表 7 个文件行数**逐一复核全部正确**：`terminal-handlers.ts=512`、`ToolDispatchRouter.cs=573`、`terminal-store.ts=226`、`BottomTerminalDock.tsx=401`、`reverse-handlers/index.ts=168`、`ToolModule.cs=148`、`ToolCallProcessor.Approval.cs=123`（实测 `\n` 计数，见「附」）。但两个超线文件未拆**也没写 AGENTS.md 要求的文件头豁免注释** —— 见 ⚠️4 |
| D5 | 未定义新概念直接进步骤（如幂等去重落点） | ✅ | 幂等去重落点已点名：步骤 7 的 `terminal:start`（新文件 `terminal-reverse-handler.ts`）内，且设计段说明「判定在 main 侧遍历 `terminalSessions` 完成」（`plan.md:57`/`:94`）。可定位，非悬空概念 |
| D6 | 是否引用了正确的参考源码 | ⚠️ | 模板引用（`AgentRuntimeSshToolExecutor.cs` 反向请求、`WidgetToolProvider.cs:38-39` 可见性、`SshToolProvider`）均命中；仅 `ToolVisibilityScopes.cs:50-65` 范围标注偏窄（见 B7） |

## 引用真实性（12 处逐条抽查）

| # | 计划说法 | 期望 | 实测 | 判定 |
|:--:|---|---|---|:--:|
| B1-1 | `terminal-handlers.ts:299` = `createTerminalSession` | 是 | `:299 export async function createTerminalSession(` | ✅ |
| B1-2 | `:379` = `createWindowEvent(ownerWindowId, 'terminal:created', …)` | 是 | `:379 createWindowEvent(ownerWindowId, 'terminal:created', toSessionRecord(session, false))` | ✅ |
| B1-3 | `:415` = `getTerminalSessionSnapshot` | 是 | `:415 export async function getTerminalSessionSnapshot(` | ✅ |
| B1-4 | `:439` = `killTerminalSession` | 是 | `:439 export async function killTerminalSession(id: string)` | ✅ |
| B1-5 | `:452` = `killAllTerminalSessions` | 是 | `:452 export function killAllTerminalSessions(): void` | ✅ |
| B1-6 | `MAX_ACTIVE_SESSIONS = 32` | 32 | `:108 const MAX_ACTIVE_SESSIONS = 32` | ✅ |
| B1-7 | `INITIAL_OUTPUT_WAIT_MS = 120` | 120 | `:110 const INITIAL_OUTPUT_WAIT_MS = 120`（`waitForInitialOutput` 在 `:280`，`:377` 调用） | ✅ |
| B1-8 | 总行数 = 512（「改动前即已超 500」） | 512 | 实测 `\n` 计数 = 512 | ✅ |
| B2 | `CreateTerminalSessionArgs` / `TerminalSession` / `TerminalSessionListEntry` 三者都**没有** `sessionId`/`projectId` | 均无 | `CreateTerminalSessionArgs:21-29`（只有 cwd/shell/cols/rows/title/command/env）、`TerminalSession:79-97`、`TerminalSessionListEntry:60-72`，三处均无 `sessionId`/`projectId`。**「坑 1」成立** | ✅ |
| B3 | `terminal-store.ts:145` 是 `kind !== 'ssh-agent'` 才发 `TERMINAL_KILL`；`:167` = `ensureSshAgentTab`；`:208` = `_onExit`；总行数 226 | 见左 | `:145 if (tab?.kind !== 'ssh-agent')` + `:147 invoke(IPC.TERMINAL_KILL,…)` ✅；`:167 ensureSshAgentTab:` ✅；总行数=226 ✅；**但 `:208` 是 `_onOutput`（空实现），`_onExit` 在 `:210`**（`plan.md` 参考段以 `:208-225` 为范围，含 `_onExit`，语义无误，唯单点行号差 2）→ ⚠️2 | ⚠️ |
| B4 | `BottomTerminalDock.tsx:80` = `tab.sessionId === sessionId` 过滤；`:344-358` 分支「ssh-agent→AgentSshTerminal，否则 LocalTerminal」；总行数 401 | 见左 | `:79-82 useMemo(… allTabs.filter((tab) => tab.sessionId === sessionId) …)` ✅；`:350 tab.kind === 'ssh-agent' ?` → `AgentSshTerminal`，`:354 : tab.status === 'running' ?` → `LocalTerminal`（范围 344-358 含之）✅；总行数=401 ✅。注：非 ssh-agent 且非 running 时走「已退出」提示而非 `LocalTerminal`，与步骤 11 意图一致 | ✅ |
| B5 | `LocalTerminal.tsx:47-53` 组件入参只有 `terminalId` + `readOnly` | 是 | `:47 export function LocalTerminal({` `:48 terminalId,` `:49 readOnly = false` `:50-53 }: { terminalId: string; readOnly?: boolean }` | ✅ |
| B6 | `WidgetToolProvider.cs:38-39` = `HumanAttended` + `NoHumanToAnswer` | 是 | `:38 visibleScopes: ToolVisibilityScopes.HumanAttended,` `:39 excludedScopes: ToolVisibilityScopes.NoHumanToAnswer));` | ✅ |
| B7 | `ToolVisibilityScopes.cs:50-65` 定义 `HumanAttended`/`NoHumanToAnswer`/`UnattendedRoles`；子代理/后台自动化/频道「都不可见」 | 见左 | 实际取值：`HumanAttended = ["*:chat@*","*:cowork@*"]`（**`:55`**）、`UnattendedRoles = ["*:*@subagent","*:*@goalsubagent","*:*@automation"]`（**`:65`**）、`NoHumanToAnswer = [.. UnattendedRoles, "*:channel@*"]`（**`:83`**）。**验算「都不可见」成立**：子代理 `*:cowork@subagent` 命中 `HumanAttended` 的 `*:cowork@*`，被 `*:*@subagent` 否决；automation 被 `*:*@automation` 否决；频道 `*:channel@*` 既不被 `HumanAttended` 授予、又被 `NoHumanToAnswer` 显式否决（双重收口）。**但 `NoHumanToAnswer` 在 `:83`，超出计划标注的 `:50-65` 范围** → ⚠️3 | ⚠️ |
| B8 | `ToolCallProcessor.Approval.cs:35` 的 `ShellApprovalTools` 实际成员；加 `Terminal` 后是否「默认模式需确认 + 频道豁免」 | 见左 | `:35-38 ShellApprovalTools = { "Bash","Shell","ShellExec","PowerShell" }` ✅。验算：`DefaultModeApprovalTools = BuildDefaultModeApprovalTools()` 内 `tools.UnionWith(ShellApprovalTools)`（`:56`）⇒ 加 `"Terminal"` 即进默认审批集；`IsDefaultModeApprovalTool`（`:111`，public）随之命中；`RequiresApprovalBeforeExecution`（`:60-97`）在 `defaultModeApproval && !SuppressTransportEvents` 时返回 true。频道豁免：`IsChannelShellApprovalWaived`（`:103-105`）= `isChannelSession && ShellApprovalTools.Contains(toolName) && !ShellRequiresApproval`，加 `"Terminal"` 即适用。**计划说法成立**（注：子代理本就不可见，故 `SubAgentApprovalTools`（`:19`，空集）不涉及） | ✅ |
| B9 | `SshToolNames` 只有 `Bash`/`Shell`/`ShellExec`（`Terminal` 不被 `ShouldRouteToSsh` 抢走） | 见左 | `AgentRuntimeSshToolExecutor.cs:35-38 SshToolNames = { "Bash","Shell","ShellExec" }`；`IsSshCapableTool`（`:55-58`）= `SshToolNames.Contains`；`ShouldRouteToSsh`（`:73-90`）先 `!IsSshCapableTool` 即 false。**`Terminal` 不在此集，断为 false** | ✅ |
| B10 | `AgentRuntimeGoalExecutor.cs:29` 从 `state.Parameters` 取 `sessionId` | 是 | `:29 var sessionId = JsonHelpers.GetString(state.Parameters, "sessionId")?.Trim() ?? string.Empty;` | ✅ |
| B11 | `ToolModule.cs` providers 数组 `:54` 附近是 `SshToolProvider`；总行数 148 | 见左 | `:54 new Providers.SshToolProvider(),` ✅；总行数=148 ✅。注：数组在 `:61` 按 `GetType().Name` 排序注册（`OrderBy`），故插入位置不影响注册顺序 —— 计划「`SshToolProvider` 之后」是就代码可读性而言，可接受 | ✅ |
| B12 | `ToolDispatchRouter.cs:409-434` 是 SSH 分支；总行数 573 | 见左 | `:409-423` SSH info 分支（`IsSshInfoTool`）、`:424-439` SSH 远程执行分支（`ShouldRouteToSsh`）—— 范围 409-434 覆盖 SSH 相关分支 ✅；总行数=573 ✅ | ✅ |

## 四个「待挑战点」结论

**C1 · `ToolDispatchRouter` 分支顺序 —— 成立 ✅**
`DispatchAsync` 的分支全是具名 `IsXxxTool(toolCall.Name)` 谓词（实测行：`33/41/63/85/101/120/142/148/163/178/194/200/217/233/249/265/281/297/313/329/347/362/378/394/410/425/441/458/474/489/508`），末尾是 `registry.TryGetExecutor(toolCall.Name, out var executor)`（`:521`）。全仓无任何名 `"Terminal"` 的既有工具或别名（`CodeCompatibleToolProvider` 别名只有 `PowerShell`/`Monitor`）；`ShouldRouteToSsh` 只认 `Bash`/`Shell`/`ShellExec`（B9）。⇒ `Terminal` 不会被任何更早分支抢走。**注意**：`ToolDefinitionPlaceholder` 本身就是 `IToolExecutor`（`ToolDefinitionPlaceholder.cs:12`），若不新增显式分支，会掉进 `:521` 的 registry 兜底并执行到「should be executed via the ToolDispatchRouter…bug」（`:43-45`）。故步骤 4 的显式分支**必需**，计划定位正确。

**C2 · `isCore: true` 必要还是多余 —— 必要，成立 ✅**
`shell ∈ ToolCategoryCatalog.Core`（`ToolCategoryCatalog.cs:36` 定义、`:93-96` 的 `Core` 含 `"shell"`）**只决定类别是否「有资格直接注入」，不决定单工具是否注入**（该文件 `:84-86` 注释明说「a core-category tool added later is core until declared」属误导性措辞）。真正判据是 `AgentRunContextPolicy.ResolveDirectInjection` 的 `if (definition.IsCore)`（`AgentRunContextPolicy.cs:213`），而该值源自 `executor.IsCore`（`ToolRegistry.cs:146`/`:165`）。`ToolDefinitionPlaceholder` 的 `isCore` **默认 `false`**（`ToolDefinitionPlaceholder.cs:29`）。⇒ 与 `Bash`（`ShellExecuteTool.cs:46 IsCore => true`）同等待遇**必须显式写 `isCore: true`**；否则不进直接注入、模型得先走 `use_capability` 才能发现它。计划判断正确，且有同类先例 `PlanToolProvider.cs:31/41/51/69`（`excludedScopes: NoHumanToAnswer, isCore: true`）。

**C3 · `terminal:created` 发送目标 —— 成立 ✅（多窗口限制为既有行为，非本刀引入）**
`resolveOwnerWindowId(sender)` 在 `sender` 为空时返回 `null`（`terminal-handlers.ts:124-126`）；`createWindowEvent(null, …)` 的 `windowId` 非 number ⇒ 走 `?? getMainWindow()` 回退（`:128-138`）；`getMainWindow()` 返回 `setMainWindow` 登记的**主渲染窗口**（`src/main/main-window-registry.ts:15-25`，其头注释明说回退正是为避开 `getAllWindows()[0]` 指向剪贴板增强器 / 快速启动器等辅助窗口的坑）。⇒ C# 反向请求无 sender 时事件落到主窗口；在「聊天 UI 只在主窗口、辅助窗口不挂工具桥」的现行模型下这是**正确目标**，不是错窗口。计划的担心成立且已被既有设计吸收；无需本刀额外处理。

**C4 · C# 测试工程接线 —— 成立 ✅（`TestOutputRoot` 为可选，见下）**
- `tests/` 下**唯一**的相关 sln 是 `tests/WishfulClaw.Tests.sln`（全仓仅两个 sln：`src/runtime/WishfulClaw.sln` 与它）。计划「注册进 `tests/WishfulClaw.Tests.sln`」定位正确。
- `scripts/run-tests.mjs`（`npm test`）自动发现：C# 侧扫 `tests/` 下匹配 `^WishfulClaw\..+RegressionTests$` 的目录（`:32-36`），并**先编译 `tests/WishfulClaw.Tests.sln`**（`:64`），再跑 `tests/<name>/bin/Debug/net11.0/<name>.exe`（`:90`）。⇒ 目录名 `WishfulClaw.TerminalToolRegressionTests` 合规，**注册进该 sln 是必需且充分**，无需改别处（无中央清单）。
- `TestSupport/TestOutputRoot.cs` 是**可选**：范例 `WishfulClaw.ChannelToolVisibilityRegressionTests.csproj` 并未引用 TestSupport（`Get-Content` 实测：仅 `OutputType/TargetFramework` + `ProjectReference` 到 `WishfulClaw.Agent`），其 `Program.cs` 也不含 `TestOutputRoot`。若新套件只做断言、不落临时文件，照 Channel 范例即可，**无需链接 TestOutputRoot**；若需落临时文件，才须按规范加 `<Compile Include="..\TestSupport\TestOutputRoot.cs" Link=…>`。
- 隐藏注意（计划未提，见 ⚠️5）：计划步骤 12 若要断言**频道豁免**，`IsChannelShellApprovalWaived` 是 `internal`（`ToolCallProcessor.Approval.cs:103`），需把新工程加进 `WishfulClaw.Agent.csproj` 的 `<InternalsVisibleTo>`（现有 8 条，见 `WishfulClaw.Agent.csproj`）。若只断言「在审批集内」，可用 **public** 的 `IsDefaultModeApprovalTool`（`:111`），则无需改 csproj。

## 必须修正项（❌）

无。

## 建议项（⚠️）

| # | 建议 | 理由 | 落地 |
|:--:|---|---|---|
| ⚠️1 | 真机验证清单**补一条场景**覆盖口径 1 第三子条：「切到另一个会话，先前会话 tab 的进程仍在（任务管理器确认）；会话结束但 dock 里 tab 还开着，进程仍在」 | 口径 1 明列「切会话 / 会话结束 = 不动」，但现清单 6 条（`plan.md:143-148`）无一条覆盖它。设计上确已满足（`killTerminalSession` 全仓唯一调用点是 `terminal:kill` IPC，无会话级 kill 路径），但需要一条可机械判定的场景把它钉住，防止后续改动误伤 | 在 `plan.md` 真机验证表加第 7 行 |
| ⚠️2 | 参考源码段 `terminal-store.ts:208-225` 改为 `:210-225`（或 `:208-225` 旁注明含 `_onOutput`） | 实测 `_onExit` 在 `:210`（`:208` 是空实现 `_onOutput`）。语义无误，纯行号标注差 2 | 改 `plan.md:180` 的引用 |
| ⚠️3 | 参考源码段 `ToolVisibilityScopes.cs:50-65` 改为 `:50-83` | 实测 `HumanAttended`:55、`UnattendedRoles`:65 在范围内，但 `NoHumanToAnswer` 在 **`:83`**，超出所标范围 | 改 `plan.md:178` 的引用 |
| ⚠️4 | 对 `terminal-handlers.ts`（512）与 `ToolDispatchRouter.cs`（573）两个超线文件，在**文件头补一行豁免注释**（写明豁免理由 + 当前行数），或明确把「补注释」列进本刀步骤 | `AGENTS.md:178`：「只有以下三类可以超 500 行，且必须在文件头注释写明豁免理由与当前行数 —— 否则审查分不清「有意豁免」和「忘了拆」，**一律按 ❌ 处理**」。两文件现均无此注释（实测头部仅 OpenCowork 移植头 / 普通 XML 注释），且不在 :179-181 三类豁免的字面范围内。计划的「不拆，记档」正确，但差这一步注释，会把 ❌ 留给阶段五 | 步骤 9/4 各加一句「同时补文件头豁免注释」，或单列一步 |
| ⚠️5 | 步骤 12 明确：C# 断言用 **public** 的 `IsDefaultModeApprovalTool`；若需验频道豁免，则同刀把新工程加入 `WishfulClaw.Agent.csproj` 的 `<InternalsVisibleTo>` | `IsChannelShellApprovalWaived` 是 `internal`；不加 `InternalsVisibleTo` 则断言编译不过。计划当前只写「`Terminal` 在审批集内」，未点明用哪个入口 | 步骤 12 补明入口，或补 `InternalsVisibleTo` |

## 附：验证过程自证据

- 行数复核（`\n` 计数，权威口径）：`terminal-handlers.ts=512`、`ToolDispatchRouter.cs=573`、`terminal-store.ts=226`、`BottomTerminalDock.tsx=401`、`reverse-handlers/index.ts=168`、`ToolModule.cs=148`、`ToolCallProcessor.Approval.cs=123` —— 与计划表 7 项**逐一吻合**。
- 说明：计划称行数用 `Get-Content | Measure-Object -Line` 实测，但该命令**不数空行**（对 `ToolModule.cs` 实得 133 ≠ 148），产不出计划表里的数字；计划表的**数值本身正确**，仅「实测方法」标注有误（属工具口径瑕疵，不改结论）。
- 分层与结构依据：`AGENTS.md:30-111`（7 层依赖）、`:174-183`（500 行硬线与三类豁免）；`docs/dev-workflow.md`「阶段三：规划验证」（检查项 + 阻断规则「❌ > 0 禁止进入用户确认环节」）。
- 生命周期「不动」依据：全仓 `killAllTerminalSessions|killTerminalSession|TERMINAL_KILL` 命中仅 `terminal-handlers.ts:439/452/498`、`src/main/index.ts:20/450`（`before-quit`）、`channels.ts:63`、`terminal-store.ts:147` —— 无任何「切会话 / 会话结束」触发 kill 的路径。
