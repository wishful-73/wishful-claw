# iter-v2-33 独立验证报告（verification_report.md）

> 验证者：独立验证 subagent（只读验证，未改动任何代码；仅写本报告）
> 时间：2026-09-19 19:39~19:45 (+08:00)
> 仓库：`D:\claw\wishful-claw` ｜ 分支：`dev/v2-iter-33` ｜ base `main` @ `f6922f6c`
> 本迭代提交：`dc1a3e75`(S-88) `42232cbf`(S-92) `7f7d3990`(S-94) `48e0d05f`(S-87) `102fe81a`(S-89) `84dee523`(S-90) `146b1fb2`(S-91) `3e5d2aa9`(S-93) `3d9ad49d`(审查修正)
> 环境：Windows / PowerShell 7（shell=powershell.exe）；`DOTNET_ROOT=D:\claw\dotnet-sdk`，SDK `11.0.100-preview.7`；Node `v24.14.1`
> 范围说明：`022111c0` / `0c354cb9`（S-95）**不在本次验证范围**。
> **验证时点（收尾补记）**：HEAD = `3d9ad49d`。该提交随后被 `git reset --soft` 折叠重提为 `a119fd9a`，且折叠后又落了工作区改动 ⇒ 本报告 `PASS` **不覆盖当前工作区**，缺口与增量重验见文末「〔2026-09-19 收尾订正〕」。

---

## 1. VERDICT

**PASS** — 三个 TypeScript 配置、两个 .NET 解决方案（含主方案全量 `-t:Rebuild`）、`npm run build` 全部 0 错 0 警；32/32 个 `test:*` 脚本与 11/11 个 C# 回归套件全绿；S-87~S-94 八项需求的实施落点均在代码中定位到，且每一项都有对应回归断言或静态证据。仅存少量**文档漂移**（不影响功能），与 5 项**需真机手测**的端到端行为。

---

## 2. 编译与测试结果表

### 2.1 编译门禁

| 项目 | 命令 | 结果 |
|---|---|---|
| TS web 配置 | `npx tsc -p tsconfig.web.json --noEmit` | ✅ exit=0，0 错 |
| TS node 配置 | `npx tsc -p tsconfig.node.json --noEmit` | ✅ exit=0，0 错 |
| TS root 配置 | `npx tsc -p tsconfig.json --noEmit` | ✅ exit=0，0 错 |
| .NET 主方案（增量） | `dotnet build src\runtime\WishfulClaw.sln --nologo` | ✅ exit=0，0 警告 0 错误 |
| .NET 主方案（**全量 Rebuild**） | `dotnet build src\runtime\WishfulClaw.sln --nologo -t:Rebuild` | ✅ exit=0，0 警告 0 错误（10s） |
| .NET 测试方案 | `dotnet build tests\WishfulClaw.Tests.sln --nologo` | ✅ exit=0，0 警告 0 错误 |
| 归档构建 | `npm run build` (electron-vite build) | ✅ exit=0，`✓ built in 55.09s`（总 ~61s） |

> 主方案做了强制全量 `-t:Rebuild`，以排除「增量构建跳过编译 ⇒ 看不到警告」的可能。全量重建后仍 **0 警告 0 错误**。

### 2.2 TypeScript `test:*` 脚本（共 32 个，逐个执行）

| # | 脚本 | 结果 | 通过数（脚本自报） |
|---|---|---|---|
| 1 | `test:session-todo-batch` | ✅ exit=0 | 12 |
| 2 | `test:context-cap` | ✅ exit=0 | 52 |
| 3 | `test:renderable-chat-items` | ✅ exit=0 | 17 |
| 4 | `test:channel-cancel-commands` | ✅ exit=0 | passed |
| 5 | `test:session-follow-up` | ✅ exit=0 | 20 |
| 6 | `test:updater-release-notes` | ✅ exit=0 | 71 |
| 7 | `test:updater-state` | ✅ exit=0 | 56 |
| 8 | `test:updater-progress` | ✅ exit=0 | 35 |
| 9 | `test:provider-presets` | ✅ exit=0 | 552（46 presets） |
| 10 | `test:provider-fallback` | ✅ exit=0 | 40 |
| 11 | `test:provider-payload` | ✅ exit=0 | 54 |
| 12 | `test:session-model-resolution` | ✅ exit=0 | 23 |
| 13 | `test:fallback-chain` | ✅ exit=0 | 22 |
| 14 | `test:i18n-coverage` | ✅ exit=0 | 2 |
| 15 | `test:live-cursor` | ✅ exit=0 | 20 |
| 16 | `test:channel-account-label` | ✅ exit=0 | 12 |
| 17 | `test:settings-tabs` | ✅ exit=0 | 23 |
| 18 | `test:select-file-tags` | ✅ exit=0 | 18 |
| 19 | `test:selected-file-context` | ✅ exit=0 | 20 |
| 20 | `test:streaming-render-pool` | ✅ exit=0 | 20045 |
| 21 | `test:channel-reply-event-policy` | ✅ exit=0 | passed |
| 22 | `test:ipc-msgpack-routing` | ✅ exit=0 | 96（272 channels） |
| 23 | `test:channel-shell-approval` | ✅ exit=0 | 45 |
| 24 | `test:browser-user-agent` | ✅ exit=0 | 24 |
| 25 | `test:free-chat-tabs` | ✅ exit=0 | 22 |
| 26 | `test:message-timestamp` | ✅ exit=0 | 25 |
| 27 | `test:free-chat-sites` | ✅ exit=0 | 15 |
| 28 | `test:shell-executable` | ✅ exit=0 | 35 |
| 29 | `test:queued-message-text` | ✅ exit=0 | 13 |
| 30 | `test:codegraph-availability` | ✅ exit=0 | 23 |
| 31 | `test:background-wake-message` | ✅ exit=0 | 30 |
| 32 | `test:session-permission-mode` | ✅ exit=0 | 24 |

**汇总：32 通过 / 0 失败。**

### 2.3 C# 回归套件（共 11 个 exe，逐个执行）

| # | 套件（`bin\Debug\net11.0\<Name>.exe`） | exit code | 断言数（自报） |
|---|---|---|---|
| 1 | `WishfulClaw.AgentTimelineRegressionTests` | ✅ 0 | 25 |
| 2 | `WishfulClaw.ChannelShellApprovalRegressionTests` | ✅ 0 | 72 |
| 3 | `WishfulClaw.ChannelToolVisibilityRegressionTests` | ✅ 0 | **122** |
| 4 | `WishfulClaw.CompactionSnapshotRegressionTests` | ✅ 0 | passed（含 unsupported_version / restore 分支） |
| 5 | `WishfulClaw.CronRegressionTests` | ✅ 0 | **42** 父 + 8 子（`--verify-new`） |
| 6 | `WishfulClaw.GoalRegressionTests` | ✅ 0 | 313 |
| 7 | `WishfulClaw.GrepPatternRegressionTests` | ✅ 0 | **21** |
| 8 | `WishfulClaw.MemoryRecallRegressionTests` | ✅ 0 | **31** |
| 9 | `WishfulClaw.ProviderHeaderRegressionTests` | ✅ 0 | passed |
| 10 | `WishfulClaw.SessionTaskCascadeRegressionTests` | ✅ 0 | 225 |
| 11 | `WishfulClaw.ToolConcurrencyRegressionTests` | ✅ 0 | passed |

**汇总：11 通过 / 0 失败。** 其中序号 3/5/7/8 的断言数与 raw-requirements 登记一致
（S-87：`ChannelToolVisibility 98→122`、`Cron 42`；S-88：`GrepPattern 21`；S-92/S-94：`MemoryRecall 18→28→31`）。

