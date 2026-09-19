# Plan: v2-iter-33 —— 记忆系统治理 + 压缩修复 + 工具与交互收口

> 分支 `dev/v2-iter-33`（base `main` @ `f6922f6c`，v0.2.32）。
> 需求文档（权威）：`docs/plans/iter-v2-33/raw-requirements.md`，本迭代编号接 iter-32 的 S-86 起，**已立项 9 项：S-87 ~ S-95**。
> 探索档：`docs/plans/iter-v2-33/exploration_findings.md`；规划验证：`docs/plans/iter-v2-33/compliance_report.md`。
> 本迭代节奏：需求逐步积攒，不定收口时间。
> **进度**：**S-95 已完成**（2026-09-19，见文末「已完成项」）；**S-87 ~ S-94 本 Plan 实施**。

## 目标

三块：
1. **记忆系统治理**（S-89 / S-90 / S-91 / S-92 / S-93 / S-94）—— 修掉整理链的 400 与可诊断性、把呈现对齐真实存储、修召回 query 污染与中文检索失效；
2. **工具正确性**（S-88）—— Grep 的通配符静默失配（会让 agent 得出「全仓没有」的错误结论）；
3. **能力放开**（S-87）—— cron 四项能力对全局会话开放。

## 实施顺序与理由

| # | 需求 | 为什么排这里 | 面 |
|---|---|---|---|
| 1 | **S-88** Grep 通配符失配 | 最小、独立、纯函数修复；且它**影响后续所有排查**（我自己就被它坑过） | C# |
| 2 | **S-92** 召回 query 剥块 | 独立小改，但它是 S-93 / S-94 的**前置口径**（召回链先修对，再谈频率与检索质量） | C# |
| 3 | **S-94** 中文短词检索 | 与 S-92 同链、病根不同；S-92 落地后才能观察真实召回率 | C# |
| 4 | **S-87** cron 放开 | 独立；改动小但涉及权限面，单独一刀好回退 | C# |
| 5 | **S-89** 整理链 400 | 记忆治理的**总根因**（整理是唯一「热记忆 → DB」通道，断了别的都白搭） | TS |
| 6 | **S-90** 记忆页拆 tab | 纯 UI，独立；先做它是因为 S-91 也要动记忆相关界面 | TS UI |
| 7 | **S-91** 档案页记忆库 | 依赖 S-90 定的页面结构习惯 + Worker 新端点 | TS + C# |
| 8 | **S-93** 自动链写 DB | 最大、风险最高（动写入链 + 去重），放最后一段完整时间 | TS |

## 待用户裁定项（进执行前确认）

| # | 项 | 本文档暂取值 | 出处 |
|---|---|---|---|
| **V1** | **S-87 执行记录怎么给** | 暂取 **新增只读工具 `CronRuns`**（`jobId?` + `limit?`），不扩 `CronList` 的 schema —— 职责清晰、不破坏现有工具契约 | raw S-87 §92 |
| **V2** | **S-87 创建/修改是否保留审批** | 暂取 **保留**（现状 `RequiresApproval` 对 Add/Create/Update 返回 true，不动） | raw S-87 §93 |
| **V3** | **S-89 合成 sessionId 的口径** | 暂取 **一个统一常量**（如 `wishful-claw-sidecar`），对齐 C# 先例 `ProviderTestService.ConnectionTestSessionId = "wishful-claw-connection-test"`；**不按用途分**（上游只要非空即可，见勘测结论） | raw S-89 §264 + 勘测 |
| **V4** | **S-91 记忆库只读还是可写** | 暂取 **只读**（首版不加写路径，编辑仍走右侧面板） | raw S-91 §423 |
| **V5** | **S-93 两条链怎么合** | 暂取 **倾向 A = 自动链也写 DB**（召回只认一个源）；**但勘测发现两个硬缺口必须先解**：① 自动化拿不到 `workingFolder`（不补就会全落 `global`）；② `memory_entries` **无唯一索引**，重复沉淀会产生重复行 | raw S-93 §563 + 勘测 |
| **V6** | **S-94 修法范围** | 暂取 **① + ②**（短查询跳过 FTS 直接 LIKE；给 LIKE 结果补轻量排序）；**③「LIKE 提升为并行通道」不做**（更大改动，留观） | raw S-94 §618 |
| **V7** | S-92 缺陷二（召回频率） | 维持 raw 的**暂不定案**（等缺陷一落地看几天真实召回率） | raw S-92 §502 |
| **V8** | **S-92 第三条待裁定：是否把「召回」开放成 agent 可显式调用的工具** | 暂取 **本刀不做，记档**（目前只有自动召回一条路；等 S-92 缺陷一/二的效果观察完再定） | raw S-92 §524 |

