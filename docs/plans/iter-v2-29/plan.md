# Plan: iter-v2-29

> 分支：`dev/v2-iter-29`（2026-09-14 从 `main` 切出，基线 `4710c6d2` / tag `v0.2.28`）
> 原始需求：`raw-requirements.md`（S-16 ~ S-25）；探索结论：`exploration_findings.md`
> 立项日期：2026-09-14。**行号均为 2026-09-14 实读，实施时按当时代码复核。**

## 修订记录

| 轮次 | 日期 | 说明 |
|---|---|---|
| R1 | 2026-09-14 | 立项稿 |
| R2 | 2026-09-14 | 依据 `compliance_report.md` 修 7 个阻断项：①S-20 占位改为沿用既有 `{{sessionId}}`（C# 零改动）②locales 路径补 `src/renderer/src/` 前缀（7 处）③Provider 面板补 `provider/` 层级（2 处）④Baidu 解析归到 `AgentRuntimeWebSearchExecutor.cs` ⑤`select-file-editor.ts` 是单文件且已 504 行→先拆再改。另收口 9 个 ⚠️：S-25 UI 落点钉死为右侧面板 `timeline` Tab、S-21 新建回归测试工程并并入 .sln、S-20.2 明确做、S-22 标注无自验证闭环 |
| R3 | 2026-09-14 | 依据复审修 R2 引入的新问题：①S-16 的 chip 渲染落点从 `select-file-editor.ts`（grep `render` 零命中）改到 `components/chat/file-aware-editor-utils.ts:212` 的 `renderDocument`（526 行，同超阈值），并从拆分清单里去掉 `render.ts` ②`use-capability-proxy.ts` 的 `if (!capabilityId) return null` 行号 `:30` → `:32` |

## 目标

一个迭代完成 10 个需求：4 项 UI/交互收口、3 项能力补缺、2 项新能力、1 项架构级新功能。
老大 2026-09-14 拍板：**不分批，虽然细项多但大部分是小修复小调整**。

## 范围与顺序

按「小 → 中 → 大」排，前期快速建立节奏，重头放后面：

| 序 | 需求 | 一句话 | 规模 |
|---|---|---|---|
| 1 | **S-24** | 用量统计请求明细上移进选项卡，图表调高 | 小 |
| 2 | **S-20** | 自定义服务商可配置请求头（含 `{{sessionId}}` 占位） | 小 |
| 3 | **S-22** | 全局任务回报后，助理新消息回推到微信渠道 | 小 |
| 4 | **S-17** | 代理调用状态条显示真实工具名 | 小 |
| 5 | **S-23** | 内置搜索中文查询失效 | 小→中 |
| 6 | **S-16** | 输入框长粘贴折叠成 chip | 中 |
| 7 | **S-18** | 右侧面板 Git 分支视图 + 提交图谱 | 中 |
| 8 | **S-19** | 软件自身界面截图并落盘到仓库路径 | 中 |
| 9 | **S-21** | 多服务商限额自动 fallback | 中 |
| 10 | **S-25** | Agent 工作时间线（自动履历） | 大 |

---

## 全局口径裁定（立项时由 agent 定，老大在确认环节过目）

| # | 需求 | 裁定 |
|---|---|---|
| 1 | S-23 | **先只修中文 bug**（去掉语言硬编码 + 修入参不匹配）。语言/地区入参与设置页入口**本次不做**，如需要另立需求 |
| 2 | S-20 | 支持**静态值 + 动态占位**两种。**占位语法沿用既有 C# 实现 `ResolveHeaderTemplate`（`ProviderRequestOverrides.cs:126-133`），写作 `{{sessionId}}` / `{{model}}`（双花括号）**——不是新做，是接上已有轮子。纯静态解决不了 OpenCode Go（它的头值是动态的） |
| 3 | S-25 | **决策级粒度 + 新建 `agent_timeline_events` 表**（跨会话回溯，跨表聚合查询太复杂）。落库同时定保留策略。**UI 落点：右侧面板新增 `RightPanelTabKind = 'timeline'`**（与既有 `goal` 并列，复用 `GoalEventTimeline` 事件流形态） |
| 4 | S-19 | **先做截自身窗口**（干净、无脱敏负担）；整桌面/区域能力本次不做 |
| 5 | S-17 | **只改状态条与审批提示**，聊天窗内 `use_capability` 卡片**保持隐藏**（`execution-outline.ts:110-111` 的注释理由成立） |
| 6 | S-18 | 分支视图做成**第三个 Tab**（不是嵌在「变更」Tab 内） |

