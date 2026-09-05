# 规划验证报告：issues 批次 2（v2-iter-24）

**最新一轮（第四轮）总判定：FAIL** ｜ ❌ 未清 4 项 / ⚠️ 本轮新增 8 项（已全部修入第 4 版正文，修完的正文本身待复核）

- **怎么读这个 4**：四项（❌13 残留半边 / ❌14 / ❌15 / ❌16）**都已按代码事实修入第 4 版正文**，账面仍计未清只因为按 `dev-workflow` 阶段三规则「已修 ≠ 已关闭」——关闭须由下一轮独立复核确认。**当前没有任何一项是「洞还在、还没动」**，剩下的动作是复核而非再修。其中 ❌16 不是验证者新一轮查出的，而是**主 agent 修 ❌14 时实测出来的**：初稿沿用 ❌14 的「四处」口径，实际打开 `ui-store.ts` 才发现标量写入面被严重低估——这正是「写计划的人低估自己的改动面」的又一例，单独立项是为了让第五轮专门核这一项的计数。
- 待审文档：`plan.md`（第 4 版）、`exploration_findings.md`（第 4 版）
- 核查基线：`dev/v2-iter-24` @ `577712b`；工作树未提交变更**全部是文档**（本目录三份 + `docs/dev-workflow.md` 台账硬规则 + `docs/PROGRESS.md` 批次条目），无一处 `src/` 源码改动 ⇒ 下列行号即执行时代码
- 规范依据：`AGENTS.md`（7 层依赖 / AOT / 大文件拆分 / 编译验证）、`docs/dev-workflow.md`（六阶段、每步双门禁、阻断规则）
- **本报告只保留最新一轮**。前三轮全文已删除（膨胀到 557 行、读者看不出收敛），需回溯时用 `git show fe5dcc3:docs/plans/iter-v2-24/plan-issues-batch-2/compliance_report.md`
- 本轮方法：三路并行只读核查，每条判定指向验证者亲自打开的 `file:line`；三处关键冲突（常驻层不变量、删除会话回落、preview 落位）由主 agent 二次读码确认，不采信文档自述

## 一、收敛台账（唯一的状态视图）

> 每追加一轮验证必须回写本表，并在 `plan.md` 头部版本行写明本版关闭了哪几项、「已修待复核」与「已复核关闭」不得混写。规则见 `docs/dev-workflow.md` 阶段三「多轮验证与收敛台账」。

轨迹：第 1 轮 ❌8 → 第 2 轮 ❌3（关 8）→ 第 3 轮 ❌2（关 3）→ 第 4 轮 ❌3（关 ❌12，❌13 半修，新出 ❌14/❌15）→ 第 4 版修订中自查出 ❌16（修 ❌14 时实测改动面，非新一轮验证新增）。

