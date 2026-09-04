# 探索结论：issues 批次 2（知识库 2026-09-01 ~ 09-03 待办）

> 探索时间：2026-09-05　基线：`dev/v2-iter-24` HEAD `577712b`（工作区干净）
> 输入来源：`D:\koda\Obsidian\02-AI教学\wishfulclaw\issues\bugs.md` + `改进.md`
> 探索方式：只读探测（6 路并行）+ 主 agent 逐点复核 + 规划验证逐轮回写
> **本文件版本：第 4 版**。第 2 版修正 8 处失真结论；第 3 版按 ❌9/❌10/❌11 重写步骤 2/3/6 相关判据；第 4 版按第四轮 ⚠️38 修正 preview 会话键的表述（**§四「唯一已经正确的先例」/「preview tab 关闭是双层栈」/「消费文件全集」三条**）。逐轮阻断项状态一律以 `compliance_report.md` 顶部「收敛台账」为准，本文件不重复记账。

## 一、条目与真实状态

### 缺陷

| 条目 | 记录日期 | 代码实证 | 状态 |
|---|---|---|---|
| 中文 IME 最后一个字符异常（w → w嗯） | 09-01 | `FileAwareEditor.tsx:323-334` compositionend 在同一个 rAF 内先提交再解除挡板并 bump 渲染版本；`:413-416` `onBlur` 不复位 `isComposingRef` / `pendingUserInputRef` | 🔴 未修复 |
| Todo 面板占用聊天窗高度、无滚动、无法收起 | 09-02 | `TodoCard.tsx:390` 容器 `cn(embedded ? 'min-w-0 space-y-0.5' : 'my-5 min-w-0')`，全文无 `max-height` / `overflow` / 定位类；仅有 `COLLAPSED_VISIBLE_RECENT_TASK_COUNT=3`（`:68`）的计数折叠 | 🔴 未修复 |
| 会话切换后右侧面板仍显示旧会话选项卡 | 09-03 | 见 §四 | 🔴 未修复 |

### 改进

| 条目 | 记录日期 | 代码实证 | 状态 |
|---|---|---|---|
| 首条消息顶部贴死 | 09-02 | `VirtualListContent.tsx:110` 滚动容器仅 `pl-7 md:pl-9`；`MessageRow.tsx:50` 仅 `pb-7`；virtualizer 未设 `paddingStart`（`useMessageListScroll.ts:229-246`）；唯一顶部间距来自「加载更早」行 `pt-3`，而 `hasLoadOlderRow`（`useMessageListData.ts:404`）在 `loadedRangeStart === 0` 时为 false | 🟡 未做 |
| 侧栏项目/对话右键菜单对齐 OpenCowork | 09-01 | 壳层已升级并优于参考：`ui/context-menu.tsx:84` `rounded-xl border-border/70 p-1.5 shadow-xl backdrop-blur-md`、`:108` `rounded-lg px-2.5 py-2 text-xs` + destructive 变体 | ✅ 老大判定已完成，本批不处理 |
| 工具分类排序 + 分类优先级 + 分类说明提示词 | 09-01 | 见 §五 | 🟡 仅剩分类说明清单 |
| 文件选中发送同步 OpenCowork 读取行为 | 09-01 | 见 §三 | 🟡 已拍板移植 |
| Todo 面板直接参考 OpenCowork 成熟组件 | 09-03 | 现用 `TodoCard.tsx` 对应 OpenCowork 消息流版 TodoCard/TodoStatusList，非其成熟 `InlineStepsPanel` | 🟡 与缺陷 B2 同单元 |
| 右侧面板 Tab 菜单改造 | 09-03 | Goals 项 `RightPanelHeader.tsx:214-217`；关闭面板按钮 `:225-233`；`TabButton`（`:66-150`）无 `onContextMenu`；无 close-all / close-others 方法 | 🟡 未做 |

## 二、Todo 面板可复用性与替换后果

