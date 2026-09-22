# plan-b3 合规审查报告

- 审查时间：2026-09-22
- 审查对象：`docs/plans/iter-v2-34/plan-b3.md`
- 参考基准：`docs/plans/iter-v2-34/raw-requirements.md`、`requirements/S-135.md`、`requirements/S-136.md`、`requirements/S-137.md`、`docs/dev-workflow.md`（「六阶段工作流」「搬入代码必须遵守两个拆分原则」两节）
- 结论：**不通过**（❌ 共 1 项，⚠️ 共 5 项）
- 审查方式：只读审查 + 路径/符号存在性抽查（Glob / Test-Path / 计数式 Select-String）。未运行构建、未跑测试、未改动任何代码文件。

---

## 逐项检查

| # | 检查项 | 结论 | 说明 |
|:--:|---|:--:|---|
| 1 | 覆盖面 | ⚠️ | S-136（步骤 1~2）、S-137（步骤 3~6）、S-135（步骤 7~9）三项目标均有对应步骤；三条需求的「待裁定」项在「开工前待裁定」表（`:11-19`）逐条给了建议并写明依据。缺口：S-137 需求勘测的「② 后台按钮组零调用点 ⇒ 那组按钮根本不出现」（`S-137.md:16`）在计划中既未纳入、也未声明移出范围。 |
| 2 | 验证检查点 | ⚠️ | 9 个步骤全部带可执行的「验证」行（typecheck / dotnet build / 真机 / npm test），总体达标。两处偏弱：① 步骤 4（`:57`）用 `npm test -- --csharp-only`，该参数是否被 `scripts/run-tests.mjs` 支持未经核实；② 步骤 7（`:74`）搬几百行只验 `typecheck` 0 错，无行为等价性验证。 |
| 3 | 文件路径真实性 | ❌ | 「涉及文件」表 10 行里 8 行为真实存在的路径；**`src/main/ipc/channels.ts` 实测不存在**（❌，见问题清单）；`src/main/ipc/<shell 相关>.ts` 为占位符而非文件名（⚠️）；新建文件 `src/main/ipc/adaptive-event-batcher.ts` 已明确标注「**新建**」，但「（或拆分后的多文件）」未列出落定文件名。 |
| 4 | 分层依赖 | ✅ | 改动面仅落三处，方向均为允许的：渲染层 store、`WishfulClaw.Agent`（C# 工具/agent 运行层）、`src/main/ipc`。计划未引入任何 Core→Workspace / Core→Worker 之类的倒挂引用，也未要求跨层直接引用。 |
| 5 | 参考源码路径真实性 | ✅ | 4 条参考路径实测全部存在：OpenCowork `chat-store.ts`、`shell-handlers.ts`、`adaptive-event-batcher.ts`、本地 `session-slice.ts`。仅行数口径有出入（见 ⚠️5）。 |
| 6 | 前置核实项 | ✅ | S-136「消息落库方式必须先核实」（`S-136.md:27`）→ 步骤 1（`:39`）写明「**已核实** `dbCreateSession` 只写会话元数据、不写消息」并落到「逐条 `dbUpsertMessage`」（该 API 实测存在）；S-137「`execId` 来源」（`S-137.md:43`）→ 步骤 3（`:51`）有专门「**前置核实**」条目，风险表（`:111`）另给兜底方案。两项均已闭环。 |
| 7 | 拆分原则 | ⚠️ | 步骤 7（`:72`）明确引用 `dev-workflow.md`「搬入代码必须遵守两个拆分原则」，给出 200~500 行目标与四类归位方向（聚合器 / 配置 / 事件白名单 / 序列化），方向正确；但未落到具体文件面，「单文件 200~500 行」也没有成为可执行检查点。 |

---

## 问题清单（仅 ❌ / ⚠️）

