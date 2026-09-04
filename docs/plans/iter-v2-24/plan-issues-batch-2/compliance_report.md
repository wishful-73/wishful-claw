# 规划验证报告：issues 批次 2（v2-iter-24）

> ## 收敛台账（截至第四轮 · 2026-09-05）—— 全文唯一的「还剩几个」视图
>
> **❌ 未清 3 项：❌13（清单残留）｜❌14｜❌15** ｜ ⚠️ 未处理 0 项（第 4 版已全部修入正文，**修完的正文本身待第五轮复核**）
>
> 轨迹：第 1 轮 ❌8 → 第 2 轮 ❌3（+8 关闭）→ 第 3 轮 ❌2（+3 关闭）→ 第 4 轮 ❌3（❌12 关闭，❌13 半修，新出 ❌14/❌15）。
> 每追加一轮验证必须更新本表，并在 `plan.md` 头部版本行写明本版关闭了哪几项 ❌、哪几项只是「已修待复核」——规则见 `docs/dev-workflow.md` 阶段三「多轮验证与收敛台账」。

| 编号 | 出处 | 一句话 | 状态 |
|---|---|---|---|
| ❌1 | 第 1 轮 | 步骤 6 未识别 `dynamic-context.ts` 已有零调用实现，存在双实现口径 | ✅ 第 2 轮复核关闭（残留 ⚠️12 → 第 3 轮已清） |
| ❌2 | 第 1 轮 | 步骤 3 缺 tab 状态必改方（`preview-panel-slice.ts` / `SubAgentsPanel.tsx`） | ✅ 第 2 轮复核关闭 |
| ❌3 | 第 1 轮 | 误把 `activeScopedSessionId` 当死代码删除 | ✅ 第 2 轮复核关闭（改为接管悬空锚点） |
| ❌4 | 第 1 轮 | 引用不存在的 `addRightPanelTab` | ✅ 第 2 轮复核关闭（换成真实 ensure* 名单） |
| ❌5 | 第 1 轮 | 步骤 2 验收指向不存在的 ToolCallCard 复用；`TodoCard.tsx` 孤儿无处置 | ✅ 第 2 轮复核关闭（残留 ⚠️16 → 第 3 轮已清） |
| ❌6 | 第 1 轮 | 「本仓无 `change-summary-utils`」失真 | ✅ 第 2 轮复核关闭（引出 ❌9） |
| ❌7 | 第 1 轮 | 步骤 7 分类口径不覆盖真实分类；Core 改动未列；单一来源未证 | ✅ 第 2 轮复核关闭（残留 ⚠️19/20/21） |
| ❌8 | 第 1 轮 | I24-17（`InputArea/index.tsx` 510 行）被静默丢弃 | ✅ 第 2 轮复核关闭（残留 ⚠️15 → 第 3 轮已补 `wc -l` 判据） |
| ❌9 | 第 2 轮 | 移植 OpenCowork 变更审查按钮会造出无出口的死按钮 | ✅ 第 3 轮复核关闭（择定「不移植」+ 配验收） |
| ❌10 | 第 2 轮 | 「涉及文件」写了不存在的路径 `MessageList/MessageList.tsx` | ✅ 第 3 轮复核关闭 |
| ❌11 | 第 2 轮 | 步骤 6b 无 `[自动]` 门禁，按其自订规则无法判 `[✓]` | ✅ 第 3 轮复核关闭（引出 ❌13） |
| ❌12 | 第 3 轮 | 步骤 3「只过滤 `tab.sessionId`」在固定 id + 按 `kind` 全局去重的单例模型下不成立 | ✅ 第 4 轮复核关闭（改按 `${kind}:${tabScopeId}` 会话化，前提经全仓 grep 复核为真）；**残留改动面另立 ❌14/❌15** |
| ❌13 | 第 3 轮 | `MessageMeta.selectedFileReads` 零写入方，承载写入的 `stores/chat-store/index.ts` 未进「涉及文件」 | 🟡 **半修（计入未清）**：正文已加步骤 6a-2，「涉及文件」第 211 行仍无该文件 |
| ❌14 | 第 4 轮 | 步骤 3 未纳入「activeTab 落位 / 空列表收起 / `rightPanelActiveTabId` 标量写入」四处判定点，且这些逻辑全跑在未过滤数组上 | 🔴 未清（第 4 版正文已修，待第五轮复核） |
| ❌15 | 第 4 轮 | 删除会话时 `session-slice.ts:150-152` 直写 `activeSessionId` 绕过 `setActiveSession`，新模型下作用域锚点停在已删会话 → 过滤恒空 | 🔴 未清（第 4 版正文已修，待第五轮复核） |

**⚠️ 建议项（30 项）收敛**：⚠️1–⚠️23 已在第 2/3 版正文落地或转成 ❌/残留项关闭；第 3 轮 ⚠️24/25/27/28/30 **已采纳**，⚠️26 **部分采纳**（新写文本又带入 3 处漂移，见四·4），⚠️29 **完全未采纳**（第 4 版已修）。本轮新增 ⚠️31–⚠️38 全部修入第 4 版正文。

---

## 一、逐项判定
- 配套探索：`docs/plans/iter-v2-24/plan-issues-batch-2/exploration_findings.md`
- 核查基线：`dev/v2-iter-24` @ `577712b`（工作区仅 `docs/plans/iter-v2-24/plan-issues-batch-2/` 未跟踪），与探索声明的基线一致，因此下列行号全部对得上执行时的代码
- 规范依据：`AGENTS.md`（7 层依赖 / AOT 9 条 / 大文件拆分 / 编译验证）、`docs/dev-workflow.md`（六阶段、plan.md 格式、每步验证检查点、阻断规则）
- 本报告为只读核查产物，未改动任何代码

---

## 一、逐项判定

### 1. 目标覆盖 —— ⚠️

计划声明范围 7 个内容条目，全部有对应步骤，无「声明了却没有步骤」的空洞条目：

| 条目 | 步骤 | 判定 |
|---|---|---|
| B1 中文 IME 末字符 | 步骤 1 | ✅ |
| B2 Todo 抢高度 | 步骤 2 | ✅ |
| M5 Todo 面板抄 OpenCowork | 步骤 2 | ⚠️（见 ❌6） |
| B3 右侧面板会话隔离 | 步骤 3 | ✅ |
| M6 Tab 菜单改造 | 步骤 4 | ✅ |
| M1 首条消息顶部间距 | 步骤 5 | ✅ |
| M4 文件选中发送读内容 | 步骤 6 | ⚠️（见 ❌1） |
| M3 剩余（分类说明提示词） | 步骤 7 | ⚠️（见 ❌7） |
| 收口 | 步骤 8 | ✅ |

扣分理由：两处「声明的口径」与「步骤实际写的内容」不等价 —— 步骤 2 声称「直接抄 OpenCowork 成熟组件」但砍掉了该组件的变更审查能力（前提不实），步骤 6 声称「只差发送前读取编排」但本仓已有一份完整未接线的同类实现。详见 ❌1、❌6。

### 2. 验证检查点 —— ❌

8 个步骤**全部**带编号检查点，且自动化（`tsc` 三套 / `dotnet build`）与人工运行态实测在文字上分开表述（步骤 1「① tsc；②-⑤ 人工实测」、步骤 2「① tsc；② 运行态」等），符合 dev-workflow 阶段四 Mini 验证要求，这点做得比规范底线好（AGENTS.md 要求三套 tsc，计划确实写三套）。

但存在**无法执行的检查点**，属实质缺陷：

- 步骤 2 ⑤「消息流内嵌 Todo 视图（`ToolCallCard/index.tsx:166` 复用处）渲染无变化」—— 该复用关系不存在，`ToolCallCard/index.tsx:166` 实际是 `}, [name, outputText, summary, t])`（一个 useMemo 的依赖数组），全文件 grep `TodoCard|TodoStatusList` 零命中 → 检查点检查一个不存在的东西（❌5）。
- 步骤 7 ②「System Prompt 分类清单与 `tool/list` 实际返回的 category/priority 一致（打印比对）」—— 按 ① 的口径（只写 7 类 + 未知兜底）打印必然不一致，因为有 17 个真实分类落在 unknown=100（❌7）。
- 步骤 7 ③「PromptBuilder 字符预算无溢出告警」—— `<tool_calling>` 段不受任何预算约束：`PromptBuilder.cs:24` `DefaultCharacterBudget = 20_000` 只作用于 `BuildContextDocuments`（`:144-176`），另一处预算是 `:188` `memoryBudget = 6000`。`BuildToolCapability`（`:235-247`）是裸 raw string，加多少字都不会产生「溢出告警」→ 该检查点恒为真，等于没检查（⚠️9）。
- 步骤 1 第 3 条改动缺客观判据：「若 `parseDomToDocument(root)` 与 state 不一致且**差异为 IME 尾字符**，则以 DOM 为准」——「差异为 IME 尾字符」在代码里没有可判定定义，实现者只能凭猜（⚠️1）。

### 3. 文件路径正确性 —— ❌

**存在性**：「涉及文件」列出的 22 条已有文件路径全部真实存在（逐个校验通过）；`SessionTodoPanel.tsx` 为待新建，本仓 `src/renderer/src/components/cowork/` 下确无 StepsPanel（不与既有文件重名），新建合理。

两处**路径写法有歧义**（文件本身存在，但按目录拼接会得到不存在的路径）：
- `src/renderer/src/components/chat/MessageList/VirtualListContent.tsx`、`MessageList.tsx`、`TranscriptMessageList.tsx` —— 后两个不在 `MessageList/` 目录下，实际为 `src/renderer/src/components/chat/MessageList.tsx`（`:92` exportAll 容器，行号正确）与 `src/renderer/src/components/chat/TranscriptMessageList.tsx`（`:126` 滚动容器 className，行号正确）。`MessageList/` 目录里既无 MessageList.tsx 也无 TranscriptMessageList.tsx（那里是 `StaticMessageTranscript.tsx`）。

**清单缺文件**（这是本项判 ❌ 的主因）：
- 步骤 3 的数据模型改动（`rightPanelTabs` 扁平数组 → per-session map）漏掉两个必改方：`src/renderer/src/stores/preview-panel-slice.ts`（`:56,72-81,139-150,168-196`，共 12 处读写 `rightPanelTabs`，preview tab 由 `openFilePreview` 写入右侧面板）与 `src/renderer/src/components/layout/SubAgentsPanel.tsx`（`:243,245,310,319` 直接 `useUIStore(s => s.rightPanelTabs)`）。不改这两个，步骤 3 无法编译通过或运行即错。
- 步骤 6 漏掉 `src/renderer/src/lib/agent/dynamic-context.ts`（既有 selected-files 读取 + `<system-reminder>` 注入实现，见 ❌1）。
- 步骤 1 第 3 条的实际改动落点 `src/renderer/src/components/chat/file-aware-editor-utils.ts`（`renderDocument` 内部 `:221 root.replaceChildren()`）未列。
- 步骤 6 改 `fs:read-text-file-lines` 返回 shape 需同步 `src/renderer/src/lib/ipc/channels.ts:25,383` 与 `src/renderer/src/lib/ipc/messagepack-channel-routing.ts:28,143`，未列。

**file:line 抽查**：抽查 30+ 处，29 处吻合，1 处（`ToolCallCard/index.tsx:166`）完全错位，另 3 处为「行号对但语义/命名不准」。明细见第四节表格。

### 4. 参考源码有效性 —— ⚠️

`D:\claw\OpenCowork`（本地副本存在，`src/renderer/src/components/cowork/StepsPanel.tsx` 776 行 / `hooks/use-chat-actions.ts` 7686 行 / `components/chat/FileAwareEditor.tsx` 841 行）中被引用的**全部行号真实命中**，无凭空引用：

- `StepsPanel.tsx:328` = `function InlineStepsPanelCard({` ✅；`:371` 卡片 className ✅；`:373-402` header + chevron `rotate-180` ✅；`:433` `<AnimatePresence initial={false}>` ✅；`:444` `max-h-64 overflow-y-auto` ✅；`:485` `InlineStepsPanel` ✅；`:289/:303` 右栏版 `max-h-[calc(100vh-200px)]` ✅。
- `use-chat-actions.ts:594` = `const SELECTED_FILE_READ_MAX_LINES = 1_000` ✅；`:848-953` = `buildSelectedFileReadContext` 完整函数体 ✅；`:940-949` `<system-reminder><selected_files>` 拼装 ✅；`:595-606` 屏蔽扩展名集合 ✅。
- `FileAwareEditor.tsx:794` = `isComposingRef.current = false`（在 onBlur 内）✅；`:736-752` = compositionend 同步 flush（计划/探索声明「这是已修的旧 bug，不对齐」，与代码事实一致 ✅）。

两点问题：
- 「本仓无 `change-summary-utils`」这一**取舍前提不成立**（❌6）。
- 计划把「复位 `pendingUserInputRef`」也归为「对齐 OpenCowork `:794`」，而参考实现的 onBlur 只复位 `isComposingRef`，不含 `pendingUserInputRef`（⚠️2）。这属于自创改动，不该挂参考的Name。

### 5. 分层与规范 —— ⚠️

- **依赖方向**：无违反。本批 C# 只改 `WishfulClaw.Persona/PromptBuilder.cs`（Persona 层第 5 层），未新增跨层引用，未出现下层引上层。
- **职责归属**：PromptBuilder 属 Persona 层（AGENTS.md 明列「分段组装 System Prompt + 字符预算」），工具分类说明写在这里方向正确 ✅。但分类真值在 Core（`WishfulClaw.Core/Tools/ToolRegistry.cs:25-34`），在 Persona 硬编码一份清单必然漂移；且若为对齐而扩 `CategoryPriorities`，那是 **Core 层改动**，而 Core 未出现在「涉及文件」里（❌7）。
- **AOT**：核查通过 —— 本批唯一 C# 改动是 raw string 字面量，不新增序列化类型。步骤 6 的 `selectedFileReads` meta 走 `MessageEntity.Meta`（`src/runtime/WishfulClaw.Infrastructure/Db/Entities/MessageEntity.cs:16,38` 为 `string?`）与 `chat-store/db-helpers.ts:134 JSON.stringify / :154 JSON.parse` 的**不透明 JSON 透传**，全仓 C# 侧 grep `SelectedFileReads` 零命中 → 确实不需要注册 `JsonSerializerContext` / 显式 `JsonTypeInfo`。步骤 8 那句「涉及 C# 序列化的改动复核 AOT 规范」是安全网，无漏项。
- **500 行红线**：`src/renderer/src/components/chat/InputArea/index.tsx` 当前 **510 行**（已超线），步骤 2 要往该文件加新面板挂载。AGENTS.md 规定「超过 500 行必须拆分」，探索 §五 明确要求「I24-17 与步骤 2 同期顺手收」，计划步骤 2 未提、「本批次不做」也未提 → ❌8。`TodoCard.tsx` 466 行、`FileAwareEditor.tsx` 461 行、`session-slice.ts` 724 行：只有前者与本批有实质耦合（职责边界，见 ❌5）。

### 6. 遗漏风险 —— ❌

