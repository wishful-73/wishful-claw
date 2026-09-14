# 探索结论：iter-v2-29（S-16 ~ S-25）

> 探索日期：2026-09-14。只读探测，未修改任何产品代码。
> 方法：主 agent 委托 3 个 subagent 并行探测（渲染端 / C# 后端 / 新能力）。
> **行号均为 2026-09-14 实读**，立项时按当时代码复核。
> 事实与推断严格分开；凡标「推断」的均为未在代码中证实的假设，须实测复核。

## 总览

| # | 需求 | 主要落点 | 初判 | 有口径待定 |
|---|---|---|---|---|
| S-16 | 输入框长粘贴折叠块 | 渲染端（编辑器族） | 中（要动 undo 与受控状态） | 撤销粒度 |
| S-17 | 代理调用显示真实工具名 | 渲染端（状态条） | 小 | 卡片口径、skill 显示形态 |
| S-18 | 右侧面板 Git 分支视图 | 渲染端 + 新增 git IPC | 中（图谱须新开） | Tab 位置、图谱选型 |
| S-19 | 软件自身界面截图 | 主进程（新 IPC）+ 工具 | 中 | 截自身窗口 vs 整桌面 |
| S-20 | 自定义服务商携带请求头 | 仅需 UI + 复用既有注入口 | **小** | 静态值 vs 动态值 |
| S-21 | 多服务商限额 fallback | C#（AgentLoop + 重试策略） | 中 | 切换粒度、产物处理 |
| S-22 | 全局回报后新消息未到微信 | 渲染端（渠道回推注册） | 小（根因已定位到点） | — |
| S-23 | 内置搜索中文失效 | C#（搜索 provider） | 小→中 | 只修 bug vs 补语言能力 |
| S-24 | 用量明细上移进选项卡 | 渲染端（设置页） | **小** | — |
| S-25 | Agent 工作时间线 | 新建表 + 新面板 | 大 | 粒度、建表 vs 聚合视图 |

---

## S-16 输入框长粘贴折叠块

**现状**

- 编辑器是 `contentEditable` div（非 textarea），主文件 `src/renderer/src/components/chat/FileAwareEditor.tsx:446-452`，依赖同目录三个工具文件：`file-aware-editor-utils.ts`（`parseDomToDocument` / `renderDocument` / `getSelectionOffsets`）、`file-aware-editor-ime.ts`、`file-aware-editor-undo-selection.ts`。
- 外层容器 `InputArea/composer-editor-area.tsx:189`；状态 hook `InputArea/use-composer-editor.ts:23`（`documentNodes` + `selectedFiles` 双状态）。
- 粘贴走 **paste 事件拦截 + `document.execCommand('insertHTML')`**：`use-composer-interactions.ts:51-74`，`:67` 插入，`:73` 失败才回退受控路径 `replaceSelectionWithText`。`:65-66` 注释说明不用 `insertText` 的原因（换行被 Blink 拆 `<div>`、连续 insertText 并入同一撤销组）。
- **undo/redo 无自定义栈**，完全依赖浏览器原生。只在边界打补丁：`file-aware-editor-undo-selection.ts:5-7`（`isHistoryInputType` 判 `historyUndo`/`historyRedo`）、`:32-40`（`collapseRestoredHistorySelection` 收起幻影选区），调用点 `FileAwareEditor.tsx:296-305`。
- 草稿：key 三级派生（`index.tsx:170-175`），定义在 `lib/input-drafts.ts:35/46`；读写桥 `hooks/use-input-draft-persistence.ts:29-91`；恢复 `use-input-area-effects.ts:105-127`，保存 `:142-154`（400ms 防抖）。
- **提交取值出口唯一**：`index.tsx:258-278` `handleSend` → `flushPendingInput()`（`:261`）→ `getLiveEditorState()`（`:262`）→ `promptText`（`:263`）。`getLiveEditorState` 定义在 `use-composer-editor.ts:137-152`。

**推断（须复核）**

- 「替换回全文」落点应在 `handleSend` 内 `:262-263` 之间（唯一取值出口）。
- chip 原文需挂 `EditorDocumentNode`（`lib/select-file-editor`）的**新增节点类型**，才能同时被序列化进草稿与被 `renderDocument` 渲染成 chip。
- `execCommand('insertHTML')`（`:67`）会绕过受控 state，长粘贴折叠必须在此处改走 `replaceSelectionWithText`，否则 chip 写不进 `documentNodes`。

