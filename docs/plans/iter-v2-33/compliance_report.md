# S-95 规划验证报告（compliance report）

- 被审文档：`docs/plans/iter-v2-33/plan.md`
- 需求口径基准：`docs/plans/iter-v2-33/raw-requirements.md` S-95 全节（第 626–877 行）
- 探索档：`docs/plans/iter-v2-33/exploration_findings.md`
- 审查者：独立 subagent（architect-reviewer）
- 日期：2026-09-19
- 结论：**FAIL（3 个 ❌）**

> 审查方式：plan 与 raw 逐条对读，再把 plan 的每个行号落点回源码实读核对（`ContextCompression.cs` / `AgentLoop.ContextCompression.cs` / `AgentRuntimeContextCompressionTools.cs` / `SessionConversation.cs` / `AgentLoop.Helpers.cs` / `AgentLoop.cs` / `SessionRestoreTools.cs` / `ContextCompression.TokenEstimation.cs` / `conversation-codec` 等）。所有行号均实读验证，非推测。

---

## 一、检查项结论

| # | 检查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 覆盖度：只保留「最近一条摘要」 | ⚠️ | plan:23、:52 明确只认最近一条并禁止沿用 `PinnedPrefixLen` 的 `while (IsCompactionSummary)` 连续跳过写法 —— 方向正确。但「其余旧摘要一律 fold」不可达（见 ❌-3），且「保留最近一条」与「摘要恒为 1 条」自相矛盾（见 ❌-1） |
| 2 | 覆盖度：移除范围与裁定一致 | ✅ | plan:22 = raw:834 / :875（旧摘要 + assistant + tool + 大 user；首条 user + 全部小 user 保留）。与源码现状（`ContextCompression.cs:400-411`）对得上 |
| 3 | 覆盖度：双路径（成功激进 / 失败保守）都在步骤里 | ✅ | plan:60-64 步骤 5 显式按 `summarizerFailed` 分流，成功 / 失败两条结果构造都写了，与 raw:837 / :873 一致 |
| 4 | 覆盖度：摘要输入统一用激进 fold（单列步骤） | ✅ | plan:58 步骤 4 单列，与 raw:825 / :873「输入统一用激进口径」一致 |
| 5 | 覆盖度：C（判据改 token）与 D（水位重置）都在 | ✅ | 步骤组二（plan:68-73）= C；步骤组三（plan:75-80）= D，与 raw:799 / :800 落点一致 |
| 6 | 覆盖度：E / F 单开、G 撤销、cap 语义不动 | ✅ | plan:32（V1，E/F 各自单开）= raw:838；plan:20-21、:98（cap 不动、G 撤销）= raw:830。E 对应 raw 待裁定第 5 条 |
| 7 | 正确性：摘要位于 tail / 全 wire 无摘要时是否自洽 | ⚠️ | plan:54-57 步骤 3 覆盖了两种情况（tail 内不重复保留；无摘要则 kept 为空），逻辑成立；但 plan:61 的成功路径公式把它写成 `[kept: … + 上一条摘要]`，与该步骤冲突（详见 ⚠️-1） |
| 8 | 正确性：role 交替 / tool_use-tool_result 配对 | ⚠️ | plan:63 只写「实施时确认」，未给结论。结论实为：不新增违规（现产物已是 `kept(user) + summary(user)` 相邻 user），但 plan 应把结论写死而非留给执行期（详见 ⚠️-2） |
| 9 | 正确性：C 与 `errorDriven` 截断兜底是否冲突 | ❌ | 与 `AgentLoop.ContextCompression.cs:109-116` 的区分本身正确，但 plan:72-73 与 plan:77 对「skipped 分支是否前进水位」给出**相反指令**（❌-2） |
| 10 | 正确性：水位重置与 7 处调用点（含两处 restore） | ⚠️ | restore 三处调用点在冷启动（`InitializeIfEmpty` 返回 true）才执行，且 `Append`（`SessionConversation.cs:195`）会把水位归零，故不构成「每轮重复压缩」；但 plan:79 只说「要区分」未给结论，且「7 处」实为 **6 处**调用点（详见 ⚠️-3） |
| 11 | 验证检查点：每步是否可执行 | ⚠️ | 每步都有验证行（build / 探针 / 真机），无「应该没问题」式空话。但步骤 2–5 的探针写明「用完即删」，而 exploration:100 明确要求「必须扩断言」；plan:94 对测试只写「视情新增 / 修改」（详见 ⚠️-4） |
| 12 | 路径与结构合规 | ⚠️ | 涉及文件全部真实存在、层级正确（详见下）；唯一硬伤是 `明确不动` 第 1 项的 cap 行号引错（详见 ⚠️-5） |
| 13 | 分层依赖 | ✅ | 改动全部落在 Agent 层（`ContextCompression.*` / `AgentLoop.*` / `SessionConversation.cs` / `AgentRuntimeContextCompressionTools.cs`），未新增跨层引用、未触及 Contracts / Core / Infrastructure / Workspace |
| 14 | 待裁定项覆盖（raw 待裁定 3 / 5 / 6） | ⚠️ | V2 ↔ raw 第 3 条、V1 ↔ 第 5 条、V3 ↔ 第 6 条，覆盖到位；但 V2 暂取值与 D 步骤自相矛盾（❌-2），且未覆盖「1 条还是 2 条摘要」这一更关键的口径分歧（❌-1） |
| 15 | 遗漏的反面：raw 已确认的「明确不动」 | ✅ | plan:96-102 逐条覆盖 cap 语义、`mergeCompressedMessagesKeepHistory`、小 user 消息 kept、`InjectTransientPrefix`、机械摘要降级路径，与 raw 一致 |

