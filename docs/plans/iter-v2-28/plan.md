# Plan: v2-iter-28

- 分支：`dev/v2-iter-28`（从 `main` @ `0388875e` / `v0.2.27` 切出）
- 范围：原已封口 7 项需求；本次追加 R-8「AI 服务商官网地址与详情页入口」，已登记待规划，见 `raw-requirements.md` 文末「状态」小节
- 提交口径（本迭代起生效的新规）：**一个需求一个提交 + 迭代收尾一次修复调整提交**；R-8 是否纳入本次提交节奏待出 Plan 后确定。规划/审查/验证文档随所属需求提交，不单独成 commit
- 裁定点：老大只在**分支合并 main 前**（他手动说"进行 28 迭代收尾"）裁定一次；需求测通后由 agent 自判提交，不逐需求停下等确认- 本迭代规划期已通过讨论定掉的口径（2026-09-11）：① 全局会话 = 全局 PM 助手，不做工作、不能改文档，**但必须保留只读工具**（因项目下会话无法回复全局对话，全局只能自己读落盘结果确认进度，R-3.F）；② 工具可见性「未声明 = 默认可见」（R-3.D）；③ 串语法 `scope:mode@role`，`unknown` 为无宿主保留值（R-3.A/B）；④ **定时任务拆两类**——`runMode:'session'` 随目标会话、`runMode:'background'` 为 `unknown@automation` 且排除浏览器/渠道专用/交互组件（R-3.C）；⑤ 范围只有 `project`/`global`，协作只属项目下，渠道是 global 的特例；⑥ **子 Agent 两分法**——全局会话的子 Agent 继承全局限制，项目下协作/后台执行的子 Agent 除浏览器外基本都能用；**且子 Agent 一律排除浏览器类**（R-3.C）；⑦ **核心工具集原则**——系统提示词只列"少而必要"的核心工具，其余可用工具经 `use_capability` 按需调用和查询（R-3.C-bis，这是 R-3 的真正意图）；核心集名单已定（priority ≤ 70 的 7 类，且**按档位变化**）；**⑪ `use_capability` 三载体同源同裁**——提示词核心集 / `use_capability` 的 description 分类清单 / `action="list"` 的返回，**三者在本档位下必须是同一套可见面**；实读确认 `list` 当前缺收窄（只调 `availableModes` 未调 `IsToolAllowed`，而前者对未声明该字段的工具直接放行），**属必修缺陷**（老大 2026-09-11 追加裁定）；⑧ **R-3 本次范围 = B（两步走）**——只做机制、零行为变化，可见集收窄与核心集名单收窄立为后继需求；⑨ **R-1「不可见」的定义**——指**用户不知道是哪个模型在请求**，清单为提示词优化 / 新建角色辅助 / 后台定时执行 / 定时任务会话执行；**⑩ R-1 模型解析口径**——**不用"最近使用"**（服务商下线模型 + 用户删除会造成悬空 id，属不可抗力），改为**逐请求显式配置 + 补位兜底**，且四个哑字段全删；**⑫ R-1 三级解析定稿**——① 该请求的显式配置 → ② 补位模型配置 → **③ 全局激活模型（保留 + 强制存在性校验）**（R-1 裁定 ⑤）；**⑬ R-2 三条裁定**——① 旧逐渠道 `features`/`permissions` 值**摘白名单丢弃**；② 5 个「只展示不生效」字段**只搬家 + 记账**，**唯 `allowShell` 例外：本次接真且语义改写为「是否需用户授权」**（本身恒可见，`false`=默认需授权、`true`=免授权直调；`channelPermissions` 全仓零注入点的"半死"状态须一并修，且强制执行须落在 C# Worker 侧）；③ 全局设置**不另开文件**，沿用 `plugins.json` 既有存储路径，**以增加字段的方式**承载（R-2）。
- 阶段产物：`exploration_findings.md`（探索态）、本 `plan.md`（规划态）、`compliance_report.md`（规划验证态）。各需求的权威口径文档为 `usage-analytics-requirement.md`（#1）、`updater-ui-issues.md`（#2）、`editor-undo-selection-issue.md`（#3）、`raw-requirements.md`（R-1～R-8）。


## 目标

补齐模型用量的可观测性地基（请求级日志 + 统计面板），修掉真机升级暴露的两条更新界面缺陷与一条编辑器观感缺陷，并把工具可见性、补位模型、渠道设置页三处架构债按"注册期声明 + 全局单份配置"重做，最后产出面向用户的第一版使用指引。

## 执行顺序与理由

| 序 | 需求 | 为何在此 |
|---|---|---|
| 1 | #2 更新弹窗与悬浮窗 | 勘查与决议早已完成，直接开工 |
| 2 | #1 模型请求日志与用量统计 | 体量最大且是 Plan D（多服务商 fallback）的前置；先打地基 |
| 3 | R-3 工具可见性 | 与 #1 共用 Agent 侧 provider/policy 一批文件，排在 #1 之后避免互相踩 |
| 4 | R-1 补位模型 | 落点也在 provider 层，且其待明确项需老大先裁 |
| 5 | R-2 渠道设置页 | 纯 renderer/store 重构，与上面无冲突 |
| 6 | #3 编辑器撤销选中态 | 复现依赖真实键入与输入法时序，随时可插入 |
| 7 | R-4 使用指引 | 需要前述功能的最终形态，放最后 |
| 8 | R-8 AI 服务商官网地址与详情页入口 | 本次执行期追加，先登记需求；待勘查内置服务商清单与外链现状后再定实施顺序 |

## 步骤清单

### 需求 #2：更新弹窗尺寸/全屏 与 后台悬浮窗移位

详见 `updater-ui-issues.md`（含实施记录）。

- [x] #2.1：默认尺寸 `sm:max-w-5xl` + `sm:min-h-[70vh]`。Mini：`tsc --noEmit -p tsconfig.web.json`。
- [x] #2.2：全屏由 inline style 改纯 class（`translate-x-0 translate-y-0` 覆盖基类 v4 独立 `translate` 属性）。Mini：twMerge 合并探针确认每个冲突键只余一个类；构建产物 CSS 逐类确认已产出。
- [x] #2.3：全屏入口改带文字标签的 outline 按钮。Mini：确认 zh/en `updater.dialog.fullscreen`/`exitFullscreen` 键已存在，无需补文案。
- [x] #2.4：悬浮窗移到左下角并跟随侧边栏宽度（收起时贴左 16px、离底 24px）。Mini：`tsc` 三配置 + `electron-vite build`。
- [x] #2.5：处理实施中发现的左下角与 sonner toast 栈争位（banner 可见时抬高 toast，判据与抬高量单点定义在 banner 模块）。Mini：`test:updater-state` 56 / `test:updater-release-notes` 71 / `test:updater-progress` 35，共 162 checks 全过。
- [ ] #2.6：老大在 dev 目视复验验收 1–6（配方见 `updater-ui-issues.md` 文末）。**未过不得勾成完成。**

### 需求 #1：模型请求日志与用量统计面板

需求与口径见 `usage-analytics-requirement.md`（第 0 节为拍定项，不再重开）。切分沿用需求文档第 8 节三个 Plan + 拆除项；C# 侧写入点调研已在 `exploration_findings.md` 第 2 节固化。

- [x] #1-P1：建表与 C# 写入钩子（一次 HTTP 请求一行，成功与失败尝试都落；`runtime_role` 取现成值；成本在写入时按显式配置价格算并落列）。落点：Provider 层现有 usage 产出点（Anthropic / OpenAI Chat / Gemini / Vertex）。验证：跑一次成功请求 + 一次 429 重试，表内行数与尝试次数一致。
  > **✅ 已完成（2026-09-11）**。落点最终定在 **`ProviderRetryPolicy.ExecuteAsync` 的重试循环**，不是 Provider 层：三家 Provider 的 `message_end` 只在成功时触发，失败请求（429/500）直接抛异常，挂 Provider 层必然丢掉全部失败请求。产出 `RequestUsageLogEntity`（31 字段）、`DbUsageLogTools`（Insert/ComputeBillableInput/ApplyCosts）、`ProviderRetryPolicy.UsageLog.cs`（LogRequestAttempt/CreateRequestLogRow/ClassifyError），DDL 与 4 索引进 `DbClient.cs`。`LogRequestAttempt` 置于 `EmitAsync` **之前**（前者不抛、后者可能抛）。回归 `UsageLogChecks` 7 套件全绿：成功 1 行 / 2×429+1 成功 = 3 行 / 重试耗尽每尝试 1 行 / 401 不可重试仍落 1 行 / 成本 `$3/M×1M=$3.00` 且无价 NULL / `billableInput=100−20−10=70` / 表 31 列。
- [x] #1-P2：查询端点（走 `workerRequest('db/usage-*')`，概览/分桶/按模型/按来源/明细）。验证：每条端点的返回结构有对应 AOT `JsonTypeInfo`，`WorkerResponse.Json` 显式传该 typeInfo。
  > **✅ 已完成（2026-09-11）**。5 端点 `db/usage-{overview,buckets,by-model,by-source,logs}` 注册于 `DbModule.cs`，实现在 `DbUsageLogQueryTools.cs`，DTO 在 `RequestUsageLogResults.cs`（5 结果 + 4 行类型，全部具名）。9 个新 `JsonSerializable` 注册进 `InfrastructureJsonContext`（含 `List<T>`），`WorkerResponse.Json` 全部显式传 typeInfo。桶补齐（24h 按小时 / 7d/30d 按天，空桶补零行）；空窗口返回零值+空数组，不报错。查询层回归 6 套件全绿（含空窗口与桶补齐断言，断言基于序列化 JSON，同时证明 AOT 注册有效）。
  > 实现注记：`DbService.QueryFirstOrDefault<T>` 带 `where T : class` 约束，故聚合投影改用私有 `OverviewRow` 类、计数改用 `QueryScalar<long>`；`InfrastructureJsonContext` 开了 `WhenWritingNull`，null 成本字段表现为**键缺失**而非显式 null。
- [x] #1-P3：统计面板 UI（24h / 7d / 30d 三档，24h 按小时分桶；下方今日明细）。验证：`tsc` 三配置 + 手工核验三档切换与空数据态。
  > **✅ 已完成（2026-09-11）**。产出 `components/settings/UsagePanel.tsx`：三档切换（`24h`/`7d`/`30d` 简写由 worker 解析，客户端不与后端约定桶边界）、6 张汇总卡（请求数/计费输入/输出/缓存读取/成本/平均耗时）、手写柱状图（失败请求红色叠加；零流量桶保留 2px 底线使时间轴连续）、按模型 + 按来源两张 rollup 表、最近 50 条明细表（含重试次数 `#n` 与失败原因）。空窗口渲染空状态而非报错。
  > 接入：新增 `usage` 到 `SettingsTab`（`ui-types.ts` 两处：联合类型 + `SETTINGS_TABS`），注册进设置页「AI 服务」分组（`BarChart3` 图标），i18n 加 `tabs.usage`（zh/en）。
  > 并发防护：`loadSeq` ref 防止慢的 30d 响应覆盖新的 24h 响应。
  > **成本显示口径**：`formatCost` 对 null/undefined 渲染 `—`，与"未配置价格即未知"一致，不显示 `$0.00`（那会暗示免费）。
  > 验证：`tsc -p tsconfig.web.json` + `tsconfig.node.json` 均 0 错误；`test:settings-tabs` 20 断言通过（顺带补上原清单漏列的 `logs`）；`test:renderable-chat-items` 16 通过；`test:provider-presets` 330 断言通过。
- [x] #1-P4：拆除渲染端旧半边（`lib/usage-analytics.ts` 及其三处 `recordUsageEvent` 调用点，按需求文档第 10 节确认后**直接删除**）。验证：全仓 `recordUsageEvent` 零命中；`db/messages-usage-stats` 保留原样不受影响。
  > **✅ 已完成（2026-09-11）**。删除 `lib/usage-analytics.ts`（373 行），移除两个导入方共 3 处调用点：`lib/pet/pet-agent.ts`（`pet-chat`）、`stores/translate-store.ts`（`translate` × 2，agent + simple 两分支）。该文件的 11 个 getter **原本就零调用方**（已核验），故整体是纯死代码。
  > 验证：全仓 `recordUsageEvent` **零命中**、`usage-analytics` **零命中**；`db/messages-usage-stats` 端点仍在（`DbModule.cs:56`，另被 `src/main/channels/plugin-command-stats.ts:25` 消费）；`DbMessageCompactTools.cs` 与 `MessageEntity.cs` `git status` **零改动**——旧回合级统计完好无损。

硬约束：AOT（新增具名 DTO 注册进 `InfrastructureJsonContext`/`WishfulClawJsonContext` 含 `List<T>`，`WorkerResponse.Json` 显式传 `JsonTypeInfo`）；`billableInput` 必须取 `DbMessageCompactTools.cs:186` 口径，不得抄 Provider 里少减 `cacheCreation` 的那个回退值；交叉验证用 `requestTimings` 长度对账行数。

**本次接线范围（老大指令）**：**只覆盖 AgentLoop 主线**（`ProviderRetryPolicy`）。`ProviderCompletionService` 与 `PersonaGenerator` 两条隐式请求链**本次不接线**，留待 R-1.4 一并处理。新表 `request_usage_logs` 为**独立新统计**，与旧的回合级会话统计（`messages.usage` / `db/messages-usage-stats`）无任何读写关系；已核验 `DbMessageCompactTools.cs` 与 `MessageEntity.cs` **零改动**。

### 需求 #3：编辑器撤销后遗留多余选中态

现状见 `editor-undo-selection-issue.md`：文本结果正确、仅观感；合成事件层复现不出来，唯二能画出非折叠选区的出口是 `FileAwareEditor.tsx:144` 与 `:253`。

- [x] #3.1：定位 `selectionRef` 在"字母/中文出现、数字不出现"这条分界下何时被记成非折叠区间。**结论**：真实键盘事件在裸 contenteditable 上复现出撤销入口——`historyUndo` 的 `input` 事件触发时实时选区即为非折叠 `{2,4}`（逐字敲字母复现、逐字敲数字为折叠 `{2,2}`），系 Blink 按词分组撤销还原「受影响区间」；第二入口是组合期间的下划线区间经 `scheduleSelectionSync` 存进 `selectionRef`。两条入口都不经共享解析器，详见 `editor-undo-selection-issue.md`「结论（iter-28 实施）」。
- [x] #3.2：在粘贴/撤销边界的选区处理处修，不动共享解析器。落地：新建 `file-aware-editor-undo-selection.ts`（`isHistoryInputType` + `collapseRestoredHistorySelection`，**仅撤销前为折叠光标时**收成区间起点，保留「选中→删除→撤销」的整段还原选中）；`syncSelection` 在 `isComposingRef` 为真时只记区间末端。Mini：`tsc` 三配置（web / node / root）全部零错误。
  - ❌（审查发现，已修）：上句「保留『选中→删除→撤销』的整段还原选中」**当时不成立**——门控读的是 `selectionRef`，而删除那一步已把 `selectionRef` 同步成折叠光标，撤销时门控照样放行 → 整段还原选区仍被收起。修法：`handleBeforeInput` 里用 `selectionWasExpandedBeforeMutation` 记下**变更前**选区是否展开（`beforeinput` 是唯一还能读到未改动 DOM 的时机），撤销时该标记为真则跳过 collapse，并在 `handleInput` 的历史分支里**消费一次即清零**，避免连按撤销把后续无关变更的幻影选区也放过去。Mini 复测：`tsc` 三配置（web / node / root）再次全部零错误。
- [ ] #3.3：老大真机复验样例（粘贴 `1234` → 改 `12你好34` → 撤销应无选中），并确认「选中一段 → 删除 → 撤销」仍保留整段还原选中。

⚠️ 本项验证依赖真实键入与输入法时序，agent 无法自主复验；若 #3.1 查不到根因，向老大报告而不是加兜底清除逻辑。

### 需求 R-1：补位模型（不可见 Agent 请求的兜底）

原始需求见 `raw-requirements.md` R-1 节，勘查见 `exploration_findings.md` 第 3 节。

**目标**：给"不可见请求"（用户在主对话流里看不到"是哪个模型在答"的辅助请求）一个显式的补位模型配置；**解析顺序为三级**——① 该请求的显式配置 → ② 补位模型配置 → ③ 全局激活模型（**保留 + 强制存在性校验**，见裁定 ⑤）。

**已查明的落点事实（本轮实读）**：

- 当前唯一在跑的"不可见请求"是提示词优化，链路为 `use-prompt-optimizer.ts:55-94` → `optimizer.ts:48-97` → `ProviderTestModule.cs:14` → `ProviderCompletionService.CompleteAsync`（`ProviderCompletionService.cs:25`）。
- 调用侧**已经持有 `providerId`**（`use-prompt-optimizer.ts:84-94` 的 `providerConfig.providerId = activeProvider.id`，类型见 `api/types.ts:459`），但 `optimizer.ts:60-69` 构造 `params.provider` 时**只取 type/baseUrl/apiKey**，`providerId` 被丢掉。
- `ProviderCompletionService` 全文 384 行，`runtime_role` / `RuntimeRole` **零命中**——这条旁路当前无来源标识，而需求 #1 的 usage 写入钩子按 `runtime_role` 分维。
- 该服务当前**只有单 provider 内重试**（`MaxAttempts=10`、退避 1s→capped 30s、`retryable=429/408/≥500`、HttpClient timeout 180s），**无跨 provider 兜底**。
- 四个同族字段全是哑数据：`contextCompressionModel`、`useGlobalActiveModel`、`ClaudeCodeConfig`（含 `smallFastModelId`）、`promptRecommendationModels` ——`src/runtime` / `src/main` / `src/shared` 对上述键名零命中。
- 唯一活着的模型解析是 `useProviderStore.activeProviderId / activeModelId`（`provider-store.ts:19-20,29-33,93,95,305-306`）＋ 会话绑定回退（`AssistantMessage/index.tsx:89-126`）。
- 无 recency 埋点：`lastUsedAt` 只属 `ProviderOAuthAccount`（`provider.ts:188`），写点是 OAuth 账号轮转戳，与模型无关。
- 结果 DTO 是具名 record `ProviderCompletionResult`（`AotResultTypes.cs:84-88`），改字段须同步 AOT 注册。

**✅ 裁定 ①：范围边界（老大 2026-09-11 口述，推翻原设想）**

老大原话：

> 「请求不可见的，优化提示词，新建角色辅助，后台定时执行，这些都是不可见的啊，后台执行目前我们可以设置模型了，**我说的不可见 指的是用户也不知道是哪个模型在请求**」

**"不可见"的定义被彻底改写了**——原来的判据是"用户在主对话流里看不到这条请求"，**现在改成"用户也不知道是哪个模型在跑"**。两者差别很大：

| | 原判据（作废） | ✅ 新判据（生效） |
|---|---|---|
| 否定对象 | 看不见**请求本身** | 看不见**用的哪个模型** |
| 典型例子 | 提示词优化 | 提示词优化、**新建角色辅助**、**后台定时执行** |
| 反例 | — | **有专属模型配置的辅助请求不算"不可见"** |

**据此确定的清单（四条，全部实读核实）**：

| # | 请求 | 落点 | 现状 |
|---|---|---|---|
| 1 | **提示词优化** | `optimizer.ts:60-69` → `ProviderTestModule.cs:14` → `ProviderCompletionService.CompleteAsync` | 丢 `providerId`，无来源标识 |
| 2 | **新建角色辅助**（AI 生成人格） | `PersonaGeneratorDialog.tsx:51-59` → `persona-store.ts:172-194`（`workerRequest('persona/generate')`）→ `PersonaModule.cs:168-198` → `PersonaGenerator.GenerateAsync` | **独立 HTTP 实现**，见下 |
| 3 | **后台定时执行** | `cron-runtime.ts:465-495`（`runMode:'background'` 的 sidecar 路径） | **已有模型配置且已生效**：`resolveProvider:77-99` 支持 `event.agentId`（provider）+ `event.model`（模型）显式指定；`buildProviderConfig:101-112` **已带 `providerId`**。故第 3 条**不是"缺配置"，而是"缺少「这是哪条不可见请求」的来源标识"** |
| 4 | **定时任务 · 依赖会话执行** | `cron-runtime.ts:405-420` 走 `chatStore.sendMessage` | 走主对话管线，**能配模型**（同 3），但同样无来源标识 |

**⚠️ 第 2 条的重大发现：`PersonaGenerator` 是第三套独立的 HTTP 实现，完全绕开 Provider 层**

- `PersonaGenerator.cs:41-45` 自己 `switch (providerType)` 分派，`:52-79` `CallOpenAIAsync` / `:81-104` `CallAnthropicAsync` **各自手搓 `HttpRequestMessage`**，`:70` / `:96` 直接 `Http.SendAsync`。
- **不进 `ProviderCompletionService`**（`ProviderTestModule.cs:14` 那条路），因而：
  - 需求 #1 的 usage 写入钩子若设在 Provider 层，**这条请求完全不会被记录**；
  - `runtime_role` 无从附带；
  - 它的 `model` 解析是 `JsonHelpers.GetString(provider, "model")` + **硬编码兜底**（`:55` `"gpt-4o-mini"`、`:84` `"claude-3-5-haiku-20241022"`）——**兜底值写死在 C# 里**，与用户实际配置无关；
  - 它**只认 `anthropic` 走 Anthropic，其余全走 OpenAI 协议**（`:41-45`），故 Gemini / Vertex 等**必然走错协议**。
- 结论：**第 2 条不只是"丢 providerId"，而是"整条链在 Provider 体系之外"**。修复它 = 把 `PersonaGenerator` 的调用改接到 `ProviderCompletionService`（或至少接入同一写入钩子），**这是一项独立工作量，须在 R-1 单列**。

**⚠️ 与需求 #1 的交界（升级为硬约束）**：需求 #1 的写入钩子**必须同时覆盖两条链**——`ProviderCompletionService`（覆盖第 1、3、4 条）与 `PersonaGenerator`（覆盖第 2 条）。若只挂在前者，**"新建角色"永远不进用量统计**。原「与需求 #1 的交界」一句仅提 `runtime_role` 分维，**低估了这条**。

**⚠️ 由新判据推出的一个重要区分（须老大确认，我按此设计）**：

> **"不可见"描述的是"用户不知道跑的哪个模型"这个事实，不是"用户不配给它配模型"这个约束。**

- 第 3 条正说明这一点：**后台定时任务已经能配模型**（`CronJobFormDialog.tsx:336-345` 的模型选择、`:326-330` 的 agentId），但它**仍然是"不可见"的**——因为用户配完就忘了，运行时不会在主对话流里体现"这次是哪个模型在答"。
- 故**补位模型的作用是"用户没显式配时给个兜底"**，而**不是取代显式配置**。三者优先级应为：
  **① 该请求的显式配置**（如定时任务的 `agentId`+`model`；将来提示词优化/角色生成的专属配置） → **② 补位模型配置**（本条需求新建） → **③ 全局激活模型**（现状行为）。
- **这条直接决定 R-1.3 的"三级解析"写法**——原骨架写的是"配置的补位模型 → 未配置时回退 → 调用侧传入"，**未给"该请求自己的显式配置"留位置**，须改。

**两个从属问题（✅ 均已由裁定 ④⑤ 闭合，保留原文备查）**：
1. 上述优先级 ①→②→③ 是否认可（尤其"显式配置优先于补位模型"这一点）→ **✅ 认可**（裁定 ④ 定为"补位模型 = 纯兜底"；裁定 ⑤ 保留第 ③ 级）。
2. **是否给提示词优化与角色生成也各加一个显式模型配置项** → **✅ 加**（裁定 ④：各增一项，形态对齐定时任务的 agentId+model）。

**✅ 裁定 ②：「最近使用」口径作废，改为显式配置（老大 2026-09-11）**

老大原话（两条，含真实踩坑）：

> 「最近使用口径其实不可靠，目前我遇到这种问题 最近使用的，突然不可用了，然后去模型管理里面调整了，然后最近使用的模型实际是不可用的。」
> 「最近使用不可用属于不可抗力吧，本来用的好好的，结果模型下线了，只能去模型管理里面删了，这时候你再去使用就是一个不存在的模型了」

**⚠️ 这不是代码 bug，是外部不可抗力**——服务商单方面下线模型，用户只能去模型管理里删掉它，**结果持久化的 id 就成了悬空指针**。老大明确把它定性为"不可抗力"，**故不作为缺陷立案**，但**它足以否定"最近使用"作为可靠性方案**。

**事故链（据此确认，非臆测）**：

```
① 用户长期用模型 M → 某天服务商下线 M
② 用户在模型管理里删除 M
③ 持久化的 activeModelId / (未来) recency 记录 仍指向 M  ← 悬空
④ 下一次不可见请求按该 id 解析 → 得到一个"不存在的模型"
⑤ 请求失败，且用户全程无感（这正是"不可见"的定义）
```

**代码印证悬空风险是真实的**：
- `activeModelId` 是**持久化状态**（`provider-store.ts:20`，persist 白名单 `:306`）。
- 清理逻辑**只在切换 provider 时跑**：`:78-89`（`setActiveProvider` 内）发现 `activeModelId` 不在新 provider 的 models 里才回退。**若用户只删模型、不切 provider，这段不会执行** → 悬空值留存。
- 同类槽位有**四对**（`:22,99` fast / `:127,134` translation / `:132` image / speech），`getCompressionProviderConfig`（`:121-125`）与 `getTranslationProviderConfig`（`:126-130`）**直接返回持久化 id，不做有效性校验**。

**结论：不用"最近使用"，改为"显式配置 + 补位兜底"**。这与裁定 ④（加显式配置）自洽——**配置项由用户显式选定，天然不会指向已删模型**；即使将来失效，也是"用户自己配的那个坏了"，可由设置页给出可见的错误提示，**而不是一个无从追溯的隐式回退**。

**顺带确立一条健壮性原则（写入设计，不单独立需求）**：任何持久化的模型引用（补位模型配置、四对 active*ModelId）在**读取时**都应做存在性校验，失效则回退并**记日志**——而非静默使用一个不存在的 id。本次至少保证**补位模型配置**走这条校验。

**✅ 裁定 ③：四个哑字段——删（老大 2026-09-11：「哑字段不要了被」）**

| 字段 | 处置 |
|---|---|
| `contextCompressionModel` | **删** |
| `useGlobalActiveModel` | **删** |
| `ClaudeCodeConfig`（含 `smallFastModelId`） | **删** |
| `promptRecommendationModels` | **删** |

- 依据：四者在 `src/runtime` / `src/main` / `src/shared` **对键名零命中**，是纯哑数据；留着只会在日后被误当"已有配置"。
- **不并入本条统一接线**（那是原选项之一，已否）：它们的语义各不相同，硬接成一件事反而更乱。
- ⚠️ **删之前须确认它们不属于本轮新增的显式配置项**——尤其 `promptRecommendationModels`（名字正对"提示词优化"）。若裁定 ④ 决定给提示词优化加配置，**应新建字段而非复用这个哑字段**（复用会把"从未生效的旧结构"当成既有约定，语义拎不清）。删除动作与裁定 ④ 的落点在**同一步骤内**一并处理，避免删了又加。

**✅ 裁定 ④：给第 1/2 条也加显式模型配置（老大 2026-09-11：「加显式模型配置这个可以」）**

- **提示词优化**与**新建角色辅助**各增一个显式模型配置项（形态对齐定时任务的"agentId + model"）。
- **补位模型的定位随之明确为"纯兜底"**：三级解析 = **① 该请求的显式配置 → ② 补位模型 → ③ 全局激活模型（带存在性校验，见裁定 ⑤）**。

**✅ 裁定 ⑤：第 ③ 级「全局激活模型」保留（老大 2026-09-11：「保留（带存在性校验）」）**

老大原话：

> 「1  R-1 三级解析第 ③ 级"全局激活模型"是否保留	**保留（带存在性校验）**」

**三级解析最终定稿**：