OpenCowork `components/cowork/StepsPanel.tsx`：
- `InlineStepsPanelCard:328` —— 默认收起为单行 header（`:373-402` 点击切换 + chevron 旋转）、展开体 `max-h-64 overflow-y-auto`（`:444`）、AnimatePresence 高度动画（`:433-443`）、卡片样式（`:371`）
- `InlineStepsPanel:485` 外层装配；右栏版 `StepsPanel:289` 用 `max-h-[calc(100vh-200px)]`（`:303`）
- 挂载层级与我们一致（OpenCowork `InputArea.tsx:4258`），**其本身也不是 fixed 悬浮**，靠 `max-h` + 收起达成「不抢高度」

数据与依赖兼容性（复核修正）：
- `TaskItem` 字段两侧一致（本仓 `stores/task-store-helpers.ts:4-18` vs OpenCowork `task-store.ts:15-29`，均含 `planId` / `sessionId` / `activeForm`）。
- 本仓**已有** `components/chat/change-summary-utils.ts:157 useAggregatedChangeSummaries`，但它的两个「使用者」`ChangeReviewSheet.tsx:31` 与 `RunChangeReviewCard.tsx:21-22` **自身全仓零 importer**；`RightPanel.tsx:185` 与 `RightPanelHeader.tsx:53` 已能渲染 `kind === 'review'`，而 `ui-types.ts:58` 之后无任何创建方。故审查按钮**不移植**（移植即给新面板接一个没有出口的按钮），整条 review 面板链记入遗留清理批。
- `agent-store.runChangesByRunId`、`ui-store.openDetailPanel`、`plan-store` 本仓均在；OpenCowork 依赖的 `useStepsPanelData:116` 聚合了 chat/team/plan/agent/ui 五个 store。**修正（第 3 版）**：本仓 `stores/team-store.ts` 确实存在（10KB，`useTeamStore` 被 8 个文件消费），"无 team store" 的说法不成立；但新面板仍不聚合 team 任务的结论不变，真实理由是**现存活路径本来就没聚合** —— `TodoCard.tsx` 中读 `useTeamStore` 的只有 `TaskCard`（`:173`，全仓零消费者），唯一活着的导出 `TodoStatusList`（`:345`）从不读 team store，且 `InputArea/session-todo-status-list.tsx` 的数据源只有 `useTaskStore.getTasksBySession`。裁剪的是这条从未生效的聚合维度，不是缺失的依赖。

替换后果（新发现）：`TodoCard.tsx`（466 行）的**唯一**消费方是 `InputArea/session-todo-status-list.tsx:2,23`；`TaskCard`（`:164`）导出后全仓无使用者。替换为悬浮面板后整个 `TodoCard.tsx` 成为孤儿文件，需一并删除，不留死码。

悬浮落地方式：外层套本仓既有 flyover 范式 `InputArea/composer-flyovers.tsx:56`（`absolute inset-x-0 bottom-full z-30`，`:63` 已有 `max-h-64 overflow-y-auto` 先例）。**锚点前提（第 3 版补）**：`bottom-full` 以最近 `relative` 祖先为基准，而 flyover 范式生效依赖 `InputArea/index.tsx:345` 的 `'composer-shell relative flex flex-col …'`（容器开标签在 `:341`）；步骤 2b 指定的挂载点 `:335-339` 在该容器**之外**（`:331-333` 是 GoalSessionBar）。直接照抄 class 会以更远祖先为锚导致错位，故新面板需自带 `relative` 包裹层，或把挂载点移进 composer 容器内。

## 三、文件选中发送：本仓已有一套完整但零调用的实现

**当前生效链路**：文件树 `cowork/tree-item.tsx:198-200,232-233` → `cowork/use-file-tree.ts:294-300` → `lib/select-file-tags.ts:141 createSelectFileTag`，输入框内只落 `<select-file>相对路径</select-file>`，发送时不读内容、不标记已读，C# 侧对 `select-file` 零处理。