| 编号 | 出处 | 一句话 | 状态 |
|---|---|---|---|
| ❌1 | 第 1 轮 | 步骤 6 未识别 `dynamic-context.ts` 已有的零调用实现，存在双实现口径 | ✅ 第 2 轮关闭 |
| ❌2 | 第 1 轮 | 步骤 3 缺 tab 状态必改方（`preview-panel-slice.ts` / `SubAgentsPanel.tsx`） | ✅ 第 2 轮关闭 |
| ❌3 | 第 1 轮 | 误把 `activeScopedSessionId` 当死代码删除 | ✅ 第 2 轮关闭（改为接管悬空锚点） |
| ❌4 | 第 1 轮 | 引用不存在的 `addRightPanelTab` | ✅ 第 2 轮关闭（换成真实 `ensure*` 名单） |
| ❌5 | 第 1 轮 | 验收指向不存在的 ToolCallCard 复用；`TodoCard.tsx` 孤儿无处置 | ✅ 第 2 轮关闭 |
| ❌6 | 第 1 轮 | 「本仓无 `change-summary-utils`」失真 | ✅ 第 2 轮关闭（引出 ❌9） |
| ❌7 | 第 1 轮 | 步骤 7 分类口径不覆盖真实分类；Core 改动未列；单一来源未证 | ✅ 第 2 轮关闭 |
| ❌8 | 第 1 轮 | I24-17（`InputArea/index.tsx` 510 行）被静默丢弃 | ✅ 第 2 轮关闭 |
| ❌9 | 第 2 轮 | 移植 OpenCowork 变更审查按钮会造出无出口的死按钮 | ✅ 第 3 轮关闭（择定不移植 + 配验收） |
| ❌10 | 第 2 轮 | 「涉及文件」写了不存在的路径 `MessageList/MessageList.tsx` | ✅ 第 3 轮关闭 |
| ❌11 | 第 2 轮 | 步骤 6b 无 `[自动]` 门禁，按自订规则无法判 `[✓]` | ✅ 第 3 轮关闭（引出 ❌13） |
| ❌12 | 第 3 轮 | 步骤 3「只过滤 `tab.sessionId`」在固定 id + 按 `kind` 全局去重的单例模型下不成立 | ✅ 第 4 轮关闭（改 `${kind}:${tabScopeId}` 会话化）；残留改动面另立 ❌14/❌15 |
| ❌13 | 第 3 轮 | `selectedFileReads` 零写入方，承载写入的 `chat-store/index.ts` 未进「涉及文件」 | 🟡 **第 4 版已修，待第五轮复核**：正文（步骤 6a-2）第 3 版即有，清单半边本版补齐 —— `chat-store/index.ts` 已列入「修改（前端）」并写明三个改造点（入参 / `:208-220` 挂 meta / `:330-344` payload 剔除） |
| ❌14 | 第 4 轮 | 步骤 3 未纳入 activeTab 落位 / 空列表收起 / `rightPanelActiveTabId` 标量写入这几处判定点（本轮按 4 处列举，实测远不止 → ❌16） | 🟡 **第 4 版已修，待第五轮复核** |
| ❌15 | 第 4 轮 | 删除会话时直写 `activeSessionId` 绕过 `setActiveSession`，新模型下作用域锚点停在已删会话 | 🟡 **第 4 版已修，待第五轮复核** |
| ❌16 | 第 4 版修订中自查 | ❌14 的修法把标量写入面记成 4 处，实测严重低估：`rightPanelActiveTabId` 全仓 **20 个落点**（`ui-store.ts` 6 / `ui-store-tab-slice.ts` 11 / `preview-panel-slice.ts` 3，含 `ui-store.ts:83` 初值）+ 读取侧 2 处（`RightPanel.tsx:89-90`、`SubAgentsPanel.tsx:243-246`）；`rightPanelOpen` 另有 19 处 | 🟡 **第 4 版已修，待第五轮复核**：正文改为 helper 收口（新建 `stores/right-panel-scope.ts`，两个纯函数），并配可复现 `[自动]` 门禁（改造后那三条 grep 应只剩 map 初值 1 行）；`rightPanelOpen` 明确保持全局，19 处只改 `ui-store.ts:114` 的**收起判据** |

⚠️ 共 38 项：⚠️1–⚠️23 已随第 2/3 版关闭或转 ❌；第 3 轮 ⚠️24/25/27/28/30 已采纳、⚠️26 部分采纳（新写文本又带入 3 处漂移）、⚠️29 第 3 轮未采纳 → **第 4 版已修**（步骤 7/8 口径见 §二）；本轮 ⚠️31–⚠️38 见 §四。

**账面小结**：4 项未清 = **0 项「未修」+ 4 项「第 4 版已修待复核」**；另有 ⚠️31–⚠️38 全部修入正文同样待复核。关闭路径只有第五轮复核或老大豁免（§七）。

## 二、第 3 轮项复核（代码证据）

