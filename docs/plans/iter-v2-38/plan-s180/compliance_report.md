# 合规报告（阶段三 · 规划验证）：Plan-S180

- **被审计划**：`docs/plans/iter-v2-38/plan-s180/plan.md`
- **需求正文**：`docs/plans/iter-v2-38/requirements/S-180.md`
- **规范依据**：`docs/dev-workflow.md`「六阶段工作流」→ 阶段三（397-416 行）、`AGENTS.md`
- **审查时间**：2026-10-09 14:03 (+08:00)
- **审查者身份**：独立 subagent（阶段三规划验证，只读；本报告为唯一产物，未改动任何源码）
- **工作区基线**：分支 `dev/v2-iter-38`；被审两文件 `TaskTool.cs`、`SubAgentExecutor.Background.cs` 均**未改动**（`git status` 无这两个文件的改动）
- **结论**：**通过（不阻断）** —— `❌ 0`

---

## 一、逐条检查项结论

### 1. 目标覆盖 —— ✅（附 ℹ️）

需求目标：让主 Agent 在 `background=true` 派完子 Agent 后**不要阻塞等待**。计划 §一/§三用**甲**（`TaskTool.cs` 描述 + `background` schema）与**丙**（后台占位返回文本）两处落点覆盖，且 §三 明确三处文本口径一致（「不要等」+ 把 `SubAgentStatus` 降级为「主动要查才查」）。需求 §3.5「缺失清单」四条中：

| 落点 | 计划 | 结论 |
|---|---|---|
| ① `TaskTool.cs:111` `background` 描述 | 甲② 覆盖 | ✅ |
| ② `TaskTool.cs:74-77` Usage notes | 甲① 覆盖 | ✅ |
| ③ `PromptBuilder.cs:283-292` `<tool_calling>` | **乙，明确不做**（§六.1，老大 14:00 裁定） | ℹ️ 残留缺口 |
| ④ `SystemPromptCache.ComputeKey` | 需求自判「无需改」 | ✅ 一致 |

⇒ 就**老大已拍板的范围（只做甲 + 丙）**而言，覆盖完整、无遗漏；③ 属**经裁定的主动排除**，非计划瑕疵，但记录为残留缺口（见 ℹ️-1）。

### 2. 验证检查点 —— ✅

四步均带「命令 + 期望结果」：