**待定口径**：折叠块的撤销粒度（回填/移除算一条 undo 记录还是多条）。

---

## S-17 代理调用状态显示真实工具名

**现状**

- 状态条：`InputArea/runtime-status.tsx:361-370`（`Running {{tool}}`），取值逻辑 `:174-178`，`:191` `activeToolName = activeTool?.name`。浮窗同款副本 `composer-status-indicator.tsx:77、151-156`。
- 审批提示：`runtime-status.tsx:327-336`，`:178` 取 `pending_approval`，`:192` 赋值；副本 `composer-status-indicator.tsx:78、117-121`。
- `capability_id` 三种形态的解析已在渲染端：`lib/agent/use-capability-proxy.ts:22-73` —— `builtin:ToolName`（`:43-48`）、`skill:name` → 名固定为 `'Skill'`（`:51-56`）、`mcp-tool:server/tool` → `mcp__server__tool`（`:59-70`）。C# 侧同构：`AgentRuntimeUseCapabilityExecutor.cs:50/61/73/110`。
- 工具调用记录带 `input` 字段（`lib/agent/types.ts:31-43`），即 `arguments.capability_id` 可读。
- 卡片隐藏处：`execution-outline.ts:101-113`，`HIDDEN_TOOL_NAMES` 含 `'use_capability'`（`:112`），注释 `:110-111`；判定函数 `isHiddenExecutionToolName` `:131-133`。
- i18n：`locales/index.ts:16-18` 自动装载；关键 key `locales/zh/chat.json:134`（`runningTool`）、`:135`（`awaitingApproval`）。

**推断（须复核）**

- 仍显示 `use_capability` 的根因可能是 `lib/agent/stream-event-adapter.ts:45-57`：`tool_use_streaming_start` 分支构造 `rewriteProxyEvent({... input:{}})` 时 `input` 为空，`resolveProxyDisplay` 在 `:30-32` 拿不到 `capability_id` 直接返回 `null` 不重写；而 `tool_call_start` 分支（`:94-98`）才带完整 input。若 `pendingToolCalls` 由 streaming_start 建条目，名字就固化。
- 最小改动点是 `runtime-status.tsx:191/192` 处对 `activeTool?.name` 再套一层 `resolveProxyDisplay(activeTool?.input)`；但 `skill:` 分支返回固定 `'Skill'`（`:53`），与需求期望的 `skill:xxx` 不一致。

**待定口径**：① 聊天窗内 `use_capability` 卡片是否也改成显示真实工具名（目前被刻意隐藏）；② skill 类显示成 `skill:xxx` 还是 `Skill`。

---

## S-18 右侧面板 Git 分支视图

**现状**

- Tab 是组件内 `useState<'files'|'changes'>`（`layout/AgentFilesPanel.tsx:15`），两个裸 button（`:52-57`），`:60` 三元渲染，**无 Tab 配置数组、无第三 Tab 扩展位**。
- git IPC 全在 `src/main/ipc/git-handlers.ts`：`list-branches`(:160)、`create`(:164)、`checkout`(:176)、`merge`(:185)、`rebase`(:191)、`delete-local`(:197)、`delete-remote`(:206)、`rename`(:215)、`fetch`(:230)、`pull-rebase`(:236)、`push`(:242)。
- `list-branches` 返回 `{branches: GitBranchItem[], current}`，`GitBranchItem = {name, fullName, type:'local'|'remote', isCurrent}`（`git-cache.ts:65-70、104-105`）；C# `ListBranchesAsync`（`Modules/Git/GitQueryTools.cs:248-271`）用 `for-each-ref` 分扫 `refs/heads` 与 `refs/remotes`，**本地/远程已可区分**。
- **提交图谱确实没有现成 IPC**：`GitQueryTools.cs:24-39` 的 operation 分发表只有 12 项，无 `--graph`；`get-commit-history`（`:218-229`）只吐 hash/author/date/subject，**无 parent 字段**，前端无法推导线。
- 缓存两层：主进程 `git-cache.ts:125-127`（`list-branches` 归 5s STABLE TTL，`:155-160`）；渲染端 `git-store-types.ts:188-197` 另有一套 pending Map + TTL。`useGitStore` 在 `stores/git-store.ts`。
- 多仓库：`layout/changes-panel.tsx:46` 用 workingFolder 匹配 repositories，**隐式选仓、没有下拉选择器**；`GitPage.tsx:293-308` 的 ScmSidebar 有 `repositories/selectedRepoPath/selectRepository`（`git-store.ts:88`）可复用。

