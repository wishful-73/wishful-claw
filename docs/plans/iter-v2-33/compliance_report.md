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

---

## 五、S-87 ~ S-94 规划验证（第二轮 plan）

- 被审文档：docs/plans/iter-v2-33/plan.md（全迭代版）
- 需求基准：docs/plans/iter-v2-33/raw-requirements.md 第 11–622 行（S-87 ~ S-94 各节，含「待裁定」）
- 规范基准：AGENTS.md（7 层单向依赖 / AOT / 大文件拆分 / 命名）、docs/dev-workflow.md（阶段二·三）
- 审查者：独立 subagent（architect-reviewer）
- 日期：2026-09-19
- 结论：**FAIL（1 个 ❌）**

> 审查方式：plan 逐节与 raw 对读；plan 引用的**每一处 `文件:行`** 均回源码实读核对（grep -n 取权威行号）；可行性项逐个落地核实（测试工程骨架、sln、InternalsVisibleTo、JSON 源生成上下文、DbClient/DbCronRunTools 契约、既有可见性回归套件与金样）。所有行号均为 2026-09-19 实读，非推测。

| # | 检查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 覆盖度：S-87 四项能力（创建/查看/修改/执行记录） | ✅ | 创建/查看/修改 = 步骤 1 放宽 `CronAdd/Create/Update/List` 可见性；执行记录 = 步骤 2 新增 `CronRuns`。raw §63「执行记录是独立缺口」被单列步骤承接。待裁定 3/4 由 V1/V2 承接，待裁定 1（渠道）已在 raw 定案并被步骤 1 记档 |
| 2 | 覆盖度：S-88 匹配修复 + 可诊断性 | ✅ | 步骤 1（真 glob）= raw §151；步骤 2（零命中区分「真没有 / 被模式筛空」）= raw §153；步骤 3 回归 = 配套；步骤 4 同族复核 = raw §157-158 |
| 3 | 覆盖度：S-89 主修 + 可诊断性 + 可选补跑 | ✅ | 步骤 1 = raw §264 主修（下沉到 `runSidecarTextRequest`，`4` 个调用点同时受益，实读确认调用点为 `memory-automation-utils.ts:409` / `memory-automation-internal.ts:192`·`:217` / `generate-title.ts:245`）；步骤 2 = raw §265；步骤 4 = raw §266（nightly 补跑，记档不修） |
| 4 | 覆盖度：S-90 两 tab + 内滚处置 | ✅ | 步骤 1（页内自建 tab，抄 `ProviderPanel.tsx` 先例）= raw 待裁定 1；步骤 2（去 `max-h-64`）= 待裁定 2；步骤 3/4 = 锚点与 locale 配套 |
| 5 | 覆盖度：S-91 裁定 A + 五项待裁定 | ✅ | 裁定 A 落步骤 3；待裁定 1（daily 去向）、2（呈现形态）、3（分工）、4（三处路径）、5（死字段/孤儿 key）分别由步骤 3/4/6 与 V4 承接；勘测对 raw 的三处纠正均以 Plan 为准且核对属实 |
| 6 | 覆盖度：S-92 缺陷一 + 缺陷二 | ⚠️ | 缺陷一（方案 2 剥块）落步骤 1-2；缺陷二按 V7 暂不定案（raw §480 同口径）。**raw §524 第三条待裁定「是否把召回开放成 agent 可显式调用的工具」在 plan 与 V1~V7 中均无承接** —— 遗漏（见 ⚠️-1） |
| 7 | 覆盖度：S-93 两链合并 | ✅ | 步骤 1（补 `workingFolder`）+ 步骤 2（phase2 写 DB）+ 步骤 3（去重）= V5 的两条硬缺口；步骤 4 记档 S-89 关系 |
| 8 | 覆盖度：S-94 修法 ①②③ | ✅ | 步骤 1 = ①，步骤 2 = ②，③按 V6 明确不做；与 raw §618 倾向一致 |
| 9 | 落点真实性（重点） | ⚠️ | 全部 C#/TS 行号实读核对，**绝大多数属实**（见「行号核对汇总」）；**2 处错引**：`DbCronRunTools` 的 `List` 实为 `:115`（plan 写 `:168`，那是 SQL 行）、`OrganizationTarget` 接口实为 `memory-organization.ts:100`（plan 写 `:105`，那是 `sshConnectionId` 字段行） |
| 10 | 可行性：S-88 新建回归套件 | ✅ | 可落地，落地清单见下；`MatchesFileName` 现为 `private static`（`GrepTool.cs:397`），改 `internal static` + `InternalsVisibleTo` 即可被新套件调用；`GrepTool` 为 `public sealed class` |
| 11 | 可行性：S-87 执行侧「首选直连 DbCronRunTools」 | ❌ | **首选路径有副作用与契约错配**：`DbCronRunTools.List` 在只读名义下会执行 `UPDATE cron_runs SET status='aborted' WHERE status='running'`（`DbCronRunTools.cs:148-162`），仅当传入 `activeRunIds` 时才加 `NOT IN` 排除；Agent 层（Worker 内）拿不到 Main/渲染端的活跃 runId ⇒ **任何在用 cron 运行会被误标 aborted**。且参数名不符（工具参数 `jobId` vs `List` 期望 `cronId`，`DbCronRunTools.cs:121`）。见 ❌-1 |
| 12 | 可行性：S-89 加 `sessionId?` 形参 | ✅ | `buildSidecarAgentRunRequest` 签名已含 `sessionId?: string`（`sidecar-mapping.ts:204`）并在 `:306` 透传；给 `runSidecarTextRequest` 加**可选**形参是向后兼容改动，**4 个调用点无需同改**（缺省走合成常量） |
| 13 | 可行性：S-91 新增 `memory/entries` | ✅ | 复用类型已在 JSON 源生成上下文注册：`WishfulClawJsonContext.cs:87-89`（`MemoryEntryRow` / `List<MemoryEntryRow>` / `MemoryEntriesByStatusResponse`）⇒ **无需改 JSON 源生成**（plan 判断正确）；注册写法 = `MemoryModule.cs:30` 旁 `context.Register("memory/entries", MemoryEntries)` |
| 14 | 可行性：S-93 插入前去重 | ⚠️ | 可做，但 plan 未指明**「取同 scope 已有条目」用哪个调用**（`memorySearch` / `memoryEntriesByStatus` / 新建 `memoryEntries` 三者皆可），实施者需自行拍板；`memory-automation-internal.ts` 现有依赖面需确认可引渲染端 helper（见 ⚠️-7） |
| 15 | 验证检查点：可执行、有硬证据 | ⚠️ | 编译命令（`dotnet build` / 三配置 `tsc`）、套件退出码、真机现象均写明，无「应该没问题」式空话。但 S-87 两处「断言」**未指定落点的套件**（见 ⚠️-2） |
| 16 | 分层与规范：改动落层 / 逆向依赖 | ✅ | S-88/S-92 落 Agent；S-94 落 Workspace；S-91 落 Worker+renderer；S-89/S-90/S-93 落 renderer。**无逆向依赖**：S-87 Agent 引用 Infrastructure（`DbCronRunTools`）合符 AGENTS.md「Agent 依赖 Infrastructure」；`MemoryModule` 仍只在 Worker |
| 17 | AOT 规范 | ✅ | S-91 复用已注册的具名类型；S-87 返回 Infrastructure 既有序列化类型；无匿名类型序列化、无反射 |
| 18 | 大文件红线（>500 行） | ⚠️ | 实读行数：`MemorySettingsPanel.tsx = 520`、`ProjectArchivePage.tsx = 596`、`memory-organization.ts = 580` —— **三处均超 AGENTS.md「超过 500 行必须拆分」**，plan 既未拆分也未给豁免说明（`MemoryModule.cs` 450、`MemoryFtsService.cs` 133、`GrepTool.cs` 432 未超）。**〔2026-09-19 收尾订正〕** 上列为规划态实读值；收尾后实测：`MemorySettingsPanel.tsx` **355**、`ProjectArchivePage.tsx` **377**（**均已拆回红线内**）、`memory-organization.ts` **636**（**仍超线**，plan 已记档豁免）、`MemoryModule.cs` **495**、`GrepTool.cs` **299**（原 432 是行尾损坏下的虚高行数） |
| 19 | 待裁定项完备性（V1~V7） | ⚠️ | V1↔S-87#3、V2↔S-87#4、V3↔S-89 口径、V4↔S-91#、V5↔S-93、V6↔S-94、V7↔S-92 缺陷二，**覆盖正确且暂取值与 raw 倾向一致**；唯一缺口是 raw §524 S-92 第三条待裁定（同 ⚠️-1） |
| 20 | 遗漏与矛盾 | ⚠️ | 内部无明显自相矛盾；三处小瑕：S-91 步骤 3 引用不存在的「步骤 0」、S-87 步骤 2 把「直连 DB」与「`:45-48` op 映射」并列（互斥接线）、「涉及文件」清单不全（见 ⚠️-5/⚠️-6） |
| 21 | 实施顺序 | ✅ | S-88→S-92→S-94→S-87→S-89→S-90→S-91→S-93 的理由链自洽：同链修复先行（S-92 是 S-93/S-94 的前置口径）、S-90 页面结构先于 S-91、S-89（热记忆→DB 通道）先于 S-93 |

