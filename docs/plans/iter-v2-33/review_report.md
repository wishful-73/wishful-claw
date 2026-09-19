# iter-v2-33（S-87 ~ S-94）代码审查报告

- 被审提交：`dc1a3e75`(S-88) / `42232cbf`(S-92) / `7f7d3990`(S-94) / `48e0d05f`(S-87) / `102fe81a`(S-89) / `84dee523`(S-90) / `146b1fb2`(S-91) / `3e5d2aa9`(S-93)
- base：`main` @ `f6922f6c`；分支 `dev/v2-iter-33`；范围合计 42 文件 / +3536 −512
- 审查者：独立 subagent（code-reviewer），**只读审查，未改任何实现代码**
- 审查方式：逐个 `git show <sha>` 读 diff + 实读 HEAD 文件取证（行号均为 HEAD 物理行号；`GrepTool.cs` 为既存「隔行空行」格式，行号随之翻倍，已按物理行给）
- 日期：2026-09-19

## 一、VERDICT

**FAIL**（❌ 2 条，⚠️ 11 条）

两条 ❌ 均属「AGENTS.md 硬规则：文件超过 500 行必须拆分」未达成，且**本迭代自己的文档（commit message / raw-requirements / plan）声称已达成**——即事实与结论不符。功能实现层面未发现阻断项：8 项需求的口径全部落地，且相对 `raw-requirements.md` 的口径逐项核对一致（见第五节）。若把这 2 条判为既存债（两者在 base 上都已 >500）而降级为 ⚠️，则本次审查结论为 PASS。

## 二、逐审查项结论表

| # | 审查项 | 结论 | 证据（文件:行号） |
|---|---|---|---|
| 1 | 分层约定（Contracts / Core / Infrastructure / Workspace / Worker / Agent / Renderer） | ✅ | 依赖方向全部自上而下，无逆向引用：新 `DbCronRunTools.ListReadOnly` 在 Infrastructure（`src/runtime/WishfulClaw.Infrastructure/Db/DbCronRunTools.cs:182-217`），调用方 `AgentRuntimeCronRunReader`（`src/runtime/WishfulClaw.Agent/AgentRuntimeCronRunReader.cs:29`）在 Agent 层——与先例 `Goal/GoalOrchestrator*.cs` 直调 `DbGoal*Tools` 同形；`MemoryFtsService`（Workspace）改动不外溢；`MemoryModule.MemoryEntries`（Worker）只做 SQL + 响应装配，未把业务逻辑搬进 Worker；渲染端新模块 `memory-hot-sync.ts` 经 `memory-helpers` 走 RPC（`src/renderer/src/lib/agent/memory-hot-sync.ts:8`），未直接碰 Worker。无跨层反向依赖 |
| 2 | 硬编码路径 / 密钥 | ✅ | 新增代码内无绝对路径、无密钥、无凭据字面量。唯一新增常量是 `SIDECAR_TEXT_REQUEST_SESSION_ID = 'wishful-claw-sidecar-text'`（`src/renderer/src/lib/ipc/agent-bridge-streaming.ts:263`），语义为「上游需非空且稳定」的合成会话标识，非密钥。DB 路径统一走 `DbClient.ResolveDbPath`（`src/runtime/WishfulClaw.Infrastructure/Db/DbClient.cs:23-35`） |
| 3 | 需求口径符合度（逐项对照 raw-requirements，非照搬） | ✅ | 8 项全部落地，5 处按 raw 记载的「开工前复核 / 勘测修正」做了适配（S-91 新端点而非复用空 status、S-93 落点改 `organizeScope`、S-89 补齐顶层 `sessionId` 而非 `provider.sessionId`、S-94 不换 tokenizer、S-88 保留 `*.ext` 快路径但先判无其它通配符）。逐项见第五节 |
| 4 | 错误处理是否充分 | ⚠️ | 主链路错误处理齐备（S-88 零命中可诊断 `GrepTool.cs:265-285`；S-89 异常不再塌成 `llm_unavailable` `memory-organization.ts:347-366`；S-90 报告读取 `cancelled` 守卫 `MemorySettingsPanel.tsx:140-148`；S-91 加载失败有错误条 `ProjectArchivePage.tsx:143-162`；S-93 镜像失败不中止整理 `memory-organization.ts:405-416`，`runMirror` 内 try/catch `memory-hot-sync.ts:77-92`）。**缺口**：S-93 新增写路径的失败只有 `console.warn`，无 UI 出口（⚠️-7）；S-94 合成 score 的阈值语义与 FTS 不同源（⚠️-3） |
| 5 | 是否引入不需要的依赖 | ✅ | 新增 import 全部指向仓内既有模块，未加第三方包：`memory-hot-sync.ts:8-9`（`memory-helpers` + `memory-automation-utils`）、`memory-organization.ts:20`、`ProjectArchivePage.tsx` 的 `memoryEntries`。两个新 csproj/测试工程只 `ProjectReference` 到 `WishfulClaw.Agent`（`tests/WishfulClaw.GrepPatternRegressionTests/WishfulClaw.GrepPatternRegressionTests.csproj:11-13`），无 NuGet 新增。S-90 的 tab 是自建组件而非引依赖（`MemorySettingsPanel.tsx:66-112`）；S-88 只用 BCL `System.Text.RegularExpressions` |
| 6 | AGENTS.md 硬规则（>500 行必须拆 / 命名 / 排版 / AOT） | ❌ | **行数红线未达成**：`ProjectArchivePage.tsx` 647 行（base 596，plan 承诺拆出的 `ProjectMemoryLibraryTab.tsx` 不存在）、`MemorySettingsPanel.tsx` 521 行（base 520，文档声称 472）。命名合规（C# PascalCase / TS kebab-case；新文件 `AgentRuntimeCronRunReader.cs`、`memory-hot-sync.ts`、`MemoryExecutionLogSection.tsx`）；AOT 合规（无反射、无匿名类型序列化，`CronRunRow` 走 `InfrastructureJsonContext.Default.ListCronRunRow`，`MemoryEntriesByStatusResponse` 已在 `WishfulClawJsonContext.cs:89` 注册且 camelCase 命名策略与 TS 侧 `.entries` 读取一致——`WishfulClawJsonContext.cs:13-16`） |
| 7 | 测试与文档 | ⚠️ | 新增/更新的既有套件本身质量合格：`tests/WishfulClaw.GrepPatternRegressionTests/Program.cs:33-67`（21 断言，含 `*.ts*` 双扩展名与零筛选判定）、`tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs`（剥块 suite + 短查询 suite）、`tests/WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs:177-210`（cron 七工具「不进 direct / 代理可达 / project:chat 不可达 / cowork 保留」四面断言）。**缺口**：S-87 的 `CronRuns` 执行侧无断言（plan 要求的三条只落了可见性一条）；S-90/S-91/S-93 只有编译级验证；plan.md 36 处 checkbox 全未勾（⚠️-8、⚠️-9） |