## 步骤清单

### S-88 Grep 工具的 `file_pattern` 通配符静默失配

落点 `src/runtime/WishfulClaw.Agent/Tools/SearchTools/GrepTool.cs`。根因已钉死：`MatchesFileName`（`:397-425`）对 `*.ts*` 走 `StartsWith("*.")` 分支，`pattern[1..]` 取出字面量 `".ts*"` 去 `EndsWith`，一个文件都匹配不上。

- [x] 步骤 1：`MatchesFileName` 改**真 glob** —— 把 `*` / `?` 翻译成正则匹配（锚定整名、`OrdinalIgnoreCase`）；`*.cs` 这类单星后缀形式可保留为快路径，但**必须先判定模式里除开头 `*.` 之外不含其它通配符**才敢走
  - 验证：`dotnet build src/runtime/WishfulClaw.sln` 零错误；新增断言（步骤 3）
- [x] 步骤 2：**可诊断性** —— 零命中时区分「目录里真的没有」与「模式把文件全筛掉了」：在 `EnumerateSearchableFiles`（`:343-393`）统计「遍历到的文件总数」与「通过 `file_pattern` 筛选的数目」，当后者为 0 而前者 > 0 时，返回可诊断提示（含 `file_pattern` 与实际文件数），不再塌成一句 `No matches found.`（`:263-269`）
  - 验证：编译零错误；手动用 `*.ts*` 在 `src` 下搜 `cron:fire`，应真实命中
- [x] 步骤 3：新增回归套件 `tests/WishfulClaw.GrepPatternRegressionTests`（照 `tests/WishfulClaw.MemoryRecallRegressionTests` 骨架：`OutputType=Exe` + `net11.0` + `ProjectReference` 到 `WishfulClaw.Agent` 的 csproj + `internal static class Program` 断言范式），把 `MatchesFileName` 由 `private static` 改 `internal static`
  - **四处落地动作缺一即不编译/不生效**（验证报告已核实）：① 新建 `tests/WishfulClaw.GrepPatternRegressionTests/WishfulClaw.GrepPatternRegressionTests.csproj`；② 新建同目录 `Program.cs`；③ `src/runtime/WishfulClaw.Agent/WishfulClaw.Agent.csproj`（`InternalsVisibleTo` 现 `:17-24` 六条）追加 `WishfulClaw.GrepPatternRegressionTests`；④ `tests/WishfulClaw.Tests.sln` 追加 Project 项（新 GUID）**并**补齐 12 行 `ProjectConfigurationPlatforms`。**不需要**改 `src/runtime/WishfulClaw.sln`
  - 断言覆盖：`*.cs` / `*.ts` / `*.tsx` 正常；**`*.ts*` 必须同时匹配 `.ts` 与 `.tsx`**；`*.c*` / `*.t?s` 正常；`Foo.cs` 精确名正常；零筛选提示的判定函数
  - 验证：套件退出码 0
- [x] 步骤 4：同族复核（只读，不改）—— `SearchFilter.IsExcluded`（`:353`）的默认排除名单；`GlobTool.cs` 是否共用同类逻辑（**勘测已确认：GlobTool 不共用 `MatchesFileName`**，仅登记结论）
  - 验证：把结论写进本文件或 commit message

### S-92 召回链：查询被注入块吃掉

落点 `src/runtime/WishfulClaw.Agent/AgentLoop.MemoryRecall.cs:33-36`（`conversation.Where(Role=="user").Select(Text).LastOrDefault()`）。污染源 = `AgentLoop.cs:247` 的 `InjectTransientPrefix` 先于 `:333-335` 的召回执行，user 消息里已带 `<memory-update>` / `<current_time>` 块 ⇒ `ExtractVariants`（`MemoryRecallQueryRefiner.cs:41`，`maxVariants=4`）的 4 个名额被块标签与日期占满。

- [x] 步骤 1：新增**纯函数** `StripInjectedBlocks(string)` —— 剥掉 `<memory-recall>…</memory-recall>` / `<memory-update>…</memory-update>` / `<current_time>…</current_time>`（含前后残留空行）。**全仓无现成剥块辅助**（已 grep 确认），需新写；落点 `src/runtime/WishfulClaw.Agent/AgentLoop.MemoryRecall.cs`（同链 partial，Agent 层；块的构造方也在 Agent 层）
  - 验证：编译零错误；断言覆盖三种块 + 组合 + 无块透传
