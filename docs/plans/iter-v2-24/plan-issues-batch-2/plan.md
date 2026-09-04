# Plan: issues 批次 2 —— 知识库 2026-09-01~09-03 待办收口

> 迭代：v2-iter-24　分支：`dev/v2-iter-24`　产品版本：0.2.24（待发布）
> 探索结论：`./exploration_findings.md`
> **本版：第 5 版（精简版）** —— 老大 2026-09-05 裁定「先精简 plan 再执行」，砍掉镀金项后直接进入阶段四执行态，不再做规划验证轮次。历轮 ❌/⚠️ 记账见 git 历史（`git show fe5dcc3` / `git show c4b395c`），不再回写本文。
> 范围确认（2026-09-05 老大拍板）：知识库其余条目全部纳入本批；M2 侧栏右键菜单判定为已完成、不再处理；B2 直接抄 OpenCowork 组件；M4 移植「发送前读内容注入」。

## 精简掉的项（相对第 4 版）

| 砍掉 | 理由 |
|------|------|
| 步骤 7 新建 `tests/WishfulClaw.ToolCategoryCatalogRegressionTests/` 回归工程 + 改 sln | 断言「分类目录 ⊇ 实际分类集合」需镜像 `ToolModule` 注册逻辑，第 4 版自陈「镜像失真必须显式承认」——一个承认自己会失真的测试价值低于其维护成本。分类覆盖由编译期 + 人工核对保证 |
| 步骤 7 `--dump-tool-order` before/after 快照 + 两个 txt 产物 | 记录的副作用（`tool/list` 顺序变化 → 一次性 prefix cache 失效）是自愈的、无功能影响。保留为验证报告里的一句已知代价即可，不值得建一套取数流程 |
| 步骤 3 的 grep 命令作 `[自动]` 门禁 | helper 收口本身保留（标量改 `Record` 后 20 个落点必须一起改，否则就是漏改），但把 grep 写成验收门禁是仪式。降级为实现约定 |
| 头部与正文的多轮 ❌/⚠️ 记账叙事、论辩散文 | 属 `compliance_report.md` 职责，泄漏进 plan 后让执行者先读 40 行「为什么上一版错了」才知道要做什么。压缩为约束条目 |

## 目标

修掉三条用户可感知缺陷（中文输入末字符异常、Todo 面板抢聊天窗高度、会话切换右侧面板不重置），并按 OpenCowork 成熟实现补齐 Todo 面板渲染、右侧面板 Tab 菜单、首条消息顶部间距、文件选中发送读取内容、工具分类说明提示词。

## 步骤清单

> `[自动]` = 编译/静态可验证；`[人工]` = 需应用内实测。两类都过才打 `[✓]`。
> 每步 Mini 验证通过后立即 commit，一步一个 commit；Plan 内只 commit 不 push。

### 步骤 1：中文 IME 末字符异常（B1）

- [x] `src/renderer/src/components/chat/FileAwareEditor.tsx` IME 时序加固（`[自动]` 三套 tsc 通过；`[人工]` 待老大实测）
  - **实现偏差**：IME 尾字符判据抽到新文件 `file-aware-editor-ime.ts`。原因是写进组件会让 `FileAwareEditor.tsx` 达到 502 行、越 AGENTS.md 500 行红线，而 `file-aware-editor-utils.ts` 本身已 526 行（既存越线）不宜再增。抽离后组件 482 行、守卫从 24 行压到 9 行
  - **新增 `imeSettleWindowRef` 结算窗口**（计划未列）：末字符保护若不设窗口，会误伤「发送后清空输入框」——此时 state 变短、DOM 仍持有刚发送的 1~2 个字符且编辑器保持焦点，判据会成立，导致输入框清不掉。窗口仅在 compositionend 之后开启，在 compositionstart / flushPendingInput / 布局 effect 任一路径关闭
  - `:323-334` `scheduleCompositionCommit` 的 rAF 回调：先 `syncLiveContent()` 把 IME 尾字符采纳进状态，**推迟到下一帧**（双 rAF）再解除 `isComposingRef` / `pendingUserInputRef` 并处理 `pendingRenderAfterCompositionRef`
  - `:413-416` `onBlur` 补 `isComposingRef.current = false`（对齐 OpenCowork `FileAwareEditor.tsx:794`）+ `pendingUserInputRef.current = false`（本仓自创加固，参考侧无此挡板，勿写成对齐）
  - `:205-236` 布局 effect：编辑器为 `document.activeElement` 且 selection 落在 root 内时，**判据 = DOM 文本以 state 文本为前缀且多出 ≤2 字符** → 视为 IME 尾字符，以 DOM 为准不 `replaceChildren`；多出 >2 字符仍按原逻辑以 state 为准重建
  - 真实重建落点在 `components/chat/file-aware-editor-utils.ts:221 root.replaceChildren()`，改动只在本仓 editor 组件加提前 return，**不动 utils 的渲染语义**
  - **不改** composition start/update 与 `beforeinput` 挡板语义；**不回退**到 OpenCowork `:736-752` 的 compositionend 同步 flush
  - 验证：`[自动]` 三套 tsc 零错误
  - 验证：`[人工]` 中文输入法混合序列各 ≥10 次（「中文测试嗯」「w 嗯」「拼音+英文+数字」），末字符不重复不丢失、光标不跳；连续快打 3~4 个汉字不让 rAF 走完仍无重复；输入中途切窗口再切回无残留候选串；候选中 Enter 上屏 / Esc 取消行为不变；粘贴长文本、`/` 文件提及与插件提及标签渲染不受影响

### 步骤 2：Todo 面板改为悬浮限高可收起（B2 + M5）

