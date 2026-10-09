# 审查报告（阶段五 · 代码审查）：Plan-S180

- **审查对象**：分支 `dev/v2-iter-38` **工作区未提交改动**（HEAD = `b4555e7d`）。代码改动仅两个文件：
  - `src/runtime/WishfulClaw.Agent/Tools/TaskTool.cs`（`BuildDescription()` `:77-78`、`BuildSchema()` `:112`）
  - `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs`（占位返回 `:208-210`）
- **审查时间**：2026-10-09 14:09 (+08:00)
- **审查者身份**：独立 subagent（阶段五代码审查，**只读**；本报告为唯一产物，未改动任何源码、未执行任何 git 写操作）
- **审查依据**：`docs/plans/iter-v2-38/plan-s180/plan.md`、`../requirements/S-180.md`、`./compliance_report.md`、`docs/dev-workflow.md`「阶段五：审查态」
- **结论**：**通过（不阻断）** —— `❌ 0`

---

## 一、逐条审查项结论

### 1. 分层与约定 —— ✅

- 改动**只落在** `WishfulClaw.Agent` 项目内的两个既有文件，均为字符串字面量替换；`git diff -- src/` 确认无其他源码文件被触碰。
- 未新增/删除 `using`，未新增工程引用，未跨层（无 `Core → Workspace` 之类反向依赖）。所改两文件同属 `WishfulClaw.Agent`，符合仓库分层约定。
- 与 `dev-workflow.md` 阶段四「新建文件须符合目录结构」无冲突（本刀**未新建源码文件**）。

### 2. 语法与兼容 —— ✅（逐行实读确认，无编译/转义风险）

- **`TaskTool.cs:77`**：`sb.AppendLine("- Set background=true … delivered to you automatically.");` —— **普通字符串字面量**（无 `$` 前缀、无 `{}`、无 `\`），与相邻 `:75-76` 形态一致。含一个 em-dash `—`（U+2014），**实测定位在行内 index 126**，文件为 **UTF-8 无 BOM**，且相邻 `:76` **早已存在同款 em-dash** ⇒ 编码一致、无风险。
- **`TaskTool.cs:78`**：`sb.AppendLine("- Use SubAgentStatus/SubAgentDetail only for a deliberate mid-flight progress check, never as a way to wait for completion.");` —— 同为普通字面量，无转义风险。
- **`TaskTool.cs:112`**：处于 `$$"""…"""` **raw string literal**（`:91`-`:118`）内。**实读确认**：
  - 该行文本**不含任何 `"`**（JSON 值为单层双引号包裹，正文无内嵌引号）；
  - **不含 `{{` / `}}`**（仅在 `(...)` 圆括号与 `,` 逗号，均为 raw string 中的普通字符）；`$$` 定义下单个 `{`/`}` 亦为普通字符；
  - **`:105` 的 `"enum": [{{enumItems}}]` 插值原样保留**（实测 `Contains("{{enumItems}}") == True`）；
  - 文件内 `"""` 恰好出现 **2 次**（开/闭定界符），未被新文本破坏。
  ⇒ **无语法/转义风险**。
- **`SubAgentExecutor.Background.cs:208-210`**：保持 `$"…" + $"…"` 拼接形态；三行文本**不含 `{`/`}`**（故 `$` 前缀无副作用，但无碍），末行仍以 `";` 收尾，拼接语法闭合。**插值占位符仍全部在位**：`:205` `{toolCallId}`、`:206` `{definition.Name}`、`:207` `{description}`。`:209` 含 em-dash（U+2014，实测 index 57），文件 **UTF-8 无 BOM** ⇒ 无风险。
- 静态实读未发现任何编译期或运行期转义问题（未执行 `dotnet build`；本项为纯静态判定，编译门禁归阶段四/六）。

### 3. 口径一致性与对冲句残留 —— ✅

三处文本**全部**同时说清「**不要等**」+「**完成会自动送达**」，且**无对冲句残留**：

| 落点 | 「不要等」 | 「自动送达」 | 「把查询降级为主动要查」 |
|---|---|---|---|
| `TaskTool.cs:77`（Usage notes） | ✅ `Do NOT block, sleep, or poll for a background sub-agent` | ✅ `its report is delivered to you automatically` | （由 `:78` 承接） |
| `TaskTool.cs:78` | ✅ `never as a way to wait for completion` | —— | ✅ `only for a deliberate mid-flight progress check` |
| `TaskTool.cs:112`（schema） | ✅ `Do NOT block, sleep, or poll for it` | ✅ `its report is delivered to you automatically when it finishes` | ✅ `use SubAgentStatus only for a deliberate mid-flight check` |
| `Background.cs:208-210` | ✅ `Do not block, sleep, or poll for it.` | ✅ `its report is delivered to you automatically as a new message` | ✅ `only if you deliberately want a mid-flight progress check` |

- **无残留「去查进度」式引导**：原先唯一反向引导（`check progress with SubAgentStatus/SubAgentDetail` / `check its progress`）已被删除并替换为带对冲的「仅主动要查才查」。
- **无过强表述**：未要求模型「立即结束回合」。`Background.cs:209` 措辞为 **「Continue with other work, or end your turn」**（继续干别的**或**结束回合），保留模型继续他事的分支，与 plan §三「必须守住的点 1」一致。
- 「自动送达」表述**与唤醒链路相符**（完成时先注入父 run 队列、父 run 已 finalize 则缓冲，随后以**一条新 user 消息**重开主 run）⇒ `as a new message` 用词准确。

### 4. 遗漏面 —— ✅（基于实读，无其他模型面遗漏）