---

## 3. 逐需求验证表

| 需求 | 验证标准 | 证据（工具） | 结论 |
|---|---|---|---|
| **S-88** Grep `file_pattern` 通配符 | `CreateFileNameMatcher` / `GlobToRegex` 存在；`*.ts*` 类模式命中；跑 `GrepPatternRegressionTests` 报断言数 | `GrepTool.cs`：`MatchesFileName` :439、`CreateFileNameMatcher` :463、`GlobToRegex` :507、调用点 :363/:395（Select-String 行号实读）。回归 `GrepPatternRegressionTests.cs` 显式覆盖：`AssertMatch("*.ts*", "use-chat-actions.ts", true)` :50、`AssertMatch("*.ts*", "App.tsx", true)` :51、`AssertMatch("*.ts*", "App.js", false)` :52。exe exit=0，**21 断言** | ✅ |
| **S-92** 召回 query 剥注入块 | `AgentLoop.MemoryRecall.cs` 的 `StripInjectedBlocks` 存在；跑 `MemoryRecallRegressionTests` | `AgentLoop.MemoryRecall.cs`：`StripInjectedBlocks` :177（`InjectedBlockTags` 循环剥 `<memory-recall>`/`<memory-update>`/`<current_time>`，未闭合删到末尾 :207）；调用点 `recallQuery = StripInjectedBlocks(userMessage)` :48，仅剥检索 query、空则 return :49-50；`recallQuery` 传给 `TryInjectRecallAsync` :97。exe exit=0，**31 断言**（含 `PASS: timestamp no longer reaches the recall query` / `PASS: user keywords survive stripping`） | ✅ |
| **S-94** 中文双字词检索 | `MemoryFtsService.cs` 的 `MinFtsQueryLength = 3` 与 LIKE 合成 score | `MemoryFtsService.cs`：常量 `MinFtsQueryLength = 3` :149；门控 `if (q.Length >= MinFtsQueryLength)` :55（2 字查询跳过 FTS）；LIKE 合成 score `(title LIKE THEN 2) + (content LIKE THEN 1) AS score` :103-104，`ORDER BY status, score DESC, updated_at DESC` :107，`RowToResult(..., hasScore: true)` :116。`RowToResult` 读取 score 列 :132-134/:141 | ✅ |
| **S-87** cron 六工具放开 + `CronRuns` | `CronToolProvider` 六个工具 scope 放宽（`GlobalSideAndWorkRuns`）+ 新增 `CronRuns`；`DbCronRunTools.ListReadOnly` 内部无 UPDATE/DELETE；跑 2 套件 | `CronToolProvider.cs`：六工具 + `CronRuns` 共 7 处 `visibleScopes: ToolVisibilityScopes.GlobalSideAndWorkRuns`（:36/:43/:56/:63/:70/:77/:92），`CronRuns` 工具名 :83。`DbCronRunTools.cs`：`ListReadOnly` :191-217 —— 方法体内**仅 SELECT**（:205）,无 UPDATE/DELETE；唯一的 `UPDATE cron_runs SET status='aborted'` :149 位于**非只读的 `List`** 内（与 raw 文档「已知取舍」一致）。直连：`AgentRuntimeCronRunReader.cs` 存在，`ToolDispatchRouter.cs` :29 `ForwardDbResult(DbCronRunTools.ListReadOnly(...))`。套件：`ChannelToolVisibilityRegressionTests` exit=0 **122 断言**；`CronRegressionTests` exit=0 **42 断言**（+ 子模式 8） | ✅ |
| **S-89** 整理请求缺 sessionId（400） | `agent-bridge-streaming.ts` 的合成 sessionId 常量与透传链 | `agent-bridge-streaming.ts`：常量 `export const SIDECAR_TEXT_REQUEST_SESSION_ID = 'wishful-claw-sidecar-text'` :263；`runSidecarTextRequest` 形参 `sessionId?: string` :271；透传 `sessionId: args.sessionId ?? SIDECAR_TEXT_REQUEST_SESSION_ID` :281（注释 :258 说明 provider 读顶层 `sessionId`）。可诊断性：`memory-organization.ts` `describeOrganizationError` :82，写 `result.error = detail` :361、`result.error ??= 'organization pass returned no usable content'` :370 | ✅ |
| **S-90** 记忆页拆两选项卡 | `MemorySettingsPanel.tsx` 行数 < 500；两个分页 tab | `MemorySettingsPanel.tsx` **实测 328 行**（< 500 ✅）。`MemoryPageTabs` :57、`role="tablist"` :84、两 tab 定义 `settings`/`log` :67-68。两个 `role="tabpanel"`：`:161`(settings) / `:337`(log)；`activeTab === 'settings'` :160、`activeTab === 'log'` :336。拆分产物：`MemoryExecutionLogSection.tsx`（81 行）、`MemoryTierSettingsSections.tsx`（221 行）均存在 | ✅ |
| **S-91** 数据库记忆入口 | Worker `memory/entries` 端点 + `memoryEntries()` + 档案页 `database` tab | `MemoryModule.cs`：注册 `context.Register("memory/entries", MemoryEntries)` :31；handler `MemoryEntries` :337，SQL `WHERE 1 = 1{scopeClause}` :353（不挂 status 谓词），返回 `MemoryEntriesByStatusResponse` :369。渲染端 `memory-helpers.ts` `memoryEntries(...)` :244。档案页 `ProjectArchivePage.tsx`：tab `{ id: 'database', icon: Database, i18nKey: 'projectArchive.tabs.database' }` :42、内容 `activeTab === 'database'` :307 | ✅ |
| **S-93** 自动沉淀记忆进召回源 | `memory-hot-sync.ts` + `memory-organization.ts` 的 `organizeScope` 调用点 | `memory-hot-sync.ts` **96 行**：`extractHotParagraphs` :21（按空行分块、剔标题行、`normalizeMemoryText` ≥ 24 字符）、`mirrorHotParagraphsToDb` :50、幂等判重 :76 `known.some(item => item.includes(normalized) \|\| normalized.includes(item))`、先读 `memoryEntries` :61 再 `memoryAppend` :78。调用点：`memory-organization.ts` import :20、`organizeScope` 内 :405 `await mirrorHotParagraphsToDb({...})`、`result.syncedToDb = sync.count` :412、`result.dbSyncError = sync.error` :414（新字段 :52/:54） | ✅ |

### 3.1 只读 SQLite 核对（未写入）

命令（`node:sqlite` `DatabaseSync(..., { readOnly: true })`）：

```js
const db = new DatabaseSync('<USERPROFILE>/.wishful-claw/index.db', { readOnly: true })
```

输出：

```
total memory_entries = 130
    project:D:\claw\wishful-claw = 66
    global = 35
    project:D:\koda\Obsidian = 17
    project:D:\koda\wishful = 7
    project:D:\claw\test-claw = 3
    project:D:\koda\koda-agent-v2 = 2
memory_archive = 0
```

- 与 S-91 / S-93 需求登记的「prod 123 条 / `project:D:\claw\wishful-claw` 59 条」同结构，总量 123→130、本项目 59→66 属正常增长（agent 持续 `memory_append`）。
- `memory_archive` 仍为 0，与登记一致。
- **全程只读打开，未执行任何写操作。**

---

## 4. 无法自动验证的项（需真机手测）

以下 5 项为端到端/UI/真机行为，无人值守环境无法完成（需启动 Electron GUI 并真实触发上游请求）。给出具体手测步骤：

