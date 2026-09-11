# Plan: v2-iter-28

- 分支：`dev/v2-iter-28`（从 `main` @ `0388875e` / `v0.2.27` 切出）
- 范围：老大 2026-09-11 封口，共 7 项需求，见 `raw-requirements.md` 文末「状态」小节
- 提交口径（本迭代起生效的新规）：**一个需求一个提交 + 迭代收尾一次修复调整提交**，即 7 + 1 = 8 个 commit。规划/审查/验证文档随所属需求提交，不单独成 commit
- 裁定点：老大只在**分支合并 main 前**（他手动说"进行 28 迭代收尾"）裁定一次；需求测通后由 agent 自判提交，不逐需求停下等确认- 本迭代规划期已通过讨论定掉的口径（2026-09-11）：① 全局会话 = 全局 PM 助手，不做工作、不能改文档，**但必须保留只读工具**（因项目下会话无法回复全局对话，全局只能自己读落盘结果确认进度，R-3.F）；② 工具可见性「未声明 = 默认可见」（R-3.D）；③ 串语法 `scope:mode@role`，`unknown` 为无宿主保留值（R-3.A/B）；④ **定时任务拆两类**——`runMode:'session'` 随目标会话、`runMode:'background'` 为 `unknown@automation` 且排除浏览器/渠道专用/交互组件（R-3.C）；⑤ 范围只有 `project`/`global`，协作只属项目下，渠道是 global 的特例；⑥ **子 Agent 两分法**——全局会话的子 Agent 继承全局限制，项目下协作/后台执行的子 Agent 除浏览器外基本都能用；**且子 Agent 一律排除浏览器类**（R-3.C）；⑦ **核心工具集原则**——系统提示词只列"少而必要"的核心工具，其余可用工具经 `use_capability` 按需调用和查询（R-3.C-bis，这是 R-3 的真正意图）；核心集名单已定（priority ≤ 70 的 7 类，且**按档位变化**）；**⑪ `use_capability` 三载体同源同裁**——提示词核心集 / `use_capability` 的 description 分类清单 / `action="list"` 的返回，**三者在本档位下必须是同一套可见面**；实读确认 `list` 当前缺收窄（只调 `availableModes` 未调 `IsToolAllowed`，而前者对未声明该字段的工具直接放行），**属必修缺陷**（老大 2026-09-11 追加裁定）；⑧ **R-3 本次范围 = B（两步走）**——只做机制、零行为变化，可见集收窄与核心集名单收窄立为后继需求；⑨ **R-1「不可见」的定义**——指**用户不知道是哪个模型在请求**，清单为提示词优化 / 新建角色辅助 / 后台定时执行 / 定时任务会话执行；**⑩ R-1 模型解析口径**——**不用"最近使用"**（服务商下线模型 + 用户删除会造成悬空 id，属不可抗力），改为**逐请求显式配置 + 补位兜底**，且四个哑字段全删；**⑫ R-1 三级解析定稿**——① 该请求的显式配置 → ② 补位模型配置 → **③ 全局激活模型（保留 + 强制存在性校验）**（R-1 裁定 ⑤）；**⑬ R-2 三条裁定**——① 旧逐渠道 `features`/`permissions` 值**摘白名单丢弃**；② 5 个「只展示不生效」字段**只搬家 + 记账**，**唯 `allowShell` 例外：本次接真且语义改写为「是否需用户授权」**（本身恒可见，`false`=默认需授权、`true`=免授权直调；`channelPermissions` 全仓零注入点的"半死"状态须一并修，且强制执行须落在 C# Worker 侧）；③ 全局设置**不另开文件**，沿用 `plugins.json` 既有存储路径，**以增加字段的方式**承载（R-2）。
- 阶段产物：`exploration_findings.md`（探索态）、本 `plan.md`（规划态）、`compliance_report.md`（规划验证态）。各需求的权威口径文档为 `usage-analytics-requirement.md`（#1）、`updater-ui-issues.md`（#2）、`editor-undo-selection-issue.md`（#3）、`raw-requirements.md`（R-1～R-4）。


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

