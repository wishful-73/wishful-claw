# iter-v2-40 阶段五代码审查报告

**第一轮** ❌ 0 项 / ⚠️ 8 项（覆盖 `a3b966d5..00dcf7db`）—— 可进入验证态
**第二轮** ❌ 1 项 / ⚠️ 20 项（官网面 12 / 软件面 8，覆盖 `00dcf7db..96c8fa3d`）—— B1 已修，其余见第二轮小节

> 审查范围：git diff a3b966d5..HEAD（分支 dev/v2-iter-40）。
> 第一轮 HEAD = `00dcf7db`（46 个文件，+2679 / −137）；第二轮 HEAD = `96c8fa3d`，
> 在 `b6a95eca`（S-207 真机报错修复）与 `96c8fa3d`（S-208 时刻与进度快照）落地之后。
> 判定基准：docs/plans/iter-v2-40/plan.md + requirements/S-203.md ~ S-209.md。
> 只读审查：未改动任何代码/文档，未执行 git 写操作（行数、键值、调用点均用 `git`/`Select-String`/`Read` 实测）。

变更分布（`git diff --name-only` 按区归类）：runtime 14 · renderer 13 · website 6 · main 2 · docs 11。
`package.json` / `*.csproj` 无改动 —— **本迭代零新增依赖**。

---

## 审查项结论速览

| 需求 | 结论 | 备注 |
| --- | --- | --- |
| S-203 官网页脚不贴底 | **PASS** | sticky footer 方案最小，4 个 `<main>` 落点全覆盖 |
| S-204 清空会话落库 + 浮窗入口 | **PASS** | guard 先于 set、finally 双路径释放；后端零改动（`db/messages-clear` 在 base 已存在） |
| S-205 官网/README 文案重写 | **PASS** | README 锚点与标题匹配；碰瓷话术已全部移除 |
| S-206 官网首屏背景动画 | **PASS** | `.shine` 系全撤、`.dl-shine` 有意保留；reduced-motion 生效 |
| S-207 沙箱越界申请临时关闭 | **PASS**（1 ⚠️） | 能力面/权限面收口正确；UI 文案未走 i18n（W6） |
| S-208 压缩抢跑 | **PASS**（2 ⚠️） | 提示词侧 + 原样注入用户末条消息；两个覆盖缺口（W4/W5） |
| S-209 GLM 空响应 | **PASS**（3 ⚠️） | 判定收窄 + 催办上限 2；空 assistant 上线与迭代预算（W1/W2/W3） |

全局项见「跨需求问题」：行数上限 4 处越线（W7）。

---

## S-203 官网页脚不贴底

**要求**：四个官网页面在内容不足一屏时页脚仍贴底，不出现页脚浮在屏幕中段。

**改动落点（实测）**

| 文件 | 关键改动 |
| --- | --- |
| `website/src/index.css` | 新增 `#root { display:flex; flex-direction:column; min-height:100vh }`（`@@ -73,6 +73,17 @@` 段），注释记录「内容超过一屏时 flex-1 不起作用，行为与修前完全一致」 |
| `website/src/App.tsx` | `<main className="flex-1">` |
| `website/src/components/doc-page.tsx` | `<main className="w-full flex-1 …">` |
| `website/src/download-page.tsx` | `<main className="w-full flex-1 …">` |

**核查**

- 全仓检索 `website/src` 下 `<main` 共 4 处，与页面数一致；`website/src/go-page.tsx` 的 `<main>` 是 `flex min-h-screen …`，该页 `SiteFooter` 缺失为既有设计（`/go` 落地页无页脚），非本需求范围。
- `#root` 拿掉默认高度约束后由 `min-height:100vh` + 纵向 flex 承担，页脚作为最后一个 flex item，`main` 的 `flex-1` 把剩余空间吃掉 —— 这是最小侵入写法，无 JS、无布局抖动。
- 已有 `Reveal` 动画与新增 flex 容器无冲突（高度由 `min-height` 撑，不产生滚动容器嵌套）。

**VERDICT: PASS**（0 项）

---

## S-204 清空会话不落库 + 补浮窗入口

**要求**：右键「清空消息」当场生效且切换会话后不回魂（真落库）；浮窗「更多」菜单补同一入口。

**改动落点（实测）**