计划已识别到位的风险：IME 无自动化护栏需人工（步骤 1）、virtualizer paddingStart 需校验收纳 offset（步骤 5）、全局会话无 workingFolder 退化（步骤 6）、注入撑爆请求体/破坏 prefix cache 的硬上限（步骤 6）、prefix 稳定性（步骤 7 精简表述）。步骤 3 → 步骤 4 的提交顺序依赖成立：步骤 4 新增的 `closeAllRightPanelTabs/closeOtherRightPanelTabs` 需以步骤 3 的会话作用域模型为前提，而计划按 3→4 单步 commit，顺序正确 ✅。

明显缺失的 5 项：

1. **与本仓既有 selected-files 注入实现撞车**（❌1）。
2. **`rightPanelTabs` 改模型的两个必改方缺列**（❌2）；且未说明 `rightPanelActiveTabId`（`ui-store.ts:83`、`ui-store-interface.ts:61` 为单一全局字段）如何随会话保存/还原 —— 而步骤 3 验收②「切回 A → activeTab 完整还原」正依赖它（⚠️7）；也未处理 preview tab 双栈耦合（`ui-store.ts:103-118` `closeRightPanelTab` 会回调 `closePreviewTab`），「关闭所有/关闭其他」若按 tabId 循环关闭，preview 类 tab 会走另一条链，语义易错（⚠️7）。
3. **`TodoCard.tsx` 换完即成孤儿**（❌5）。事实：`TodoStatusList`（`TodoCard.tsx:345`）唯一消费者是 `InputArea/session-todo-status-list.tsx:23`；`TaskCard`（`TodoCard.tsx:164`）全仓**零消费者**；`embedded` prop（`:65,74,168,349`）无任何调用方传 true。步骤 2 用 `SessionTodoPanel` 顶掉 composer 挂载后，466 行 `TodoCard.tsx` 会整体变成死代码，计划只写了「若仅剩消息流用途则加注释」—— 前提不成立，缺处置口径。
4. **composer 附件与内联标签两条通道的分歧**（⚠️5）。步骤 6 只从 `parseSelectFileText`（`select-file-tags.ts:159`）解析，但发送请求里已经带着一份 `selectedFiles`（`use-chat-actions.ts:778,793`，元素类型 `SelectedFileItem`，含 `originalPath/sendPath/previewPath/isWorkspaceFile`，定义在 `lib/api/types.ts:325-329`），另有 `ui-store.ts:304 selectedFiles`（全仓无写入方）。三个「选中文件」来源并存，计划只点名一个 → 同一文件被注入两遍的风险未被约束。
5. **压缩/快照与本批「无交集」的判断不充分**（⚠️11）。探索 §四.6 一句话排除，但步骤 6 会改变每轮请求体内容，而 `docs/PROGRESS.md`/近期 4 个提交（`577712b`、`947d442`、`8e01b94`）都在改压缩：手动压缩后 Worker 重建权威上下文时，`<selected_files>` 注入落在压缩边界前还是后、快照恢复后首轮是否重放，计划与探索都没有交代。按记忆条目「带会话状态的后端操作不能信分页转录」，这类交互必须显式表态。

i18n 落库这一项计划做得对：步骤 2 明确新增 key 落 `chat` ns 中英双份不留 `defaultValue`；步骤 6 所需的 `userMessage.selectedFileRead*` 六条 key 已同时存在于 `locales/zh/chat.json:1105-1111` 与 `locales/en/chat.json:1106+`，「涉及文件」也正确列出两个 chat.json ✅。回归测试缺自动化护栏属已知约束（探索 §四.1 已声明 `tests/` 无 IME 用例），可接受。

### 7. 范围一致性 —— ⚠️

「本批次不做」4 条与探索 §五 7 行对照：I24-11 ✅、I24-15 ✅、review-12/plan-review-fixes 清单更正 ✅、三份计划归档 + 压缩孤儿组件退役 ✅（合并为一条）；**I24-17（InputArea 超 500 行）被静默丢弃**，而探索把它明确指派给「与步骤 2 同期顺手收」，步骤 2 又确实改该文件 → ❌8。M2 判定已完成、Plan A/B、自动更新 E2E 三条属本批自设边界，与探索不冲突 ✅。

另一处自相矛盾：头部「范围确认」写「B2 直接抄 OpenCowork 组件」，步骤 2 正文却同时声明「数据源沿用本仓 `getTasksBySession`」—— 参考组件的卡片（`StepsPanel.tsx:328`）吃的是 `InlineTaskSummaryItem[]`（由 `InlineStepsPanel:485` + `useStepsPanelData` 从 plan 任务 + session todo + team task 三源合成，并带 plan/team tone），不是 `TaskItem[]`。这不是「抄」，是「按参考样式重写 + 自写适配层」。计划应把这点写实，否则步骤 2 的工作量与回归面被低估（⚠️8）。

---

## 二、❌ 阻断项（必须修正后才能进入执行态）

**❌1 步骤 6 未识别本仓已有的 selected-files 读取与注入实现，存在双实现撞车**
- 问题：计划与探索均称本仓「发送时不读内容」「只差发送前读取与写 meta 的编排逻辑」，据此要在 `use-chat-actions.ts` 新写一套编排。实际本仓已有一份完整实现，含 token 预算、SSH 分支、截断与 unreadable 处理，只是**没有接线**。
- 证据：`src/renderer/src/lib/agent/dynamic-context.ts:19` `FILE_CONTEXT_BUDGET_RATIO = 0.25`、`:74-83` 调用 `buildSelectedFileContext(selectedFiles, workingFolder, sshConnectionId, modelConfig)`、`:185-240` 函数体（`:210` 走 `fs:read-file` / `ssh:fs:read-file`，`:212-215` unreadable skip）、`:89` 拼 `<system-reminder>`；入口 `buildRuntimeReminder`（`:24`）全仓 grep **仅此定义 + `lib/tools/codegraph-tool.ts:12` 一句注释**，无任何调用方。
- 修正建议：步骤 6 二选一并写实 —— (a) 接线 `buildRuntimeReminder`，把 `selectedFiles` 来源换成 `<select-file>` 解析结果 + composer `SelectedFileItem`，再补写 `selectedFileReads` meta；或 (b) 明确弃用/删除 `dynamic-context.ts:185-240`，在计划里说明理由。同时把 `lib/agent/dynamic-context.ts` 加入「涉及文件」，并统一预算口径（1000 行 vs 现有 24k token 上限，只能留一个，另一个显式退役）。

**❌2 步骤 3「涉及文件」缺 `rightPanelTabs` 的两个必改消费方**
- 问题：把 `rightPanelTabs` 从扁平数组改成 per-session map，属于数据模型变更，但清单只列了 `ui-store.ts`、`ui-store-tab-slice.ts`、`right-panel-tab-factories.ts`、`session-slice.ts`、`RightPanel.tsx`、`RightPanelHeader.tsx`，漏掉两个直接读写该字段的位置，按清单实施无法编译通过。
- 证据：`src/renderer/src/stores/preview-panel-slice.ts:56,72-81,139-150,168-196`（`openFilePreview` 写入/移除右侧 preview tab，共 12 处引用）；`src/renderer/src/components/layout/SubAgentsPanel.tsx:243,245,310,319`（`useUIStore(s => s.rightPanelTabs)` 后按 `activeSessionId` 找 overview tab）。
- 修正建议：在「涉及文件·修改（前端）」补上这两个文件；并在步骤 3 正文点名「preview tab 双栈（`ui-store.ts:103-118` `closeRightPanelTab` → `closePreviewTab`）在 per-session 模型下的关闭语义」与「`rightPanelActiveTabId` 一并会话化」两个子任务。

**❌3 步骤 3 把 `activeScopedSessionId` 误标为死代码并要求删除**
- 问题：步骤 3「顺手处理死代码：`syncSessionScopedState` / `activeScopedSessionId`（`:324-327`）若被本方案取代则一并删除」。`syncSessionScopedState` 确实零调用，但 `activeScopedSessionId` 是**当前面板/浏览器会话作用域的主锚点**，删除会直接破坏多处逻辑。
- 证据：`src/renderer/src/stores/ui-store.ts:324`（字段定义）、`ui-store-interface.ts:233-235`（类型声明）；消费方 `components/layout/RightPanel.tsx:36,39,46,48`（`panelSessionId`、activeProjectId、memoryProject 全部以它为优先）、`components/layout/SessionChangeReviewPanel.tsx:30,32`、`stores/browser-session-helpers.ts:123,137,151,211,271`、`stores/ui-store-tab-slice.ts:38`。
- 修正建议：把该行改为「仅删除 `syncSessionScopedState`（零调用）；`activeScopedSessionId` 保留，并在 per-session map 方案中明确它与 `activeSessionId` 的优先级是否沿用」。若新方案要取代它，必须逐条列出上述 6 个文件的迁移方式。

**❌4 步骤 3 引用了不存在的 store API `addRightPanelTab`**
- 问题：步骤 3「保持对外 selector 兼容：… `addRightPanelTab` / `closeRightPanelTab` / `setRightPanelActiveTab` 写入当前会话作用域」。`addRightPanelTab` 全仓零命中，按它来定义「兼容性验收」无从落地。
- 证据：`grep -rn "addRightPanelTab" src/renderer/src` 无结果；真实写入方为 `stores/ui-store-tab-slice.ts:14 ensureActivityTab / :34 ensureSubAgentTab / :79 openGoalPanel / :115 ensureTerminalTab / :135 ensureFilesTab / :158 ensureSummaryTab`、`stores/preview-panel-slice.ts:199 openFilePreview`，关闭/激活为 `stores/ui-store.ts:84 setRightPanelActiveTab / :103 closeRightPanelTab / :120 removeRightPanelTabsForSession`（接口声明 `ui-store-interface.ts:60-64,274-275`）。
- 修正建议：把 `addRightPanelTab` 替换为上面这份真实名单，并特别标注 `ensureActivityTab`/`ensureTerminalTab` **不接收 sessionId 参数且 tabId 为固定常量**（`'activity'`/`'terminal'`/`'files'`/`'summary'`，见 `ui-store-tab-slice.ts:21,122,142,168`），会话化后这些固定 id 的归属与去重口径要写清。

**❌5 步骤 2 验证点⑤ 的复用位置不存在，且 `TodoCard.tsx` 换后成孤儿无处置口径**
- 问题：验收⑤ 要检查一个不存在的复用点；同时步骤 2 只写了「`TodoCard.tsx` 若仅剩消息流用途则在文件头注释其职责边界」，而实际换完后它连「消息流用途」都没有。
- 证据：`components/chat/ToolCallCard/index.tsx` grep `TodoCard|TodoStatusList` 零命中，`:155-166` 是 `name === 'TaskList'` 时把结构化输出压成 header 摘要（`:166` = `}, [name, outputText, summary, t])`），消息流的 Todo 展示走的是通用工具输出路径，与 `TodoCard.tsx` 无关；`TodoStatusList`（`chat/TodoCard.tsx:345`）唯一消费者 `InputArea/session-todo-status-list.tsx:23`；`TaskCard`（`chat/TodoCard.tsx:164`）全仓零消费者。
- 修正建议：⑤ 改为「消息流的 `TaskList` 工具结果卡（`ToolCallCard/index.tsx:155-166`）不受影响」；并新增一条明确决策：步骤 2 落地后 `TodoCard.tsx`（466 行）与 `session-todo-status-list.tsx` 是删除、还是保留 `TodoStatusList` 供别处使用。按 AGENTS.md「不留半套机制」的口径，应显式退役死代码。

**❌6 步骤 2 的移植取舍建立在不实事实上，砍掉了可用的变更审查能力**
- 问题：步骤 2「取舍：OpenCowork 的 `useAggregatedChangeSummaries` 变更审查按钮不移植（本仓无 `change-summary-utils`）」，探索 §三 同样断言「本仓不存在」。事实是本仓有同名 hook 与同名工具文件，且已被两处组件使用，此外还多一个比参考更好用的 `latestDisplayableRunChangeSet`。
- 证据：`src/renderer/src/components/chat/change-summary-utils.ts:157 export function useAggregatedChangeSummaries`；消费者 `components/chat/ChangeReviewSheet.tsx:10,31`、`components/chat/RunChangeReviewCard.tsx:21,163`；`components/chat/file-change-utils.ts:207 aggregateDisplayableRunFileChanges`、`:213 latestDisplayableRunChangeSet`；`stores/agent-store/slices/run-changes-slice.ts`（`runChangesByRunId`）、`ui-store.ts:202 openDetailPanel` 均在。
- 修正建议：要么按老大「直接抄成熟组件」的原意把变更审查按钮一并移植（依赖已齐），要么在计划里给出**真实**的不移植理由（如与右侧面板 Review tab 功能重复），不能以「本仓没有」为由静默缩水。

**❌7 步骤 7 的分类口径与代码实际不符，且可能需要 Core 层改动却未列文件**
- 问题：步骤 7 要求「分类口径必须与 `ToolRegistry.cs:25-41` 一致：file / search / shell / task / memory / plan / capability（+ 未知兜底类）」。但 `CategoryPriorities` 只登记了 7 类，实际注册工具携带 24 种 `Category`，其余 17 种全部落到 unknown=100。用这个口径写「逐分类说明清单」，等于给多数工具写不出说明；验证②「与 `tool/list` 实际返回 category/priority 打印比对」必然失败。
- 证据：`src/runtime/WishfulClaw.Core/Tools/ToolRegistry.cs:25-34`（仅 7 项）、`:36-41`（未知返回 100）、`:185-192`（按 Priority→名称排序）；provider 分类实测：`Tools/Providers/` 下 `notify`、`browser`、`channel-plugin`、`ask-user`、`code-compatible`、`codegraph`、`cron`、`desktop`、`global-dispatch-reply`、`global-task`、`goal`、`image-generate`、`notebook`、`project`、`skill-management`、`plugin`、`skill`、`ssh`、`team`、`web`、`widget` 等（`public string Category =>` 24 处命中）；`tool/list` 出口在 `Agent/Tools/ToolModule.cs:80`。
- 修正建议：步骤 7 先做一次口径决策 —— (a) 扩 `CategoryPriorities` 把真实分类纳入（则 `WishfulClaw.Core/Tools/ToolRegistry.cs` 必须进「涉及文件·修改（C#）」，Core 层改动需在计划里显式声明），Prompt 按分类组（检索类 / 执行类 / 协作类 / 外设类 / 发现类）概括而非逐类枚举；或 (b) 明确只说明有优先级的 7 类，并把验证② 改为「7 类逐条比对 + 其余归入发现类说明」，否则该检查点无法判定通过。

**❌8 I24-17（`InputArea/index.tsx` 510 行）既未纳入步骤也未列入「不做」，与探索和 AGENTS.md 三重冲突**
- 问题：AGENTS.md「超过 500 行必须拆分」；该文件实测 510 行；探索 §五 判定「与步骤 2 同期顺手收（Todo 挂载点在此文件）」；步骤 2 正是在该文件替换 Todo 挂载（`:335-339`），会使其更长；计划「本批次不做」抄了探索 §五 的其余 4 条却漏了这一条。
- 证据：`wc -l src/renderer/src/components/chat/InputArea/index.tsx` = 510；挂载点 `:331-339`；同目录已按职责拆出 20+ 个 hook/子组件（`use-composer-*.ts`、`composer-*.tsx`），拆分范式现成。
- 修正建议：二选一 —— 步骤 2 顺带把新增面板的挂载与选择器逻辑继续外提到 `session-todo-status-list.tsx` 或新 `use-composer-todo-panel.ts`，使 `index.tsx` 回落到 500 行以下并写进验证检查点；或把 I24-17 明确补进「本批次不做」并说明为什么这次不收。