- [ ] #3.1：定位 `selectionRef` 在"字母/中文出现、数字不出现"这条分界下何时被记成非折叠区间。验证：能稳定复现或给出复现失败的明确结论。
- [ ] #3.2：在粘贴/撤销边界的选区处理处修，不动共享解析器。Mini：`tsc` 三配置。
- [ ] #3.3：老大真机复验样例（粘贴 `1234` → 改 `12你好34` → 撤销应无选中）。

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
- [x] R-1.6：**给第 1/2 条加显式模型配置项**（裁定 ④）——`ProviderCompletionSettings` 新建 `promptOptimizer{Provider,Model}Id` 与 `persona{Provider,Model}Id` 两对，**未复用 R-1.5 删掉的哑字段**。UI 见 `ProviderCompletionSettingsPanel.tsx`（provider + model 双下拉，形态对齐定时任务的 `agentId`+`model`），挂在运行时页 `sec-runtime-auxiliary-models`。
  - 验证：`tsc` 三配置 + `test:settings-tabs`（20 断言）通过；"未配置时走第 ② 级"由解析器断言 ③ 覆盖。真机已在 dev 实例的实际点击与保存：面板写→`config.json` 的 `providerCompletion` 节点（camelCase）→重载读回一致，配好的路由随后被 R-1.3 的落库行证明生效；验证完毕已把三项路由复位为 null。
- [x] R-1.7：**补位模型配置项**（同一面板第三行 `fallback{Provider,Model}Id`）＋ **读取时的存在性校验**。校验落在 `TryResolveStored`：provider 文件不存在 / 模型不在 `models[]` / type+baseUrl 缺失三种情况一律**降级到下一级并 `WorkerLog.Warn`**，最后一级仍无效则返回可见错误（不静默猜模型）。
  - 验证：R-1.3 的 ④⑤⑥ 三条断言即"指向已删模型确认回退且有日志"，测试输出中三条 `WARN` 逐条对得上。zh/en 文案已补齐（`runtimePage.auxiliaryModels.*` 与 `anchorNav.auxiliaryModels`），无硬编码中文。
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