- [x] 步骤 2：`AgentLoop.MemoryRecall.cs:33-36` 取到 `userMessage` 后先 `StripInjectedBlocks` 再进 refiner
  - **纪律**：只剥**喂给检索的 query**，**不碰 conversation 原文**（原文里剥掉会破坏 `InjectTransientPrefix` 的 `Contains("<current_time>")` 重复注入守卫，也会动 prefix cache）
  - 验证：编译零错误；断言（步骤 3）
- [x] 步骤 3：回归断言 —— 在 `tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs` 新增 suite：给一条「已注入块」的 userMessage，断言送到检索的 query **不含任何块标签**、且**含用户关键词**
  - 验证：套件退出码 0
- [x] 步骤 4（**记档，不与本刀合**）：① `state.PendingMemoryRecall` 是死变量（`AgentLoop.Helpers.cs:315-319` 消费点永远早于 `AgentLoop.MemoryRecall.cs:96` 设置点）；②「只召回一次」（缺陷二）按 V7 暂不定案；③ raw §524 第三条待裁定「是否把召回开放成 agent 可显式调用的工具」按 **V8 本刀不做**
  - 验证：三条结论均写进 raw 的裁定记录

### S-94 中文双字词检索失效（trigram 下限 3 字符）

落点 `src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs`。`tokenize='trigram'` 对 < 3 字符的查询必然零命中；LIKE 只在 FTS 零命中时兜底（`:85`），且 `RowToResult(..., hasScore: false)`（`:107-127`）让 `PassesThreshold`（`MemoryRecallService.cs:199-205`）对 `Score is null` 直接放行 ⇒ 无排序、无阈值。

- [x] 步骤 1：`SearchAsync` 顶部（`:41-42`）判定 `q.Length < 3`（UTF-16 char 计，CJK 每字 1 char）⇒ **跳过 FTS 直接走 LIKE**，不做无用的 FTS 尝试
  - 验证：编译零错误；断言：2 字词命中数 == LIKE 命中数
- [x] 步骤 2：**LIKE 结果补轻量排序** —— 给 LIKE 行填合成 score（标题命中 > 内容命中；再按命中次数；`updated_at` 作 tie-break），让 `PassesThreshold` 与结果排序有意义，而不是恒 `hasScore: false` 全放行
  - 验证：编译零错误；断言：标题命中排在纯内容命中之前
- [x] 步骤 3：回归断言 —— `tests/WishfulClaw.MemoryRecallRegressionTests` 新增 suite（按现有范式 `DbClient.Initialize(tempDb)` 造数据）：① < 3 字符走 LIKE 且有序；② 3+ 字符仍走 FTS（现有 `RunFtsLiteralQuerySuite` 不能回退）
  - 验证：套件退出码 0

### S-87 cron 四项能力对全局会话开放

落点 `src/runtime/WishfulClaw.Agent/Tools/Providers/CronToolProvider.cs`（六个工具各一处 `visibleScopes: ToolVisibilityScopes.WorkRunsOnly`，`:36/43/56/63/70/77`）。全局会话的上下文串是 `global:chat`，而 `WorkRunsOnly = ["*:cowork@*"]` ⇒ 模式段对不上。

- [x] 步骤 1：六处 `WorkRunsOnly` → **`ToolVisibilityScopes.GlobalSideAndWorkRuns`**（= `["global:*@*", "*:cowork@*"]`，memory 那批工具用的就是它）。`*:cowork@*` 那半腿保证项目协作会话现有能力不回退
  - **渠道会话会被一并放开 —— 已确认属预期**（老大：「渠道就是特殊的全局对话」），不是副作用
  - 验证：编译零错误；断言：`global:chat` 可见、`project:cowork` 仍可见、`project:chat` 不可见
  - **断言落点（验证报告要求写明）**：写进 `tests/WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs` —— 断言 **cron 类别工具在 `global:chat` / `global:channel` 下经 `use_capability` 代理可达、在 `project:chat` 下不可达**。注意：既有可见性断言只查 **`direct` 集（`scope ∧ IsCore`）**，而 cron 工具**非 `IsCore`**（`CronToolProvider` 未传 `isCore`，默认 `false`）⇒ 放宽后只进代理、**不进 `direct`**
  - **金样声明**：`VisibilitySnapshotDump` 的 `visibility-snapshot.expected.txt` **不受影响、无需重生成**（该文件无 `Cron*` 行）—— 实施时**不要**因为改了可见性就去盲改金样
