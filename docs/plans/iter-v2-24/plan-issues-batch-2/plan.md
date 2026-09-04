# Plan: issues 批次 2 —— 知识库 2026-09-01~09-03 待办收口

> 迭代：v2-iter-24　分支：`dev/v2-iter-24`　产品版本：0.2.24（待发布）
> 探索结论：`./exploration_findings.md`（第 4 版）
> 范围确认（2026-09-05 老大拍板）：知识库其余条目全部纳入本批；M2 侧栏右键菜单判定为已完成、不再处理；B2 直接抄 OpenCowork 组件；M4 移植「发送前读内容注入」。
> **本版本：第 4 版**（阻断项逐轮状态以 `compliance_report.md` 顶部「收敛台账」为准，本行只作索引，不替代台账）：
> - 第 1~2 轮 ❌1–❌11 已在前序轮次复核关闭；第 3 轮 ❌12（步骤 3 改按 `${kind}:${tabScopeId}` 会话化）与 ⚠️24/25/27/28/30 已采纳。
> - 第四轮复核结果：❌12 **关闭**；❌13 **半修**（正文已加步骤 6a-2，「涉及文件」漏列 `chat-store/index.ts`，本版补齐）；新出 ❌14（落位/收起/标量写入判定点未纳入改动面）、❌15（删除会话时的作用域回落旁路）；**❌16 = 修 ❌14 过程中新发现**，❌14 初稿把标量写入面记成 4 处，实测 `rightPanelActiveTabId` 20 个落点 + 读取侧 2 处，须走 helper 收口而非逐处手改；⚠️29 前版未采纳，本版修正。
> - ⚠️31–⚠️38 已全部修入本版正文。**这些修订尚未经第五轮复核**，账面仍计 4 项 ❌ 未清（全部为「已修待复核」，0 项「未修」），不得据此进入执行态。

## 目标

修掉三条用户可感知缺陷（中文输入末字符异常、Todo 面板抢聊天窗高度、会话切换右侧面板不重置），并按 OpenCowork 成熟实现补齐 Todo 面板渲染、右侧面板 Tab 菜单、首条消息顶部间距、文件选中发送读取内容、工具分类说明提示词，收口 v2-iter-24 的功能补齐面。

## 步骤清单

> 标注 `[自动]` = 编译/静态/回归可验证；`[人工]` = 需应用内实测。两类都过才打 `[✓]`。

### 步骤 1：中文 IME 末字符异常（缺陷 B1）

- [ ] 步骤 1：`src/renderer/src/components/chat/FileAwareEditor.tsx` IME 时序加固
  - 改动点：
    - `:323-334` `scheduleCompositionCommit` 的 rAF 回调：先 `syncLiveContent()` 把 IME 尾字符采纳进状态，**推迟到下一帧**再解除 `isComposingRef` / `pendingUserInputRef` 并处理 `pendingRenderAfterCompositionRef`（双 rAF）
    - `:413-416` `onBlur` 补 `isComposingRef.current = false`（对齐 OpenCowork `FileAwareEditor.tsx:794`）+ `pendingUserInputRef.current = false`（**本仓自创加固**，参考侧 `:792-796` 无此挡板，勿写成对齐）
    - `:205-236` 布局 effect：当编辑器为 `document.activeElement` 且 selection 落在 root 内、而 `parseDomToDocument(root)` 与 state 仅差 IME 尾字符时，以 DOM 为准不 `replaceChildren`
    - 判定口径（可写代码，不用「仅差尾字符」这种模糊说法）：**DOM 文本以 state 文本为前缀，且多出 ≤2 个字符** → 视为 IME 尾字符，采纳 DOM；多出 >2 字符仍按原逻辑以 state 为准重建
    - 实际重建落点在 `components/chat/file-aware-editor-utils.ts:221 root.replaceChildren()`（`renderDocument` 内），改动只在本仓 editor 组件里加提前 return，不动 utils 的渲染语义
  - **不改** composition start/update 与 `beforeinput` 挡板语义；**不回退**到 OpenCowork `:736-752` 的 compositionend 同步 flush
  - 验证：
    - `[自动]` 三套 tsc 零错误
    - `[人工]` 中文输入法混合序列各 ≥10 次（「中文测试嗯」「w 嗯」「拼音+英文+数字」），末字符不重复不丢失、光标不跳
    - `[人工]` 主动验证「≤2 字符」阈值不被绕过：连续快打 3~4 个汉字不让 rAF 走完，观察是否仍以 DOM 为准且无重复字符
    - `[人工]` 输入中途切窗口再切回继续打字，无残留候选串（覆盖 onBlur 复位路径）
    - `[人工]` 候选中按 Enter 上屏、按 Esc 取消（compositioncancel 路径）行为不变
    - `[人工]` 粘贴长文本、`/` 文件提及与插件提及标签渲染不受影响

### 步骤 2：Todo 面板改为悬浮限高可收起（缺陷 B2 + 改进 M5）

- [ ] 步骤 2a：新建 `src/renderer/src/components/chat/SessionTodoPanel.tsx`，移植 OpenCowork `cowork/StepsPanel.tsx` 的 `InlineStepsPanelCard`（`:328`）
  - 移植：单行 header 默认收起（`:373-402` 点击展开/收起 + chevron 旋转）、展开体 `max-h-64 overflow-y-auto`（`:444`）、AnimatePresence 高度动画（`:433-443`）、卡片样式（`:371`）
  - 悬浮：外层套本仓既有范式 `absolute inset-x-0 bottom-full z-30`（`InputArea/composer-flyovers.tsx:56`），不再占聊天窗 flex 高度
  - **悬浮锚点必须自带**：`bottom-full` 以最近的 `relative` 祖先为基准，而挂载点 `InputArea/index.tsx:335-339` 在 `:345` 的 `'composer-shell relative flex flex-col …'` 容器**之外**（`:331-333` 是 GoalSessionBar、`:341` 才开 `composerWidthClass` 容器），照抄 class 会以更远祖先为锚导致错位。新组件**自带一层 `relative` 包裹**（或由 2b 把挂载点移进 composer 容器内），二者择一并在实现里注明
  - 数据源沿用 `useTaskStore.getTasksBySession(draftSessionId)`（现 `InputArea/session-todo-status-list.tsx:19-21`），保留现状的项目会话门禁 `projectScoped`（参考侧 `InputArea.tsx:4258` 同样要求，两侧一致）
  - 五态 tone 沿用参考映射（`StepsPanel.tsx:176 blocked` / `:178 in_review` 等），删除 `TodoCard.tsx` 不丢状态显示
  - 依赖取舍：**不移植变更审查按钮** —— 本仓 `components/chat/change-summary-utils.ts:157 useAggregatedChangeSummaries` 虽存在，但其两个消费者 `ChangeReviewSheet.tsx` 与 `RunChangeReviewCard.tsx` **全仓零 importer**，`RightPanel.tsx:185` 与 `RightPanelHeader.tsx:53` 已能渲染 `kind === 'review'` 却无任何创建方（`ui-types.ts:58`）。给面板接一个没有出口的按钮属死链复活，本批不做，已记入 exploration §七 遗留清理批
  - **不聚合 team 任务**：理由不是「本仓无 team store」（`stores/team-store.ts` 存在且被 8 个文件消费），而是**现存活路径本来就没聚合** —— `TodoCard.tsx` 里读 `useTeamStore` 的只有 `TaskCard`（`:173`，全仓零消费者），唯一活着的导出 `TodoStatusList`（`:345`）从不读 team store。新面板与 `TodoStatusList` 保持同口径
  - i18n：新增 key 落 `chat` ns（`chat.todo.*`），`src/renderer/src/locales/zh/chat.json` + `src/renderer/src/locales/en/chat.json` 双份齐全
  - 验证：
    - `[自动]` 三套 tsc 零错误
    - `[人工]` Todo ≥15 条时面板 `max-h-64` 内部滚动，聊天区高度不被挤压、composer 不上移
    - `[人工]` 悬浮层底部紧贴 composer 顶部、无跨容器错位，展开时不遮挡输入光标可点击区
    - `[人工]` 收起态单行 header 可见进度摘要，点击可展开/收起
    - `[人工]` 切换会话只显示新会话 Todo
    - `[人工]` 面板内不出现任何点击后无出口的入口（审查按钮已明确移除）