**行号核对汇总**（plan 引用 → 源码实读）：`ContextCompression.cs` 的 `:318-345`（`PinnedPrefixLen`，实读 318-345）、`:347-357`（`IsPinnableUserTurn`）、`:393-414`（`PartitionFold`）、`:402`（摘要 → kept 判据）、`:167-214`（结果构造）、`:275-312`（`PlanCompaction`）、`:421`（`SummarizeAsync`）、`:334`（首条 user 的 `!IsCompactionSummary` 守卫，plan 未引但很关键）**全部属实**；`AgentLoop.ContextCompression.cs:118` / `:126` / `:163`、`AgentRuntimeContextCompressionTools.cs:154` / `:176` / `:243` / `:320`、`SessionConversation.cs:43-49`、`AgentLoop.Helpers.cs:297-351`、`context-compression.ts:290` 均属实。唯一错引是 `AgentLoop.Helpers.cs:234-236`（见 ⚠️-5）。

---

## 二、发现的问题（按严重度）

### ❌ 阻断项（必须修入 plan 才能开工）

#### ❌-1：收敛目标自相矛盾 —— 步骤产出 2 条摘要，目标 / 验收却写「1 条」

- **问题**：plan:11 目标写「产物收敛到 `[1 条摘要] + tail`」，plan:65 步骤 6 验收写「wire 摘要由 53 → 1」；但 plan:61 步骤 5 的成功路径公式是 `[head] + [kept: 小 user 消息 + 上一条摘要] + [新摘要] + [tail]` —— 「上一条摘要」被 kept 留**住**、「新摘要」又追加，**稳态恒为 2 条摘要**。照步骤实施，步骤 6 的验收（`53 → 1`）必然失败（实际会得到 `53 → 2`）。
- **证据**：
  - plan:11（`[1 条摘要] + tail（≈2~3 万 token）`）、plan:61（成功路径含「上一条摘要」+「新摘要」）、plan:65（`53 → 1`）。
  - raw:813 成功路径公式同样含 `[上一条摘要] + [新摘要]`；但 raw:817「正常态下摘要恒为 1 条 —— 每次压缩把上一条**吸收进**新摘要」、raw:819「53 条残留…第一次压缩把除最后一条外的 52 条全部折进新摘要 → **一次回到 1 条**」、raw:823「仅该条保 kept/pin」。**raw 自身这对口径互相打架**（§813 保留 vs §817/§819 吸收），plan 原样照收了 §813 而未消解矛盾。
  - 若按 §817/§819（吸收口径）实现：上一条摘要须**进 fold 且不进结果**，结果 = `[新摘要] + tail` = 1 条，收敛；若按 §813/plan:61（保留口径）实现：稳态 2 条，永不收敛到 1。二者代码路径不同（决定 `PartitionFold` 是否对 `lastSummaryIdx` 保留、`fold` 是否含最后一条）。