**已存在但无人调用的实现**（关键，初版低估）：
- `lib/agent/dynamic-context.ts:24 buildRuntimeReminder` —— 组装 `<system-reminder>`，内部已含会话状态、CodeGraph 前置钩子与 selected_files
- `lib/agent/dynamic-context.ts:185-252 buildSelectedFileContext` —— 已是较完整实现：`resolveFileContextBudget(modelConfig)` 按 `contextLength` 计算 token 预算、`truncateToTokenBudget` 截断并标 `[Truncated due to context budget]`、读失败/不可读进 `## Skipped Files`、SSH 项目走 `ssh:fs:read-file`、`displayPath` 去工作目录前缀
- 全仓搜索 `buildRuntimeReminder` / `selected_files` 的结果：除定义文件与 `lib/tools/codegraph-tool.ts:12` 一句注释外**零调用方**；`lib/agent/visual-context.ts`（另一处 `<system-reminder>` 生产者，`:319,334`）同样零调用
- `stores/ui-store.ts:304-312 selectedFiles: string[]` + `setSelectedFiles:305` / `toggleFileSelection:306` / `clearSelectedFiles:312` —— **无任何写入方**（第 3 版更正方法名：实为 `toggleFileSelection`，前版误写 `toggleSelectedFile`）；`dynamic-context.ts:38` 读的正是这个永空数组。
- **同名陷阱**：`InputArea/index.tsx:97` 解构出的 `selectedFiles / setSelectedFiles` 来自 `InputArea/use-composer-editor.ts:25` 的组件本地 `useState`，与 `ui-store` 的那一份毫无关系（类型也不同：`SelectedFileItem[]` vs `string[]`）。grep `selectedFiles` 时极易把两者混为一谈，排查前必须先看来源。
- **第三条通道是死字段**：composer 本地列表在 `InputArea/index.tsx:270-271` 映射成 `sendOptions.selectedFileReferences` 传出，实测 `SendMessageOptions.selectedFileReferences` 在 `use-chat-actions.ts:31` 声明后**全仓无读取方**（`grep -rn selectedFileReferences src/` 仅 3 处命中：producer 两处 + 声明一处）。故注入实现只能以「消息文本」为唯一真源，该死字段记入遗留清理批。

**结论**：本批不是从零实现，而是「把 `buildSelectedFileContext` 迁到真实发送路径并补齐 meta 写入」。发送路径装配点：`hooks/use-chat-actions.ts:122-130`（按 `session.scope` 解析 `workingFolder` / `sshConnectionId`）→ `:173 userContent` → `:210 messages:[{role:'user',content:userContent}]`。

**仍需补的差距**：
1. `buildSelectedFileContext` 只返回拼好的字符串，无法喂已就位的结构化 meta；需改为同时返回逐文件结果（路径 / 行数 / 截断 / 跳过 / 失败）以写 `MessageMeta.selectedFileReads`（接口名实测 `lib/api/types.ts:358 interface MessageMeta`，字段 `:361`，元素 `:331 SelectedFileReadItemMeta`，容器 `:344 SelectedFileReadsMeta`；第 3 版更正：前版误写作 `UserMessageMeta`，该类型全仓不存在。视图 `components/chat/user-message-views.tsx:40-68` 六种状态均已就位，`UserMessage.tsx:340` 已消费）。
2. 现按 token 预算截断（无行数上限），OpenCowork 按 1000 行；两者取其一需明确 —— 本批采用**保留 token 预算 + 增加行数硬上限**双重保护，避免超大文件把预算吃满挤掉对话。
3. `<select-file>` 存相对路径，需按会话 `workingFolder` 解析绝对路径；全局会话（`scope='global'` 无 workingFolder）与解析失败 → meta 标「仅路径引用」，不读盘。
4. 两条读盘通道并存：死链用 `fs:read-file`（全量），另有 `fs:read-text-file-lines`（`src/main/ipc/fs-handlers.ts:154`，名为 lines 实为全量 `readFile`、无上限）。本批统一走 `fs:read-file` + 渲染侧截断，主进程 `read-text-file-lines` 无调用方的事实记入遗留清理，不在本批动。

## 四、右侧面板 Tab：作用域机制半套悬空（B3 深层原因）