### ❌ 阻断项

**❌-1：S-87 步骤 2「执行侧首选直连 `DbCronRunTools.List`」不可直接照做 —— 会在只读名义下误杀在用 cron 运行，且参数名不匹配**

- **问题**：plan:90 写「首选：直接复用 `Infrastructure/Db/DbCronRunTools.cs`（`:168` 的 `List`，agent 层可依赖 Infrastructure，无需为读一张 SQLite 表再开一条 reverse-request 通道）」。但实读 `DbCronRunTools.List`（**定义在 `:115`，非 `:168`**）在查询前会先执行一段**写操作**：
  - `DbCronRunTools.cs:148-162`：`UPDATE cron_runs SET status='aborted', error=@orphanError, finished_at=@now WHERE status='running'`，**仅当 `parameters.activeRunIds` 非空**时才追加 `AND run_id NOT IN (…)`。
  - 即：**不传 `activeRunIds` 时，该 UPDATE 会把当下每一个 `running` 行一律标成 `aborted`**。
- **为什么 Agent 拿不到 `activeRunIds`**：该集合是 cron 执行器**内存态**（`AutomationPage.tsx:50-54` 从 `window.__cronRuntime.getActiveRunIds()` 取），属 Main/渲染侧；Agent 工具在 Worker 内执行，无从取得。⇒ 照「首选」实现后，只要用户在定时任务正在跑时让 agent 调一次 `CronRuns`，正在运行的记录会被误标 aborted，随后 `Finish`（`:60` 要求 `status='running'`）不再命中，**该次运行的状态/摘要/错误永久丢失**。
- **附带的契约错配**：`List` 过滤键是 `cronId`（`:121`、`:166`），而 plan 给工具的形参是 `jobId`；直连需显式映射，plan 未写。
- **结论**：「直连」不是「读一张表」那样无副作用，plan 给出的理由（去掉一条 reverse 通道）不成立。
- **修法建议（三选一，写死即可解）**：
  1. **改用 plan 自备的退回路径**：走 reverse-handler 新增 `cron:runs`（`AgentRuntimeCronExecutor.cs:45-48` 加 `"CronRuns" => "cron:runs"`），在 Main 侧调用时**带上 `activeRunIds`**（与 `db/cron-runs-list` 同范式，`AutomationPage.tsx:57`）—— 与 plan 已在 `:90` 记的退回方案一致，风险最低；
  2. 若坚持 Worker 内直连：**不复用 `DbCronRunTools.List`**，改为新增一个纯只读查询（`SELECT … FROM cron_runs` + `cron_id`/`limit`），绕开 orphan 归一化写；
  3. 若坚持复用 `List`：则必须让 Agent 侧能拿到 `activeRunIds`（新增一条反向请求取活跃集合），等于是把「直连去掉一条通道」的收益又还回去 —— 不推荐。