- **修法建议**：在 plan 里**新增一条待用户裁定项（V4）并二选一**：
  - 口径 R（保留最近一条，忠实 raw:813）：把目标与步骤 6 验收改成「`53 → 2`、稳态 2 条」，并同步 plan:11 的 token 估算（2 条摘要 + tail，非 2~3 万）；
  - 口径 A（吸收最近一条，忠实 raw:817/§819，也是「滚动摘要」的原意）：把最后一条摘要也放进 `fold`（并入新摘要）、结果只留新摘要，`PartitionFold` 不再对 `lastSummaryIdx` 保 kept，目标与验收维持「1 条」。
  - 该口径决定核心实现，**不定不能开工**。

#### ❌-2：C 步骤与 D 步骤对「skipped 分支是否前进水位」给出相反指令

- **问题**：plan:72-73（步骤组二·步骤 2）写「token 判据不达标 ⇒ 按 skipped 处理且**不前进水位**」，验证写「探针确认 **skipped 分支不再** `MarkCompactionWatermark`」；plan:77（步骤组三·步骤 1）却写「**skipped 分支的 mark 保持现状**（把水位推到大值，避免每轮重试）」。两处指令相反，实施者无法同时满足。V2 暂取值（plan:33「不前进水位」）与 plan:77 也直接冲突。
- **证据**：plan:33 vs plan:72-73 vs plan:77。源码侧：`AgentLoop.ContextCompression.cs:118` 是**唯一**的 skipped 判据（`newWireConversation.Count >= originalCount`），:126 在 skipped 分支内 `MarkCompactionWatermark(wireConversation.Count)` —— 即「不前进水位」与「保持现状推大」落在**同一个分支**，plan 未把二者拆成两个分支。
- **衍生风险**：若真按 V2「不前进水位」，在阈值仍超、`errorDriven=false` 时，循环每轮都会重入压缩（`AgentLoop.cs:282-284` 门控 `watermark < count` 仍成立），即 raw 待裁定第 3 条担心的「频繁 skipped、每次白烧一次摘要调用」。plan 必须把这条代价写清并交给用户裁定，而不是两句相反的话。
- **修法建议**：二选一并写死 ——
  - 方案甲（拆分支）：新增独立的「跑了但没缩小」分支，`return skipped` 且**不** mark；原「无可折叠内容」分支（`CompactAsync` 返回 `Compacted=false`）保持 mark。plan 明写两条分支的判据与 `MarkCompactionWatermark` 处理。
  - 方案乙（不拆）：统一为「skipped 一律 mark 推大」，并把 V2 暂取值改成「不前进水位」的反面，plan:72-73 的验证行相应改写。

#### ❌-3：「其余旧摘要一律 fold」不可达 —— 去掉「摘要 → kept」判据后，小摘要仍被第二条判据留住

- **问题**：plan:52 步骤 2 只要求「去掉 `:402` 的 `IsCompactionSummary` 分支」，改为只对 `lastSummaryIdx` 保留。但 `PartitionFold` 的第二条判据（`ContextCompression.cs:403`）是「`Role == "user"` 且无 tool_results 且 `IsPinnableUserTurn`」，而 `IsPinnableUserTurn`（`:347-357`）的预算 = `min(1500, 窗口 × 15%)`；`EstimateTextTokens`（`TokenEstimation.cs:45-51`）对任何文本都等于**字符数**（`Math.Max((len+3)/4, len)` 恒为 `len`）。raw:757 实测摘要长度 **1,300~9,200 字符** ⇒ **≤1500 字符的旧摘要会命中「小 user 消息」判据、照旧进 kept**，「其余摘要一律进 fold」不成立，步骤 2 自己的验证（「结果里摘要条数 == 1」）也会因此失败。
- **证据**：plan:52（只提去掉第一条判据）；`ContextCompression.cs:402-403`（两条判据并列）；`:347-357`（预算 1500）；`TokenEstimation.cs:49-50`（估算恒等于字符数）；raw:757（摘要 1,300~9,200 字符）。反证：同一文件 `:334` 的**首条 user** 判据已显式加 `!IsCompactionSummary(conversation[i])` 守卫 —— 作者本就知道「摘要会是合法的小 user 消息」，但 plan 未把同样的守卫搬到 `PartitionFold` 第二条判据。
- **修法建议**：plan:52 补一句硬要求 —— `PartitionFold` 第二条判据加 `&& !IsCompactionSummary(message)`（或先判摘要、`continue`），确保「除最近一条外的摘要」无论大小都进 fold；并把该点写进步骤 2 的验收断言。