```
① 该请求的显式配置（定时任务 agentId+model / 提示词优化 / 新建角色辅助）
      ↓ 未配置
② 补位模型配置（本条需求新建，纯兜底定位）
      ↓ 未配置
③ 全局激活模型（useProviderStore.activeProviderId + activeModelId）
      ↓ 仍无效
   → 报可见错误（不静默猜、不静默用悬空 id）
```

**第 ③ 级的两条硬约束（"带存在性校验"的具体含义）**：

1. **读取时校验**：取 `activeModelId` 后**必须**核对目标 provider 的模型列表**是否仍存在**该 id。因 `provider-store.ts:78-89` 的清理逻辑**只在 `setActiveProvider` 内**——用户**只删模型、不切 provider** 时，持久化的 `activeModelId` 会**悬空**且永不清理（这正是裁定 ② 老大踩的那个坑）。
2. **失效即显式失败**：校验不通过时**回退到"报可见错误"**，**不得**把它当有效配置使用或静默改投别的模型（重演"用一个不存在的模型"）。记日志，不静默。

> **与裁定 ② 的关系**：保留第 ③ 级**不违背**裁定 ② 否掉"最近使用"的理由——裁定 ② 否的是"**把最近使用当作主口径**"（不可靠），而第 ③ 级是**最后兜底 + 强制校验**，比"无配置则失败"体验好，且校验堵住了悬空 id。**两者的差别在"是否校验"**：老方案不校验故会踩坑，本方案强制校验故安全。

**步骤清单**（**五条裁定全部闭合**，见上）：

- [x] R-1.0：出 Plan（本节，完成）＋ **五条全部裁定**：① 范围边界（四条清单）；② **不用"最近使用"，改显式配置 + 补位兜底**（不可抗力定性）；③ **四个哑字段全删**；④ **给第 1/2 条加显式模型配置**；⑤ **第 ③ 级"全局激活模型"保留 + 强制存在性校验**。
- [x] R-1.1：定配置的存储与下发通道。配置落在 Worker `config.json` 的 `providerCompletion` 节点，经 `provider/completion-config-read|write` 下发；`ProviderCompletionSettings` / `ProviderCompletionSettingsResult` 已注册 `AgentRuntimeJsonContext` AOT。
- [x] R-1.2：`optimizer.ts:60-69` 补传 `providerId`（`model` 已在顶层 `params.model`）。
  - 实落：`provider.providerId` ＋ `requestKind:'promptOptimizer'` ＋ `providerRole:'global'` ＋ `globalActiveModel{providerId, modelId}`。`providerRole:'global'` 是**故意的**——它让共享解析器跳过"调用方自带 provider"这条显式路，把提示词优化的第 ① 级定成 Worker 侧专属路由（R-1.6），而不是"当前会话恰好在用哪个模型"。
  - 验证（真机，dev 实例 + CDP，非静态核对）：见 R-1.3 的真机条目。**该轮真机验证暴露出一个根因缺陷**——`workerRequestWithId` 的返回类型写成 `Promise<{result, requestId}>`，但主进程 handler（`misc-handlers.ts:96`）自 `f8fe878d`（2026-08-26，provider/complete 全链路取消改造）起一直直接返回 worker 载荷本身，`git log -S requestId` 证明该包装从未存在过。`optimizer.ts` 因此长期取 `response.result === undefined`，**提示词优化自那天起每次都是"Empty response from worker"**。已按根因修：preload 契约改为 `Promise<T>`（含 `index.d.ts`），调用侧直接取结果并保留 `?? { ok:false }` 兜空响应；不加重试、不加"请刷新"按钮。修复后日志 `extracted 3/3 options from tool args`。
- [x] R-1.3：`ProviderCompletionService` 内增加三级解析：**① 该请求的显式配置 → ② 补位模型配置 → ③ 全局激活模型（✅ 裁定 ⑤：保留，须带存在性校验）**。
  - 实落为共享解析器 `ProviderCompletionResolver.Resolve(parameters, requestKind)`（`Infrastructure/Storage/ProviderCompletionSettings.cs`），`ProviderCompletionService` 与 `PersonaGenerator` **同用一个**，故 R-1.4「接回 Provider 体系」落在"模型解析"这一半。
  - 验证：`ProviderCompletionResolutionChecks.Run()`（已挂进 `ProviderHeaderRegressionTests`），6 条断言覆盖 ①显式优先于配置、②配置优先于全局、③补位兜底、④配置里的**模型**被删→降级、⑤配置里的**provider**被删→降级、⑥全局激活模型悬空→**显式失败并带 "no longer exists"**。运行时可见 3 条 `WARN`，即 R-1.7 要求的"记日志不静默"。
  - 真机三级解析（dev 实例，运行时页配置 → 点"优化提示词" → 读 `request_usage_logs`）：
    - 第 ① 级生效：把提示词优化路由配成 `agnes-2.5-pro-beta`，全局激活模型仍是 `agnes-3.0-flash`（顶栏徽章可见）→ 落库行 `promptOptimizer / agnes-2.5-pro-beta / 761 in / 820 out / 183 reasoning`。**配置赢全局**，且证明渲染端传来的 `providerId` 确实到了 Worker。
    - 路由清空后落到末级：同一操作 → `promptOptimizer / agnes-3.0-flash / 646 in / 877 out`，即第 ③ 级全局激活模型。
    - 悬空配置不静默：把人格路由指向已删除的 `deleted-model-x` → `WARN auxiliary provider configured route unavailable kind=persona error=Model 'deleted-model-x' no longer exists in provider 'x8HOp-...'`，随后走补位并成功落库。
- [x] R-1.4：**把 `PersonaGenerator` 接回 Provider 体系**——现状是绕开 `ProviderCompletionService` 的独立 HTTP 实现（`PersonaGenerator.cs:41-104`），且硬编码兜底模型、只认 OpenAI/Anthropic 两协议。至少须让它**进入需求 #1 的写入钩子**与 **R-1.3 的三级解析**。
  - 已完成（"至少须"的两项）：硬编码兜底 `"gpt-4o-mini"` / `"claude-3-5-haiku-20241022"` **已删**；模型选择改走同一个 `ProviderCompletionResolver`；成功与异常两条出口都写 `AuxiliaryUsageLog`，`runtime_role = "personaGenerator"`；`PersonaModule` 允许省略 `provider`（交解析器兜底）；`WishfulClaw.Persona` 显式引用 Infrastructure（Persona→Infrastructure 属正向依赖）。
  - ⚠️ **已知限制（明确记账）**：请求构造与响应解析仍是 PersonaGenerator 自己的两条 HTTP 实现，且**只认 anthropic 与 OpenAI 兼容协议**；Gemini / Vertex 会按 OpenAI 兼容协议发出，命中时打 `WorkerLog.Warn("persona generation uses OpenAI-compatible protocol for provider type ...")`。彻底改接 `ProviderCompletionService` 是"换实现"而非"换解析口径"，未纳入本条。
  - 验证：`UsageLogChecks.RunAuxiliaryUsageSuite` 以 `runtime_role='personaGenerator'` 断言写库；真机已实跑一次 `persona/generate`（dev 实例 Worker），落库行 `personaGenerator / agnes-2.5-pro-beta / 553 in / 3654 out / reasoning 2.6K`，即补位路由在人格链上同样生效。
  - ⚠️ **该真机请求只能直调 Worker 方法，走不了 UI**：见本节末「待老大裁」第 1 条。
- [x] R-1.5：**删除四个哑字段**（裁定 ③）。复搜口径放宽到八项键名：`contextCompressionModel` / `useGlobalActiveModel` / `claudeCodeConfigs` / `ClaudeCodeConfig` / `smallFastModelId` / `promptRecommendationModels` / `SessionDefaultModelBinding` / `sanitizeClaudeCode` —— `src` + `tests` 内**全部 0 命中**。`dotnet build` 0 错误 0 警告，`tsc` 三配置零错误。
- [x] R-1.6：**给第 1/2 条加显式模型配置项**（裁定 ④）——`ProviderCompletionSettings` 新建 `promptOptimizer{Provider,Model}Id` 与 `persona{Provider,Model}Id` 两对，**未复用 R-1.5 删掉的哑字段**。UI 见 `ProviderCompletionSettingsPanel.tsx`（provider + model 双下拉，形态对齐定时任务的 `agentId`+`model`），已从运行与性能页提取为 AI 服务分组下、紧随 AI 服务商之后的「模型管理」页签。
  - 验证：`tsc` 三配置 + `test:settings-tabs`（20 断言）通过；"未配置时走第 ② 级"由解析器断言 ③ 覆盖。真机已在 dev 实例的实际点击与保存：面板写→`config.json` 的 `providerCompletion` 节点（camelCase）→重载读回一致，配好的路由随后被 R-1.3 的落库行证明生效；验证完毕已把三项路由复位为 null。
- [x] R-1.7：**补位模型配置项**（同一面板第三行 `fallback{Provider,Model}Id`）＋ **读取时的存在性校验**。校验落在 `TryResolveStored`：provider 文件不存在 / 模型不在 `models[]` / type+baseUrl 缺失三种情况一律**降级到下一级并 `WorkerLog.Warn`**，最后一级仍无效则返回可见错误（不静默猜模型）。
  - 验证：R-1.3 的 ④⑤⑥ 三条断言即"指向已删模型确认回退且有日志"，测试输出中三条 `WARN` 逐条对得上。zh/en 文案已补齐（`runtimePage.auxiliaryModels.*` 与模型管理页签文案），无硬编码中文。
- [x] R-1.8：给第 1/2/3/4 条补来源标识。**四条来源互不相同且均可被 #1 的查询按 `runtime_role` 分组**：`promptOptimizer`（由 `requestKind` 映射）、`personaGenerator`（PersonaGenerator 直传）、`automationBackground` / `automationSession`（`cron-runtime.ts` 传 `usageSource`，`ProviderRetryPolicy.UsageLog.cs:117` 用它覆盖 `runtime_role`）。
  - 顺带修掉两处**写死的假值**：`AuxiliaryUsageLog` 原先恒写 `CollaborationMode="chat"`（cowork 会话里点"优化提示词"会被标错）与 `TotalAttempts=1`（`ProviderCompletionService` 内部最多重试 10 次，却报"一次就成"）。前者改 `"unknown"`（无会话的单次请求本就没有 scope/mode，实体与建表注释同步），后者改由调用方传真实次数；`attempt_index` 仍恒为 1——辅助链**一次逻辑请求一行**，与主线"一次尝试一行"的粒度差异已在注释写明。
  - `usageSource` 已补进 `chatStore.sendMessage` 的参数类型（此前 `cron-runtime.ts:421` 必须靠 `as unknown as` 整对象断言才能把它传出去）。
  - 回归：`UsageLogChecks.RunUsageSourceOverrideSuite` 钉住两条方向——传 `usageSource` 时它覆盖 `runtime_role`，不传时保留运行态的规范角色 `sessionagent`（`AgentRunContextPolicy.Resolve` 归一化是小写）。
  - 真机「按来源」分组（dev 实例）：同一张表里并列出现 `promptOptimizer`、`providerCompletion`、`personaGenerator`、`sessionagent · global:chat` 四类，互不混淆。为让这条成立，`UsagePanelParts.tsx` 的来源串改为丢弃 `unknown` 占位段——辅助请求无会话，硬拼 `unknown:unknown` 会把用户真正要看的"哪个模型答的"埋掉。

⚠️ **R-1 真机验证带出的两项越界发现（只记账，不在本条自行动手）**：

1. **AI 生成人格自诞生起就没有 UI 入口。** `PersonaGeneratorDialog.tsx` 全仓仅被它自己引用（`grep -rn PersonaGeneratorDialog src/` 除定义文件外 0 命中），`persona-store.ts:172 generatePersona` 的唯一消费方就是这个从未挂载的对话框。`git show 6ae15912`（2026-07-23，迭代6 `feat(persona): 6-7 AI-assisted persona creation`）只新增了组件 + store + Worker 侧，**没碰任何页面/设置面板**——不是后来被删掉的挂载点，是一开始就没接。R-1 把这条链的模型解析与记账都修到了位，但用户仍然**点不到它**。需老大裁定：本次补入口，还是记账为后继需求。（这也是 R-1.4 真机验证只能直调 `persona/generate` 的原因。）
2. **需求 #1 用量面板的 i18n 只接了一半。** `UsagePanel.tsx` 有 23 处 `t('usage.*', { defaultValue: 中文 })` 加 3 处 `usage.ranges.*`，**zh / en 两份 settings.json 里都不存在这些键**（只有 `tabs.usage` 这个页签标签）；`UsagePanelParts.tsx` 连 `useTranslation` 都没有，表头与图表 tooltip 是硬编码中文。结果：zh 环境看起来正常，**en 环境整块面板显示中文**。属 #1 的收尾活，与 R-1 无关，故单独记账。

⚠️ **与需求 #1 的交界（已升级为硬约束）**：见上文「第 2 条的重大发现」——#1 的钩子必须覆盖 `ProviderCompletionService` **与** `PersonaGenerator` 两条链，否则第 2 条永久缺失。

⚠️ **与 Plan D 不是一件事**：Plan D 是**可见主对话**请求失败后的跨服务商切换（`docs/plans/iter-v2-27/plan.md:195-205`，未纳入 28）；R-1 是**不可见请求**的默认路由。两者不得合并。

### 需求 R-2：渠道设置页去单份、全局回复设置改选项卡

原始需求见 `raw-requirements.md` R-2 节。勘查见 `exploration_findings.md` 第 4 节。

**现状与需求的落差（须先让老大知道）**：「功能设置」7 个字段里**只有 2 个真生效**——`features.autoReply`（消费点 `use-channel-auto-reply.ts:139-143`）与 `features.autoStart`（消费点 `src/main/ipc/channel-handlers/channel-plugin-handlers.ts:167-176`，由 `index.ts:607` 调）。`streamingReply` 与 4 个 `permissions.allow*` 只在 `/status` 文本与 UI 里展示，不驱动任何行为（`auto-reply.ts:238` 的 `supportsStreaming` 来自 service 能力而非该字段）。**其中 `allowShell` 另有一层问题**：`bash-tool.ts:50` 读的 `channelPermissions.allowShell` **全仓零赋值点**（`channelPermissions` 仅 `tool-types.ts:44` 声明 + `:50` 读取两处），故 `ctx.channelPermissions` 恒为 `undefined`，该字段**从未影响过任何调用**——属"半死"（有读取方、无注入方），**本次裁定接真并改写语义**（见下方裁定 ② 与步骤 R-2.6）。另外 `ChannelInstance.tools`（`channel-types.ts:66`）**零调用方**：主进程侧反向请求入口整条链已接好（`reverse-handlers/index.ts:88,153-158` → `src/main/ipc/channel-handlers/channel-plugin-handlers.ts:163-165` → `src/main/ipc/channel-handlers/channel-handler-utils.ts:268` → `channel-config-store.ts:51`），但 `tool-enabled` 全仓只在主进程这两处出现，**C# 侧零处发起**；C# 侧工具筛选走 `toolPreset + sessionMode`（`AgentLoop.cs:166-168`、`AgentRunContextPolicy.cs:117-133,176`）——这条与 R-3 直接相关，见 R-3 节。

**落点约束**：渠道配置唯一落盘处是 C# 侧 `~/.wishful-claw/plugins.json`（`ChannelConfigStore.cs:19,181-184`），读写全经主进程转发（`plugin:update` / `plugin:list`）。全局设置若存进渲染端 `settings-store`（那是主进程 `general.json`），与 AGENTS.md「功能只有 C# Worker 版本才算完成」冲突。**页面无 shadcn `Tabs` 可依赖**（`components/ui/` 下无 `tabs.tsx`），设置页各 tab 全是自绘按钮组；`mcp-panel.tsx:101,215`、`skill-panel.tsx:180,201` 用「两块 div 常驻 + `hidden`」保挂载，照抄时若改成条件渲染会丢状态。

- [x] R-2.1：`GlobalChannelSettings`（`PluginPanel.tsx:99-101,136-137` 的 `<details open>`）改为自绘选项卡，样板取 `plugin-panel-detail.tsx:221-260,352-358`（含「当前 tab 不可见时自动切首个」的 effect）。Mini：`tsc` 三配置。
- [x] R-2.2：把 `features` / `permissions` 从渠道详情的 features tab（`plugin-panel-detail.tsx:103-217`）搬进上述全局选项卡，渠道详情只留 `qr` / `credentials` 与渠道自身的 `providerId`/`model` 覆盖。Mini：`tsc` 三配置 + 手工核验渠道列表→详情→切换渠道不残留上一个渠道的表单值。
- [x] R-2.3：两处消费端改读全局（`use-channel-auto-reply.ts:139-143`、`src/main/ipc/channel-handlers/channel-plugin-handlers.ts:167-176`）。Mini：C# `dotnet build` + 三套 `tsc`。
- [x] R-2.4：旧逐渠道 key 从 `plugin:list` 顶层白名单摘除，让首读即剪枝（`src/main/ipc/channel-handlers/channel-plugin-handlers.ts:344-352` 已有该机制，白名单现含 `features`/`permissions`/`tools`/`providerId`/`model`），避免 `plugin:update` 浅合并（`:392`）留下僵尸字段。Mini：拿一份真实 `plugins.json` 副本跑首读，确认旧 key 被删且渠道功能不受影响。
- [x] R-2.5：`autoStart` 等默认值收敛到单点——现存 5 处不一致（seed `false` @ `src/main/ipc/channel-handlers/channel-plugin-handlers.ts:292`、UI 兜底 `true` @ `plugin-panel-detail.tsx:107`、启动判定 `?? true` @ `:170`、`/status` 兜底 `true` @ `plugin-command-handlers.ts:321-325`、`use-channel-auto-reply.ts:139`）。
- [x] R-2.6：**`allowShell` 接真（语义改写为「是否需用户授权」）**（裁定 ② 的例外项，老大 2026-09-11 拍定）——① **修正命名与文案**：字段名与 `plugin-panel-detail.tsx:191-192` 的「Shell 执行」/「允许 AI 执行 shell 命令」描述的是**旧语义**，须改为"是否需授权"口径（建议重命名 `shellRequiresApproval` 取反语义，或至少改名不可行时在类型注释 + UI 文案明写）；② **默认值 = 需授权**（`false` 保持，但要与旧字段语义对齐）；③ **注入 `channelPermissions`**——当前全仓**零赋值点**（`tool-types.ts:44` 声明 + `bash-tool.ts:50` 读取，`ctx.channelPermissions` 恒为 `undefined`），须从渠道配置真正注入到工具执行上下文；④ **C# Worker 侧同步强制**——`bash-tool.ts:49-52` 的 `requiresApproval` 在渲染边界，而 `execute` 直接返回 `nativeOnlyBashResult()`，**真实执行在 C# 侧**，故授权判定必须在 C# Worker 侧也成立，否则重蹈"零注入"覆辙。验证：① `tsc` 三配置 + C# `dotnet build`；② 渠道会话下 `Bash` **恒可见**（`shell` 属核心集 priority 30）；③ `allowShell=false`（默认）时调用 **触发用户授权确认**；④ `allowShell=true` 时**免授权直接执行**；⑤ 两种设置下 **`Bash` 均出现在可见集与提示词核心集中**（证明它管的是授权不是可见性）。
- [x] R-2.7：**记账 4 个仍不生效的权限字段**（裁定 ② 主体）——`allowReadHome` / `readablePathPrefixes` / `allowWriteOutside` / `allowSubAgents` 本次**只搬家 + 记账**，不接真。须在本文档与 `raw-requirements.md` 明写"当前仅展示与 `/status` 回显，无强制执行点"，**防后续误以为已生效**。验证：四处读取点核实仍仅在 `plugin-command-handlers.ts:338-341` 与 UI；记账条目进入后继需求清单。

**R-2 实现与验证记录（2026-09-12）**

落点文件：新增 `src/runtime/WishfulClaw.Infrastructure/Storage/GlobalChannelSettings.cs`（值与默认值的唯一真源）、`src/runtime/WishfulClaw.Agent/Modules/Channels/GlobalChannelSettingsService.cs`（Worker 端点）、`src/runtime/WishfulClaw.Agent/ToolCallProcessor.Approval.cs`（授权半边从 `ToolCallProcessor.cs` 拆出）、`src/renderer/src/components/settings/plugin-panel-global.tsx`（三选项卡面板）；改造 `channel-types.ts`、`channel-config-store.ts`、`channel-handler-utils.ts`、`channel-plugin-handlers.ts`、`plugin-command-handlers.ts`、`PluginPanel.tsx`、`plugin-panel-detail.tsx`、`plugin-panel-qr.tsx`、`use-channel-auto-reply.ts`、`channel-store.ts`、`bash-tool.ts`、`tool-types.ts`、`api/types.ts`、zh/en `settings.json`。

| 步骤 | 落地 | 证据 |
|---|---|---|
| R-2.1 | 原 `<details open>` 全局块删掉，换成自绘三 tab（`reply`/`features`/`permissions`），三块 div 常驻 + `hidden` 保挂载 | 三套 `tsc` 0 错误；`PluginPanel.tsx` 166→100 行 |
| R-2.2 | `plugin-panel-detail.tsx` 的 `FeaturesPanel`（117 行）与 `features` tab 删除，`ConfigTab` 收成 `'qr' \| 'credentials'`；渠道自身 `providerId`/`model` 覆盖保留 | 全仓 grep `channel.tabs.features` 0 消费点，zh/en 死键同步删除 |
| R-2.3 | `use-channel-auto-reply.ts` 改读全局 `autoReply`；`autoStartChannels` 改读全局 `autoStart` | 读不到设置时**不本地兜默认**：autoReply 保持放行（等同旧默认 `true`），autoStart 记 ERROR 后跳过本轮自动启动 |
| R-2.4 | 顶层白名单摘除 `features`/`permissions`（余 11 键），命中差异即回写 | 实读本机 `~/.wishful-claw/plugins.json`（root 仍是 `JsonArray`，8 渠道）：key 集合已完全等于新白名单，**本条为向前干净的 no-op**；旧值一旦存在即会被首读删除 |
| R-2.5 | 默认值收敛到 `GlobalChannelSettings.Defaults` 一处，TS 侧不再声明任何默认（`channel-types.ts` 注释明写"Worker applies the defaults"） | 原 5 处不一致逐条消除：seed 不再写 features/permissions、UI 改 spinner 占位、启动判定与 `/status` 改读全局（读失败打印 Unavailable 而非兜一套）、auto-reply 改读全局 |
| R-2.6 | ① 改名 `shellRequiresApproval`（取反）+ zh/en 文案改写；② 默认 `true`=需授权，旧 `allowShell:false` 取反映射到安全侧；③ **放弃注入 `channelPermissions`**（见下）；④ C# `IsChannelShellApprovalWaived` 仅在「渠道会话 + shell 四类 + 全局关闭」时免确认 | 新增 `tests/WishfulClaw.ChannelShellApprovalRegressionTests`：**57 断言全过**（默认为 ask / legacy 两向映射 / 显式键优先 / 非布尔脏值不采信 / 豁免不含 `Write`·`Edit`·`NotebookEdit`·`Desktop*`·读类 / 非渠道会话不豁免 / 小写名不匹配即回落 ask / shell 四类在开关两种取值下均留在 default approval set = 授权≠可见性 / 整对象存盘回读一致且存盘会抹掉 retired `allowShell`）；`ChannelToolVisibilityRegressionTests` 102 断言、ToolConcurrency、SessionTaskCascade 均不回退 |
| R-2.7 | 4 个 `allow*` + `streamingReply` 明写未接真：UI 段首提示"以下开关当前仅记录设置，尚未接入强制执行"，`/status` 三行打 `(not enforced yet)` | `raw-requirements.md` S-5 记账条目；`readablePathPrefixes` 本次连 UI 输入项都没有（仅存盘与回读） |

**两处与步骤预估不一致的纠偏（须让老大知道）**：

1. **存储落点**：裁定 ③ 的"沿用 `plugins.json` 增字段"经实读**不可行**——`plugins.json` 的根节点是 `JsonArray`（`ChannelConfigStore.cs:33` 要求 `is JsonArray`），要放一个与渠道数组并列的全局对象就得改根形状，主进程与 C# 两侧读写全要跟着改，风险远大于收益。改存 **Worker `ConfigStore` 键 `channelSettings`**（即 `~/.wishful-claw/config.json`），与 `providerCompletion` 等既有全局设置同处、同一读写通道——这仍然是老大原话的"与既有设置同样的方式，增加字段"。代价：比原预估多了 2 个 Worker 端点（`channel/settings-read` / `channel/settings-write`）与 2 个 AOT 类型（`GlobalChannelSettings`、`GlobalChannelSettingsResult`，已注册进 `AgentRuntimeJsonContext`），"无需新增端点、无需新增 AOT 类型"的原句作废。
2. **R-2.6③ 的注入方案取消**：实读确认 `toolRegistry.checkRequiresApproval` **全仓零调用方**，`bash-tool.ts` 的 `execute` 恒返回 `nativeOnlyBashResult()`——即"注入 `channelPermissions` 给渲染端判定"是一条**接了也不会被执行的死路径**（正是本条要防的"重蹈零注入覆辙"）。改为删除 `bash-tool.ts` 的 `requiresApproval` 与 `tool-types.ts` 的 `channelPermissions` 声明，授权判定唯一真源落在 C#。

**本条真机验证缺口**：渠道会话端到端（微信/飞书里真发一条消息，看 `Bash` 在两种设置下分别"弹授权"与"直接跑"）需要老大的真实渠道绑定，未跑；面板的实际渲染与切渠道不残留值的手工核验同样未跑。静态面（类型、编译、57 条行为断言）已全部通过。



**✅ 本条三条待裁项已全部裁定（老大 2026-09-11）**：

**① 旧逐渠道 `features`/`permissions` 值 → 摘白名单丢弃**（老大原话：「摘白名单丢弃」）。

即：默认值以**全局唯一真源**为准，不尝试从任一既有渠道搬值当全局初值（无既有依据可取哪一份）。落地方式沿用 R-2.4 既有机制——把 `features`/`permissions` 从 `plugin:list` 顶层白名单摘除，**首读即剪枝**，旧逐渠道 key 会被删除，不会因 `plugin:update` 浅合并（`:392`）留成僵尸字段。

**② 5 个「只展示不生效」字段 → 只搬家 + 记账**（老大原话：「只搬家 + 记账」）——**但 `allowShell` 除外，本次接真且语义改写**。

**实读复核（4 个 `allow*` 权限字段全部无强制执行点，证据如下）**：

| 字段 | 读取点 | 是否驱动行为 |
|---|---|---|
| `permissions.allowReadHome` | `plugin-command-handlers.ts:339` 仅 `/status` 打印 | ❌ 无 |
| `permissions.readablePathPrefixes` | 无任何读取点（仅 seed/UI 初始化） | ❌ 无 |
| `permissions.allowWriteOutside` | `plugin-command-handlers.ts:340` 仅 `/status` 打印 | ❌ 无 |
| `permissions.allowSubAgents` | `plugin-command-handlers.ts:341` 仅 `/status` 打印 | ❌ 无 |
| `permissions.allowShell` | `bash-tool.ts:50` **唯一真读取点**，但 `channelPermissions` 全仓**零赋值点** | ❌ 当前未生效（半死） |
| `features.autoReply` | `use-channel-auto-reply.ts:139-143` | ✅ 生效 |
| `features.streamingReply` | 仅 `/status` 打印（`supportsStreaming` 来自 service 能力，非本字段） | ❌ 无 |
| `features.autoStart` | `channel-plugin-handlers.ts:167-176`（`index.ts:607` 调） | ✅ 生效 |

**关键补充实读**：`channelPermissions` 全仓**仅 2 处出现，零赋值点**——`tool-types.ts:44` 声明 + `bash-tool.ts:50` 读取。即 `requiresApproval` 的 `ctx.channelPermissions` **永远是 `undefined`**，故 `allowShell` 的配置**从未影响过任何一次调用**（永远走 `:51` 的 `return true`，即永远需授权）。

**`allowShell` 的新语义（老大 2026-09-11 改写，本次接真）**：