- [x] 步骤 2a：新建 `src/renderer/src/components/chat/SessionTodoPanel.tsx`，移植 OpenCowork `cowork/StepsPanel.tsx` 的 `InlineStepsPanelCard`（`:328`）（`[自动]` 三套 tsc 通过；`[人工]` 待老大实测）
  - 实现偏差：**零新增 i18n key** —— 折叠态摘要复用既有 `chat.todo.tasksDone`（`{{completed}} / {{total}}`，zh/en 两份都已存在），不需要计划里写的 `chat.todo.*` 新键；外层卡片删掉 `layout` 属性（两个分支都等于关闭 layout 动画，且卡片绝对定位无兄弟重排）
  - 移植：单行 header 默认收起（`:373-402` 点击展开/收起 + chevron 旋转）、展开体 `max-h-64 overflow-y-auto`（`:444`）、AnimatePresence 高度动画（`:433-443`）、卡片样式（`:371`）
  - 悬浮：外层套本仓范式 `absolute inset-x-0 bottom-full z-30`（`InputArea/composer-flyovers.tsx:56`），不再占聊天窗 flex 高度
  - **悬浮锚点必须自带一层 `relative` 包裹**：挂载点 `InputArea/index.tsx:335-339` 在 `:345` 的 `composer-shell relative …` 容器**之外**，`bottom-full` 会以更远祖先为锚导致错位。自带 `relative` 或由 2b 把挂载点移进 composer 容器内，二者择一并注明
  - 数据源沿用 `useTaskStore.getTasksBySession(draftSessionId)`（现 `InputArea/session-todo-status-list.tsx:19-21`），保留 `projectScoped` 门禁（参考侧 `InputArea.tsx:4258` 同要求）
  - 五态 tone 沿用参考映射（`StepsPanel.tsx:176 blocked` / `:178 in_review` 等）
  - **不移植变更审查按钮**：其两个消费者 `ChangeReviewSheet.tsx` / `RunChangeReviewCard.tsx` 全仓零 importer，`kind === 'review'` 无任何创建方——接一个没有出口的按钮属死链复活，已记入遗留清理批
  - **不聚合 team 任务**：现存活路径 `TodoStatusList`（`TodoCard.tsx:345`）从不读 team store，新面板与之保持同口径
  - i18n：原计划新增 `chat.todo.*` 键，实测既有 `chat.todo.tasksDone`（zh/en 双份）已够用 → **零新增**（见上方偏差）
  - 验证：`[自动]` 三套 tsc 零错误
  - 验证：`[人工]` Todo ≥15 条时面板内部滚动、聊天区高度不被挤压、composer 不上移；悬浮层底部紧贴 composer 顶部无错位；收起态单行 header 可见进度摘要且可展开；切会话只显示新会话 Todo；面板内无点击后无出口的入口
- [x] 步骤 2b：收口 `InputArea/index.tsx` 与孤儿文件（`[自动]` 三套 tsc 通过、grep 无残留、487 行 < 500；`[人工]` 待老大实测）
  - `InputArea/index.tsx`（当前 510 行，越 AGENTS.md 500 行红线）：挂载点 `:335-339` 换为新面板，新增逻辑外移使文件回到 500 行内（顺带关闭遗留项 I24-17）
  - 删除 `components/chat/TodoCard.tsx`（466 行，唯一 importer 是 `session-todo-status-list.tsx:2`）；`session-todo-status-list.tsx` 若无剩余职责一并删除
  - **删除范围不含消息流工具结果卡**：`ToolCallCard/index.tsx:155-166` 的 `TaskList` 摘要走独立逻辑，不 import TodoCard，作为回归点验证而非顺手改
  - 验证：`[自动]` 三套 tsc 零错误；`grep -rn "TodoCard\|session-todo-status-list" src/renderer/src` 无残留引用；`InputArea/index.tsx` < 500 行
  - 验证：`[人工]` 输入框上方悬浮层出现/收起/滚动/点击正常，聊天窗高度不随 Todo 条数变化；消息流 `TaskList` 卡的「N/M 已完成」摘要不受影响
  - 实现偏差（为压回 500 行做的两处顺带清理，均不改变可观测行为）：
    - `ComposerStatusIndicator` 与 `ComposerRuntimeStatusFooter` 共享的 6 个运行态 props 抽成一份 `composerRunStatus` payload（原先两处逐字重复，改一处漏一处）
    - 删除只写不读的 `pendingPlanMode` state 及其在 `use-mode-controls.ts` / `use-composer-mode-state.ts` / `use-input-area-effects.ts` 三处的透传（`index.tsx` 原本就以 `const [, setPendingPlanMode]` 丢弃了值）
  - **顺带发现的遗留缺陷（本批不改）**：`planMode` 只从 `planModesBySession[draftSessionId]` 读，会话创建前（home composer 已选工作目录）点 Plan Mode 开关落到 `use-mode-controls.ts` 的无会话分支，**开关是死控件**；同场景的 Goal Mode 有 `pendingGoalMode` 兜底所以能用。删除死 state 前后行为一致（都无反应），已记入遗留清理批

### 步骤 3：右侧面板 Tab 会话隔离（B3）