### ⚠️ 建议项（不阻断，建议采纳）

- **⚠️-1（步骤 3 与步骤 5 公式冲突）**：plan:56 步骤 3 明确「`lastSummaryIdx >= start`（摘要落在 tail）时…`kept` 集合不得再放它」，但 plan:61 的成功路径公式无条件写 `[kept: … + 上一条摘要]`。应把公式改成条件式（摘要是否在 kept 取决于它落在 region 还是 tail），否则实施者在 tail 场景会二义。
- **⚠️-2（role 交替 / tool 配对留白）**：plan:63 只写「实施时确认」。实读结论可直接写死：① 摘要是 `user` 角色（`ContextCompression.cs:199`），成功路径会产出 `[上一条摘要(user)] + [新摘要(user)]` 及 `[小 user 消息(user)] + [摘要(user)]` 的相邻 user —— 但**现状产物已是 `kept(全 user) + 摘要(user)` 相邻 user**（`:178-207`），线上一直可用 ⇒ 非新增违规；② tool_use / tool_result 配对不受影响：`TailStart`（`:378-381`）与 `PinnableUserTurn` 的「无 tool_results」约束保证折掉 assistant(tool_use) 时不会留下孤儿 tool_result。建议 plan 直接给出这两条结论并注明「如 `ConversationCodec` 有相邻合并逻辑则以其实测为准」。
- **⚠️-3（水位调用点计数与 restore 结论）**：plan:79 称「全部 7 处调用点」但只列 6 处；`git grep -n MarkCompactionWatermark` 实测为 **6 处调用**（`AgentLoop.ContextCompression.cs:126`、`:163`；`AgentLoop.cs:101`；`AgentRuntimeContextCompressionTools.cs:243`、`:320`；`SessionRestoreTools.cs:107`）+ 1 处定义（`SessionConversation.cs:43`）。另：三处 restore 调用都在 `InitializeIfEmpty(...) == true`（冷启动、水位原为 0）内执行，且随后 `AgentLoop.cs:117` 的 `Append` 会把水位归零（`SessionConversation.cs:195`），**不存在「restore 把水位重置成小值 ⇒ 每轮重复压缩」的路径**（是否压缩仍由 `ShouldCompress` 的 token 阈值决定）。建议 plan 修正计数并把该结论写死，替换现「要区分」的留白。
- **⚠️-4（验证手段偏软）**：步骤 2–5 的探针均注明「用完即删」，而 exploration:100 明确「改动必须扩断言而非只求不红」、raw:819 的「自愈」也必须实测确认。plan:94 对测试只写「视情新增 / 修改」。建议改为**强制**在 `tests/WishfulClaw.CompactionSnapshotRegressionTests` 增持久断言：① 结果里摘要条数 == 1（或 2，取决于 ❌-1 裁定）；② `fold` 含除最近一条外的全部旧摘要；③ 失败路径旧摘要条数不变；④ 53 条残留输入一次压缩后的摘要条数。
- **⚠️-5（cap 行号引错）**：plan:98 把 cap 落点写成 `AgentLoop.Helpers.cs:234-236`，实读该三行是 `EnsureProviderTurnHasOutput` 的签名区；`ApplyContextCap` 定义在 **`AgentLoop.Helpers.cs:58`**，调用点在 **`AgentLoop.cs:240`**。行号错会导致实施 / 复查「明确不动」时看错代码，建议修正（`context_cap_tokens` 的会话级上限落点在 iter-32 S-73/S-84，本刀不动这一点本身正确）。
- **⚠️-6（契约「不改」的口径需收窄）**：plan:6 / :108 声称「本次不改契约」，就**字段**而言属实（`compression-contract.md` 的快照 / 工件字段 `wireConversation` / `summaryMessage` / `compactArtifacts` / `messagesSummarized` / `summarizerFailed` 均不动）。但契约的两处**语义**描述会被本刀带偏：§二（`:32-39`「`[pinned prefix] + [fold 保留的 user turns] + [summary] + [recent tail]`」结构将新增「保留的上一条摘要」）与 §三（`:57`「`newCount >= originalCount` 时视为没有产生有效压缩」将被 C 改成 token 判据）。建议 plan 注明这两处需同步加脚注 / 小幅修订，避免契约漂移。
- **⚠️-7（陈旧注释）**：步骤 1/2 改动后，`ContextCompression.cs:25`（flow 注释）、`:271` / `:315-316`（`head = … + prior summaries`）等注释会与实际不符。建议纳入步骤 1/2 的「顺带修正」清单，属低成本加分项。

