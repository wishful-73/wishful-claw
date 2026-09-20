# Plan: v2-iter-33 —— 记忆系统治理 + 压缩修复 + 工具与交互收口

> 分支 `dev/v2-iter-33`（base `main` @ `f6922f6c`，v0.2.32）。
> 需求文档（权威）：`docs/plans/iter-v2-33/raw-requirements.md`，本迭代编号接 iter-32 的 S-86 起，**已立项 12 项：S-87 ~ S-100**。
> 探索档：`docs/plans/iter-v2-33/exploration_findings.md`；规划验证：`docs/plans/iter-v2-33/compliance_report.md`。
> 本迭代节奏：需求逐步积攒，不定收口时间。
> **进度**：**S-95 已完成**（2026-09-19，见文末「已完成项」）；**S-87 ~ S-94 本 Plan 实施**；**S-96 / S-97 已完成**（2026-09-20）；**S-98 / S-99 / S-100 见「第二批」节**。

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
  - **大文件红线豁免（AGENTS.md：>500 行必须拆）**：`memory-organization.ts` 规划态实读 **580 行**（**〔收尾实测 636 行〕**，S-93 镜像块前移 +2 行）。本刀只改 catch 分支（净增 ~5 行），**不在本刀拆分** —— 拆分要重组自动化链多个模块，属独立重构，**登记待办另开一刀**（记进 raw 裁定记录；另两处超线文件已由 S-90 / S-91 顺手拆掉）
- [x] 步骤 3（口径订正）：`buildProviderPayload`（`provider-payload.ts:19`）与 `chat-store/index.ts:397-401` 的注释声称 opencode-go 靠 `provider.sessionId` / `{{sessionId}}` 模板，与实读不符 —— 一并订正，避免下次误判
  - 验证：注释与 `OpenAIChatHeaders.cs:27-32` 的实际条件一致
- [x] 步骤 4（记档，**不改**）：`ContextCompression.cs:725-730` 是同因下游（同样读 `state.SessionId`）；nightly「错过不补跑」（`memory-organization-scheduler.ts:101-107`）、`requestMaxRetries=10` / timeout 100s 导致每次失败耗 ~11 分钟 —— 均只登记
  - 验证：结论写进 raw 裁定记录

### S-90 记忆页拆成「设置 / 执行记录」两个选项卡

落点 `src/renderer/src/components/settings/MemorySettingsPanel.tsx`（单一长页，`mx-auto max-w-4xl` 容器 `:147`）：`sec-memory-organization`（`:155-317`）/ `sec-memory-tiers`（`:320-338`）/ `sec-memory-recall`（`:341-421`）/ **`sec-memory-execution-log`（`:424-478`，`max-h-64` 内滚在 `:432`）**。

- [x] 步骤 1：页内加内层 tab（`useState<'settings'|'log'>` + 顶部 tab bar）。**无共享 tab 组件**（`components/ui/` 下只有 `segmented-control.tsx`），照抄最规范的先例 **`ProviderPanel.tsx:54-107` 的 `ProviderPanelTabs`**（`role="tablist"/"tab"` + 方向键 + pill 样式）
  - 验证：`npx tsc --noEmit -p tsconfig.web.json` 零错误
- [x] 步骤 2：内容分流 —— 前三段进「设置」分页，`sec-memory-execution-log` 整段进「执行记录」分页（按 V4 无关；`:432` 的 `max-h-64` 内滚**去掉**改成整页滚动，既然已独立成页签）
  - **大文件红线拆分（AGENTS.md：>500 行必须拆）**：拆出 `src/renderer/src/components/settings/MemoryExecutionLogSection.tsx`，装 `sec-memory-execution-log` 段（`:424-478`）—— `MemorySettingsPanel.tsx` 规划态实读 **520 行**，抽出后 ≈465 行回到线内（**〔收尾实测 355 行〕**：第一刀只拆 `MemoryExecutionLogSection.tsx`（85 行）后为 521 行**未达标**，审查 ❌-2；修正刀再拆 `MemoryTierSettingsSections.tsx`（229 行）+ 补 `aria-labelledby` ⇒ **355 行**）
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
  - **大文件红线拆分**：新列表抽成 `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx` —— `ProjectArchivePage.tsx` 规划态实读 **596 行**，步骤 4 删 daily + 本次抽列表后回到线内（**〔收尾实测 377 行〕**：第一刀未拆、内联到 647 行，审查 ❌-1；修正刀拆出 `ProjectMemoryFileTab.tsx`（191 行）+ `ProjectMemoryLibraryTab.tsx`（132 行）⇒ **377 行**）
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

## 第二批（S-98 / S-99 / S-100）：记忆库真分页 + 检索分词 + 粘贴回退

> 2026-09-20 追加。老大实测反馈产生的三项，登记见 `raw-requirements.md` 的 S-98 / S-99 / S-100。
> 三项均已探索完毕（实读源码）；候选方案已在 raw 各节列出，本 Plan 按下述取值拍定。
> **规划验证（2026-09-20）首轮 FAIL（❌2 / ⚠️7）** —— S99-3 的验证口径、S100 的诊断步骤、消费方清单、`JsonContext` 的层归属均已按报告订正；报告见 `compliance_report.md` 的同名节。

### 目标

1. **S-98 记忆库真分页** —— 拆掉 S-97 留下的「200 条硬墙」（客户端分页），改服务端 `OFFSET` + 稳定排序 + 总数；
2. **S-99 检索分词** —— `memory_search` 的多关键词从「整串短语」改为「逐词 AND」；
3. **S-100 粘贴回退** —— composer 的 `Ctrl+V` 在剪贴板无 `text/plain` 时不再静默失败。