- 无论选哪条，plan 都需把工具参数 `jobId` 与底层 `cronId` 的映射写进步骤。

### ⚠️ 建议项

- **⚠️-1（覆盖缺口）S-92 第三条待裁定未承接**：raw §524 明列「是否把『召回』开放成 agent 可显式调用的工具（目前只有自动召回一条路）」，plan 的 S-92 步骤与 V1~V7 均未涉及。建议：要么新增 V8 承接（并给暂取值，如「本刀不做、记档」），要么在 S-92 步骤 4 的记档项里显式写「不开放」。
- **⚠️-2（验证落点）S-87 的「断言」无处可落**：plan:88/91 写「断言：`global:chat` 可见、`project:cowork` 仍可见、`project:chat` 不可见」「能列出 `cron_runs` 行、`jobId` 过滤生效」，但未指定套件。实读现有套件：`ChannelToolVisibilityRegressionTests` 与 `ProviderHeaderRegressionTests` 的可见性断言只查 **`direct` 集（`scope ∧ IsCore`）**（`ChannelToolVisibilityRegressionTests/Program.cs:204`、`VisibilitySnapshot.cs:92-116`），而 cron 工具**非 `IsCore`**（`CronToolProvider` 未传 `isCore`，`ToolDefinitionPlaceholder` 默认 `false`）⇒ 放宽 `visibleScopes` 后 cron 只进 `use_capability` 代理，**不进 `direct`**，也不会改动金样 `visibility-snapshot.expected.txt`（实读该文件仅 16 行，无 `Cron*`）。**结论：金样无需重生成（属正确判断），但 plan 所述断言当前没有承载套件** —— 建议明确把「cron 类别在 `global:chat`/`global:channel` 的代理可达性」写进 `ChannelToolVisibilityRegressionTests`（或 `ToolDeclarationChecks`），否则该验证只有人工 `tsc`/编译证据。**同时提醒**：plan 应显式声明「金样不受影响、无需重生」，避免实施者看到可见性改动就去盲改金样（iter-30/31 已有「金样只能证明行为没变、发现不了漏改」的教训）。
- **⚠️-3（行号错引）2 处，须修正**：
  - `DbCronRunTools` 的 `List`：plan 写 `:168` → 实为 **`:115`**（`:168` 是 SQL 拼接行）。
  - `OrganizationTarget`：plan S-93 步骤 1 写 `memory-organization.ts:105` → 接口声明在 **`:100`**（`:105` 是 `sshConnectionId?` 字段）。
