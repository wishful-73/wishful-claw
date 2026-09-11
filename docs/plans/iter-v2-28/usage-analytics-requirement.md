# v2-iter-28 候选需求：模型调用统计与请求明细

- 状态：**范围已确认**（2026-09-11 老大拍定核心口径，见第 0 节；尚未排期规划）
- 归属：`v2-iter-28`
- 需求类型：可观测性补齐 —— 新增模型请求日志 + 统计基于该日志聚合
- 记录方式：只读调研，本文所有结论均有 `文件:行号` 证据，实现前需按当期代码复核行号

## 0. 范围决议（2026-09-11 老大拍定）

1. **新增一层「模型请求日志」，统计一律从这份日志聚合。** 不复用 `messages.usage`，原 6.1 的 B 方案（先拿回合级数据出面板）**作废** —— 先打地基，口径只留一条链。
2. **日志形态 = SQLite 结构化表**，一次 HTTP 请求一行。面板下方的"今日请求明细"就是这张表的可读视图；不做 JSONL 文件日志，也不做表 + 文件双写留档。
3. **失败与被重试的请求全量入表**，每次尝试独立成行，成功失败都落。
4. **现有会话级统计 `db/messages-usage-stats` 保留原样**（唯一消费方是 IM 群命令统计），新面板不接它。代价：仓库长期存在两套 token 口径（回合累计 vs 单次请求），面板需明示本面板为请求口径。
5. **成本要展示，但只按模型上显式配置的价格相乘；没配价格就没有该项成本，不做倍率与缺价推算。** 现有会话统计本身不算成本，可复用的是它 `:186` 的 billableInput 与 `:193` 的 requestTimings 两套口径，详见 6.4。
6. **统计按来源分维**，直接用 C# 现成的 `RuntimeRole`，无需新增字段，详见第 10 节结论 3。
7. **请求日志先行**，Plan D（多服务商 fallback）排其后。
8. **桌宠线挂起**，本需求不承接宠物经验值修复。

## 1. 原始需求

看模型的使用情况：

1. **24 小时 / 7 天 / 30 天**三档模型统计；
2. 面板下方一份**今日请求明细日志**。

## 2. 现状实测：数据分三档

### 2.1 已有结构化数据，可直接聚合（不用改后端）

每次模型请求的 usage 在 C# 侧已完整解析，随 `message_end` 流到渲染端合并累计，最后以 JSON 落在 SQLite `messages.usage` 列。

- 解析点：`src/runtime/WishfulClaw.Agent/AnthropicMessagesEventParser.cs`（`input_tokens` / `output_tokens` / `cache_read_input_tokens` / `cache_creation*` / `reasoning_tokens`）、`OpenAIChatSseParser.cs`、`OpenAIResponsesEventParser.cs`
- 快照结构：`src/runtime/WishfulClaw.Agent/Models/ProviderDebugModels.cs` → `AgentRuntimeTokenUsage`（含 `CacheReadRatio`、`SessionCacheHitTokens/MissTokens`、`UsageSource`）
- 渲染端累计：`src/renderer/src/lib/agent/usage-merge.ts:58-93`（`accumulateUsageSnapshot`，tokens 累加、`requestTimings` 追加）
- 落库：`src/renderer/src/stores/chat-store/db-helpers.ts:136` → `src/runtime/WishfulClaw.Infrastructure/Db/DbMessageTools.cs:24`
- 表结构：`src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs:115-124`，`usage` 列由 `:494` `EnsureColumn("messages","usage","TEXT")` 迁移补上
- 已有的按会话聚合端点：`DbModule.cs:56` 注册 `db/messages-usage-stats` → `DbMessageCompactTools.cs:56` `UsageStats` / `:173` `TryAddUsage`；目前**唯一消费方是 IM 群命令统计** `src/main/channels/plugin-command-stats.ts:24-25`，没有 UI

结论：**按时间窗聚合 token / 请求量的数据是现成的**，回合级统计口径可以先出面板不动后端。

### 2.2 有数据但未持久化

