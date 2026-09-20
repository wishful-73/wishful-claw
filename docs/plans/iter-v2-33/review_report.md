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

---

## 〔2026-09-19 收尾订正〕行数复测（以本表为准）

本报告正文里的行数是**审查当时（HEAD `3d9ad49d`）**的实测值。收尾阶段又落了改动（`a119fd9a` 的 `aria-labelledby` 与 tab 常驻挂载、`GrepTool.cs` 行尾损坏修复、S-93 镜像块前移），行数已变。此处**统一复测一次**，上文 `:133`「376 行」、`:134`「345 行」、`:53`「634 行」、`:217`「573 行」等旧值**作废**，一律以本表为准。

| 文件 | 审查当时 | 收尾实测 | 空行 | 结论 |
|---|---|---|---|---|
| `src/renderer/src/components/chat/ProjectArchivePage.tsx` | 376 | **377** | 33 | ❌-1 已消除（拆出两个子 tab 组件） |
| `src/renderer/src/components/settings/MemorySettingsPanel.tsx` | 345 | **355** | 17 | ❌-2 已消除；+10 来自补 `aria-labelledby`（N-2） |
| `src/renderer/src/components/settings/MemoryExecutionLogSection.tsx` | 82 | **85** | 4 | S-90 抽出物 |
| `src/renderer/src/components/settings/MemoryTierSettingsSections.tsx` | 229 | **229** | 8 | N-2 抽出物 |
| `src/renderer/src/components/chat/ProjectMemoryFileTab.tsx` | 191 | **191** | 16 | ❌-1 抽出物 |
| `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx` | 132 | **132** | 8 | 同上 |
| `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.cs` | — | **495** | 31 | 未超线 |
| `src/runtime/WishfulClaw.Agent/Tools/SearchTools/GrepTool.cs` | 432 / 598 | **299** | 46 | 原行数是 `\r\n\r\n` 行尾损坏下的**虚高值**（598 行里 345 行是空行）；折叠修复后内容零改动、编译 0 错、`GrepPatternRegressionTests` 21 断言全过 ⇒ 回到红线内 |
| `src/runtime/WishfulClaw.Agent/ContextCompression.cs` | — | **839** | 82 | ⚠️ 超线（S-95 落点，part. 拆分文件，本轮未动） |
| `src/renderer/src/lib/agent/memory-organization.ts` | 634 | **636** | 51 | ⚠️-2 **仍超线**，plan 已记档豁免、另开一刀 |
| `src/renderer/src/lib/agent/memory-automation-utils.ts` | — | **618** | 72 | ⚠️ 超线（死代码链，未记档 ⇒ 本次补记） |
| `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs` | 573 | **573** | 7 | ⚠️-1 **仍超线**，记档另开一刀 |
| `src/renderer/src/lib/agent/memory-hot-sync.ts` | 96 | **96** | 10 | S-93 新模块 |

**行数口径纪律（已犯两次，勿再犯）**：任何「N → M 行」的结论，必须在**全部改动落地后重测**再写进文档 —— 本迭代 S-90 先写 472、再写 327，两次都错。本表数值由 `[System.IO.File]::ReadAllLines()` 直接计数得出，可作为收尾基线。

## 审查（第二批 S-98 ~ S-100，2026-09-20）

- 被审提交：`e15ed074`（S-99 + S-100）、`53c23c5a`（S-98）；HEAD = `53c23c5a`，分支 `dev/v2-iter-33`
- 需求基准：`raw-requirements.md` 的 S-98（`:1120-1188`）/ S-99（`:1217-1272`）/ S-100（`:1275-1348`）；计划 `plan.md`「## 第二批（S-98 / S-99 / S-100）」（`:187-262`）；规划验证 `compliance_report.md`「## 规划验证（第二批 S-98 ~ S-100，2026-09-20）」（`:274-397`）与「### 复验（第二批 S-98 ~ S-100，2026-09-20）」（`:398-434`）
- 规范基准：`AGENTS.md`（分层与单向依赖 `:159-177`、AOT 十条 `:222-235`、大文件拆分 `:237-247`、命名 `:202-203`、提交规范 `:302-319`）；`docs/dev-workflow.md`（审查态定义）
- 审查者：独立 subagent（code-reviewer）
- 审查方式：**纯静态审查** —— `git show` 读两份完整 diff + 实读 HEAD 源文件与调用点取证；按本轮指令**未跑构建、未跑测试、未改任何源码**；行号均为 HEAD 物理行号
- 行数口径：`(Get-Content <file>).Count`（含空行），与前几批同口径

### 一、逐审查项结论

