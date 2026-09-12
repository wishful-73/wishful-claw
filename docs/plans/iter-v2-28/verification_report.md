# 迭代 28 验证报告（Z2）

- 日期：2026-09-12
- 分支：`dev/v2-iter-28`（第一轮验证时未 push；收尾修复提交 `215b0a52` 完成后 push，远端 8 刀。R-3.I 收敛批为**第 9 刀**、R-3.J 浏览器批为**第 10 刀**，归属与折叠方案见 §6）
- 被测对象：7 个需求提交（`c7287b6e` #2、`f9940a56` #1、`6a6ceff2` R-3、`19dc9433` R-1、`fdce236f` #3、`231f1cd5` R-4、`3897f34d` R-2）+ 收尾未提交改动（`review_report.md` 的 9 项 ❌ 修正）。R-1 原有一刀多余补口，收尾已折进 `19dc9433`，改写前整条链留在本地标签 `pre-fold-iter28`
- **第二轮复验（2026-09-12，老大追加裁定后）**：R-3 判 PASS 但裁定"实现方案还是有点复杂…现在工具本身不是已经有白名单黑名单了么"，据此追加做了 **R-3.I 中心名字表整体收敛**（删 6 张中心表 + 删绕过短路 + 103 件工具落到 8 种声明形态 + 删 proxy 名字表）。两轮差异见 §1 末「可见性金样」与 §4 R-3 行
- **第三轮复验（2026-09-12，老大第二条追加裁定后）**：追加做了 **R-3.J 浏览器退出直连集、只经 proxy 可达**（三处 preset 摘 `browser` + `full` 补 `DeniedCategories` + `UnattendedRoles` 加宽到 `@automation` + 新增 `BrowserSurfaceAccessChecks`）。**§1/§2/§3 全部数字为本轮重跑实测**，未沿用第一、二轮的结论
- 验证方式：全部门禁在本会话**重跑实测**（未沿用审查期数字），命令、退出码与计数口径逐条列在下表
- 进验证态的前置：`dev-workflow.md` 阶段五阻断规则「❌ 项 > 0 时禁止进入验证态」——审查 9 项 ❌ 已当场修完并复测，残留 0 → 放行

## 1. 门禁矩阵（实测）

| 门禁 | 命令 | 结果 | 计数口径 |
|------|------|------|---------|
| TS 渲染进程 | `npx tsc --noEmit -p tsconfig.web.json` | exit 0，`error TS` 计数 0 | 重定向到文件后取 `$?`（不用管道尾 `$?`） |
| TS 主进程 | `npx tsc --noEmit -p tsconfig.node.json` | exit 0，0 | 同上 |
| TS 根配置 | `npx tsc --noEmit -p tsconfig.json` | exit 0，0 | 同上 |
| C# 解决方案 | `dotnet build src/runtime/WishfulClaw.sln -c Release -v m` | exit 0，**0 个警告 / 0 个错误** | 中文 SDK 打印本地化摘要，按诊断码 `: (warning\|error) [A-Z]+[0-9]+` 计数，英文字面量会得到假的"零警告"。唯一出现的 `NETSDK1057` 严重级是 `message`（预览版 SDK 提示），不计为警告。**本轮走 Release 而非 Debug**：`dev:full` 拉起的实例锁着 `Worker/bin/Debug` 的 dll，Debug 全量构建会撞 MSB3027；Debug 口径由 §1「应用启动」行的 `dev:full` 内建构建覆盖——**本轮该次 Debug 构建同样打出「0 个警告 / 0 个错误」**，15 个项目全量产出 |
| AOT 发布 | `node scripts/publish-aot-worker.mjs` | exit 0，`AOT 编译成功`，`warn`/`error`/`警告`/`错误`/`IL2*`/`IL3*` **零命中**，产物 `resources/worker/WishfulClaw.Worker.exe` **23,033,344 B** | 产物目录 `resources/worker/` 已在 `.gitignore:42`，不污染工作树；该脚本不写 `package.json` |
| 应用启动 | `npm run dev:full` ×**4 次** | 均启动成功，Worker 连上、渲染进程加载，**启动后零 `[ERROR]`** | 第 4 次为 R-3.J 浏览器批改动后的复跑：**同一条命令内先完成 Debug 全量构建（0 警告 0 错误）再起应用**，故"跑的是新代码"由构建本身证明，不再依赖 exe 与源文件的 mtime 比对；随后比对 `~/.wishful-claw-dev/logs/2026-09-12.log`——**启动前后均 37 行、零条新记录**，控制台唯一含 `ERROR` 的行是 Electron 的 dev-only CSP 警告。见 §2 |
| C# 回归 | 9 套，**全部跑第三轮改动后的新产物** | **9/9 exit=0** | 7 套在 sln 内，直接跑 `bin/Release/net11.0/*.exe`（避免 `dotnet run` 触发 Debug 重建撞锁）；`Cron`/`MemoryRecall` 不在 sln 内，用 `dotnet run --project … -c Release` 单跑 |
| TS 回归 | 11 个 `test:*` 脚本（**第三轮全部复跑**） | **10/11 exit=0**，`test:cron-integration` exit=1；10 套逐套计数与前两轮**完全一致**（16/20/71/56/35/330+43/20/96+272 + 2 套不报数） | 见 §3；该失败脚本指向已不存在的 `tests/cron-integration/tsconfig.json`（`error TS5058`），**先前遗留**，本迭代未碰 |

