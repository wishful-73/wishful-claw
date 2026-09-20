# iter-v2-33 探索发现（S-95 上下文压缩「越压越多」）

> 2026-09-19 实读。分支 `dev/v2-iter-33`（base `main` @ `f6922f6c`，v0.2.32）。
> 证据分两类：**代码实读**（行号）与**开发库实测**（`~/.wishful-claw/index.db`）。
> 需求原文见同目录 `raw-requirements.md` 的 S-95。

---

## 一、现象与结论

| 现象 | 结论 |
|---|---|
| 点击手动压缩后上下文不减反增 | 真实存在，**非显示问题** |
| 自动压缩「压不动」 | 真实存在，每次仅折 2~4 条 |

**唯一主因**：`ContextCompression.CompactAsync` 构造结果时**只移除 `fold`（assistant/tool）**，从未实现「摘要前的消息全部滚蛋」——旧摘要被 `head`/`kept` 拎在 fold 之外，因此永远删不掉，每次压缩又新增一条 ⇒ 单调膨胀。

---

## 二、开发库实测数据（`~/.wishful-claw/index.db`，会话 `lOzL9w1ou1FUddATk2XEq`）

**最新快照 `session_compaction_snapshots`（trigger=auto，orig=131 → new=128）的 `wire_conversation`**：

| 内容 | 条数 | 字符 | 占比 |
|---|---|---|---|
| `<compaction-summary>` 旧摘要 | **53** | **324,874** | **98.29%** |
| 其它 user 消息 | 74 | 5,652 | 1.71% |
| assistant | 1 | — | — |

**真实用量**：`messages.usage.contextTokens` = **261,205**（压缩跑完仍在 26 万量级）。

**`fold` 时间序列（本次进 fold 的条数）**：

```
09-16 09:26  new=28   fold=86
09-17 22:02  new=87   fold=136
09-18 21:41  new=120  fold=296
09-19 08:23  new=129  fold=225
09-19 16:12  new=122  fold=66   （manual）
09-19 16:13:55 new=125 fold=3   ← 锁死
09-19 16:14:09 new=126 fold=2
09-19 16:14:31 new=127 fold=2
09-19 16:14:51 new=128 fold=4
```

`new_count` 长期单调爬升：**24（09-16）→ 128（09-19）**。

**会话设置**（`sessions` 表）：`model_id = deepseek-v4-flash`（真实 `contextLength = 1,000,000`）、`context_cap_tokens = 200000`、`compression_threshold = 0.0`（跟随全局 0.8）。

> cap 只是**放大因素**（触发线 78.4 万 → 14.4 万，让畸形产物显性锁死），**不是原因**，其语义不动。

---

## 三、代码现状（逐处落点）

`src/runtime/WishfulClaw.Agent/ContextCompression.cs`：

| 行号 | 符号 | 现状 | 问题 |
|---|---|---|---|
| `:109-129` | `CompactAsync` 入口 | `PlanCompaction` 失败即返回 `Compacted=false` | — |
| `:167-214` | 结果拼接 | `head + kept + [新摘要] + tail` | **只移除 fold**，摘要位置固定 append |
| `:275-312` | `PlanCompaction` | `head = PinnedPrefixLen(...)`；`preserveTail=false` 时 `start = Count` | — |
| `:318-345` | `PinnedPrefixLen` | `while (i < Count && IsCompactionSummary(conversation[i])) i++;` | **把连续旧摘要全部塞进 head** |
| `:347-357` | `IsPinnableUserTurn` | `budget = min(1500, 窗口 × 15%)` | 用户消息保留（**保留不动**） |
| `:363-384` | `TailStart` | 按 `DefaultTailTokens = 16384` 反走 | — |
| `:393-414` | `PartitionFold` | `IsCompactionSummary(msg)` → **kept**；小 user 消息 → **kept** | **摘要归 kept = 永不折叠的元凶** |
| `:421-490` | `SummarizeAsync` | 3 次尝试 + 360s 超时；失败返回 `MechanicalFoldDigest` | 机械摘要零信息量 |
| `:809-814` | `MechanicalFoldDigest` | 一句英文占位 | 失败路径不可用它换掉旧摘要 |

`TokenEstimation.cs`：`:55-60` `IsCompactionSummary`（要求 `TrimStart().StartsWith("<compaction-summary>")`）、`:45-51` `EstimateTextTokens = Math.Max((len+3)/4, len)`（ASCII 约 4 倍高估）。

**两条调用路径**：

| 路径 | 文件 | 关键点 |
|---|---|---|
| 自动 | `AgentLoop.ContextCompression.cs:46-219` | `TryCompressLoopConversationAsync`；`:118` 用**条数**判成功；`:126` skipped 分支 mark 水位 |
| 手动 | `AgentRuntimeContextCompressionTools.cs:26-283` | `CompressAsync`；`:154` `preserveTail: trigger != "manual"`；`:176` 用**条数**判成功 |

**水位**：`SessionConversation.cs:43-49` `MarkCompactionWatermark` 用 `Math.Max`（只增不减）；门控 `AgentLoop.cs:282-284` 要求 `watermark < wireConversation.Count`。

---

## 四、参考源码

`D:\claw\OpenCowork`（移植来源，文件头注释 "Ported from OpenCowork"）。

- 本仓 `ContextCompression.cs` 头部注释自述移植自 OpenCowork 的压缩实现（`PlanCompaction` / `PartitionFold` / `SummarizeAsync` / `MechanicalFold` 四段式）。
- `PartitionFold` 的 kept 注释原文 "small user turns + prior compaction summaries" —— 移植时把「保留最近一条摘要」实现成了「保留全部摘要」，且从不折旧。**本轮实施时应回看 OpenCowork 原实现，确认其 `preserve` 语义是否只留最近一条**（若原实现就是全留，则这是上游缺陷，不是移植偏差）。

---

## 五、风险与依赖

| 风险 | 说明 |
|---|---|
| **失败路径丢信息** | 若激进口径不加双路径分流，摘要失败时 `MechanicalFoldDigest` 会顶替掉旧摘要 ⇒ 模型视角失忆（DB 有存档，模型看不到） |
| **前缀缓存** | 压缩替换会让 prefix cache 失效一次，属预期；但 `InjectTransientPrefix` 注到摘要头上（附三）会让**每轮**都改字节 |
| **水位门控** | 压缩后条数骤降 + `Math.Max` 只增不减 ⇒ 需要 D 项一起修，否则压缩后长期不再触发 |
| **畸形历史自愈** | 现有会话已有 53 条残留摘要；「只认上一条」实现后第一次压缩会折掉 52 条 ⇒ **无需数据迁移**，但需在验证态实测确认 |
| **测试覆盖** | 现有 `tests/WishfulClaw.CompactionSnapshotRegressionTests`（271 断言）是压缩链的主回归，改动必须扩断言而非只求不红 |
| **E/F 不并入** | 压缩后数字口径（E）、时间戳注入摘要（F）与本需求非同一因果链，本轮**不动**，仅在文档记档 |

---

## 六、待确认（实施前）

1. OpenCowork 原实现的摘要保留语义（见第四节）—— 只影响「是否属移植偏差」的定性，不影响修法。
2. 现有 53 条残留摘要在修复后第一次压缩能否收敛为 1 条（验证态实测）。