- 缓存命中率：`src/runtime/WishfulClaw.Agent/SessionConversation.cs:70-98` 的 `_sessCacheHit` / `_sessCacheMiss` 是 `private long` + `Interlocked`，`Initialize` 时 `ResetCacheTotals()` 清零 → **纯内存、重启即丢、不落库**，只随实时快照送到输入框状态条（`InputArea/runtime-status.tsx`、`AssistantMessage/use-completion-summary.ts`）。
- 累加点在三家 Provider：`AnthropicMessagesProvider.cs` / `OpenAIChatProvider.cs` / `OpenAIResponsesProvider.cs`。

### 2.3 完全没有，且无法从现有数据反推

**请求级明细不存在。**

- `messages.usage` 是**一整轮的累计**：一次用户回合里 tool loop 有 N 次 HTTP 请求，N 份 usage 被合成一份，请求之间的归属丢失。
- `RequestTiming`（`src/renderer/src/lib/api/types.ts:58-65`）只有 `totalMs` / `ttftMs` / `tps`，**没有每次请求的 token，也没有独立时间戳**。
- `messages` 表没有 `model` / `provider` / `status` / `error` / `retry` / `request_id` 列；provider 与模型归属只在 `sessions` 表（会话级），**中途换过模型的会话反推不出当时用的谁**。
- 日志侧也不能当明细用：`src/main/lib/logger.ts` 输出的是 `[时间] [LEVEL] [source] 文本` 拼接，只有 `extra` 才是 JSON，**半结构化不可索引**；端点为 `src/main/index.ts:546/553/560` 的 `log:list-files` / `log:read-file` / `log:cleanup`。Worker 的 usage 只以人读字符串散在 stderr。

## 3. 关键发现：仓库里已有一套未接线的用量分析层

`src/renderer/src/lib/usage-analytics.ts`（372 行，头部标注 Ported from OpenCowork）已实现：

| 能力 | 位置 | 状态 |
|---|---|---|
| 写入单条用量事件 | `:189` `recordUsageEvent` | 有实现，**调用即失败** |
| 时间窗概览 | `:292` `getUsageOverview` | 通道无后端 |
| 按日聚合 | `:299` `getUsageDaily` | 同上 |
| 时间轴（hour / day 分桶） | `:306` `getUsageTimeline` | 同上 |
| 按模型 / 按服务商 | `:316` / `:323` | 同上 |
| 明细列表 / 清理 | `:330` `listUsageEvents` / `:334` `clearUsageEvents` | 同上 |
| activity 四查询 | `:338-372` | 同上 |
| 成本计算 | `:140` `computeCosts`（读 provider 价格字段） | 有实现 |
| provider/模型归属推断 | `:82` `resolveProviderAndModel` | 有实现 |

配套：`src/shared/messagepack/binary-ipc.ts:105-116` 定义了 12 个通道常量（`usage-events:add/overview/daily/timeline/by-model/by-provider/list/clear` + `usage-activity:*` 四枚）。

**但后端半边完全不存在：**

- `src/main` / `src/preload` 中 `USAGE_` 与 `usage-events` **0 命中**，没有任何 handler；
- `usage_events` 表在全部 C# 与 TS 中 **0 命中**；
- 渲染端白名单 `src/renderer/src/lib/ipc/messagepack-channel-routing.ts` 无 usage 条目，准入判定在 `:423` `argCount <= 1 && MESSAGEPACK_INVOKE_CHANNELS.has(channel)` → 通道直接被拒。

**由此带出一个现存缺陷：桌面宠物按 token 换算的经验值恒为 0。** 断点有**两处**，不是一处（2026-09-11 实测修正）：

1. `recordUsageEvent` 有三个真实调用点 —— `src/renderer/src/lib/pet/pet-agent.ts:222`、`src/renderer/src/stores/translate-store.ts:279,313` —— 全部在 `await invokeMessagePackBinary(USAGE_EVENTS_ADD_MSGPACK_CHANNEL, ...)`（`usage-analytics.ts:242`）处失败，后端半边不存在。
2. 更要紧的是 `accruePetExpFromUsage`（`usage-analytics.ts:235`）位于那次失败**之前**，且是 `void` + 自带 try/catch，所以它每次都真的执行了 —— 经验值仍为 0 是因为它走的 `pet:exp-add` 通道**同样没有主进程 handler**（见第 10 节）。