- [ ] R-2.1：`GlobalChannelSettings`（`PluginPanel.tsx:99-101,136-137` 的 `<details open>`）改为自绘选项卡，样板取 `plugin-panel-detail.tsx:221-260,352-358`（含「当前 tab 不可见时自动切首个」的 effect）。Mini：`tsc` 三配置。
- [ ] R-2.2：把 `features` / `permissions` 从渠道详情的 features tab（`plugin-panel-detail.tsx:103-217`）搬进上述全局选项卡，渠道详情只留 `qr` / `credentials` 与渠道自身的 `providerId`/`model` 覆盖。Mini：`tsc` 三配置 + 手工核验渠道列表→详情→切换渠道不残留上一个渠道的表单值。
- [ ] R-2.3：两处消费端改读全局（`use-channel-auto-reply.ts:139-143`、`src/main/ipc/channel-handlers/channel-plugin-handlers.ts:167-176`）。Mini：C# `dotnet build` + 三套 `tsc`。
- [ ] R-2.4：旧逐渠道 key 从 `plugin:list` 顶层白名单摘除，让首读即剪枝（`src/main/ipc/channel-handlers/channel-plugin-handlers.ts:344-352` 已有该机制，白名单现含 `features`/`permissions`/`tools`/`providerId`/`model`），避免 `plugin:update` 浅合并（`:392`）留下僵尸字段。Mini：拿一份真实 `plugins.json` 副本跑首读，确认旧 key 被删且渠道功能不受影响。
- [ ] R-2.5：`autoStart` 等默认值收敛到单点——现存 5 处不一致（seed `false` @ `src/main/ipc/channel-handlers/channel-plugin-handlers.ts:292`、UI 兜底 `true` @ `plugin-panel-detail.tsx:107`、启动判定 `?? true` @ `:170`、`/status` 兜底 `true` @ `plugin-command-handlers.ts:321-325`、`use-channel-auto-reply.ts:139`）。
- [ ] R-2.6：**`allowShell` 接真（语义改写为「是否需用户授权」）**（裁定 ② 的例外项，老大 2026-09-11 拍定）——① **修正命名与文案**：字段名与 `plugin-panel-detail.tsx:191-192` 的「Shell 执行」/「允许 AI 执行 shell 命令」描述的是**旧语义**，须改为"是否需授权"口径（建议重命名 `shellRequiresApproval` 取反语义，或至少改名不可行时在类型注释 + UI 文案明写）；② **默认值 = 需授权**（`false` 保持，但要与旧字段语义对齐）；③ **注入 `channelPermissions`**——当前全仓**零赋值点**（`tool-types.ts:44` 声明 + `bash-tool.ts:50` 读取，`ctx.channelPermissions` 恒为 `undefined`），须从渠道配置真正注入到工具执行上下文；④ **C# Worker 侧同步强制**——`bash-tool.ts:49-52` 的 `requiresApproval` 在渲染边界，而 `execute` 直接返回 `nativeOnlyBashResult()`，**真实执行在 C# 侧**，故授权判定必须在 C# Worker 侧也成立，否则重蹈"零注入"覆辙。验证：① `tsc` 三配置 + C# `dotnet build`；② 渠道会话下 `Bash` **恒可见**（`shell` 属核心集 priority 30）；③ `allowShell=false`（默认）时调用 **触发用户授权确认**；④ `allowShell=true` 时**免授权直接执行**；⑤ 两种设置下 **`Bash` 均出现在可见集与提示词核心集中**（证明它管的是授权不是可见性）。
- [ ] R-2.7：**记账 4 个仍不生效的权限字段**（裁定 ② 主体）——`allowReadHome` / `readablePathPrefixes` / `allowWriteOutside` / `allowSubAgents` 本次**只搬家 + 记账**，不接真。须在本文档与 `raw-requirements.md` 明写"当前仅展示与 `/status` 回显，无强制执行点"，**防后续误以为已生效**。验证：四处读取点核实仍仅在 `plugin-command-handlers.ts:338-341` 与 UI；记账条目进入后继需求清单。

**（本条三条裁定已闭合；`allowShell` 为裁定 ② 的唯一例外，见 R-2.6）**

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
- **全局档**（`global:chat`，PM 助手）：**换成 PM 那套**——`project`（`list_projects`/`get_project_details`）、`global-task`、`task`、`memory`、`capability`、`ask-user`/`widget`（与用户沟通）。**不含** `file`/`shell`（全局不做工作）。这与 R-3.F「全局保留只读工具」不矛盾：**读文件类仍在全局可见集内，只是不占提示词核心位**，需要时经 `use_capability` 取。

