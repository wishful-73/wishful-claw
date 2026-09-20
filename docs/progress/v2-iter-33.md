# v2-iter-33：S-87~S-106 二十项需求

- 状态：**已收尾**（合并 main + tag `v0.2.33` + Release）
- 分支：`dev/v2-iter-33`（base `main` @ `f6922f6c`，即 v0.2.32 收尾点）
- Plan：`docs/plans/iter-v2-33/plan.md`；原始需求：`raw-requirements.md`
- 产品版本：`0.2.33`
- 日期：2026-09-19 ~ 2026-09-20

## 范围与功能单元

### S-87 定时任务（cron）工具对全局会话开放

全局 PM 此前对定时任务**四项全没有**（创建 / 查看 / 修改 / 查看执行记录）。本轮把 cron 六个工具的 `visibleScopes` 从 `WorkRunsOnly` 放宽到 `GlobalSideAndWorkRuns`，并新增**只读**工具 `CronRuns`（`jobId?` + `limit?`，默认 20）查执行记录。

`CronRuns` **不走 reverse-request** 转发：数据本就在本地，且既有的 `DbCronRunTools.List` 会在「只读」名义下先做 `UPDATE cron_runs SET status='aborted' WHERE status='running'` 误杀在跑任务；改为在 `DbCronRunTools` 上新增不做 orphan 归一化的只读对应方法。cron 工具非 `IsCore`，放宽后只进 `use_capability` 代理、不进 `direct` 工具集。

### S-88 Grep 工具的 `file_pattern` 通配符静默失配

`MatchesFileName` 原来只认 `"*.ext"` 这一种形态，其余一律按**字面文件名**比较 ⇒ `*.ts*` 这类真通配符**静默零命中**，还塌成 `No matches found.` 看不出是被过滤掉的。

改法：新增 `CreateFileNameMatcher`，把 `*` / `?` 译成锚定正则（`IgnoreCase | CultureInvariant`），`"*.ext"` 保留 `EndsWith` 快路径，生产路径只构造一次。`EnumerateSearchableFiles` 同时统计候选数与被 `file_pattern` 拒绝数，**全被拒时**返回带 `file_pattern` 与候选数的提示，不再伪报「无匹配」。补 `WishfulClaw.GrepPatternRegressionTests`（21 断言）。

### S-89 记忆整理持续失败：请求缺 sessionId 被上游 400

自 2026-09-04 起凌晨梳理**一直失败**。根因：opencode-go 的 `x-opencode-session` 头由 C# provider 读 run request 的**顶层 `sessionId`**，而 sidecar 文本请求没传 ⇒ 上游 400。

`agent-bridge-streaming.ts` 的 `runSidecarTextRequest` 新增可选 `sessionId`，缺省用常量 `wishful-claw-sidecar-text` 合成，并透传进 `buildSidecarAgentRunRequest`；四个调用点（记忆整理两处、标题生成、自动沉淀）同受益。另把 catch 分支的真实错误（HTTP 状态 + provider + body 摘要）写进 `result.error`，不再塌成 `llm_unavailable`。

### S-90 记忆页拆成「设置 / 执行记录」两个选项卡

执行记录会一直累加，压在设置页下方不合适。`MemorySettingsPanel` 加 `MemoryPageTabs`（`role="tablist"` + pill；仓库 `ui/` 无可复用 tab 原语，形状抄 `ProviderPanelTabs`），并把执行记录抽成独立文件 `MemoryExecutionLogSection.tsx`。

### S-91 记忆的呈现割裂：每日记忆没有实体，「数据库记忆」没有入口

「每日记忆」**没有实体**（没有任何每日记忆文件，`MemoryStats.DailyCount` 是空壳），而 DB 里的记忆**没有入口**。项目档案页把 `daily` 选项卡换成 `database`「记忆库」，只读列出本项目条目。

配套新增 Worker 端点 `memory/entries`（`memory/entries-by-status` 对空 `status` 返回 `[]`，不能复用）。scope **不在渲染端手拼** `project:ssh:{...}`，而是照 `memoryEntriesByStatus` 范式传 `scope='project'` + `projectId` / `workingFolder` / `sshConnectionId`，由 Worker `GetScope` 解析。

### S-92 记忆召回链缺陷：召回查询被注入块吃掉、只召回一次

时序上 `InjectTransientPrefix` 在召回**之前**把 `<memory-recall>` / `<memory-update>` / `<current_time>` 注进最后一条 user 消息，检索把这整块当成查询词 ⇒ 用户关键词**一个都进不去**（定性比「被稀释」更严重，实测是「替换 + 全灭」）。

修法：新增 `StripInjectedBlocks`，**只作用于喂检索的 query**，不碰 conversation 原文（重复注入守卫依赖原文）；剥完为空则不召回。同时登记「只召回一次」（iteration 1 之后 `PendingMemoryRecall` 置空）为待定案项，本刀不动。