- 状态源 `stores/ui-store.ts:82-83`：`rightPanelTabs`（全局扁平数组）+ `rightPanelActiveTabId`，`ui-store.ts:44` 无 `persist`。
- tab 实例已带可选 `sessionId`（`ui-store-tab-slice.ts:147,163,173` files/summary、`:51,61` subagent、`:106` goal），但 `RightPanel.tsx:62-63 visibleTabs = rightPanelTabs` 不按 session 过滤。
- **单例约束（第 3 版新增，决定了修法）**：固定类 tab 的 id 是常量且去重按 `kind` 全局查（`ensureFilesTab:137`、`ensureSummaryTab:160`、`ensureActivityTab:16`、`ensureTerminalTab:117`、`ensureBrowserTab:412`），同一时刻全仓只可能有一张 files / summary / activity / terminal / browser tab。`ensureFilesTab:138-140` 命中后**只激活、不回写 sessionId**；`ensureSummaryTab:162-165` 命中后会把单例归属**改写**给最后调用方。⇒「只给 visibleTabs 加过滤」在数据模型上不成立：B 会话里点 Files 会得到 stamped A 的 tab 并被过滤掉，表现为点击无反应；摘要 tab 则会 A/B 互抢。**tab 标识必须一并会话化。**
- 已经正确的先例有**两个**（第 4 版按 ⚠️38 更正「唯一先例」的说法）：
  - `ensureSubAgentTab:36-47` —— `tabScopeId = sessionId ?? 'global'`、`tabId = subagent:${tabScopeId}:${toolUseId}`、按 `id` 去重。
  - **preview tab** —— `preview-panel-slice.ts:55` 用 `rightPanelPreviewTabId(nextTab.id)`（实现在 `preview-panel-helpers.ts:208-210`，返回 `preview:${previewTabId}`）生成**逐文档唯一 id**，`:56-58` 按 `id` 而非 `kind` 查重，`:67-68` 每条都写 `sessionId: scope.sessionId` / `projectId: scope.projectId`。而 `previewTabId` 本身（`:161-174`）已内嵌 `previewScopeKey`（`:154-159` = `session:${sid}` / `project:${pid}` / `global`）⇒ **会话作用域是传递性嵌在 id 里的**，sessionId 为空时自动回落 `project:` / `global` 桶。⇒「按 id 去重 + 落会话键」这一步 preview 已经做对了，不需要改造；它的会话键不是待补项，而是步骤 3 可直接对齐的第二份现成范式（其 id 粒度比 `${kind}:${tabScopeId}` 更细，因为它天然一个文档一张卡）。
