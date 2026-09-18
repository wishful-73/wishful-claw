# 规划验证报告：v2-iter-32

> 阶段三产物（docs/dev-workflow.md「六阶段工作流 → 阶段三：规划验证」）。
> 验证对象：`docs/plans/iter-v2-32/plan.md`；权威口径：`docs/plans/iter-v2-32/raw-requirements.md`。
> 验证时间：2026-09-18。核查方式：文件系统实测 + 源码逐处实读（行号均为本次实读结果）。

## 总结论

**FAIL** —— 存在 **3 项阻断（❌）**，按 dev-workflow「❌ 项 > 0 时禁止进入用户确认环节」，当前**不可进入用户确认**；修复这 3 项后其余检查项均合格，预期转 PASS。

阻断项集中在两处：S-73 的「DB 加列」落点文件写错/不全（漏 `DbClient.cs`），以及 S-79 漏掉 raw 明确要求的「实施前覆盖清单」与开关透传点。plan.md 整体结构、格式、分层、实施顺序（含 S-74→S-75 依赖）均合格，详见下表。

## 一、逐项检查结果

| # | 检查项 | 结论 | 说明 |
|---|---|---|---|
| 1 | 步骤覆盖 **S-72** | ✅ | 对齐 raw §11-38：有内容→`onSend`（入队）/ 无内容→`onStop`（plan.md:111-112）；复用现成判据 `!text.trim() && attachedImagesCount === 0`（源码实读确认在 `composer-toolbar.tsx:195`）；待核实①「点按钮与回车同路径」落成步骤1（plan.md:109-110）；待核实③「有附件无文字算不算内容」由判据沿用得到覆盖。 |
| 2 | 步骤覆盖 **S-73** | ❌ | 语义（`min(真实, 256K)`、仅 >256K 生效、档案保持真值、渲染端同口径）四步齐（plan.md:124-135），但**步骤2「DB 加列」的落点文件写错/不全**——见「二、❌ 阻断项」#1。 |
| 3 | 步骤覆盖 **S-74** | ✅ | 三处 gap 收窄分别成步（plan.md:35-40），与 raw §110-115 表一一对应；`hover 底色块不粘连` 与「左组不被裁」落进整体测通（plan.md:41）。⚠️ 见建议项 #8（gap 指向不明）。 |
| 4 | 步骤覆盖 **S-75** | ⚠️ | 常量（宁大勿小）+ 上限改算法 `视口 − 最低宽度`（不减去左侧）+ 统一判定函数 + 退化分支 + 拖拽同触发，五项皆覆盖（plan.md:49-58），与 raw §176-178、§212-217、§232-235 一致。但漏了 raw 明确的**左侧面板拖宽场景**与 `::-webkit-scrollbar` 待裁定项，落点亦含糊——见建议项 #4/#5/#6。 |
| 5 | 步骤覆盖 **S-76** | ✅ | 首尾相接窗口（plan.md:65-66）、末段总耗时仅在有切分时出现（plan.md:67）、边界兜底含 `live` 段用 `liveState.startedAt`（plan.md:69）、无切分消息零影响，均对齐 raw §275-302；数据来源（压缩工件对自带 `createdAt`）与源码吻合（`renderable-chat-items.ts:191` 浅拷贝、`lib/agent/context-compression.ts:92` 用 `createdAt`）。 |
| 6 | 步骤覆盖 **S-77** | ✅ | 问题1（单行截断 + hover 全文 + 与 `inProgressHint` 合并）成步（plan.md:78-81）；问题2 按推荐 A（渲染端只显示当前批、数据不动）成步（plan.md:82-84），与 raw §339 推荐一致。⚠️ 切批规则 A 尚未经老大裁定——见建议项 #7。 |
| 7 | 步骤覆盖 **S-78** | ✅ | 方案 A 全量落地：Content 视口上限 + 显式 grid-rows + overflow-hidden（plan.md:93）、标题 `shrink-0`（plan.md:95）、正文自滚层 `min-h-0/max-h/overflow-y-auto/whitespace-pre-wrap/break-words`（plan.md:97）、`descriptionVariant?: 'code'` 可选开关 + 28 调用点零改动验证（plan.md:100-101）。与 raw §369-386 逐条对应；源码实读确认原语现状（`alert-dialog.tsx:41` 只有 `max-w-lg`、`:90` 正文仅 `text-sm text-muted-foreground`）。 |
| 8 | 步骤覆盖 **S-79** | ❌ | 主体（边界纯函数、三 helper 接入并显式失败、多根集合含非 SSH 项目、空集合视为未开、全局开关默认开、错误文案 i18n）六步齐（plan.md:142-153），与 raw §427-493 一致。但**漏「实施前覆盖清单」**且**开关透传点不全**——见「二、❌ 阻断项」#2、#3。 |
| 9 | 每步验证检查点 | ✅ | 全部 34 个步骤均带「验证」行。11 个为「tsc 零错误」单独兜底，对 CSS/间距/呈现类改动不构成有效信号（见建议项 #11）；研究型步骤（S-72 步骤1、S-73 步骤1）以「结论写入 raw-requirements」为检查点，合理。 |
| 10 | 文件路径符合项目结构 | ✅ | 逐路径 `Test-Path`：plan.md 列出的 **27 个待修改文件全部存在**；2 个新测试目录（`tests/session-todo-batch/`、`tests/sandbox-path-boundary/`）不存在，但 plan.md:157-159 已标「新增」，符合规范。`tests/` 现有 30 个 `program.ts` 测试目录 + `WishfulClaw.Tests.sln`，新目录命名风格一致。渲染端路径均落在 `src/renderer/src/**`，与 AGENTS.md 目录规范一致。 |
| 11 | 分层依赖正确 | ✅ | S-73：列加在 Infrastructure（`Db`），由 Agent 读取，方向向上，OK；S-79：改 Agent（`Tools/ToolHelpers.cs`）并借 Infrastructure（`DbProjectTools`）取根集合，Agent→Infrastructure 合法；`ToolExecutionContext`（Core，`ToolTypes.cs:64/67/68` 已有 `WorkingFolder/ProjectId/SshConnectionId`）无需新通道，未引入 Core→上层依赖。无逆向依赖。 |
| 12 | 参考源码正确 | ⚠️ | `D:\claw\OpenCowork` 在 AGENTS.md 参考表内（AGENTS.md:194）✅；但 `D:\claw\deepseek-harness`（plan.md:180）**不在 AGENTS.md「参考源码」表**（AGENTS.md:192-198 只列 OpenCowork / KodaClaw / OpenClaw.net / DeepSeek-Reasonix / Codex），而 dev-workflow 要求「参考源码路径以 AGENTS.md 中的为准」。路径本身存在（含 `docs/subsystems/spill.zh.md`）。见建议项 #9。 |
| 13 | plan.md 格式 | ✅ | 四要素齐备：目标（plan.md:7「## 目标」）、步骤清单（plan.md:29「## 步骤清单」，带 `[ ]` + 验证点）、涉及文件（plan.md:155「## 涉及文件」）、参考源码（plan.md:177「## 参考源码」），并额外补了「实施顺序与理由」「门禁」。符合 dev-workflow 阶段二模板。 |
| 14 | 实施顺序合理 | ✅ | S-74 排 #1、S-75 排 #2（plan.md:17-18），与 raw §200「实施顺序先 S-74 再 S-75」及 exploration_findings.md 风险 #1（S-74→S-75 强依赖）一致；其余按「风险低→改动面大」推进，S-79 收尾，合理。 |