- [ ] 步骤 2b：收口 `InputArea/index.tsx` 与孤儿文件
  - `InputArea/index.tsx`（当前 510 行，越 AGENTS.md 500 行红线）：挂载点 `:335-339` 换为新面板，并把本步新增逻辑外移使文件回到 500 行内（顺带关闭遗留项 I24-17）
  - 删除 `components/chat/TodoCard.tsx`（466 行）——实证唯一 importer 是 `session-todo-status-list.tsx:2`；`TaskCard`（`:164`）全仓无使用者；`session-todo-status-list.tsx` 若无剩余职责则一并删除
  - 删除范围**不含**消息流工具结果卡：`ToolCallCard/index.tsx:155-166` 的 `TaskList` 摘要走的是独立逻辑（`name !== 'TaskList'` 早退 + `t('todo.tasksDone')`），不 import TodoCard，需作为回归点验证而不是顺手改
  - 验证：
    - `[自动]` 三套 tsc 零错误；`grep -rn "TodoCard\|session-todo-status-list" src/renderer/src` 无残留引用
    - `[自动]` `wc -l src/renderer/src/components/chat/InputArea/index.tsx` < 500（I24-17 关闭判据）
    - `[人工]` 输入框上方 Todo 悬浮层出现/收起/滚动/点击全部正常，聊天窗高度不随 Todo 条数变化
    - `[人工]` 消息流里 `TaskList` 工具结果卡的「N/M 已完成」摘要不受影响

### 步骤 3：右侧面板 Tab 会话隔离（缺陷 B3）