### S-93 自动沉淀的记忆进不了召回检索源（两条链不相通）

召回读 SQLite `memory_entries`，而自动沉淀链走文件（rollout → stage1 → `raw_memories.md` → phase2 → `MEMORY.md`），**不写 DB** ⇒ 两条链不相通。

修法：凌晨梳理（活的 `organizeScope`）在梳理成功后把现役 `MEMORY.md` 的段落**镜像进 DB**（新模块 `memory-hot-sync.ts`），用 S-91 的 `memoryEntries` 判重（`normalizeMemoryText` 双向包含 ⇒ 幂等）。镜像失败**不中止整理**，执行记录补 `N mirrored to DB`。另修：镜像块原本在 `no_changes` 提前 return **之后**，MEMORY.md 稳定后镜像永不跑 —— 已移到 `no_changes` 判断之前。

### S-94 记忆检索主力对中文双字词结构性失效（trigram 下限 3 字符）

`memory_fts` 用 `tokenize='trigram'`，**下限 3 字符** ⇒ 中文双字词查不到；LINE 回退路径又吃整串、同样 0。修法：查询长度 < 3 时跳过 FTS 直走 LIKE；LIKE 路径合成相关度 score（title 命中 2 / content 命中 1）、`hasScore: true`、`ORDER BY score DESC` + `updated_at` 破平。

### S-95 压缩「越压越多」：未实现「摘要前的消息全部滚蛋」（滚动摘要）

32 迭代后手动压缩越压越多、自动压缩压不动。根因：`CompactAsync` **从未实现滚动摘要** —— `PinnedPrefixLen` 把连续旧摘要 pin 进 head、`PartitionFold` 第一条判据把摘要归 kept，旧摘要永不进 fold ⇒ 摘要 1→2→…→53 条单调累积（实测 53 条 / 324,874 字符占 wire 98.3%）。

改法：

- `PinnedPrefixLen` 只 pin system + 首条 user（旧摘要不再 pin）
- `PartitionFold` 摘要**全进 fold**，`IsSmallUserTurn` 补 `!IsCompactionSummary` 守卫
- 结果构造按 `summarizerFailed` **双路径**：成功 = head + kept 小 user + 最近一条摘要 + tail；失败 = 保留旧摘要 + 用户原话 + 机械摘要
- 成功判据由**条数改 token 估算**；成功后 `ResetCompactionWatermark`（原 `MarkCompactionWatermark` 是 `Math.Max` 只增不减）

实测 53 条残留会话首次压缩**自愈**（→ 1 条摘要），无需数据迁移。补 `SummaryRollingChecks`（13 断言）。

### S-96 全局记忆页扩容：新增「热记忆」与「记忆库」两个选项卡

全局会话的热记忆与全局记忆都是**跨会话共享的全局资产**，此前在设置页没有任何 UI 入口。`MemorySettingsPanel` 从 2 个选项卡扩到 4 个（设置 / 全局记忆 / 记忆库 / 执行记录）。

- 新增 `MemoryHotTab.tsx`：全局热记忆**可编辑**（读 `memory/read` 整份、存 `memory/write` 整份覆盖，带保存 / 重置 / 未保存标记）。
- 新增 `MemoryEntriesTab.tsx`：全局记忆库**只读** + 搜索。
- 顺带修 `memory-helpers.ts` 里 `memoryRead` / `memoryWrite` 的**死形参**（`sections` / `section` 从未生效，两函数零调用点）。

### S-97 记忆库列表呈现：按修改时间 / 默认收起 / 分页

三条实测反馈：按修改时间排（用 `updated_at`）、行默认收起只留标题（点击展开）、支持分页。

### S-98 记忆库真分页：`memory/entries` 补 `OFFSET` 与稳定排序

S-97 的客户端分页在超 200 条时**翻不到尾**。改为服务端分页：`memory/entries` 加 `offset` / `order`（白名单仅 `"asc"`，否则 `"desc"`）/ `limit`（clamp ≤ 500），SQL 改 `ORDER BY updated_at {dir}, id {dir} LIMIT @limit OFFSET @offset`（加 `id` 破平），返回 `MemoryEntriesResponse(entries, total)`。

`MemoryModule.cs` 拆 `partial`（搬出 `MemoryModule.Entries.cs`，主文件 495 → 402 行）。两个列表改服务端分页（`PAGE_SIZE = 20`）。

### S-99 记忆检索不支持多关键词：整条查询被当成单一短语，多词必然零命中

`BuildFtsLiteralQuery` 把整条查询包成 FTS5 短语，而 trigram 下短语 = 字符级连续子串 ⇒ 空格分隔的多词**必然零命中**；LIKE 回退吃同一整串、同样 0。