| # | 审查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 分层约定（Contracts→Core→Infrastructure→Workspace→Persona→Agent→Worker），有无逆向依赖 | ✅ | 三处改动都落在正确层：`MemoryFtsService`（Workspace）只 `using WishfulClaw.Infrastructure.Db` + `WishfulClaw.Core.Protocol`（`MemoryFtsService.cs:1-4`）；新类型 `MemoryEntriesResponse` 落 Workspace（`AotMemoryResultTypes.cs:41-49`）；新端点文件 `MemoryModule.Entries.cs` 落 Worker（`internal sealed partial class MemoryModule`，`:13`），只 `using Contracts / Infrastructure.Db / Workspace.Memory`（`:1-5`）—— Worker→Workspace 是允许方向（`AGENTS.md:154`）。渲染端 `memory-helpers.ts`（stores）与两个 Tab（components）只经 `window.api.workerRequest` 走 RPC（`memory-helpers.ts:273`），未越层直连 Worker/DB。**未发现任何逆向引用**（无 Workspace→Worker / Infrastructure→Workspace 的新增引用） |
| 2 | 是否真的实现了需求 | ⚠️ | S-99 ✅（单 token 等价**成立**，见 2.1）；S-98 ✅ 主体（`order` 白名单与 `offset` clamp 均**无注入面**，见 2.2）但**夹带一处跨模块行为收缩**（❌-1）；S-100 ✅ 代码正确（回退确在 plain 为空时发生，见 2.3），但**唯一真实逻辑零自动化证据**（⚠️-1）。另：plan 的 S99-4 检查点（9 词不抛异常）无落点（⚠️-4） |
| 3 | 错误处理是否充分 | ⚠️ | 合格项：FTS 失败/零命中仍回退 LIKE，且 `results.Clear()` 丢弃半读行（`MemoryFtsService.cs:89-95`）；DB 异常被 `RunAsync` 包成 `SimpleOkResult(false, Error)`（`MemoryModule.cs:391-401`），两个前端都有 try/catch + 错误条 + 清空态（`MemoryEntriesTab.tsx:109-115`、`ProjectMemoryLibraryTab.tsx:53-59`）。缺口：① LIKE 路**无 try/catch**（`MemoryFtsService.cs:136`），SQL 失败会直穿；② `offset`/`limit` 在 `RunAsync` **之外**解析（`MemoryModule.Entries.cs:80-85`），畸形入参会绕过模块自己的错误包装（⚠️-3）；③ 前端未按 `totalPages` 夹紧请求页码（⚠️-2） |
| 4 | 硬编码路径 / 密钥 / 不必要的新依赖 | ✅ | 两份 diff 无绝对路径、无密钥/凭据字面量；`package.json` 只 +1 条 `test:paste-text` 脚本，无新依赖（`tests/paste-text/program.ts` 只 import 被测模块 + esbuild 打包，与既有 28 条 TS 测试同范式）；C# 侧无新 NuGet |
| 5 | 单文件 500 行红线（逐个实测） | ✅ | 见「二、行数实测」—— 12 个触碰/受影响文件**全部 ≤ 500**，且 plan 自设的更严阈值也达成（`MemoryModule.cs` 402 ≤ 420；`MemoryModule.Entries.cs` 132 ≤ 150） |
| 6 | 行为回归风险 | ❌ | 六个点名面逐一核过（见 2.4）：5 参调用点编译兼容 ✅；重置页码 `useEffect` 的依赖改动**正确且无死循环** ✅；`entries-by-status` 的 `limit` 收敛**未影响 tier 浏览器**（唯一调用点正好传 200）✅；但 `memory/entries` 的 `limit` 上界把 `memory-hot-sync.ts` 的 500 行判重窗口**静默缩到 200**（❌-1），另有跨页请求竞态与「页码越界→假空列表」两处 UX 回归（⚠️-2） |
| 7 | 测试断言是否真能证伪 | ⚠️ | `RunMultiKeywordSuite` **能证伪改动前行为**（旧实现的整串短语 + 整串 LIKE 在 `alpha gamma` / `记忆 整理` 上都必然 0 命中，`:116` 会先失败），但两条断言名过其实（不能区分 FTS 与 LIKE 回退；不能证明 score「逐词累加」）⇒ ⚠️-5；`tests/paste-text/program.ts` 6/7 条是纯路由断言，**唯一标注「this is the S-100 fix」的那条恒真**，且 S-100 唯一真实逻辑 `htmlToPlainText` 在测试中**从未被执行**（⚠️-1） |

#### 2.1 S-99「单 token 行为与改动前逐字节一致」—— 成立