⚠️ **B 口径下的落地方式**：本次**只建机制**（`IsCore` 字段 + `PromptBuilder` 按档输出结构），**名单先取"等价现状"**使提示词内容零变化；**上表的收窄留下一步**（R-3.13 记账）。

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
- [x] R-3.1：在 `ToolDefinition`（`ToolTypes.cs:8-14`，Core 层）新增 `VisibleScopes` + `IsCore`，打通四处注册路径。验证：`dotnet build src/runtime/WishfulClaw.sln` 零错误；`VisibleScopes` 缺省值为 null（= 默认可见），`IsCore` 缺省值须显式定（建议 false + 例外名单，见 R-3.C-bis），不引入"未声明即拒绝"。　✅ `VisibleScopes`＋`IsCore` 已进 `ToolDefinition` 并打通四处注册路径（`IToolExecutor` 默认成员 → `ToolRegistry` ×2 → `ToolDefinitionPlaceholder` → `ToolTypes` record 末位带默认值，旧位置构造不破坏）。缺省 `VisibleScopes=null`＝默认可见、`IsCore=false`。`ToolDeclarationChecks` 覆盖缺省语义／占位透传／注册表透传／无分类工具四组。
- [x] R-3.2：实现唯一判定入口（R-3.D 算法）＋ `ctxStr` 单点渲染（`<scope>:<mode>[@<role>]`）。验证：对 R-3.C 的 **13 个**场景（含 6a/6b 拆分）各渲染一个串，与表一致；`unknown`/`unknown@automation` 两个串都能渲染。　✅ `ToolVisibilityPolicy` 为唯一判定入口，`RenderContext` 为 `ctxStr` 唯一渲染点；`ToolVisibilityChecks.RunContextStringSuite` 是 R-3.C 十三场景的可执行副本，逐串断言。
- [x] R-3.3：把准入决策从 A 类硬编码表迁到新声明，`AgentRunContextPolicy.cs` 保留为唯一强制层。验证：`IsToolAllowed:199-222` 与 `FilterToolDefinitions:224-248` 的重复判断收敛为一处；对每个 preset 出前后可见集差异表（B 口径下**差异必须为空**）。　✅ `ChannelOnlyTools`（22 个名字）已从强制层删除，改为注册期 `ToolVisibilityScopes.ChannelOnly` 声明；`IsToolAllowed` 收敛为「`Evaluate` → Blocked/Declared/DefaultVisible」三段，声明命中即准入、未声明才走会话档规则。**零变化已用机器证明**，见 R-3.H ①。
- [x] R-3.4：**黑名单显式排除渠道三工具**（R-3.D 收窄 1，B 口径下属零变化）。验证：渠道会话下 `visualize_show_widget`/`AskUserQuestion`/`ExitPlanMode` 不可见，且与 `PromptBuilder.cs:326-327` 承诺一致。　✅ 三件在 `ToolVisibilityPolicy.ChannelExcludedTools` 单点定义，且黑名单优先级高于声明（`ToolVisibilityChecks` 用 `["*:*"]` 声明反证）。
- [x] R-3.5：**`use_capability` 三动作全部受管**（R-3.D 收窄 2 + 老大 2026-09-11 追加裁定）——`call` / `inspect` / **`list`** 三条路径**必须走同一套可见性判定**。现状实读：`call`（`AgentRuntimeUseCapabilityExecutor.cs:322-327`）与 `inspect`（`AgentRuntimeUseCapabilityEncoding.cs:115-133`）**已调 `IsToolAllowed`**，**唯 `list` 缺**（`AgentRuntimeUseCapabilityDiscovery.cs:148-153` 只调 `IsAvailableInMode`，而后者对未声明 `availableModes` 的工具直接返回 true）。MCP/Extension 显式处理——不进核心集，范围由注册来源兜。验证：① `list` 与 `call`/`inspect` 对**同一个工具**给出**一致**的可见性判定（构造 `project:cowork@subagent` + 浏览器工具这一组反例，三者须一致拒绝）；② `list` 的 `categories` 分组统计也基于收窄后集合；③ 两条投递路径行为一致，无静默放行。　✅ `list`/`inspect`/`call` 三动作现共用 `AgentRuntimeUseCapabilityDiscovery.IsProxyBuiltinVisible` 一个谓词（其内部即 `IsToolAllowed`），三载体同源同裁由构造保证而非约定。
- [x] R-3.6：**子 Agent 排除浏览器类**（R-3.D 收窄 4，B 口径下属零变化）。验证：① `project:cowork@subagent` 下 9 个浏览器工具全部不可见；② 同档下 `use_capability action="list"` **也查不到** `browser` 类（与 R-3.8d 合并验证，这是修复后的必然结果）；③ `global:chat@subagent` 的全局集合收束**本次只声明、不启用**（收窄 6 属行为变更，留下一步），故本步只验证浏览器排除；④ 宿主 `project:cowork` 自身浏览器工具不受影响、`list` 仍能查到。　✅ 收窄 4 以显式黑名单落地：`category=="browser"` × `subagent`/`goalsubagent` 在 `IsGloballyExcluded` 拒绝，宿主档不受影响；同一谓词使 `list` 同步查不到。`global:chat@subagent` 的收束本次不动（现状已由 `GlobalChatTools` 白名单兜住）。
- [ ] R-3.7：**核心工具集机制**（R-3.C-bis）——① `IsCore` 落地并接线到 `PromptBuilder`；② `BuildToolCapability()` 改为**接收会话上下文**、只输出本档可见的**核心**工具；③ proxied 类不再出现在提示词的直接列表。验证：① 提示词中 category 数从 **27** 降至核心集规模（目标 ≤ 8）；② 同一会话的提示词中**不含**任何 proxied 类；③ 全局会话的核心集与项目协作不同（如全局列 PM 工具）；④ `use_capability` 的 `action="list"` 仍能查到被移出提示词的工具——**且必须是与 description 一致的本档集合**（老大追加裁定：三载体同源同裁；验证时对 description 的分类清单、`list` 的返回、提示词的核心集做**三方比对**，不得出现任一漂移）。**B 口径下本次"名单等价现状"**：只改结构不改内容，行为零变化；名单收窄留下一步。　⛔ **本步整体转后继需求**（机制与名单在提示词侧不可切分，理由见 R-3.H ②）。`IsCore` 字段本次已按 R-3.1 落地，但 `PromptBuilder.BuildToolCapability()` 未接，故该字段当前**只声明、无消费方**。
- [x] R-3.8：**定义「需人类在场的交互工具」共用集合**（R-3.D 合并说明）——渠道档与后台定时档共用一份，含 `AskUserQuestion`/`ExitPlanMode`/`visualize_show_widget`。验证：两处引用同一来源，全仓该三件名单只出现一次定义。　✅ 共用集合＝`ChannelExcludedTools`，全仓该三件名单只此一处（已复搜 `visualize_show_widget`/`ExitPlanMode` 的 .cs 命中确认）；后台定时档的复用留下一步（R-3.H ③）。
- [x] R-3.8b：**`use_capability` 的 description 带上「支持哪些分类」**（R-3.C-bis 关键推论，老大强调）——① 从 `ToolCategoryCatalog` × `ProxiedCategories` 的**交集**动态生成类名清单（零硬编码）；② **按档位过滤**（与 `list` 共用同一条可见性判定）；③ 替换 `UseCapabilityToolProvider.cs:36-39` 现有的 "such as mcp, skill, project, desktop, or goal" 手写举例。验证：① 描述中出现全部 proxied 类名（如 `browser`，老大举的例子）；② 渠道/子 Agent 档下被排除的类**不出现**；③ 与提示词 `<tool_calling>` 段共用同一来源，无手工维护的第二份清单；④ **与 `action="list"` 的实际返回逐项一致**（本步与 R-3.5 是同一收窄的两个出口，须同批验证，防止 description 按档、list 全量的漂移）。
- [x] R-3.8c：**修掉三处分类学矛盾**（R-3.C-bis 对照发现）——① `task` 归核心集，**从 `ProxiedCategories` 移除**；② `goal` 类**整体进 proxied**，`ProxiedBuiltinTools` 收敛；③ **`browser` 加进 `ProxiedCategories`，并从 `ToolPreset.cs:53,68,83` 三处 preset 白名单移除**（老大定性：浏览器属插件提供，与 MCP 同类，须经 `use_capability` 获取）。验证：① `ToolCategoryCatalog` 的 priority ≤ 70 集合与 `ProxiedCategories` 交集仅剩 `capability` 入口自身；② `goal` 类 10 个工具全部只经 proxy 可达；③ 三处 preset 白名单不再含 `browser`，且浏览器工具仍可经 `use_capability` 取到（**可见面不变**）。　✅ **三处已全部落地**：`ProxiedCategories` 现含 `goal`、`browser`，已移除 `task`。但**必须与 R-3.H ③ 连读**——③ 只落了"进 proxied"这一半，"出 `ToolPreset.cs:53,68,83` 三处白名单"那一半被快照拦下并已回滚，作为 S-7 单独立项。
- [x] R-3.8d：**在 proxy 的 `list` 上实现收窄**（R-3.D 收窄 4 的生效点，**本轮从"验证"升级为"实现"**）——`browser` 进 proxied 后，若只在直连工具列表过滤，子 Agent 仍能经 `use_capability` 取到浏览器。**实读已确认当前就是缺的**：`BuildCapabilitySummaries`（`AgentRuntimeUseCapabilityDiscovery.cs:148-153`）的过滤链只到 `IsAvailableInMode`，未调 `IsToolAllowed`，而 `IsAvailableInMode` 对未声明 `availableModes` 的工具直接放行。**修法**：在该过滤链补 `!AgentRunContextPolicy.IsToolAllowed(runContext, name, category, channelSession)`（`runContext`/`sessionMode`/`channelSession` 已在签名内，无需改调用链）；`EncodeBuiltinInspectResponse` 已正确，**两者共用同一判定**。验证：① `project:cowork@subagent` 下 `use_capability action="list"` **查不到** `browser` 类，而宿主档能查到；② `list` / `inspect` / `call` 对同一工具判定一致；③ `categories` 分组统计同步收窄。　✅ 与 R-3.5 同一改动的另一出口：`BuildCapabilitySummaries` 过滤链已调 `IsProxyBuiltinVisible`，`categories` 分组统计同源收窄。
- [ ] R-3.9：渠道工具开关接真作为收窄层，作用在统一判定之后（只减不增）。验证：C# 侧有真实读取点；关闭某工具后 `use_capability` 与系统提示核心集两条通路都被收窄。　⛔ 转后继需求，并与 R-2 的渠道文件改动同批做（两节共用四个文件，不得并行）。见 R-3.H ③。
- [ ] R-3.10：改造必改回归测试 3 组（R-3.E ⑤ 的三个文件）。验证：三组全过；测试内不再复刻工具名清单。**新增第 4 组**：提示词核心集快照测试（断言 category 数与不含 proxied 类）。　⛔ 随 R-3.7 一并转后继需求（提示词核心集快照测试无对象可断言）。R-3.E ⑤ 三组本身的改造随收窄工作同批。
- [x] R-3.11：清理 `AgentRunContextPolicy.cs:62` 等硬编码清单（含 `DesktopScreenshot`/`BrowserScreenshot`，与 R-4 交界）。验证：A 类硬编码表命中数下降至只剩声明入口。　✅ A 类硬编码表命中数已降至只剩会话档白名单：`AgentRunContextPolicy` 现存 `SharedChatTools`/`ProjectChatTools`/`GlobalChatTools` 三张（其存在理由见该文件 `IsAllowedByChatAllowlist` 的 XML 说明——MCP/skill 动态注册工具没有注册点可声明，只能按名兜），`ChannelOnlyTools` 与渠道交互黑名单均已迁出。
- [x] R-3.12：**记账"两条任务通道的分离事实"**（R-3.F 澄清表）——① 全局任务（重，`send_work_request` + `reply_global_dispatch`）与 ② 临时任务 Todo（轻，`send_session_message` + 倒计时自读）是两套独立机制，**本次不动**，写入需求/进度文档备查。（原「回执链路待核查」已由该澄清关闭。）　✅ 记入 R-3.H ④。
- [x] R-3.13：**记账"下一步需求"的待办**——明写 R-3.7（定时任务两类落地）、R-3.10（显式化 early-return）、R-3.6②（`global:chat@subagent` 收束）、R-3.7③（核心集名单收窄）四项均属**行为变更**，B 口径下本次不做，须在 `raw-requirements.md` 与进度文档中立为后继需求，**不得丢失**。　✅ 记入 R-3.H ②③，并已同步 `raw-requirements.md`。

