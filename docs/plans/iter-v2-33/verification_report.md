# iter-v2-33 独立验证报告（verification_report.md）

> 验证者：独立验证 subagent（只读验证，未改动任何代码；仅写本报告）
> 时间：2026-09-19 19:39~19:45 (+08:00)
> 仓库：`D:\claw\wishful-claw` ｜ 分支：`dev/v2-iter-33` ｜ base `main` @ `f6922f6c`
> 本迭代提交：`dc1a3e75`(S-88) `42232cbf`(S-92) `7f7d3990`(S-94) `48e0d05f`(S-87) `102fe81a`(S-89) `84dee523`(S-90) `146b1fb2`(S-91) `3e5d2aa9`(S-93) `3d9ad49d`(审查修正)
> 环境：Windows / PowerShell 7（shell=powershell.exe）；`DOTNET_ROOT=D:\claw\dotnet-sdk`，SDK `11.0.100-preview.7`；Node `v24.14.1`
> 范围说明：`022111c0` / `0c354cb9`（S-95）**不在本次验证范围**。

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