---

## 三、审查结论

- **阻断规则**：❌ 项 > 0 时禁止进入用户确认环节。
- **本次 ❌ = 3**（❌-1 收敛目标自相矛盾、❌-2 skipped 水位指令相反、❌-3 小摘要漏进 kept），故：
- **最终判定：FAIL**。不得进入用户确认，须先修入 plan：
  1. 就「保留最近一条 / 吸收最近一条」给出唯一裁定项（新增 V4）并对齐目标、步骤 5 公式与步骤 6 验收（消除 ❌-1）；
  2. 就 skipped 分支的水位处理二选一，统一 plan:33 / :72-73 / :77（消除 ❌-2）；
  3. `PartitionFold` 第二条判据补 `!IsCompactionSummary` 硬要求（消除 ❌-3）。
- 四、五两组（C / D）与收尾门禁的设计方向正确，A（滚动摘要）主线与 raw 定稿的因果纪律（cap 不动、G 撤销、DB 一字不删）一致；修掉上述 3 个 ❌ 与 7 个 ⚠️ 中至少 1–6 后，可复验通过。本次改动**不引入跨层依赖**，文件路径全部真实且分层正确，无需结构调整。

---

## 四、复验（第二轮）

- 复验者：独立 subagent（复验）
- 日期：2026-09-19
- 被审：plan.md（修订版）
- 结论：**PASS（0 个 ❌）**

> 复验方式：不回看上一轮结论，直接以 `raw-requirements.md` S-95 全节（626–877 行）与源码实读为准，对修订版 plan 逐条复核。plan / raw / 源码行号均已重读验证。

