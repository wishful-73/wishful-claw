# Plan: iter-v2-34 S-134 —— 常驻终端：agent 可起、可读、可停的可见进程

> 2026-09-22 建。需求口径权威源 = 同目录 `../raw-requirements.md` 的 `### S-134`，本文件只排步骤与文件面，不重复取证。
> 立项缘由：本迭代「shell 命令执行 / 常驻终端」讨论，老大 2026-09-22 拍定三条口径（生命周期 / 读停都要 / SSH 保持原样）。
> 与 `plan.md`（S-112 + S-111）、`plan-b2.md`（S-107 / S-108 / S-109 / S-115）、`plan-s132/plan.md`（S-132）**互不依赖**，可独立实施、独立成刀。
> **阶段三（规划验证）：PASS（❌ 0 / ⚠️ 5）** —— 报告见同目录 `compliance_report.md`。5 条建议**全部采纳**并已回写本文件：⚠️1 补真机场景 7；⚠️2 / ⚠️3 修正两处引用行号；⚠️4 两个超线文件补豁免头注释（并入步骤 4 / 9）；⚠️5 步骤 12 改用 public 断言入口。

## 目标

给 agent 一条「起常驻进程 → 看得见 → 能读输出 → 能停」的完整回路：新增 `Terminal` 工具，进程落在**底部终端面板**里，与用户自建的本地终端**共用同一个 `LocalTerminal` 组件**。

**不是**「再造一个 Bash」——`Bash` 继续负责「一次性、要 stdout/stderr/exitCode」，`Terminal` 负责「常驻、要看、要停」。分工写进工具描述。

## 口径（照抄 `raw-requirements.md`，本文件不重新讨论）

| # | 事项 | 裁定 |
|:--:|---|---|
| 1 | 进程生命周期 | 关 tab = kill；退出应用 = kill；切会话 / 会话结束但 tab 还开着 = **不动** |
| 2 | 能力面 | 读 + 停都要（单工具 `action: start \| read \| stop`） |
| 3 | SSH 项目 | 保持原样 —— 不动 SSH 链路，本工具只做本地 |

## 现状：五件现成件（已逐条读码核实）

| 现成件 | 位置 | 本需求怎么用 |
|---|---|---|
| 真 node-pty 会话 | `src/main/ipc/terminal-handlers.ts:299` `createTerminalSession` | 直接调，不新写 PTY |
| 会话快照（含 buffer） | 同文件 `:415` `getTerminalSessionSnapshot` | `start` 返回 tail、`read` 取输出，都走它 |
| 杀会话 | 同文件 `:439` `killTerminalSession` | `stop` 直接调 |
| 事件广播 | 同文件 `:379` `createWindowEvent(ownerWindowId, 'terminal:created', …)` | 通道已存在，**渲染端目前无人监听** ⇒ 加监听即可建 tab |
| 交互终端组件 | `src/renderer/src/components/terminal/LocalTerminal.tsx` | 入参只有 `terminalId`；Dock 里 agent tab 与用户自建 tab 共用它 ⇒ **零新增渲染组件** |

**反向请求模板**：C# `AgentRuntimeSshToolExecutor`（`:156` `AgentRuntimeReverseRequests.RequestAsync(context, "ssh:exec", …)`）→ main `src/main/ipc/reverse-handlers/index.ts` 的 `directHandlers`。

**tab 归属先例**：`terminal-store.ts:167` `ensureSshAgentTab`（每会话一个 agent tab，**不自动打开 dock**）+ `BottomTerminalDock.tsx:80` 按 `sessionId` 过滤。

## 设计

### 工具签名