老大原话：

> 「permissions.allowShell 这个可以让它生效，部分用户确实不希望渠道对话的时候直接使用，可以语言确认授权也行，**默认需要用户授权**，这个改成是否用户授权，也就是**本身是可见的，只是是否需要用户授权才能调用**，以及不需要用户授权直接调用」

**语义改写要点**：

| 维度 | 旧语义（命名暗示） | **新语义（老大拍定）** |
|---|---|---|
| 管什么 | 看起来像"是否允许 Shell"（**可见性/可用性开关**） | **是否需用户授权才可调用**（**授权策略开关**） |
| 可见性 | 疑似可关掉 | **始终可见**——`Bash` 恒在可见集与核心集内（`shell` 类属 priority 30，见 R-3.C-bis 核心集表） |
| `true` | 允许执行 | **不需要用户授权，直接调用** |
| `false` | 禁止执行 | **本身可见，但每次调用需用户确认（语言确认授权）**，是**默认值** |
| 与 R-3 的关系 | — | 挂在**统一可见性判定之后**的**授权层**；与 R-3.9「渠道工具开关接真作为收窄层」是同层的两条并列机制（R-3.9 管"能不能用"，本条管"用之前要不要问"） |

**⚠️ 命名须一并修正**（否则误导后来者）：字段名 `allowShell` 读起来是"允许 Shell"，与"是否需要授权"相反——`allowShell=true` 实际含义是"免授权"。**建议改名为 `shellRequiresApproval`（取反）或 `shellAutoApprove`，并使默认值语义清晰**；若因持久化兼容不便改名，**至少在类型注释与 UI 文案里明写新语义**（`plugin-panel-detail.tsx:191-192` 的现有文案「Shell 执行」/「允许 AI 执行 shell 命令」**必须改**，因其描述的是旧语义）。

**接真的两处改动**：

1. **注入点**：`channelPermissions` 须真正从渠道配置注入到工具执行上下文（当前零赋值点）——落点与 R-3.9 的渠道开关读取点同处，**两项宜同批做**。
2. **消费点**：`bash-tool.ts:50` 的 `requiresApproval` 逻辑本身**已符合新语义**（`!allowShell` → 即"未开免授权则需授权"），**保留即可**，只需保证 `ctx.channelPermissions` 真的被注入、且默认值为 `false`（= 默认需授权）。同时确认**渲染端 C# 侧**（Native Worker 的 Bash 实际执行方）也走同一授权判定——`bash-tool.ts` 是渲染边界，`execute` 直接返回 `nativeOnlyBashResult()`，**故真正的强制执行必须在 C# Worker 侧**，不能只在渲染端做（否则形同虚设，重蹈 `channelPermissions` 零注入的覆辙）。

**③ 全局设置存哪 → 与既有设置同样的方式，增加字段**（老大原话：「之前哪些设置存那里 增加字段一样的方式，这个没有什么讲头」）。

即：**不另开全局配置文件**，沿用现有 `plugins.json` 的存储路径与读写通道（`ChannelConfigStore.cs:19,181-184`），**以增加字段的方式**承载全局设置。R-2.3 的两处消费端改读全局、R-2.4 的白名单摘除，均在此前提下进行。

**据此，R-2 的落点约束相应简化**：无需新增 C# 端点、无需新增 AOT 类型（沿用既有 `plugins.json` 读写路径），全局设置只是同文件内新增键。

⚠️ 本节与 R-3 共用 `channel-types.ts:56-76`、`channel-config-store.ts:42-58`、`src/main/ipc/channel-handlers/channel-plugin-handlers.ts:292-299,344-357`、`src/main/ipc/channel-handlers/channel-handler-utils.ts:251-263` 四个文件，**两项不得并行改**。

### 需求 R-3：工具可见性改为注册期声明「范围:级别」，取代写死白名单

原始需求与四轮补充见 `raw-requirements.md` R-3 节。落点与 #1 共用 Agent 侧文件，故排在 #1 之后。勘查见 `exploration_findings.md` 第 5 节。

#### R-3.A 语义模型（老大 2026-09-11 确认，全部设计的基准）

```
scope ─┬─ project ─┬─ chat    （会话）
       │           └─ cowork  （协作）← 只有项目下有
       ├─ global  ── chat    （全局会话 = 全局 PM 助手）
       │            └─ channel（特例：回复经渠道插件发出）
       └─ unknown ── *       （无宿主的后台执行；当前唯一实例：定时任务后台档）
```

- **scope 一是 `project` / `global` 两种为主体**；`unknown` 是**保留值**，仅用于"确实没有宿主"的执行态（R-3.C 6b），不代表第三种业务范围。
- **协作（cowork）只属于项目下会话**。全局会话没有协作。
- **全局会话只有 chat**，角色定位是「全局 PM 助手」——负责与用户沟通整理需求、给项目下会话派活、管控进度，**不做具体工作**（`PromptBuilder.cs:410-433` 的 `BuildGlobalAgentPrompt` 实证）。
- **渠道是 global 下的特例**，不是第三级 scope → 表达为 `global:channel`。
- **`global:cowork` 语义上不成立**，方案里不出现。
- 推论：`AgentRunContextPolicy.cs:125-130`（channel→global）与 `:134-137`（global→chat）两条强制折算是**正确语义的代码化，不是缺陷，本次不动**。

#### R-3.B 组合串语法（✅ 已裁定，老大 2026-09-11）

```
<scope>:<mode>[@<role>]
```

**老大拍定：用 `@` 后缀（不用三段平铺）。** 理由：`scope:mode` 是主体的两级定性，`@role` 是"以什么身份跑"的修饰，用 `@` 在视觉与语义上把二者分开，读起来就是 `project:cowork @subagent`（"项目协作下的子 Agent"）。

- `scope`：`project` | `global` | `unknown`（`*` 仅用于声明侧）
- `mode`：`chat` | `cowork` | `channel` | `*`
- `role`（可省）：`sessionagent` | `subagent` | `goalsubagent` | `goalrunner` | `automation` | `pet` | `providerturn` | `translation` | `*`
- **声明侧可用通配**（如 `*:chat`）；**运行侧永远是具体串**（如 `project:chat`），两侧不混用。

#### R-3.C 全量场景映射（实读各调用侧，13 项）
| # | 场景 | 统一串 | 现状来源 |
|---|---|---|---|
| 1 | 项目下普通对话 | `project:chat` | `use-chat-actions.ts:252` |
| 2 | 项目下协作 | `project:cowork` | 同上 |
| 3 | 全局对话（PM 助手） | `global:chat` | 全局会话 |
| 4 | 全局对话中属于渠道的 | `global:channel` | `use-channel-auto-reply.ts:291` |
| 5 | 项目下子 Agent | `project:chat@subagent` / `project:cowork@subagent` | `SubAgentExecutor.Parameters.cs:44,77` |
| 6a | **定时任务 · 依赖会话执行** | **随目标会话** + `@automation`（`project:cowork@automation` / `global:chat@automation`） | `cron-runtime.ts:405-420`（`runtimeRole:'sessionAgent'`，`scope`/`collaborationMode` 取目标会话） |
| 6b | **定时任务 · 后台执行（无宿主）** | `unknown` + `@automation` | `cron-runtime.ts:476-495`（`scope`/`collaborationMode` 由 `runEvent.scope` 推断，非真实会话） |
| 7 | Goal 跑 | 随宿主 + `@goalrunner` | `project-send-message.ts:205` |
| 8 | Goal 子 Agent | 随宿主 + `@goalsubagent` | `SubAgentExecutor.Parameters.cs:78` |
| 9 | 桌宠 | `global:chat@pet` | `pet-agent.ts:194` |
| 10 | Provider 单轮 | 随上下文 + `@providerturn` | `IndependentRuntimeRoles` |
| 11 | 翻译 | 随上下文 + `@translation` | 同上 |
| 12 | 无宿主执行态（保留值） | `unknown` | 见 6b |

**定时任务必须拆成两类（老大 2026-09-11 明确，实读代码印证）**——`runMode: 'background' | 'session'`（`AutomationTaskFormDialog.tsx:37,89`，落库 `cron-reverse-handler.ts:115,545`）：

| 类 | 串 | 权限口径 |
|---|---|---|
| **6a 依赖会话执行** | 继承目标会话 | 「这个会话是什么范围就是什么范围」——**完全等于宿主会话**，不特殊 |
| **6b 后台执行（无宿主）** | `unknown@automation` | 「除了不能操作浏览器，其它除了一些特殊的比如渠道专用、不可见以外，其它工具应该都可以，还有部分需要用户交互的组件工具也不能用」 |

**6b 的三条排除**（老大原话，逐条对齐）：

| 排除项 | 对应工具 | 理由 |
|---|---|---|
| ① 浏览器 | `Browser*`（category `browser`） | 与子 Agent 同因——驱动前台进程 |
| ② 渠道专用 | `ChannelSendImage`/`ChannelSendFile`，及 `global:channel` 特化项 | 无渠道上下文，发了也没有落点 |
| ③ 需用户交互的组件工具 | `AskUserQuestion` / `ExitPlanMode` / `visualize_show_widget` | 后台无人可答，会挂住 |

**6b 的关键含义：后台定时任务是"默认可见 + 收窄"的又一实例**——除上述三类外**其余全开**（含 `Write`/`Edit`/`Bash`），这与现状 `runtimeRole:"automation"` 走 `IndependentRuntimeRoles` 全放行**方向一致**，故机制化后此档**除三类收窄外行为不变**。

**定时任务与子 Agent 属同一类**（老大 2026-09-11 确认「基本权限都差不多」）：两者都是**继承宿主 scope/mode、只替换角色**，落地时 `@subagent` / `@goalsubagent` / `@automation` **共用一份基础权限声明**，不写三遍。

**子 Agent 的两分法**（老大 2026-09-11 补充，覆盖第 5/8 两类）：

| 子 Agent 从哪来 | 统一串 | 权限口径 |
|---|---|---|
| **全局会话的子 Agent** | `global:chat@subagent` | **继承全局会话的限制**——全局是 PM 助手不做工作，故其子 Agent 也不得拿到写/执行类工具 |
| **项目下协作 / 其它后台执行** | `project:cowork@subagent`（及其它后台宿主） | **除浏览器外基本都能用**——即「默认可见」在此档位实际呈现为近乎全开 |

**另一条横切规则：子 Agent 一律不准用浏览器**（老大 2026-09-11：「浏览器属于前台进程 所以我希望子agent不准用」）。

- 依据：浏览器工具（`BrowserNavigate`/`BrowserGetContent`/`BrowserScreenshot`，`BrowserToolProvider.cs:18,28,38`，category `browser`）驱动的是**前台可见的浏览器进程**；子 Agent 在后台跑，占用前台浏览器语义错位。
- 落地：**声明侧**把 `browser` 类从所有 `*@subagent` / `*@goalsubagent` 的可见集合中排除（**黑名单显式排除**，见 R-3.D 收窄 1 的同类做法），不靠"宿主看不到所以子 Agent 也看不到"的间接推导——因为项目下协作档的默认可见会把它放进来。
- 与 R-4.5 的交界：`DesktopScreenshot` 是另一类（截桌面，非浏览器进程），R-4 要用它截图，**不在本条排除范围内**。

#### R-3.C-bis 核心工具集原则（老大 2026-09-11 拍定，R-3 的真正意图）

> 老大原话：「**会话本身是有核心工具这个说法的，我希望的是系统提示词提供的工具要少且必要，其它可用工具是按需通过 use_capability 再调用和查询的**。」

**这是 R-3 的目的，不只是手段**——前面 A～D 各项解决"哪些工具可见"，本条解决"**可见的工具里，哪些值得占用系统提示词的篇幅**"。两层不可混淆：

| 层 | 问题 | 载体 |
|---|---|---|
| **可见性** | 这个工具在当前档位**能不能用** | `VisibleScopes`（R-3.D） |
| **核心性** | 这个工具值不值得**直接进系统提示词** | `IsCore`（本条） |

**目标形态**：

```
系统提示词 = 少量核心工具（直接列出，可立即调用）
           + use_capability 代理入口（按需 list → inspect → call）
```

**现状落差（实读，必须修）**：

- `PromptBuilder.cs:242-259` 的 `BuildToolCapability()` **无条件列出全部 27 个 category**（直接遍历 `ToolCategoryCatalog.All`，`:246`），标题还写 "Not every category is exposed in every session"——**用一句免责声明掩盖了"列出了大量本档不可用项"的事实**。这正与"少且必要"相反。
- 该函数的入参是无参的，**拿不到当前会话上下文**，故它无法按档位裁剪——**结构上就做不到"少且必要"**。
- 已有一半机制（`ProxiedCategories` 14 类 + `ProxiedBuiltinTools` 3 名，`AgentRuntimeUseCapabilityExecutor.cs:32-45`）：这些类**不进 chat/coding preset、只经 `use_capability` 到达**——**方向正确**，但存在两个问题：
  - ① 该名单**与 `ToolPreset` 的名单矛盾**（`ProxiedCategories` 14 类 vs `ToolPreset.AllowedCategories`，仅 5 类重叠；`task`/`project` 两边都有；`goal` 类 10 个工具但 proxy 只点名 3 个）——两套分类学各说各话。
  - ② 系统提示词**仍然把 27 个类全列出来**（含 14 个 proxied 类），于是模型看到的是"有这么些类别"，但其中一半得绕 `use_capability`——**提示词与真实可用面不一致**。

**⚠️ 关键推论：`use_capability` 的 description 必须列出「支持哪些分类」（老大 2026-09-11 强调）**

老大原话：

> 「use_capability 的 action="list" 不是重点，而是 **use_capability 本身一定会进核心工具的**，这时候说明里面需要带上它支持有哪些分类，这样 agent 才知道通过它查询浏览器工具 这是我举的例子哈」

**这条修正了上一稿设计中的一个危险倾向**：我原本打算让 `BuildToolCapability()` 只输出核心集、把 proxied 类**全部从提示词里拿掉**。**那样会更好，也更糟**——

- 好处：提示词从 27 类降到 7 类（"少而必要"达成）。
- **致命坏处**：agent 连"我们还有这些能力"都不知道了。**"少"不等于"不告诉它有什么"**——一旦浏览器、桌面、渠道这些类从视野里消失，agent **不会想到去 `use_capability` 里查**，能力等于被藏死。

**正确形态：核心工具直列 + 按需能力"目录"经 `use_capability` 的 description 交代**。三者分工：

| 载体 | 内容 | 作用 |
|---|---|---|
| 提示词 `<tool_calling>` | **核心工具**（R-3.C-bis 定的 7 类） | 立即可用，占篇幅 |
| **`use_capability` 的 description** | **它支持的全部 category 清单** | **告诉 agent"还有什么可用、从哪查"** |
| `action="list"` | 分页明细 + schema | 真正取用时才查 |

> ⚠️ **三个载体都必须是"本档位口径"**（老大 2026-09-11 追加裁定：「use_capability action="list" 也是需要应用收窄的啊」）。此三处**同源同裁**——description 列的分类、`list` 返的明细、提示词列的核心集，**在本档位下应当是同一套可见面**，不得出现"description 说没有、`list` 却查得到"或反之的漂移。**这条直接决定了 `list` 必须走收窄，不能只走 `availableModes`**（见下方实读缺陷）。

**现状（实读，作为本轮要改的对象）**：`UseCapabilityToolProvider.cs:36-39` 的 `category` 参数说明只写 "such as **mcp, skill, project, desktop, or goal**" —— **仅 5 个举例，且与真实代理面不符**，没有任何权威性。agent 无从得知还有浏览器等类。

**⚠️ 关键推论二：`action="list"` 当前缺收窄——是漏口，不是待确认项**（老大 2026-09-11 裁定 + 本轮实读验证）

老大原话：

> 「**use_capability action="list" 也是需要应用收窄的啊**」

**实读三个动作的收窄覆盖，结论是"一好两缺"**：

| 动作 | 实现位置 | 是否走会话上下文收窄 | 判定 |
|---|---|---|---|
| `call`（`builtin:` 分支） | `AgentRuntimeUseCapabilityExecutor.cs:322-327` | ✅ 已调 `AgentRunContextPolicy.IsToolAllowed(runContext, toolName, category, channelSession)` | 已具备 |
| `inspect`（`builtin:` 分支） | `AgentRuntimeUseCapabilityEncoding.cs:115-133` | ✅ 已调 `IsToolAllowed` | 已具备 |
| **`list`** | `AgentRuntimeUseCapabilityDiscovery.cs:148-153` | ❌ **只调 `registry.IsAvailableInMode(name, sessionMode)`，缺 `IsToolAllowed`** | **缺陷** |

**缺陷细节（实读原文）**——`BuildCapabilitySummaries` 的 builtin 过滤条件为：

```
category is null
|| !IsProxiedBuiltinTool(name, category)
|| !registry.IsAvailableInMode(name, sessionMode)        // ← 仅按 availableModes 判
|| !registry.TryGetExecutor(name, out var executor)
|| executor is null
```

而 `ToolRegistry.IsAvailableInMode`（`ToolRegistry.cs:87-98`）在工具**未声明 `availableModes`** 时（`_toolModes` 无该项或为空数组）**直接 `return true`**（`:91-92`）。浏览器 9 个工具恰恰**未设 `availableModes`**（`BrowserToolProvider.cs` 全文件零命中）→ 故 `project:cowork@subagent` 档下 `action="list"` **照样把 9 个浏览器工具列出来**，子 Agent 拿到 `capability_id` 后 `action=call` 虽会被 `:322-327` 拦下，但**能力已经暴露在视野里**，且"description 说没有 / list 查得到 / call 又拒绝"三者自相矛盾——**违反本条开头的"三载体同源同裁"原则**。

**修复口径（并入 R-3.5 与 R-3.8d）**：

1. `BuildCapabilitySummaries` 的 builtin 过滤链**补上第 4 个条件** `!AgentRunContextPolicy.IsToolAllowed(runContext, name, category, channelSession)`——**挂点已在手边**：`runContext`/`sessionMode`/`channelSession` 三个参数**已在签名里**（`:96-98`），由 `EncodeListResponse` 从 `ExecuteAsync:125` 的 `AgentRunContextPolicy.Resolve(state.Parameters)` 一路传下，**无需改调用链，只需加一个判断**。
2. **`list` 的 `categories` 分组统计也要基于收窄后的集合**（当前 `EncodeListResponse:214-218` 的 `categories` 从 `filtered` 生成——补上收窄后自然正确，**但须验证**）。
3. `EncodeBuiltinInspectResponse`（`Encoding.cs:115-133`）**已正确**，作为对照基准，不重复实现——两处应共用同一判定，不得写成两套。
4. **MCP/Skill 条目不参与此收窄**（它们不在 registry，无 `IsToolAllowed` 语义）——它们的收窄靠 R-3.D 收窄 2 的"注册来源兜"。

**与 R-3.8d 的关系**：R-3.8d 原写"确认收窄 4 的生效点在 proxy 层"——**本轮实读把"确认"升级为"必修"**：不起作用（当前就是缺的），故 R-3.8d 从"验证类"步骤变为"实现类"步骤。

**实读核出的真实代理面（14 类，`AgentRuntimeUseCapabilityExecutor.cs:32-38`）**：

```
desktop · cron · image-generate · notebook · widget · team
channel-plugin · plugin · ssh · skill-management · project · global-task
global-dispatch-reply · task
```

**与 `ToolCategoryCatalog`（27 类）对照后发现三处不一致，须一并修**：

1. **`task` 被同时列入「核心集」与「proxied」**——`ToolCategoryCatalog` 里 `task` priority=40（≤70 → 属核心集），但 `ProxiedCategories` 也含 `task`。**自相矛盾**：既在提示词核心位，又只在 proxy 能取到。**须定：`task` 归核心集，从 `ProxiedCategories` 移除**（Task* 是会话内委派主力的常用工具，属"少而必要"无疑）。
2. **`goal` 类 10 个工具，但 `proxied` 未列 `goal`**，只在 `ProxiedBuiltinTools` 点名 3 个（`list_goals`/`get_goal_history`/`reopen_goal`）——**半代理半直连，分类学不干净**。须定：`goal` 类**整体进 proxied**（它是长周期能力，非每轮必用），`ProxiedBuiltinTools` 随之收敛。
3. **`browser` 本应属 proxied，但现状是"直连"**（✅ 老大 2026-09-11 已定性）：老大原话——

   > 「浏览器属于插件提供的 跟mcp这些一样，需要通过 use_capapility 去获取」

   **即：浏览器是插件提供的能力，与 MCP 同类，故必须经 `use_capability` 获取，不进核心集、不直连。** 而现状与之矛盾（实读）：
   - `BrowserToolProvider.cs:13` 的 `Category => "browser"`，**9 个工具**（`BrowserNavigate`/`GetContent`/`Screenshot`/`Snapshot`/`Click`/`Type`/`Scroll`/`Evaluate`/`Search`）以普通 `ToolDefinitionPlaceholder` **直接注册**，且**未设 `availableModes`**（文件内零命中）。
   - `browser` **出现在 preset 白名单**里：`ToolPreset.cs:53,68,83`（chat / coding / channel 三档的 AllowedCategories 都含 `browser`）→ 故浏览器工具**当前是直连给模型的**。
   - 而 `ProxiedCategories`（14 类）**不含 `browser`**。
   - **须定：把 `browser` 加进 `ProxiedCategories`，并从三处 preset 白名单移除**——这使"浏览器经 proxy 取"成立，与"浏览器属插件能力"的定性一致，也顺带解释了为何它要在 R-3.D 的收窄 4（子 Agent 排除 browser）里被特别对待。

   ⚠️ **注意与 R-3.D 收窄 4 的交互**：收窄 4 要求"子 Agent 排除 `browser` 类"。若 `browser` 进了 proxied，则**排除须作用在 proxy 的 `list` 上**（不能只在直连工具列表里过滤），否则子 Agent 仍能经 `use_capability` 取到浏览器。

   **⚠️ 本项与 B 口径的关系（须单独判定，不能笼统说"零变化"）**：实读 `ToolPreset.cs` 三处白名单（`:53` chat / `:68` coding / `:83` channel）现含 `browser`，而 `BrowserToolProvider` 的 9 个工具**未设 `availableModes`**（文件内零命中）→ 故浏览器**当前直连出现在这三档的提示词里**。把它移入 proxied 后：
   - **可见面（能不能用）**：不变（原直连可见，改后经 proxy 仍可见）→ 这一层**零变化，本次可做**。
   - **提示词内容（是否直列）**：**变化**（9 个浏览器工具从直接列表移出，改为"经 use_capability 可得"）→ 这一层**属 R-3.C-bis 的收窄**，按 B 应**留下一步**。
   - **结论**：本次**只做"加进 `ProxiedCategories` + 从 preset 移除"的机制改动，但保持提示词等价现状**（即 B 口径下提示词仍列出该能力，只是改由 `use_capability` 行的分类清单承载——这正是 R-3.8b 的用途）。**收窄留下一步**，与 R-3.7③ 同批。

**落地口径（写入 R-3.C-bis，并新增步骤）**：

1. `use_capability` 的 description **动态生成**——从 `ToolCategoryCatalog` 与 `ProxiedCategories` 的**交集**取类名列表（零反射、零硬编码，AOT 友好），而非手写举例。
2. 该清单**按档位过滤**：只列**当前档位下实际可经 proxy 取到**的分类（如 `global:chat` 里 `browser` 可见故列出，子 Agent 档排除 `browser` 故不列）。
3. 提示词的 `<tool_calling>` 段与 `use_capability` 的 description **共用同一份来源**，避免两处漂移（与 `ToolCategoryCatalog` 已是"单点真源"的既有做法一致，见该类注释 `:18-21`）。
4. **`action="list"` 的返回必须与上述清单一致**（老大 2026-09-11 追加裁定）——即 `list` 走**同一套收窄判定**，不是"description 按档、list 全量"的两套口径。**这是三载体同源同裁的强制要求**，也是 `BuildCapabilitySummaries` 补 `IsToolAllowed` 的直接理由（缺陷细节见上一小节"关键推论二"）。
5. **档位过滤的实现须单点**：description 生成与 `list` 过滤**读同一个函数**（如按 `(runContext, sessionMode, channelSession)` 返回"本档可经 proxy 取到的 category 集合"），避免 description 与 list 各写一份判断而漂移——**这比 R-3.8b 原写的"两处共用来源"更严格：不只是共用 category 来源，而是共用整条可见性判定**。

**核心集名单（✅ 老大 2026-09-11 拍定：「核心集按照你的推进来」）**：

**采纳建议方案**——核心集 = `ToolCategoryCatalog` 里 **priority ≤ 70 的 7 类**：

| category | priority | 含工具 | 是否核心 |
|---|---|---|---|
| `file` | 10 | Read / Write / Edit / LS | ✅ |
| `search` | 20 | Glob / Grep | ✅ |
| `shell` | 30 | Bash | ✅ |
| `task` | 40 | Task* + 子 Agent 委派 | ✅ |
| `memory` | 50 | memory 五件 | ✅ |
| `plan` | 60 | plan 系列 | ✅ |
| `capability` | 70 | `use_capability` **入口本身** | ✅ |
| ≥ 80 的其余 20 类 | 80-270 | codegraph / project / web / browser / ssh / skill / plugin / notebook / ask-user / widget / image-generate / desktop / team / global-task / global-dispatch-reply / goal / cron / channel-plugin 等 | ❌ 按需经 `use_capability` |

**「是否按档位变化」的答复**：按档位变化——核心集是**各档自己的"少而必要"**，不是全局同一份。至少两套：
- **项目档**（chat/cowork）：上表 7 类。
- **全局档**（`global:chat`，PM 助手）：**换成 PM 那套**——`project`（`list_projects`/`get_project_details`）、`global-task`、`task`、`memory`、`capability`、`ask-user`/`widget`（与用户沟通），并保留横切所有档位的 `shell` 核心工具。读文件类仍在全局可见集内，只是不占提示词核心位，需要时经 `use_capability` 取。

⚠️ **B 口径下的落地方式**：本次**只建机制**（`IsCore` 字段 + `PromptBuilder` 按档输出结构），**名单先取"等价现状"**使提示词内容零变化；**上表的收窄留下一步**（R-3.13 记账）。

> **最终追加裁定（Shell）**：`Bash` 通过工具自身的普通声明设置为 `IsCore=true`、`VisibleScopes=ToolVisibilityScopes.Everywhere`；不在 preset、准入策略或执行路由里增加名字特判。`IsCore` 的统一消费仍归 R-3.7 / S-1，当前只完成核心性声明；可见性已由统一准入轴覆盖全部运行上下文。

#### R-3.D 判定规则（唯一入口）
**已裁定：默认可见**（老大 2026-09-11：「新工具对协作模式来说需要全开，默认没处理的需要默认可见」）。

```
IsVisible(tool, ctx):
    1. tool.VisibleScopes 为空 → 默认可见（直接进黑名单检查）
    2. 渲染 ctx 成具体串 ctxStr（如 "project:cowork@subagent"）—— 只在一处生成，不散落
    3. 逐条比对 VisibleScopes 的 pattern（scope/mode/role 三段，`*` 匹配任意；
       pattern 不带 @role 时默认只匹配 role=sessionagent）
    4. 有声明且无一条命中 → 不可见
    5. 命中排除集合 → 不可见
    优先级：黑 > 白 > 默认可见
```

**「默认可见」的六处必做收窄**（B 口径下：收窄 1–5 属"零变化"，收窄 6 属**行为变更，本次只声明不启用**）：