> **B 口径下的"零变化"自检**：把上面所有本次要做的步骤跑完后，**任一档位的可见工具集合与提示词内容都应逐字节等价于改动前**。若出现任何差异，说明该处本质是行为变更，应移入后继需求。

#### R-3.H 执行记录（2026-09-12 凌晨，无人值守）

**① 零变化是怎么被证明的——不是目视，是快照门禁**

`ToolPreset.BuiltIn` × 7 个 preset × 13 个 R-3.C 场景 = 91 个「档位 → 可见工具名有序列表」，序列化成一份 31 270 字符的摘要，落库为 `tests/WishfulClaw.ProviderHeaderRegressionTests/visibility-snapshot.expected.txt`，由 `Program.Main` 每次跑测试时经 `VisibilitySnapshot.AssertMatchesGolden` 复核。取基线的方式是**开一个 worktree 检出 R-3 动手前的提交**（`0ee4bf62`，只额外放入摘要工具本身），两边各出一份摘要再 diff——不是"改完看一眼觉得没变"。

- 基线摘要与当前摘要 **逐字节相同（31270 = 31270，diff 空）**。
- 过程中出现过一次真实破口：`ToolPreset.cs` 里把 `browser` 从 `chat`/`coding` 白名单摘掉（R-3.8c③ 的内容）会让 91 格里若干格少 6 个工具。隔离实验确认该 hunk 是唯一差异来源后**已把它整体回滚**，`ToolPreset.cs` 现与 HEAD 一致。无人值守时不赌"这个收窄大概没人依赖"——能力静默消失属于必须单独立项的行为变更。
- 摘要不覆盖 `use_capability` 的 `list` 输出（它不在 registry 定义集合里）。该出口的收敛由 `ToolDeclarationChecks.RunCapabilityCatalogSuite` 单独断言（description／`list` 分类目录／子 Agent 档三组）。