| 参数 | 类型 | 必填 | 说明 |
|---|---|:--:|---|
| `action` | enum `start` / `read` / `stop` | ✅ | 必填 —— 省略后的默认值会让「起」和「读」的误用更隐蔽 |
| `command` | string | start | 要跑的命令 |
| `terminalId` | string | read / stop | `start` 返回的 id |
| `cwd` | string | — | 缺省 = 会话工作目录 |
| `shell` | string | — | 缺省 = 设置页「终端与 SSH」的 shell |
| `env` | object | — | 附加环境变量 |
| `title` | string | — | tab 标题；缺省 = `Agent: ` + 命令首行（截断 40 字符） |

**返回**：
- `start` ⇒ `{ "terminalId": "term-…", "status": "running\|exited", "exitCode"?: n, "tail": "…" }` —— **起完等首次输出再返回**（main 已有 `waitForInitialOutput`，120 ms），让 agent 知道到底起没起来，而不是起了个报错的 `npm run dev` 还当成功。
- `read` ⇒ `{ "terminalId": …, "status": …, "exitCode"?: n, "text": "…" }` —— 纯文本尾巴，上限 12 000 字符（对齐 `AgentRuntimeSshToolExecutor.ShellMaxOutputChars`）。
- `stop` ⇒ `{ "terminalId": …, "status": "stopped" }`。

### 归属与去重（两条硬约定）

1. **tab 必须带 `sessionId`** —— 否则被 `BottomTerminalDock.tsx:80` 的 `tab.sessionId === sessionId` 挡掉，**起了但看不见**。`CreateTerminalSessionArgs` / `TerminalSession` / `TerminalSessionListEntry` 三者都要加 `sessionId?` / `projectId?`，并由 `toSessionRecord` 透传进 `terminal:created` 事件。
2. **同会话 + 同 command + 仍在 running ⇒ 直接返回已有会话**（幂等）。理由：agent 极爱重复跑同一条 `npm run dev`，不去重就是 tab 堆积。判定在 main 侧遍历 `terminalSessions` 完成。

### 可见性与审批（两条不能省的接线）

- 可见性 **照 `WidgetToolProvider.cs:38-39` 的先例**：`visibleScopes: ToolVisibilityScopes.HumanAttended` + `excludedScopes: ToolVisibilityScopes.NoHumanToAnswer`。
  - 理由：底部终端是**有人看着的共享面板**。子代理 / 后台自动化 / 频道会话没有人在键盘前，起了没人收 ⇒ 一律不可见。
  - 分类 `category: "shell"`（`shell` ∈ `ToolCategoryCatalog.Core`），`isCore: true` —— 与 `Bash` 同等待遇，否则模型得先走 `use_capability` 才发现它存在。
- 审批 **必须**把 `"Terminal"` 加进 `ToolCallProcessor.Approval.cs:35` 的 `ShellApprovalTools`。不加 = 绕过审批的后门，**这条不是「后续优化」**。加进去同时自动获得：默认模式需确认、频道会话沿用 `shellRequiresApproval` 豁免开关。

### 三个必须在实施时处理的坑

| # | 坑 | 处理 |
|:--:|---|---|
| 1 | **读输出带 ANSI** | main 的 buffer 是裸 PTY 字节流（转义序列 + `\r`）。新建纯函数模块剥离后再截尾，别把转义码喂给模型 |
| 2 | **执行环境两套语义** | `Bash` 在 C# 跑（自注入 `PYTHONUTF8` / `LANG`、自己的 shell 候选链），`Terminal` 在 main 跑（`process.env` + 设置页终端 shell）。工具描述里写明，别让模型以为等价 |
| 3 | **关 tab 的清理路径** | `closeTab` 只对 `kind !== 'ssh-agent'` 发 `TERMINAL_KILL`（`terminal-store.ts:145`）。新 tab kind **必须落在「真终端」这一侧**，否则关掉 tab 进程还在 |

### 明确不动（防扩大范围）

