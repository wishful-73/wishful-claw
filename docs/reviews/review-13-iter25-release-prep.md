# review-13 · v2-iter-25 正式版发布前全面审查

- 基线：`main` @ `0199aa5`（v2-iter-24 合并），产品版本 `0.2.24`，tag `v0.2.24`
- 日期：2026-09-05
- 方式：6 路并行审查（iter-24 遗留复核 / 发布链路 / 代码健康度 / 运行时健壮性 / 产品表面 / 安全隐私），吃重结论逐条按符号 grep 当前工作树二次实证
- 性质：**只读审查，未改动任何业务代码**

---

## 结论

0.2.24 作为测试版可用，但**不具备 1.0 对外发布条件**。阻断项集中在 7 组，其中 3 组是硬门槛：

1. **安全**：渲染端 XSS → 本机 RCE 的链条完整存在，且渠道入站消息默认落进「免审批 fullAccess」会话——陌生人发一条消息就能驱动本机 Bash。
2. **可运维性**：打包版日志级别为 `error`，而 Worker 崩溃与退出只写 `warn` → 外部用户反馈问题时**磁盘上没有任何线索**。
3. **发布链路**：自动更新端到端从未实跑、无 CI、无代码签名、E2E 脚本指向不存在的目录、老用户 DB 迁移不可回滚。

另有一批「门面级」缺陷会让 1.0 第一印象很差：侧栏与导航里整套占位页、已实现却未挂载的新手引导与 Git 页、辅助窗口完全无 i18n、README 是开发者 README。

**建议 iter-25 定位**：安全与发布链收口（出 RC），产品表面与文档门面并行推进，质量账（BOM/死代码/吞异常）只挑高 ROI 项，超长文件拆分和 i18n 键清理明确推到 1.1 之后。

---

## 1. 阻断项（不修不能发 1.0）

### B1 安全 · XSS → RCE 链

| # | 缺陷 | 证据 | 后果 |
|---|---|---|---|
| S1 | `setWindowOpenHandler` 无条件 `shell.openExternal(details.url)` | `src/main/index.ts:119-122` | 绕开已实现的协议白名单（`src/main/ipc/misc-handlers.ts:115-130`），`file:`/`ms-msdt:` 可拉本地处理器 |
| S2 | Mermaid `securityLevel:'loose'` + `dangerouslySetInnerHTML` | `src/renderer/src/lib/preview/viewers/MermaidBlock.tsx:27,69` | Agent 或注入产出的 mermaid 代码块可在渲染端直接执行 JS |
| S3 | 全仓无 `will-navigate` 拦截；markdown 非 http href 不 `preventDefault` | `markdown-renderer.tsx:345-352` | 顶层窗口可导航到 `file://`，且仍带 preload 桥 |
| S4 | HTML 预览 `sandbox="allow-scripts allow-same-origin"` | `html-viewer.tsx:35` | 等同无沙箱，可读父窗口 |
| S5 | preload 通用透传：`invoke(channel,payload)`、`workerRequest(method,params)`、整体暴露 `electron`（含 ipcRenderer） | `src/preload/index.ts:39-44,86` | 渲染端一旦 XSS，可调任意 IPC handler |
| S6 | `fs:read-file/write-file/delete/move` 接受任意绝对路径，零越界校验 | `src/main/ipc/fs-handlers.ts:69-191` | 任意文件读写删 |
| S7 | `terminal:create` 携带 `command` → node-pty spawn；`ssh:exec` 任意远程命令 | `terminal-handlers.ts:467,318-323`；`ssh-handlers.ts:105` | S2+S5 串起来就是本机 RCE |

S1/S2/S3/S4 是**小改动 closes 大洞**（合计 1 天内），S5/S6/S7 需要一次 IPC 面收敛设计（见 FU1）。

### B2 安全 · 渠道入站 = 免审批执行（产品级最危险）

- `src/renderer/src/stores/settings-store.ts:367` 出厂默认 `coworkDefaultPermissionMode:'fullAccess'`，`:165-168` 迁移兜底仍给 fullAccess。
- `src/renderer/src/hooks/use-channel-auto-reply.ts:160` 把微信/飞书入站消息送进该模式会话。
- `src/runtime/WishfulClaw.Agent/Modules/Channels/channels/auto-reply.ts:101-141` 入站文本**无 untrusted 包裹**（对比记忆注入侧已做：`Workspace/Memory/MemoryRecallService.cs:80`）。