### 实施顺序与理由

| # | 需求 | 为什么排这里 | 面 |
|---|---|---|---|
| 1 | **S-99** 检索分词 | 纯 C# 单方法改动，与 S-98 的端点无耦合；且 S-98 的分页 UI 要配修好的检索才看得出效果 | C# |
| 2 | **S-100** 粘贴回退 | 纯前端单函数，独立 | TS |
| 3 | **S-98** 真分页 | 唯一同时动 Worker 端点 + 两个前端列表的，放最后一刀好回退 | C# + TS |

> **提交粒度**：S-99 + S-100 合为一刀（同批 bug 反馈、都是小改）；S-98 单独一刀。

### 步骤清单

#### S-99 检索分词（C#，`WishfulClaw.Workspace/Memory/MemoryFtsService.cs`）

- [x] **S99-1** 加 `SplitTokens(q)`：按空白拆、去空、去重（保序）。**单 token 时行为与现状逐字节一致**（含 `< MinFtsQueryLength` 走 LIKE 的既有分支）。验证：单 token 查询结果与改动前一致。
- [x] **S99-2** 多 token 且**全部 ≥ `MinFtsQueryLength`** ⇒ FTS 查询串改 `"t1" AND "t2" ...`（每 token 仍过 `BuildFtsLiteralQuery` 转义双引号）。**FTS 零命中时仍走 LIKE 回退**（`results.Count == 0` 的现有分支保持不变）—— 这是 S99-1「单 token 行为一致」成立的前提。验证：能命中「两个词都出现但不相邻」的条目。
- [x] **S99-3** 多 token 且**存在 < 3 字符的 token**（中文双字词的必经支）⇒ **跳过 FTS 直接走 LIKE**，WHERE 改逐 token 的 `(title LIKE ? OR content LIKE ?)` **AND** 连接；score 改为**对每个 token 累加** `(title 命中 2 + content 命中 1)`。
  ⚠️ **AND 语义下的断言口径（规划验证 ❌-1 订正）**：返回集**每一行都命中全部 token**，「命中词数」对候选集是常量、不是区分变量；有区分度的只有**「同一个词是命中 title 还是仅命中 content」**。验证：造两条同含「记忆」「整理」的条目 A（两词都出现在 `title`）与 B（两词只在 `content`），断言 **A 排在 B 前且 `score(A) > score(B)`**；另断言只含其中一个词的条目**不被返回**（AND 语义本身）。
- [x] **S99-4** 边界：token 数截断到 8（防 LIKE 子句与参数数膨胀）。验证：9 个词的查询正常返回、不抛异常。
- [x] **S99-5** `tests/WishfulClaw.MemoryRecallRegressionTests` 扩断言（31 → **38**，实跑 `WishfulClaw.MemoryRecallRegressionTests.exe` 打印 `passed: 38` 为准）。造 A/B 两条样本时**必须同 `status`（都用 `active`）** —— 否则 `MemoryFtsService.cs` 的 `ORDER BY` 先按 status 分层，「A 排在 B 前」会被 status 掩盖（规划验证 N-3）。验证：套件 exit=0。

#### S-100 粘贴回退（TS，`InputArea/use-composer-interactions.ts`）

- [x] **S100-0** （**实施时跳过** —— 改由 S100-1 的 HTML 回退一次性覆盖全部分支，理由与后路见 raw S-100 实施记录）【诊断，**先于修法**】在 `handlePaste` 入口加**临时**诊断（dev 模式打印 `Array.from(event.clipboardData.types)` + 每个 `text/*` 条目的长度 + 实际走了哪一支），复现一次后**立即删除**。目的：把 raw 列出的三种可能定到唯一一支 —— 否则会「修完行为零变化、却按已修交付」。验证：拿到 `types` 输出，并用它为 S100-1 定落点。
- [x] **S100-1** 新增**纯函数** `composePastedText(plain: string, html: string, htmlToText?: (html: string) => string): string`：优先 `plain`；其为空则对 `html` 调 `htmlToText`（默认实现用 `DOMParser` 提取纯文本、块级元素补换行）；皆空返回 `''`。**签名只吃字符串**（不吃 `DataTransfer`），`getData` 的取用留在 `handlePaste` 侧；第三参可注入是为了**在 node 里可测**（node 无 `DOMParser`，测试传桩 —— 规划验证 ⚠️-4 / N-1）。**并根据 S100-0 的结论决定是否追加 `items` 遍历取 `text/*`** —— 若诊断落在「有 `text/plain` 但 `getData` 返空」那一支，`text/html` 回退**不对症**，`items` 遍历才是。
  **验证（含落点 —— 规划验证 N-1）**：新建 `tests/paste-text/program.ts` + `package.json` 的 `test:paste-text`（仓范式：`esbuild --bundle --platform=node --alias:@renderer=./src/renderer/src` → `node`）。断言：无输入 → `''`；仅 `plain` → 原样；仅 `html`（注入桩）→ 走桩，返回 `stub:` 前缀结果；两者都有 → **取 `plain`、不调桩**。