## 全局门禁（每个需求都要过）

- TypeScript 三配置全零错误：`tsconfig.web.json` / `tsconfig.node.json` / `tsconfig.json`（**必须带 `-p`**）
- C#：`dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误
- 涉及 C# 新 DTO 的需求（**S-19 / S-21 / S-25**）：必须跑 `npm run build:worker:prod`，AOT 无 IL2026/IL3050/IL3051；**新增具名 DTO 须注册进 `InfrastructureJsonContext` / `WishfulClawJsonContext`（含 `List<T>`）**
- 行尾：C# 多为 CRLF，单点改动直接用 Edit 工具（保留原行尾）；批量才用 Python（`newline=''`）
- i18n：**所有新增文案 zh/en 双语补齐**，沿用 `t(key, { defaultValue })` 内联兜底
- 分层：7 层单向依赖不得逆向（Contracts ← Core ← Infrastructure ← Workspace ← Persona ← Agent ← Worker）

## 提交口径

**10 个需求 + 1 个收尾修复调整 = 11 个提交。** 规划/审查/验证文档不单独提交，并入所属需求；审查与验证发现的问题全攒进收尾那一刀。

---

# 需求 1：S-24 用量统计请求明细上移进选项卡

## 目标
把「请求明细」从图表下方的独立区块移进选项卡体系（曲线图 / 柱状图 / 统计概览 / 请求明细），移走后图表高度调高，解决「图表偏矮」的错位感。

## 步骤

- [✓] S-24.1：`UsagePanel.tsx:33` 的 `UsageChartTab` 联合类型加 `'detail'`；`:314-335` 的切换条补第四个按钮，**并把 `:316-318` 硬编码的中文标签改成 `t()`**
- [✓] S-24.2：`:337` 前插入 `chartTab === 'detail'` 渲染分支，接入 `UsageDetailTable`（props 见 `usage-detail-table.tsx:116-127`）
- [✓] S-24.3：删除 `:452-472` 原来的请求明细区块
- [✓] S-24.4：图表调高 —— `UsagePanelParts.tsx:290`（LineChart `height=240`）与 `:389`（BarChart）的 `height`，**加上 `:306` 的 CSS `h-56`**（两套并存，都要改）；立项时复核 BarChart 的 CSS 高度类（未逐行确认 `:400-440`）
- [✓] S-24.5：i18n 新增 `usage.tabs.*`（`src/renderer/src/locales/zh/settings.json:1503` 是 `"usage": {`，其下只有 `ranges` / `detail`，**无 tabs 子键，需新建**），en 同步

**Mini 验证**：切换四个 Tab 无残留渲染；明细翻页仍走 `loadLogsPage`（`:218-243`）且防串号（`loadSeq` / `logsLoadSeq`）不失效；图表高度实测变大且不断轴；tsc 三配置零错误。

## 涉及文件
- `src/renderer/src/components/settings/UsagePanel.tsx` — 改
- `src/renderer/src/components/settings/UsagePanelParts.tsx` — 改（图表高度）
- `src/renderer/src/locales/zh/settings.json`、`src/renderer/src/locales/en/settings.json` — 改

---

# 需求 2：S-20 自定义服务商可配置请求头

## 目标
让用户在自定义服务商上配置额外 HTTP 请求头，解决 OpenCode Go 等要求特定头传递会话标识的上游接不进来的问题。

**关键前提（探索确认）**：机制已具备，**缺的只是设置页没有编辑器**。

- `shared/types/provider.ts:349` 有 `requestOverrides.headers`
- C# `ProviderRequestOverrides.ApplyHttpHeaderOverrides`（`:61-71`）已在 **5 处**被调用：`AnthropicMessagesProvider.cs:209`、`ContextCompression.cs:550`、`ContextCompression.cs:695`、`OpenAIChatHeaders.cs:26`、`OpenAIResponsesProvider.cs:244`
- **动态占位已实现**：`ProviderRequestOverrides.ResolveHeaderTemplate`（`:126-133`）在 `:84`（正常头）与 `:117`（debug 头）被自动调用，替换 `{{sessionId}}` / `{{ sessionId }}` / `{{model}}` / `{{ model }}`
- 传输链 `sidecar-mapping.ts:155`（sessionId）与 `:168`（requestOverrides）均已通