## 4. 缺的后半边在参考项目里有现成实现

`D:\claw\OpenCowork`（本地副本，只读参考）：

| 资产 | 路径 | 规模 |
|---|---|---|
| 写入工具 | `sidecars/OpenCowork.Native.Worker/Modules/Db/DbUsageWriterTools.cs` | 398 行 |
| 查询分析工具 | `sidecars/OpenCowork.Native.Worker/Modules/Db/DbUsageAnalyticsTools.cs` | 564 行 |
| 建表与索引 | `sidecars/.../Db/DbSchemaMigrator.cs:628-717` | 见下 |
| 主进程 dao（不照抄） | `src/main/db/usage-events-dao.ts` | 225 行 |
| 面板 UI | `src/renderer/src/components/settings/panels/AnalyticsPanel.tsx` | 567 行 |
| 概览 UI | `src/renderer/src/components/settings/AnalyticsOverview.tsx` | 701 行 |

表结构含 `usage_events`（42 列，请求级：provider/model/各类 token/四类价格/四类成本/ttft/total/tps/provider_response_id/debug json/raw usage json/meta）+ 5 个倒序索引（created_at、provider+created_at、model+created_at、session+created_at、source_kind），另有三张预聚合表 `usage_activity_daily`、`usage_activity_daily_models`、`usage_activity_daily_providers`。

**OpenCowork 的面板形态与需求逐字对应**：`AnalyticsPanel.tsx:37` `rangeDays = 1 | 7 | 30`，`:72` 选 1 天时 timeline 按 `hour` 分桶否则按 `day`，`:300-308` 三档切换按钮，`:513` 底部就是明细表。

## 5. 移植的两个硬判断（不能照抄之处）

### 5.1 DB 层位置不同

本项目 DB 访问已下沉到 C# Worker，OpenCowork 的 `usage-events-dao.ts` 在主进程。所以要把 dao 逻辑改写成 `WishfulClaw.Infrastructure/Db/` 下的工具，经 `DbModule` 注册，并遵守 AOT 约束：新增具名 DTO 同时注册进 `InfrastructureJsonContext` 与 `WishfulClawJsonContext`（含 `List<T>` 泛型版本），`WorkerResponse.Json` 显式传 `JsonTypeInfo`。

现成模板链路（以 `db/messages-list` 为例）：renderer `workerRequest('db/...')` → `src/preload/index.ts:43-45` → `src/main/ipc/misc-handlers.ts:52-72` 通用转发（`db/*` 不需进 messagepack 白名单）→ `WorkerDispatcher` → `DbModule.cs` `context.Register(...)` → `WorkerResponse.Json`。**走这条 `workerRequest` 通道比补 12 个 messagepack 通道 + 白名单更省**，需要决策（见 6.2）。

### 5.2 写入点必须在 C# 每请求结束处

OpenCowork 在渲染端回合结束调 `recordUsageEvent`，那是**回合级**。要做"请求明细"必须在三家 Provider 的 `message_end`（或等价的单次请求收尾处）产出事件 —— 因为只有那一层知道本次请求实际用的 model、成功还是失败、重试了几次、token 明细。渲染端拿不到"这轮第 3 次请求失败重试过"。

代价：写入路径从渲染端移到 C#，`recordUsageEvent` 里的 provider/模型归属解析与成本计算（`resolveProviderAndModel` / `computeCosts`）需要在 C# 侧重建或改为写入时只存原始值、查询时再算成本。

## 6. 取舍决议与剩余待确认

### 6.1 明细粒度 —— ✅ 已定：A

- **A 真·每次 HTTP 请求**：要动 C# 三个 provider 出口 + 新增表 + 成本解析下沉。**老大 2026-09-11 选定此项**，理由见第 0 节第 1 条。
- ~~B 先做回合级~~：作废。原建议"B 先出面板、A 作第二个 Plan"已被否决 —— 不要先出一个口径不对的面板再返工。