- 步骤 1：`npm run typecheck` 0 错（**脚本存在**：`typecheck:node && typecheck:web`）；`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警（**sln 存在**）；`git diff` 只动两处字符串、`{{enumItems}}` 与 JSON 结构未变。
- 步骤 2：`dotnet build` 0 错 0 警；插值占位符 `{toolCallId}` / `{definition.Name}` / `{description}` 仍在；`placeholder` 变量类型与 `ToolResult` 构造未变。
- 步骤 3：`npm run typecheck` + `dotnet build` + `npm test` **67/67**（**实测当前套件数 = 67**：TS 脚本 51 + C# 测试工程 16 = 67，与计划口径一致）。
- 步骤 4：真机复验（派 `background=true` 子 Agent，观察主 Agent 是否结束回合），并给出「无法当场稳定复现 → 标 `blocked` + 转长期观察」兜底。

⇒ 每步可执行、期望值明确，符合阶段二「每步带验证检查点」要求。

### 3. 路径合规 —— ⚠️（1 处笔误，不阻断）

- 产物目录 `docs/plans/iter-v2-38/plan-s180/` **存在**，计划声明产出 `plan.md` + `compliance_report.md` + `review_report.md` + `verification_report.md`，与同级 `plan-s177/s178/s179` 命名一致 ⇒ ✅
- 被改两文件路径**正确**：`src/runtime/WishfulClaw.Agent/Tools/TaskTool.cs`、`src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs` ⇒ ✅
- **⚠️ 笔误**：§五「不动」清单把 `ToolDispatchRouter.cs` 写作 `src/runtime/WishfulClaw.Agent/**Tools/**ToolDispatchRouter.cs:44`。**实际路径为 `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs:44`**（`Tools/` 子目录不存在；`Glob` 仅命中无 `Tools/` 的路径）。该文件在「不动」清单中、**不会被修改**，故不影响实施正确性，但为避免后续误找/误改，建议修正。
  - 注：需求 `S-180.md` §3.5 只写 `ToolDispatchRouter.cs:44`（不带路径），**无此笔误**；笔误仅出现在 plan.md。

### 4. 分层依赖 —— ✅

本计划只改 `WishfulClaw.Agent` 项目内两个文件，**不新增工程引用、不跨层**：`TaskTool.cs` 仅用同项目 `SubAgentRegistry`；`Background.cs` 位于 `WishfulClaw.Agent` 根（已读实际文件，`using` 为 `WishfulClaw.Contracts/Core.*`，属既有合法依赖）。无 `Core → Workspace` 之类反向依赖，无越层。

### 5. 行号与现状属实 —— ✅（逐字核对，全部一致）

对**当前工作区**代码逐字核对，计划 §二 引用全部属实：

- `TaskTool.cs:74-77`：`Usage notes:` / delegate / stateless / `Set background=true…check progress with SubAgentStatus/SubAgentDetail.` —— 与计划引用**逐字一致** ✅
- `TaskTool.cs:108-112`：`background` 属性块与 `:111` 描述 —— **逐字一致** ✅
- `SubAgentExecutor.Background.cs:204-209` 占位返回 —— `:208`「You can continue working.」、`:209`「…check its progress. When it completes, you will be notified automatically.」**逐字一致** ✅
- 佐证链路属实（实读）：`:49` fire-and-forget `Task.Run` → `:86-92` emit `sub_agent_end` → `:100-101`+`:216-255` 构造 `[Background Sub-Agent Completed]` 通知 → `:106-115` 先 `EnqueueMessages` 注入父 run 队列，`:122-130` 父 run 已 finalize 则缓冲 ⇒ 「主 Agent 是被新一轮消息唤醒」的判断成立 ✅
- 旁证属实：`create-tool.ts` 描述 `:55-87`、`execute` 返 `nativeOnlyTaskResult()` `:49-53`、且 properties 仅 `description`/`prompt`（**确实没有 `background` 参数**）✅；`PromptBuilder.cs` 的 `<tool_calling>` 段与 `:290` 委派句、`ToolDispatchRouter.cs:44` 文案 —— 文案逐字一致 ✅

### 6. 做法可行性（语法/编译）—— ✅ 无编译风险

- **甲①**：新增两行为**普通字符串字面量**（无 `$` 前缀、无 `{`/`}`、无 `\` 转义），与既有 `:75-77` 形态一致 ⇒ 安全。
- **甲②**：目标行位于 `$$"""…"""` **raw string literal**（`:90-117`），其插值定界符为 `{{…}}`。计划新增描述文本内容为 `… Do NOT block, sleep, or poll for it — its report is delivered to you automatically when it finishes (use SubAgentStatus only for a deliberate mid-flight check). …`，**不含 `{{` / `}}` / `"`**，不触碰 `:104` 的 `{{enumItems}}` 插值 ⇒ 不破坏 raw string 解析。
- **丙**：替换段保持 `$"…" + $"…"` 拼接形态，新文本**不含 `{`/`}`**（故 `$` 插值前缀无副作用），`{toolCallId}` / `{definition.Name}` / `{description}` 插值原样保留 ⇒ 安全。
- 结构相容性确认：丙的三行替换文本与现有 `:204-209` 的拼接结构（每行 `…\n" +` 收尾、末行以 `";` 结束）**形态一致**，替换后字符串拼接语法闭合，无编译风险。

### 7. 边界与不回退 —— ✅

§六「刻意不做」明确列 5 条，§五「不动」清单点名 4 个禁区：`create-tool.ts`（非模型面，`execute` 只返 `nativeOnlyTaskResult()`）、`PromptBuilder.cs`（乙）、`SubAgentStatusTool.cs`（工具本身正确）、`ToolDispatchRouter.cs`（cron 非交互拦截，易改错处）。边界清晰，能防下一轮走回头路。（禁区路径 1 处笔误见检查项 3。）

### 8. 风险与副作用（既有测试）—— ✅ 零测试风险

自行扫描确认：

- 全仓搜被改字符串（`You can continue working` / `check its progress` / `you will be notified automatically` / `Set background=true` / `check progress with SubAgentStatus` / `Background sub-agent started`）：**命中仅源码两文件 + 计划/需求文档**，`tests/` 下**无任何断言**引用。
- `tests/` 内引用 `TaskTool` 的两处（`WishfulClaw.ChannelToolVisibilityRegressionTests`、`WishfulClaw.ProviderHeaderRegressionTests/VisibilitySnapshotDump.cs`）只做**工具可见性/声明**层面断言（记录工具**名**、分类归属），**不断言 description / inputSchema 文本**。
- 无 golden/snapshot 文件内嵌 `TaskTool` 描述文本（搜 `Launch a sub-agent` / `Delegate complex tasks immediately` / `Sub-agents are stateless`：命中仅源码 + 文档）。
- ⇒ 改这两段文本**不改变套件数、不触碰任何断言**，计划 §二「零测试风险」的判断成立；步骤 3 的「`npm test` 套件数与断言论不变」可作验收基线。

---

## 二、统计

`❌ 0 / ⚠️ 1 / ℹ️ 2`

**⚠️（1）**
1. §五 将 `ToolDispatchRouter.cs` 误写为 `…/Agent/Tools/ToolDispatchRouter.cs`；实际为 `…/Agent/ToolDispatchRouter.cs`（不在被改面内，不阻断）。

**ℹ️（2）**
1. 需求 §3.5 落点③（`PromptBuilder.cs` `<tool_calling>` 补规则）本次**不做**（乙，经老大裁定）。属**主动排除**而非遗漏；若步骤 4 真机复验仍复现死等，③ 应为首选补点。
2. 步骤 4 真机复验依赖主 Agent 行为，存在如 S-177「无法当场稳定复现」的可能；计划已给出 `blocked` + 长期观察兜底，属可接受，但收尾时须如实标注复验状态。

---

## 三、阻断判定

**❌ = 0 ⇒ 不阻断**，可进入「用户确认」环节。

**最小修法（不阻断，建议一并改）**：仅需在 `plan.md` §五 第 4 条把路径 `src/runtime/WishfulClaw.Agent/Tools/ToolDispatchRouter.cs:44` 修正为 `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs:44`。纯文档修正，不影响实施步骤与验证口径。