- `src/renderer/src/stores/chat-store/session-slice.ts`
  - `:18 const clearingSessions = new Set<string>()`（模块级守卫集合）
  - `:486-533 clearSessionMessages`：注释完整交代旧实现的三个缺陷（只清内存 / worker 只清上下文 / `messages` 表一条未删）；`:494` **先 `clearingSessions.add(sessionId)` 再 `set(...)`**；`:498-506` 内存置空（`messages=[]`、`messageCount=0`、`messagesLoaded=true`、`loadedRange{Start,End}=0`、`totalTurns=0`、`lastKnownMessageCount=0`、`isRuntimeResident=false`）；`:509 void dbClearMessages(sessionId)`；`:511-515` `success=false` 显式 `console.warn`（不静默）；`:517-519` `catch`；`:520-524` `.finally` 无条件 `delete`；`:525` 并行清 worker 上下文；`:528-531` 清会话级 Todos。
  - 守卫回读点三处：`:932 loadRecentSessionMessages`、`:1015 fetchOlderMessages`、`:1052 loadMessageWindowAround`。
- `src/renderer/src/stores/chat-store/db-helpers.ts:628 export async function dbClearMessages(sessionId: string): Promise<{ success: boolean }>`。
- 渲染端入口：`components/chat/session/SessionConversationPane.tsx` 已导入 `confirm` / `Eraser` 并接入清空项（含确认弹窗）。
- i18n：`locales/zh/layout.json` `:238-240` 与 `locales/en/layout.json` `:238-240` 均补齐 `clearSession` / `clearSessionConfirmTitle` / `clearSessionConfirmDesc`（zh/en 成对，无缺键）。

**核查与正面记录**

- **guard 时序正确**：`:494` 先注册 guard 再 `:495 set`，挡掉「内存已空 → 删库未落定」窗口内的任何回读，与注释 `:493` 自述一致；`.finally`（`:520`）保证成功/失败两条路径都释放，不会永久卡死会话。
- **选型正确**：注释 `:491-492` 说明为何走 `db/messages-clear` 而非 `session-reset-conversation`（后者会把标题重置为 "New Conversation"，违反 S-204 裁定 1「标题不动」）。
- **后端零改动成立**：`db/messages-clear` 已存在于 base（`Infrastructure/Db/DbModule.cs` 的注册），本迭代未改 worker 侧，与 plan 的「不新增 IPC」一致。
- `isRuntimeResident=false`（`:505`）是必要的：否则 `:937` 的 `if (session.isRuntimeResident) return` 会让清空后的会话无法重新装载。

**VERDICT: PASS**（0 项）

---

## S-205 官网与 README 文案重写

**要求**：首屏一句话说清「你说一句，它在你自己的电脑上把活干完」；去掉碰瓷式对标话术。

**改动落点（实测）**

- `README.md`（12 行）：首屏 `<strong>` 由「桌面 AI Agent 工作台 — 有记忆、有人格、能动手」改为「你说一句，它在你自己的电脑上把活干完」；副标点出「读写文件、执行命令、搜索代码、操作浏览器和桌面软件」；快捷跳转锚点与对应小节标题同步改写。
- `website/src/content/site.ts`（`@@ -50,7 +50,9 @@` 起）：Hero 副标重写（原先把价值阶梯整块塞进 Hero，导致主标题被挤到 770px、CTA 945px、截图出屏，注释记录了这次取舍）；其余为 advantages / faq 文案。
- `website/src/sections/hero.tsx` 同步。

**核查**

- **碰瓷风险清零**：`site.ts` 中 Codex / Cursor / Claude Code 的提及已在 advantages 侧删除；README 首屏不再出现对标措辞。
- **锚点校验**：README 新增链接 `#-一分钱不花先白嫖起来` ↔ 小节标题 `### 🆓 一分钱不花，先白嫖起来`。GitHub anchor 规则（emoji 置空、标点删除、空格转连字符）下前者化简为 `-一分钱不花先白嫖起来`，与实际锚点一致；同文件的 `#-不花-token-也能用` 沿用同一规则，风格自洽。
- `hero.title` 未动（符合裁定：主标题不换）。

**VERDICT: PASS**（0 项）

---

## S-206 官网首屏背景动画

**要求**：首屏加背景动画；与既有扫光效果冲突时保动画。

**改动落点（实测）**

- `website/src/index.css`
  - 新增 `.hero-aurora` / `.hero-aurora::before` / `.hero-aurora-lines` / `.hero-aurora-lines-2` 及关键帧（文件内约 409-443 行）。
  - **撤掉** `.shine` / `.shine-muted` / `.hero-shine`（476-479 有注释留痕）。
  - **保留** `.dl-shine` / `.dl-current`（仍被 `sections/download-buttons.tsx` 使用）。
  - `@media (prefers-reduced-motion: reduce)` 同时停 aurora（476-484）与既有 `.reveal`（384-388）。
- `website/src/sections/hero.tsx`：外层 `relative isolate`，插入 `aria-hidden` 的装饰层（两个 SVG 描线 + aurora 容器），移除了原先的 `shine` / `data-text`。
- `website/src/sections/advantages.tsx` 全量复核：仅消费 `content/site` 的 `advantages`，条件渲染配图那段已随 image 字段移除而删除，无残留。