**② R-3.7 为什么整体推走，而不是"只做机制"**

计划原话是"`IsCore` 字段 + `PromptBuilder` 按档输出本次做，名单收窄留下一步，用等价现状的名单让提示词行为不变"。落到代码上这两半分不开：`BuildToolCapability()` 现在输出的是 `ToolCategoryCatalog.All` 全 27 类，"按档输出核心集"必然改变 `<tool_calling>` 段的字节内容；要让字节不变，只能给它加一个**永远传全量**的参数，并让 `IsCore` 停在无人读取的状态。那是假接线，还会在勾上 R-3.7 后留下一个看不出缺口的绿勾。**裁定：R-3.7 连同提示词核心集快照测试（R-3.10）整体转后继需求**，与核心集名单同批做——它们本来就必须同时落地才有意义。`IsCore` 字段仍按 R-3.1 落进声明链，状态明确记为"已声明、暂无消费方"。

**③ 转后继需求的行为变更清单（R-3.13 的账，不得丢失）**

| # | 待办 | 为什么会变行为 | 前置 |
|---|---|---|---|
| 1 | `browser` 出 `ToolPreset.cs:53,68,83` 三处 preset 白名单（R-3.8c③ 的**另一半**） | 91 格快照中 chat/coding 档各少 6 个直接工具，属能力面变更 | 前置已满足：`browser` 本次已进 `ProxiedCategories`，摘掉白名单后仍可经 `use_capability` 取到 |
| 2 | ~~`task` 出 `ProxiedCategories`、`goal` 整体进 proxied~~ **——本次已随 R-3.8c①② 落地**；后继只剩"是否连 `ProxiedBuiltinTools` 三件名字一起收敛" | 已发生的差异：`list` 与 description 的 `goal` 类条目变多（见 R-3.H ⑤） | — |
| 3 | 定时任务 6b 后台档落地 `unknown@automation` ＋ 三类收窄（R-3.D 收窄 3、R-3.C 6b） | 现状走 `runtimeRole:"automation"` 全放行；收窄后浏览器／渠道专用／交互三件从该档消失 | 前端 `cron-runtime.ts:476-495` 需真的发 `scope:"unknown"`（当前由 `runEvent.scope` 推断），交互工具共用集合已为此备好单一来源 |
| 4 | `global:chat@subagent` 继承全局限制（R-3.6② / 收窄 6） | 全局 PM 的子 Agent 将拿不到写/执行类工具 | 现状已被 `GlobalChatTools` 兜住，改动点在"声明替代白名单" |
| 5 | `FilterToolDefinitions` 的 `BypassesChatAllowlist` 短路显式化（R-3.10） | 该短路正是"cowork／goal／automation 看得到渠道专用工具"的现存泄漏点（`preset=full` + `project:cowork` 实测含 `ChannelSendImage` 等 22 件）——**这是改动前就有的 Bug，本次刻意不碰** | 显式化即修复，属行为变更 |
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