- [x] **S100-2** `handlePaste` 改调该函数；**返回值仍为空时才 return**（不 `preventDefault`，放过默认行为）。`document.execCommand('insertHTML')` 与受控兜底路径**保持原样不动** —— **保留理由**：`execCommand` 在「读得到文本」的现有路径上工作正常，本需求只修「读不到文本」这一支，**不动能跑的代码**；它与换行 / 撤销组的取舍已记在源码注释 `:102-103`，不属于本刀范围（规划验证 ⚠️-7）。验证：真机粘贴（见验证态）。
- [x] **S100-3** `shouldCollapsePaste` 改吃**提取后**的文本（HTML 提出来的长度才是真实长度）。验证：粘贴长 HTML 表格能正确折叠成 chip。

#### S-98 真分页（C# + TS）

- [x] **S98-1** 【拆分】把 `MemoryModule.MemoryEntriesByStatus`（`:286-328`）与 `MemoryModule.MemoryEntries`（`:337-372`）整体搬到新文件 `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.Entries.cs`（`partial class MemoryModule`）。验证：`MemoryModule.cs` 降到 ≤ 420 行、新文件 ≤ **150** 行（S98-3 还要给它加 `offset` / `order` / `COUNT`，留余量 —— 规划验证 ⚠️-6），两 sln 编译零错（**AGENTS.md 500 行红线**）。
- [x] **S98-2** `src/runtime/WishfulClaw.Workspace/Memory/AotMemoryResultTypes.cs` 新增 `MemoryEntriesResponse(List<MemoryEntryRow> Entries, int Total)`，并注册进 `WishfulClawJsonContext`（**它位于 Worker 层**：`src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs` —— 规划验证 ⚠️-2 订正）。**不动** `MemoryEntriesByStatusResponse`（它是 `entries-by-status` 与 `entries` 共用的契约，改它会波及 tier 浏览器 —— 消费方 `MemoryPanel.tsx:68-69`）。验证：编译**零错误**（AOT 源生成下 JsonContext 漏注册是**编译错误**，不是告警）；`List<MemoryEntryRow>` 已在 `WishfulClawJsonContext.cs:88`，无需补泛型注册。
- [x] **S98-3** `MemoryEntries` 端点增 `offset`（默认 0，clamp ≥ 0）、`order`（仅 `"asc"`，其余一律 `"desc"` —— **白名单映射，不拼接用户串**）两个参数，并把 `limit` **收敛出上界**（现状 `GetInt(parameters, "limit", 200)` 无上界，clamp 到 ≤ **500** 防大页拖库 —— 规划验证 ⚠️-7；**取 500 不取 200**：`lib/agent/memory-hot-sync.ts` 的判重窗口正是 500，收更紧会静默缩小它 —— 审查 ❌-1）；SQL 改 `ORDER BY updated_at {dir}, id {dir} LIMIT @limit OFFSET @offset`（**加 `id` 破平**，兑现 S-97 承诺的稳定排序）；返回 `MemoryEntriesResponse(entries, total)`，`total` 取同 scope 的 `SELECT COUNT(*)`。验证：同一 `updated_at` 的多条跨页时 id 序稳定、不重不漏。
- [x] **S98-4** `memory-helpers.ts` 的 `memoryEntries()` 增 `offset` / `order` 两个**尾参**（默认 `0` / `'desc'`；**不动前 5 个形参的顺序**，`ProjectMemoryLibraryTab` 现有调用免改），返回类型改 `{ entries?: MemoryStatusEntry[]; total?: number }`。验证：`tsc` 三配置零错误。
- [x] **S98-5** `MemoryEntriesTab.tsx` 改服务端分页：`PAGE_SIZE=20` 作 `limit`、`(page-1)*PAGE_SIZE` 作 `offset`、`total` 驱动 `totalPages`；**删掉 `ENTRY_FETCH_LIMIT=200` 及其「硬墙」注释块**；排序开关 `newestFirst` 下推为服务端 `order`。搜索命中（`memory/search`，≤20 条）维持客户端排序不动。验证：浏览 200+ 条能翻到尾页。
- [x] **S98-6** `ProjectMemoryLibraryTab.tsx` 加同一套真分页（`PAGE_SIZE=20` + 上一页/下一页 + 「第 X / Y 页」）。验证：档案页记忆库能翻页。
- [x] **S98-7** i18n `{zh,en}/settings.json` + `{zh,en}/chat.json` 补/复用分页文案（`memoryPage.entries.pageOf` / `prevPage` / `nextPage` 已存在，档案页需新增对应键）。验证：`npm run test:i18n-coverage` PASS。

### 涉及文件

- `src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs` — S-99（分词 + 双路 AND）
- `src/runtime/WishfulClaw.Workspace/Memory/AotMemoryResultTypes.cs` — S-98（新增 `MemoryEntriesResponse`）
- `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs` — S-98（注册新 record；**实际在 Worker 层**，规划验证 ⚠️-2 订正）
- `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.cs` — S-98（**减负**，搬走两个端点）
- `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.Entries.cs` — S-98（**新建**，partial 续写）
- `src/renderer/src/stores/chat-store/memory-helpers.ts` — S-98（`memoryEntries` 增参）
- `src/renderer/src/lib/agent/memory-hot-sync.ts` — S-98（**`memoryEntries` 的第 3 个调用点**，S-93 的判重消费方；新增两个尾参有默认值使其免改，但**必须回归验证** —— 规划验证 ⚠️-1 补）
- `src/renderer/src/components/settings/MemoryEntriesTab.tsx` — S-98（服务端分页）
- `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx` — S-98（新增分页）
- `src/renderer/src/components/chat/InputArea/use-composer-interactions.ts` — S-100（html 回退）
- `src/renderer/src/locales/{zh,en}/{settings,chat}.json` — S-98（分页文案）
- `tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs` — S-99（新增断言）
- `tests/paste-text/program.ts` — S-100（**新建**：`composePastedText` 的纯函数断言 —— 规划验证 N-1 补）
- `package.json` — S-100（新增 `test:paste-text` 脚本）

