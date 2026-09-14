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
| R4 | 2026-09-14 | 老大问回之前的 agent 后重定 S-23 范围：由「只修中文 bug」升级为「退役 WebSearch 全链路 + 统一到 BrowserSearch + 修三根因/设 UA + 三档自定义引擎 + 工具改名」，规模 小→中 改为**大**。已逐条复核老大给的现状核实（4 条中 3 条成立、1 条需修正：BrowserSearch 在 renderer TS 而非 C#） |

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
| 1 | S-23 | ~~先只修中文 bug~~ **已作废**（2026-09-14 老大重定范围）。新口径：**退役 WebSearch 全链路，统一到 BrowserSearch，并修三根因 + 设 UA**。见需求 5 节 |
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

- [✓] S-17.1：**先定位真因** —— 验证推断：`lib/agent/stream-event-adapter.ts:45-57` 的 `tool_use_streaming_start` 分支构造 `rewriteProxyEvent({... input:{}})` 时 input 为空 → `rewriteProxyEvent`（调用于 `stream-event-adapter.ts:15-17`）→ `resolveProxyDisplay`（**本体在 `lib/agent/use-capability-proxy.ts:22`，`if (!capabilityId) return null` 在 `:32`**）不重写。若成立，优先修源头；若 `pendingToolCalls` 实际由 `tool_call_start`（`:94-98`）建条目，则只需改展示层
- [✓] S-17.2：`runtime-status.tsx:191` `activeToolName` 计算处套一层代理解析；`:192` `pendingApprovalToolName` 同口径
- [✓] S-17.3：浮窗副本 `composer-status-indicator.tsx:77、151-156` 与 `:78、117-121` 同步
- [✓] S-17.4：**skill 类显示名** —— `use-capability-proxy.ts:51-56` 目前把 `skill:name` 解析成固定 `'Skill'`，需补出 `skill:xxx` 形态
- [✓] S-17.5：i18n（`src/renderer/src/locales/zh/chat.json:134` runningTool、`:135` awaitingApproval，en 同步）

**Mini 验证**：tsc 三配置零错误；真实触发一次 `use_capability` 代理调用，状态条显示真实工具名而非 `use_capability`；审批提示同口径；skill 与 mcp-tool 两种形态都验。

## 涉及文件
- `src/renderer/src/components/chat/InputArea/runtime-status.tsx` — 改
- `src/renderer/src/components/chat/InputArea/composer-status-indicator.tsx` — 改
- `src/renderer/src/lib/agent/use-capability-proxy.ts` — 改（skill 显示名）
- `src/renderer/src/lib/agent/stream-event-adapter.ts` — 可能改（若确认为根因）
- `src/renderer/src/locales/{zh,en}/chat.json` — 改

---

# 需求 5：S-23 搜索能力收敛到 BrowserSearch（2026-09-14 老大重定范围）

> ⚠️ **口径已变更**：立项时口径 1「先只修中文 bug」作废。老大 2026-09-14 给回核实结论后
> 重定范围为「退役 WebSearch 全链路，统一到 BrowserSearch」。规模由「小→中」升为**大**。

## 目标

砍掉长期不维护的 WebSearch（外部 API）链路，把搜索统一到自维护的 BrowserSearch
（抓公开搜索页），并修掉中文查询返回词典/翻译结果的三个根因。

## 老大给回的现状核实（已由 agent 逐条复核，除一条外全部成立）

| # | 老大结论 | 复核 |
|---|---|---|
| 1 | 两套搜索并存：BrowserSearch 无条件注册（`tools/index.ts:73`），WebSearch 跟设置开关注册（`InputArea/index.tsx:115`） | ✅ 成立 |
| 2 | main 的 `web:search` IPC 注册了但 renderer 无调用 | ✅ 成立——只存在于 `channels.ts:347` 常量、`messagepack-channel-routing.ts:171` 路由表、`web-search-handlers.ts:138` handler；renderer 侧**零调用点** |
| 3 | 中文乱码是解码问题，不是语言设置问题 | ✅ 成立（`WebSearchProviders.cs:18` 的 `hl=en`、`:22` 的 `Accept-Language: en-US` 是硬编码，不是用户设置） |
| 4 | 三根因：bing_cn 裸 HTTP 垃圾源 / 词典域兜底混入 / 去重不判相关性 | ✅ 全在 `browser-search-tool.ts`：`:425` 通用兜底提取器、`:466-485` 只比 URL 的去重、全文**零** UA 设置 |

**⚠️ 一条与老大描述不符（影响实施落点）**：BrowserSearch **不在 C#**，是 renderer 侧 TS
（`src/renderer/src/lib/tools/browser-search-tool.ts`，**693 行**）。内置引擎注册表与意图路由
（`:141-161`）都在这一个文件里（baidu / bing_cn / bing_intl / sogou / so_360 / toutiao /
sogou_wechat / github / arxiv / wikipedia_zh / wikipedia_en …）。所以「改 BrowserSearch」
= 改这一个 TS 文件，**不动 C# 的** `AgentRuntimeBrowserExecutor.cs`（138 行，是另一套东西）。

> 📌 上表与本节的行号均指向**动手前**的 `browser-search-tool.ts`；该文件已在 S-23.7 拆成
> `lib/tools/browser-search/` 目录（`types` / `engines` / `extract` / `dedupe` / `search` / `tool` / `index`），
> 引用时按模块名找，别按行号找。

## 步骤