| # | 需求 | 手测步骤 | 预期 |
|---|---|---|---|
| M1 | **S-87** `CronRuns` 工具真机返回 | ① 全局 PM 会话里让 agent 调一次 `CronRuns`（可带 `jobId` / `limit`）；② 观察返回体 | 返回 `cron_runs` 历史行（非空、含 status/summary/error/toolCallCount/startedAt/finishedAt）；不误报既有权运行 |
| M2 | **S-89** 记忆整理不再 400 + 会话标题生成 | ① 绑 opencode-go，设置页手动触发一次「记忆整理」；② 新建会话发首条消息触发标题生成；③ 查 `~/.wishful-claw/logs/<date>.log` | 不再出现 `HTTP 400 / MissingSessionID`；执行记录里失败项带**真实** HTTP 状态 + provider + body 摘要（不再塌成 `llm_unavailable`） |
| M3 | **S-90** 两个选项卡 | ① 打开设置 → 记忆页；② 切「设置」/「执行记录」；③ 在「执行记录」下看左侧锚点导航 | 两 tab 正常切换（含方向键）；执行记录整页滚动、完整可见；切到「执行记录」时锚点 nav 消失（无死链） |
| M4 | **S-91** 档案页「记忆库」 | ① 打开项目档案页 → 「记忆库」tab；② 点刷新 | 列出本项目 `scope = project:{workingFolder}` 的 `memory_entries`（本机 prod 实测 66 条）；含加载态/空态/错误条；只读 |
| M5 | **S-93** 凌晨梳理镜像进 DB | ① 跑一次凌晨梳理（或用设置页手动触发）；② 看执行记录文案；③ **同 scope 再跑一次** | ① 出现 `N mirrored to DB`；② 本项目现役记忆可在召回中搜到；③ 第二次 `N = 0`（幂等，无重复插入） |

---

## 5. FAIL / PARTIAL 明细

**无 FAIL、无 PARTIAL。** 以下为**文档漂移**（不影响功能与结论，供追记）：

| 项 | 登记值 | 实测值 | 说明 |
|---|---|---|---|
| S-90 `MemorySettingsPanel.tsx` 行数 | 审查修正后「327 行」 | **328 行** | 差 1 行；红线（<500）已达成，不影响结论 |
| S-93 `memory-organization.ts` 行数 | 「634 行，超 500 红线（豁免项）」 | **583 行** | 较登记更小（已被外移逻辑），仍 >500，豁免登记有效 |
| prod `memory_entries` 总数 | 123 条（登记时点） | **130 条** | 正常增长，非缺陷 |
| S-88 raw 文档小节标题 | 仍写「实施记录（未实施）」 | 代码已实现 + 回归通过 | 文档未回填实施记录，属**文档状态滞后**，非代码缺陷 |
| S-92 raw 文档「实施记录」 | 缺陷二维持暂不定案 / 待裁定第三条不做 | 与 plan V7/V8 一致 | 一致，无需处置 |

---

## 6. 附：验证过程一览（命令与退出码）

```
git branch --show-current                  -> dev/v2-iter-33
git log --oneline -15                      -> 3d9ad49d ... f6922f6c（本迭代 9 提交齐备）

npx tsc -p tsconfig.web.json --noEmit      -> EXIT=0
npx tsc -p tsconfig.node.json --noEmit     -> EXIT=0
npx tsc -p tsconfig.json --noEmit          -> EXIT=0

dotnet build src\runtime\WishfulClaw.sln --nologo -t:Rebuild  -> 0 警告 0 错误  EXIT=0
dotnet build tests\WishfulClaw.Tests.sln  --nologo            -> 0 警告 0 错误  EXIT=0

npm run build                              -> EXIT=0（✓ built in 55.09s）

package.json test:* 脚本                   -> 32/32 PASS，0 FAIL
tests\WishfulClaw.*RegressionTests exe     -> 11/11 exit=0

SQLite（readOnly）                         -> memory_entries=130, memory_archive=0
```

> 本报告由独立验证会话生成；**验证期间未修改任何源代码/配置**，仅新建本报告文件。

---

## 〔2026-09-19 收尾订正〕验证覆盖面缺口与增量重验

### 一、缺口（成立，本报告此前未自陈）

**验证时点 HEAD = `3d9ad49d`；当前 HEAD = `a119fd9a`。** `git diff 3d9ad49d a119fd9a --stat` 证明两处**代码**变化未被本报告覆盖：

| 文件 | 变化 | 性质 |
|---|---|---|
| `src/renderer/src/components/settings/MemorySettingsPanel.tsx` | +14 / −2 | 两个 `role="tabpanel"` 补 `aria-labelledby` —— 静态属性，风险低 |
| `src/renderer/src/components/chat/ProjectArchivePage.tsx` | +7 / −3 | memory tab 由「按需挂载」改为**常驻挂载**（`hidden` / `contents` 切换），以免切换 tab 丢未保存草稿 —— **有行为变化，须重验** |

折叠之后、收尾之前又落了工作区改动（同样未被覆盖）：

| 文件 | 变化 | 性质 |
|---|---|---|
| `src/runtime/WishfulClaw.Agent/Tools/SearchTools/GrepTool.cs` | 行尾损坏修复：598 行 / 345 空行 → **299 行 / 46 空行**，内容零改动 | 已有证据：`dotnet build`（Agent 项目 + `tests.sln`）0 错 0 警、`GrepPatternRegressionTests` 21 断言全过 |
| `src/renderer/src/lib/agent/memory-organization.ts` | S-93 镜像块移到 `no_changes` 早退**之前**，修「MEMORY.md 稳定后镜像永不执行」 | **须重验**；副作用：sink 失败时 DB 已镜像（幂等 + 下一轮自愈，可接受，须记档） |

⇒ 本报告原 `PASS` 仅对 `3d9ad49d` 成立；**对 `a119fd9a` 与当前工作区不完整**，须增量重验。

### 二、增量重验（范围与结果）

> 执行者：独立验证 subagent（只读验证；仅写本节，未改任何源码/配置/其他文档）
> 时间：2026-09-19 20:24~20:30 (+08:00)｜仓库 `D:\claw\wishful-claw`｜分支 `dev/v2-iter-33`｜HEAD `a119fd9a`｜**验证对象 = 当前工作区（含未提交改动）**
> 环境：Windows / `powershell.exe`；`$env:DOTNET_ROOT='D:\claw\dotnet-sdk'`；Node `v24.14.1`

**VERDICT：PASS（增量范围）** —— 4 处改动全部复验通过，无阻断项；同时**更正 1 处环境约束**（§2.6 末：MSB3027 未复现）、**更正 1 处口径**（§2.7：§5 的 328/583 是「非空行」口径，非漂移），并登记 6 项残余风险 R1~R6（§2.8）。原报告 `PASS`（对 `3d9ad49d`）与本增量 `PASS` 合并后，对**当前工作区**成立。

#### 2.1 范围界定（与简报口径的偏差，须记档）

| 项 | 简报 | 实测（`git status --porcelain`） | 处置 |
|---|---|---|---|
| 工作区未提交文件 | 4 个 | **7 个**：4 个代码/文档之外，还有 `plan.md`、`review_report.md`、`verification_report.md` | 多出的 3 个是 docs 收尾文档，**不属本次验证对象**；代码改动仍是 2 个（`GrepTool.cs`、`memory-organization.ts`）✅ 与简报一致 |

增量集合 = ① `MemorySettingsPanel.tsx` ② `ProjectArchivePage.tsx`（`git diff 3d9ad49d a119fd9a` 内，已提交）+ ③ `GrepTool.cs` ④ `memory-organization.ts`（工作区未提交，`git diff` 内）。合计 `git diff 3d9ad49d a119fd9a --stat` 的 6 个文件里，代码 2 个 + docs 4 个；工作区代码 2 个。