### 整体验证检查点

- **C#**：`dotnet build src/runtime/WishfulClaw.sln` 与 `tests/WishfulClaw.Tests.sln` 均 **0 错 0 警**；
- **TS**：`tsc -p tsconfig.web.json` / `tsconfig.node.json` / `tsconfig.json` 三配置 **0 错**；
- **回归**：全部 `WishfulClaw.*RegressionTests` exe `exit=0`；S-99 新断言纳入 MemoryRecall 套件；`npm run test:paste-text` 通过；
- **文件红线**：所有触碰文件 ≤ 500 行（`MemoryModule.cs` 本批**降价**）；
- **真机（老大）**：① 多关键词能搜到；② 从「无 `text/plain`」的来源 `Ctrl+V` 能落字；③ 记忆库翻页能到尾页，且相邻页无重叠。
- **验证态已知限制**：S-100 要**拆成两半看** —— `composePastedText` 的纯函数逻辑由 `test:paste-text` 覆盖（归门禁）；而「`getData` 在真实剪贴板下能否读到文本」**只能真机确认**（依赖剪贴板来源），归老大手测，与 S-95 的手动压缩同类（规划验证 N-2 收窄）。

---

## 第三批（S-101 / S-102）：记忆库时间筛选 + 沙箱放行应用数据目录

> 2026-09-20 追加。老大实测 / 自查产生的两项，登记见 `raw-requirements.md` 的 S-101 / S-102。
> 两项均已探索完毕（实读源码），口径由老大一次拍齐，下方即拍定值。

### 目标

1. **S-101 记忆库按时间筛选** —— 记忆库列表与搜索都支持「全部 / 今天 / 近 7 天 / 近 30 天」，按**修改时间**；
2. **S-102 沙箱放行应用数据目录** —— 让 agent（尤其全局 PM）能读自家日志与数据文件，消掉「协议要求读日志、沙箱不让读」的矛盾。

### 实施顺序与理由

| # | 需求 | 为什么排这里 | 面 |
|---|---|---|---|
| 1 | **S-102** 沙箱放行数据根 | 纯 C# 单方法 + 文档订正，独立、风险最低；先落它，之后排查问题才有日志可读（**自己给自己开路**） | C# + docs |
| 2 | **S-101** 时间筛选 | 要动 Worker 端点 + 搜索链 + 两个前端列表，是本批唯一跨层的 | C# + TS |

> **提交粒度**：各单独一刀。

### 步骤清单

#### S-102 沙箱放行应用数据目录（C# + docs）

- [x] **S102-0** 【先读再改】读 `WishfulClawDataDir`（`Root` 的解析口径 —— 是否已含 `-dev`）与 `tests/WishfulClaw.GoalRegressionTests/Program.Sandbox.cs`（既有断言钉了哪几条根数）。**规划验证 ❌-2：不先做这步，S102-1 改完必红既有断言。**
- [x] **S102-1** `src/runtime/WishfulClaw.Agent/Tools/PathBoundary.cs` 的 `ResolveRoots`：**两个分支**（project / global）返回集合**都**追加**已有的应用数据根** —— 直接复用 `WishfulClawDataDir.Root`（**规划验证 ⚠️**：全仓已有 17 处消费方 —— `DbClient.cs:34` / `ConfigStore.cs:192` / `MemoryPathResolver.cs:17` 等，**不要再自行解析环境变量或复刻 `isPackaged`**）。验证：断言「项目会话的根含数据根」「全局会话的根含数据根」。
- [x] **S102-1b** **同步既有断言**：`tests/WishfulClaw.GoalRegressionTests/Program.Sandbox.cs:61`（项目会话根集合）与 `:65-68`（无 `workingFolder` 时的根数）按新集合更新，并**新增**「数据根在集合内」「数据根外仍拒绝」。验证：`WishfulClaw.GoalRegressionTests.exe` `exit=0`（规划验证 ❌-2）。
- [x] **S102-1c** **明示语义翻转（复验新发现 N-A，须你知情）**：现在的规则是「根集合为空 ⇒ 不拦」，而追加数据根后**集合永不为空** ⇒ 原先「一个项目都没有 ⇒ agent 随便访问」的情形，会变成「**只能访问数据根，其余一律拒绝**」。这是**有意收紧**（沙箱本就该拦），但要：① 在 `PathBoundary` 类注释里写明；② 在收尾报告里如实告知（可能影响「还没建项目时随手用」的场景）。验证：断言「无项目时根集合 = [数据根]」且「数据根外仍拒绝」。
- [x] **S102-2** 边界断言：数据根内放行、数据根外拒绝、**兄弟目录不穿透**（`.wishful-claw` 与 `.wishful-claw-dev` 不得互相放行）。规划验证已论证现有 `IsInsideAnyRoot:114-122` 的目录分隔符判定**天然挡住**，但要有断言钉住。验证：断言套件 `exit=0`。
- [x] **S102-3** **SSH 与边界情形**：SSH 项目的 `working_folder` 是远端路径（现有代码已排除），数据根是**本地绝对路径** —— 两分支都追加不影响 SSH 语义，需在代码注释里写明「数据根始终是本地的，与 SSH 无关」。另确认数据根目录**不存在**时不抛异常（`IsInsideAnyRoot` 只做字符串比较、不碰磁盘 —— 复核一次）。验证：注释 + 断言。
- [x] **S102-4** `AGENTS.md`「异常日志」节订正两处：① 日志目录有**两套**（打包版 `~/.wishful-claw/logs/`，开发版 `~/.wishful-claw-dev/logs/`，由 `src/main/lib/data-dir.ts` 的 `isPackaged` 决定）；② 说明沙箱开着时该目录**已在允许范围内**。验证：与 `data-dir.ts` 实现逐字对照。