## 二、❌ 阻断项

### ❌ #1 — S-73 的「DB 加列」落点文件写错/不全（漏 `DbClient.cs`）

- **问题**：plan.md:126 步骤2 要求「会话级字段落库（比照 S-59 `permissionMode`：DB 加列 + 会话读写）」，plan.md:169 把该动作归到 `src/runtime/WishfulClaw.Infrastructure/Db/DbSessionTools.cs`（加列）。但**「加列」的实际机制不在 `DbSessionTools.cs`**，而在 `DbClient.cs` 的 `EnsureColumn` 迁移列表。
- **证据**：
  - `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs:521-537` —— 迁移集中在此：`EnsureColumn("sessions", "persona_id", …)` … `EnsureColumn("sessions", "permission_mode", "TEXT")`（**S-59 的 `permission_mode` 就在 `:537`**）。
  - `DbSessionTools.cs` 全文件（431 行）grep `EnsureColumn` **0 命中**；它只负责 INSERT/UPDATE 参数与行映射（`:98`、`:156` 的 `permission_mode`）。
  - 即 S-59 先例实际牵扯**两个文件**：`DbClient.cs`（加列）+ `DbSessionTools.cs`（读写）。
- **建议修法**：plan.md:169 的 S-73 文件清单补 `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs`（`EnsureColumn("sessions", <新列>, "TEXT")`），并在步骤2 验证里点明「migration 走 `DbClient.EnsureColumn`」而非笼统的 `EnsureColumn`。