| 编号 | 本轮证据 | 结论 |
|---|---|---|
| ❌12 | 方案已从「过滤」换成「tab 身份会话化」，其成立前提**经全仓复核为真**：字面 tab id 只出现在 8 个生产方（`ui-store-tab-slice.ts:21/57/102/122/142/168`、`ui-store.ts:414`、`preview-panel-slice.ts:61-62`），消费方一律按 `kind` 分派（`RightPanel.tsx:66/72/78/108/109/155/184/186/252`、`RightPanelHeader.tsx:51/54`），`RightPanelHeader.tsx:174/187` 与 `SubAgentsPanel.tsx:245-247/310-313` 只把 id 当不透明值用；`ui-store.ts:206 agentFilesActiveTab:'files'` 属 AgentFilesPanel 内层页签、不同命名空间。改 id 形态不涉及持久化（`ui-store.ts:44` 为裸 `create<UIStore>`，renderer 里 persist 只在 settings/agent/team/app-plugin/extension/provider），也不撞兜底（`getDefaultRightPanelTabs()` 返回 `[]`、`right-panel-tab-factories.ts:9-13` 只是 `tabs ?? []` 空值守卫）。目标先例 `ensureSubAgentTab:36-47` 形态核实存在（去重在 `:47`，落在计划引用的 36-46 之外） | ✅ 关闭，残留另立 ❌14/❌15 |
| ❌13 | 步骤 6a-2 新写的行号基本准确：入参接口 `chat-store/index.ts:69`、实现 `:168`、`userText` 反推 `:182-193`、`dbUpsertMessage` `:258`、`agent/run` payload `:330-344` 且 `:335` 确为 `...params` spread（故「必须剔除渲染端字段」有对象、不是伪需求）、`use-chat-actions.ts:234 return started`；`db-helpers.ts` 判定「无需改动」经实证成立（`:110` 起点、`:127 Object.assign`、`:152-168` 恢复侧用 delete 黑名单，未知键 `selectedFileReads` 能原样回读，`cron-runtime.ts:226-237` 已走同一条通用通道）。**但** `grep -n "chat-store/index.ts" plan.md` 只命中正文（137/139/147），「涉及文件」区间（192-236）内与 chat-store 相关的仅 `session-slice.ts`（步骤 3） ⇒ 检查项 D 仍不通过 | 🟡 半修 |
| ⚠️24 | `ensureBrowserTab` 描述已改对（固定 id `'browser'`、tab 不写 sessionId、内容级隔离靠 `browserStatesBySession`），实测 `ui-store.ts:413-419` 无 `sessionId` 字段、`:423-431` 为页面状态通道 | ✅ 采纳（区间应写 `410-444`，见 §五） |
| ⚠️25 | 正文已要求 `ContextMenuTrigger asChild` 同时覆盖 `TabButton` 两个返回分支 | ✅ 采纳（引用分支行号各偏 1，见 §五） |
| ⚠️26 | 已校准：`InputArea/index.tsx:341`/`:345`、`RightPanel.tsx:89-90`、`enqueuePendingSessionMessage:782` 全部命中；新写文本又引入 3 处漂移（见 §五） | 🟡 部分 |
| ⚠️27 | 假前提已改：正文现写「现状 23 个 provider 分类与直接执行器分类均为小写 kebab，不存在大小写差异，保留 `OrdinalIgnoreCase` 是给后续 provider 留容错」——实测成立，`ToolRegistry.cs:25` 确为该比较器 | ✅ 采纳 |
| ⚠️28 | 迁出后失效 import 已列入清理，且**实测三条全部成立**：`dynamic-context.ts` 内 `useUIStore` 仅 `:1/:38`、`ipcClient` 仅 `:9/:203`、`estimateTokens` 仅 `:12/:213/:271`（后三处都在待迁函数体内，前提是两个预算辅助函数一起迁走）；`@electron-toolkit/tsconfig` 基线确为 `noUnusedLocals: true` / `noUnusedParameters: true` ⇒ 不清即 TS6133。步骤 4 的 `onAddGoals` props 收窄亦已写入 | ✅ 采纳 |
| ⚠️29 | **未采纳（第 3 轮）**：步骤 8 仍写「`dotnet build <sln>`（必要时 `-o` 临时输出目录）0 error / 0 warning」——解决方案级 `--output` 会触发 `NETSDK1194`，两个口径互斥；步骤 7「改动前后各打印一次 `tool/list` 名称序列」仍无可运行入口（本步新建的回归工程本可承担：`Core/Tools/ToolRegistry.cs:126 GetToolDefinitions()` 是 public）。**本轮已实测复现**：`dotnet build src/runtime/WishfulClaw.sln -o <tmp>` → **1 warning NETSDK1194 / 0 error**；不带 `-o` → **0 error / 0 warning**（`577712b`），故「无新增 warning」在本仓是可判定的「仍为 0」 | 🟡 第 3 轮判「仍开放」→ **第 4 版已修，待第五轮复核**（步骤 7 补 `--dump-tool-order` 取数顺序与产物文件、步骤 7/8 统一为「0 error + 无新增 warning，sln 级不加 `-o`」） |
| ⚠️30 | 跨通道路径去重已明确归给新模块，并配 `[人工]`「同一文件两路加入只注入一次」 | ✅ 采纳 |