- `ensureBrowserTab`（`ui-store.ts:410-444`）**与前述判断相反**：tab 是固定 id `'browser'` 且**不写 sessionId**，会话隔离只落在内容层 `browserStatesBySession`（`updateBrowserStateForSession`）。改法：只补 tab 级会话键使二者口径一致，页面状态逻辑不动。
- 改 id 的安全性已核：全仓消费方一律按 `tab.kind` 分派渲染与判定（`RightPanel.tsx:66,72,78,108,109,155,184,186,252`、`RightPanelHeader.tsx:51,54`），**无一处依赖字面 tab id**；`getDefaultRightPanelTabs()`（`right-panel-tab-factories.ts:15`）返回 `[]`、`ensureRightPanelTabs:9` 只是 null 兜底，均无固化 id 假设；`ui-store.ts:44` 无 `persist`，不涉及旧持久化数据兼容。
- **半套作用域机制**：`ui-store.ts:324-325 activeScopedSessionId / activeScopedProjectId` 有 **4 个消费文件**（第 3 版更正计数，前版写「6 个消费方」实为按引用点数）—— `RightPanel.tsx:36,39,46,48`、`SessionChangeReviewPanel.tsx:30,32`、`browser-session-helpers.ts:123,137,211,271`、`ui-store-tab-slice.ts:38`，另有接口声明 `ui-store-interface.ts:233`；而唯一能写它的 `syncSessionScopedState`（`ui-store.ts:326-327`）**全仓零调用**。因此面板一直在读一个永为 `null` 的作用域锚点，`?? activeSessionId` 回退掩盖了缺陷。
- **`rightPanelActiveTabId` 是单一全局字段**（`ui-store.ts:83`），`RightPanel.tsx:89-90` 取 `tabs.find(id === activeTabId) ?? tabs[0]`。只过滤 tabs 而不同步会话化 activeTabId 时，「在会话 B 点过 tab → 切回 A」必然显示错 tab。
- **preview tab 关闭是双层栈**：`ui-store.ts:103-119 closeRightPanelTab`（第 4 版校准闭合行，前版写 `:103-118`）对 `kind === 'preview' && previewTabId` 转调 `closePreviewTab`（`:105-110`）同步移除 `previewPanelTabs` 与 `rightPanelTabs` 两层并重排激活；其余情况取 `tabs[tabs.length-1]`（`:117`）作为新的 activeTab（**相邻优先语义缺失**，步骤 4 要一并修）。`removeRightPanelTabsForSession:120-133` 靠循环调用 `closeRightPanelTab` 保住双层栈语义，批量关闭 API 不得绕过。
- **删除会话按 `sessionId` 字段筛选，与 tab id 是两回事**：`removeRightPanelTabsForSession:124-126` 的条件是 `t.sessionId === sessionId`。⇒ 步骤 3 把 id 改成 `${kind}:${tabScopeId}` 后，**`sessionId` 字段仍必须写原始 sessionId**（全局桶写 `null`，不得把 id 里的 `'global'` 字面量写进该字段），否则删除会话时批量关闭会静默失效、旧会话的 tab 留在面板上。
- `session-slice.ts:189-203 setActiveSession` 不触碰面板；`removeRightPanelTabsForSession`（`ui-store.ts:120-133`）只在删除会话时调用（`session-slice.ts:182`）。同文件 `:178-183` 已注明 **chat-store → ui-store 存在加载期循环依赖**，必须 `void import('@renderer/stores/ui-store')` 惰性取用，`setActiveSession` 接管作用域时要沿用该范式。
- 真实 tab 写入 API 名单：`ui-store-tab-slice.ts` 的 `ensureActivityTab:14` / `ensureSubAgentTab:34` / `openSubAgentsPanel:76` / `openGoalPanel:79` / `ensureTerminalTab:115` / `ensureFilesTab:135` / `ensureSummaryTab:158`；工厂 `right-panel-tab-factories.ts ensureRightPanelTabs`；**另有 `ensureBrowserTab` 不在 tab-slice 而在 `ui-store.ts:410`**（由 `ui-store-browser-slice.ts:32` 调用、`ui-store-interface.ts:255` 声明）；第 3 版更正：它**不是**带 sessionId 的动态 tab，而是固定 id 的全局单例（详见上一条），但仍属会话化必改方。**不存在 `addRightPanelTab`**。
- `rightPanelTabs` / `rightPanelActiveTabId` 的消费文件全集（6 个）：`RightPanel.tsx`(4)、`SubAgentsPanel.tsx`(6)、`stores/preview-panel-slice.ts`(16)、`stores/ui-store-interface.ts`(2)、`stores/ui-store-tab-slice.ts`(28)、`stores/ui-store.ts`(19)。其中 `preview-panel-slice.ts` 与 `SubAgentsPanel.tsx` 是数据模型改造的必改方。**但 preview 的改造面不是「补会话键」**（那已完成，见上文 ⚠️38 条），而是**两处全局标量写入要按作用域落键**：`:151-156` 关闭时回落 `rightPanelActiveTabId`（取最后一个、空则 `''`）、`:168-172` 激活时写 `rightPanelActiveTabId: rpTabId` 且 `rightPanelOpen: true`（第 4 版实测行号，对应 ❌14）。
- 可复用范式：`ui-store.ts:214-227 bottomTerminalDockOpenBySessionId`（`Record<sid,bool>`）与 `planModesBySession` / `browserStatesBySession`。

