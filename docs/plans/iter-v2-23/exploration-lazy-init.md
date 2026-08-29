# 探索报告：惰性后端会话初始化（修复压缩会话失效）

> 日期：2026-08-29
>
> 任务来源：用户报告"压缩会话后再次发送新消息，之前的压缩会话失效"；排查发现进入历史会话会直接重建后端会话。目标：进入历史会话仅前端渲染，发送消息时才惰性初始化后端会话（空间不够先压缩 / 有快照用快照+增量 / 无快照常规全量）。

## 一、压缩失效根因链（已逐点核实代码）

### 根因 1（决定性）：压缩状态卡完成态 upsert 反向删除刚写入的快照

时序（每次压缩必然复现）：

1. `context_compression_started` 事件 → 渲染端 `recordCompressionStatusMessage` 落库状态卡（`meta.compressionStatus.state=compressing`）——`src/renderer/src/stores/chat-store/index.ts`（WIP 稳定 operationId 版本，未提交）。
2. 后端 `AgentLoop` 压缩成功后 `PersistSnapshot`（`AgentLoop.cs:226-259`）→ `DbCompactionSnapshotStore.UpsertSnapshot:123` 游标 = 事务内 DB 最新消息位置 → **状态卡就是游标锚点行**（它在快照写入前落库且位于转录末尾）。
3. `context_compressed` 事件 → 渲染端把同一张状态卡更新为完成态（meta 增加 completedAt/统计）→ `db/messages-upsert`。
4. `DbMessageToolsMutations.Upsert:89-116`：UPDATE 分支 `HasModelInputChanged:132-140` **逐字符串比较 meta** → meta 变化 → `InvalidateIfUpsertCovered(existingPosition)` → 位置 ≤ 游标 → **快照被删除**（`DbCompactionSnapshotStore.cs:60-69,89-96`）。

结果：压缩成功的瞬间快照即死。此后任何恢复都拿不到快照。

### 根因 2：全量恢复路径直接撤销压缩

快照失效后，`agent/restore-session` 走全量路径（`SessionRestoreTools.cs:118-142`）：

- messages 表中压缩点之前的旧消息完整保留（压缩从不删 DB 消息，已核实 `AgentLoop.cs` 压缩成功分支 + `ContextCompression.Persistence.cs`）；
- 全量恢复把旧历史全量灌回模型上下文；
- `IsChatOnlyArtifact:356-371` 只过滤 `compactBoundary` / `compressionStatus`，**不过滤 `compactSummary` 摘要消息** → 旧历史 + 摘要双份注入。

用户观察到的"压缩失效"即此：旧消息重新回到模型上下文。

### 放大因素 3：急切重建 + 竞态

- 进入会话即触发 `void workerRequest('agent/restore-session')`（fire-and-forget，`session-slice.ts:530`），与后续 `agent/run` 存在竞态；
- 触发点共 5 处：会话切换（`useMessageListScroll.ts:391`）、启动预载（`MainLayout.tsx:179`）、搜索跳转（`search-dialog.tsx:297`）、后台回前台（`session-runtime-router.ts:464`）、Cron（`cron-runtime.ts:377` 经 loadRecentSessionMessages）；渠道为显式 `await`（`use-channel-auto-reply.ts:199`）。

### 次要因素 4：水位线纯内存

`CompactionWatermark` 仅内存（`SessionConversation.cs:24`），`Append` 重置为 0；快照恢复路径会 `MarkCompactionWatermark`（`SessionRestoreTools.cs:166`），全量路径不设。保护主要靠 token 阈值门控，现状可接受，不在本次修改范围。

## 二、现有架构关键事实（惰性化设计依据）

