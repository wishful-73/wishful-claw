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

---

## 规划验证（第二批 S-98 ~ S-100，2026-09-20）

- 被审文档：`docs/plans/iter-v2-33/plan.md` 的「## 第二批（S-98 / S-99 / S-100）」（plan.md:187-255）
- 需求基准：`docs/plans/iter-v2-33/raw-requirements.md` S-98（`:1120-1163`）、S-99（`:1194-1235`）、S-100（`:1239-1301`）
- 规范基准：`AGENTS.md`（7 层单向依赖 / AOT 十条 / 单文件 ≤ 500 / 命名）、`docs/dev-workflow.md`（阶段二 plan 格式 + 阶段三检查项）
- 审查者：独立 subagent（architect-reviewer）
- 日期：2026-09-20
- 结论：**FAIL（2 个 ❌）**

> 审查方式：纯静态审查（未跑构建、未跑测试、未改任何源码）。plan 引用的每个文件均回源码实读；行号一律 2026-09-20 实测（`(Get-Content X).Count` 计**含空行的总行数**，与 plan 自报基线同口径 —— plan 给的 6 个基线值经复核**全部一致**：`MemoryModule.cs` 495 / `MemoryEntriesTab.tsx` 322 / `ProjectMemoryLibraryTab.tsx` 132 / `memory-helpers.ts` 293 / `MemoryFtsService.cs` 155 / `use-composer-interactions.ts` 119；`AotMemoryResultTypes.cs` 实测 **40 行**）。

### 一、逐条审查项结论

| # | 检查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 步骤覆盖三个需求的目标 / 落点完整性 | ⚠️ | S-99（S99-1~5）与 S-100（S100-1~3）**目标覆盖完整**；S-98 覆盖 raw 的 6 条要改项 + 3 条待裁定：offset（S98-3）= §1146、tiebreaker `updated_at {dir}, id {dir}`（S98-3）= §1147、总数选 A（S98-2/3）= §1149、前端请求驱动 + 删 `ENTRY_FETCH_LIMIT`（S98-5）= §1156、排序下推 SQL（S98-3/5）= §1157、档案页一并改（S98-6）= §1163、i18n 四文件齐备（S98-7）。**缺口**：`memoryEntries()` 现有 **3 个**消费方，plan 只认 1 个（见 ⚠️-1）；S-100 缺 raw 明确要求的「定案实测」（见 ❌-2） |
| 2 | 每步是否有可执行、可判定的验证检查点 | ❌ | 20 个步骤中 18 个的检查点可判定（tsc 三配置 / `dotnet build` 双 sln / 套件 `exit=0` / 真机三条），无「应该没问题」式空话。**S99-3 的检查点在 AND 语义下不可判定**（见 ❌-1）；S98-1 的「新文件 ≤ 130 行」自设阈值偏紧（见 ⚠️-6）；S100-1 的检查点只有 `tsc` 零错误、行为无任何可判定证据（见 ⚠️-4） |
| 3 | 文件路径 / 分层依赖方向 | ⚠️ | 正确项：S-99 落 `WishfulClaw.Workspace/Memory/MemoryFtsService.cs`（Workspace 层 ✅）、S-98 落 `WishfulClaw.Worker/Modules/`（Worker 层 ✅）、`AotMemoryResultTypes.cs` 留 Workspace ✅、新 partial 文件 `MemoryModule.Entries.cs` 落 Worker ✅、渲染端三文件与 `locales/{zh,en}/{settings,chat}.json` 路径 ✅。**依赖方向无逆向引用**：Worker 引用 Workspace（`using WishfulClaw.Workspace.Memory;` `MemoryModule.cs:5`）符合 AGENTS.md；`MemoryFtsService` 只依赖 `Infrastructure/Db`（`MemoryFtsService.cs:3`）未上引；`memory-hot-sync.ts` 引 `stores/chat-store/memory-helpers` 为同类横切，无环。**错 1 处**：`WishfulClawJsonContext.cs` 路径见 ⚠️-2 |
| 4 | 单文件 500 行红线 | ✅ | 见下表「500 行核算」。**全部触碰文件改动后均 ≤ 500**，无一处触线 |
| 5 | AOT：新增 JSON record 是否注册 | ✅（附注） | S98-2 明确「注册进 `WishfulClawJsonContext`」，覆盖 AGENTS.md AOT 规则 5。核对细节：`MemoryEntriesResponse` 内含 `List<MemoryEntryRow>`，该泛型**已注册**（`WishfulClawJsonContext.cs:88`）⇒ 只需新增 1 条 record 注册，无需补 `List<T>`（规则 8）✅。两处表述需订正见 ⚠️-5 |
| 6 | 技术性错误核验（a)(b)(c)(d) | ❌ | (a) ❌ **不成立**：`memoryEntries()` 有 3 个调用点，plan 只提 `ProjectMemoryLibraryTab`（见 ⚠️-1；(b) ✅ **成立**：`order` 白名单映射是**必要且更安全**的写法（`ORDER BY` 的值位无法参数化，白名单是唯一正确解）；(c) ✅ **成立**：单 token「逐字节一致」经现有分支核对为真（依据见下文）；(d) ✅ **成立**：`MemoryEntriesByStatusResponse` 确被两个端点共用（见下文） |

#### 审查项 6(c) 细核 —— 单 token「逐字节一致」为何**成立**

现有 `SearchAsync` 分支（`MemoryFtsService.cs:37-121`）：
- `:41 q = query.Trim()`；`:55 if (q.Length >= MinFtsQueryLength)`（`MinFtsQueryLength = 3`，`:149`）⇒ FTS 路；`:57 ftsQuery = BuildFtsLiteralQuery(q)`（`:151-152` 包双引号 + 转义 `"`）。
- `:91 if (results.Count == 0)` ⇒ LIKE 路，`@pattern = $"%{q}%"`（`:111`），score = `(title LIKE ? THEN 2) + (content LIKE ? THEN 1)`（`:103-104`）。

新增 `SplitTokens` 后：单 token 时 `tokens[0] == q`（`q` 已 Trim，无空白可拆）⇒ `BuildFtsLiteralQuery(tokens[0])` 与 `BuildFtsLiteralQuery(q)` **字面相同**；LIKE 的逐 token 累加式在 n=1 时退化为 `(title?2:0)+(content?1:0)`，与 `:103-104` **同式**。∴ 承诺成立。
**但成立的前提是「单 token 保留 FTS→LIKE 兜底」**，而 plan 的 S99-2/S99-3 把三分支写成一个 dispatch、**从未声明 FTS 零命中仍回退 LIKE**；若实施者按「全 token ≥ 3 ⇒ 只走 FTS」直译，单 token ≥ 3 就丢了兜底 ⇒ 与 S99-1 的承诺冲突（见 ⚠️-3）。

#### 审查项 6(d) 细核 —— `MemoryEntriesByStatusResponse` 确为两端点共用

`MemoryEntriesByStatus`（`MemoryModule.cs:286-328`）在 `:290`、`:325-326` 返回 `MemoryEntriesByStatusResponse`；`MemoryEntries`（`:337-372`）在 `:368-370` **也**返回同一类型 ⇒ plan 判断正确。附带核实「改它会波及 tier 浏览器」同样成立：`memoryEntriesByStatus` 的消费方是 `src/renderer/src/components/memory/MemoryPanel.tsx:68-69`（warm/cold 两路），若给该 record 加 `Total` 字段会同时改变 `entries-by-status` 的 wire 形状。**⇒ S98-2 新增独立 `MemoryEntriesResponse` 而不复用，是正确决策**（反向也印证 raw §1151 的提醒）。

### 二、500 行红线核算（`AGENTS.md`：>500 必须拆分）

| 文件 | 现状（实测） | 本批改动 | 预估 | 判定 |
|---|---|---|---|---|
| `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.cs` | **495** | S98-1 搬走 `:286-328`(48 行) + `:337-372`(43 行) = −91 | **≈ 404** | ✅（plan 自设 ≤ 420 可达） |
| `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.Entries.cs`（新建） | 0 | +搬入 91 行 + usings/namespace/partial class 头 ≈ 11 行；S98-3 再 +参数/`order` 映射/`COUNT(*)`/响应构造 ≈ 15~20 | **≈ 115~125** | ✅（plan 自设 ≤ 130，**临界**，见 ⚠️-6） |
| `src/runtime/WishfulClaw.Workspace/Memory/AotMemoryResultTypes.cs` | **40** | S98-2 +1 record（2 行，`MemoryEntriesByStatusResponse` 在 `:40`） | **≈ 42** | ✅ |
| `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs` | **149** | S98-2 +1 条 `[JsonSerializable]`（`:89` 旁） | **≈ 150** | ✅ |
| `src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs` | **155** | S-99 +`SplitTokens` + 三分支 dispatch + 逐 token score 累加 | **≈ 215~250** | ✅ |
| `src/renderer/src/stores/chat-store/memory-helpers.ts` | **293** | S98-4 +2 尾参 + 返回类型（`:259-273`） | **≈ 298** | ✅ |
| `src/renderer/src/components/settings/MemoryEntriesTab.tsx` | **322** | S98-5 −`ENTRY_FETCH_LIMIT` 块（`:19-24`，≈ −6）+ 服务端分页/`total` 驱动 ≈ +15 | **≈ 331** | ✅ |
| `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx` | **132** | S98-6 +分页控件与 `total` 驱动 ≈ +30~50 | **≈ 165~185** | ✅ |
| `src/renderer/src/components/chat/InputArea/use-composer-interactions.ts` | **119** | S100-1 +`clipboardTextOf` ≈ +20 | **≈ 140** | ✅ |
| `src/renderer/src/lib/agent/memory-hot-sync.ts`（未列入 plan） | **96** | 无需改（尾参向后兼容） | **96** | ✅（但应从清单可见，见 ⚠️-1） |

**结论：无一处触线** ⇒ 审查项 4 为 ✅。S98-1 的「先拆分再改」是**必要**动作而非美化 —— 若不动 `MemoryModule.cs`（现 495），S98-3 在 `MemoryEntries` 上追加 `offset`/`order`/`COUNT(*)` 会把它推过 500 红线。

### 三、❌ 阻断项（必须修）

#### ❌-1：S99-3 的验证检查点在 AND 语义下**不可判定**，打分措辞自相矛盾

- **出处**：`plan.md:214`
  > `S99-3` 多 token 且存在 < 3 字符的 token ⇒ 跳过 FTS 直接走 LIKE，WHERE 改逐 token 的 `(title LIKE ? OR content LIKE ?)` **AND** 连接；score 改为**对每个 token 累加** `(title 命中 2 + content 命中 1)`，**命中词多者分高**。验证：`记忆 整理` 能命中同含两词的条目，且**双命中的排在单命中之前**。
- **问题 1（检查点不可判定）**：WHERE 用 **AND** 连接 ⇒ 返回集里**每一行都同时命中全部 token**，「单命中」的行在定义上不存在 ⇒ 「双命中的排在单命中之前」无法写出任何断言、无法判定。
- **问题 2（打分语义写反）**：AND 下「命中词数」对候选集是常量（= token 数），故 score 的**唯一**变量是「token 命中 title 还是只命中 content」：全命中 title 得 `2n`，全落 content 得 `n`。∴ plan 写的「命中词多者分高」应表述为「**token 命中 title 越多者分高**」。
- **连带影响**：S99-5「扩断言（31 → ≥ 38）」的断言集依赖这条检查点 ⇒ 照抄会让实施者写不出断言，或写出恒真的假断言（`计划外的自欺`）。
- **修正建议**（写进 S99-3 验证即可）：
  > 造两行：A = 标题 `记忆 整理`，正文无关；B = 标题 `无关`，正文 `记忆 整理`。断言 `记忆 整理` 命中 A、B 两行（证明 AND 生效、非同词零命中），且 A 排在 B 前（标题命中加权）；再断言 score(A) > score(B)。
  > 并把「命中词多者分高」改为「token 命中 title 越多者分高（n=2 时 title 全中 = 4、只中 content = 2）」。

#### ❌-2：S-100 把「根因未定案」当既定事实定下修法，缺 raw 明确要求的定案实测

- **出处**：plan.md:190「三项均已探索完毕…**无待用户裁定项**」+ plan.md:220-221（S100-1/2 直接落地 `text/html` 回退）。
- **对照 raw**：`raw-requirements.md:1286-1296` 的「待定案（**还差一条实测数据**）」明确列出三分支，并给出定位手段：
  > 「**定位手段（建议先做这个，别盲改）**：在 `handlePaste` 入口加临时诊断（dev 打印 `Array.from(event.clipboardData.types)` + 各格式长度 + 走了哪一支），复现一次即可定案。」
  且 `:1298-1301` 把「是否接受先加诊断再改」列为**待裁定 1**。
- **问题**：plan 的修法**只覆盖三分支中的第 1 支**（源只放了富文本）。若真因是第 3 支（`types` 含 `text/plain` 但 `getData('text/plain')` 返回空串），`clipboardTextOf` 会依次取到空 `text/plain`、空 `text/html` ⇒ 返回 `''` ⇒ 仍走 `:81 if (!plainText) return`（`use-composer-interactions.ts:80-81`）⇒ **行为零变化**，需求却按「已修」交付。而 raw 的关键现象（「用一次剪贴板增强后常规 Ctrl+V 恢复」）对第 1、3 两支**都成立**（`:1281` 的 `clipboard.writeText` 既补 text/plain，也把剪贴板所有权换成自己的进程），**无法据此排除第 3 支**。
- **为什么算阻断**：这不是「口径选择」可以由 plan 自行取值 —— 它是**缺失事实**（`clipboardData.types` 到底是什么），plan 无权替它取值。plan.md:255 也自承「S-100 的修复效果**无法用编译/单测证明**」，即**连事后验收都无从判定**，这是计划可证伪性上的硬缺口。
- **修正建议**（低成本，二选一）：
  1. 在 S100 前补一步 **S100-0（诊断）**：`handlePaste` 入口（`:72` 之后、`:73` 之前）加 `if (import.meta.env.DEV) console.debug('[paste]', Array.from(event.clipboardData.types), event.clipboardData.getData('text/plain')?.length, event.clipboardData.getData('text/html')?.length)`，真机复现一次记进实施记录，**再**按定案落 S100-1/2；或
  2. 保留现有三步，但把 S100-1 的回退扩到「`text/plain` → `text/html` → **`items` 遍历取 `text/*`**」，使第 3 支也被覆盖，并在验证检查点里写明「真机需记录 `types`」。
  > 另注：plan.md:221 保留 `document.execCommand('insertHTML')` 原样，与 raw `:1300-1301` 待裁定 2 的倾向（统一收敛到受控路径 `replaceSelectionWithText`）相反；raw 给的理由是源码 `:102-103` 已自承 `insertHTML` 与换行/撤销组冲突。plan 未写保留理由，建议补一句（非阻断，见 ⚠️-7）。

### 四、⚠️ 建议项（不阻断）