改法：新增 `SplitTokens`（空白拆词、去空、保序去重）+ `MaxQueryTokens = 8`；FTS 路开关改为「所有 token 长度 ≥ 3」；查询串拼成 `"t1" AND "t2"`；含短词时整条走 LIKE 逐词 `(title LIKE ? OR content LIKE ?)` AND，score 逐词累加。单 token 行为与改前一致。

### S-100 输入框（composer）常规 Ctrl+V 无反应

`handlePaste` 只读 `getData('text/plain')`，为空即 `return` **且不 `preventDefault`**；受控编辑器吞掉浏览器默认插入 ⇒「没反应」。而应用内的剪贴板增强会把剪贴板**重写成纯文本**再注入真 Ctrl+V，所以走它之后常规粘贴就正常了。

改法：新增纯函数 `composePastedText(plain, html, htmlToText?)` + `htmlToPlainText`（`DOMParser`、块级补换行），`handlePaste` 改走它 —— `text/plain` 为空时回退 HTML，不再直接 return。补 `tests/paste-text`（7 断言）。

### S-101 记忆库支持按时间筛选

记忆库加时间筛选（按 `updated_at`），UI 快捷区间：全部 / 今天 / 近 7 天 / 近 30 天，搜索链一起支持。

- 新增 `MemoryTimeFilter.cs`（Workspace 层纯函数，Worker 端点与搜索链共用；放这层是因为 Worker 端点函数是 `private static` 且无测试工程引用 Worker）。
- `IMemorySearch.SearchAsync` 加 `from` / `to`，FTS 路与 LIKE 路各自带区间。
- `CountScope` **同步带同一条件**（少了它「共 N 条」按全量算）。
- 新增 `memory-time-range.ts`（按**本地日**切边界）+ `tests/memory-time-range`（13 断言）。

### S-102 沙箱模式不允许应用数据目录：全局 PM 读不了自家日志

全局 PM 想读自己的日志（`~/.wishful-claw/logs/`）被沙箱拒绝。`PathBoundary.ResolveRoots` 原来只有「项目 `workingFolder`」和「全部项目 `workingFolder` 并集」两类根，一根都没有时**不拦**。

改法：拆成 `CollectProjectRoots`（算会话自己的根）+ `WithDataRoot`（纯函数，追加**本实例数据根**）两层。数据根走 `WishfulClawDataDir.Root`（认 `WISHFULCLAW_DATA_DIR`，Worker 由主进程注入）⇒ **开发实例只看 `.wishful-claw-dev`、打包版只看 `.wishful-claw`**，不互相串。

⚠️ **语义翻转**：根集合不再为空，「一个项目都没有 ⇒ 随便访问」变为「只能访问数据根」。

### S-103 工作目录父目录 + 全局 PM 项目创建工具

给全局 PM（含渠道会话）暴露 `create_project`，并约束只能在用户设定的**父目录**下创建；该父目录同时作为全局会话的**额外沙箱允许根**。

- 新增 `ProjectsParentDirectory.cs`（配置键 `projectsParentDir`，`Read()` 恒返回生效绝对路径，默认 `~/WishfulClawProjects`，父目录不存在自动创建且工具返回回显最终路径）。
- 新增 `ProjectCreationPolicy.cs`（全限定父目录校验 + 保留设备名检查）—— **落点纯函数**（工具参数里没有路径，沙箱看不到它，边界全靠这一个函数）。
- `create_project` 工具 `GlobalSideOnly`（渠道会话经 `AgentRunContextPolicy` 强制 `global`，天然覆盖）；**只建一级子目录**，路径由服务端拼；不带 `sshConnectionId`（SSH 另开需求）。
- `PathBoundary` 的**全局分支**追加父目录（`WithDataRoot` 一字未动，避免泄漏进项目会话）。
- **用户从 UI 建项目不受任何约束** —— 约束按创建者分、不按表分，**零表结构改动**。
- 同 `working_folder` 查重从 SQL `=` 改为 C# `OrdinalIgnoreCase` + 忽略尾随分隔符（agent 侧路径经 `GetFullPath` 归一化、用户建的可能只 `Trim`，会指向同一物理目录）。
- 设置页新增「工作目录父目录」section（浏览 + 过宽路径 warning + 恢复默认）。

### S-104 主窗口显示/隐藏快捷键 + 开机启动静默

拆成两件独立的事：

- **A 主窗口快捷键**：设置页「快捷键」新增第三项（主窗口显示/隐藏），**默认不给加速键**；托盘标签改为「显示/隐藏主窗口」。显示分支必须先 `show()` 再 `forceActivateWindow`（`Activate` 只处理最小化，对 `hide()` 掉的窗口无效）。
- **B 开机启动静默**：登录项带 `--hidden`、静默启动发一条系统通知；开关默认**不静默**（「没有设置的用户默认是显示的」，显式 opt-in 才 tray-only）。`setLoginItemSettings` 收敛到唯一入口 `applyLoginItem`，启动时对账让存量装机自愈。