> ⚠️ 立项稿曾误判「占位替换需要新做」且写成单花括号 `{sessionId}`，已被合规审查纠正。**C# 侧零改动**，本需求是纯渲染端工作。

## 步骤

- [✓] S-20.1：在 `components/settings/provider/ProviderConfigPanel.tsx` 增加「请求头」编辑区（key-value 列表，增删改），落到 `provider.requestOverrides.headers`；输入框旁给占位提示 `{{sessionId}}` / `{{model}}`
- [✓] S-20.2：`components/settings/provider/AddProviderDialog.tsx:39-48` 新建流程同步支持（**做，不做则新建服务商时配不了头，闭环不完整**）
- [✓] S-20.3：**动态占位 —— 不用改代码，只做验证**。确认 `{{sessionId}}` 经 `ResolveHeaderTemplate` 生效（sessionId 已在传递链上 `sidecar-mapping.ts:155`）。仅当实测发现链断了才回头补
- [✓] S-20.4：校验与防护 —— 头名合法性校验；**禁止覆盖保留头**（`Authorization` / `Content-Type` / `Content-Length` 等），覆盖时给出明确报错而不是静默。⚠️ 既有 `IsSensitiveHeader`（`:135-141`）当前用于 **debug 脱敏**而非覆盖拦截，语义不同，**不要直接复用**，另写保留头清单
- [✓] S-20.5：OpenCode Go 内置特判（`OpenAIChatHeaders.cs:27-32、45-50`）**本次不动**，保持内置 preset 行为不变；只验证新机制能覆盖同一场景
- [✓] S-20.6：i18n

**Mini 验证**：tsc 三配置零错误；配一个自定义头后发请求，确认头带上；配 `x-opencode-session: {{sessionId}}`（**点名用 OpenCode Go 的真实头名跑一遍**）确认被替换成真实会话 id；尝试填 `Authorization` 被拒且有提示；`tests/WishfulClaw.ProviderHeaderRegressionTests` 既有断言不回退。

## 涉及文件
- `src/renderer/src/components/settings/provider/ProviderConfigPanel.tsx` — 改
- `src/renderer/src/components/settings/provider/AddProviderDialog.tsx` — 改
- `src/runtime/WishfulClaw.Agent/ProviderRequestOverrides.cs` — **只读参考**（占位已实现，预期零改动）
- `src/renderer/src/locales/{zh,en}/*.json` — 改

---

# 需求 3：S-22 全局任务回报后新消息回推微信

## 目标
全局会话派发 work request → 项目会话完成回报 → 助理收到后继续说话 → **这条新消息要推送到微信渠道**。

**根因（探索定位）**：`src/renderer/src/lib/tools/project-send-message.ts:193` 直接调 `chatStore.sendMessage`，**全文件没有 `registerExternalChannelReply`**；而渠道外发的触发条件是「必须命中 `activeAutoReplies`，`loop_end` 才发」（`use-channel-auto-reply.ts:487-515`）。回报触发的那一轮没注册，所以无人回推。

## 步骤

- [✓] S-22.1：**先复现** —— 用 `LogsPanel`（`LogsPanel.tsx:111/171-184`）把日志等级降到 debug（`logger.ts:39-54`，也可用环境变量 `WISHFUL_CLAW_LOG_LEVEL`），按复现路径跑一遍，确认真的是「回报到了、新消息没推」，而不是别的断点
- [✓] S-22.2：在 `project-send-message.ts:193` 的 `chatStore.sendMessage` **之前**补 `registerExternalChannelReply`，把渠道归属（pluginId + chatId）带到这一轮
- [✓] S-22.3：复用 `DbPluginSessionRouting.cs:36` 的 `pluginId+chatId` 合成 key，确保与入站注册的是同一个 sessionId（`:49-57`）
- [✓] S-22.4：确认这一轮结束后 `activeAutoReplies` 能正确清理（避免泄漏到后续无关轮次）
- [✓] S-22.5：i18n（若有新增提示文案）

**Mini 验证**：tsc 三配置零错误；静态确认注册与清理成对（`registerExternalChannelReply` 与注销一一对应，不泄漏到后续轮次）；
⚠️ **本需求在 agent 侧没有自验证闭环**（无微信渠道环境），真机复现只能老大做。提交时按「代码逻辑自洽 + 静态断言通过」入库，**不按默认口径标为「测通」**，收尾时单列待验。