### ❌ #2 — S-79 漏掉 raw 明确要求的「实施前覆盖清单」

- **问题**：raw-requirements.md:495-497 明列实施前必须另核的覆盖面：`Monitor`（也执行命令）、`use_capability` 代理路径、子代理 / cron / skill 内部工具调用、MCP 工具自身路径参数。plan.md 的 S-79 六个步骤（plan.md:137-153）**无一步覆盖该审计**，「涉及文件」（plan.md:170）也未列 `AgentRuntimeUseCapabilityExecutor`、`Monitor` 相关文件。
- **证据**：
  - `raw-requirements.md:495-497`（「### 实施前的覆盖清单 —— 直连侧（File* / Glob / Grep / ShellExecute，经 helper）已覆盖；另需核：`Monitor`…、`use_capability` 代理路径、子代理 / cron / skill 内部的工具调用…、MCP 工具自身的路径参数」）。
  - `raw-requirements.md:416` 明确 `AgentRuntimeUseCapabilityExecutor` **不经过** `ResolveFilePath`（复用 `IsDefaultModeApprovalTool`，见其 `:314`），属已知漏洞面。
  - `plan.md:137-153`、`plan.md:170` 无对应条目。
- **建议修法**：在 S-79 增一步「覆盖审计」：逐个确认 `Monitor`/`use_capability`/子代理·cron·skill/MCP 是否经 helper，未覆盖的**记入文档（能力边界说明）**，避免「默认开 + 用户以为全防住」造成的失真；并把审计到的文件补进「涉及文件」。

### ❌ #3 — S-79 开关透传点不全（只列 1 处，实为 9 处级链路）

- **问题**：S-79 开关为**全局 settings、默认开**（raw-requirements.md:433）。plan.md:148 步骤4 说「接入 Worker，经 run params 下发」，plan.md:170 的「涉及文件」只列 `src/renderer/src/hooks/use-chat-actions.ts`。而同类全局开关（`contextCompressionEnabled`）实际散在 8~9 个透传点，只改 `use-chat-actions.ts` 会漏。
- **证据**：`contextCompressionEnabled` 实际命中（实读 grep）：`hooks/use-chat-actions.ts:240/414/468/544`（4 处）、`hooks/use-channel-auto-reply.ts:291`、`hooks/use-background-subagent-wakeup.ts:116`、`lib/.../provider-auto-fallback.ts:246`、`lib/.../project-send-message.ts:228`；raw-requirements.md:90 记「现行 run params 透传点有 9 处（含 `chat-store/index.ts`）」。
- **影响面**：S-79 生效范围**含渠道会话**（raw-requirements.md:467-473，渠道 = 全局 PM、默认 `fullAccess`），若渠道/后台子代理路径漏传，用户关闭开关时这些路径仍被拦（或反之）——与需求不符。
- **建议修法**：「涉及文件」按 9 处链路逐点补齐（或明确 Worker 直接读全局配置的替代挂法并在 plan 中写明），并在步骤4 的验证里加「渠道会话 / 后台唤醒路径同样透传」的核对。

## 三、⚠️ 建议项