- **⚠️-1（消费方清单不全；(a) 项的实际答案）`memoryEntries()` 有 3 个调用点，plan 只提 1 个。**
  实读（`Get-ChildItem -Recurse -Include *.ts,*.tsx | Select-String 'memoryEntries\('`）：
  1. `src/renderer/src/components/settings/MemoryEntriesTab.tsx:93` —— `memoryEntries('global', undefined, ENTRY_FETCH_LIMIT)`（S98-5 会重写）；
  2. `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx:36-42` —— 5 个位置参数（plan 唯一提到的那个）；
  3. **`src/renderer/src/lib/agent/memory-hot-sync.ts:61-67`** —— `memoryEntries(args.scope, args.workingFolder ?? undefined, DB_SYNC_SCAN_LIMIT, args.projectId, args.sshConnectionId)`，消费 `existing.entries`（`:68`）做 S-93 的**插入前判重**，`DB_SYNC_SCAN_LIMIT = 500`（`:15`）。
  - **结论**：plan.md:229 的断言「新增两个尾参不会破坏现有调用」**为真**（尾参默认值 + 位置参数不变 ⇒ 三处都免改、都编译）。但**依据只列了 1/3 的调用点**，且 `memory-hot-sync.ts` **不在 plan.md:234-246 的「涉及文件」清单里**。
  - **为何要点名**：它是对**行为**敏感的唯一消费方 —— S98-3 往 `ORDER BY` 追加 `id {dir}` 破平后会改变**同秒行的相对次序**，而 `memory-hot-sync` 的判重窗口正是「按该 ORDER BY 取回的前 500 行」。风险低，但 plan 未给任何回归点。
  - **修正建议**：①「涉及文件」补 `src/renderer/src/lib/agent/memory-hot-sync.ts — S-98（受 `memoryEntries` 参数与 `ORDER BY` 变更影响，**不改代码**）」；② 在 S98-4 验证里加一条可判定断言：`memoryEntries('project', …, 500)` 调用点仍编译且 `entries` 可读（可用既有 `memory-hot-sync` 的 `mirrorHotParagraphsToDb` 二次调用 `count = 0` 作为幂等证据，参照 `raw` §1179 的测试缺口条目）。

- **⚠️-2（路径错层）`WishfulClawJsonContext.cs` 写在 Workspace 层，实际在 Worker 层。**
  - plan.md:238 写 `src/runtime/WishfulClaw.Workspace/Memory/WishfulClawJsonContext.cs（或其所在文件）`。
  - 实读：全仓唯一同名文件是 **`src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs`**（`[JsonSerializable(typeof(MemoryEntriesByStatusResponse))]` 在 `:89`，class 在 `:147`）；`src/runtime/WishfulClaw.Workspace/Memory/` 下**没有**该文件（该目录 15 个 .cs 已逐一列出）。
  - **修正建议**：改为 `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs`，并去掉「（或其所在文件）」的兜底措辞（AOT 注册点若走错层会构造出第二个 context，属难查的编译期错误）。
  - 定级说明：本仓既有先例把同类「文件:行 错引」记作 ⚠️（§五 ⚠️-3 的 `:168`→`:115`、`:105`→`:100`），故此处同样不判 ❌。

- **⚠️-3（S-99 规格缺口）FTS→LIKE 兜底在 S99-2/S99-3 里未被声明。**
  - 现状 `MemoryFtsService.cs:91 if (results.Count == 0)` 是 FTS 失败/零命中时的兜底（`:81-87` 的 catch 也清空后落到这里）。
  - plan 的 S99-2（全 token ≥ 3 走 FTS）、S99-3（含短 token 走 LIKE）构成一个 dispatch，却**未交代**「FTS 零命中是否仍回退 LIKE」。对单 token 而言这条兜底是 S99-1「逐字节一致」承诺的组成部分（见一、6(c) 细核）。
  - **修正建议**：在 S99-1 写明「单 token 完整保留 `:55` FTS → `:91` LIKE 的两段式」；在 S99-2 明确「all-≥3 的 FTS 分支零命中时是否也回退到逐 token LIKE AND（建议：回退，保持与现状同构）」。

- **⚠️-4（可测性）`clipboardTextOf(data: DataTransfer)` 的签名使核心逻辑无法单测。**
  - plan.md:220 的 S100-1 验证只有「`tsc` 零错误」；plan.md:255 因此自承「无法用编译/单测证明」。**这个结论是签名造成的，不是问题本身的性质。**
  - **修正建议**：把纯逻辑与 DOM 读取分层 —— `export function textFromClipboard(plain: string, html: string): string`（纯函数，可用 `tests/*` 的 TS 断言范式覆盖：空 plain + 含 `<p>` 的 html ⇒ 提取文本；块级元素补换行；两者皆空 ⇒ `''`），`handlePaste` 内只做 `textFromClipboard(event.clipboardData.getData('text/plain'), event.clipboardData.getData('text/html'))`。这样 plan.md:255 的「无法证明」可收窄为「仅 `getData` 读取层需真机确认」，与 `use-composer-interactions.ts` 现有 `shouldCollapsePaste`（`:16-26`）同为纯函数可测（顺带补上 S100-3 的折叠断言）。

- **⚠️-5（AOT 表述）S98-2 的两处说法需订正。**
  - plan.md:227「验证：编译零告警（**AOT 下 JsonContext 漏注册会告警**）」—— 实为**编译错误**而非告警：漏注册则 `WishfulClawJsonContext.Default.MemoryEntriesResponse` 属性不存在，`WorkerResponse.Json(value, …)` 直接编译失败（AGENTS.md AOT 规则 4 要求显式传 `JsonTypeInfo`）。
  - plan 未声明「`List<MemoryEntryRow>` 已注册、无需新增」（`WishfulClawJsonContext.cs:88`）—— 建议显式写一句，免得实施者按 AOT 规则 8 重复注册。
  - 定级：**不阻断**（检查点「编译零告警」本身仍可执行，S98-2 的注册动作已覆盖）。

- **⚠️-6（自设阈值过紧）S98-1 的「新文件 ≤ 130 行」与 S98-3 叠加后临界。**
  - 搬入内容实测 91 行（`:286-328` = 48 行、`:337-372` = 43 行）+ 文件骨架 ≈ 11 行 ⇒ ≈ 102 行；S98-3 再给 `MemoryEntries` 加 `offset`/`order` 白名单映射/`COUNT(*)`/新响应构造 ⇒ ≈ +15~20 ⇒ **≈ 117~122**。
  - **修正建议**：把 S98-1 的自设判据放宽为「新文件 ≤ 150 行」（或改成「`MemoryModule.cs` ≤ 420 且新文件 ≤ 200」），避免同一需求的 S98-1 与 S98-3 互相锁死。`MemoryModule.cs` 侧 ≤ 420 的判据有余量（实测 495 − 91 = 404）。

- **⚠️-7（可写死的取舍未写）`offset`/`limit` 无上界 + `execCommand` 保留的理由。**
  - `MemoryEntries` 现 `limit = GetInt(parameters, "limit", 200)`（`MemoryModule.cs:342`）**无上界**；S98-3 只对 `offset` 写了 clamp ≥ 0。建议一并写 `limit = Math.Clamp(limit, 1, 500)`（S-93 的 `DB_SYNC_SCAN_LIMIT = 500` 是现有最大调用值，上界取 500 恰好不破它）。**注意：若上界取得比 500 小会静默缩小 S-93 的判重窗口。**
  - plan.md:221「`document.execCommand('insertHTML')` 与受控兜底路径保持原样不动」与 raw `:1300-1301` 的倾向相反，建议补一句保留理由（代价：该类受控编辑器下 `insertHTML` 失败只能靠 `:105 if (inserted)` 的 false 分支兜底，而**返回 true 但 DOM 未被 model 吸收**的情形兜不住 —— 与 S-100 的原始症状同源）。
  - 定级：**不阻断**。

### 五、审查结论

- 阻断规则（`docs/dev-workflow.md` 阶段三）：❌ > 0 禁止进入用户确认环节。**本轮 ❌ = 2**。
- 分层依赖、AOT 注册动作、文件路径（除 1 处错层）、单文件 500 行红线（全 10 个文件核算通过）四项**均无硬伤**；S-98 对 raw 三条待裁定的取值（A / 直接改掉 / 档案页一并改）与 raw 倾向一致，S99/S100 的落点选层正确。
- 两个 ❌ 的**返工成本都很低**：❌-1 改一句验证描述；❌-2 补一步诊断（或把回退扩到 `items` 遍历）。⚠️-1/⚠️-2 是清单与路径的补字。
- **最终判定：FAIL**。修掉 ❌-1、❌-2 即可复验（只需重读 plan.md:212-214 与 :218-222 两段，无需重跑全量；本报告第二节的 500 行核算与第一节 6(c)/6(d) 的核对结论可直接复用）。
### 复验（第二批 S-98 ~ S-100，2026-09-20）

- 复验对象：`docs/plans/iter-v2-33/plan.md` 的「## 第二批（S-98 / S-99 / S-100）」（现行 plan.md:187-261）
- 上轮报告：本文件上一节「## 规划验证（第二批 S-98 ~ S-100，2026-09-20）」（结论 FAIL，❌2 / ⚠️7）
- 审查者：独立 subagent（architect-reviewer）；日期 2026-09-20
- 审查方式：纯静态复验 —— 未跑构建 / 未跑测试 / 未改任何源码；plan 每条修订均回源码实读核对行号与事实
- 结论：**PASS**

#### 一、逐项复验（上轮 ❌/⚠️ 编号 → 是否已正确处置 → 依据）

| 上轮编号 | 处置 | 依据（plan.md 现行文字 / 源码实读） |
|---|---|---|
| **❌-1** S99-3 断言在 AND 语义下不可判定 | ✅ | plan.md:216 新增独立段落订正：明写「返回集**每一行都命中全部 token**，『命中词数』对候选集是常量、不是区分变量」；验证改为「造 A（两词都出现在 `title`）与 B（两词只在 `content`），断言 **A 排在 B 前且 `score(A) > score(B)`**；另断言只含其中一个词的条目**不被返回**」。plan.md:215 已删去「命中词多者分高」。全仓 grep「双命中 / 单命中 / 命中词多者分高」**零命中** ⇒ 无残留不可判定说法 |
| **❌-2** S-100 根因未定案就定修法 | ✅ | plan.md:222 新增 **S100-0 诊断步骤**（`handlePaste` 入口加临时诊断：dev 打印 `Array.from(event.clipboardData.types)` + 各 `text/*` 长度 + 走了哪一支，复现一次后**立即删除**；明标「先于修法」）。plan.md:223 S100-1 写死：「**根据 S100-0 的结论决定是否追加 `items` 遍历取 `text/*`** —— 若诊断落在『**有 `text/plain` 但 `getData` 返空**』那一支，`text/html` 回退**不对症**，`items` 遍历才是」。plan.md:190 原句「无待用户裁定项」已删（grep「无待用户裁定」零命中） |
| **⚠️-1** `memoryEntries()` 第 3 个调用点（`memory-hot-sync.ts`）缺失 | ✅ | plan.md:245「涉及文件」新增 `src/renderer/src/lib/agent/memory-hot-sync.ts — S-98（**`memoryEntries` 的第 3 个调用点**，S-93 的判重消费方；新增两个尾参有默认值使其免改，但**必须回归验证**）`。源码复核：`memory-hot-sync.ts:61-67` 确为 5 个位置参数调用、消费 `existing.entries`（`:68`）做判重，`DB_SYNC_SCAN_LIMIT = 500`（`:15`），属实 |
| **⚠️-2** `WishfulClawJsonContext.cs` 路径错层 | ✅ | plan.md:230（S98-2）与 plan.md:241（涉及文件）均已订正为 `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs`，并注明「**实际在 Worker 层**」。grep「Workspace/Memory/WishfulClawJsonContext」「或其所在文件」**零命中** ⇒ 无残留兜底措辞 |
| **⚠️-3** FTS 零命中仍回退 LIKE 未声明 | ✅ | plan.md:214（S99-2）已写明「**FTS 零命中时仍走 LIKE 回退**（`results.Count == 0` 的现有分支保持不变）—— 这是 S99-1『单 token 行为一致』成立的前提」。源码复核：`MemoryFtsService.cs:91 if (results.Count == 0)` 该分支存在，属实 |
| **⚠️-4** `clipboardTextOf(DataTransfer)` 无法单测 | ✅ | plan.md:223（S100-1）已改为**只吃字符串的纯函数** `composePastedText(plain: string, html: string): string`（优先 `plain` → 从 `html` 用 `DOMParser` 提取 → 皆空 `''`），注明「签名只吃字符串（不吃 `DataTransfer`）」，`getData` 取用留在 `handlePaste` 侧；并配纯函数断言（无输入→空串 / 仅 plain→原样 / 仅 html 带标签→提取后无标签 / 两者都有→取 plain） |
| **⚠️-5（其余）** JsonContext 漏注册定性 / `List<MemoryEntryRow>` 泛型注册 / 消费方 | ✅ | plan.md:230（S98-2）三处均已订正：①「编译**零错误**（AOT 源生成下 JsonContext 漏注册是**编译错误**，不是告警）」；②「`List<MemoryEntryRow>` 已在 `WishfulClawJsonContext.cs:88`，无需补泛型注册」；③「消费方 `MemoryPanel.tsx:68-69`」。源码复核：`WishfulClawJsonContext.cs:88` = `[JsonSerializable(typeof(List<MemoryEntryRow>))]` 属实；`MemoryPanel.tsx:68-69` 确为 `memoryEntriesByStatus('warm'/'cold', …)` 两路消费属实 |

#### 二、上轮未纳入「必须逐项确认」清单的两项 ⚠️（未处置，仍 ⚠️ 级，不阻断）

- **⚠️-6（S98-1 自设阈值偏紧）—— 未处置**：plan.md:229 仍写「`MemoryModule.cs` 降到 ≤ 420 行、新文件 ≤ 130 行」。按上轮核算，`MemoryModule.Entries.cs` 搬入 ≈ 102 行 + S98-3 追加 ≈ 15~20 ⇒ **≈ 117~122**，逼近 130 上限、与 S98-3 相互锁死。建议放宽（如「新文件 ≤ 150 行」）。此为上轮 ⚠️（非阻断），未处置不改变结论。
- **⚠️-7（`limit` 无上界 + `execCommand` 保留理由）—— 未处置**：plan.md:231（S98-3）仍只对 `offset` 写「clamp ≥ 0」，未对 `limit` 设上界（源码 `MemoryModule.cs:342` `limit = GetInt(parameters, "limit", 200)` 确**无上界**）；plan.md:224（S100-2）仍只写 `document.execCommand('insertHTML') … 保持原样不动`，未补保留理由（与 raw:1300-1301「待裁定 2」的倾向——统一收敛到受控路径 `replaceSelectionWithText`——相反）。亦为上轮 ⚠️，未处置不改变结论。

#### 三、本次新发现（均 ⚠️ 级，不阻断）

- **N-1（新）S100-1 的「纯函数断言」缺执行落点**：plan.md:223 要求对 `composePastedText` 做纯函数断言，但 plan.md:237-250「涉及文件」为 S-100 只列了 `src/renderer/src/components/chat/InputArea/use-composer-interactions.ts`，**未列任何 TS 测试文件，也未列要新增的 npm script**。本仓 TS 测试既有范式 = `tests/<name>/program.ts` 经 esbuild 打包 + `package.json` 的 `test:<name>` 脚本（实测 28 条，如 `test:select-file-tags`）。⇒ 按现行文字该断言**没有可执行的家**（整体检查点 plan.md:254-256 也未把 TS 单测套件纳入回归）。**建议**：涉及文件补 `tests/<name>/program.ts`（新建），并在 S100-1 验证行点名对应 `npm run test:<name>`。
- **N-2（新）plan.md:259 与 S100-1 字面轻微抵触**：plan.md:259 仍写「**验证态已知限制**：S-100 的修复效果**无法用编译/单测证明**（依赖剪贴板来源）」。上轮 ⚠️-4 的修法正是**为把该限制收窄到「仅 `getData` 读取层」**（纯逻辑本可单测）；现 S100-1 已加纯函数断言，而 :259 的全局口径未同步收窄。**建议**改为「`composePastedText` 的纯逻辑由单测覆盖；仅 `clipboardData.getData` 的读取层依赖真机」。
- **N-3（新，实现注记，非缺陷）**：S99-3 的断言「A 排在 B 前」依赖 `MemoryFtsService.cs:107` 的 `ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, score DESC, updated_at DESC`。造数时 A / B 需**同 status**（自然取 active），否则首键 `status` 会先于 `score` 决定次序、产生假失败。**建议**在 S99-5 断言里显式注明。

#### 四、复验结论

- 上轮 **2 个 ❌ 全部正确处置**（❌-1 → plan.md:215-216；❌-2 → plan.md:222-223 + 190），且被点名的 5 个 ⚠️（⚠️-1 ~ ⚠️-5）亦全部处置、逐条与源码事实相符。
- 未处置项均为 **⚠️ 级**（⚠️-6 / ⚠️-7 + 新发现 N-1 / N-2 / N-3），**不构成阻断**。
- **无因修订而新引入的阻断性矛盾或行号失效**。plan 现行引用的源码行号已实读核对通过：`MemoryFtsService.cs:37-121 / :55 / :91 / :103-104 / :107 / :149 / :151-152`、`WishfulClawJsonContext.cs:88`、`MemoryModule.cs:342 / :286-328 / :337-372`、`AotMemoryResultTypes.cs:40`、`memory-hot-sync.ts:61-68`、`MemoryPanel.tsx:68-69`、`use-composer-interactions.ts:80-81`；plan 自报基线行数（`MemoryModule.cs` 495 / `WishfulClawJsonContext.cs` 149 / `memory-hot-sync.ts` 96 / `memory-helpers.ts` 293）本轮实测**一致**。
- **最终判定：PASS**（阻断规则：❌ = 0）。可进入用户确认环节。建议把 ⚠️-6 / ⚠️-7 / N-1 / N-2 / N-3 的补字一次性并入（成本极低），并在执行时按 N-3 注记造数。

---

## 第三批（S-101 / S-102）规划验证（2026-09-20）

- **审查对象**：`plan.md`「## 第三批（S-101 / S-102）」（现行 `plan.md:266-323`）；`raw-requirements.md`「## S-101」（`:1353-1389`）与「## S-102」（`:1391-1433`）。
- **审查者**：独立 subagent（architect-reviewer）；日期 2026-09-20。
- **方式**：纯静态 —— 未跑构建 / 未跑测试 / 未改任何源码；plan / raw 每条「实读」断言均回源码核对行号与事实，本报告即本次唯一写入。

### VERDICT: FAIL

- 阻断规则（`docs/dev-workflow.md` 阶段三）：❌ > 0 禁止进入用户确认环节。**本轮 ❌ = 2**（❌-1 S101 的回归验证落点在指定工程内不可达；❌-2 S102-1 与既有沙箱断言确定性冲突，且计划未覆盖该步骤）。
- 事实核验 8 条：**7 条完全属实**（A1/A2/A3/A5/A6/A7/A8），A4 主体属实但「只有」措辞不完整（列 ⚠️-0，不判 ❌，理由见该条）。

### 事实核验结果（逐条，带文件:行号）

| # | plan/raw 断言 | 判定 | 源码证据（实读） |
|---|---|---|---|
| **A1** | `PathBoundary.ResolveRoots` 只装两类根（项目 `workingFolder` / 全局项目并集），`~/.wishful-claw/` 不在内；行号 `:47-71` | ✅ | `src/runtime/WishfulClaw.Agent/Tools/PathBoundary.cs:47-71`：project 分支 `:49-53` 返回 `[workingFolder]`（空则 `[]`）；global 分支 `:56-64` 查 `projects.working_folder` 并集（`ssh_connection_id` 为空）。**两支均无数据根**。行号一致 |
| **A2** | `src/main/lib/data-dir.ts` 按 `app.isPackaged` 分 `.wishful-claw` / `.wishful-claw-dev`；行号 `:10-18` | ✅ | `data-dir.ts:10-18`；三元式在 `:14-16`（`WISHFUL_CLAW_DATA_DIR_NAME` / 名字 `-dev`）。行号一致。**补注**：`resolveDataDir` 还先短路读 `WISHFULCLAW_DATA_DIR`（`:11-12`），raw 未提，但不与断言矛盾 |
| **A3** | `native-worker.ts:178` 把 `WISHFULCLAW_DATA_DIR` 传给 Worker，且传的是**已解析值（含 `-dev`）** | ✅ | `native-worker.ts:175` `const resolvedDataDir = resolveDataDir()`，`:178` `WISHFULCLAW_DATA_DIR: resolvedDataDir`。`resolveDataDir` 返回绝对路径（env 覆盖 或 `join(homedir, name[-dev])`）⇒ **传的是已解析值**，S102-1 的「读环境变量」方案成立。行号一致。**补注**：C# 侧已有同义助手 `WishfulClaw.Infrastructure/Storage/WishfulClawDataDir.cs:7-19`（`Root`：env 优先、回退 `~/.wishful-claw`）+ 常量 `WishfulClaw.Contracts/WishfulClawPaths.cs:6`（`DataDirEnvVar`）—— 见 ⚠️-1 |
| **A4** | `MemoryModule.Entries.cs` 的 `MemoryEntries` 现有参数「只有 `scope/limit/offset/order`」；`CountScope` 无时间条件且被 `MemoryEntries` 用于 `total` | ⚠️（主体✅） | `MemoryModule.Entries.cs`：`MemoryEntries` 直读 `scope`(`:81`)/`limit`(`:84`)/`offset`(`:85`)/`order`(`:89`)；`CountScope`(`:118-123`)**无时间条件**且被 `:113` 用作 `total` ⇒ **动作相关的两半全对**。但端点还经 `GetScope` 消费 `workingFolder`/`projectId`/`sshConnectionId`（`MemoryModule.cs:310-327`）⇒ 「**只有**」四参字面不成立（见 ⚠️-0） |
| **A5** | `MemoryFtsService.SearchAsync` 有 **FTS 路 + LIKE 路**两条，两条都要加时间条件 | ✅ | `src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs:33-145`：FTS 路 `:63-96`（`memory_fts MATCH`，带 `{scopeFilter}{statusFilter}` `:72`）；LIKE 路 `:98-142`（逐 token `LIKE`，带 `{scopeFilter}{statusFilter}` `:132`）⇒ **两条**，S101-3 写对 |
| **A6** | `memory_entries` 有 `created_at` + `updated_at` 两个 INTEGER 列 | ✅ | `src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs:275-284`：`:282 created_at INTEGER NOT NULL`、`:283 updated_at INTEGER NOT NULL` |
| **A7** | `memory-helpers.ts` 的 `memoryEntries` 现为 7 个位置参数；调用点恰 3 个（`MemoryEntriesTab` / `ProjectMemoryLibraryTab` / `memory-hot-sync.ts`） | ✅ | `memory-helpers.ts:264-272` = `scope, workingFolder, limit, projectId, sshConnectionId, offset, order`（**7 个**）。全仓 `memoryEntries(` 调用点（grep）：`MemoryEntriesTab.tsx:98`、`ProjectMemoryLibraryTab.tsx:43`、`memory-hot-sync.ts:61` ⇒ **恰 3 个，无多无少** |
| **A8** | `AGENTS.md`「异常日志」节写「日志位置：`~/.wishful-claw/logs/`」（开发模式下是错的） | ✅ | `AGENTS.md:285-296`：`:289` 明写 `~/.wishful-claw/logs/`，`:292-294` 的 Win/macOS/Linux 三行**全是 `.wishful-claw`**（无 `-dev`）⇒ 与 `data-dir.ts` 的 dev 分支矛盾，确为假事实 |

### ❌ 阻断项（必须修）

#### ❌-1：S101-7 的回归验证落点**在指定工程内不可达**，S101-1/S101-2 的核心风险无检查点

- **出处**：`plan.md:301`「**S101-7** 回归断言：`MemoryRecallRegressionTests` 补时间筛选（区间内 / 区间外 / 边界值 / **`total` 与行数一致**）。验证：套件 `exit=0`」（`plan.md:313` 亦把 `tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs` 列为 S-101 唯一测试落点）。
- **不可达事实**：
  - `tests/WishfulClaw.MemoryRecallRegressionTests/WishfulClaw.MemoryRecallRegressionTests.csproj` 的 `ProjectReference` 只有 **Agent / Infrastructure / Workspace**，**没有 Worker**（逐行实读）。
  - 全仓 `tests/` 内 **无一处** `WishfulClaw.Worker` 或 `MemoryModule`（grep 零命中）。
  - 被测端点 `MemoryEntries`（`MemoryModule.Entries.cs:79`）与 `CountScope`（`:118`）是 **`private static`**，宿主为 Worker 内 `internal sealed partial class MemoryModule`（`:13`）⇒ 即便加了 Worker 引用也**够不到**，还要 `InternalsVisibleTo` + 提升可见性。
  - ⇒「`total` 与行数一致」这一**端点级**断言在该工程里**写不出来**。（S101-3 那半可测 —— Workspace 被引用，`MemoryFtsService.SearchAsync` 可直调；但 S101-1/S101-2 正是 raw §1379 亲口点名的坑：**「`COUNT(*)` 必须带同样条件，否则共 N 条/翻页漏行（S-98 在相邻处踩过）」**，此坑**无任何可执行落点**。）
- **连带**：`plan.md:320`「回归：全部 `WishfulClaw.*RegressionTests` exe `exit=0`」对 S-101 而言**部分为空头支票**（端点侧无从判定）。
- **修法（任选，均低成本）**：
  1. 新建 `tests/WishfulClaw.MemoryEntriesRegressionTests`（照既有骨架），`ProjectReference` 到 `WishfulClaw.Worker` 并在 `WishfulClaw.Worker.csproj` 加 `InternalsVisibleTo`，同时把 `MemoryEntries`/`CountScope` 由 `private` 提为 `internal`（须先确认 Worker 作为 `Exe` 可被测试工程引用，否则改用方案 2）；或
  2. 把「`where` 子句 + `COUNT(*)`」抽成一个 Workspace 层可测的纯 helper（如 `MemoryEntryFilter.BuildWhere(from,to,scope)` + `CountSql(...)`），让 **entries 与 COUNT 共用同一段构造**，再在现有 `MemoryRecallRegressionTests`（已引用 Workspace）里断言「同一 filter 下 `COUNT` == 行数、边界取等号」。方案 2 还能从结构上消灭「两处各写一遍 WHERE」这个反复出事的模式。

#### ❌-2：S102-1 与**既有沙箱断言确定性冲突**，计划未覆盖该步骤（计划自设 gate 必红）

- **出处**：`plan.md:289`「S102-1 … `ResolveRoots` 的**两个分支**（project / global）返回集合**都**追加该根」；`plan.md:318-321` 的 gate「全部 `WishfulClaw.*RegressionTests` exe `exit=0`」。
- **既有断言（实读）** `tests/WishfulClaw.GoalRegressionTests/Program.Sandbox.cs`：
  - `:59-62`：`projectPolicy = ResolvePolicy({"scope":"project","workingFolder":root})` ⇒ `AssertEqual(1, projectPolicy.Roots.Count, "项目会话只有一个根")` 且 `AssertEqual(root, Roots[0])`。
  - `:64-68`：`AssertEqual(0, ResolvePolicy({"scope":"project"}).Roots.Count, "项目会话缺 workingFolder 时没有根")`。
- **冲突**：S102-1 落地后，上两条分别变为 **2** 与 **1** ⇒ **两断言必红**，直接击穿 gate。
- **为何算阻断（而非普通「测试待补」）**：`:61`/`:67` 编码的是**产品语义**——「项目会话只有一个根」「无 `workingFolder` 即无根＝不拦」；S102-1 恰恰改变了它。计划对 S102 只写「边界断言落点（`tests/WishfulClaw.*`，S-102-2 实施时定）」（`plan.md:314`），**从未交代**要修订这两条既有断言或重申新语义（如「项目会话的根 = 该工作目录 **+ 本实例数据根**，恒 ≥ 1」），也未提 raw §1431 要求的「SSH 不参与」。
- **修法**：S102 增一步（明写）：把 `Program.Sandbox.cs:61` 改为 `Roots.Count == 2` 且含数据根；把 `:67` 的「无根」语义改述为「缺 workingFolder 时仍含数据根（唯一根）」或按新口径重写；并补 raw §1431 的 SSH 断言。位置可直接钉在 `Program.Sandbox.cs`（该文件已在括号外，且已引用 Agent，`PathBoundary` 可达）。

### ⚠️ 建议项（不阻断）

- **⚠️-0（raw §1364/§1391 措辞不精确）**「`memory/entries` 参数 `scope/limit/offset/order`」漏了 `workingFolder`/`projectId`/`sshConnectionId`（这三者由 `GetScope` 消费，`MemoryModule.cs:310-327`）。**动作不受影响**（S101-1/2 只加 `from/to` 且已正确指向 `CountScope`），故不判 ❌，但建议 raw 表述补全，免得后人照抄得出「项目 scope 靠 scope 字段传」的错误推论。
- **⚠️-1（应复用既有数据根解析）** plan S102-1 写「**新增**数据根解析（优先读 `WISHFULCLAW_DATA_DIR`，回退 `~/.wishful-claw`）」，但该逻辑**已存在且是全仓唯一权威**：`WishfulClaw.Infrastructure/Storage/WishfulClawDataDir.cs:7-19` `Root`（env → `Path.GetFullPath`；否则 `UserProfile/.wishful-claw`），配常量 `WishfulClawPaths.DataDirEnvVar`（`Contracts/WishfulClawPaths.cs:6`）。`PathBoundary`（Agent）本就依赖 Infrastructure（`AGENTS.md:81`），**直接 `WishfulClawDataDir.Root` 即可**。另起一份 env 解析正是计划自己警惕的「两处判断必然漂移」的翻版。建议改「复用 `WishfulClawDataDir.Root`」。
- **⚠️-2（S102 SSH 语义缺）** raw §1431 明确要求断言含「SSH 不参与」，plan S102-2 未提；且 project 分支对 **SSH 项目**同样返回其（远端）`workingFolder`，此时再把**本地**数据根塞进同一集合，语义需一句说明（本地根 + 远端根混装对 SSH 是否可接受）。
- **⚠️-3（S102 断言落点未定）**「S-102-2 实施时定」属可避免的悬空 —— 现成落点就是 `Program.Sandbox.cs`（已引用 Agent）。建议直接钉死（顺带解决 ❌-2）。
- **⚠️-4（数据根不存在时）** 若 `~/.wishful-claw-dev` 尚未创建，把它作为允许根无副作用（`IsInsideAnyRoot` 用 `Path.GetFullPath` 对不存在路径也成立，`PathBoundary.cs:143-153`），但「首次运行即已放行（目录随后会建）」这一点值得在实现记录写一句；`Root` 亦不做 `Directory.CreateDirectory`。
- **⚠️-5（安全：开整个数据根的爆炸半径）** 见「我的独立判断」第 12 条。
- **⚠️-6（S-101 接口与清单缺项）** 给搜索链加 `from/to` 需改 **`IMemorySearch.SearchAsync`**（`Workspace/Memory/IMemorySearch.cs:18-23`）并更新另 **2 处调用方**（`MemoryRecallService.cs:165` 自动召回、`MemorySearchTool.cs:81` agent 工具，均传默认=不限），以及 **`memory/search` 端点**（`MemoryModule.cs:106-118`，它才是读 `from/to` 的地方）。plan「涉及文件」（`plan.md:305-314`）**未列 `MemoryModule.cs` 与 `IMemorySearch.cs`**（只列了 `MemoryModule.Entries.cs`），S101-3 也只用「`MemoryFtsService.SearchAsync` 两条路」一语带过接口面。
- **⚠️-7（`MemoryEntriesByStatus` 未表态）** tier 浏览器的 `memory/entries-by-status`（`MemoryModule.Entries.cs:30-65`，消费方 `MemoryPanel.tsx:68-69`）要不要也支持时间筛选？plan 与 raw 都未提。若「不」，建议一句理由（该面板按 status 分组、无时间筛选语义）；否则会给人「筛了时间但 tier 面板不跟」的错觉。
- **⚠️-8（时区口径 + 项目 tab 无时间列）** 见「我的独立判断」第 14 条。
- **⚠️-9（S101-4 取值）** options 重构标注为「我自己的取舍、非需求、可跳过」—— 可以接受。但若跳过后 `from/to` 以**位置参数**追加，`memoryEntries` 将达 **9 个位置参数**（第 3 位 `limit`、第 6 位 `offset`，raw §1387 已自陈易错）。建议明确：**要么做 options 化，要么把 `from/to` 也用 options（尾参对象）承载**，别走 9 个裸位置参数。

### ✅ 通过项

- **事实核验 A1/A2/A3/A5/A6/A7/A8 七条逐字属实**（证据见上表）；**A8 的「假事实」成立**（开发模式下 `AGENTS.md` 的日志路径确实指错）。
- **落层正确（审查项 16）**：Worker 端点改动落在 `MemoryModule.Entries.cs`（Worker 层）；搜索能力落在 `MemoryFtsService.cs`（Workspace 层）；UI 落在渲染端两个列表组件；沙箱落在 `PathBoundary.cs`（Agent 层）。无错层、无逆向依赖（`AGENTS.md:112` 约束未破）。
- **单文件 500 行红线全通过（审查项 15）**（实测当前行数）：
  | 文件 | 现 | 本批增 | 预估 | 判定 |
  |---|---|---|---|---|
  | `src/runtime/WishfulClaw.Agent/Tools/PathBoundary.cs` | 161 | S102-1 +≈15 | ≈176 | ✅ |
  | `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.Entries.cs` | 136 | S101-1/2 +≈20 | ≈156 | ✅ |
  | `src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs` | 214 | S101-3 +≈20 | ≈234 | ✅ |
  | `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.cs`（**未列入涉及文件，但必被 S101-3 触碰**） | 402 | +≈6 | ≈408 | ✅（见 ⚠️-6） |
  | `src/renderer/src/stores/chat-store/memory-helpers.ts` | 302 | S101-4 +≈10 | ≈312 | ✅ |
  | `src/renderer/src/components/settings/MemoryEntriesTab.tsx` | 356 | S101-5 +≈40 | ≈396 | ✅ |
  | `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx` | 195 | S101-5 +≈50 | ≈245 | ✅ |
  | `AGENTS.md`（文档） | 307 | S102-3 +几行 | — | ✅ |
- **S102-2「兄弟目录不穿透」断言在现有实现下成立（审查项 13）**：`PathBoundary.cs:114-122` —— 先比 `string.Equals(target, root)`；再要求 `target.StartsWith(root)` **且** `target[root.Length] == Path.DirectorySeparatorChar`。`.wishful-claw-dev` 相对根 `.wishful-claw` 前缀虽同，但越界字符是 `-` 而非 `\` ⇒ 直接拒绝；反向同理。`GetFullPath` 已把 `/` 归一为平台分隔符（`Normalize` `:143-153`），Windows 下比较用 `OrdinalIgnoreCase`（`:103-105`）。**断言可钉死，不是纸面承诺。**
- **S102 的 env-var 取值路径与实现一致**：放弃在 C# 复刻 `app.isPackaged` 的判断是对的（`data-dir.ts:11-12` 甚至允许 env 覆盖，C# 复刻必然漂移）。
- **`AGENTS.md`「异常日志」节定位准确**（`AGENTS.md:285-296`），S102-3 的两处订正方向正确。

### 我的独立判断（重点第 12、13、14 条）

**12（S-102 会不会削弱沙箱本意 / 开整个数据根值不值）—— 我不同意「开整个数据根」的默认取值，但承认它是用户已拍板的决定，故不作阻断，只要求「明示代价」。**
- 数据根里有 `config.json`（**Provider API Key**）、`index.db`（**全部记忆 + 会话库**）、`ai-provider/*.json`、`codegraph/`。沙箱是**纯路径维度**的（`PathBoundary` + `ToolHelpers.EnsureInsideSandbox`），**没有读写区分**，而 `ToolHelpers.ResolveFilePath`（`:63-79`）同时服务 **Read 与 Write/Edit** ⇒ 把数据根放进允许集合，等于**同时授予 agent 对这些文件的读 + 写权限**（可覆写 `config.json`、可写坏自己赖以运行的 `index.db`）。
- 风险不是「越权读日志」，而是两条新面：① **提示注入外泄** —— agent 若被它读到的文件内容诱导，可把 `config.json` 的密钥读出来再发往别处；② **自伤** —— 误写 `index.db`/`config.json` 会导致产品不可用，且排障面收窄。
- 我的建议（不改用户口径前提下）：① 在 S102 的 commit / `AGENTS.md` 明写「**沙箱开启时，本实例数据根（含 `config.json`、`index.db`）已对 agent 读写放行**」，让「协议要求读日志」与「已放行」的因果关系显式；② 若能接受，给数据根加一个**极小 denylist**（`config.json` 至少，`index.db` 建议），代价低、收益明确；③ 明确「只开 `logs/` 是打地鼠」这个否决理由是对的（确实还要 `MEMORY.md` / `memory-organization-log.json` / `config.json`），但可考虑**白名单**（`logs/` + 若干 *.json/*.md）而非**整根**。综合：本地单机自用产品、用户明确要求，风险可接受；但计划应把「读 + 写 + 密钥在范围内」这句话写出来，不能只写「放行数据根」。

**13（兄弟目录不穿透是否成立）** —— **成立**（论证见 ✅ 段）。这一条 S102-2 的断言是**正确且可验证**的，是本次审查里少数可以「照抄进测试」的承诺。补一句：该性质依赖「根路径先经 `Path.GetFullPath` 归一、末尾分隔符已裁掉」（`Normalize`），实现时不要绕开 `Normalize` 直拼字符串。

**14（`from/to` 用 Unix 秒 + UI 用本地日，时区有没有坑）** —— **无内在 bug，但口径必须钉死「按本地日算边界」，否则必踩一个 +8h 的偏移坑。**
- `updated_at` 存的是**绝对** Unix 秒（`MemoryAppend` 用 `DateTimeOffset.UtcNow.ToUnixTimeSeconds()`，`MemoryModule.cs:129`），与展示端**本地**渲染（`MemoryEntriesTab.tsx:57` `Intl.DateTimeFormat(undefined, {dateStyle,timeStyle})`）在语义上是自洽的：两侧都用绝对时间，只要 `from`/`to` 也由**本地日**换算成绝对秒即可。
- **唯一的坑**：前端算「今天 00:00」若图省事用 `new Date().toISOString().slice(0,10)`（**UTC 日**）再转秒，东八区会整体偏 **−8h** —— 出现「筛『今天』却带出昨天 16:00 之后的条目」或漏掉当天 00:00–08:00。正确写法是 `Math.floor(new Date(y, m, d).getTime() / 1000)`（`Date` 构造用**本地**时区），或 `setHours(0,0,0,0)`。DST 时 `Date` 自会处理，无需手算。
- **另外两点必须写进步骤**：① `to` 的**含端点**语义（`<=` 已在 S101-1 写为「边界取等号」✅），且「今天」的 `to` 应取**当日 24:00 / now**，而非「今天 00:00」；② **`ProjectMemoryLibraryTab` 根本不显示 `updatedAt`**（逐行实读，`:128-148` 无时间列）⇒ raw §1372 选 `updated_at` 的理由「与列表右侧**已经显示**的时间一致、所见即所筛」**只对全局 tab 成立**。建议：要么给项目 tab 也加一列修改时间（顺带消除「按什么时间筛用户看不出来」），要么把「所见即所筛」的验收口径限定在全局 tab。

**15/16/17（规范符合性）** —— 15 ✅（上表核算，无文件触 500 红线；`MemoryModule.cs` 虽被漏列但 402→408 仍安全）；16 ✅（落层全对）；17 ✅（未见 `AGENTS.md` 分层约定被违反；`PathBoundary`(Agent) 读 Infrastructure 属允许方向 —— 唯一的规范层小瑕疵是 ⚠️-1 的「重复造 env 解析」而非依赖方向）。

### 本次结论小结

- **❌ = 2**（皆可用极小成本收敛：❌-1 定一个能触达 Worker 端点的断言落点，或把 `where`/`COUNT` 抽成 Workspace 纯 helper；❌-2 在 S102 补一步、改 `Program.Sandbox.cs:61/:67` 并重申新语义）。
- ⚠️ = 10（⚠️-0 ~ ⚠️-9，其中 ⚠️-1 复用既有 `WishfulClawDataDir.Root`、⚠️-6 补 `IMemorySearch`/`MemoryModule.cs`/2 调用方、⚠️-8 时区口径+项目 tab 时间列，这三条建议一并并入）。
- 事实地基扎实（8 条 7 条全对），**不是「根因没定就定修法」那一类问题**；两项的落层选择正确、文件红线安全。**修掉 2 个 ❌ 即可复验通过。**

---

## 第三批（S-101 / S-102）规划验证复验（2026-09-20）

- **审查对象**：`plan.md`「## 第三批（S-101 / S-102）」（现行 `plan.md:266-334`，**已按上轮 FAIL 订正**）；对照上轮报告同节 + `raw-requirements.md` S-101（`:1353-1387`）/ S-102（`:1391-1431`）。
- **审查者**：独立 subagent（architect-reviewer）；日期 2026-09-20。**方式**：纯静态（未跑构建 / 未跑测试 / 未改任何源码）。本报告为本次唯一写入。
- **实读文件清单**：`plan.md`（全文）、`tests/WishfulClaw.MemoryRecallRegressionTests/WishfulClaw.MemoryRecallRegressionTests.csproj`、`src/runtime/WishfulClaw.Workspace/WishfulClaw.Workspace.csproj`、`src/runtime/WishfulClaw.Workspace/Memory/{IMemorySearch,MemoryFtsService}.cs`、`src/runtime/WishfulClaw.Worker/Modules/MemoryModule.Entries.cs`、`src/runtime/WishfulClaw.Worker/Modules/MemoryModule.cs`、`src/runtime/WishfulClaw.Agent/Tools/PathBoundary.cs`、`tests/WishfulClaw.GoalRegressionTests/{Program.cs,Program.Sandbox.cs,Program.SandboxPrompt.cs}`、`src/runtime/WishfulClaw.Infrastructure/Storage/WishfulClawDataDir.cs`、`src/renderer/src/components/{chat/ProjectMemoryLibraryTab.tsx,settings/MemoryEntriesTab.tsx}`、`src/renderer/src/stores/chat-store/memory-helpers.ts`、`AGENTS.md`、`raw-requirements.md`（S-101/S-102 节）。

### VERDICT: PASS

- 阻断规则（`docs/dev-workflow.md` 阶段三）：❌ > 0 禁止进入用户确认环节。**本轮 ❌ = 0** —— 上轮 ❌-1 / ❌-2 均被 plan 实质修掉，且修法**技术可行、有可执行落点**（非纸面）。
- 5 条主要 ⚠️ 全部吸收（复用 `WishfulClawDataDir.Root` / SSH 语义 / 本地日时区 / 档案页补时间 / 涉及文件补 `IMemorySearch.cs`+`MemoryModule.cs`）。
- **无因订正新引入的阻断性矛盾**；step 编号通（无跳号/重号），i18n 步仍在（`S101-6b`），跨批参数口径一致。
- 残余 6 条（**皆不阻断**，见文末「残余」）：`WishfulClawDataDir` 消费方计数不准、⚠️-6 的 2 处调用方与「MemoryModule 改动理由写偏」、⚠️-9 后路未落、⚠️-7 tier 端点未表态、⚠️-0 raw 措辞、**新发现 N-A「缺 workingFolder 的项目会话」语义变更未明示**。

### 逐条复验

#### ❌-1｜S101-7 断言落点不可达 → **已解决（技术可行）**

- **plan 的修法**：`S101-0`（`plan.md:298`）把「时间区间 SQL 条件段 + 参数」抽成 **Workspace 层纯函数**（`WishfulClaw.Workspace/Memory/`），Worker 端点与搜索链**共用同一份实现**；`S101-7`（`plan.md:306`）明确「**不写** `memory/entries` 端点的『total 与实际行数一致』—— Worker 不可达，此条归真机手测，**不要假装测过**」。
- **可达性核验（逐项实读）**：
  - **测试工程能引用 Workspace**：`WishfulClaw.MemoryRecallRegressionTests.csproj:13` → `ProjectReference` 到 `WishfulClaw.Workspace.csproj`。✅
  - **原 ❌ 前提仍成立**：全仓 `tests/*/*.csproj` **无任何** `ProjectReference` 到 `WishfulClaw.Worker`（11 个套件分别引 Agent / Infrastructure / Workspace，逐文件 grep 确认）；`MemoryEntries`（`MemoryModule.Entries.cs:79`）与 `CountScope`（`:118`）确为 Worker 内 `private static`（宿主 `internal sealed partial class MemoryModule`，`:13`）。⇒ 端点级断言在该工程里**确实写不出来**，plan 的判断正确。
  - **Worker 消费 Workspace 纯函数合法**：`AGENTS.md:89`「Worker 层**依赖** Agent + Persona + **Workspace** + …」；`MemoryModule.Entries.cs:5` 本就有 `using WishfulClaw.Workspace.Memory;`。⇒ 无错层、无逆向依赖。✅
  - **纯函数能被测试工程够到 ⇒ 必须 `public`（且设计上被强制）**：`WishfulClaw.Workspace.csproj` **无 `InternalsVisibleTo`**（全仓仅 `WishfulClaw.Agent.csproj:18-25` 与 `WishfulClaw.CodeGraph.csproj:24` 有；无 `Directory.Build.props`）。而 Worker 是**异程序集**也要消费该函数 ⇒ 只能 `public` ⇒ 测试工程（引用了 Workspace）必然可达。`plan.md:313` 已把它列入涉及文件。✅
  - **S101-3 的双路可加时间过滤**：FTS 路 `JOIN memory_entries e ON f.rowid = e.id`（`MemoryFtsService.cs:71`）⇒ `e.updated_at` 可达；LIKE 路直读 `memory_entries`（`:131`）⇒ `updated_at` 可达。两条路都能拼 `{timeFilter}`。✅
- **结论**：**解决**。plan 采纳了上轮「修法 2」（Workspace 纯 helper），且 `S101-2`（`plan.md:300`）要求 `CountScope` 与 `MemoryEntries`「**必须调用 S101-0 的同一个函数**，不许另写一份」⇒ 从结构上消灭了 raw §1379 点名的「两处各写一遍 WHERE」模式。未测到的端点级一致性被**如实**降级为真机手测（`plan.md:332` 列入「验证态已知限制 ①」），非空头支票。
- **附注（残余，不阻断）**：`plan.md:298` 的验证写「纯函数能被测试工程引用（编译通过即证明落层正确）」—— 建议实现记录里**显式写明该类型为 `public`**，免得后人误设 `internal`（现措辞虽会因编译失败暴露，但意图不够直白）。

#### ❌-2｜S102-1 必红既有沙箱断言 → **已解决**

- **plan 的修法**：`S102-0`（`plan.md:289`）先读 `WishfulClawDataDir` 与 `Program.Sandbox.cs` 既有断言；`S102-1b`（`plan.md:291`）**同步既有断言**：「`Program.Sandbox.cs:61`（项目会话根集合）与 `:65-68`（无 `workingFolder` 时的根数）按新集合更新」，并**新增**「数据根在集合内」「数据根外仍拒绝」；`plan.md:323` 把该文件列进涉及文件。
- **行号 / 断言对得上（逐行实读 `Program.Sandbox.cs`）**：
  - `:61` `AssertEqual(1, projectPolicy.Roots.Count, "项目会话只有一个根")`（`:62` `AssertEqual(root, projectPolicy.Roots[0])`）—— plan 点名的「项目会话根集合」。
  - `:65-68` `AssertEqual(0, PathBoundary.ResolvePolicy({"scope":"project"}).Roots.Count, "项目会话缺 workingFolder 时没有根")` —— plan 点名的「无 `workingFolder` 时的根数」。
- **追加/前置的连带核验**：
  - `:62` `Roots[0] == root` 仅在「**追加**」时保持（`plan.md:290` 用词正是「返回集合**都追加**」）⇒ 不破；若实现成 prepend 则 `:62` 红 —— 「追加」是承重词。
  - `:71` `AssertEqual(0, ResolvePolicy({"sandboxEnabled":false}).Roots.Count)` 走 `Policy.Disabled`（`PathBoundary.cs:34-35`）**不经** `ResolveRoots` ⇒ 不受影响，plan 未提该行亦无碍。
  - `:28-39/:75-107` 全用**显式** roots，不经 `ResolvePolicy` ⇒ 不受影响。
  - `Program.SandboxPrompt.cs` 只断言「段出现与否 + cacheKey」，**不查根集合内容** ⇒ 不受影响。
- **新断言可确定性钉住数据根**：`Program.cs:36` `Environment.SetEnvironmentVariable("WISHFULCLAW_DATA_DIR", testRoot)` ⇒ 进程内 `WishfulClawDataDir.Root == testRoot`（`WishfulClawDataDir.cs:11-13`）；且 `:43 DbClient.Initialize` 先于 `:53 RunSandboxSuite` ⇒ 全局分支查 `projects` 表可跑。「数据根在集合内」对 `WishfulClawDataDir.Root` 直接断言即可，**确定性的**。（`:23 outside = Path.GetTempPath()` 是 `testRoot` 的**父**目录，不在 `[root, dataRoot]` 任一之内 ⇒「数据根外仍拒绝」成立。）
- **结论**：**解决**。两处行号与断言内容完全吻合，S102-0 + S102-1b 覆盖到位。

#### ⚠️-1｜复用 `WishfulClawDataDir.Root` → **已吸收**

- `plan.md:290`：「**直接复用 `WishfulClawDataDir.Root`**（… 不要再自行解析环境变量或复刻 `isPackaged`）」；`plan.md:311` 列该文件「复用其 `Root`，预期零改动」。实体核对：`WishfulClawDataDir.cs:7-19`（env `WISHFULCLAW_DATA_DIR` 优先 → `Path.GetFullPath`；否则 `UserProfile/.wishful-claw`）—— 与 raw §1429 口径**逐字一致**。✅
- **残余（不阻断）**：`plan.md:290` 称「全仓已有 **17 处**消费方」。实测 `WishfulClawDataDir` 引用 = `src` 15 处（`AgentLoop:183` / `SubAgentDefinition:50` / `SystemPromptCache:92` / `PersonaStore:33` / `SpillStore:28` / `DbClient:34` / `ConfigStore:192` / `ProviderStore:163` / `MemoryPathResolver:17` / `ChannelConfigStore:183` / `QqSessionStore:144` / `ExtensionManifestHelpers:136` / `OpenAIAudioTools:216` / `SeedanceVideoTools:144` / `XaiVideoTools:143`）+ `tests` 1 处（`Program.Spill.cs:59`）= **16**。举例的三处均真实存在，数字不精确但不影响动作。

#### ⚠️-2｜S102 SSH 语义 → **已吸收**

- `plan.md:293` `S102-3`：「SSH 项目的 `working_folder` 是远端路径（现有代码已排除），数据根是**本地绝对路径** —— 两分支都追加不影响 SSH 语义，需在代码注释里写明『数据根始终是本地的，与 SSH 无关』」+「验证：注释 + 断言」。✅（覆盖 raw §1431「SSH 不参与」）

#### ⚠️-3｜S102 断言落点 → **已吸收**

- 落点钉死在 `tests/WishfulClaw.GoalRegressionTests/Program.Sandbox.cs`（`S102-1b`/`S102-2`，`plan.md:291-292`；涉及文件 `plan.md:323`）。该文件已 `using WishfulClaw.Agent.Tools;`（`Program.Sandbox.cs:2`）⇒ `PathBoundary` 可达。✅

#### ⚠️-4｜数据根不存在时 → **已吸收**

- `plan.md:293`：「另确认数据根目录**不存在**时不抛异常（`IsInsideAnyRoot` 只做字符串比较、不碰磁盘 —— 复核一次）」。✅

#### ⚠️-8｜时区本地日 → **已吸收**

- `plan.md:302` `S101-4`：「`from`/`to` 传 Unix 秒，但『今天 / 近 7 天』的**边界必须按本地日**算（本地 00:00 为当日起点），**不要**用 UTC 日 —— 否则东八区用户在早上 8 点前会看到『今天』少几小时」。✅ 与上轮 ⚠️-8 建议逐字对应。

#### ⚠️-8b｜档案页补时间显示 → **已吸收**

- `plan.md:304` `S101-6`：「`ProjectMemoryLibraryTab` 当前**不显示 `updatedAt`** … 补一行时间显示（沿用 `MemoryEntriesTab` 的 `formatTimestamp` 口径）」。实读核对：`ProjectMemoryLibraryTab.tsx:139-141` 只渲染 `{entry.priority} · {entry.status}`，**无时间列**，⚠️ 属实；`MemoryEntriesTab.tsx:56-58` 有 `formatTimestamp` + `:339` 渲染。✅

#### ⚠️-6｜涉及文件补 `IMemorySearch.cs` / `MemoryModule.cs` → **已吸收（不完整）**

- `plan.md:314` 列 `WishfulClaw.Workspace/Memory/IMemorySearch.cs`（签名同步）；`plan.md:317` 列 `WishfulClaw.Worker/Modules/MemoryModule.cs`。**两个点名文件都进了**。✅
- **残余（不阻断）**：(a) 上轮 ⚠️-6 还点名「另 2 处调用方」`MemoryRecallService.cs:165`、`MemorySearchTool.cs:81`（grep 确认二者均消费 `IMemorySearch.SearchAsync`），plan 未列；若新参数带默认值且追加在 `ct` 之后（或调用方用命名参）则二者免改，但 **plan 未写明参数落位**。(b) `plan.md:317` 把 `MemoryModule.cs` 的改动理由写成「若 `GetScope` 需随之调整」—— **理由写偏**：实际必须改的是 `MemorySearch` handler（`MemoryModule.cs:106-118`，读 `query/scope/limit/include_deprecated` 后调 `search.SearchAsync`）要解析并透传 `from`/`to`；`GetScope:310-344` 本身无需动。文件已列，故不阻断，但实现时按现文字会漏掉端点解析。

#### ⚠️-9｜options 化 vs 9 个裸位置参数 → **未完全吸收（残余）**

- `plan.md:303` `S101-5` 仍把 options 化列为「**我自己的取舍、非需求**，若判断影响面不值就跳过」。上轮 ⚠️-9 的**后路**（「若跳过，`from`/`to` 也要用 options 尾参承载，别走 9 个裸位置参数」）未写进 plan（raw §1387 也只是「建议」）。不阻断（raw 明示可砍）。

#### ⚠️-5｜安全爆炸半径 → **已吸收**

- `plan.md:334`「**S-102 的代价（须明示）**：把整个数据根放进允许集合 = agent 可读写 `config.json`（含 API Key）/ `index.db` … 收尾报告里要写清这一条」。✅

#### ⚠️-7｜tier 端点 `entries-by-status` 未表态 → **未吸收（残余）**

- plan 与 raw 仍未提 `MemoryModule.Entries.cs:30-65` 的 `memory/entries-by-status`（消费方 `MemoryPanel.tsx:68-69`）要不要同样支持时间筛选。不阻断。

#### ⚠️-0｜raw 措辞（`scope/limit/offset/order` 漏 `workingFolder`/`projectId`/`sshConnectionId`）→ **未改（残余，非 plan 职责）**

### 新问题（本轮复验新增，均不阻断）

- **N-A（语义变更未明示，⚠️）**：`S102-1` 落地后，「项目会话缺 `workingFolder`」由 **`[]`（= 不拦）** 变为 **`[数据根]`（= 只放行数据根，其余全拦）** —— 与 `Program.Sandbox.cs:64` 自己的注释「没有根可依，解析结果为空（= 不拦）」**语义相悖**。`plan.md:291` 只说「按新集合更新」根数，**未写明这条行为语义的翻转**（原「无根即不拦」的降级对该分支失效）；SSH 项目 `workingFolder` 为远端/缺省时同理（`S102-3` 只讲「不影响 SSH 语义」，未讲这条降级变化）。建议在 `S102-1b` 明写新语义（「项目会话恒 ≥ 1 根，缺 `workingFolder` 时根 = 数据根」）并确认可接受。
- **N-B（编号通，✅）**：`S102` = 0 / 1 / 1b / 2 / 3 / 4；`S101` = 0 / 1 / 2 / 3 / 4 / 5 / 6 / **6b** / 7。**无跳号、无重号**；原 i18n 步仍在（= `S101-6b`，`plan.md:305`）。`1b`/`6b` 为插入式编号，连贯。
- **N-C（跨批一致性 ✅）**：`memoryEntries` 参数顺序 —— `S-98-4`（`plan.md:233`）= 7 参（`scope, workingFolder, limit, projectId, sshConnectionId, offset, order`），实测 `memory-helpers.ts:264-271` **逐字一致**，与 `S-101-5`「7 个位置参数」一致；`MaxEntriesLimit = 500`（`MemoryModule.Entries.cs:23`）在第三批**未被触碰**，无冲突。
- **N-D（行数 watch，⚠️/不阻断）**：`MemoryModule.Entries.cs` 现 **136** 行；`S-98-1` 曾定该新文件目标 **≤150** 行，`S101-1/2` 再增 `from`/`to` + 共用函数调用后逼近（约 +7~15）⇒ 可能**略超 150**，但第三批检查点是 **≤500 硬线**（`plan.md:330`）⇒ 不阻断，留观。

### 残余（不阻断）

1. `plan.md:290` 的「17 处消费方」计数不准（实测 16）。
2. ⚠️-6 的 2 处调用方（`MemoryRecallService.cs:165` / `MemorySearchTool.cs:81`）未列、新参数落位未写明；`plan.md:317` 对 `MemoryModule.cs` 的改动理由写偏（应为 `MemorySearch` handler 解析 `from/to`，非 `GetScope`）。
3. `S101-0` 的 `public` 可见性未显式写死（设计上被强制，建议点明）。
4. ⚠️-9 后路（跳过 options 时 `from/to` 用 options 尾参承载）未落。
5. ⚠️-7 tier 端点 `memory/entries-by-status` 是否支持时间筛选未表态。
6. ⚠️-0 raw 措辞未订正（非 plan 职责）。
7. `S-98-1` 的 `MemoryModule.Entries.cs ≤150` 目标可能被本批略微突破（仍 ≤500，不阻断）。
8. **N-A**：缺 `workingFolder` 的项目会话语义由「不拦」变「只放行数据根」—— 建议明示并确认可接受。

---

## 第四批（S-103）规划验证（2026-09-20）

### 结论：FAIL

有 **3 条 ❌ 阻断**。计划的**核心意图与绝大多数探索结论经实读核实成立**（渠道可见性、config 端点、沙箱两段式、底层 Create 都已就位，判断准确）。但有三处会让实施跑偏或让安全约束/断言失效：① AOT 结果类型的**注册落点写错**（照抄会在真机运行期炸）；② **断言套件未指定工程**（IVT 决定可达性，写 internal 就编译不过）；③ 沙箱追加的**落点**若按字面「复用 `WithDataRoot`」会把父目录**泄漏进项目会话**并打红既有断言。修掉这 3 条即可开工。

---

### 一、事实核验结果（逐条，全部带文件:行号）

| # | plan 的结论（plan.md 行） | 判定 | 证据 |
|---|---|---|---|
| 1 | 渠道 scope 被强制成 `global` | ✅ | `AgentRunContextPolicy.cs:35-40`（`if (sessionMode == "channel") scope = "global";`） |
| 2 | 渲染出的上下文串是 `global:channel` | ✅ | `ToolVisibilityPolicy.cs:62-64`（`channelSession` ⇒ mode=`"channel"`）+ `:78`（no-role 时 `scope:mode`）⇒ `global:channel`；`RenderContext` 确在 `:59-79` |
| 3 | `GlobalSideOnly = ["global:*@*"]`（mode 通配）**已覆盖渠道** | ✅ | `ToolVisibilityScopes.cs:48`；`MatchesPattern` 推演见下方「通过项 A」 |
| 4 | `config/get` + `config/set` 端点已存在 | ✅ | `ConfigModule.cs:20-24`（`config/get`=:22、`config/set`=:23） |
| 5 | 设置类模板 = 常量 + 静态 Read/Write + Defaults | ✅ | `GlobalChannelSettings.cs`（`Defaults` :20、`Read` :61、`Write` :73、`ConfigKey` :27） |
| 6 | `ToolSchemaBuilder`（Object/String/Integer） | ✅ | `ToolSchemaBuilder.cs:13` / `:55` / `:91` |
| 7 | `ProjectToolsProvider` 已有 5 工具、缺 `create_project` | ✅ | `ProjectToolsProvider.cs:13-108`；5 工具的 `visibleScopes` 与 raw §1512-1516 表**逐条一致**（list/get=`Everywhere`、create_session=`GlobalSideAndWorkRuns`、另两个=`GlobalSideOnly`） |
| 8 | 执行器 `ProjectToolNames` + switch 分派 | ✅ | `AgentRuntimeProjectExecutor.cs:16`（集合）/`:32`（switch）；`ToolDispatchRouter.cs:441`（`IsProjectTool` 分支） |
| 9 | 项目创建底层 + RPC | ✅ | `DbProjectTools.cs:67`（`Create`）、`Directory.CreateDirectory` 在 `:83`；`DbModule.cs:28` 注册 `db/projects-create` |
| 10 | 沙箱两段式（S-102 后） | ✅ | `PathBoundary.cs:60` `CollectProjectRoots` / `:96` `WithDataRoot`；`ResolveRoots`=`:52-53` |
| 11 | 设置页落点（沙箱开关旁） | ✅ | `RuntimePanel.tsx:104-117`（`sec-runtime-sandbox`） |
| 12 | 目录选择器先例 `skill-panel.tsx:71` | ⚠️ 行号对、**先例引用不准** | `skill-panel.tsx:71` 确为 `ipcClient.invoke('fs:select-folder')`，但**不带参数**；带 `{ defaultPath }` 的正确先例是 `WorkingFolderSelectorDialog.tsx:210-212`。main 侧 handler 确支持 `defaultPath`（`main/index.ts:249-256`）⇒ 功能可行，仅先例指错 |
| 13 | 用户创建路径（不动） | ✅ | `stores/chat-store/project-slice.ts:81` `createProject` |
| 14 | 结果类型「加进 `AotProjectResultTypes.cs`」即完成 AOT 注册 | ❌ **错误** | `AotProjectResultTypes.cs` **只有 record 定义、无任何 `[JsonSerializable]`**；真正的源生成注册在 `WishfulClaw.Worker/WishfulClawJsonContext.cs:132-136`（`ProjectListRow/ProjectListResult/SessionListRow/ProjectDetailResult/CreateSessionResult` 全在那里）。详见 ❌-1 |

**通过项 A —— `global:*@*` 能匹配 `global:channel`（按解析逻辑推一遍）：**
- 运行时串（渠道）：`scope`=global（被强制）、`channelSession`=true ⇒ `mode`=`channel`（`ToolVisibilityPolicy.cs:62-64`）、无 `@role` ⇒ role 取默认 `sessionagent` ⇒ **`global:channel`**。
- 模式串：`ParseScopeMode("global:*@*")` ⇒ `role="*"`、`body="global:*"` ⇒ `scope="global"`、`mode="*"`。
- 逐段比：`MatchesSegment("global","global")`=true；`MatchesSegment("*","channel")`=true（`*` 命中任一段）；`MatchesSegment("*","sessionagent")`=true ⇒ **匹配通过**。
- 模式串的角色段落到 `*`（通配），所以 mode 段通配 + role 段通配，渠道必然可见。**plan 结论正确**。

**通过项 B —— `availableModes: ["global"]` 对渠道有效（两道闸都过）：**
- 闸一（模式）：`ResolveAvailableMode` 对 `sessionMode == "channel"` **返回字面 `"global"`**（`AgentRunContextPolicy.cs:97-101`，注释明说这就是为了别掉 `availableModes: "global"` 的工具）；`GetToolDefinitions(sessionMode)` 用精确匹配（`ToolRegistry.cs:224`）；`ToolCallProcessor.cs:169/210` 亦用 `ResolveAvailableMode` 出参。`list_projects` 的 `["global"]` 就是现成先例 ⇒ **能过**。
- 闸二（可见性）：见通过项 A ⇒ **能过**。两道独立闸门 `create_project` 都过得去，plan §S103-3 的「与 `list_projects` 一致 ⇒ 渠道也拿到」成立。

**通过项 C：** `test:i18n-coverage` 脚本存在（`package.json`）；11 个 C# 套件 = `tests/` 下 11 个 `*Tests.csproj`（✅ 与 plan.md:413「11 个 C# 套件」一致）。

---

### 二、❌ 阻断项（必须修入 plan 才能开工）

#### ❌-1：AOT 结果类型的**注册落点写错** —— 照 plan 字面做，工具在真机跑到该分支才炸（且不是编译错）

- **plan 原文**：`plan.md:384` S103-3c「结果类型加进 `AotProjectResultTypes.cs`（AOT 源生成下漏注册是**编译错误**，不是告警）」；`plan.md:405` 涉及文件同样只列 `Agent/AotProjectResultTypes.cs`。
- **实读**：`AotProjectResultTypes.cs` 通篇只有 `record` 定义，**没有一条 `[JsonSerializable]`**。真正的注册点是 `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs:132-136`（`ProjectListRow` :132、`ProjectListResult` :133、`SessionListRow` :134、`ProjectDetailResult` :135、`CreateSessionResult` :136）。
- **为什么会炸**：`AgentRuntimeProjectExecutor` 走 `WorkerJsonHelper.GetTypeInfo<T>()`（`AgentRuntimeProjectExecutor.cs:81/169/235`），其实现是 `JsonOptions.GetTypeInfo(typeof(T))!`（`Contracts/WorkerResponse.cs:99-102`），而解析器是 `Program.cs:16-19` 装的 `JsonTypeInfoResolver.Combine(WishfulClawJsonContext.Default, AgentRuntimeJsonContext.Default)`。新类型两边都没注册 ⇒ `GetTypeInfo` 返回 **null** ⇒ `JsonSerializer.Serialize(value, (JsonTypeInfo<T>)null)` 抛 `ArgumentNullException`。这是**运行期**错误，**编译器不会兜底**（`GetTypeInfo<T>` 这条路径本就是为了消掉 IL2026/IL3050 而存在，故连告警都没有）—— plan 的「漏注册是编译错误」判断**错**，只有手测 `create_project` 成功分支才暴露。
- **建议修法**：S103-3c 改为「① `CreateProjectResult`（及各新 record）定义在 `AotProjectResultTypes.cs`；② **在 `WishfulClaw.Worker/WishfulClawJsonContext.cs` 追加 `[JsonSerializable(typeof(CreateProjectResult))]`**（与既有的 `ProjectListResult` 等并列）」；`plan.md:405` 涉及文件补 `Worker/WishfulClawJsonContext.cs`。

#### ❌-2：断言套件**未指定工程** —— IVT / `public` 决定可达性，选错则编译不过（`ProjectCreationPolicy` 断言写不出来）

- **plan 原文**：`plan.md:377`「抽成纯函数是为了可断言 —— …验证：**断言套件**」；`plan.md:409` 涉及文件只写「**测试工程**（新增断言套件）」。**两处都没点明哪个工程**，而工程选择不是自由项。
- **实读（IVT）**：`WishfulClaw.Agent.csproj:17-26` 的 `InternalsVisibleTo` 名单 **8 项**：`GoalRegressionTests`、`CompactionSnapshotRegressionTests`、`ToolConcurrencyRegressionTests`、`ChannelToolVisibilityRegressionTests`、`ChannelShellApprovalRegressionTests`、`ProviderHeaderRegressionTests`、`GrepPatternRegressionTests`、`MemoryRecallRegressionTests`。
- **实读（谁引用 Agent）**：`tests/` 11 个工程里 **10 个**引用 `WishfulClaw.Agent`；**只有 `WishfulClaw.AgentTimelineRegressionTests` 不引用**（仅 `Infrastructure`）。**注意两个引用 Agent 却不在 IVT 里的**：`WishfulClaw.CronRegressionTests`、`WishfulClaw.SessionTaskCascadeRegressionTests`。
- **推论**：`Agent` 里同类策略类 `AgentRunContextPolicy` / `ToolVisibilityPolicy` 都是 **`internal static`**（`AgentRunContextPolicy.cs:23`、`ToolVisibilityPolicy.cs:32`）。
  - 若 `ProjectCreationPolicy` 写成 **`internal`**（与同类一致）⇒ 断言**只能**落在那 8 个 IVT 工程之一。若实现者顺手放进 `CronRegressionTests` / `SessionTaskCascadeRegressionTests`（它们确实引用 Agent）⇒ **编译不过 `CS0122`**。
  - 若写成 **`public`**（像 `PathBoundary` `PathBoundary.cs:26`）⇒ 10 个引用 Agent 的工程都能断言。
- **建议修法**：在 S103-2 里**写死**「`public static class ProjectCreationPolicy` + 断言落在 `WishfulClaw.ChannelToolVisibilityRegressionTests`（或 `GoalRegressionTests` —— 它已有 `Program.Sandbox.cs` 断言 `PathBoundary`，是现成先例）」。**首选 `ChannelToolVisibilityRegressionTests`**：plan.md:415 检查点 3 本来就要断言 `create_project` 的可见性（含 `global:channel`），把纯函数断言与可见性断言放同一套件最省事；该工程已引用 Agent 且在 IVT 里。

#### ❌-3：沙箱追加的**落点** —— 「复用 `WithDataRoot`」按字面会把父目录**泄漏进项目会话**，且打红既有断言、让检查点 4 不可写

- **plan 原文**：`plan.md:388` S103-4「`PathBoundary.ResolveRoots`：**全局分支**追加父目录（**复用 S-102 `WithDataRoot` 的追加模式**）；**项目会话不加**」。
- **问题 1（安全）**：`ResolveRoots = WithDataRoot(CollectProjectRoots(parameters))`（`PathBoundary.cs:52-53`）—— **`WithDataRoot` 被项目会话与全局会话共用**（`PathBoundary.cs:86-95` 注释明说「项目会话和全局会话两条路都必须带上它」）。若把「追加父目录」写进 `WithDataRoot`（plan 字面「复用其追加模式」），则**项目会话也会拿到父目录** ⇒ 直接违反 plan 自己的口径（`plan.md:388`「项目会话不加」）与 raw §1553「给出去了，项目 A 的会话就能读写项目 B」。**这是本需求的核心安全边界，不能靠措辞含糊过去。**
- **问题 2（打红既有断言）**：`GoalRegressionTests/Program.Sandbox.cs:85-92` **直接断言 `WithDataRoot` 的根数** —— `WithDataRoot([])` 必须 `==1`、`WithDataRoot([root,secondRoot])` 必须 `==3`。往 `WithDataRoot` 里追加父目录后，这两条**必红**。
- **问题 3（检查点 4 不可写）**：`plan.md:416` 检查点 4 要「父目录进**全局分支**、不进**项目分支**」。但全局分支 `CollectProjectRoots` 会走 `DbClient.GetClient()`（`PathBoundary.cs:71`），而套件里**不能碰真库**（`Program.Sandbox.cs:82-83` 的原话：「那是会初始化真实库的写操作，套件里不能碰」）⇒ 现状**没有可断言的纯函数 seam** 能把「父目录进全局分支」单测出来。
- **建议修法**：新增一个**接收已解析 parentDir 的纯函数**（如 `internal static IReadOnlyList<string> WithProjectsParent(IReadOnlyList<string> roots, string? parentDir)`，parentDir 为空则原样返回），**只在 `CollectProjectRoots` 的全局分支**调用它；`WithDataRoot` **一字不动**（既有断言与「纯函数」契约都保住）。检查点 4 改为断言这个新纯函数（全局调用点由 `ResolveRoots` 串起来、不碰 DB）。

---

### 三、⚠️ 建议项（不阻断，但建议实施前定）

#### ⚠️-1：配置「未配置」语义与「回退默认地址」**自相矛盾** —— 检查点 5 的报错路径按现文字不可达
- 证据：`plan.md:372` `Read()`「未设置时**回退默认地址**」；`plan.md:377` 策略「父目录为空 ⇒ **错误**」；`plan.md:388` 沙箱「父目录**未配置**或解析失败 ⇒ 不加」；`plan.md:417` 检查点 5「**未配置时明确报错**」。
- 冲突：若 `Read()` 恒返回默认（`~/WishfulClawProjects`），则「未配置」**永不出现** ⇒ 工具**静默建到默认目录**、沙箱**恒加根**，检查点 5 的「未配置时报错」**永远测不到**；而 `plan.md:373`「空写入视为清除」之后又回落到默认，同样回到这条死循环。
- 建议：拆两个入口 —— `TryReadConfigured()`（用户没设时返回 `null`，**供策略/沙箱用**）与 `Read()` / `DefaultPath`（**供设置页输入框预填**）。并明确「用户显式清空 = 未配置」之后，工具是**报错**还是**回退默认建**（二者取一，写进 plan）。

#### ⚠️-2：重名 / 已存在目录未覆盖
- 证据：`DbProjectTools.Create`（`DbProjectTools.cs:81-99`）对 `workingFolder` 只调 `Directory.CreateDirectory`（**幂等，同名目录不报错**），`projects` 表**无 name / working_folder 唯一约束**，`id` 由 `CreateId()` 生成（GUID，不冲突）。
- 后果：agent 连续两次 `create_project name=Foo` ⇒ 两条**同名同路径**的项目；用户在 `父目录/foo` 已建过项目时 ⇒ 再来一条。
- 建议：在策略/执行器加一条「同 `folderName`（或同路径）已存在 ⇒ 报错或返回既有项目」的处置，并在 plan 写明。

#### ⚠️-3：设置页的渲染端读写通路没写明（无先例，但可达）
- 证据：渲染端**全仓无 `config/get` / `config/set` 使用先例**（grep 为空）；但 `window.api.workerRequest(method, params)` 是通用桥（`db/*`、`memory/*`、`persona/*`、`provider/*` 均如此，见 `stores/chat-store/db-helpers.ts:10`、`persona-store.ts:38-175`），且 `config/get`/`config/set` 已在 `ConfigModule.cs:22-23` 注册 ⇒ **可达**。
- 建议：plan S103-5 明写「渲染端走 `window.api.workerRequest('config/get'|'config/set', …)`」，免得实现者以为要新开 IPC 通道。另 `RuntimePanel.tsx` 现在是用同步的 `useSettingsStore`（`:22`），本项要引入**异步加载**（首屏 fetch + 保存态），plan 未提。

#### ⚠️-4：`fs:select-folder` 先例引用不准（见事实表 #12）
- 建议：把 `plan.md:365` 的先例改成 `chat/WorkingFolderSelectorDialog.tsx:210-212`（那是唯一传 `{ defaultPath }` 的现成调用）。

#### ⚠️-5：`id` 生成方式应写明
- `create_project` 的 schema 只有 `name/folderName/description`（`plan.md:382`），未暴露 `id` ⇒ 服务端 `CreateId()` 生成，**无冲突**。建议 plan 明写「**不传 `id`**，服务端生成」，避免实现者顺手把 `id` 加进 schema（那会让 agent 指定任意 id）。

#### ⚠️-6：项目显示名与目录名会不一致（预期内，但需说明）
- `DbProjectTools.Create` 内 `SanitizeProjectName`（`DbProjectTools.cs:299-310`）把 `<>:"/\|?*` 换**空格**并压缩空白、空则回落 `"New Project"`；而 `ProjectCreationPolicy` 派生 `folderName` 把非法字符换 **`-`**。⇒ 显示名（空格）≠ 目录名（`-`）；若 `name` 全非法字符，显示名变 `New Project` 而目录名是派生值。建议在 plan 说明二者关系。

#### ⚠️-7：`GlobalSideOnly` 挡的是「项目 cowork」，不是「global 域子代理」—— raw §1556 副作用的措辞要收紧
- 证据：`GlobalSideOnly = ["global:*@*"]`（`ToolVisibilityScopes.cs:48`）的 role 段是 `*`。global 作用域的子代理（`runtimeRole=subagent` ⇒ 串 `global:cowork@subagent`）**照样匹配**；真正被挡的是**项目作用域**（`project:cowork` 不匹配 `global:*@*`）。
- 影响：raw §1556 那句「全局 PM 派出去的 cowork 子任务不能建项目」**表述不准**（被挡的是项目 cowork，不是 global 子代理）。功能意图（项目会话不给父目录访问）不受影响，仅措辞。建议改为「**项目会话 / 项目 cowork 不可见**」。

#### ⚠️-8：`create_project` 会经 `use_capability` 代理触达，而非直接注入 —— plan 未表态
- 证据：`ToolDefinitionPlaceholder` 默认 `isCore=false`（`ToolDefinitionPlaceholder.cs:29`），5 个既有项目工具都没设 `isCore` ⇒ `ResolveDirectInjection` 只留 `IsCore`（`AgentRunContextPolicy.cs:210-217`）⇒ 与 `list_projects` 一样**不进直接工具表**，只经 `use_capability` 代理。
- 影响：与既有项目工具行为一致，**不是缺陷**；但 plan 未写 `IsCore`。建议明写「`isCore=false`，与既有项目工具一致」，免得实现者以为要直注入而漏 `use_capability` 路径的验证。

---

### 四、我的独立判断（针对本次三个重点）

1. **可见性（plan 最关键的设计主张）经实读成立**：`availableModes: ["global"]` + `visibleScopes: GlobalSideOnly` 两道闸，渠道（`global:channel`）都过。plan 不需要为渠道做任何额外改动，此判断**正确**。
2. **plan 对「沙箱拦不住 `create_project`（路径非参数）」的判断成立且重要**（raw §1555/§1563）：`create_project` 的边界 100% 依赖 `ProjectCreationPolicy`，所以 ❌-2（断言落点）与 ❌-3（沙箱落点）是本需求仅有的两道防线，必须落死。
3. **真实性核查发现 1 处硬错（❌-1）**：plan 把 AOT 注册点记成了 `AotProjectResultTypes.cs`。这条不改，`create_project` 成功分支会在**真机运行期**抛 `ArgumentNullException`，而编译器/类型检查都抓不到 —— 属于「照 plan 做就必踩」的坑。

### 五、结论

**FAIL**（3 ❌ / 8 ⚠️）。修法均已给到文件:行号级别：❌-1 改 `plan.md:384`+`:405`（补 `WishfulClawJsonContext.cs` 注册）；❌-2 在 `plan.md:377`/`:409` 写死断言工程（建议 `ChannelToolVisibilityRegressionTests`）；❌-3 在 `plan.md:388` 明确「新增纯函数 `WithProjectsParent`、只在全局分支调用、`WithDataRoot` 不动」。三条落地后 → PASS。

---

## 第四批（S-103）规划验证复验（2026-09-20）

- 复验对象：`plan.md` §「第四批（S-103）」（`plan.md:339-420`）、`raw-requirements.md` §S-103（含 §「规划验证处置（2026-09-20）」，`raw-requirements.md:1498-1590`）
- 上一轮报告：本文件 §「第四批（S-103）规划验证（2026-09-20）」
- 复验方式：把每一条修订文本**回源码 / 工程文件实读核对**，非推测。实读文件：`Worker/WishfulClawJsonContext.cs`、`Agent/AotProjectResultTypes.cs`、`Agent/WishfulClaw.Agent.csproj`、`tests/WishfulClaw.ChannelToolVisibilityRegressionTests/*.csproj`、`Agent/Tools/PathBoundary.cs`、`tests/WishfulClaw.GoalRegressionTests/Program.Sandbox.cs`、`Worker/Modules/ConfigModule.cs`、`Infrastructure/Storage/ConfigStore.cs`
- **复验结论：PASS** —— 3 条 ❌ 全部**已修**且证据准确；**未新增 ❌**。残余问题均为 ⚠️ 级措辞/表述残留（详见三、四）。

### 一、三条 ❌ 的复验结果

| ❌ | 复验结果 |
|---|---|
| ❌-1 AOT 结果类型注册点 | **已修**（指向正确、注册模式对、涉及文件已补） |
| ❌-2 断言落哪个工程 | **已修**（`public` + 工程名写死，工程可达性经实读验证） |
| ❌-3 沙箱追加落点 | **已修**（新纯函数 + 只全局分支调用 + `WithDataRoot` 不动，结构与既有断言均相容） |

#### ❌-1 —— 已修

- **新文本**：`plan.md:386`（S103-3c）把两件事拆开 —— record 定义放 `Agent/AotProjectResultTypes.cs`；**`[JsonSerializable]` 注册在 `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs`**（「与既有的 `ProjectListResult` 等并列，约 `:132-136`」）。并把「漏注册是编译错误」订正为「`GetTypeInfo<T>()` 的 `!` 吞掉 null ⇒ **运行期 `ArgumentNullException`**，编译器与类型检查都不抓」。
- **涉及文件**：`plan.md:408` 已列入 `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs`（标注「**`[JsonSerializable]` 注册点** —— ❌-1」）。
- **实读核对**：
  - `WishfulClawJsonContext.cs:132-136` = `[JsonSerializable(typeof(ProjectListRow))]`(`:132`) / `ProjectListResult`(`:133`) / `SessionListRow`(`:134`) / `ProjectDetailResult`(`:135`) / `CreateSessionResult`(`:136`)，模式确为并列的 `[JsonSerializable(typeof(Xxx))]`，紧邻 `ProjectListResult`。⇒ plan 的「约 `:132-136`」**准确**，「与 `ProjectListResult` 并列」**准确**。
  - `AotProjectResultTypes.cs` 通篇只有 `record`（`ProjectListRow` / `ProjectListResult` / `SessionListRow` / `ProjectDetailResult` / `CreateSessionResult`），**零 `[JsonSerializable]`** —— 与上一轮结论一致。
- **结论**：指向正确、模式正确、涉及文件到位。**已修。**

#### ❌-2 —— 已修

- **新文本**：`plan.md:377`（S103-2）写死 —— 新增 `Agent/Tools/ProjectCreationPolicy.cs`，**`public static class`**（附理由「写成 `internal` 会把断言锁死在 8 个 `InternalsVisibleTo` 工程里」）；并写「**❌-2 定案：断言落在 `tests/WishfulClaw.ChannelToolVisibilityRegressionTests`** —— 该工程已引用 Agent 且在 IVT 名单内」。
- **实读核对（IVT）**：`WishfulClaw.Agent.csproj:17-26` 的 `InternalsVisibleTo` **恰为 8 条**（`:18` `GoalRegressionTests`、`:19` `CompactionSnapshotRegressionTests`、`:20` `ToolConcurrencyRegressionTests`、`:21` **`ChannelToolVisibilityRegressionTests`**、`:22` `ChannelShellApprovalRegressionTests`、`:23` `ProviderHeaderRegressionTests`、`:24` `GrepPatternRegressionTests`、`:25` `MemoryRecallRegressionTests`）；**不含** `WishfulClaw.CronRegressionTests` / `WishfulClaw.SessionTaskCascadeRegressionTests` —— 与上一轮完全一致。
- **实读核对（是否引用 Agent）**：`tests/WishfulClaw.ChannelToolVisibilityRegressionTests/WishfulClaw.ChannelToolVisibilityRegressionTests.csproj:10-12` = `<ProjectReference Include="..\..\src\runtime\WishfulClaw.Agent\WishfulClaw.Agent.csproj" />` ⇒ **该工程确实引用 Agent，且 `ChannelToolVisibilityRegressionTests` 在 IVT 内** ⇒ 断言可达（`public` 使其更无约束，双保险）。
- **结论**：`public`/`internal` 与工程名都已写死，工程选择经实读为真。**已修。**
- 轻微残留（非阻断）：`plan.md:412` 汇总的涉及文件仍写泛化「测试工程（新增断言套件）」，未回填工程名。建议改为具名，与 S103-2 对齐。

#### ❌-3 —— 已修

- **新文本**：`plan.md:390`（S103-4）明确 —— 新增纯函数 `PathBoundary.WithProjectsParent(IReadOnlyList<string> roots, string? parentDir)`（parentDir 空则原样返回），**只在 `CollectProjectRoots` 的全局分支**调用它；**`WithDataRoot` 一字不动**；并写明理由（`ResolveRoots = WithDataRoot(CollectProjectRoots(parameters))` 里 `WithDataRoot` 被项目/全局**两分支共用**，写进去会把父目录泄漏进项目会话，且打红 `Program.Sandbox.cs` 的既有断言）。
- **实读核对（结构是否支撑改法）**：`PathBoundary.cs`
  - `ResolveRoots`（`:52-53`）= `WithDataRoot(CollectProjectRoots(parameters))`；
  - `CollectProjectRoots`（`:60-84`）：**项目分支在 `:62-66` 提前 `return`**；全局分支在 `:68-84`（`:71` `DbClient.GetClient()` 查表 + `:78-83` catch 兜底）⇒ **全局分支确有干净插入点**（把全局分支的返回值包一层 `WithProjectsParent(roots, parentDir)` 即可），且**项目分支根本不会走到全局分支** ⇒ 天然不泄漏。
  - `WithDataRoot`（`:96-103`）不动 ⇒ 「纯函数、不碰 DB」的原契约保住。
  - 分层：`PathBoundary` 已 `using WishfulClaw.Infrastructure.Storage`（`:5`，用于 `WishfulClawDataDir`），在其调用点读 `ProjectsParentDirectory.Read()`（Infrastructure.Storage）**不新增跨层引用**，合规。
- **实读核对（既有断言是否红）**：`Program.Sandbox.cs:85-87` = `AssertEqual(1, PathBoundary.WithDataRoot([]).Count, …)`、`:89-92` = `AssertEqual(3, PathBoundary.WithDataRoot([root, secondRoot]).Count, …)` —— 两条**直接调 `WithDataRoot`**，新方案不动 `WithDataRoot` ⇒ **不会红**。同文件 `:63-72` 的项目会话根数断言走「项目分支 + `WithDataRoot`」，同样不受影响。
- **结论**：语义写死、结构与既有断言均相容、纯函数可单测。**已修。**
- 轻微提示（非阻断）：plan 只说「全局分支调用」，未说明**全局分支的 catch 兜底路径**（`:78-83` 返回 `[]`）是否也要经 `WithProjectsParent`。若实现只在 try 的成功 `return` 上包一层，DB 查询失败时父目录根会一并丢失（与「沙箱恒加根」的表述略有出入）。建议 S103-4 明写「两处返回（成功 / catch）都要经 `WithProjectsParent`」，或注明接受该降级。

### 二、⚠️-1 ~ ⚠️-8 处置情况

| ⚠️ | 项目 | 处置 | 落点 |
|---|---|---|---|
| ⚠️-1 | 配置「未配置态」语义 | **已处置（残留 1 处措辞）** | `plan.md:372` 定案「没有未配置态，`Read()` 恒返回生效路径，「恢复默认」= 删 key」；`plan.md:420` 检查点 5 已改为「不可创建时报错」；`S103-2`（`:377`）规则①标为「配置解析失败时的兜底」与定案自洽。**残留**：`plan.md:417` 检查点 2 仍写「**未配置父目录**」作为纯函数断言用例 —— 术语与「没有未配置态」不符，宜改为「父目录为空（兜底）」 |
| ⚠️-2 | 重名 / 已存在目录 | **已处置** | 新增 `S103-3d`（`plan.md:384`）：建前查同 scope 是否占用该 `workingFolder`，命中即报错并回显既有项目 id/name |
| ⚠️-3 | 渲染端读写通路 | **已处置** | `S103-5`（`plan.md:394`）写明走 `window.api.workerRequest('config/get'|'config/set', …)`、不需新开 IPC 通道，并指出 `RuntimePanel` 需引入独立异步 state |
| ⚠️-4 | `fs:select-folder` 先例 | **已处置** | `plan.md:394`（S103-5）+ 事实表 `plan.md:365`：先例订正为 `components/chat/WorkingFolderSelectorDialog.tsx:210-212` |
| ⚠️-5 | 不暴露 `id` | **已处置** | `S103-3`（`plan.md:382`）：「⚠️-5：不暴露 `id`（服务端 `CreateId()` 生成）」 |
| ⚠️-6 | 显示名 vs 目录名 | **已处置** | 新增 `S103-3e`（`plan.md:385`）：`name`=显示名（非法字符→空格、空→`New Project`）、`folderName`=目录名（→`-`），要求写进工具 description |
| ⚠️-7 | `GlobalSideOnly` 措辞（挡的是项目域，非 global 域子代理） | **仅部分处置** | raw §S-103 `:1557` 已订正措辞（「被挡的是项目作用域，global 域子代理照样可见」）；但 **plan 侧未落**：`plan.md:418` 检查点 3 仍写「在项目会话**与子代理**不可见」—— 与 ⚠️-7 结论相悖/含糊（global 域子代理 `global:cowork@subagent` 被 `*` 段命中，**可见**） |
| ⚠️-8 | `isCore` | **已处置** | `S103-3`（`plan.md:382`）：「⚠️-8：不设 `isCore`（默认 `false`，与既有 5 个项目工具一致 ⇒ 经 `use_capability` 代理触达）」 |

**小结**：8 条中 **6 条完全处置**（⚠️-2/3/4/5/6/8）、**⚠️-1 已处置但残留 1 处措辞**、**⚠️-7 仅 raw 侧订正、plan 侧未落** ⇒ **仍有 2 处残留未完全闭环**（均 ⚠️ 级）。

### 三、新发现的问题（均为 ⚠️ 级，不阻断）

1. **（承接 ⚠️-7）检查点 3 的可见性断言若不改，实施者可能写出**不可满足**的断言**（`plan.md:418`）。`GlobalSideOnly = ["global:*@*"]`（`ToolVisibilityScopes.cs:48`）role 段为 `*`，global 域子代理（`global:cowork@subagent`）**会**可见。建议把检查点 3 改为：「在**项目会话（含项目子代理 / 项目 cowork）**不可见；**global 域子代理仍可见**」。
2. **检查点 2 术语残留**（`plan.md:417`）：「未配置父目录」应改为「父目录为空（配置解析失败兜底）」。
3. **涉及文件未回填工程名**（`plan.md:412`）：「测试工程（新增断言套件）」应具名为 `tests/WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs`。
4. **全局分支 catch 路径是否也加父目录未写明**（`plan.md:390`）：见 ❌-3 复验的「轻微提示」。
5. **步骤字母序**（cosmetic）：`S103-3d` / `S103-3e` 排在 `S103-3c` 之前，编号不递增。功能无碍（无步骤互相引用、无缺失步骤、检查点与步骤一一对应），建议顺手按 `3c→3d→3e` 排列。
6. **raw 侧陈旧表述（非 plan 缺陷）**：`raw-requirements.md:1570`（§实施要点 #1）仍写「新增 worker 读写端点」，而 plan 已确认 `config/get` / `config/set` **端点已存在**（实读 `ConfigModule.cs:20-24` 确含 `config/get`(:22) / `config/set`(:23)，`ConfigStore.Get/Set/Delete` 均已实现，`Set` 传 null 时即删 key，正好支撑「恢复默认=删 key」）。以 plan 为准，raw 该句宜标注为「复用既有端点」。

### 四、复验结论

**PASS。** 三条 ❌ 均已修入 plan，且经源码/工程文件实读验证落地可行：
- ❌-1：注册点指向 `WishfulClaw.Worker/WishfulClawJsonContext.cs`（`:132-136` 模式正确、涉及文件 `:408` 已补）—— **已修**。
- ❌-2：`public static class ProjectCreationPolicy` + 断言落 `ChannelToolVisibilityRegressionTests`（IVT `:21` 在册、工程 `csproj:11` 引用 Agent）—— **已修**。
- ❌-3：新增 `PathBoundary.WithProjectsParent`、只全局分支调用、`WithDataRoot` 不动（`PathBoundary.cs` 结构与 `Program.Sandbox.cs:85-92` 既有断言均相容）—— **已修**。

**遗留（不阻断开工，建议实施前顺手改）**：⚠️-1 检查点 2 术语（`plan.md:417`）、⚠️-7 检查点 3 可见性措辞（`plan.md:418`）、涉及文件回填工程名（`:412`）、全局 catch 路径说明（`:390`）、步骤字母序。**上一轮 8 条 ⚠️ 中 6 条已完全处置，2 条（⚠️-1 / ⚠️-7）尚有残留措辞未闭环。**

**补记（2026-09-20，复验处置环节）**：上述 5 项残留**已全部闭环** —— ⚠️-1 检查点 2 术语（`plan.md:417`）、⚠️-7 检查点 3 可见性措辞（`:418`，已改为「项目作用域不可见；global 域子代理仍可见，属预期」）、涉及文件回填工程名（`:412`）、catch 路径说明（`:390`）、`S103-3c/3d/3e` 字母序，均在复验后同轮改完；记录见 `plan.md` 第四批与 `raw-requirements.md` 的「规划验证复验」节。本条上文的「仅部分处置」是**订正前的历史记录**，不再代表当前状态。

---

## 第五批（S-104）规划验证（2026-09-20）

**对象**：`plan.md` 的「## 第五批（S-104）：主窗口显示/隐藏快捷键 + 开机启动静默」。独立 subagent（只读，未改任何文件、未跑构建）。

**结论：FAIL（❌ 2 / ⚠️ 10）。**

### 一、事实核验（11 条，逐条实读）

| # | 断言 | 结论 |
|---|---|---|
| 1 | `window-handlers.ts:15-17` 的 `setLoginItemSettings` 不带 `args` | ✅ |
| 2 | `index.ts:103-104` `ready-to-show` 无条件 `show()` | ✅ |
| 3 | `index.ts:149-154` `showMainWindow()` 形状 | ✅ |
| 4 | `index.ts:177-186` 托盘只有显示、无隐藏 | ✅ |
| 5 | **`index.ts:194-201` 的 `second-instance` 已接 `showMainWindow()`** | ✅（raw 里「可能起第二个实例」的担忧**不成立**） |
| 6 | `priority-shortcuts.ts:831/:848` 签名 | ✅（`(id, accelerator, callback): boolean` / `(id): void`） |
| 7 | `clipboard:*` / `launcher:*` IPC 的形状与持久化 | ✅（**渲染端 `ShortcutConfig` 是复数 `accelerators`**，raw 猜的是单数） |
| 8 | `ShortcutsPanel.tsx` 现有结构 | ✅（**是左侧 tab 列表**，不是「两项列表」；加的是**第三个 tab**） |
| 9 | `RuntimePanel.tsx:72` 的 `launchAtLogin` 走另一条存储 | ✅（渲染端 `settings/general.json`，非主进程 JSON） |
| 10 | 主进程有 `Notification` 先例 | ✅（`misc-handlers.ts:22-36`，**文案由渲染端传**）；`displayBalloon` 零命中；`src/main` **无 i18n** |
| 11 | 现成设置存储 | ✅（两条路都满足「启动前可同步读」，先例 `settings-handlers.ts:30-36`） |

### 二、两条阻断

**❌-1 新开关 ↔ 登录项 `args` 的联动，三处语义一处都没写死**（首版 plan 的 S104-2 措辞还会把人带偏 —— 读起来像「固定塞 `['--hidden']`」）：
1. `args` 必须**由开关值决定**而非常量，否则开关形同虚设、检查点 5 直接挂；
2. 开关的**写路径必须重调** `setLoginItemSettings` —— `window-handlers.ts:16` 是**全仓唯一写点**（`git grep` 仅此一处），值不经过它进不了登录项；
3. **存量用户永不自愈**：旧装机的注册表条目没有 `args`，而新开关默认「开」⇒ 升级后照旧弹窗、开关却显示已开，除非用户手动拨一次。`app:get-login-item-settings` 只回 `openAtLogin`，**读不到 args** ⇒ 只能靠本地开关值做**启动时对账**。

**❌-2 两个新 IPC 通道未登记路由 allowlist**：`tests/ipc-msgpack-routing/program.ts` 扫描 `src/main` 全部 `register\w*MessagePackHandler`，未归类即 Group 2 断言失败。`ShortcutsPanel` 走 `window.api.invoke` ⇒ 正确归类是 `PRELOAD_BINARY_ONLY`（现有 `clipboard:get-config` / `launcher:get-config` / `app:get-login-item-settings` 都在里面），且该名单有「必须有 caller」断言 ⇒ **顺序是先接线再登记**。首版 plan 的涉及文件里没有这个测试文件。

### 三、10 条提示（施工级，均已并入 plan）

- **⚠️-1** 静默启动放大了「second-instance 早于窗口存在」的竞态（`showMainWindow()` 在 `mainWindow === null` 时静默 return，而窗口 `:585` 才建）—— 原来自会开窗所以丢了无感，**改静默后这是唯一恢复路径**
- **⚠️-2** `showMainWindow()` 只有 `show()+focus()`，会输给 Windows 前台锁；本仓已有 `forceActivateWindow()`（`priority-shortcuts.ts:870-886`，注释原文即此 race）⇒ 显示分支应复用它
- **⚠️-3** 新纯函数**不能放 `index.ts`**（模块作用域直接跑 `app.setName` / `requestSingleInstanceLock`）⇒ 照 `src/main/updater-state.ts` 那种无 Electron 依赖的单文件
- **⚠️-4** 新套件**必须写进 `package.json`**，否则 `run-tests.mjs:26-29` 筛不到它，门禁对新断言是空的
- **⚠️-5** 通知文案归属二选一（渲染端供文需新增一条「本次静默启动」的主→渲染信号；主进程硬编码则单语）
- **⚠️-6** 通知本身受系统通知设置 / 专注助手抑制，且有 green zip 分发（可能缺 AUMID 快捷方式）⇒ 检查点 2 别把「没看到通知」当「没做对」
- **⚠️-7** 默认不给加速键是**单向的**（`multi-shortcut-editor.tsx:103-108` 的 `removeShortcut` 在只剩 1 个时直接 return）⇒ 新项 `DEFAULT_CONFIG.accelerators` 必须是 `[]` 且注册处 guard 空数组，否则会被 `clipboard-enhancer.ts:102` 那种「空则回退默认」吃掉
- **⚠️-8** `index.ts` **638 行**已越 500 硬线且无豁免，plan 还要塞 4 类逻辑 ⇒ 全进新模块；动作注册留在 `index.ts`（避免 `priority-shortcuts.ts` 反向 import 主窗口形成循环依赖）
- **⚠️-9** 托盘项直接改成「切换」会让标签自相矛盾 ⇒ 用中性标签「显示/隐藏主窗口」
- **⚠️-10** `plan.md:4` 仍写「已立项 12 项：S-87 ~ S-100」的陈旧漂移

### 四、处置（2026-09-20，同轮完成）

plan 第五批节**整节重写**，并入：S104-2 的三条语义（取值规则 / 写路径重放 / 常量单源）、**新增 S104-2b 启动时对账**、**新增 S104-5b IPC 路由登记**、S104-1 改为「新模块 `src/main/main-window.ts`」、S104-1b 补 second-instance 竞态、S104-3 定通知归属、S104-4 补空数组 guard 与循环依赖规避、S104-7 补套件入 `package.json`；涉及文件补 `messagepack-channel-routing.ts` + `tests/ipc-msgpack-routing/program.ts` + 新模块与新套件；检查点补「存量对账」与通知抑制的说明；`plan.md:4` 的计数漂移一并订正为 18 项并补齐各批索引。

---

## 第五批（S-104）规划验证**复验**（2026-09-20）

**对象**：订正后的 `plan.md` 第五批节。独立 subagent（只读，未改任何文件、未跑构建）。

**结论：FAIL（原 12 条中 11 条已真闭环，2 条新发现阻断）。**

### 一、原 12 条的复验结果

| 条目 | 结论 | 关键证据 |
|---|---|---|
| ❌-1 三条语义 + 对账 | **已闭环** | `plan.md:459-465`（取值规则 / 唯一写点 `window-handlers.ts:16` / S104-2b 对账）；`git grep setLoginItemSettings` 确认全仓仅一处写入 |
| ❌-2 IPC 路由登记 | **部分闭环 → 见 N2** | 需求写到了，但**登记的落点写错文件** |
| ⚠️-1 second-instance 竞态 | 已闭环 | `plan.md:457`；实读 `index.ts:149-154` / `:199-201` / `:585` |
| ⚠️-2 复用 `forceActivateWindow` | 已闭环 | `priority-shortcuts.ts:877` 签名与 `:874` 注释均属实 |
| ⚠️-3 纯函数不放 `index.ts` | 已闭环（原则） | `index.ts:189-195` 实读确认；**但落点文件本身有问题 → N1** |
| ⚠️-4 套件写进 `package.json` | 已闭环 | `scripts/run-tests.mjs:27-30` |
| ⚠️-5 通知文案归属 | 已闭环 | `plan.md:467`；`quick-launcher.ts:796` 硬编码中文属实 |
| ⚠️-6 通知可能被抑制 | 已闭环 | `plan.md:499` |
| ⚠️-7 空数组 guard | 已闭环 | `clipboard-enhancer.ts:102` / `multi-shortcut-editor.tsx:104` 均属实 |
| ⚠️-8 500 行红线 | 已闭环 | 实读 `(Get-Content).Count` = **638 / 886 / 645 / 1018**，与 plan 逐字吻合 |
| ⚠️-9 托盘中性标签 | 已闭环 | `plan.md:507`；`index.ts:178` 现为「显示主窗口」 |
| ⚠️-10 计数漂移 | 已闭环 | `plan.md:4` 现为「已立项 18 项：S-87 ~ S-104」 |

### 二、本轮新发现（两条阻断）

**N1 —— 新套件会因 `priority-shortcuts.ts` 的模块作用域 Electron 代码而崩。** 首版 plan 把 `shouldShowOnStartup` 与 `toggle` / 通知**放进同一个** `main-window.ts`，而 `toggle` 要复用 `forceActivateWindow` ⇒ 必然顶层 `import './priority-shortcuts'`；该文件 `:55` 在**模块作用域**执行 `app.on('will-quit', …)`。套件经 esbuild 打成 CJS 后用**纯 node** 跑（`package.json` 的 `test:*` 无一带 `--external:electron`），`app` 为 `undefined` ⇒ **import 阶段即抛**。
- 先例佐证：`git grep "from '\.\./\.\./src/main"` 在 `tests/` 下只有 `updater-state`（→ `src/main/updater-state.ts`，零 Electron）与 `channel-cancel-commands`（纯函数）。**全仓没有任何套件 import 过会执行 Electron 的 `src/main` 模块。**
- 这正是 plan 自己立的规矩被自己违反。

**N2 —— `PRELOAD_BINARY_ONLY` 的文件归属是错的事实陈述。** plan 断言它在 `src/renderer/src/lib/ipc/messagepack-channel-routing.ts`。实读证伪：该文件只有 `MESSAGEPACK_INVOKE_CHANNELS` / `_SEND_` / `_EVENT_` 三张表；`PRELOAD_BINARY_ONLY` **只在 `tests/ipc-msgpack-routing/program.ts:39` 定义**（成员 `clipboard:get-config`(`:45`) / `launcher:get-config`(`:52`) / `app:get-login-item-settings`(`:40)`）。

### 三、本轮新发现（提示）

- **N3**：`src/main/main-window-registry.ts` **已存在**（`index.ts:37` 在用它）⇒ 新文件叫 `main-window.ts` 只差一个 `-registry`，极易误 import
- **N4**：本报告上一节把组件写成 `MultiShortcutEditor.tsx`；**实际是 kebab-case `multi-shortcut-editor.tsx`**（已订正）
- **N5**：第三 tab 那个开关的**端点归属**没钉死（是否并入 `main-window` 的 config 对象，还是另开）

### 四、处置（2026-09-20，同轮完成）

- **N1**：S104-1 拆成**两个文件** —— `src/main/startup-flags.ts`（`shouldShowOnStartup` + `HIDDEN_FLAG`，**零 Electron 依赖**，照 `updater-state.ts`）+ `src/main/main-window-visibility.ts`（toggle + 通知，可 import Electron）；并写明「纯函数与要用 Electron 的 toggle **必须分文件**」及其根因
- **N2**：S104-5b 与涉及文件改写为「加进 **`tests/ipc-msgpack-routing/program.ts` 的 `PRELOAD_BINARY_ONLY`（`:39`）**」，并显式标注**不是** `messagepack-channel-routing.ts`
- **N3**：两个新文件定名 `startup-flags.ts` / `main-window-visibility.ts`，不叫 `main-window.ts`
- **N4**：本报告与 plan 的组件文件名订正为 `multi-shortcut-editor.tsx`
- **N5**：S104-4b 钉死「走同一个 `main-window:get-config` / `update-config`，并入该 config 对象（`{enabled, accelerators, hideWindowOnLaunch}`），**不另开一套端点**」

---

## 第五批（S-104）规划验证**第三轮复验**（2026-09-20）

**对象**：订正后的 `plan.md` 第五批节。独立 subagent（只读，未改任何文件、未跑构建）。

**结论：PASS（N1 / N2 / N3 / N5 四条全部真闭环，无新增阻断）。**

### 一、四条目标的复验结果

| 条目 | 结论 | 关键证据（实读） |
|---|---|---|
| N1 纯函数 / Electron 拆分 | **已闭环** | plan 已拆成 `startup-flags.ts`（零 Electron）+ `main-window-visibility.ts`；可行性经实读确认 —— `updater-state.ts:1-6` 全文件无 `from 'electron'`，`tests/updater-state/program.ts:11` 正是纯 node import 先例；`priority-shortcuts.ts:1` `import { app, … } from 'electron'`、`:55` 模块作用域 `app.on('will-quit', …)` ⇒ 确不能进纯函数链 |
| N2 路由登记落点 | **已闭环** | `tests/ipc-msgpack-routing/program.ts:39` 实测有 `const PRELOAD_BINARY_ONLY = new Set([`，成员 `:40/:45/:52` 与 plan 逐条吻合；Group 3 断言在 `:180-187`；`messagepack-channel-routing.ts` 实读只有三张 `MESSAGEPACK_*` 表、无 `PRELOAD_BINARY_ONLY` ⇒ plan 的证伪属实 |
| N3 新文件命名冲突 | **已闭环** | `src/main/main-window-registry.ts` 确实存在（导出 `setMainWindow`/`getMainWindow`，`index.ts:37` 在用）；`src/main/startup-flags.ts` / `main-window-visibility.ts` 经 `Get-ChildItem` 确认**不存在**，标「新增」正确 |
| N5 开关端点归属 | **已闭环** | plan 钉死「并入同一个 `main-window:get-config` / `update-config`，不另开一套」，与 S104-4 一致，无第二条端点线 |

**抽样实读**（本批新提到的路径/符号）：`tests/startup-flags/`（不存在，正确标新增）、`priority-shortcuts.ts:877 forceActivateWindow`、`settings-handlers.ts:30 initializeLogLevelFromSettings`、`ShortcutsPanel.tsx:12 type TabId`、`multi-shortcut-editor.tsx:104` guard、行数 `index.ts=638 / priority-shortcuts.ts=886 / clipboard-enhancer.ts=645 / quick-launcher.ts=1018` —— 全部命中。

### 二、第三轮新发现（**无阻断**）

- **T-1**：`plan.md` 的 S104-5b 残留「二选一必须点明：要么…，要么进 `MESSAGEPACK_INVOKE_CHANNELS`」——与同段已钉死的唯一落点软矛盾，会把实施者带回被证伪的选项。**已处置**：删去备选，只留 `PRELOAD_BINARY_ONLY`。
- **T-2**：S104-2 称 `window-handlers.ts:16` 是「全仓唯一写点」，但本批自己会新增 ≥2 个写入点（启动对账、开关写入）⇒ 「唯一写点」在改动后应表述为「唯一入口」。**已处置**：改写为「必须收敛到一个函数 `applyLoginItem(openAtLogin, hideWindow)`，三处全走它」。
- **T-3**：`get-config` / `update-config` 的返回形状**不对称**（`clipboard-enhancer.ts:478` 的 get 返回裸 config，只有 `:508` 的 update 带 `shortcutRegistered`；launcher 同构 `quick-launcher.ts:838/:852`）⇒ 照抄时别把它塞进 get。**已处置**：在 plan 该步注明。
- **T-4**：S104-4b 的**存储**仍是 ①/② 二选一（N5 只钉了端点归属）。**已处置**：钉死 ① 主进程自有 JSON（对齐 `clipboard-config.json`），理由「启动前必须知道开关值」是硬约束、跨进程取多一跳。
---

## 第六批（S-106）规划验证（2026-09-20）

**对象**：`plan.md` 的「## 第六批（S-106）：项目档案『记忆库』补搜索」。独立 subagent（只读，未改任何文件、未跑构建/测试）。**结论：可执行，0 ❌ / 7 ⚠️。**

### 一、事实核验：19 条全部命中

| 断言 | 证据 |
|---|---|
| `ProjectMemoryLibraryTab.tsx` = **229 行** | `ReadAllLines().Count` |
| `MemoryEntriesTab.tsx` = **380 行** | 同上 |
| 项目 tab 全文件 0 处 `memorySearch` / `Input` | 全文实读；import 只有 `Button` / `memory-time-range` / `memoryEntries` / `MemoryStatusEntry` |
| 双源范式 `hits === null` | `MemoryEntriesTab.tsx:89 / :139 / :162` |
| 输入框清空回浏览 | `:232` `if (!next.trim()) setHits(null)` |
| 归一函数在 `:39-59` | `fromEntry :39-48` / `fromHit :50-59` |
| `memorySearch` 签名与参数序 | `memory-helpers.ts:72-92`；`from` / `to` 进 payload |
| `memory/search` 与 `memory/entries` **同一个 `GetScope`** | `MemoryModule.cs:25`（search）/ `:31`（entries）注册；两者分别调 `GetScope`（`MemoryModule.cs:109`、`MemoryModule.Entries.cs:83`）；唯一定义在 `MemoryModule.cs:313-348` |
| 两份 locale 的 `projectArchive.memoryLibrary` **都在 L1048** | `Select-String` 双命中 |
| `memoryPage.entries` zh **L1585** | 实读 |
| `MemorySearchResult.updatedAt` = ISO 串 | C# `MemoryModels.cs:65` `DateTimeOffset`；序列化 camelCase |
| `MemoryEntryRow.UpdatedAt` = Unix 秒 | C# `AotMemoryResultTypes.cs:38` `long`；`MemoryModule.Entries.cs:140` `GetInt64("updated_at")` |
| 「本次未改动 C# 侧」 | `memory/search` 早已带 `from` / `to`（`MemoryModule.cs:113-118` → `MemoryFtsService.cs:33-36`）且已走 `GetScope` |
| `from` / `to` 单位一致 | `memory-time-range.ts:7-8` 注释明示「Unix 秒，与 `memory/entries` / `memory/search` 同口径」 |

**无一条计划断言与实读冲突，无行号漂移。**

### 二、⚠️ 清单与处置

**⚠️-1（最重要 —— 我的判断不完整）**：计划称「本需求唯一的真陷阱」是 `updatedAt` 单位，**不成立**。`MemorySearchResult` 的 TS 声明（`memory-helpers.ts:38-46`）有 `key` / `tier`，而 **C# wire 上根本没有这两个字段**（`MemoryModels.cs:57-72` 只有 `Id / Title / Content / Scope / Priority / Status / UpdatedAt / Score`；`src/main` 与 `src/renderer/src/lib/ipc` 对 `memory/search` 无任何二次映射 ⇒ renderer 直接消费 wire 原形）。
⇒ 照抄 `fromHit`（`MemoryEntriesTab.tsx:51`、`:54`）会得到 **`hit-undefined` 重复 key**（React 警告）+ **meta 渲染成 `" · <scope>"`**（`tier` 为 undefined）。
⇒ **这是全局页的既有缺陷**（`MemoryPanel.tsx:347` 同用 `{hit.tier}`），S-106「对齐范式」会把缺陷一起继承。
**处置**：S106-2 改为「两个陷阱」；本刀新代码用 `hit.id` 作 key、`priority · status` 作 meta。全局页 / `MemoryPanel` 的同类问题**记档另开一刀**，本刀不扩范围。

**⚠️-2**：现有 `ProjectMemoryLibraryTab.tsx:88-90` 的 `useEffect(() => { void load(page) }, [load, page])` 是**无条件**的；全局那边有 `if (hits === null)` 守卫（`MemoryEntriesTab.tsx:138-140`）。漏了它 ⇒ 搜索态切页仍会发 `memory/entries` 并回写 `entries` / `total`，污染搜索视图。
**处置**：S106-1 显式写「浏览 `load` effect 仅当 `hits === null` 时执行」。

**⚠️-3**：全局范式只重置页码、**不重发检索**（`MemoryEntriesTab.tsx:185-187` 的 effect 依赖 `[hits, newestFirst, range]`，而 `handleSearch` 只由按钮 / Enter 触发）⇒ **搜索态下切时间区间，命中列表保持旧区间结果**。计划「验证检查点 4」写「切时间区间后命中跟着变」—— **浏览态成立，搜索态不成立**。
**处置**：采纳「搜索态且 range 变化时自动重跑」，加一条 effect；检查点 4 分两态写清。

**⚠️-4**：`memory/entries` 无 status 谓词（返回**全状态**），`memory/search` 默认 `includeDeprecated=false`（只查 `active` / `warm`）⇒ **冷 / 弃用条目浏览可见、搜索永远搜不到**。
**处置**：作为已知行为记档（`memorySearch` 未暴露 `include_deprecated`，要对齐需扩签名 = 新增范围，需老大裁）。

**⚠️-5**：搜索态结果排序未定（全局靠 `newestFirst` 开关在客户端排；本刀不做排序切换）。`memory/search` 返回序是「active 优先 → score」。
**处置**：钉死「沿用服务端相关度序」，不做客户端重排。

**⚠️-6**：raw 列 4 个 key，plan 列 5 个（多 `loading`）。
**处置**：注明「比 raw 多补 `loading`，与全局口径对齐」。

**⚠️-7**：页码越界回落**浏览态也缺**（`:92-93` 只做显示钳制 `currentPage`，而 `load` effect 加载的是 `page`）。全局是在 `load()` 内 `setPage(lastPage)` 回写（`MemoryEntriesTab.tsx:120-124`）。
**处置**：S106-3 点明这是浏览态既有缺口，修法照全局在 `load()` 内回写。

### 三、风险 / 不可执行项

- **无 500 行红线风险**：229 → 预计 ~330。
- **无既有测试会因本刀变红而计划漏提**：`tests/i18n-coverage/program.ts` 只校验「代码引用到的 key 在 zh **且** en 都有」，不查多余 key、不查数量 ⇒ **两个语言文件都补即 PASS，缺一即红**；全 `tests/` 只有该套件读 `locales`。无新增 IPC 通道 ⇒ `test:ipc-msgpack-routing` 不受影响。
- 实施者需新增的 import（`Input`、`Search` 图标、`memorySearch` / `MemorySearchResult`、`useMemo`）计划未写，属常识，不阻断。