- [ ] 步骤 3：右侧面板 tab 会话化（作用域锚点接管 + tab id 按会话分区）
  - **先说清为什么「只加过滤」不成立（第 3 版验证 ❌12 的结论）**：固定类 tab 的 id 是常量、去重按 `kind` 全局查（`ui-store-tab-slice.ts:137` `find(tab => tab.kind === 'files')`、`:160` 同理 summary），全仓同一时刻**最多只能存在一个** files / summary / activity / terminal / browser tab。若只给 `visibleTabs` 加 `tab.sessionId` 过滤：会话 A 的 `files` tab 会被 B 过滤掉，而 `ensureFilesTab(B)` 又因 `:138-140` 命中既有 tab 后**只激活、不回写 sessionId** → B 面板永远打不开文件 tab（点了没反应，正是 B3 要修的缺陷类型）；`ensureSummaryTab:162-165` 更会把单例 tab 的 sessionId 从 A 改写到 B，A 的摘要 tab 直接易主。故 tab **标识**必须一起会话化。
  - **目标模型（照抄本仓已有先例）**：`ensureSubAgentTab:36-47` 已经是正确形态——`sessionId = (requestedSessionId?.trim() || null) ?? state.activeScopedSessionId ?? useChatStore.getState().activeSessionId ?? null`（**`\|\| null` 这个归一不能漏**：只 `?.trim()` 时纯空白串会得到 `''` 而非 nullish，`tabScopeId` 就成空前缀）、`tabScopeId = sessionId ?? 'global'`、`tabId = subagent:${tabScopeId}:${toolUseId}`，去重按 `id` 而非 `kind`（落点 `:47`）。把同一形态推广到 `ensureActivityTab:14` / `ensureTerminalTab:115` / `ensureFilesTab:135` / `ensureSummaryTab:158` / `openGoalPanel:79` / `ensureBrowserTab`（`ui-store.ts:410-444`）
  - 各写入方具体落点：
    - activity / terminal / files / summary / browser：id 改为 `${kind}:${tabScopeId}`，去重条件从 `tab.kind === X` 改为 `tab.id === tabId`，新建时写入 `sessionId`
    - `ensureFilesTab`（`:138-140`）现状命中后不回写 sessionId —— 会话化后按 id 命中即同会话，语义自然一致，无需再回写
    - `ensureSummaryTab`（`:162-165`）的「改写既有 tab sessionId」动作在会话化后失去意义，删除，不留两套语义
    - `openGoalPanel:89` 现在按 `goal:${projectId ?? 'global'}` 建 id、`:90-92` 按 `kind+projectId` 去重 —— Goal 是 per-session（带 `goalId`），项目键会让同项目两个会话共用一个 Goal tab，改为 `goal:${tabScopeId}`，`projectId` 降级为 tab 数据字段
    - `ensureBrowserTab:410-444`：现状是**固定 id `'browser'` 且 tab 上不写 sessionId**，会话隔离靠另一张 `browserStatesBySession`（`updateBrowserStateForSession`）提供内容级隔离 —— 与 ⚠️ 早前判断一致。本步只补 tab 级会话键（`browser:${tabScopeId}`）使 tab 与内容口径一致，**不动** `browserStatesBySession` 的状态逻辑
  - `RightPanel.tsx:62-63 visibleTabs` 按 `activeScopedSessionId ?? activeSessionId` 过滤，`:89-90` 的激活项查找在**过滤后集合**上做，渲染分支继续按 `tab.kind` 分派（全仓无一处依赖字面 tab id，第四轮已复核：字面量只出现在 8 个生产方，消费方一律按 `kind` 分派）。
  - **过滤只作用于 tab 条与激活项，不得吞掉常驻层判据（第四轮 ⚠️37）**：`hasBrowserTab`（`:95-96`）与 `hasFilesTab`（`:108`）是「常驻不卸载层」的挂载条件，`:92-94` 注释自陈目的是「面板收起或切到别的 tab 时 webview 仍在后台跑」——这两个判据继续读**未过滤**的 `rightPanelTabs`（按 `kind` 判定，与会话无关）。同时须写明真实保活边界：`browserPanelKey`（`:97-101`）**已经**按 `session:${panelSessionId}` 作 React key，切会话本来就会 remount `BrowserPanel`，所以本批要保证的是「**同会话内**收起面板 / 切 tab 不卸载」，不是「跨会话不卸载」（后者本仓现状即不保证，别写成已实现）。`filesVisible` / `browserVisible` 这类「是否显示」的判据跟着过滤集合走。
  - **接管作用域锚点**：`stores/chat-store/session-slice.ts:189-203 setActiveSession` 内调用 `syncSessionScopedState(sessionId, projectId)`（`stores/ui-store.ts:326-327`，当前零调用的既有 setter），让 4 个消费文件（`RightPanel.tsx:36,39,46,48`、`SessionChangeReviewPanel.tsx:30,32`、`browser-session-helpers.ts:123,137,211,271`、`ui-store-tab-slice.ts:38`，另有接口声明 `ui-store-interface.ts:233`）的 `activeScopedSessionId` 真正生效
  - **循环依赖规避（必做）**：`setActiveSession` 拿 `ui-store` 必须走 `void import('@renderer/stores/ui-store').then(...)` 惰性方式，同文件 `:178-183` 删除会话路径已留了明确注释与范式；顶部直接 `import` 会踩 chat-store → ui-store 循环
  - `projectId` 取值：`setActiveSession(id)` 只有 `id`，需从 `get().sessions.find((s) => s.id === id)?.projectId ?? null` 派生（全局会话无 projectId → 传 `null`），不要从 `activeProjectId` 猜，否则切换会话时会把上一个项目的作用域带过去
  - **`rightPanelActiveTabId` 一并会话化**（`ui-store.ts:83` 现为单一全局字段）：`RightPanel.tsx:89-90` 取 `tabs.find(id === activeTabId) ?? tabs[0]`，全局单值会让「在 B 点过 tab → 切回 A」落到错误 tab。改为按会话记录激活项（范式照 `ui-store.ts:214-227 bottomTerminalDockOpenBySessionId`），与 tabs 同一套作用域模型
  - **标量写入全量清单与收敛修法（第四轮 ❌14 + ❌16）**：`rightPanelActiveTabId` 与 `rightPanelOpen` 这两个**全局标量**才是会话化的真正拦路虎。第 4 版初稿只点了 4 处，**实测改动面被严重低估**（❌16：修 ❌14 过程中发现）——下面的计数全部给出可复现命令，第五轮按命令核即可，不要相信本文的自述：
    - `rightPanelActiveTabId`：**20 个必改落点**。复现：`grep -n "rightPanelActiveTabId:" src/renderer/src/stores/ui-store.ts src/renderer/src/stores/ui-store-tab-slice.ts src/renderer/src/stores/preview-panel-slice.ts` → 20 行（分布 `ui-store.ts` 6 / `ui-store-tab-slice.ts` 11 / `preview-panel-slice.ts` 3；`ui-store-interface.ts:61` 是类型声明，不计）。含初值 `ui-store.ts:83`；其余 19 处为 `set`/patch 写入：`preview-panel-slice.ts:82/:151/:170`、`ui-store-tab-slice.ts:18/:29/:71/:99/:112/:119/:130/:139/:151/:165/:177`、`ui-store.ts:95/:101`（`setActiveRightPanelTab`）`/:114/:118`（`closeRightPanelTab`）`/:440`（`ensureBrowserTab`）。
    - `rightPanelOpen`：**19 处，但按下面的设计决定只有 1 处要改**。复现：同上把字段名换成 `rightPanelOpen:` 并加上 `src/renderer/src/stores/right-panel-tab-factories.ts` → 20 行（`ui-store.ts` 5 / `ui-store-tab-slice.ts` 11 / `preview-panel-slice.ts` 2 / `factories` 2），扣掉 `right-panel-tab-factories.ts:19`（函数返回类型标注，真实赋值在 `:20`）= 19 处（含初值 `ui-store.ts:73`；`ui-store-interface.ts:51` 是类型声明，不在上述路径内）。
    - **读取侧 2 处**：`RightPanel.tsx:89-90`（当前激活项查找）与 `components/layout/SubAgentsPanel.tsx:243-246`（从 `rightPanelTabs.find(kind==='subagent' && id === rightPanelActiveTabId)` 推导「当前选中的子 Agent」，读的是**未过滤全局集合 + 全局标量**）。activeTabId 变成 per-scope map 后，此处必须按当前作用域取值，否则子 Agent 面板的选中态会跨会话串。
    - ⇒ **合计 22 个必改落点** = `rightPanelActiveTabId` 20 + 读取侧 2。其中 `ui-store.ts:114` 同时是「写入点」与「收起判据」，只计一次。
    - **唯一非 store 写入方**：`right-panel-tab-factories.ts:19-21 closeRightSidePanels()` 返回 `{ rightPanelOpen: false }`（并被 `CHAT_SURFACE_NAV_RESET:23` 展开用于页面切换时收面板）——**保持全局、不改**（导航切页本就该收起右侧面板，与会话无关）；这也是 ⚠️38 把它判为「预期零改动」的准确理由，不是「它不写标量」。
    - **根因修法，不逐处手改**：新建 `src/renderer/src/stores/right-panel-scope.ts`，导出 `activateRightPanelTab(state, sessionId, tabId)` 与 `closeRightPanelScope(state, sessionId, tabId)` 两个纯函数（照 `preview-panel-helpers.ts` 的「helper 返回 patch、slice 只 set」既有范式），把上述 20 个 `rightPanelActiveTabId` 落点统一改为「算出作用域 → 调 helper → 返回 patch」。逐处手改一定会漏，而漏掉的那一处就是下一次 bug 的来源。
    - `rightPanelActiveTabId` 改为 `Record<tabScopeId, string>`（范式照 `ui-store.ts:214-227 bottomTerminalDockOpenBySessionId`），读取处仍是 `RightPanel.tsx:89-90` 的单点查找，但改在过滤后集合上、按当前作用域取激活项。
    - `rightPanelOpen` **保持全局单值，不做 per-session 开合**。理由：切会话时面板自动出现/消失比现状更令人意外，而 B3 的抱怨是 tab 串会话、不是开合状态。所以 19 处里 18 处**原样保留**（11 处 tab-slice 的 `true`、`preview-panel-slice.ts:83/:171`、初值 `:73`、`toggleRightPanel:74` / `setRightPanelOpen:75` 两个用户动作 setter、`:441`，以及 factories 那处），**唯一要改的是 `ui-store.ts:114` 的收起判据**：从「全局数组为空」改成「**当前作用域**的集合为空即收起」。既不会「A 关完最后一个 tab 面板还开着显示空白」，也不会「因为 B 还有 tab 所以 A 关完不收起」。副作用必须写进验收：A 收起面板时 B 的 tab 并未被删除，切到 B 重新展开仍是 B 自己的激活项。
    - 同理，`closeRightPanelTab` 的 preview 双层栈分支（`ui-store.ts:105-110`）与 `removeRightPanelTabsForSession:120-133` 的循环关法都不得绕过 helper。
  - **删除会话时的作用域回落旁路（第四轮 ❌15）**：`stores/chat-store/session-slice.ts:150-152` 在 immer 事务内直写 `state.activeSessionId = state.sessions[0]?.id ?? null`，**不经 `setActiveSession`**；侧栏删除入口 `components/layout/workspace-sidebar-items.tsx:174 deleteSession(session.id)` 之后也不做任何导航。本步把面板过滤挂到 `activeScopedSessionId` 上之后，删掉当前会话会让锚点停在已删 id、过滤结果恒空（面板空白，直到用户手动再切一次）。必须让该回落路径同样调用 `syncSessionScopedState`（沿用同文件 `:178-186` 的惰性 import 范式）。
  - preview 类 tab 的关闭语义需保持：`ui-store.ts:103-119 closeRightPanelTab` 对 `kind === 'preview' && previewTabId` 走 `closePreviewTab` **双层栈同步关闭**（`previewPanelTabs` + `rightPanelTabs`），会话化改造后不得绕过该分支（步骤 4 的「关闭所有/关闭其他」也依赖它）。**纠正（第四轮 ⚠️38）**：`openPreviewTab` 写会话键是**已满足项**，不是待办——`preview-panel-slice.ts:67-68` 已写 `sessionId`/`projectId`，且右栏 id 本身**传递性内嵌了作用域**：`rightPanelPreviewTabId`（`preview-panel-helpers.ts:208-210`）= `preview:${previewTabId}`，而 `previewTabId`（`:161-174`）= `file|diff|markdown|dev-server:${previewScopeKey}:…`，`previewScopeKey`（`:154-159`）= `session:${sid}` / `project:${pid}` / `global`。⇒ 会话粒度是**逐文档**（比 `${kind}:${tabScopeId}` 更细），且 sessionId 为空时会回落到 `project:` / `global` 桶。preview 侧真正要改的是上一条列的 `:151-156` 与 `:168-172` 两处落位/激活。
  - `removeRightPanelTabsForSession`（`ui-store.ts:120-133`）语义并入新模型：实测其筛选条件是 `:124-126` 的 `t.sessionId === sessionId`（**按字段，不按 id 前缀**），故会话化后必须继续写真实 `sessionId` 字段，全局桶保持 `null` 而**不得**把 id 里的 `'global'` 字面量写进该字段，否则删除会话时静默漏清、旧会话 tab 残留；不留两套机制
  - 验证：
    - `[自动]` **helper 收口（❌16）**：改造后 `grep -n "rightPanelActiveTabId:" src/renderer/src/stores/ui-store.ts src/renderer/src/stores/ui-store-tab-slice.ts src/renderer/src/stores/preview-panel-slice.ts` 应只剩 `ui-store.ts` 的 map 初值 1 行（改造前实测 20 行），其余 19 处写入全部经 `right-panel-scope.ts` helper 返回 patch；仍有散写即说明有落点漏改
    - `[自动]` 三套 tsc 零错误；grep 确认 `syncSessionScopedState` 已有调用方、无第二套作用域机制并存；grep 确认无残留 `tab.kind === 'files'` 式的**去重**判断（渲染分支的 kind 判断保留）
    - `[人工]` 会话 A 开 文件+终端+摘要 → 切会话 B → 面板只剩 B 的 tab（或空）→ 切回 A → A 的 tab 与 activeTab 完整还原
    - `[人工]` **切到 B 后在 B 里点 TitleBar 的 Files 按钮能真正打开 B 的文件 tab**（专测 ❌12 的单例冲突，不能只激活不显示）
    - `[人工]` 在 B 里点过任意 tab 再切回 A，A 展示的仍是它自己的 activeTab（专测 activeTabId 会话化）
    - `[人工]` TitleBar 的 `ensureFilesTab()`（`components/layout/TitleBar.tsx:100`，**无参**调用，接口 `ui-store-interface.ts:274` 该参可选）仍能在当前会话正确打开（依赖写入方的 `activeScopedSessionId ?? activeSessionId` 兜底；现状该路径产出的 files tab `sessionId = null`，会话化后不得继续落在 `'global'` 桶）
    - `[人工]` **同会话内**收起右侧面板 / 切走 browser tab 再切回，webview 不重新加载（常驻层未受过滤影响）；切会话会 remount `BrowserPanel` 属既有行为（`browserPanelKey` 已按会话作 key），不计本批缺陷
    - `[人工]` **删除当前会话后，右侧面板显示的是回落到的那个会话的 tab，而不是空白**（专测 ❌15 的作用域旁路）
    - `[人工]` **关闭某会话的最后一个 tab 会收起面板；切到另一有 tab 的会话后面板内容正确**（专测 ❌14 的「按作用域判空」）
    - `[人工]` `tabScopeId` 落到 `'global'` 桶（完全无会话）与「有 sessionId 的全局域会话」两类不互相污染；SubAgents / preview / goal / browser tab 在切换后不串会话
    - `[人工]` 删除会话后其 tab 不留存；点击 Files / Context 按钮（`components/layout/SessionConversationPane.tsx:121` `handleOpenFilesPanel`、`:128` `handleOpenSummaryPanel`，均为点击回调而非切换副作用）不重复追加同会话 tab
    - `[人工]` preview tab 关闭后左侧 preview 列表与右侧 tab 同步消失（双层栈语义未破）
    - `[人工]` Goal tab：同项目两个会话各开各的 Goal，互不覆盖 `goalId`。**边界声明**：同一会话内先后打开多个 Goal 仍共用那张 `goal:${tabScopeId}` 并在 `:96` 覆写 `goalId`（现状行为），本批不改、不得写成已修复