1. **S-73 默认态未写**：raw §91（「默认态与取值——新会话默认关还是开」）标「待定」，plan.md:119-135 六步均未给默认值。建议在步骤里写明默认（建议沿用 raw 倾向「关」= 保持现状），否则实施时无据。
2. **S-73 UI 入口未经裁定**：raw §64⑤、§88 明确「入口位置未定，老大不知道放哪」；plan.md:26 暂取 `context-ring`。该假定需在用户确认环节显式拍板，不能当默认成立。
3. **S-73 步骤5 措辞易误导**：plan.md:132 写「沿用现有 9 处透传链之一」。「之一」与 raw §90（会话级字段同样要在 9 处补）语义相反——若走 run params 应是「9 处全补」。建议改措辞。
4. **S-75 未覆盖左侧面板拖宽场景**：raw §234 明确「左侧固定 `MAX=420`，单独拖宽也能挤爆聊天窗；若选常量方案，左侧上限按同一口径取 `min(420, 视口 − 最低宽度)`」。plan.md 只改 `clampRightPanelWidth`（`right-panel-defs.ts:19-26`），未提左侧的 `clampLeftSidebarWidth`（`right-panel-defs.ts:15-17`，现为定值 420，且由 `ui-store.ts:71` 调用）。建议补一步。
5. **S-75 未处理 `::-webkit-scrollbar` 待裁定项**：raw §201-210、§55 记「`assets/main.css:302-305` 的全局 `::-webkit-scrollbar{height:5px}` 令 `[scrollbar-width:none]` 失效、并占位撑高」，「修不修 / 算 S-75 的一部分还是单独立条」待老大定。plan.md 完全未提，建议至少登记为「本迭代不做 / 另立条」的显式结论。
6. **S-75 落点含糊**：plan.md:46-47 写「`MainLayout.tsx` 或右面板宽度消费处（触发收起逻辑）」，未定「统一判定函数」落在哪个文件、如何接进展开/收起路径。而 `setLeftSidebarOpen`/`setRightPanelOpen` 的调用点分散（`register.ts:52`、`team-native-ui.ts:45`、`ConversationGuideDialog.tsx:84/91/116`、`PreviewPanel.tsx:302/405`、`RightPanel.tsx:249`），建议在 plan 里定死接入方式（如集中到 `useUIStore` 的 setter 内）。
7. **S-77 切批规则 A 未经裁定**：raw §336-341 标「待裁定」，plan.md:82-84、plan.md:27 暂取推荐 A。需在用户确认环节拍板（纯渲染过滤、数据不动的口径本身合理）。
8. **S-74 步骤3「左右两组之间 gap-2」指向不明**：`composer-toolbar.tsx` 有**两处** `gap-2`——`:225` 外层、`:227` 内层（承载左右两组）。plan.md:39 未指明改哪一处（或两处都改），建议写全 class 名+行号。
9. **参考源码越出 AGENTS.md 白名单**：`D:\claw\deepseek-harness`（plan.md:180）不在 AGENTS.md 参考表内。建议要么在 AGENTS.md 补登，要么改用表内项目；至少加一句「非 AGENTS 白名单、仅作子系统文档写法参考」的说明。
10. **S-78「28 个调用点」数字待复核**：实读 grep（`await confirm(` / `confirm({`）命中 **26** 处，与 raw §384 / plan.md:101 的「28」有出入。因 plan.md:101 用 `git diff` 做最终验证，风险低，但建议以 diff 实数为准并同步文档。
11. **样式类步骤验证信号弱**：S-74 步骤1-3、S-76 步骤1-3、S-77 步骤1 的验证仅「tsc 零错误」，而 tsc 无法反映间距/截断/时间显示的呈现变化。建议对这些步骤补「真机/视觉核对」或明确注明「本步仅编译门禁，呈现留待整体测通」。
12. **门禁 #2 表述与测试登记**：plan.md:189 `npm run test:*` 依赖 shell 通配（`npm run` 不展开 `*`），建议改为逐脚本或 `npm-run-all`；且 S-77 / S-79 新增测试需在 `package.json` 登记脚本，但 `package.json` 未进「涉及文件」。
13. **S-77 「涉及文件」多列了 locale**：plan.md:166 列了 `locales/{zh,en}/chat.json`，但四个步骤无任何新增/修改文案的动作（计数复用现有 `todo.tasksDone` 的 `{completed,total}`）。建议补一个改文案的步骤，或从涉及文件移除。
14. **S-73 涉及文件与「会话级」口径的张力**：plan.md:169 列 `stores/settings-store*（若需）`，但 raw §49 明确「开关是会话级别，**不需要全局**」。若确要动 settings-store（如仅为 UI 偏好）应加说明，否则建议移除以免误导为全局开关。

---

### 附：本次核实证据（关键实读）