| 事实 | 位置 |
|---|---|
| `agent/run` 时若 Worker 内存无该 session 的 `SessionConversation`，**不报错、不查 DB**，按首轮用前端本次发来的消息初始化（历史静默丢失） | `AgentLoop.cs:61-75`、`SessionConversation.cs:276-285` |
| `sendMessage` 全程不调 restore，只发新消息 + `agent/run` | `chat-store/index.ts:157-371` |
| AgentLoop 运行时 100% 依赖内存会话，从不读 messages 表 | `AgentLoop.cs` 全文件 |
| 自动压缩在每轮迭代开头判断，`lastInputTokens > 0` 门控 → **首轮 LLM 请求前永不压缩**（`lastInputTokens` 首轮后才有值） | `AgentLoop.cs:181-183,354-356` |
| 压缩阈值 `ShouldCompress` = min((contextLength−20000)×ratio, 有效窗口−13000) | `AgentLoop.cs:541-580` |
| token 估算工具已存在：`ContextCompression.EstimateMessagesTokens(conversation)` | `ContextCompression.TokenEstimation.cs:37` |
| 快照读取校验已有共享实现 `DbCompactionSnapshotTools.TryGetValidSnapshot`；端点 `db/compaction-snapshots-get/upsert/delete` 已注册但前端零调用 | `DbCompactionSnapshotTools.cs:61`、`DbModule.cs:63-65` |
| 恢复幂等守卫：`InitializeIfEmpty`（锁内判空+替换） | `SessionConversation.cs:162-174` |
| 手动压缩 `agent/compress-context`：Worker 有内存会话优先用之，否则回退请求携带的 messages（stateless），stateless 不 Replace、不落快照 | `AgentRuntimeContextCompressionTools.cs:24-105` |
| 快照失效钩子全集：Upsert/Update/Clear/Delete/DeleteLast/TruncateFrom/CompactSession/删会话/删项目 | `DbMessageToolsMutations.cs`、`DbSessionTools.cs:189`、`DbProjectTools.cs:187` |
| Upsert 的 INSERT 分支（新消息）不触发失效；仅 UPDATE 分支触发 | `DbMessageToolsMutations.cs:118-122` |

## 三、惰性初始化方案要点

**后端主导**（在 `agent/run` 内收口，单点覆盖前台/渠道/Cron/后台全部路径）：

1. `AgentLoop` 的 `MessageCount == 0` 分支（仅主会话 key，排除 `__subagent__`/`__goal__`）：
   - 复用恢复核心（从 `SessionRestoreTools.RestoreSession` 提取：快照+增量 / 全量回退）；
   - DB 无消息 → 维持现首轮逻辑；有消息 → `InitializeIfEmpty` + 快照路径设水位；
   - **空间不足先压缩**：恢复后 `Append` 本轮新用户消息，用 `EstimateMessagesTokens` 估算整体 token 种子化 `lastInputTokens` → 迭代 1 开头现有压缩块经 `ShouldCompress` 自然门控触发，实现"先压缩（压缩输入含新消息，尾部保留新消息）再继续"。
2. 前端解耦：`loadRecentSessionMessages` 移除 fire-and-forget restore；渠道显式 restore 移除（后端惰性初始化覆盖，`InitializeIfEmpty` 防竞态）。
3. 根因修复（惰性化本身不修根因，必须同步做，否则快照仍会在压缩瞬间被删）：
   - 聊天展示产物（`compressionStatus`/`compactBoundary` meta 行）的 upsert 不再触发快照失效——契约 §7.4"不影响模型输入的展示字段更新不使快照失效"的直接落实；
   - 全量恢复过滤 `compactSummary`（无快照时旧历史已在，摘要属重复注入）。

## 四、风险与边界

- 估算 token 是文本近似（与手动压缩路径同一工具），可能低估/高估；相比现状（首轮前完全无压缩机会）是净改进。
- 首条消息延迟略增（一次 DB 查询 + JSON 解析），原急切恢复只是把同等成本挪到进入会话时，总量不变。
- 压缩失败/无进展时沿用现有 skipped 语义，首轮请求可能超窗报错——与现状一致，不额外处理。
- 手动压缩端点、Goal 主循环、SubAgent 隔离 key 行为不变。

## 五、未提交 WIP 说明

工作区当前有 22 个文件的未提交改动（压缩状态事件增强：稳定 operationId 状态卡、compressionStatus 五态、事件字段扩展等）。根因 1 的触发链基于 WIP 版状态卡；旧版（两次独立插入）同样存在后续 upsert 触发失效的路径。执行态开始前需先将 WIP 提交为检查点（步骤 35 依赖其稳定 id 语义）。