| 项 | 为什么不动 |
|---|---|
| `AgentRuntimeSshToolExecutor` / `ShouldRouteToSsh` / `ssh:exec` | 口径 3：SSH 保持原样 |
| `Bash`（`ShellExecuteTool`）的行为与 schema | 分工靠描述，不改行为 |
| `AgentSshTerminal` / `ssh-agent` tab 逻辑 | 只读观察 tab，与本需求无关 |
| 右侧 `ProjectTerminalDock` / `TerminalPanel` | 本需求只碰底部 Dock |
| `terminal-handlers.ts` 的 500 行超标问题 | **改动前即已超线（512 行）**；本刀只加 3 个可选字段的透传（约 +10 行），拆分会把「一需求一刀」撕开 ⇒ 不拆，记档 |

## 步骤清单

| # | 步骤 | 落点 | 验证检查点 |
|:--:|---|---|---|
| 1 | 工具定义 provider：`Terminal`，`action` enum + 6 个可选参数；`category: "shell"` / `isCore: true` / `HumanAttended` + `NoHumanToAnswer`；描述里写清与 `Bash` 的分工、**始终本地**、环境与 `Bash` 不同 | **新建** `src/runtime/WishfulClaw.Agent/Tools/Providers/TerminalToolProvider.cs` | `dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警；`ToolSchemaBuilder` 用法对齐同目录 provider |
| 2 | provider 注册进 providers 数组 | `Tools/ToolModule.cs`（`:54` 附近，`SshToolProvider` 之后） | 同上 |
| 3 | 执行器：`IsTerminalTool` + 三动作分发 + 反向请求 `terminal:start` / `terminal:read` / `terminal:stop`；`sessionId` / `projectId` 从 `state.Parameters` 取（先例 `AgentRuntimeGoalExecutor.cs:29`） | **新建** `src/runtime/WishfulClaw.Agent/AgentRuntimeTerminalExecutor.cs` | 编译 0 错；错误码风格对齐同目录执行器的 `EncodeError` |
| 4 | 路由分支：`Terminal` → 执行器（放在 SSH 分支旁，`ToolDispatchRouter.cs:424` 之前，避免被 `ShouldRouteToSsh` 抢先）；**同时在该文件头补一行豁免注释**（写明「改动前即已超 500 行的理由 + 当前行数」，对齐 `AGENTS.md:178`） | `AgentRuntimeTerminalExecutor` 新分支 + `ToolDispatchRouter.cs` 文件头 | `grep -n "IsTerminalTool" ToolDispatchRouter.cs` 命中 1 处；文件头 `grep -n "500 行"` 命中 1 处 |
| 5 | 审批：`ShellApprovalTools` 加 `"Terminal"` | `ToolCallProcessor.Approval.cs:35` | 编译 0 错；步骤 12 的 C# 断言覆盖 |
| 6 | 纯文本抽取：剥 ANSI 转义、`\r\n` 归一、按字符数截尾 | **新建** `src/main/ipc/terminal-output-text.ts` | 无 electron 依赖（供 TS 单测直接 import） |
| 7 | 反向处理器：`terminal:start`（含幂等去重 + `Agent: ` 标题）/ `terminal:read` / `terminal:stop`，复用三个现成函数 | **新建** `src/main/ipc/reverse-handlers/terminal-reverse-handler.ts` | 类型零错；不 import 渲染端 |
| 8 | 注册三个方法进 `directHandlers` | `src/main/ipc/reverse-handlers/index.ts` | `isMainProcessMethod` 走 `directHandlers.has` ⇒ 无需额外改它；`npx tsc --noEmit -p tsconfig.node.json` 0 错 |
| 9 | 会话记录加 `sessionId` / `projectId`：三个类型 + `toSessionRecord` 透传；**同时在该文件头补一行豁免注释**（理由 + 当前行数，对齐 `AGENTS.md:178`） | `src/main/ipc/terminal-handlers.ts` | `grep -n "sessionId" terminal-handlers.ts` 命中进 `CreateTerminalSessionArgs` / `TerminalSession` / `TerminalSessionListEntry` / `toSessionRecord` 四处；文件头 `grep -n "500 行"` 命中 1 处 |
| 10 | 渲染端 store：`TerminalTabKind` 加 `'local-agent'`；新增 `_onCreated`；`init()` 注册 `IPC.TERMINAL_CREATED` 监听，**建 tab 但不自动打开 dock**（对齐 `ensureSshAgentTab` 的既有注释语义） | `src/renderer/src/stores/terminal-store.ts` | `npx tsc --noEmit -p tsconfig.web.json` 0 错；tab 的 `id` = 事件里的终端 id（`_onExit` 靠它更新状态） |
| 11 | Dock 区分 agent tab：`local-agent` 加图标/配色（渲染分支复用 `LocalTerminal`，**不改行为**） | `src/renderer/src/components/terminal/BottomTerminalDock.tsx` | `local-agent` 仍走 `tab.kind === 'ssh-agent' ? … : <LocalTerminal/>` 的**后半支** |
| 12 | C# 回归：`Terminal` 在审批集内、provider 注册出定义（category `shell` / isCore / 两个 scope）、schema 合法可解析。**断言入口用 public 的 `IsDefaultModeApprovalTool`（`ToolCallProcessor.Approval.cs:111`），无需改 csproj**；若确需断言频道豁免（`IsChannelShellApprovalWaived` 是 `internal`）才把新工程加进 `WishfulClaw.Agent.csproj` 的 `<InternalsVisibleTo>` | **新建** `tests/WishfulClaw.TerminalToolRegressionTests/` 并注册进 `tests/WishfulClaw.Tests.sln` | 单跑该 exe 打印通过 |
| 13 | TS 回归：纯文本抽取对 ANSI 序列 / `\r` / 超长截尾的断言 | **新建** `tests/terminal-output-text/program.ts` + `package.json` 加 `test:terminal-output-text` | `npm run test:terminal-output-text` 通过 |
| 14 | 门禁：`npm run typecheck` + `npm test` 全量 + C# 两 sln 编译 0 错 0 警 | — | 全绿 |
| 15 | **真机验证**（见下节 7 条） | — | 老大试 |
| 16 | 回写 `raw-requirements.md` 的 S-134 实施记录 + `docs/progress/v2-iter-34.md` | — | 非代码，随本刀一起进 |
| 17 | **提交（本需求一刀）** | — | 不推送 |

## 涉及文件

| 文件 | 动作 |
|---|---|
| `src/runtime/WishfulClaw.Agent/Tools/Providers/TerminalToolProvider.cs` | **新建**（步骤 1） |
| `src/runtime/WishfulClaw.Agent/AgentRuntimeTerminalExecutor.cs` | **新建**（步骤 3） |
| `src/runtime/WishfulClaw.Agent/Tools/ToolModule.cs` | 改（步骤 2） |
| `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs` | 改（步骤 4） |
| `src/runtime/WishfulClaw.Agent/ToolCallProcessor.Approval.cs` | 改（步骤 5） |
| `src/main/ipc/terminal-output-text.ts` | **新建**（步骤 6） |
| `src/main/ipc/reverse-handlers/terminal-reverse-handler.ts` | **新建**（步骤 7） |
| `src/main/ipc/reverse-handlers/index.ts` | 改（步骤 8） |
| `src/main/ipc/terminal-handlers.ts` | 改（步骤 9） |
| `src/renderer/src/stores/terminal-store.ts` | 改（步骤 10） |
| `src/renderer/src/components/terminal/BottomTerminalDock.tsx` | 改（步骤 11） |
| `tests/WishfulClaw.TerminalToolRegressionTests/**` + `tests/WishfulClaw.Tests.sln` | **新建 + 改**（步骤 12） |
| `tests/terminal-output-text/program.ts` + `package.json` | **新建 + 改**（步骤 13） |
| `docs/plans/iter-v2-34/raw-requirements.md` | 改（步骤 16，非代码） |
| `docs/progress/v2-iter-34.md` | 改（步骤 16，非代码） |

## 单文件 500 行红线核查（2026-09-22 实测 `\n` 计数）

| 文件 | 实测 | 判定 |
|---|:--:|---|
| `src/main/ipc/terminal-handlers.ts` | 512 | **改动前即超线**；本刀 +约 8 行，不拆（见「明确不动」），**步骤 9 补文件头豁免注释** |
| `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs` | 573 | **改动前即超线**；本刀 +约 12 行（1 个分支），不拆，**步骤 4 补文件头豁免注释** |
| `src/renderer/src/stores/terminal-store.ts` | 226 | 在线内（+约 35） |
| `src/renderer/src/components/terminal/BottomTerminalDock.tsx` | 401 | 在线内（+约 6） |
| `src/main/ipc/reverse-handlers/index.ts` | 168 | 在线内（+约 4） |
| `src/runtime/WishfulClaw.Agent/Tools/ToolModule.cs` | 148 | 在线内（+1） |
| `src/runtime/WishfulClaw.Agent/ToolCallProcessor.Approval.cs` | 123 | 在线内（+1） |
| 四个新建文件 | — | 预估 70 / 200 / 70 / 110，全部在线内 |

## 真机验证清单（步骤 15）

| # | 场景 | 期望 |
|:--:|---|---|
| 1 | 让 agent 起一条常驻命令（如 `npm run dev`） | 底部 Dock 出现 `Agent: …` tab；**不自动弹开**，但手动打开就能看到累计输出 |
| 2 | 在 tab 里敲键盘 | 有回显、能交互（证明是真 PTY，不是只读观察） |
| 3 | `action: read` | 返回纯文本，**无 `\x1b[…` 转义字符**、无 `^M` |
| 4 | `action: stop` 与**手动关 tab** | 两条路都让进程真的死掉（任务管理器里确认没有残留 node） |
| 5 | 退出应用 | 进程死（`killAllTerminalSessions` 既有行为） |
| 6 | 子代理 run / 频道会话 | `Terminal` **不在**工具表里（可见性收口生效） |
| 7 | **切到另一个会话**（原会话 tab 仍开着）→ 任务管理器确认原进程仍在；**结束会话**但 dock 里 tab 还开着 → 进程仍在 | 口径 1 第三子条：切会话 / 会话结束**不杀进程**，用户是唯一收尾人 |

**注意 1**：run 期间会占用 dev 实例锁 ⇒ 跑 `npm test` / `dotnet build` 前先按 `docs/dev-workflow.md`「编译环境」关掉开发实例，验完告知老大重开 `npm run dev:full`。
**注意 2**：验证产物落 `.wishful-claw/tmp/`，验完 `npm run test:clean`。

## 风险与回退

| # | 风险 | 对策 |
|:--:|---|---|
| R1 | tab 建了但看不见（会话归属没传下去） | 步骤 9 的机械判据（四处 `sessionId` 命中）+ 真机场景 1 |
| R2 | 新工具绕过审批 | 步骤 5 是**独立一步**且有 C# 断言兜底，不允许「先上线后补」 |
| R3 | agent 重复起同一命令堆 tab | main 侧幂等去重（同会话 + 同 command + running ⇒ 复用） |
| R4 | 模型分不清 `Bash` / `Terminal`，拿 `Terminal` 跑一次性命令 | 两边描述互相点名分工；真机场景 1 顺带观察 |
| R5 | 转义码污染上下文 | 步骤 6 的纯函数 + 步骤 13 的单测，不靠「看着没乱码」 |
| R6 | 子代理里起了进程没人收 | 可见性 `excludedScopes: NoHumanToAnswer`（照 Widget 先例） |

**回退**：单刀 `git revert`。四条改动链（C# 工具 / main 反向 / 渲染 store / Dock）都在本刀内，无跨刀耦合；未推送前也可 `reset --soft`。

## 提交节奏

- **本需求独立一刀**，按「一个需求一个提交」。
- **不推送** —— 迭代内只 commit，收尾才推。

## 参考源码

**本仓（模板与现成件）**
- `src/main/ipc/terminal-handlers.ts:299` / `:379` / `:415` / `:439` / `:452` —— PTY 会话、`terminal:created` 广播、快照、杀会话、全杀
- `src/main/ipc/reverse-handlers/index.ts:27-66` —— `directHandlers` 反向请求表（`ssh:exec` 是最近的模板）
- `src/runtime/WishfulClaw.Agent/AgentRuntimeSshToolExecutor.cs:98-160` —— 反向请求调用姿态
- `src/runtime/WishfulClaw.Agent/Tools/Providers/SshToolProvider.cs` / `WidgetToolProvider.cs:38-39` / `BrowserToolProvider.cs:31-32` —— provider 写法与可见性先例
- `src/runtime/WishfulClaw.Core/Tools/ToolVisibilityScopes.cs:50-83` —— `HumanAttended`（`:55`）/ `UnattendedRoles`（`:65`）/ `NoHumanToAnswer`（`:83`）的语义
- `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs:409-434` —— 反向请求型工具的分支写法
- `src/renderer/src/stores/terminal-store.ts:39-45` / `:167-206` / `:210-225` —— `ensureSshAgentTab`、`hasSshAgentTabForSession`、`_onExit`（`:208` 是空实现的 `_onOutput`）
- `src/renderer/src/components/terminal/BottomTerminalDock.tsx:78-82` / `:344-358` —— 按会话过滤 + 分支渲染
- `src/renderer/src/components/terminal/LocalTerminal.tsx:47-53` —— 组件入参
- `docs/plans/iter-v2-34/plan-s132/plan.md` —— 本目录计划的格式与严谨度基准

## 阶段三（规划验证）待挑战点

> **验证结论（2026-09-22，`compliance_report.md`）：四项全部判「成立 ✅」**，无 ❌；另收 5 条建议，均已采纳回写本文件（见文件头）。
> 此处保留原题与裁定摘要，便于复查。

1. **`ToolDispatchRouter` 分支顺序**：`Terminal` 是否真的不会被 `ShouldRouteToSsh`（只认 `Bash` / `Shell` / `ShellExec`）或更早的分支抢走。
   → **成立**。全仓无名 `Terminal` 的既有工具/别名；但 `ToolDefinitionPlaceholder` 本身是 `IToolExecutor`，不新增显式分支会掉进 registry 兜底并报内部 bug ⇒ **步骤 4 的显式分支必需**。
2. **`ToolDefinitionPlaceholder` 的 `isCore` 语义**：`shell` 已在 `ToolCategoryCatalog.Core` 内，显式 `isCore: true` 是否必要 / 是否足够。
   → **必要且足够**。类别只决定「有资格注入」，真正判据是 `AgentRunContextPolicy.ResolveDirectInjection` 的 `if (definition.IsCore)`，而 placeholder 默认 `false`。
3. **`terminal:created` 的发送目标**：C# 反向请求无 `sender` ⇒ `resolveOwnerWindowId(null)` 返回 `null` ⇒ `createWindowEvent` 回退 `getMainWindow()`。多窗口场景下是否会送到错窗口。
   → **成立且已被既有设计吸收**。回退目标是登记过的主渲染窗口（`main-window-registry.ts`），正是为避开辅助窗口；**本刀无需额外处理**。
4. **C# 测试工程接线**：`tests/WishfulClaw.Tests.sln` 注册新工程 + `TestOutputRoot.cs` 链接方式是否与既有套件一致（`docs/dev-workflow.md`「测试产物落点」）。
   → **成立**。`TestOutputRoot.cs` 是**可选**：仅断言、不落临时文件则照 `WishfulClaw.ChannelToolVisibilityRegressionTests` 范例即可（步骤 12 已按此口径）。