---

## 三、⚠️ 建议项

**⚠️1 步骤 1 第 3 条改动的真实落点未列，判据不客观**
- 问题：`replaceChildren` 不在 `FileAwareEditor.tsx`，在 `renderDocument` 内部；「差异为 IME 尾字符」无代码可判定定义。
- 证据：`src/renderer/src/components/chat/file-aware-editor-utils.ts:221 root.replaceChildren()`；`FileAwareEditor.tsx:218-229`（`parseDomToDocument` → `isSameDocument` → `renderDocument`）。
- 建议：把 `file-aware-editor-utils.ts` 补进涉及文件；把守卫条件改成可判定形式，例如「DOM 文本以 state 文本为前缀且多出 ≤2 个字符」或「composition 后一帧内 DOM 长度 > state 长度」，并在检查点里写明该阈值。

**⚠️2 步骤 1 把自创改动归为「对齐参考实现」**
- 问题：`pendingUserInputRef.current = false` 并非 OpenCowork `:794` 的行为，写成「对齐」会误导后续维护者去参考仓核。
- 证据：OpenCowork `src/renderer/src/components/chat/FileAwareEditor.tsx:792-796` onBlur 仅含 `focusedRef` 与 `isComposingRef` 两行。
- 建议：标注为「本仓额外加固（参考实现仅复位 isComposingRef）」，并在检查点里补一条「切窗回来后立即发送，正文不应带未提交的半截拼音」。

**⚠️3 「涉及文件」的 MessageList 系文件目录归属有歧义**
- 问题：`MessageList.tsx`、`TranscriptMessageList.tsx` 被写在 `MessageList/` 目录项之后，按目录拼接得到的路径不存在。
- 证据：实际 `src/renderer/src/components/chat/MessageList.tsx`、`src/renderer/src/components/chat/TranscriptMessageList.tsx`；`MessageList/` 目录内为 `MessageRow.tsx`/`StaticMessageTranscript.tsx` 等。
- 建议：三条都写全路径。

**⚠️4 步骤 6 的 meta 类型名写错**
- 问题：称写 `UserMessageMeta.selectedFileReads`；`UserMessageMeta` 全仓不存在。
- 证据：`src/renderer/src/lib/api/types.ts:358 export interface MessageMeta {`、`:361 selectedFileReads?: SelectedFileReadsMeta`；消费方 `components/chat/UserMessage.tsx:340`。
- 建议：改为 `MessageMeta.selectedFileReads`（types.ts:358/361）。

**⚠️5 步骤 6 未定义注入落点与「request-only」约束，且未处理三条 selectedFiles 来源**
- 建议：正文补一句「注入只进本轮出站请求，不写入持久化的用户消息正文（对齐 OpenCowork `turnRequestContextTexts`，本仓对应 `dynamic-context.ts:24 buildRuntimeReminder`）」；并明确 `ui-store.ts:304 selectedFiles`（无写入方，死字段）、composer `SelectedFileItem[]`（`use-composer-editor.ts:25`，`use-chat-actions.ts:778` 已随请求传出）、`<select-file>` 文本标签三者的去重规则，检查点加一条「同一文件既不 attachment 又内联标记时只注入一次」。

**⚠️6 步骤 6 IPC 返回 shape 变更的连带改动未列**
- 建议：补 `lib/ipc/channels.ts:25,383`、`lib/ipc/messagepack-channel-routing.ts:28,143` 到涉及文件；并记录一个有利事实——`fs:read-text-file-lines` 与 `ssh:fs:read-text-file-lines` 当前**渲染侧零调用**（仅声明与注册），改契约无存量回归面，可放心改成 `{ content, lineCount, truncated }`。

**⚠️7 步骤 3 未交代 `rightPanelActiveTabId` 与 preview 双栈的会话化细节**
- 证据：`ui-store.ts:83`（全局 `rightPanelActiveTabId: ''`）、`:84-102`（激活 preview tab 时联动 `activePreviewPanelTabId`/`previewPanelState`/`previewPanelOpen`）、`:103-118`（关闭最后一个 tab 会连带 `rightPanelOpen:false`）。
- 建议：把「activeTabId 一并进 per-session 记录」和「关闭所有/关闭其他时 preview tab 走 `closePreviewTab` 还是走 map 清空」写实，否则验收②「activeTab 完整还原」与验收⑤「不重复追加」都不稳。

**⚠️8 步骤 2 未表态全局会话与任务状态覆盖**
- 证据：`InputArea/session-todo-status-list.tsx:21` 现要求 `projectScoped` 才渲染；`blocked`/`in_review` 实际定义在 `stores/task-store.ts:13`（并非计划所引的 `task-store-helpers.ts`，该文件 `:11` 是更宽的 `'pending'|'in_progress'|'completed'|string`），`chat/TodoCard.tsx:16-17,49-51` 已有对应图标。
- 建议：明确「全局会话是否显示 Todo」；把「按 `task-store-helpers.ts` 实际字段裁剪」改为「按 `stores/task-store.ts:13` 的 5 态全集保留 blocked/in_review」，避免无谓降配。

**⚠️9 步骤 7 验证③ 的「字符预算」不成立**
- 证据：`Persona/PromptBuilder.cs:24,144-176`（预算仅作用 persona 文档）、`:188,221-222`（memory 段 6000）。
- 建议：改为可测指标，例如「`BuildToolCapability` 返回值 UTF-8 长度增量 ≤ N 字符，并在 `tool/list` 与 system prompt 日志中打印前后长度」，或直接引入段级预算常量。

**⚠️10 步骤 4 的右键实现口径需按本仓范式写实**
- 证据：Radix 范式为 `<ContextMenu><ContextMenuTrigger asChild>`（`components/cowork/tree-item.tsx:222`、`components/chat/GitPage/ScmSidebar.tsx:239`），而 `RightPanelHeader.tsx:66-150` 的 `TabButton` 本体已是 `<button>`，裸 `onContextMenu` 不会拉起 Radix 菜单，直接包 trigger 又会造成 button 嵌 button。
- 建议：正文写明用 `ContextMenuTrigger asChild` 包裹既有 button，并补一条「Goal tab 装配口径」：步骤 4 移除的是 `RightPanelHeader.tsx:214-217` 菜单项与 `RightPanel.tsx:228` 的 `onAddGoals` 装配，需同时确认 Goal 仍可由聊天窗触发（`ui-store-tab-slice.ts:79 openGoalPanel`）。

**⚠️11 步骤 8 未列压缩/快照交互与规划态文档提交**
- 建议：步骤 8 增加两条：①「手动压缩 → 恢复后首轮带 `<selected_files>` 的行为实测」；②按 dev-workflow 阶段二/三补齐 Git 操作 —— 目前 `docs/plans/iter-v2-24/plan-issues-batch-2/` 仍是 untracked，规划文档与本报告的 `docs(plan)` commit 与 PROGRESS.md 更新未纳入步骤清单（AGENTS.md「迭代完结收尾」的版本号 0.2.24 提升也属迭代收尾而非本批，建议在计划中注明归属，避免与步骤 8 混淆）。

---

## 四、行号抽查表

| 引用位置 | 声明内容 | 实际内容 | 判定 |
|---|---|---|---|
| `FileAwareEditor.tsx:323-334` | compositionend 同帧提交→解除挡板→bump 版本 | `compositionEndRafRef.current = requestAnimationFrame(() => { syncLiveContent(); flushDocumentSync(); scheduleSelectionSync(); isComposingRef=false; pendingUserInputRef=false; … bumpCompositionRenderVersion() })` | ✅ 吻合 |
| `FileAwareEditor.tsx:413-416` | onBlur 不复位挡板 | `onBlur={() => { focusedRef.current = false; onBlur?.() }}` | ✅ 吻合 |
| `FileAwareEditor.tsx:220-235` | 布局 effect | useLayoutEffect 实际跨 `:205-236`（挡板早退在 `:209-216`，`shouldRender` 在 `:220`） | ⚠️ 区间偏小 |
| `TodoCard.tsx:390` | 容器 className（无 max-h/overflow） | `<div className={cn(embedded ? 'min-w-0 space-y-0.5' : 'my-5 min-w-0', className)}>` | ✅ 逐字吻合 |
| `TodoCard.tsx:68` | COLLAPSED_VISIBLE_RECENT_TASK_COUNT=3 | 同行 | ✅ 吻合 |
| `ui-store.ts:82-83` | tabs 为全局扁平列表 | `rightPanelTabs: getDefaultRightPanelTabs(),` / `rightPanelActiveTabId: '',` | ✅ 吻合 |
| `ui-store.ts:214-227` | per-session map 范式（含 planModesBySession/browserStatesBySession） | 区间仅 `bottomTerminalDockOpenBySessionId`；`planModesBySession:274`、`browserStatesBySession:281` 在区间外 | ⚠️ 命名对、区间不覆盖 |
| `ui-store.ts:120-133` | removeRightPanelTabsForSession | 同行起 | ✅ 吻合 |
| `ui-store.ts:324-327` | syncSessionScopedState / activeScopedSessionId 死代码 | `:324 activeScopedSessionId: null`、`:326 syncSessionScopedState`（零调用）；但 activeScopedSessionId 有 6 文件消费 | ❌ 判定错误（见 ❌3） |
| `RightPanel.tsx:62-63` | visibleTabs 不按 session 过滤 | `const tabs = useMemo(() => { const visibleTabs = rightPanelTabs` | ✅ 吻合 |
| `RightPanel.tsx:228` | Goals 装配 | `onAddGoals={() => useUIStore.getState().openGoalPanel(panelSessionId, activeProjectId)}` | ✅ 吻合 |
| `RightPanelHeader.tsx:214-217` | 「+」菜单 Goals 项 | `<DropdownMenuItem onSelect={onAddGoals}>` → `<Target/>` → `t('rightPanel.goals')` → `</DropdownMenuItem>` | ✅ 逐字吻合 |
| `RightPanelHeader.tsx:225-233` | 关闭右侧面板按钮 | `<Button … onClick={onClosePanel} title={t('rightPanelAction.closePanel')}> <PanelRightClose/> </Button>` | ✅ 吻合 |
| `RightPanelHeader.tsx:66-150` | TabButton 无 onContextMenu | `function TabButton({` 起 `:66`，闭合 `:150`，无右键处理 | ✅ 吻合 |
| `VirtualListContent.tsx:110` | 滚动容器仅 pl-7 md:pl-9 | `className="absolute inset-0 overflow-y-auto pl-7 md:pl-9"` | ✅ 逐字吻合 |
| `MessageList.tsx:92` | exportAll 分支容器 | `chat/MessageList.tsx:92 <div ref={scroll.containerRef} className="relative h-full flex-1" data-message-list>` | ✅ 行号对（路径见 ⚠️3） |
| `TranscriptMessageList.tsx:126` | 静态视图滚动容器 | `className={cn('not-prose h-[min(60vh,40rem)] min-h-[20rem] overflow-y-auto', className)}` | ✅ 吻合 |
| `MessageList/MessageRow.tsx:50` | 仅 pb-7 | `className={… pb-7 transition-colors …}` | ✅ 吻合 |
| `useMessageListScroll.ts:229-246` | virtualizer 未设 paddingStart | `useVirtualizer({ count… estimateSize… overscan… rangeExtractor… getItemKey… })`，无 paddingStart | ✅ 吻合 |
| `useMessageListScroll.ts:122-137` | scrollToBottomImmediate | `const scrollToBottomImmediate = React.useCallback(` 起 `:122` | ✅ 吻合 |
| `session-slice.ts:189-203` | setActiveSession 不重置面板 | `setActiveSession: (id) => { set({ activeSessionId: id }); …loadTasksForSession… }`，无 rightPanel 相关 | ✅ 吻合 |
| `SessionConversationPane.tsx:121,128` | ensureFilesTab / ensureSummaryTab | `:121 ensureFilesTab(resolvedSessionId)`、`:128 useUIStore.getState().ensureSummaryTab(resolvedSessionId)` | ✅ 吻合 |
| `fs-handlers.ts:154` | 全量 readFile 无行限 | `:154 'fs:read-text-file-lines',` → `:157 await fs.promises.readFile(args.path,'utf-8')` 直接 return | ✅ 吻合 |
| `ssh-fs-handlers.ts:87` | SSH 同名通道 | `:87 'ssh:fs:read-text-file-lines',` → `sftp.readFile(...)` 全量 | ✅ 吻合 |
| `select-file-tags.ts:159 / :141` | parseSelectFileText / createSelectFileTag | 两处同行 | ✅ 吻合 |
| `lib/api/types.ts:331,344,361` | SelectedFileReadItemMeta / SelectedFileReadsMeta / UserMessageMeta.selectedFileReads | 行号全对；`:358` 接口名为 `MessageMeta`（`UserMessageMeta` 不存在） | ⚠️ 行号✅ 名称❌（见 ⚠️4） |
| `user-message-views.tsx:40-68` | 六态文案已就位 | `:40` 标题 key，`:46-68` skipped/pdf/非文本/failed/truncated/lines 全分支 | ✅ 吻合 |
| `ToolCallCard/index.tsx:166` | 复用 TodoCard 供消息流渲染 | 该行是 useMemo 依赖数组；全文件零命中 TodoCard/TodoStatusList | ❌ 不成立（见 ❌5） |
| `InputArea/composer-flyovers.tsx:56,63` | 悬浮范式 + 限高先例 | `:56 "composer-flyout absolute inset-x-0 bottom-full z-30 …"`、`:63 "max-h-64 overflow-y-auto p-1"` | ✅ 逐字吻合 |
| `InputArea/session-todo-status-list.tsx:19-21` | 数据源 | `useTaskStore((s) => draftSessionId ? s.getTasksBySession(draftSessionId) : EMPTY_TASKS)` + `if (!projectScoped …) return null` | ✅ 吻合 |
| `Persona/PromptBuilder.cs:235-247` | `<tool_calling>` 段 | `:235 private static string BuildToolCapability` / `:238 <tool_calling>` / `:245 </tool_calling>` | ✅ 吻合 |
| `PromptBuilder.cs:240-241` | 已有 use_capability list→call 引导 | `:240` list→call 全句、`:241` 「Use the proxy when…」 | ✅ 吻合 |
| `Core/Tools/ToolRegistry.cs:25-41` | 7 类优先级 + 未知兜底 | `CategoryPriorities` `:25-34`、`GetCategoryPriority` 默认 100 `:36-41` | ✅ 行号对，口径不覆盖真实分类（见 ❌7） |
| `ToolRegistry.cs:185-192 / :21,128-129` | Priority→名称排序、定义缓存 | `:186-192 list.Sort(byPriority…then name)`、`:21 _cachedDefinitions`、`:128-129` 缓存早返回 | ✅ 吻合 |
| OpenCowork `cowork/StepsPanel.tsx:328,371,373-402,433-443,444` | InlineStepsPanelCard 收起/样式/动画/限高 | 逐一命中；`isComposingRef` 无关，但需注意 `:485 InlineStepsPanel` 才是数据装配层 | ✅ 全部命中 |
| OpenCowork `use-chat-actions.ts:594,848-953,595-606,940-949,4406-4413` | 1000 行上限 / 读取编排 / 屏蔽扩展名 / reminder 拼装 / 调用点 | `:594 SELECTED_FILE_READ_MAX_LINES = 1_000`、`:848 buildSelectedFileReadContext`（至 `:953`）、`:595` BLOCKED_EXTENSIONS、`:940-949` system-reminder 数组、`:4406-4413` 调用并 push 进 `turnRequestContextTexts` | ✅ 全部命中 |
| OpenCowork `chat/FileAwareEditor.tsx:794 / :736-752` | onBlur 复位挡板 / compositionend 同步 flush | `:792-796 onBlur { focusedRef=false; isComposingRef=false; onBlur?.() }`（**无 pendingUserInputRef**）、`:736-752` 确为同步 flush | ✅ 命中（归因见 ⚠️2） |
| OpenCowork `InputArea.tsx:4258` | 挂载层级一致 | `components/chat/InputArea.tsx:4258 {projectScoped && draftSessionId && <InlineStepsPanel sessionId={draftSessionId} />}` | ✅ 命中（路径应写全 `chat/`） |
| 本仓 `task-store-helpers.ts:4-18` vs OpenCowork `task-store.ts:15-29` | TaskItem 字段两侧一致 | 字段集合一致（含 planId/sessionId/activeForm）；本仓 `status` 更宽 | ✅ 吻合 |
| 本仓「无 change-summary-utils / useAggregatedChangeSummaries」 | 移植取舍依据 | `chat/change-summary-utils.ts:157` 存在且被 `ChangeReviewSheet.tsx:31`、`RunChangeReviewCard.tsx:163` 使用 | ❌ 不成立（见 ❌6） |