| # | 风险 | 处理 | 本次（B） |
|---|---|---|---|
| 1 | 渠道三工具（`visualize_show_widget`/`AskUserQuestion`/`ExitPlanMode`）"默认可见"会进渠道会话，与 `PromptBuilder.cs:326-327` 对模型的**承诺**矛盾 | **黑名单显式排除** | ✅ 做（零变化） |
| 2 | MCP/Extension 不在 registry（`AgentRuntimeUseCapabilityDiscovery.cs:144-153`），现靠 `IsAvailableInMode` 返回 false 的副作用被拒 | 该副作用**不能再依赖**；显式让它们**不进核心集**（与 R-3.C-bis 三层结构天然一致） | ✅ 做（零变化） |
| 3 | `unknown` 档（无宿主）会命中默认可见 | 其**核心位默认 false**（`unknown@automation` 的三类排除属 R-3.7，留下一步） | ✅ 做（零变化） |
| 4 | 子 Agent（`*@subagent` / `*@goalsubagent`）默认可见会拿到浏览器类 | **黑名单显式排除 `browser` 类**（见 R-3.C"子 Agent 两分法"） | ✅ 做（零变化） |
| 5 | 后台定时任务（`unknown@automation`）默认可见会拿到浏览器/渠道/交互组件 | **黑名单排除** category `browser` + 渠道专用工具 + `AskUserQuestion`/`ExitPlanMode`/`visualize_show_widget` | ⏸ 声明写出，**启用留下一步** |
| 6 | `global:chat@subagent` 会因"非 chat 全放行"拿到**全量**工具，与"继承全局限制"矛盾 | 声明侧显式收到 `GlobalChatTools` 同款集合（**收窄**，非黑名单） | ⏸ **行为变更，留下一步** |

**合并后的"交互组件三工具"排除面**：`AskUserQuestion`/`ExitPlanMode`/`visualize_show_widget` 同时被 **收窄 1（渠道）** 与 **收窄 5（后台定时）** 排除——即这三个工具在**任何"无人可答"的档位**都不可见。落地时宜**一次性把该集合定义为「需人类在场的交互工具」**，两处共用一份名单，不写两遍。

#### R-3.E 现状勘查要点（决定工作量的五条）

**① 目标形态在现实现里不存在**：全仓无复合范围串、无"未知范围"。会话上下文是 `AgentRunContext(Scope, CollaborationMode, RuntimeRole)` 三段枚举（`AgentRunContextPolicy.cs:9-12`）。故这是**新建一种表达**，不是搬字符串。

**② 现在的"强制过滤"只覆盖两类会话**：`IsToolAllowed:199-222` 两个 early-return——`IndependentRuntimeRoles`（automation/pet/providerturn/translation）全放行 + 非 chat 全放行；`FilterToolDefinitions:224-248` 又重复一遍。**真正被拦的只有 `*:chat` 与 `global:channel`**，cowork/goal/automation 一条都不拦。

> **与 R-3.C"子 Agent 两分法"的关系**：老大已定"项目下协作/后台执行的子 Agent 除浏览器外基本都能用"——这与现状第二类 early-return（非 chat 全放行）**方向一致**，故机制化后此档**行为不变**，唯一新增约束是**排除浏览器类**（R-3.D 收窄 4，新增黑名单，不改默认方向）。而"全局会话的子 Agent 继承全局限制"是**新的收束**——现状 `global:chat@subagent` 会因"非 chat 全放行"拿到全量工具，机制化后应收到 `GlobalChatTools` 同款集合。**这是本次唯一一处新增的行为收窄，须在步骤中单列验证**（R-3.6）。

**③ 硬编码名单 10 张 + 两套矛盾分类学**：A 类准入表 10 张（`AgentRunContextPolicy.cs` 五张名单 + `IndependentRuntimeRoles` + `ToolPreset` 七 preset + `ProxiedCategories` 14 类/`ProxiedBuiltinTools` 3 名 + `AgentLoop.cs:179,190`）；B 类路由谓词 30 个；C 类审批文案 6 处；D 类提示词 2 处；E 类渲染端展示 5 处。`ProxiedCategories`（`AgentRuntimeUseCapabilityExecutor.cs:32-38`）与 `ToolPreset.AllowedCategories`（`ToolPreset.cs`）**仅 5 类重叠**；`task`/`project` 同时在两边；`goal` 类 10 个工具但 proxy 只点名 3 个。

**④ 默认开放会同时打开两条投递路径**：`mcp__*`/`extension__*` 不在 registry；`use_capability:call`（`AgentRuntimeUseCapabilityExecutor.cs:290,302,346`）**本就绕过 `ToolCallProcessor`**——统一判定必须挂在**这条路径也经过的地方**，否则收窄层形同虚设。

**⑤ 必改的回归测试 3 组**：`ChannelToolVisibilityRegressionTests/Program.cs:20-53,68-83,174`（复刻 5 份工具名清单）；`GoalRegressionTests/Program.Lifecycle.cs:245-315`（断言 proxy 只暴露 3 个 goal 工具）；`ToolConcurrencyRegressionTests/Program.cs:41-49,92-99`（**靠 `runtimeRole:"automation"` 绕开准入**——若显式化 early-return，该组必一起改）。

**落点可行性**（零反射，符合 AOT）：`ToolTypes.cs:8-14` 的 `ToolDefinition` record（新增 `VisibleScopes` + `IsCore`）+ `IToolExecutor.cs:33` 旁 + `ToolDefinitionPlaceholder.cs:12-25` + `ToolRegistry.Register:44`。**分层边界**：声明字段与 `ToolPreset` 同属 **Core**；消费与强制层（`AgentRunContextPolicy`、`AgentRuntimeUseCapabilityExecutor`）在 Agent——不得把声明字段加进 Agent 层。

#### R-3.F 全局会话能力边界（老大已定性：PM 助手，不做工作）

**实读结论：全局会话改文档的能力早就是关的**——`GlobalChatTools` 名单里 `Write`/`Edit`/`MultiEdit`/`NotebookEdit`/`Bash`/`Shell` **全部不在**。挡它的不是 preset（`ToolPreset["chat"]` 的 category **含 `file`**，而 `file` 类含 `Read`/`Write`/`Edit`/`LS`），而是名单只挑了 `Read`/`LS`。

**老大 2026-09-11 补充（修正前一稿建议）**：全局会话**保留只读工具是应该的**，不是残留。

- 依据（老大原话）：「全局会话基本都是提供了只读工具的，它发送任务然后让项目下会话写到指定位置，**它自己读取文档确认情况**」。
- 关键机制约束：「**现在项目下会话是没法回复到全局对话的**，项目下会话是没有这种权限的」——老大据此的推论是：全局派活后拿不到自动回报，只能**自己去读落盘结果**来"管控进度"。**读文件类工具因此是全局 PM 职责的必需品，不能收。**
- **前一稿"建议收掉读文件类"作废**（该建议基于"PM 不该碰文件"的直觉，与老大的实际工作模式不符）。

**✅ 澄清：回执链路不是"落差"，而是"重量级专用通道"（老大 2026-09-11）**

老大原话：

> 「reply_global_dispatch 这个是针对全局任务的。常规小任务不能走这条线。全局任务在我看来是比较重的东西。目前任务有两种 1.类似goal的任务 这个是持续追踪推进的，有reply_global_dispatch支持 2.临时任务todo的 全局会话给项目下会话发送任务 并且自己创建一个倒计时比如几分钟后去读取文档」

**这条把上一稿的"落差"结论推翻了**——我原先以为"项目会话回不了全局"是不一致，实际是**两条设计上分离的通道**，代码里分得很干净：

| | **① 全局任务（重）** | **② 临时任务 Todo（轻）** |
|---|---|---|
| 定位 | 类似 goal，**持续追踪推进** | 一次性委派，**倒计时后自动回读** |
| 派发工具 | `send_work_request`（`GlobalTaskToolsProvider.cs:96-114`，`availableModes: ["global"]`） | `send_session_message`（`ProjectToolsProvider.cs:57-86`，四模式全开） |
| 载体 | `global_tasks` + `global_task_dispatches` 两张表 | **源会话的一条 Todo** + follow-up 记录 |
| 回报方式 | **`reply_global_dispatch`**（`ProjectToolsProvider` 之外的独立 provider；明写 "Complex tracked work must use global tasks and send_work_request instead"） | **不用回执**——到期后全局**自己去读**（`followUp.queryInstruction` 说明"该检查什么"） |
| 到期机制 | 无（靠对方显式回报） | `followUp.delayMs`（最小 1000ms）+ `update_session_follow_up` 三动作（complete/reschedule/fail，`ProjectToolsProvider.cs:88-102`） |
| 全局侧出口 | `list_global_dispatches` + `update_dispatch` | `update_session_follow_up` |

**关键推论（推翻上一稿）**：

1. **"项目下会话没法回复到全局对话"= 对 ② 而言是设计如此，不是缺陷**。② 的语义就是"不问回报、到期自读"——这**正好解释了老大为何强调全局要保留读文件类工具**（R-3.F 上半节）：**② 的进度确认完全依赖全局自己去读**。两条互相印证。
2. **① 的 `reply_global_dispatch` 属于 `global:channel` 之外的另一条专用线，不该被当"常规能力"看待**。上一稿将它列为"项目会话的常规工具"，是**误读**——它的 schema 说明（`GlobalDispatchReplyToolProvider.cs:19-24`）明写 "Do not use it for ordinary user messages"。
3. **R-3.D 的"子 Agent 排除浏览器/交互工具"等收窄，与这两条通道无关**——那是**工具可见性**层，本表是**任务机制**层。两者不得混谈。
4. 故此前的 **R-3.12「记账全局回执链路待核查」应当关闭**——不是"通道存在但未验证"，而是"**通道按设计服务于 ① 类任务，且与 ② 类分离**"。若老大要的是"② 也能回执"，那才是新需求（**当前不做**）。

**由此确认的全局会话 PM 职责全貌**（与 R-3.F 上半节合并阅读）：

```
全局 PM 助手
  ├─ 重任务 → 建 global task → send_work_request 派发 → reply_global_dispatch 收回报
  │                                                        └─ list_global_dispatches + update_dispatch 跟进
  └─ 轻任务 → 源会话建 Todo → send_session_message(带 followUp.delayMs) 派发
                             → 倒计时到期自己读文档确认 → update_session_follow_up 收尾
```

**两条通道都需要的能力**：`Read`/`Glob`/`Grep`（读文档确认）+ `list_projects`/`get_project_details`（找会话）+ Task 四件（自建 Todo）。**这恰好就是全局既定工具集，无需增删。**

**全局保留的全部只读/非写工具（实读，与 PM 职责逐条对齐）**：

| 工具 | 归因 | 处置 |
|---|---|---|
| `Read` / `Glob` / `Grep` / `LS` / `codegraph_explore` | **读文档确认进度**（R-3.F 依据） | **保留**（前稿"建议收"作废） |
| 6 个浏览器工具 | 查外部资料（只读外部） | **保留** |
| `SubAgentDetail` / `SubAgentStatus` | "管控进度" | **保留** |
| `AskUserQuestion` / `visualize_show_widget` | 与用户沟通整理需求 | 保留 |
| memory 五件 | 全局 PM 的长期上下文 | 保留 |
| global task 四件 + `create_global_task`/`create_session`/`list_global_dispatches`/`list_global_tasks`/`send_session_message`/`send_work_request`/`update_dispatch`/`update_global_task` | **给项目下派活 + 管控进度** | 保留 |
| `list_projects`/`get_project_details`/`list_goals`/`get_goal`/`get_goal_history`/`list_installed_skills` | 全局视角信息 | 保留 |
| `WebFetch`/`WebSearch` | 查资料 | 保留 |
| `ChannelSendImage`/`ChannelSendFile` | 渠道输出 | 保留 |
| `use_capability` | 插件/MCP 统一入口 | 保留 |
| Task 四件 | 全局自己的任务编排 | 保留 |
| `Write`/`Edit`/`MultiEdit`/`NotebookEdit`/`Bash`/`Shell` | 会改动环境 | **本来就没有，继续保持没有** |

**结论：全局会话的工具集合本次不动**（原"待定性"关闭）——既定的只读集合恰好等于 PM 职责所需。

#### R-3.G 步骤清单

- [x] R-3.0：出 Plan（本节，完成）＋ **全部裁定已闭合**。**已定 7 条**：① 语义模型（R-3.A）；② 串语法 `scope:mode@role`（R-3.B）；③ 定时任务拆两类（R-3.C 6a/6b）；④ 定时任务与子 Agent 同类；⑤ 默认可见（R-3.D）；⑥ 全局保留只读工具、工具集合不动（R-3.F）；⑦ **核心工具集原则**——系统提示词只列少而必要的核心工具，其余经 `use_capability` 按需（R-3.C-bis）。**本次范围 = B（两步走，老大 2026-09-11 拍定）**。　✅ 本次执行范围按此裁定；R-3.7／R-3.8c／R-3.9 的实际归属见 R-3.H 执行记录。
  - **B 的含义（决定提交边界）**：本次**只做机制**——新串完整表达现状（当前"全放行"的档位先声明成 `*:*`，**零行为变化**），把"可见集收窄"留到下一步需求独立提交。
  - **据此，本次执行 R-3.1～R-3.6、R-3.9、R-3.11～R-3.13**（机制 + 零变化收窄 + 测试 + 记账）；**R-3.7（定时任务两类落地）与 R-3.10（显式化 early-return）留到下一步需求**——两者都会改变可见集；**R-3.8（交互工具共用集合）本次照做**（它同时服务零变化的渠道收窄与将来）。
  - ⚠️ **核心工具集（R-3.C-bis）与 B 的关系**：机制层（`IsCore` 字段 + `PromptBuilder` 按档输出）**本次做**；**具体核心集名单的收窄留到下一步**，本次先用"等价现状"的名单让提示词行为不变。
- [x] R-3.1：在 `ToolDefinition`（`ToolTypes.cs:8-14`，Core 层）新增 `VisibleScopes` + `IsCore`，打通四处注册路径。验证：`dotnet build src/runtime/WishfulClaw.sln` 零错误；`VisibleScopes` 缺省值为 null（= 默认可见），`IsCore` 缺省值须显式定（建议 false + 例外名单，见 R-3.C-bis），不引入"未声明即拒绝"。　✅ `VisibleScopes`＋`IsCore` 已进 `ToolDefinition` 并打通四处注册路径（`IToolExecutor` 默认成员 → `ToolRegistry` ×2 → `ToolDefinitionPlaceholder` → `ToolTypes` record 末位带默认值，旧位置构造不破坏）。缺省 `VisibleScopes=null`＝默认可见、`IsCore=false`。`ToolDeclarationChecks` 覆盖缺省语义／占位透传／注册表透传／无分类工具四组。　**审查补口（2026-09-12）**：新增第五组 `RunDeclarationCensusSuite`——走**真实生产注册表**（`VisibilitySnapshotDump.BuildProductionRegistry`），逐条声明断言两件事：① 该声明串至少匹配一个被 `VisibilitySnapshot.ResolveScenarios()` 扫到的运行上下文（防拼错／档位改名后残留的"看起来权威、永不命中"的声明）；② 该工具确实经自身声明拿到过 `Declared` 准入（防被黑名单整体吞掉）。有效性已反证：把 `ToolVisibilityScopes.ChannelOnly` 改成 `*:chanell@*` 后测试立刻红，改回即绿。
- [x] R-3.2：实现唯一判定入口（R-3.D 算法）＋ `ctxStr` 单点渲染（`<scope>:<mode>[@<role>]`）。验证：对 R-3.C 的 **13 个**场景（含 6a/6b 拆分）各渲染一个串，与表一致；`unknown`/`unknown@automation` 两个串都能渲染。　✅ `ToolVisibilityPolicy` 为唯一判定入口，`RenderContext` 为 `ctxStr` 唯一渲染点；`ToolVisibilityChecks.RunContextStringSuite` 是 R-3.C 十三场景的可执行副本，逐串断言。
- [x] R-3.3：把准入决策从 A 类硬编码表迁到新声明，`AgentRunContextPolicy.cs` 保留为唯一强制层。验证：`IsToolAllowed:199-222` 与 `FilterToolDefinitions:224-248` 的重复判断收敛为一处；对每个 preset 出前后可见集差异表（B 口径下**差异必须为空**）。　✅ `ChannelOnlyTools`（22 个名字）已从强制层删除，改为注册期 `ToolVisibilityScopes.ChannelOnly` 声明；`IsToolAllowed` 收敛为「`Evaluate` → Blocked/Declared/DefaultVisible」三段，声明命中即准入、未声明才走会话档规则。**零变化已用机器证明——口径为 105 格中 97 格逐字节等价，余 8 格是 R-3.6 收窄 4 的裁定性排除**，见 R-3.H ①。　**【R-3.I 修正】**`Evaluate` 与 `VisibilityOutcome` 三段式已删除——"未声明才走会话档规则"这半句随档表一起消失，`IsToolAllowed` 现在只把注册表里的 `VisibleScopes`/`ExcludedScopes` 交给 `ToolVisibilityPolicy.IsVisible`，未声明即处处可见（老大裁定）。机器口径更新为 **69 格等价 / 36 格收窄 / 0 格放宽**，差异逐组有裁定出处，见 R-3.I。
- [x] R-3.4：**黑名单显式排除渠道三工具**（R-3.D 收窄 1，B 口径下属零变化）。验证：渠道会话下 `visualize_show_widget`/`AskUserQuestion`/`ExitPlanMode` 不可见，且与 `PromptBuilder.cs:326-327` 承诺一致。　✅ 三件在 `ToolVisibilityPolicy.ChannelExcludedTools` 单点定义，且黑名单优先级高于声明（`ToolVisibilityChecks` 用 `["*:*"]` 声明反证）。　**【R-3.I 修正】**`ChannelExcludedTools` 已随中心名单整体删除，三件改为自声明 `ToolVisibilityScopes.HumanAttended`（`*:chat@*` / `*:cowork@*`，天然不含 channel）。渠道档排除效果不变，但机制已从"中央黑名单"变成"工具自己声明不在无人值守档出现"，"黑名单优先级高于声明"这条断言现由 `IsVisible` 的「先 veto 后 grant」顺序保证。
- [x] R-3.5：**`use_capability` 三动作全部受管**（R-3.D 收窄 2 + 老大 2026-09-11 追加裁定）——`call` / `inspect` / **`list`** 三条路径**必须走同一套可见性判定**。现状实读：`call`（`AgentRuntimeUseCapabilityExecutor.cs:322-327`）与 `inspect`（`AgentRuntimeUseCapabilityEncoding.cs:115-133`）**已调 `IsToolAllowed`**，**唯 `list` 缺**（`AgentRuntimeUseCapabilityDiscovery.cs:148-153` 只调 `IsAvailableInMode`，而后者对未声明 `availableModes` 的工具直接返回 true）。MCP/Extension 显式处理——不进核心集，范围由注册来源兜。验证：① `list` 与 `call`/`inspect` 对**同一个工具**给出**一致**的可见性判定（构造 `project:cowork@subagent` + 浏览器工具这一组反例，三者须一致拒绝）；② `list` 的 `categories` 分组统计也基于收窄后集合；③ 两条投递路径行为一致，无静默放行。　✅ `list`/`inspect`/`call` 三动作现共用 `AgentRuntimeUseCapabilityDiscovery.IsProxyBuiltinVisible` 一个谓词（其内部即 `IsToolAllowed`），三载体同源同裁由构造保证而非约定。　⚠️ **"三载体"只算 proxy 侧的三个出口，不等于"所有出口一致"**：直连工具集是第四个出口，`FilterToolDefinitions` 的短路使它在 cowork／goal／automation 档绕过同一谓词（实测见 R-3.H ① 与 S-4）。本步验收①②③均按 proxy 侧口径达成。　**【R-3.I 修正】**该短路已删，**四个出口（直连集／description／`list`／`call`）现过同一条判定**，"三载体同源"升级为"四载体同源"。原口径记为历史，实测差异见 R-3.I 差异表组②。
- [x] R-3.6：**子 Agent 排除浏览器类**（R-3.D 收窄 4，B 口径下属零变化）。验证：① `project:cowork@subagent` 下 9 个浏览器工具全部不可见；② 同档下 `use_capability action="list"` **也查不到** `browser` 类（与 R-3.8d 合并验证，这是修复后的必然结果）；③ `global:chat@subagent` 的全局集合收束**本次只声明、不启用**（收窄 6 属行为变更，留下一步），故本步只验证浏览器排除；④ 宿主 `project:cowork` 自身浏览器工具不受影响、`list` 仍能查到。　⚠️ **落地面（2026-09-12 补格实测修正，勿照抄本步原口径）**：收窄 4 以显式黑名单落地——`category=="browser"` × `subagent`/`goalsubagent` 在 `IsGloballyExcluded` 拒绝。proxy 三载体（description／`list`／`call`）**全档位生效**，含 `project:cowork@subagent`；**直连工具集只有 chat 档子 Agent 生效**（`project:chat@subagent`、`global:chat@subagent` 各少 6 个 `Browser*`），`project:cowork@subagent`/`@goalsubagent` 的 9 个 `Browser*` 仍在直连集合里——`FilterToolDefinitions` 的 `BypassesChatAllowlist` 短路在逐工具判定之前就返回了，见 S-4。**本步因此不是 B 口径所说的"零变化"**，那 8 格的差异与处置见 R-3.H ①；宿主档（`project:cowork`／`project:chat`）浏览器工具不受影响。　**【R-3.I 修正】**`IsGloballyExcluded`／`BackgroundBrowserExcludedRoles` 已删除，收窄 4 现由 9 件浏览器工具自声明 `ExcludedScopes = ToolVisibilityScopes.SubAgentRoles` 落地。上面"**直连工具集只有 chat 档子 Agent 生效**"那句作废：短路移除后 `project:cowork@subagent`／`@goalsubagent` 的 9 个 `Browser*` 也从直连集合消失（R-3.I 差异表组②，8 格 × −9），四个出口对同一裁定一致生效。
- [✗] R-3.7：**核心工具集机制**（R-3.C-bis）——① `IsCore` 落地并接线到 `PromptBuilder`；② `BuildToolCapability()` 改为**接收会话上下文**、只输出本档可见的**核心**工具；③ proxied 类不再出现在提示词的直接列表。验证：① 提示词中 category 数从 **27** 降至核心集规模（目标 ≤ 8）；② 同一会话的提示词中**不含**任何 proxied 类；③ 全局会话的核心集与项目协作不同（如全局列 PM 工具）；④ `use_capability` 的 `action="list"` 仍能查到被移出提示词的工具——**且必须是与 description 一致的本档集合**（老大追加裁定：三载体同源同裁；验证时对 description 的分类清单、`list` 的返回、提示词的核心集做**三方比对**，不得出现任一漂移）。**B 口径下本次"名单等价现状"**：只改结构不改内容，行为零变化；名单收窄留下一步。　⛔ **本步整体转后继需求**（机制与名单在提示词侧不可切分，理由见 R-3.H ②）。`IsCore` 字段本次已按 R-3.1 落地，但 `PromptBuilder.BuildToolCapability()` 未接，故该字段当前**只声明、无消费方**。
- [x] R-3.8：**定义「需人类在场的交互工具」共用集合**（R-3.D 合并说明）——渠道档与后台定时档共用一份，含 `AskUserQuestion`/`ExitPlanMode`/`visualize_show_widget`。验证：两处引用同一来源，全仓该三件名单只出现一次定义。　✅ 共用集合＝`ChannelExcludedTools`，全仓该三件名单只此一处（已复搜 `visualize_show_widget`/`ExitPlanMode` 的 .cs 命中确认）；后台定时档的复用留下一步（R-3.H ③）。　**【R-3.I 修正】**"单点"的形态变了、也更纯：`ChannelExcludedTools` 已删，共用的不再是三件**名字**而是**一种声明形状** `ToolVisibilityScopes.HumanAttended`（`*:chat@*` + `*:cowork@*`，一条都不含 channel），三件各自在注册点带这个形状。**"全仓只出现一次"因此只对形状成立**，名字各出现一次（在自家 Provider 里），这是老大裁定"用工具自身的黑白名单"的应有结果。**后台定时档的复用本次仍未发生**，且原因比"留下一步"更具体：automation 归一后读作 cowork，`*:cowork@*` 照样命中，三件在 `*:cowork@automation` 档**依旧可见**（差异表组③ 该格只减 22 件渠道工具，不含这三件）。要真排除须按 role 收紧形状（如 `*:cowork@sessionagent`）或等 `unknown@automation` 在真实运行里出现，见 S-3。
- [x] R-3.8b：**`use_capability` 的 description 带上「支持哪些分类」**（R-3.C-bis 关键推论，老大强调）——① 从 `ToolCategoryCatalog` × `ProxiedCategories` 的**交集**动态生成类名清单（零硬编码）；② **按档位过滤**（与 `list` 共用同一条可见性判定）；③ 替换 `UseCapabilityToolProvider.cs:36-39` 现有的 "such as mcp, skill, project, desktop, or goal" 手写举例。验证：① 描述中出现全部 proxied 类名（如 `browser`，老大举的例子）；② 渠道/子 Agent 档下被排除的类**不出现**；③ 与提示词 `<tool_calling>` 段共用同一来源，无手工维护的第二份清单；④ **与 `action="list"` 的实际返回逐项一致**（本步与 R-3.5 是同一收窄的两个出口，须同批验证，防止 description 按档、list 全量的漂移）。　✅ 三处出口均已落地：类名清单由 `ToolCategoryCatalog` × `ProxiedCategories` 交集生成、按本档可见性过滤（`GetVisibleProxiedCategoryNames`），手写举例已删。　⚠️ **验收 ③ 只能部分成立，读的时候别越界**：description 与提示词 `<tool_calling>` 段**共用的是同一份 `ToolCategoryCatalog`**（所以确实不存在第二份手工名单），但**不是同一条过滤链**——`<tool_calling>` 仍由 `PromptBuilder.BuildToolCapability()` 输出静态全 27 类（R-3.7 ⛔ 未接线），description 则是 catalog × proxied ∩ 本档可见。两句"同一来源"要连读，真正把两个出口并成一条属 S-1。
- [x] R-3.8c：**修掉三处分类学矛盾**（R-3.C-bis 对照发现）——① `task` 归核心集，**从 `ProxiedCategories` 移除**；② `goal` 类**整体进 proxied**，`ProxiedBuiltinTools` 收敛；③ **`browser` 加进 `ProxiedCategories`，并从 `ToolPreset.cs:53,68,83` 三处 preset 白名单移除**（老大定性：浏览器属插件提供，与 MCP 同类，须经 `use_capability` 获取）。验证：① `ToolCategoryCatalog` 的 priority ≤ 70 集合与 `ProxiedCategories` 交集仅剩 `capability` 入口自身；② `goal` 类 10 个工具全部只经 proxy 可达；③ 三处 preset 白名单不再含 `browser`，且浏览器工具仍可经 `use_capability` 取到（**可见面不变**）。　✅ **三处已全部落地**：`ProxiedCategories` 现含 `goal`、`browser`，已移除 `task`。但**必须与 R-3.H ③ 连读**——③ 只落了"进 proxied"这一半，"出 `ToolPreset.cs:53,68,83` 三处白名单"那一半被快照拦下并已回滚，作为 S-7 单独立项。
- [x] R-3.8d：**在 proxy 的 `list` 上实现收窄**（R-3.D 收窄 4 的生效点，**本轮从"验证"升级为"实现"**）——`browser` 进 proxied 后，若只在直连工具列表过滤，子 Agent 仍能经 `use_capability` 取到浏览器。**实读已确认当前就是缺的**：`BuildCapabilitySummaries`（`AgentRuntimeUseCapabilityDiscovery.cs:148-153`）的过滤链只到 `IsAvailableInMode`，未调 `IsToolAllowed`，而 `IsAvailableInMode` 对未声明 `availableModes` 的工具直接放行。**修法**：在该过滤链补 `!AgentRunContextPolicy.IsToolAllowed(runContext, name, category, channelSession)`（`runContext`/`sessionMode`/`channelSession` 已在签名内，无需改调用链）；`EncodeBuiltinInspectResponse` 已正确，**两者共用同一判定**。验证：① `project:cowork@subagent` 下 `use_capability action="list"` **查不到** `browser` 类，而宿主档能查到；② `list` / `inspect` / `call` 对同一工具判定一致；③ `categories` 分组统计同步收窄。　✅ 与 R-3.5 同一改动的另一出口：`BuildCapabilitySummaries` 过滤链已调 `IsProxyBuiltinVisible`，`categories` 分组统计同源收窄。
- [✗] R-3.9：渠道工具开关接真作为收窄层，作用在统一判定之后（只减不增）。验证：C# 侧有真实读取点；关闭某工具后 `use_capability` 与系统提示核心集两条通路都被收窄。　⛔ 转后继需求，并与 R-2 的渠道文件改动同批做（两节共用四个文件，不得并行）。见 R-3.H ③。
- [✗] R-3.10：改造必改回归测试 3 组（R-3.E ⑤ 的三个文件）。验证：三组全过；测试内不再复刻工具名清单。**新增第 4 组**：提示词核心集快照测试（断言 category 数与不含 proxied 类）。　⛔ 随 R-3.7 一并转后继需求（提示词核心集快照测试无对象可断言）。R-3.E ⑤ 三组本身的改造随收窄工作同批。　**【R-3.I 修正：本步三项中两项已落地，口径按实测更新】**① **"显式化 early-return"那半已随追加裁定完成**——`BypassesChatAllowlist` 与 `IndependentRuntimeRoles` 双双删除，判定对 105 格每一格都执行，S-4 就此关闭；② 三组测试的真实状态：`ToolConcurrencyRegressionTests` **已核实不再依赖 role 豁免**（其 `DelayedToolExecutor` 不声明任何可见性，automation 归一为 cowork 后靠"未声明＝默认可见"通过，与改前经 `runtimeRole:"automation"` 全放行是不同通路、同一结果）；`GoalRegressionTests` 已改为按注册表动态推导 goal 条目；**唯 `ChannelToolVisibilityRegressionTests` 仍在复刻 5 份工具名清单**（`:22/:27/:33/:44/:52`），"测试内不再复刻名单"这半句对该文件不成立，与提示词核心集快照测试同留后继。
- [x] R-3.11：清理 `AgentRunContextPolicy.cs:62` 等硬编码清单（含 `DesktopScreenshot`/`BrowserScreenshot`，与 R-4 交界）。验证：A 类硬编码表命中数下降至只剩声明入口。　**【按 R-3.I 追加裁定重做，本步结论以本节为准】**原口径"降到只剩三张会话档白名单 + 三处单点集合"**已被推翻**——老大要求判定层**一个工具名名单都不留**。现在的实测状态：`AgentRunContextPolicy.cs` 与 `ToolVisibilityPolicy.cs` 内**零个工具名集合**，`SharedChatTools`／`ProjectChatTools`／`GlobalChatTools`／`ChannelOnlyTools`／`ChannelExcludedTools`／`BackgroundBrowserExcludedRoles`／`IsGloballyExcluded`／`ChatTools()`／`IsAllowedByChatAllowlist`／`BypassesChatAllowlist` 全部不存在，准入判定只剩 `ToolVisibilityPolicy.IsVisible` 一处，读的是工具自身声明。　**仍在的只有两类东西，都不是名字表**：① `ToolVisibilityScopes` 里的**形状常量**（`Everywhere`／`WorkRunsOnly`／`ChannelOnly`／`HumanAttended`／`SubAgentRoles` 等 pattern 数组，跨工具复用以免同一种档写 20 遍）；② `ToolPreset.cs` 的 **preset 白名单**（category 级，R-3.8c/S-7 的对象，本次未动）。　**复搜为证**：对准入路径六个文件（两个策略文件 + `ToolCallProcessor` + `AgentRuntimeUseCapabilityDiscovery` + `AgentRuntimeUseCapabilityExecutor` + `ToolVisibilityScopes`）跑 `grep -n "HashSet<string>"`，**只剩 2 处、都不是工具名表**：① `AgentRuntimeUseCapabilityDiscovery.cs:137` 的 `visibleCategories`——`GetVisibleProxiedCategoryNames` 遍历注册表**算出来的局部累加器**（出参是分类名集合，供 description 与 `list` 共用）；② `AgentRuntimeUseCapabilityExecutor.cs:32` 的 `ProxiedCategories`——**分类粒度**的 proxy 规则本体。原先第三处 `ProxiedBuiltinTools`（3 个 goal 名字）已确认永不可能命中并删除（见 R-3.I 表第七行）。两个策略文件命中数为 **0**；判据与命令见 verification_report。"MCP/skill 动态注册工具没有注册点可声明、只能按名兜"这条原理由**已由老大裁定作废**——未声明即默认可见，见 R-3.I。
- [x] R-3.12：**记账"两条任务通道的分离事实"**（R-3.F 澄清表）——① 全局任务（重，`send_work_request` + `reply_global_dispatch`）与 ② 临时任务 Todo（轻，`send_session_message` + 倒计时自读）是两套独立机制，**本次不动**，写入需求/进度文档备查。（原「回执链路待核查」已由该澄清关闭。）　✅ 记入 R-3.H ④。
- [x] R-3.13：**记账"下一步需求"的待办**——明写 R-3.7（定时任务两类落地）、R-3.10（显式化 early-return）、R-3.6②（`global:chat@subagent` 收束）、R-3.7③（核心集名单收窄）四项均属**行为变更**，B 口径下本次不做，须在 `raw-requirements.md` 与进度文档中立为后继需求，**不得丢失**。　✅ 记入 R-3.H ②③，并已同步 `raw-requirements.md`。