逐处对照（旧 = `e15ed074^` 的 `SearchAsync`，新 = HEAD）：
- 开关：旧 `if (q.Length >= MinFtsQueryLength)`（原 `:55`）→ 新 `if (tokens.All(t => t.Length >= MinFtsQueryLength))`（`:63`）。`q` 已在 `:41` `Trim()`；单 token 意味着无任何空白 ⇒ `tokens = [q]` ⇒ 两者等价 ✅
- FTS 串：旧 `BuildFtsLiteralQuery(q)` → 新 `BuildFtsQuery([q])` = `string.Join(" AND ", [BuildFtsLiteralQuery(q)])`（`:207-208`）⇒ n=1 时退化为同一字面量、同一转义 ✅
- LIKE 回退：子句由 `(content LIKE @pattern OR title LIKE @pattern)` 变 `(title LIKE @like0 OR content LIKE @like0)`（`:122`）—— 同一谓词、仅操作数顺序不同 ✅；score 由 `(title?2)+(content?1)`（旧 `:103-104`）变为同式的单 token 展开（`:123-125`）✅；`ORDER BY` 未动（`:133`）✅
- 早退、`limit` clamp（`:40`）、`statusFilter`/`scopeFilter`（`:52-54`）均未动 ✅

结论：**该承诺为真**；且未出现「all-≥3 走 FTS 就丢掉 LIKE 兜底」—— `:99 if (results.Count == 0)` 兜底仍在（规划验证 ⚠️-3 记的隐患未落地）。
⚠️ 附注：该等价**依赖 `:37-38` 的空查询早退** —— 若将来该早退被移除，`tokens` 为空 ⇒ `tokens.All(...)` 为**真** ⇒ `BuildFtsQuery([])` 得 `""`，LIKE 子句退化成 `WHERE (){...}`（`:132`）语法错误且**无 try/catch**。建议在 `:46` 后补一句 `if (tokens.Count == 0) return …;` 把不变式写进代码（防御性，非阻断）。

#### 2.2 注入面复核

- `order`：**白名单** —— 只做 `!Equals(order, "asc", OrdinalIgnoreCase)` ⇒ `descending`（`MemoryModule.Entries.cs:85`），SQL 里拼的是自己产生的 `direction = descending ? "DESC" : "ASC"`（`:93`、`:98`）⇒ 调用方串**永不进入 SQL 文本** ✅（`ORDER BY` 值位无法参数化时这是唯一正确解）
- `offset`：`Math.Max(0, GetInt(parameters, "offset", 0))`（`:81`）+ `@offset` 参数（`:100`）✅；无上界不影响正确性（大 offset 只返回空页）
- `limit`：`Math.Clamp(..., 1, MaxEntriesLimit)`（`:80`）✅ 有上界（**上界选值见 ❌-1**）
- 关键词：全部走参数（`@like{i}` 逐个绑定，`MemoryFtsService.cs:115-127`）；`scope` 仍是既有 `EscapeSql` 拼接（`:213`、`MemoryModule.Entries.cs:92/116`），**未新增**注入面（`scope` 由 `GetScope` 产出，非调用方原串）
- ⚠️ 附带：LIKE 的 `%` / `_` **未转义**（`:121` `$"%{tokens[i]}%"`）—— 属改动前既有行为，但**改动后 LIKE 路的覆盖面变大了**（含短 token 的多词查询全部走它），用户输入 `%` 会变通配符 ⇒ ⚠️-6

#### 2.3 S-100 回退条件复核

`composePastedText(plain, html, htmlToText)`（`use-composer-interactions.ts:69-77`）：`if (plain) return plain` ⇒ **只有 plain 为 `null`/`undefined`/`''` 才读 html** ✅；html 为空则 `''` ✅；调用点 `:128-132` 用组合结果做 `if (!plainText) return`（仍**不** `preventDefault`）✅。`shouldCollapsePaste` 现吃**提取后**的文本（`:140`），兑现 plan S100-3 ✅。`clipboardTextToHtml` 先转义 `&<>` 再进 `execCommand('insertHTML')`（`:28-34`、`:155`）⇒ 从 HTML 剪贴板提取的内容**不会**被当 HTML 注入 ✅（`DOMParser` 文档是 inert 的，脚本/`onerror` 不执行）。
⚠️ 小口径：`plain = ' '`（仅空白）仍算「有 plain」⇒ 富文本源若同时提供空白 plain，仍会插入空白（与改动前一致，非回归）。

#### 2.4 六个回归面逐一核