- [x] 步骤 3：tab 标识会话化 + 作用域锚点接管 + 激活项按会话记录（`[自动]` 三套 tsc 通过、三项 grep 通过；`[人工]` 待老大实测）
  - **实现偏差 1：字段改名** `rightPanelActiveTabId` → `rightPanelActiveTabIds`（`Record<tabScopeId, string>`）。改名后 `grep -rn "rightPanelActiveTabId\b"` 全仓零命中，比计划预期的「只剩 map 初值 1 行」更严；helper 收口 grep `rightPanelActiveTabId:` 亦零命中，20 个落点无散写
  - **实现偏差 2：helper 面比计划宽**。`right-panel-scope.ts` 除计划列的 `activateRightPanelTab` / `closeRightPanelScope` 两个纯函数外，还导出 `rightPanelTabScopeId` / `rightPanelTabScope` / `scopedRightPanelTabId` / `resolveRightPanelSessionId` / `readActiveRightPanelTabId` / `hasRightPanelTabsInScope`。原因是 20 个落点不只缺「算 patch」，也缺「算作用域 / 算 tabId / 读激活项」，这些若不收进同一文件就会在 slice 里各自内联一遍 `sessionId ?? 'global'`，正是本步要消灭的第二套机制
  - **实现偏差 3：步骤 4 的「关闭后 activeTab 落位相邻」提前在本步落地**（`closeRightPanelScope` 内按被关闭项在**同作用域**列表里的下标取相邻存活项）。原因是激活项一旦会话化，落位算法必须同时知道作用域，放在步骤 4 改等于同一函数改两遍。步骤 4 只剩菜单装配
  - **实现偏差 4：收起判据拆成两个不同作用域**。`closeRightPanelScope` 用**被关闭 tab 自己**的作用域重算激活项；面板是否收起用**当前展示**的作用域（`hasRightPanelTabsInScope(tabs, resolveRightPanelSessionId(state))`）。合并成一个会导致「删后台会话 A 的最后一个 tab」把正在看 B 的面板收掉
  - **实现偏差 5：收起判据同时补进 `closePreviewTab`**（计划只提 `ui-store.ts:114`）。preview 双层栈是独立关闭路径，不补则「关掉某会话最后一个 preview tab」不收起面板
  - **实现偏差 6：`CodeGraphToolCard.tsx:307` 调用方修根因**。原传字面 `null` 作 sessionId，严格作用域过滤后该 preview 会落进不可见的 `global` 桶；改为传 `undefined` 让其回落当前会话。不放宽过滤规则（放宽等于把 global 桶漏进每个会话）
  - **实现偏差 7：`resolveSessionProjectId` 抽到 `lib/session-context.ts`**。计划写在 `session-slice.ts` 内联派生，实测 `setActiveSession` 与 `deleteSession` 两条路径都要用，内联即两份重复定义；抽到既有会话作用域文件后与 `getSessionScope` 同源
  - **既存越线记录（不在本步修）**：`chat-store/session-slice.ts` 741 行（本步 +21/-? 微增）、`chat/file-aware-editor-utils.ts` 526 行，均超 AGENTS.md 500 行红线，属改造前既存，列入验证报告
  - **tab 标识必须一起会话化，只给 `visibleTabs` 加过滤不成立**：固定类 tab 的 id 是常量、去重按 `kind` 全局查（`ui-store-tab-slice.ts:137` / `:160`），全仓同一时刻最多只能存在一个 files / summary / activity / terminal / browser tab。只加过滤会导致：会话 A 的 files tab 被 B 过滤掉，而 `ensureFilesTab(B)` 命中既有 tab 后只激活不回写 sessionId → B 面板永远打不开文件 tab（正是 B3 要修的缺陷类型）
  - **目标模型照抄本仓已有先例** `ensureSubAgentTab:36-47`：`sessionId = (requestedSessionId?.trim() || null) ?? state.activeScopedSessionId ?? useChatStore.getState().activeSessionId ?? null`、`tabScopeId = sessionId ?? 'global'`、`tabId = ${kind}:${tabScopeId}`，去重按 `id` 而非 `kind`
    - **`|| null` 这个归一不能漏**：只 `?.trim()` 时纯空白串会得到 `''` 而非 nullish，`tabScopeId` 就成空前缀
  - 推广到 `ensureActivityTab:14` / `ensureTerminalTab:115` / `ensureFilesTab:135` / `ensureSummaryTab:158` / `openGoalPanel:79` / `ensureBrowserTab`（`ui-store.ts:410-444`）
    - `ensureSummaryTab:162-165` 的「改写既有 tab sessionId」动作在会话化后失去意义，**删除**，不留两套语义
    - `openGoalPanel:89-92` 现按 `goal:${projectId ?? 'global'}` 建 id、按 `kind+projectId` 去重 —— Goal 是 per-session（带 `goalId`），项目键会让同项目两个会话共用一个 Goal tab，改为 `goal:${tabScopeId}`，`projectId` 降级为 tab 数据字段
    - `ensureBrowserTab` 只补 tab 级会话键（`browser:${tabScopeId}`）使 tab 与内容口径一致，**不动** `browserStatesBySession` 的状态逻辑
  - `RightPanel.tsx:62-63 visibleTabs` 按 `activeScopedSessionId ?? activeSessionId` 过滤，`:89-90` 激活项查找在**过滤后集合**上做，渲染分支继续按 `tab.kind` 分派（全仓无一处依赖字面 tab id）
  - **过滤只作用于 tab 条与激活项，不得吞掉常驻层判据**：`hasBrowserTab`（`:95-96`）与 `hasFilesTab`（`:108`）是「常驻不卸载层」的挂载条件，继续读**未过滤**的 `rightPanelTabs`（按 `kind` 判定，与会话无关）；`filesVisible` / `browserVisible` 这类「是否显示」判据跟着过滤集合走
    - 真实保活边界：`browserPanelKey`（`:97-101`）已按 `session:${panelSessionId}` 作 React key，切会话本来就 remount `BrowserPanel`。本批保证的是「**同会话内**收起面板 / 切 tab 不卸载」，不是跨会话不卸载
  - **接管作用域锚点**：`stores/chat-store/session-slice.ts:189-203 setActiveSession` 内调用 `syncSessionScopedState(sessionId, projectId)`（`stores/ui-store.ts:326-327`，当前零调用的既有 setter），让 4 个消费文件的 `activeScopedSessionId` 真正生效（`RightPanel.tsx:36,39,46,48`、`SessionChangeReviewPanel.tsx:30,32`、`browser-session-helpers.ts:123,137,211,271`、`ui-store-tab-slice.ts:38`）
    - **循环依赖规避（必做）**：拿 `ui-store` 必须走 `void import('@renderer/stores/ui-store').then(...)` 惰性方式，同文件 `:178-183` 已留范式；顶部直接 import 会踩 chat-store → ui-store 循环
    - `projectId` 从 `get().sessions.find((s) => s.id === id)?.projectId ?? null` 派生（全局会话传 `null`），**不要从 `activeProjectId` 猜**，否则切会话时会把上一个项目的作用域带过去
  - **`rightPanelActiveTabId` 一并会话化**（`ui-store.ts:83` 现为单一全局字段）：改为 `Record<tabScopeId, string>`，范式照 `ui-store.ts:214-227 bottomTerminalDockOpenBySessionId`
    - 实测改动面：`rightPanelActiveTabId:` 在 `ui-store.ts` / `ui-store-tab-slice.ts` / `preview-panel-slice.ts` 共 **20 个写入落点**（含初值 `ui-store.ts:83`），读取侧 2 处（`RightPanel.tsx:89-90`、`components/layout/SubAgentsPanel.tsx:243-246`——后者从 `rightPanelTabs.find(kind==='subagent' && id === rightPanelActiveTabId)` 推导当前选中子 Agent，必须按当前作用域取值，否则选中态跨会话串）
    - **根因修法，不逐处手改**：新建 `src/renderer/src/stores/right-panel-scope.ts`，导出 `activateRightPanelTab(state, sessionId, tabId)` 与 `closeRightPanelScope(state, sessionId, tabId)` 两个纯函数（照 `preview-panel-helpers.ts` 的「helper 返回 patch、slice 只 set」范式），20 个落点统一改为「算作用域 → 调 helper → 返回 patch」。逐处手改一定会漏，漏掉那处就是下一个 bug
    - `closeRightPanelTab` 的 preview 双层栈分支（`ui-store.ts:105-110`）与 `removeRightPanelTabsForSession:120-133` 的循环关法都不得绕过 helper
  - **`rightPanelOpen` 保持全局单值，不做 per-session 开合**：切会话时面板自动出现/消失比现状更令人意外，B3 抱怨的是 tab 串会话、不是开合状态。19 个落点里 **18 处原样保留**，唯一要改的是 `ui-store.ts:114` 的收起判据：从「全局数组为空」改成「**当前作用域**集合为空即收起」
    - 唯一非 store 写入方 `right-panel-tab-factories.ts:19-21 closeRightSidePanels()` 返回 `{ rightPanelOpen: false }`（被 `CHAT_SURFACE_NAV_RESET:23` 用于页面切换收面板）——**不改**，导航切页本就该收面板，与会话无关
  - **删除会话时的作用域回落旁路**：`stores/chat-store/session-slice.ts:150-152` 在 immer 事务内直写 `state.activeSessionId = state.sessions[0]?.id ?? null`，**不经 `setActiveSession`**；侧栏删除入口 `components/layout/workspace-sidebar-items.tsx:174` 之后也不做导航。面板过滤挂到 `activeScopedSessionId` 后，删掉当前会话会让锚点停在已删 id、过滤结果恒空（面板空白）。该回落路径必须同样调用 `syncSessionScopedState`（沿用惰性 import 范式）
  - **preview 类 tab 关闭语义保持**：`ui-store.ts:103-119 closeRightPanelTab` 对 `kind === 'preview' && previewTabId` 走 `closePreviewTab` 双层栈同步关闭，会话化后不得绕过（步骤 4 的批量关闭依赖它）
    - `openPreviewTab` 写会话键**已满足**，不是待办：`preview-panel-slice.ts:67-68` 已写 `sessionId`/`projectId`，且右栏 id 传递性内嵌作用域（`preview:${previewTabId}`，而 `previewTabId` = `file|diff|markdown|dev-server:${previewScopeKey}:…`，`previewScopeKey` = `session:${sid}` / `project:${pid}` / `global`）。会话粒度是**逐文档**，比 `${kind}:${tabScopeId}` 更细。preview 侧真正要改的是 `:151-156` 与 `:168-172` 两处落位/激活
  - `removeRightPanelTabsForSession`（`ui-store.ts:120-133`）筛选条件是 `:124-126` 的 `t.sessionId === sessionId`（**按字段，不按 id 前缀**）→ 会话化后必须继续写真实 `sessionId` 字段，全局桶保持 `null`，**不得**把 id 里的 `'global'` 字面量写进该字段，否则删会话时静默漏清
  - 验证：`[自动]` 三套 tsc 零错误；`syncSessionScopedState` 已有调用方、无第二套作用域机制并存；无残留 `tab.kind === 'files'` 式的**去重**判断（渲染分支的 kind 判断保留）
  - 验证：`[人工]` 会话 A 开 文件+终端+摘要 → 切 B → 面板只剩 B 的 tab（或空）→ 切回 A → A 的 tab 与 activeTab 完整还原
  - 验证：`[人工]` 切到 B 后点 TitleBar 的 Files 按钮能真正打开 B 的文件 tab（专测单例冲突，不能只激活不显示）；在 B 点过任意 tab 再切回 A，A 展示的仍是自己的 activeTab
  - 验证：`[人工]` TitleBar 的 `ensureFilesTab()`（`components/layout/TitleBar.tsx:100`，**无参**调用）仍能在当前会话正确打开（依赖写入方兜底；现状该路径产出的 files tab `sessionId = null`，会话化后不得继续落 `'global'` 桶）
  - 验证：`[人工]` 同会话内收起面板 / 切走 browser tab 再切回，webview 不重新加载；切会话 remount 属既有行为不计缺陷
  - 验证：`[人工]` 删除当前会话后面板显示回落会话的 tab 而非空白；关闭某会话最后一个 tab 会收起面板，切到另一有 tab 的会话内容正确；A 收起面板时 B 的 tab 未被删除，切到 B 展开仍是 B 自己的激活项
  - 验证：`[人工]` `'global'` 桶（完全无会话）与「有 sessionId 的全局域会话」两类不互相污染；SubAgents / preview / goal / browser tab 切换后不串会话；删除会话后其 tab 不留存；点击 Files / Context 按钮（`SessionConversationPane.tsx:121` / `:128`）不重复追加同会话 tab
  - 验证：`[人工]` preview tab 关闭后左侧列表与右侧 tab 同步消失；Goal tab 同项目两个会话各开各的、互不覆盖 `goalId`（**边界**：同一会话内先后打开多个 Goal 仍共用 `goal:${tabScopeId}` 并覆写 `goalId`，本批不改，不得写成已修复）