**推断（须复核）**

- 加「分支」Tab 需把 union 扩为三值并把三元改 switch。
- 图谱必须**新增 git operation**（`git log` 含 `%P` 取 parent），前端才有数据可画。
- 仓库选择器可从 ScmSidebar 复用。

**待定口径**：① 新 Tab 还是在「变更」Tab 内找锚点；② 图谱绘制 SVG 手绘还是引依赖。

---

## S-19 软件自身界面截图能力

**现状**

- `captureDesktopScreenshot()` 在 `src/main/ipc/desktop-control.ts:122-161`：固定 `screen.getPrimaryDisplay()`（`:124`）、只 `types:['screen']`（`:131`），**无窗口/区域入参**；返回 base64 + width/height/mediaType（`:145-153`），**不落盘**。工具声明 `DesktopToolProvider.cs:17-23`，入参仅 `delayMs`。
- **Electron 通路有先例但未开放成 IPC**：`src/main/ipc/channel-handlers/qr-page-capture.ts:135` 已有 `win.webContents.capturePage(bounds)`（离屏窗口 + 区域 bounds → data URL），但**是纯内部函数未注册 IPC**；全仓无 `capturePage` 的 IPC handler。
- `image:persist-generated` 在 `src/main/ipc/misc-handlers.ts:268-292`，目录由 `getGeneratedImagesDir()`（`:246-251`）**写死** `homedir()/wishful-claw/image`，文件名 `Date.now()-uuid`，**args 不接受目标路径**。
- 其它采集通路：`BrowserScreenshot`（`AgentRuntimeBrowserExecutor.cs:29`）、`desktop:screenshot:capture` 反向请求（`src/main/ipc/native-agent-runtime.ts:135-146`）。`image:download` / `image:fetch-base64` 只在 `messagepack-channel-routing.ts:167-169` 声明，**主进程未找到 handler**。
- 挂 IPC 的模式：`registerMessagePackHandler<TArgs,TResult>(channel, handler)`（`src/main/ipc/messagepack-handler.ts:10-25`），样板见 `misc-handlers.ts:19-33`；主窗口引用 `getMainWindow()`（`src/main/main-window-registry.ts:22`）。

**推断（须复核）**

- 可行路径：新增 `window:capture-self` handler → `getMainWindow().webContents.capturePage(rect)`；再给 `image:persist-generated` 加可选 `targetPath`（或走 Worker 文件写工具）落盘到仓库路径。

**待定口径**：截**自身窗口**（干净、无脱敏负担）还是仍支持**整桌面/区域**（能拍悬浮窗与多窗关系）。

---

## S-20 自定义服务商携带特定请求头

**现状（关键发现：机制已具备，缺的只是 UI）**

- `AIProvider`（`src/shared/types/provider.ts:295-370`）**无 headers/extraHeaders 字段**，但已有 `requestOverrides?: RequestOverrides`（`:349`）；`RequestOverrides` 定义 `:93-100`，**含 `headers?: Record<string,string>`**。
- UI 侧 `AddProviderDialog.tsx:39-48` 只收集 name/type/baseUrl/apiKey/homepage；`ProviderConfigPanel.tsx` 未出现 requestOverrides/headers → **没有任何请求头配置项**。
- **已存在统一注入口**：`ProviderRequestOverrides.ApplyHttpHeaderOverrides(request, provider)` 读 `provider.requestOverrides.headers`（`src/runtime/WishfulClaw.Agent/ProviderRequestOverrides.cs:61-71`），被 `OpenAIChatHeaders.cs:26`、`AnthropicMessagesProvider.cs:209`、`OpenAIResponsesProvider.cs:244`、`ContextCompression.cs:550/695` 调用。
- `x-opencode-session` 目前是**内置 preset 特判**：`OpenAIChatHeaders.cs:27-32、45-50`、`ContextCompression.cs:697-702`、`ProviderTestService.cs:208-211`，条件均为 `builtinId == "opencode-go"`。值是**动态**的（取运行时 `sessionId`，`OpenAIChatHeaders.cs:12,31`）。
- 传递链已通：`sidecar-mapping.ts:153`(providerBuiltinId)、`:155`(sessionId)、`:168`(requestOverrides) → `sidecar-protocol-types.ts:112,119` → Worker。