### 6.2 通道形态 —— 🔵 默认采纳（提出后未反对，非明确拍定）

走 `workerRequest('db/usage-*')`，与现有 `db/*` 端点同构：renderer → `src/preload/index.ts:43-45` → `src/main/ipc/misc-handlers.ts:52-72` 通用转发 → `WorkerDispatcher` → `DbModule` 注册。省掉补 12 个 messagepack 通道 + 渲染端白名单。

沿用已有的 12 个 `usage-*:msgpack` 通道这一选项作废 —— 写入方已移到 C#（5.2 与第 10 节），`usage-events:add` 本就不需要，剩下的查询通道也没有非走 messagepack 不可的理由。

### 6.3 故障归因字段 —— ✅ 已定：预留

随第 0 节第 3 条（失败全量入表）一并成立：表需含 `status` / `error_kind` / `attempt_index`，并预留 `switched_from_provider_id` 给 Plan D 的多服务商降级归因。否则日后要看重试率与降级效果需再迁一次数据。

✅ 遗留已解（2026-09-11）：**请求日志先行**，Plan D（多服务商 fallback，27 整块移交未实施）靠后。故 `switched_from_provider_id` 等降级归因列**只预留不填**，等 Plan D 落地再补写入 —— 两者共用同一批 C# provider 出口，不并行改同一段代码。

### 6.4 成本展示 —— ✅ 已定：展示，口径参考现有会话统计做法

实测前提（决定"参考"能参考到什么程度）：

- **现有会话统计完全不算成本。** `DbMessageCompactTools.cs:56` `UsageStats` 只累计 token 与耗时，`MessageUsageStatsResult` 末位恒传 `null`（`:94`）；`AgentRuntimeTokenUsage`（`ProviderDebugModels.cs:25-40`）**无任何价格字段**。成本是全新口径，不能指望继承。
- **但它已有的两套口径正好可复用**，风格也照它来（`JsonDocument` 直读字段、不做类型化 DTO）：
  - `:186-187` 已在 C# 复刻 `getBillableInputTokens`（`billableInput ?? max(0, input - cacheRead - cacheCreation)`），与 `format-tokens.ts:41-52` 一致。
  - `:193` + `:202-207` 用 `requestTimings` 数组长度算 `RequestCount` —— **这就是现成的"请求数"口径**，新日志表按行计数后应与之吻合，可作交叉验证。
- **价格在 C# 侧可达**：`src/runtime` 全量 .cs 中 `inputPrice` 零命中（无强类型字段），但 `ProviderStore.cs` 全程用 `JsonNode`（`:38` / `:50` / `:264`），可按 modelId 索引取价；磁盘实测 `~/.wishful-claw/ai-provider/*.json` 有 10+ 个文件含 `inputPrice`，即启用后的 provider 配置**带着价格落盘**。
- **填值率**（`src/renderer/src/stores/providers/*.ts`，531 个 `name:` 条目）：`inputPrice` / `outputPrice` 各 349（约 66%）、`cacheHitPrice` 205（约 39%）。缺口集中在本地/免费端点 —— `ollama`、`lmstudio`、`huggingface`、`cerebras`、`groq`、`fireworks`、`nvidia`、`ppio`、`stepfun`、`volcengine`、`modelscope` 全为 0；主流付费端点基本全覆盖（`openrouter` 56/57、`openai` 29/32、`siliconflow` 25/26、`moonshot` 15/17、`anthropic` 9/10）。

**✅ 成本口径定稿（老大 2026-09-11）：只按模型上显式配置的价格相乘，没配就没有，不做任何推算。**

