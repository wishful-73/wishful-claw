# Plan: v2-iter-33 S-95 —— 压缩滚动摘要（修「越压越多 / 压不动」）

> 分支 `dev/v2-iter-33`（base `main` @ `f6922f6c`，v0.2.32）。
> 需求文档（权威）：`docs/plans/iter-v2-33/raw-requirements.md`，本迭代编号接 iter-32 的 S-86 起（S-87 起已登记多项，**S-95 是唯一进入实施的**）。
> 探索档：`docs/plans/iter-v2-33/exploration_findings.md`。
> 规划验证：`docs/plans/iter-v2-33/compliance_report.md`（**首轮 FAIL：3 ❌ + 7 ⚠️** → 修订 → **复验 PASS**；❌-1 转为 V4，**2026-09-19 老大已裁定为口径 A（吸收式，稳态 1 条）**）。
> 压缩契约：`docs/plans/iter-v2-23/compression-contract.md`（**字段不动**；§二 / §三 的语义描述随本刀加注，见「收尾」步骤 3）。
> 本迭代节奏：需求逐步积攒，不定收口时间；本 Plan **只覆盖 S-95**。

## 目标

实现**滚动摘要**语义：压缩触发后，模型看到的 wire 里摘要**收敛为一条**，摘要之前的内容（旧摘要、assistant、tool、大 user 消息）全部退出上下文（进 fold 被新摘要吸收，不落进结果）；用户消息（首条 + 小 user 消息）与 tail 照旧保留。目标是产物收敛到 `[1 条摘要] + tail`（≈2~3 万 token），从根上解除「手动压缩越压越多 / 自动压缩压不动」的死锁；同刀修掉把「token 净增」判成「压缩成功」的条数判据（C）与只增不减的压缩水位（D）。

**V4 已裁定（2026-09-19 老大，口径 A = 吸收式）**：压缩后内存里**只有新摘要**；下一轮压缩把「上一轮的摘要 + 其后积累的消息」一起拿去压，产出新摘要，旧摘要不再单独留存。

**这不是新功能，是补齐 `CompactAsync` 从未实现的语义**：它现在构造 `head（含连续旧摘要）+ kept（含全部旧摘要 + 小 user 消息）+ [新摘要] + tail`，只移除 `fold`（assistant / tool），所以摘要 1 → 2 → … → 53 条单调膨胀，实测摘要占 wire 字符的 **98.29%**。

## 待用户裁定项（进执行前确认）

| # | 项 | 本文档暂取值 | 出处 |
|---|---|---|---|
| **V4** | 旧摘要的处置口径 | **已裁定（2026-09-19 老大）：口径 A（全部吸收 → 稳态 1 条）** —— 「压缩后内存中就是新摘要，然后继续积累消息；下一轮压缩只有上一轮的摘要 + 消息需要拿去压缩，压缩后成为新摘要」 | 老大 2026-09-19 口述；raw §813（结果保留 `[上一条摘要]`）**作废** |
| V1 | E / F 是否并入本刀 | 暂定**不并入**（各自单开） | raw §801-802、§838 |
| V2 | C 的严格度（token 不达标时怎么办） | 暂取**方案乙**：「跑了但没缩小」按 skipped，且**统一 mark 推大水位**（与现状 skipped 同口径，避免每轮重入白烧摘要调用）；`errorDriven` 的截断兜底不受影响 | raw §836 |
| V3 | 锁死兜底（连续 N 次压缩且 fold 过小则短路） | 暂定**本刀不做**（A 修好后产物收敛，锁死不再发生，兜底留观） | raw §839 |

### V4 定案（2026-09-19 老大口述，口径 A）

> 「压缩后内存中就是新摘要，然后继续积累消息；下一轮压缩的时候，只有最近的那条旧摘要，也就是上一轮的摘要 + 消息，需要拿去压缩，压缩后成为新摘要，这时候内存中就只有新摘要 + 第一条用户消息了。如果压缩失败才是另外的处理。」