| 上轮项 | 处置是否到位 | 证据 / 说明 |
|---|---|---|
| ❌-1（收敛目标自相矛盾） | ✅ 已转 V4 待裁定（处理合规） | plan:14 立「收敛条数以 V4 裁定为准、暂按口径 A 编排」；plan:22 V4 行给出「不丢内容」的双口径并标注「raw 自身打架」；plan:29-32 口径对照表（A=1 条 / R=2 条）；plan:31 A 段「`PartitionFold` 不再对任何摘要保 kept」、plan:32 R 段「对全 wire 最后一条摘要保 kept」；plan:63 步骤 5 成功公式改为条件式 `[kept: 小 user 消息（+ 口径 R 时的上一条摘要）]`；plan:67 步骤 6 验收写 `53 → 1（A）/ 2（R）`；plan:89 收尾断言 ① 写「== 1（A）/ 2（R）」；plan:116-119「V4 分支附注」把 R 时对步骤 2/4/5 与条数的改动逐条列出。**矛盾已消解**：现状全文再无「目标写 1 / 步骤写 2」的并存指令，R 分支有单列附表兜底。**合规性**：口径歧义来自 raw 自身（§813 `[上一条摘要]+[新摘要]` / §823「仅该条保 kept」 vs §817「恒为 1 条」 / §819「53→1」 / §877「其余旧摘要一律进 fold 被新摘要吸收…摘要恒为 1 条」），直接决定 `lastSummaryIdx` 是进 fold 还是保 kept（核心实现分叉），非 agent 可自行消解的表述瑕疵，交用户裁定成立 |
| ❌-2（skipped 水位指令相反） | ✅ 已统一为方案乙 | plan:24 V2 暂取值 = 「跑了但没缩小」按 skipped 且**统一 mark 推大水位**（与现状 skipped 同口径）；plan:74 步骤 2 写「统一 mark 推大水位…消除『不前进水位 / 保持现状』的自相矛盾」+ 代价记档。全文 grep「不前进 / 保持现状」仅剩 plan:74 这一句**说明性引用**（引号内文字），**无相反指令**。与源码自洽：`AgentLoop.ContextCompression.cs:118` 是唯一 skipped 判据、`:126` 在该分支内 `MarkCompactionWatermark(wireConversation.Count)`（推大），两类 skipped（`Compacted=false` 与「跑了但没缩小」）都经 `:118` 汇入同一分支，plan:74「（与 `Compacted=false` 的 skipped 同一处理）」描述准确 |
| ❌-3（小摘要漏进 kept） | ✅ 已补守卫、位置正确 | plan:55 步骤 2 ② 写「给 `:403` 的小 user 判据补 `&& !IsCompactionSummary(message)` 守卫」，并给出依据（预算 `min(1500, 窗口×15%)`、`EstimateTextTokens = Math.Max((len+3)/4, len)` 对 ASCII 恒等于字符数、摘要实测 1,300~9,200 字符）、指明「`:334` 的首条 user 判据**已有同款守卫**，照搬即可」。源码核对：`ContextCompression.cs:402-403` 两条判据并列属实；`:334` 的 `!IsCompactionSummary(conversation[i])` 守卫属实；`TokenEstimation.cs:49-50` 估算恒等于字符数属实。修法可达「除最近一条外的摘要一律进 fold」 |
| ⚠️-1（步骤 3 与步骤 5 公式冲突） | ✅ 已采纳 | plan:63 成功路径公式改为条件式（摘要仅在口径 R 时才入 kept）；plan:58 步骤 3 保留「`lastSummaryIdx >= start` 时不重复放」；两处不再冲突 |
| ⚠️-2（role/tool 配对留白） | ✅ 已采纳、结论写死 | plan:65 写入两条实读结论：① 摘要是 `user`（`:199`）、相邻 user 现状已存在（`:178-207`）非新增违规；② `TailStart`（`:378-381`）与「无 tool_results」约束保证无孤儿 tool_result；并附「若 `ConversationCodec` 有相邻合并逻辑以实测为准」 |
| ⚠️-3（水位调用点计数 + restore 结论） | ✅ 已采纳、计数改 6 处 | plan:81 写「全部 **6** 处调用点（另有 1 处定义 `SessionConversation.cs:43`，不计）」并逐一列出；plan:82 把 restore 结论写死（三处 restore 都在 `InitializeIfEmpty(...) == true` 内、随后 `Append` 归零水位 `:195` ⇒ 不存在每轮重复压缩）。源码核对：`git grep` 实测 **6 处调用**（`AgentLoop.ContextCompression.cs:126` / `:163`、`AgentLoop.cs:101`、`AgentRuntimeContextCompressionTools.cs:243` / `:320`、`SessionRestoreTools.cs:107`）+ 1 处定义（`SessionConversation.cs:43`）；三处 restore 均在 `InitializeIfEmpty` 分支内（`AgentLoop.cs:94-102`、`AgentRuntimeContextCompressionTools.cs:313-321`、`SessionRestoreTools.cs:96-108`）属实；`SessionConversation.cs:195` `Append` 归零属实。计数与结论均正确 |
| ⚠️-4（验证手段偏软） | ✅ 已采纳、改为强制持久断言 | plan:88-93 收尾步骤 2 明确「**在 `tests/WishfulClaw.CompactionSnapshotRegressionTests` 增持久断言**（不是临时探针；exploration_findings 已要求『扩断言』）」并列 5 条断言（① 摘要条数 == 1/2；② fold 含规定范围内全部旧摘要；③ 失败路径旧摘要条数不变；④ 53 条残留一次压缩后条数；⑤ ≤1500 字符小摘要不漏进 kept）；plan:52/57/59 步骤验证均指向「收尾的持久断言」而非「用完即删的探针」；plan:103 把测试目录标为「**必改**」 |
| ⚠️-5（cap 行号引错） | ✅ 已采纳、行号更正 | plan:108 写「`ApplyContextCap` 定义在 `AgentLoop.Helpers.cs:58`，调用在 `AgentLoop.cs:240`（首轮报告曾把行号写成 `Helpers.cs:234-236`，那三行是 `EnsureProviderTurnHasOutput`，**已更正**）」。源码核对：`AgentLoop.Helpers.cs:58` = `internal static JsonElement ApplyContextCap(...)`；`AgentLoop.cs:240` = `provider = ApplyContextCap(...)`；`AgentLoop.Helpers.cs:235` = `EnsureProviderTurnHasOutput`。更正属实 |
| ⚠️-6（契约语义同步） | ✅ 已采纳 | plan:94 收尾步骤 3 写「契约同步 —— `compression-contract.md` 的 §二（结果逻辑结构）、§三（`newCount >= originalCount` 判据）随本刀加注 / 小幅修订，**字段一律不动**」；plan:7 头注同步标注。源码核对：契约 `:32-39` §二结构描述、`:57` §三「`newCount >= originalCount` 时视为没有产生有效压缩」确会被本刀带偏，故加注成立 |
| ⚠️-7（陈旧注释） | ✅ 已采纳 | plan:51 步骤 1「顺带：修正随之陈旧的注释 —— `:25`（flow 第 5 步…）、`:271` 与 `:315-316`（`head = … + prior summaries`）」。源码核对：`:25` flow 第 5 步、`:271-273` PlanCompaction「system + first user + **prior summaries**」、`:315-316` PinnedPrefixLen 摘要「**and any prior compaction summaries**」均属实，改动后确会与实际不符 |