**核查**

- 全仓检索 `website/src`：`.shine` / `data-text` 无残留命中；`.dl-shine` 命中属有意保留（S-206 冲突裁定「首屏扫光让步，下载区闪光不动」）。
- aurora 走纯 CSS（`color-mix(in srgb, var(--color-accent) 12%, transparent)` + 关键帧 drift/breathe），无 JS 定时器，`prefers-reduced-motion` 下整体停摆。
- 装饰层 `aria-hidden` 到位，不污染可访问性树。

**VERDICT: PASS**（0 项）

---

## S-207 沙箱越界「申请临时关闭」

**要求**：沙箱拦截到工作目录外路径时，agent 可发起一次「申请临时关闭」；桌面弹窗、渠道文字审批；批准后临时豁免，到期自动恢复。

**改动落点（实测）**

- 能力面：`src/runtime/WishfulClaw.Agent/Tools/Providers/SandboxElevationToolProvider.cs` 暴露**无参**工具 `RequestSandboxElevation`；`visibleScopes: ["*:chat@*","*:cowork@*","*:channel@*"]`，`excludedScopes: ToolVisibilityScopes.UnattendedRoles`（就地写，注释说明与 `HumanAttended` 的差异就是多了 channel —— 符合 `Core/Tools/ToolVisibilityScopes.cs` 自述的「只有多工具共用的集合才放这里」）。
- 状态面：`Tools/SandboxElevationStore.cs` 仅存一个到期时间戳（`0` = 无豁免），**进程级、非 run 级、不持久化**。
- 面 <- 判定：`Tools/PathBoundary.cs:49 sandboxEnabled`（默认开，源自 iter-32 S-79）叠加 `!SandboxElevationStore.IsActive()`。
- 执行器：`src/runtime/WishfulClaw.Agent/SandboxElevationExecutor.cs`（`internal static class AgentRuntimeSandboxElevationExecutor`，与 `AskUser` 同族的 reverse-request）：已生效时短路；桌面走 `confirm`，渠道把请求文本发回由渲染端转交 `channel-shell-approval` 文字审批；批准后写 `SandboxElevationStore`。
- 分发层：`ToolDispatchRouter.cs` 签名含 `Tools.PathBoundary.Policy sandbox`（`:26-33`），`nonInteractive`（后台 run）短路置于 `AskUser` 之前；沙箱申请分支在 `AskUser` 之后、`else` 链内。
- 提示词：`Persona/PromptBuilder.cs:63 parts.Add(BuildSandboxContext())`、`:353 BuildSandboxContext()`。
- 渲染端：`lib/tools/sandbox-elevation.ts`（143 行）、`stores/sandbox-elevation-store.ts`（`SANDBOX_ELEVATION_DURATION_MS = 60*60*1000`、`untilMs`、`grant`/`clear`，刻意不持久化）、`components/chat/InputArea/sandbox-elevation-chip.tsx`（倒计时 + 「恢复」，同时清两侧）、`lib/ipc/renderer-tool-bridge.ts`。
- IPC：`main/ipc/worker-forward-handlers.ts:78-82 registerMessagePackHandler('sandbox:clear-elevation', …)`；`native-agent-runtime.ts` 同时把 `sandbox/elevation-request` 加入 reverse-request 允许清单；preload 走通用 `invokeMessagePackBinary`，无需单独 allowlist。
- 渠道超时：`lib/channel/channel-shell-approval.ts:104-105` 注释明确「静默渠道必须超时为 false，绝不让 run 挂在用户没看见的审批上」。

**核查与正面记录**

- 权限面收口正确：后台 run 走 `nonInteractive` 短路（不能弹窗 = 直接拒绝）；无人值守角色经 `UnattendedRoles` 整类排除；与 `AskUser` 同族的「reverse-request 拿不到人在场就降级」语义一致。
- 豁免是进程级的这一事实在代码与注释里都写明（跨会话共享，批准的是「这台机器上的一个决定」），属于设计取舍而非疏漏 —— 记录为**已接受设计**。
- 与 `channel-shell-approval` 的复用正确：渠道端不新建审批通道，直接套用既有文字审批，避免第二套超时行为。

### 问题

**W6 ⚠️ S-207 渲染端文案未走 i18n，硬编码中文。**
`lib/tools/sandbox-elevation.ts:51,53,54,81,82,119-128` 与 `components/chat/InputArea/sandbox-elevation-chip.tsx:39,45,51` 全部是硬编码中文（弹窗标题「请求临时关闭沙箱模式」、按钮「临时关闭（1 小时）」/「保持开启」、渠道文案「回复「同意」批准…」、chip「沙箱已临时关闭 · 剩 {minutes} 分钟」/「恢复」）。对照 S-204 已把同类文案成对写进 `locales/{zh,en}/layout.json`，且本应用自带 `en` locale，英文用户会看到中文弹窗。
**建议**：为 S-207 文案补 `locales/{zh,en}/layout.json` 键（或在 `sandbox` 命名空间下），与 S-204 保持同一条 i18n 口径。