后果：**给用户的机器人发一条消息，即可在用户机器上免审批执行命令。** 修法三件（缺一不可）：渠道/Cron/分派会话强制 `default`；入站文本包 untrusted 标记；渠道会话默认禁用 shell/write 类工具或按会话二次确认。

### B3 安全 · 审批与路径边界

- 子 Agent 免审批：`ToolCallProcessor.cs:521-530,566` `SubAgentApprovalTools` 为空集，配合 `SuppressTransportEvents` → `default` 模式对子 Agent/Goal 子任务完全无约束（UI 未告知，用户会误当沙箱）。
- `ToolHelpers.cs:54-68` `ResolveFilePath` 不约束 workingFolder，无 `..`/符号链接/敏感路径（`~/.ssh`、SAM、`.env`）防护，`FileReadTool.cs:59`、`FileWriteTool.cs:28` 直接用。
- 审批白名单只 8 个名字（`ToolCallProcessor.cs:537-545`），`BrowserEvaluate`、`CronAdd/CronCreate`（可植入持久化定时 Agent 运行）、`PluginSendMessage`（可向外部群外发）均免审批。
- WebFetch 无内网/元数据过滤且允许 5 跳重定向：`AgentRuntimeWebFetchExecutor.cs:60,116-117` → `localhost`/`169.254.169.254`/`192.168.x` GET SSRF。
- API Key 明文 JSON 落盘 `~/.wishful-claw/ai-provider/`（`src/main/lib/ai-provider-store.ts:40-53`，Windows 下 `mode:0o600` 无效），`ai-provider-handlers.ts:28` 全量回传渲染端；同产品内 SSH 私钥已走 `safeStorage`（`src/main/ssh/repository.ts:81`）——两者标准不一致。

> 注：「SSH 凭据回传渲染端」是老大已裁定的有意设计（本地单用户），本项**不再作为问题提出**。但 API Key 与之不同：它会随每次请求进 header，且日志/诊断端点更易带出，值得单独定策。

### B4 可运维性 · 生产日志链断裂

- `src/main/lib/logger.ts:27` 打包版 `MIN_LEVEL='error'`，`:92` 低于该级别直接 return。
- Worker 侧全部诊断走 `warn`：`src/main/lib/native-worker.ts:209-215`（stderr → `logWarn('worker', …)`）、`:218-221`（`Worker exited: code=X signal=Y` → `logWarn`）。

后果：**发出去的包里，Worker 崩溃原因、崩溃栈、退出码一条都不会落盘。** 外部用户只能口述「卡住了」。这是支持成本与缺陷定位能力的门槛项。

配套缺口：日志按日期切文件成立（`logger.ts:55-60`），但无旧文件清理、无大小上限，且 `appendFileSync` 同步写。

### B5 可靠性 · Worker 失活用户无感 + 重启无熔断

- `closeWorker` 只 kill + reject pending（`native-worker.ts:396-419`），**不通知渲染端** → 崩溃那一轮 `loop_end` 永不到达，卡片永久「进行中」，无横幅无提示。
- 现成探针 `isNativeWorkerRunning()`（`:532`）与 `agentBridge.isRunning()`（`src/renderer/src/lib/ipc/agent-bridge.ts:56-63`）**全仓零调用方**。
- 重启只有惰性 `ensureStarted()`（`:74-82,100`），无退避、无崩溃计数。叠加 Goal 启动即从 DB 恢复全部 active goal（`WishfulClaw.Worker/Modules/GoalModule.cs:45-66`）→ 若崩溃由某个 goal 触发，会形成「重启→恢复→再崩」循环拉起。**需实测验证**。
- 渲染进程崩溃只写日志（`src/main/index.ts:114-118`），根 `ErrorBoundary.tsx:26-35` 是裸红字堆栈无 reset（带 Try again 的 `error-boundary.tsx` 反而零引用）→ 崩溃后永久白屏。

### B6 无人值守审批门（1.0 用户最容易踩）