**推断（须复核）**

- 最小改动 = **复用既有 `requestOverrides.headers`，只在服务商设置 UI 暴露一个请求头编辑器**，C# 与传输层**无需改动**。这印证了 29 侧文档里"偏向给自定义服务商补通用能力、而不是再加 preset"的推定。

**待定口径**：用户填的是**静态固定值**就够，还是要支持**动态占位**（如 `{sessionId}`）？OpenCode Go 的会话标识是动态的，若只做静态值仍解决不了它的场景。

---

## S-21 多服务商限额自动 fallback

**现状**

- `ExecuteTurnAsync` 签名（`AgentLoop.cs:526-532`）：`(parameters, provider, conversation, toolDefs, state, context)`。`conversation` 来自 `SessionConversationManager`（`:64、148-149`），`toolDefs` 来自 registry（`:183-192`）。
- 调用点 `AgentLoop.cs:319-328`，外层 `while(true)` 带溢出压缩重试（`:332-374`）。
- `ProviderRetryPolicy.ExecuteAsync`（`ProviderRetryPolicy.cs:80-172`）：`ResolveMaxRetryAttempts` `:178-192`（缺失=10，0=无限）；`TimeoutException` `:101-130`；`ProviderHttpException` `:131-155`；**终止分支 `:156-170` 直接 throw**。退避 `ComputeDelayMs:213-236`（Retry-After 优先、>10 次固定 60s、指数 500ms 封顶 15s + 250ms 抖动）。事件发射 `:120-128、143-153`（`request_retry`）。取消靠 `!state.IsCancellationRequested`。
- 耗尽后异常上抛 `AgentRuntimeTools.cs:291-304`，发 `error` + `loop_end:error`。
- provider 载荷由 `sidecar-mapping.ts:126-189` 构造（`requestMaxRetries` `:149-151`）；类型 `src/shared/types/provider.ts:295-360`。
- 三家 Provider 入口签名一致（`AnthropicMessagesProvider.cs:36`、`OpenAIResponsesProvider.cs:29`、`OpenAIChatProvider.cs:28`），均为 `internal static partial class`，**无接口**（Agent 项目内 `interface I` 零命中），切换靠 `AgentLoop.cs:534-550` 的 if 链。
- **无任何优先级/排序/候选字段**；`fallback` 全仓仅命中渠道与 MCP；唯一排序语义是 `provider.ts:338` 的 `oauthAccounts`。
- 事件链路 `AgentRuntimeTools.cs:228-269`，渲染端 `chat-store/index.ts:1567` 处理 `request_retry`。

**推断（须复核）**

- fallback 最自然的落点是 `AgentLoop.cs:526`，只需替换 `provider` 元素即可保住 `conversation`/`toolDefs`/`state`。
- ⚠️ 切出 `openai-responses` 会丢 `OpenAIResponsesState` 里的 response id（未实测）。

**待定口径**：同 S-21 节——切换粒度、已产出流式内容与工具调用的处置、`requestMaxRetries=0`（无限）是否仍不切换、取消语义、限额识别不出时的降级。

---

## S-22 全局任务回报回推后新消息未到微信

**现状（根因已基本定位到点）**

- 回报投递：`AgentRuntimeGlobalDispatchReplyExecutor.cs:141-194` —— 取 `source_session_id`（`:143-146`）→ 组 content（`:151-153`）→ `sessionMode:"global"`（`:165`）→ `AgentRuntimeReverseRequests.RequestAsync("project/send-session-message")`（`:171-172`）。`delivered` 语义**仅为"反向请求没抛异常"**（`:174-177`），与微信推送无关。
- 渲染端 handler：`src/renderer/src/lib/tools/project-send-message.ts:59`，在 `:193` 直接调 `chatStore.sendMessage`，**全文件无 `registerExternalChannelReply`**。
- 渠道外发机制：`activeAutoReplies` 以 **sessionId** 为 key（`use-channel-auto-reply.ts:86`），写入点 `:100`（外部注册）与 `:257`（渠道入站）；外发 `enqueueChannelReply:353-372` → `channel-plugin-handlers.ts:148/158` → `sendChannelMessage:93`。**触发条件 `use-channel-auto-reply.ts:487-515`：必须命中 `activeAutoReplies`，`loop_end` 才发。**
- 现有注册方只有三处：`use-chat-actions.ts:117`、`cron-runtime.ts:388`、`session-follow-up-runtime.ts:140`。
- 会话标识：`DbPluginSessionRouting.cs:36` 用 `pluginId+chatId` 合成 key，`:49-57` 复用同一 session，`:69` 无项目时 `scope="global"` —— **渠道会话与全局会话可以是同一 sessionId**。
- 日志降级设施已就绪：`src/main/lib/logger.ts:39-54`（`setLogMinLevel`、环境变量 `WISHFUL_CLAW_LOG_LEVEL` `:34-37`），应用点 `settings-handlers.ts:23-36`，UI `LogsPanel.tsx:111/171-184`。