### 步骤 4：Tab 标题栏菜单改造（M6）

- [ ] `src/renderer/src/components/layout/RightPanelHeader.tsx` 三处改造
  - 移除「+」菜单 Goals 项（`:214-217`）及 `RightPanel.tsx:228` 的 `openGoalPanel` 装配路径。Goal 面板仅由聊天窗目标触发（现存入口 `GoalSessionControls.tsx:254`，由 `GoalSessionBar` 渲染、挂在 `InputArea/index.tsx:332`，删菜单不影响入口存活）
  - **同步收窄 props**：`onAddGoals` 的类型声明（`:44`）与解构形参（`:160`）删除后成为未用参数，须与装配处一并移除（`noUnusedParameters` 会报错）
  - 「关闭右侧面板」按钮（`:225-233`）改为「更多」下拉：关闭当前 / 关闭其他 / 关闭所有 / 关闭右侧面板
  - store 新增 `closeAllRightPanelTabs` / `closeOtherRightPanelTabs`（作用域为当前会话，落 `ui-store-tab-slice.ts`），批量关闭必须**复用** `ui-store.ts:103 closeRightPanelTab` 逐项关（preview 双层栈语义见步骤 3），不要在 tab-slice 里另写一套 filter
  - **修正关闭后 activeTab 落位**：`closeRightPanelTab` 现取 `tabs[tabs.length - 1]`（最后一个），改为相邻优先（被关闭项的后一项，无后项取前一项）
  - `TabButton`（`:66-150`）增加右键菜单：**该函数有两个返回分支** —— `:123-133` 的 `if (!animated)` 走普通 `<button>`、`:136-148` 走 `<motion.button>`。`ContextMenuTrigger asChild` 必须**同时覆盖两个分支**（或合并成同一 element 后再包），只包 motion 分支会让 `animated=false` 路径右键静默失效；asChild 透传事件，不能把 button 嵌进 button。菜单项与「更多」下拉一致，复用 `components/ui/context-menu.tsx`
  - 验证：`[自动]` 三套 tsc 零错误
  - 验证：`[人工]`「+」菜单无 Goals 且聊天窗有 Goal 时仍能打开；四个关闭动作结果正确、关闭当前后 activeTab 落位相邻；Tab 右键菜单与「更多」下拉行为一致，仅 1 个 tab 时「关闭其他」无副作用；右键不改变既有 hover/点击/拖拽手感，motion 动画未因 asChild 丢失；中英文案齐全无 `defaultValue` 裸奔