- `nonInteractive` 只豁免 AskUser：`ToolDispatchRouter.cs:30-37`（返回工具错误让模型自主继续）。审批门 `ToolCallProcessor.cs:396` **完全不查该标志**。
- `cron-runtime.ts:416-418` in-session 路径沿用 `targetSession.permissionMode` + 传 `nonInteractive:true`；只有 sidecar 路径 `:490` 硬编码 `fullAccess`。
- 反查审批有 30 分钟上限、窗口 closed 快速失败（`src/main/ipc/native-agent-runtime.ts:29-37,220-236`）→ 不会真永久挂起，但整轮以 error 结束；窗口 hide 到托盘时用户根本看不见有审批在等。
- `AutomationTaskFormDialog.tsx:450-454` 仍向用户展示「YOLO（自动批准）」+「执行期间默认不请求工具确认」（`locales/zh/layout.json:366-367`），与上述实现不符 = **UI 承诺与行为不一致**（即 I24-11）。
- 同源问题：Task Board 分派投递沿用目标会话 `permissionMode`（`project-send-message.ts:116`）、`maxIterations: 0` = 无限轮（`:117` → `AgentLoop.cs:220`），且 dispatch 已标 `sent` 并通知全局 Agent，而实际可能正卡在审批门。

### B7 发布链路

| # | 缺口 | 证据 |
|---|---|---|
| R1 | 无代码签名 → SmartScreen「未知发布者」+ 杀软误报；更新完整性只靠 GitHub 账号 + `latest.yml` sha512，账号或发布流程被盗即全体用户 RCE | `electron-builder.yml:120-134`；`docs/in-app-update-plan.md:358` 自认「后续接入 Authenticode」；`AGENTS.md:381` 已有 `win-unpacked/app.asar` 被杀软句柄锁的记录 |
| R2 | 许可合规：打包时删掉 Chromium/Electron 归属载体与第三方 LICENSE | `scripts/after-pack-remove-files.cjs:10`；`electron-builder.yml:92`；`THIRD_PARTY_NOTICES.md` 仅列 OpenCowork+shadcn，vendored CodeGraph（195 个 .cs）完全未署名 → 违反 Apache-2.0 §4 |
| R3 | 自动更新端到端从未实跑；dev 环境永不检查更新（`src/main/updater.ts:427`），无 CI 可代跑 | 仓库无 `.github/`；`pack:installer:full` 不含 typecheck/test（`package.json:18`） |
| R4 | 能静默装出坏包：`resources/worker/` 被 gitignore，`pack:installer` 不重编 Worker，`publish-aot-worker.mjs:73-84` 只删 .pdb 不清目录；spawn 失败仅 `logError` 无 UI | `docs/build-guide.md:64` 仅口头提醒 |
| R5 | E2E 覆盖为 0 且脚本是死的：`test:e2e`/`pretest:e2e` → 不存在的 `tests/e2e/`；`test:cron-integration` → 不存在的 `tests/cron-integration/`；`@playwright/test` 已装但无 config/spec | 已实证 `tests/` 只有 6 个 C# 回归项目 + `renderable-chat-items` |
| R6 | 两个回归项目未挂进 sln，`dotnet build` 根本不编译它们 | `WishfulClaw.CronRegressionTests`、`WishfulClaw.MemoryRecallRegressionTests` ∉ `src/runtime/WishfulClaw.sln` |
| R7 | 老用户升级不可回滚：大量 EnsureColumn/UPDATE 直改用户库，无 `PRAGMA user_version`、无备份、失败静默 | `DbClient.cs:445-529`、`:671-674` `catch{}`、`DbClientCompactionSnapshotMigrations.cs:147` 对已有表 RENAME+重建 |
| R8 | 无 RC 灰度通道：`releaseType: release`（`electron-builder.yml:10`）+ updater 用 `split('-')[0]` 剥后缀比较（`updater.ts:59-60`）→ `1.0.0-rc.1` 若发成普通 Release 会推给稳定用户 | 需为 iter-25 的 RC 明确发布策略 |
| R9 | 更新源只有 GitHub，127MB 资产国内基本不可达，失败仅有文案 | `updater.ts:126-129` |
| R10 | 平台范围未裁定：macOS `notarize:false` 未签名未公证；剪贴板回填 `pasteToForegroundWindow` 非 win32 直接 false（静默失效） | `electron-builder.yml`；`clipboard-enhancer.ts` |

### B8 产品门面（外部用户第一眼）

