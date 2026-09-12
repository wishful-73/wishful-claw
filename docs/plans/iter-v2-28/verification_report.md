# 迭代 28 验证报告（Z2）

- 日期：2026-09-12
- 分支：`dev/v2-iter-28`（第一轮验证时未 push；收尾修复提交 `215b0a52` 完成后 push，远端 8 刀。R-3.I 收敛批为**第 9 刀**，归属与折叠方案见 §6）
- 被测对象：7 个需求提交（`c7287b6e` #2、`f9940a56` #1、`6a6ceff2` R-3、`19dc9433` R-1、`fdce236f` #3、`231f1cd5` R-4、`3897f34d` R-2）+ 收尾未提交改动（`review_report.md` 的 9 项 ❌ 修正）。R-1 原有一刀多余补口，收尾已折进 `19dc9433`，改写前整条链留在本地标签 `pre-fold-iter28`
- **第二轮复验（2026-09-12，老大追加裁定后）**：R-3 判 PASS 但裁定"实现方案还是有点复杂…现在工具本身不是已经有白名单黑名单了么"，据此追加做了 **R-3.I 中心名字表整体收敛**（删 6 张中心表 + 删绕过短路 + 103 件工具落到 8 种声明形态 + 删 proxy 名字表）。**§1/§2/§3 全部数字为该批改动后重跑实测**，未沿用第一轮结论；两轮差异见 §1 末「可见性金样」与 §4 R-3 行
- 验证方式：全部门禁在本会话**重跑实测**（未沿用审查期数字），命令、退出码与计数口径逐条列在下表
- 进验证态的前置：`dev-workflow.md` 阶段五阻断规则「❌ 项 > 0 时禁止进入验证态」——审查 9 项 ❌ 已当场修完并复测，残留 0 → 放行

## 1. 门禁矩阵（实测）

| 门禁 | 命令 | 结果 | 计数口径 |
|------|------|------|---------|
| TS 渲染进程 | `npx tsc --noEmit -p tsconfig.web.json` | exit 0，`error TS` 计数 0 | 重定向到文件后取 `$?`（不用管道尾 `$?`） |
| TS 主进程 | `npx tsc --noEmit -p tsconfig.node.json` | exit 0，0 | 同上 |
| TS 根配置 | `npx tsc --noEmit -p tsconfig.json` | exit 0，0 | 同上 |
| C# 解决方案 | `dotnet build src/runtime/WishfulClaw.sln -c Release -v m` | exit 0，**0 个警告 / 0 个错误** | 中文 SDK 打印本地化摘要，按诊断码 `: (warning\|error) [A-Z]+[0-9]+` 计数，英文字面量会得到假的"零警告"。唯一出现的 `NETSDK1057` 严重级是 `message`（预览版 SDK 提示），不计为警告。**本轮走 Release 而非 Debug**：`dev:full` 拉起的实例锁着 `Worker/bin/Debug` 的 dll，Debug 全量构建会撞 MSB3027；Debug 口径由 §1「应用启动」行的 `dev:full` 内建构建覆盖（该次构建成功并产出了 12:10:45 的新 exe） |
| AOT 发布 | `node scripts/publish-aot-worker.mjs` | exit 0，`AOT 编译成功`，`warn`/`error`/`警告`/`错误`/`IL2*`/`IL3*` **零命中**，产物 `resources/worker/WishfulClaw.Worker.exe` **23,032,832 B** | 产物目录 `resources/worker/` 已在 `.gitignore:42`，不污染工作树；该脚本不写 `package.json` |
| 应用启动 | `npm run dev:full` ×**3 次** | 均启动成功，Worker 连上、渲染进程加载，**启动后零 `[ERROR]`** | 第 3 次为追加裁定收敛批改动后的复跑：先确认 `bin/Debug/…/WishfulClaw.Worker.exe` 晚于**全部** `.cs` 源文件（`find src -name '*.cs' -newer <exe>` 计数 0），再起应用，随后比对 `~/.wishful-claw-dev/logs/2026-09-12.log` 行数——**启动前后均 37 行、04:10Z 之后零条新记录**。见 §2 |
| C# 回归 | 9 套，**全部跑第二轮改动后的新产物** | **9/9 exit=0** | 7 套在 sln 内，直接跑 `bin/Release/net11.0/*.exe`（避免 `dotnet run` 触发 Debug 重建撞锁）；`Cron`/`MemoryRecall` 不在 sln 内，用 `dotnet run --project … -c Release` 单跑 |
| TS 回归 | 11 个 `test:*` 脚本（**第二轮全部复跑**） | **10/11 exit=0**，`test:cron-integration` exit=1；10 套逐套计数与第一轮**完全一致**（16/20/71/56/35/330+43/20/96+272 + 2 套不报数） | 见 §3；该失败脚本指向已不存在的 `tests/cron-integration/tsconfig.json`（`error TS5058`），**先前遗留**，本迭代未碰 |