- [✓] S-23.7：**先拆文件**（先做，后面所有改动都落在新目录里）
  - `lib/tools/browser-search-tool.ts`（693 行）→ `lib/tools/browser-search/`：`types.ts` /
    `engines.ts` / `extract.ts` / `dedupe.ts` / `search.ts` / `tool.ts` / `index.ts`。
    **同名目录 + index.ts 满足同一 import 路径**，所有消费方 import 不改。
- [✓] S-23.1：**退役 WebSearch 全链路**
  - renderer：`lib/tools/web-search-tool.ts` 整删；`tools/index.ts` 去 `updateWebSearchToolRegistration`；
    `InputArea/index.tsx` 去调用点、`toggleWebSearch` 回调、三个从未被消费的 toolbar props
    （`canToggleWebSearch` / `webSearchEnabled` / `toggleWebSearch`）；`use-input-area-selectors.ts`
    去 5 个字段与订阅；`sidecar-mapping.ts` / `sidecar-protocol-types.ts` / `sidecar-protocol.ts`
    去 `SidecarWebSearchConfig` 与 `mapSidecarWebSearchConfig`
  - 死选项清理：`SendMessageOptions.webSearchEnabled`、`use-chat-actions.ts` 的 4 处传参
    （其中 `:158-168` 那段 filter 的结果本来就被 `void` 掉，是彻底的空转）、
    `use-channel-auto-reply.ts:284`、`project-send-message.ts:220`
  - C#：`AgentRuntimeWebSearchExecutor.cs`(371) / `WebSearchProviders.cs`(164) 删；
    `ToolDispatchRouter.cs` 去 WebSearch 分派块；`WebToolProvider.cs` 只留 `WebFetch`
    （**WebFetch 必须保留**）；`AgentRunContextPolicy` 去 `WebSearchEnabled` 字段与读取；
    `AgentRuntimeUseCapabilityDiscovery` 去 web 类目门控（连带去掉已无用的 `category` 形参，
    3 个文件 5 处调用点 + `BrowserSurfaceAccessChecks.cs` 同步改）；
    `SubAgentExecutor.Results.cs` 的 `"WebSearch" => "query"` **保留**（改名后它正是新工具的映射）
  - main：`web-search-handlers.ts` → **改名** `web-fetch-handlers.ts`（`registerWebFetchHandlers`），
    只删 `web:search` / `web:search-config` / `web:search-providers`，**保留 `web:fetch` /
    `web:fetch-rendered` / `fetchRenderedPage` / `isRenderableHttpUrl`**（BrowserSearch 的抓取通路）；
    `channels.ts` 去 3 个常量；`messagepack-channel-routing.ts` 去 3 条路由
- [✓] S-23.2：**settings 字段处理** —— 6 个 `webSearch*` 字段迁进 `legacyWebSearch`
  （**不硬删**），`browserSearch` 从 `DEFAULT_BROWSER_SEARCH_SETTINGS` 播种，`version: 37 → 38`
- [✓] S-23.3：**修三根因 + 设 UA**
  - bing_cn：**直接摘掉**（裸 HTTP 下只吐词典/翻译卡），`bing_intl` 覆盖必应
  - 词典域兜底：`extract.ts` 的 `isLowQualityCard` 按域 + 路径片段拦词典/翻译/百科卡，
    **但引擎自身域名豁免**（否则 `wikipedia_zh` 会把自己的结果全滤掉）
  - 去重不判相关性：`dedupe.ts` 的 `interleaveByEngine` 轮转（快引擎不再吃满名额）+
    `deduplicate(results, max, query)` 把相关性当**优先级**而非硬过滤（不相关的结果降级去填剩余名额）
  - UA：**已天然满足** —— `AgentRuntimeWebFetchExecutor.cs:61-65` 早就发桌面 Chrome UA +
    `Accept-Language: zh-CN,zh;q=0.9,en;q=0.8`，所以「全文零 UA」这条只在旧渲染端成立
- [✓] S-23.4：**设置页改造** —— ⚠️ 见「修正记录 1」：设置页**没有**可复用的「搜索服务商」区，
  改为在「插件」二级分类下**新增** `webSearch` 页签（`SettingsPage.tsx` + `ui-types.ts` +
  `tests/settings-tabs`）。面板 = `WebSearchPanel.tsx`：检索策略（自动选择引擎 / 结果条数上限）+
  10 个内置引擎逐个开关 + 特性徽标（裸 HTTP / 需浏览器渲染 / 类目）+ 6 类意图路由可编辑（含
  恢复默认、引擎被全局关掉时的提示、全关兜底提示）
- [✓] S-23.5：**用户自定义引擎** —— ⚠️ 见「修正记录 2」：只有**两档**。
  ①`basic`：URL 模板（`{query}` 占位，保存前校验）+ 通用 h2/h3 解析，结果标 `confidence: 'low'`；
  ②`selector`：+ 抓取方式（http/rendered）+ 可选 CSS 选择器（item/title/url/snippet）。
  **不做**「把 HTML 喂给模型解析」——慢、贵、不稳定，不作为主路径。
  实现 = `web-search-custom-engines.tsx` + `engines.ts` 的 `toEngineConfig`
- [✓] S-23.6：**工具改名** `BrowserSearch` → `WebSearch` —— ⚠️ 见「修正记录 3」：方向与旧口径相反。
  改 `BrowserToolProvider.cs`（声明 + 描述去引擎枚举，改为「引擎集与意图路由在设置里配」）、
  `AgentRuntimeBrowserExecutor.cs` 的 `BrowserToolNames`、renderer 侧 `WEB_SEARCH_TOOL_NAME`。
  旧名别名：`lib/tools/tool-name-aliases.ts` 的 `normalizeToolName`，接在 `step-descriptions.ts`
  （唯一有查表、旧名会掉到默认分支的地方）；其余展示点（`compact-header.tsx` / `process-summary.ts` /
  `execution-outline.ts` / `ToolCallCard/types.ts`）本来就同时列了 `WebSearch` 与 `BrowserSearch`，无需改