另：第 3 轮检查 E 提的「恢复会话首轮是否重放 `<selected_files>`」，第 4 版正文已表态并写明这是**已接受的后果**（注入只活在 Worker 内存会话，DB 只存干净文本），不再悬空。

## 三、第四轮 ❌ + 修订中自查出的 ❌（阻断）

### ❌14 步骤 3 会话化漏掉「落位 / 收起 / 标量写入」四处判定，且它们全跑在未过滤数组上

- 正文只写了 tab 身份与 `rightPanelActiveTabId` 会话化，没写这些既有判定要跟着改：
  - `ui-store.ts:111-118 closeRightPanelTab`：`tabs.length === 0` 才收起面板，`nextActive = tabs[tabs.length - 1].id`，两处都以标量写 `rightPanelActiveTabId`（`:114`、`:118`）；
  - `ui-store.ts:120-133 removeRightPanelTabsForSession`：靠循环 `closeRightPanelTab` 保住 preview 双层栈，同样落进上面的标量写；
  - `preview-panel-slice.ts:151-156`：关闭后 nextActive 取**未过滤** `nextRightPanelTabs` 末项；`:168-172 setActivePreviewTab`：按 id 直接激活、不校验会话。
- 后果（会话化后必然出现）：关掉当前会话最后一个 tab 不再收起面板（别的会话还有 tab）；`nextActive` 可能指向别会话的 tab id，`RightPanel.tsx:89-90` 在过滤集合里找不到就静默回落 `tabs[0]` ⇒ 步骤 3 验收「A 的 tab 与 activeTab 完整还原」「在 B 点过 tab 再切回 A」由这条路径失效，而正文把这归给了 activeTabId 会话化，执行者不会去改这四处。
- 修正要求（第 4 版已写入正文）：四处判定一律改成「先按当前作用域取集合再算长度与 nextActive」，`rightPanelActiveTabId` 的写入点改成按 sessionId 写 map，并保留 `closeRightPanelTab` 的 preview 双层栈分支不被绕过。
  - **⚠️ 本条的「四处 / 三个写入点（`ui-store.ts:114/:118`、`preview-panel-slice.ts:151/:170`）」列举口径已被 ❌16 推翻** —— 实测写入面是它的 5 倍以上，最终修法以下一条 ❌16 的 helper 收口为准，不要再按这四处逐点手改。

### ❌16 修 ❌14 时发现标量写入面被严重低估（第 4 版修订中自查，非新一轮验证）