**推断（须复核）**

- 根因：回报触发的那一轮**没有进 `activeAutoReplies`**，故 `loop_end` 时无人回推到渠道。修点在 `project-send-message.ts:193` 前补注册（把渠道归属信息带到这一轮）。
- 仍需先**实测复现**确认，不要直接按推断改。

---

## S-23 内置搜索对中文查询失效

**现状**

- 语言相关参数（`WebSearchProviders.cs`）：
  - Google `:18` `hl=en&num=&gbv=1` + `:22` `Accept-Language: en-US,en;q=0.9`
  - Bing `:37` + `:41` 同样 `en-US`
  - **Baidu `:54` + `:58` 是 `zh-CN,zh;q=0.9,en;q=0.8`（唯一正确的）**
  - Tavily `:76-83`、Searxng `:91`、Exa `:103-110`、Bocha `:122-129`、Zhipu `:140-147` **全部无任何语言/地区参数**；全仓无 `lr` / `mkt` / `setlang` / `gl`
- 结果解析（Google `:145-170`、Bing `:172-193`、Baidu `:195-215`）均为**英文站 class 白名单**。
- ⚠️ **schema 与执行器不匹配**：工具声明入参是 `count`（`WebToolProvider.cs:23`），执行器读的是 `maxResults`（`AgentRuntimeWebSearchExecutor.cs:57`）与 `searchMode`（`:60`）→ `count` 恒被忽略；渲染端传的 `searchEngine` 也无人读取。
- 配置：`AgentRuntimeWebSearchExecutor.cs:96-117` 读 `parameters.webSearch.{enabled 默认 false(:112)/provider/apiKey/maxResults/timeout}`；渲染端 `sidecar-mapping.ts:199-214`（`webSearchEnabled` 为假直接返回 undefined `:205`）。
- **设置页无入口**：`components/settings` 下 grep `webSearch|联网搜索` 零命中；仅 `InputArea/index.tsx:112-115` 有开关，provider/apiKey 无 UI。默认值 `settings-store.ts:337-340`：`enabled=false, provider=tavily, apiKey=''`。
- 提示词里仅 `PromptBuilder.cs:356`（渠道会话块）提到 web tools，无 WebSearch 使用引导。

**推断（须复核）**

- 中文失效主因是 Google/Bing 的 `hl=en` + en-US 头硬编码，以及 Baidu 的 class 白名单（短中文词易落进词典/翻译卡片）。
- ⚠️ 矛盾点：当前默认值下 `provider=tavily` 且 `apiKey=''`，**按理会直接报错而不是返回词典结果** —— 说明老大实际用的 provider 配置与默认值不同，**须先确认实际配置再谈修法**。

**待定口径**：只修中文 bug，还是顺带补语言/地区入参与设置页入口（后者改动面大得多）。

---

## S-24 用量统计：请求明细上移进选项卡

**现状**

- `type UsageChartTab = 'line' | 'bar' | 'stats'`（`UsagePanel.tsx:33`）；按钮 `:314-335`，**标签是硬编码中文**（`:316-318`，未走 i18n）；渲染分支 `:337-421`。
- 请求明细区块在 `:452-472`，位于图表区（`:313-422`）与 rollup 表（`:425-450`）**之后**，是最底部。`UsageDetailTable` 定义在 `usage-detail-table.tsx:112`。
- 数据加载：`requestUsageLogs` → `workerRequest('db/usage-logs', {range, limit:20, offset:page*20})`（`:136-142`，`DETAIL_PAGE_SIZE=20` `:110`）；首次与概览并发（`:173-193`）；翻页走 `loadLogsPage`（`:218-243`，含越界回退末页 `:227-232`）。**防串号靠两个 ref**：`loadSeq`（`:162`）+ `logsLoadSeq`（`:163`）。
- 图表高度：`UsagePanelParts.tsx:290` LineChart `height=240`、`:389` BarChart `height=240`；viewBox `:305`/`:404`；**实际显示高度由 `:306` 的 `className="h-56"`（224px）决定** —— viewBox 与 CSS 两套并存，调高要一起改。
- i18n：命名空间 `settings`（`UsagePanel.tsx:145`）；`locales/zh/settings.json:1503` 起为 `usage` 段（`ranges`:1508、`stats`:1513、`chart`:1527、`detail`:1541）。**现有 `usage` 下没有 `tabs` 子键**，需新建。