- [✓] S-23.8：i18n —— `settings.json` 新增 `tabs.webSearch.label` / `anchorNav.webSearch*` /
  `webSearch.*`；`common.json` 新增 `browserSearch.engines.*` 与 `browserSearch.intents.*`
  （放 `common` 是因为 `engineDisplayName` / `intentDisplayName` 在**非 React** 路径被调用，
  `common` 是 default/fallback ns、必定已加载；未加载时 `translateOr` 回落到字面名）

**Mini 验证**（已执行，2026-09-14）：
- tsc 三配置零错误；`dotnet build src/runtime/WishfulClaw.sln` **0 警告 0 错误**
- C# 回归：`ProviderHeaderRegressionTests`（含金样 `visibility-snapshot.expected.txt` 与
  `BrowserSurfaceAccessChecks` 的浏览器准入断言）、`ChannelToolVisibility`(108)、
  `ChannelShellApproval`(74)、`ToolConcurrency`、`Goal`(148)、`SessionTaskCascade`(180)、
  `CompactionSnapshot`(269+2) 全过
- TS 回归：`settings-tabs`(22) / `ipc-msgpack-routing`(96) / `provider-presets`(546) /
  `renderable-chat-items`(16) / `channel-cancel-commands` / `channel-reply-event-policy` /
  `updater-*`(71+56+35) 全过
- 临时断言脚本（跑完即删）：S-23 主体 61 条 + 设置面板逻辑 25 条，全过。覆盖：
  bing_cn 已不在注册表、迁移（老配置不丢 / 新装为 null / 已有 legacy 不覆盖）、
  意图路由（含全关兜底、autoRoute 关闭、显式 override 优先）、两档自定义引擎的
  `lowConfidence` 与选择器、词典卡过滤 + 引擎自身域豁免、轮转交错、URL/标题去重、
  相关性优先级、引擎开关的规范化顺序与可往返、意图不可清空、意图编辑器与 `resolveSearchPlan` 一致

## 涉及文件
- `src/renderer/src/lib/tools/browser-search/`（新目录，7 文件）— 原 `browser-search-tool.ts` 拆分 + 三根因修复
- `src/renderer/src/lib/tools/tool-name-aliases.ts`（新）— 旧工具名归一
- `src/renderer/src/lib/tools/web-search-tool.ts` — 删；`browser-search-tool.ts` — 删（已拆目录）
- `src/renderer/src/lib/tools/index.ts`、`browser-native-ui.ts`、`lib/agent/sub-agents/step-descriptions.ts` — 改
- `src/renderer/src/components/settings/WebSearchPanel.tsx`（新）、`web-search-custom-engines.tsx`（新）、
  `SettingsPage.tsx`、`src/renderer/src/stores/ui-types.ts` — 改
- `src/renderer/src/components/chat/InputArea/{index.tsx,composer-toolbar.tsx,use-input-area-selectors.ts}`、
  `hooks/{use-chat-actions.ts,use-channel-auto-reply.ts}`、`lib/tools/project-send-message.ts`、
  `stores/chat-store/index.ts` — 去死选项
- `src/renderer/src/stores/settings-store{,-types,-migrate}.ts` — 字段迁移
- `src/renderer/src/lib/ipc/{sidecar-mapping,sidecar-protocol-types,sidecar-protocol,channels,messagepack-channel-routing}.ts` — 改
- `src/main/ipc/web-search-handlers.ts` → `web-fetch-handlers.ts`（改名 + 只留 fetch）；`src/main/index.ts` — 改
- `src/runtime/WishfulClaw.Agent/`：`AgentRuntimeWebSearchExecutor.cs` / `WebSearchProviders.cs` — 删；
  `ToolDispatchRouter.cs` / `AgentRunContextPolicy.cs` / `AgentRuntimeUseCapabilityDiscovery.cs` /
  `AgentRuntimeUseCapabilityEncoding.cs` / `AgentRuntimeUseCapabilityExecutor.cs` /
  `AgentRuntimeBrowserExecutor.cs` / `Tools/Providers/{WebToolProvider,BrowserToolProvider}.cs` — 改
- `tests/WishfulClaw.ProviderHeaderRegressionTests/BrowserSurfaceAccessChecks.cs`、`tests/settings-tabs/program.ts` — 改
- `src/renderer/src/locales/{zh,en}/{settings,common}.json` — 改

## 修正记录（实施期推翻的规划结论）

1. **「复用原 WebSearch 设置区」不成立** —— 全仓核对：6 个 `webSearch*` 字段**从来没有过任何 UI 入口**，
   设置页里唯一叫「搜索服务商」的字符串是 AI 服务商列表的搜索框占位符
   （`provider.list.searchPlaceholder`）。语言文件里倒是留着 `tabs.websearch.label = "联网搜索"`
   与一整块 `websearch.*` 文案，但**零消费者**——是更早被删掉的面板留下的死键。故：
   ①落点由老大定为「设置 → 插件（二级分类）→ 网络搜索」，实现为**新增 `webSearch` 页签**；
   ②死键 `tabs.websearch` 与 `websearch.*` 一并删除（它们描述的正是本次退役的 API 链路）