## 涉及文件
- `src/renderer/src/lib/tools/project-send-message.ts` — 改
- `src/renderer/src/hooks/use-channel-auto-reply.ts` — 可能改（注册入口复用）
- `src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionRouting.cs` — 只读参考（key 合成）

---

# 需求 4：S-17 代理调用状态显示真实工具名

## 目标
Agent 经 `use_capability` 代理调用工具时，输入框左上角状态条显示**被代理的真实工具名**，审批提示同口径。卡片保持隐藏（口径 5）。

## 步骤

- [ ] S-17.1：**先定位真因** —— 验证推断：`lib/agent/stream-event-adapter.ts:45-57` 的 `tool_use_streaming_start` 分支构造 `rewriteProxyEvent({... input:{}})` 时 input 为空 → `rewriteProxyEvent`（调用于 `stream-event-adapter.ts:15-17`）→ `resolveProxyDisplay`（**本体在 `lib/agent/use-capability-proxy.ts:22`，`if (!capabilityId) return null` 在 `:32`**）不重写。若成立，优先修源头；若 `pendingToolCalls` 实际由 `tool_call_start`（`:94-98`）建条目，则只需改展示层
- [ ] S-17.2：`runtime-status.tsx:191` `activeToolName` 计算处套一层代理解析；`:192` `pendingApprovalToolName` 同口径
- [ ] S-17.3：浮窗副本 `composer-status-indicator.tsx:77、151-156` 与 `:78、117-121` 同步
- [ ] S-17.4：**skill 类显示名** —— `use-capability-proxy.ts:51-56` 目前把 `skill:name` 解析成固定 `'Skill'`，需补出 `skill:xxx` 形态
- [ ] S-17.5：i18n（`src/renderer/src/locales/zh/chat.json:134` runningTool、`:135` awaitingApproval，en 同步）

**Mini 验证**：tsc 三配置零错误；真实触发一次 `use_capability` 代理调用，状态条显示真实工具名而非 `use_capability`；审批提示同口径；skill 与 mcp-tool 两种形态都验。

## 涉及文件
- `src/renderer/src/components/chat/InputArea/runtime-status.tsx` — 改
- `src/renderer/src/components/chat/InputArea/composer-status-indicator.tsx` — 改
- `src/renderer/src/lib/agent/use-capability-proxy.ts` — 改（skill 显示名）
- `src/renderer/src/lib/agent/stream-event-adapter.ts` — 可能改（若确认为根因）
- `src/renderer/src/locales/{zh,en}/chat.json` — 改

---

# 需求 5：S-23 内置搜索中文失效

## 目标
修掉中文查询返回词典/翻译类结果的问题。**先只修 bug**（口径 1），语言入参与设置页入口本次不做。

## 步骤

- [ ] S-23.0：**先确认实际 provider 配置** —— 探索发现默认值是 `provider=tavily, apiKey=''`（`settings-store.ts:337-340`），按理会直接报错而不是返回词典结果，与老大描述的现象矛盾。**须先问到实际配置再动手**（见「执行前需要老大处理」）
- [ ] S-23.1：`WebSearchProviders.cs:18` Google 去掉硬编码 `hl=en`、`:22` 的 `Accept-Language: en-US` 改为可配或按查询语言推断
- [ ] S-23.2：`:37/:41` Bing 同样处理
- [ ] S-23.3：Baidu 解析的 class 白名单补中文结果形态（短中文词易落进词典/翻译卡片）—— 落点是 **`AgentRuntimeWebSearchExecutor.cs:195` 的 `ExtractBaiduResults`**（该文件 371 行；`WebSearchProviders.cs` 只有 164 行，是 partial 的另一半，别找错文件）。行号改动后会漂移，实施时重新定位
- [ ] S-23.4：**修入参不匹配** —— 工具 schema 声明 `count`（`WebToolProvider.cs:23`），执行器读 `maxResults`（`AgentRuntimeWebSearchExecutor.cs:57`）与 `searchMode`（`:60`），导致 `count` 恒被忽略。统一到 `maxResults`
- [ ] S-23.5：中英文查询各实测一遍（英文是否正常老大当时未验证）

**Mini 验证**：C# build 零警告零错误；用同一个中文 query 分别走修复前后的 provider，对比结果不再是词典条目；英文 query 不回退。

## 涉及文件
- `src/runtime/WishfulClaw.Agent/WebSearchProviders.cs` — 改（Google / Bing 语言硬编码，164 行）
- `src/runtime/WishfulClaw.Agent/AgentRuntimeWebSearchExecutor.cs` — 改（入参统一 + Baidu 白名单，371 行；两者是同一个 partial 类）
- `src/runtime/WishfulClaw.Agent/Tools/Providers/WebToolProvider.cs` — 改（schema）