**修复路径判断（第 3 版推翻第 2 版结论，第 4 版补三条改造面）**：第 2 版写的是「先只接管作用域锚点 + 过滤，实在不行再升级」，验证 ❌12 证明该最小方案在单例约束下不可行（见上）。定案为**一步到位**：tab id 按 `${kind}:${tabScopeId}` 会话化 + 去重键从 `kind` 改 `id` + `rightPanelActiveTabId` 按会话记录 + `setActiveSession` 接管 `syncSessionScopedState`，四件事同批做完，不留条件式分支。**第 4 版追加同批必做的三条**：❌14（最后一张 tab 关闭时的落位/收起判定要按作用域取集合再算）、❌16（`rightPanelActiveTabId` 的标量写入面实测 **20 个落点**，不是 ❌14 初稿列举的四处，须统一收进新建 `src/renderer/src/stores/right-panel-scope.ts` 的两个纯 helper；`rightPanelOpen` 经设计决定**保持全局**，19 处里只改 `ui-store.ts:114` 的收起判据为「当前作用域集合为空即收起」）、❌15（删除会话后 `activeScopedSessionId` 的回落旁路）。preview 侧保留的是**双层栈关闭语义**（`ui-store.ts:103-119` + `preview-panel-slice.ts` 16 处耦合）不变，其 tab 会话键**已然齐备**（⚠️38），需改的只有上面那两处标量落键；`browserStatesBySession` 的既有语义同样不动，只把 browser tab 补成带会话键。

## 五、工具分类：优先级表只覆盖 7 类，实际有 24+

- 优先级表 `Core/Tools/ToolRegistry.cs:25-34`：file10 / search20 / shell30 / task40 / memory50 / plan60 / capability70；`GetCategoryPriority:36-41` 未命中一律 100。
- 实际分类集合远大于此：23 个 `IToolProvider` 各自的 `Category`（`Agent/Tools/Providers/*.cs`，如 ask-user / browser / channel-plugin / code-compatible / codegraph / cron / desktop / global-dispatch-reply / global-task / goal / image-generate / notebook / plan / plugin / project / skill-management / skill / ssh / task / team / capability / web / widget）+ `ToolModule.cs:32 RegisterDirectExecutors`（实测行号，第 3 版更正，原写 `:33`）的直接执行器分类。未列者全部并列在 100，只按名称字典序排。
- 注册顺序 `Agent/Tools/ToolModule.cs:36-60`（providers 显式列表按类名 Ordinal 排序）→ `:65 PushCategory`；保序注入链 `AgentLoop.cs:167-168` → `AgentRunContextPolicy.cs:160-178`；`tool/list` 输出 priority `ToolModule.cs:104-106`；渲染端不再重排 `lib/tools/tool-cache.ts:34-35`。
- 提示词现状 `Persona/PromptBuilder.cs:235-247 <tool_calling>`：`:239` 一句工作流顺序、`:240-241` 已明确引导 `use_capability` list→call。**缺**逐分类说明清单。
- 单一来源约束：若在 Persona 层手写分类清单，必然与 Core 的分类集合漂移。故本批要求把「分类名 → 优先级 → 一句话说明」收敛到 Core 的单一目录（`ToolRegistry` 同层新增目录类型），优先级表与 Prompt 清单同源于它。分层合法性：Persona 依赖 Contracts + Core + Workspace（AGENTS.md 第 5 层），可引用 Core；禁止反向。

## 六、风险与约束