### 步骤 4：Tab 标题栏菜单改造（改进 M6）

- [ ] 步骤 4：`src/renderer/src/components/layout/RightPanelHeader.tsx` 三处改造
  - 移除「+」菜单 Goals 项（`:214-217`）及 `RightPanel.tsx:228` 的 `openGoalPanel` 装配路径，Goal 面板仅由聊天窗目标触发（现存入口 `GoalSessionControls.tsx:254 openGoalPanel(...)`，由 `GoalSessionBar` 渲染、挂在 `InputArea/index.tsx:332`，删菜单不影响入口存活）
  - **同步收窄 props**：`onAddGoals` 的类型声明（`RightPanelHeader.tsx:44`）与解构形参（`:160`）在删除 Goals 菜单项后成为未用参数，须与装配处一并移除（`noUnusedParameters` 会报错）
  - 「关闭右侧面板」按钮（`:225-233`）改为「更多」下拉：关闭当前 / 关闭其他 / 关闭所有 / 关闭右侧面板
  - store 新增 `closeAllRightPanelTabs` / `closeOtherRightPanelTabs`（作用域为当前会话，落在 `ui-store-tab-slice.ts`），批量关闭必须复用 `ui-store.ts:103 closeRightPanelTab` 逐项关（preview 双层栈语义见步骤 3），不要在 tab-slice 里另写一套 filter
  - 「关闭当前后 activeTab 落位相邻 tab」现状不满足：`closeRightPanelTab` 取的是 `tabs[tabs.length - 1]`（最后一个），本步需一并修正为相邻优先（被关闭项的后一项，无后项取前一项）
  - `TabButton`（`:66-150`）增加右键菜单：**该函数有两个返回分支** —— `:123-133` 的 `if (!animated)` 走普通 `<button>`、`:136-148` 走 `<motion.button>`（函数闭合 `:150`）。`ContextMenuTrigger asChild` 必须**同时覆盖两个分支**（或把两分支合并成同一 element 后再包），只包 motion 分支会让 `animated=false` 路径的右键静默失效；asChild 透传事件，不能把 button 嵌进 button。菜单项与「更多」下拉一致，复用 `components/ui/context-menu.tsx`
  - 验证：
    - `[自动]` 三套 tsc 零错误
    - `[人工]`「+」菜单无 Goals；聊天窗有 Goal 时仍能正常打开 Goal tab
    - `[人工]` 四个关闭动作结果正确，关闭当前后 activeTab 落位相邻 tab
    - `[人工]` Tab 右键菜单与「更多」下拉行为一致；仅 1 个 tab 时「关闭其他」无副作用
    - `[人工]` 右键不改变既有 hover/点击/拖拽手感，motion 动画未因 asChild 包裹丢失
    - `[人工]` 中英文案齐全，无 `defaultValue` 裸奔

### 步骤 5：首条消息顶部间距（改进 M1）

- [ ] 步骤 5：聊天列表顶部留白（主聊天两处表面）
  - 首选滚动容器加顶部内边距：`components/chat/MessageList/VirtualListContent.tsx:110`（`absolute inset-0 overflow-y-auto pl-7 md:pl-9`），并同步 `components/chat/MessageList.tsx:92`（`exportAll` 分支容器）两处一致
  - 若改用 virtualizer `paddingStart`（`components/chat/MessageList/useMessageListScroll.ts:229-246`），必须同步校验收纳 `scrollToBottomImmediate`（`:122-137`）与「进行中当前轮 user message 顶部吸附卡」（`VirtualListContent.tsx:227`）的 offset 计算
  - 范围外（不改）：子 Agent 播放视图 `components/chat/TranscriptMessageList.tsx:126`（消费者 `layout/SubAgentExecutionDetail.tsx:372`）与 `components/chat/MessageList/StaticMessageTranscript.tsx:98`
  - 验证：
    - `[自动]` 三套 tsc 零错误
    - `[人工]` 新会话首次发送后第一条消息与顶部有可见间隔
    - `[人工]` 流式吸附卡置顶不重叠不抖动；长会话滚到底仍贴底
    - `[人工]` 上滑出现「加载更早」行时（`VirtualListContent.tsx:134` 的 `pt-3`）间距不翻倍
    - `[人工]` 导出全部视图与主列表间距表现一致

