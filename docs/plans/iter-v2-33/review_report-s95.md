# S-95 代码审查报告（review report）

- 被审提交：022111c0
- 审查者：独立 subagent（code-reviewer）
- 日期：2026-09-19
- 结论：**PASS**（❌ 0 条，⚠️ 5 条）

审查为独立复核：只读代码与文档，未改任何实现；`SummaryRollingChecks` 由 `Program.cs` 挂载后实测通过（父套件退出码 0）。

## 一、审查项结论

| # | 审查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 需求符合度（滚动摘要 / 双路径 / 输入含全部旧摘要 / 小 user 保留 / 改动面） | ⚠️ | 成功路径结果 = `head + 小 user + 新摘要 + tail`（`ContextCompression.cs:174-221`），旧摘要一律进 fold（`:137`、`:421`）；失败路径经 `summarizerFailed && IsCompactionSummary` 保守保留旧摘要（`:190`）；首条 user + 小 user 保留（`PinnedPrefixLen :340-347`、`IsSmallUserTurn :397-400`）。改动面 = A + C + D，E/F/G 未动（TS 与 `InjectTransientPrefix` 零改动，cap 语义未动）。**唯一缺口见 ⚠️-1**（tail 内的旧摘要仍会被原样带出）。 |
| 2 | 边界正确性（失败回带 / 遍历范围 / head 变小的影响 / 极端输入） | ✅ | 结果遍历 `for i=head; i<start`（`:187`）与 `region = [head, start)`（`:133`）逐位同构，无重复回带（单趟循环、OR 短路）；`summarizerFailed=true` 只额外放行 `IsCompactionSummary`（`:190`）不会带回其它消息。`head` 变小仅使 `start-head` 变大，`PlanCompaction` 的 `start-head<min` 早退更不易触发（`:317`）、`TailStart` 以预算为准（`:374-381`）；`start<head` 兜底仍在（`:316`）。空摘要 / 全摘要输入均走到 `fold.Count==0` 早退或正常折叠（`:139-144`）。 |
| 3 | 判据统计改 token（作用域 / 重算 / errorDriven / 语义回归） | ✅ | 自动：`originalTokens/newTokens` 取自 `conversation`/`newConversation`（`AgentLoop.ContextCompression.cs:109-110`），截断后重算（`:122`）；errorDriven 截断兜底条件仍为 `newTokens >= originalTokens && (errorDriven || SummarizerFailed)`（`:115`），语义未被削弱。手动同口径（`AgentRuntimeContextCompressionTools.cs:168-169`、`:190`）。正常 compressed 路径不会误判 skipped（`EstimateMessagesTokens` 为纯函数、两侧同口径）。**口径粗糙见 ⚠️-5**。 |
| 4 | 水位重置（`ResetCompactionWatermark` 与 6 处调用点 / 锁与并发） | ⚠️ | 新增 `ResetCompactionWatermark`（`SessionConversation.cs:57-63`）持 `_lock` 赋值；成功路径 2 处用 Reset（`AgentLoop.ContextCompression.cs:172`、`AgentRuntimeContextCompressionTools.cs:252`），restore 3 处与自动 skipped 1 处仍 Mark（`SessionConversation.cs:43-49` 语义不变）。自洽：Reset 仅在真压缩后调用。**手动 skipped 未回退水位，见 ⚠️-2**。 |
| 5 | 错误处理（异常 / 空集合 / TruncateMessages 降级链） | ✅ | 手动两处 `catch`（OCE / 通用）与自动 `catch` 段完整（`AgentRuntimeContextCompressionTools.cs:268-286`、`AgentLoop.ContextCompression.cs:199-227`）；机械截断降级链保留（`:117-118`、`:186-187`）；`TruncateMessages` 对 `total<=head+tail` 原样返回（`ContextCompression.cs:249-250`）。 |
| 6 | 分层与规范（层 / 硬编码 / AOT / 行数 / 命名注释） | ⚠️ | 只动 Agent 层；无硬编码路径 / 密钥；AOT 合规（无反射、无匿名类型序列化，测试用 `JsonDocument`，实现用 `WorkerJsonHelper`）；注释英文、与原文件风格一致，`internal` 提升由 `InternalsVisibleTo` 支撑（`WishfulClaw.Agent.csproj:19`）。**行数见 ⚠️-4**。 |
| 7 | 测试质量（能否锁回归 / 挂载 / internal 合理性） | ⚠️ | `SummaryRollingChecks.cs:38-76` 真能锁住分区两条规则（回退任一即失败）；`Program.cs:23-24` 正确挂载于子进程派发前；`internal` 提升合理且必要。**结果构造未被覆盖，见 ⚠️-3**。 |
| 8 | 契约一致 | ✅ | `compression-contract.md:43-48`（§二）与 `:66`（§三）两处修订注与代码行为一致：pinned prefix 只含 system + 首条 user（`PinnedPrefixLen :332-349`）、成功态单摘要、失败态保留旧摘要、判据改 token。字段与顺序未动。 |

## 二、发现的问题

### ❌ 阻断项

无。

### ⚠️ 建议项