1. **IME 无自动化护栏**：`tests/` 下无 IME 用例；改动在受控 contenteditable 的 composition 链路上，回归面是「打字 → 候选 → 切窗 → 发送」全序列，只能人工验证。
2. **步骤 3 是本批最高回归面**：tab 状态牵动 preview（16 处）与 SubAgentsPanel（6 处）。
3. **M4 改变发给模型的请求体**：注入前缀影响 prefix cache 与请求体大小，须遵守工具描述与提示词精简规范，且不得在后续轮次重复累积。
4. **删除 `TodoCard.tsx` 前须再确认无 importer**（当前实证唯一 importer 是 `session-todo-status-list.tsx:2`）。
5. 本批与压缩、自动更新、全局任务工作台无交集，可独立验证。
6. **步骤 7 会改变 `tool/list` 的名称序列**：`ToolRegistry.cs:186-192` 按 Priority→名称排序，注释自陈目的是 "deterministic prefix bytes"。把约 20 个原本并列 100 的分类改成具体值，会让工具定义顺序变化 → **一次性 prefix cache 失效**（之后重新稳定）。同时新目录必须保持 `StringComparer.OrdinalIgnoreCase`（`:25`），否则大小写不一致的分类会静默退回 100。
7. **`tests/` 下 6 个 .NET 回归工程只有 4 个在 sln 内**：`WishfulClaw.sln:20,24,26,28` 含 Goal / CompactionSnapshot / SessionTaskCascade / ToolConcurrency，`Cron` 与 `MemoryRecall` 未入 sln（`dotnet build sln` 不编译它们）。新增回归工程须照已入 sln 的先例办，不能照未入的两个抄。

## 七、本批不做的迭代 24 遗留（已核实，另批处理）

| 项 | 实证 | 归属 |
|---|---|---|
| I24-11 automation 权限承诺与实现不一致 | `lib/tools/cron-runtime.ts:491` 仍硬编码 `permissionMode:'fullAccess'` + `forceApproval:false` | 审查遗留批 |
| I24-15 主进程分派失败路径不进统一日志 | `src/main/ipc/native-agent-runtime.ts:162-164,193-196,263-269` 三处 catch | 审查遗留批 |
| review-12 / plan-review-fixes 清单失真 | I24-1~I24-18 中 15 项已修（`bb619be` / `bc91bdb` / `0e22cc1`），文档仍标 ⏳ / `[ ]` | 归档批 |
| plan-tool-concurrency-queue 归档 | 步骤 1-3 代码已在 `e9fbcd2` 完成，缺 `verification_report.md` | 归档批 |
| plan-context-manifest 归档 + 缺口 | 6 步代码基本落地；「显式修复上下文」操作在 renderer/main 无调用方 | 归档批 + 独立功能 |
| plan-compression-display 收口 | 主体已做；`CompressionStatusMessage.tsx` / `CompactBoundaryMessage.tsx` 已成孤儿；续聊入口未迁移；近 4 个提交仍在返工 | 返工风险最高，单列 |
| 死代码清理：`dynamic-context.ts` 其余部分、`visual-context.ts`、`ui-store.selectedFiles` slice、`fs:read-text-file-lines` 无调用、review 面板链（`ChangeReviewSheet.tsx` / `RunChangeReviewCard.tsx` 零 importer，`kind:'review'` 零创建方） | 见 §二 §三 | 遗留清理批（本批仅迁走 selected_files 部分） |
| Plan A Task Board / Plan B 会话 Todo / 自动更新端到端 / 压缩取消竞态 实测 | 属用户实测项 | 非本批开发范围 |

## 八、参考源码定位

- OpenCowork（本地 `D:\claw\OpenCowork`）
  - `src/renderer/src/components/cowork/StepsPanel.tsx:328,371,373-402,433-444` —— InlineStepsPanelCard（步骤 2）
  - `src/renderer/src/hooks/use-chat-actions.ts:594,848-953` —— selected_files 读取与注入、1000 行上限、pdf/office 跳过（步骤 6）
  - `src/renderer/src/components/chat/FileAwareEditor.tsx:794` —— onBlur 复位 composition 挡板（步骤 1，仅此一行可回补；其 `:736-752` compositionend 同步 flush 是我们已修的旧 bug，不对齐）
- 本仓既有范式：`InputArea/composer-flyovers.tsx:56,63` 悬浮 + 限高；`ui-store.ts:214-227` per-session map；`components/ui/context-menu.tsx` 右键菜单原语；`lib/agent/dynamic-context.ts:185-252` selected_files 读取骨架