### 步骤 6：文件选中发送读取内容注入（改进 M4）

- [ ] 步骤 6a：把死链里的读取实现迁到真实发送路径
  - 新建 `src/renderer/src/lib/agent/selected-file-context.ts`，迁移 `lib/agent/dynamic-context.ts:185-252 buildSelectedFileContext`（含 `resolveFileContextBudget`、`truncateToTokenBudget`、SSH 分支、skipped 收集、displayPath 归一），改为**同时返回结构化逐文件结果**（路径 / 行数 / 是否截断 / 跳过原因 / 失败）。**注意 `:254 resolveFileContextBudget` 与 `:265 truncateToTokenBudget` 在 185-252 之外，必须一并迁走** —— 留在原地会通过 `:257`/`:271` 留住 `estimateTokens` 等使用者，下面那条「失效 import」判据就不成立
  - **迁出即删旧**：同步删除 `dynamic-context.ts:73-83` 的 `if (selectedFiles.length > 0)` 分支及其上方 `:38 useUIStore.getState().selectedFiles ?? []` 读取（该 slice 全仓零写入方，永空），`buildRuntimeReminder` 保持零调用、不复活；`:16-18` 三个预算常量随函数一并迁走，`dynamic-context.ts` 不残留第二份实现
  - **同步清理失效 import**（第四轮已逐个复核成立）：删掉 `:38` 与 `:73-83` 并整体迁走后，`dynamic-context.ts:1 useUIStore`（本文件仅 `:1`/`:38` 两处）、`:9 ipcClient`（仅 `:9`/`:203`）、`:12 estimateTokens`（仅 `:12`/`:213`/`:271`）三者全部失去使用者；tsconfig 链已开 `noUnusedLocals` / `noUnusedParameters`（基线 `@electron-toolkit/tsconfig`），不清理会以 TS6133 直接编译失败
  - 在 `hooks/use-chat-actions.ts` 发送装配处接入：`:122-129` 已按 `session.scope` 解析 `workingFolder` / `sshConnectionId`，在 `:173 userContent` 组装前解析输入文本中的 `<select-file>`（`lib/select-file-tags.ts:159 parseSelectFileText`）→ 解析绝对路径 → 读取 → 拼 `<system-reminder><selected_files>` 追加进**发给模型的内容**
  - **注入的唯一来源 = 消息文本本身**：`parseSelectFileText` 已同时识别 `<select-file>` 标签与 `@{path}` token（`lib/select-file-tags.ts:27 syntax` 联合、`:35 SELECT_FILE_TOKEN_RE`、`:183-187` 两者均产出 `type:'file'` 段）并在 `:130-138` 按位置去重，覆盖两条输入通道。其余两条**不得**再各自注入：
    - `ui-store.selectedFiles`（`:304`）永空、且 `:306 toggleFileSelection` 零调用 → 本步不接入，列入遗留清理批
    - composer 局部 `selectedFiles` → `InputArea/index.tsx:270-271` 映射成 `sendOptions.selectedFileReferences`，实测在 `use-chat-actions.ts:31` 声明后**无任何读取方**（全仓仅 3 处命中），属死字段，不作为注入入口
    - 注意 `:130-138` 的去重是**按标签位置**（重叠区间合并），不是按文件路径：同一文件被引用两次会得到两个 file 段，路径级去重必须在新模块里自己做
  - 去重判据：同一文件在一轮请求里最多出现一次（按归一化后的绝对路径去重）
  - 验证：
    - `[自动]` 三套 tsc 零错误（本步纯渲染端，不加 `dotnet build`）；`grep -rn "buildSelectedFileContext" src/renderer/src` 命中**恰好两个文件** = 新模块内的定义 + `hooks/use-chat-actions.ts` 的唯一调用方，且 `dynamic-context.ts` 零命中
    - `[人工]` 选中一个 .ts 文件发送 → Agent 无需再调用 Read 即可回答文件内容，且后续轮次不重复累积该注入（查上下文查看请求体）
- [ ] 步骤 6a-2：把「发给模型的内容」与「落库文本」分离（第 3 轮 ❌13 的结论，本步必做；依据按第四轮 ⚠️31 改写）
  - **为什么仍要分离，但理由不是「气泡会脏」**：第四轮实测气泡与会话标题两条路径都已剥离 `<system-reminder>` —— `UserMessage.tsx:57` → `extractEditableUserMessageDraft`（`lib/image-attachments.ts:168`）→ `extractEditableText:132-155` 的 `:148 stripSystemRemindersOnly`，标题另在 `chat-store/index.ts:289` 用正则再剥一次 ⇒ 前版「注入块进 content 后气泡与历史会显示一大段原始 XML」为**假**。真正被污染的是 **store 与 DB 的 `text` 字段**：`index.ts:182-193` 的 `userText` 是从 `params.messages[last].content` 逐块 join 反推、**不做任何剥离**，`:214` 直接作为乐观消息的 `text` 并经 `:258 dbUpsertMessage` 落库，此后一切以 `text` 为源的消费方（复制、检索、后续任何改用 text 的视图）都会拿到原始 XML。加 `userMessageText` 是把干净文本在源头固定下来，不是修气泡。
  - **meta 必须在 store 内、且在构造期挂上（⚠️32）**：乐观 `userMessage` 现状字段只有 `id / role / text / [content] / createdAt`，**没有 `meta`**；`UserMessage.tsx:340` 读的是 `meta?.selectedFileReads`，不挂 meta 就永远不显示。`sendMessage` 返回 boolean（`use-chat-actions.ts:234 return started`），调用方拿不到消息 id；`updateMessage`（`session-slice.ts:434-443`）只做 `Object.assign` **不写库**，事后补挂刷新即丢。**时机只能更早**：`beginUserTurn`（`index.ts:244`）经 immer 会把该对象深冻结且全仓无 `setAutoFreeze`，所以「`:258` 之前任意时刻挂」不成立，只能在构造乐观消息那一段（真实区间 **`:208-220`**）一次性带出。
  - `stores/chat-store/index.ts` 改动：
    - `sendMessage` params（接口 `:69-113`，实现 `:168`）新增两个**仅渲染端使用**的字段：`userMessageText?: string`、`meta?: MessageMeta`（实测现入参无任何可承载 meta 或纯文本的字段，只有 `messages[].content`）
    - `userText` 派生（`:185-192`）改为优先取 `params.userMessageText`，回落到现有从 content 反推的逻辑（两个字段都可选，不影响任何既有调用方）
    - `:208-220` 乐观消息补 `...(params.meta ? { meta: params.meta } : {})`
    - **`:330-344` 的 `agent/run` payload 在 `:335` 处 `...params` 全量透传，须先剔掉 `userMessageText` / `meta` 再发**。定性按第四轮校准：Worker 侧 `Agent/AgentRuntimeTools.cs:42,50-56` 用 `JsonElement` 逐字段取、未知键被忽略（`cron-runtime.ts:417/420` 早已有字段随 spread 进 Worker），所以剔除是**卫生措施**——避免 UI 元数据经 `:56 parameters.Clone()` 驻留整个 run 生命周期——而不是不改就会出功能错。
  - `stores/chat-store/db-helpers.ts` **无需改动**（已实证）：`serializeMessage:110` 起、`:127` 有 `if (msg.meta) Object.assign(meta, msg.meta)`（无白名单，全量并入），`deserializeMessage:152-168` 用 delete 黑名单恢复其余 meta 键，`selectedFileReads` 随通用通道持久化与回读；旁证 `cron-runtime.ts:226-237` 已用同一通道存 `cronTaskId/cronRunId`
  - 已接受的后果（写进报告，不算缺陷）：注入只存在于 Worker 内存会话，DB 转录里只有干净文本；因此**重启后该轮注入不再出现在模型历史**，与「单轮生效、不跨轮累积」的目标一致，也与既有会话恢复语义一致
  - 验证：
    - `[自动]` 三套 tsc 零错误；`grep -n "userMessageText\|meta" src/renderer/src/stores/chat-store/index.ts` 确认这两个渲染端字段在 `:330-344` 的 `agent/run` payload 组装前已被剔除（不出现在发给 Worker 的对象里）
    - `[人工]` 带文件发送后，用户气泡只显示自己输入的文字 + 「已读 N 行」摘要，不出现原始 `<selected_files>` XML
    - `[人工]` 重启应用后重新打开该会话，气泡与「已读」摘要显示不变（meta 已从 DB 回读）