### 步骤 5：首条消息顶部间距（M1）

- [ ] 聊天列表顶部留白（主聊天两处表面必须一致）
  - 首选滚动容器加顶部内边距：`components/chat/MessageList/VirtualListContent.tsx:110`（`absolute inset-0 overflow-y-auto pl-7 md:pl-9`），同步 `components/chat/MessageList.tsx:92`（`exportAll` 分支容器）
  - 若改用 virtualizer `paddingStart`（`MessageList/useMessageListScroll.ts:229-246`），必须同步校验收纳 `scrollToBottomImmediate`（`:122-137`）与「进行中当前轮 user message 顶部吸附卡」（`VirtualListContent.tsx:227`）的 offset 计算
  - **范围外（不改）**：子 Agent 播放视图 `components/chat/TranscriptMessageList.tsx:126` 与 `MessageList/StaticMessageTranscript.tsx:98`
  - 验证：`[自动]` 三套 tsc 零错误
  - 验证：`[人工]` 新会话首次发送后第一条消息与顶部有可见间隔；流式吸附卡置顶不重叠不抖动；长会话滚到底仍贴底；上滑出现「加载更早」行时（`VirtualListContent.tsx:134` 的 `pt-3`）间距不翻倍；导出全部视图与主列表表现一致

### 步骤 6：文件选中发送读取内容注入（M4）

- [ ] 步骤 6a：把死链里的读取实现迁到真实发送路径
  - 新建 `src/renderer/src/lib/agent/selected-file-context.ts`，迁移 `lib/agent/dynamic-context.ts:185-252 buildSelectedFileContext`（含 SSH 分支、skipped 收集、displayPath 归一），改为**同时返回结构化逐文件结果**（路径 / 行数 / 是否截断 / 跳过原因 / 失败）
    - **`:254 resolveFileContextBudget` 与 `:265 truncateToTokenBudget` 在 185-252 之外，必须一并迁走** —— 留在原地会通过 `:257`/`:271` 留住 `estimateTokens` 等使用者，下面「失效 import」判据就不成立
  - **迁出即删旧**：删除 `dynamic-context.ts:73-83` 的 `if (selectedFiles.length > 0)` 分支及其上方 `:38 useUIStore.getState().selectedFiles ?? []` 读取（该 slice 全仓零写入方，永空）；`:16-18` 三个预算常量随函数迁走，不残留第二份实现；`buildRuntimeReminder` 保持零调用、不复活
  - **同步清理失效 import**：删掉 `:38` 与 `:73-83` 并整体迁走后，`dynamic-context.ts:1 useUIStore`、`:9 ipcClient`、`:12 estimateTokens` 三者全部失去使用者；tsconfig 链已开 `noUnusedLocals` / `noUnusedParameters`，不清理会以 TS6133 编译失败
  - 在 `hooks/use-chat-actions.ts` 发送装配处接入：`:122-129` 已按 `session.scope` 解析 `workingFolder` / `sshConnectionId`，在 `:173 userContent` 组装前解析输入文本中的 `<select-file>`（`lib/select-file-tags.ts:159 parseSelectFileText`）→ 解析路径 → 读取 → 拼 `<system-reminder><selected_files>` 追加进**发给模型的内容**
  - **注入的唯一来源 = 消息文本本身**。`parseSelectFileText` 已同时识别 `<select-file>` 标签与 `@{path}` token（`:27` / `:35` / `:183-187`）并在 `:130-138` 按位置去重，覆盖两条输入通道。其余两条**不得**再各自注入：
    - `ui-store.selectedFiles`（`:304`）永空、`:306 toggleFileSelection` 零调用 → 不接入，列入遗留清理批
    - composer 局部 `selectedFiles` → `InputArea/index.tsx:270-271` 映射成 `sendOptions.selectedFileReferences`，实测在 `use-chat-actions.ts:31` 声明后**无任何读取方**，属死字段
    - **注意 `:130-138` 的去重是按标签位置**（重叠区间合并），不是按文件路径：同一文件被引用两次会得到两个 file 段，路径级去重必须在新模块里自己做（判据：按归一化绝对路径，一轮请求内最多出现一次）
  - 验证：`[自动]` 三套 tsc 零错误（本步纯渲染端，不加 `dotnet build`）；`grep -rn "buildSelectedFileContext" src/renderer/src` 恰好命中两个文件 = 新模块定义 + `use-chat-actions.ts` 唯一调用方，`dynamic-context.ts` 零命中
  - 验证：`[人工]` 选中一个 .ts 文件发送 → Agent 无需再调 Read 即可回答文件内容，后续轮次不重复累积该注入