### 可见性金样（R-3 的核心门禁）

`visibility-snapshot.expected.txt` 实测：**112 行 / 25,250 字节**（第二轮 30,294 字节、第一轮 32,346 字节；两次缩小的量都是收窄掉的工具名），结构 = 7 行 `preset=` 头 + **105 格**（**15 档 × 7 preset**）。15 档去重后逐一可列（`global:channel`、`global:chat`、`global:chat@{pet,subagent}`、`global:cowork@automation`、`project:chat`、`project:chat@{providerturn,subagent,translation}`、`project:cowork`、`project:cowork-by-default`、`project:cowork@{automation,goalrunner,goalsubagent,subagent}`）。
**注意 `global:chat@automation` 已改名为 `global:cowork@automation`**（老大裁定「定时任务走的也是 cowork」，`RenderContext` 把 `runtimeRole=="automation"` 归一读作 cowork）——与旧基线对账须按此配对，否则 105 格键集不平。**本轮踩过一次**：不配对直接比，得到的是"112 格 / 7 格放宽"，全是假象。

**五组机器证明（本轮实跑；每行的"基线"列就是它比的谁，不得跨行引用）**：

| 证明 | 基线 | 口径 | 结果 |
|---|---|---|---|
| 逐工具准入位不变 | R-3.I 删表前 | `--derive-admission` 输出的 **103 工具 × 7 个生产格** 位串，删表前 vs 删表后 | **逐字节相同**。**仅对 R-3.I 批成立**：R-3.J 之后浏览器 9 件在 `automation` 三格的位串已按裁定变了，不得再拿这张表说"至今未漂移" |
| 105 格快照 diff（R-3.I） | 删表前 | 收敛前 dump vs 收敛后 dump，逐格比工具名集合 | **69 格等价 / 36 格收窄 / 0 格放宽**（分组与裁定出处见 `plan.md` R-3.I） |
| 105 格快照 diff（R-3.J） | R-3.I 之后 | 浏览器批前 dump vs 批后 dump | **61 格等价 / 44 格收窄 / 0 格放宽**，44 格减掉的工具名集合**恰为 9 件 `Browser*`**，无第四件被牵连；每格 −6 或 −9（−9 只在 cowork 形态格，`BrowserClick`/`BrowserType`/`BrowserEvaluate` 本带 `WorkRunsOnly`，非 cowork 形态原先也不可见）。`automation`/`minimal`/`skill-installer` 三档 15 格全等价（本就未列 `browser`） |
| 累计（动手前 → 现网） | 未动 R-3 时的金样 | 与本轮重生后的金样逐格比 | **47 格等价 / 58 格收窄 / 0 格放宽**，58 格共减 64 件不同工具。两批格集重叠 22 格，故 **`36 + 44 − 22 = 58`**，不得把两批数字相加当累计 |
| 浏览器只经 proxy | 现网代码 | 新增 `BrowserSurfaceAccessChecks`（跑在 `Program.cs` 内、金样比对之前） | ① 9 件确在 `browser` 类下；② **直连侧 105 格零注入**（断言前核实格数确为 105）；③ 代理侧 `@subagent`／`@goalsubagent`／`@automation` 三后缀格计数 **0**，有人格 cowork 形态 9 件、其余 6 件，且任何有人格必含 `BrowserNavigate` 与 `BrowserGetContent` |