### 可见性金样（R-3 的核心门禁）

`visibility-snapshot.expected.txt` 实测：**112 行 / 30,294 字节**（第一轮为 32,346 字节，缩小的 2 KB 是收窄掉的工具名），结构 = 7 行 `preset=` 头 + **105 格**（**15 档 × 7 preset**）。15 档去重后逐一可列（`global:channel`、`global:chat`、`global:chat@{pet,subagent}`、`global:cowork@automation`、`project:chat`、`project:chat@{providerturn,subagent,translation}`、`project:cowork`、`project:cowork-by-default`、`project:cowork@{automation,goalrunner,goalsubagent,subagent}`）。
**注意 `global:chat@automation` 已改名为 `global:cowork@automation`**（老大裁定「定时任务走的也是 cowork」，`RenderContext` 把 `runtimeRole=="automation"` 归一读作 cowork）——与旧基线对账须按此配对，否则 105 格键集不平。

**三层机器证明（本轮实跑）**：

| 证明 | 口径 | 结果 |
|---|---|---|
| 逐工具准入位不变 | `--derive-admission` 输出的 **103 工具 × 7 个生产格** 位串，删表前 vs 删表后 | **逐字节相同** |
| 105 格快照 diff | 收敛前 dump vs 收敛后 dump，逐格比工具名集合 | **69 格等价 / 36 格收窄 / 0 格放宽**（分组与裁定出处见 `plan.md` R-3.I；一格改名见上） |
| 中心名字表已无 | `grep "HashSet<string>"` 于 `ToolVisibilityPolicy.cs`、`AgentRunContextPolicy.cs` | **两文件零命中**；proxy 侧仅剩 `ProxiedCategories`（类别表）与一处方法内局部去重集合。**不得表述成"全仓 HashSet 已清零"**，边界见 S-11 |

门禁有效性仍由**反证探针**兜着：把 `*:channel@*` 故意写坏成 `*:chanell@*`，声明普查套件立即失败（本轮普查已升级为硬约束——**未声明的生产工具直接判红**）。

> ⚠️ **一处取证不可复现，如实记账**：上表第 2 行比对用的收敛前 dump 留在本会话临时目录（`snapshot-pre-collapse.txt` / `snapshot-post-collapse.txt`），**未入库**（金样只存"当前应有值"，不存历史基线）。后来者要复核 69/36/0，只能按 `plan.md` R-3.I 的差异表逐格核对，或自建 worktree 检出收敛前提交重跑 dump——**临时目录会被清理，本报告中的 69/36/0 届时无法自动重跑**。第 1 行同理，且它只证明"已声明工具的准入位未漂移"，漂移发生在名单本身（新工具不再允许不声明，由普查拦）。

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