- 触发过程：按 ❌14 的「四处」动手时，为核 `ensureBrowserTab` 顺手读到 `ui-store.ts:440-441`，才发现 `rightPanelActiveTabId` 全仓远不止四处。若不实测就照抄 ❌14 的列举，执行者会改完四处、留下十几处散写，而这正是 ❌14 要修的那类静默失效。
- 实测计数（第五轮按下述命令自核，勿信本文自述）：
  - `grep -n "rightPanelActiveTabId:" src/renderer/src/stores/{ui-store.ts,ui-store-tab-slice.ts,preview-panel-slice.ts}` → **20 行**（`ui-store.ts` 6 / `ui-store-tab-slice.ts` 11 / `preview-panel-slice.ts` 3；含 `ui-store.ts:83` 初值；`ui-store-interface.ts:61` 类型声明不在路径内）。
  - `grep -n "rightPanelOpen:" src/renderer/src/stores/{ui-store.ts,ui-store-tab-slice.ts,preview-panel-slice.ts,right-panel-tab-factories.ts}` → 20 行，扣 `right-panel-tab-factories.ts:19`（返回类型标注，真实赋值在 `:20`）= **19 处**。
  - 读取侧另 2 处：`RightPanel.tsx:89-90`、`SubAgentsPanel.tsx:243-246`（后者从**未过滤全局集合 + 全局标量**推导「当前选中的子 Agent」，activeTabId 变 per-scope map 后必须按作用域取值，否则子 Agent 选中态跨会话串）。
- 定案（已写入正文）：
  - `rightPanelActiveTabId` → `Record<tabScopeId, string>`，20 个落点**统一收进新建 `src/renderer/src/stores/right-panel-scope.ts` 的两个纯 helper**（照 `preview-panel-helpers.ts`「helper 返回 patch、slice 只 set」的既有范式），不逐处手改；配 `[自动]` 门禁「改造后上述 grep 只剩 map 初值 1 行」，使收口可机械验证。
  - `rightPanelOpen` **保持全局单值**：切会话时面板自动出现/消失比现状更令人意外，B3 抱怨的是 tab 串会话而非开合状态。19 处里 18 处原样保留，**只改 `ui-store.ts:114` 的收起判据**为「当前作用域集合为空即收起」。副作用写进验收：A 收起时 B 的 tab 未被删，切到 B 重新展开仍是 B 自己的激活项。

### ❌15 步骤 3 未处理「删除会话时的作用域回落旁路」

- `session-slice.ts:150-152` 在 immer 事务内直接 `state.activeSessionId = state.sessions[0]?.id ?? null`，**不经 `setActiveSession`**；侧栏删除入口 `workspace-sidebar-items.tsx:174 deleteSession(session.id)` 之后也不做任何导航。
- 后果：新模型下面板按 `activeScopedSessionId` 过滤，而接管该字段的动作挂在 `setActiveSession` 上 ⇒ 删掉当前会话后锚点仍停在已删 id，过滤结果恒空（面板空白，直到用户手动再切一次）。与验收「删除会话后其 tab 不留存」「全局与项目会话互不污染」直接冲突。
- 修正要求（第 4 版已写入正文）：该回落路径同样调用 `syncSessionScopedState`，并沿用同文件 `:178-183` 已注明的 `void import('@renderer/stores/ui-store')` 惰性范式（顶部直接 import 会踩 chat-store → ui-store 循环）。

## 四、本轮新增 ⚠️（已全部修入第 4 版正文）