**VERDICT: PASS（附 W6）**

---

## S-208 压缩摘要不再抢跑用户新消息

**要求**：自动压缩触发时，agent 不能把「压缩时刻之前的事」当成现在要干的事，忽略用户刚发出的消息。

**改动落点（实测）**

- `ContextCompression.cs`（`@@ -74,16 +74,21 @@` 起）：`SummarySystemPrompt` 常量四处改写 —— 背景不算指令、目标限定为「截稿时刻」、待办以陈述事实而非祈使句表述、禁止祈使语气。
- `ContextCompression.cs`：新增 `FindLatestUserText`，把压缩时刻用户的**末条消息原文**注入摘要体，包裹在既有 `<compaction-summary>` 标签内，并附「此为压缩时刻的快照；此后用户若有新消息，以对话中最新消息为准」。
- `AgentLoop.cs`（`:289-317` 压缩触发点）、`AgentLoop.Helpers.cs` 同步。
- 渲染端零改动：`lib/agent/context-compression.ts:142 stripCompactionSummaryTags` / `:144 .replace(/^\s*<compaction-summar…/` 仍能识别（注入内容在标签内，`StartsWith(tag)` 语义不变）；`ContextCompression.cs:197 IsCompactionSummary` 同样成立。

**核查与正面记录**

- 根因定位准确：压缩触发点在 `AgentLoop.cs:289-317`（每轮最开头），早于模型看到用户新消息，这与缺陷现象一致。
- 摘要标签语义未被破坏：注入只往标签**内部**加文本，`StartsWith`/`strip` 两侧判定都不必改，符合「渲染端零改动」的声明。

### 问题

**W4 ⚠️ `FindLatestUserText` 早于 `DrainQueuedMessages`，中途插话场景取到的是上一条用户消息。**
循环顺序是「压缩（`:289-317`）→ 排空排队消息（`:319-327`）」。若用户是在 run **正在进行中**才发消息（走排队路径），压缩发生时该消息尚未进入 `conversation`，注入的快照会捕获**前一条**用户消息。严重度低（新消息排在摘要之后仍是最后一条，prompt 侧自愈机制「以最新消息为准」也兜住了），但要明确：S-208 目前只完整覆盖「用户消息触发新 run」这一支。
**建议**：在阶段六真机复现时专门覆盖「run 进行中插话 + 触发压缩」；若要彻底修，可在压缩前先 `DrainQueuedMessages`，或让 `FindLatestUserText` 兼顾 pending 队列中的消息。

**W5 ⚠️ 注入的用户原文会随摘要一起渲染给用户，且不截断。**
注入文本在 `<compaction-summary>` 标签内，渲染端的 `stripCompactionSummaryTags` 只剥标签、不剥内容，因此用户在摘要卡片里会再看到一遍自己刚发的话；对超长用户消息还会**成倍增加 token**（注释明确「不截断」）。
**建议**：确认摘要卡片的渲染是否会让这段重复文本外露；若是，考虑给注入段加一个渲染端可识别的独立包裹标记（仍可零逻辑改动地隐藏），或对原文做上限截断（如 2000 字符）并在提示词里注明省略。

**VERDICT: PASS（附 W4/W5）**

---

## S-209 GLM 空响应（正文空但只出思考）

**要求**：GLM-5.3-flash 实测以正常 `stop` 收尾却正文为空、内容全落思考，不应直接判故障报错。

**改动落点（实测）**

- 新文件 `src/runtime/WishfulClaw.Agent/AgentLoop.EmptyTurn.cs`（**52 行**，已全文复核）：`internal const int MaxEmptyTurnNudges = 2`；`EmptyTurnNudge` 提示文案；`InjectEmptyTurnNudge` 走**临时副本**（与 `InjectSessionTodo` 同法），提醒不落库、不进 durable conversation。
- `AgentLoop.Helpers.cs:235-265 EnsureProviderTurnHasOutput`：判定放宽为「正文非空 ∨ 有工具调用 ∨ 思考非空」（`:252-253`），只有三者全空才 `throw ProviderEmptyResponseException`（`:262`），并在日志里给出 09-10 ~ 10-13 的 16 条 empty turn 抽样依据（`:249-250`）。
- `AgentLoop.cs:456-481`：`ToolCalls.Count == 0` 分支内，若「正文空 + 思考非空」且 `TryScheduleEmptyTurnNudge(MaxEmptyTurnNudges)` 成功 → `WorkerLog.Warn` + `continue`（催一轮，发生在 `iteration_end` 之前，因为它并没有真结束）；额度用尽则照常走 `iteration_end` + 收尾，**绝不无限重试**。
- `AgentRuntimeRunState.cs`：`PendingEmptyTurnNudge` / `EmptyTurnNudgeCount` / `TryScheduleEmptyTurnNudge`。
- `AgentLoop.cs:649` 在喂 provider 前调 `InjectEmptyTurnNudge`。