2. **自定义引擎「三档」收敛为两档** —— 规划里的第三档「自定义 API（endpoint + key）」是 agent 自己
   加的，老大的原话是「基础 / 进阶 / 不建议默认做『把 HTML 喂给模型解析』」。已按老大口径改为
   `tier: 'basic' | 'selector'`，`extractFromJson` 与 `api` 字段删除
3. **改名方向与规划相反** —— 规划写的是 `WebSearch → BrowserSearch`，但老大 2026-09-14 的原话是
   「BrowserSearch 名字确实有歧义（它不是浏览器操作），只改注册的时候的工具名」→ 正确方向是
   `BrowserSearch → WebSearch`。名字此时正好空出来（C# 那套同名工具本次退役），两件事必须同批做，
   否则 LLM 会看到两个 `WebSearch`
4. **`web-search-handlers.ts` 不能整删** —— 它同时承载 `web:fetch` / `web:fetch-rendered`，
   而这两个正是 BrowserSearch 的抓取通路（`browser-search/search.ts:25,38`）。改为**只删 search 三通道 +
   文件改名** `web-fetch-handlers.ts`
5. **`AgentRunContext.WebSearchEnabled` 是死门控** —— renderer 不再发送该参数后它恒为默认 `true`，
   门控永不生效。已连同其唯一用途（web 类目过滤）一起删除；`IsProxyBuiltinVisible` 的 `category`
   形参随之失去唯一用途，一并去掉（5 处调用点 + 1 处测试）
6. **`SubAgentExecutor.Results.cs` 的 `"WebSearch" => "query"` 不能删** —— 规划把它列进「清理」，
   但改名后 `WebSearch` 正是新工具名，这条映射仍是对的
7. **「设 UA」这条已在 C# 侧天然满足** —— `AgentRuntimeWebFetchExecutor.cs:61-65` 早就发桌面 Chrome UA +
   `Accept-Language: zh-CN,zh;q=0.9,en;q=0.8`。真正要修的是噪声源（bing_cn）、兜底卡黑名单与去重排序

---

# 需求 6：S-16 输入框长粘贴折叠块

## 目标
长文本粘贴进输入框不整段展开，折成带标签的可折叠 chip；chip 原文无损保存，提交时替换回全文。

**硬约束（探索确认）**：**undo/redo 没有自定义栈，完全依赖浏览器原生**（只在 `file-aware-editor-undo-selection.ts` 打边界补丁）。折叠块的撤销设计必须顺着浏览器原生来，不能自造栈。

## 步骤

- [✓] S-16.1：在 `src/renderer/src/lib/select-file-editor.ts:41` 的 `EditorDocumentNode`（现 `= EditorTextNode | EditorFileNode | EditorPluginNode`）增加 `pasted-block` 节点类型（`label` + `text` 原文），确保能进 `serializeEditorDocument`（草稿）与被 `renderDocument` 渲染。
  ⚠️ **该文件现已是 504 行**，加了节点类型 + 序列化后必然超阈值。实施时**先拆**：新建 `lib/select-file-editor/` 目录，按 `types.ts`（节点定义）/ `serialize.ts`（`serializeEditorDocument`）拆开，`index.ts` 桶导出，保持对外 API 不变
  ✅ 实施：拆成 `types.ts`（节点与 `SerializeOptions`）/ `nodes.ts`（节点工厂 + `mergeTextNodes`）/ `files.ts`（路径工具 + 已选文件集合）/ `serialize.ts`（纯文本 + 正/反序列化）/ `document.ts`（区间操作 + `removeReferenceNode` + `documentHasFileReferences`）+ `index.ts` 桶。**桶只导出原 26 个公开名**（新增的 `normalizePath` 等内部工具仅模块内导出，不进桶）。依赖方向 `types ← nodes ← files ← serialize ← document`，无环。
  ⚠️ **渲染不在本文件** —— `select-file-editor.ts` 全文 grep `render` 零命中。渲染真身在 `src/renderer/src/components/chat/file-aware-editor-utils.ts:212` 的 `renderDocument`（526 行，同样超阈值），S-16.3 的 chip 渲染要落那里
- [✓] S-16.2：`use-composer-interactions.ts:51-74` 粘贴分支 —— 超过阈值（参考 Reasonix：2000 字符或 20 行，满足其一即折）时**不走 `:67` 的 `execCommand('insertHTML')`**（它会绕过受控 state），改走 `:73` 的 `replaceSelectionWithText` 插入 chip 节点
- [✓] S-16.3：chip 渲染 —— 落点是 `src/renderer/src/components/chat/file-aware-editor-utils.ts:212` 的 `renderDocument`（**不是 `select-file-editor.ts`**）。标签形如「粘贴 #N · L 行」，带**预览 / 展开回填原文 / 移除**三个操作
  ✅ 实施：拆为 `file-aware-editor-utils/` 目录（`types.ts` / `chips.ts` / `dom.ts` / `selection.ts` / `index.ts`）。**目录沿用原文件名**（`file-aware-editor-utils`）→ 8 处导入点零改动。原文经 `wrapper.title` 预览（悬停显示全文），不做独立预览弹窗。
- [✓] S-16.3b：**反解析必须同步** —— 同文件 `:313` 的 `parseDomToDocument`（与 `renderDocument` 配对的正/反解析，相隔约 100 行）也要支持 chip。**漏了这条，DOM → document 回读时 chip 会丢**，「草稿重进 chip 仍在」「原文无损」两条验证必挂（`FileAwareEditor.tsx:250` 有 DOM/state 一致性比对 `isSameDocument`）
  ✅ 同时补了 `isSameDocument` 的 `pasted` 分支（原实现只比对 text/file/plugin，漏了 pasted 会让每次回读都被判为「文档变了」）。