#### 2.2 逐项证据表

| # | 增量 | 实测 diff | 取证命令（实跑） | 结果 |
|---|---|---|---|---|
| ① | `MemorySettingsPanel.tsx` 两个 `role="tabpanel"` 补 `aria-labelledby` | `+12 / −2`（总行 345→355） | `Select-String "memory-page-tab"` | ✅ tab 侧 `id={memory-page-tab-${tab}}`（:94）、`MEMORY_PAGE_TABS = ['settings','log']`（:48）与 panel 侧 `aria-labelledby="memory-page-tab-settings"`（:164）/`"memory-page-tab-log"`（:345）**逐一配对**，无悬空 ID |
| ② | memory tab 常驻挂载（`hidden`/`contents`） | `+4 / −3`（总行 375→376） | `Read` 全文 + `Grep` | ✅ 见 §2.3 |
| ③ | `GrepTool.cs` 行尾折叠 | `0 增 / 299 删`，598→299 行、空行 345→46 | `git diff --ignore-blank-lines --ignore-cr-at-eol` | ✅ **零内容改动**，见 §2.4 |
| ④ | `memory-organization.ts` S-93 镜像块前移 | `+19 / −17`，总行 634→636（非空 583→585） | `git diff`（工作区）+ `Read` | ✅ 落点正确，语义见 §2.5 |

#### 2.3 必核点一：常驻挂载是否引入重复 load / 隐藏轮询 / 泄漏 / 依赖挂载语义

读 `ProjectMemoryFileTab.tsx`（191 行）与 `project-archive-helpers.ts` 全文：

- **无重复 load / 无轮询 / 无监听泄漏**：全组件只有 `useEffect(() => { void load() }, [load])`（:71-73），`load` 仅依赖 `path`；无 `setInterval`/`setTimeout`、无 `window.api.on*` 注册、无订阅；其数据源 `readTextFile`/`writeTextFile`（`project-archive-helpers.ts`）都是**一次性 `ipcClient.invoke`**，不注册持久监听 ⇒ 常驻挂载不会累积监听器。
- **挂载/卸载语义未丢**：`key={`memory-${reloadToken}`}`（`ProjectArchivePage.tsx:304`）保留，页头 Refresh（`handleReload` :159-165 → `setReloadToken(+1)`）仍**强制重挂载 + 重读盘**；项目切换走 `memoryPath`（:80 `useMemo`）变化 → `load` 依赖触发重读。
- **布局未变**：`contents`（`display:contents`）使包装 div 不生成盒子，子组件仍是父 flex 列的直接 flex 项，与改动前（组件直接挂在 `flex min-h-0 flex-1 flex-col` 下）一致；`hidden`（`display:none`）隐藏时 `Textarea` 不可聚焦、不进 a11y 树，不产生重复可访问节点。
- **行为变化（可接受，符合改动意图）**：隐藏期间**不再重读盘** ⇒ 若 `MEMORY.md` 被外部（记忆整理/agent 写入）改写，切回 memory tab 看到的是缓存草稿，需点 Refresh；这正是「保草稿」的代价，非缺陷。
- ⚠️ **修复边界未闭合（登记为风险 R4）**：Refresh 或项目切换会在**隐藏状态下**清掉常驻的未保存草稿 —— 改动前草稿在切 tab 时已丢，故**非回归**，但「切 tab 不丢草稿」的承诺不覆盖 Refresh/换项目。

#### 2.4 必核点二：行尾折叠是否零内容改动（自设计取证）

三层证据，全部实跑：

1. **git 语义层**：`git diff --ignore-blank-lines --ignore-cr-at-eol -- <path>` 输出 **0 行**（exit 0）；仅 `--ignore-cr-at-eol` 时仍为 `0 增 / 299 删` ⇒ **被删的 299 行全部是空行**，无任何非空行被删/改。
2. **字节层**（node 脚本，避免 PowerShell 编码干扰）：HEAD blob 与工作区文件的**非空行序列逐字节相同** —— 双方 253 行、`sha256` 均为 `b109eceecdd2ddcf`、首个分歧索引 = `none`、行尾空白 0/0；空行 345→46；总行 598→299。
3. **历史层**（排除「顺手重排版式」的怀疑）：该文件**每个历史提交的仓库形态都带畸形空行比** —— `a119fd9a` 598/345、`dc1a3e75` 598/345、`b05c3734` 432/250、`d407893b` 430/249、`30814e6c` 414/240（空行恒占 ~58%），折叠后为 46/253（15.4%）⇒ 与「CRLF 被按两个换行符拆分后重写」的经典损坏一致，**折叠是恢复原始版式，不是改版式**。

旁证：Agent 项目 `-t:Rebuild` 0 警 0 错、`GrepPatternRegressionTests` exit=0 **21 断言**（S-88 的 glob 匹配器仍在文件内）。

#### 2.5 必核点三：镜像前移（`sinkOutdatedParagraphs` 失败时 DB/MEMORY.md 不一致 + 幂等性）

读工作区 `memory-organization.ts:383-405`、`sinkOutdatedParagraphs`（:271-325）、`memory-hot-sync.ts`（96 行）全文：

- **落点正确**：镜像块（:388-399）现位于 `no_changes` 早退（:401-405）**之前** ⇒ 稳定态 `MEMORY.md` 每次整理都会尝试镜像，正是修「稳定后镜像永不再跑」。
- **幂等成立**：`mirrorHotParagraphsToDb` 先 `memoryEntries`（`memory/entries`，**不带 status 谓词**，含 warm/cold）→ `known` 归一化后「互相包含」判重（`memory-hot-sync.ts:68-76`），命中即 `continue`；重跑应 0 新增，且无重复插入（`test:settings-tabs` 类断言不涉及此链，需真机复跑，见 R2）。
- **同一轮不会重复插入**：镜像只 append **最终稿中存在**的段落；sink 只 append `outdatedParagraphs` 中**已不在最终稿**的段落（`paragraphStillPresent` 过滤，:276-278）⇒ 两个集合**不相交**。
- **sink / write 失败时的不一致：可接受**。镜像先跑，sink 失败（:415-418）或写盘失败（:422-425）时 DB 已含新镜像行而 `MEMORY.md` 未更新 ⇒ **DB 短时是热文件的超集**。理由：热文件仍是 source of truth，下一轮以文件内容重算并收敛；且「DB 先写、文件后写」的同类不一致在 sink 自身（先 `memoryAppend` 后 `writeTargetContent`）中**早已存在**，非本次引入。
- **可观测性已闭合**：`result.dbSyncError`（:397）在 UI 已暴露（`MemoryExecutionLogSection.tsx:40`，作为 `detail` 触发 amber 边框），`syncedToDb` 聚合进执行记录文案（`memory-organization.ts:586` 的 `N mirrored to DB`）⇒ 手测 M5 可达。刻意**不**把 dbSyncError 并入 `report.error`（:586 / :593 的 `error` 与 `status='error'`）= 镜像失败不阻断整理，与代码注释一致。

#### 2.6 门禁实跑汇总（命令 + 退出码）