- `composer-toolbar.tsx:191` `onClick={isStreaming ? () => onStop?.() : onSend}`；`:195` 非流式 `disabled` 判据含 `attachedImagesCount === 0`；`:225/227` 双 `gap-2`；`:228` 左组 `gap-2 … [scrollbar-width:none]`；`:253` 右组 `gap-1.5`。
- `right-panel-defs.ts:19-26` `clampRightPanelWidth` 上限 = `min(∞, viewport × 0.8)`；`:15-17` `clampLeftSidebarWidth` 上限定值 420。
- `RightPanel.tsx:131` `clampRightPanelWidth(rightPanelWidth)`、`:143` 拖拽 `setRightPanelWidth(clampRightPanelWidth(...))`、`:226` `style={{ width: rightPanelOpen ? targetPanelWidth : 0 }}`。
- `renderable-chat-items.ts:173-200` `createAssistantFragment` 浅拷贝（`:191` `{ ...message, id, content }`）、`:349-368` `splits` 排序、`:437` `appendMessage`。
- `MessageItem.tsx:218-219` 传 `createdAt/updatedAt`。
- `SessionTodoPanel.tsx:130` `total: tasks.length`、`:195` `title={inProgressHint}`、`:212-220` `min-w-0 break-words`。
- `alert-dialog.tsx:41` 仅 `max-w-lg` 无 `max-h`、`:90` 正文仅 `text-sm text-muted-foreground`；`confirm-dialog.tsx:163-168` `<AlertDialogContent size="sm">` + `AlertDialogDescription`。
- C# 四处 `contextLength` 读取实读：`AgentLoop.ContextCompression.cs:38`、`AgentLoop.cs:658`、`ContextCompression.cs:282`、`ContextCompression.cs:350`（与 raw §74 表一致）。
- `ToolHelpers.cs:58/74`、`ShellExecuteTool.Helpers.cs:18`、`ToolCallProcessor.cs:150/157-159` 与 raw 描述一致。
- `DbClient.cs:522-537` `EnsureColumn("sessions", …)` 迁移列表（含 `permission_mode`）。
- `ToolTypes.cs:64/67/68` `ToolExecutionContext` 已含 `WorkingFolder/ProjectId/SshConnectionId`。
- 参考仓库存在性：`D:\claw\OpenCowork`、`D:\claw\deepseek-harness`（含 `docs/subsystems/spill.zh.md`）、`koda-claw`、`openclaw.net`、`DeepSeek-Reasonix` 均存在。

---

## 四、复审（第二轮）

> 复审时间：2026-09-18（第二轮）。复审对象：修订后的 `docs/plans/iter-v2-32/plan.md`；权威口径：`docs/plans/iter-v2-32/raw-requirements.md`。
> 核查方式：**源码逐处实读**（本节行号均为本轮实读结果，不采信报告转述）。
> 本轮范围：复核「二、❌ 阻断项」3 项是否修好 + 扫描修订是否引入新问题 + 核对新增的 V1~V5 待裁定表。

### 新的总结论

**PASS** —— 首轮 3 项阻断（❌#1 / #2 / #3）**均已修复**，且修订顺带消化了首轮「三、⚠️ 建议项」中的大部分；**未发现新增阻断项**。仅余 2 处 ⚠️ 级小瑕疵（V 表出处引用偏差 N1、V 表漏一条 raw 待定项 N2），不构成阻断。⇒ 按 dev-workflow「❌ 项 > 0 时禁止进入用户确认环节」，当前 **3 项阻断全关、可进入用户确认环节**。

### 1. 三项阻断逐条复核

#### ✅ #1（S-73 的「DB 加列」落点漏 `DbClient.cs`）— 已修

- **plan.md 已改到位**：
  - 步骤2（plan.md:147-149）明文写「**`DbClient.cs` 的 `EnsureColumn("sessions", <新列>, "TEXT")`（`:521-537` 那个迁移列表，S-59 的 `permission_mode` 就在 `:537`）+ `DbSessionTools.cs` 读写映射**」，并追加一条醒目标注「加列机制**不在** `DbSessionTools.cs`（该文件 `EnsureColumn` 零命中），两个文件都要动」；验证行也点了「migration 走 `DbClient.EnsureColumn`」而非笼统 `EnsureColumn`。
  - 涉及文件（plan.md:204）S-73 首项已列 `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs`（加列）、次项 `Db/DbSessionTools.cs`（读写）。