### ❌ 1（critical · 文件路径真实性）：`src/main/ipc/channels.ts` 不存在
- 出现位置：`plan-b3.md:90`（涉及文件表）、`plan-b3.md:59`（步骤 5）。
- 实测证据：`Test-Path src/main/ipc/channels.ts` → `False`。`src/main/ipc/` 目录下为 `channel-handlers.ts`、`worker-forward-handlers.ts`、`agent-stream-handler.ts`、`worker-forward-handlers.ts` 等，**没有 `channels.ts`，也没有 `shell-handlers.ts`**。
- 需求正文指向的其实是另一个文件：`S-137.md:18` 说的是 `src/renderer/src/lib/ipc/channels.ts`（该文件实测存在，`SHELL_* / PROCESS_*` 整族常量声明在此）。
- 影响：步骤 5 的第一条结论「`src/main/ipc/channels.ts` **已有** `SHELL_ABORT` 常量」挂在了不存在的文件上。若照计划执行，实施者要么去新建一个本不该存在的文件，要么误判前置条件成立，属于会误导执行的真实错误。
- 建议改法（涉及文件表对应行）：
  - 把「`src/main/ipc/channels.ts`｜改（确认 `SHELL_ABORT` 常量）」改为「`src/renderer/src/lib/ipc/channels.ts`｜确认 `SHELL_ABORT` 常量（只读核对，不改）」；
  - 把占位符「`src/main/ipc/<shell 相关>.ts`」改为确定的落点，候选（二者实测均存在）：`src/main/ipc/worker-forward-handlers.ts`（现有向 C# worker 转发请求的集中处）或 `src/main/ipc/channel-handlers.ts`；
  - 步骤 5（`:59`）同步改：`SHELL_ABORT` 常量位于 `src/renderer/src/lib/ipc/channels.ts`，主进程新增 `shell:abort` handler 落在上述确定文件。

### ⚠️ 1（warning · 覆盖面）：S-137「② 后台按钮组恒空」未表态
- 证据：`S-137.md:16` 明确勘测到 `initBackgroundProcessTracking` / `registerBackgroundProcess` 同样零调用点 ⇒ 后台那组按钮（`bash-output.tsx:179-209`）**根本不出现**。
- 计划只处理 ① 前台按钮（步骤 5 接 `registerForegroundShellExec` + `bash-output.tsx:211-226`），对 ② 既未纳入步骤，也未在「范围与顺序」或风险表声明「本次不做 / 另立需求」。
- 影响：范围边界不清。验证态/收尾时容易被追问「后台按钮也不出现，算不算这条需求没修完」而没有口径。
- 建议：在「范围与顺序」表或风险表补一行显式结论 —— 二选一：(a) 本次一并接 `registerBackgroundProcess` 并加验证点；(b) 明确「② 后台按钮组本刀不接，理由：无进程句柄来源 / 需求现象仅指前台」，并登记为遗留项。

### ⚠️ 2（warning · 验证检查点）：`npm test -- --csharp-only` 参数未核实
- 位置：`plan-b3.md:57`。同文「门禁基线」（`:126`）只写了 `npm test` 全量 47/47（TS 35 + C# 12），并未出现 `--csharp-only` 这一用法。
- 影响：若 `scripts/run-tests.mjs` 不支持该参数，该步骤的验证命令会跑成全量或直接失败，验证记录对不上账。
- 建议：核实 `scripts/run-tests.mjs` 的参数约定；若不支持，改为「`npm test` 全量（C# 12 项）」或写明本仓实际支持的筛选方式。