> **B 口径下的"零变化"自检**：把上面所有本次要做的步骤跑完后，**任一档位的可见工具集合与提示词内容都应逐字节等价于改动前**。若出现任何差异，说明该处本质是行为变更，应移入后继需求。
>
> **自检结果（2026-09-12 补格重测，见 R-3.H ①）**：105 格中 97 格等价，**8 格不等价**——chat 档两个子 Agent 档位各少 6 个 `Browser*`。这 8 格不是机制泄漏，而是收窄 4 的目标效果首次被量到（此前该两档根本不在快照内）。**处置**：不回退（回退即重新放开裁定点掉的泄漏），改为在收尾时向老大单列裁定；`use_capability` description 按档动态生成同理见 R-3.H ⑤。
>
> **⚠️ 上面的"零变化自检"已被老大追加裁定作废，最终口径以 R-3.I 为准。** 老大的原话是「零行为变化是 agent 规划的时候的步骤，并不是必须」，随后要求把判定层所有中心 `HashSet<string>` 删除。删表后的机器实测：**105 格 = 69 格逐字节等价 / 36 格收窄 / 0 格放宽**（97/8 是删表前的中间态，勿再引用）。36 格差异分成四组，**每组都指到一条具体裁定**，逐格机器版仍在 `visibility-snapshot.expected.txt`；差异表、放宽面（只有一处：未声明的动态 MCP/skill 工具）与遗留见 R-3.I。

#### R-3.H 执行记录（2026-09-12 凌晨，无人值守）

**① 零变化是怎么被证明的——不是目视，是快照门禁（2026-09-12 审查后补格重测）**

> **⚠️ 本节记录的是"删表前"那一轮的取证方法与前后可见集口径，其中的 97/8 数字已被追加裁定（R-3.I）取代。** 快照门禁这套方法本身仍然成立、且是 R-3.I 那 36 格差异的取证工具，本节保留供读；**结论数字看 R-3.I**。

`ToolPreset.BuiltIn` × 7 个 preset × **15 个档位** = **105 格**「档位 → 可见工具名有序列表」，序列化成一份 32 346 字符的摘要，落库为 `tests/WishfulClaw.ProviderHeaderRegressionTests/visibility-snapshot.expected.txt`，由 `Program.Main` 每次跑测试时经 `VisibilitySnapshot.AssertMatchesGolden` 复核。取基线的方式是**开一个 worktree 检出 R-3 动手前的提交**（`f9940a56`，即 `6a6ceff2` 的父提交；只额外放入摘要工具本身），两边各出一份摘要再 diff——不是"改完看一眼觉得没变"。

- **⚠️ 本节的第一版口径是错的，必须连读这段**：原先 13 个场景里有三个标签名不副实——`project:chat`、`project:chat@subagent`、`project:chat@providerturn/translation` 的场景 JSON **没带 `collaborationMode`**，而 `AgentRunContextPolicy.Resolve` 对项目档缺省归一为 `cowork`（`:113-116`）。于是"项目 chat 档"这一整条 `ProjectChatTools` 分支**从未进入快照**，标签写着 chat、跑的是 cowork 的活。审查发现后已把每个场景的 `collaborationMode` 补齐（另留 `project:cowork-by-default` 一格专门钉住缺省归一），并补上 `project:chat@subagent`、`global:chat@subagent` 两档。**教训：档位标签必须等于解析结果**，否则覆盖面是自说自话。
- 补格后重测：**105 格中 97 格逐字节等价**；确有差异的 8 格 = preset `full`/`chat`/`coding`/`channel` × `project:chat@subagent` 与 `global:chat@subagent`，每格少 6 个 `Browser*`（该档 16 件 → 10 件）。
- **这 8 格不是漏网，是收窄 4 第一次真正被量到**：老大裁定"子 Agent 一律不得用浏览器"，而基线上 chat 档子 Agent 的 `Browser*` 由 `SharedChatTools` 兜着照旧可见。改动前后唯一差异来源就是 `ToolVisibilityPolicy.IsGloballyExcluded` 的 `browser × subagent/goalsubagent` 谓词。**它在 B 口径（只做机制）之外，属实际行为变更，保留或回退由老大在迭代收尾裁定**——本次不回退的理由是回退等于把裁定点掉的泄漏重新放开。
- 补格同时也修正了 R-3.6① 的口径：直连侧浏览器排除**只在 chat 档子 Agent 生效**，`project:cowork@subagent`/`@goalsubagent` 的 9 个 `Browser*` 依旧在集合里（被 `BypassesChatAllowlist` 短路绕过判定），见 S-4。
- 过程中出现过一次真实破口：`ToolPreset.cs` 里把 `browser` 从 `chat`/`coding` 白名单摘掉（R-3.8c③ 的内容）会让若干格少 6 个工具。隔离实验确认该 hunk 是唯一差异来源后**已把它整体回滚**，`ToolPreset.cs` 现与 HEAD 一致。无人值守时不赌"这个收窄大概没人依赖"——能力静默消失属于必须单独立项的行为变更。
- 摘要不覆盖 `use_capability` 的 `list` 输出（它不在 registry 定义集合里）。该出口的收敛由 `ToolDeclarationChecks.RunCapabilityCatalogSuite` 单独断言（description／`list` 分类目录／子 Agent 档三组）。

**② R-3.7 为什么整体推走，而不是"只做机制"**

计划原话是"`IsCore` 字段 + `PromptBuilder` 按档输出本次做，名单收窄留下一步，用等价现状的名单让提示词行为不变"。落到代码上这两半分不开：`BuildToolCapability()` 现在输出的是 `ToolCategoryCatalog.All` 全 27 类，"按档输出核心集"必然改变 `<tool_calling>` 段的字节内容；要让字节不变，只能给它加一个**永远传全量**的参数，并让 `IsCore` 停在无人读取的状态。那是假接线，还会在勾上 R-3.7 后留下一个看不出缺口的绿勾。**裁定：R-3.7 连同提示词核心集快照测试（R-3.10）整体转后继需求**，与核心集名单同批做——它们本来就必须同时落地才有意义。`IsCore` 字段仍按 R-3.1 落进声明链，状态明确记为"已声明、暂无消费方"。

**③ 转后继需求的行为变更清单（R-3.13 的账，不得丢失）**

| # | 待办 | 为什么会变行为 | 前置 |
|---|---|---|---|
| 1 | `browser` 出 `ToolPreset.cs:53,68,83` 三处 preset 白名单（R-3.8c③ 的**另一半**） | 91 格快照中 chat/coding 档各少 6 个直接工具，属能力面变更 | 前置已满足：`browser` 本次已进 `ProxiedCategories`，摘掉白名单后仍可经 `use_capability` 取到 |
| 2 | ~~`task` 出 `ProxiedCategories`、`goal` 整体进 proxied~~ **——本次已随 R-3.8c①② 落地**；后继只剩"是否连 `ProxiedBuiltinTools` 三件名字一起收敛" | 已发生的差异：`list` 与 description 的 `goal` 类条目变多（见 R-3.H ⑤） | — |
| 3 | 定时任务 6b 后台档落地 `unknown@automation` ＋ 三类收窄（R-3.D 收窄 3、R-3.C 6b） | **2026-09-12 追加裁定后只剩"档位"这一半**：`IndependentRuntimeRoles` 已删，automation 不再全放行而是归一读作 cowork，该档实测少了 22 件渠道专用工具；~~浏览器与交互三件仍可见~~ → **浏览器已随 R-3.J 整体否决、交互六件已随 R-3.K + R-3.M 整体否决，三类收窄全部落地** | 只剩前端 `cron-runtime.ts:476-495` 需真的发 `scope:"unknown"`（当前由 `runEvent.scope` 推断）——这条 R-3.J **刻意没顺手改**，理由见 S-3 |
| 4 | `global:chat@subagent` 继承全局限制（R-3.6② / 收窄 6） | 全局 PM 的子 Agent 将拿不到写/执行类工具 | **前提已变**：`GlobalChatTools` 随中心表删除，该档现状完全由逐工具声明决定，删表前后该档**逐字节未变**——本项从此是"要不要再收一刀"的**产品裁定**，不是机制遗留 |
| 5 | ~~`FilterToolDefinitions` 的 `BypassesChatAllowlist` 短路显式化（R-3.10）~~ **已随 R-3.I 落地、本项关闭** | 该短路正是"cowork／goal／automation 看得到渠道专用工具"的现存泄漏点（`preset=full` + `project:cowork` 实测含 `ChannelSendImage` 等 22 件）——**这是改动前就有的 Bug，本次刻意不碰** | ✅ 短路已删，判定对每一格都执行；22 件渠道工具从 cowork／automation 各档消失（差异表组①③），泄漏点关闭 |
| 6 | 渠道工具开关接真（R-3.9） | 死配置一旦生效，历史上下转过开关的用户会立刻少工具 | 与 R-2 同批改 `channel-types.ts`／`channel-config-store.ts` 等共用文件 |
| 7 | 提示词核心集机制与名单（R-3.7 / R-3.10） | `<tool_calling>` 段内容变化＝提示词变化 | 见本节 ② |

**⑤ 快照没盖住的那一面：`use_capability` 的 description 与 `list` 确实变了**

91 格快照量的是**直连工具集**（`registry.GetToolDefinitions(preset, mode)` → `FilterToolDefinitions`），`use_capability` 只有一个工具名进那张表，它内部列了什么快照看不见。本项改动会动到的正是这个看不见的出口，故单列如下，不让"逐字节等价"这句话越界：

- **description 改为按档动态生成**（R-3.8b，老大点名本次做）：原先是 `UseCapabilityToolProvider.cs` 里写死的 "such as mcp, skill, project, desktop, or goal" 举例，现由 `ToolCategoryCatalog` × `ProxiedCategories` × 本档可见性算出，`AgentLoop` 在过滤完成后经 `ApplyCapabilityDescription` 重写。**提示词的这一段因此与改动前不同**，这是 R-3.8b 验收标准①「描述中出现全部 proxied 类名（如 `browser`）」的必然结果，不是漏网。
- **`browser` 进 proxied**：`list` 与 description 多出 `browser` 类。直连侧浏览器工具**一个没少**（白名单改动已回滚），所以这是**多一条发现路径**，不是新增能力，也不是收窄。
- **`goal` 整体进 proxied**：`list` 从 3 件（`list_goals`/`get_goal_history`/`reopen_goal`）增到该档 `goal` 类全部（`GoalToolProvider` 注册 10 件，按 `availableModes` 过滤）。`call` 侧一直有 `IsToolAllowed` 兜底，**放出去的都是本档本就允许的工具**，不存在越权。
- **`task` 出 proxied**：`TaskCreate`/`TaskGet`/`TaskList`/`TaskUpdate` 四件本就同时是直连工具且在两档 chat 白名单内，proxy 里的重复入口删掉不会让任何一档失去任务编排能力（`GoalRegressionTests` 与 `ToolDeclarationChecks` 实测四件仍在直连集）。

覆盖它们的测试：`ToolDeclarationChecks.RunCapabilityCatalogSuite`（分类目录＝catalog×proxied 交集、按档过滤、子 Agent 档不含 browser）、`GoalRegressionTests`（goal 类 proxy 条目改为按注册表动态推导，不再复刻名字清单）。

**④ R-3.12 记账：两条任务通道是两套机制，本次不动**

- **全局任务（重）**：`create_global_task` → `send_work_request` 派发 → 项目侧 `reply_global_dispatch` 收回报，`list_global_dispatches`/`update_dispatch` 跟进。落库全局任务表。
- **临时任务 Todo（轻）**：源会话 `TaskCreate` 建 Todo → `send_session_message(带 followUp.delayMs)` 派发 → 倒计时到期自己 `Read` 文档确认 → `update_session_follow_up` 收尾。不落全局任务表，随会话生命周期。
- 两者**不共用存储、不共用状态机、本次也不合并**。R-3 的可见性改造对两套都只要求"相关工具在 `global:chat` 档可见"，已满足（见 R-3.F 结论表：全局工具集合本次不动）。


⚠️ 本节与 R-2 共用 `channel-types.ts:56-76`、`channel-config-store.ts:42-58`、`src/main/ipc/channel-handlers/channel-plugin-handlers.ts:292-299,344-357`、`src/main/ipc/channel-handlers/channel-handler-utils.ts:251-263` 四个文件，**两项不得并行改**。

#### R-3.I 追加裁定：中心名单全部删除，判定只剩工具自身声明（2026-09-12，老大）

**裁定原话**：「`HashSet<string>` 我希望所有的这个都去掉，不然这次工具处理没有任何意义，现在工具本身是有黑名单和白名单的，应用起来」＋「黑名单和白名单，我们都有，都需要用起来」＋「部分工具 比如临时todo这种 以及文件查看查询这些 直接是允许 `*` 也就是所有工具都能用」。

这条裁定推翻了 R-3.3／R-3.11 落地的"声明＋会话档表"双轨制。**口径变化**：R-3 本意就是收窄与梳理，"零行为变化"是规划时的自设步骤而非硬约束（老大：「零行为变化是 agent 规划的时候的步骤，并不是必须」），因此本步允许出差异，但**每一格差异必须能被指到一条裁定**。

**删掉的七处**（前六处在 `AgentRunContextPolicy.cs` 与 `ToolVisibilityPolicy.cs`，第七处在 `AgentRuntimeUseCapabilityExecutor.cs`）：

| 被删 | 原作用 | 现在由谁替代 |
|---|---|---|
| `IndependentRuntimeRoles` | automation／pet／providerturn／translation 四角色**无条件全放行** | 无——四角色改按各自 scope+mode 判定，见下"差异表" |
| `SharedChatTools` / `ProjectChatTools` / `GlobalChatTools` | 三张 chat 档工具名白名单 | 逐工具 `VisibleScopes` 声明 |
| `ChatTools()` / `IsAllowedByChatAllowlist` | chat 档准入决策 | `ToolVisibilityPolicy.IsVisible` 一处 |
| `BypassesChatAllowlist` + `FilterToolDefinitions` 原样返回短路 | 非 chat 档整体绕过判定 | 无——判定对每一格都执行 |
| `ChannelExcludedTools`（交互三件黑名单） | 渠道档硬排除三件 | 六件交互面工具自声明**白+黑一对**：`VisibleScopes = HumanAttended`／`WorkRunsOnly`（都不含 channel）＋ `ExcludedScopes = NoHumanToAnswer`（含 `*:channel@*`）。**2026-09-12 由 R-3.K + R-3.M 定稿**；测试侧那张同名名单保留为守卫，由 3 件扩到 6 件 |
| `IsGloballyExcluded` / `BackgroundBrowserExcludedRoles` / `Evaluate` + `VisibilityOutcome` | 按 category×role 的浏览器排除与三段式判定 | 9 个浏览器工具自声明 `ExcludedScopes = SubAgentRoles`；判定收敛为「先 veto 后 grant」两条 |
| `ProxiedBuiltinTools`（3 个 goal 名字） | 点名哪几个内置工具可以经 `use_capability` 取 | **本次一并删除**：`goal` 已整类进 `ProxiedCategories`，`list_goals`／`get_goal_history`／`reopen_goal` 三件的 category 就是 `goal`，名字分支**永不可能再决定结果**（已复搜：该表仅 `IsProxiedBuiltinTool` 一处引用，其入参 category 来自 `registry.GetCategory`，调用点还前置了 `category is null` 短路）。谓词改名 `IsProxiedBuiltinCategory(category)`，S-8 的遗留同时关闭 |

**边界（本次没删的 `HashSet<string>`，以及为什么）**——裁定要收的是**准入/可见性判定**上的名字表，以下三族不在此列，均已立为后继：

| 仍在 | 位置 | 为何不算"准入名单" |
|---|---|---|
| `ProxiedCategories`（15 类） | `AgentRuntimeUseCapabilityExecutor.cs:32` | **分类粒度**而非工具名，且它本身就是"哪些类只经 proxy 可达"这条规则的唯一表达（R-3.8c/S-7 的对象）。删它等于取消 proxy 机制 |
| `*ToolNames` 分派表 **12 张**（`Browser`／`ChannelPlugin`／`Cron`／`Desktop`／`GlobalTask`／`Plan`／`Plugin`／`Project`／`SkillManagement`／`Ssh`／`SshInfo`／`Task`） | 各 `AgentRuntime*Executor.cs`（已逐文件 `grep "private static readonly HashSet<string>"` 清点） | **路由**用：把 `use_capability` 解出来的名字交给哪个 executor 的 switch，不参与"能不能看见"。R-3.E ③ 归为 B 类。同批文件另有 5 张 `Allowed*` 集合是**入参取值校验**（按钮名/修饰键/回复状态），也不是工具名单 |
| `SubAgentApprovalTools`／`ShellApprovalTools`／`DefaultModeApprovalTools` | `ToolCallProcessor.Approval.cs:19,35,45` | **审批轴**，与可见性正交（可见但要批准）。要迁成声明须新增"审批作用档"字段并连带改审批文案，属新立需求 → 登记为 **S-11** |

**现在的机制**：`ToolPreset.BuiltIn`（preset 白名单）→ `availableModes`（按 sessionMode）→ 工具自身 `VisibleScopes`/`ExcludedScopes`（按 `scope:mode@role`）。**三层之外再无名单**，`AgentRunContextPolicy` 只剩"把请求解析成上下文"与"把注册表里的声明交给判定"两件事。

**103 个生产工具全部落到 8 种声明形态**：`Everywhere`(`*`) 22、`WorkRunsOnly`(`*:cowork@*`) 41、`GlobalSideAndWorkRuns`(`global:*@*` + `*:cowork@*`) 12、`ChannelOnly`(`*:channel@*`) 22、`HumanAttended`(`*:chat@*` + `*:cowork@*`) 2、`SubAgentRoles` 否决 9（`ExcludedScopes`）、内联两形态 4，其余为组合。**普查已升级为硬约束**：`ToolDeclarationChecks.RunDeclarationCensusSuite` 现在断言**每个生产工具都必须声明**（未声明＝在所有档可见＝直接红），同时逐条检查声明串至少命中一格（防"看起来权威、永不命中"的死串）以及每个声明工具至少在一格被自身声明放行。

**机器证明分两层**：

1. **逐工具×7 个生产格准入位不变**：`--derive-admission` 在删表前（`admission-vectors.txt`）与删表后（`admission-post-collapse.txt`）**103 行 × 7 位逐字节相同**。这一层成立的原因是 R-3.3 已把判定改成"声明命中即定、未声明才走档表"，而那 103 件工具**当时已全部带声明**——档表实际只兜动态注册的 MCP/skill 工具。
2. **105 格快照 diff**：`7 preset × 15 档`，**69 格逐字节等价，36 格收窄，0 格放宽**。

**36 格差异按成因分组**（机器版在 `visibility-snapshot.expected.txt`，`-N` 为该格减少的工具数）：

| 组 | 格 | 差异 | 裁定出处 |
|---|---|---|---|
| ① 在场档（**唯一影响人手点开的会话**） | 4 格 = `full`/`channel` × `project:cowork`(含 `-by-default`) | 各 −22：22 个渠道专用工具 | **S-4 关闭**：原短路绕过判定，无渠道上下文时这些工具发了也没有落点（`ChannelOnly` 声明的既有语义，此前对 cowork 档不生效） |
| ② 子 Agent 浏览器 | 8 格 = `full`/`chat`/`coding`/`channel` × `project:cowork@subagent`/`@goalsubagent` | 各 −9：全部 `Browser*` | 收窄 4（老大 2026-09-11"子 Agent 一律不得用浏览器"）——R-3.H ① 记的 8 格是 chat 档子 Agent，本组是当时被短路绕过的 cowork 档另一半 |
| ③ automation 档 | 6 格 = `full`/`channel` × `*:cowork@automation`/`@goalrunner` | 各 −22：22 个渠道专用工具 | 老大 2026-09-12：「定时任务走的也是 cowork」。**`goalrunner` 未减渠道工具之外的任何能力**；后台 cron 的渠道投递走 `PLUGIN_EXEC` IPC（`cron-runtime.ts:256-288`），不经工具，功能不断 |
| ④ 四个无人值守角色 | 18 格 = 6 preset（`minimal` 三格收敛前后本就无差）× `global:chat@pet` / `project:chat@providerturn` / `project:chat@translation` | 每格 −2 ～ −58，收掉的全是写/执行/编排/渠道类（`Edit`/`Write`/`Bash`/`Task`/`Desktop*`/`Cron*`/`Team*`/`memory_hot_write` 等） | 老大 2026-09-12：「**翻译和宠物应该跟 chat 一样**」。这三档现在**逐格等于同 preset 的 chat 档集合**——`IndependentRuntimeRoles` 全放行的历史豁免结束 |

**本次明确接受的一处放宽**：未声明的工具（运行期注册的 MCP／skill）从"走 chat 档名单"变为"处处可见"。老大裁定「未声明保持默认可见」。这是默认语义，不是名单：**新增内置工具不再允许不声明**，普查会直接拦下（见上）。