- **源码复核（说法为真）**：
  - `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs:522-537` 确为迁移列表，`EnsureColumn("sessions", "permission_mode", "TEXT")` 在 `:537`；私有方法 `EnsureColumn` 定义在 `:748`。
  - 在 `.../WishfulClaw.Infrastructure/Db/` 目录内实读 grep `EnsureColumn`：仅 `DbClient.cs` 与 `DbClientCompactionSnapshotMigrations.cs` 命中；`DbSessionTools.cs` **0 命中**（该文件只在 `:98` INSERT、`:156` UPDATE 参数里出现 `permission_mode`）。与 plan 的描述完全一致。

#### ✅ #2（S-79 漏「实施前覆盖清单」）— 已修

- **plan.md 已改到位**：S-79 新增步骤5「**覆盖审计**」（plan.md:177-183），按 raw §495-497 逐条列出四类覆盖面 —— `Monitor`（也执行命令）、`use_capability` 代理路径（并注明 raw §416 的 `AgentRuntimeUseCapabilityExecutor` 不经过 `ResolveFilePath`）、子代理 / cron / skill 内部工具调用、MCP 工具自身路径参数；验证行要求「审计结论逐条落进 raw-requirements；审计到的文件补进「涉及文件」」。
- **源码复核（说法为真）**：`AgentRuntimeUseCapabilityExecutor.cs:314` 确实复用 `ToolCallProcessor.IsDefaultModeApprovalTool`（谓词定义在 `ToolCallProcessor.Approval.cs:111`）；`Monitor` 是真实工具名（`Tools/Providers/CodeCompatibleToolProvider.cs:30` 注册，`AgentRuntimeCodeCompatibleExecutor.cs:31/44` 派发）。
- **残留小项（非阻断）**：涉及文件（plan.md:205）目前仍未**预先**列入被审计对象（如 `AgentRuntimeUseCapabilityExecutor.cs`、`AgentRuntimeCodeCompatibleExecutor.cs`），靠步骤5「审计到再补」。因该步是研究型步骤、其结论才决定文件清单，**可接受**；若要更严，可在步骤5 的措辞里点名这两个已知文件。

#### ✅ #3（S-79 开关透传点不全）— 已修

- **plan.md 已改到位**：步骤4（plan.md:173-176）已按同类全局开关的实际散布点**逐个点名** —— `hooks/use-chat-actions.ts`（4 处）、`hooks/use-channel-auto-reply.ts`、`hooks/use-background-subagent-wakeup.ts`、`lib/.../provider-auto-fallback.ts`、`lib/.../project-send-message.ts`；验证行加「**渠道会话与后台唤醒路径同样透传**（渠道在生效范围内，漏传会关不掉）」。涉及文件（plan.md:205）同步列全，并补 `stores/chat-store/index.ts`（如 run params 定义在此）。
- **源码复核（实读 grep `contextCompressionEnabled`，行号与 plan 一致）**：`use-chat-actions.ts:240 / 414 / 468 / 544`（**4 处**确认）、`use-channel-auto-reply.ts:291`、`use-background-subagent-wakeup.ts:116`、`provider-auto-fallback.ts:246`、`project-send-message.ts:228`；`contextCompressionThreshold` 落在同一批点（`:241 / 292 / 117 / 247 / 229`），即**8 个真实透传点**。
- **关于 raw §90 的「9 处」**：第 9 处 `stores/chat-store/index.ts` 实为 **RunParams 类型定义**（`chat-store/index.ts:109` `contextCompressionEnabled?: boolean`，本轮实读确认在接口体内），**不是**读 settings 的透传点。plan 把它按「run params 定义在此」列进涉及文件，口径比 raw 更准确。⇒ 8 个透传点 + 1 个类型定义点，**覆盖完整**。
- **附带发现（供参考，不影响 S-79）**：`src/renderer/src/lib/ipc/agent-bridge-streaming.ts:435-438` 亦在 `agent/compress-context` 调用里**有条件透传** `contextCompressionThreshold`。它是渲染端压缩 IPC 路径（由 `lib/agent/context-compression.ts:7` 调用），**不是 run params 链**，未列不影响 S-79；但说明 raw「9 处」是旧口径，实际 touch `contextCompression*` 的位置不止 9。