---

### 结论

计划的问题清单、步骤划分、验证检查点形式与提交节奏（一步一 commit、只 commit 不 push、VERDICT 归用户）都符合 dev-workflow 与 AGENTS.md，抽查的 file:line 命中率也很高；但**三处事实性错误（既有 dynamic-context 实现、`activeScopedSessionId` 死代码判定、`change-summary-utils` 不存在）+ 两处 API/文件清单不实（`addRightPanelTab`、preview-panel-slice/SubAgentsPanel 缺列）+ 一处验收指向不存在的代码 + 一处范围矛盾（I24-17）**共 8 项 ❌ 未清，按 dev-workflow 阶段三阻断规则（❌ 项 > 0 禁止进入用户确认环节）**不得进入执行态**。修正集中在步骤 2、3、6、7 四段与「涉及文件」「本批次不做」两处清单，不影响本批 7 条目的整体取舍。

---
---

# 第二轮验证（第 2 版计划）

**核查时间**：2026-09-05　**核查基线**：`dev/v2-iter-24` @ `577712b`（与首轮同基线，工作区仅 `docs/plans/iter-v2-24/plan-issues-batch-2/` untracked，行号可直接对上执行时代码）
**复审对象**：`plan.md` 第 2 版、`exploration_findings.md` 第 2 版
**本章为唯一写操作，未改动任何代码或其它文档**

**总判定：FAIL** ｜ 第 1 轮 8 项 ❌ **全部已真正修正** ｜ 本轮新增 ❌ 3 项 / ⚠️ 13 项

- 第 2 版的事实修正质量很高：本轮对首轮 8 项逐条回代码复核，**无一项是「改文字不改事实」**；二·4 的 36 行 file:line / 路径抽查中 30 行完全吻合，不吻合处已逐项落到 ❌/⚠️。
- 判 FAIL 的原因是修正过程中暴露/引入了 3 个新的阻断项：**变更审查按钮在本仓没有可落地出口（❌9）**、**「涉及文件」仍含不存在的路径（❌10）**、**步骤 6b 缺 `[自动]` 门禁、按本计划自订规则无法判 `[✓]`（❌11）**。三项都是局部改动，不涉及本批 7 条目的取舍与步骤划分。

## 二·1 第 1 轮 ❌ 复核表

| # | 首轮 ❌ | 是否已修正 | 回代码证据 |
|---|---|---|---|
| ❌1 | 步骤 6 未识别 `dynamic-context.ts` 零调用实现，存在双实现风险 | ✅ 已修正（残留 ⚠️12） | 步骤 6a 明确「新建 `lib/agent/selected-file-context.ts`，迁移 `dynamic-context.ts:185-252 buildSelectedFileContext`（含 `resolveFileContextBudget`/`truncateToTokenBudget`/SSH 分支/skipped/displayPath）」——实测函数体正是 `185-252`（185 `async function buildSelectedFileContext(`、252 `}`），预算常量 `:16-18`、SSH 分支 `:203-206`、unreadable `:207-210`、`<selected_files>` 拼装 `:243-250` 全部点名；`buildRuntimeReminder`（`:24`）确为零调用（全仓仅定义 + `lib/tools/codegraph-tool.ts:12` 注释）；`dynamic-context.ts` 已进「涉及文件·修改」，其余部分列入「本批次不做」的死代码清理批 → 无双实现口径 |
| ❌2 | 步骤 3 缺 tab 状态必改方 | ✅ 已修正 | 步骤 3 第 57 行与「涉及文件」第 148 行均补入 `stores/preview-panel-slice.ts`、`components/layout/SubAgentsPanel.tsx`；实测 `rightPanelTabs`/`rightPanelActiveTabId` 引用数 `RightPanel.tsx` 4 / `SubAgentsPanel.tsx` 6 / `preview-panel-slice.ts` 16 / `ui-store-interface.ts` 2 / `ui-store-tab-slice.ts` 28 / `ui-store.ts` 19，与探索 §四第 69 行声明**逐一吻合** |
| ❌3 | 误把 `activeScopedSessionId` 当死代码删除 | ✅ 已修正 | 「删除」表述已消失，改为「接管悬空的作用域锚点」：`setActiveSession`（实测 `session-slice.ts:189-203`，确不触碰面板）内调 `syncSessionScopedState`（实测 `ui-store.ts:326-327`，签名 `(sessionId, projectId)`、赋值 `activeScopedSessionId/activeScopedProjectId`，全仓除接口声明 `ui-store-interface.ts:235` 外**零调用**）；消费方实测 `RightPanel.tsx:36,39,46,48`、`SessionChangeReviewPanel.tsx:30,32`、`browser-session-helpers.ts:123,137,211,271`、`ui-store-tab-slice.ts:38` 与计划列举一致 |
| ❌4 | 引用不存在的 `addRightPanelTab` | ✅ 已修正 | 全仓 grep `addRightPanelTab` 仍为 0 命中，两份文档已不含该词；改为真实名单，实测 `ui-store-tab-slice.ts` `ensureActivityTab:14`/`ensureSubAgentTab:34`/`openSubAgentsPanel:76`/`openGoalPanel:79`/`ensureTerminalTab:115`/`ensureFilesTab:135`/`ensureSummaryTab:158` + `right-panel-tab-factories.ts:9 ensureRightPanelTabs` 全部存在；固定 id `activity:21`/`terminal:122`/`files:142`/`summary:168` 的归属口径已在步骤 3 第 56 行写明（漏 `ensureBrowserTab` → ⚠️13） |
| ❌5 | 步骤 2 验收指向不存在的 ToolCallCard 复用；`TodoCard.tsx` 孤儿无处置 | ✅ 已修正（残留 ⚠️16） | 步骤 2 已不含任何 ToolCallCard 复用表述；2b 明确「删除 `TodoCard.tsx`（466 行）」并给实证——实测 importer 只有 `InputArea/session-todo-status-list.tsx:2`，`TaskCard`（`TodoCard.tsx:164`）与 `TodoStatusList`（`:345`）为仅有的两个导出，前者全仓零消费者；`session-todo-status-list.tsx` 的「若无剩余职责则一并删除」也写了；`[自动]` 加了「grep 无残留引用」判据 |
| ❌6 | 「本仓无 change-summary-utils」失真 | ✅ 已修正 → 但引出 ❌9 | 探索 §二第 37 行与步骤 2a 第 37 行均改述为「本仓已有 `change-summary-utils.ts:157 useAggregatedChangeSummaries`」——实测签名 `useAggregatedChangeSummaries(changes: AggregatedFileChange[])`、行号正确，`ChangeReviewSheet.tsx:31`、`RunChangeReviewCard.tsx:21` 确在 import；参考侧卡片亦确有审查按钮（`StepsPanel.tsx:404-427`）→ 前提已摆正。但「照搬移植」在本仓落不了地，见 ❌9 |
| ❌7 | 步骤 7 分类口径不覆盖真实分类；Core 改动未列；单一来源方案未证 | ✅ 已修正（残留 ⚠️19/20/21） | 实测 `grep 'Category =>' WishfulClaw.Agent` = **23 处**，集合为 ask-user/browser/capability/channel-plugin/code-compatible/codegraph/cron/desktop/global-dispatch-reply/global-task/goal/image-generate/notebook/plan/plugin/project/skill/skill-management/ssh/task/team/web/widget，与探索 §五第 77 行列举**逐项一致**；直接执行器分类实测 `file/search/shell/task/memory`（`ToolModule.cs` 内 `RegisterDirectExecutors`）；`Core/Tools/ToolRegistry.cs` 已进「涉及文件·修改（C#）」，新建 `Core/Tools/ToolCategoryCatalog.cs` 已进「新建」；单一来源成立性已核：`WishfulClaw.Persona.csproj:11` 确实 `ProjectReference` 了 `WishfulClaw.Core`，与 AGENTS.md 第 5 层依赖（Persona 依赖 Contracts+Core+Workspace）一致，方向合法；`<tool_calling>` 段实测 `PromptBuilder.cs:235-247`、`:240-241` use_capability 引导行号准确 |
| ❌8 | I24-17（InputArea 510 行）静默丢弃 | ✅ 已修正（缺判据 → ⚠️15） | 实测 `wc -l src/renderer/src/components/chat/InputArea/index.tsx` = **510**；步骤 2b 明确「挂载点 `:335-339` 换为新面板，并把本步新增逻辑外移使文件回到 500 行内（顺带关闭遗留项 I24-17）」——挂载点实测 335 `<SessionTodoStatusList` 至 339 `/>`，**行号精确**；不再靠「本批次不做」漏项 |

## 二·2 新增 ❌ 阻断项（3）

**❌9 步骤 2a「变更审查按钮照搬移植」在本仓没有可落地出口，验收指向从未被渲染的组件（断头路）**
- 问题：验收写「审查按钮打开 `ChangeReviewSheet` 行为与消息流卡片一致」。实测这条链在本仓是断的，三处同时无出口。
- 证据：
  - `src/renderer/src/components/chat/ChangeReviewSheet.tsx` 与 `RunChangeReviewCard.tsx` **全仓零 importer**（`grep -rn "ChangeReviewSheet\|RunChangeReviewCard" src/ tests/` 除自身文件外 0 命中）→ 二者同为孤儿组件，不存在「打开 ChangeReviewSheet」的现成路径。
  - 参考实现的动作是 `OpenCowork StepsPanel.tsx:351-357` → `openDetailPanel({ type:'change-review', runId })`；本仓类型分支存在（`stores/ui-types.ts:114`），但 `detailPanelOpen`/`detailPanelContent` 在整个 `src/` 下**没有任何渲染消费方**（仅 `stores/ui-store.ts:200-203` 写入 + `ui-store-interface.ts:125-128` 声明）→ 本仓唯一活着的消息流变更卡 `SessionChangeSummaryCard.tsx:151`（由 `MessageList/MessageRow.tsx:78` 渲染）点的就是这个空出口。「与消息流卡片一致」= 与一个点击无响应的按钮一致。
  - 右侧面板虽有 review 渲染分支（`RightPanel.tsx:185`）与图标（`RightPanelHeader.tsx:53`），但 `kind: 'review'` 的 tab 全仓**无创建方**（`grep "kind: 'review'"` 0 命中）。
- 修正建议（二选一，写实进步骤 2a）：(a) 按钮改为打开当前会话的右侧 Review tab，同时补 `ui-store-tab-slice.ts` 的 review tab 创建 API 并把它加进「涉及文件」，验收改为「点击后面板切到 Review tab 且会话正确」；(b) 本批只做参考卡片的 `+/- 行数摘要芯片`（`StepsPanel.tsx:404-421`，纯展示、无需出口），按钮明确不做，验收改为「增删行数与实际变更一致」。当前写法违反 AGENTS.md「迭代交付标准：有反馈、有闭环」。

**❌10 「涉及文件·修改（前端）」步骤 5 条目含不存在的路径（首轮 ⚠️3 要求写全路径，改写后仍错）**
- 问题：计划第 150 行写 `components/chat/MessageList/MessageList.tsx`。该路径不存在。
- 证据：`ls src/renderer/src/components/chat/MessageList/` 只有 `AssistantReplyRail.tsx`、`EmptyState.tsx`、`ExportView.tsx`、`MessageRow.tsx`、`StaticMessageTranscript.tsx`、`VirtualListContent.tsx`、`locator-utils.ts`、`mode-hints.tsx`、`props-equal.ts`、`scroll-utils.ts`、`useMessageListData.ts`、`useMessageListScroll.ts`、`utils.ts`。真实文件是 `src/renderer/src/components/chat/MessageList.tsx`（正文引用的 `:92` = `<div ref={scroll.containerRef} className="relative h-full flex-1" data-message-list>` 行号正确）。同条目末项 `TranscriptMessageList.tsx` 未带目录，按前缀拼接得到 `MessageList/TranscriptMessageList.tsx` 同样不存在（真实为 `chat/TranscriptMessageList.tsx`，`:126` 正确）。
- 修正建议：步骤 5 四条全部写成从 `src/renderer/src/` 起的全路径；`VirtualListContent.tsx` 与 `useMessageListScroll.ts` 确在 `MessageList/` 下，其余两条不在。

**❌11 步骤 6b 缺 `[自动]` 验证点，按本计划自订规则无法判 `[✓]`**
- 问题：计划第 14 行图例「两类都过才打 `[✓]`」，但步骤 6b（第 102-111 行）的验证段只有 4 条 `[人工]`，没有 `[自动]`。
- 证据：6b 涉及 `lib/api/types.ts` meta 消费与发送装配，属编译面改动；「提交节奏」（第 168 行）明确「步骤 2 与 6 各含 a/b 两个子提交」→ 6b 是独立 commit，却没有编译门禁，与 AGENTS.md「每次写完代码必须确保零报错（三套 tsc 缺一不可）」冲突。其余 9 个步骤/子步骤（1、2a、2b、3、4、5、6a、7、8）两类齐全。
- 修正建议：6b 补 `[自动]` 三套 tsc 零错误（若触动消息渲染可加 `npm run test:renderable-chat-items`）。

## 二·3 新增 ⚠️ 建议项（13）

**⚠️12 步骤 6a 迁出后，`dynamic-context.ts` 内部调用点未交代处置**：`buildRuntimeReminder` 的 `:73-83` 仍在调 `buildSelectedFileContext`。若按计划「迁出」删除原函数，此处立即 tsc 报错；若改为 import 新模块，则新模块签名（返回结构化结果）与该处字符串用法不匹配，等于留下第二条路径。步骤 6a 只写了「不复活 `buildRuntimeReminder` 整体」，需补一句「同时删除 `:73-83` selected_files 分支（连带 `:38` 永空数组读取与 `:16-18` 预算常量去留）」。