## 三、❌ 问题清单

### ❌-1 `ProjectArchivePage.tsx` 647 行，超 500 行红线；plan 承诺的拆分组件未创建，且本刀净增 51 行

- **文件:行号**：`src/renderer/src/components/chat/ProjectArchivePage.tsx`（HEAD **647** 行；base `f6922f6c` 596 行）。记忆库 tab 实现内联在 `:511-586`（约 76 行 JSX），`loadMemoryDb` 在 `:140-162`。
- **现象**：`plan.md:151` 与 `:213` 明确写「新列表抽成 `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx`」，并把它列为「**新建**」；但该文件在仓库中**不存在**（`git show 146b1fb2 --name-only` 的 7 个文件里没有它；`git ls-files` 亦无）。S-91 实施记录里也没提这一句，只有 `raw-requirements.md:466` 的「helpers」一条。结果：文件从 596 → 647，**离红线更远**。
- **为什么错**：AGENTS.md「大文件拆分」第 2 条是硬规则（超过 500 行必须拆分），plan 自己给的验证口径就是「删 daily + 抽列表后回到线内」；本刀既没拆、又把新功能内联进去，导致规划验证结论（`compliance_report.md`）与代码事实不一致——这是**结论性判断未被复核**的老问题。
- **建议修法**：按 plan 拆两个组件即可一次落到 500 以内（估算 647 − 76 − 85 ≈ 486）：
  1. `ProjectMemoryLibraryTab.tsx`：搬 `:511-586` 的只读列表 + `memoryDbEntries/memoryDbLoading/memoryDbError/loadMemoryDb`（`:140-162`），props 传 `{ scope 相关字段, onRefresh, entries, loading, error }`；
  2. 顺手把 MEMORY.md 编辑器段（`:425-508`，约 85 行）抽成 `ProjectMemoryFileTab.tsx`——该段与 daily 下线后的「memory tab 专属」语义已经独立，属于 AGENTS.md 第 3 条「按职责边界拆」。

### ❌-2 `MemorySettingsPanel.tsx` 521 行，超 500 行红线；文档声称「520 → 472 行」与事实不符

- **文件:行号**：`src/renderer/src/components/settings/MemorySettingsPanel.tsx`（HEAD **521** 行，末行 `export { MemorySettingsPanel }` 位于 `:521`；base `f6922f6c` 520 行）。新增 tab 组件 `MemoryPageTabs` 在 `:62-112`，tab 分流在 `:203-205` 与 `:479`。
- **现象**：`84dee523` 的 commit message 写「主文件 520 → 472 行」，`raw-requirements.md:330` 写「主文件 520 → 472 行」，`plan.md:130` 的验证口径写「`MemorySettingsPanel.tsx` 行数 < 500」——三处一致声称已回到线内，**实测 521 行**（拆出 `MemoryExecutionLogSection.tsx` 的 −82 行确实做了，但 `MemoryPageTabs`（51 行）+ tab 包裹层把收益吃掉，净 +1）。
- **为什么错**：硬规则不满足；且「声称达标」比未拆更危险——下一位审查者/规划者会据此认为该文件已合规，红线失效。任何按行数做的判断（如本报告）都必须对文档口径打问号。
- **建议修法**：把设置两段拆出去即可（521 − ~100 ≈ 420）：
  - `MemoryTiersSection.tsx`（`:374-393`）+ `MemoryRecallSection.tsx`（`:395-476`），把 `TierRow`（`:484-519`）与 `clampTierDays`/`clampInt`（`:27-60`）随之下移；
  - 同时**订正文档**：把 commit message 与 `raw-requirements.md:330` 的行数改成实测值，或在拆完后重测再写。

## 四、⚠️ 轻微问题（不影响放行）

**⚠️-1（规范，低-中）`ToolDispatchRouter.cs` 573 行 > 500，本刀又 +17 行且未拆。**
- 证据：`src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs`（HEAD 573 行；base `f6922f6c` 549 行），本刀新增分支 `:343-360`。
- 说明：既存越线，但本刀在它身上继续加分支（`else if` 链已 30 余条，`:33-521`），属「越拆越难拆」的典型。建议单开一刀按工具族（Desktop / Web / Goal / Cron / Plugin / SSH …）拆 partial。

**⚠️-2（规范，低）`memory-organization.ts` 634 行 > 500（规划验证阶段已记档为豁免项，此处仅记）。**
- 证据：`src/renderer/src/lib/agent/memory-organization.ts`（HEAD 634 行，本刀 +27 行，新增只落 `:52-54`、`:337`、`:405-416`、`:558`、`:584`）。本刀把新增逻辑外移到 `memory-hot-sync.ts`（96 行）的做法正确，符合豁免口径。

**⚠️-3（S-94 语义，中）LIKE 合成 score 与 FTS `-rank` 量纲不同源，却被同一 `minScore` 与同一列表比较。**
- 证据：LIKE 侧 score ∈ {0,1,2}（`src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs:99-104`），FTS 侧 score = `-rank`（bm25 量级，`:61`）；两路结果在 `MemoryRecallService.SearchMultiQueryAsync` 里按查询词序合并、无分数归一（`MemoryRecallService.cs:158-183`），随后统一过 `PassesThreshold`（`:133-139`、`:199-205`）。
- 影响：① `minScore > 0` 时两路被「同一把尺子」筛，语义不等价（LIKE 恒 1~2 分，几乎必然通过，而 FTS 命中可能被筛掉）；② 同一条查询词若两路都命中，谁在前由合并顺序决定，不是分数决定。**不构成回归**（LIKE 以前恒 `Score=null` 全放行，现在至少有序），但「按相关度排序」的名义只在本路内成立。
- 建议：把两路分数归一（如给 `MemorySearchResult` 加 `ScoreSource`，在 `PassesThreshold` 里按来源分路判阈值），或在注释里写明「跨通道分数不可比」，避免后续误读为统一相关度。

