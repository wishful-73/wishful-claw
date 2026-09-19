# S-95 验证报告（verification report）

- 验证对象：commit `022111c0` + 后续未提交修正（`ContextCompression.cs` / `AgentRuntimeContextCompressionTools.cs` / `SummaryRollingChecks.cs` / `plan.md`）
- 验证者：独立 subagent
- 日期：2026-09-19
- 结论：**PASS**（编译 / 回归 / 真实畸形数据三项全部达标；真机 UI 交互未验证，见第五节）

## 一、编译验证

| 目标 | 命令 | 退出码 | 结果 |
|---|---|---|---|
| C# 主方案 | `dotnet build src/runtime/WishfulClaw.sln` | 0 | 已成功生成，**0 警告 0 错误** |
| C# 测试方案 | `dotnet build tests/WishfulClaw.Tests.sln` | 0 | 已成功生成，**0 警告 0 错误** |
| TS web | `npx tsc --noEmit -p tsconfig.web.json` | 0 | 无输出（零错误） |
| TS node | `npx tsc --noEmit -p tsconfig.node.json` | 0 | 无输出（零错误） |
| TS root | `npx tsc --noEmit -p tsconfig.json` | 0 | 无输出（零错误） |

（三个 TS 配置均**带 `-p`** 执行；SDK 为 `dotnet-sdk` 11.0.100-preview.7 预览版，仅 `NETSDK1057` 预览提示消息，非警告。）

## 二、回归套件

逐个运行 `tests/WishfulClaw.*RegressionTests/bin/Debug/net11.0/*.exe`（共 10 个），全部退出码 0：

| 套件 | 退出码 | 最后一行输出 |
|---|---|---|
| AgentTimelineRegressionTests | 0 | ALL PASS (25 assertions) |
| ChannelShellApprovalRegressionTests | 0 | Channel shell approval regression checks passed (72 assertions). |
| ChannelToolVisibilityRegressionTests | 0 | Channel tool visibility regression checks passed (98 assertions). |
| CompactionSnapshotRegressionTests | 0 | Compaction snapshot regression parent checks passed: 2 |
| CronRegressionTests | 0 | Cron regression parent checks passed: 42 |
| GoalRegressionTests | 0 | Goal regression tests passed: 313 |
| MemoryRecallRegressionTests | 0 | Memory recall regression checks passed: 18 |
| ProviderHeaderRegressionTests | 0 | Provider header regression checks passed. |
| SessionTaskCascadeRegressionTests | 0 | Session task cascade regression passed: 225 |
| ToolConcurrencyRegressionTests | 0 | Tool concurrency regression checks passed. |

**`Summary rolling checks` 专项确认**：`WishfulClaw.CompactionSnapshotRegressionTests.exe` 全量输出中，`Summary rolling checks passed: 13` 出现（父进程 + `--suite` 子进程各一次），**13 条断言全绿**，逐条为：

1. only the small user turn is kept verbatim
2. the kept message is the small user turn
3. everything else folds
4. a SHORT prior summary folds (it must not leak into kept)
5. a long prior summary folds
6. no prior summary survives in kept
7. head stops after system + first user; prior summaries are NOT pinned
8. all 53 prior summaries fold in a single pass
9. none of the 53 summaries is kept
10. a foldable region compacts
11. an unusable provider degrades to the mechanical digest
12. failure path keeps both prior summaries plus the mechanical digest
13. failure path keeps the small user turn verbatim

（第 10–13 条即失败路径断言，见第四节。父套件另一行 `Compaction snapshot regression parent checks passed: 2` 是原有父/子模式断言，最终 `EXIT=0`。）

## 三、真实畸形数据验证（关键证据）

从开发库 `C:\Users\龚翼\.wishful-claw\index.db`（206 MB）读取会话 `lOzL9w1ou1FUddATk2XEq` 的**最新** `session_compaction_snapshots` 行（`trigger=auto`，`wire_conversation` 364,956 字符），用 `JsonSerializer.Deserialize<List<JsonElement>>` → `AgentLoop.ReadConversation` 反序列化为 `List<AgentRuntimeChatMessage>`（128 条），再调用真实代码路径 `ContextCompression.PinnedPrefixLen` / `PartitionFold`（`internal`，经 `InternalsVisibleTo` 访问；`PlanCompaction` 为 `private`，用反射取得同一分区口径 `head/start/ok`）。`provider = {"type":"nonexistent-provider","contextLength":200000}`。