**⚠️13 步骤 3 名单与数量仍有三处不实**：(a) 「真实 tab 写入 API 名单」漏 `ensureBrowserTab`——它不在 tab-slice 而在 `stores/ui-store.ts:410` 定义、`stores/ui-store-browser-slice.ts:32` 调用、`ui-store-interface.ts:255` 声明，而 browser tab 是带 sessionId 的动态 tab，正是会话化对象；(b) 第 55 行称「6 处既有消费方」却只列 4 个文件，建议改为「4 个消费文件（+ `ui-store-interface.ts:233` 声明）」；(c) `syncSessionScopedState(sessionId, projectId)` 的 `projectId` 取值来源未写，且 `session-slice.ts:178-180` 的注释明确要求用 `void import('@renderer/stores/ui-store')` 惰性方式规避 chat-store → ui-store 循环依赖，直接 import 调用会踩坑。

**⚠️14 `rightPanelActiveTabId` 会话化仍未写，验收②不稳定**：实测 `ui-store.ts:83` 为单一全局字段、`RightPanel.tsx:88-89` 取 `tabs.find(id === activeTabId) ?? tabs[0]`。在「按 sessionId 过滤」方案下，若用户在会话 B 点过任一 tab，切回 A 时 activeTab 无法还原，步骤 3 验收「A 的 tab 与 activeTab 完整还原」即失败。首轮 ⚠️7 提过，第 2 版未采纳；同时「preview 双栈关闭语义」（`ui-store.ts:103-118` `closeRightPanelTab` → `closePreviewTab`）也仍未在步骤 3 点名，而步骤 4 的「关闭所有/关闭其他」正依赖它。

**⚠️15 步骤 2b 的「回到 500 行内」没有判据**：验证段只有 tsc + grep + 人工，没有 `wc -l` 门禁。建议补 `[自动]` `wc -l src/renderer/src/components/chat/InputArea/index.tsx` < 500，否则 I24-17 是否关闭全凭实现者自觉。

**⚠️16 步骤 2 缺一条消息流回归点**：删除 `TodoCard.tsx` 后，消息流的 `TaskList` 结果卡摘要仍走 `ToolCallCard/index.tsx:155-166`（`name !== 'TaskList'` 早退、`t('todo.tasksDone', {completed,total})`、`:166` 为 useMemo 依赖数组），实测该文件不 import TodoCard，故不会坏——但计划应显式写一条「TaskList 工具结果卡摘要不受影响」，把首轮 ❌5 的教训落成检查点。

**⚠️17 步骤 1 三条旧建议全部未采纳**：(a) 第 21 行仍把 `pendingUserInputRef.current = false` 归为「对齐 OpenCowork `FileAwareEditor.tsx:794`」，实测参考侧 `:792-796` onBlur 只有 `focusedRef` 与 `isComposingRef` 两行，属本仓自创加固，应改标注；(b) 第 3 条改动的真实落点 `components/chat/file-aware-editor-utils.ts:221 root.replaceChildren()` 仍未进「涉及文件」；(c) 「与 state 仅差 IME 尾字符」仍无代码可判定义，建议改为「DOM 文本以 state 文本为前缀且多出 ≤2 个字符」并把这个阈值写进 `[人工]` 判据。

**⚠️18 悬浮层锚点风险未评估**：`composer-flyovers.tsx:56` 的 `absolute inset-x-0 bottom-full z-30` 生效前提是父级 `composer-shell relative`（实测 `InputArea/index.tsx:344`），而步骤 2b 指定的挂载点 `:335-339` 在该容器**之外**（`:331-333` 是 GoalSessionBar、`:340` 才开 `composerWidthClass` 容器）。照抄 class 会以更远祖先为定位锚、出现错位；同时展开态遮挡范围与 `z-30` 同弹层同层未评估。建议步骤 2a 明确「新面板自带 relative 包裹层」或改挂到 composer 内部。

**⚠️19 探索 §二「本仓无 team store」不实**：`src/renderer/src/stores/team-store.ts` 存在（10KB，`useTeamStore` 被 9 个文件消费），且 `TodoCard.tsx:173-179` 的 `TaskCard` 曾用它合并 team tasks。结论（新面板不聚合 team）无害——`TodoStatusList`（`:345`，唯一活着的导出）从不读 team store——但理由必须改写，否则文档留下假事实。顺带建议补两点：五态 tone 沿用参考映射（`StepsPanel.tsx:176 blocked`/`:178 in_review`，实测存在，故删 TodoCard 不丢状态显示）；全局会话门禁沿用现状（`session-todo-status-list.tsx:21` 要 `projectScoped`，参考侧 `InputArea.tsx:4258` 同样要，两者一致，但计划未表态）。

**⚠️20 步骤 7 未评估排序副作用与一个大小写细节**：实测 `ToolRegistry.cs:163,179` 用 `GetCategoryPriority(category)` 给定义打优先级，`:186-192` 按 Priority→名称排序且注释自陈目的是 "deterministic prefix bytes"。把约 20 个原本并列 100 的分类改到具体值，会改变 `tool/list` 名称序列 → 一次性 prefix cache 失效与模型可见顺序变化。建议加 `[自动]`「改动前后 tool/list 名称序列 diff，确认仅按预期分组变化」，并在正文写明这次缓存失效是一次性的。另 `CategoryPriorities` 用 `StringComparer.OrdinalIgnoreCase`（`:25`），新目录必须保持大小写不敏感；探索 §五把 `RegisterDirectExecutors` 写成 `ToolModule.cs:33`，实测为 `:32`。

**⚠️21 步骤 7「比对脚本或单测」缺落点与命令**：`tests/` 下有 6 个 .NET 回归工程（CompactionSnapshot/Cron/Goal/MemoryRecall/SessionTaskCascade/ToolConcurrency），但它们不在 `src/runtime/WishfulClaw.sln` 内，`dotnet build sln` 不会编译它们。建议写实为「新增 `tests/tool-category-catalog/` 或比对脚本 + 对应 `npm run test:*` 命令」；同时按 AGENTS.md AOT 第 10 条，涉 C# 的 `[自动]` 门禁建议加 `node scripts/publish-aot-worker.mjs`（脚本实测存在），当前步骤 8 只写「复核 AOT 规范」，无判据。

**⚠️22 三处旧建议仍未采纳**：(a) 步骤 4 的 `TabButton` 实测本体是 `<motion.button>`（`RightPanelHeader.tsx:66` 起、`:148` 闭合），裸 `onContextMenu` 拉不起 Radix 菜单，需 `ContextMenuTrigger asChild` 包裹既有 button，否则 button 嵌 button；(b) 步骤 7 `[人工]`「System Prompt 无预算溢出告警」恒真——`BuildToolCapability` 是裸 raw string，`DefaultCharacterBudget = 20_000`（`:24`，用于 `:76`）与 `memoryBudget = 6000`（`:188`）都不管它，应改成「打印 `<tool_calling>` 段 UTF-8 长度前后差 ≤ N 字符」；(c) 步骤 6b 仍写 `UserMessageMeta.selectedFileReads`，实测接口名是 `MessageMeta`（`lib/api/types.ts:358`，`:361` 为字段），`UserMessageMeta` 全仓不存在。

**⚠️23 步骤 6 未处理「三条 selectedFiles 通道」的去重与排队重放**：实测发送请求已带 composer 侧 `selectedFiles`（`use-chat-actions.ts:42,582,778,793`，经 `getRequestText` 透传并进排队项 `enqueuePendingSessionMessage`），另有 `ui-store.ts:304 selectedFiles`（永空，探索 §三所指 `toggleSelectedFile` 实为 `:306 toggleFileSelection`）与本步解析的 `<select-file>` 标签。计划只点名第三条，需补「同一文件只注入一次」判据，并说明排队消息重放时是否复用同一装配处（避免漏注入或注入两遍）。

## 二·4 行号与路径抽查表（本轮实测）

**「涉及文件」路径存在性**：26 条已存在文件路径逐个确认，**25 条命中、1 条不存在**（`components/chat/MessageList/MessageList.tsx`，见 ❌10）；3 条待新建路径（`chat/SessionTodoPanel.tsx`、`lib/agent/selected-file-context.ts`、`Core/Tools/ToolCategoryCatalog.cs`）均不与既有文件重名；`locales/zh/chat.json`、`locales/en/chat.json` 存在 ✅。

| 引用 | 计划/探索声明 | 实测 | 判定 |
|---|---|---|---|
| `FileAwareEditor.tsx:323-334` | `scheduleCompositionCommit` 的 rAF 回调 | `:309` 定义函数，`:323` = `compositionEndRafRef.current = window.requestAnimationFrame(() => {`，325 `syncLiveContent()`、328-329 两个挡板复位、332 `bumpCompositionRenderVersion()`、334 `})` | ✅ 行号与函数名均吻合 |
| `FileAwareEditor.tsx:413-416` | onBlur 不复位挡板 | `413 onBlur={() => {`、`414 focusedRef.current = false`、`415 onBlur?.()`、`416 }}` | ✅ 逐字吻合 |
| `FileAwareEditor.tsx:205-236` | 布局 effect（首轮指区间偏小） | `205 React.useLayoutEffect(`，挡板早退 209-216，`shouldRender` 220，闭合依赖数组 236 | ✅ 已按首轮建议扩到 205-236 |
| `file-aware-editor-utils.ts:221` | （计划未列该文件） | `221 root.replaceChildren()` 位于 `renderDocument` | ❌ 实际改动落点未进涉及文件（⚠️17b） |
| `TodoCard.tsx:390 / :68 / :164` | 容器 className / 计数常量 / TaskCard 起点 | 390 `className={cn(embedded ? 'min-w-0 space-y-0.5' : 'my-5 min-w-0', className)}`；68 `COLLAPSED_VISIBLE_RECENT_TASK_COUNT = 3`；164 `export function TaskCard({` | ✅ 三处吻合；文件 466 行 |
| `ui-store.ts:82-83` | tabs 全局扁平 + activeTabId 全局 | `82 rightPanelTabs: getDefaultRightPanelTabs(),`、`83 rightPanelActiveTabId: '',` | ✅ 吻合 |
| `ui-store.ts:214-227` | per-session map 范式（已收窄为单一例子） | `214 bottomTerminalDockOpenBySessionId: {},` 至 `227 isBottomTerminalDockOpen` 尾部 | ✅ 首轮「区间不覆盖」问题已改述 |
| `ui-store.ts:324-327` | activeScoped* + syncSessionScopedState 零调用 | `324/325` 两字段、`326 syncSessionScopedState: (sessionId, projectId) =>`、`327 set({...})`；grep 仅定义 + 接口声明 | ✅ 吻合（⚠️13 数量表述另计） |
| `ui-store.ts:120-133` | removeRightPanelTabsForSession | `120` 起，按 `t.sessionId === sessionId` 循环 `closeRightPanelTab` | ✅ 吻合 |
| `ui-store-tab-slice.ts` 各 ensure* | 7 个写入方 | 14/34/76/79/115/135/158 全部命中；固定 id 21/122/142/168 | ✅ 全部命中 |
| `RightPanel.tsx:36,39,46,48 / :62-63 / :228` | 作用域锚点消费、visibleTabs 不过滤、Goals 装配 | 36 取 `activeScopedSessionId`、39/48 `?? state.activeSessionId`、46 `panelSessionId`；62-63 `const tabs = useMemo(...) const visibleTabs = rightPanelTabs`（仅改 title，无 session 过滤）；228 `onAddGoals={...openGoalPanel(panelSessionId, activeProjectId)}` | ✅ 逐处吻合 |
| `RightPanelHeader.tsx:214-217 / :225-233 / :66-150` | Goals 菜单项 / 关闭面板按钮 / TabButton | 214-217 `<DropdownMenuItem onSelect={onAddGoals}>`…`</DropdownMenuItem>`；225-233 `<Button … onClick={onClosePanel} title=…><PanelRightClose/></Button>`；66 `function TabButton({`、148 `</motion.button>`、150 `}` | ✅ 三处吻合（motion.button 见 ⚠️22a） |
| `VirtualListContent.tsx:110 / :134` | 滚动容器仅 pl-7 / 加载更早行 pt-3 | 110 `className="absolute inset-0 overflow-y-auto pl-7 md:pl-9"`；134 `… pb-3 pt-3 …` | ✅ 逐字吻合 |
| `MessageList.tsx:92`、`TranscriptMessageList.tsx:126` | exportAll 容器 / 静态视图滚动容器 | 92 `<div ref={scroll.containerRef} className="relative h-full flex-1" data-message-list>`；126 `cn('not-prose h-[min(60vh,40rem)] min-h-[20rem] overflow-y-auto', className)` | ⚠️ 行号 ✅，但涉及文件路径前缀错（❌10） |
| `useMessageListScroll.ts:229-246 / :122-137` | virtualizer 无 paddingStart / scrollToBottomImmediate | 229 `const rowVirtualizer = useVirtualizer({`…246 `})`，`paddingStart` 在 `MessageList/*` 全目录 0 命中；122 `const scrollToBottomImmediate = React.useCallback(` | ✅ 吻合 |
| `useMessageListData.ts:404` | hasLoadOlderRow | `404 const hasLoadOlderRow = loadedRangeStart > 0` | ✅ 吻合 |
| `use-chat-actions.ts:122-130 / :173 / :210` | scope→workingFolder/ssh、userContent 组装、messages | 122-129 逐条解析 projectId/workingFolder/sshConnectionId；173 `const userContent: string \| ContentBlock[] = …`；210 `messages: [{ role: 'user', content: userContent }],` | ✅ 三处吻合（文件 960 行） |
| `api/types.ts:331 / :344 / :361` | 三个 meta 类型位置 | 331 `SelectedFileReadItemMeta`、344 `SelectedFileReadsMeta`、361 `selectedFileReads?:` | ✅ 行号吻合；接口名 `MessageMeta`（358），计划写 `UserMessageMeta` ❌（⚠️22c） |
| `user-message-views.tsx:40-68` + locales | 六态文案已就位 | 40 `t('userMessage.selectedFileReadsTitle')`、46-68 覆盖 skipped/pdf/非文本/failed/truncated/lines；`locales/zh/chat.json:1105-1111`、`locales/en/chat.json:1106-1112` 七条 key 双份齐全 | ✅ 吻合 |
| `UserMessage.tsx:340` | meta 消费方 | `340 <UserSelectedFileReadsView reads={meta?.selectedFileReads} />` | ✅ 逐字吻合 |
| `session-slice.ts:189-203 / :182` | setActiveSession 不重置面板 / 删除会话才清 tab | 189-203 仅 `set({activeSessionId})` + task 同步；182 `removeRightPanelTabsForSession(id)`，178-180 注释要求惰性 import | ✅ 吻合（循环依赖未写 ⚠️13c） |
| `TitleBar.tsx:100`、`SessionConversationPane.tsx:121,128` | 无参 ensureFilesTab / 带 session 的 ensure* | `100 onClick={() => ensureFilesTab()}`；`121 ensureFilesTab(resolvedSessionId)`；`128 useUIStore.getState().ensureSummaryTab(resolvedSessionId)` | ✅ 三处吻合（新加的好检查点） |
| `Core/Tools/ToolRegistry.cs:25-41 / :163,179 / :186-192` | 7 类表 + 未知 100 + 打优先级 + 排序 | 25 `CategoryPriorities = new(StringComparer.OrdinalIgnoreCase)`、26-32 七项、36-41 `GetCategoryPriority` 默认 100；163/179 调用；186-192 `list.Sort` Priority→Ordinal 名称 | ✅ 吻合（排序副作用未评估 ⚠️20） |
| `Agent/Tools/Providers/*.cs` Category | 23 个分类 | `grep -c 'string Category =>' = 23`，集合与探索逐字一致 | ✅ 吻合 |
| `Agent/Tools/ToolModule.cs:33 / :65 / :105-106` | 直接执行器注册 / PushCategory / tool/list 输出 | 实测 `RegisterDirectExecutors(registry)` 在 **:32**；`:65 registry.PushCategory(provider.Category)` ✅；`:105 category`、`:106 priority` ✅ | ⚠️ 一处 off-by-one（⚠️20） |
| `Persona/PromptBuilder.cs:235-247 / :240-241 / :24,188` | tool_calling 段 / use_capability 引导 / 预算 | 235 `BuildToolCapability`、238 `<tool_calling>`、245 `</tool_calling>`、240-241 proxy 引导两句；24 `DefaultCharacterBudget = 20_000`（仅用于 :76）、188 `memoryBudget = 6000` | ✅ 行号吻合；「预算告警」判据仍恒真（⚠️22b） |
| `Persona.csproj:11` | Persona 可引用 Core | `<ProjectReference Include="..\WishfulClaw.Core\…">`；未见任何下层引上层 | ✅ 分层合法 |
| `dynamic-context.ts:185-252 / :24 / :73-83` | 迁移边界 / 不复活整体 / 遗留调用点 | 185 函数起、252 止；24 `buildRuntimeReminder`；73-83 仍调 `buildSelectedFileContext` | ✅ 边界精确；残留 ⚠️12 |
| OpenCowork `cowork/StepsPanel.tsx:328 / :371 / :373-402 / :433 / :444 / :116 / :176,178 / :404-427` | 卡片定义 / 卡片样式 / header+chevron / AnimatePresence / max-h-64 / 数据装配 / blocked+in_review tone / 审查按钮 | 逐一命中：328 `function InlineStepsPanelCard({`、371 `className="mb-2 overflow-hidden rounded-xl border …"`、395-401 chevron `rotate-180`、433 `<AnimatePresence initial={false}>`、444 `<div className="max-h-64 overflow-y-auto px-3 py-2.5">`、116 `function useStepsPanelData(sessionId?)`、176 `case 'blocked'`/178 `case 'in_review'`、404-427 changeSummary 芯片 + 审查按钮 | ✅ 全部命中（本地副本存在） |
| OpenCowork `hooks/use-chat-actions.ts:594 / :848-953` | 1000 行上限 / 读取编排函数体 | 594 `const SELECTED_FILE_READ_MAX_LINES = 1_000`；848 `async function buildSelectedFileReadContext(args…): Promise<{ meta?: SelectedFileReadsMeta; contextText?: string }>`、952 `return { meta, contextText }`、953 `}` | ✅ 吻合（本仓改用 token 预算 + 行数双限，属显式取舍） |
| OpenCowork `chat/FileAwareEditor.tsx:794` | onBlur 复位挡板 | 792 `onBlur={() => {`、793 `focusedRef.current = false`、**794 `isComposingRef.current = false`**、795 `onBlur?.()`；无 pendingUserInputRef | ✅ 行号精确；归因仍不实（⚠️17a） |
| OpenCowork `chat/InputArea.tsx:4258` | 挂载层级一致 | `4258 {projectScoped && draftSessionId && <InlineStepsPanel sessionId={draftSessionId} />}` | ✅ 吻合（且探索已改述「参考本身非 fixed 悬浮」） |
| `select-file-tags.ts:141 / :159`、`tree-item.tsx:198,232`、`use-file-tree.ts:294-300` | 现状标签链路 | 141 `createSelectFileTag`、159 `parseSelectFileText`；tree-item 两处 `handleAddToChat`；use-file-tree 294-298 `setPendingInsertText(createSelectFileTag(relativePath))` | ✅ 吻合 |
| `fs-handlers.ts:154` + 渲染侧调用 | 名为 lines 实为全量、无调用方 | 154 注册、157 `fs.promises.readFile(…, 'utf-8')`；`read-text-file-lines` 在 renderer 仅 `channels.ts:25,383` 与 `messagepack-channel-routing.ts:28,143` 声明，零 invoke | ✅ 吻合（本批不改契约，首轮 ⚠️6 自然消解） |
| `InputArea/index.tsx:335-339 / :344` | 挂载点 / 悬浮锚点 | 335 `<SessionTodoStatusList` … 339 `/>`；344 `'composer-shell relative flex flex-col …'` | ✅ 挂载点精确；锚点风险未写（⚠️18） |
| `ChangeReviewSheet.tsx` / `RunChangeReviewCard.tsx` / `detailPanelContent` / `kind:'review'` | 「审查按钮打开 ChangeReviewSheet，与消息流卡片一致」 | 两组件全仓零 importer；`detailPanelContent` 零渲染方（`ui-types.ts:114` 仅类型）；`kind: 'review'` 零创建方 | ❌ 不成立（❌9） |
| `stores/team-store.ts` | 探索 §二「本仓无 team store」 | 文件存在（10407 字节），`useTeamStore` 9 个文件消费，`TodoCard.tsx:173-179` 曾用 | ❌ 不实（⚠️19） |