### ⚠️ 3（warning · 验证检查点）：S-135 搬入无行为等价性验证
- 位置：`plan-b3.md:74`（步骤 7 的验证仅 `npm run typecheck` EXIT=0）。
- 依据：`dev-workflow.md:395` 要求大文件拆分后「保持逻辑等价，不改变行为，只改组织结构」。typecheck 只验类型，验不了聚合语义（合批边界、控制事件必须直通、`maxBufferSize` 溢出行为、前台/后台两档切换）。
- 建议：步骤 7 增加一条可执行验证 —— 按 `dev-workflow.md:280` 的既有约定加 TS 回归脚本（`tests/<名字>/program.ts` + `package.json` 的 `test:<名字>`，会被 `npm test` 自动收进来，无需改 `run-tests.mjs`），断言至少三条：① 同一 `runId` 的多个 `textDelta` 在窗口内合并为一条；② 控制类事件不参与合批、立即直通；③ 缓冲区超 `maxBufferSize` 时立即 flush。即把 S-136 步骤 1 的做法（加回归断言）同样用在 S-135 上。

### ⚠️ 4（warning · 拆分原则）：拆分后的文件面未落定
- 位置：`plan-b3.md:72`（「各归其位」）与 `plan-b3.md:94`（涉及文件表写「（或拆分后的多文件）」）。
- 影响：`dev-workflow.md:395-398` 的两个拆分原则要求「分到各自的文件中，放入 AGENTS.md 项目结构中对应的目录」。计划只给了四类职责名称，没有给出拆分后的文件名与目标目录，实施态仍要临场决策，且无法在步骤 7 验证「单文件 200~500 行」。
- 建议：在计划里预列拆分清单（示例，目录以 AGENTS.md 项目结构为准）：聚合器 `adaptive-event-batcher.ts`（核心状态机 + flush 调度）、配置 `batcher-config.ts`（`foregroundFlushMs` / `backgroundFlushMs` / `maxBufferSize` / `idleTimeoutMs` 阈值）、事件白名单 `aggregatable-events.ts`（`AGGREGATABLE_EVENT_TYPES`）、序列化/合并 `batcher-codec.ts`（`textDelta` / `thinkingDelta` / `toolArgsDelta` 累加逻辑）。并把「每个文件 200~500 行」写成步骤 7 的验证项（如「拆分后逐文件行数 ≤500 且 ≥200」）。

### ⚠️ 5（info · 参考源码）：918 行 与实测 853 行不符
- `D:\koda\OpenCowork\src\main\ipc\adaptive-event-batcher.ts` 实测 **853 行 / 29555 字节**。计划（`:71`、`:103`）与需求（`S-135.md:14`、`:26`）均写作 918 行。
- 影响：不影响「需要拆分」的结论（853 行同样远超 500 行上限），但建议改为实测值或注明计数口径（如是否含空行/注释统计差异），免得验证态对不上账。

---

## 附：路径抽查记录

> 方法：`Test-Path` / `Get-ChildItem`（存在性）+ 计数式 `Select-String`（符号出现次数）。**只查存在性，未读源码内容**。抽查时间 2026-09-22。

### A. 计划「涉及文件」表（`plan-b3.md:84-95`）

| 计划中路径 | 实测 | 备注 |
|---|:--:|---|
| `src/renderer/src/stores/chat-store/session-slice.ts` | ✅ 存在 | S-136 |
| `src/runtime/WishfulClaw.Agent/Tools/ShellTools/ShellExecuteTool.cs` | ✅ 存在 | S-137 |
| `src/runtime/WishfulClaw.Agent/Tools/ShellTools/ShellExecuteTool.Process.cs` | ✅ 存在 | S-137 |
| `src/runtime/WishfulClaw.Agent/AgentRuntimeModule.cs` | ✅ 存在 | S-137 |
| `src/main/ipc/channels.ts` | ❌ **不存在** | 同名文件在 `src/renderer/src/lib/ipc/channels.ts`（存在） |
| `src/main/ipc/<shell 相关>.ts` | ⚠️ 占位符 | `src/main/ipc/shell-handlers.ts` 实测不存在；候选落点见 ⚠️ 问题 1 |
| `src/renderer/src/stores/agent-store/slices/background-process-slice.ts` | ✅ 存在 | S-137 |
| `src/renderer/src/components/chat/ToolCallCard/output-blocks/bash-output.tsx` | ✅ 存在 | S-137 |
| `src/main/ipc/adaptive-event-batcher.ts` | 🆕 已标「新建」 | S-135（拆分后多文件未列明，见 ⚠️4） |
| `src/main/ipc/agent-stream-handler.ts` | ✅ 存在 | S-135 |

