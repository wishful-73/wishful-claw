# 迭代 28 验证报告（Z2）

- 日期：2026-09-12
- 分支：`dev/v2-iter-28`（验证时**未 push**）
- 被测对象：7 个需求提交（`c7287b6e` #2、`f9940a56` #1、`6a6ceff2` R-3、`19dc9433` R-1、`fdce236f` #3、`231f1cd5` R-4、`3897f34d` R-2）+ 收尾未提交改动（`review_report.md` 的 9 项 ❌ 修正）。R-1 原有一刀多余补口，收尾已折进 `19dc9433`，改写前整条链留在本地标签 `pre-fold-iter28`
- 验证方式：全部门禁在本会话**重跑实测**（未沿用审查期数字），命令、退出码与计数口径逐条列在下表
- 进验证态的前置：`dev-workflow.md` 阶段五阻断规则「❌ 项 > 0 时禁止进入验证态」——审查 9 项 ❌ 已当场修完并复测，残留 0 → 放行

## 1. 门禁矩阵（实测）

| 门禁 | 命令 | 结果 | 计数口径 |
|------|------|------|---------|
| TS 渲染进程 | `npx tsc --noEmit -p tsconfig.web.json` | exit 0，`error TS` 计数 0 | 重定向到文件后取 `$?`（不用管道尾 `$?`） |
| TS 主进程 | `npx tsc --noEmit -p tsconfig.node.json` | exit 0，0 | 同上 |
| TS 根配置 | `npx tsc --noEmit -p tsconfig.json` | exit 0，0 | 同上 |
| C# 解决方案 | `dotnet build src/runtime/WishfulClaw.sln --nologo -v m` | exit 0，**0 warning / 0 error** | 按诊断码 `: (warning\|error) [A-Z]+[0-9]+` 计数；中文 SDK 打印本地化摘要，英文字面量匹配会得到假的"零警告"。唯一出现的 `NETSDK1057` 严重级是 `message`（预览版 SDK 提示），不计为警告 |
| AOT 发布 | `npm run build:worker:prod`（`scripts/publish-aot-worker.mjs`） | exit 0，IL2026/IL3050 **0 条**，产物 `WishfulClaw.Worker.exe` **23,031,296 B** | 该脚本不写 `package.json`（已核对 `git diff --numstat` 仍是 `2 0`，即只有本次新增的两个 test 脚本） |
| 应用启动 | `npm run dev:full` ×**2 次** | 均启动成功，Worker 连上、渲染进程加载，**启动后零 `[ERROR]`** | 见 §2 摘录；第二次为进程清理后的复跑 |
| C# 回归 | 9 套，逐套 `dotnet build` + 直接跑 dll | **9/9 exit=0** | 见 §3 |
| TS 回归 | 11 个 `test:*` 脚本 | **10/11 exit=0**，`test:cron-integration` exit=1 | 见 §3；该脚本指向已不存在的 `tests/cron-integration/tsconfig.json`，**先前遗留**，本迭代未碰 |

### 可见性金样（R-3 的核心门禁）

`visibility-snapshot.expected.txt` 实测：**112 行 / 32,346 字节**，结构 = 7 行 `preset=` 头 + **105 格**（**15 档 × 7 preset**），15 档去重后逐一可列（`global:channel`、`global:chat`、`global:chat@{automation,pet,subagent}`、`project:chat`、`project:chat@{providerturn,subagent,translation}`、`project:cowork`、`project:cowork-by-default`、`project:cowork@{automation,goalrunner,goalsubagent,subagent}`）。
门禁有效性已用**反证探针**确认：把 `*:channel@*` 故意写坏成 `*:chanell@*` 后声明普查套件立即失败，随后还原。

## 2. 启动证据（脱敏摘录）

原始日志留在会话临时文件，**不入库**——本仓库是公开仓库，日志含用户目录名，不满足 R-4.5 立的「不得含完整用户路径」口径。关键行（路径已作 `<HOME>` 处理）：

```
[Worker] spawning { workerPath: '...\WishfulClaw.Worker\bin\Debug\net11.0\WishfulClaw.Worker.exe',
                    endpoint: '\\.\pipe\wishful-claw-<pid>-<guid>' }
[Worker] data directory <HOME>\.wishful-claw-dev
[Worker] DbClient: starting table creation
[Worker] DbClient: 43 DDL statements applied (tables + indexes)
[Worker] DbClient: memory_fts virtual table ready / creating 4 FTS triggers / all triggers created successfully
[Worker] DbClient: running EnsureColumn migrations → migrations completed
[Worker] DbClient: initialization completed successfully
[Worker] server listening transport=named-pipe debug=False slowRequestMs=750
[Worker] socket connected
[Worker] connected { pid: 14896 }
[renderer:LOG] [vite] connected.
[Worker] builtin personas loaded count=6
```