- **⚠️-4（大文件红线）三处 >500 行未处置**：`MemorySettingsPanel.tsx`（520 行，S-90 还要加 tab bar）、`ProjectArchivePage.tsx`（596 行）、`memory-organization.ts`（580 行，S-89 步骤 2 要改）。AGENTS.md 硬规则「超过 500 行必须拆分」。`ProjectArchivePage` 因步骤 4 删 daily 可能净减，但仍超线。建议：至少在 plan 里给一句「本次不拆 / 或拆分落点」，别默认无视红线（`MemorySettingsPanel` 的拆分可参考其文档注释第 5 条例外，但需说明）。**〔2026-09-19 收尾订正〕** 本条已闭环：`MemorySettingsPanel.tsx` 520 → **355**（拆出 `MemoryExecutionLogSection.tsx` 85 + `MemoryTierSettingsSections.tsx` 229）、`ProjectArchivePage.tsx` 596 → **377**（拆出 `ProjectMemoryFileTab.tsx` 191 + `ProjectMemoryLibraryTab.tsx` 132）；`memory-organization.ts` 580 → **636**（**仍超线**，已在 plan 记档豁免、另开一刀）。
- **⚠️-5（涉及文件不全）**：
  - S-88：还需改 `src/runtime/WishfulClaw.Agent/WishfulClaw.Agent.csproj`（追加 `<InternalsVisibleTo Include="WishfulClaw.GrepPatternRegressionTests" />`，现 `:17-24` 列 6 条）与 `tests/WishfulClaw.Tests.sln`（新增 Project 项 + 12 行 `ProjectConfigurationPlatforms`）；plan 只列了新测试目录与 `GrepTool.cs`。
  - S-89：步骤 3（口径订正）要改 `provider-payload.ts:19` 与 `chat-store/index.ts:397-401` 的注释 —— 均在「涉及文件」清单外。
  - S-92：新增纯函数 `StripInjectedBlocks` 的**落点文件**未指定（plan 只说「放 Agent 层」）。
- **⚠️-6（表述/冗余）**：S-91 步骤 3 引用「步骤 0」不存在（S-91 步骤为 1~6）；SSH scope 构造建议不要渲染端自拼 `project:ssh:{…}`，而是照 `memoryEntriesByStatus` 的既有范式传 `scope='project'` + `projectId`/`workingFolder`/`sshConnectionId`，由 Worker `GetScope`（`MemoryModule.cs:358-393`）解析 —— 与 `memory-helpers.ts:219-235` 一致，少一处易错分支。S-87 步骤 2 同段并置「直连 DB」与「`:45-48` op 映射」两种**互斥**接线，建议按 ❌-1 的结论二选一写死。
- **⚠️-7（去重调用未写死）**：S-93 步骤 3 的「取同 scope 已有条目」需指定调用（推荐新建的 `memoryEntries` 或既有 `memoryEntriesByStatus`）；`paragraphStillPresent`（`memory-organization.ts:178`）只是**字符串包含**范式，不等于能取到 DB 现有行。另需确认 `memory-automation-internal.ts` 的 `runPhase2ForRoot` 引入渲染端 helper 后不破坏其现有依赖面。

### 行号核对汇总

（plan 引用 → 实读结果；未标错者均为 ✅）