#### S-101 记忆库时间筛选（C# + TS）

- [x] **S101-0** 【先定可测边界】规划验证 ❌-1：`MemoryEntries` / `CountScope` 是 **Worker 内 `private static`**，而**没有任何测试工程引用 Worker**（11 个套件分别引 Agent / Infrastructure / Workspace）⇒ 端点级断言根本写不出来。**修法**：把「时间区间的 SQL 条件段 + 参数」抽成一个**纯函数**，放 **Workspace 层**（`WishfulClaw.Workspace/Memory/`，与 `MemoryFtsService` 同层，这样 `MemoryRecallRegressionTests` 直接断言得到），Worker 端点与搜索链**共用同一份实现**。验证：纯函数能被测试工程引用（编译通过即证明落层正确）。
- [x] **S101-1** `MemoryModule.Entries.cs` 的 `MemoryEntries` 加 `from` / `to`（Unix 秒，可选；缺省或 `<= 0` 视为不限），WHERE 用 S101-0 的纯函数拼条件。验证：真机（端点逻辑无单测，限制见 S101-7）。
- [x] **S101-2** **`CountScope` 必须带同样条件** —— 否则「共 N 条 / 第 X 页」全错、翻页漏行（S-98 在相邻处踩过）。**必须调用 S101-0 的同一个函数**，不许另写一份。验证：纯函数单测（同输入同输出）+ 真机 total 对齐。
- [x] **S101-3** 搜索链加时间筛选：`MemoryFtsService.SearchAsync` 的 **FTS 路与 LIKE 路都要带** `updated_at` 区间。**注意**：`MemoryFtsService` 实现在 `IMemorySearch` 契约下（`src/runtime/WishfulClaw.Workspace/Memory/IMemorySearch.cs`），改签名要**同步接口**，否则编译不过。验证：`MemoryRecallRegressionTests` 断言（该套件引用了 Workspace，**这条可测**）。
- [x] **S101-4** **时区口径**：`from` / `to` 传 Unix 秒，但「今天 / 近 7 天」的**边界必须按本地日**算（本地 00:00 为当日起点），**不要**用 UTC 日 —— 否则东八区用户在早上 8 点前会看到「今天」少几小时。验证：断言本地时区下的边界值。
- [x] **S101-5** `memory-helpers.ts` 透传（`memoryEntries` + `memorySearch`）；**顺带把 `memoryEntries` 的 7 个位置参数改成 options 对象**（影响 3 个调用点：`MemoryEntriesTab` / `ProjectMemoryLibraryTab` / `memory-hot-sync.ts`）—— 此项是**我自己的取舍、非需求**，若判断影响面不值就跳过，并在实施记录里写明跳过理由。
- [x] **S101-6** `MemoryEntriesTab.tsx` + `ProjectMemoryLibraryTab.tsx` 加区间 chip（全部 / 今天 / 近 7 天 / 近 30 天）；切区间回到第 1 页。**另**：`ProjectMemoryLibraryTab` 当前**不显示 `updatedAt`**（规划验证 ⚠️）—— 不补这个，档案页筛完看不出任何变化，等于不可验证；补一行时间显示（沿用 `MemoryEntriesTab` 的 `formatTimestamp` 口径）。验证：切区间后页码回 1、行数随区间变化、每行能看到时间。
- [x] **S101-6b** i18n 补四个 chip 文案（`{zh,en}/settings.json`；档案页如需另补 `chat.json`）。验证：`npm run test:i18n-coverage` PASS。
- [x] **S101-7** 回归断言（**落点按规划验证 ❌-1 修正**）：`tests/WishfulClaw.MemoryRecallRegressionTests` 断言 **S101-0 的纯函数**（区间内 / 区间外 / 边界取等号 / 本地日边界）+ **S101-3 的搜索双路**（都在 Workspace 层，该套件引用得到）。**明确不写**：`memory/entries` 端点的「total 与实际行数一致」—— **Worker 不可达，此条归真机手测**，并写进验证态已知限制，**不要假装测过**。验证：套件 `exit=0`。

### 涉及文件