- [ ] 步骤 6b：边界与退化
  - 保护：token 预算（沿用 `resolveFileContextBudget`）+ 行数硬上限双保险，超限截断并标 `truncated`
  - **路径解析规则必须写实（第四轮 ⚠️34）**：`<select-file>` 里存的是**相对 `workingFolder`** 的相对路径（`lib/select-file-editor.ts:145-147`、`components/cowork/use-file-tree.ts:297` 产出的 `sendPath`），而 `fs:read-file` 要绝对路径。新模块必须自己完成「`workingFolder` + 相对路径 → 绝对路径」拼接，并做**越界防护**（拼接后归一化仍须落在 `workingFolder` 内，否则视为不可解析）；否则下面「路径不可解析 → 仅路径引用」会把项目文件**全部**退化成不读盘。`@{path}` token 通道同理需明确是绝对还是相对。
  - 跳过：pdf / office / 二进制 / 非文本扩展名 → meta 标 `skipped`。**注意母本无扩展名白名单**，`skipped` 判定与新模块自算的 `lineCount` / `maxLines` 一样都得在 `selected-file-context.ts` 里实现，不是继承来的
  - **失败态当前判不出来（第四轮 ⚠️35）**：`src/main/ipc/fs-handlers.ts:73-80` 对 ENOENT / EISDIR **返回 `''` 而不抛**，`ssh-fs-handlers.ts:79-81` 任何错误同样返回 `''` ⇒ 「读失败」与「空文件」在现有 IPC 语义下不可区分。单文件读失败 → `failed` 且**不阻断发送**这条要有可落地判据：由新模块用「先 stat / 存在性判定或路径解析结果」来定 `failed`，明确不得把 `''` 当失败，也不得为区分失败去改主进程返回 shape（那会牵动 `lib/ipc/channels.ts` 与 `messagepack-channel-routing.ts`，超出本批范围）
  - 退化：全局会话（无 `workingFolder`）与路径不可解析 → 仅路径引用，不读盘
  - **旁路调用方边界（第四轮 ⚠️33）**：注入挂在 `handleSendMessage` 的「文本 → userContent」这一步，但另有 7 个**绕过该装配、直接调 store 级 `chatStore.sendMessage`** 的调用方 —— `hooks/use-chat-actions.ts:408/464/542`、`hooks/use-background-subagent-wakeup.ts:78`、`hooks/use-channel-auto-reply.ts:264`、`lib/tools/cron-runtime.ts:406`、`lib/tools/project-send-message.ts:103`。这些路径的文本若含 `<select-file>` / `@{path}` 会**静默不注入**。本批定性为**已接受边界**（这些入口的文本由程序生成、不来自用户选文件），但必须写进验证报告，不得留成未声明的洞。
  - meta 写入 `MessageMeta.selectedFileReads`（接口名 `lib/api/types.ts:358`，字段 `:361`，元素类型 `:331 SelectedFileReadItemMeta` / 容器 `:344 SelectedFileReadsMeta`；视图 `components/chat/user-message-views.tsx:40-68`（真实逻辑块 `:33-72`）六种状态与 `UserMessage.tsx:340` 消费均已就位，**无需新建组件**）
  - **排队消息重放同一条装配路径**：`getRequestText`（`use-chat-actions.ts:765-780`）把文本原样存进 `PendingSessionMessageItem`（`enqueuePendingSessionMessage:782-801`），重放经 `:909-915 handler({ text: item.requestText, queuedDispatch: true })` 回到同一发送入口，因此注入必须挂在「文本 → userContent」这一步，天然对排队重放生效；不得挂在 `handleSend` 或 composer 侧，否则排队消息会漏注入。需实测「流式中排队 → 出队后仍带注入且只带一次」
  - 验证：
    - `[自动]` 三套 tsc 零错误；`grep -rn "<selected_files>" src/renderer/src` 仅命中新建的 `lib/agent/selected-file-context.ts` 一处生产者，发送链路无第二条注入路径
    - `[人工]` >1000 行文件显示截断标记，Agent 明确说明只看到部分内容
    - `[人工]` 选中 pdf → 显示跳过文案，Agent 走自身工具或说明无法读取
    - `[人工]` SSH 项目选中远端文件能读取；全局会话选中文件仅路径引用不报错
    - `[人工]` 用户消息下方「已读 N 行 / 截断 / 跳过 / 失败」文案与实际一致
    - `[人工]` 同一文件既从文件树加入又从 `@` 搜索加入 → 只注入一次
    - `[人工]` 流式进行中排队的带文件消息，出队后仍有注入且不重复

### 步骤 7：工具分类说明提示词（改进 M3 剩余部分）