- **⚠️31 `userMessageText` 的必要性前提不实**：`UserMessage.tsx:57` → `extractEditableUserMessageDraft`（`lib/image-attachments.ts:168`）→ `extractEditableText:132-155` 的 `:148 stripSystemRemindersOnly` 已把整块 `<system-reminder>` 剥掉，会话标题另在 `chat-store/index.ts:289` 用正则剥一次 ⇒「注入块进 content 后用户气泡与重载历史都会显示一大段原始 XML」为假。字段本身值得留，真正受影响的是 store/DB 的 `text`（`:185-192` 反推不剥离、`:214` 直接落库），依据要照这个改写成「保持落库文本干净」，不要留成气泡会脏的假事实。
- **⚠️32 meta 挂载时机要收紧**：`beginUserTurn`（`index.ts:244`）经 immer 深冻结该对象且全仓无 `setAutoFreeze` ⇒「`:258` 之前任意时刻挂上」不成立，只能在乐观消息构造期（真实区间 `:208-220`）挂。
- **⚠️33 步骤 6 未声明旁路边界**：7 个绕过 `handleSendMessage` 装配的 store 级直连调用方 —— `use-chat-actions.ts:408/464/542`、`hooks/use-background-subagent-wakeup.ts:78`、`hooks/use-channel-auto-reply.ts:264`、`lib/tools/cron-runtime.ts:406`、`lib/tools/project-send-message.ts:103` —— 其文本若含 `<select-file>` / `@{}` 会静默不注入，须写明是本批接受的边界还是必改方。
- **⚠️34 相对→绝对路径规则缺失**：`lib/select-file-editor.ts:145-147` 与 `components/cowork/use-file-tree.ts:297` 产出的 `sendPath` 是相对 `workingFolder` 的相对路径，而 `fs:read-file` 要绝对路径。正文只写「解析绝对路径」，缺拼接与越界防护，按现状 6b 的「路径不可解析 → 仅路径引用」会把项目文件全部退化成不读盘。
- **⚠️35 `failed` 态当前判不出来**：`src/main/ipc/fs-handlers.ts:73-80` 对 ENOENT/EISDIR **返回 `''` 不抛**，`ssh-fs-handlers.ts:79-81` 任何错误也返回 `''` ⇒ 「读失败」与「空文件」不可区分；`lineCount` / `maxLines` / `skipReason` 三项 meta 必须新模块自己算（母本既无行数上限也无扩展名白名单）。
- **⚠️36 步骤 6a 的 `[自动]` grep 判据不可满足**：现命中 2 处（`dynamic-context.ts:74` 调用 + `:185` 定义），迁移后按定义「新模块（定义）+ `use-chat-actions.ts`（唯一调用方）」必然命中**两个文件**，判据须改成「仅命中这两处」或让新模块内部自留调用；`<selected_files>` 那条判据迁移后成立（现仅 `dynamic-context.ts:243` 一处，开闭标签一起迁走）。另 6a 的 `[自动]` 带了 `dotnet build`，本步无 C# 改动，属冗余无害。
- **⚠️37 常驻层与过滤集合的关系正文未表态**：`RightPanel.tsx:92-94` 注释自陈「webview 常驻以便 Agent 浏览器工具后台继续跑」，而 `:95-96 hasBrowserTab` 与 `:108 hasFilesTab` 读的正是待过滤的同一个 memo；同时 `:97-101 browserPanelKey` 已经按 `session:${panelSessionId}` 作 key，**跨会话本来就 remount**。定案：常驻层判据继续读未过滤集合，过滤只作用于 tab 条与激活项，验收改成「同会话内收起面板 / 切 tab 不卸载」。
- **⚠️38 清单口径**：`right-panel-tab-factories.ts`、`ui-store-browser-slice.ts` 列了「必改」但按正文其实零改动（真正的 browser 写入方在 `ui-store.ts:410`）；`lib/api/types.ts` 四个类型均已就位、大概率零改动；`RightPanel.tsx` 在清单里只挂步骤 4、未标步骤 3；「`openPreviewTab` 必须写会话键」是**已满足项**（`preview-panel-slice.ts:67-68` 已写 sessionId/projectId，previewTabId 本身内嵌 `session:` scope），preview 侧真正要改的是 §三 ❌14 列的两处。

## 五、行号复核表（本轮实测，含第 4 版新写文本）