**核查与正面记录**

- **不污染历史**：催办走临时副本，摘要身份判定（靠消息形状）不受影响、聊天窗也看不到，这一点与 `InjectSessionTodo` 的既有做法一致，是正确选择。
- **有界重试**：`MaxEmptyTurnNudges = 2` 且计数落在 run state，不存在跨 run 累积。
- `continue` 跳过 `iteration_end` 的影响已核实为**无害**：渲染端 `iteration_end` 处理器是空 `break`（`stores/chat-store` 内），不会造成 UI 事件错配；且催办语义上本就不该报「迭代结束」。

### 问题

**W1 ⚠️ 只出思考的 assistant 轮会被原样送进 wire conversation，内容为空串。**
`AgentLoop.cs:435-436` 在该分支**之前**就把 `turn.AssistantMessage` 写入 `conversation` / `wireConversation`；实测 `ConversationCodec.cs:199-216 WriteAssistantWireContent` 在 `ToolUses.Count == 0` 时直接 `writer.WriteStringValue(message.Text)` —— 思考-only 轮会产出 `{"role":"assistant","content":""}`。OpenAI 兼容端点（GLM 的 `openai-chat`）容忍空串 content，但 Anthropic 系要求 assistant 内容非空（且「允许空 assistant」的例外只针对**最后一条** assistant 消息，而催办恰好会在其后追加一条 user 消息），存在 400 风险。
**建议**：阶段六在 Anthropic 系模型上跑一次「reasoning-only + 催办」用例确认；若确实 400，可在催办路径下用思考内容填充 `Text`（或跳过空 assistant 的写入）。

**W2 ⚠️ 催办未计入迭代预算，sidecar 单轮路径会被白耗。**
催办所在分支（`AgentLoop.cs:456-481`）在 `providerTurnOnly` 判定（`:484` 附近）**之前**。sidecar 以 `providerTurnOnly: true, maxIterations: 1` 调用（`lib/ipc/agent-bridge-streaming.ts:94/195`），一旦 provider 回 reasoning-only，`continue` 会额外吃掉一轮，随后因 `maxIterations=1` 退出并报 `max_iterations`，而 sidecar 拿到的正文仍是空。
**建议**：把催办条件收紧为 `!providerTurnOnly`，或要求「剩余迭代 > 1」时才催（读 run state 的迭代余量）。

**W3 ⚠️（信息）催办分支同时跳过 `iteration_end` 与 `TryCloseMessageQueueIfEmpty()`。**
`:462-470` 的 `continue` 一并跳过了 `iteration_end`（无害，见上）与 `TryCloseMessageQueueIfEmpty()`（`:474` 附近）。后者被跳过意味着「催办轮开始后才排空的排队消息」不会触发收尾判定 —— 因为循环本来就要继续，这一行为是**正确**的，此处仅作留痕以免后续误读为「漏调清理」。

**VERDICT: PASS（附 W1/W2/W3）**

---

## 跨需求问题

**W7 ⚠️ 行数上限：4 个文件 > 500 行且无有效豁免头。**
`AGENTS.md:175` 规定「超过 500 行必须拆分」，`:178` 要求越线文件在文件头写明豁免理由与**当前行数**。实测（`Get-Content | .Count`）：

| 文件 | 当前行数 | base 行数 | 豁免头 |
| --- | --- | --- | --- |
| `src/renderer/src/stores/chat-store/session-slice.ts` | **1099** | — | 无（S-204 主战场） |
| `src/runtime/WishfulClaw.Agent/ContextCompression.cs` | **945** | — | 无（S-208 主战场） |
| `src/runtime/WishfulClaw.Agent/AgentLoop.cs` | **726** | 643（+83） | 无（S-208/S-209 主战场，已拆 `AgentLoop.Helpers/EmptyTurn/…` 分部类） |
| `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs` | **632** | 593 | **有但过时**：头注释仍写「573 行（2026-09-22）」 |

`src/renderer/src/components/chat/InputArea/index.tsx` = 480，**未越线**（S-207 的 chip 是新增独立文件，未塞进 index.tsx，做法正确）。