- [ ] 步骤 6a-2：把「发给模型的内容」与「落库文本」分离
  - **要分离的是 store 与 DB 的 `text` 字段，不是气泡**：气泡与会话标题两条路径都已剥离 `<system-reminder>`（`UserMessage.tsx:57` → `extractEditableUserMessageDraft` → `extractEditableText:148 stripSystemRemindersOnly`；标题另在 `chat-store/index.ts:289` 用正则再剥一次）。真正被污染的是 `index.ts:182-193` 的 `userText`——从 `params.messages[last].content` 逐块 join 反推、**不做任何剥离**，`:214` 直接作为乐观消息 `text` 并经 `:258 dbUpsertMessage` 落库，此后一切以 `text` 为源的消费方（复制、检索）都会拿到原始 XML
  - **meta 必须在 store 内、且在构造期挂上**：乐观 `userMessage` 现字段只有 `id / role / text / [content] / createdAt`，**没有 `meta`**，而 `UserMessage.tsx:340` 读 `meta?.selectedFileReads`。`sendMessage` 返回 boolean，调用方拿不到消息 id；`updateMessage`（`session-slice.ts:434-443`）只 `Object.assign` **不写库**，事后补挂刷新即丢；`beginUserTurn`（`index.ts:244`）经 immer 会深冻结该对象且全仓无 `setAutoFreeze` ⇒ **只能在构造乐观消息那一段（`:208-220`）一次性带出**
  - `stores/chat-store/index.ts` 改动：
    - `sendMessage` params（接口 `:69-113`，实现 `:168`）新增两个**仅渲染端使用**字段：`userMessageText?: string`、`meta?: MessageMeta`
    - `userText` 派生（`:185-192`）改为优先取 `params.userMessageText`，回落到现有从 content 反推的逻辑（两字段都可选，不影响既有调用方）
    - `:208-220` 乐观消息补 `...(params.meta ? { meta: params.meta } : {})`
    - **`:330-344` 的 `agent/run` payload 在 `:335` 处 `...params` 全量透传，须先剔掉 `userMessageText` / `meta` 再发**。Worker 侧 `Agent/AgentRuntimeTools.cs:42,50-56` 用 `JsonElement` 逐字段取、未知键被忽略，所以剔除是**卫生措施**（避免 UI 元数据经 `:56 parameters.Clone()` 驻留整个 run 生命周期），不是不改就出功能错
  - `stores/chat-store/db-helpers.ts` **无需改动**（已实证）：`serializeMessage:127` 有 `if (msg.meta) Object.assign(meta, msg.meta)`（无白名单全量并入），`deserializeMessage:152-168` 用 delete 黑名单恢复其余 meta 键，`selectedFileReads` 随通用通道持久化与回读
  - **已接受的后果**（写进验证报告，不算缺陷）：注入只存在于 Worker 内存会话，DB 转录里只有干净文本 ⇒ 重启后该轮注入不再出现在模型历史，与「单轮生效、不跨轮累积」目标一致
  - 验证：`[自动]` 三套 tsc 零错误；确认 `userMessageText` / `meta` 在 `:330-344` 的 `agent/run` payload 组装前已被剔除
  - 验证：`[人工]` 带文件发送后用户气泡只显示自己输入的文字 + 「已读 N 行」摘要，不出现原始 XML；重启应用重新打开该会话，气泡与摘要显示不变（meta 已从 DB 回读）
- [ ] 步骤 6b：边界与退化
  - 保护：token 预算（沿用 `resolveFileContextBudget`）+ 行数硬上限双保险，超限截断并标 `truncated`
  - **路径解析规则**：`<select-file>` 里存的是**相对 `workingFolder`** 的相对路径（`lib/select-file-editor.ts:145-147`、`components/cowork/use-file-tree.ts:297` 产出的 `sendPath`），而 `fs:read-file` 要绝对路径。新模块必须自己完成拼接并做**越界防护**（归一化后仍须落在 `workingFolder` 内，否则视为不可解析）；否则「路径不可解析 → 仅路径引用」会把项目文件**全部**退化成不读盘。`@{path}` token 通道同理需明确绝对还是相对
  - 跳过：pdf / office / 二进制 / 非文本扩展名 → meta 标 `skipped`。**母本无扩展名白名单**，`skipped` 判定与新模块自算的 `lineCount` / `maxLines` 都得在 `selected-file-context.ts` 里实现，不是继承来的
  - **失败态当前判不出来**：`src/main/ipc/fs-handlers.ts:73-80` 对 ENOENT / EISDIR **返回 `''` 而不抛**，`ssh-fs-handlers.ts:79-81` 任何错误同样返回 `''` ⇒ 「读失败」与「空文件」在现有 IPC 语义下不可区分。单文件读失败 → `failed` 且**不阻断发送**的判据：由新模块用「先 stat / 存在性判定或路径解析结果」来定，**不得把 `''` 当失败**，也不得为区分失败去改主进程返回 shape（会牵动 `lib/ipc/channels.ts` 与 `messagepack-channel-routing.ts`，超出本批范围）
  - 退化：全局会话（无 `workingFolder`）与路径不可解析 → 仅路径引用，不读盘
  - **旁路调用方边界（已接受，须写进验证报告）**：另有 7 个绕过该装配、直接调 store 级 `chatStore.sendMessage` 的调用方 —— `hooks/use-chat-actions.ts:408/464/542`、`hooks/use-background-subagent-wakeup.ts:78`、`hooks/use-channel-auto-reply.ts:264`、`lib/tools/cron-runtime.ts:406`、`lib/tools/project-send-message.ts:103`。这些路径文本若含 `<select-file>` / `@{path}` 会**静默不注入**。定性为已接受边界（这些入口文本由程序生成、不来自用户选文件），但不得留成未声明的洞
  - meta 写入 `MessageMeta.selectedFileReads`（`lib/api/types.ts:358`，字段 `:361`，元素类型 `:331`，容器 `:344`；视图 `components/chat/user-message-views.tsx:33-72` 六种状态与 `UserMessage.tsx:340` 消费均已就位，**无需新建组件**）
  - **排队消息重放同一条装配路径**：`getRequestText`（`use-chat-actions.ts:765-780`）把文本原样存进 `PendingSessionMessageItem`，重放经 `:909-915` 回到同一发送入口 ⇒ 注入必须挂在「文本 → userContent」这一步，天然对排队重放生效；**不得挂在 `handleSend` 或 composer 侧**，否则排队消息漏注入
  - 验证：`[自动]` 三套 tsc 零错误；`grep -rn "<selected_files>" src/renderer/src` 仅命中新建的 `lib/agent/selected-file-context.ts` 一处生产者，发送链路无第二条注入路径
  - 验证：`[人工]` >1000 行文件显示截断标记且 Agent 明确说明只看到部分内容；选中 pdf 显示跳过文案；SSH 项目选中远端文件能读取；全局会话选中文件仅路径引用不报错；「已读 N 行 / 截断 / 跳过 / 失败」文案与实际一致；同一文件既从文件树又从 `@` 搜索加入只注入一次；流式中排队的带文件消息出队后仍有注入且不重复