- `GrepTool.cs:397-425`（`MatchesFileName` 定义 `:397`，`StartsWith("*.")` 在 `:411`、`pattern[1..]` 在 `:415`）→ ✅；`:343-393`（`EnumerateSearchableFiles`）→ ✅；`:263-269`（`No matches found.` 在 `:267`）→ ✅；`:353`（`SearchFilter.IsExcluded`）→ ✅；`GlobTool.cs` **无** `MatchesFileName`（仅共用 `SearchFilter.IsExcluded`，`GlobTool.cs:205`）→ plan「不共用」结论 ✅。
- `AgentLoop.MemoryRecall.cs:33-36`（`conversation.Where(...).LastOrDefault()`）→ ✅；`AgentLoop.cs:16`（`OpenClaw.net: TryInjectRecallAsync (iteration 7)`）→ ✅；`:247`（`InjectTransientPrefix`）→ ✅；`:333-335`（`if (iteration == 1)` / recall 调用）→ ✅；`AgentLoop.Helpers.cs:297-351`（`InjectTransientPrefix` 定义）→ ✅；`:315-319`（`PendingMemoryRecall` 消费点）→ ✅；`MemoryRecallQueryRefiner.cs:41`（`ExtractVariants(maxVariants=4)`，实为 Workspace 层 `Memory/MemoryRecallQueryRefiner.cs`）→ ✅；「全仓无现成剥块辅助」→ ✅。
- `MemoryFtsService.cs:41-42`（`q = query.Trim()` / `BuildFtsLiteralQuery`）→ ✅；`:85`（LIKE fallback 门控）→ ✅；`:107-127`（`RowToResult(…, hasScore)`）→ ✅；`MemoryRecallService.cs:199-205`（`PassesThreshold`）→ ✅。
- `CronToolProvider.cs:36/43/56/63/70/77`（六处 `visibleScopes: WorkRunsOnly`）→ ✅；`AgentRuntimeCronExecutor.cs:26`（工具名单）/`:36`（`RequiresApproval`）/`:45-48`（op 映射）→ ✅；`ToolVisibilityScopes.GlobalSideAndWorkRuns = ["global:*@*","*:cowork@*"]`（`WishfulClaw.Core/Tools/ToolVisibilityScopes.cs:39`）、`WorkRunsOnly = ["*:cowork@*"]`（`:32`）→ ✅；`AgentRunContextPolicy.cs:53-57`（global⇒chat）→ ✅。
- `DbCronRunTools.cs` 的 `List` → **`:115`（plan 写 `:168`，错）**；orphan 写见 `:148-162`；过滤键 `cronId` 见 `:121`；`db/cron-runs-list` 注册在 `DbModule.cs:183`。
- `MemoryModule.cs:30`（`context.Register("memory/entries-by-status",…)`）/`:140`（`INSERT INTO memory_entries`）/`:288-289`（空 status 返回空）/`:305-309`（`SELECT … entries-by-status`）/`:368-371`（SSH `GetScope` 分支）→ ✅；`WishfulClawJsonContext.cs:87-89` → ✅；`DbClient.cs:275-284`（`memory_entries` 建表，无唯一索引）→ ✅。
- `agent-bridge-streaming.ts:254-274`（`runSidecarTextRequest`，`buildSidecarAgentRunRequest` 调用在 `:265-274`，未传 `sessionId`）→ ✅；`sidecar-mapping.ts:204`（`sessionId?: string`）/`:306`（透传）→ ✅；S-89 四个调用点 `memory-automation-utils.ts:409` / `memory-automation-internal.ts:192`·`:217` / `generate-title.ts:245` → ✅。
- `memory-organization.ts:51`（`error?: string | null`）→ ✅；`:329-335`（catch + `llm_unavailable`）→ ✅；`:259`（`memoryAppend` 调用）→ ✅；`:178`（`paragraphStillPresent`）→ ✅；`OrganizationTarget` 接口 → **`:100`（plan 写 `:105`，错）**。
- `memory-automation-internal.ts:333`（`evidence: { writtenItems: … }`）→ ✅；plan 写的「约 `:319`」（写文件之后/`recordEntry` 之前）→ 实读 `:315-320` 区间，✅（「约」可接受）。
- `memory-helpers.ts:116-132`（`memoryAppend` 签名）→ ✅；`memoryEntriesByStatus` 在 `:219-235`（`status` 必填，非空 `scope='all'` 语义）→ ✅；`shared/memory-automation-types.ts:74-80`（`MemoryRootDescriptor` 无 `workingFolder`）→ ✅；`DbCronRunTools`/`MemoryEntryRow` 相关类型 ✓。
- `MemorySettingsPanel.tsx:147`（容器 `mx-auto max-w-4xl`）→ ✅；`:424-478`（`sec-memory-execution-log`）→ ✅；`:432`（`max-h-64`）→ ✅；`SettingsPage.tsx:53-57`（`MEMORY_ANCHORS`）→ ✅；`:214`（`SectionAnchorNav`）→ ✅。
- `ProjectArchivePage.tsx:44-48`（`MEMORY_TABS`）/`:68-76`（`dailyFile`）/`:102-105`（`dailyPath`）/`:148-177`（`loadDailyFile`）/`:252`·`:591`（dormant 注释）/`:257`·`:260`·`:283-289`·`:298-299`（save/reset/reload daily 分支）/`:450`（tab 判定）/`:510-516`（编辑区分支）→ ✅；`project-archive-helpers.ts:6`（`ArchiveTabId`）/`:56-60`（`DEFAULT_DAILY_TEMPLATE`）→ ✅；`memory-files.ts:108/133/160`（daily 三函数）→ ✅；其消费方 `memory-snapshot.ts:145-148`（非档案页）→ ✅（plan 对 raw 的纠正成立）。
- `locales/zh|en/chat.json:1044`（`tabs.daily`）/`:1046`（`tabs.dormant` 孤儿 key）→ ✅；`settings.json` 的 `memoryPage`（zh `:1542`/en `:1403`）与 `usage.tabs.*` 先例（zh `:1651`/en `:1512`）存在 → ✅；`AutomationPage.tsx:57`（`db/cron-runs-list`）→ ✅。
- `WishfulClaw.Agent.csproj:17-23`（`InternalsVisibleTo` 6 条，实为 `:17-24`）→ ✅。