- `src/runtime/WishfulClaw.Agent/Tools/PathBoundary.cs` — S-102（数据根进允许集合）
- `WishfulClawDataDir.cs` — S-102（**复用其 `Root`，预期零改动**；若需暴露新成员才在此加）
- `AGENTS.md` — S-102（日志路径订正 + 沙箱说明）
- `src/runtime/WishfulClaw.Workspace/Memory/`（**新建**时间区间纯函数，S101-0 定名）— S-101（Worker 与搜索链共用）
- `src/runtime/WishfulClaw.Workspace/Memory/IMemorySearch.cs` — S-101（签名同步；规划验证 ⚠️ 补）
- `src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs` — S-101（两条路都带时间）
- `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.Entries.cs` — S-101（`from`/`to` + `CountScope` 共用纯函数）
- `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.cs` — S-101（若 `GetScope` 需随之调整；规划验证 ⚠️ 补）
- `src/renderer/src/stores/chat-store/memory-helpers.ts` — S-101（透传；options 化可选）
- `src/renderer/src/components/settings/MemoryEntriesTab.tsx` — S-101（区间 chip）
- `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx` — S-101（区间 chip + 补时间显示）
- `src/renderer/src/locales/{zh,en}/settings.json`（+ `chat.json`）— S-101（文案）
- `tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs` — S-101（纯函数 + 搜索双路断言）
- `tests/WishfulClaw.GoalRegressionTests/Program.Sandbox.cs` — S-102（**既有断言同步** + 新增数据根断言；规划验证 ❌-2）

### 整体验证检查点

- **C#**：`dotnet build src/runtime/WishfulClaw.sln` 与 `tests/WishfulClaw.Tests.sln` 均 **0 错 0 警**；
- **TS**：`npm run typecheck`（node + web）**0 错**；
- **回归**：全部 `WishfulClaw.*RegressionTests` exe `exit=0`（含 `GoalRegressionTests` 的沙箱断言更新、`MemoryRecallRegressionTests` 的新断言）；`test:*` 脚本全 PASS；
- **文件红线**：所有触碰文件 ≤ 500 行（`AGENTS.md` 会略长，仍远低于红线）；
- **真机（老大）**：① 记忆库切「近 7 天」条目变少，且每行显示的修改时间都落在区间内；② 搜索在区间内生效；③ 项目档案页「记忆库」也能切区间且看得到时间；④ 全局会话里让 agent 读 `~/.wishful-claw-dev/logs/<当天>.log` 能成功（改前报沙箱越界）。
- **验证态已知限制 ①**（规划验证 ❌-1）：`memory/entries` 端点的「`total` 与实际行数一致」**无自动化覆盖** —— Worker 不被任何测试工程引用，只能真机验。收尾报告**如实标注**，不得记作「已验证」。
- **验证态已知限制 ②**（规划验证 ⚠️）：S-102 的「生产实例只放行 `.wishful-claw`」需**打包版**才能真机验，开发模式只能验 dev 那支 —— 用环境变量模拟断言覆盖。
- **S-102 的代价（须明示）**：把整个数据根放进允许集合 = agent 可读写 `config.json`（含 API Key）/ `index.db`。这是老大拍板的选择（换取「排查时读得到日志与配置」），**不是遗漏** —— 收尾报告里要写清这一条。

---

## 第四批（S-103）：工作目录父目录 + 全局 PM 项目创建工具

### 目标

给全局 PM 补上唯一缺的那块能力：**创建项目**。约束是「只能在用户设定的父目录下建，且只建一级子目录」；该父目录同时作为全局会话的**额外沙箱允许根**。用户从 UI 建项目**不受任何约束**（既有路径不动）。

### 口径（老大拍板 2026-09-20）

- 父目录放行**整棵**；**不做**删除 / 修改项目工具；设置项在**设置页**；要**默认地址**
- **agent 创建 = 父目录 + 一级子目录；用户创建 = 任意位置**
- `create_project` 只有**全局 PM 自己**可见（`GlobalSideOnly`）—— 「这个全局 PM 包含渠道这些哦」

### 阶段一探索结论（2026-09-20 实读）

| 事实 | 位置 |
|---|---|
| 渠道 scope 被强制成 `global`，渲染出的上下文串是 `global:channel` | `AgentRunContextPolicy.cs:35-40` + `ToolVisibilityPolicy.RenderContext:59-79` |
| ⇒ `GlobalSideOnly = ["global:*@*"]`（mode 段通配）**已覆盖渠道**，代码无需改动 | `Core/Tools/ToolVisibilityScopes.cs:48` |
| `config/get` + `config/set` 端点**已存在** ⇒ 不新增端点 | `Worker/Modules/ConfigModule.cs:20-24` |
| 设置类模板（常量 + 静态 Read/Write + Defaults） | `Infrastructure/Storage/GlobalChannelSettings.cs` |
| 工具 schema 构造器 | `Core/Tools/ToolSchemaBuilder.cs`（`Object` / `String` / `Integer`） |
| 工具注册点（**已有 5 个工具**，缺 `create_project`） | `Agent/Tools/Providers/ProjectToolsProvider.cs:13` |
| 执行器分派（`ProjectToolNames` 集合 + switch） | `AgentRuntimeProjectExecutor.cs:16,32`；`ToolDispatchRouter.cs:441` |
| 项目创建底层（INSERT + `CreateDirectory`） | `Infrastructure/Db/DbProjectTools.cs:67`，RPC `db/projects-create` |
| 沙箱两段式（S-102 重构后） | `Agent/Tools/PathBoundary.cs` 的 `CollectProjectRoots` / `WithDataRoot` |
| 设置页落点（沙箱开关旁） | `components/settings/RuntimePanel.tsx:104-117` |
| 目录选择器 | `ipcClient.invoke('fs:select-folder', { defaultPath })` —— **带参数的正确先例是 `components/chat/WorkingFolderSelectorDialog.tsx:210-212`**（`settings/skill-panel.tsx:71` 只是不带参调用） |
| 用户创建路径（**不动**） | `stores/chat-store/project-slice.ts:81` → `db:projects:create:msgpack` |

### 步骤清单