- **`SubAgentStatusTool.cs:15-17`**（`SubAgentStatus` 工具描述）：内容为**功能性描述**（「按 toolUseId 查状态；完成时含最终报告（截断）；省略则列出全部；详情见 SubAgentDetail」），**不含任何「等待/轮询」引导**，属中性工具说明，**不是轮询教唆点**，无需改。`SubAgentDetailTool`（`:75-77`）同理。
- **`TaskTool.cs:56`**（工具首句）与 `:74-78`：本刀已在同文件补全「不要等」，无残留冲突。
- **渲染端 `src/renderer/src/lib/agent/sub-agents/create-tool.ts`：实读确认 `execute`（`:111`）只返回 `nativeOnlyTaskResult()`**（`:49-53`，内部为 `{error: 'Task execution has migrated to the .NET Native Worker.'}` 的结构化结果），**且其 `TASK_DESCRIPTION`（`:55-87`）不发给模型**：
  - 佐证：其定义经 `toolRegistry.register()`（`builtin/index.ts:55`）进入渲染端 `ToolRegistry`；而**全库检索 `getStableDefinitions` / `.getDefinitions()` 无任何消费者**（除定义自身 `tool-registry.ts:97-123`），即该 `description` 未被用于任何 provider 请求装配。运行链路的工具 schema 由 C# 侧 `TaskTool.cs` 经 `ToolModule` 构建。
  - ⇒ 渲染端镜像**确实不是模型面**，与需求/plan 判断一致，**不是修点**（记录为 ℹ️-2，见下）。
- **`ToolDispatchRouter.cs:44`**（cron 非交互 ask-user 拦截）：文案为「This is a background **scheduled task** and cannot wait for **user answers**」，语义是「非交互 run 不问用户」，**与子 Agent 等待语义无关**，**未改**（正确避开）。
- **`PromptBuilder.cs`**：**乙**，经老大裁定**明确不做**（残留缺口，见 ℹ️-1）。

⇒ 在**老大已拍板范围（甲 + 丙）**内，**无模型可读的遗漏轮询教唆点**。

### 5. 测试影响 —— ✅（零测试风险，实扫确认）

- 全仓搜索被改字符串（`notified automatically` / `check its progress` / `continue working` / `check progress with` / `you will be notified` / `Set background=true` / `Background sub-agent started` 等）：**命中仅源码两文件 + 计划/需求文档**，`tests/` 下**零命中**。
- `tests/` 内引用 `TaskTool` / `SubAgentStatusTool` / `SubAgentDetailTool` 的两处（`WishfulClaw.ChannelToolVisibilityRegressionTests`、`WishfulClaw.ProviderHeaderRegressionTests/VisibilitySnapshotDump.cs`）仅做**工具可见性/名称**层面断言（`Register(...)`、记录工具**名**与分类归属），**不断言 description / inputSchema 文本**（`VisibilitySnapshotDump.cs:30-32` 注释亦明示「the snapshot records names」）。
- 无 golden / snapshot 内嵌 `TaskTool` 描述或后台占位文本。
- ⇒ 改这三处文本**不改变套件数与断言论**，plan §二「零测试风险」成立。

### 6. JSON schema 有效性 —— ✅（已重建并解析验证）

- 以改为后的 schema 重建 JSON、替换 `{{enumItems}}` 为样例 `["custom"]` 后用解析器校验：**`JSON VALID`**；键 `properties.background.description` 正常取值。
- 该行位于 raw string 内，**无未转义 `"`、无残留 `,` 结构问题**；`additionalProperties: false`、`required` 等结构未变。⇒ **整段 schema 仍是合法 JSON**。

### 7. 多余依赖 / 硬编码 —— ✅（符合预期：无）

- 改动**仅替换字符串文本**，未新增依赖、未引入硬编码路径/密钥、未改动任何逻辑分支。`git diff` 逐行核对，无副作用面。

---

## 二、统计

**`❌ 0 / ⚠️ 0 / ℹ️ 5`**

**ℹ️（5）** —— 均**不建议本刀修**（理由随附）：

1. **残留缺口 ③（`PromptBuilder.cs` `<tool_calling>`）** —— 属**经老大裁定的主动排除**（乙不做），非本刀瑕疵。**是否本刀修**：**不修**。理由：越出老大已定口径。**但**若步骤 4 真机复验仍复现「主 Agent 死等」，③ 应作为**首选补点**。
2. **渲染端镜像 `create-tool.ts` 的描述陈旧**（无 `background` 参数、无「不要等」文案）—— 实读确认**当前不发给模型**（`execute` 为 stub、`getDefinitions` 无消费者）。**是否本刀修**：**不修**。理由：不在模型面、改了也无收益；仅提示「若未来渲染端重新接管模型调用，此镜像会是下一个漏点」。
3. **`SubAgentStatusTool` / `SubAgentDetail` 工具描述未加对冲** —— 实读为中性功能描述，**不教唆轮询**，本刀已从 `Task`/占位文本双向覆盖「何时才该查」。**是否本刀修**：**不修**。理由：无引导缺口，加字属画蛇添足。
4. **文案大小写风格微差** —— `TaskTool` 用 `Do NOT`，`Background.cs` 用 `Do not`。纯风格，**不修**。
5. **真机复验（plan 步骤 4）未执行/未决** —— 属阶段六范畴，依赖主 Agent 行为，可能如 S-177「无法当场稳定复现」→ `blocked` + 长期观察。**是否本刀修**：不适用（非代码项），仅提示收尾时如实标注复验状态。

> 无 ⚠️ 项。

---

## 三、阻断判定

**`❌ = 0` ⇒ 不阻断**，可进入阶段六（验证态）。

**无需给出最小修法**（无 ❌、无建议本刀修的 ⚠️）。所有 ℹ️ 均已标注「不建议本刀修」及理由。