1. **`memoryEntries()` 新尾参对 3 个调用点**：`MemoryEntriesTab`（7 参，`:98-106`）、`ProjectMemoryLibraryTab`（6 参，`:43-50`）、`lib/agent/memory-hot-sync.ts`（5 参，`:61-67`，吃默认 `offset=0/order='desc'`）⇒ 语法与默认值均兼容 ✅；**但第 3 个调用点的语义被服务端 clamp 改了**（❌-1）
2. **重置页码 `useEffect` 依赖**：`[rows, newestFirst]` → `[hits, newestFirst]`（`MemoryEntriesTab.tsx:166-168`）。`setPage(1)` 幂等（React 同值 bail-out）⇒ **无死循环** ✅；`rows` 不再是依赖 ⇒ 翻页不会被踢回第 1 页 ✅（plan 记的实施坑确已修）。**但**：`hits` 由非 null 变 null 的那次提交里，load effect（`:120`）声明**早于** setPage effect（`:166`）⇒ 会先按**旧页码**发一次请求、再按 page=1 发第二次，两响应无序号保护、可能乱序落地（⚠️-2）
3. **`entries-by-status` 的 `limit` 收敛**：唯一调用点是 `MemoryPanel.tsx:68-69`，硬编码 `200` ⇒ `Math.Clamp(200,1,200)=200`，**行为完全不变** ✅；`MemoryEntriesByStatusResponse` 未改（`AotMemoryResultTypes.cs`），tier 浏览器读 `.entries` 不受新的 `total` 影响（`total` 只加在独立的 `MemoryEntriesResponse` 上）✅
4. **排序/响应契约**：`memory/entries` 的 wire 形状由 `{entries}` 变为 `{entries,total}`（**加字段**，向后兼容）✅；`order` 缺省仍 `updated_at DESC`（`MemoryModule.Entries.cs:85`）✅；`entries-by-status` 顺带补 `id DESC` 破平（`:48`）—— 行为变更但严格更确定，tier 浏览器不依赖同行相对次序 ✅
5. **i18n**：`chat.json` zh/en 各 +4 键（`total/prevPage/nextPage/pageOf`）且**两侧对称**；`settings.json` 的 `memoryPage.entries.{prevPage,nextPage,pageOf,matches,sortNewest,sortOldest,rowHint}` 均已存在（zh `:1575-1581` / en `:1436-1442`）⇒ 无缺失 key ✅（未跑 `test:i18n-coverage`，见「六、残余风险」）
6. **`ENTRY_FETCH_LIMIT` 残留**：全仓 grep **0 命中**（`src` / `tests`）✅；新注释已把「服务端分页」语义写清（`MemoryEntriesTab.tsx:16-22`、`:69-72`）✅

### 二、行数实测（HEAD `53c23c5a`，`(Get-Content).Count` 含空行）

| 文件 | 改动前 | 改动后 | ≤500 |
|---|---|---|---|
| `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.cs` | 495 | **402** | ✅（且 ≤ plan 自设 420） |
| `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.Entries.cs`（新） | — | **132** | ✅（且 ≤ plan 自设 150） |
| `src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs` | 155 | **214** | ✅ |
| `src/runtime/WishfulClaw.Workspace/Memory/AotMemoryResultTypes.cs` | 40 | **49** | ✅ |
| `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs` | 149 | **150** | ✅ |
| `src/renderer/src/stores/chat-store/memory-helpers.ts` | 293 | **302** | ✅ |
| `src/renderer/src/components/settings/MemoryEntriesTab.tsx` | 322 | **347** | ✅ |
| `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx` | 132 | **195** | ✅ |
| `src/renderer/src/components/chat/InputArea/use-composer-interactions.ts` | 119 | **170** | ✅ |
| `src/renderer/src/lib/agent/memory-hot-sync.ts`（受影响未改） | 96 | **96** | ✅ |
| `tests/paste-text/program.ts`（新） | — | **60** | ✅ |
| `tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs` | 220 | **256** | ✅ |

**结论：红线与 plan 自设阈值全部达成**。`MemoryModule.cs` 的拆分（495→402）是**必要动作**而非美化 —— 规划验证 §二已论证：不拆则 S98-3 的增参会把它推过 500。

### 三、❌ 阻断项

#### ❌-1 `limit` 上界 200 把 `memory-hot-sync.ts` 的 500 行判重窗口**静默缩到 200**