| # | 命令 | 退出码 | 结果 |
|---|---|---|---|
| G1 | `dotnet build src/runtime/WishfulClaw.Agent/WishfulClaw.Agent.csproj --nologo -v q` | 0 | 生成成功，0 警告 0 错误 |
| G1b | 同上 `-t:Rebuild`（**强制全量**，排除「增量跳过编译」） | 0 | 生成成功，0 警告 0 错误（3.00s） |
| G2 | `dotnet build tests/WishfulClaw.Tests.sln --nologo -v q` | 0 | 生成成功，0 警告 0 错误 |
| G3 | `npx tsc -p tsconfig.web.json --noEmit` | 0 | 无输出（0 错） |
| G4 | `npx tsc -p tsconfig.node.json --noEmit` | 0 | 无输出（0 错） |
| G5 | `npx tsc -p tsconfig.json --noEmit` | 0 | 无输出（0 错） |
| G5b | `npx tsc -p tsconfig.web.json --noEmit --listFiles` | 0 | 5 个改动的前端文件**全部在程序内**（`memory-organization.ts`/`memory-hot-sync.ts`/`ProjectArchivePage.tsx`/`ProjectMemoryFileTab.tsx`/`MemorySettingsPanel.tsx`）⇒ 类型检查**确实覆盖**改动文件 |
| G6 | 32 个 `npm run test:*`（脚本名由 `package.json` 枚举） | **32/32 = 0** | 0 失败；断言数与既有报告**逐条一致**（`context-cap` 52、`provider-presets` 552/46、`streaming-render-pool` 20045、`ipc-msgpack-routing` 96/272 channels …）⇒ 无既有断言失效 |
| G7 | 11 个 `tests/WishfulClaw.*RegressionTests/bin/Debug/net11.0/*.exe` | **11/11 = 0** | 25 / 72 / **122** / 2 / 42 / 313 / **21** / **31** / passed / 225 / passed，与既有报告一致 |

> **未复现的环境约束（更正简报口径）**：简报称 `dotnet build src/runtime/WishfulClaw.sln` 会因 `WishfulClaw.Worker` PID 23668 锁定 `bin/Debug/net11.0/*.dll` 而 `MSB3027` 失败。实测：该进程**确实在跑**（`Get-Process -Id 23668` → `WishfulClaw.Worker`，`StartTime 2026/9/19 20:04:42`），但 `.sln` **增量构建 EXIT=0，未出现 MSB3027**（未匹配到任何 error/MSB3027/被锁定行）⇒ 该约束**本次未复现**，故 G1（按简报指定的替代路径）与 G1b 都实际跑到了 0 警 0 错。**未对整方案强跑 `-t:Rebuild`**：那会在运行中的 Worker 删除/替换其 `bin` 下 DLL，可能破坏正在运行的实例（且简报已明确指定用 Agent-only 构建替代）；如需整方案 Rebuild，须先停 Worker。

#### 2.7 口径更正：§5 的「328 行 / 583 行」不是漂移

§5 把 `MemorySettingsPanel.tsx` 记为「实测 328 行」、`memory-organization.ts` 记为「583 行」——实为**非空行口径**，与 `plan.md` 的**总行口径**（355 / 636）各自自洽，**不构成文档漂移**（node 实测：`MemorySettingsPanel.tsx` `3d9ad49d` = 345 总/328 非空，`a119fd9a` = 355 总/338 非空；`memory-organization.ts` `a119fd9a` = 634 总/583 非空，工作区 = **636 总/585 非空**，与 `plan.md` 的〔收尾实测 636 行〕一致 ✅）。建议后续统一写「总行/非空行」两个数，避免复核时误判。

#### 2.8 未覆盖项与残余风险

| # | 风险 | 性质/严重度 | 依据 | 建议 |
|---|---|---|---|---|
| R1 | ② 常驻挂载**无自动化断言** | 低（已静态核对+tsc） | 全仓无针对 `ProjectArchivePage` 挂载语义的测试；`test:settings-tabs` 不涉及档案页 | 真机手测 M6（见 §2.9） |
| R2 | ④ 镜像前移 + 幂等**无自动化断言** | 中 | `Grep tests/ -e "memory-organization\|memory-hot-sync\|mirrorHotParagraphs"` → **0 命中** | 建议补纯函数级单测（`extractHotParagraphs` + 判重：第二次 `count=0`），目前只能靠真机复跑 M5③ |
| R3 | ① `aria-labelledby` 无自动化断言 | 低（纯静态属性，id 配对已核对） | 同上，测试套件不含 `memory-page-tab*` | 可加 5 行断言进现有 TS 测试，或真机读屏手测 |
| R4 | Refresh / 换项目会丢弃常驻草稿 | 低-中（非回归，但修复承诺未闭合） | `handleReload` :159-165 无条件 `reloadToken+1` → remount；`memoryPath` 变化 → `load` 重跑 | 可改为「有脏稿时先提示/不刷新」，或登记为已知取舍 |
| R5 | 判重是**子串包含** + `DB_SYNC_SCAN_LIMIT=500` 扫描窗口 | 中（既有逻辑，前移后被**更频繁**触发） | `memory-hot-sync.ts:15/68-76`：新记忆若是既有条目的子串/超串会被永久跳过；单 scope 超 500 条后窗口外重复项可能重复插入 | 建议登记：改指纹（如 `normalizeMemoryText` 精确等值或哈希）并分页读取 |
| R6 | 无真机 UI/E2E（Electron 未启动） | 已知（原报告 §4 M1~M5 保留） | 无 GUI 环境 | 追加 **M6**：① 在 memory tab 输入不保存 → 切「记忆库」→ 切回，草稿仍在；② 点 Refresh → 草稿被清空并重读盘（与 §2.3 行为一致） |

#### 2.9 结论

- 4 处增量**全部复验通过**：2 处 TSX（a11y id 配对正确；常驻挂载无重复 load/轮询/泄漏）、2 处工作区（`GrepTool.cs` 零内容改动；`memory-organization.ts` 镜像前移语义与幂等成立）。
- **0 阻断项**；门禁全绿（Agent 构建 0/0、`tests.sln` 0/0、tsc×3 = 0、`test:*` 32/32、C# 套件 11/11），未发现新 tsc/编译错误，未发现既有断言失效。
- 需记档：R1~R6（其中 R2/R5 建议各开一条轻量待办），§2.6 的环境约束更正（MSB3027 未复现），§2.7 的口径说明。
- 验证期间**只读**：未修改任何源码/配置；仅新建 `.wishful-claw/notes/` 下 3 个取证脚本（`linecounts.js`、`greptool-content-proof.js`、`greptool-history.js`）并写入本节。

---

## 验证（第二批 S-98 ~ S-100，2026-09-20）