`43` 那条本迭代改过文案：原先写 `43 tables created/verified`，但 `tableSqls.Length` 数的是**建表 + 建索引的 DDL 总条数**（23 建表 + 20 建索引）。按 `index.db` 实测量：代码去重 23 张建表语句（含 `memory_fts` 虚拟表），dev 库物理 28 项（22 张业务表 + `memory_fts` 及 4 张影子表 + `sqlite_sequence`）。旧文案会在排查容量问题时给出假表数，故改为 `DDL statements applied (tables + indexes)`。

唯一非 INFO 输出是 Electron 的 dev-only `Insecure Content-Security-Policy` 警告（打包后不出现），非本迭代引入。

## 3. 回归测试实测计数

**C# 9 套（全部 exit=0）**

| 套件 | 具名断言 | 备注 |
|------|---------|------|
| `GoalRegressionTests` | 148 | |
| `SessionTaskCascadeRegressionTests` | 180 | |
| `ChannelToolVisibilityRegressionTests` | 102 | 运行期两条 `AgentRunContextPolicy: inferred scope=global` WARN 为用例刻意构造的缺 scope 输入，属预期 |
| `ChannelShellApprovalRegressionTests` | 74 | |
| `CronRegressionTests` | 42（父）+ 8（子 `--verify-new`） | **不在 `WishfulClaw.sln` 内**，单独构建运行 |
| `MemoryRecallRegressionTests` | 18 | 同上，也不在 sln 内 |
| `CompactionSnapshotRegressionTests` | 2（父）+ 子进程 PASS | |
| `ProviderHeaderRegressionTests` | 只报"passed"不报数 | 含用量写/查两侧、可见性金样、声明普查；本迭代把 `UsageLogChecks` 按读写契约拆成两文件后复跑 |
| `ToolConcurrencyRegressionTests` | 只报"checks passed" | |

具名计数合计 **566**（另 2 套不报数、2 套带子进程模式）。

**TS 10 套通过**：`ipc-msgpack-routing` 96 断言 / 272 通道、`provider-presets` 330 / 43 preset、`updater-release-notes` 71、`updater-state` 56、`updater-progress` 35、`renderable-chat-items` 16、`settings-tabs` 20、`session-follow-up` 20、`channel-cancel-commands` 通过、`channel-reply-event-policy` 通过。具名合计 **644**。

⚠️ `tests/**` 不被任何 `tsconfig` 覆盖，所以 §1 的 tsc 三绿**不代表测试代码有类型检查**——测试靠 esbuild 打包 + 实跑兜住。已记在 `review_report.md` 规范表。

## 4. 逐需求结论

| 需求 | 结论 | 已有工具证据 | 缺口（如实） |
|------|------|-------------|-------------|
| #1 模型请求日志与用量统计 | **PARTIAL** | 5 查询套件 + 7 写路径套件（`ProviderHeader` 内）、金样复跑、i18n 双语各 66 行补齐、入口三处 grep 到位（`SettingsPage.tsx:83` 菜单项 / `:243` 渲染分支 / `ui-types.ts:97`+`:116` 类型与持久化白名单）、面板实际调用 5 个 `db/usage-*` 端点 | 面板**渲染后的样子没目视**（空数据/单模型/长表这些形态未见图）；`request_usage_logs` 无保留策略，长期占用未测 |
| #2 更新弹窗尺寸/全屏与悬浮窗移位 | **PARTIAL** | updater 三套 162 checks 全过；判据单点化（`isUpdateBannerVisible` + `UPDATE_BANNER_TOAST_BOTTOM`）；toast 冲突按 sonner 实测参数（`VIEWPORT_OFFSET='24px'`、z-index 999999999、宽 356）推导 | `#2.6` **dev 目视复验未做**（配方在 `updater-ui-issues.md`，需临时降版本号触发） |
| #3 编辑器撤销遗留选中 | **PARTIAL** | 根因改到 `beforeinput`（唯一能读到变更前 DOM 选区的时机）+ 消费一次即清零；`renderable-chat-items`/`channel-*` 等相邻面未回归 | `#3.3` **真机键入与输入法时序未复验**——这类时序我无法自证 |
| R-1 补位模型与三级解析 | **PASS** | 三级解析落地 + 来源回归；`ProviderHeader` 实跑打出两条降级路径的现场 WARN：`auxiliary provider configured route unavailable kind=persona error=Provider 'retired-provider' no longer exists`、`auxiliary provider global active model unavailable ... 'deleted-model' no longer exists in provider 'global'` | `PersonaGeneratorDialog` 仍无 UI 入口（历史遗留，非本需求范围）；提交粒度已达成（多余补口刀收尾折进 `19dc9433`） |
| R-2 渠道设置全局化 | **PARTIAL** | 三层修复（`parseGlobalSettings` 八键校验 + `IsFullRecord` 拒不完整整对象写 + `ReadShellRequiresApproval` 回落 true）；3 个新通道进 msgpack 路由白名单并由 96/272 新套件钉住；2 处静默吞异常补日志 | 新错误态/重试按钮与三选项卡**未目视**；`streamingReply` 等 5 字段仍无强制执行点（S-5，已在 UI 文案注明"仅记录设置"） |
| R-3 工具可见性注册期声明 | **PASS（机制）／口径待裁定** | 105 格金样 + 15 档 + 声明普查 + 反证探针有效；死重载已删；重建后 dll 复跑 | "零行为变化"**实测不成立**：以动手前基线 `f9940a56` 开 worktree 逐格比对，97 格字节相同、**8 格被收窄**（子 Agent 档 `Browser*`）。是否保留交老大裁定；第四载体漏口 S-4 刻意未修 |
| R-4 使用指引 + README 拆分 | **PARTIAL** | 三份文档落位与互链、URL 单点定义（全仓仅一处字面量）、`HelpCircle` 入顶栏右侧组首位、关于页 `sec-about-guide` 走 `shell.openExternal`；审查 4 处失真（搬丢块/徽章/第 10 节/假生效开关）已按实测改掉 | `R-4.5` **配图未做**：整桌面截图会把他人窗口与凭据拍进公开仓库，清场只能本人做；10 处落点清单已写在 `docs/user-guide.md` 文末 |