- **占位页死入口一整套**：`MainLayout.tsx:83-91,108-110` 把 Skills/Souls/Sync/Resources/Translate/Draw/CodeGraph/Git/Channels 指向 `PlaceholderPage.tsx:31-33`，并把 `iterLabel: "迭代七"/"后续"` **内部路线图直接展示给外部用户**。可见入口：侧栏 Draw（`WorkspaceSidebar.tsx:192`）、消息操作栏 Translate（`action-bar.tsx:83`、`UserMessage.tsx:160`）、命令面板 Draw（`search-dialog.tsx:551`）、项目首页「打开渠道/打开 Git」（`ProjectHomePage.tsx:129,138`）。
- **已实现却没接上**：`GitPage.tsx`(557) + `GitPage/ScmSidebar.tsx`(619) 完整实现、渲染点为零；`ConversationGuideDialog.tsx`(344，zh/en 文案齐全) 零引用未挂载，且 10 步里 6 步的 `data-tour` 锚点不存在。
- **命令面板 Keyboard Shortcuts 点了没反应**：`CommandPalette.tsx:94-98` 只写 `shortcutsOpen`，无任何组件读取。
- **半成品面板用户可达**：`RuntimeStatusPanel.tsx:8` 显示 "Runtime status — coming soon"（经 `MainLayout.tsx:225` + `ui-store.ts:191` 有导航入口）；`ProjectTerminalDock.tsx:11` 函数体只有 TODO + `return null`，仍被 `ChatHomePage.tsx:328`、`ProjectHomePage.tsx:158` 渲染。
- **onboarding 缺配置服务商步骤**：`SplashPage.tsx:17-26` → `PersonaSelectPage.tsx` 只有 2 步（称呼+人格），无 Key 时靠琥珀横幅引导（`composer-banners.tsx:41-50`），陌生用户第一次发消息只会看到失败。
- **README 是开发者 README**：无下载链接/截图/首次配置/隐私/帮助，Quick Start 是 `npm run dev`，徽章 `.NET-10`（`README.md:20`）与实际钉版 `11.0.100-preview.7`（`src/runtime/global.json:3`）冲突，结尾「自用项目，慢慢打磨」（`:178`）。无 `CHANGELOG.md`。
- **反馈通道零入口**：`AboutPanel`（`SettingsPage.tsx:263-335`）只有版本/特性/检查更新；日志目录 `~/.wishful-claw/logs/` 无 UI 出口，而 `shell:openPath` IPC 已就绪（`misc-handlers.ts:133-145`）。

---

## 2. 高优先（强烈建议进 iter-25）

**运行时**
- 无 per-session 串行化：`chat-store/index.ts:177-220` sendMessage 不检查该会话是否在跑，直接 `isStreaming:true` 起新 run；`SessionConversation.cs:271` 按 sessionId 共享上下文，Worker 只有全局信号量（`LocalIpcWorkerServer.cs:166`）→ **Task Board 向运行中会话分派，会与在跑的 run 交叉写同一上下文**。
- 忙会话下渠道消息静默丢弃：worker 直接报错（`AgentRuntimeTools.cs:76-84`），异常被 `use-channel-auto-reply.ts:117-118` 的 catch 吞掉 → IM 消息不被回复且无提示。**需实测**。
- `SessionConversationManager._sessions` 无容量上限（`SessionConversation.cs:271`），长时间翻阅大量会话＝多份完整上下文常驻。
- 全库仅 1 处 `BeginTransaction`（`DbService.cs:163`）→ 跨语句写非原子。
- `requestMaxRetries=0`（无限）+ 400 视为可重试（`ProviderRetryPolicy.cs:149-174`）→ API Key 失效时静默烧请求。
- DB 无保留策略：`cron_runs`、`goal_events`、memory/FTS 只增不删，无 VACUUM/checkpoint → 数天挂机 `index.db` 单调膨胀。
- 快捷键注册失败不告知：`registerPriorityShortcut` 返回 bool 但 `priority-shortcuts.ts:813-846` 无反馈；`ShortcutsPanel` 仅管 clipboard+launcher 两项，无冲突检测。PowerShell 桥靠 temp 下 `-ExecutionPolicy Bypass`（`:746-747`）→ 对外部用户是杀软/企业策略高危点。
- 子 Agent/Goal 免审批的 UI 告知缺失（见 B3）。