### S-88 落地清单（复验用）

新增回归套件需 **4 处动作**，缺一即不编译/不生效：
1. 新建 `tests/WishfulClaw.GrepPatternRegressionTests/WishfulClaw.GrepPatternRegressionTests.csproj`（照 `tests/WishfulClaw.MemoryRecallRegressionTests/*.csproj`：`OutputType=Exe`、`net11.0`、`Nullable`、ProjectReference 到 `WishfulClaw.Agent`（+ 如需要 Infrastructure/Workspace））。
2. 新建 `tests/WishfulClaw.GrepPatternRegressionTests/Program.cs`（`internal static class Program` + `Main()` 返回 0/1 的断言范式）。
3. 在 `src/runtime/WishfulClaw.Agent/WishfulClaw.Agent.csproj` 的 `InternalsVisibleTo` ItemGroup 追加 `WishfulClaw.GrepPatternRegressionTests`。
4. 在 `tests/WishfulClaw.Tests.sln` 追加 Project 项（新 GUID）**并**补齐 12 行 `ProjectConfigurationPlatforms`（Debug/Release × Any CPU/x64/x86 各 ActiveCfg+Build）。**不需要**改 `src/runtime/WishfulClaw.sln`。
> 另：`MatchesFileName` 需由 `private static` 改 `internal static`（步骤 3 已写明，✅）。

### 复验结论

- 阻断规则：❌ > 0 禁止进入用户确认环节。**本轮 ❌ = 1**（S-87 执行侧「直连 `DbCronRunTools.List`」的首选路径含误杀在用运行的副作用 + 参数名错配）。
- **最终判定：FAIL**。须先把 ❌-1 二选一写死（推荐改走 plan 自备的 `cron:runs` reverse 路径并带 `activeRunIds`），并把 ⚠️-3 的两处行号、⚠️-1 的漏项、⚠️-2 的断言落点补进 plan。
- 其余 20 项检查中，覆盖度（除 S-92 一项）、分层依赖、AOT、实施顺序均为 ✅；S-88/S-89/S-91 三项可行性经源码核实为**可落地**（含具体清单与结论）。
- 修掉上列后即可复验（预计仅需针对 S-87 步骤 2 与三处文档项重读，不需重跑全量）。
---

## 六、复验（第二轮 plan 修订后）

- 被审文档：docs/plans/iter-v2-33/plan.md（修订版）
- 审查者：独立 subagent（architect-reviewer）
- 日期：2026-09-19
- 结论：**PASS（0 个 ❌；1 个 ⚠️ 残余）**

> 复验方式：只针对 §五 的 1 个 ❌ + 7 个 ⚠️ 逐条回源码实读核对（未重跑全量）。所有行号为 2026-09-19 实读。修订版 plan 已消除唯一的阻断项，7 个 ⚠️ 中 6 个处置到位、1 个仅部分处置（均非阻断）。