新增 `startup-flags.ts`（零 Electron import，纯 node 可测）/ `main-window-visibility.ts` / `main-window-config.ts` + `tests/startup-flags`（5 断言）。`src/main/index.ts` 同步拆出 `dialog-handlers.ts` / `worker-forward-handlers.ts`（638 → 455 行）。

⚠️ **挂账**：开机静默开关的真机验证未做（老大「这个要后面看情况了」）。

### S-105 AI 服务商详情页两处交互收口

- 「拉取模型」在 API Key 为空时禁用，模型列表提示改为「请先输入 API Key 后尝试重新拉取」。
- 协议类型与自定义请求头一样改成**默认折叠**的折叠块。

新增公共组件 `CollapsibleSection.tsx`（手写折叠，不走 `ui/collapsible`），模型区整体抽成 `ProviderModelsSection.tsx`，`ProviderConfigPanel.tsx` 771 → 311 行。

⚠️ **本刀引入并已修的真 bug**：复用 store 的 `isProviderAuthReady` 时，该函数对 `authMode !== 'apiKey'` 无条件返回 false，而 Codex / Copilot / Kimi 三个内置服务商是 `requiresApiKey: false` + `authMode: 'oauth'` ⇒ 其按钮被永久禁用（功能回退）。判据改为 `provider.requiresApiKey === false || isProviderAuthReady(provider)`。

### S-106 项目档案「记忆库」补搜索

项目档案「记忆库」补搜索条件，与全局记忆库对齐（双源：空查询走 `memory/entries` 浏览，非空切 `memory/search`）。同时补**默认收起行折叠**与枚举文案 i18n。

顺带修 `memory-helpers.ts` 里 `MemorySearchResult` 的类型声明：原声明 `{ key, title, content, scope, tier, score, updatedAt }` 与 C# wire（`Id / Title / Content / Scope / Priority / Status / UpdatedAt / Score`）不符，`key` / `tier` **在 wire 上根本不存在**，导致两个既有消费方渲染出 `undefined`。订正为 `id / priority / status`。

另修聊天窗底部终端面板滚动条过粗：xterm 6.0.0 自带 `SmoothScrollableElement` 把 `verticalScrollbarSize` **内联写死 14px**，全局 `::-webkit-scrollbar` 无效 → 针对性覆写为 5px。

## 提交

28 刀。需求 20 项而提交多于需求，因为过程中按「审查与验证修复调整」独立成刀，另有工程卫生与文档收尾刀：

- 需求刀：S-87 ~ S-106 各一刀。
- 收尾修复刀：`a119fd9a` / `9c247595`（批一）、`1a36cf8c`（批二）、`cc4c7ffc` + `1879e27a`（S-103 审查与验证修复调整）。
- 文档/卫生刀：`28f32b8e`（结构信息移出 `AGENTS.md`、提交与推送拆分）、`0cdba5bf`（S-103 验证报告落盘）、`99ab22b9`（工程卫生与文档收尾）。
- 迭代总规模：125 files changed, 12369 insertions(+), 2329 deletions(-)。

## 门禁

- TypeScript 三配置 0 错误（`npm run typecheck`）
- C# 两 sln 0 警告 0 错误
- `npm test` 聚合脚本 **45/45 通过**（33 个 TS 脚本 + 11 个 C# 回归套件 + 编译）
- 触碰文件行尾与 BOM 全 clean

## 已知限制

- **S-104 开机静默开关**的真机验证未做（老大「后面看情况」）。
- **S-92 只召回一次**：首次 API 调用后 `PendingMemoryRecall` 置空，多轮对话中不重复召回；本轮只修了「查询被注入块污染」，频率问题未定案。
- **S-102 的代价**：放行整个实例数据根后，agent 可读写 `config.json`（含 API Key）与 `index.db`；「生产实例只放行 `.wishful-claw`」只能在打包版真机验。
- **S-103 只支持本地目录**（不带 `sshConnectionId`），SSH 项目的创建另开需求。
- 沙箱仍只覆盖**工具参数里的路径**，命令行内部与 OS 级隔离不在范围内（v2-iter-32 S-79 的既有边界）。
- 若干记档未开刀项：`ToolDispatchRouter.cs` 573 行、`memory-organization.ts` 634 行、Grep 正则超时、`projectArchive.tabs.dormant` 孤儿 key、`memory-files.ts` daily 三函数、`DailyCount` / `TopicsCount` 死字段、cron `CronRuns` 跨会话权限面、sidecar 共用合成 sessionId、5 个 C# 套件跑完不自清目录（`npm run test:clean` 兜底）。