- [x] 步骤 2：执行记录（按 V1）—— 新增只读工具 **`CronRuns`**：参数 `jobId?`（缺省列全部）+ `limit?`（默认 20）；在 `CronToolProvider` 注册（`visibleScopes` 同上，`Category` 仍 `"cron"`）
  - **执行侧（写死，唯一路径）—— 不复用 `DbCronRunTools.List`**（`src/runtime/WishfulClaw.Infrastructure/Db/DbCronRunTools.cs:115`，**不是 `:168`，`:168` 是 SQL 拼接行**）：`List` 在只读名义下**先做写操作** —— `UPDATE cron_runs SET status='aborted' … WHERE status='running'`（`:148-162`），**仅当 `parameters.activeRunIds` 非空时才加 `NOT IN` 排除**。而该集合是**渲染端内存态**（`src/renderer/src/lib/tools/cron-runtime.ts:27` 的 `activeRunIds` Set，`:41` 的 `getActiveRunIds()`；`AutomationPage.tsx:52-60` 正是这么用的），**Main 与 Agent 都拿不到**（Main 侧 `cronRunLock` 以 `jobId` 为键、不含 runId，`cron-execution-coordinator.ts:6-38`）⇒ 直调 `List` 会把**正在跑的运行误标 aborted**，随后 `Finish`（要求 `status='running'`）不再命中，该次运行状态/摘要永久丢失
  - **做法**：在 `DbCronRunTools` 新增**纯只读**方法 `ListReadOnly(JsonElement parameters)`（只 `SELECT * FROM cron_runs` + `cron_id`/`session_id`/`limit` 过滤，**不做 orphan 归一化写**），由 `CronRuns` 直调（先例：`Goal/GoalOrchestrator*.cs` 直调 `DbGoal*Tools`，同 Worker 进程内 `DbClient.GetClient(parameters)` 可用）；**工具参数 `jobId` → 底层 `cronId` 显式映射**（`List` 的过滤键是 `cronId`，`:121`/`:166`）
  - **工具分派**：`ToolDispatchRouter.cs:329` 的 `AgentRuntimeCronExecutor.IsCronTool` 分支**不覆盖** `CronRuns`（`CronToolNames` 六项不动）—— 在 `ToolDispatchRouter` 另加一条直连分支（不经 reverse、不经 `AgentRuntimeCronExecutor` 的 op 映射），错误文案对齐既有 `"… tool execution failed: {ex}"` 范式
  - **已知取舍（写进 commit message）**：`CronRuns` 不做 orphan 归一化 ⇒ 崩溃/退出残留的 `running` 行会原样列出（界面侧 `AutomationPage` 传 `activeRunIds` 仍正确显示 aborted）；**读时不写库是有意为之**，清理职责仍归 `db/cron-runs-list`
  - **不启用的既有预留**：`channels.ts:218` 的 `CRON_RUNS: 'cron:runs'` 常量与 `messagepack-channel-routing.ts:221` 的登记**无 handler**，本刀不接线
  - 验证：编译零错误；断言：能列出 `cron_runs` 行、`jobId` 过滤生效；**断言 `List`（原方法）行为未变**（`CronRuns` 不得调用它）
- [x] 步骤 3：附带记档（**不改**）—— `ToolVisibilityScopes.WorkRunsOnly` 的注释写着「availableModes already refused them a chat」，对 cron 不成立（其 `availableModes` 含 `"global"`），真正挡住它的是 `visibleScopes`
  - 验证：结论写进 raw 或 commit message
- [x] 步骤 4：（按 V2）`AgentRuntimeCronExecutor.RequiresApproval`（`:36`）**保持不动**
  - 验证：`git diff` 确认该文件只有步骤 2 的接线改动

### S-89 记忆整理持续失败（sidecar 请求缺 sessionId）

**勘测修正了需求原文的口径**：opencode-go（`stores/providers/opencode-go.ts:407-418`）**没有任何 `requestOverrides`**，其 `x-opencode-session` 头走的是 C# 硬编码块，读的是**顶层 `sessionId` → `state.SessionId`**（`OpenAIChatHeaders.cs:27-32` + `OpenAIChatProvider.cs:59`），**不是 `provider.sessionId`**。⇒ 只补 `provider.sessionId`（原文候选 A）对本例**无效**，必须让 sidecar 请求带上顶层 `sessionId`。

落点 `src/renderer/src/lib/ipc/agent-bridge-streaming.ts:254-274`（`runSidecarTextRequest` 调 `buildSidecarAgentRunRequest` 时**没传 `sessionId`**；后者签名本来就有该参数，`sidecar-mapping.ts:204` + `:306`）。