门禁有效性仍由**反证探针**兜着：把 `*:channel@*` 故意写坏成 `*:chanell@*`，声明普查套件立即失败（本轮普查已升级为硬约束——**未声明的生产工具直接判红**）。

> ⚠️ **三组比对不可自动复现，如实记账**：上表第 2／3／4 行与第 1 行用的都是**本会话临时目录里的历史 dump**（`snapshot-baseline-locked.txt`＝未动 R-3 的基线、`snapshot-pre/post-collapse.txt`＝R-3.I 前后、`snap-browser-pre/post.txt`＝R-3.J 前后，以及 `admission-*.txt` 三份位串向量），**均未入库**——金样的设计意图是"只存当前应有值"，把历史基线也塞进去会让下一个人分不清该跟谁比。临时目录会被清理，因此**事后能自动复算的只有第 5 行（`BrowserSurfaceAccessChecks`，随套件跑）与金样自洽性**；69/36/0、61/44/0、47/58/0 三组数**届时只能按 `plan.md` R-3.I／R-3.J 的差异表逐格核对，或自建 worktree 检出对应提交跑 `--dump-snapshot` 重取基线**。第 1 行还有一层限制：它只证明"已声明工具的准入位在**那一批**未漂移"，真正的收紧发生在名单本身（新工具不再允许不声明，由普查拦）。

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

**第 4 次（R-3.J 浏览器批后）实跑摘录**：`npm run dev:full` 先打 `已成功生成 / 0 个警告 / 0 个错误`（15 个项目全量，含 `WishfulClaw.Worker`），再起主进程与渲染进程，关键行 `build the electron main process successfully` → `[renderer:LOG] [vite] connected.` → `[Worker] ... builtin personas loaded count=6`；`~/.wishful-claw-dev/logs/2026-09-12.log` **启动前后均 37 行、零条新记录**。控制台含 `ERROR` 的行仅上面那条 dev-only CSP 警告。

## 3. 回归测试实测计数

**C# 9 套（全部 exit=0）** — 下表计数为**第三轮复跑实测**，与前两轮逐项一致

| 套件 | 具名断言 | 备注 |
|------|---------|------|
| `GoalRegressionTests` | 148 | |
| `SessionTaskCascadeRegressionTests` | 180 | |
| `ChannelToolVisibilityRegressionTests` | 102 | 运行期两条 `AgentRunContextPolicy: inferred scope=global` WARN 为用例刻意构造的缺 scope 输入，属预期 |
| `ChannelShellApprovalRegressionTests` | 74 | |
| `CronRegressionTests` | 42（父）+ 13（子 `--verify-reopen`）+ 8（子 `--verify-new`）+ 子 `--exercise-legacy` 通过 | **不在 `WishfulClaw.sln` 内**，单独构建运行 |
| `MemoryRecallRegressionTests` | 18 | 同上，也不在 sln 内 |
| `CompactionSnapshotRegressionTests` | 2（父）+ 子进程 PASS | |
| `ProviderHeaderRegressionTests` | 只报"passed"不报数 | 含用量写/查两侧、可见性金样、声明普查；本迭代把 `UsageLogChecks` 按读写契约拆成两文件后复跑，**第三轮再加 `BrowserSurfaceAccessChecks`（排在金样比对之前）** |
| `ToolConcurrencyRegressionTests` | 只报"checks passed" | |