**C# 9 套（全部 exit=0）** — 下表计数为**第二轮复跑实测**，与第一轮逐项一致

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
| R-3 工具可见性注册期声明 + R-3.I 中心名字表收敛 | **PASS** | 105 格金样 + 15 档 + 声明普查（已升为"未声明即判红"的硬约束）+ 反证探针有效；死重载与 proxy 名字表已删；两策略文件 `HashSet<string>` 零命中；9 套 C# 回归 + 10 套 TS 回归全跑新产物；重建后启动零新 ERROR | **① 无人值守三档（宠物／翻译／providerTurn）的 UI 效果未目视**——本环境无截图通路（§5），这 18 格各收掉 2～58 件工具，"这些档是否真需要被收掉的工具"须老大实测判定；**②** `ChannelToolVisibilityRegressionTests` 仍复刻 5 份工具名清单（`:22/:27/:33/:44/:52`），"测试内不再复刻名单"这半句对该文件不成立；**③** 新登记 S-10（chat 档整条轻通道断开，删表前后一致但已成硬拦截）与 S-11（审批 3 张 + 分派 12 张名字表在准入轴之外，不得说成"全仓 HashSet 已清零"）。与动手前基线逐格比对为 **69 格等价 / 36 格收窄 / 0 格放宽**，36 格逐组有老大裁定出处（原 S-4 漏口已随本批关闭，不再是转后继项） |
| R-4 使用指引 + README 拆分 | **PARTIAL** | 三份文档落位与互链、URL 单点定义（全仓仅一处字面量）、`HelpCircle` 入顶栏右侧组首位、关于页 `sec-about-guide` 走 `shell.openExternal`；审查 4 处失真（搬丢块/徽章/第 10 节/假生效开关）已按实测改掉 | `R-4.5` **配图未做**：整桌面截图会把他人窗口与凭据拍进公开仓库，清场只能本人做；10 处落点清单已写在 `docs/user-guide.md` 文末 |

**FAIL：0 项。** 5 项 PARTIAL 的缺口全部是"真机目视/截图"同一类，无一项是功能不工作。

## 5. 为什么目视没做（含一次通路探查）

1. **我没有任何屏幕截图通路**：工具集里没有桌面捕获；`mcp__browser-use__take_screenshot` 需要可见的浏览器表面，本次报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE (visible=false, visibilityState=hidden)`。
2. **退而用 DOM 快照也不行**：把 in-app browser 指向 dev 渲染进程 `http://127.0.0.1:5173/` 后，`take_snapshot` 只拿到空 `RootWebArea "Wishful Claw"`，控制台给出原因——`IPC channel "agent-history:index" is unavailable: Electron preload bridge is missing`（`src/renderer/src/lib/ipc/ipc-client.ts:19`）。**没有 preload 桥就没有任何 IPC 支撑的界面**，所以浏览器通路不能替代真机。（顺带一条正面结论：缺桥时 IPC 客户端是**显式报错**而不是崩，页面因此空白而非白屏炸栈。）
3. 应用自带的 `DesktopScreenshot` 工具要跑在真实应用里、且整桌面截图会拍到当前桌面的其他窗口——与本迭代 R-4.5 的「清场 + 脱敏」硬前置冲突，属老大动作。
4. 交付标准的"能启动"已由 §2 三次实跑满足（第 3 次起因：收敛批最后两处 C# 编辑晚于在跑的 exe，故重启复验——先证明 exe 晚于全部源文件再看日志零新增 ERROR）；"有入口/有反馈/有闭环"里凡能用 grep 与回归钉住的都已钉住，剩下的就是形态目视。

**目视清单（按性价比排序，配方可复用）**：#1 用量面板（打开设置→用量统计，看空态与有数据态）→ **#2.6 更新弹窗全屏 + 左下悬浮窗**（配方见 `updater-ui-issues.md`，需临时降 `package.json` 版本）→ **R-3.I 无人值守三档**（第二轮新增，见下）→ R-2 渠道全局三选项卡与错误态 → R-4 顶栏问号与关于页按钮 → #3 粘贴 `1234`→改 `12你好34`→撤销。