- [x] 步骤 1（主修）：`runSidecarTextRequest` 加 `sessionId?: string` 形参并透传给 `buildSidecarAgentRunRequest`；**缺省时用合成常量**（按 V3）
  - 一处修，**4 个调用点同时受益**：`memory-automation-utils.ts:409`（stage1 抽取）、`memory-automation-internal.ts:192` / `:217`（整理 pass）、`lib/api/generate-title.ts:245`（**会话标题生成也在静默失败**）
  - 验证：`npx tsc --noEmit -p tsconfig.web.json` + `-p tsconfig.node.json` 零错误
- [x] 步骤 2（可诊断性）：`memory-organization.ts:329-335` —— catch 里把真实错误写进 `result.error`（字段**已存在**，`memory-organization.ts:51`），别再塌成 `llm_unavailable`；`scopeLabel` + 真实错误进 report
  - 验证：TS 编译零错误；真机触发一次整理，日志/界面能看到 HTTP 状态与 provider
  - **大文件红线豁免（AGENTS.md：>500 行必须拆）**：`memory-organization.ts` 实读 **580 行**。本刀只改 catch 分支（净增 ~5 行），**不在本刀拆分** —— 拆分要重组自动化链多个模块，属独立重构，**登记待办另开一刀**（记进 raw 裁定记录；另两处超线文件已由 S-90 / S-91 顺手拆掉）
- [x] 步骤 3（口径订正）：`buildProviderPayload`（`provider-payload.ts:19`）与 `chat-store/index.ts:397-401` 的注释声称 opencode-go 靠 `provider.sessionId` / `{{sessionId}}` 模板，与实读不符 —— 一并订正，避免下次误判
  - 验证：注释与 `OpenAIChatHeaders.cs:27-32` 的实际条件一致
- [x] 步骤 4（记档，**不改**）：`ContextCompression.cs:725-730` 是同因下游（同样读 `state.SessionId`）；nightly「错过不补跑」（`memory-organization-scheduler.ts:101-107`）、`requestMaxRetries=10` / timeout 100s 导致每次失败耗 ~11 分钟 —— 均只登记
  - 验证：结论写进 raw 裁定记录

### S-90 记忆页拆成「设置 / 执行记录」两个选项卡

落点 `src/renderer/src/components/settings/MemorySettingsPanel.tsx`（单一长页，`mx-auto max-w-4xl` 容器 `:147`）：`sec-memory-organization`（`:155-317`）/ `sec-memory-tiers`（`:320-338`）/ `sec-memory-recall`（`:341-421`）/ **`sec-memory-execution-log`（`:424-478`，`max-h-64` 内滚在 `:432`）**。

- [x] 步骤 1：页内加内层 tab（`useState<'settings'|'log'>` + 顶部 tab bar）。**无共享 tab 组件**（`components/ui/` 下只有 `segmented-control.tsx`），照抄最规范的先例 **`ProviderPanel.tsx:54-107` 的 `ProviderPanelTabs`**（`role="tablist"/"tab"` + 方向键 + pill 样式）
  - 验证：`npx tsc --noEmit -p tsconfig.web.json` 零错误
- [x] 步骤 2：内容分流 —— 前三段进「设置」分页，`sec-memory-execution-log` 整段进「执行记录」分页（按 V4 无关；`:432` 的 `max-h-64` 内滚**去掉**改成整页滚动，既然已独立成页签）
  - **大文件红线拆分（AGENTS.md：>500 行必须拆）**：拆出 `src/renderer/src/components/settings/MemoryExecutionLogSection.tsx`，装 `sec-memory-execution-log` 段（`:424-478`）—— `MemorySettingsPanel.tsx` 实读 **520 行**，抽出后 ≈465 行回到线内
  - 验证：tsc 零错误；真机两页签可切换、执行记录完整可见；`MemorySettingsPanel.tsx` 行数 < 500
- [x] 步骤 3：`SettingsPage.tsx:214` 的 `SectionAnchorNav` —— 内层 tab 切到「执行记录」时隐藏锚点导航（`MEMORY_ANCHORS`（`:53-57`）只覆盖设置三段）
  - 验证：tsc 零错误；真机确认锚点在两个页签下的显隐正确
- [x] 步骤 4：locale —— `src/renderer/src/locales/{zh,en}/settings.json` 的 `memoryPage` 下加 `tabs.setting` / `tabs.executionLog`（对齐 `usage.tabs.*` 命名先例）
  - 验证：两语言 key 齐全（`i18n-coverage` 套件跑通）

### S-91 记忆呈现割裂：档案页 daily tab → 记忆库