> **独立重新验证**，验证对象 HEAD = `53c23c5a`（父提交 `e15ed074`）。验证者未参考实施者自述结论，全部检查项由本机重新执行并留存原始输出。
> 环境：Windows / PowerShell，仓库根 `D:\claw\wishful-claw`；`DOTNET_ROOT=D:\claw\dotnet-sdk`。
> **验证期间零源码改动**；只新建外置构建目录 `D:\claw\_wc_verify_tmp\`（已删除，见 §7）与本节报告。

### 0. 需求与检查点（先读）

读入并作为判据的文件：

- `docs/plans/iter-v2-33/plan.md` 的「## 第二批（S-98 / S-99 / S-100）」节 —— 目标、实施顺序、步骤清单（S99-1~5 / S100-0~3 / S98-1~7）、整体验证检查点。
- `docs/plans/iter-v2-33/raw-requirements.md` 的 S-98（`:1120-1186`）、S-99（`:1217-1271`）、S-100（`:1275-1348`）三节「实施记录」。
- 提交内容：`git show e15ed074 --stat`（8 文件，+657/-16）、`git show 53c23c5a --stat`（11 文件，+339/-162）。工作树 `git status --short` 干净（无未提交改动污染验证对象）。

---

### 1. C# 编译

| # | 检查项 | 实际命令 | 原始结果 | 结论 |
|---|---|---|---|---|
| C1 | 测试 sln 编译 | `$env:DOTNET_ROOT='D:\claw\dotnet-sdk'; & 'D:\claw\dotnet-sdk\dotnet.exe' build tests\WishfulClaw.Tests.sln --nologo -v q` | `已成功生成。 0 个警告 0 个错误`；`EXIT=0` | ✅ 0 错 0 警 |
| C2 | 源码主 sln 编译（外置输出绕过 Worker 锁） | `... build src\runtime\WishfulClaw.sln --nologo -v q -p:BaseOutputPath=D:\claw\_wc_verify_tmp\` | `已成功生成。 0 个警告 0 个错误`；`EXIT=0` | ✅ 0 错 0 警 |

**说明**：简报提到的「主 sln 被运行中的 `WishfulClaw.Worker` 锁 dll ⇒ MSB3021/MSB3027」在本机**以指定替代路径（`-p:BaseOutputPath`）成功绕过**，输出落在外置目录，仓库内 `bin/` 未被写入。未在整方案上跑 `-t:Rebuild`（会删/换运行中实例的 `bin` DLL，属破坏性操作，且非本次要求）。

---

### 2. TS 编译

| # | 检查项 | 实际命令 | 原始结果 | 结论 |
|---|---|---|---|---|
| T1 | web 配置 | `npx tsc -p tsconfig.web.json --noEmit` | 无输出；`EXIT_WEB=0` | ✅ 0 错 |
| T2 | node 配置 | `npx tsc -p tsconfig.node.json --noEmit` | 无输出；`EXIT_NODE=0` | ✅ 0 错 |
| T3 | 根配置 | `npx tsc -p tsconfig.json --noEmit` | 无输出；`EXIT_ROOT=0` | ✅ 0 错 |

---

### 3. C# 回归套件（11/11）

命令：`foreach ($exe in (Get-ChildItem tests\WishfulClaw.*RegressionTests\bin\Debug\net11.0\*.exe | Sort-Object Name)) { & $exe.FullName *> "<tmp>\wc_suite_<name>.log"; "$($exe.BaseName) EXIT=$LASTEXITCODE" }`

| 套件 | exit | 自报断言数 |
|---|---|---|
| WishfulClaw.AgentTimelineRegressionTests | 0 | 25 |
| WishfulClaw.ChannelShellApprovalRegressionTests | 0 | 72 |
| WishfulClaw.ChannelToolVisibilityRegressionTests | 0 | 122 |
| WishfulClaw.CompactionSnapshotRegressionTests | 0 | 269（child `--suite-new`）+ 2（parent）；另 `Summary rolling checks passed: 13`、`Pasted block restore checks passed: 11` |
| WishfulClaw.CronRegressionTests | 0 | child 101 / 14 / 8 + parent 42 |
| WishfulClaw.GoalRegressionTests | 0 | 313 |
| WishfulClaw.GrepPatternRegressionTests | 0 | 21 |
| **WishfulClaw.MemoryRecallRegressionTests** | **0** | **37** |
| WishfulClaw.ProviderHeaderRegressionTests | 0 | `Provider header regression checks passed.`（无数字） |
| WishfulClaw.SessionTaskCascadeRegressionTests | 0 | 225 |
| WishfulClaw.ToolConcurrencyRegressionTests | 0 | `Tool concurrency regression checks passed.`（无数字） |

**结论**：11/11 `exit=0` ✅

#### 3.1 `WishfulClaw.MemoryRecallRegressionTests.exe` 完整原始输出（S-99 落点）

```
PASS: temporary memory database initializes: 
PASS: FTS literal query returns a hit: <memory-recall>
PASS: FTS literal query scores its hit: <memory-recall>
PASS: FTS literal query returns a hit: say "hello"
PASS: FTS literal query scores its hit: say "hello"
PASS: FTS literal query returns a hit: OR token
PASS: FTS literal query scores its hit: OR token
PASS: FTS literal query returns a hit: alpha:beta (gamma)
PASS: FTS literal query scores its hit: alpha:beta (gamma)
PASS: two-character query is served by the LIKE path
PASS: short-query hits carry a synthesised score
PASS: title hit outranks content-only hit for short queries
PASS: multi-keyword CJK query is served by the LIKE path (both keywords are 2 chars)
PASS: AND semantics exclude a row carrying only one keyword
PASS: title-carried keywords outrank body-carried ones despite being older
PASS: score accumulates per keyword
PASS: multi-keyword query with all keywords >= 3 chars hits via FTS
PASS: single-keyword query still matches by substring
PASS: new memory needs injection
PASS: same memory content is skipped
PASS: changed memory content is injected again
PASS: context replacement clears recall deduplication state
PASS: session clear resets recall deduplication state
PASS: global fallback injects when project hits were already present
PASS: global fallback injects one new entry
PASS: global fallback injects the new global entry
PASS: recall searches project variants before global variants after deduplication
PASS: strips recall + time ahead of the user text
PASS: strips memory-update + time ahead of the user text
PASS: strips all three injected blocks
PASS: plain user text passes through unchanged
PASS: text without blocks is untouched
PASS: unrelated tags are preserved
PASS: a message that is only a block strips to empty
PASS: unterminated block is dropped to the end
PASS: timestamp no longer reaches the recall query
PASS: user keywords survive stripping
Memory recall regression checks passed: 37
```

**断言数独立核算**：`Select-String -Pattern '^PASS:'` 计数 = **37**，与套件自报 `passed: 37` 一致。
**S-99 新增子套件**（`RunMultiKeywordSuite`，见 `git show e15ed074 -- tests/.../Program.cs`）共 6 条断言：`hits.Count >= 2`、`AND 排除只带一词的行`、`标题承载词者优先（尽管更旧）`、`score 逐词累加`、`全 ≥3 字符走 FTS`、`单 token 仍按子串命中`。旧基线 31 + 6 = 37 ✔ 与 raw-requirements 的「31 → 37」吻合。

> ⚠️ **偏差 D1**：`plan.md` S99-5 写的是「扩断言（31 → **≥ 38**）」，实际落 **37**，比 plan 口径少 1 条（raw-requirements 写的是 37）。plan 与 raw 两处口径不一致，实施按 raw 落地。**功能断言面（S99-3 要求的 A/B 排序 + score + AND 排除）已全部具备**，差额属文档口径未对齐，非覆盖缺失。

---

### 4. TS 测试脚本（33/33）

命令：从 `package.json` 枚举全部 `test:*` 脚本（`scripts.PSObject.Properties | Where-Object Name -like 'test:*'`）逐个 `npm run <name>`。

**枚举结果：33 个**（与任务描述「当前 33 个」一致）。
**逐个执行：PASS=33，FAIL=0**，全部 `exit=0`。脚本名单：
`background-wake-message, browser-user-agent, channel-account-label, channel-cancel-commands, channel-reply-event-policy, channel-shell-approval, codegraph-availability, context-cap, fallback-chain, free-chat-sites, free-chat-tabs, i18n-coverage, ipc-msgpack-routing, live-cursor, message-timestamp, paste-text, provider-fallback, provider-payload, provider-presets, queued-message-text, renderable-chat-items, selected-file-context, select-file-tags, session-follow-up, session-model-resolution, session-permission-mode, session-todo-batch, settings-tabs, shell-executable, streaming-render-pool, updater-progress, updater-release-notes, updater-state`

其中与本批直接相关的两条原始输出：

- `test:paste-text`（S-100）→ `Paste text checks passed: 7`，7 条 `PASS:` 全绿，`exit=0`。
- `test:i18n-coverage`（S-98 的 S98-7）→ `i18n coverage checks passed: 2`，`exit=0`。

---

### 5. 逐条核实（S-99 / S-98 / S-100 的核心承诺）

#### 5.1 S-99「单 token 行为与改动前一致」—— ✅ 成立（静态逐条对照）

对照 `git show e15ed074 -- .../MemoryFtsService.cs` 与当前 `src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs`（全文 214 行，已通读）：

| 环节 | 改动前 | 改动后 | 单 token 是否等价 |
|---|---|---|---|
| FTS 开关 | `if (q.Length >= MinFtsQueryLength)` | `if (tokens.All(t => t.Length >= MinFtsQueryLength))` | ✅ 单 token 时 `tokens=[q]`，`All(...)` ≡ `q.Length>=3` |
| FTS 查询串 | `BuildFtsLiteralQuery(q)` = `"q"`（内部 `"`→`""`） | `BuildFtsQuery([q])` = `string.Join(" AND ", [BuildFtsLiteralQuery(q)])` = `"q"` | ✅ 逐字节相同（`AND` 只有 1 个操作数时不出现） |
| LIKE 条件 | `(content LIKE @pattern OR title LIKE @pattern)` | `(title LIKE @like0 OR content LIKE @like0)` | ✅ `OR` 交换律等价；绑定值同为 `%q%` |
| score 表达式 | `CASE WHEN title LIKE @pattern THEN 2 ELSE 0 END + CASE WHEN content LIKE @pattern THEN 1 ELSE 0 END` | 同一表达式，仅参数名 `@pattern`→`@like0` | ✅ 语义/数值完全相同 |
| ORDER BY / LIMIT | `CASE WHEN status='active' THEN 0 ELSE 1 END, score DESC, updated_at DESC LIMIT @limit` | 未变 | ✅ |
| 早退 | `string.IsNullOrWhiteSpace(query) \|\| limit<=0` → 空 | 未变（`:37`，在 `SplitTokens` 之前） | ✅ |
| 去重 / 8 词上限 | 不存在 | `SplitTokens` 里 `OrdinalIgnoreCase` 去重 + `MaxQueryTokens=8` | ✅ 单 token 均不触发 |