**未做与遗留**：
- **S-3 只落了一半**——`automation` 现在读作 cowork，但**后台 cron 请求的 scope 仍是 `project`/`global`**（`cron-runtime.ts:485`），`unknown@automation` 那一格在真实运行里还不存在。要把 R-3.D 收窄 5 真正接上，需要前端发 `scope:"unknown"`，仍是后继需求。
- **无人值守三档的 UI 面未目视验证**（宠物气泡、翻译结果、providerTurn 单轮），本环境无法给 Electron 界面截图取证。差异是按 preset×档位算出来的，"宠物是否真的需要某个被收掉的工具"须老大实测判定。
- 登记新发现 **S-10**：`send_session_message`／`update_session_follow_up` 对 `project:chat` 档不可见（`0111011` / `0001011`），**删表前后一致、非本次引入**，但判定现在对每一格都跑，这一格从此变成硬拦截——R-3.12 记的"轻通道"若源会话是 chat 档，收尾步会拿不到工具。
- **【2026-09-12 独立复审更正，上表组④ 的理由有一处与代码事实不符】**组④ 原写"收掉的全是写/执行/编排/渠道类"，并据此在 `verification_report.md` §5 的目视配方里写"翻译只需要读+回文本"。**翻译链路不是这样**：`translate-agent-service.ts` 的系统提示词四处明写要求模型调 `Write()`/`Edit()` 写翻译缓冲区（`:124`/`:149`/`:178`/`:193`），而 `Write`/`Edit` 现声明 `WorkRunsOnly`，在 `global:chat@translation` 下不可见——改前靠 `IndependentRuntimeRoles` 全放行才通。**这 18 格里翻译那几格的"收窄"因此不是无害的**，只是当前不炸：`setAgentMode` 全仓零调用，agent 模式翻译进不去（宠物同理，无线程入口）。已立 **S-14**，接真时须给 `Write`/`Edit` 补形状或把 translation 归到 cowork。
- **【同日新增 S-12】**另查明两条"判定之外"的取工具出口：IPC `tool/list`（`ToolModule.cs:80` 只按 preset）与 `provider/complete`（`ProviderCompletionService.cs:221` 直写 provider body）。**当前均无害**——前者的产物被渲染端塞进 `agent/run` 的 `tools` 字段，而 Worker 根本不读该字段（`AgentRuntimeTools.cs` 零引用，`AgentLoop.cs:168` 从注册表重建）。但这是"第二套工具真源 + 一段死载荷"，已立 S-12。
- **【同日新增 S-13】**`automation` 档仍看得见交互三件（金样实测含 `AskUserQuestion`/`ExitPlanMode`/`visualize_show_widget`），成因是 `Resolve()` 把 `automation` 归一成 `cowork` 而 `HumanAttended` 含 `*:cowork@*`。**原写"改声明值解决不了，须收到 role 粒度"——该结论只对"只用白名单"成立，对黑名单不成立**（老大当日纠正并裁定走 `ExcludedScopes`）。**已由 R-3.K + R-3.M 关闭**，`raw-requirements.md` S-13 已标记关闭。
- **口径收紧**：本批统一的是**准入判定轴**。最终工具清单仍由四层决定——`ToolPreset` → `availableModes` → 声明 → 两个按名字的功能开关（`AgentLoop.cs:179` `WebSearch`/`WebFetch`、`:190` `codegraph_` 前缀）。对外不得表述为"工具可见性已收敛为单一机制"。
- **裁定的字面范围只到"准入判定"这一轴**：路由分派的 12 张 `*ToolNames` 与审批的 3 张 `HashSet<string>`（`ToolCallProcessor.Approval.cs:19,35,45`）**本次未动**，理由见上"边界"表。**不得对外说成"全仓 HashSet 已清零"**——审批若要落到工具自身声明，须新增"审批作用档"字段并连带改审批文案，已立 **S-11**。

#### R-3.J 追加裁定：浏览器退出核心直连集，只经 proxy 可达（2026-09-12，老大）

**裁定原话**：「浏览器工具不属于核心工具，只需要在代理里面能查到使用就行」＋「浏览器工具属于插件里面来的，这些工具都是在代理里面就行。麻烦的一点就是我不希望不可见进程去调用比如子agent去调用」。对"否决要收到哪些档"的追问，老大答：「部分定时任务也就是自动化是最终去会话里面去执行的，这个就可以调用，但是后台执行的不行，子会话不行」。

这条裁定同时关闭了 **S-7**（`browser` 出三处 preset 白名单），并给 S-3 的"浏览器那一半"换了实现路径。**判据由此明确**：能不能用浏览器，不看是不是自动触发，看**有没有一个人在看着的会话宿主**——嵌入式定时任务在它宿主会话里跑，可以；后台 sidecar 与子 Agent 没有宿主窗口，不行。

**动了三层中的两层**（`availableModes` 那一层未动）：

| 层 | 改动 | 生效面 |
|---|---|---|
| **preset 层**（`ToolPreset.cs`） | `chat`／`coding`／`channel` 三档的 `AllowedCategories` 摘掉 `"browser"`；`full` 档新增 `DeniedCategories = {"browser"}` | **只作用于直连注入**。`full` 是七档里唯一没有白名单的（`AllowedCategories == null` ⇒ 全类别放行），所以它必须**点名拒绝**而不是"不写"——这一处是 S-7 原记的"摘三处 ≠ 只经 proxy"的剩余一半 |
| **声明层**（`ToolVisibilityScopes.cs`） | `SubAgentRoles` 更名加宽为 **`UnattendedRoles`** = `["*:*@subagent", "*:*@goalsubagent", "*:*@automation"]`，9 件 `Browser*` 的 `ExcludedScopes` 全部改指它 | **只作用于准入判定**，即四个载体（直连集／description／`list`／`call`）共用谓词 |
| `automation` 档语义 | 旧注释写的"包括 automation，它是被交代过的那个会话"当场作废，改为按"有没有人看着窗口"重新表述 | — |

**为什么必须两层一起动**：`IsProxyBuiltinVisible` 从一开始就不读 preset（`AgentRuntimeUseCapabilityDiscovery.cs:106-121` 只有注册表＋`availableModes`＋准入谓词三项），所以**只摘 preset 的话，浏览器在每一格都还能经 `use_capability` 叫出来**，直连侧少 9 件、代理侧一点没变——老大要的"不可见进程不能调用"完全落在代理侧，而代理侧唯一的机制就是工具自身声明。反过来，**只加否决也做不到"只经 proxy"**：否决是黑白名单那一半，它管不到直连注入的类别白名单。两层各管一半，合起来才是这条裁定说的形态。

**为什么加 `*:*@automation` 不会误伤嵌入式定时任务**（改前先核过）：`runtimeRole=="automation"` 只有 cron 的**后台 sidecar 路径**会发（`cron-runtime.ts:487`）；`runMode === 'session'` 的定时任务在宿主会话内跑，发的是 `runtimeRole: 'sessionAgent'`／`usageSource: 'automationSession'`（`cron-runtime.ts:451,402-415`），因此**照旧能用浏览器**——正是老大那句话的两个半边。后台那条路径要往渠道投递是走 `PLUGIN_EXEC` IPC，不经浏览器工具，功能不断。

**105 格快照 diff（`visibility-snapshot.expected.txt` 重生，112 行 / 25,250 字节，原 30,294）**：**61 格逐字节等价 / 44 格收窄 / 0 格放宽**。44 格 = `full`／`chat`／`coding`／`channel` 四档 × 每档 11 格（`automation`／`minimal`／`skill-installer` 三档本就未列 `browser`，15 格全等价）。每格 **−6 或 −9**，减掉的工具名集合**恰为** 9 件 `Browser*`，四档内无第四件被牵连：
- **−9** 的 5 格＝`project:cowork`／`project:cowork-by-default`／`project:cowork@goalrunner`／`project:cowork@automation`／`global:cowork@automation`；
- **−6** 的 6 格＝`global:chat`／`global:chat@pet`／`project:chat`／`project:chat@providerturn`／`project:chat@translation`／`global:channel`——`BrowserClick`／`BrowserType`／`BrowserEvaluate` 三件本就带 `WorkRunsOnly`（`*:cowork@*`），在**非 cowork 形态**的格（chat 形态与 channel 形态）原先也不可见，故这 6 格各少减那 3 件。

一格一格看，**本批没有任何一格减了非浏览器工具，也没有任何一格增了工具**。

**机器证明（新增 `BrowserSurfaceAccessChecks.cs`，接进 `Program.cs`，排在金样比对之前）**，三段：
1. 9 件 `Browser*` 确实注册在 `browser` 类下（防止"摘干净"只是因为名字没对上）；
2. **直连侧全域零注入**：7 个 preset × 15 档＝105 格逐格 `FilterToolDefinitions(GetToolDefinitions(preset, mode))`，断言**一个浏览器工具都不出现**（断言前核实格数确为 105）；
3. **代理侧按档归零**：三个无人值守后缀（`@subagent`／`@goalsubagent`／`@automation`）的格经 `IsProxyBuiltinVisible` 计数为 0；有人格为 `cowork` 形态 9 件、其余 6 件，且**任何有人格都必含 `BrowserNavigate` 与 `BrowserGetContent`**（"能查到并使用"这半句的正证）。

**回归同步**：`ToolVisibilityChecks.RunVetoBeatsGrantSuite` 改指 `UnattendedRoles` 并新增一条断言（"后台定时同样被否决——它改的是没人看着的页面"），原"只有否决时默认可见仍成立"的用例从 `automation` 移到 `goalrunner`（该角色现在也不再默认可见，留着会假失败）；`ToolDeclarationChecks.cs:168` 引用改名。9 套 C# 回归 + 11 套 TS + 三配置 tsc + Release/Debug 双构建 0 警告 + AOT 零告警 + `dev:full` 实启动全跑在本批改动之后（数字见 `verification_report.md` §1）。

**未做与遗留**：
- **后台定时没有独立档位**：`automation` 现在仍读作 `project:cowork@automation`／`global:cowork@automation`，与"人手动开的 cowork 会话"同格，本批靠 role 后缀把它区分开。**S-3 的剩余缺口不变**：`cron-runtime.ts:485` 发的 scope 仍是 `project`/`global`，`unknown@automation` 那一格在真实运行里还不存在。本次**刻意不改前端发 `scope:"unknown"`**——那会让该格所有 `*:cowork@*` 声明不再命中、整格形状重排，且与老大「定时任务走的也是 cowork」的裁定冲突，仍属 S-3。
- ~~**交互三件在 `automation` 档仍可见**（`AskUserQuestion`／`visualize_show_widget`／`ExitPlanMode`）：老大这条只裁了浏览器，未裁交互件（同 S-2 ② 的悬置）。~~ → **已关闭（R-3.K + R-3.M）**：六件交互面工具（交互两件 + 计划族四件）在**全部** `@automation` 格不可见，金样残留实测 0。
- **真实浏览器表面的目视未做**：本环境无屏幕捕获通路，"proxy 里叫得出 `BrowserNavigate` 并且真能跳页"这条只有单测级证据（同一谓词、同一注册表），未跑真机点一次。

#### R-3.K 追加裁定：交互三件改走黑名单（2026-09-12，老大）

**裁定原话**：「这一条可以通过黑名单，去处理么，黑名单的优先级高于白名单，`@automation` 以及 channel 都把用户需要交互的组件纳入黑名单」。

**这条推翻了 R-3.I 遗留里的一个结论，先把话收回来**：独立复审当时写"要表达『后台不行、会话内定时任务行』，**必须**落到 role 粒度（如 `*:cowork@sessionagent`），改声明值解决不了"。**该结论对"只用白名单"成立，对"黑名单"不成立**——`ExcludedScopes` 是声明的一部分，veto 在 `ToolVisibilityPolicy.IsVisible` 里排在 grant 与默认可见之前（`:96-106`），所以**不动任何白名单形状**、只给工具加一个排除字段即可。9 件 `Browser*` 用 `UnattendedRoles` 处理同一个"同 mode 不同 role"问题，正是这个套路的既有先例。

**改动（4 个文件，判定代码一行未动）**：

| 层 | 改动 |
|---|---|
| 声明常量 | `ToolVisibilityScopes` 新增 `NoHumanToAnswer = ["*:*@automation", "*:channel@*"]`，附 doc 说明"为什么必须是 veto 而不是更窄的 grant" |
| 注册点 ×3 | `AskUserToolProvider`（`AskUserQuestion`）、`WidgetToolProvider`（`visualize_show_widget`）、`PlanToolProvider`（`ExitPlanMode`）各加 `excludedScopes: ToolVisibilityScopes.NoHumanToAnswer` |

**`*:*@automation` 这一条同时覆盖两种串**：`project:cowork@automation`／`global:cowork@automation`（automation 归一读作 cowork 后的实际串）与保留值 `unknown@automation`（`RenderContext` 对 unknown 丢 mode 段，解析后仍是 scope `*`/mode `*`/role `automation` 命中）。**所以 S-3 剩下的"前端要发 `scope:"unknown"`"那条缺口不影响本批生效**。

**金样实测：105 格 = 97 格逐字节等价 / 8 格收窄 / 0 格放宽。** 8 格全部是 `@automation`（4 个 preset × 2 档）：

| preset | `global:cowork@automation` | `project:cowork@automation` |
|---|---|---|
| `full` | 57 → 55（−`AskUserQuestion`、`visualize_show_widget`） | 53 → 50（−`AskUserQuestion`、`ExitPlanMode`、`visualize_show_widget`） |
| `chat` | 27 → 26（−`AskUserQuestion`） | 28 → 26（−`AskUserQuestion`、`ExitPlanMode`） |
| `coding` | 27 → 26（−`AskUserQuestion`） | 28 → 26（−`AskUserQuestion`、`ExitPlanMode`） |
| `channel` | 21 → 20（−`AskUserQuestion`） | 18 → 17（−`AskUserQuestion`） |

`automation`／`minimal`／`skill-installer` 三档的 automation 格本就未含这三件，等价。**`global:channel` 全部 7 格逐字节等价**——即老大点名的 channel 那一半**其实早就被 `HumanAttended` 的形状挡住了**（`*:chat@*`／`*:cowork@*` 一条都不含 channel），加进黑名单属**冗余但显式**的兜底：它把"channel 里看不见"从"靠白名单恰好没写 channel"变成工具自己声明"绝不在 channel 出现"。保留它，因为显式声明比隐式推导更抗未来改动。

**为什么 `ExitPlanMode` 之前也在 automation 档可见**：它声明的**不是** `HumanAttended` 而是 `WorkRunsOnly`（`PlanToolProvider.cs:48`），`*:cowork@*` 直接命中 automation 归一后的 cowork。**R-3.8 的 R-3.I 修正里"三件各自在注册点带 `HumanAttended` 这个形状"与代码不符**（只有两件是），已就地更正；本批给它补 veto 后，三件在 automation 档行为一致。

**未做与遗留（前两条当日已裁定，均已在 R-3.M 落地）**：
- ~~⚠️ 本批引入了一处计划族内部的不对称，须裁定~~ → **已裁定：收全族**（老大 2026-09-12）。原状是 `project:cowork@automation` 档 `EnterPlanMode`／`SubmitPlanReview`／`UpdatePlanStep` 可见、唯独 `ExitPlanMode` 被否决，为本批新造。两种收法里老大选了**收全族**——无宿主的自动化进 plan 模式本就无意义（写完 plan 要等人 review，没人可 review）。落地见 R-3.M。
- ~~子 Agent 是否也该排除，仍未裁（S-2 ②）~~ → **已裁定：子 Agent 需要排除**（老大 2026-09-12：「子 agent 需要排除，因为子 agent 其实类似后台执行」）。落地见 R-3.M：`NoHumanToAnswer` 的角色轴改为直接取 `UnattendedRoles`，`@subagent`／`@goalsubagent` 一并纳入，**S-2 ② 关闭**。
- ~~**未加新测试**：这 8 格由金样逐字节钉住…（本批未做，见下方"验证状态"）~~ → **策略守卫已由 R-3.M 补上**：`ToolVisibilityChecks.RunSharedShapesSuite` 新增断言（六件交互面工具在 `@subagent`／`@goalsubagent`／`@automation` 与 channel 全不可见、在 `project:cowork` 可见，且 `UnattendedRoles ⊆ NoHumanToAnswer`），`ChannelToolVisibilityRegressionTests` 的 `ChannelExcludedTools` 由 3 件扩到 6 件。**补这条的理由**：金样是变更探测器、不是策略守卫——将来有人重生成金样会静默丢掉 veto，而声明级断言不会。**✅ 该断言已实际编译并运行通过（2026-09-12 晚，见下条）。**
- **✅ 本批已编译、已跑测试（2026-09-12 晚补测通过）**：原记「`dotnet build` 不可用」**结论作废** —— 根因是 bash 会话不继承 Windows 核心 env（`APPDATA` 为空 → NuGet 加载用户级 `NuGet.Config` 时 `Path.Combine(path1, null)`），**手动 export 一组变量后构建与测试均正常**。实测：`dotnet build src/runtime/WishfulClaw.sln`（15 项目）**0 警告 0 错误**；`ProviderHeaderRegressionTests` → `checks passed`（含 `VisibilitySnapshot.AssertMatchesGolden`）；`ChannelToolVisibilityRegressionTests` → `passed (108 assertions)`。**故脚本重算的金样已被机器断言确认自洽**，新增的策略守卫断言也已实际编译并运行通过。

#### R-3.L 口径确认：白名单两条途径 → 黑名单 → 最终可用集（2026-09-12，老大）

**老大原话**：「首先通过白名单获取到可用工具，两个途径，一个是系统提示词的获取核心工具 一个是代理获取工具，获取到工具后都需要经过黑名单过滤，返回实际的可用工具列表」。

**这条把目标形态定死为一条两段式流水线**：

```
白名单（VisibleScopes）──┬─ 途径① 系统提示词的核心工具
                        └─ 途径② 代理（use_capability）
                                   ↓  两条途径的产物都要过同一道黑名单
                        黑名单（ExcludedScopes）
                                   ↓
                          实际可用工具列表
```

**与现有实现的对照**（逐条实读，含缺口）：

| 段 | 落点 | 状态 |
|---|---|---|
| 白名单 · 途径① 直连工具集 | `AgentLoop.cs:168` `GetToolDefinitions(preset, mode)` → `:170` `FilterToolDefinitions` | ✅ 白+黑都过 |
| （既非白也非黑）提示词 `<tool_calling>` 段 | `PromptBuilder.cs:242 BuildToolCapability()` | ⚠️ **未接任何判定**：函数无参、遍历 `ToolCategoryCatalog.All` 出**全 27 个 category 名**。它**不产出可调用项**，是能力目录而非取工具途径；按 R-3.C-bis 应由 `use_capability` description 动态承载（= S-1）。详见下方口径 2 |
| 白名单 · 途径② 代理 | `IsProxyBuiltinVisible` → `IsToolAllowed`（description／`list`／`inspect`／`call` 四处共用） | ✅ 白+黑都过 |
| 黑名单 | `ToolVisibilityPolicy.IsVisible` 的 `MatchesAny(excludedScopes, ctxStr)` 先行否决（`:96-99`） | ✅ 单点 |

**三点须记账的口径**：

1. **判定顺序与老大描述的先后相反，但结果等价**。代码是"先黑后白"（veto 在 grant 之前），老大描述的是"先白后黑"。因为这是纯 AND，最终集合完全相同，**不需要改动**；写文档时不必把顺序当成偏差。
2. **"途径①"已确认为 (a) 直连工具集 → 本条口径零缺口**（老大 2026-09-12 裁定：「我刚说的是的是 A 直连工具集」）。原先"系统提示词"有 (a)/(b) 两种读法，现按裁定收敛：

   | 读法 | 指什么 | 实读 | 结论 |
   |---|---|---|---|
   | **(a) 直连工具集** ← 老大所指 | 发进 provider 请求 `tools` 参数的那份（模型能立刻直接调的） | `AgentLoop.cs:168` `GetToolDefinitions(preset, mode)` → `:170` `FilterToolDefinitions` | ✅ **白名单（preset + `availableModes` + `VisibleScopes`）与黑名单（`ExcludedScopes`）都过** → "两条途径都过黑名单"**成立，零缺口** |
   | (b) 提示词 `<tool_calling>` 段 | `PromptBuilder.cs:242` `BuildToolCapability()` 渲染进 system prompt 的那段文字 | 无参函数，遍历 `ToolCategoryCatalog.All` 输出**全 27 个类别名** | ⚠️ 不过任何判定，**但它不产出可调用项**——所以它**不是"取工具的途径"**，是 R-3.C-bis 定义的**能力目录** |

   **故 (b) 不计入本口径的缺口**，它归属 R-3.C-bis 的"目录搬家"（= **S-1**）：这份目录应由 `use_capability` 的 description **按档位动态**承载（只列本档实际可经 proxy 取到的分类），而不是由 `BuildToolCapability()` 静态列全 27 类。佐证：`IsCore` 字段（R-3.1）**已声明但零消费方**（全仓 7 处命中全是声明与赋值——`IToolExecutor.cs:56` 默认值、`ToolDefinitionPlaceholder.cs:20,37`、`ToolTypes.cs:33,50`、`ToolRegistry.cs:146,165` 传给 definition；**没有任何一处读它来做过滤或裁剪**）。S-1 保持原优先级排队，不在本迭代收尾前插队。
3. **白名单段对 MCP／skill 是直通**。它们运行期注册、无注册点可声明，`VisibleScopes` 为空即"默认可见"（老大既有裁定），此时**黑名单是唯一过滤**。对 103 件内置工具不适用——普查已把"未声明"变成硬错误，所以内置工具一律先过白名单。

**R-3.K 与 R-3.M 都是这条流水线的实例**：白名单给 `HumanAttended`／`WorkRunsOnly` → 黑名单减 `NoHumanToAnswer`（展开后 `*:*@subagent`／`*:*@goalsubagent`／`*:*@automation`／`*:channel@*`）→ 得到"桌面会话里可用、无人可答的档位里不可用"的最终集。**两条途径都走 `IsToolAllowed`，所以黑名单对途径①直连与途径②代理同时生效**，无需各写一遍。

#### R-3.M 追加裁定：无人可答的档位一律否决交互面（2026-09-12，老大）

**裁定原话**：「计划模型应该全部都进而不是单独 ExitPlanMode 进 这个全是应该收全族，子 agent 需要排除，因为子 agent 其实类似后台执行」。

**两条改动，判定代码仍是一行未动**：

| 层 | 改动 |
|---|---|
| 声明常量 | `NoHumanToAnswer` 的角色轴**改为直接取 `UnattendedRoles`**：`[.. UnattendedRoles, "*:channel@*"]`（原为字面量 `["*:*@automation", "*:channel@*"]`）。展开后 = `*:*@subagent`／`*:*@goalsubagent`／`*:*@automation`／`*:channel@*`。**这样写的理由**：两个集合回答的是同一个问题——"有人在场吗"——把角色轴单点化之后，将来新增无人角色不会只进其中一个而**静默漏掉另一个** |
| 注册点 ×3 | `PlanToolProvider` 的 `EnterPlanMode`／`SubmitPlanReview`／`UpdatePlanStep` 各补 `excludedScopes: ToolVisibilityScopes.NoHumanToAnswer`（`ExitPlanMode` 已在 R-3.K 带上）→ **计划族四件行为一致** |

**金样实测：本轮再收窄 19 格、0 放宽**（累计 R-3.K 8 格 + 本轮 19 格 = **27 格**；其中 `project:cowork@automation` 三格两轮各减 3 件，合并记 6 件）：

| preset | `global:chat@subagent` | `project:chat@subagent` | `project:cowork@subagent` | `project:cowork@goalsubagent` | `project:cowork@automation` |
|---|---|---|---|---|---|
| `full` | 21→19 | 18→16 | 30→28 | 30→28 | 53→47（两轮合计 −6） |
| `chat` | 16→15 | 13→12 | 22→21 | 22→21 | 28→23（两轮合计 −5） |
| `coding` | 16→15 | 13→12 | 22→21 | 22→21 | 28→23（两轮合计 −5） |
| `channel` | 14→13 | 11→10 | 16→15 | 16→15 | 18→17（R-3.K 已收，本轮无变化） |

减项：`@subagent`／`@goalsubagent` 四格各减 `AskUserQuestion`（`full` 档因含 `widget` 类再减 `visualize_show_widget`）；`project:cowork@automation` 减 `EnterPlanMode`／`SubmitPlanReview`／`UpdatePlanStep`。

**全库残留检查（脚本实测）**：三类无人档位（`@subagent`／`@goalsubagent`／`@automation`）与六件交互面工具（计划四件 + 交互两件）取交集，**命中 0**——7 preset × 15 档全部干净。金样文件 112 行 / **24,557 B**（R-3.K 后为 25,039 B，R-3.K 前基线 25,250 B）。

**一处重要实读发现：计划族对子 Agent 的排除在当前档位组合下是"防御性"的。** 四件都声明 `availableModes: ["normal"]`，而子 Agent 档的 `AvailableMode` 是 `subagent`（`ResolveAvailableMode` 把 `sessionMode` 原样小写返回，`AgentRunContextPolicy.cs:97-98`），`normal` ∉ 该集 → **它们在子 Agent 档本就不进 preset 可见集**。所以本轮 16 格 subagent 变更里**一件计划工具都没被减掉**（脚本实测：减项全是 `AskUserQuestion`／`visualize_show_widget`）。这条 veto 的价值在于**不依赖 `availableModes` 这个间接闸门**：若将来子 Agent 被允许跑 normal 模式，交互面仍不会跟着漏出去。

**未做与遗留**：
- **S-2 ② 关闭**：子 Agent 可否直接问人 —— 已裁定"不可"（等同后台执行）。
- **未加新测试**（同 R-3.K 的口径）：19 格由金样逐字节钉住，但金样是变更探测器、不是策略守卫。若要守卫，仍建议在 `ToolVisibilityChecks` 加一条声明级断言："六件交互面工具在 `*@subagent`／`*@goalsubagent`／`*@automation`／channel 均不可见，在 `project:cowork` 可见"。
- **✅ 本批已编译、已跑测试（2026-09-12 晚补测通过）**：见 R-3.K 末条的更正。金样虽为**脚本重算**，但已被 `ProviderHeaderRegressionTests` 的 `AssertMatchesGolden` 确认自洽；R-3.M 新增的策略守卫断言（六件交互面工具在无人档位与 channel 全不可见、`UnattendedRoles ⊆ NoHumanToAnswer`）已实际编译并随 `ChannelToolVisibilityRegressionTests`（108 断言）运行通过。

### 需求 R-4：正式版使用指引与 README 拆分

原始需求见 `raw-requirements.md` R-4 节：README 拆成用户指引 + 开发 README、功能全量罗列、截图（整桌面截软件本身）、关于页按钮与顶栏问号图标双入口指向 GitHub 指引。勘查见 `exploration_findings.md` 第 6 节。

- [x] R-4.0：出 Plan（本节）＋ 定《使用指引》在仓库中的存放路径与文件名。验证：README 拆分后的两份文件均有明确路径，且仓库根 README 指向用户指引。
  > **✅ 已完成（2026-09-12）**。定稿三份文件：根 `README.md`（用户向总入口 + 功能全量罗列）、`docs/user-guide.md`（《使用指引》手册，应用内两入口指向它）、`docs/development.md`（开发向 README，原根 README 的架构/构建/技术栈/参考来源整块搬迁并就地续写）。根 README 的下载、指引、开发三处链接互指正确；全仓无其它文件引用被移走的旧 README 锚点（`grep 'README\.md#'` 仅命中本次新写的指引内链）。
- [x] R-4.1：README 一分为二——根 `README.md` 面向用户（功能全量罗列），开发向 README 另起一份。验证：两份文件中不再混放对方内容；链接互指正确。
  > **✅ 已完成（2026-09-12）**。根 README 换成用户视角：快速上手三步 → 七组能力罗列（记忆/人格/工具/自主推进/自动化/效率/扩展/用量）→ 数据与隐私 → 系统要求 → FAQ → 二次开发入口 → License；7 层架构图、`npm` 命令表、AOT 编译口径、参考项目表全部移入 `docs/development.md`，用户向文本不再出现内部实现细节。按「产品文案写能力不写血统」的口径，根 README 只保留 License 所需的法定归属一句，血统说明留在开发说明。
  > 顺带修正搬移内容里的两处失真：`.NET 10` → `net11.0` 实为 **.NET 11**（含徽章）；安装包体积按实测写「约 130 MB / 装后约 360 MB」（`docs/build-guide.md` 与 `release/*.exe` 对账）。
- [x] R-4.2：URL 单点定义——GitHub 使用指引地址收敛为一处常量，关于页与顶栏两处引用。仓库地址 `https://github.com/wishful-73/wishful-claw`。验证：全仓该 URL 字面量只出现一次定义处。
  > **✅ 已完成（2026-09-12）**。新建 `src/renderer/src/lib/user-guide.ts`：`REPO_URL` + `USER_GUIDE_URL`（= `blob/main/docs/user-guide.md`，钉 `main` 不随分支漂，发布版读到的永远是随发布那份）+ `openUserGuide()`。全仓 `grep user-guide` 确认 URL 字面量仅此一处定义，顶栏与关于页两处均为 `import { openUserGuide }`。