**发布链**
- 文档失真会让新环境无法复现构建：README `.NET-10`；`docs/new-session-prompt.md:121` 日志路径 `%AppData%/WishfulClaw/logs/` **错**（实际 `~/.wishful-claw/logs/`，`logger.ts:45-53`，AGENTS.md 正确）；`docs/build-guide.md:42` 产物名与 `artifactName`（`electron-builder.yml:129`）不符；便携 SDK `D:\claw\dotnet-sdk` 是本机专属（`publish-aot-worker.mjs:52`）。
- 无 Win10 x64 下限检查、未设 `deleteAppDataOnUninstall`；`node_modules` 白名单手工枚举易漏（`electron-builder.yml:42-88`）；`@jitsi/robotjs/prebuilds` 五套平台全入包。

**产品表面**
- 辅助窗口完全无 i18n：`launcher/main.tsx`、`clipboard/main.tsx` 未引入 react-i18next → 英文用户看到全中文。
- OS 通知标题全中文（`chat-store/index.ts:1498-1524`）、托盘菜单中文（`main/index.ts:148,150`）、`ExtensionPanel.tsx`(15 处)、`SubAgentCard.tsx:84,117,128,339,341`、`ThinkingBlock.tsx:109`、`PersonaSelectPage.tsx:315`、侧栏相对时间（`workspace-sidebar-items.tsx:38-48`）。
- `en/settings.json` 缺 32 个 `channel.*` 键（英文渠道字段退化为原始 key）；`en/chat.json` 残留中文；`index.html lang="zh-CN"` 固定且 `documentElement.lang` 从不更新。
- 11 处写死深色孤岛，浅色主题下出现深灰块：`ChangeReviewSheet.tsx:209`、`change-review-helpers.tsx:91,204`、`token-summary.tsx:44,47`、`runtime-status.tsx:566`、`OrchestrationMemberStrip.tsx:46,50`。
- `AgentErrorCard.tsx` 分类做得好（auth/quota/network/timeout/runtimeUnavailable），但**没有「重试」/「去设置」行动出口**，`RetryBanner` 未挂载。

---

## 3. iter-24 移交遗留项复核（按当前代码实证）

| 项 | 结论 | 证据 |
|---|---|---|
| I24-11 automation 权限承诺与实现不一致 | **未修，且比报告更严重** | UI 文案在（`AutomationTaskFormDialog.tsx:450-454`）；cron in-session 沿用会话 permissionMode（`cron-runtime.ts:416-418`）；`nonInteractive` 只豁免 AskUser（`ToolDispatchRouter.cs:33`），审批门不查（`ToolCallProcessor.cs:396`） |
| I24-8 剩余半（tasks/global_tasks 整行覆写） | **未修** | `DbGlobalTaskTools.cs:114-135`、`DbTaskTools.cs:112-136` 仍 QueryFirstOrDefault→ApplyPatch→整行 UPDATE，无事务无版本条件；对比 `DbGlobalTaskDispatchTools.cs:161-177` 已改局部 SET |
| I24-18 剩余半（渠道图片 fetch 无超时） | **未修** | `channel-handler-utils.ts:153`、`:230` 仍无 signal/timeout；仓内已有先例 `feishu-install.ts:71 AbortSignal.timeout(15_000)` |
| §4.4 分派状态回改 sent 覆盖竞态 | **未修** | `AgentRuntimeGlobalTaskExecutor.cs:267-279` 投递返回后无条件写 `sent`；`DbGlobalTaskDispatchTools.cs:175-177` UPDATE 缺状态守卫（同文件 `Cancel:200` 反而有）；投递是 fire-and-forget，目标会话可在写回前跑完并 reply completed |
| status/priority 枚举白名单 | **未修** | `DbGlobalTaskTools.cs:91-92,176-179`、executor `:125-134` 原样透传；dispatch Update 端 kind/status 同样无校验（`:163-165`）；`tasks` 只在读侧 `AgentRuntimeTaskExecutor.Db.cs:52 NormalizeStatus` 兜底 |
| LIKE 通配未转义 | **未修，范围比报告大** | `DbGlobalTaskTools.cs:44`、`DbMessageToolsQueries.cs:169`、`MemoryFtsService.cs:95`、`AgentRuntimeProjectExecutor.cs:59` + CodeGraph 2 处；全仓 `ESCAPE` 0 命中 |
| 缺复合索引 | **未修** | `DbClient.cs:372-373,386-387,403-404` 全单列；实际查询形状 `WHERE archived=0 AND status=? ORDER BY archived,updated_at DESC`；`global_task_dispatches.project_id` 完全无索引 |
| `db:tasks:get:msgpack` 死端点 | **确认无调用方** | 注册 `src/main/index.ts:410`、常量 `binary-ipc.ts:91`，第三处引用 0 |
| `task-store-helpers.ts` 异常静默 | **未修** | `:42,46,50,54` 四处 `.catch(() => {})`，文件内无任何日志 |
| `use-permission-mode.ts:39` 依赖含 `opts` | **未修** | 调用方 `use-composer-mode-state.ts:63-68` 每渲染传新对象 → 回调每次重建 |
| `TaskFormDialog.tsx:88` dueAt 无 NaN 校验 | **未修** | handleSave 只校验 title（`:79-82`） |
| `messageList.pinnedTurnEmpty` 死键 | **确认死键** | 仅剩 `locales/{en/chat.json:949, zh/chat.json:948}`，代码 0 消费方 |
| 真实 Electron E2E | **0 覆盖且当前无法启动** | 见 R5/R6 |