#### S103-1 配置层（C#，`WishfulClaw.Infrastructure/Storage/`）

- [x] **S103-1** 新增 `ProjectsParentDirectory.cs`（照 `GlobalChannelSettings` 的形状）：配置键 `projectsParentDir`；`Read()` 返回**生效的绝对路径**（有设置值用设置值，否则用 `DefaultPath`）；`Write(string)`；`DefaultPath` 静态属性 = `Path.Combine(用户主目录, "WishfulClawProjects")`。**⚠️-1 定案：没有「未配置」态** —— `Read()` 恒返回一个可用路径，工具始终能用、沙箱恒加根；设置页的「恢复默认」= 删掉该 key（不是写空串），于是回到 `DefaultPath`。验证：断言默认值随主目录变化、写入后读回一致、删 key 后回到默认。
- [x] **S103-1b** 默认地址**不**用点号隐藏名、**不**放数据根内、**不**放 `~/Documents`（Windows 上会被 OneDrive 重定向）。理由写进类注释。

#### S103-2 创建策略（C#，**纯函数**，Agent 层）

- [x] **S103-2** 新增 `Agent/Tools/ProjectCreationPolicy.cs`，**`public static class`**（同 `PathBoundary` 的先例；写成 `internal` 会把断言锁死在 8 个 `InternalsVisibleTo` 工程里）：`ResolveTarget(string parentDir, string name, string? folderName)` ⇒ `(string? Path, string? Error)`。规则：① 父目录为空 ⇒ 错误（配置解析失败时的兜底）；② `folderName` 缺省由 `name` 派生（非法字符换 `-`）；③ 拒绝路径分隔符 / `..` / 盘符 / 绝对路径 / 空名；④ 结果必须是父目录的**直接子目录**。**抽成纯函数**是为了可断言 —— 执行器的方法在 Worker 里拿不到（同 S-101 `MemoryTimeFilter` 的理由）。**❌-2 定案：断言落在 `tests/WishfulClaw.ChannelToolVisibilityRegressionTests`** —— 该工程已引用 Agent 且在 IVT 名单内，而本批的可见性断言（含 `global:channel`）本来就要写在那儿，两处合并最省事。
- [x] **S103-2b** 父目录不存在时**自动创建**（`Directory.CreateDirectory`），工具结果里**回显最终绝对路径**（不静默铺树）。

#### S103-3 工具与执行（C#，Agent 层）

- [x] **S103-3** `ProjectToolsProvider` 注册 `create_project`：参数 `name`（必填）+ `folderName`（可选）+ `description`（可选）；**⚠️-5：不暴露 `id`**（服务端 `CreateId()` 生成，避免 agent 指定任意 id）；`availableModes: ["global"]`（与 `list_projects` 一致 ⇒ 渠道也拿到）；`visibleScopes: ToolVisibilityScopes.GlobalSideOnly`；**不加** `RequiresApproval`；**⚠️-8：不设 `isCore`**（默认 `false`，与既有 5 个项目工具一致 ⇒ 经 `use_capability` 代理触达，不进直接工具表）。
- [x] **S103-3b** `AgentRuntimeProjectExecutor`：`ProjectToolNames` 加 `create_project`；switch 加分支 → 读配置 → `ProjectCreationPolicy.ResolveTarget` → 失败即 `EncodeError` → 成功调 `DbProjectTools.Create`（带 `workingFolder`）→ 回显 id / name / 路径。
- [x] **S103-3c** 新结果类型（如 `CreateProjectResult`）的 record 定义放 `Agent/AotProjectResultTypes.cs`，但 **`[JsonSerializable]` 注册在 `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs`**（与既有的 `ProjectListResult` 等并列，约 `:132-136`）。**❌-1 订正**：plan 原写「漏注册是编译错误」是**错的** —— `WorkerJsonHelper.GetTypeInfo<T>()`（`Contracts/WorkerResponse.cs:104-107`）是 `(JsonTypeInfo<T>)JsonOptions.GetTypeInfo(typeof(T))!`，`!` 把 null 吞掉，取不到就是 **null** ⇒ 运行期 `ArgumentNullException`，**编译器与类型检查都不抓**，只有真机走到 `create_project` 成功分支才炸。（S-98 那次是走 `WishfulClawJsonContext.Default.XxxResponse` 属性，漏了才是编译错 —— 两条路径不同，不能外推。）
- [x] **S103-3d（⚠️-2 重名处置）** 建之前先查同 scope 下是否已有项目占用该 `workingFolder`（`projects` 表无唯一约束，`Directory.CreateDirectory` 对同名目录是幂等的 ⇒ 不处理就会出现「同名同路径两条项目」）。命中 ⇒ **返回错误并回显既有项目的 id / name**，让 agent 改用既有项目，而不是默默建第二条。同上，`folderName` 已存在为**普通目录**（非项目）时沿用该目录并在结果里说明。
- [x] **S103-3e（⚠️-6 命名关系，写进工具 description）** `name` 是**显示名**（`DbProjectTools.SanitizeProjectName` 把非法字符换**空格**、空则回落 `New Project`）；`folderName` 是**目录名**（`ProjectCreationPolicy` 把非法字符换 **`-`**）。两者不保证相等，工具描述里要说清「目录名默认由显示名派生」。

#### S103-4 沙箱（C#，Agent 层）