| # | 复验项 | 结论 | 证据 |
|---|---|---|---|
| 1 | ❌-1（关键）S-87 步骤 2 执行侧改法：新增纯只读 `ListReadOnly` + Agent 直调 + `jobId`→`cronId` 映射 + 不经 `AgentRuntimeCronExecutor` | ✅ | **逐条回源码核实全部属实**：`DbCronRunTools.List` 定义在 **`:115`**（plan:94 写 `:115` 且显式注明「不是 `:168`，`:168` 是 SQL 拼接行」）；orphan 写 `UPDATE cron_runs SET status='aborted' … WHERE status='running'` 在 **`:148-162`**，`NOT IN` 仅当 `activeRunIds` 非空才拼（`:151-161`）；过滤键 `cronId` 在 **`:121`** 与 **`:166`**；helper `RequireString`/`GetString`/`GetInt`/`GetLong` 均在（`:182-195`，新方法可复用）；返回类型 `WorkerResponse.Json` ✅。`cron-runtime.ts` 的 `activeRunIds` Set 在 **`:27`**、`getActiveRunIds()` 在 **`:41`** ✅。`AutomationPage.tsx` 的 `window.__cronRuntime.getActiveRunIds` 在 **`:51-54`**、`db/cron-runs-list` 调用在 **`:57`** ✅。`CronRunLock`（`cron-execution-coordinator.ts:6-38`）**以 `jobId` 为键、不含 runId** ✅。`handleCronReverseRequest`（`cron-reverse-handler.ts:731-757`）**无 `cron:runs`**（switch 仅 add/update/delete/toggle/list/run-now/run-complete）✅。`channels.ts:218` `CRON_RUNS='cron:runs'` 存在且 `registerCronHandlers`（`:697-705`）**未注册** ⇒ 确无 handler ✅。`ToolDispatchRouter.cs:329` 确为 `IsCronTool` 分支（`:329-343`），另加直连分支可行 ✅。**可行性成立**：Agent 直调 Infrastructure `Db*Tools` 有先例 —— `GoalProgressTool.cs:56-65` 以 `parameters` 直调 `DbGoalPlanTaskRoundTools.InsertPlanTask`；`GoalOrchestratorMaterialize.cs:244` 用 `DbClient.GetClient(parameters)`；WorkerResponse→工具输出串的转换先例见「实施注意」 |
| 2 | ⚠️-1 V8 承接 raw §524 | ✅ | plan:40 新增 **V8**（「S-92 第三条待裁定：是否把『召回』开放成 agent 可显式调用的工具」→ 暂取「本刀不做，记档」，出处 raw §524）；plan:70（S-92 步骤 4 ③）再次引用 V8。漏项已补 |
| 3 | ⚠️-2 S-87 断言落点 + 金样声明；`ChannelToolVisibilityRegressionTests` 是否合适 | ✅ | plan:91 写明落点 = `tests/WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs`，plan:92 声明金样 `visibility-snapshot.expected.txt` **无需重生成**。**套件合适**：`Program.cs:290-291` 的 `Allowed(...)`= `AgentRunContextPolicy.IsToolAllowed(runContext, name, registry, channelSession:true)`（代理可达性口径）可直接承载 cron 断言；套件已有 `registry.IsAvailableInMode`（`:157`）与自建 `ToolRegistry`（`:239-276`，含 `new CronToolProvider()`）范式。金样核验：`tests/WishfulClaw.ProviderHeaderRegressionTests/visibility-snapshot.expected.txt` **无任何 `Cron*` 行** ⇒ 「无需重生成」属实 |
| 4 | ⚠️-3 两处行号修正、且不再残留旧错引 | ✅ | plan:94 更正为 `DbCronRunTools.cs:115`；plan:166 更正为 `memory-organization.ts:100`。源码核对：`memory-organization.ts:100` = `interface OrganizationTarget`、`:105` = `sshConnectionId?: string \| null` ✅。**旧号 `:168` / `:105` 仅作为显式否定出现**（「不是 `:168`…」「不是 `:105`…」），非残留错引。留意：plan:160 的 `MemoryAppendTool.cs:105` 是**另一个文件**（该行确为 `INSERT INTO memory_entries`，实读属实），不是残留错引 |
| 5 | ⚠️-4 三个 >500 行文件的拆分/豁免 | ⚠️ | 行数实读：`MemorySettingsPanel.tsx=520`、`ProjectArchivePage.tsx=596`、`memory-organization.ts=580`（均 >500）。前两者已处置：plan:128 拆出 `components/settings/MemoryExecutionLogSection.tsx`（抽出后 ≈465 行）；plan:150 拆出 `components/chat/ProjectMemoryLibraryTab.tsx`。**但 `memory-organization.ts`（580 行、S-89 步骤 2 还要改 `:329-335`）全文无拆分/豁免说明** ⇒ 仍留 1 处缺口（非阻断）。**〔2026-09-19 收尾订正〕** 该缺口未消除：收尾后实测 `MemorySettingsPanel.tsx` **355**、`ProjectArchivePage.tsx` **377**（前两者确已拆回红线内），`memory-organization.ts` **636**（**仍超线**）⇒ 已在 plan 补「S-93 改 `memory-organization.ts`（636 行 > 500）红线豁免 + 记档另开一刀」 |
| 6 | ⚠️-5 涉及文件清单补全 | ✅ | plan:196 `WishfulClaw.Agent.csproj`；plan:216 `tests/WishfulClaw.Tests.sln`；plan:207 `provider-payload.ts` + `chat-store/index.ts`；`StripInjectedBlocks` 落点在 plan:63 与 plan:197（`AgentLoop.MemoryRecall.cs`）；新拆组件 plan:210 / plan:212。5 项缺项全部补齐 |
| 7 | ⚠️-6 / ⚠️-7「步骤 0」失引、SSH scope 范式、S-87 二选一、S-93 去重调用 | ✅ | 「步骤 0」已消失，plan:149 改引「照上文『勘测修正』第 3 条」；SSH scope 范式写死（plan:142 勘测修正第 3 条 + plan:149：**不自拼 `project:ssh:{…}`**，传 `scope='project'`+`projectId`/`workingFolder`/`sshConnectionId`，由 Worker `GetScope` 解析）；S-87 执行侧**唯一路径**写死（plan:94-96：新增 `ListReadOnly` 直连，不经 reverse / 不经 op 映射）；S-93 去重调用写死（plan:172 用 `memoryEntries(scope, …)`，明确不用 `memoryEntriesByStatus`）+ 比对口径（plan:173） |
| 8 | 新增回归检查：修订是否引入新问题 | ✅ | ① `CronRuns` 不在 `AgentRuntimeCronExecutor.CronToolNames`（`:24-27` 六项）⇒ 与 `IsCronTool` 无冲突；② `RequiresApproval`（`:36-37`）仅 `CronAdd/Create/Update`，且 default-mode 审批集 `DefaultModeApprovalTools`（`ToolCallProcessor.Approval.cs:49-57`）不含 `CronRuns` ⇒ **不会被误拦**；③ 可见性放宽**不破坏既有断言**：`ChannelToolVisibilityRegressionTests` 的 `OverExposureTools`（含 CronAdd/Create/Update，`:42-48`）只在 `direct`（scope ∧ IsCore）集断言不可见（`:144`/`:204`），cron 非 IsCore ⇒ 只进代理、不进 `direct`；`CronRegressionTests.cs:96` 只断言六项存在、不断言缺 CronRuns；④ 新增直调方法**无需注册 Worker op**（in-process 直调），plan 判断正确；⑤ 命名 `ListReadOnly` 与本文件 terse 风格（Start/Finish/Get/List）略异但无冲突（详见「新引入问题」） |