**裁定（老大选 A）**：档案页 `daily` tab 改造成「记忆库」，列**本项目 scope** 的 `memory_entries`；右侧面板 `MemoryPanel` 退回「全局检索 + 统计 + 整理控制台」（保持不变）。

**勘测修正/补充（与 raw 不同，以此为准）**：
- ⚠️ `memory/entries-by-status` **空 status 直接返回空列表**（`MemoryModule.cs:288-289`），**拿不到不过滤的全量** ⇒ 必须新增 `memory/entries` 变体（不能靠传空 status）；响应类型可复用 `MemoryEntryRow` / `MemoryEntriesByStatusResponse`（`WishfulClawJsonContext.cs:87-89` 已注册，**无需改 JSON 源生成**）
- ⚠️ `memory-files.ts` 的 daily 三函数（`:108` / `:133` / `:160`）**消费方是 `memory-snapshot.ts:145-148`，不是档案页** ⇒ **本项不动它们**（raw 里「消费方只有档案页、统一成本低」的判断不成立）
- ⚠️ **SSH 项目的 scope 是 `project:ssh:{projectId|sshConnectionId}`**（`MemoryModule.GetScope:368-371`），与本地 `project:{workingFolder}` 不同；档案页在 SSH 项目下 `workingFolder` 为 `undefined` ⇒ 构造 scope 必须按是否 SSH 分支，否则会落到 `global`

- [x] 步骤 1：Worker 新增 `memory/entries` —— `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.cs` 新增 handler（SQL 抄 `:305-309` 去掉 `statusClause`，`ORDER BY updated_at DESC LIMIT @limit`）+ 在 `:30` 旁 `context.Register("memory/entries", …)`
  - 验证：`dotnet build src/runtime/WishfulClaw.sln` 零错误；断言：本项目 scope 下能取到全部条目（不分 status）
- [x] 步骤 2：渲染端入口 —— `src/renderer/src/stores/chat-store/memory-helpers.ts` 新增 `memoryEntries(scope, workingFolder?, limit?, projectId?, sshConnectionId?)`（照 `memoryEntriesByStatus` 的签名形状）
  - 验证：tsc 零错误
- [x] 步骤 3：`daily` tab → **记忆库** —— `ProjectArchivePage.tsx` 的 `MEMORY_TABS`（`:44-48`）把 `daily` 换成 `database`（图标 `Database`、文案「记忆库」/「Memory Library」）；列表渲染本项目条目，首版**只读**
  - **scope 构造（照上文「勘测修正」第 3 条）**：**不要渲染端自拼 `project:ssh:{…}`**，而是照 `memoryEntriesByStatus` 既有范式（`memory-helpers.ts:219-235`）传 `scope='project'` + `projectId` / `workingFolder` / `sshConnectionId`，由 Worker `GetScope`（`MemoryModule.cs:358-393`）解析 —— 少一处易错分支
  - **大文件红线拆分**：新列表抽成 `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx` —— `ProjectArchivePage.tsx` 实读 **596 行**，步骤 4 删 daily + 本次抽列表后回到线内
  - 验证：tsc 零错误；真机打开档案页 → 记忆库，能看到本项目条目（**本地项目与 SSH 项目各测一次**，确认 scope 不误落 `global`）
- [x] 步骤 4：清理 daily 残留 —— `ProjectArchivePage.tsx` 的 `dailyFile` state（`:68-76`）、`dailyPath`（`:102-105`）、`loadDailyFile`（`:148-177`）、`handleSave` / `handleReset` / `handleReload` 的 daily 分支（`:257` / `:260` / `:283-289` / `:298-299`）、编辑区分支（`:510-516`）、tab 判定（`:450`）、dormant 注释（`:252` / `:591`）；`project-archive-helpers.ts` 的 `DEFAULT_DAILY_TEMPLATE`（`:56-60`）与 `ArchiveTabId`（`:6`）
  - 验证：tsc 零错误；全仓 grep `DEFAULT_DAILY_TEMPLATE` / `loadDailyFile` 无残留引用
- [x] 步骤 5：locale —— `locales/{zh,en}/chat.json:1044` 的 `projectArchive.tabs.daily` 改文案（或换 key）；`:1046` 的 `tabs.dormant`（**孤儿 key，全仓仅这两行**）删掉
  - 验证：`i18n-coverage` 套件跑通
- [x] 步骤 6（**不做，记档**）：`TopicsCount` / `DailyCount` 两个恒 0 死字段；`memory-files.ts` 的三处路径不一致（与档案页 daily 解耦后仍在，但消费方是快照链，另开）

### S-93 自动沉淀的记忆进不了召回检索源