**⚠️-4（S-88 文案，低）零命中诊断语对 `*.ts*` 的表述会误导模型。**
- 证据：`src/runtime/WishfulClaw.Agent/Tools/SearchTools/GrepTool.cs:275-277` —— `"...rejected all {N} candidate file(s) ...; only \"*\" and \"?\" are supported as wildcards (e.g. \"*.ts*\" is not a plain suffix match)."`。修好之后 `*.ts*` **是受支持且能命中的**，这句话读起来像「`*.ts*` 不支持」，可能让模型放弃本来可用的模式（该模式正是 S-88 的起因）。
- 建议：改成描述事实，例如 `file_pattern "X" matched none of the N files under ROOT (glob supports * and ?). Check the extension you meant, e.g. "*.ts" / "*.tsx".`

**⚠️-5（S-88 健壮性，低）文件名 glob 正则无超时、连续 `*` 未折叠。**
- 证据：`GrepTool.cs:499`（`new Regex(...)` 无 `TimeSpan` 超时，也无 `RegexOptions.NonBacktracking`）；`:507-549` 逐字符翻译，`****` 会翻成 `.*.*.*.*`。模式来自 agent 入参（`GrepTool.cs:61-63` 的 schema 未限制）。
- 影响：文件名最长 255 字符、星号个数等于模式长度，理论上存在高次回溯的慢匹配面（非阻塞，属健壮性）。
- 建议：`GlobToRegex` 里折叠连续 `*`，并给 `new Regex` 加 1~2 秒超时（超时当不匹配处理）。

**⚠️-6（S-90 可访问性，低）tab 的 ARIA 引用指向不存在的元素，且缺方向键导航。**
- 证据：`MemorySettingsPanel.tsx:96` 的 `aria-controls={`memory-page-tabpanel-${tab}`}`，DOM 中并无该 id（日志页容器是 `MemoryExecutionLogSection.tsx:25` 的 `id="sec-memory-execution-log"`，设置页无 tabpanel 包裹，也无 `role="tabpanel"`）；`:94-99` 有 `role="tab"`/`tabIndex` 但**无 `onKeyDown`**，而它声称照抄的 `ProviderPanel.tsx:70-97` 是有 `handleKeyDown`（ArrowLeft/Right）的。
- 影响：键盘用户只能用 Tab 停在当前选中项、无法左右切换（`tabIndex=-1` 的项不可聚焦）；读屏软件的 tab↔panel 关联断开。
- 建议：给面板套 `role="tabpanel" id={`memory-page-tabpanel-${tab}`}`（或把 `aria-controls` 指向真实 id），并补 `handleKeyDown`（从 `ProviderPanelTabs` 复制即可）。

**⚠️-7（S-93 可观测性，低-中）镜像失败只有 `console.warn`，界面上看不见。**
- 证据：`memory-organization.ts:412-416` 写 `result.syncedToDb` / `result.dbSyncError`；但执行记录组件的详情只取 `report.error ?? scope.error ?? scope.skippedReason`（`MemoryExecutionLogSection.tsx:34-40`），`dbSyncError` 没有出口（`git grep dbSyncError` 全仓只有 `memory-organization.ts` 两处与 raw 文档）。
- 影响：S-93 是**新增写入路径**，它失败时用户与后续排查都只能翻日志；raw 只记档了「不展示 `syncedToDb`」，但 `dbSyncError` 属于失败信号，性质不同于成功计数。
- 建议：在 `MemoryExecutionLogSection` 的 `detail` 链里插一层 `?? report.scopes.find((s) => s.dbSyncError)?.dbSyncError`（一行），或把镜像失败并入 `scope.error`（镜像失败不中止整理的设计可保留，但让 `organized` 与 `error` 同时出现是允许的）。

**⚠️-8（文档，低）`plan.md` 的 36 处步骤 checkbox 全未勾选（含 S-87~S-94 全部步骤与收尾三步）。**
- 证据：`docs/plans/iter-v2-33/plan.md`（`- [ ]` 36 处，`- [x]` 0 处）。8 个需求提交都并入文档，但勾选一直没做，与 AGENTS.md「一个需求一个 commit（连带 plan 勾选）」的节奏口径不一致。
- 建议：收尾前按实际逐条勾选，并把 `compliance_report.md` 里与代码事实冲突的行数结论一并订正（见 ❌-1 / ❌-2）。

**⚠️-9（测试，中）S-87 `CronRuns` 执行侧完全没有断言；S-90/S-91/S-93 无自动化测试。**
- 证据：`plan.md:99` 要求「断言：能列出 `cron_runs` 行、`jobId` 过滤生效；**断言 `List`（原方法）行为未变**」，实际只有可见性断言落在 `tests/WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs:177-210`；新 `ListReadOnly`（`DbCronRunTools.cs:182-217`）与 `AgentRuntimeCronRunReader.BuildParameters`（`AgentRuntimeCronRunReader.cs:35-55`，`jobId`→`cron_id` 映射）零覆盖。S-90/S-91/S-93 的验证均为编译级 + 真机手测（raw 各自标注「未验（需真机）」）。
- 影响：`ListReadOnly` 是「读了但不许写」的关键约束，一旦有人图省事改回调 `List`（会 `UPDATE ... status='aborted'` 误杀在跑的运行），没有任何自动检查会红。
- 建议：补 `DbCronRunTools` 层的只读性断言（跑一次 `ListReadOnly` 后断言 `cron_runs` 行未被改动、`running` 行原样返回），以及 `jobId` 过滤的断言——这是本批唯一「改了就没法从界面看出来」的风险点。

**⚠️-10（S-87 权限面，低，记档）`CronRuns` 不传 `sessionId`，跨会话全量可见。**
- 证据：`AgentRuntimeCronRunReader.BuildParameters`（`:35-55`）只写 `cronId` + `limit`，`DbCronRunTools.ListReadOnly` 在两者皆缺时 `SELECT * FROM cron_runs`（`DbCronRunTools.cs:196-201`）。
- 说明：渠道/全局会话因此可读**所有** cron 任务的运行摘要与错误。与现状一致（`CronList` 本就向同一批会话暴露全部任务及 `last_run_summary`），故不判越权；但若后续渠道要按会话隔离，这里是第二个需要加过滤的地方（renderer 侧 `db/cron-runs-list` 是传 `sessionId` 的）。建议在 `ListReadOnly` 的 XML 注释里点出这一点。