## 二·5 AGENTS.md 条款符合性

- **AOT（9 条）**：判定通过。本批 C# 改动为 `Core/Tools/ToolCategoryCatalog.cs`（静态表）+ `ToolRegistry.cs`（改读表）+ `PromptBuilder.cs`（raw string），不新增序列化类型；`selectedFileReads` 走 `MessageMeta`（`types.ts:361`）与 DB `Meta` 字符串的不透明透传，C# 侧 `grep SelectedFileReads` 零命中，无需注册 `JsonSerializerContext`。步骤 8 的安全网表述保留 ✅，但「复核 AOT 规范」无判据，建议写实为 `node scripts/publish-aot-worker.mjs`（⚠️21）。
- **大文件拆分**：改进明显。`TodoCard.tsx`（466）删除、`InputArea/index.tsx` 510→<500 已进计划正文（❌8 关闭）；三个新建文件按内容估算均在 200~400 行区间，不新增越线条目。两点残留：步骤 2b 的 500 行目标无 `wc -l` 判据（⚠️15）；`SessionTodoPanel.tsx` 需同时容纳卡片+装配+审查芯片，建议在计划标注预计规模。另注：`use-chat-actions.ts` 960 行本批要加代码，但仓内已有 43 个 renderer 文件越 500 行，属存量普遍问题，不作为本批缺陷。
- **编译验证**：合格。步骤 8 三套 tsc 均带 `-p`（AGENTS.md 强调项），`dotnet build` 带 `-o` 避锁提示；步骤 2-7 以「三套 tsc」简写、步骤 1 只写 web 一套（建议统一为三套）。缺口在步骤 6b（❌11）。
- **Git 提交节奏**：与 AGENTS.md「功能单元」基本对齐——8 个步骤对应 7 个知识库条目 + 收口，一步一 commit 不属于碎片化；「只 commit 不 push、Plan 完成后统一 push、VERDICT 归用户」三条与规范逐字一致。一处口径可商：步骤 2a 单独提交时新面板尚未挂载、旧面板未删，属半成品检查点（AGENTS.md 反对「改一点就 commit」），建议 2a+2b 合并为一个功能单元，或在 2a 提交信息标注「未接线，随 2b 完成」。
- **迭代收尾/版本号**：计划未误收版本号与 tag 步骤 ✅（属迭代收尾，非本批），与首轮 ⚠️11 的建议一致。

## 二·6 范围一致性

plan.md「本批次不做」5 条 vs 探索 §七 8 行：I24-11 ✅、I24-15 ✅、review-12/plan-review-fixes ✅、三份计划归档（含压缩孤儿组件退役）✅、死代码清理批（`dynamic-context.ts` 其余/`visual-context.ts`/`ui-store.selectedFiles`/`fs:read-text-file-lines`）✅（首轮漏掉的死代码清理批已由第 2 版补进第 175 行，与探索 §七第 100 行一一对应）、Plan A Task Board ✅、Plan B 会话 Todo 端到端 ✅、自动更新端到端 ✅。**唯一缺项**：探索 §七末行的「压缩取消竞态实测」在计划「本批次不做」中没有对应表述（计划只写了「真实 Electron E2E」）→ 建议补一句，避免执行期被追问。另：探索 §六第 88 行「本批与压缩、自动更新无交集」与步骤 6 改变每轮请求体这一事实仍不充分，恢复会话首轮是否重放 `<selected_files>` 未表态（⚠️23 附）。

## 二·7 结论

第 1 轮的 8 项 ❌ **已全部真正修正**，且修正后新增的引用（tab API 真实名单、23 分类集合、`session-todo-status-list` 唯一 importer、`Persona.csproj→Core` 依赖、挂载点 `:335-339`、`ensureFilesTab()` 无参检查点）命中率很高，第 2 版还主动补了首轮未要求的「`[自动]`/`[人工]` 图例」「无参调用回归点」「单一来源分层合法性说明」，质量优于首轮底线。

但按 dev-workflow 阶段三阻断规则仍有 **3 项 ❌ 未清**：❌9（变更审查按钮无可落地出口，会移植一个点击无响应的按钮）、❌10（涉及文件含不存在路径 `MessageList/MessageList.tsx`）、❌11（步骤 6b 缺 `[自动]` 门禁）。三项均为局部修订：❌9 需要在两个方案里挑一个并写实验收，❌10/❌11 各一行。修完即可进入用户确认环节，不必再动步骤 3/5/7 的设计。⚠️ 13 条建议中，⚠️14（activeTab 会话化）、⚠️12（遗留调用点处置）、⚠️20（tool/list 排序副作用）与执行成败直接相关，建议同批采纳。

---

# 第三轮验证（第 3 版计划）

- 验证对象：`docs/plans/iter-v2-24/plan-issues-batch-2/plan.md`（第 3 版，223 行）+ `exploration_findings.md`
- 代码基线：`dev/v2-iter-24` @ `577712b`，除本计划目录外工作树干净
- 方法：本轮每条判定都指向验证者**亲自打开过的 `file:line`**（不采信文档自述）；按任务要求对第 3 版「新增/修正后」的表述提高怀疑度；门禁口径实跑：`npx tsc -p tsconfig.web.json` / `-p tsconfig.node.json` / `-p tsconfig.json` 与 `dotnet build src/runtime/WishfulClaw.sln`

## 三·0 总判定

**FAIL** —— 本轮新增 **❌ 2 项（❌12、❌13）**、**⚠️ 7 项（⚠️24–⚠️30）**。

- 第 2 轮 3 项 ❌（❌9 / ❌10 / ❌11）**已全部真正修复**，且是以代码事实修复而非措辞修复（见三·1）。
- 检查 C（步骤/子步骤 `[自动]`+`[人工]` 双门禁）**通过**：10 个步骤与子步骤（1、2a、2b、3、4、5、6a、6b、7、8）逐项计数为 1+5 / 1+5 / 2+2 / 1+6 / 1+5 / 1+4 / 1+1 / 1+6 / 5+2 / 3+1，均 ≥1 `[自动]` 与 ≥1 `[人工]`；`[自动]` 命令除 ⚠️29 的两点外均可直接运行。
- 检查 B（死链 / 闭环）**通过**：未新增「有入口、无反馈、无出口」的可见死链；步骤 2a 的审查按钮改为明确不移植并配验收；步骤 4 删 `+` 菜单 Goals 后，Goal 面板入口仍存活（`GoalSessionControls.tsx:254 openGoalPanel(...)`，位于 `GoalSessionBar`，由 `InputArea/index.tsx:332` 渲染）。
- 检查 E（范围决策）**通过**：「本批次不做」各条未在计划新建物里留下可见死入口；死代码清理批与步骤 6a 的「迁出即删旧」边界一致。
- 与既往两轮相同的规律再次成立：**新 ❌ 出现在第 3 版新写的「修正」上**——❌12 出自为回应 ⚠️14 而新写的步骤 3 首选方案，❌13 出自为回应 ❌11 而新写的步骤 6b meta 段落。

## 三·1 第 2 轮 ❌ 复核（代码证据）

| 编号 | 第 2 轮结论 | 本轮代码复核证据 | 结论 |
|---|---|---|---|
| ❌9 | 移植 OpenCowork 变更审查按钮会造出点击无响应的死按钮，计划需在「补出口 / 不移植」间择一并写实验收 | 计划第 42 行择定「**不移植**」，第 51 行补了验收「面板内不出现任何点击后无出口的入口」。我逐一验证其理由成立：`src/renderer/src/components/chat/change-summary-utils.ts:157` 确有 `useAggregatedChangeSummaries`；其消费者 `ChangeReviewSheet.tsx` 与 `RunChangeReviewCard.tsx` 在 `src/renderer/src` 全仓 **零 importer**；`RightPanel.tsx:185` 与 `RightPanelHeader.tsx:53` 能渲染 `kind === 'review'`，但全仓 **`kind: 'review'` 零创建方** ⇒ 只移植按钮确实无可落地出口。另核 `detailPanel*` 在 renderer 无任何挂载（`preview-panel-slice.ts:51-52,166-167`、`ui-store.ts:200-203` 仅 store 侧）⇒「本仓无审查出口」为真 | ✅ 已修复 |
| ❌10 | 「涉及文件」写了不存在的路径 `MessageList/MessageList.tsx` | 计划第 102 行与「涉及文件」第 184 行均已写作 `src/renderer/src/components/chat/MessageList.tsx`；该文件存在，第 92 行确为 `exportAll` 分支容器；`components/chat/MessageList/` 目录下**无**同名文件，新路径不再是歧义路径。步骤 5 其余引用逐条命中：`VirtualListContent.tsx:110 / :134 / :227`、`useMessageListScroll.ts:122 / :229`、`useMessageListData.ts:404`、`MessageRow.tsx:50` | ✅ 已修复 |
| ❌11 | 步骤 6b 无 `[自动]` 门禁，只有 6 条 `[人工]` | 6b 验证首条已补 `[自动]`：三套 tsc + `grep -rn "<selected_files>" src/renderer/src` 仅命中新模块单一生产者。判据可运行且当前为真：该 grep 现在**只有 1 处命中**（`src/renderer/src/lib/agent/dynamic-context.ts:243`），迁到 `lib/agent/selected-file-context.ts` 后即满足「仅命中新模块」；`<system-reminder>` 的第二生产者 `lib/agent/visual-context.ts` 不产 `<selected_files>`，不会污染该判据 | ✅ 已修复（6b 的 meta 落地缺口另立 ❌13） |

## 三·2 本轮新增 ❌（阻断）

### ❌12 步骤 3「首选方案（改动面小）」与其自身验收冲突：固定 id + 按 `kind` 全局去重的单例 tab，无法靠「过滤 `tab.sessionId`」实现会话隔离