**R-3.I 无人值守三档的目视配方**（这三档本次各收掉 2～58 件工具，是 36 格差异里唯一"改了但没人看过效果"的一组）：
- **宠物**：触发一次宠物气泡回复，确认回答形态没退化（该档现与同 preset 的 `global:chat` 逐格相同）。
- **翻译**：对一条消息用翻译入口，确认只需要读+回文本、被收掉的写/执行类工具本就不该出现。
- **providerTurn**（单轮请求，如标题生成/会话摘要）：改一次会话标题或跑一次摘要，确认单轮链路不依赖被收掉的工具。
判定口径：这三档现在**逐格等于同 preset 的 chat 档集合**，所以只要 chat 档对应功能正常，即为通过；若发现某档确需某件被收掉的工具，把工具名与档位报回来改声明即可（机制已单点，无需动判定）。

## 6. 记账

- **本报告的数字以第二轮复跑为准**。R-3 追加裁定后重跑了全部门禁（§2/§3），第一轮的口径与数字凡与第二轮冲突处均已被就地改写，不另存旧值。金样快照与逐格 diff 的收敛前基线只留在会话临时目录（§3 ⚠️），故 69/36/0 这组数**事后不可自动复算**，能复算的是提交进仓库的 `visibility-snapshot.expected.txt`（112 行 / 30,294 字节）。
- **R-3.I（中心名字表收敛）的提交归属**：这批改动源于老大对 R-3 的**追加裁定**，时间点在收尾提交 `215b0a52` 已 push 之后。按 AGENTS.md「审查与验证发现的问题攒进收尾那一次修复调整 commit」本应并入它，但那样须改写已推送的一刀并 `--force` 推送，属未经确认的不可逆动作，凌晨无人值守下不做。故这批**单独成一刀**，紧跟收尾刀 `215b0a52` 之后，标题 `fix(visibility): 迭代28 需求R-3 追加裁定 — 中心名字表收敛为逐工具声明`（本报告本身即随该刀提交，故此处不写它自己的哈希）。分支历史因此是 **7 需求 + 1 收尾 + 1 追加裁定 = 9 刀**而非 8 刀。**老大在收尾时可自行折叠**成 8 刀口径：`git reset --soft HEAD~2` 把收尾刀与该刀并重提为一次修复调整提交，再 `push --force-with-lease`。折叠与否都不影响代码内容。
- 不得对外说成**"全仓 HashSet 已清零"**：本次删的是**准入判定轴**上的 6 张中心名表与短路；审批侧 3 张 `HashSet<string>`、分派侧 12 张 `*ToolNames`、以及 5 处 `Allowed*` 校验名单都在另一条轴上，未在本次裁定范围内，已立 **S-11**（`raw-requirements.md`）。
- 本报告的修正是**验证态新发现**，按工作流不单独提交，与审查 9 项 ❌ 一并进收尾那次 `fix(迭代28): 审查与验证修复调整`：`DbClient.cs` 启动日志文案、`plan.md`/`review_report.md` 表数口径、本报告与 `review_report.md` 两份文档。
- **历史折叠（本分支唯一一次改写）**：R-1 多出的那一刀补口用 `git commit-tree` 重parent 折进 R-1，未动工作区、未用 `rebase -i`；改写前的整条链留在本地轻量标签 `pre-fold-iter28`（**不 push**，老大确认后可 `git tag -d pre-fold-iter28` 删掉）。折叠点实测 `git diff 80ccb575 3897f34d` 为 **0 字节** → 折掉一刀而内容零变化；`pre-fold-iter28` 到最终 HEAD 之间只剩本报告与 `review_report.md` 两文件的哈希引用改写，无代码/资产变更。因改写点之后的 `#3`/`R-4`/`R-2` 哈希随之变，两份报告里的哈希引用已同步改指新值。
- 迭代是否完结由老大裁定。**本迭代分支已 push（`dev/v2-iter-28`，按 AGENTS.md「Plan 完成后才 push」）**；**合并 main、打 tag `v0.2.28`、`package.json` 版本改 0.2.28、GitHub Release、打包安装、`docs/progress` 记账均未做**，等他手动发起。
- 下个迭代值得排的两条机器门禁：给 `tests/**` 加一份 tsconfig（现在 tsc 完全测不到测试代码）；把 `CronRegressionTests`/`MemoryRecallRegressionTests` 纳入 `.sln`，否则会静默漏编。