**结论**：单 token 下 FTS 查询串与 LIKE 条件、score 表达式与改动前等价，成立。
**佐证（行为侧）**：改动前就存在的 6 条单 token 断言（4 条 `FTS literal query …`（含 `"hello"` 引号、`OR token`、`alpha:beta (gamma)` 标点）+ 2 条短查询）在改动后仍全部 PASS，未见行为漂移。
**边界**：这是**静态论证 + 既有断言旁证**，未做「检出 `e15ed074^` 重编译同库对跑」的双版本字节对比（重编译会与运行中的 Worker 争 `bin` DLL），列入未覆盖项 U3。

#### 5.2 S-98 稳定排序 / 分页参数 —— ✅ 全部满足

读 `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.Entries.cs`（全文 132 行，已通读）：

| 承诺 | 实际代码 | 结论 |
|---|---|---|
| `ORDER BY` 带 `id` 破平 | `:98` `ORDER BY updated_at {direction}, id {direction} LIMIT @limit OFFSET @offset` | ✅ |
| `offset` 有 clamp | `:81` `var offset = Math.Max(0, GetInt(parameters, "offset", 0));` | ✅ clamp ≥ 0 |
| `order` 是白名单 | `:85` `descending = !string.Equals(GetString(parameters,"order"), "asc", OrdinalIgnoreCase);` → `:93` `direction = descending ? "DESC" : "ASC"` | ✅ 方向只取自建常量，调用方字符串**不进** SQL |
| `limit` 有上界 | `:19` `MaxEntriesLimit = 200`；`:80` `Math.Clamp(GetInt(parameters,"limit",MaxEntriesLimit),1,MaxEntriesLimit)` | ✅ 另有 `entries-by-status`（`:34`）同款收敛 |
| 新增 `total` | `:109` 返回 `new MemoryEntriesResponse(entries, CountScope(db, scope))`，`:114-119` 独立 `SELECT COUNT(*)` | ✅ |
| 不动共用契约 | `AotMemoryResultTypes.cs:40` `MemoryEntriesByStatusResponse` 未改；`:49` 新增 `MemoryEntriesResponse(List<MemoryEntryRow> Entries, int Total)` | ✅ |
| JsonContext 注册 | `src/runtime/WishfulClaw.Worker/WishfulClawJsonContext.cs:90` `[JsonSerializable(typeof(MemoryEntriesResponse))]`（`List<MemoryEntryRow>` 已在 `:88`） | ✅ |
| 端点仍挂载 | `MemoryModule.cs:30-31` `Register("memory/entries-by-status", …)` / `Register("memory/entries", MemoryEntries)`；两文件同为 `internal sealed partial class MemoryModule` | ✅ |

> **轻微偏差 D2**：`order` 白名单比较用了 `OrdinalIgnoreCase`，即 `"ASC"` / `"Asc"` 也会走升序（plan 原文「只有 `"asc"` 走升序，其余一律降序」）。更宽松，但**不构成注入面**（仍是白名单映射，绝不拼接用户串），且不会产生 `"desc"` 被误判为升序的反向错误。

前端侧（`memory-helpers.ts` / `MemoryEntriesTab.tsx` / `ProjectMemoryLibraryTab.tsx`）：`memoryEntries()` 的 `offset`/`order` 确为**末两个形参**（`:270-271`，默认 `0`/`'desc'`），前 5 参顺序未动（`memory-hot-sync.ts` 等既有 5 参调用点免改，tsc 三配置 0 错为证）；`MemoryEntriesTab` 的 `ENTRY_FETCH_LIMIT` 已消失，`load()` 改请求驱动（`PAGE_SIZE=20`、`offset=(page-1)*PAGE_SIZE`、`order` 下推服务端），`total` 驱动 `totalPages`；重置页码的 `useEffect` 依赖已从 `rows` 改为 `[hits, newestFirst]`（`:166-168`，注释写明原因）；`ProjectMemoryLibraryTab` 同样服务端分页 + 切项目重置页码。

> **轻微偏差 D3**：`MemoryEntriesTab.tsx:121` 的 `load(page, newestFirst)` 用**未 clamp** 的 `page`（渲染用的是 `currentPage = Math.min(page, totalPages)`）。UI 上 Next 按钮已 `Math.min(totalPages, prev+1)`、Refresh 用 `currentPage`，故正常操作不可达；仅当底层数据在他处缩减时理论上会请求到空页。低危，登记备查。

#### 5.3 S-100 测试「确实在测东西」—— ✅ 非恒真

读 `tests/paste-text/program.ts`（60 行）与 `src/renderer/src/components/chat/InputArea/use-composer-interactions.ts` 的 `composePastedText`（`:69-77`）：

- 断言框架：`assert(cond, name)` 在 `!cond` 时 `console.error` + `process.exit(1)`，**失败即非零退出**（`npm run` 会红）——不是只打印的恒真式。
- `composePastedText('from plain', '<b>ignored</b>', mustNotBeCalled)` 里 `mustNotBeCalled` **抛异常**：只要实现去碰 HTML 味道就会炸，这条真实钉住「plain 优先且不调 html 转换」。
- 每条断言都比较**函数实际返回值**（`assertEqual` 用 `Object.is`），无 `assert(true)` 之类的自证。
- 唯一冗余项：`'the html fallback yields insertable text'`（`.length > 0`）与上一条 `assertEqual('stub:…')` 部分重叠；但它仍是**对真实返回值的断言**（若回退返回空串会红），属冗余而非恒真。
- **独立复算**：我在工作路径外临时目录用 `esbuild --bundle --platform=node --alias:@renderer=./src/renderer/src` 打包了一段自写探针（非仓库测试），直接调真实导出函数：