**建议**：
1. 新生效的本迭代涨行（`AgentLoop.cs` +83、`ToolDispatchRouter.cs` +39、`session-slice.ts`/`ContextCompression.cs` 各自微增）应在阶段六收尾时至少**更新豁免头行数**；`ToolDispatchRouter.cs` 的「573」已与实测 632 不符，属明显遗漏。
2. `session-slice.ts`（1099）与 `ContextCompression.cs`（945）早已远超阈值，本迭代又在其上动刀 —— 建议把「按 S-204 / S-208 这两块职责拆文件」登记为 tech-debt，与本迭代的解耦边界（清除会话 / 压缩摘要）天然吻合，成本低。
3. `AgentLoop.cs` 已有部分类拆分基础（`AgentLoop.EmptyTurn.cs` 52 行即本次新增），把 S-208 的压缩辅助与 S-209 的催办辅助进一步外移即可接近阈值，无需大改。

### W7 处置结果（2026-10-20，收尾刀后补做）

本迭代**改动过**且 >500 行的文件共 **7 个**，全部带豁免头，数字与收尾实测一致（`Get-Content | .Count`）：

| 文件 | 行数 | 处置 |
| --- | --- | --- |
| `stores/chat-store/session-slice.ts` | 1103 | **拆**才是正解但成本高（80 余方法共享一份 immer state）⇒ 补豁免头「高度内聚的 store」；拆分登记为 tech-debt |
| `Agent/ContextCompression.cs` | 949 | **拆了**：S-208 快照逻辑外移到 `ContextCompression.UserSnapshot.cs`（111 行），1056 → 949；豁免头原写 936（当时预估，实际 949）已订正 |
| `Agent/AgentLoop.cs` | 755 | 豁免头原有但挂在 `namespace` 之后（不算文件头）⇒ 移到第 1 行；数字 755 实测相符 |
| `stores/chat-store/db-helpers.ts` | 712 | 22 个同构 `workerRequest` 薄封装 ⇒ 补豁免头「高度内聚」 |
| `website/src/index.css` | 699 | 设计 token + 组件类，且 `@import` / `@plugin` 顺序参与 cascade ⇒ 补豁免头「同质数据」 |
| `Agent/ToolDispatchRouter.cs` | 633 | 豁免头原有但写 573 ⇒ 订正 633 |
| `lib/api/types.ts` | 525 | 37 个纯 `interface` / `type` 声明 ⇒ 补豁免头「单一数据对象」 |

**遗留 tech-debt（未做，已记账）**：`session-slice.ts` 按「会话生命周期 / 消息读写 / 用量统计」三块拆成 slice 组合，与 S-204 的清除链路天然对齐；`db-helpers.ts` 按表拆成 session / message / project / usage 四个模块。两者都需要改多个调用方 import，留给专门的拆分需求，不在本迭代收尾里动。

---

## 其它一致性核查（通过项，供阶段六留痕）

- **无新增依赖**：`package.json` / `*.csproj` 未出现在 diff 中。
- **IPC 安全口径**：S-207 的 reverse-request 同步记入 `native-agent-runtime.ts` 的允许清单 —— 沿用了 S-145 以来的做法（新增 reverse-request 必须同时更新 main 侧清单），未出现漏登记。
- **渠道静默失败防线**：`channel-shell-approval.ts:104-105` 的超时-to-`false` 语义被 S-207 直接复用，没有新写一套可能挂死的等待逻辑。
- **i18n 成对性**：S-204 新增的 `clearSession*` 三个键在 zh/en 两侧行号一致（`:238-240`），无单向缺键（S-207 的缺口见 W6）。

---

## 总结

本迭代 7 条需求在代码层面**全部落地且实现方向正确**：S-203/S-206 是最小侵入的 CSS 方案（撤 `.shine` 保动画、reduced-motion 停摆）；S-204 的关键在 guard 时序与 finally 释放，实测均正确且后端零改动成立；S-205 清掉了碰瓷话术并对齐了 README 锚点；S-207 的能力面（无参工具）、权限面（后台短路 + 无人值守排除）、状态面（进程级 1 小时）三层收口一致；S-208/S-209 都选择了「提示词侧 + 临时副本注入」这条不污染历史的路线，与既有 `InjectSessionTodo` 同族。

未发现 ❌ 级缺陷（构建/类型/测试门禁按 plan 由阶段六执行，本次为只读审查）。8 项 ⚠️ 中，W1（空 assistant 上线对 Anthropic 系的风险）与 W4（中途插话时快照取到上一条用户消息）**建议在阶段六真机复现时专门覆盖**；W6（S-207 文案未 i18n）与 W7（4 文件越线 / 豁免头过时）适合在收尾「最后一刀」一并处理，成本都很低。

**Verdict: 需小幅修改（needs changes）—— 无阻断项，可进入阶段六验证态；W1/W4 需真机确认，W6/W7 建议随收尾修复。**