**⚠️-11（S-89，低，记档）所有 sidecar 调用方共用一个合成 `sessionId`。**
- 证据：`agent-bridge-streaming.ts:263` 常量 + `:281` 兜底；受益方包括 stage1 抽取、consolidation、organization pass、`generate-title`（`raw-requirements.md:283-284`）。
- 说明：raw 已记档「上游只要非空且稳定」，且对齐 C# 先例 `ProviderTestService.ConnectionTestSessionId`。但「稳定」同时意味着整理、标题生成等**互不相关**的后台任务在上游共享一个会话标识——若上游用它做路由/限额/缓存，行为会互相影响。建议保留但记档，观察上游是否按 session 计费/限流。另：`ContextCompression.cs` 同因下游（同样读 `state.SessionId`）本刀未修，raw 已记档。

## 五、逐需求实现核对表

| 需求 | raw 口径（要点） | 代码落点 | 符合？ |
|---|---|---|---|
| **S-88** Grep `file_pattern` | ① `MatchesFileName` 改**真 glob**（`*`/`?` → 正则），`*.ext` 可留快路径但**必须先判定除开头 `*.` 外无其它通配符**；② 零命中要能区分「目录里真没有」与「模式把文件全筛掉」；③ 同族复核（`SearchFilter.IsExcluded`、`GlobTool` 是否共用） | ① `GrepTool.cs:437-503` `CreateFileNameMatcher`（快路径守卫 `:487` 正是 `pattern.IndexOfAny(WildcardChars, 2) < 0`），翻译器 `:507-549`；② `:265-285` 诊断分支 + `:359-411` 候选/拒绝计数（`stats.Candidates` 在目录过滤之后计，`:383-389`，与注释一致）；③ `GlobTool.cs:189-231` 自有一套 `MatchesGlob`（路径级 `**`/`*`），**不共用** `MatchesFileName` — 与 commit 记档一致 | ✅（文案见 ⚠️-4，健壮性见 ⚠️-5） |
| **S-92** 召回 query 污染 | 取**方案 2（剥块）**：在 query 组装处剥 `<memory-recall>` / `<memory-update>` / `<current_time>`；**只作用于喂检索的 query，不碰 conversation 原文**（`InjectTransientPrefix` 的重复注入守卫与 prefix cache 依赖原文）；缺陷二不定案；`PendingMemoryRecall` 死变量另开 | `AgentLoop.MemoryRecall.cs:163-211`（`InjectedBlockTags` + `StripInjectedBlocks` + `RemoveInjectedBlock`，含未闭合块删到文末、无块原样返回）；调用点 `:48-50` 剥块、`:96-101` 传 `recallQuery`；原文未被修改（`conversation` 只在 `:112-120` 另做注入）。回归 `tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs`（11 断言，含「时间戳不再进 query」「用户关键词存活」） | ✅ |
| **S-94** 中文双字词检索 | 取修法 ①②：① <3 字符查询**跳过 FTS 直接走 LIKE**；② LIKE 结果补**轻量排序**（标题命中 > 内容命中）使 `PassesThreshold` 恢复意义；③**不做**（LIKE 不升为并行通道）；**不换 tokenizer** | ① `MemoryFtsService.cs:55`（`q.Length >= MinFtsQueryLength` 才走 FTS，常量 `:145`）；② `:97-113`（`(title LIKE 2) + (content LIKE 1) AS score`，`hasScore: true`，`ORDER BY status, score DESC, updated_at DESC`）；③ 未动双通道结构；tokenizer 未动 | ✅（跨通道量纲见 ⚠️-3） |
| **S-87** cron 对全局会话放开 | 六工具 `visibleScopes` 换 `GlobalSideAndWorkRuns`（渠道一并放开**属预期**）；执行记录取「**新增只读 `CronRuns`**」（`jobId?` + `limit?` 默认 20）；**不复用** `DbCronRunTools.List`（其 orphan 归一化会误杀在跑的运行，新增**纯只读** `ListReadOnly`，`jobId`→`cron_id` 显式映射，`ToolDispatchRouter` 加直连分支）；`channels.ts:218` 的 `CRON_RUNS` 不接线；`RequiresApproval` 不动 | `CronToolProvider.cs` 六处 `WorkRunsOnly`→`GlobalSideAndWorkRuns` + 新 `CronRuns` 注册（同 scope 声明）；`DbCronRunTools.cs:182-217` `ListReadOnly`（只 SELECT + `cron_id`/`session_id`/`limit` 过滤 + `Math.Clamp(limit,1,200)`）；`AgentRuntimeCronRunReader.cs:28-55`（参数映射 + `ForwardDbResult` 错误封装）；`ToolDispatchRouter.cs:343-360` 直连分支（在 `IsCronTool` 之外，`:329`）；`AgentRuntimeCronExecutor` 未改 | ✅（测试缺口见 ⚠️-9，sessionId 见 ⚠️-10） |
| **S-89** 整理链 400 | **主修下沉到 `runSidecarTextRequest`**（一处修、四调用点受益），缺省用**统一合成常量**；可诊断性：真实错误进 `result.error`，别再塌成 `llm_unavailable`；注释口径订正（opencode-go 读**顶层 `sessionId`**，非 `provider.sessionId`/`{{sessionId}}`）；nightly 补跑 / retries / `ContextCompression` 同因下游**记档不做** | `agent-bridge-streaming.ts:263`（常量）+ `:271`（形参）+ `:281`（`args.sessionId ?? SIDECAR_TEXT_REQUEST_SESSION_ID`）→ `sidecar-mapping.ts:306` 落到 run request 顶层 → C# `AgentRuntimeTools.cs:51-53`（`sessionId` → `AgentRuntimeRunState`）→ `OpenAIChatHeaders.cs:27-32`（拼 `x-opencode-session`）；`memory-organization.ts:71-91`（`describeOrganizationError`）+ `:347-366`（异常分支写 `result.error` 并早退，与原「catch 后落 `!organization?.memoryMarkdown`」等价）；注释订正 `provider-payload.ts:19-24`、`chat-store/index.ts:397-408` | ✅（共用 id 见 ⚠️-11） |
| **S-90** 记忆页双选项卡 | 页内自建 tab（`role="tablist"`，形状照 `ProviderPanelTabs`）；三段进「设置」、执行记录进「执行记录」；执行记录**去 `max-h-64` 内滚改随页滚**；**拆出 `MemoryExecutionLogSection.tsx` 使主文件 <500**；锚点导航在无目标时消失；locale 新增 `memoryPage.tabs.*` | `MemorySettingsPanel.tsx:62-112`（tab bar）、`:138`（state）、`:203-205`/`:479`（分流）、`:140-148`（报告读取）；`MemoryExecutionLogSection.tsx:1-82`（自带 `formatMemoryTimestamp`，只收 `reports`，无内滚）；`section-anchor-nav.tsx:54-68`（MutationObserver + 无目标返回 null）；locale `zh/en settings.json` 的 `memoryPage.tabs.{label,settings,executionLog}` 与 `executionLog.*` 齐备 | ⚠️ **功能符合**，但行数口径未达成（❌-2）、a11y 缺陷（⚠️-6） |
| **S-91** 每日记忆 → 记忆库 | 档案页 `daily` tab → `database`「记忆库」，列**本项目 scope** 的 `memory_entries`；**只读**；Worker 新增 `memory/entries`（不能复用空 status 的 `entries-by-status`）；**scope 字符串不在渲染端手拼**；删 `daily` 死代码；清理 `tabs.daily` 文案；`dormant` 孤儿 key 与 `memory-files.ts` daily 三函数**留另一刀** | `MemoryModule.cs:31` 注册 + `:337-372` `MemoryEntries`（`scope='all'`/省略 = 不挂谓词，显式 scope 走 `GetScope` `:403-438`，与 `entries-by-status` 同语义）；`memory-helpers.ts:244-260` `memoryEntries(scope, workingFolder, limit, projectId, sshConnectionId)`；`ProjectArchivePage.tsx:129-162`（`loadMemoryDb` 传 `scope='project'` + `workingFolder/projectId/sshConnectionId`，不手拼）、`:511-586` 只读列表（刷新/加载/空/错误四态）；`project-archive-helpers.ts:6`（`ArchiveTabId` 去 `daily`）+ 删 `DEFAULT_DAILY_TEMPLATE`/`getTodayDate`；locale `tabs.database` + `memoryLibrary.*`（`dormant` 孤儿 key 按记档保留） | ⚠️ **口径符合**，但 plan 承诺的组件抽取未做（❌-1） |
| **S-93** 自动链写 DB | 口径 A：让自动链也写 DB（召回只认一个源）；落点从死代码 `runPhase2ForRoot` 改到活的凌晨梳理 `organizeScope`（用户裁定）；镜像现役 `MEMORY.md` 段落；**插入前判重**（不改表结构加唯一索引）；失败不中止整理；补 `syncedToDb`/`dbSyncError`；执行记录文案带 `N mirrored to DB` | `memory-hot-sync.ts:21-32`（`extractHotParagraphs`：空行分块 + 剔纯标题行 + `normalizeMemoryText >= 24` 字符）、`:57-95`（`runMirror`：`memoryEntries` 取 500 条 + 双向包含判重 `:76` + 逐段 `memoryAppend` + 首次失败即带 `count` 返回）；`memory-organization.ts:405-416`（**在 `sinkOutdatedParagraphs` 之后、`writeTargetContent` 之前**镜像 `nextContent`）、`:52-54`/`:558` 字段、`:584` 文案；`MemoryRootDescriptor` 无需补 `workingFolder`（raw 已修正，`target.workingFolder` 本就可用 `:408`） | ✅（可观测性见 ⚠️-7，无测试见 ⚠️-9） |