| 项 | 定案 |
|---|---|
| 结果的摘要条数 | **1 条**（只有新摘要；上一条旧摘要的内容随其一起进新摘要，不再单独留在结果里） |
| 摘要**输入** | 「上一轮摘要 + 其后积累的消息」；**畸形会话（53 条）的其余旧摘要一并进输入被吸收** —— 不直接丢（丢会让更早历史在模型视角失联，raw §874 对成功路径同样适用） |
| 畸形会话验收 | 53 → **1** |
| 结果结构 | `[head: system + 首条 user] + [kept: 小 user 消息] + [新摘要] + [tail]` |
| 失败的处置 | 走另一路（现状保守口径，见步骤 5） |

> raw §813 的「`+ [上一条摘要]`」与 §817 / §819 打架，**以本裁定为准（§813 作废）**；raw §825 的「输入含除上一条外的旧摘要」同步修正为「含全部旧摘要」。

## 实施顺序与理由

| # | 步骤组 | 为什么排这里 |
|---|---|---|
| 1 | **A-1 分区改造**（`PinnedPrefixLen` + `PartitionFold`） | 主线。单独修它即可解除死锁；后续改动都建立在「结果里摘要收敛」这个新事实上 |
| 2 | **A-2 fold 口径**（fold 含 V4 规定范围内的旧摘要，喂给 `SummarizeAsync`） | 依赖 A-1；顺序反了会落到「成功路径删掉的旧摘要没进新摘要」= 真丢内容 |
| 3 | **A-3 双路径结果构造**（按 `summarizerFailed` 分流） | 依赖 A-1 / A-2；失败路径是安全网，最后接 |
| 4 | **C 判据改 token** | A 落地后结果确实变小，此时换判据语义才正确 |
| 5 | **D 水位成功后重置** | 与 C 同源（判定不达标如何处理水位），放最后统一收口 |

## 步骤清单

### 步骤组一：A —— 滚动摘要（`src/runtime/WishfulClaw.Agent/ContextCompression.cs`）

- [ ] 步骤 1：`PinnedPrefixLen`（`:318-345`）收窄——删掉 `:340-342` 的 `while (i < conversation.Count && IsCompactionSummary(conversation[i])) i++;`，`head` 只到「system + 首条可 pin user」为止（`:323-338` 段保持不动）。旧摘要不再进 `head`，自然落进可折叠区。
  - 顺带：修正随之陈旧的注释 —— `:25`（flow 第 5 步「[pinned prefix] + [kept user turns] + [summary] + [recent tail]」）、`:271` 与 `:315-316`（`head = … + prior summaries`）
  - 验证：`dotnet build src/runtime/WishfulClaw.sln` 零错误；`tests/WishfulClaw.CompactionSnapshotRegressionTests` 无既有断言依赖旧 head 语义
- [ ] 步骤 2：`PartitionFold`（`:393-414`）改造：
  - ① 删掉 `:402` 的 `IsCompactionSummary(message)` 判据；
  - ② **给 `:403` 的小 user 判据补 `&& !IsCompactionSummary(message)` 守卫** —— 否则 ≤1500 字符的旧摘要会被当成「小 user 消息」留在 kept（`IsPinnableUserTurn` 预算 `min(1500, 窗口×15%)`，且 `EstimateTextTokens = Math.Max((len+3)/4, len)` 对 ASCII 恒等于字符数；实测摘要长 1,300~9,200 字符）。`:334` 的首条 user 判据**已有同款守卫**，照搬即可；
  - ③ 按 V4 定案（口径 A）：摘要**全部进 fold**，结果里不保留任何旧摘要。
  - 验证：`dotnet build` 零错误；覆盖断言见「收尾」步骤 2（**不靠临时探针**）
- [ ] 步骤 3：核对分区覆盖边界——① 最近一条摘要在 `tail`（`start` 之后）时由 tail 原样带出，`kept` 不重复放它；② 全 wire 无摘要时 kept 里的摘要为空；③ `lastSummaryIdx < head` 不应出现（步骤 1 后 head 不含摘要）。
  - 验证：同样进「收尾」的持久断言