---

# 第二轮审查（2026-10-20，覆盖 `00dcf7db..96c8fa3d`）

第一轮之后又落了三个提交：`48ba39a9` / `502b1c5f`（官网文案与背景动画收尾定案）、
`b6a95eca`（S-207 真机报错 `CannotWritePropertyWithinArray` 的修复）、
`96c8fa3d`（S-208 压缩摘要带用户消息时刻与执行进度）。第二轮按官网面 / 软件面两条线各审一遍。

## 第二轮结论速览

| 面 | ❌ | ⚠️ | 一句话 |
| --- | --- | --- | --- |
| 官网（S-203 / S-205 / S-206） | 0 | 12 | 落点全对；12 项里 5 项是「已定案被实施逆转或文档没跟上」，3 项是实打实的渲染开销，4 项待老大拍板 |
| 软件（S-207 / S-208 / S-209） | 1 | 8 | B1 是唯一会产出错误界面的缺陷（已修 + 已加回归）；其余为缺显示层、缺审计、口径打架、可测性 |

## 官网面

**通过项（实测留痕）**

- S-203 sticky footer 落点全对：`index.css:81-85` `#root { display:flex; flex-direction:column; min-height:100vh }` + 三处 `<main className="… flex-1 …">`（`App.tsx` / `components/doc-page.tsx` / `download-page.tsx`），`go-page.tsx` 有意不加（该页无页脚）。
- S-206 扫光删干净：`.shine` / `.shine-muted` / `.hero-shine` / `data-text` 渲染面零命中；`.dl-shine` / `.dl-current` 保留属定案。
- `prefers-reduced-motion` 双路径齐备（CSS 媒体查询 + `matchMedia` 提前 return）；装饰层 `pointer-events:none` / `aria-hidden` 到位。
- 友商品牌词（Codex / Cursor / Claude Code）渲染面 0 命中。

### 问题（已处置）

| 编号 | 内容 | 处置 |
| --- | --- | --- |
| ⚠️1 | 六处「已定案」被 10-19 实施逆转，changelog 官网侧零记录 ⇒ 阶段六会按旧判据判不合格 | **已修**：`changelog.md` 补「官网侧：S-205 / S-206 收尾定案」6 条流水；`requirements/S-205.md` §十、`S-206.md` §十 记录逆转与理由 |
| ⚠️2 | README 首屏与官网 hero 不同源，违反 S-205 判据 2 | **已修**：`README.md:4-5` 改「你提需求，它跑全程」+ 与 `site.ts` 同源的简介行 |
| ⚠️7 | 注释漂移（`converge-streams.tsx:3/:55/:122`、`advantages.tsx:4`、`App.tsx:13`） | **已修**：五处注释按当前实现重写 |
| ⚠️11 | `S-205.md:297` 数字漂移（「2 条注释」实为 3 行；「site.ts 改 7 处」实为 13 处） | **已修**：改为实测值 |

### 问题（待老大拍板，未动）

| 编号 | 内容 | 待定原因 |
| --- | --- | --- |
| ⚠️3 | `site.ts:61`「搜本地文件」实况需另装 Everything（`src/main/lib/everything-search.ts:4-10`） | 属于对外口径，风险是「装了没搜到」 |
| ⚠️4 | 「它跑全程」贴近 §四-3 禁写的「全自动无人值守」 | 老大 10-19 明确点了这句；红线段落归属由他定 |
| ⚠️5 | README `✨`/`💾`/`❓` 三节开场未同步新调性 | 与 S-205 的「改哪些节」范围一致，需一并确认 |

### 问题（观感/性能，评估后未动）

⚠️6 / ⚠️7（已修为例外）/ ⚠️8 / ⚠️9 / ⚠️10 / ⚠️12 属「还能更好」而非缺陷。其中 ⚠️6 在本轮已处理了主体
（`converge-streams.tsx`：rAF 加 IntersectionObserver、ResizeObserver 加尺寸守卫、每帧字符串改按
`(颜色, alpha 档)` 缓存），**未动**的是缩放档位与 `color-mix()` 的 `@supports` 降级 —— 这两处改的是
观感参数，等老大在真机上看完再定，不在审查期擅自动。

⚠️12（`index.css` 695 行超标）不在本小节 —— 属行数硬线问题，已随 §W7 处置结果一并补上豁免头（实测 699 行）。

## 软件面

### ❌ B1（必修，已修）：快照剥离按块判定，用户消息含空行就漏字