**⚠️-1（需求语义，中）** 「稳态 1 条摘要」非严格成立：结果里位于 `tail` 内的旧摘要会被无条件原样带出，成功路径下结果可能含 2 条（新摘要 + tail 里那条），而契约 / Plan 的绝对表述是「正常态只有一条」。
- 证据：`ContextCompression.cs:187-196`（region 幸存者）+ `:217-221`（tail 无条件追加）；`PlanCompaction :300-318` 与 `TailStart :368-389` 对摘要无感知，摘要落入 `>= start` 即被带走。Plan 步骤 3 ① 已把此情形列为「由 tail 原样带出」的受认边界，故非功能性缺陷，且总数有界（tail 预算 `DefaultTailTokens=16384` 封顶），不会回到 53 条的无界膨胀。
- 建议：① 若要字面满足「1 条」，让 `TailStart` 在遇到 `IsCompactionSummary` 消息时停止回退（把摘要当作 tail 边界），保证上一轮摘要恒落入 fold 区；② 或在与 Plan / 契约同批收口时把「正常态 ≤ 1 条（tail 携带时可为 2）」写明，并补一条断言（见 ⚠️-3）。

**⚠️-2（水位，低-中）** 手动链路「跑了但没缩小」的 skipped 未推进水位，与 Plan 步骤组二步骤 2「统一 mark 推大水位」的表述不符。
- 证据：`AgentRuntimeContextCompressionTools.cs:171-202` 两个 skipped 分支均只返回、不 mark；对照自动链路 `AgentLoop.ContextCompression.cs:133` 的 skipped 分支会 `MarkCompactionWatermark`。
- 影响：手动压缩被跳过（例如冷启恢复的产物）后，水位仍为 0 / 旧值，auto 门控（`AgentLoop.cs:282-284`）会在下一轮再次放行，重复空烧一次摘要调用，直到有新消息。非阻断（手动路径本身不查水位）。
- 建议：在 `:171-180` 与 `:193-202` 的返回前补 `sessionConv?.MarkCompactionWatermark(originalCount)`（或仅 `!outcome.Compacted` 分支补），使自动门控同步收敛。

**⚠️-3（测试质量，中）** 新增断言未覆盖「结果构造」双路径，Plan 收尾步骤 2 的断言 ①（结果里摘要条数 == 1）与 ③（失败路径旧摘要条数不变）缺位。
- 证据：`SummaryRollingChecks.cs:22-79` 仅调用 `PartitionFold` 与 `PinnedPrefixLen`，未调用 `CompactAsync`；`Program.cs:24` 挂载正确但内容止于分区规则。
- 影响：把结果循环（`ContextCompression.cs:187-196`）整体回退成旧的 `kept` 口径，或删掉 `summarizerFailed && IsCompactionSummary` 守卫，本套件仍全绿 —— 即真正的「输出长什么样」这一步没有被锁住。
- 建议：用现有 `{"type":"nonexistent-provider","contextLength":200000}` 触发 `SummarizeAsync` 抛错（`ContextCompression.cs:472`）走 `summarizerFailed=true` 失败路径，断言结果旧摘要条数不变；成功路径可把结果构造抽为 `internal` 纯函数（`BuildCompactedResult(head, start, summarizerFailed, ...)`）后直接断言摘要数 == 1。

**⚠️-4（规范，低）** `SessionConversation.cs` 由 490 行增至 504 行，越过仓库 200~500 行红线（本刀推过界）。
- 证据：`git show 022111c0^:.../SessionConversation.cs` = 490 行，现状 504 行（`:57-63` 新增方法 + 注释）；规则见 `docs/dev-workflow.md:271` 与 `docs/iteration-plan.md:255`。`ContextCompression.cs` 816 → 834 行属既存越线（非本次引入）。
- 建议：压缩 `ResetCompactionWatermark` 的 XML 注释，或把 `SessionConversation` 的 `RepairToolPairing` 家族（`:269-417`，约 150 行）拆到 `partial` 文件，使主文件回落 500 内。

**⚠️-5（判据口径，低）** 成功判据复用的 `EstimateTextTokens` 对 ASCII 实质等于「字符数」（`Math.Max((len+3)/4, len)`，`ContextCompression.TokenEstimation.cs:45-51`），即判据实为字符量代理，与真实 token 口径偏差约 4 倍。
- 证据：`ContextCompression.cs:143`、`AgentLoop.ContextCompression.cs:109-110`。两侧同口径且压缩确实降字符，故不构成误判回归；但「token 判据」名义下实为字符判据，且与环上 provider 真实 `usage.contextTokens` 不同源（这正是待单开的 E）。
- 建议：本刀可不动（Plan V1 已定 E 不并入），但建议在 `compression-contract.md:66` 的注里点明「token 估算实为字符代理」，避免后续误读为真实 token。

**⚠️-6（文档，低）** `docs/plans/iter-v2-33/plan.md` 的 S-95 步骤清单全部仍为 `- [ ]` 未勾选，与本 commit 宣称「已实现」矛盾。
- 证据：`plan.md` 步骤组一 / 二 / 三与收尾共 14 处 `- [ ]`。
- 建议：收尾时按实际勾选（含未做项 V3 锁死兜底标注不做）。

## 三、审查结论

被审提交 `022111c0` 忠实实现了 S-95 的口径 A（吸收式滚动摘要）：`PinnedPrefixLen` 不再 pin 历史摘要（`ContextCompression.cs:327-350`）、`PartitionFold` 让全部摘要进 fold 并补短摘要守卫（`:408-432`）、结果按 `summarizerFailed` 双路径构造（`:186-196`）、判据改 token（自动 + 手动同口径）、水位成功后 Reset。构建零错误零警告，`SummaryRollingChecks` 9 条断言实测全绿，整套回归父套件退出码 0。改动严格限于 Plan 授权的 A + C + D，E/F/G 未越界，分层 / AOT / 命名合规。

未发现阻断项。5 条 ⚠️ 中，⚠️-1（tail 携带旧摘要使「稳态 1 条」不绝对）与 ⚠️-3（结果构造缺断言）建议在收口前处理或显式记档；其余为低风险文档 / 规范项。

**结论：PASS（0 ❌），可进入验证态。**