## 六、补充结论

1. **安全性**：本批未引入注入面。SQL 仍走参数化 + 既有 `EscapeSql`（`MemoryModule.cs:352-355`、`MemoryFtsService.cs:150`）；`CronRuns` 的 `jobId` 经 `cron_id = @cronId` 参数绑定（`DbCronRunTools.cs:205`），非拼接；`ListReadOnly` 只读不写（无 `UPDATE`/`DELETE`），符合 raw 的「读时不写库是有意为之」。S-88 的正则来自 agent 入参但只作用于文件名，见 ⚠️-5。
2. **AOT**：新增序列化类型复用已注册 `JsonTypeInfo`；`AgentRuntimeCronRunReader` 用 `Utf8JsonWriter` 手写小 JSON 并 `JsonDocument.Parse`（`:37-54`、`:60-67`），未引入匿名类型序列化 → 与 AGENTS.md AOT 条款一致。
3. **命名 / 排版**：C# 新文件 PascalCase、TS 新文件 kebab-case；注释英文、中文说明留 raw 文档，符合既有风格。多处顺手删掉 UTF-8 BOM（`WishfulClaw.Agent.csproj`、`tests/WishfulClaw.Tests.sln`、若干 TS 文件）属无害清理，MSBuild / tsc 均已验证通过。
4. **无阻断的功能缺陷**：8 项需求的核心路径都能走通，且 raw 中「已记档不做」的项（S-88 附带注释、S-89 补跑/重试、S-91 `dormant` key 与 `memory-files.ts` daily、S-92 缺陷二/死变量、S-94 ③）均确实未做，无范围蔓延。

**结论：FAIL（2 ❌ / 11 ⚠️）。两条 ❌ 都是「文件行数红线未达成 + 文档声称已达成」，修法是各自拆 1~2 个组件（❌-1 拆到 ~486 行、❌-2 拆到 ~420 行）并订正文档行数；功能层面本批可放行。**

## 七、第二轮复核（2026-09-19，针对 3d9ad49d）

- **复核者**：独立 subagent（code-reviewer），第二轮。**全程只读，未改任何实现代码**（本报告为唯一写入）。
- **被审提交**：`3d9ad49d`（`fix(迭代33): 审查与验证修复调整`，12 文件 +813/−590）；base `main` @ `f6922f6c`；HEAD = `3d9ad49d`。
- **复核方式**：`git show 3d9ad49d` 逐文件读 diff → 实读 HEAD 文件取证（行号均为 HEAD 物理行号）→ **独立重跑门禁**（`tsc` / `CronRegressionTests` / `settings-tabs` / `i18n-coverage`，见 7.7）。行数一律以 PowerShell `(Get-Content <path>).Count` 实测，**不采信 commit message 或文档口径**。

### 7.1 VERDICT