### 仍未解决

- **⚠️-4 残余（非阻断）**：`memory-organization.ts` 实读 **580 行**（>500 红线），S-89 步骤 2 仍要改它，修订版 plan 未给拆分落点或豁免说明。建议补一句处置（如抽出 `paragraphStillPresent`/错误诊断等纯函数到同目录小模块，或显式声明豁免并给理由）。

### 新引入问题

- 无阻断项、无新的 ❌。两条非阻断提示：
  1. **（提示）`ListReadOnly` 命名与文件风格略异**：`DbCronRunTools` 现有方法为 `Start/Finish/Get/List`（动词式），`ListReadOnly` 为「动词+限定」，全仓 `*/Db/*.cs` 无同名范式。不冲突，但若求一致可考虑 `ListSafe` / `Query`；实施时按 plan 原样命名亦可。
  2. **（提示）`ListReadOnly` 的返回类型/转串方式未写死**：plan:95 只说「只 `SELECT …`」，未指明返回值沿用 `WorkerResponse.Json(...)` 还是直接返回行列表。**可行**（先例见下），但建议在步骤 2 里写死以省实施推断。

### 实施注意（供执行阶段照抄的结论）

1. **Agent 直调 Infrastructure `Db*Tools` 的可行性 = 已确证**，两个可照抄的先例：
   - **调用侧**：`GoalProgressTool.cs:56-65` —— 拿 `var parameters = state.Parameters;` 后直调 `DbGoalPlanTaskRoundTools.InsertPlanTask(parameters, …)`；Db 侧方法（`DbGoalPlanTaskRoundTools.cs:105-107`）入参即 `JsonElement parameters`，内部 `DbClient.EnsureInitialized/GetClient(parameters)`。`DbCronRunTools.ListReadOnly(JsonElement parameters)` 照此形状即可。
   - **转工具输出串**：若 `ListReadOnly` 沿用 `WorkerResponse.Json(rows, InfrastructureJsonContext.Default.ListCronRunRow)`（与 `List` 的 `:173` 同一类型），Agent 侧转串照抄 `AgentRuntimeGlobalTaskExecutor.cs:451-458` 的 `ForwardDbResult(WorkerResponse response)`：`JsonDocument.Parse(response.ToJsonBytes(null))` → 取 `root.GetProperty("result").GetRawText()`；错误分支对齐 `ToolDispatchRouter.cs:340` 的 `$"Cron tool execution failed: {ex.Message}"` 范式（`isToolError=true`）。若改为直接返回行列表，则照 `GoalProgressTool.EncodeOk`（`:88-100`）手写 JSON 输出。
2. **S-87 步骤 1 断言落点**：写进 `tests/WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs`，用其既有 `AgentRunContextPolicy.IsToolAllowed(..., channelSession:true)`（`Allowed`，`:290`）断言 cron 六项的代理可达性；**project:chat 不可达**一条需另造一个 project run 上下文（套件现仅建 channel/global 上下文，`:69-70`），其余范式可直接复用。**不要碰 `visibility-snapshot.expected.txt`**（无 Cron 行）。
3. **S-87 执行侧 = 唯一路径**：新增 `DbCronRunTools.ListReadOnly`（纯读，无 orphan 写、无 `activeRunIds` 依赖）+ `ToolDispatchRouter` 另加直连分支；**不改** `AgentRuntimeCronExecutor`（含 `RequiresApproval` 与 `CronToolNames` 六项），**不接线** `channels.ts:218` 的 `CRON_RUNS`。参数 `jobId` 在直连分支内显式映射为底层 `cronId`（`:121`/`:166`）。
4. **S-93 去重**：用 S-91 新建的 `memoryEntries(scope, …)` 取同 scope 全量（**不要**用 `memoryEntriesByStatus`，空 status 返回空），再按归一化文本做包含判断。
5. **⚠️-4 收尾**：补 `memory-organization.ts`（580 行）的拆分/豁免处置。