- [x] R-4.3：顶栏问号图标——插入 `TitleBar.tsx:94-138` 现有图标组**左侧**（`hasProject` 块之前），沿用现有按钮类名与 `<Tooltip side="bottom">`。验证：`tsc` 三配置；`hasProject` 真/假两态下图标位置与拖拽区不冲突。
  > **✅ 已完成（2026-09-12，代码级）**。`HelpCircle` 按钮放在右侧组第一个（`hasProject` 块之前），类名与相邻按钮逐字一致（含 `titlebar-no-drag`，故不吞拖拽区），tooltip 键 `layout:topbar.userGuide`（zh/en 已补）。`hasProject` 为假时该组只剩它一个按钮，位置仍在最左，无重叠。
  > ⚠️ **验证口径说明**：三套 `tsc` 全绿 + `TitleBar` 仅由 `MainLayout` 渲染已核；**未做真机点击**——同仓库另一会话此刻正在 `dev/v2-iter-28` 上改 R-2，再起一个 `dev:full` 会撞 Electron 单实例锁与 `~/.wishful-claw-dev/`，反而打断对方的验证。留待老大或对方会话空闲时一并目视。
- [x] R-4.4：关于页新增按钮——落点 `SettingsPage.tsx` 的 `AboutPanel()`，样板沿用现有 `SettingsSection id="sec-about-updates"`。验证：`tsc` 三配置；点击后走 `setWindowOpenHandler` → `shell.openExternal`，不在应用内打开。
  > **✅ 已完成（2026-09-12）**。新增 `SettingsSection id="sec-about-guide"`（排在「应用更新」之上）+ `outline` 按钮（`ExternalLink` 图标），`onClick={openUserGuide}` → `window.api.invoke('shell:openExternal', USER_GUIDE_URL)` → `misc-handlers.ts:116` 的协议白名单（`http/https/mailto`）→ `shell.openExternal`，**不经应用内 webview**。关于页菜单文案 `tabs.about.desc` 同步改为「产品介绍、使用指引与应用更新」（zh/en）。i18n 四键 `about.guide.{label,desc,hint,open}` 双语补齐。
- [ ] R-4.5：配图产出——用现成 `DesktopScreenshot`（`AgentRuntimeDesktopExecutor.cs:26,81-104`）截软件自身界面。**硬前置：清场 + 脱敏**，不得含凭据、完整用户路径或真实用户数据。图片落盘走 `image:persist-generated`（`misc-handlers.ts:268-277`，落点固定 `~/wishful-claw/image/`），再手动移入仓库文档目录。验证：逐张目视确认无敏感信息；文件名与文档引用一一对应。
  > **⏸ 未做，需老大裁定（无人值守下主动停在门前）**。三条理由：① 整桌面截图会把**当前桌面**别的窗口一并拍进去，而本仓库是**公开** GitHub 仓库，配图一旦 push 即对外发布，属不可逆的外部可见动作；② 清场（关掉含凭据/真实项目的窗口）只有本人能做；③ 截图落点固定在 `~/wishful-claw/image/` 且不能指定目录，仍需人工移入仓库。**已把落点与清单写进 `docs/user-guide.md` 文末「配图待补清单」**（10 处，含建议文件名规范 `docs/images/usage-panel.png`），文档目前**不放占位图片链接**，因此不会出现裂图；截完按表逐条插入即可。
- [x] R-4.6：功能罗列粒度定稿（依赖 R-4.0）。验证：对照 `ABOUT_FEATURE_KEYS` 7 项与设置页各面板，无遗漏主能力。
  > **✅ 已完成（2026-09-12）**。粒度定为**「用户能点到的面板」一层**（不逐工具、不逐开关）。基线核对：`ABOUT_FEATURE_KEYS` 7 项（Agent 编程 / 多模型 / 长期记忆 / 人格定制 / 能力扩展 / 渠道集成 / 效率工具）在 README 与指引中逐项有落点；设置页 15 个页签（通用/快捷键/人格管理/SSH/AI 服务商/运行与性能/记忆/用量统计/渠道/插件/自定义扩展/Skills/MCP/关于/日志）全部有归属段落。
  > **写作时按实读剔除了四类"代码里有但用户进不去"的能力，避免指引承诺不存在的东西**：① 桌面宠物（`stores/pet-*`、`lib/pet/*` 无组件与窗口引用）；② Git 面板（`GitPage.tsx`/`ScmSidebar.tsx` 未被渲染，侧边栏 Git 项落占位页）；③ 绘图与翻译（`MainLayout.tsx:87-88` 明确 `PlaceholderPage iterLabel="后续"`，但侧边栏「扩展」与消息操作条里有入口——文案里不提，防误读）；④ `SettingsTab` 联合类型里的 `permission` 与 `tabs.websearch` 文案（`menuGroups` 无该项、无渲染分支，权限实际入口是输入区盾牌）。
  > 顺带把 R-1 的对外口径写进 §2（辅助模型 + 补位模型 + 三级解析），把本次 #1 的用量统计写进 §14，把迭代 27 的长对话能力（排队消息 / 上下文压缩）写进 §4。

⚠️ 本项截图能力与 iter-27 的 `evidence/*.png` 未产出缺口是同一块肌肉，`docs/progress/v2-iter-27.md:29` 记账不得因本项而划完成。

**审查补口（2026-09-12，并入收尾那次 `fix(迭代28)`）**：全量审查在 R-4 的三份文档里查出四处失真，均已按实测改掉——

1. **搬移丢块**：R-4.1 把旧 README 的「💻 Tech Stack」表和「📦 数据持久化」小节**整块搬丢了**（既没留在根 README，也没进 `docs/development.md`）。两处已补回：技术选型表按 `package.json`/`csproj` 实测重写（含 `@msgpack/msgpack`、Tailwind 4、Monaco、`Microsoft.Data.Sqlite`），数据持久化按实测的 **22 张业务表 + `memory_fts`** 与 Markdown/JSON 三类载体重写并指向已有的 `docs/data-storage.md`，不重复细节。
   > 表数取证口径（写文档时踩到歧义，记此防复犯）：`DbClient.cs` 里 `CREATE TABLE` 去重后 **23** 张（含 `memory_fts` 虚拟表）；dev 库 `index.db` 物理 **28** 项（22 业务表 + `memory_fts` 及其 4 张影子表 + `sqlite_sequence`）；启动日志那句 `43 tables created/verified` 数的其实是 `tableSqls.Length`＝**43 条 DDL（23 建表 + 20 建索引）**，标签名不副实，验证态已把日志文案改为 `DDL statements applied (tables + indexes)`。
2. **徽章过期**：根 README 与 `docs/development.md` 的 `Electron-35` 徽章与实际不符——`8c6d8f93` 起依赖就是 `electron ^43.2.0`（已安装版本同为 43.2.0），两处改 43。`AGENTS.md` 与 `docs/project-plan.md` 里也写着 Electron 35，**未动**（前者是你的常驻指令文件，留老大定）。
3. **指引第 10 节与代码不符**：原文写「绑定一个项目会话——渠道收到的消息会由该会话的 Agent 处理」，**代码里没有这个概念**——`ChannelInstance.projectId` 是死字段（创建时写 `null`，且有迁移主动清空历史值），路由实际按 `plugin:{pluginId}:chat:{chatId}` 自动开会话（`src/main/channels/auto-reply.ts:151-189` + `DbPluginSessionRouting.cs`）。整节按现状重写：入口布局（左列表／右详情／底部全局面板）、扫码绑定仅微信与飞书、以及三项全局设置各自的生效面。
4. **只记录设置的开关看着像生效**：「流式回复」全仓**无运行时读取点**（只有渠道 `/status` 打印一次），却和生效的开关并排显示、无任何提示。中文/英文文案与其 `defaultValue` 已补「当前仅记录设置，尚未接入强制执行」，与同面板「安全权限」页已有的 `notEnforcedHint` 口径对齐。**代码层的接线仍缺**，见 S-5 记账。

### 需求 R-5：更新悬浮块支持拖动 + 位置跨重启记住

登记日期：2026-09-12（执行期内追加）。**原始登记见 `raw-requirements.md` R-5 节**。

老大原话：

> 更新页之前是在更新弹窗正在更新的时候可以点击后台下载，隐藏更新弹窗后会有一个小的悬浮块，之前是调整了位置，我觉得位置还是不太合适，但是不打算调整了，想让悬浮块支持拖动可以么

两条当场裁定（2026-09-12）：

| 问题 | 裁定 |
|---|---|
| 归属与时点 | **立进 28 作为 R-5，当场做**（不排后继需求） |
| 拖过之后的位置要不要跨重启记住 | **记住** |

#### R-5.A 与 #2 的关系（先说清楚，避免重复记账）

#2 的「悬浮窗遮挡位置」是**替用户挑一个更好的默认角落**（`updater-ui-issues.md` 缺陷 2，已实施并提交 `c7287b6e`）。R-5 是**把选择权交给用户**：默认角落仍然保留，不满意时可以自己挪。两者不冲突——#2 的落点就是 R-5 的「未拖动前」状态，R-5 不改动那个落点。

#### R-5.B 三条口径

1. **未拖动 = 现行为逐字不变**。落点仍是 `left = 侧边栏开启 ? 宽度 + 16 : 16` ＋ `bottom-6`，侧边栏开合继续跟随。
2. **拖过之后，位置说了算**。一旦落位，自动跟随停掉——用户手摆的位置不该再被侧边栏开合推走。位置持久化进 `settings-store`（与 `leftSidebarWidth` 同一条 `persist` + `partialize` 白名单）。
3. **`null` ≠ 某个坐标**。持久化字段是 `UpdateBannerPosition | null`，`null` 表示"从未手动摆过"。这条区分本身就是口径 1／口径 2 的开关，不是缺省值偷懒。

#### R-5.C 四个必须处理的耦合点（动手前实读确认）

| # | 耦合点 | 处理 |
|---|---|---|
| 1 | `bannerLeft = leftSidebarOpen ? leftSidebarWidth + 16 : 16` 自动跟随 | 只在未落位时生效 |
| 2 | `UPDATE_BANNER_TOAST_BOTTOM = 90` 抬高 toast（来历：两者默认同在左下角） | 改为「仅未落位时抬高」= `shouldLiftToastsForBanner()`。抬高的存在理由就是那个共享角落，手摆的位置不再共享它 |
| 3 | 「详情」「重启安装」两个按钮 | pointerdown 命中 `button, a, input, select, textarea, [data-banner-no-drag]` 即不启动拖动，按钮点击行为逐字不变 |
| 4 | 视口钳制 | 拖动中实时钳制 ＋ 窗口 resize 重新钳制 ＋ 恢复旧位置时修复（上次在更大窗口上拖的，这次可能已在屏外） |

#### R-5.D 步骤清单

- [x] R-5.0：出 Plan（本节）＋ 实读定位持久化落点。验证：持久化载体明确，且与 `leftSidebarWidth` 同一条通路。
  > **✅ 已完成（2026-09-12）**。落点 = `settings-store.ts` 的 `persist`（`name: 'wishfulclaw-settings'`、`partialize` 白名单、`migrate: migrateSettings`）。**不是** `ui-store.ts`——该 store 是纯 `create()`，无 persist 中间件；`leftSidebarWidth` 在 ui-store 里只存不持久，持久真身在 settings-store。写入通路：`partialize` → `ipcStorage` → IPC `settings:set` → `writePersistedSettings`（Main 侧整块落盘，无键级白名单，新字段可直通）。
- [x] R-5.1：拖动交互。验证：`tsc` 三配置；拖动不吞按钮点击；文本不被选中；指针移出窗口不丢捕获。
  > **✅ 已完成（2026-09-12，代码级）**。实现 = `pointerdown/move/up/cancel` ＋ `setPointerCapture`（与仓内既有拖拽实现 `ReasoningEffortSlider.tsx:268-287` 同款）。三个细节：① 3px 阈值，未过阈值的按压不算拖动（避免误触即移位）；② `pointerdown` 上 `preventDefault()` 抑制按住即起文本选中，按钮因早退不受影响；③ 落点存进 `dragRef.latest` 由 `pointerup` 提交，**不**从 `pointerup` 事件坐标重算——`pointercancel` 的坐标不可信。
- [x] R-5.2：位置持久化 + 跨重启恢复 + 视口钳制。验证：重开应用位置不变；缩窗后不越界。
  > **✅ 已完成（2026-09-12，代码级）**。**拖动过程不落盘**：每帧写会变成每帧一次 IPC ＋ Main 一次 settings 文件写，故拖动只走本地 state，仅松手时 `updateSettings` 一次。钳制三处：拖动中（用 pointerdown 时量的真实尺寸）、窗口 resize 时、以及恢复旧位置时。版本号 `36 → 37`，`migrateSettings` 里加形状校验（`Number.isFinite` 双字段，坏值 → `null` 退回默认角落）；**边界不在此处校验**——只有渲染端知道视口与元素尺寸，钳制归渲染端。
  > **两处实现期修正（记此防复犯）**：① 恢复旧位置的钳制**只改渲染值、不改存档**——若把钳制结果写回，在笔记本上开一次就会把大屏上摆的位置永久压到小屏边界内，窗口变回大时也回不去了；只修渲染值则窗口恢复大小时自动回到原位。② 该效果的依赖必须含"悬浮块变可见"这一项：`phase` 从 `idle` 变 `downloading` 时组件才首次真正渲染出元素，缺这一项则整个会话都不会修复那个屏外位置。
  > **同时收了一个宽度溢出**：`max-w-sm`（384px）只管宽度上限、不管落点，靠右摆放时更长的状态文案（下载中 → "更新 X 已下载，等待重启安装"）会把块推出右边界。落位后加内联 `maxWidth = min(384, 视口宽 - left - 8)`，内层两行本就是 `truncate`，因此收紧的是文字而不是越界。
- [ ] R-5.3：真机目视（老大）。验证：拖到四角均不越界；拖过后开合侧边栏悬浮块不动；重开应用位置一致；拖动期间 toast 不再被抬高。

**门禁**：本需求**零 C# 改动**，门禁即 `tsc` 三配置（`tsconfig.web.json` / `tsconfig.node.json` / `tsconfig.json`），本次已跑，**三份均 0 错误**。无新增 C# 回归、无金样变动（不触碰 R-3 的 105 格）。

**已知取舍（记账，不修）**：口径 2 取的是"落位即不抬 toast"。若用户只把悬浮块往上挪几十像素、仍压在左下角，toast 会落在它后面。取舍理由是几何判据要引入一组魔法数字且不随 resize 重算，而用户自己摆的位置本就看得见、可以再挪。老大若要更细的规则，是三行的后续改动。

### 需求 R-6：提示词按「英文 + 四关」约定清理

登记日期：2026-09-12（执行期内追加）。**原始登记见 `raw-requirements.md` R-6 节**。

老大原话：

> 人格文档暂时没什么好方案，这个先不用管，我看中的是刚刚的提示词优化本身，除了工具本身用英文描述，下面还有其它的要求

即：把 `docs/提示词优化.md` 的规则（**提示词一律英文** ＋ **分节的行为规则而非自我介绍** ＋ **加一行前的四关**）**落到本仓库已有的提示词上**，不是只当约定记着。

**范围裁定（2026-09-12）**：6 套预置人格文档**本轮不动**（老大原话见上）。工具描述**已经是英文**，勘查已确认，不在改动范围。

#### R-6.A 勘查结论：本仓库的提示词都在哪

| 位置 | 现状 |
|---|---|
| `Persona/PromptBuilder.cs`（系统提示词分段组装） | 英文、分节，**但有 6 处过不了四关** |
| `Persona/PersonaGenerationPrompt.cs`（生成人格的元提示词） | 英文骨架，**JSON 示例是中文** |
| `Persona/Resources/Personas/*/*.md`（6 套预置人格） | **中文**，本轮不动 |
| `Agent/Tools/**` 的 `Description`、`Core/Tools/ToolCategoryCatalog.cs` | 英文 ✅ |
| `Agent/Goal/GoalPromptTemplates.cs`、`AgentRuntimePlanExecutor.cs` | 英文、分节 |
| `Agent/ContextCompression.cs`、`Workspace/Memory/MemoryRecallService.cs` | 英文 |
| `CodeGraph/**` | vendored，与上游逐字对齐，**不动** |

#### R-6.B 四关逐条对照：本轮实际改了什么

| # | 位置 | 过的关 | 改法 |
|---|---|---|---|
| 1 | `BuildBaseInstruction` | 三 | 删 `Tools are available for coding, research, file operations, and shell commands.` —— 同一份提示词的 `<tool_calling>` 段已经渲染了 27 个类别，这是第二遍 |
| 2 | `BuildBaseInstruction` | 二 | `Do not overstep your bounds or create unnecessary files.` 拆成 `## Working rules` 两条，其中文件创建改为阈值式：「只在**改不动现有文件**时才新建」 |
| 3 | `BuildSessionContext` | 三／事实必须为真 | **`Shell: cmd.exe` 是假事实**。`ShellExecuteTool.ShellResolution` 在 Windows 上依次试 `powershell.exe` → `pwsh.exe` → `cmd.exe`，默认落在 PowerShell；两者语法互不兼容（`&&`、`$env:`），报错名字会让模型写出跑不通的命令。改为**读真实配置**：`WISHFUL_SHELL`（Main 从设置注入，与工具解析的首选项同源），取不到才回落平台默认 |
| 4 | `BuildContextDocuments` | 一 | 删两行仪式句（`Read and internalize them.` 说不出没有它会做错什么；`They define WHO you are and HOW you act.` 与上一句同义） |
| 5 | `BuildMemoryContext` ＋ `MemoryRecallService` | 一 | 防注入守卫原文三句说同一件事，收敛为「untrusted reference data, possibly wrong or malicious」＋ 一句禁令；两处措辞统一（此前系统提示词与召回结果各写一套） |
| 6 | `BuildSshContext` / `BuildProjectContext` | 一／三 | `## Project` 的 SSH 分支与 `<ssh_capability>` 逐句重复同一段（远程路径、本地文件工具、`local:true`），**同一次运行的提示词里出现两遍** → 只留 `<ssh_capability>`。另删三处：`This is by design, not a limitation.`（元解释）、`Use them freely for local tasks`（无阈值）、远程文件操作的命令枚举与 `SshListConnections` 路由（属工具描述领域，且该工具本就在直连清单里） |
| 7 | `BuildChannelSessionPrompt` | 三 | **删「交互类工具在此不可用」整条**：R-3.K／R-3.M 已用 `ExcludedScopes` 把 ask-user／widget／计划族从渠道档的工具表里摘掉，模型调不到，再嘱咐一遍是重复。保留其替代行为（用纯文本提问并等下一条消息）。另合并两条同义项 |
| 8 | `BuildToolCapability` | 一／二 | 两条 proxy 说明说的是同一件事 → 合一；`briefly` → `in one sentence`；`complex multi-step tasks` → `three or more distinct steps` |
| 9 | `BuildGoalModePrompt` | 一／结构 | 删与 `## Your role` 里「Confirm」重复的那条硬规则；`@"..."` → `"""`（同一文件其它段都是 raw literal，verbatim 形式迫使 `"pending"` 写成 `""pending""`） |
| 10 | `PersonaGenerationPrompt` | 一 | JSON 示例的中文占位符 → 英文；补一句「示例示形不示语言」以**保住**既有行为（人格内容仍按用户语言生成） |
| 11 | `AgentRuntimePlanExecutor` | 三的延伸 | 两条入口消息各自内联了一份 1,400 字符的工作流文本，只差开头一句 → 收敛为 `PlanModeWorkflow` 常量一份 |

#### R-6.C 步骤清单

- [x] R-6.0：出 Plan（本节）＋ 全量勘查提示词源头（含 CJK 扫描与 raw-string 扫描，确认工具描述已是英文）。
- [x] R-6.1：系统提示词（`PromptBuilder.cs`）逐段过四关。验证：改动均为英文文本与常量，行尾 CRLF 保持一致。
- [x] R-6.2：其余提示词源头（`PersonaGenerationPrompt` / `MemoryRecallService` / `AgentRuntimePlanExecutor`）。
- [x] R-6.3：落成仓库约定 → 新建 `docs/prompt-authoring.md`，并在 `AGENTS.md`「开发约定」下加「提示词写作」小节（AI 只读 AGENTS.md 也能拿到硬规则）。
- [ ] R-6.4：后续项三项，见 R-6.D，**本轮不做**。

#### R-6.D 登记未做的三项（都有明确理由，不是漏）

1. **`<tool_calling>` 渲染全量 27 个类别**（跨层，需设计）：`ToolCategoryCatalog.All` 是静态目录，而 R-3 的可见性策略会按档位隐藏一部分 → 提示词会列出模型**当前调不到**的类别。修法必须把「本档位可见的类别」算出来交给 Persona，但 `ToolVisibilityPolicy` 在 **Agent** 层、`AgentRunContext` 是 Agent internal，Persona 不能反向依赖；可行路径是 Agent 侧把列表塞进 run 参数，或把判定下沉到 Core。**属跨层设计，需老大裁定后再动。**
2. **计划模式的第三份工作流文本**（`AgentRuntimePlanExecutor.cs` 的「计划批准后」消息自带一份 EXECUTION 描述，与入口消息重叠）：合并会改动模型看到的行为，本轮只做同文去重，不动语义。
3. **6 套预置人格文档**：老大已裁定暂缓（语言与产品调性两件事都还没有好方案）。

**门禁（2026-09-12 晚实测）**：本批是**纯字符串与常量改动，零逻辑变更**（唯一新增逻辑是 `ResolveShellName` 读一个环境变量）。`dotnet build src/runtime/WishfulClaw.sln` → 15 项目 **0 警告 0 错误**；`tsc --noEmit` × `tsconfig.web/node/root` → **三配置 0 错误**。

**⚠️ 本批真正的缺口不是编译，是覆盖**：`tests/` 全目录 grep `PromptBuilder` **零命中** —— 系统提示词的 11 处改动没有任何自动化守门，只有「能编译 + 真机目视」两道。建议单独立需求做「系统提示词快照测试」（样板可复用 `ProviderHeaderRegressionTests/VisibilitySnapshot.AssertMatchesGolden`，对照文件形态即 `visibility-snapshot.expected.txt`）。

### 需求 R-7：临时文档统一归置 `.wishful-claw/notes/` + 项目数据目录隐藏

**来源**：老大 2026-09-12 执行期追加。原话：「全局 PM 给项目下会话发临时任务的时候，会写一个文档然后读取，我希望这些文档放到 `.wishful-claw` 下的一个专门的文件夹里面去。其次，首次创建 `.wishful-claw` 的时候设置为隐藏文件夹。」

**裁定（AskUserQuestion，2026-09-12）**：
1. 引导要落在 **`send_work_request` 工具本身的描述**里（老大原话：「我希望 send_work_request 这个工具本身的描述里面就引导了，如果要创建文档应该放哪里」）；
2. 目录名 **`.wishful-claw/notes/`**；
3. 覆盖范围 **所有临时文档**（在系统提示词层面统一规定去处）。

#### R-7.A 勘查结论

- **PM 没有任何文件工具**：全局档可用工具只有 `ProjectToolsProvider`（3 件）与 `GlobalTaskToolsProvider`（7 件），都声明 `availableModes: ["global"]`。所以 PM **不能自己写文档**，只能通过 instruction 指挥目标会话。
- `send_work_request`（`AgentRuntimeGlobalTaskExecutor.SendWorkRequestAsync`）只投递一段 `instruction` 纯文本 + 一段固定尾注，**不落任何文件**。
- 同一条文案在 **两处** 各有一份：C# 侧 `AgentRuntimeGlobalTaskExecutor.cs:221-229` 与渲染端 `task-board-store.ts:97-106`（`buildWorkRequestContent`，注释写明 `mirrors`）。**改文案必须两处同改**，否则看板与 PM 派发的措辞会漂移。
- 「写文档」因此是**目标会话收到任务后自发**的行为；约束要同时给到 PM（工具描述）与会话（投递消息 + 系统提示词）才算闭环。
- C# 侧项目级数据目录**没有统一入口**：`WishfulClawDataDir`（Infrastructure）只管**全局** `~/.wishful-claw`；项目级是各处自己 `Path.Combine(workingFolder, WishfulClawPaths.DataDirName, …)` 拼的，创建点至少 6 处（plans / memory / personas / goals ×2 / project-status）。
- Windows 隐藏属性**没有跨平台 API**：C# 用 `FileAttributes.Hidden`（`DirectoryInfo.Attributes`）；Node 侧无内置能力（只能调 `attrib.exe` 子进程），故**隐藏只做 C# 侧**。
- `.wishful-claw` 以点开头，macOS / Linux **天然隐藏**，只需处理 Windows。

#### R-7.B 步骤清单

- [ ] R-7.1 文档归置约定（纯提示词，4 处）
  - `GlobalTaskToolsProvider.cs` 的 `send_work_request` 描述：引导 PM 在 instruction 里指明文档去处
  - `AgentRuntimeGlobalTaskExecutor.cs` 投递消息尾注：给目标会话的明确指示
  - `task-board-store.ts` 的 `buildWorkRequestContent`：与上一条同步
  - `PromptBuilder.BuildProjectContext` 的 `## Project` 段：统一规定「临时文档写到 `.wishful-claw/notes/`，不要散落在项目里」
- [x] R-7.2 `WishfulClawDataDir` 新增 `EnsureProjectRoot(workingFolder)`（创建 + Windows 设隐藏，幂等）与 `HideOnWindows(directory)`
- [x] R-7.3 落点收敛为**单点**：`AgentLoop.ExecuteLoopAsync` 在 `parameters` 规范化之后调一次 `EnsureProjectRoot`。
      **为什么单点就够**：`EnsureProjectRoot` 是**主动创建**——会话启动时目录还不存在，由它创建即带隐藏属性；而 `Directory.CreateDirectory` 对已存在目录不改属性，所以之后 plans / memory / personas / goals 各自创建子目录时，父目录的隐藏不会被冲掉。逐点改创建点是重复劳动。
- [x] R-7.4 门禁（2026-09-12 实测）：`dotnet build src/runtime/WishfulClaw.sln` **0 警告 0 错误**；tsc `tsconfig.web.json` **0 错误**；**9 套 C# 回归全绿**（74 / 108 / 269+2 / 8+42 / 148 / 18 / passed / 180 / passed）；**10 套 TS 回归全绿**（56 / 35 / 71 / 20 / 330 / 16 / passed / passed / 96 / 20）。
      **未加自动化断言**：`EnsureProjectRoot` 的行为依赖真实文件系统与平台，测试要写临时目录 + 清理，对一个 3 行的属性设置 API 不成比例。改为**真机目视**：开一次项目会话后看 `.wishful-claw` 是否隐藏。

#### R-7.C 边界（如实登记）

1. **隐藏只在 C# 侧生效**：Node 没有设置 Windows 隐藏属性的内置能力（只能调 `attrib.exe` 子进程），故不引入 TS 侧实现。实际的项目根目录创建点都在 C# 侧，影响很小。
2. **「首次创建」是幂等 ensure，不是钩子**：老项目里 `.wishful-claw` 已存在且可见，会在下一次会话启动时被**补设**为隐藏；不是「只对新项目生效」。
3. **CodeGraph 目录随父目录一起隐藏**：`CodeGraphConnectionFactory`（`WishfulClaw.CodeGraph`，vendored）自己 `CreateDirectory` 建 `codegraph/` 子目录，按仓库约定**不改 vendored**；但它只建子目录，父目录 `.wishful-claw` 已由 run 入口创建并隐藏，故不受影响。
4. **未跑过会话的项目**：若 `.wishful-claw` 在一个**从未执行过任何 run** 的项目里被创建（例如用户直接点 CodeGraph 索引），首次会是可见的，直到该项目第一次跑会话时补设。这是单点落点的固有边界，成本极低（一次补设），未再为此增加创建点。

### 需求 R-8：AI 服务商官网地址与详情页入口（含内置模型数据刷新）

需求来源：本次执行期追加，权威口径见 `raw-requirements.md` R-8。

目标：让用户从内置 AI 服务商详情直接找到官方办理入口，同时允许自定义服务商没有官网地址。

范围与约束：

- 在 AI 服务商数据模型中新增**可选**字段。需求原文建议命名 `websiteUrl`，**实现采用 `homepage`**（与 `BuiltinProviderPreset.homepage` 必填字段同名，避免两份命名并行）；空值不能阻止保存、启用或调用。
- 盘点 `src/renderer/src/stores/providers/index.ts` 的全部 `builtinProviderPresets`，逐项从官方站点核实官网或官方开发者/API 入口并补齐，不使用第三方聚合地址。
- AI 服务商详情页仅在有地址时显示外部链接入口，点击走现有协议白名单与 `shell.openExternal`，不在应用内加载任意网页。
- 兼容已有配置与 preset 更新：字段缺失按未配置处理，不得覆盖 API Key、Base URL、模型或启用状态。