- [ ] 步骤 7：分类元数据收敛到单一来源并渲染进 Prompt
  - 新建 `src/runtime/WishfulClaw.Core/Tools/ToolCategoryCatalog.cs`：分类名 → 优先级 → 一句话说明，覆盖现存全部分类（23 个 provider `Category` + 直接执行器 `file/search/shell/task/memory`，实测注册入口 `Agent/Tools/ToolModule.cs:32 RegisterDirectExecutors`），未列者保留 100 兜底
  - 改 `Core/Tools/ToolRegistry.cs:25-41`：`CategoryPriorities` 字典改为读取该目录，避免两份表；**保持 `StringComparer.OrdinalIgnoreCase`**（`:25` 现状）。实测全仓 23 个 provider 分类与直接执行器分类**均为小写 kebab，当前不存在大小写差异** —— 保留该比较器不是修 bug，而是给后续 provider 留容错，勿在改动中顺手换成 Ordinal
  - 改 `Persona/PromptBuilder.cs:235-247 <tool_calling>`：按目录顺序渲染分类清单，保留 `:240-241` 既有 `use_capability` list→call 引导，不重复表述；遵循提示词精简规范（一行一类、不堆例子）
  - 分层合法性：Persona 依赖 Contracts + Core + Workspace，可引用 Core（`WishfulClaw.Persona.csproj:11` 已 `ProjectReference` Core）；不得反向依赖
  - **排序副作用要在结论里写明**：`ToolRegistry.cs:163,179` 用 `GetCategoryPriority` 给工具定义打优先级，`:186-192` 按 Priority→名称排序且注释自陈目的是 "deterministic prefix bytes"。把约 20 个原本并列 100 的分类改成具体值 → `tool/list` 名称序列变化 → **一次性 prefix cache 失效**（之后恢复稳定）。这不是缺陷，但必须作为已知代价记录，不能默默发生
  - 验证：
    - `[自动]` `dotnet build src/runtime/WishfulClaw.sln` **0 error，且与改动前基线相比无新增 warning**。不要写「0 error / 0 warning」也不要给解决方案级 build 加 `-o`：`dotnet build <sln> -o <dir>` 会被 MSBuild 判为解决方案级 `--output` 不支持并稳定报 1 条 `warning NETSDK1194`，与「0 warning」互斥（第四轮 ⚠️29）。需要临时输出目录避开文件锁时，只对**单工程**用 `-o`（如 `dotnet build src/runtime/WishfulClaw.Worker/WishfulClaw.Worker.csproj -o <tmp>`）。基线实测（2026-09-05 / `577712b`，不带 `-o`）：**0 error / 0 warning**，故「无新增 warning」在本仓等价于可判定的「仍为 0」
    - `[自动]` 新增 `tests/WishfulClaw.ToolCategoryCatalogRegressionTests/`（Program.cs 断言式，范式照 `tests/WishfulClaw.ToolConcurrencyRegressionTests`），并在 `WishfulClaw.sln` 补 `Project(...)` 条目（sln 内已有 4 个同类回归工程，Cron / MemoryRecall 两个未入 sln，不要照那两个抄）。断言：`ToolCategoryCatalog` 分类集合 ⊇ `grep -rn "string Category =>" src/runtime/WishfulClaw.Agent/Tools/Providers` 的实际集合 + 直接执行器分类，缺项即失败；并断言大小写不敏感查找命中
    - `[自动]` **`tool/list` 名称序列前后对比（第四轮 ⚠️29 补可运行入口）**：在同一回归工程内新增 `--dump-tool-order` 分支，用 `new ToolRegistry()` 复刻 `Agent/Tools/ToolModule.cs:29-73` 的注册（23 个无参 provider 按 `GetType().Name` Ordinal 排序 + `PushCategory/PopCategory`；直接执行器照 `:124-151` 逐个 `registry.Register(new XxxTool(), "cat")`），打印 `GetToolDefinitions()`（`Core/Tools/ToolRegistry.cs:126`，public）的 `Name` 序列。命令：
      - **取数顺序（不能用 `git stash`：回归工程本身就是新代码，stash 会把它一起收走）**：① 先只提交新工程 + `ToolCategoryCatalog.cs` 本体（**尚未接入 `ToolRegistry`**），跑 `dotnet run --project tests/WishfulClaw.ToolCategoryCatalogRegressionTests -- --dump-tool-order` 存 `docs/plans/iter-v2-24/plan-issues-batch-2/tool-order-before.txt`——此时读到的就是现状优先级序；② 再改 `ToolRegistry.cs:25-41` 与 `PromptBuilder.cs` 并重跑同一命令存 `tool-order-after.txt`；③ `diff` 两文件确认**仅按预期分组变化**，两份产物随计划目录一并 commit
      - **镜像失真必须显式承认**：该构造是 `ToolModule.cs` 的镜像副本，provider 列表变了而测试没同步就会失真。加一条守卫断言：镜像 provider 数量 == `grep -rn "string Category =>" src/runtime/WishfulClaw.Agent/Tools/Providers | wc -l`（实测 23），不等即失败。**不得**为了让测试复用而把 `RegisterDirectExecutors`（`private static`，`:121`）改成 public 或加 `InternalsVisibleTo`；若实现期判定镜像不可接受，允许的最小替代是把 provider 列表抽成 `ToolModule` 的 `public static` 工厂供 prod 与测试共用，但那属于 prod 结构改动，须在验证报告单列
    - `[自动]` `dotnet run --project tests/WishfulClaw.ToolCategoryCatalogRegressionTests` 退出码 0
    - `[自动]` 涉 C#：`node scripts/publish-aot-worker.mjs` 通过（AOT 规范第 10 条），0 error / 0 warning
    - `[人工]` 实测一轮：核心工具未覆盖时 Agent 主动 `use_capability` 查找并按分类命中
    - `[人工]` 打印改动前后 `<tool_calling>` 段的 UTF-8 字节长度并记录差值（该段是 `PromptBuilder` 里的裸 raw string，`DefaultCharacterBudget = 20_000`（`:24`，仅用于 `:76`）与 `memoryBudget = 6000`（`:188`）都不约束它，"预算溢出告警" 恒真、不可作为判据），确认增量在预期内

### 步骤 8：全量验证与归档

- [ ] 步骤 8：本批完整验证 + 文档
  - `[自动]` `npx tsc --noEmit -p tsconfig.web.json` / `tsconfig.node.json` / `tsconfig.json` 三配置全部零错误
  - `[自动]` `dotnet build src/runtime/WishfulClaw.sln` **0 error，且与第 4 版基线（`577712b`）相比无新增 warning**。解决方案级 build **不加 `-o`**（会稳定报 `NETSDK1194`，与「0 warning」互斥，见步骤 7）；遇文件锁需临时输出目录时只对单个 csproj 加 `-o`
  - `[自动]` 涉 C# 序列化改动复核 AOT 规范：新增类型注册进 `JsonSerializerContext`、`WorkerResponse.Json` 显式传 `JsonTypeInfo`（本批步骤 7 只加静态表与文本，预期不新增序列化类型，若步骤 3/6 引入新契约需回补）
  - `[人工]` 按步骤 1-7 的 `[人工]` 检查点逐条实测并记录结果
  - 产出 `verification_report.md`；更新 `docs/PROGRESS.md` 记录本批功能单元与待裁定项
  - 验证：VERDICT 由老大裁定（PASS / FAIL / PARTIAL），Agent 不自行判定完成

## 涉及文件

> 前端路径一律从 `src/renderer/src/` 写全，避免按目录前缀拼接出错。

**新建**
- `src/renderer/src/components/chat/SessionTodoPanel.tsx` —— 移植 InlineStepsPanelCard（步骤 2a）
- `src/renderer/src/lib/agent/selected-file-context.ts` —— 迁出 selected_files 读取（步骤 6a）
- `src/renderer/src/stores/right-panel-scope.ts` —— `activateRightPanelTab` / `closeRightPanelScope` 两个纯 helper + `Record<tabScopeId, string>` 激活项读写（步骤 3，❌16 的根因修法；20 个 `rightPanelActiveTabId` 落点统一走此处）
- `src/runtime/WishfulClaw.Core/Tools/ToolCategoryCatalog.cs` —— 分类优先级与说明单一来源（步骤 7）
- `tests/WishfulClaw.ToolCategoryCatalogRegressionTests/{Program.cs, WishfulClaw.ToolCategoryCatalogRegressionTests.csproj}` —— 分类覆盖回归（步骤 7）
- `docs/plans/iter-v2-24/plan-issues-batch-2/{exploration_findings,plan,compliance_report,review_report,verification_report}.md`
- `docs/plans/iter-v2-24/plan-issues-batch-2/tool-order-{before,after}.txt` —— 步骤 7 的 `tool/list` 名称序列前后快照（prefix cache 一次性失效的实证留档）