---

# 需求 6：S-16 输入框长粘贴折叠块

## 目标
长文本粘贴进输入框不整段展开，折成带标签的可折叠 chip；chip 原文无损保存，提交时替换回全文。

**硬约束（探索确认）**：**undo/redo 没有自定义栈，完全依赖浏览器原生**（只在 `file-aware-editor-undo-selection.ts` 打边界补丁）。折叠块的撤销设计必须顺着浏览器原生来，不能自造栈。

## 步骤

- [ ] S-16.1：在 `src/renderer/src/lib/select-file-editor.ts:41` 的 `EditorDocumentNode`（现 `= EditorTextNode | EditorFileNode | EditorPluginNode`）增加 `pasted-block` 节点类型（`label` + `text` 原文），确保能进 `serializeEditorDocument`（草稿）与被 `renderDocument` 渲染。
  ⚠️ **该文件现已是 504 行**，加了节点类型 + 序列化后必然超阈值。实施时**先拆**：新建 `lib/select-file-editor/` 目录，按 `types.ts`（节点定义）/ `serialize.ts`（`serializeEditorDocument`）拆开，`index.ts` 桶导出，保持对外 API 不变
  ⚠️ **渲染不在本文件** —— `select-file-editor.ts` 全文 grep `render` 零命中。渲染真身在 `src/renderer/src/components/chat/file-aware-editor-utils.ts:212` 的 `renderDocument`（526 行，同样超阈值），S-16.3 的 chip 渲染要落那里
- [ ] S-16.2：`use-composer-interactions.ts:51-74` 粘贴分支 —— 超过阈值（参考 Reasonix：2000 字符或 20 行，满足其一即折）时**不走 `:67` 的 `execCommand('insertHTML')`**（它会绕过受控 state），改走 `:73` 的 `replaceSelectionWithText` 插入 chip 节点
- [ ] S-16.3：chip 渲染 —— 落点是 `src/renderer/src/components/chat/file-aware-editor-utils.ts:212` 的 `renderDocument`（**不是 `select-file-editor.ts`**）。标签形如「粘贴 #N · L 行」，带**预览 / 展开回填原文 / 移除**三个操作
- [ ] S-16.3b：**反解析必须同步** —— 同文件 `:313` 的 `parseDomToDocument`（与 `renderDocument` 配对的正/反解析，相隔约 100 行）也要支持 chip。**漏了这条，DOM → document 回读时 chip 会丢**，「草稿重进 chip 仍在」「原文无损」两条验证必挂（`FileAwareEditor.tsx:250` 有 DOM/state 一致性比对 `isSameDocument`）
- [ ] S-16.4：撤销行为 —— 展开与移除各算一条原生撤销记录（不自造栈），与 `file-aware-editor-undo-selection.ts:5-7,32-40` 的补丁协同
- [ ] S-16.5：**提交时替换回全文** —— 落点 `index.tsx:262-263` 之间（`getLiveEditorState()` 之后、`promptText` 取值处）
- [ ] S-16.6：i18n

**Mini 验证**：tsc 三配置零错误；粘贴 2000+ 字折叠成 chip；草稿保存后重进会话 chip 仍在且原文无损；点展开回填、点移除均正常；提交后模型收到的是完整原文；Ctrl+Z 行为符合预期。

## 涉及文件
- `src/renderer/src/components/chat/FileAwareEditor.tsx` — 可能改
- `src/renderer/src/components/chat/InputArea/use-composer-interactions.ts` — 改
- `src/renderer/src/lib/select-file-editor.ts` — **拆为 `src/renderer/src/lib/select-file-editor/` 目录**（`types.ts` 节点定义 + `serialize.ts` 序列化；其余纯文本与选区工具函数随 `serialize.ts` 或留在 `index.ts` 桶文件；对外 API 不变）
- `src/renderer/src/components/chat/file-aware-editor-utils.ts` — 改（`renderDocument:212` 渲染 chip + `parseDomToDocument:313` 反解析；**该文件 526 行，同超阈值，按大文件拆分一并处理**）
- `src/renderer/src/components/chat/InputArea/index.tsx` — 改（提交取值）
- `src/renderer/src/locales/{zh,en}/*.json` — 改