具名计数合计 **566**（口径＝各套**父进程**报出的具名数之和，`Cron` 子进程的 13／8 与 `CompactionSnapshot` 子进程 PASS **不含在内**；另 2 套不报数）。

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
| R-3 工具可见性注册期声明 + R-3.I 中心名字表收敛 + R-3.J 浏览器只经 proxy | **PASS** | **三批各自的证据链**：① 机制批——105 格金样 + 15 档 + 声明普查（已升为"未声明即判红"的硬约束）+ 反证探针有效，死重载与 proxy 名字表已删，两策略文件 `HashSet<string>` 零命中；② R-3.I 批——删表前后 103 工具×7 格准入位逐字节相同、36 格收窄逐组有裁定；③ R-3.J 批——**直连侧 105 格零浏览器注入**、**代理侧三个无人值守后缀归零而有人格仍含 `BrowserNavigate`/`BrowserGetContent`**（新 `BrowserSurfaceAccessChecks`，随 `ProviderHeader` 套件跑）、金样重生后 44 格收窄且减项恰为 9 件 `Browser*`。9 套 C# 回归 + 10 套 TS 回归全跑新产物；重建后启动零新 ERROR。**逐格 diff 是三组数（69/36/0、61/44/0、累计 47/58/0），比的是三个不同基线，不得互换或相加**，见 §1 五组证明表 | **① 无人值守三档（宠物／翻译／providerTurn）的 UI 效果未目视**——本环境无截图通路（§5），这 18 格各收掉 2～58 件工具，"这些档是否真需要被收掉的工具"须老大实测判定；**②** `ChannelToolVisibilityRegressionTests` 仍复刻 5 份工具名清单（`:22/:27/:33/:44/:52`），"测试内不再复刻名单"这半句对该文件不成立；**③** 新登记 S-10（chat 档整条轻通道断开，删表前后一致但已成硬拦截）与 S-11（审批 3 张 + 分派 12 张名字表在准入轴之外，不得说成"全仓 HashSet 已清零"）；**④ R-3.J 新增**——真机浏览器表面**未目视**（"proxy 里叫得出 `BrowserNavigate` 且真能跳页"只有单测级证据：同一谓词、同一注册表），且**交互三件在 `automation` 档仍可见**（老大两条裁定均未裁到交互件，见 S-2 ②/S-3 ③）。原 S-4、S-7 两个漏口已随两批关闭，不再是转后继项 |
| R-4 使用指引 + README 拆分 | **PARTIAL** | 三份文档落位与互链、URL 单点定义（全仓仅一处字面量）、`HelpCircle` 入顶栏右侧组首位、关于页 `sec-about-guide` 走 `shell.openExternal`；审查 4 处失真（搬丢块/徽章/第 10 节/假生效开关）已按实测改掉 | `R-4.5` **配图未做**：整桌面截图会把他人窗口与凭据拍进公开仓库，清场只能本人做；10 处落点清单已写在 `docs/user-guide.md` 文末 |

**FAIL：0 项。** 5 项 PARTIAL 的缺口全部是"真机目视/截图"同一类，无一项是功能不工作。

## 5. 为什么目视没做（含一次通路探查）