- [ ] 步骤 4：`fold` 口径改激进——确保传给 `SummarizeAsync`（`:421+`）的 fold 含**全部旧摘要**（含最近一条）+ assistant / tool / 大 user。**成功路径要删掉的一切，必须已进新摘要。**
  - 验证：持久断言 —— fold 里旧摘要条数 == 全 wire 摘要总数
- [ ] 步骤 5：结果构造按 `summarizerFailed` 双路径分流（`:167-214`）——
  - **成功**：`[head: system + 首条 user] + [kept: 小 user 消息] + [新摘要] + [tail]`（旧摘要一律不留）
  - **失败**：现状口径（kept 含旧摘要与小 user 消息 + 机械摘要 + tail），**旧摘要一条不删**
  - **role / tool 配对结论（已实读，不再留「实施时确认」）**：① 摘要是 `user` 角色（`:199`），结果里会出现相邻 user 消息（`kept(user) + 摘要(user)`）—— **现状产物已经如此**（`:178-207`），线上一直可用，非新增违规；② tool 配对不受影响：`TailStart`（`:378-381`）与「无 tool_results」约束保证折掉 assistant(tool_use) 时不留孤儿 tool_result。若 `ConversationCodec` 有相邻合并逻辑，以其实测为准。
  - 验证：`dotnet build` 零错误；持久断言覆盖成功 / 失败两条路径
- [ ] 步骤 6：整体测通——真机复现原会话（`lOzL9w1ou1FUddATk2XEq`，53 条摘要的畸形 wire），点手动压缩，确认 wire 摘要 53 → **1**、`new_count` 大幅下降且不再单调爬升、真实 `usage.contextTokens` 落到 2~3 万量级。
  - 验证：`dotnet build` + TS 三配置零错误；DB 快照取证（对比 `session_compaction_snapshots` 的 fold 字段由 2~4 回到数百）

### 步骤组二：C —— 成功判据从条数改 token

- [ ] 步骤 1：把 `AgentLoop.ContextCompression.cs:118` 与 `AgentRuntimeContextCompressionTools.cs:176` 的 `newWireConversation.Count >= originalCount` 改为 token 估算比较：`EstimateMessagesTokens(newConversation) < EstimateMessagesTokens(conversation)` 才算压动。两处自动 / 手动**必须同口径**。注意 `errorDriven`（context-window overflow）仍走 `AgentLoop.ContextCompression.cs:109-116` 的截断兜底，**不受本改影响**。
  - 验证：持久断言 —— 「折 2 条换 1 条长摘要」判 skipped 而非 compressed
- [ ] 步骤 2：（按 V2 方案乙）「跑了但没缩小」的 skipped **统一 mark 推大水位**（与 `Compacted=false` 的 skipped 同一处理），消除「不前进水位 / 保持现状」的自相矛盾。代价记档：阈值仍超时该轮不再重试，直到有新消息。
  - 验证：持久断言 —— 两类 skipped 都调用 mark；`errorDriven` 路径不落这条

### 步骤组三：D —— 压缩水位成功后重置

- [ ] 步骤 1：`SessionConversation.cs:43-49` 的 `MarkCompactionWatermark` 由 `Math.Max(_compactionWatermark, messageCount)` 改为成功路径的**重置语义**（成功后直接赋值当前长度），或新增 `ResetCompactionWatermark` 供成功路径调用。
  - 验证：持久断言 —— 压缩成功后水位 == 新 wire 长度
- [ ] 步骤 2：核对**全部 6 处调用点**（另有 1 处定义 `SessionConversation.cs:43`，不计）：`AgentLoop.ContextCompression.cs:126`（skipped）、`:163`（成功）、`AgentLoop.cs:101`（restore）、`AgentRuntimeContextCompressionTools.cs:243`（手动成功）、`:320`（手动 restore）、`SessionRestoreTools.cs:107`（restore）。
  - **结论（已实读，不再留「要区分」）**：三处 restore 都在 `InitializeIfEmpty(...) == true`（冷启动、水位原为 0）内执行，随后 `Append` 会把水位归零（`SessionConversation.cs:195`）⇒ **不存在「restore 重置成小值 ⇒ 每轮重复压缩」的路径**；是否压缩仍由 `ShouldCompress` 的 token 阈值决定。
  - 验证：`git grep -n "MarkCompactionWatermark"` 逐条确认 6 处语义