## 参考源码
- `D:\claw\DeepSeek-Reasonix\desktop\frontend\src\components\Composer.tsx` — 折叠阈值 / `PastedBlock{label,text}` / chip 三操作 / `expandPastedBlocks()`

---

# 需求 7：S-18 右侧面板 Git 分支视图

## 目标
右侧面板增加第三个 Tab「分支」：本地分支、远程分支、提交图谱（分支线可视化）。

## 步骤

- [ ] S-18.1：C# `Modules/Git/GitQueryTools.cs:24-39` 的 operation 分发表**新增提交图谱 operation**（`git log` 带 `%P` 取 parent），返回结构化拓扑
- [ ] S-18.2：`src/main/ipc/git-handlers.ts` 新增 `git:commit-graph` IPC，挂 `git-cache.ts:125-127` 缓存（参考 `list-branches` 的 5s STABLE TTL，`:155-160`）
- [ ] S-18.3：shared 类型 + `stores/git-store.ts` 扩展（仓库选择复用 `git-store.ts:88` 的 `selectRepository`）
- [ ] S-18.4：`layout/AgentFilesPanel.tsx:15` union 扩为三值；`:52-57` 两个裸 button 改成可维护的 Tab 结构；`:60` 三元改分支渲染
- [ ] S-18.5：分支列表复用 `git:list-branches`（本地/远程已可区分，见 `GitQueryTools.cs:248-271`），分组展示
- [ ] S-18.6：图谱渲染 —— **SVG 手绘**（不引依赖），按 refs + parents 组装拓扑
- [ ] S-18.7：i18n

**Mini 验证**：tsc 三配置零错误；C# build 零警告零错误；单仓库与多仓库各验一次；图谱在有 merge 的仓库上渲染正确；远程分支展示正确。

## 涉及文件
- `src/runtime/WishfulClaw.Agent/Modules/Git/GitQueryTools.cs` — 改（新 operation）
- `src/main/ipc/git-handlers.ts` — 改（新 IPC）
- `src/main/ipc/git-cache.ts` — 改（缓存）
- `src/renderer/src/components/layout/AgentFilesPanel.tsx` — 改（第三 Tab）
- `src/renderer/src/stores/git-store.ts`、`src/shared/types/*` — 改
- `src/renderer/src/locales/{zh,en}/*.json` — 改

---

# 需求 8：S-19 软件自身界面截图能力

## 目标
让 Agent 能截取**软件自身窗口**并**落盘到仓库路径**，用于由 Agent 自建《使用指引》配图（口径 4）。

## 步骤

- [ ] S-19.1：新增 `window:capture-self` IPC —— 用 `registerMessagePackHandler`（`src/main/ipc/messagepack-handler.ts:10-25`，样板 `misc-handlers.ts:19-33`），内部调 `getMainWindow()`（`src/main/main-window-registry.ts:22`）的 `webContents.capturePage(rect)`；先例见 `channel-handlers/qr-page-capture.ts:135`
- [ ] S-19.2：`image:persist-generated`（`misc-handlers.ts:268-292`）加**可选 `targetPath`**，突破当前 `getGeneratedImagesDir()`（`:246-251`）写死 `homedir()/wishful-claw/image` 的限制
- [ ] S-19.3：工具层暴露 —— 扩展 `DesktopScreenshot`（`DesktopToolProvider.cs:17-23` 现仅 `delayMs` 入参）或新增独立工具，使其能调 S-19.1 的能力
- [ ] S-19.4：**AOT** —— 新增具名 DTO 注册进 `WishfulClawJsonContext`；跑 `npm run build:worker:prod` 确认无 IL2026/IL3050/IL3051
- [ ] S-19.5：用新能力补《使用指引》配图（落点待老大定，见下）；`docs/user-guide.md` 文末原有 10 处待配图清单，**开工前先核对还差哪些**，别按 10 处全做

**Mini 验证**：tsc 三配置零错误；C# build + AOT 零警告；**实拍一张并落盘到指定仓库路径**（这是本需求的核心验收）。

## 涉及文件
- `src/main/ipc/*.ts`（新 capture handler）— 新建
- `src/main/ipc/misc-handlers.ts` — 改（targetPath）
- `src/runtime/WishfulClaw.Agent/Tools/Providers/DesktopToolProvider.cs` — 改
- `docs/user-guide.md` — 改（配图）
- `src/renderer/src/locales/{zh,en}/*.json` — 改