1. **我没有任何屏幕截图通路**：工具集里没有桌面捕获；`mcp__browser-use__take_screenshot` 需要可见的浏览器表面，本次报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE (visible=false, visibilityState=hidden)`。
2. **退而用 DOM 快照也不行**：把 in-app browser 指向 dev 渲染进程 `http://127.0.0.1:5173/` 后，`take_snapshot` 只拿到空 `RootWebArea "Wishful Claw"`，控制台给出原因——`IPC channel "agent-history:index" is unavailable: Electron preload bridge is missing`（`src/renderer/src/lib/ipc/ipc-client.ts:19`）。**没有 preload 桥就没有任何 IPC 支撑的界面**，所以浏览器通路不能替代真机。（顺带一条正面结论：缺桥时 IPC 客户端是**显式报错**而不是崩，页面因此空白而非白屏炸栈。）
3. 应用自带的 `DesktopScreenshot` 工具要跑在真实应用里、且整桌面截图会拍到当前桌面的其他窗口——与本迭代 R-4.5 的「清场 + 脱敏」硬前置冲突，属老大动作。
4. 交付标准的"能启动"已由 §2 **四次实跑**满足（第 3 次起因：收敛批最后两处 C# 编辑晚于在跑的 exe，故重启复验——先证明 exe 晚于全部源文件再看日志零新增 ERROR；第 4 次为浏览器批，证据更强：**同一条 `dev:full` 命令内先完成 Debug 全量构建（0 警告 0 错误）再起应用**，"跑的是新代码"不需要再靠 mtime 推）；"有入口/有反馈/有闭环"里凡能用 grep 与回归钉住的都已钉住，剩下的就是形态目视。

**目视清单（按性价比排序，配方可复用）**：#1 用量面板（打开设置→用量统计，看空态与有数据态）→ **#2.6 更新弹窗全屏 + 左下悬浮窗**（配方见 `updater-ui-issues.md`，需临时降 `package.json` 版本）→ **R-3.I 无人值守三档**（第二轮新增，见下）→ **R-3.J 浏览器只经 proxy**（第三轮新增，见下）→ R-2 渠道全局三选项卡与错误态 → R-4 顶栏问号与关于页按钮 → #3 粘贴 `1234`→改 `12你好34`→撤销。

**R-3.I 无人值守三档的目视配方**（这三档本次各收掉 2～58 件工具，是 36 格差异里唯一"改了但没人看过效果"的一组）：
- **宠物**：触发一次宠物气泡回复，确认回答形态没退化（该档现与同 preset 的 `global:chat` 逐格相同）。
- **翻译**：对一条消息用翻译入口，确认只需要读+回文本、被收掉的写/执行类工具本就不该出现。
- **providerTurn**（单轮请求，如标题生成/会话摘要）：改一次会话标题或跑一次摘要，确认单轮链路不依赖被收掉的工具。
判定口径：这三档现在**逐格等于同 preset 的 chat 档集合**，所以只要 chat 档对应功能正常，即为通过；若发现某档确需某件被收掉的工具，把工具名与档位报回来改声明即可（机制已单点，无需动判定）。

**R-3.J 浏览器只经 proxy 的目视配方**（本批唯一"没人看过真机效果"的面——单测只能证到谓词与注册表，证不到真实浏览器表面）：
1. **正向**：开一个项目 cowork 会话，让 Agent「用浏览器打开某网页并告诉我标题」。预期它先 `use_capability` 查 `browser` 类，再 `BrowserNavigate` + `BrowserGetContent`，页面真的跳了。若它报"没有这个工具"，说明代理侧被误收。
2. **反向（子 Agent）**：让它派一个子 Agent 做同样的事。预期子 Agent 查 `browser` 类拿到空清单，回复里没有浏览器操作。
3. **反向（后台定时）**：建一个 `runMode: 'background'` 的定时任务，prompt 要求用浏览器。预期同样取不到。
4. **正向（带宿主的定时）**：建一个 `runMode: 'session'`（指定目标会话）的定时任务，prompt 要求用浏览器。预期**能用**——老大那句「最终去会话里面去执行的，这个就可以调用」正是这一格，也是本批最容易误伤、必须实测的一条。

## 6. 记账