### 步骤 7：工具分类说明提示词（M3 剩余部分）

- [ ] 分类元数据收敛到单一来源并渲染进 Prompt
  - 新建 `src/runtime/WishfulClaw.Core/Tools/ToolCategoryCatalog.cs`：分类名 → 优先级 → 一句话说明，覆盖现存全部分类（23 个 provider `Category` + 直接执行器 `file/search/shell/task/memory`，注册入口 `Agent/Tools/ToolModule.cs:32 RegisterDirectExecutors`），未列者保留 100 兜底
  - 改 `Core/Tools/ToolRegistry.cs:25-41`：`CategoryPriorities` 字典改为读取该目录，避免两份表；**保持 `StringComparer.OrdinalIgnoreCase`**（`:25` 现状）。实测全仓 23 个 provider 分类与直接执行器分类均为小写 kebab、当前不存在大小写差异 —— 保留该比较器不是修 bug 而是给后续 provider 留容错，**勿顺手换成 Ordinal**
  - 改 `Persona/PromptBuilder.cs:235-247 <tool_calling>`：按目录顺序渲染分类清单，保留 `:240-241` 既有 `use_capability` list→call 引导、不重复表述；遵循提示词精简规范（一行一类、不堆例子）
  - 分层合法性：Persona 依赖 Contracts + Core + Workspace，可引用 Core（`WishfulClaw.Persona.csproj:11` 已 `ProjectReference` Core）；不得反向依赖
  - **已知代价（写进验证报告，不算缺陷）**：`ToolRegistry.cs:163,179` 用 `GetCategoryPriority` 给工具定义打优先级，`:186-192` 按 Priority→名称排序（注释自陈目的是 "deterministic prefix bytes"）。把约 20 个原本并列 100 的分类改成具体值 → `tool/list` 名称序列变化 → **一次性 prefix cache 失效**，之后恢复稳定
  - 验证：`[自动]` `dotnet build src/runtime/WishfulClaw.sln` **0 error 且无新增 warning**。**不要给解决方案级 build 加 `-o`**：`dotnet build <sln> -o <dir>` 会被 MSBuild 判为不支持并稳定报 1 条 `warning NETSDK1194`，与「0 warning」互斥。需临时输出目录避文件锁时只对**单工程**用 `-o`。基线实测（2026-09-05 / `577712b`，不带 `-o`）：0 error / 0 warning
  - 验证：`[自动]` `node scripts/publish-aot-worker.mjs` 通过（AOT 规范第 10 条），0 error / 0 warning
  - 验证：`[人工]` 核心工具未覆盖时 Agent 主动 `use_capability` 查找并按分类命中；打印改动前后 `<tool_calling>` 段 UTF-8 字节长度并记录差值（该段是 `PromptBuilder` 里的裸 raw string，`DefaultCharacterBudget = 20_000`（`:24`，仅用于 `:76`）与 `memoryBudget = 6000`（`:188`）都不约束它，"预算溢出告警" 恒真、不可作判据）

### 步骤 8：全量验证与归档

- [ ] 本批完整验证 + 文档
  - `[自动]` 三套 tsc（`tsconfig.web.json` / `tsconfig.node.json` / `tsconfig.json`）全部零错误
  - `[自动]` `dotnet build src/runtime/WishfulClaw.sln` 0 error、与基线 `577712b` 相比无新增 warning（不加 `-o`，见步骤 7）
  - `[自动]` AOT 规范复核：新增类型注册进 `JsonSerializerContext`、`WorkerResponse.Json` 显式传 `JsonTypeInfo`（步骤 7 只加静态表与文本，预期不新增序列化类型；若步骤 3/6 引入新契约需回补）
  - `[人工]` 按步骤 1-7 的 `[人工]` 检查点逐条实测并记录结果
  - 产出 `verification_report.md`；更新 `docs/PROGRESS.md` 记录本批功能单元与待裁定项
  - VERDICT 由老大裁定（PASS / FAIL / PARTIAL），Agent 不自行判定完成

## 涉及文件

> 前端路径一律从 `src/renderer/src/` 写全，避免按目录前缀拼接出错。

**新建**
- `src/renderer/src/components/chat/file-aware-editor-ime.ts` —— IME 末字符判据（步骤 1，为守住组件 500 行红线而抽离）
- `src/renderer/src/components/chat/SessionTodoPanel.tsx` —— 移植 InlineStepsPanelCard（步骤 2a）
- `src/renderer/src/lib/agent/selected-file-context.ts` —— 迁出 selected_files 读取（步骤 6a）
- `src/renderer/src/stores/right-panel-scope.ts` —— `activateRightPanelTab` / `closeRightPanelScope` 两个纯 helper + `Record<tabScopeId, string>` 激活项读写（步骤 3）
- `src/runtime/WishfulClaw.Core/Tools/ToolCategoryCatalog.cs` —— 分类优先级与说明单一来源（步骤 7）
- `docs/plans/iter-v2-24/plan-issues-batch-2/{review_report,verification_report}.md`