- [✓] S-16.4：撤销行为 —— 展开与移除各算一条原生撤销记录（不自造栈），与 `file-aware-editor-undo-selection.ts:5-7,32-40` 的补丁协同
  ✅ 展开走 `replaceSelectionWithText` → `replaceEditorRange` 一次结构性替换，落在浏览器原生 undo 记录里；移除走 `removeReferenceNode` 同样一次替换。均未自造栈。
- [✓] S-16.5：**提交时替换回全文** —— 落点 `index.tsx:262-263` 之间（`getLiveEditorState()` 之后、`promptText` 取值处）
  ✅ 落在 `use-composer-editor.ts` 的 `getLiveEditorState()`：`promptText` 传 `expandPastedBlocks: true`；`serializedText`（草稿）**不带**该选项，保留 `<pasted-block>` 标签以便草稿往返。
- [✓] S-16.6：i18n
  ✅ `input.pastedBlock.{label,labelWithLines,expand,expandTitle,remove}`（`zh`/`en` 的 `chat.json`）。⚠️ **新增 `src/renderer/src/lib/i18n-text.ts` 的 `translateOr()` 兜底助手**：实测未初始化时 `i18n.t` 返回 `undefined` 且**忽略 `defaultValue`**（命名空间未加载时返回裸 key），非 React 调用点裸用会让 `label` 变 `undefined` 并在 `.trim()` 上崩。

**⚠️ 关键约定（实施期钉死）**：折叠块在**纯文本坐标系**里贡献的是**全文**（`getNodePlainText(pasted) = node.text`），不是 chip 标签。理由：`text` 同时喂给 `editorDocumentToPlainText`（光标/选区换算）与提示词优化器，若只贡献标签，优化器会把用户粘贴的正文替换成「粘贴 · 40 行」。为保持 DOM 侧一致，`collectTextContent` 与 `setSelectionOffsets` 的 chip 长度都从 `pastedBlockTextById`（模块级 Map，按 node id 存原文）取，而不是从 `data-fallback-text` 属性取（属性里只有标签）。该 Map **只增不清**：多个编辑器实例共享此模块，渲染时清空会静默丢掉另一个实例的 chip。

**Mini 验证**：tsc 三配置零错误；粘贴 2000+ 字折叠成 chip；草稿保存后重进会话 chip 仍在且原文无损；点展开回填、点移除均正常；提交后模型收到的是完整原文；Ctrl+Z 行为符合预期。

**已执行的验证（2026-09-14）**：
- `npm run typecheck`（`tsconfig.node.json` + `tsconfig.web.json` + `tsconfig.json`）零错误
- 临时脚本（已删）跑通 20 条断言：标签往返、草稿含标签、提交展开为原文、纯文本含原文、展开后零丢失、双 chip 不串、单行超长也折叠
- `esbuild` 打包整个 `InputArea/index.tsx`（覆盖新的两个目录 + `i18next` 引入）成功，仅剩既有的 `import.meta` cjs 警告
- 现有 TS 回归全绿：`renderable-chat-items` / `provider-presets` / `settings-tabs` / `channel-reply-event-policy` / `ipc-msgpack-routing` / `channel-cancel-commands` / `updater-release-notes`
- ⏳ 仍需人工在真机确认：粘贴折叠、草稿重进、点展开/移除、Ctrl+Z 手感（`npm run dev` 后手测）

## 涉及文件
- `src/renderer/src/components/chat/FileAwareEditor.tsx` — 改（`onPastedBlockExpand` 透传）
- `src/renderer/src/components/chat/InputArea/use-composer-interactions.ts` — 改（折叠阈值 + 粘贴分支）
- `src/renderer/src/components/chat/InputArea/use-composer-editor.ts` — 改（`expandPastedBlock` + 提交展开）
- `src/renderer/src/components/chat/InputArea/composer-editor-area.tsx` / `index.tsx` — 改（props 透传）
- `src/renderer/src/lib/select-file-editor.ts` — **已拆为 `src/renderer/src/lib/select-file-editor/` 目录**（`types.ts` / `nodes.ts` / `files.ts` / `serialize.ts` / `document.ts` + `index.ts` 桶；对外 API 不变）
- `src/renderer/src/components/chat/file-aware-editor-utils.ts` — **已拆为同名目录**（`types.ts` / `chips.ts` / `dom.ts` / `selection.ts` + `index.ts` 桶）
- `src/renderer/src/lib/select-file-tags.ts` — 改（`pasted-block` 标签正/反解析）
- `src/renderer/src/lib/i18n-text.ts` — **新增**（`translateOr` 兜底）
- `src/renderer/src/locales/{zh,en}/chat.json` — 改

## 参考源码
- `D:\claw\DeepSeek-Reasonix\desktop\frontend\src\components\Composer.tsx` — 折叠阈值 / `PastedBlock{label,text}` / chip 三操作 / `expandPastedBlocks()`

---

# 需求 7：S-18 右侧面板 Git 分支视图

## 目标
右侧面板增加第三个 Tab「分支」：本地分支、远程分支、提交图谱（分支线可视化）。

## 步骤