**复核新增（iter-24 新代码）**
- 【高】Task Board 向运行中会话分派无 per-session 串行化（见 §2）。
- 【中】分派列表无 LIMIT：`DbGlobalTaskTools.cs:46`、`DbGlobalTaskDispatchTools.cs:52`，而 dispatch 记录按设计永久保留 → 看板全表拉取。
- 【中】分派 `maxIterations: 0` 无限轮（`project-send-message.ts:117`）。
- 【低】`task-board-store.ts:164-176` 空 patch 仍发一次 update，把整行按刚读值写回并顶新 updated_at → 放大 I24-8 丢写。

> 本报告与 docs/reviews/review-10/11/12 的「待完成」记账不一致时，**以本表为准**。

---

## 4. 质量账（量化）

| 维度 | 实测 | 判定 |
|---|---|---|
| **UTF-8 BOM** | **269 个 tracked 文件带 BOM**（.cs 98 / .ts 67 / .tsx 35 / .md 51 / .json 10 / .csproj 6 / .sln 1），`git status` 干净 = **已提交进仓库**；历史从 156 涨到 269。10 个 .json 全在 `locales/{en,zh}/`。有 `.editorconfig charset=utf-8`，但**无 .gitattributes、无校验脚本/hook** | **必做**，一次性机械改动 + 防回归，ROI 最高 |
| 空 catch / 吞异常 | TS：空 89、无日志吞 156（主进程 52/72，`channel-feishu-handlers.ts` 空 15、`mcp-client.ts` 空 9；`goal-store.ts` 空 10、`task-board-store.ts` 吞 8）；C# 第一方：空 32、吞 68 | 只补最高危 10 处（`FileWriteTool.cs:48` 使 diff/回滚拿错值、`SeedanceVideoTools.cs:103,109`、`XaiVideoTools.cs:111,114`、`OpenAIAudioTools.cs:265,387`、`MediaFileTools.cs:80`、`goal-store` 10 处）；**不**做 245 处全量 |
| 超长文件 | 第一方 C# >500 行 13 个（`ContextCompression`/`DbClient`/`AgentLoop`/`GoalOrchestrator` 均已按职责拆兄弟 partial，只是主文件略超）；TS 51 个，其中 `chat-store/index.ts` **2172 行** god object、`quick-launcher.ts` 1017、`cron-reverse-handler.ts` 757。Provider preset 4 个（868/657/610/571）是**单个对象字面量**，AGENTS.md 明文豁免 | 只拆 3 个真多职责的；CodeGraph 26 个与 preset 清单**不动**；建议顺手在 AGENTS.md 把 CodeGraph 显式排除出 500 行约束 |
| @ts-ignore / eslint-disable | 4 + 5，逐条判定均成立（preload 类型声明、mammoth/react-pdf 可选依赖豁免） | **不排期** |
| **AOT 规范** | 实测近乎 0 违规：`Activator.CreateInstance` 0、`Assembly.GetTypes` 0、裸 `new JsonSerializerOptions()` 0、匿名类型序列化 0、`WorkerResponse.Json(` 267 处缺 JsonTypeInfo **0**、`JsonSerializer.Serialize*` 26 处全带 `GetTypeInfo`；2 处 `using System.Reflection` 均有合理理由（嵌入资源读取、原生库 resolver） | **执行最好的一条，不整改** |
| 命名规范 | C# PascalCase 0 违规；TS 138 个非 kebab-case（组件 PascalCase、lib kebab-case 混用是既成事实，`error-boundary.tsx`/`ErrorBoundary.tsx` 撞名就是后果） | **改 AGENTS.md 那句话**，不改代码 |
| 死代码 | 28 个 0 引用 .ts/.tsx ≈2718 行；8 个无引用 IPC 常量（`SEEDANCE_VIDEO_*`×4、`CODEGRAPH_*`×3、`SSH_CONNECTION_GET_SECRETS`）；可疑无调用方 worker 方法：`config/*`×5、`provider/*`×4、`agent-changes/*`×3、`skills/ensure-builtin`（TS 实际调复数 `ensure-builtins`）、`memory/update`、`git/query-local`、`db/sessions-clear-all`、`db/messages-{add,add-batch,update}`、`db/*-get` ≈19；C# 死类型指标不可靠 | 建议做纯删除部分，`db/*-get` 逐个标「需人工确认」 |
| i18n 键 | 叶子键 3191，无字面量消费 ≈938（29%），但有 70 处动态 `t()` → 上界不可全信；zh/en 键数不齐 | iter-25 **只补缺键**，不批量删键 |
| TODO 断头路 | 全仓标记仅 14 条，其中用户可见真断头路 5 条：`ProjectTerminalDock.tsx:11`、`session-slice.ts:366 clearSessionPromptSnapshot` 空实现但有 **5 个调用方在等**（`plan-store.ts:278,300,318,336,354`）、`RuntimeStatusPanel.tsx:5,8`、`use-chat-actions.ts:585`（0 调用方，直接删）、`lib/utils/export-chat.ts`（0 调用方，删） | **必做**，1.0 硬门槛，每条 ≤0.5 天 |
| 供应链 | `xlsx@0.18.5`（`package.json:86`）含已知 SheetJS 问题，且**全仓无任何 import** = 死依赖，删；`WishfulClaw.CodeGraph` 195 文件 vendored 无 upstream commit 戳与 CVE 跟进策略；electron 43.2.0 / node-pty 1.1.0 / ws 8.21.1 / ssh2 1.17.0 / axios 1.19.0 未见已知高危 | 删 xlsx（S）；CodeGraph 版本戳 + 跟进策略写入 AGENTS.md |
| 隐私 | 无遥测库、无自有域上报，更新检查只泄露版本+IP，日志只落本地（但含用户名绝对路径与会话片段） | 可接受；1.0 需一份面向用户的隐私/数据说明 |