**现状（实读）**：`memory_entries` 全仓只有两个写入方 —— RPC `memory/append`（`MemoryModule.cs:140`）与 agent 工具 `memory_append`（`MemoryAppendTool.cs:105`）；渲染端 `memoryAppend()` 只有一处调用（`memory-organization.ts:259`）。**自动链走文件**（`rollout → stage1 → raw_memories.md → phase2 → MEMORY.md`），不写 DB ⇒ 召回（只读 `memory_entries`）看不到自动沉淀的记忆。

**勘测发现的两个硬缺口（必须与主修同刀解决）**：
- ⚠️ 自动化只有 `MemoryRootDescriptor{id, scope, rootPath, projectId, sshConnectionId}`（`shared/memory-automation-types.ts:74-80`）—— **没有 `workingFolder`** ⇒ 不补就只能写进 `global`，与目标 scope（`project:D:\claw\wishful-claw`）不符
- ⚠️ `memory_entries` 建表（`DbClient.cs:275-284`）**无唯一索引、无去重列** ⇒ 自动链每轮都会重复沉淀同一批内容，必须先做插入前去重

- [x] 步骤 1：给自动化链补 `workingFolder`（从 `OrganizationTarget`（`memory-organization.ts:100`，**不是 `:105`——`:105` 是 `sshConnectionId?` 字段**）透传到 `runPhase2ForRoot`，或写进 `MemoryRootDescriptor`）
  - ⚠️ **订正（开工前复核，2026-09-19）**：`runPhase2ForRoot` 实测**零调用方**（死代码），本步骤**不做**；`OrganizationTarget` 本就带 `workingFolder`（`:124`），`sinkOutdatedParagraphs`（`:283`）与 `runDbDemotion`（`:430`）都已在用。落点整体改到活的凌晨梳理 `organizeScope` —— 详见 `raw-requirements.md` S-93 节「开工前复核」与「实施记录」。
  - 验证：tsc 零错误；断言/日志确认 phase2 拿到的 scope 字符串是 `project:{workingFolder}`
- [x] 步骤 2（主修）：`memory-automation-internal.ts` 的 `runPhase2ForRoot` 内、写文件之后（约 `:319`，`consolidation?.writtenItems` 在 `:333` 可用）调 `memoryAppend(...)` 把本轮沉淀写进 DB
  - ⚠️ **订正（2026-09-19，老大裁定口径 A）**：落点改为 `memory-organization.ts` 的 `organizeScope`（`:323-408`）—— 在 `sinkOutdatedParagraphs` 之后、写回 `MEMORY.md` 之前，调用新模块 `src/renderer/src/lib/agent/memory-hot-sync.ts` 的 `mirrorHotParagraphsToDb`，把**现役** MEMORY.md 段落镜像进 DB。镜像失败**不中止**整理（`syncedToDb` / `dbSyncError` 单独记，`MemoryExecutionLogSection` 已能显示失败原因）。
  - 写入通道：`memoryAppend(scope, content, priority, workingFolder?, {projectId?, sshConnectionId?, title?})`（`memory-helpers.ts:116-132`）
  - 验证：tsc 零错误；真机跑一次整理，`memory_entries` 该 scope 行数增加
- [x] 步骤 3（去重，硬要求）：插入前按「同 scope + 内容归一化后包含判断」去重；**不**改 `memory_entries` 的表结构（加唯一索引=迁移，风险另算）
  - **取「同 scope 已有条目」写死**：用 **S-91 步骤 2 新建的渲染端入口 `memoryEntries(scope, …)`**（`memory-helpers.ts`）；**不用** `memoryEntriesByStatus`（其 `status` 必填、且空 status 返回空列表，拿不到全量）
  - **比对口径**：字符串包含判断的现成范式是 `memory-organization.ts:178-187` 的 `paragraphStillPresent`，但它只是**文本包含**、不等于能取到 DB 现有行 —— 两者配合：先 `memoryEntries` 取回，再按归一化文本做包含判断
  - **依赖面确认**：`memory-automation-internal.ts` 引入渲染端 helper 后不得引入环；若 `runPhase2ForRoot` 所在模块不适合直接 import，改由调用方注入回调
  - 验证：连续跑两次整理，行数不翻倍
- [x] 步骤 4（记档）：S-93 落地后 S-89 的 400 才是真瓶颈（整理是唯一「热记忆 → DB」通道）—— 两项需一起看效果

### 收尾：门禁、断言与提交