| 引用 | 计划声明 | 实测 | 判定 |
|---|---|---|---|
| `chat-store/index.ts:200-218` | 乐观 userMessage 构造 | 真实 `:208-220`（200-207 是 runId 注释与生成） | ⚠️ 漂移 8 行 |
| `ui-store.ts:410-442 ensureBrowserTab` | browser tab 写入方 | 真实 `:410-444`（`:443` 收 return、`:444` 收 set） | ⚠️ 区间截断 |
| `RightPanelHeader.tsx:122-133 / :135-148` | TabButton 两分支 | 真实 `:123-133`（普通 button）/ `:136-148`（motion） | ⚠️ 各偏 1 |
| `ui-store-tab-slice.ts:36-46 ensureSubAgentTab` | 目标形态 | 形态正确，但真实表达式是 `(requestedSessionId?.trim() \|\| null) ?? …`，计划漏了 `\|\| null`（少了它 `'  '` 会得到空串而非 null → tabScopeId 空前缀）；去重落点在 `:47`，在引用区间外 | ⚠️ |
| `chat-store/index.ts` 其余 | 接口 `:69` / 实现 `:168` / `userText :182-193` / `dbUpsertMessage :258` / payload `:330-342` | 逐条命中（payload 真实 `:330-344`，`...params` 在 `:335`） | ✅ |
| `session-slice.ts` | `setActiveSession:189-203` 不触面板；`:178-183` 惰性 import 范式；`updateMessage:434-443` 只 Object.assign 不写库 | 三处精确（惰性范式真实到 `:186`） | ✅ |
| `ui-store.ts` | `:83` 单一全局 activeTabId / `:103-118` 双层栈 / `:120-133` / `:214-227` per-session map / `:326-327 syncSessionScopedState` 零调用 | 全部命中（`closeRightPanelTab` 闭合在 `:119`，漂移 1 行可忽略；`syncSessionScopedState` 确认除 `ui-store-interface.ts:235` 声明外零调用） | ✅ |
| `tab-slice` 单例约束 | `:137` files / `:160` summary 按 kind 去重；`138-140` 只激活；`162-165` 改写归属 | 命中（`ensureSummaryTab` 改写体真实 `:161-166`；固定 id 在 `:21/:122/:142/:168`） | ✅ |
| `openGoalPanel:89 / :90-92` | 按 `goal:${projectId ?? 'global'}` 建 id、按 kind+projectId 去重 | 命中；goalId 写于 `:96`、`RightPanel.tsx:187-194` 只读 `tab.projectId/sessionId/goalId` ⇒ projectId 降级为数据字段不丢功能 | ✅ |
| `use-chat-actions.ts` | `:31` 死字段（全仓 3 处命中）/ `:122-130` scope 解析 / `:173 userContent` / `:210 messages` / `:765-780 getRequestText` / `:782` 起排队 / `:234 return started` | 全部命中（`:122-129` 为准，`:130` 是 console.log；排队重放 `:909-915 handler({ text: item.requestText, queuedDispatch: true })` 确实回到同一入口） | ✅ |
| `dynamic-context.ts` | `:16-18` / `:24` 零调用 / `:38` / `:73-83` / `:185-252` | 全部命中；`resolveFileContextBudget:254`、`truncateToTokenBudget:265` 在引用区间**之外**，「含二者」需按整段迁出理解 | ✅（表述可收紧） |
| `select-file-tags.ts` | `:27` / `:35` / `:130-138` 按位置重叠去重 / `:141` / `:159` / `:183-187` | 全部命中，`continue` 条件确为区间重叠 ⇒ 非路径去重 | ✅ |
| `api/types.ts` | `:331/:344/:358/:361` | 四个行号全对；`selectedFileReads` 全仓写入方仍为 0 | ✅ |
| `user-message-views.tsx:40-68` | 六态就位 | 真实逻辑块 `:33-72`（末态在 69-72），字段与 `SelectedFileReadItemMeta` 对齐，无需新建组件 | ✅ |
| `SubAgentsPanel.tsx` / `TitleBar.tsx:100` / `SessionConversationPane.tsx:121/128` | 消费方与点击回调 | 精确；`TitleBar` 确为无参（接口 `ui-store-interface.ts:274` 该参可选），今天走无参路径产出的 files tab `sessionId = null`；121/128 都在 `useCallback` 内（`:119-122`、`:126-129`） | ✅ |
| `InputArea/index.tsx` | `:331-333` GoalSessionBar、`:335-339` 挂载点、`:341` 开容器、`:345` className | 全部命中 | ✅ |

## 六、文档侧问题（「阻断项看不到减少」的直接原因）