- **问题**：首选方案只改两处——`setActiveSession` 里调 `syncSessionScopedState`（计划第 65 行）+ `RightPanel.tsx:62-63` 按 `activeScopedSessionId ?? activeSessionId` 过滤 `tab.sessionId`（第 68 行）——但 tab 的**身份是全局唯一的固定 id，且去重键是 `kind`**。会话 A 已存在 `files`/`summary` 单例时，在会话 B 触发同名 `ensure*Tab` 不会新建 B 的 tab，于是：① B 里点「文件」得到的仍是 stamped A 的 tab，被过滤掉 ⇒ 点击无可见结果；② `summary` 更糟，它会把唯一那张 tab 的 `sessionId` **改写成 B** ⇒ 切回 A 后 A 的摘要 tab 消失。计划第 76 行（「切回 A → A 的 tab 与 activeTab 完整还原」）、第 79 行（「`ensureFilesTab` / `ensureSummaryTab` 不重复追加」）、第 80 行（「`TitleBar.tsx:100 ensureFilesTab()` 无参调用仍能在当前会话正确打开」）在该模型下**无法同时成立**。
- **证据**（均为我打开过的源码）：
  - `src/renderer/src/stores/ui-store-tab-slice.ts:135-154` `ensureFilesTab`：`const existing = state.rightPanelTabs.find((tab) => tab.kind === 'files')` → 命中即 **只返回 `{ rightPanelActiveTabId: existing.id, rightPanelOpen: true }`**，完全不回写 `sessionId`；新建分支的 `id` 硬编码为 `'files'`（`:142`）。
  - 同文件 `:158-180` `ensureSummaryTab`：命中 existing 时 `map` 成 `{ ...tab, sessionId: sessionId ?? tab.sessionId ?? null }`（`:165`）——**单例被最后一次调用方改写归属**；`id` 硬编码 `'summary'`（`:168`）。
  - `ensureActivityTab:14 / ensureTerminalTab:115` 同样是固定 id（`:21` `'activity'`、`:122` `'terminal'`）；计划第 68 行的全局类豁免**只点名 activity / terminal**，未覆盖 files / summary / subAgents / goal。
  - 计划第 79 行把 `SessionConversationPane.tsx:121,128` 当作「切换会话时不重复追加」的检查点，但这两个位置都在**点击回调**里：`:118-122 handleOpenFilesPanel = useCallback(...)` 内 `:121 ensureFilesTab(resolvedSessionId)`、`:126-129 handleOpenSummaryPanel` 内 `:128 ensureSummaryTab(resolvedSessionId)`，不是会话切换副作用 ⇒ 该验收描述的场景实际不会由这两行触发。
  - 被过滤后 activeTab 会落错：`src/renderer/src/components/layout/RightPanel.tsx:89-90` 为 `const selectedTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]`，激活项被过滤掉时静默回落到 `tabs[0]`。
- **修正建议**（二选一并写进计划正文，勿留“若…则升级”的条件式）：
  1. **按会话命名 tab 身份**：`ensure*Tab(sessionId)` 改为以 `${kind}:${sessionId ?? 'global'}` 作为 `id`、去重键同步从 `kind` 改为 `id`，`ensureRightPanelTabs`（`right-panel-tab-factories.ts:9`）与持久化面板状态兼容策略一并说明；或
  2. **显式采用 per-session map 分支**（`ui-store.ts:214-227 bottomTerminalDockOpenBySessionId` 范式，计划第 71 行）作为首选方案，并把 `SessionConversationPane.tsx:121,128` 的验收改写成「在会话 B 点击文件/摘要后切回会话 A，A 的 files/summary 仍在且归属未被改写」。
  - 无论哪种，第 79 行的两个 `[人工]` 检查点都要重述为「点击处理器 + 切换副作用」两类场景，并把 `ensureFilesTab()`（`TitleBar.tsx:100`）**无参**调用在会话化后的归属语义写成可判定条件（建议断言：等价于以 `activeScopedSessionId` 为目标会话打开）。

### ❌13 步骤 6b 的 `MessageMeta.selectedFileReads` 没有任何写入路径，且承载写入的文件未列入「涉及文件」

- **问题**：6b 声称「meta 写入 `MessageMeta.selectedFileReads`（视图 `user-message-views.tsx:40-68` 与 `UserMessage.tsx:340` 消费均已就位）」——消费侧确实就位，但**生产侧需要改 `chat-store`**，而 `src/renderer/src/stores/chat-store/index.ts` 既不在步骤 6b 的动作里，也不在「涉及文件（修改·前端）」（计划第 186 行只列了 `use-chat-actions.ts`、`lib/api/types.ts`、`lib/agent/dynamic-context.ts`）。按现计划执行会停在「读到了、注入了、视图永远不显示」的半闭环上，第 136 行「用户消息下方『已读 N 行 / 截断 / 跳过 / 失败』文案与实际一致」无法通过。
- **证据**：
  - 全仓 grep `selectedFileReads`：只有 `src/renderer/src/lib/api/types.ts:361`（类型）、`src/renderer/src/components/chat/UserMessage.tsx:340`（读 `meta?.selectedFileReads`）、`components/chat/user-message-views.tsx:40` 与两份 `locales/*/chat.json`（`:1105/:1106`）——**零写入方**。
  - 乐观用户消息在 `src/renderer/src/stores/chat-store/index.ts:208` 构造：`const userMessage: ChatMessage = { id: \`user_${now}\`, role: 'user', text: userText, ...(Array.isArray(userContent) ? { content: ... } : {}), createdAt: now }` —— **不含 `meta`**。
  - 唯一落库通道是 `src/renderer/src/stores/chat-store/db-helpers.ts:110 serializeMessage` → `:127 if (msg.meta) Object.assign(meta, msg.meta)` → `:134 meta: JSON.stringify(meta)`，由 `chat-store/index.ts:258 void dbUpsertMessage(sessionId, userMessage, ...)` 调用 ⇒ **meta 必须在 `:258` 之前已挂在 ChatMessage 上**（`ChatMessage.meta?: MessageMeta` 见 `chat-store/types.ts:61`）。
  - 事后补写不可行：`chat-store/session-slice.ts:434 updateMessage` 只做 `Object.assign(msg, patch)`（签名 `:49` 返回 `void`），**不写 DB**；且 `sendMessage` 的入参（`chat-store/index.ts:69-113`）无任何可承载 meta 的字段、返回值是 `Promise<boolean>`（`:114`），调用方拿不到 `user_${now}` 这个消息 id，外部无法定向补写。
- **修正建议**：在步骤 6b 增加一条动作并把文件补进「涉及文件·修改（前端）」：`src/renderer/src/stores/chat-store/index.ts` —— 为 `AgentActions.sendMessage` 入参增加 `userMessageMeta?: MessageMeta`（或 `selectedFileReads?: SelectedFileReadsMeta`），在 `:208` 构造 `userMessage` 时展开为 `meta`，使 `:258 dbUpsertMessage` 天然持久化；同时把 `[自动]` 门禁补一条可判定项（例如 `grep -rn "selectedFileReads" src/renderer/src/stores` 至少命中一处写入），否则该字段仍会保持「只有视图读、无人写」。

## 三·3 本轮新增 ⚠️（建议）

### ⚠️24 `ensureBrowserTab` 被误描述为「带 sessionId 的动态 tab」
- 证据：`src/renderer/src/stores/ui-store.ts:410 ensureBrowserTab`，`:412` 按 `kind === 'browser'` 查找已有项，`:413-419` 新建项为 `{ id: 'browser', kind: 'browser', title, closable, createdAt }`——**没有 `sessionId` 字段**；带会话的只是页面状态 `:423 updateBrowserStateForSession`。
- 影响：计划第 72 行据此把它归为「属会话化对象」，执行者会在过滤模型下发现 browser tab 永远全局可见，与第 78 行验收「browser tab 在切换后不串会话」冲突（表现为「切会话后浏览器 tab 还留在原地」，也可能是期望行为）。
- 建议：改写为「browser tab 本体是全局单例，仅其 pageState 按会话分离」，并在验收里明确它是否应随会话隔离。

### ⚠️25 `TabButton` 有两个返回分支，`asChild` 包裹范围被写窄了
- 证据：`src/renderer/src/components/layout/RightPanelHeader.tsx:66 function TabButton({`，`:123-133` 为 `if (!animated) return <button ...>{content}</button>`（普通 `<button>`），`:136-148` 才是 `<motion.button>…</motion.button>`，函数闭合在 `:150`。
- 影响：计划第 90 行「本体是 `<motion.button>`（`:66` 起、`:148` 闭合）」把两分支说成一支；只包 `motion.button` 会让 `animated=false` 路径的右键菜单静默失效。
- 建议：写「`ContextMenuTrigger asChild` 必须同时覆盖 `:123-133` 与 `:136-148` 两个分支（或把两分支合并为同一 element）」，并保留现有第 96 行的手感验收。
- 补充确认：该文件 `onContextMenu` 出现次数为 **0**，「裸 `onContextMenu` 拉不起 Radix 菜单」的表述属预防性说明而非现状描述，可留。

### ⚠️26 四处 `file:line` 存在 ±1 漂移（实质结论不变，建议校准以免 grep 复核落空）
- `InputArea/index.tsx`：计划第 39 行写 `:340` 开容器、`:344` 为 `composer-shell relative flex flex-col`；实测容器开标签在 **`:341`**，className 字符串在 **`:345`**（`:331-333` GoalSessionBar、`:335-339` `<SessionTodoStatusList>` 均命中）。「挂载点在 relative 容器之外」这一实质判断 **成立**。
- `RightPanel.tsx`：计划第 69 行写 `:88-89`；实测为 **`:89-90`**。
- `use-chat-actions.ts`：计划第 130 行写 `enqueuePendingSessionMessage:781`；实测函数起于 **`:782`**。
- 建议：统一改为「函数/JSX 名 + 起始行」写法，并在计划里为引用行给可 grep 的符号名，避免执行期误判为文档过时。

### ⚠️27 步骤 7 保留 `StringComparer.OrdinalIgnoreCase` 的理由与实际事实不符
- 证据：`src/runtime/WishfulClaw.Core/Tools/ToolRegistry.cs:25` 确为该比较器（保留它是对的）；但全仓 provider `Category` 与直接执行器分类**均为小写 kebab**（`src/runtime/WishfulClaw.Agent/Tools/Providers/*.cs` 共 **23** 个小写分类；`Agent/Tools/ToolModule.cs:32 RegisterDirectExecutors`（定义 `:121`）写入 `file/search/shell/task/memory`），**不存在任何大小写不一致的分类**，也没有大写字面量。
- 影响：计划第 144 行「provider 分类与执行器分类的大小写不完全一致，改成序数比较会静默退回 100」是**假前提**（虽然结论——不改比较器——是对的）。
- 建议：改为「现状无大小写差异，保留 OrdinalIgnoreCase 是为了给后续 provider 留容错」，避免审查期被当成事实错误。

### ⚠️28 迁出/删除动作产生的未用 import 与未用 prop 未列入计划（三套 tsc 会直接报错）
- 证据：tsconfig 继承链开启 `noUnusedLocals` / `noUnusedParameters`（未用 import → TS6133 级错误）。具体落点：
  - `src/renderer/src/lib/agent/dynamic-context.ts`：步骤 6a「迁出即删旧」后，`:1 import { useUIStore }`、`:9 ipcClient`、`:12 estimateTokens` 三者将失去使用者（`:38` 读取点与 `:73-83` 分支被删）。
  - `src/renderer/src/components/layout/RightPanelHeader.tsx:44 / :160` 的 `onAddGoals` prop 在步骤 4 删除 `:214-217` Goals 项后变为未用参数，须一并从签名与 `RightPanel.tsx:228` 装配处移除。
- 建议：在 6a 与步骤 4 各加一句「同步清理失效 import / prop 形参（`noUnusedLocals`）」，并把 `RightPanelHeader` 的 props 收窄写进步骤 4 的动作条目（「涉及文件」第 183/186 行已含这两个文件）。

### ⚠️29 步骤 7 与步骤 8 的三条 `[自动]` 门禁口径不可执行或互相冲突
- 证据（实测）：`dotnet build src/runtime/WishfulClaw.sln` 若按计划第 161 行「必要时 `-o` 临时输出目录」加输出目录，MSBuild 会报 `warning NETSDK1194`（解决方案级 `--output` 不被支持），实测结果为 **0 error / 1 warning**，与第 149 行「`dotnet build src/runtime/WishfulClaw.sln` 0 error / 0 warning」及第 153 行「`node scripts/publish-aot-worker.mjs` 通过，0 error / 0 warning」的口径直接冲突。
- 另：第 152 行 `[自动]`「改动前后各打印一次 `tool/list` 的名称序列并存入计划目录」**没有给出可运行命令**（无入口程序、无输出文件名），执行期无法自证。
- 正面确认：第 150 行的分类断言 grep `grep -rn "string Category =>" src/runtime/WishfulClaw.Agent/Tools/Providers` 实测可运行且恰命中 **23** 条，与「23 个 provider 分类」一致，该判据有效。
- 建议：① 把「必要时 `-o`」限定为**单工程** build（如 `dotnet build src/runtime/WishfulClaw.Worker/WishfulClaw.Worker.csproj -o <tmp>`），解决方案级不加 `-o`，或把判据写成「0 error，且除 NETSDK1194 外无新增 warning」；② 用步骤 7 新建的回归工程承担 tool/list 序列检查——`Core/Tools/ToolRegistry.cs:126 GetToolDefinitions()` 是 public，可在该工程内打印排序后的名称序列并按前后两版存入计划目录，使第 152 行有可运行入口。

### ⚠️30 「同一文件只注入一次」的去重前提被写弱
- 证据：`src/renderer/src/lib/select-file-tags.ts:159 parseSelectFileText`（`:182-188` 对 tag 与 token 一律产出 `type: 'file'`），但其 `:130-138` 的合并循环是**按位置区间重叠去重**，不是按路径去重——同一文件从 `@` 搜索（`<select-file>`，`:141 createSelectFileTag`）与从文件树（`@{path}` token，`:35 SELECT_FILE_TOKEN_RE`）各进一次时，两处文本位置不同 ⇒ 不会被该函数合并。
- 影响：计划第 118 行「`parseSelectFileText` 已同时识别标签与 token 并在 `:130-138` 去重，覆盖两条输入通道」把跨通道去重归给了这个函数；第 121 行虽另写了「按归一化后的绝对路径去重」，但未指明由新模块实现。
- 建议：把跨通道路径去重显式写成 `lib/agent/selected-file-context.ts` 的责任，并加一条 `[人工]`（同一文件两路加入 → 请求体只出现一次 `<selected_files>` 条目）对应断言；好消息是闭环方向已核：`lib/select-file-editor.ts:228 serializeEditorDocument` 用 `createSelectFileTag(file.sendPath)` 序列化，故发送文本确实带标签（第 117 行的解析前提成立）。

## 三·4 指令 A 清单 `file:line` 抽检表