**修改（前端）**
- `src/renderer/src/components/chat/FileAwareEditor.tsx` —— IME 时序 + onBlur（步骤 1）
- `src/renderer/src/components/chat/InputArea/index.tsx` —— Todo 面板挂载、510→487 行收口（步骤 2）
- `src/renderer/src/components/chat/InputArea/{use-mode-controls,use-composer-mode-state,use-input-area-effects}.ts` —— 清理只写不读的 `pendingPlanMode`（步骤 2b 顺带）
- `src/renderer/src/components/chat/TodoCard.tsx`、`src/renderer/src/components/chat/InputArea/session-todo-status-list.tsx` —— 删除（步骤 2b）
- `src/renderer/src/stores/ui-store.ts`、`ui-store-tab-slice.ts`、`ui-store-interface.ts`、`preview-panel-slice.ts`、`chat-store/session-slice.ts`、`src/renderer/src/components/layout/SubAgentsPanel.tsx` —— tab 会话作用域（步骤 3）
- `src/renderer/src/components/layout/RightPanel.tsx` —— 步骤 3（常驻层判据 `hasBrowserTab:95-96` / `hasFilesTab:108` 保持读未过滤数组）+ 步骤 4（`onAddGoals` 装配收窄、`+` 菜单去 Goals）
- `src/renderer/src/components/layout/RightPanelHeader.tsx` —— Goals 移除、更多下拉、Tab 右键（步骤 4）
- `src/renderer/src/components/chat/MessageList/VirtualListContent.tsx`、`src/renderer/src/components/chat/MessageList.tsx` —— 顶部间距（步骤 5，两处表面必须一致）
- `src/renderer/src/components/chat/MessageList/useMessageListScroll.ts` —— 仅当改用 virtualizer `paddingStart` 时才动（步骤 5 备选）
- `src/renderer/src/hooks/use-chat-actions.ts`、`src/renderer/src/lib/agent/dynamic-context.ts` —— 文件读取注入编排与迁出（步骤 6a；`lib/select-file-tags.ts` 只调用不改）
- `src/renderer/src/stores/chat-store/index.ts` —— 步骤 6a-2：`sendMessage` 入参加 `userMessageText` / `meta`、乐观消息构造区间 `:208-220` 挂 `meta`、`agent/run` payload（`:330-344`，`...params` 在 `:335`）剔除两个渲染端字段
- `src/renderer/src/locales/zh/chat.json`、`src/renderer/src/locales/en/chat.json` —— 新文案（步骤 2/4）

**预期零改动**（若实现期发现需要改，须在验证报告说明理由）
- `src/renderer/src/stores/right-panel-tab-factories.ts` —— 只有 `ensureRightPanelTabs:9` 的 null 兜底、`getDefaultRightPanelTabs:15` 返回 `[]`、`closeRightSidePanels:19` 与常量表，不构造任何 tab id；其 `rightPanelOpen: false` 按设计保持全局
- `src/renderer/src/stores/ui-store-browser-slice.ts` —— `openBrowserTab:31-32` 只把 `sessionId` 透传给 `ensureBrowserTab`，会话化落在 `ui-store.ts:410`
- `src/renderer/src/lib/api/types.ts` —— `MessageMeta.selectedFileReads:361` + `SelectedFileReadItemMeta:331` + `SelectedFileReadsMeta:344` 字段已齐备
- `src/renderer/src/stores/chat-store/db-helpers.ts` —— meta 通用通道已支持（见步骤 6a-2）

**修改（C#）**
- `src/runtime/WishfulClaw.Core/Tools/ToolRegistry.cs` —— 优先级表改读目录（步骤 7）
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` —— 分类说明清单（步骤 7）

## 参考源码（读，不改）

- OpenCowork：`D:\claw\OpenCowork`
  - `src/renderer/src/components/cowork/StepsPanel.tsx:328,371,373-402,433-444` —— InlineStepsPanelCard 收起/限高/动画（步骤 2）
  - `src/renderer/src/hooks/use-chat-actions.ts:594,848-953` —— selected_files 读取与注入、1000 行上限、pdf/office 跳过（步骤 6）
  - `src/renderer/src/components/chat/FileAwareEditor.tsx:792-796` —— onBlur 复位 composition 挡板（步骤 1，仅 `isComposingRef` 一行可对齐）
  - `src/renderer/src/components/chat/InputArea.tsx:4258` —— Todo 面板挂载层级与 `projectScoped` 门禁（步骤 2）
- 本仓既有范式：
  - `src/renderer/src/components/chat/InputArea/composer-flyovers.tsx:56,63` —— 悬浮层 class 范式（步骤 2a 借样式，文件本身不改）
  - `src/renderer/src/components/chat/file-aware-editor-utils.ts:221` —— `renderDocument` 里 `root.replaceChildren()` 的真实重建落点（步骤 1 的绕过对象）
  - `src/renderer/src/stores/ui-store.ts:103-119` —— `closeRightPanelTab` 的 preview 双层栈关闭语义与 activeTab 落位（步骤 3/4）；`:120-133 removeRightPanelTabsForSession` 按 `t.sessionId` **字段**筛选
  - `src/renderer/src/stores/ui-store.ts:214-227` —— per-session 标量 map 先例（`bottomTerminalDockOpenBySessionId`），步骤 3 照此形办
  - `src/renderer/src/stores/ui-store-tab-slice.ts:36-47` —— `ensureSubAgentTab` 的作用域归一先例，步骤 3 推广的目标模型
  - `src/renderer/src/stores/preview-panel-helpers.ts` —— 「helper 返回 patch、slice 只 set」范式（步骤 3 新建 helper 照此）
  - `src/renderer/src/components/ui/context-menu.tsx` —— 右键菜单（步骤 4）
  - `src/renderer/src/components/chat/ToolCallCard/index.tsx:155-166` —— `TaskList` 结果卡摘要，步骤 2b 的回归对象
  - `src/renderer/src/lib/agent/dynamic-context.ts:185-252` —— selected_files 迁移母本（步骤 6a）

## 本批次不做

- M2 侧栏右键菜单（老大判定已完成）
- 迭代 24 审查遗留：I24-11 automation 权限、I24-15 主进程失败日志、review-12 与 plan-review-fixes 清单更正
- 三份计划归档：plan-tool-concurrency-queue、plan-context-manifest（含「显式修复上下文」入口缺口）、plan-compression-display（含压缩孤儿组件退役）
- 压缩取消竞态实测：属 plan-compression-display 的运行期复验范围，本批不重复
- 死代码清理批：`lib/agent/visual-context.ts`、`ui-store.selectedFiles` slice 与 `toggleFileSelection`、`SendMessageOptions.selectedFileReferences`、`fs:read-text-file-lines` 无调用端点、`dynamic-context.ts` 其余未迁部分、review 面板链（`ChangeReviewSheet.tsx` / `RunChangeReviewCard.tsx` 零 importer 与 `kind:'review'` 零创建方）
- Plan A 全局任务工作台 / Plan B 会话 Todo 端到端测试、自动更新端到端、真实 Electron E2E