**PASS**（❌ **0** 条 —— 首轮两条 ❌ 的硬规则实体均已消除；**新增问题 6 条**，全部 ⚠️ 级；**剩余 ⚠️ 6 条**）。

### 7.2 ❌ 对账表

| 编号 | 首轮要求 | 实测（HEAD，`(Get-Content).Count`） | 结论 |
|---|---|---|---|
| ❌-1 | `src/renderer/src/components/chat/ProjectArchivePage.tsx` 行数 < 500；plan 承诺抽出的 `ProjectMemoryFileTab.tsx` / `ProjectMemoryLibraryTab.tsx` 必须存在 | `ProjectArchivePage.tsx` = **376 行**（末行 `:376`）；`ProjectMemoryFileTab.tsx` = **191** 行（存在）；`ProjectMemoryLibraryTab.tsx` = **132** 行（存在）。两组件确被接线：默认导入 `ProjectArchivePage.tsx:34-35`，渲染于 `:303`（`ProjectMemoryFileTab key={memory-${reloadToken}} path={memoryPath}`）与 `:308-313`（`ProjectMemoryLibraryTab key={library-${reloadToken}} projectId workingFolder sshConnectionId`） | ✅ **消除** |
| ❌-2 | `src/renderer/src/components/settings/MemorySettingsPanel.tsx` 行数 < 500；且文档行数口径须订正 | `MemorySettingsPanel.tsx` = **345 行**（末行 `export { MemorySettingsPanel }` 在 `:345`）⇒ **500 红线已满足**；抽出物 `MemoryTierSettingsSections.tsx` = 229 行（`MemoryTiersSection` `:82`、`MemoryRecallSection` `:161`）。⚠️ **口径仍失准**：commit message 与 `raw-requirements.md` S-90 节都写「主文件落到 **327 行**」，与实测 345 差 18 行；`plan.md:129` 仍留「抽出后 ≈465 行回到线内」的旧估算。因两数均在线内，**不再影响「是否合规」的判断**，降级为新增项 N-3 / N-4 | ✅ **消除**（硬规则）；文档口径记 ⚠️ |

### 7.3 已处置 ⚠️ 对账表

| 编号 | 首轮要求 | 实测证据（HEAD） | 结论 |
|---|---|---|---|
| ⚠️-3 | 注明 LIKE 合成分与 FTS `-bm25` 不可比 | `MemoryFtsService.cs:97-100` 新增 4 行注释：`this 0..2 scale is NOT comparable to the FTS path's -bm25 rank … a non-zero threshold filters the two sources with different yardsticks; ordering is only meaningful within a channel.` | ✅ 处置 |
| ⚠️-4 | 零命中诊断文案不得暗示 `*.ts*` 不受支持 | `GrepTool.cs:274-277`：改为 `file_pattern "X" matched none of the N candidate file(s) under ROOT. Globs support "*" and "?" — check the extension you meant, e.g. "*.ts" or "*.tsx".`；旧句 `(e.g. "*.ts*" is not a plain suffix match)` 已删 | ✅ 处置 |
| ⚠️-6 | tab 补真实 `role="tabpanel"` 容器 + 方向键导航 | `MemorySettingsPanel.tsx:65`（`tabRefs`）、`:71-80`（`handleKeyDown`：ArrowLeft/Right + `preventDefault` + 环形取模 + `onChange` + `?.focus()`）；panel 容器 `:161`（`role="tabpanel" id="memory-page-tabpanel-settings"`）与 `:337`（`…-log`），与 tab 的 `aria-controls`（`:95`）拼法一致（`MEMORY_PAGE_TABS = ['settings','log']`，`:48`）⇒ **DOM id 真实存在** | ✅ 处置（残留小瑕见 N-2） |
| ⚠️-7 | 镜像失败要有 UI 出口 | `MemoryExecutionLogSection.tsx:38-40` 在 `??` 链插入 `report.scopes.find((scope) => scope.dbSyncError)?.dbSyncError`；类型成立（`memory-organization.ts:54` `dbSyncError?: string \| null` 是 scope 结果字段，tsc 零错误）；失败仍走 amber 高亮（`:49`） | ✅ 处置 |
| ⚠️-8 | `plan.md` 勾选补齐 + S-93 步骤 1/2 落点订正 | 实测 `plan.md`：`- [x]` **36** 处、`- [ ]` **0** 处；S-93 步骤 1/2 各新增「⚠️ 订正（2026-09-19 …）」段并指回 `raw-requirements.md` 的「开工前复核 / 实施记录」 | ✅ 处置（`compliance_report.md` 未同步，见 N-4） |
| ⚠️-9 | `CronRuns` 执行侧补断言（`ListReadOnly` 只读性 / `jobId` 过滤） | `tests/WishfulClaw.CronRegressionTests/Program.cs` 新增断言块：先 `Start` 造一条 `running` 行 → `ListReadOnly` 取回 → 断言 status 原样为 `running` → 再用新私有方法 `CountRunningRuns`（`:557-570`，直连 SQLite）断言**库里那行未被改动**；`--verify-reopen` 改为按 run id 定位 + 断言终态 `failed`。**实跑**：退出码 0，`PASS:` 行合计 **165**（parent 42 + child `--exercise-legacy` 101 / `--verify-reopen` 14 / `--verify-new` 8），新增 6 条全 PASS —— commit 的「42 → 165」与实测一致 | ✅ 处置（S-90/S-91/S-93 仍无自动化测试，见剩余 ⚠️-9） |

### 7.4 功能等价性核对（逐组件）

**① `ProjectMemoryFileTab.tsx`（191 行，原 MEMORY.md 编辑器）—— 等价，除 N-1**
- 加载：`load()`（`:31-66`）与旧 `loadMemoryFile` 逐行同构 —— `!path` 早退且 `loading:false`；ENOENT 三判据（`no such` / `enotfound` / `找不到`）⇒ 落 `DEFAULT_MEMORY_TEMPLATE` 且 `missingFile:true`；其它错误 ⇒ 内容清空 + `error`。✓
- 保存：`handleSave`（`:73-92`）保留 `saving` 置位、失败 ⇒ `error` + `toast.error(t('projectArchive.saveFailed'), { description })`、成功 ⇒ `savedContent: prev.draftContent` + `missingFile:false` + `toast.success(t('projectArchive.saved'))`。✓
- 重置：`handleReset`（`:94-96`）`draftContent ← savedContent` 并清 `error`；按钮 `disabled={!hasUnsavedChanges}`。✓
- 派生：`hasUnsavedChanges` / `canSave = missingFile || hasUnsavedChanges`（`:98-99`）= 旧 `:225-227`（含「文件不存在也允许保存以创建」）。✓
- 四态渲染：路径条 +「未创建」徽标 + 同步状态 + Reset/Save（`:103-148`）、缺失提示块（`:150-157`）、loading（`:161-166`）、Textarea（`:167-180`，`rows=24` / `min-h-[480px]` / `font-mono`）、错误条（`:183-188`）逐项一致。✓
- i18n：全部沿用既有 `projectArchive.*` 与 `action.save`，**未新增 key**（i18n-coverage 实测仍 PASS）。✓
- **不等价处仅 N-1**：草稿状态随组件卸载销毁。