## 避坑说明
- **浏览器通路已验证不可用**：`mcp__browser-use__take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`；in-app browser 指向 dev 渲染进程、拿不到内容（`raw-requirements.md:106`）。**浏览器截图不能替代真机 capturePage**，勿重复踩。

---

# 需求 9：S-21 多服务商限额自动 fallback

## 目标
当前服务商触发限额（5h/周限额、429、503）时，按用户配置的优先级自动降级到下一个服务商继续执行，**同一逻辑请求内切换、保持上下文连贯**。

沿用 iter-27 **Plan D 的 D1–D5 骨架**（设计已写在 `docs/plans/iter-v2-27/plan.md:195-205`），不重开设计。

## 步骤

- [ ] S-21.D1：梳理调用链与不变式 —— `AgentLoop.cs:319-328`（调用点）、`:526-532`（`ExecuteTurnAsync`）、`ProviderRetryPolicy.cs:80-172`（重试循环）、`:156-170`（耗尽 throw）、`AgentRuntimeTools.cs:291-304`（异常收尾）。**确定一个逻辑请求的 attempt 边界，并确认不会重复工具调用**
- [ ] S-21.D2：配置面 —— `src/shared/types/provider.ts` 增加 fallback 开关与优先级列表；设置页 `ProviderPanel.tsx` 提供可排序配置。**保留现有 `requestMaxRetries` 语义**
- [ ] S-21.D3：状态机 —— 让有限重试耗尽后返回「可切换」结果而非直接 throw；`requestMaxRetries=0`（无限）**保持不切换**；同一请求按序逐个尝试**不循环**；取消立即终止；新增结构化 fallback/重试事件
- [ ] S-21.D4：接入 `AgentLoop` —— 切换时完整复用 `conversation` / `toolDefs` / `state`。⚠️ 切出 `openai-responses` 会丢 `OpenAIResponsesState` 的 response id（未实测，须验）
- [ ] S-21.D5：观测与人工验证 —— 配额信息只作可选观测增强；**用两个可控测试 provider / Mock endpoint 验证，禁止依赖真实 API 触发限额**；日志记原 provider、目标 provider、重试次数、切换原因
- [ ] S-21.D6：**AOT** —— 新增 DTO 注册进 JsonContext
- [ ] S-21.D7：**回归测试工程** —— 新建 `tests/WishfulClaw.ProviderFallbackRegressionTests`（既有 9 个同款工程可抄：`tests/WishfulClaw.ProviderHeaderRegressionTests` 等）。⚠️ **必须同时加进 `src/runtime/WishfulClaw.sln`**，否则会像 `CronRegressionTests` / `MemoryRecallRegressionTests` 一样静默漏编；跑法 `dotnet run --project tests/<项目> --no-build`（`dotnet build` 只编译不运行）

**Mini 验证**：C# build + AOT 零警告；状态机测试覆盖 429/503/超时、有限/无限、全失败、取消；工具调用中途切换不重复；流式事件不重复；session/channel 路径不丢来源。

## 涉及文件
- `src/runtime/WishfulClaw.Agent/AgentLoop.cs` — 改
- `src/runtime/WishfulClaw.Agent/ProviderRetryPolicy.cs` — 改
- `src/shared/types/provider.ts` — 改
- `src/renderer/src/components/settings/ProviderPanel.tsx` — 改
- `tests/WishfulClaw.ProviderFallbackRegressionTests/` — 新建（**并入 .sln**）
- `src/renderer/src/locales/{zh,en}/*.json` — 改

---

# 需求 10：S-25 Agent 工作时间线（自动履历）

## 目标
自动记录 Agent 干了哪些事、什么时间做的（派发了什么任务、完成了什么、做了什么决策），用户可随时查看回溯。**决策级粒度 + 新建 `agent_timeline_events` 表**（口径 3）。

> ⚠️ `request_usage_logs` 是模型请求/计费维度，与「Agent 干了什么」无关，**不作为本需求素材**（老大 2026-09-14 点名纠正）。

## 步骤