**修改（前端）**
- `src/renderer/src/components/chat/FileAwareEditor.tsx` —— IME 时序 + onBlur（步骤 1）
- `src/renderer/src/components/chat/InputArea/index.tsx`、`src/renderer/src/components/chat/InputArea/session-todo-status-list.tsx` —— Todo 面板挂载、510→<500 行收口（步骤 2）
- `src/renderer/src/components/chat/TodoCard.tsx` —— 删除（步骤 2b）
- `src/renderer/src/stores/ui-store.ts`、`src/renderer/src/stores/ui-store-tab-slice.ts`、`src/renderer/src/stores/ui-store-interface.ts`、`src/renderer/src/stores/preview-panel-slice.ts`、`src/renderer/src/stores/chat-store/session-slice.ts`、`src/renderer/src/components/layout/SubAgentsPanel.tsx` —— tab 会话作用域（步骤 3）
- `src/renderer/src/stores/right-panel-tab-factories.ts`、`src/renderer/src/stores/ui-store-browser-slice.ts` —— **预期零改动**（第 4 版 ⚠️38 从必改名单移出）。实测前者只有 `ensureRightPanelTabs:9` 的 null 兜底、`getDefaultRightPanelTabs:15` 返回 `[]`、`closeRightSidePanels:19` 与常量表，**不构造任何 tab id**；后者 `openBrowserTab:31-32` 只是把 `sessionId` 透传给 `ensureBrowserTab`，会话化落在 `ui-store.ts:410`。若实现期发现需要改，需在验证报告里说明理由
- `src/renderer/src/components/layout/RightPanel.tsx` —— 步骤 3（常驻层判据 `hasBrowserTab:95-96` / `hasFilesTab:108` 保持读未过滤数组，`⚠️37`）+ 步骤 4（`onAddGoals` 装配收窄、`+` 菜单去 Goals）
- `src/renderer/src/components/layout/RightPanelHeader.tsx` —— Goals 移除、更多下拉、Tab 右键（步骤 4）
- `src/renderer/src/components/chat/MessageList/VirtualListContent.tsx`、`src/renderer/src/components/chat/MessageList.tsx` —— 顶部间距（步骤 5，两处表面必须一致）
- `src/renderer/src/components/chat/MessageList/useMessageListScroll.ts` —— 仅当改用 virtualizer `paddingStart` 时才动（步骤 5 备选方案）
- `src/renderer/src/hooks/use-chat-actions.ts`、`src/renderer/src/lib/agent/dynamic-context.ts` —— 文件读取注入编排与迁出（步骤 6a；`lib/select-file-tags.ts` 只调用不改）
- `src/renderer/src/stores/chat-store/index.ts` —— 步骤 6a-2 的必改方：`AgentActions.sendMessage` 入参加 `userMessageText` / `meta`、乐观消息构造区间 `:208-220` 挂 `meta`、`agent/run` payload（`:330-344`，`...params` 在 `:335`）剔除两个渲染端字段。**第四轮 ❌13 的「半修」正是此项此前未列入本表**
- `src/renderer/src/lib/api/types.ts` —— **预期零改动**（`MessageMeta.selectedFileReads:361` + `SelectedFileReadItemMeta:331` + `SelectedFileReadsMeta:344` 字段已齐备，视图侧无需新类型；仅当实现期发现字段不够时才改）
- `src/renderer/src/locales/zh/chat.json`、`src/renderer/src/locales/en/chat.json` —— 新文案（步骤 2/4）

**修改（C#）**
- `src/runtime/WishfulClaw.Core/Tools/ToolRegistry.cs` —— 优先级表改读目录（步骤 7）
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` —— 分类说明清单（步骤 7）
- `src/runtime/WishfulClaw.sln` —— 纳入步骤 7 新回归工程

## 参考源码（读，不改）

- OpenCowork：`D:\claw\OpenCowork`
  - `src/renderer/src/components/cowork/StepsPanel.tsx:328,371,373-402,433-444` —— InlineStepsPanelCard 收起/限高/动画（步骤 2）
  - `src/renderer/src/hooks/use-chat-actions.ts:594,848-953` —— selected_files 读取与注入、1000 行上限、pdf/office 跳过（步骤 6）
  - `src/renderer/src/components/chat/FileAwareEditor.tsx:792-796` —— onBlur 复位 composition 挡板（步骤 1，仅 `isComposingRef` 一行可对齐）
  - `src/renderer/src/components/chat/InputArea.tsx:4258` —— Todo 面板挂载层级与 `projectScoped` 门禁（步骤 2）
- 本仓既有范式与判据来源：
  - `src/renderer/src/components/chat/InputArea/composer-flyovers.tsx:56,63` —— 悬浮层 class 范式（步骤 2a 借样式，文件本身不改）
  - `src/renderer/src/components/chat/file-aware-editor-utils.ts:221` —— `renderDocument` 里 `root.replaceChildren()` 的真实重建落点（步骤 1 的绕过对象）
  - `src/renderer/src/stores/ui-store.ts:103-119` —— `closeRightPanelTab` 的 preview 双层栈关闭语义与 activeTab 落位（步骤 3/4）；`:120-133 removeRightPanelTabsForSession` 按 `t.sessionId` **字段**筛选（非 tab id），会话化后该字段仍须写原始 sessionId
  - `src/renderer/src/stores/ui-store.ts:214-227` —— per-session 标量 map 先例（`bottomTerminalDockOpenBySessionId: Record<sid,bool>`）；❌14 要求 `rightPanelActiveTabId` 与「最后一个 tab 关闭 → 收起」按作用域记录，即照此形办，不是备选方案
  - `src/renderer/src/components/ui/context-menu.tsx` —— 右键菜单（步骤 4）
  - `src/renderer/src/components/chat/ToolCallCard/index.tsx:155-166` —— `TaskList` 结果卡摘要，步骤 2b 的回归对象
  - `src/renderer/src/lib/agent/dynamic-context.ts:185-252` —— selected_files 迁移母本（步骤 6a）
  - `tests/WishfulClaw.ToolConcurrencyRegressionTests/` —— .NET 回归工程范式（步骤 7）
  - `scripts/publish-aot-worker.mjs` —— AOT 构建验证入口（步骤 7）

## 提交节奏

每步 Mini 验证（三套 tsc，涉 C# 时加 `dotnet build`）通过后立即 commit，一步一个 commit；步骤 2 与 6 各含 a/b 两个子提交。Plan 内只 commit 不 push，全部步骤通过验证后按 AGENTS.md 统一 push。

## 本批次不做

- M2 侧栏右键菜单（老大判定已完成）
- 迭代 24 审查遗留：I24-11 automation 权限、I24-15 主进程失败日志、review-12 与 plan-review-fixes 清单更正
- 三份计划归档：plan-tool-concurrency-queue、plan-context-manifest（含「显式修复上下文」入口缺口）、plan-compression-display（含压缩孤儿组件退役）
- **压缩取消竞态实测**：属 plan-compression-display 的 5 场景运行期复验范围，本批不重复验证
- 死代码清理批：`lib/agent/visual-context.ts`、`ui-store.selectedFiles` slice 与 `toggleFileSelection`、`SendMessageOptions.selectedFileReferences`（`use-chat-actions.ts:31` 声明后无读取方）、`fs:read-text-file-lines` 无调用端点、`dynamic-context.ts` 其余未迁部分、review 面板链（`ChangeReviewSheet.tsx` / `RunChangeReviewCard.tsx` 零 importer 与 `kind:'review'` 零创建方）
- Plan A 全局任务工作台 / Plan B 会话 Todo 端到端测试、自动更新端到端、真实 Electron E2E（属用户实测或非本批范围）