---

## 5. 建议的 v2-iter-25 范围（6 个功能单元）

> 命名与顺序按依赖排；每条都对应上文编号。

**FU1 安全收口（对应 B1/B2/B3）**
- `setWindowOpenHandler` 接协议白名单；Mermaid 改 `strict`；补 `will-navigate`；html-viewer 去 `allow-same-origin`。
- IPC 面收敛：去掉原始 `electron`/`ipcRenderer` 暴露、`invoke`/`workerRequest` 收窄到显式 channel/method 白名单；`fs:*` 加工作目录约束与危险操作确认；`terminal:create` 去 `command` 参数。
- 渠道/Cron/分派强制 `default` + 入站 untrusted 包裹 + 子 Agent 继承审批 + `ResolveFilePath` 越界与敏感路径防护 + WebFetch 私网过滤 + 审批白名单重审。
- API Key 存储定策（safeStorage 或明确公告）。

**FU2 可观测性与可靠性（B4/B5）**
- 打包版日志级别与 Worker 诊断落盘（`worker` 来源单独放行到 error 文件）+ 日志保留/轮转。
- Worker 失活广播 → 渲染端把该会话 run 置失败并提示（复用现成 `isNativeWorkerRunning`）；崩溃计数 + 退避 + 熔断；Goal 恢复延迟确认。
- 渲染进程崩溃恢复 + 根 ErrorBoundary 可重试；`clearSessionPromptSnapshot` 实装（5 个调用方在等）。
- per-session 串行化（Task Board / 渠道 / 分派与在跑 run 互斥）。

**FU3 审批策略统一（B6 + I24-11）**
- 审批门读 `nonInteractive`：非交互运行下自动拒绝（或按工具风险降级），错误透出给模型。
- 撤掉或兑现 UI「YOLO（自动批准）」承诺；dispatch 的 `sent` 语义与权限模式、`maxIterations` 一并校正。