### B. 计划「参考源码」表（`plan-b3.md:99-104`）

| 路径 | 实测 |
|---|:--:|
| `D:\koda\OpenCowork\src\renderer\src\stores\chat-store.ts` | ✅ 存在 |
| `D:\koda\OpenCowork\src\main\ipc\shell-handlers.ts` | ✅ 存在 |
| `D:\koda\OpenCowork\src\main\ipc\adaptive-event-batcher.ts` | ✅ 存在（853 行 / 29555 字节，与 918 行口径不符） |
| `src/renderer/src/stores/chat-store/session-slice.ts` | ✅ 存在 |

### C. 计划正文连带提到的其它路径（存在性）

| 路径 | 引用于 | 实测 |
|---|---|:--:|
| `src/renderer/src/stores/chat-store/db-helpers.ts` | 步骤 1（`:39`，引 `:313`） | ✅ 存在 |
| `src/runtime/WishfulClaw.Agent/Tools/ShellTools/ShellTypes.cs` | 待裁定表（`:16`，引 `:14`） | ✅ 存在 |
| `src/renderer/src/components/chat/AssistantMessage/action-bar.tsx` | `S-136.md:9` | ✅ 存在 |
| `src/renderer/src/locales/zh/chat.json` | `S-136.md:10` | ✅ 存在 |
| `src/main/ipc/worker-forward-handlers.ts` | 本次追加（候选落点） | ✅ 存在 |
| `src/main/ipc/channel-handlers.ts` | 本次追加（候选落点） | ✅ 存在 |
| `src/runtime/WishfulClaw.sln` | 步骤 3 构建目标（`:53`） | ✅ 存在 |
| `tsconfig.web.json` | 步骤 1 / 5 验证命令（`:41`、`:62`） | ✅ 存在 |
| `tests/WishfulClaw.Tests.sln` | `dev-workflow.md:280` 测试注册目标 | ✅ 存在 |

### D. 符号存在性（仅计数，未读内容）

| 符号 | 命中数 | 结论 |
|---|:--:|---|
| `dbUpsertMessage` | 14 | ✅ 步骤 1 依赖的落消息 API 存在，写法可行 |
| `forkSessionFromMessage` | 0（`src/renderer/src/**/*.ts`） | ✅ 与 `S-136.md:11-17`「全仓无实现体」一致，缺口定性成立 |

### E. 白名单文件读取记录

| 文件 | 结果 |
|---|---|
| `docs/plans/iter-v2-34/plan-b3.md` | ✅ 已读（全文 128 行） |
| `docs/plans/iter-v2-34/raw-requirements.md` | ✅ 已读（清单 31 项，S-135 ~ S-137 见 `:41-43`，候选池转正说明见 `:49`） |
| `docs/plans/iter-v2-34/requirements/S-135.md` | ✅ 已读（28 行） |
| `docs/plans/iter-v2-34/requirements/S-136.md` | ✅ 已读（30 行） |
| `docs/plans/iter-v2-34/requirements/S-137.md` | ✅ 已读（47 行） |
| `docs/dev-workflow.md` | ✅ 已读（「六阶段工作流」`:284-` 与「搬入代码必须遵守两个拆分原则」`:393-398`；另核对阶段四验证条款 `:385-391`、测试注册条款 `:280`） |

### F. 本次审查未做（审查态纪律）

- 未运行 `npm run typecheck` / `npm test` / `dotnet build`（不跑构建测试）。
- 未修改任何代码文件、未 commit、未 push。
- 唯一写入文件 = 本报告 `docs/plans/iter-v2-34/plan-b3-compliance_report.md`。