### 2. 首轮「三、⚠️ 建议项」的消化抽查（修订后）

已落实：S-74 三处 gap 补齐行号（plan.md:46/48/50 —— 实读 `composer-toolbar.tsx` `:225` 外层 `gap-2`、`:227` 内层 `gap-2`、`:228` 左组 `gap-2`、`:253` 右组 `gap-1.5`，与 plan 完全一致）；S-75 补左侧 `clampLeftSidebarWidth`（plan.md:64，实读 `right-panel-defs.ts` 及其调用点 `ui-store.ts:71` 存在）与统一判定函数**落点定死**在 `useUIStore` 三个 setter（plan.md:67-68，已把 `ui-store.ts` 列入涉及文件）；S-75 把滚动条登记为「本迭代不改 / 已知限制」（plan.md:74-75）；S-73 步骤5 改掉「之一」措辞（plan.md:154）；S-73 备注澄清 `settings-store` 非开关落点（plan.md:158-159）；S-78 步骤4 记「26 vs 28，以 `git diff` 为准」（plan.md:120）；门禁#2 改写为「`*` 不被 npm 展开、逐脚本执行」（plan.md:225）；S-77 locale 条件化（plan.md:201）；参考源码注明 `deepseek-harness` 不在 AGENTS.md 白名单（plan.md:215）。

### 3. 新发现问题

| # | 级别 | 问题 | 证据 |
|---|---|---|---|
| N1 | ⚠️ | V 表出处引用偏差：V5 的 `raw §55` 与滚动条主题无关（raw 第 55 行是 S-73「上限值 = 256K」，滚动条那条 CSS 在 §204-205、讨论在 §201-210），疑为笔误；V4 标 `§232-235`（`### 边界情况`），而「≈800px 估算 / 真机校准」实际在 §217-218、§226-230 | `raw-requirements.md:55`、`:204-205`、`:217-230`、`:232-235` |
| N2 | ⚠️ | V 表漏一条 raw 明标「待定」项：raw §91 后半「**是否另给下拉（如 128K / 256K）待定**」未进 V 表（V2 只覆盖「新会话默认态」）。plan 实际按「固定 256K、不给下拉」推进（plan.md:60、`:150`），与 raw「上限固定 256K（已定）」不冲突，但该决策未登记 | `raw-requirements.md:91`；`plan.md:34`、`:150` |

**其它复核（未发现问题）**：

- plan.md 章节无重复、格式无破损；V1~V5 无「多写」——V1=raw §64⑤/§88、V2=§91、V3=§336-341、V4≈§217-235、V5=§201-210，均能对上 raw 的待定项。
- 步骤清单排列顺序（S-74→S-75→S-76→S-77→S-78→S-72→S-73→S-79，plan.md:41/55/77/91/107/124/138/161）与「实施顺序与理由」表（plan.md:16-25）**一致**。
- 门禁命令复核：`tsconfig.web.json` / `tsconfig.node.json` / `tsconfig.json` 三配置均存在；`tests/WishfulClaw.Tests.sln` 存在，C# 回归套件实为 **10 个** `WishfulClaw.*RegressionTests` 目录（含 `WishfulClaw.GoalRegressionTests`），故 plan.md:194 新增 `tests/WishfulClaw.GoalRegressionTests/Program.SandboxPath.cs` 的落点成立（该工程已有 `Program.SessionTodo.cs` 等同类分部文件，命名风格一致，「不新开工程」为真）；`build:worker:prod`（`package.json:11`）与 `typecheck:web/node`（`package.json:19-20`）均在。

### 4. 结论与后续

- 3 项阻断**全部关闭**，**无新增阻断** ⇒ 当前**可进入用户确认环节**。
- 进入确认时请一并裁定：V1~V5 五项暂取值（尤其 **V2 默认关**、**V5 本迭代不改滚动条**），并顺手补记 N1 / N2 两处文档小瑕疵（建议：V5 出处改指 §201-210/§205；V 表补一条「上限取值形态：固定 256K / 是否给下拉」）。
- 首轮「三、⚠️ 建议项」本节仅抽查已落实项，未抽查者仍以首轮报告为准。