- **服务端**：`MemoryModule.Entries.cs:19` `private const int MaxEntriesLimit = 200;` + `:80` `var limit = Math.Clamp(GetInt(parameters, "limit", MaxEntriesLimit), 1, MaxEntriesLimit);`
- **消费方**：`src/renderer/src/lib/agent/memory-hot-sync.ts:15` `const DB_SYNC_SCAN_LIMIT = 500`（注释「How many existing entries to scan for duplicates before mirroring」），`:61-67` 以它作 `limit` 调 `memoryEntries(...)`，`:68-76` 对取回的既有条目做插入前判重。
- **问题**：改动前该入参**照单全收**（旧 `GetInt(parameters, "limit", 200)` 无 clamp）⇒ 窗口 = 500；改动后 `Math.Clamp(500,1,200)` = **200**。这是本刀引入的、跨模块的、**无任何断言覆盖**的行为回归：S-93 镜像链在单 scope 条目超 200 后，窗口外已存在的重复项会被**重复插入**（正是 `raw-requirements.md:1197`「待登记 #2」记的那类缺陷被放大）。同时 `DB_SYNC_SCAN_LIMIT = 500` 这个常量与它的注释**已与事实不符**，成了误导性常量。
- **这不是「取值偏好」，是规划验证早已点名的风险**：`compliance_report.md:388`（⚠️-7）原文「**注意：若上界取得比 500 小会静默缩小 S-93 的判重窗口**」，并建议上界取 500；而 `plan.md:232` 写的是「clamp 到 ≤ 200」—— **plan 自身的取值与它引用的 ⚠️-7 相反**，实施按 plan 字面取值，于是把这条风险落地了。commit message 与 `raw-requirements.md:1178` 都写着 `memory-hot-sync.ts` 免改，实际是**免改编译、改了行为**。
- **当前数据量下后果轻微**（仓内记档 prod 123 条 < 200，见 `raw-requirements.md:1359`），故**修法极廉价、没有理由拖**。
- **修正建议（二选一，务必让常量与事实一致）**：
  1. 上界对齐最大既有调用值：`MaxEntriesLimit = 500`，并在 `:16-18` 注释写明「= `memory-hot-sync.ts` 的 `DB_SYNC_SCAN_LIMIT`，不得调小」；或
  2. 保持页面上界 200，但把 `memory-hot-sync.ts:15` 改成 200，注释改为「受 `memory/entries` 的 `MaxEntriesLimit` 约束 —— 判重窗口 = 200，超出部分靠下次整理收敛」，即**把收缩显式化**。
  并把 S-98 实施记录里 `memory-hot-sync.ts` 的「不改代码」订正为「不改代码，但行为受上界影响（窗口 500→200）」。

### 四、⚠️ 建议项（不阻断）

- **⚠️-1（S-100 证据缺口：唯一真实逻辑零覆盖 + 一条恒真断言）**
  - `tests/paste-text/program.ts:56-59` 的 `assert(composePastedText('', htmlFlavour, (v) => \`stub:${v}\`).length > 0, 'the html fallback yields insertable text (this is the S-100 fix)')` —— 传进去的桩**恒返回非空**，该断言**不可能失败**，而它偏偏是唯一被标为「S-100 的修复」的那条。
  - 更实质：`htmlToPlainText`（`use-composer-interactions.ts:43-56`，含 `<br>`→换行、块级元素补换行、`\n{3,}` 压缩、`trim`）**在任何测试里都未被执行**（测试用第三参把整段逻辑换掉了）⇒ **S-100 真正改的那段代码目前零自动化证据**：把它改成 `return ''`，套件照样 7/7 PASS（此时线上症状就是「再次静默失败」）。
  - 建议（低成本）：把「块边界 → 换行 + 空行压缩」抽成**不吃 `Document`** 的纯函数（或让 `htmlToPlainText` 接受可注入的 `parse`），补 3 条真断言（`<ul><li>a</li><li>b</li></ul>` ⇒ `"a\nb"`；`a<br>b` ⇒ `"a\nb"`；三连空行压成两行）；退一步至少把 `:56-59` 的文案从「this is the S-100 fix」降为「html 桩被调用」—— **别让恒真断言冒充证据**。
  - 附：`raw-requirements.md:1336-1337` 的「待裁定 1（是否先诊断再改）」**至今无人拍板**，实施（`:1345`）以「全分支覆盖替代单支诊断」自行取值 ⇒ 若真机仍不生效，说明落的是第 3 支（有 `text/plain` 但 `getData` 返空），届时 `text/html` 回退**不对症**。建议真机验证时记录一次 `event.clipboardData.types`，把这条不确定性关掉。