| 计划位置 | 断言 | 我打开的证据 | 判定 |
|---|---|---|---|
| `:20` | `FileAwareEditor.tsx:309 scheduleCompositionCommit`、`:323-334` 的 rAF 内 `:325 syncLiveContent`、`:328-329` 复位两个挡板、`:332 bump` | `src/renderer/src/components/chat/FileAwareEditor.tsx` 逐行核对，行号全中；`:346-371 compositioncancel` 也镜像同一 rAF 写法 | ✅ |
| `:21` | `:413-416 onBlur` 只置 `focusedRef` 与 `onBlur?.()`，需补 composition 复位 | 实测 `:413-416` 完全一致，未复位 composition；OpenCowork 对应行 `:794` 确为 `isComposingRef.current = false` | ✅ |
| `:22` / `:25` | `:205-236` 布局 effect 为绕过对象；且不回退到 OpenCowork `:736-752` 的 compositionend 同步 flush | 该区间确为 useLayoutEffect（含 `isComposingRef` 早退与 `isSameDocument` 守卫）；OpenCowork `:736-752` 确为同步 flush 写法 | ✅ |
| 参考 `:199` | OpenCowork `FileAwareEditor.tsx:792-796` onBlur 有 `isComposingRef = false`，且「仅这一行可对齐」 | `D:\claw\OpenCowork\...\FileAwareEditor.tsx:792-796` 命中；该文件 `pendingUserInputRef` **0 命中** ⇒ 我方那半个字段确属自加，「仅一行」表述准确 | ✅ |
| 参考 `:203` | `file-aware-editor-utils.ts:221 root.replaceChildren()` 为真实重建 | `:212 export function renderDocument(`、`:221 root.replaceChildren()` | ✅ |
| `:39` | 挂载点 `:335-339` 在 `:344 composer-shell relative` 之外，`:340` 才开宽度容器 | 挂载点确在 `:335-339`（`:331-333` 为 GoalSessionBar）；但容器开标签实测 `:341`、className 在 `:345` ⇒ 实质结论成立、行号各偏 1 | ⚠️（⚠️26） |
| `:38`/`:202` | 悬浮范式 `composer-flyovers.tsx:56 absolute inset-x-0 bottom-full z-30`、`:63 max-h-64 overflow-y-auto` | 两处逐字命中 | ✅ |
| `:37`/参考`:197` | OpenCowork `StepsPanel.tsx:328/371/373-402/395-401/433-443/444/116/176/178/404-427` | 逐一打开，11 个引用点全部命中（含 `:176 blocked` / `:178 in_review`） | ✅ |
| 参考 `:200` | 挂载层级 `InputArea.tsx:4258` 带 `projectScoped` 门禁 | 命中 | ✅ |
| `:41` | 五态可由 `TaskItem.status` 表达 | `stores/task-store-helpers.ts:11 status: 'pending' \| 'in_progress' \| 'completed' \| string` ⇒ `blocked`/`in_review` 可承载 | ✅ |
| `:40` | 现数据源 `session-todo-status-list.tsx:19-21`，唯一 importer 为 `:2` | `InputArea/session-todo-status-list.tsx:2 import …TodoCard`、`:19/:21/:23` 命中 | ✅ |
| `:43` | `TodoCard.tsx` 466 行；读 team store 的只有 `TaskCard(:164/:173)`；`TodoStatusList(:345)` 不读 team；`team-store` 被 8 个文件消费 | 行数 466 一致；`:345-466` 体内 **无** `useTeamStore`；`TaskCard` 全仓零消费者；`useTeamStore` 命中 9 个文件、扣除 `stores/team-store.ts` 自身即 **8 个消费者** | ✅ |
| `:55` | `ToolCallCard/index.tsx:155-166` 独立逻辑、不 import TodoCard | `:156 if (name !== 'TaskList') return summary`、`:166 t('todo.tasksDone', …)`、`:167` 依赖数组；文件内无 TodoCard 引用 | ✅ |
| `:65` | `session-slice.ts:189-203 setActiveSession` 现不触面板；`:178-183` 已留惰性 import 范式 | `:178-179` 注释 + `:180 void import('@renderer/stores/ui-store')` + `:182 removeRightPanelTabsForSession(id)`；`:189-203` 仅 `set({ activeSessionId })` + 懒同步 task | ✅ |
| `:65` | `syncSessionScopedState` 现为 `ui-store.ts:326-327`、零调用；消费文件 4 个 | `:324 activeScopedSessionId` / `:325 activeScopedProjectId` / `:326-327` setter，全仓 `syncSessionScopedState(` 除声明与 `ui-store-interface.ts:235` 外 **零调用**；消费者 `RightPanel.tsx:36,39,46,48`、`SessionChangeReviewPanel.tsx:30,32`、`browser-session-helpers.ts:123,137,211,271`、`ui-store-tab-slice.ts:38` | ✅ |
| `:68`/`:76` | `RightPanel.tsx:62-63 visibleTabs`（现无过滤）＋固定 id 单例 tab 可被过滤会话化 | `:62-63` 确为 `useMemo(() => { const visibleTabs = rightPanelTabs`（无 filter）；但 `ui-store-tab-slice.ts:135-154/:158-180` 以 `kind` 全局去重且 id 硬编码 ⇒ 过滤模型不成立 | ❌（❌12） |
| `:70`/`:88` | `ui-store.ts:103-118 closeRightPanelTab`：preview 走 `closePreviewTab`（`:105-110`），activeTab 落位取最后一个（`:117`） | 逐行命中；`:117 tabs[Math.max(0, tabs.length - 1)].id` ⇒ 计划「取最后一个、非相邻优先」为真 | ✅ |
| `:72` | 写入 API 真实名单 7 项 + 工厂 + `ensureBrowserTab`（定义 `ui-store.ts:410`，调用 `ui-store-browser-slice.ts:32`，声明 `ui-store-interface.ts:255`），且 browser 是「带 sessionId 的动态 tab」 | 名单与行号全部命中（`:14/:34/:76/:79/:115/:135/:158`、`right-panel-tab-factories.ts:9`、`ui-store.ts:410`、`ui-store-browser-slice.ts:32`、`ui-store-interface.ts:255`）；唯 browser tab 无 `sessionId`、按 `kind` 单例 | ⚠️（⚠️24） |
| `:73` | `removeRightPanelTabsForSession` 在 `ui-store.ts:120-133` | 命中 | ✅ |
| `:86`/`:87` | Goals 项 `RightPanelHeader.tsx:214-217`、关闭按钮 `:225-233`（`:229 onClick={onClosePanel}`）、`RightPanel.tsx:228 onAddGoals` | 三处逐字命中 | ✅ |
| `:90` | `TabButton` 为 `:66-150`、本体 `<motion.button>`（`:66` 起、`:148` 闭合） | 函数确 `:66-150`，但 `:123-133` 另有非 animated 的普通 `<button>` 分支，`:136-148` 才是 motion | ⚠️（⚠️25） |
| `:69` | `rightPanelActiveTabId`（`ui-store.ts:83`）为单值全局字段 | `:82/:83` 命中（`rightPanelTabs: getDefaultRightPanelTabs()` / `rightPanelActiveTabId: ''`），`closeAllRightPanelTabs` / `closeOtherRightPanelTabs` 全仓不存在 ⇒ 步骤 4 新增属实 | ✅ |
| `:102` | `MessageList.tsx:92` 为 `exportAll` 容器；`VirtualListContent.tsx:110/134/227` 三处表面 | 全部命中，`:227` 吸附卡含 `pl-7 pr-14 md:pl-9`；`MessageList/*` 内 `paddingStart` 0 命中 | ✅ |
| `:117` | `use-chat-actions.ts:122-130` 按 scope 解析三个上下文、`:173 userContent`、`:210 messages:[{role:'user',content:userContent}]` | 逐行命中（`:165 messageText`） | ✅ |
| `:119`/`:222` | `SendMessageOptions.selectedFileReferences`（`:31`）声明后无读取方，全仓仅 3 处命中；composer `selectedFiles` 经 `:270-271` 映射进 `sendOptions` | 全仓 grep 恰 3 处（类型 + 映射 + 传参），无消费者；`ui-store.ts:304/306/312` 的 `selectedFiles` 相关 setter 也确为**零写入方**（`setSelectedFiles` 命中全部落在 composer `useState`，见 `use-composer-editor.ts:25`） | ✅ |
| `:118` | `parseSelectFileText` 覆盖两通道并在 `:130-138` 去重 | 双通道识别成立（`:27/:35/:141/:182-188`）；`:130-138` 是位置重叠去重，非路径去重 | ⚠️（⚠️30） |
| `:130` | `getRequestText:765-780` 原样存文本，排队重放走同一入口 ⇒ 注入挂「文本→userContent」天然生效 | `:765-780` 命中；`:782` 起 `enqueuePendingSessionMessage`（计划 `:781`，偏 1）；`:880-940 dispatchNextQueuedMessageForSession` 以 `handler({ text: item.requestText, queuedDispatch: true })` 重放 ⇒ 实质结论成立 | ✅（行号 ⚠️26） |
| `:115` | 预算/截断/skipped 母本在 `dynamic-context.ts:185-252`，`:16-18` 三常量随迁 | `:185-252` 确为 `buildSelectedFileContext`；`:254 resolveFileContextBudget` / `:265 truncateToTokenBudget` 在引用区间**之外**，「含二者」需按「整段辅助函数一并迁出」理解 | ⚠️（表述可收紧） |
| `:116` | `buildRuntimeReminder` 零调用，不复活 | `:24` 定义，全仓零调用 | ✅ |
| `:129` | meta 接口就位：`api/types.ts:358 MessageMeta` / `:361 selectedFileReads?` / `:331 ItemMeta` / `:344 ReadsMeta`；视图 `user-message-views.tsx:40-68` + `UserMessage.tsx:340` 已就位 | 五个类型引用点全部命中（`ItemMeta` 含 `skipReason?/error?`）；视图侧确实就位，**但生产侧无写入路径** | ❌（❌13） |
| `:222` | `fs:read-text-file-lines` 无调用端点 | `src/main/ipc/fs-handlers.ts:154` 注册（`:157 utf-8` 读取），renderer 侧仅 `lib/ipc/channels.ts:25,383` 与 `messagepack-channel-routing.ts:28,143` 的声明，**零 invoke** | ✅ |
| `:143` | 23 个 provider 分类 + 直接执行器 5 类，注册入口 `ToolModule.cs:32` | `Agent/Tools/ToolModule.cs:32 registry.RegisterDirectExecutors(...)`（定义 `:121`，写 file/search/shell/task/memory）、`:65 PushCategory(provider.Category)`；`grep -rn "string Category =>" .../Providers` 恰 23 条小写 kebab 分类 | ✅ |
| `:144` | `ToolRegistry.cs:25-41` 表 + `:36` 兜底 100 | 字典 `:25-34`（7 项）、`GetCategoryPriority` `:36-41` 默认 100 | ✅ |
| `:145`/`:146` | `PromptBuilder.cs:235-247 <tool_calling>`、`:238/:245` 标签、`:240-241` `use_capability` 引导；`Persona.csproj:11` 已引用 Core | 全部逐字命中；`:24 DefaultCharacterBudget = 20_000` 仅被 `:76` 使用、`:188 memoryBudget = 6000` | ✅ |
| `:147` | `:163/:179` 打优先级、`:186-192` 按 Priority→名称排序且注释自陈 "deterministic prefix bytes" | `:185` 注释原文命中，`:186 list.Sort(...)` | ✅ |
| `:150`/`:151` | 新回归工程范式 `tests/WishfulClaw.ToolConcurrencyRegressionTests/`；sln 内已有 4 个同类回归工程，Cron / MemoryRecall 未入 sln | `WishfulClaw.sln:20/:24/:26/:28` 为 Goal / CompactionSnapshot / SessionTaskCascade / ToolConcurrency 四项；Cron 与 MemoryRecall 在磁盘存在但不在 sln；`scripts/publish-aot-worker.mjs` 存在；范式为 Program.cs 断言式 console 工程（引用 `WishfulClaw.Agent`），provider 类 `public sealed` ⇒ 可直接断言 | ✅ |
| `:204`/`:205` | `ui-store.ts:103-118` 双层栈语义、`:214-227` per-session map 范式 | 两处命中（`bottomTerminalDockOpenBySessionId` 为 map 范式） | ✅ |
| 「涉及文件」全部路径 | 所列新建/修改/参考源码路径均存在 | 以脚本逐条 `test -e` 校验，**0 条 MISSING**（含 4 份 locales、5 份 store 切片、2 份 C# 文件、OpenCowork 4 个参考文件） | ✅ |

## 三·5 检查项 B / C / D / E 结论汇总

- **B（每一步是否死链 / 是否闭环）**：除 ❌13（注入结果无 meta 落库出口）与 ❌12（会话切换后 tab 还原不闭环）外，其余步骤入口→反馈→闭环齐备；步骤 2a 的审查按钮出口已按 ❌9 的修正彻底移除，不再留悬空入口。
- **C（`[自动]`/`[人工]` 双门禁 + 命令可运行性）**：结构上 **10/10 达标**；可运行性问题集中在 ⚠️29（`dotnet build <sln> -o` 与「0 warning」互斥、`tool/list` 名称序列无现成命令）与 ⚠️26（引用行号 ±1 会让复核 grep 落空）。
- **D（内部一致性：步骤要改的文件是否都在「涉及文件」）**：**2 处缺口**——❌13 的 `stores/chat-store/index.ts`（含 `:69` 入参类型）为硬缺口；⚠️28 的两处未用 import/prop 清理（`lib/agent/dynamic-context.ts` 已在列，`RightPanelHeader.tsx` 已在列）属描述缺失而非文件缺失。步骤 3 的两个分支各自的文件清单已核：分支一（首选，`syncSessionScopedState` + 过滤）只改 `session-slice.ts` / `ui-store.ts` / `ui-store-tab-slice.ts` / `RightPanel.tsx`，分支二（per-session map）另需 `SubAgentsPanel.tsx` / `preview-panel-slice.ts` / `ui-store-interface.ts` / `ui-store-browser-slice.ts` / `right-panel-tab-factories.ts`，两者并集与「涉及文件」第 182 行一致 ✅（即该条通过）。
- **E（范围决策合理性）**：通过。唯一值得在执行前补一句的是「真实 Electron E2E」之外的**恢复会话首轮是否重放 `<selected_files>`**（第 2 轮 ⚠️23 附带项，第 3 版未表态）——它与步骤 6 改动每轮请求体直接相关，但不构成新的可见死入口，故不升级。

## 三·6 第三轮结论

第 3 版的引用密度与命中率是三轮里最高的一版：本轮抽检的 40 余条 `file:line` 中，实体结论仅 **2 条不成立**（❌12 的过滤会话化模型、❌13 的 meta 写入路径），其余全部经代码核实为真，且第 2 轮三项 ❌ 的修复质量扎实（择一方案 + 配验收 + 事实复核）。

仍有 2 项 ❌ 阻断，但**均为定点修订、不动步骤骨架**：
- ❌12 需要步骤 3 在「tab 身份按会话命名」与「直接采用 per-session map」之间再择一，并把第 76/79/80 行三条 `[人工]` 验收改到该模型下可判定；
- ❌13 需要在 6b 增加 `chat-store/index.ts`（`:69` 入参加 meta 承载 + `:208` 构造时展开）并把该文件补进「涉及文件·修改（前端）」。

建议同批采纳 ⚠️24（browser tab 语义）、⚠️27（假前提）、⚠️28（TS6133 会直接卡住 `[自动]` 三套 tsc）、⚠️29（门禁自身互斥会让步骤 8 无法自证）。两项 ❌ 清完后即可进入用户确认环节。