- [x] R-8.0：复核内置服务商清单、官网地址来源和地址展示口径。
- [x] R-8.1：扩展共享类型、preset、持久化/迁移和自定义服务商表单，保持官网地址可选。
      `src/shared/types/provider.ts` 新增 `homepage?: string`；`createProviderFromPreset` 写入。
- [x] R-8.2：在服务商详情页增加条件外链入口，复用现有安全外开通道。
      `ProviderConfigPanel.tsx:230` `{provider.homepage && (...)}` + `shell:openExternal`。
- [x] R-8.3：补齐每个内置服务商的官方地址，并核对没有漏填、错链或第三方链接。
- [x] R-8.4：验证旧配置迁移、自定义空地址保存、详情页外链和异常协议拦截。

#### R-8.5：内置模型清单数据刷新 + 全量 bump preset 版本

老大在执行期追加：内置模型清单已明显滞后，要求按官方在售清单刷新（模型增删 / 名称 / 上下文 / 价格 / 能力），并顺带更新版本号。

**为什么要 bump 版本（这是 R-8 官网不显示的根因）**：`ensureBuiltinPresets` 的升级分支有版本门控
`if ((current.presetVersion ?? 0) >= preset.version) continue`。`createProviderFromPreset` 只管**新建**，
已存在的老记录永远走不到 `homepage` 回填。R-8 只加字段没 bump 版本，于是新用户看得到官网、老用户看不到。

**口径（老大拍板）**：范围 = 主力 + 国内常用 18 家完整核实，其余小服务商只 bump 版本；深度 = 模型 + 名称 + 上下文 + 价格；
计费 = 峰谷/阶梯取标准档；条目 = 以官方在售清单为准，下线模型移出并登记 `deprecatedModelIds`。
**币种**：字段单位是 **USD/百万 token**，官方为人民币牌价的按 **1 USD = 6.7106 CNY** 折算；官方直接公布美元价的
（Moonshot 国际版 / 小米海外 / xAI / OpenRouter）直接用美元，不做二次换算。

- [x] R-8.5.1：18 家完整核实并落地 —— `deepseek` / `moonshot` / `google` / `anthropic` / `openai` / `qwen` / `baidu` /
      `bigmodel` / `minimax` / `volcengine` / `hunyuan` / `stepfun` / `xiaomi` / `siliconflow` / `gitee-ai` /
      `openrouter` / `x-ai` / `azure-openai`。
      `volcengine` / `stepfun` / `hunyuan` 三家原本**完全没有或只有部分价格**，本次按官方价目表补齐。
      `openrouter` 按官方 `GET /api/v1/models`（445 个模型）重建：49 项价格/上下文刷新、7 项下线移出、
      新增 Claude Opus 5 / Fable 5.1、GPT-6 Astra、GPT-5.6 系列、Gemini 3.6~3.8 Flash、Kimi K3、GLM-5.3、Grok 4.6 等 31 项。
      `gitee-ai` 按官方 `/v1/models`（256 个）下线 19 个、新增 21 个。
- [x] R-8.5.2：**46 个 preset 的 `version` 全部 +1**，让老用户记录走升级分支刷新模型清单与 `homepage`。
- [x] R-8.5.3：补 `deprecatedModelIds` 的消费点。**该字段此前全仓无任何消费方（纯死数据）**——移出默认清单的模型
      在新版里不再出现在 `presetModelIds`，会被 `userCustomModels` 当成"用户自建"永久保留，永远清不掉。
      已在升级分支加一行过滤（`ensureBuiltinPresets`）。
- [x] R-8.5.4：补回归测试。把升级逻辑抽成纯函数 `src/renderer/src/stores/provider-preset-upgrade.ts`
      （否则 node 测试里起不了渲染端 store），`tests/provider-presets/program.ts` 断言"老记录能被回填 `homepage`"——
      这正是 R-8 当初漏测、导致门禁全绿而功能失效的场景。顺带由新断言查出并修掉 `baidu` preset 的 `ernie-x1.1`
      同时出现在 `deprecatedModelIds` 与 `defaultModels` 的数据矛盾。
- [x] R-8.5.5：顺手补注册 `stepfunPlanPreset`。它是 7 个"套餐/编码" preset 里唯一没进 `builtinProviderPresets` 的
      （明显漏注册），否则对它的版本 bump 是空转。

#### R-8.C 边界（如实登记）

1. **bump 版本的代价**：升级分支会全量重建 `models`（preset 全量 + 用户自建），只保留用户模型的 `enabled` 标志。
   老用户被删的模型会复活、用户改过的模型配置（name / contextLength / pricing / thinkingConfig）会被 preset 值覆盖。这是老大已知并接受的代价。
2. **`defaultModel` 不在升级范围内**：升级分支只刷 `type` / `homepage` / `models`，preset 的 `defaultModel` 变化只对**新装**生效。
3. **聚合型服务商无法做到"完整"**：`siliconflow` 的完整目录需鉴权（`GET /v1/models` 返回 401），本次只按官方价格页公示项复核，未做删除；
   `gitee-ai` 的价格沿用文件原本声明的"公开 provider 元数据（OpenRouter）"口径，未逐条换算 Gitee 自身价目。
4. **阶梯/峰谷取首档**：火山方舟 seed-2.0 系列与 SiliconFlow 部分模型按输入长度或时段分段计价，统一取标准档（最低档），并在文件注释里登记完整价目。
5. **`azure-openai` 只做对齐不做重算**：Azure 在售模型取决于区域与部署、计费沿用 OpenAI 牌价，本次仅与 `openai.ts v3` 对齐
   （把三个 gpt-5.x-chat 变体移出并登记 deprecated），未按区域差异重算价格。
6. **BOM 漂移**：本迭代若干文件被工具写入时带上 UTF-8 BOM（HEAD 版本没有），已在本工作涉及的文件上清理；
   `docs/` 三个文件、两个 `.cs`、`tests/WishfulClaw.ProviderHeaderRegressionTests/visibility-snapshot.expected.txt` 上仍存在，未动 —— 后者是金样字节比对文件，不属本次范围。

### 需求 R-9：内置服务商懒物化（preset 只读基线化）＋ 内置 id 固定化 ＋ 存量清理

> **定位（老大 2026-09-13 裁定）**：**属 28 迭代追加需求，本次不启用 29 迭代**。
> 原误登记为 `raw-requirements.md` 后继需求 S-15，现提升为 R-9 走正式流程（状态小节第 12 项）。
> **来源**：R-8 落地后老大追问「内置服务商最终也是转换为数据了么」而引出的根本问题。八条口径已当场拍定，本节是其正式载体。

#### R-9.0 根因与目标

- [✓] **根因一**：`ensureBuiltinPresets()` 把 46 个 preset **全量复制**成 `AIProvider` 记录落 `wishful-claw-providers`，
  且**全部 `enabled: false`**（9 个显式、37 个靠 `?? false`），约 500 个模型对象整份拷贝、**零用户意图**。
- [✓] **根因二**：`provider-store-helpers.ts:207` 的 `presetVersion >= preset.version ⇒ continue` 使 preset 后续任何改动
  （含 R-8 新增 `homepage` 这类纯加字段）对老用户**永不生效** → 只能手工 bump（R-8.5 那次 46 个全量 bump 即由此而来）。
- [✓] **根因三（真正的矛盾）**：**快照语义下「让新数据生效」与「保住用户改动」互斥**——
  不 bump 新数据不生效，bump 就把用户改过的模型元数据整块覆盖回去（代价已记在 R-8.C.1）。
- [✓] **目标**：内置服务商从「启动时物化的快照」改为「**只读基线**」——读实时从 preset 合成、永不落盘；**写才物化**。
  物化之后归用户自己管，我们不再自动更新，覆盖问题从根上消失。

#### R-9.1 内置 id 固定为 `builtinId`

- [✓] `createProviderFromPreset`：`id: nanoid()` → **`id: preset.builtinId`**（把「随机 id 当主键、稳定 builtinId 只当标签」的现行关系倒过来）。
- [✓] 46 个 `builtinId` 实测已全局唯一（`openai`／`baidu-coding`／`xiaomi-coding`／`stepfun-plan`…），**不加前缀**。
- [✓] **自定义服务商仍用 `nanoid()`**，与 kebab-case 的 builtinId 命名空间天然隔离。
- [✓] `builtinId` 字段**保留**，作为「内置／自定义」判定依据，不要靠 id 字符串猜。
- [✓] **一 preset 一记录**。用户想再开一个同类服务商（官方 ＋ 中转）走**自定义**路径、自己填 baseUrl 与名称
      （老大原话："用户可以自己添加更多同样服务商，只是名称不一样"）。

#### R-9.2 读写分离：读走合成，写才物化

- [✓] **读**（列表、详情、模型清单）→ 实时从 preset 合成，**永不落盘**，因此永远最新。
- [✓] **写**（启用／填 apiKey／改 baseUrl／拨模型开关／设为活跃）→ 此刻物化一条记录。
- [✓] **已物化的归用户自己管**（老大裁定："已经物化的用户自己管理，快照是旧的还是新的都是用户自己的事情了"）
      → **不做 model diff、不做覆盖合并**，也就不存在"覆盖用户改动"的问题。
- [✓] 用户自助更新手段现成：`fetchModels`（从 API 拉模型清单）不动。

#### R-9.3 实现路径：**选 A（内存全量、落盘瘦身）**

| 路径 | 做法 | 代价 |
|---|---|---|
| **A（选）** | `providers` **内存数组保持全量**（46 条合成 ＋ 自定义），只改 `partialize` 让**无用户意图的内置不落盘** | 20+ 处 `providers.find(p => p.id === …)` **零改动**；需一个 `virtual` 标记（**运行时字段，仅合成对象带，永不落盘**） |
| B | 真懒：`providers` 只装有意图的，新增 `getVisibleProviders()`，改所有 UI 读取点 | 语义更纯，但要动 automation／chat／goal 等十几个组件，回归面大 |

- [✓] 选 **A**。理由：内存里多 46 个合成对象成本可忽略（数据本就在 preset 里），**真正要解决的是"落盘快照腐化"**，
      A 精确地只解决这一点，且让 `AssistantMessage`／`GoalConfirmCard`／`context-ring`／`AutomationModelSelector` 等
      十几处 `providers.find` 全部零改动。
- [✓] 给 `AIProvider` 加 `virtual?: boolean`（**运行时字段，永不落盘**）：preset 合成的对象自带 `virtual: true`，
      用户首次写入时由 `materializeRecord()` 摘掉 → 变成真实记录。**默认即"真实"**，所以 R-9 之前写的老记录
      天然不带该标记、天然落盘 —— **零迁移、不碰用户数据**。`partialize` 只输出 `!p.virtual` 的条目。
      > 老大 2026-09-13 点名否决了前一版"加 `materialized` 落盘字段 + 迁移老记录"的做法：
      > 「你为什么要加物化字段，不能是内置的加个虚拟字段么？你要去动用户数据？」——虚拟记录本就是代码合成的，
      > 由合成方打标记即可，不该反过来给所有老数据补字段。

#### R-9.4 停掉 `ensureBuiltinPresets` 为内置创建记录 ＋ 废弃 `presetVersion` 闸门

- [✓] 卸掉该函数"为内置 preset 创建记录"的职责（改为只**合成**到内存），自定义服务商逻辑保留。
- [✓] 注意这是给启动路径**减负**（少建 46 条、少一次全量写盘），与老大「启动本身就有很多东西要处理」的诉求同向。
- [✓] **连带废弃整个 `presetVersion` 版本闸门** → 以后改 preset 数据**不必再 bump version**，
      R-8.5 那种 46 个全量 bump 成为历史。这是本需求最大的长期收益。
- [✓] ⚠️ **前提**：R-9.2 的合成链路必须先落地，否则内置服务商会整体消失。

#### R-9.5 存量清理（**进入 AI 服务商管理页时专项做**）

- [✓] 时机：**管理页**，**不在 hydration**（老大裁定："启动本身就有很多东西需要处理，专项专做"）。
- [✓] 清理判定（建议**先只上前四条**，后四条作保守兜底——保守的代价只是少清几条，激进的代价是丢用户配置）：
      `builtinId` 存在 && `!enabled` && `!apiKey` && `preset.requiresApiKey !== false`
      && `baseUrl === preset.defaultBaseUrl` && 无 preset 之外的自定义模型 && 未被 6 个选中态指针引用 && 无 OAuth 账号绑定。
- [✓] ⚠️ **`requiresApiKey: false` 的 5 个必排除**：`codex-oauth`／`copilot-oauth`／`lmstudio`／`ollama`／`moonshot.ts:27`
      天生没有 apiKey，不排除会被无条件误删；其中 `ollama` 常被改 baseUrl，删了即丢配置。
- [✓] ✅ **有利性质**：因内置 id 固定为 `builtinId`，删记录**不会让引用悬空**（合成链路仍可解析），
      这与现行 nanoid 情形（删了就真找不到）本质不同。

#### R-9.6 内置的「删除」改称「恢复出厂设置」

- [✓] `ProviderConfigPanel.tsx:209`（另 `:286` 有同款判断）现在用 `{!provider.builtinId && …}` 把内置删除入口**隐藏**。
      当前合理（删了下启动被重建、等于没删），但 R-9.4 之后语义已变，此入口**必须开放**。
- [✓] **名称不叫「删除」，叫「恢复出厂设置」**（老大原话："实际上就是删了，只是名称不一样，免得用户觉得我怎么没删掉"）。
      根因：懒物化后内置由 preset 渲染、**永远在列表里**，点「删除」而条目仍在会造成"没删掉"的困惑。
- [✓] **「删除」只属于自定义服务商**。文案需体现"清空我的配置、回到内置默认"。

#### R-9.7 附带清理

- [✓] 删掉 `addProviderFromPreset`（"从模板再添加一条"）——全仓**零 UI 调用**，僵尸 API；R-9.1 之后它与"一 preset 一记录"直接冲突。
- [✓] 可复用先例：全局模型库 `managedModels` 已由 `collectBuiltinManagedModels()` 从 preset 实时收集、不落盘；
      R-9 等于把同一做法从「模型库」推广到「服务商本身」。

#### R-9.C 边界（不做的、代价与风险）

1. **删除/停创建必须与合成链路同批落地**，不得先删后补——列表与十几处 `providers.find` 都依赖数组内容。
2. **存量迁移**：老用户配置里躺着的 46 条 nanoid 记录，需把**有用户意图**的 id 换成 `builtinId` 并同步改引用
   （6 个选中态指针 `activeProviderId`／`activeFastProviderId`／`activeImageProviderId`／`activeTranslationProviderId`／
   `activeSpeechProviderId` ＋ 压缩配置，以及 `lib/auth/provider-auth*.ts` 的 OAuth 账号绑定）；无意图的直接丢弃。
3. **不做 model diff**：已物化记录的快照新旧由用户自己负责（老大裁定），本次不引入稀疏覆盖结构。
4. **不改动 `fetchModels` 与 `builtinModelRegistry`**：后者本就是每次启动从 preset 实时建的（不受版本门控），
   正是 R-9 要推广的范式。
5. **BOM／行尾**：本需求涉及的文件若被工具写入，沿用既有纪律（不新增 BOM、保留原行尾）。
6. **验证口径（两条路径均已自动化，不必只靠手工）**：
   - `ensureBuiltinPresets` 的核心抽为纯函数 `reconcileProviders()`（`provider-materialization.ts`，不依赖 store），
     因此**整条升级路径可在 node 里回归** —— 这是把"老大要求的新装/老用户都要正常"做成可执行断言的关键一步。
   - `test:provider-presets` **535 assertions**：
     · **新装**：46 条全虚拟、id 等于 builtinId、无 id 重映射、`shouldPersist` 全 false（零落盘）；
     · **老配置升级**：造一份 46 条 nanoid 的老配置（其中 deepseek 带 apiKey／启用／改过 baseUrl／有自建模型，openai 已启用，
       外加一条自定义服务商），断言 apiKey／enabled／baseUrl／自建模型**全部保留**、id 重映射正确、自定义服务商不丢、
       迁移后 `providers.length` 不减；
     · 老记录不带 `virtual` ⇒ 视为真实记录 ⇒ 照常落盘（**零迁移**）。
   - tsc 三配置 0 错误；TS 11 套 Mini + C# 9 套回归全绿。
   - ⚠️ **仍缺真机验证**：应用未能启动（打包时 `out/renderer/assets` 清空被环境 safe-delete 守卫拦截，229 > 50 阈值），
     UI 层的实际观感（恢复出厂后条目是否还在列表、管理页清理后是否可见）**尚未目视确认**。

### 收尾：统一审查、验证与修复

- [✓] Z1：全量审查本迭代 7 项改动 → `review_report.md`；发现的修正**不单独提交**，攒进收尾那次 `fix(迭代28): 审查与验证修复调整`。
  > **✅ 已完成（2026-09-12）** → `docs/plans/iter-v2-28/review_report.md`。❌ 9 项全部当场修完、⚠️ 12 项记账、⛔ 6 项转后继；修正均未单独提交，等收尾那一刀。
- [✓] Z2：按各项验收标准出 `verification_report.md`，PASS/FAIL/PARTIAL 如实记账，FAIL 由 agent 修完再记。
  > **✅ 已完成（2026-09-12）** → `docs/plans/iter-v2-28/verification_report.md`。全部门禁在本会话**重跑实测**（未沿用审查期数字）：tsc 三配置 0 错误、解决方案 0 警告 0 错误、AOT 0 条 IL 警告（exe 23,031,296 B）、`dev:full` 两次实跑启动后零 `[ERROR]`、9 套 C# + 10 套 TS 回归全绿（具名断言 566 / 644）。结论 **FAIL 0 项**；#1 / #2 / #3 / R-2 / R-4 记 PARTIAL，缺口同属"真机目视"一类（agent 无屏幕捕获通路，且浏览器通路已实测走不通：缺 preload 桥），R-1 PASS、R-3 机制 PASS 但"零行为变化"口径待老大裁定。
- [ ] Z3：老大确认完结后由他手动发起收尾：版本 `0.2.28`、合并 main、打 tag、push、Release、progress 记账。

## 涉及文件

> 路径按当前代码实测；执行时以当时行号复核。新建/修改以动手时为准。
> **路径前缀速查（首轮规划验证已修正）**：渠道侧三个 TS 文件在 `src/main/ipc/channel-handlers/`（不是 `src/main/channels/`）；`/status` 默认值在 `src/main/channels/plugin-command-handlers.ts`；编辑器文件在 `src/renderer/src/components/chat/FileAwareEditor.tsx`；`use-channel-auto-reply.ts` 在 `src/renderer/src/hooks/`；`ToolPreset.cs` 在 **Core** 层（`src/runtime/WishfulClaw.Core/Tools/`，不在 Agent）。

**需求 #1（请求日志与统计）**
- `src/runtime/WishfulClaw.Infrastructure/Db/` — 新建 usage 表实体 + `DbUsage*Tools`（查询端点）
- `src/runtime/WishfulClaw.Agent/Providers/` — 四个 Provider 的 usage 产出点接写入钩子
- `src/runtime/WishfulClaw.Infrastructure/Db/DbMessageCompactTools.cs:186` — `billableInput` 口径唯一来源（只读参照）
- `src/renderer/src/lib/usage-analytics.ts` — 删除（含三处 `recordUsageEvent` 调用点）
- `src/renderer/src/components/settings/` — 统计面板 UI（新建）
- JSON Context 注册处（`InfrastructureJsonContext` / `WishfulClawJsonContext`）— 新增 DTO 注册

**需求 #2（更新弹窗/悬浮窗）**
- 见 `updater-ui-issues.md`（已实施并提交 `c7287b6e`）；剩余 `#2.6` 为老大目视复验

**需求 #3（编辑器撤销选中态）**
- `src/renderer/src/components/chat/FileAwareEditor.tsx:144,253` — 唯一两个非折叠选区出口
- 粘贴/撤销边界的选区处理处 — 修改点；**不动共享解析器**

**需求 R-1（补位模型）**
- `src/renderer/src/lib/prompt-optimizer/optimizer.ts:60-69` — 补传 `providerId`
- `src/renderer/src/components/chat/InputArea/use-prompt-optimizer.ts:55-94` — 调用侧模型解析
- `src/runtime/WishfulClaw.Agent/ProviderCompletionService.cs` — 三级解析落点（384 行）
- `src/runtime/WishfulClaw.Agent/Modules/ProviderTestModule.cs:14` — 注册处
- `src/runtime/WishfulClaw.Contracts/AotResultTypes.cs:84-88` — `ProviderCompletionResult`（改字段须同步 AOT）
- `src/renderer/src/stores/provider-store.ts:19-20,29-33,93,95,305-306` — 唯一活着的模型解析
- `src/renderer/src/lib/api/types.ts:452-472` — `ProviderConfig`（含 `providerId`）
- `src/renderer/src/components/settings/` — 补位模型配置 UI（新建/改）

**需求 R-2（渠道设置页全局化）**
- `src/renderer/src/components/settings/PluginPanel.tsx:99-101,136-137` — 全局设置 `<details>` 改选项卡
- `src/renderer/src/components/settings/plugin-panel-detail.tsx:103-217,221-260,352-358` — features/permissions 搬家 + 选项卡样板
- `src/renderer/src/hooks/use-channel-auto-reply.ts:139-143` — 消费端改读全局
- `src/main/ipc/channel-handlers/channel-plugin-handlers.ts:167-176,292-299,344-352,392` — 消费端 + 白名单 + 浅合并
- `src/main/channels/plugin-command-handlers.ts:321-325` — `/status` 默认值
- `src/main/channels/channel-types.ts:56-76` — `ChannelInstance`（与 R-3 共用）
- `src/main/channels/channel-config-store.ts:42-58` — 配置归一化（与 R-3 共用）

**需求 R-3（工具可见性）**
- `src/runtime/WishfulClaw.Core/Tools/ToolTypes.cs:8-14` — `ToolDefinition` 新增声明字段
- `src/runtime/WishfulClaw.Core/Tools/ToolRegistry.cs:44,89-90` — 注册与可用性
- `src/runtime/WishfulClaw.Core/Tools/IToolExecutor.cs:33` 旁 + `ToolDefinitionPlaceholder.cs:12-25` — 注册路径
- `src/runtime/WishfulClaw.Agent/AgentRunContextPolicy.cs:62,125-130,199-222,212-216,230-236` — 唯一强制层
- `src/runtime/WishfulClaw.Core/Tools/ToolPreset.cs:38-119` — 七 preset
- `src/runtime/WishfulClaw.Agent/AgentRuntimeUseCapabilityExecutor.cs:290,302,346` — use_capability 旁路
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs:242-259,326-327,348,418` — 提示词侧
- `tests/WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs:20-53,68-83,174` — 必改回归
- `tests/WishfulClaw.GoalRegressionTests/Program.Lifecycle.cs:245-315` — 必改回归
- `tests/WishfulClaw.ToolConcurrencyRegressionTests/Program.cs:41-49,92-99` — 必改回归

**需求 R-4（使用指引）**
- `README.md` — 拆分为用户指引；开发 README 另起
- `src/renderer/src/components/layout/TitleBar.tsx:94-138` — 顶栏问号
- `src/renderer/src/components/settings/SettingsPage.tsx:260-338` — 关于页按钮
- `src/renderer/src/components/layout/WorkspaceSidebar.tsx:408-417` — 版本号落点（参照）
- Main 侧 `setWindowOpenHandler` 所在文件 — 外链约定（执行时复核）

**需求 R-5（悬浮块拖动）**
- `src/renderer/src/components/updater/UpdateStatusBanner.tsx` — 拖动交互 + 落位接线（`shouldLiftToastsForBanner` 出口）
- `src/renderer/src/components/updater/banner-position.ts` — **新建**：钳制与落位样式（与 React 树解耦，便于单独推演）
- `src/shared/updater/types.ts` — `UpdateBannerPosition` 类型 ＋ `normalizeUpdateBannerPosition` 形状校验
- `src/renderer/src/stores/settings-store.ts` — 字段 + 默认值 + `partialize` + `version: 36 → 37`
- `src/renderer/src/stores/settings-store-migrate.ts` — 恢复时形状校验
- `src/renderer/src/App.tsx:51,226` — toast 抬高判据改 `shouldLiftToastsForBanner`
- `src/renderer/src/locales/{zh,en}/settings.json` — `updater.banner.dragHint`

**需求 R-6（提示词清理）**
- `docs/prompt-authoring.md` — **新建**：仓库级提示词约定（两条硬约定 + 四关 + 提示词清单 + 已知偏离 + 自查清单）
- `AGENTS.md`「开发约定」— 新增「提示词写作」小节（硬规则摘要 + 指向上述文档）
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` — 11 处改动：基础段、环境段（**修 `cmd.exe` 假事实**）、persona 包装、记忆包装、`<tool_calling>`、`<ssh_capability>`、`## Project`、`<channel_session>`、`<goal_mode>`；新增 `ResolveShellName`
- `src/runtime/WishfulClaw.Persona/PersonaGenerationPrompt.cs` — JSON 示例改英文 + 语言说明
- `src/runtime/WishfulClaw.Workspace/Memory/MemoryRecallService.cs` — 防注入守卫措辞与系统提示词统一
- `src/runtime/WishfulClaw.Agent/AgentRuntimePlanExecutor.cs` — 工作流文本收敛为 `PlanModeWorkflow` 常量

**需求 R-7（临时文档归置 + 数据目录隐藏）**
- `src/runtime/WishfulClaw.Infrastructure/Storage/WishfulClawDataDir.cs` — 新增 `EnsureProjectRoot(workingFolder)`（项目级 `.wishful-claw`，创建 + Windows 设隐藏，幂等）与 `HideOnWindows(directory)`
- `src/runtime/WishfulClaw.Agent/AgentLoop.cs` — run 入口调一次 `EnsureProjectRoot`（+ `using WishfulClaw.Infrastructure.Storage`）
- `src/runtime/WishfulClaw.Agent/Tools/Providers/GlobalTaskToolsProvider.cs` — `send_work_request` 描述加文档归置引导
- `src/runtime/WishfulClaw.Agent/AgentRuntimeGlobalTaskExecutor.cs` — work request 投递消息尾注加同一引导
- `src/renderer/src/stores/task-board-store.ts` — `buildWorkRequestContent` 与上一条同步（注释里写明 `mirrors`，两处必须同改）
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` — `## Project` 段（本地 + SSH 两个分支）加 `.wishful-claw/notes/` 约定

## 参考源码

- OpenCowork: `D:\claw\OpenCowork` — 提示词优化器原始实现（`optimizer.ts` 头部保留其版权声明），R-1 改 `params` 构造时对照其原始意图
- DeepSeek-Reasonix: `D:\claw\DeepSeek-Reasonix` — 工具注册发现与注入体系（ToolDiscovery/InjectionStrategy），R-3 的"注册期声明"思路来源
- KodaClaw: `D:\claw\koda-claw` — PromptBuilder 分段组装，R-3 的 D 类提示词名单与 R-1 的模型槽位设计参照
- OpenAI Codex: `https://github.com/openai/codex` — 无本地副本，R-3 不直接依赖
- 参考项目本地副本路径见 `AGENTS.md`「参考源码」表

## 不纳入

- Plan D（多服务商有限重试后 fallback）：27 整块移交，本迭代未确认纳入。
- A4 真机升级的"下载确认之后"环节：只做过前半段，不得据 #2 勾成完成。
- 桌宠经验值修复与 pet IPC 半边：老大决定挂起。
- K0 常量收敛、`CodeGraphDataDir.cs:56` 环境变量回落、Obsidian 侧"全局会话无法调用 shell"：27 带过来但未确认纳入 28。