- [ ] S-25.1：定 schema —— 事件类型枚举（任务派发 / 回报 / 完成 / 决策 / 子 Agent / 定时触发…）、作用域（session + 可选 project）、时间戳、metadata
- [ ] S-25.2：建表 —— `Infrastructure/Db/DbClient.cs` 新增 `agent_timeline_events`（参考 `goal_events` `:266` 的字段组织：session_id / event_type / message / metadata_json / created_at）
- [ ] S-25.3：数据层 —— 新建 `DbAgentTimelineTools`，在 `DbModule.cs` 用 `context.Register("db/agent-timeline", ...)` 注册（参考 `:144-146` goal-events）
- [ ] S-25.4：埋点 —— 在全局任务派发/回报、会话 todo 状态变更、cron 执行、子 Agent 运行等**决策点**写入
- [ ] S-25.5：**保留策略** —— 落库同时定清理策略（按天数或条数），避免重蹈 `request_usage_logs` 无 prune 的覆辙。清理入口挂到已有的启动/维护时机，不要新增定时器
- [ ] S-25.6：UI —— **右侧面板新增 Tab**，落点钉死：
  - `src/renderer/src/stores/ui-types.ts:54` 的 `RightPanelTabKind` 加 `'timeline'`（现有 11 个：activity/memory/context/review/files/preview/browser/subagent/terminal/goal/summary）
  - `components/layout/RightPanel.tsx:77-101` 标题映射加 `timeline` 一条（其余 kind 逐个 if 赋值 `t(...)`，照抄风格）
  - 面板内容复用 `GoalEventTimeline`（`components/goal/goal-session-views.tsx:80-109`）的事件流形态
- [ ] S-25.7：**AOT** —— DTO 注册进 `InfrastructureJsonContext`；i18n

**Mini 验证**：tsc 三配置零错误；C# build + AOT 零警告；事件能写入、能按会话查询；右侧面板能打开「时间线」Tab 并看到事件流；
**保留策略按可判定方式验**：手动把若干行 `created_at` 改到阈值之前 → 触发清理 → 断言这些行已消失、阈值内的行仍在。

## 涉及文件
- `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs` — 改（建表）
- `src/runtime/WishfulClaw.Infrastructure/Db/DbAgentTimelineTools.cs` — 新建
- `src/runtime/WishfulClaw.Infrastructure/Db/DbModule.cs` — 改（注册端点 `db/agent-timeline*`）
- `src/renderer/src/stores/ui-types.ts` — 改（`RightPanelTabKind` 加 `'timeline'`）
- `src/renderer/src/components/layout/RightPanel.tsx` — 改（标题映射 + 分发）
- `src/renderer/src/components/timeline/*` — 新建（时间线面板，复用 `GoalEventTimeline` 形态）
- `src/renderer/src/locales/{zh,en}/*.json` — 改

## 参考源码
- `components/goal/GoalHistoryPanel.tsx` + `goal-history-store.ts` — 「计划→轮次→任务」可展开分组 + 事件流形态
- `components/goal/goal-session-views.tsx:80-109` — `GoalEventTimeline` 组件

---

# 执行前需要老大处理的事项

这几件 agent 做不了或做不准，需在确认环节一并处理：

1. **S-23（阻塞开工）**：确认你实际使用的搜索 provider 配置。默认值 `tavily + 空 apiKey`（`settings-store.ts:337-340`）按理会直接报错而不是返回词典结果，与现象矛盾，**不问清无法定修法**
2. **S-19**：定配图落盘目录约定（建议 `docs/assets/`，以及是否要求与 `docs/user-guide.md` 里的引用路径单点对应）
3. **S-21**：提供两个可控的测试 provider / Mock endpoint（或授权自带 mock server 起一个）
4. **S-22**：**真机复现**（agent 无微信渠道环境）—— 修完后走一遍「全局派发 → 项目回报 → 助理回复」确认微信端收到。本需求 agent 侧无法自测通
5. **收尾**：真机人工复测（本次多条需求是 UI 与渠道，最终目视仍由你确认）

> 已在规划阶段自行钉死、不再问你的：S-25 的 UI 落点（右侧面板新 Tab `timeline`）、S-16 的文件拆分（504 行已超阈值，先拆再改）、S-21 的测试承载（新建 `tests/WishfulClaw.ProviderFallbackRegressionTests`）。

# 验证门禁（迭代级）

- TypeScript 三配置 `tsc --noEmit -p ...` 全零错误
- `dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误
- `npm run build:worker:prod` AOT 成功且无 IL2026/IL3050/IL3051
- 既有回归不回退：`test:renderable-chat-items`、`test:provider-presets`、`test:ipc-msgpack-routing`、`test:settings-tabs`、`test:updater-*`，C# 侧 Goal / SessionTaskCascade / ChannelToolVisibility / ChannelShellApproval / ToolConcurrency 等
- 逐个需求的 Mini 验证（见各需求节）