- **本报告的数字以第三轮复跑为准**。R-3 的两条追加裁定各触发一次全门禁重跑（§1/§2/§3），前两轮凡与本轮冲突处均已就地改写，不另存旧值。金样快照与逐格 diff 的**三份历史基线全部只留在会话临时目录**（§1 ⚠️），故 69/36/0、61/44/0、47/58/0 三组数**事后均不可自动复算**；随仓库能复算的是 `visibility-snapshot.expected.txt`（112 行 / 25,250 字节）的自洽性，与 `BrowserSurfaceAccessChecks` 的浏览器准入断言。
- **两批追加裁定的提交归属**：R-3.I（中心名字表收敛）与 R-3.J（浏览器退出直连集）都源于老大对 R-3 的**追加裁定**，时间点在收尾提交 `215b0a52` 已 push 之后。按 AGENTS.md「审查与验证发现的问题攒进收尾那一次修复调整 commit」本应并入它，但那样须改写已推送的一刀并 `--force` 推送，属未经确认的不可逆动作，凌晨无人值守下不做。故两批**各单独成一刀**，紧跟收尾刀 `215b0a52` 之后，标题分别为 `fix(visibility): 迭代28 需求R-3 追加裁定 — 中心名字表收敛为逐工具声明` 与本批同格式的一刀（本报告随各自所属刀提交，故此处不写它们自己的哈希）。分支历史因此是 **7 需求 + 1 收尾 + 2 追加裁定 = 10 刀**而非 8 刀。**老大在收尾时可自行折叠**成 8 刀口径：`git reset --soft HEAD~3` 把收尾刀与这两刀重提为一次修复调整提交，再 `push --force-with-lease`。折叠与否都不影响代码内容；不折叠也不违反「一需求一刀」——这两刀是**追加裁定的独立批次**，标题已标明所属需求与裁定性质。
- 不得对外说成**"全仓 HashSet 已清零"**：本次删的是**准入判定轴**上的 6 张中心名表与短路；审批侧 3 张 `HashSet<string>`、分派侧 12 张 `*ToolNames`、以及 5 处 `Allowed*` 校验名单都在另一条轴上，未在本次裁定范围内，已立 **S-11**（`raw-requirements.md`）。**R-3.J 还刻意新增了一张** `HashSet<string>`——`ToolPreset.BuiltIn["full"].DeniedCategories`。它属**preset 轴**（老大裁定中「工具本身不是已经有白名单黑名单了么」的那一层就是这里），且**粒度是类别名而非工具名**，与准入判定轴的中心名字表不是同一条轴上被收的东西。
- **第一轮**验证态新发现的修正（`DbClient.cs` 启动日志文案、`plan.md`/`review_report.md` 表数口径、本报告与 `review_report.md` 两份文档）按工作流未单独提交，与审查 9 项 ❌ 一并进了收尾那次 `fix(迭代28): 审查与验证修复调整`（`215b0a52`）。此后两批追加裁定的文档改动随各自所属刀提交，不再攒。
- **历史折叠（本分支唯一一次改写）**：R-1 多出的那一刀补口用 `git commit-tree` 重parent 折进 R-1，未动工作区、未用 `rebase -i`；改写前的整条链留在本地轻量标签 `pre-fold-iter28`（**不 push**，老大确认后可 `git tag -d pre-fold-iter28` 删掉）。折叠点实测 `git diff 80ccb575 3897f34d` 为 **0 字节** → 折掉一刀而内容零变化；`pre-fold-iter28` 到最终 HEAD 之间只剩本报告与 `review_report.md` 两文件的哈希引用改写，无代码/资产变更。因改写点之后的 `#3`/`R-4`/`R-2` 哈希随之变，两份报告里的哈希引用已同步改指新值。
- 迭代是否完结由老大裁定。**本迭代分支已 push（`dev/v2-iter-28`，按 AGENTS.md「Plan 完成后才 push」）**；**合并 main、打 tag `v0.2.28`、`package.json` 版本改 0.2.28、GitHub Release、打包安装、`docs/progress` 记账均未做**，等他手动发起。
- 下个迭代值得排的两条机器门禁：给 `tests/**` 加一份 tsconfig（现在 tsc 完全测不到测试代码）；把 `CronRegressionTests`/`MemoryRecallRegressionTests` 纳入 `.sln`，否则会静默漏编。