**② `ProjectMemoryLibraryTab.tsx`（132 行，S-91 只读记忆库）—— 等价**
- `load()`（`:31-51`）参数与旧 `loadMemoryDb` **完全一致**：`memoryEntries('project', workingFolder ?? undefined, 200, projectId ?? undefined, sshConnectionId ?? undefined)`；「scope='project' 由 worker 解析、渲染端不手拼」注释保留；catch ⇒ `error` + 清列表；finally 清 loading。✓
- 触发时机：旧为「`activeTab==='database'` 才在 effect 里加载」，新为 mount 加载 —— 该组件**仅在 `activeTab==='database'` 时渲染**（`:307`），语义等价。✓
- 四态：`loading && entries.length === 0` 才显示 loading（保留「刷新时不闪空态」）、空态图标+文案、列表 `ul/li` 与字段（`title` / `priority · status` / `content`）、错误条、自带 Refresh（`disabled={loading}`）全部保留。✓
- **无 props 遗漏**：页面传入的正是 `activeProjectId` / `activeProject?.workingFolder` / `activeProject?.sshConnectionId`（`:310-312`），与旧闭包捕获同源。✓

**③ `reloadToken` 是否覆盖原 `handleReload` —— 等价**
- 旧（`3d9ad49d^`）：`memory → loadMemoryFile()`、`database → loadMemoryDb()`、`persona → loadPersonas()`。
- 新（`:159-165`）：`persona → loadPersonas()`；其余 ⇒ `setReloadToken(+1)`，两个记忆组件各带 `key={memory-${reloadToken}}`（`:303`）/ `key={library-${reloadToken}}`（`:309`）⇒ 重挂载 ⇒ 各自 effect 重跑 `load()`。**语义等价**（重读源；丢草稿行为与旧 `loadMemoryFile` 覆盖 `draftContent` 相同）。✓
- 任一时刻只有一个记忆组件在 DOM（条件渲染），故 `+1` 只作用于当前页签，不会误刷另一个。✓
- 残留（低，N-5）：`isLoading` 由「按页签取三者之一」改为常量 `personasLoading`（`:169`），致记忆 / 记忆库页签下头部 Refresh 无 spinner/禁用反馈。

**④ `MemoryTierSettingsSections.tsx` 的 warm/cold 联动（`clampTierDays`）—— 等价**
- `clampInt`（`:6-9`）与 `clampTierDays`（`:12-15`）**逐字符同构**：`clampInt(value, 1, 365, counterpart)` + `warm ⇒ Math.min(clamped, counterpart)` / `cold ⇒ Math.max(clamped, counterpart)` ⇒「warm 不得大于 cold、cold 不得小于 warm」的约束保持。✓
- `tierRows`（`:88-134`）三档（ephemeral / standard / lasting）的 `setWarm` / `setCold` 各自以**对侧当前值**为 counterpart，与旧实现一致；`TierRow`（`:18-57`）的 `min=1 max=365`、`w-20 text-xs`、`days` 后缀、grid 表头 `1fr auto auto` 未变。✓
- `SettingsSection` 的 id 仍为 `sec-memory-tiers`（`:139`）/ `sec-memory-recall`（`:166`）⇒ `SettingsPage.tsx` 的 `MEMORY_ANCHORS` 锚点仍可命中。✓
- 无 props 差异风险：两个新组件各自 `useSettingsStore()`（`:84` / `:162`），与父组件原用的同一 zustand store 同源 ⇒ 无状态丢失、无 props 遗漏。✓

**⑤ `MemoryExecutionLogSection.tsx` 的 `??` 链顺序 —— 合理**
- `:35-43`：`report.error` → 首个 `scope.error` → 首个 `scope.dbSyncError` → 首个「`skippedReason && !organized`」→ `null`。失败信号恒先于「跳过原因」这类中性信息，`:49` 依此决定 amber 高亮 ⇒ 顺序正确。✓
- 小瑕（低）：多 scope 同时失败时只显示第一条（`find` 语义），与既有 `scope.error` 取舍一致，可接受。

**⑥ `role="tabpanel"` 包裹是否破坏 `space-y-4` 布局语义 —— 未破坏**
- 父容器 `:151` 为 `space-y-4`；旧（S-90 后）直接子节点 = 标题 / tab bar / 三个 `SettingsSection`（fragment 展平），新 = 标题 / tab bar / **一个 `role="tabpanel" className="space-y-4"` 容器**（`:161-333`，内部再 `space-y-4` 装三段）⇒「标题↔tab↔panel」与「段↔段」间距同为 4，**视觉等价**；两个 panel 互斥渲染（`activeTab === …`），不会出现双份间距；执行记录 panel（`:337`）同理。✓
- 无 flex 子项假设被破坏（父容器仍是 block）；`SettingsSection` 自带 id 未被包裹层吞掉，`section-anchor-nav.tsx` 的 `MutationObserver` 仍按 id 探测。✓
- 唯一痕迹：被包裹段未随包裹层重新缩进（`:162-331` 仍是旧缩进），纯格式。

### 7.5 新发现问题