- 四项成本各自独立：`input_cost = billable_input × inputPrice / 1e6`、`output_cost`、`cache_creation_cost`、`cache_hit_cost` 同理。**对应价格列为 null 时该项成本留 null，不回填、不显示 0。**
- **不移植 `resolveCacheCreationCost`**（`format-tokens.ts:172-205`）—— 它的 `inputPrice × 1.25`（缺 cacheCreationPrice 时）、`inputPrice × 2`（1 小时 TTL 桶）、缺价回退、以及 `getCacheCreationSplit` 的 5m/1h 分桶**全部不要**。连带地，表也**不需要 `cache_creation_5m/1h` 两列**，只存合计的 cache creation tokens。
- `total_cost_usd` = 上述四项中**非 null 项之和**；四项全 null 则 total 为 null。
- 落点随口径一并定：**C# 写入时算并落列**。去掉倍率推算后只剩"读四个价字段 + 乘除"，移植代价几乎为零，换来面板能直接 `SUM`、能按成本排序、价格有历史快照。原"查询时算"选项作废（那要捞回整窗明细才能聚合）。

⚠️ **呈现上必须交代清**：约 61% 的模型缺 `cacheHitPrice`、34% 完全无价。这类行的 total 只覆盖"配了价的那部分"，会**系统性低于实际账单**，面板需标"按已配置价格计"，不能让人当作应付金额。

⚠️ **`billableInput` 三处口径不一致，写钩子时别顺手抄错**：
- `format-tokens.ts:46-51` 与 `DbMessageCompactTools.cs:186-187`（现有会话统计）都是 `input − cacheRead − cacheCreation`；
- 但 `AnthropicMessagesProvider.cs:152-153`（还有 `OpenAIChatProvider.cs:147`、`OpenAIResponsesProvider.cs:94` 同一形状）的回退是 `input − cacheHit`，**少减了 cacheCreation**。
- 该回退值目前只喂给 `AccumulateCacheTokens`（`:156`），**没有回填进 `emitUsage`**，所以不影响已落库的 usage；但新写入钩子就在紧邻这几行的位置，务必显式采用 `:186` 口径，与现有会话统计一致，避免面板与 IM 群统计再分叉一套数。

### 6.5 排期 —— ✅ 已定

v2-iter-27 已于 2026-09-11 收尾发版（`v0.2.27`）。老大确认本需求纳入 `v2-iter-28` 且**请求日志优先做**，Plan D 排在其后。

## 7. 顺带记下的关联项

- `recordUsageEvent` 静默失败（第 3 节）—— 处置方式见第 10 节：本需求确定做请求级日志后，三处调用点直接删除，改由 C# 写入钩子覆盖。
- `quota-store.ts:3-5` 注释已自证"no backend quota system yet"，是纯内存态，只有 `ModelSwitcher/QuotaIndicators.tsx` 消费。本需求的统计表若上线，配额展示可以复用同一张表，避免再造一条链路。
- 日志页面（27 追加）与统计面板是两回事：日志是无结构文本，统计表是结构化数据，不要试图从 `.log` 里解析明细。

## 8. 规模粗估

| 路径 | 粗估 |
|---|---|
| ~~只做 B（回合级统计 + 面板，复用 `messages.usage`）~~ | **作废** —— 见第 0 节第 1 条 |
| A 请求级明细（唯一路线） | 三个 Plan：① 建表与 C# 写入钩子（三家 Provider 各一处，取同层已有的 `RuntimeRole`）② 查询端点（可大量参考 OpenCowork 962 行）③ 面板 UI（参考 1268 行）。成本落点已定为写入时算（6.4），且因砍掉倍率与 TTL 分桶，表可比参考项目的 42 列明显更窄，能复用的查询 SQL 打折扣 |

## 9. 验收标准草案（待细化）

1. 三档时间窗切换后，请求数 / input / output / cache read / cache creation / reasoning / 成本 概览随之变化；24 小时档的时间轴按小时分桶。
2. 明细列表在真机跑若干轮含工具调用的对话后，能出现**多条**记录且条数与请求数吻合（不是每轮一条）。
3. 重启应用后历史统计不丢。
4. 缓存命中率可按时间窗回溯，不再只在输入框实时闪现。
5. 中途更换模型的会话，明细中每条记录的模型归属正确。
6. 一次真机可复现的失败（如故意配错 key）能在明细里看到失败行，且 token 概览的请求数把它算进去。