| 断言 | 实测 | 期望 | 判定 |
|---|---|---|---|
| ① 原 wire 摘要条数 / 字符 | **53 条 / 324,876 字符** | — | — |
| ① 其余内容字符 | **5,652**（摘要占 98.29%，与 raw §670 表的 324,874 / 5,652 吻合，差 2 字符为 tag 计数口径） | — | — |
| ② `head` 内摘要数 | **0** | 0（不再 pin 旧摘要） | ✅ |
| ③ `kept` 内摘要数 | **0** | 0 | ✅ |
| ④ `fold` 内摘要数 | **53** | == 摘要总数 53 | ✅ |
| （tail 内摘要数） | **0** | 0（`TailStart` 遇摘要停） | ✅ |
| 分区恒等式 | head+kept+fold+tail = **53** | == 总数 | ✅ |
| 成功路径结果摘要数 | **1**（= head 0 + kept 0 + 新摘要 1 + tail 0）| 1 | ✅ |
| 失败路径结果摘要数 | **54**（53 旧摘要 + 1 机械摘要） | 旧摘要全留 + 1 | ✅ |

分区明细：`head=1 start=126 ok=True`，region=125 条；`kept=72`（全是小 user 消息），`fold=53`（全为旧摘要，本会话可折区几乎只剩摘要）。

**估算 token 前后对比**（`EstimateMessagesTokens`，同一粗估口径）：

| 阶段 | 估算 token |
|---|---|
| before（完整 wire 128 条） | **343,515** |
| after 结构（head + kept + tail，不含摘要） | **18,427** |
| after + 代理新摘要（用最长旧摘要 9,167 字符代占） | **27,598** |

⇒ **53 条摘要一轮折完，成功路径结果摘要数收敛为 1，估算 token 从 34.4 万降到 2~3 万量级**，与 plan/raw 的「收敛到 ≈2~3 万 token」预期一致。这正是「一次性折掉 52 条、自愈」的直接证据。

会话侧参数（`sessions` 表）：`context_cap_tokens=200000`、`compression_threshold=0`（跟随全局 0.8）、`model_id` 该行读为 NULL；该会话 `session_compaction_snapshots` 累计 **53 行**。cap 语义未改，产物落到 14.4 万触发线以下。

> 说明：上表 ①②③④⑤ 均为对真实 53 条畸形 wire 的直接断言，非构造数据。临时验证程序放在 `.wishful-claw/notes/s95verify/`，**验证后已整目录删除，git 工作树无残留**。

## 四、失败路径

- **持久断言**：`SummaryRollingChecks` 第 10–13 条覆盖 —— 摘要器不可用（`nonexistent-provider`）时 `CompactAsync` 走 `MechanicalFoldDigest`，`Compacted=true` / `SummarizerFailed=true`，结果保留 **2 条**旧摘要 **+ 1 条**机械摘要 = 3 条，并保留小 user 原话。全绿（见第二节）。
- **真实数据模拟**：对上述 53 条畸形 wire 按失败口径推演，结果摘要数 = 53（旧摘要全留）+ 1（机械摘要）= **54**，即失败时一条旧摘要都不删 —— 与口径「失败路径保守保留旧摘要 + 用户原话」一致。

## 五、未验证项与原因

- **真机交互验证（启动应用 + 点击手动压缩）**：**未验证**。原因：本验证环境为纯命令行 / 无头环境，手动压缩入口需要 Electron 渲染层的人为用户点击交互，且需要一个可用的真实 provider 才能跑通摘要 LLM 调用，本环境不具备。因此「点一次手动压缩后 UI 环上数字、聊天窗压缩卡片」的端到端观感**未做实测**；这一项建议由老大在真机上按 plan「步骤组一步骤 6」复跑（会话 `lOzL9w1ou1FUddATk2XEq` 点手动压缩，确认 wire 摘要 53 → 1、`new_count` 下降、真实 `usage.contextTokens` 落到 2~3 万）。
- 其余项（编译 / 10 套回归 / 真实畸形数据分区与 token / 失败路径）均**已实测并有工具证据**。

## 六、验证结论

**PASS。** 依据：

1. C# 两个 sln 与 TS 三配置**零错误**（C# 0 警告 0 错误，TS 无输出）。
2. 10 个回归套件**全部退出码 0**，新增 `Summary rolling checks` **13 条断言全绿**。
3. 真实 53 条畸形 wire：`head=0` 摘要、`kept=0` 摘要、`fold=53` 摘要（== 总数）、tail 0 摘要，**成功路径结果摘要数 = 1**，估算 token **343,515 → 18,427（含代理新摘要 27,598）**，与「摘要前的消息全部滚蛋 / 稳态 1 条」口径完全一致。
4. 失败路径保守：真实数据模拟保留 53 条旧摘要 + 1 条机械摘要，不丢历史。

唯一保留项是真机 UI 交互（第五节，环境不具备），不影响对本刀逻辑正确性的判定。