- **⚠️-2（两处前端回归：跨页请求竞态 + 越界页码显示假空）**
  - 竞态：`MemoryEntriesTab.tsx:120-122` 的 load effect 声明**先于** `:166-168` 的 `setPage(1)`，故「清空搜索框回到浏览」「切换排序」时会先按旧页码发一次请求、再按 page=1 发一次；两请求**无序号/取消机制**，后到的旧响应可能覆盖新页内容（页码显示第 1 页、列表却是第 3 页）。`ProjectMemoryLibraryTab.tsx:66-72` 同形（切项目时先 `load(旧page)` 再 `load(1)`）。
  - 越界：两处 load 都吃**未夹紧的 `page`**（`MemoryEntriesTab.tsx:121`、`ProjectMemoryLibraryTab.tsx:71`），而显示用 `currentPage = Math.min(page, totalPages)`。若数据外部变少（总条数 45→5），会请求 offset=40 得空页 ⇒ 渲染「没有匹配的记忆条目」而页码写着「第 1 / 1 页」，**看起来像数据丢了**。
  - 建议：① 请求改吃 `currentPage`（或在 `load` 内先 `Math.min`）；② 加请求序号（`const seq = useRef(0)`，回填前 `if (seq.current !== mine) return`），或把两个 effect 合成单个「参数变化即重新取数」的 effect。属既有交互模型的欠账，但本刀把「一次拉全量」换成「每页一次请求」**放大了它**。

- **⚠️-3（参数解析在错误包装之外；LIKE 路无 try/catch）**
  - `MemoryModule.Entries.cs:80-85`（`limit`/`offset`/`order`）都在 `RunAsync(...)`（`:87`）**之前**执行：`GetInt` 走 `prop.GetInt32()`（`MemoryModule.cs:358-367`），调用方给超 Int32 范围的数字时抛异常，而 `WorkerDispatcher.DispatchAsync`（`WorkerDispatcher.cs:34-45`）**不捕获** ⇒ 该请求拿不到模块统一风格的错误响应（`limit` 的同一形态是既有；`offset` 是本刀新增的同类入口）。
  - `MemoryFtsService.cs:136` 的 LIKE 查询**无 try/catch**（FTS 路有）：SQL 构造一旦失败异常直穿到 `memory/search`。
  - 建议：三个参数解析挪进 `RunAsync` 内；给 LIKE 路补与 FTS 路对称的 catch + `WorkerLog.Warn`。

- **⚠️-4（plan 自设检查点无落点：S99-4 的 9 词查询）**
  `plan.md:217`（S99-4）验证写「9 个词的查询正常返回、不抛异常」，但 `RunMultiKeywordSuite`（`tests/WishfulClaw.MemoryRecallRegressionTests/Program.cs:103-129`）的 6 条断言里没有这条，`MaxQueryTokens = 8`（`MemoryFtsService.cs:180`）的截断语义**无断言覆盖**。建议补一条：9 词查询返回非空、不抛异常，顺带钉住「第 9 个词被丢弃」。

- **⚠️-5（`RunMultiKeywordSuite` 两条断言名不副实）**
  - `Program.cs:123-124`：`Assert(ftsHits.Count > 0, "multi-keyword query with all keywords >= 3 chars hits via FTS")` —— 它**能证伪改动前行为**（旧实现必然 0 命中），但**无法证明命中来自 FTS**：若 FTS 分支将来坏掉/恒零命中，`:99` 的 LIKE 回退会给出同样的行，断言照过。名字里的 `via FTS` 是**过度声明**，建议改文案或加可区分的探针。
  - `Program.cs:119`：`Assert(hits[0].Score > hits[1].Score, "score accumulates per keyword")` —— **不能证明「累加」**：换成「title 命中 2 / 只命中 content 1」的**不累加**实现，A(2) > B(1) 照样成立。要可证伪应断言具体值（A = `2+2 = 4`、B = `1+1 = 2`，即 `AssertEqual(4d, hits[0].Score)`）—— `Score` 是 `double?`，可直接比。
  - 正面：`:117`「AND 必须排除只含一词的行」是**真断言**（改 OR 立即失败）；`:118` 的排序断言也是真的（A 比 B 旧仍排在前，证明排序按 score 而非 recency）。

