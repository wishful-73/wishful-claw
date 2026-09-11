# v2-iter-28 候选需求：模型调用统计与请求明细

- 状态：待老大确认范围（2026-09-11 记录现状结论与取舍点，尚未规划）
- 归属：`v2-iter-28`（候选，也可拆为独立小迭代）
- 需求类型：可观测性补齐 —— 模型用量统计面板 + 请求级明细
- 记录方式：只读调研，本文所有结论均有 `文件:行号` 证据，实现前需按当期代码复核行号

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

**由此带出一个现存缺陷（可与本需求一并修，也可单列）：** `recordUsageEvent` 已有两处真实调用 —— `src/renderer/src/lib/pet/pet-agent.ts:222`、`src/renderer/src/stores/translate-store.ts:279,313` —— 目前**全部静默失败**，桌面宠物按 token 换算的经验值实际上从未累计过。

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

## 6. 待老大确认的取舍

### 6.1 明细粒度

- **A 真·每次 HTTP 请求**：要动 C# 三个 provider 出口 + 新增表 + 成本解析下沉。工作量大，但明细日志成立，重试/降级/缓存命中率历史也顺带成立。
- **B 先做回合级**：现有 `messages.usage` 就能聚合出 24h/7d/30d 与按会话/项目的统计，UI 可先落地；"明细"退化成"本轮请求数 + 各次耗时"，无 token 拆分。
- 建议：B 先出面板满足"看统计"，A 作为同一迭代的第二个 Plan，避免一次性改动面过大。

### 6.2 通道形态

沿用已有的 12 个 `usage-*:msgpack` 通道（要补 handler + 补渲染端白名单），还是改走 `workerRequest('db/usage-*')`（与现有 DB 端点同构，无需动白名单）。后者与本项目分层更一致。

### 6.3 表结构是否预留故障归因字段

建议至少预留 `status` / `error_kind` / `attempt_index` / `switched_from_provider_id`，把失败、重试与多服务商降级归因一并进表。否则后续要看重试率与降级效果需要再迁一次数据。需确认与既有重试/降级功能的排期先后。

### 6.4 成本是否展示

`src/shared/types/provider.ts:231-237` 有 `inputPrice` / `outputPrice` / `cacheCreationPrice` / `cacheHitPrice` 四个字段，但**实际填值率未知**（多数 provider 可能为空）。若展示美元，需要同时决定空价格时的呈现（隐藏该列 / 显示"未配置价格"）。

### 6.5 排期

27 当前压着一大批真机复测（尤其 dev/生产目录隔离与真机升级链路），本文档倾向把本需求独立成 `v2-iter-28`，不与收尾混做。

## 7. 顺带记下的关联项

- `recordUsageEvent` 静默失败（第 3 节）—— 若本需求不做，也应单独修或明确关掉调用，否则宠物经验值一直是 0。
- `quota-store.ts:3-5` 注释已自证"no backend quota system yet"，是纯内存态，只有 `ModelSwitcher/QuotaIndicators.tsx` 消费。本需求的统计表若上线，配额展示可以复用同一张表，避免再造一条链路。
- 日志页面（27 追加）与统计面板是两回事：日志是无结构文本，统计表是结构化数据，不要试图从 `.log` 里解析明细。

## 8. 规模粗估

| 路径 | 粗估 |
|---|---|
| 只做 B（回合级统计 + 面板，复用 `messages.usage`） | 一个 Plan：新增 C# 聚合端点 + 面板 UI，无需新表 |
| A + B（真请求级明细） | 三个 Plan：① 建表与 C# 写入钩子 ② 查询端点（可大量参考 OpenCowork 962 行）③ 面板 UI（参考 1268 行） |

## 9. 验收标准草案（待细化）

1. 三档时间窗切换后，请求数 / input / output / cache read / cache creation / reasoning / 成本 概览随之变化；24 小时档的时间轴按小时分桶。
2. 明细列表在真机跑若干轮含工具调用的对话后，能出现**多条**记录且条数与请求数吻合（不是每轮一条）。
3. 重启应用后历史统计不丢。
4. 缓存命中率可按时间窗回溯，不再只在输入框实时闪现。
5. 中途更换模型的会话，明细中每条记录的模型归属正确。