**推断（须复核）**

- 加 `'detail'` 到 union → 补第四个按钮 → 插入渲染分支 → 删除 `:452-472` 原区块；顺带把 `:316-318` 硬编码标签改成 `t()`。
- 图表调高需同时改 `height` 与 `h-56`（BarChart 的 CSS 高度类在 `:400-440`，未逐行确认，立项时复核）。

---

## S-25 Agent 工作时间线（自动履历）

**现状**

> 注意：`request_usage_logs` 是模型请求/计费维度，与「Agent 干了什么」无关，**不作为本需求素材**（老大 2026-09-14 点名纠正）。

- 业务动作相关表（`Infrastructure/Db/DbClient.cs`）：`goal_events`:266（session_id/goal_id/event_type/message/metadata_json/**created_at**）、`global_tasks`:394、`global_task_dispatches`:408（created/updated/completed_at）、`tasks`:348、`session_follow_ups`:366、`cron_runs`:252（started/finished_at）、`sub_agent_runs`:125、`goal_execution_runs`:239（started/finished_at）。
- **先例**：`components/goal/GoalHistoryPanel.tsx`（648 行），数据源 `goal-history-store.ts`，形态为「计划 → 轮次 → 任务」可展开分组 + 事件流，`:537-541` 渲染 `<GoalEventTimeline>`。
- 右侧面板扩展方式：`RightPanel.tsx:79-99` 按 `tab.kind` 映射标题、`:193-198` 映射组件；kind 白名单 `ui-types.ts:54-65`，实例字段 `:67-88`，作用域收口 `right-panel-scope.ts`。⚠️ **注意 `AgentFilesPanel` 内部那套双 Tab 与这个 kind 体系无关**（S-18 走的是内部 Tab）。
- DB 读写：**无通用 CRUD 封装**，`DbClient` 仅 `Initialize/GetClient/EnsureInitialized`（`:41,612,630`）；每表一个 `Db*Tools` 静态类，在 `DbModule.cs` 用 `context.Register("db/xxx", ...)` 注册为 Worker 端点（`:144-146` goal-events、`:166-169` execution-runs）；主进程经 `dbRequest()` 转发（`session-follow-up-scheduler.ts:32`）。
- 现成时间线组件：`GoalEventTimeline`（`components/goal/goal-session-views.tsx:80-109`）—— 圆点 + 标题 + `toLocaleTimeString()` + 两行截断详情，配 `formatGoalEvent`。另有 `activity-store.ts:5-17` 的 `ActivityItem`（迭代维度，**不持久化**）。

**推断（须复核）**

- 可复刻 `goal_events` 模式：新建表 + `Db*Tools` + `DbModule` 注册 + 复用 `GoalEventTimeline`；若走右侧面板则需新增一个 `RightPanelTabKind`。

**待定口径**：① 记录粒度（工具调用级 / 轮次级 / 决策级）；② 新建统一事件表 vs 跨表聚合视图；③ 作用域（按会话/按项目/全局）；④ 保留策略（落库即须定）；⑤ UI 落点（右侧面板新 kind？设置页？）。

---

## 跨需求共性

1. **右侧面板有两套体系**：`RightPanel` 的 `tab.kind`（S-25 若走这里）与 `AgentFilesPanel` 的内部 Tab（S-18 走这里）。立项时别混。
2. **i18n 都是内联 `defaultValue` 兜底**，新增文案 key 要 zh/en 双语补齐。
3. **S-20 与 S-23 都属"机制已有、缺 UI/配置"**，改动面比预期小。
4. **S-22 根因已基本定位到点**，是十条里最可能"小而准"的修复。