**FAIL：0 项。** 5 项 PARTIAL 的缺口全部是"真机目视/截图"同一类，无一项是功能不工作。

## 5. 为什么目视没做（含一次通路探查）

1. **我没有任何屏幕截图通路**：工具集里没有桌面捕获；`mcp__browser-use__take_screenshot` 需要可见的浏览器表面，本次报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE (visible=false, visibilityState=hidden)`。
2. **退而用 DOM 快照也不行**：把 in-app browser 指向 dev 渲染进程 `http://127.0.0.1:5173/` 后，`take_snapshot` 只拿到空 `RootWebArea "Wishful Claw"`，控制台给出原因——`IPC channel "agent-history:index" is unavailable: Electron preload bridge is missing`（`src/renderer/src/lib/ipc/ipc-client.ts:19`）。**没有 preload 桥就没有任何 IPC 支撑的界面**，所以浏览器通路不能替代真机。（顺带一条正面结论：缺桥时 IPC 客户端是**显式报错**而不是崩，页面因此空白而非白屏炸栈。）
3. 应用自带的 `DesktopScreenshot` 工具要跑在真实应用里、且整桌面截图会拍到当前桌面的其他窗口——与本迭代 R-4.5 的「清场 + 脱敏」硬前置冲突，属老大动作。
4. 交付标准的"能启动"已由 §2 双次实跑满足；"有入口/有反馈/有闭环"里凡能用 grep 与回归钉住的都已钉住，剩下的就是形态目视。

**目视清单（按性价比排序，配方可复用）**：#1 用量面板（打开设置→用量统计，看空态与有数据态）→ #2 更新弹窗全屏 + 左下悬浮窗（配方见 `updater-ui-issues.md`，需临时降 `package.json` 版本）→ R-2 渠道全局三选项卡与错误态 → R-4 顶栏问号与关于页按钮 → #3 粘贴 `1234`→改 `12你好34`→撤销。

## 6. 记账

- 本报告的修正是**验证态新发现**，按工作流不单独提交，与审查 9 项 ❌ 一并进收尾那次 `fix(迭代28): 审查与验证修复调整`：`DbClient.cs` 启动日志文案、`plan.md`/`review_report.md` 表数口径、本报告与 `review_report.md` 两份文档。
- **历史折叠（本分支唯一一次改写）**：R-1 多出的那一刀补口用 `git commit-tree` 重parent 折进 R-1，未动工作区、未用 `rebase -i`；改写前的整条链留在本地轻量标签 `pre-fold-iter28`（**不 push**，老大确认后可 `git tag -d pre-fold-iter28` 删掉）。折叠点实测 `git diff 80ccb575 3897f34d` 为 **0 字节** → 折掉一刀而内容零变化；`pre-fold-iter28` 到最终 HEAD 之间只剩本报告与 `review_report.md` 两文件的哈希引用改写，无代码/资产变更。因改写点之后的 `#3`/`R-4`/`R-2` 哈希随之变，两份报告里的哈希引用已同步改指新值。
- 迭代是否完结由老大裁定。**本迭代分支已 push（`dev/v2-iter-28`，按 AGENTS.md「Plan 完成后才 push」）**；**合并 main、打 tag `v0.2.28`、`package.json` 版本改 0.2.28、GitHub Release、打包安装、`docs/progress` 记账均未做**，等他手动发起。
- 下个迭代值得排的两条机器门禁：给 `tests/**` 加一份 tsconfig（现在 tsc 完全测不到测试代码）；把 `CronRegressionTests`/`MemoryRecallRegressionTests` 纳入 `.sln`，否则会静默漏编。