- [✓] S-18.1：C# `Modules/Git/GitQueryTools.cs` 的 operation 分发表新增 `get-commit-graph`；新增 `GitCommitGraphItem`（`Hash` / `ShortHash` / `Parents` / `Author` / `Date` / `Subject` / `Refs`）与 `GitQueryResult.Graph`。用 `git log --all --date=iso --pretty=format:%H%x01%h%x01%P%x01%an%x01%ad%x01%s%x01%D --max-count=N`，`%P` 取 parent 链、`%D` 取 ref 名。**用 `--all` 而非默认 HEAD**：只看 HEAD 历史的话永远只有一条直线，图谱就没有意义了。新增具名 DTO 已注册进 `AgentRuntimeJsonContext`（`GitCommitGraphItem` + `List<GitCommitGraphItem>`）
- [✓] S-18.2：`src/main/ipc/git-handlers.ts` 新增 `git:commit-graph`（走既有 `queryGit` 通道，自动享受去重 + TTL）；`git-cache.ts` 的 `gitQueryTtl` 把 `get-commit-graph` 归入 `GIT_QUERY_STABLE_TTL_MS`（5s，与 `list-branches` / `get-commit-history` 同档）；`GitQueryResult` 补 `graph?: GitCommitGraphItem[]`
- [✓] S-18.3：类型落在 `stores/git-store-types.ts`（**未动 `src/shared/types/*`**：Git 这条链路本来就把类型放在 renderer store 侧，shared 里没有对应文件，强行新建反而是分裂）。新增 `GitCommitGraphItem`、`GitRepositoryDetails.graph` / `graphError`、`loadCommitGraph(repoPath, { force })` + `pendingCommitGraphRequests` 去重 + `COMMIT_GRAPH_LIMIT = 50`。**图谱按需加载**（只有分支 Tab 消费），不塞进 15s 轮询的 `refreshRepository`
- [✓] S-18.4：`layout/AgentFilesPanel.tsx` 的 union 扩为三值（`files` / `changes` / `branches`），两个裸 button 改成 `TABS` 常量驱动的结构（顺带把 label 的 `t()` 调用收敛成一处）
- [✓] S-18.5：分支列表直接消费 `details.branches`（`git:list-branches` 已在 `refreshRepository` 里加载，本地/远程由 `type` 区分），分「本地分支 / 远程分支」两组展示，当前分支加标记
- [✓] S-18.6：图谱 **SVG 手绘，零依赖**。布局算法抽成纯函数 `components/cowork/commit-graph-layout.ts`（单遍 lane 分配：commit 与第一父提交共用 lane，其余父提交各占新 lane，合并释放的 lane 交给下一个需要的分支 → 宽度受「同时活跃的分支数」约束而非分支总数）；渲染在 `commit-graph.tsx`（贝塞尔连线 + 节点圆点，调色板按 lane 取色）
- [✓] S-18.7：i18n —— `locales/{zh,en}/layout.json` 的 `agentFiles` 块新增 `branches` / `commitGraph` / `localBranches` / `remoteBranches` / `graphEmpty` / `noBranches` / `currentBranch`

**范围裁定**：本次**只读展示**，不做 checkout / merge / delete 等分支操作 —— 那些在 Git 页已有完整入口（`GitPage/ScmSidebar.tsx`），右侧面板是「我在哪」的一眼视图，重复一套写操作只会多一份需要维护的风险面。

**Mini 验证（已执行，2026-09-14）**：
- `tsc` 三配置（web / node / root）零错误
- `dotnet build src/runtime/WishfulClaw.sln` → **0 警告 0 错误**
- AOT 发布（`npm run build:worker:prod`）→ 成功，**零 IL2026/IL3050/IL3051**
- C# 回归 7 工程全过：ProviderHeader / ChannelToolVisibility(108) / ChannelShellApproval(74) / ToolConcurrency / Goal(148) / SessionTaskCascade(180) / CompactionSnapshot(2)
- TS 回归全过：ipc-msgpack-routing(96 断言 / **270** 通道，比 S-23 后多 1 条即本次新增) / settings-tabs(22) / provider-presets(546) / renderable-chat-items(16) / channel-cancel-commands / channel-reply-event-policy / updater-release-notes(71) / updater-state(56) / updater-progress(35)
- 图谱布局断言脚本（跑完即删）**283 条全过**：真实仓库 50 commit（laneCount=2，含 3 个 merge）、合成菱形拓扑（merge→a/b→base 的 lane 分配）、lane 复用、窗口截断（父提交在批外时只丢连线不崩）、空输入、几何换算
- **C# 端到端断言脚本（跑完即删）376 条全过**：直接调 `GitQueryTools.QueryAsync` 跑真实仓库 —— 50 commit / 3 merge / 5 个带 ref，逐条核对 hash 与 parent 均为 40 位 sha、subject 不含分隔符、refs 已 trim；再用 `AgentRuntimeJsonContext.Default.GitQueryResult` 真序列化一次，断言外层键是 `graph`、嵌套键是 `hash`/`shortHash`/`parents`/`refs`（**这是 renderer 真正拿到的字节**，光看编译通过证明不了命名策略生效）；同时回归 `get-commit-history` / `list-branches` 未被破坏、未知 operation 仍干净报错
- `git log --all` 输出格式与 C# 解析逐字段核对（`%P` 空格分隔 / `%D` 逗号+空格分隔；git refname 禁空格，故两种分隔都安全）
- JSON 命名策略确认为 `JsonKnownNamingPolicy.CamelCase` + `WhenWritingNull` → 新字段 `graph` / `shortHash` / `parents` / `refs` 能正确送达 renderer（这也是现有 `GitBranchItem.name` 一直能读到的原因）