- **⚠️-6（LIKE 通配符未转义）**：`MemoryFtsService.cs:121` 的 `$"%{tokens[i]}%"` 未转义 `%` / `_`；改动后 LIKE 路覆盖面变大（含短 token 的多词查询、FTS 零命中回退）。建议加 `ESCAPE '\'` 并对 token 做 `%`/`_`/`\` 转义。属既有欠账，可一并收（不阻断）。

- **⚠️-7（跨页一致性 + 缺索引）**：`MemoryEntries` 先查页（`MemoryModule.Entries.cs:95-106`）、再 `CountScope`（`:109`、`:114-119`），两者**不在一个事务里** ⇒ 并发写入时 `total` 与当前页可能不同源（翻末页可能得空页）。且 `memory_entries` **没有 `(scope, updated_at)` 索引**（`DbClient.cs` 的索引清单里无 memory_entries 相关项）⇒ 每页一次全扫 + 排序 + 一次 `COUNT(*)`。当前规模无影响，仅记档；量大后建议 `CREATE INDEX ix_memory_entries_scope_updated ON memory_entries(scope, updated_at DESC, id DESC)`。

- **⚠️-8（搜索态下 Refresh 做无用功）**：`MemoryEntriesTab.tsx:191` 的 Refresh 在 `hits !== null` 时仍 `load(currentPage, newestFirst)` 重取浏览页，但列表渲染的是 `hits` ⇒ 用户看到「什么都没发生」。建议搜索态下禁用 Refresh 或提示先清空查询。（改动前同形，非本刀引入。）

- **⚠️-9（提交卫生两点，均不判问题但要记）**：① `e15ed074` 把 S-99 与 S-100 合成一刀，与 `AGENTS.md:304-306`「一个需求一个 commit」字面冲突，但 `plan.md:207` 明示「S-99 + S-100 合为一刀」⇒ 属已记录取舍，**不判问题**；② 该 diff 第 1 行**顺手删掉了 `use-composer-interactions.ts` 的 UTF-8 BOM**（`-import` → `+import`）—— 与本需求无关的顺手改动，建议 commit message 点一句，或留给专门的行尾/BOM 清理刀（仓内另记有「行尾损坏」整改项，`raw-requirements.md:1207`）。

### 五、正面记录（值得保留的做法）

1. **端点拆分是必要设计而非美化**：`MemoryModule.cs` 495→402 行，且把共用的行映射抽成 `ReadEntryRow`（`MemoryModule.Entries.cs:121-131`）—— 两份原实现的逐字段读取完全同构，抽取无重复。
2. **契约克制**：新增 `MemoryEntriesResponse`（`AotMemoryResultTypes.cs:41-49`）而**不动**两端点共用的 `MemoryEntriesByStatusResponse`，并同步注册 AOT context（`WishfulClawJsonContext.cs:90`；`List<MemoryEntryRow>` 已在 `:88`）✅ 符合 `AGENTS.md` AOT 规则 4/5/8。
3. **`order` 用白名单而非拼接用户串**（`MemoryModule.Entries.cs:83-85`）—— `ORDER BY` 值位无法参数化时的正确写法，且有注释说明理由。
4. **稳定排序承诺落地**：`updated_at {dir}, id {dir}`（`:98`）与 `entries-by-status` 的 `id DESC`（`:48`）都补了 tiebreaker，注释写明「缺全序会跨页重复/漏行」。
5. **FTS 失败路径健壮**：`results.Clear()` + `WorkerLog.Warn`（`MemoryFtsService.cs:89-95`）—— 半读结果不会混进 LIKE 结果集。
6. **踩坑留痕**：`MemoryEntriesTab.tsx:163-165` 用注释写明「为什么不把 `rows` 放进依赖」（否则翻页被踢回第 1 页）—— 正是这类注释让后人不会把依赖「改回去」。
7. **测试用例设计有讲究**：`RunMultiKeywordSuite` 特意把三条样本都设为 `active`（`Program.cs:100-101`），避免 `ORDER BY` 的 status 首键掩盖 score 排序（规划验证 N-3 的注记被如实执行）；A 比 B 旧却排在前，使「按相关度而非时间」可被证伪。

### 六、残余风险 / 本次未能验证的部分（非缺陷，交门禁与验证态）

- 按本轮指令**未跑任何构建/测试**，故以下结论**未由本报告独立复核**，仅有 commit 自述：`WishfulClaw.Workspace.csproj` / `WishfulClaw.Worker.csproj` 0 错 0 警、`tsc` 三配置 0 错、`test:i18n-coverage` PASS、`test:paste-text` 7/7、MemoryRecall 套件 31→37 全 PASS。**尤其**：`e15ed074` 的 commit message 自述主 sln 编译曾被运行中的 Worker 进程锁 dll（「留待门禁阶段复验」），而 `53c23c5a` 又改了 `AotMemoryResultTypes.cs` / `WishfulClawJsonContext.cs` ⇒ **建议门禁阶段以 `-p:BaseOutputPath`（外置输出）实跑两个 sln 并留记录**，确认 AOT 源生成注册（`MemoryEntriesResponse`）真的编过。
- S-98 的「跨页不重不漏」是运行时行为（依赖 `id` tiebreaker），`raw-requirements.md:1186` 已列为真机确认项 —— 本报告的静态结论只能到「SQL 形态正确、全序成立」为止。
- S-100 的「真实剪贴板能否读到文本」只能真机确认（`plan.md:262` 已收窄口径）。

### 七、VERDICT

**FAIL**（❌ 1 条 / ⚠️ 9 条）

| | 计数 | 内容 |
|---|---|---|
| ❌ 阻断 | 1 | ❌-1 `limit` 上界 200 静默缩小 `memory-hot-sync.ts` 的 500 行判重窗口（跨模块行为回归 + 常量与事实不符） |
| ⚠️ 建议 | 9 | ⚠️-1 S-100 零覆盖 + 恒真断言（含 raw「待裁定 1」仍未拍板）／⚠️-2 跨页请求竞态 + 越界页码假空态／⚠️-3 参数解析在错误包装外 + LIKE 路无 catch／⚠️-4 S99-4 检查点无落点／⚠️-5 两条断言名不副实／⚠️-6 LIKE 通配符未转义／⚠️-7 COUNT 与页非同快照 + 无索引／⚠️-8 搜索态 Refresh 无效／⚠️-9 提交卫生两点 |

- 七项审查项中：**✅ 3 项**（#1 分层依赖方向、#4 硬编码/依赖、#5 500 行红线）、**⚠️ 3 项**（#2 需求符合度、#3 错误处理、#7 测试证伪力）、**❌ 1 项**（#6 回归风险）。
- 三个需求的**主体实现正确、落层正确、红线全部达成**；S-98 对 raw 三条待裁定的取值（总数方案 A / 直接改掉客户端分页 / 档案页一并改）与 raw 倾向一致；`order`、`offset` 无注入面；S-99 的单 token 等价承诺**经逐处对照成立**。
- ❌-1 的返工成本是**改一个常量 + 订正一句文档**（或改另一个常量），修完即可复验（只需重读 `MemoryModule.Entries.cs:19/80` 与 `memory-hot-sync.ts:15`）；⚠️-2 / ⚠️-3 建议同刀收掉。**修掉 ❌-1 后本报告结论可翻为 PASS。**

—— 审查者签名：code-reviewer（第二批 S-98 ~ S-100），2026-09-20

---

## 复验（第 2 轮，增量）

**复验者**：architect-reviewer（独立，只读）
**复验对象**：收尾修复提交（代码 5 处 + 文档口径订正）

### VERDICT: PASS

| 上轮问题 | 复验结论 | 依据 |
|---|---|---|
| ❌-1 `limit` 上界静默缩小判重窗口 | **消除** | `MemoryModule.Entries.cs:23` `MaxEntriesLimit = 500`；`:38`（by-status）与 `:84`（entries）都走 `Math.Clamp(..., 1, MaxEntriesLimit)`；`memory-hot-sync.ts:15` `DB_SYNC_SCAN_LIMIT = 500` 经 `memory-helpers.ts:264-272` 第 3 位形参传入，`Clamp(500,1,500)=500` 不再被夹 |
| 验证 D3 页码越界空白页 | **修复** | `MemoryEntriesTab.tsx:107-115` 用返回的 `total` 算 `lastPage`，越界则 `setPage(lastPage)` + 早退；`setPage` 后 effect 重读时 `targetPage > lastPage` 恒 false ⇒ **无死循环**；早退仍过 `finally` ⇒ 无 loading 卡死 |
| paste-text 恒真断言 | **已删且无覆盖损失** | 剩余 6 条中 `:50` 断言返回值等于 `stub:${htmlFlavour}` —— 把回退分支改成 `return ''` 该条即红 |
| MemoryRecall 两条断言名不副实 | **已获真区分度** | 改为断言数值 `4d` / `2d`；不累加的实现会得 2 / 1，旧写法（只比大小）区分不出、新写法能 FAIL |
| 验证 D1 断言计数（≥38 / 37） | **两版都写错，已订正为 38** | 实跑修复后的 exe 打印 `passed: 38`；`plan.md:218`、`raw-requirements.md:1272` 改 38（`RunMultiKeywordSuite` 7 断言）、`:1349` paste-text 改 6 |

### 残余 ⚠️（不阻断，延续记档）

1. **S-100 真实 `htmlToPlainText`（`DOMParser` 分支）仍无自动化证据** —— node 无 `DOMParser`，测试只能注入桩；唯一覆盖是真机验证。已写进 raw S-100 回归段。
2. **搜索态 Refresh 与页码 clamp 交叠**（`MemoryEntriesTab.tsx:196-210`）—— 需「搜索结果 ≥3 页 + 浏览态仅 1 页 + 手点 Refresh」的窄条件，无崩溃无死循环；属既有 wart，非本刀引入，建议另开刀。
3. **LIKE 通配符 `%` / `_` 未转义**、**`COUNT(*)` 与页非同快照 / `updated_at` 无索引**、**跨页请求竞态无序号保护** —— 上轮 ⚠️-2 / ⚠️-6 / ⚠️-7 的延续，本次按「不扩大范围」记档不修。

—— 复验者签名：architect-reviewer，2026-09-20