**N-1（中，本刀引入的行为回归）未保存草稿在切换页签时被静默丢弃。**
- 证据：草稿状态现由 `ProjectMemoryFileTab` 内部持有（`:21-28` 的 `file` state），而该组件**只在 `activeTab === 'memory'` 时挂载**（`ProjectArchivePage.tsx:302-304`）⇒ 切到「记忆库 / 人格」即卸载、状态销毁，切回时重挂载并从磁盘重读。
- 对照旧实现：状态在页面级（`3d9ad49d^` 的 `const [memoryFile, setMemoryFile] = useState<FileState>(…)`），页签条件渲染只卸载 **Textarea 的 DOM**，不卸载 state ⇒ 旧行为「切页签回来草稿仍在」。
- 影响：编辑 MEMORY.md → 切「记忆库」→ 切回「记忆」= 草稿无声消失（磁盘文件未动，无任何确认提示）。属本刀拆分**新引入**的可感知数据丢失。
- 建议（择一）：① 把 `file` state 与 `load / handleSave / handleReset` 提回 `ProjectArchivePage`，子组件只负责渲染；② 改为常驻挂载 + `hidden={activeTab !== 'memory'}`，把 `reloadToken` 当 prop 触发内部重载（**推荐**，既保「刷新即重读」又不丢草稿）；③ 卸载前加确认（成本最高）。
- 不判 ❌ 的理由：文件内容不会被破坏、Save 路径完好，且「刷新即丢草稿」是既有设计取舍；但这是本批**最值得在 push 前修掉的一条**。

**N-2（低）新增 `tabpanel` 缺 `aria-labelledby`，⚠️-6 只做了一半。**
- 证据：`:95` 的 tab 有 `id="memory-page-tab-${tab}"`，但 `:161` / `:337` 的 panel 只有 `id` + `role`，**无** `aria-labelledby`（也未给 panel `tabIndex={0}`）⇒ 读屏软件报「无名面板」。建议补 `aria-labelledby="memory-page-tab-settings"` 等（按 tab 变量拼）。

**N-3（低）行数口径第二次失准：文档写 327，实测 345。**
- 证据：`raw-requirements.md` S-90 节新增行「主文件落到 **327 行**」；commit message 同写 327；实测 345 行。方向仍偏小，但因两数都 < 500，**不再掩盖越线**；同一口径错误连犯两次，建议改为「实测 345 行」并写明测法。

**N-4（低）旧行数结论未同步订正。**
- `plan.md:129` 仍写「`MemorySettingsPanel.tsx` 实读 **520 行**，抽出后 ≈465 行回到线内」（实情：抽出执行记录段后仍是 521，两段都拆完才是 345）；`:130` 的验证句「行数 < 500」现已真实成立。
- `compliance_report.md:160` 仍列「`MemorySettingsPanel.tsx = 520`、`ProjectArchivePage.tsx = 596`、`memory-organization.ts = 580`」——首轮 ⚠️-8 建议「一并订正」，本刀未动该文件。建议收尾改为实测（345 / 376 / 634）。

**N-5（低）头部 Refresh 的加载反馈退化。**
- 证据：`ProjectArchivePage.tsx:169` `const isLoading = personasLoading`（旧按页签取 `memoryFile.loading` / `memoryDbLoading` / `personasLoading`），`:266-269` 用它做 `disabled` 与 `animate-spin` ⇒ 记忆 / 记忆库页签下点刷新看不到进行中反馈（内容仍会重载）。建议让子组件回报 loading，或把 `reloadToken` 与子组件内部 loading 解耦。

**N-6（低，信息）`review_report.md` 被整份替换，S-95 的审查记录从工作树消失。**
- 证据：本刀 diff 把该文件从「S-95 代码审查报告（被审 `022111c0`，PASS）」整份改写为 iter-33（S-87~S-94）报告；`git log --all -- docs/plans/iter-v2-33/review_report.md` 显示两次不同范围的审查共用同一路径（S-95 版由 `0c354cb9` 引入，且是 HEAD 祖先）；工作树中已检索不到 `S-95` 字样（命中 0），只能 `git show 0c354cb9:docs/plans/iter-v2-33/review_report.md` 取回。
- 影响：不阻断（内容可经 git 取回），但追溯困难。建议 S-95 报告改名落盘（如 `review_report_S95.md`）或把两份合并为「按审查范围分节」。

### 7.6 剩余 ⚠️ 清单（按优先级）

| 编号 | 级别 | 内容 | 状态 |
|---|---|---|---|
| N-1 | 中 | 切页签丢失未保存的记忆草稿（本刀引入） | 新发现，建议 push 前修 |
| ⚠️-9（后半） | 中 | S-90 / S-91 / S-93 仍无自动化测试（S-91 只读列表、S-93 镜像写库仅编译级 + 手测） | 遗留 |
| ⚠️-1 | 中 | `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs` **573 行**（实测）> 500，本刀仍在其上加分支、未拆 | 遗留（记档，另开一刀） |
| ⚠️-2 | 低 | `src/renderer/src/lib/agent/memory-organization.ts` **634 行**（实测）> 500，已有豁免口径 | 遗留（记档） |
| ⚠️-5 | 低 | `GrepTool.cs` 文件名 glob 正则无超时、连续 `*` 未折叠 | 遗留（记档） |
| ⚠️-10 | 低 | `CronRuns` 不带 `sessionId`，跨会话全量可见 | 遗留（记档） |
| ⚠️-11 | 低 | 所有 sidecar 调用方共用合成 `sessionId` | 遗留（记档） |
| N-2 ~ N-6 | 低 | `aria-labelledby` 缺位 / 行数口径 327→345 / plan 与 compliance 旧数字 / Refresh 反馈 / 报告覆盖 | 新发现 |

（首轮 ⚠️-3 / -4 / -6 / -7 / -8 / -9 前半已处置，见 7.3，不在此表重复。）

### 7.7 门禁实跑记录（本轮独立重跑，非引用他人结论）

| 门禁 | 命令 | 结果 |
|---|---|---|
| TS 类型检查 | `npx tsc --noEmit -p tsconfig.web.json` | 退出码 **0**，无输出（新拆分文件、props 类型、`role` / `aria-*` 属性均通过） |
| C# cron 回归 | `dotnet run --project tests/WishfulClaw.CronRegressionTests -c Release` | 退出码 **0**；`PASS:` **165** 行（parent 42 + child 101 / 14 / 8），含新增 `ListReadOnly` 只读性 6 条全绿 |
| 设置页 tab | `npm run test:settings-tabs` | PASS（23 assertions） |
| i18n 覆盖 | `npm run test:i18n-coverage` | PASS（2 checks） |
| 工作树状态 | `git status --porcelain` | 空（复核期间未产生受版本控制的改动） |

—— 复核者签名：code-reviewer（第二轮），2026-09-19