- [x] 步骤 1：每项需求测通即 commit 一刀（`fix(...)` / `feat(...)`），规划/审查/验证文档并入所属需求的提交
- [x] 步骤 2：全量门禁 —— C# `dotnet build src/runtime/WishfulClaw.sln` + `tests/WishfulClaw.Tests.sln` 零错误；TS **三配置**（`tsconfig.web.json` / `tsconfig.node.json` / `tsconfig.json`）全零错误；`tests/` 下全部回归套件跑通
- [x] 步骤 3：**不 push** 直到本 Plan 覆盖的需求全部完成并通过验证（然后一次性 push）

## 已完成项

### S-95 压缩「越压越多」（2026-09-19 完成）

滚动摘要（口径 A：结果只留一条新摘要，旧摘要全部进 fold 被吸收；失败路径保守保留）。commit `022111c0`（需求一刀）+ `0c354cb9`（审查与验证修复调整）。
- 验收：拿真实畸形会话（53 条摘要 / 128 条 wire）跑分区逻辑 → `head` 摘要 0、`kept` 摘要 0、`fold` 摘要 53，成功路径结果摘要 = **1**；估算 token **343,515 → 18,427**
- 详情：`compliance_report.md`（首轮 FAIL → 复验 PASS）、`review_report.md`、`verification_report.md`
- **遗留**：真机手动压缩那一步待实机确认

## 涉及文件（S-87 ~ S-94）

- `src/runtime/WishfulClaw.Agent/Tools/SearchTools/GrepTool.cs` — S-88（匹配 + 可诊断性）
- `src/runtime/WishfulClaw.Agent/WishfulClaw.Agent.csproj` — S-88（`InternalsVisibleTo` 追加新套件）
- `src/runtime/WishfulClaw.Agent/AgentLoop.MemoryRecall.cs` — S-92（`StripInjectedBlocks` 新写 + query 剥块）
- `src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs` — S-94（短查询路由 + LIKE 排序）
- `src/runtime/WishfulClaw.Workspace/Memory/MemoryRecallService.cs` — S-94（阈值/合并）
- `src/runtime/WishfulClaw.Agent/Tools/Providers/CronToolProvider.cs` — S-87（可见性 + 注册新工具）
- `src/runtime/WishfulClaw.Infrastructure/Db/DbCronRunTools.cs` — S-87（**新增 `ListReadOnly`**；不动 `List`）
- `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs` — S-87（`CronRuns` 直连分支）
- `src/runtime/WishfulClaw.Agent/AgentRuntimeCronExecutor.cs` — S-87（**不改**；`CronRuns` 不走 reverse）
- `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.cs` — S-91（新端点 `memory/entries`）
- `src/renderer/src/lib/ipc/agent-bridge-streaming.ts` — S-89（sessionId 传递）
- `src/renderer/src/lib/agent/memory-organization.ts` — S-89（可诊断性）
- `src/renderer/src/lib/api/provider-payload.ts` + `src/renderer/src/stores/chat-store/index.ts` — S-89（注释订正）
- `src/renderer/src/lib/agent/memory-automation-internal.ts` — S-93（写 DB）
- `src/renderer/src/components/settings/MemorySettingsPanel.tsx` + `SettingsPage.tsx` — S-90（内层 tab）
- `src/renderer/src/components/settings/MemoryExecutionLogSection.tsx` — S-90（**新建**，拆出执行记录段）
- `src/renderer/src/components/chat/ProjectArchivePage.tsx` + `project-archive-helpers.ts` — S-91（记忆库）
- `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx` — S-91（**新建**，拆出记忆库列表）
- `src/renderer/src/stores/chat-store/memory-helpers.ts` — S-91 / S-93（入口）
- `src/renderer/src/locales/{zh,en}/{settings,chat}.json` — S-90 / S-91（文案）
- `tests/WishfulClaw.GrepPatternRegressionTests/` — S-88（新建）
- `tests/WishfulClaw.Tests.sln` — S-88（注册新测试工程）
- `tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs` — S-92 / S-94（新增断言）
- `tests/WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs` — S-87（cron 类别可见性断言）

## 参考源码

- 本次**无外部源码搬运**；语义基准是 `docs/plans/iter-v2-33/raw-requirements.md` 的 S-87 ~ S-94 各节（含 2026-09-19 实读的勘测行号）。
- 勘测纠正了 raw 的三处判断，**以本 Plan 为准**：① S-89 的 opencode-go 头走顶层 `sessionId`（不是 `provider.sessionId`）；② S-91 的 `memory/entries-by-status` 空 status 返回空（必须新端点）；③ S-91 的 `memory-files.ts` daily 消费方是快照链（不是档案页，不能顺手删）。