**FU4 发布链路（B7）**
- 代码签名决策落地 + 签名后重验 `latest.yml`/blockmap；THIRD_PARTY_NOTICES 补全（含 CodeGraph、Chromium/Electron），停止删 `LICENSES.chromium.html`。
- 迁移安全：`PRAGMA user_version` + 迁移前 `index.db.bak` + 事务包裹 + 失败可见提示。
- 打包门禁：`pack:installer:*` 串 typecheck + 回归 + Worker 产物存在性/新鲜度断言；2 个回归项目挂进 sln；E2E 要么补 Playwright config + 最小 smoke，要么删掉 3 条死脚本（不留假象）。
- 更新端到端实跑（0.2.24 → 下一版真下载/安装/数据保留）+ 干净 VM 装机 + 卸载重装；RC 发布策略（`releaseType: prerelease` 或 stable-only 定案）。
- 修正文档失真（日志路径、README 版本徽章、build-guide 产物名）。

**FU5 产品表面（B8）**
- 清占位死入口与 `iterLabel`；接回或摘除 GitPage、Keyboard Shortcuts、RuntimeStatusPanel、ProjectTerminalDock。
- onboarding 补「配置服务商」步；挂载并修复新手引导（补齐/裁剪 `data-tour`）。
- README 门面重写 + CHANGELOG；About 加「打开日志目录 / 反馈 / 许可 / 隐私」；`AgentErrorCard` 加行动出口。
- 辅助窗 i18n + OS 通知/托盘中文治理 + 补 32 个 `en/channel.*` 键；修 11 处深色孤岛。

**FU6 数据正确性与质量账（§3 剩余 + §4）**
- I24-8 剩余半（tasks/global_tasks 局部 SET + `updated_at` 乐观条件）；§4.4 dispatch 状态守卫；枚举白名单（含 dispatch Update 端）；分派列表加 LIMIT。
- I24-18 剩余半（2 处 fetch 超时）；LIKE `ESCAPE`；复合索引；10 处高危吞异常补日志。
- BOM 269 清零 + `.gitattributes` + `scripts/check-bom.mjs` 挂 build；删 `xlsx` 死依赖；纯删除类死代码清扫；小项（死端点、`pinnedTurnEmpty`、`[opts]` 依赖、dueAt NaN、`use-permission-mode`）。

**门槛建议**：FU1+FU2+FU3+FU4 = RC 发布的硬门槛；FU5 = 对外可发布门面；FU6 = 稳定性与账面收口。

---

## 6. 需要老大拍板的 4 个决策

1. **代码签名**：买 OV 证书还是用 Azure Trusted Signing？不签的话 1.0 能否接受 SmartScreen 拦截 + 更新链完整性靠 GitHub 账号。（影响 FU4 工作量数天～数周）
2. **1.0 平台范围**：只声明 Windows，还是补 macOS 签名+公证与 Linux？（mac 现在 `notarize:false`，剪贴板回填非 win32 静默失效）
3. **渠道免审批**：陌生人在微信/飞书发消息就能驱动免审批 Bash——是否把渠道/Cron/分派会话强制 `default`，以及是否默认关闭渠道的 shell/写文件能力？（这是 B2 的唯一实质解）
4. **迭代容量**：上面 6 个 FU 总量明显超一个迭代。是「iter-25 = FU1~FU4 出 RC、iter-26 = FU5+FU6 再发正式版」，还是压成一个迭代（则需砍 FU6 大半与 FU5 的选择项）？

---

## 7. 明确不做（避免 iter-25 失焦）

- AOT 整改（实测 0 违规）、@ts-ignore / eslint-disable 治理（9 处全合理）、C# 文件名规范化（0 违规）。
- TS 全量改 kebab-case（138 个 .tsx，成本极高收益为负；正确动作是改 AGENTS.md 命名条款）。
- 空 catch 全量补日志（245 处 → 只做 10 处高危）。
- i18n 938 个疑似无消费方键的批量删除；CodeGraph 26 个超长文件与 Provider preset 清单的拆分。
- 无障碍 44px 热区、focus-visible 全覆盖、9px/10px 字号系统性对比度上调、docs/ 重组为对外文档站 —— 留 1.1。