### 收尾：门禁、断言与提交

- [ ] 步骤 1：TS 三配置零错误：`npx tsc --noEmit -p tsconfig.web.json` + `-p tsconfig.node.json` + `-p tsconfig.json`；C# `dotnet build src/runtime/WishfulClaw.sln` 零错误 + `tests/WishfulClaw.Tests.sln` 编译 + 全部回归套件跑通
- [ ] 步骤 2：**在 `tests/WishfulClaw.CompactionSnapshotRegressionTests` 增持久断言**（不是临时探针；exploration_findings 已要求「扩断言」）：
  - ① 结果里摘要条数 == 1
  - ② fold 含全部旧摘要
  - ③ 失败路径旧摘要条数不变
  - ④ 53 条残留摘要的输入一次压缩后的摘要条数
  - ⑤ ≤1500 字符的小摘要不漏进 kept
- [ ] 步骤 3：契约同步 —— `docs/plans/iter-v2-23/compression-contract.md` 的 §二（结果逻辑结构）、§三（`newCount >= originalCount` 判据）随本刀加注 / 小幅修订，**字段一律不动**
- [ ] 步骤 4：需求整体测通后**一个 commit**（`fix(compaction): S-95 压缩实现滚动摘要，修越压越多与压不动`），规划 / 审查 / 验证文档并入该 commit，**不 push**

## 涉及文件

- `src/runtime/WishfulClaw.Agent/ContextCompression.cs` — 修改（`PinnedPrefixLen` / `PartitionFold` / fold 口径 / `:167-214` 结果构造双路径 / 陈旧注释）
- `src/runtime/WishfulClaw.Agent/AgentLoop.ContextCompression.cs` — 修改（C：`:118` 判据、`:109-116` 降级链、`:126` 水位）
- `src/runtime/WishfulClaw.Agent/AgentRuntimeContextCompressionTools.cs` — 修改（C：`:176` 手动判据；`:243` 水位）
- `src/runtime/WishfulClaw.Agent/SessionConversation.cs` — 修改（D：`:43-49` 水位语义）
- `tests/WishfulClaw.CompactionSnapshotRegressionTests/` — **必改**（新增持久断言：`PastedBlockRestoreChecks.cs` / `Program.cs`）
- `docs/plans/iter-v2-23/compression-contract.md` — 加注（§二 / §三 语义同步，字段不动）

## 明确不动（防跑偏，逐条已在 raw 裁定）

1. **cap 语义** —— `ApplyContextCap` 定义在 `src/runtime/WishfulClaw.Agent/AgentLoop.Helpers.cs:58`，调用在 `AgentLoop.cs:240`（首轮报告曾把行号写成 `Helpers.cs:234-236`，那三行是 `EnsureProviderTurnHasOutput`，**已更正**）；S-73 设计，G 已撤销
2. `mergeCompressedMessagesKeepHistory`（`src/renderer/src/lib/agent/context-compression.ts:290`）—— DB / 聊天记录全史保留，正确
3. 「小 user 消息 → kept」判据（`IsPinnableUserTurn`，`ContextCompression.cs:347-357`）—— 设计意图（保用户原话），实测仅占 1.71%
4. `InjectTransientPrefix`（`AgentLoop.Helpers.cs:297-351`）注到最后一条 user 消息 —— 为 prefix cache 稳定，设计正确；F 单开
5. `MechanicalFoldDigest` 降级路径本身 —— 失败路径继续用它，只是**不许因它去删旧摘要**

## 参考源码

- 本次**无外部源码搬运**，纯自家逻辑修复；语义基准是 `raw-requirements.md` 的 S-95 全节（老大四条澄清 + 双路径定稿）。
- 同族背景：`docs/plans/iter-v2-32/`（S-73 / S-84 cap 落地 —— 放大因素的来源，本次不动它）。
- 契约：`docs/plans/iter-v2-23/compression-contract.md`（快照与工件字段约定，本次只改参与构造的消息集合与判据语义）。