1. 第 3 轮之后 `plan.md` 被**就地改了正文**（步骤 3 换会话化模型、新增 6a-2），但头部版本行仍写「本版本（第 3 版）已修正首轮 8 项与第 2 轮 3 项」，读起来像第 3 轮从没发生过。
2. `compliance_report.md` 每轮只往后追加、不回写上一轮状态，前三轮 ❌ 的「已关闭」只散落在各轮自己的复核表里，而文档第一句永远是第 1 轮的「总判定：FAIL ❌8」。
3. 本目录三份文档**连续三轮全部 untracked**，dev-workflow 阶段二/三 要求的 `docs(plan)` commit 一步没做，等于没有任何可 diff 的收敛轨迹。
4. `docs/PROGRESS.md` 里没有本批条目（阶段三明确要求「完成后更新 PROGRESS.md，commit + push」）。

处理进度（本轮落地状态，供第五轮直接定位）：

| 项 | 动作 | 状态 |
|---|---|---|
| ① | 本报告改为「顶部台账 + 仅最新一轮」，前三轮正文删除 | ✅ 已完成（557 → 本文件；旧全文 `git show fe5dcc3:docs/plans/iter-v2-24/plan-issues-batch-2/compliance_report.md`） |
| ② | `plan.md` 版本行改为第 4 版并列明本版关闭/残留 | ✅ 已完成（头部「本版本：第 4 版」块 + `exploration_findings.md` 同步升到第 4 版，含其头部版本行此前滞后一版的修正） |
| ③ | dev-workflow 阶段三补硬规则 | ✅ 已完成：`docs/dev-workflow.md` → 阶段三 → **「多轮验证与收敛台账（硬规则）」五条**（台账唯一进度口径 / 正文只留最新一轮 / 每轮必须 commit / 「已修」≠「已关闭」 / 每轮重跑「涉及文件一致性 + `[自动]` 门禁可运行且不冲突」两条机械检查）。同时把输出路径占位从 `docs/plans/plan_XXX/` 校准为实际的 `docs/plans/iter-v2-{N}/plan-XXX/` |
| ④ | 本目录补 commit | 🟡 基线 `fe5dcc3` 已提交（含删除前三轮前的完整 557 行版本），本轮收口为第二个提交 |
| ⑤ | `docs/PROGRESS.md` 补批次条目 | ✅ 已完成（v2-iter-24 节下新增批次 2 行：阶段 / 阻断账面 / 下一步） |

## 七、结论与进入执行态前必做

第四轮的复核结论是 FAIL：❌12 关闭且其方案的关键前提经全仓复核为真，但 ❌13 只修了正文、清单半边没补，会话化模型另带 ❌14/❌15 两处「正文动作不足以让验收成立」的洞。**该判定按第四轮当时状态记账，不因后续修订追溯改动**；同一次工作会话内随后已把这些项与 ⚠️31–⚠️38 全部按代码事实写进第 4 版正文（定点修订，不动步骤骨架）。修订过程中自查出的 ❌16 属于同一批动作，且它推翻了 ❌14 自己的改动面计数——这恰好说明「已修」为什么不能算「已关闭」：修 ❌14 的那段正文本身带着一个会被照抄的错误数字。故台账上 4 项一律为「第 4 版已修，待第五轮复核」，不存在「未修」项。

按 dev-workflow 阶段三阻断规则（❌ > 0 禁止进入用户确认环节）+ 台账规则第 4 条（「已修」≠「已关闭」），下一步二选一：

- **(a) 推荐**：再跑一轮定点复核 —— 只看 ❌13 清单半边 / ❌14 / ❌15 / ❌16 与 ⚠️31–⚠️38 的修入结果。其中 ❌16 的三项计数正文已给出可直接执行的 grep，**须实跑核对而非读文确认**（20 / 19 / 读取侧 2）；另加新规则要求的两条机械检查（涉及文件 ↔ 步骤动作一致性——本轮新增的 `right-panel-scope.ts` 已在「新建」清单内、`[自动]` 门禁可运行且不冲突）。范围小、可快速完成，清零后再交老大确认。
- **(b)** 老大明确豁免其中某几项，把豁免结论与理由记进台账，账面按「已豁免」计。