### 新发现的问题

- **（提示，非阻断）plan:34 的引证偏松**：「第三种读法不可取（输入只含最近一条、更早的旧摘要直接丢）」引的是 `raw §874`（该节讲的是**失败路径**不可删旧摘要的论证），最直接的需求依据其实是 `raw §825`「摘要输入必须用激进口径的 fold（含除上一条外的旧摘要）—— 否则成功路径删掉的旧摘要没进新摘要，那才是真丢」。结论成立、方向一致，仅引证不最精准，建议把 §874 补成「§825 + §874」或改引 §825。
- **（提示，非阻断）口径 A 的一个边界已被覆盖**：auto 路径 `preserveTail=true` 时，若「全 wire 最后一条摘要」恰好落在 tail 窗口内，则由 tail 原样带出，结果会出现「新摘要 + tail 内的旧摘要」= 2 条，与「稳态 1 条」不严格一致。plan:58 步骤 3 ① 已显式承认并处理该边界（「摘要落在 tail 时 `kept` 不重复放它」），故属已知边界而非漏项；如要更严谨，可在步骤 3 验证里补一条「tail 含旧摘要时结果条数」断言。
- 未发现新的行号错误、新的自相矛盾、步骤间依赖断链或不可执行的验收。复核行号全部真实：`ContextCompression.cs:318-345` / `:347-357` / `:393-414` / `:402` / `:403` / `:334` / `:167-214` / `:421` / `:25` / `:271` / `:315-316`；`AgentLoop.ContextCompression.cs:109-116` / `:118` / `:126` / `:163`；`AgentRuntimeContextCompressionTools.cs:176` / `:243` / `:320`（`:199` 摘要 user 角色、`:178-207` kept+摘要构造、`:378-381` TailStart 对齐、`:195`/`:43-49` `SessionConversation` 水位、`:58` `ApplyContextCap` 定义、`AgentLoop.cs:101` / `:240` / `:282-284` 门控）全部属实。

### 复验结论

- 阻断规则：❌ > 0 则仍禁止进入用户确认。本轮复核 **❌ = 0**。
- 上轮 3 项 ❌ 已全部处置到位（❌-2/❌-3 直接修入；❌-1 因需求原文自相矛盾而合规转为待裁定项 V4，plan 内部已用条件式 + 分支附注消解矛盾），7 项 ⚠️ 全部采纳并落纸（其中 ⚠️-1~4、7 为方案性采纳，⚠️-5/6 为行号与契约同步采纳）。
- 新增 2 条提示级问题（plan:34 引证偏松、口径 A 的 tail 边界断言可再补），均不阻断。
- **最终判定：PASS**。修订版 plan 消除了首轮全部阻断项且未引入新硬伤，可进入用户确认环节（V4 口径 A/R 仍需老大拍板，V1/V2/V3 按 plan 暂取值执行）。