`getCompactSummaryDisplayText` 用「按空行切块 + 逐块看前缀」剥离 S-208 的快照块，而
`splitCompactSummaryBlocks` 正是按空行切的。用户消息里一有空行（粘多段文本是最常见输入），
块 1 是「第二段」⇒ 不以前缀开头 ⇒ 循环停下 ⇒ **后半段 + 整块压缩时刻一起漏回卡片**。
单段能过纯属块数巧合（`startIndex < blocks.length - 1` 兜住）。

**修复**：改用 Worker 写死的收束句 `以上为压缩时刻的快照；此后用户若再有消息，以对话中最新消息为准。`
作结束锚点，一次剥到位；认不出锚点就原样返回（旧摘要没有这一段，猜位置截断会吃掉正文）。

**回归**：新增 `tests/compaction-snapshot-display/`（10 用例，含「多段用户消息」「多段原文 + 多段摘要」
两条 B1 专项）。顺带把显示链路拆成 `src/renderer/src/lib/agent/context-compression-display.ts` —— 纯模块、
不 import IPC，这正是它此前零覆盖的原因（原文件顶层依赖 `agent-bridge-streaming`）。

### 问题与处置

| 编号 | 内容 | 处置 |
| --- | --- | --- |
| 3.1 | S-208 裁定 3「显示面」没落地：`compactedAt` / `latestUserSentAt` / `latestUserState` 全仓只有类型声明，卡片零消费、locale 无三态键 | **已修**：`ContextCompressionMessage.tsx` 展开区加一行元信息；zh/en 各补 6 个键（`summaryCompactedAt` / `summaryLatestUserAt` / `summaryLatestUserState` / `latestUserNotStarted|Running|Answered`）。**09:58 真机回看后老大又拍掉第三段**（卡片只留两个时刻，状态只给模型），见 `S-208.md` §9.7 |
| 3.2 | `SandboxElevationStore.Grant()` 无审计日志，而「恢复」方向有 | **已修**：`SandboxElevationExecutor` 批准路径记 session / run / until / reason |
| 3.3 | 批准后系统提示词仍写「沙箱开着」（按 run 开头构建 + 进 cacheKey），与 `PathBoundary.IsEnabled` 实时豁免打架 | **已修**：新增 `AgentLoop.SandboxTransition.cs`，每轮 provider 调用前比对实时状态，变了才注入一条临时提示（不落库、不进 durable conversation） |
| 3.4 | `BuildJsonElement` 无「不给外壳」的约定约束 | **已修**：`WorkerResponse.cs` 补 `<remarks>` 写明坑与 AOT 退化后的症状；`JsonHelpers` 套件加「回调只写属性名必须抛」用例（24→28）；`SandboxPath` 套件加 `BuildRequest` 形状用例（14→20） |
| 3.5 | 审批弹窗 / 渠道文案全硬编码中文；`grantLocal(_approved: boolean)` 参数未用；「1 小时」三处独立硬编码 | **已修**：全部走 `agent` 命名空间 `sandboxElevation` 段（zh/en 各 11 键）；时长由 `SANDBOX_ELEVATION_DURATION_MS` 推、审批超时由 `SHELL_APPROVAL_TIMEOUT_MS` 推；`grantLocal()` 去参数 |
| 3.6 | S-209 的 `conversation.Add(turn.AssistantMessage)` 早于催办判定 ⇒ 催办 2 次留 2–3 条 `Text == ""` 的 assistant 落库 | **已修**：催办判定提到写入之前，空轮直接 `continue`；真实产出（正式答复 / 带工具调用）在判定之后统一写入 |
| 3.7 | 官网两处渲染开销（同 ⚠️6） | **已修**（见官网面） |
| 3.8 | `ContextCompression.cs` 1056 行无豁免头；`ToolDispatchRouter.cs` 豁免头仍写「573 行」 | **已修**：快照逻辑抽到 `ContextCompression.UserSnapshot.cs`（111 行），主文件降到 936 行并补豁免头；两处豁免头行数按实测更新（936 / 633）；`AgentLoop.cs` 补豁免头（755） |

**另记（未改，理由随附）**

- 3.6 的「额度用尽后那条空 assistant 仍落库」保持原样：S-209 已定案「额度用尽即正常收尾」，
  这条消息是收尾语义的一部分，挡掉它是改行为而不是修缺陷。
- `ErrorCode` / 沙箱豁免「进程级而非 run 级」等既有设计取舍维持不变（第一轮已记录为**已接受设计**）。

---

## 门禁（第二轮收尾实测）

| 门禁 | 结果 |
| --- | --- |
| `npm run typecheck` | 退出 0（node + web 两配置） |
| `npm test` | **73/73**（新增 `test:compaction-snapshot-display`；JsonHelpers 24→28、SandboxPath 14→20） |
| `dotnet build src/runtime/WishfulClaw.sln` | 0 警告 0 错误 |
| `cd website && npm run build` | 退出 0 |