```
PROBE OK: plain empty + html empty -> empty
PROBE OK: null/null -> empty
PROBE OK: plain wins
PROBE OK: html fallback via stub
PROBE OK: exposes the real default (arity 3, optional)
PROBE TOTAL=5
PROBE_EXIT=0
```

与仓库自带 7 条断言的行为一致 ⇒ **断言反映真实行为，非恒真**。`handlePaste`（`:128-132`）确认改调 `composePastedText(getData('text/plain'), getData('text/html'))`，`if (!plainText) return` 保留（不 `preventDefault`），`execCommand('insertHTML')` 与受控兜底路径按 diff **未改动**；`shouldCollapsePaste(plainText)` 吃的是**提取后**文本（S100-3 达成）。

---

### 6. 文件行数红线（AGENTS.md ≤ 500）

`[System.IO.File]::ReadAllLines().Count` 与 `(Get-Content).Count` **两种量法都报**（任务指出的 `\r\n\r\n` 畸形行尾在这 5 个文件上**不存在**，两法结果完全一致）：

| 文件 | ReadAllLines | (Get-Content).Count | 字节 | 红线 | 结论 |
|---|---|---|---|---|---|
| `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.cs` | 402 | 402 | 18739 | ≤500（plan S98-1 另要求 ≤420） | ✅ |
| `src/runtime/WishfulClaw.Worker/Modules/MemoryModule.Entries.cs` | 132 | 132 | 6618 | ≤500（plan S98-1 另要求 ≤150） | ✅ |
| `src/runtime/WishfulClaw.Workspace/Memory/MemoryFtsService.cs` | 214 | 214 | 10528 | ≤500 | ✅ |
| `src/renderer/src/components/settings/MemoryEntriesTab.tsx` | 347 | 347 | 13010 | ≤500 | ✅ |
| `src/renderer/src/components/chat/ProjectMemoryLibraryTab.tsx` | 195 | 195 | 7207 | ≤500 | ✅ |

**本批所有触碰文件均 ≤ 500 行；`MemoryModule.cs` 由 495 → 402（降价），`MemoryModule.Entries.cs` 132 ≤ 150，全部兑现 plan S98-1。**

---

### 7. 汇总表

| # | 检查项 | 命令/方法 | 结果 | 结论 |
|---|---|---|---|---|
| C1 | `tests/WishfulClaw.Tests.sln` 编译 | `dotnet build … -v q` | 0 警 0 错，exit 0 | ✅ |
| C2 | `src/runtime/WishfulClaw.sln` 编译（外置输出） | `… -p:BaseOutputPath=D:\claw\_wc_verify_tmp\` | 0 警 0 错，exit 0 | ✅ |
| T1~T3 | tsc 三配置 | `npx tsc -p {web,node,root}` | exit 0 / 0 / 0，无输出 | ✅ |
| R | C# 回归套件 | 11 个 exe | **11/11 exit=0** | ✅ |
| R-M | MemoryRecall 套件 | 同上 | **37 断言全 PASS**，独立计数 37 | ✅ |
| P | TS 测试脚本 | 33 个 `npm run test:*` | **33/33 exit=0** | ✅ |
| V1 | S-99 单 token 等价 | 读 diff + 现码逐条对照 | FTS 串/LIKE 条件/score 等价 | ✅ |
| V2 | S-98 稳定排序+参数收敛 | 读 `MemoryModule.Entries.cs` | `id` 破平 / offset clamp / order 白名单 / limit 上界 / total 全在 | ✅ |
| V3 | S-98 契约与注册 | 读 `AotMemoryResultTypes.cs`、`WishfulClawJsonContext.cs`、`MemoryModule.cs` | 新 record + 注册 + 路由齐备，共用契约未动 | ✅ |
| V4 | S-100 断言有效性 | 读 `tests/paste-text` + 独立探针 | 非恒真；探针 5/5 复算通过 | ✅ |
| V5 | 文件行数红线 | 两种量法 | 5 文件全部 ≤500，无畸形行尾 | ✅ |
| V6 | i18n 覆盖 | `npm run test:i18n-coverage` | PASS（档案页 `total/prevPage/nextPage/pageOf` 已补，zh/en 对齐） | ✅ |

---

### VERDICT: **PASS**

四项门禁（C# 两 sln 0 错 0 警、tsc 三配置 0 错、C# 回归 11/11、TS 脚本 33/33）全部复现通过；三项需求的核心承诺（S-99 单 token 等价 + 多词 AND + 短词走 LIKE 逐词累加 score；S-98 OFFSET/稳定排序/总数/白名单/上界 + 前端真分页；S-100 HTML 回退 + 纯函数断言非恒真）逐条独立核实成立，无阻断项。

#### 登记：偏差（不影响 PASS，建议记档）

| # | 偏差 | 严重度 | 依据 | 建议 |
|---|---|---|---|---|
| D1 | `plan.md` S99-5 要求「31 → ≥38」，实际 **37**（raw-requirements 写 37） | 低（文档口径不一致） | `plan.md:218` vs 实际套件自报 37；S99-3 要求的功能断言已全部具备 | 对齐 plan 口径为 37，或补 1 条断言 |
| D2 | `order` 白名单用 `OrdinalIgnoreCase`（`"ASC"` 也升序），plan 原文是「仅 `"asc"`」 | 极低 | `MemoryModule.Entries.cs:85` | 无需修（更宽松但无注入面），或对齐注释 |
| D3 | `MemoryEntriesTab.tsx:121` 的 `load(page,…)` 用未 clamp 的 `page` | 低 | `:121` vs `:158`；UI 上不可达 | 可传 `currentPage` 兜底 |

#### 未覆盖项 / 风险登记

| # | 未覆盖 | 原因 | 归属 |
|---|---|---|---|
| U1 | S-98「跨页不重不漏」 | 依赖 `id` tiebreaker 的运行时行为，无 GUI/E2E 环境；须造同秒写入多行后连翻数页核对 | 真机手测（plan 已列） |
| U2 | S-100「真实剪贴板 `getData` 能否读到文本」+ **真实 `htmlToPlainText`（`DOMParser`）路径** | node 无 `DOMParser`，测试只覆盖注入桩；`getData` 依赖剪贴板来源 | 真机手测（plan N-2 已收窄） |
| U3 | S-99「单 token 逐字节一致」的双版本对跑 | 未检出 `e15ed074^` 重编译同库对跑（会与运行中 Worker 争 `bin` DLL）；本次为**静态逐条论证 + 既有单 token 断言全 PASS 旁证** | 可接受；如需强证可在停 Worker 后双跑 |
| U4 | 未在整方案上跑 `dotnet build … -t:Rebuild` | 会删/换运行中 Worker 实例的 `bin` DLL，属破坏性操作且非本次要求 | 环境约束，非代码风险 |
| U5 | 未跑 Electron GUI / 真机交互 | 无 GUI 环境 | 真机手测（M1~M6 沿用） |

#### 验证期间的文件系统改动（可审计）

- **新建**：`D:\claw\_wc_verify_tmp\`（外置 `BaseOutputPath` 构建输出 + `probe.ts`/`probe.cjs` 独立探针）→ **验证完毕已整目录删除**（见下）。
- **新建/追加**：`docs/plans/iter-v2-33/verification_report.md`（本节）。
- **未改**任何源码、配置、既有文档；未 `commit`、未 `push`。