## 涉及文件
- `src/runtime/WishfulClaw.Agent/Modules/Git/GitQueryTools.cs` — 改（新 operation + 解析）
- `src/runtime/WishfulClaw.Agent/Modules/Git/GitModels.cs` — 改（`GitCommitGraphItem` + `GitQueryResult.Graph`）
- `src/runtime/WishfulClaw.Agent/AgentRuntimeJsonContext.cs` — 改（DTO 注册）
- `src/main/ipc/git-handlers.ts` — 改（新 IPC）
- `src/main/ipc/git-cache.ts` — 改（TTL + 类型）
- `src/renderer/src/lib/ipc/channels.ts`、`messagepack-channel-routing.ts` — 改（通道常量 + 路由表）
- `src/renderer/src/stores/git-store.ts`、`git-store-types.ts` — 改（类型 + `loadCommitGraph`）
- `src/renderer/src/components/layout/AgentFilesPanel.tsx` — 改（第三 Tab）
- `src/renderer/src/components/cowork/branch-panel.tsx` — 新建（面板）
- `src/renderer/src/components/cowork/commit-graph.tsx` — 新建（SVG 渲染）
- `src/renderer/src/components/cowork/commit-graph-layout.ts` — 新建（布局纯函数）
- `src/renderer/src/locales/{zh,en}/layout.json` — 改

---

# 需求 8：S-19 软件自身界面截图能力

## 目标
让 Agent 能截取**软件自身窗口**并**落盘到仓库路径**，用于由 Agent 自建《使用指引》配图（口径 4）。

## 步骤

- [✓] S-19.1：**抽落盘逻辑**到 `src/main/lib/image-persist.ts` —— `persistImageBuffer(buffer, mediaType, { targetPath?, baseDir? })`。无 `targetPath` 时走旧默认目录（保持向后兼容），有 `targetPath` 时按 `baseDir` 解析相对路径或原样使用绝对路径，扩展名按 mediaType 补齐（或当目标已有图片扩展名时保留）；嵌套目录自动 mkdir。**这是 S-19.2 的前置**：把「写文件」从 IPC handler 里抽出来，让 reverse-request 与 IPC 共用同一段规则
- [✓] S-19.2：`misc-handlers.ts` 的 `image:persist-generated` 加可选 `targetPath` / `baseDir`，复用 `persistImageBuffer`；删掉本地复刻的 `getGeneratedImagesDir` / `guessExtensionFromMimeType` 与对应的 `fs.writeFileSync`，整段逻辑收敛到一个调用点
- [✓] S-19.3：新增 reverse-request `window:capture-self`（`reverse-handlers/window-capture-handler.ts`），注册进 `directHandlers`。`getMainWindow().webContents.capturePage()` → `image.toPNG()` → 若有 `targetPath` 则 `persistImageBuffer` 落盘 → 返回 `{ success, data, width, height, filePath? }`。窗口已最小化时返回明确错误而不自动 restore（避免打扰用户）；delayMs 上限 5000
- [✓] S-19.4：C# `AgentRuntimeDesktopExecutor` 加 `CaptureAppWindow`（加入 `DesktopToolNames` 集合，注释说明「transport is the same as desktop tools, even though subject differs」），新增 `ExecuteAppWindowCaptureAsync`。**关键修正**：路径解析放在 C# 侧而不是 main 侧 —— main 进程的 cwd 是应用目录，`docs/images/foo.png` 交给它会写到错误位置。**C# 拿到 `workingFolder`（ToolDispatchRouter 加传），按 `Path.GetFullPath(Path.Combine(baseDir, requested))` 解析成绝对路径再下传**，main 端只接绝对路径
- [✓] S-19.5：`docs/user-guide.md` 配图待补清单段落更新 —— 指出 `CaptureAppWindow` 截自身窗口**不再需要清场与脱敏**（区别于 `DesktopScreenshot` 仍需脱敏）；图片落点 `docs/images/`，新工具自动创建目录（含嵌套）。**配图补充本身**：S-19 的目标是「**能力本身**」（老大口径：能力即可，落盘位置由 agent 决定），实际补图需要 agent 在应用内打开对应面板调工具 —— 开发态由 agent 触发不了 UI 交互，留给用户/agent 在生产会话里跑
- [✓] S-19.6：AOT —— 改动只新增一条工具定义 + 一个执行器方法，没有新具名 DTO（reverse-request 走 Worker → main 的 MessagePack，参数与结果是已有 JSON 结构），跑 `npm run build:worker:prod` 确认零 IL 警告

**Mini 验证（已执行，2026-09-14）**：
- `tsc` 三配置（web / node / root）零错误
- `dotnet build src/runtime/WishfulClaw.sln` → **0 警告 0 错误**
- AOT 发布（`npm run build:worker:prod`）→ 成功，**零 IL2026/IL3050/IL3051**；产物从 23,104,000 → 23,113,728 字节（+9KB，即新工具定义与 executor 体量）
- C# 回归 7 工程全过（含 ProviderHeader 金样 + ChannelToolVisibility 的 `OverExposureTools` 白名单 —— `CaptureAppWindow` 不列在那里，但 desktop 类工具默认就与 channel session 互斥，金样因此无需更新）
- TS 回归全过；`ipc-msgpack-routing` 通道数 270 不变（reverse-request 不在 renderer 路由表里）
- **真实 Electron 实拍**（核心验收）：临时脚本 `tmp-verify/capture-check.cjs` 用 `node_modules/electron/dist/electron.exe` 启动一个 BrowserWindow（680×420），加载 data URL 页面，`capturePage()` 拿到 999×536 PNG（12,822 字节，魔数 `89 50 4e 47` 正确），落盘到 `docs/images/tmp-capture-check.png` —— `ALL PASS` 后 Read 工具读图确认像素正确（看到「Wishful Claw」蓝色文字 + 「capture-self check」）。同脚本验证 6 种路径场景：相对+扩展名 / 无扩展名补 .png / 嵌套目录自动创建 / 绝对路径 / 默认目录回退 / jpeg mediaType 补 .jpg