### 需求 R-4：正式版使用指引与 README 拆分

原始需求见 `raw-requirements.md` R-4 节：README 拆成用户指引 + 开发 README、功能全量罗列、截图（整桌面截软件本身）、关于页按钮与顶栏问号图标双入口指向 GitHub 指引。勘查见 `exploration_findings.md` 第 6 节。

- [ ] R-4.0：出 Plan（本节）＋ 定《使用指引》在仓库中的存放路径与文件名。验证：README 拆分后的两份文件均有明确路径，且仓库根 README 指向用户指引。
- [ ] R-4.1：README 一分为二——根 `README.md` 面向用户（功能全量罗列），开发向 README 另起一份。验证：两份文件中不再混放对方内容；链接互指正确。
- [ ] R-4.2：URL 单点定义——GitHub 使用指引地址收敛为一处常量，关于页与顶栏两处引用。仓库地址 `https://github.com/wishful-73/wishful-claw`。验证：全仓该 URL 字面量只出现一次定义处。
- [ ] R-4.3：顶栏问号图标——插入 `TitleBar.tsx:94-138` 现有图标组**左侧**（`hasProject` 块之前），沿用现有按钮类名与 `<Tooltip side="bottom">`。验证：`tsc` 三配置；`hasProject` 真/假两态下图标位置与拖拽区不冲突。
- [ ] R-4.4：关于页新增按钮——落点 `SettingsPage.tsx` 的 `AboutPanel()`，样板沿用现有 `SettingsSection id="sec-about-updates"`。验证：`tsc` 三配置；点击后走 `setWindowOpenHandler` → `shell.openExternal`，不在应用内打开。
- [ ] R-4.5：配图产出——用现成 `DesktopScreenshot`（`AgentRuntimeDesktopExecutor.cs:26,81-104`）截软件自身界面。**硬前置：清场 + 脱敏**，不得含凭据、完整用户路径或真实用户数据。图片落盘走 `image:persist-generated`（`misc-handlers.ts:268-277`，落点固定 `~/wishful-claw/image/`），再手动移入仓库文档目录。验证：逐张目视确认无敏感信息；文件名与文档引用一一对应。
- [ ] R-4.6：功能罗列粒度定稿（依赖 R-4.0）。验证：对照 `ABOUT_FEATURE_KEYS` 7 项与设置页各面板，无遗漏主能力。

⚠️ 本项截图能力与 iter-27 的 `evidence/*.png` 未产出缺口是同一块肌肉，`docs/progress/v2-iter-27.md:29` 记账不得因本项而划完成。

### 收尾：统一审查、验证与修复

- [ ] Z1：全量审查本迭代 7 项改动 → `review_report.md`；发现的修正**不单独提交**，攒进收尾那次 `fix(迭代28): 审查与验证修复调整`。
- [ ] Z2：按各项验收标准出 `verification_report.md`，PASS/FAIL/PARTIAL 如实记账，FAIL 由 agent 修完再记。
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