## 10. 追加实测（2026-09-11 范围确认后）：三处上报点全部经 C#

第 3 节记的"渲染端 `recordUsageEvent` 静默失败"缺陷，在写入点下沉到 C#（5.2）之后处置方式已明确 —— 三处调用点的模型请求**本来就不直连 HTTP**：

| 调用点 | 来源标识 | 模型请求实际走哪 | 下沉后处置 |
|---|---|---|---|
| `src/renderer/src/lib/pet/pet-agent.ts:222` | `sourceKind: 'pet-chat'` | `runAgentViaSidecar(...)` → C# Agent Loop | 删 |
| `src/renderer/src/stores/translate-store.ts:279` | `sourceKind: 'translate'` + `meta.mode='agent'` | `runAgentViaSidecar(...)` → C# Agent Loop | 删 |
| `src/renderer/src/stores/translate-store.ts:313` | 同上 + `meta.mode='simple'` | `translate-service.ts:86` `streamSidecarProviderTurn(...)` → C# 单次 provider turn | 删 |

由此得三条结论：

1. **桌宠线整体挂起（老大 2026-09-11 决定），本需求不承接宠物经验值修复。** 实测事实留档备查：`accruePetExpFromUsage` 在失败点之前就已执行，经验值仍为 0 的真因是 `pet:exp-add` 连同整套 pet IPC（`pet-window:open` / `pet:sync` / `pet:tts-stream` / `pet:tts-cancel` / `pet:open-studio`）**只出现在渲染端白名单 `messagepack-channel-routing.ts:17-27`，`src/main` 的 117 个 .ts 里 "pet" 子串零命中，C# 侧同样零实现** —— 桌宠的持久化半边整体缺失，补 `usage_events` 后端不会顺带修好它。
2. **`usage-analytics.ts` 渲染端半边失去存在理由**：`recordUsageEvent` 及其 `resolveProviderAndModel`(`:82`) / `computeCosts`(`:140`) 应废弃或迁 C#，12 个 messagepack 通道里的 `usage-events:add` 不再需要。
3. **来源分维不需要新增字段 —— C# 侧的 `RuntimeRole` 已全覆盖。** 上一版称"`streamSidecarProviderTurn` 不带来源、要给翻译入口补字段"，实测**不成立，此处撤回**：

| 来源 | `runtimeRole` 取值 | 证据 |
|---|---|---|
| 普通会话 Agent Loop | `sessionagent`（未传时按 sessionMode 推导的默认分支） | `AgentRunContextPolicy.cs:161` |
| Goal 主跑 / 子 Agent / Goal 子 Agent | `goalrunner` / `subagent` / `goalsubagent` | `:158-160`、`GoalSubAgentExecutor.cs:102` |
| 桌宠 | `pet` | `pet-agent.ts:192` |
| 翻译（agent 模式） | `translation` | `translate-agent-service.ts:246` |
| 单次 provider turn（翻译 simple、技能审查） | `providerTurn` | `agent-bridge-streaming.ts:88`、`:273` |
| 自动化 | `automation` | `AgentRunContextPolicy.cs:17` |

该值在 C# 已参与真实业务判定（`:184` 的 switch、`:212` 的工具准入、`ToolCallProcessor.cs:215` 的报错文案），且三家 Provider 产出 usage 的位置（`AnthropicMessagesProvider.cs:161`、`OpenAIChatProvider.cs:156`、`OpenAIResponsesProvider.cs:103`）与之同层 —— **写入钩子就地可取，零额外改造**。

⚠️ **别把 `UsageSource` 当来源字段用**：`AgentRuntimeRunState.cs:63` 赋了默认值 `"executor"` 之后**全项目无任何一处改写它**，`ProviderDebugModels.cs:39` 注释宣称的 "executor"/"subagent"/"compaction" 是未接线的意图。它可当第二维度（同一请求内的工作类型），但要另开接线，不能白捡。

✅ 老大已确认**统计按来源分维**：写入钩子落 `runtime_role` 列即可，`sourceKind` 不必承载。`meta` 里的源/目标语言若要保留，另议。