**修正记录**：
- `WINDOW_CAPTURE_REGION`（`channels.ts:323`）与 `routing.ts:13` 的 `'window:capture-region'` 是死键（只有常量 + routing 登记，**无任何 handler**），与本次能力同名容易误导。**未删除** —— 它在 Clipboard 分组下，语义是「截取进剪贴板」（待补），与本次的「截取落盘」是两件事，避免触碰老大的未来规划；如未来真做「截图进剪贴板」可换名复用
- `fs:save-image` 也在 routing 表里且**无对应常量**（更死），不在本次范围、未动
- 路径解析**不放 main 侧**：原计划 S-19.3 没明确，C# 执行器现在自带 `workingFolder` 解析，把绝对路径下传给 main —— 这样 `persistImageBuffer` 的 `baseDir` 始终是工作文件夹，main 进程的 cwd 不会干扰
- `image:persist-generated` 的旧 `url` / `filePath` 参数**从未被任何调用方使用**（grep 确认），顺手删掉；扩展名强制已知图片格式（`.png/.jpg/.jpeg/.webp/.gif/.bmp`），其它按 mediaType 补 → 避免「`docs/images/panel.md` 被静默写成 markdown」

## 涉及文件
- `src/main/lib/image-persist.ts` — 新建（落盘逻辑）
- `src/main/ipc/misc-handlers.ts` — 改（`image:persist-generated` 加 targetPath + 复用新模块）
- `src/main/ipc/reverse-handlers/window-capture-handler.ts` — 新建（自窗口截图 reverse-request）
- `src/main/ipc/reverse-handlers/index.ts` — 改（注册 `window:capture-self`）
- `src/runtime/WishfulClaw.Agent/AgentRuntimeDesktopExecutor.cs` — 改（`CaptureAppWindow` + 路径解析）
- `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs` — 改（传 `workingFolder`）
- `src/runtime/WishfulClaw.Agent/Tools/Providers/DesktopToolProvider.cs` — 改（工具定义）
- `docs/user-guide.md` — 改（配图清单段落，反映新能力）

## 避坑说明
- **浏览器通路已验证不可用**：`mcp__browser-use__take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`；in-app browser 指向 dev 渲染进程、拿不到内容（`raw-requirements.md:106`）。**浏览器截图不能替代真机 capturePage**，勿重复踩。

---

# 需求 9：S-21 多服务商限额自动 fallback

## 目标
当前服务商触发限额（5h/周限额、429、503）时，按用户配置的优先级自动降级到下一个服务商继续执行，**同一逻辑请求内切换、保持上下文连贯**。

沿用 iter-27 **Plan D 的 D1–D5 骨架**（设计已写在 `docs/plans/iter-v2-27/plan.md:195-205`），不重开设计。

## 步骤

- [✓] S-21.D1：调用链梳理 —— 写在 `docs/plans/iter-v2-29/S-21-call-chain-notes.md`。关键事实：`ProviderRetryPolicy.ExecuteAsync` **全仓唯一调用点在 `AgentLoop.cs:324`**（grep 确认），fallback 接入只在那里；三段 catch（超时 / 可重试 HTTP / 终端 throw）的第三段是 fallback 切入点；`AgentRuntimeProviderTurnResult` 当前没有「可切换」字段 → 需要扩；`requestMaxRetries=0`（`isUnlimited`）必须保持不切换
- [ ] S-21.D2：配置面 —— `src/shared/types/provider.ts` 增加 fallback 开关与优先级列表；设置页 `ProviderPanel.tsx` 提供可排序配置。**保留现有 `requestMaxRetries` 语义**
- [ ] S-21.D3：状态机 —— 让有限重试耗尽后返回「可切换」结果而非直接 throw；`requestMaxRetries=0`（无限）**保持不切换**；同一请求按序逐个尝试**不循环**；取消立即终止；新增结构化 fallback/重试事件
- [ ] S-21.D4：接入 `AgentLoop` —— 切换时完整复用 `conversation` / `toolDefs` / `state`。⚠️ 切出 `openai-responses` 会丢 `OpenAIResponsesState` 的 response id（未实测，须验）
- [ ] S-21.D5：观测与人工验证 —— 配额信息只作可选观测增强；**用两个可控测试 provider / Mock endpoint 验证，禁止依赖真实 API 触发限额**；日志记原 provider、目标 provider、重试次数、切换原因
- [ ] S-21.D6：**AOT** —— 新增 DTO 注册进 JsonContext
- [✓] S-21.D7：**回归测试工程** —— 新建 `tests/WishfulClaw.ProviderFallbackRegressionTests`（csproj 引用 `WishfulClaw.Agent`，Program.cs 留 sanity 断言 1 条 + D1-D7 注释指针），用 `dotnet sln add` **同步进 `src/runtime/WishfulClaw.sln`**。`dotnet build sln` 0/0；`dotnet run --project tests/<项目> --no-build` 通过。**这一步单独提前做**是项目硬规则（不然像 `CronRegressionTests` / `MemoryRecallRegressionTests` 一样**静默漏编**——既不在 sln、也不在 `dotnet build` 范围里，等于测试从来没跑过）。状态机测试在 D3、AgentLoop 集成测试在 D4 时填实

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