- [x] **S103-4** **❌-3 订正落点**：新增纯函数 `PathBoundary.WithProjectsParent(IReadOnlyList<string> roots, string? parentDir)`（parentDir 空则原样返回），**只在 `CollectProjectRoots` 的全局分支**调用它。**`WithDataRoot` 一字不动** —— 原因是 `ResolveRoots = WithDataRoot(CollectProjectRoots(parameters))` 里 `WithDataRoot` 被**项目会话与全局会话共用**，往里加父目录会把父目录泄漏进项目会话（违反本需求核心边界），还会打红 `Program.Sandbox.cs` 里断言 `WithDataRoot` 根数的既有用例（`WithDataRoot([])==1`、`==3`）。父目录解析失败 ⇒ 不加、不报错（沙箱是保护措施，不能反过来把工具打挂）。验证：断言 `WithProjectsParent` 纯函数。

#### S103-5 设置页（TS）

- [x] **S103-5** `RuntimePanel.tsx` 沙箱开关下方加「工作目录父目录」：输入框显示当前值 + 「浏览」按钮（`fs:select-folder`，`defaultPath` 传当前值；**⚠️-4 先例是 `components/chat/WorkingFolderSelectorDialog.tsx:210-212`**，那是唯一带 `{ defaultPath }` 的现成调用）+ 「恢复默认」。**⚠️-3 通路**：渲染端走 `window.api.workerRequest('config/get' | 'config/set', …)`（端点已存在，**不需新开 IPC 通道**）；`config/*` 在渲染端**没有先例**，但 `window.api.workerRequest` 是通用桥。注意 `RuntimePanel` 现在是同步读 `useSettingsStore`，本项要引入**独立异步 state**（首屏 fetch + 保存态）。
- [x] **S103-5b** **过宽路径 warning**：值为盘符根（`D:\`）或用户主目录本身时显示警告 —— 那是「整棵父目录对全局 PM 全开」的直接后果，用户该知情。
- [x] **S103-5c** i18n `{zh,en}/settings.json` 补 `general.projectsParent.*`。验证：`npm run test:i18n-coverage` PASS。

### 涉及文件

**新增**
- `src/runtime/WishfulClaw.Infrastructure/Storage/ProjectsParentDirectory.cs`
- `src/runtime/WishfulClaw.Agent/Tools/ProjectCreationPolicy.cs`

**修改**
- `src/runtime/WishfulClaw.Agent/Tools/Providers/ProjectToolsProvider.cs`（注册 `create_project`）
- `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs`（分派 + 创建分支）
- `src/runtime/WishfulClaw.Agent/AotProjectResultTypes.cs`（新结果类型的 record 定义）
- `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs`（**`[JsonSerializable]` 注册点** —— ❌-1）
- `src/runtime/WishfulClaw.Agent/Tools/PathBoundary.cs`（全局分支追加父目录）
- `src/renderer/src/components/settings/RuntimePanel.tsx`（父目录设置）
- `src/renderer/src/locales/{zh,en}/settings.json`
- `tests/WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs`（**断言落点**：`ProjectCreationPolicy` 纯函数 + `create_project` 可见性，含 `global:channel`）

### 整体验证检查点

1. 两 sln 0 错 0 警；11 个 C# 套件 `exit=0`；`npm run typecheck` 0 错；全部 `test:*` 通过
2. **纯函数断言**：父目录解析失败 / 一级子目录 / `..` 越界 / 绝对路径 / 名称派生，全部覆盖
3. **可见性断言**：`create_project` 在 `global:*`（**含 `global:channel`**）可见、在**项目作用域**（`project:cowork`）不可见；global 域子代理因 role 段是 `*` **仍可见**，属预期（仍受父目录约束）
4. **沙箱断言**：`WithProjectsParent(roots, parentDir)` 纯函数 —— 有父目录则追加、空则原样返回；且 `WithDataRoot` 保持既有行为（`Program.Sandbox.cs` 的既有断言不红）
5. **真机手测（老大侧）**：设置页设父目录 → 全局 PM 让 agent 建项目 → 落在 `父目录/名称`；改过父目录后再建 → 落在新位置；父目录指向不可创建的路径时报错（**注意 ⚠️-1 定案后没有「未配置」态，此项改为「不可创建时」**）；用户走 UI 建项目不受影响

---

## 已完成项

### S-95 压缩「越压越多」（2026-09-19 完成）

滚动摘要（口径 A：结果只留一条新摘要，旧摘要全部进 fold 被吸收；失败路径保守保留）。commit `022111c0`（需求一刀）+ `0c354cb9`（审查与验证修复调整）。
- 验收：拿真实畸形会话（53 条摘要 / 128 条 wire）跑分区逻辑 → `head` 摘要 0、`kept` 摘要 0、`fold` 摘要 53，成功路径结果摘要 = **1**；估算 token **343,515 → 18,427**
- 详情：`compliance_report.md`（首轮 FAIL → 复验 PASS）、`review_report.md`、`verification_report.md`
- **遗留**：真机手动压缩那一步待实机确认

### S-103 工作目录父目录 + 全局 PM 项目创建工具（2026-09-20 实施，待审查/验证）

`create_project` 只给全局侧（含渠道），路径由服务端拼成 `父目录/一级子目录`；父目录同时是全局会话的额外沙箱根（**只在全局分支追加**）。配置存 C# 侧 `config.json` 的 `projectsParentDir`，默认 `~/WishfulClawProjects`，没有「未配置」态。门禁全绿（两 sln 0/0、11 套件 exit=0、typecheck 0、34/34 `test:*`）。详见下方第四批 S-103 节的「实施记录」。

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
