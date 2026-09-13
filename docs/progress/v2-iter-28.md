# v2-iter-28：模型用量统计 + 工具可见性注册期声明 + 渠道设置全局化 + 内置服务商懒物化 + 聊天执行态渲染修复（已完成，已合并 main）

- 状态：已完成。老大 2026-09-13 口头确认「28 迭代已经都人工复测过了」并授权收尾，收尾六步（版本 / 合 main / tag / push / Release / progress 记账）本文件记齐
- 分支：`dev/v2-iter-28`（tip `966638ba`，2026-09-13 已合并 main 并删除本地与远程分支；删除前实测 `git merge-base --is-ancestor` 确认是 main 祖先）
- Plan：`docs/plans/iter-v2-28/plan.md`；原始需求：`raw-requirements.md`；独立审查：`review_report.md`；验证：`verification_report.md`；探索：`exploration_findings.md`；合规：`compliance_report.md`；单需求文档：`usage-analytics-requirement.md`、`updater-ui-issues.md`、`editor-undo-selection-issue.md`
- VERDICT：**PASS（带移交项，FAIL 0 项）**——收尾时点重跑实测：三套 tsc 零错误、C# 解决方案 0 警告 0 错误、9 套 C# + 10 套 TS 回归全绿、生产安装包 `wishful-claw-0.2.28-setup.exe` 已上架且 `latest.yml` 与包内证据核验一致；逐项真机目视由老大本人完成
- 产品版本：`0.2.28`（`package.json` 与 README 徽章同步）
- Tag：`v0.2.28`（annotated，对象 `232ef1bc` → commit `5581e62b`）
- Commit：`5581e62b`（merge 进 main，已推送）；本迭代开发期 21 刀 + 收尾 2 刀（`73df427b` 需求登记、`966638ba` 版本号），关键刀见下「提交粒度」节
- Release：<https://github.com/wishful-73/wishful-claw/releases/tag/v0.2.28>，资产 `wishful-claw-0.2.28-setup.exe`（113,257,779 B）+ `latest.yml`（356 B）+ `.blockmap`（118,368 B）；远程 `latest.yml` 下载 HTTP 200 且与本地逐字节一致，Release 非 draft 非 prerelease
- 日期：2026-09-13

## 范围与功能单元（13 项：立项 3 + 原始需求 4 + 执行期追加 6）

- **#1 模型请求日志与用量统计面板** — 新增 `request_usage_logs` 建表与读写两侧、5 个 `db/usage-*` 端点、设置页「用量统计」面板；旧统计代码拆分归位
- **#2 更新弹窗尺寸/全屏 + 后台悬浮窗移位** — 弹窗可放大与全屏；悬浮块移到左下角，判据单点化（`isUpdateBannerVisible` + `UPDATE_BANNER_TOAST_BOTTOM`）
- **#3 编辑器撤销后遗留选中态** — 改到 `beforeinput`（唯一能读到变更前 DOM 选区的时机）消费一次即清零
- **R-1 不可见请求的补位模型** — 三级解析（显式指定 → 补位模型 → 全局激活模型）+ 删掉 4 个"写了不读"的哑字段 + `PersonaGenerator` 接线路由参数
- **R-2 渠道功能/权限设置全局化** — 逐渠道配置收成全局一份、设置页三选项卡；落点 `config.json:channelSettings`（`GlobalChannelSettingsStore`），`shellRequiresApproval` 强制执行门接真（C# `ToolCallProcessor`）
- **R-3 工具可见性收敛到注册期声明** — `scope:mode@role` + 唯一判定入口 + 逐工具 `VisibleScopes`（白）/`ExcludedScopes`（黑）+ `IsCore`；执行期追加五批裁定：**R-3.I** 删 6 张中心名字表与绕过短路（103 件工具落到 8 种声明形态）、**R-3.J** 浏览器 9 件退出直连集只经 `use_capability` 可达、**R-3.K** 交互三件走黑名单、**R-3.L** 口径确认（纯裁定说明，无代码）、**R-3.M** 无人可答档位一律否决交互面（计划族收全族 + 子 Agent 纳入）
- **R-4 使用指引 + README 拆分** — README 一分为二（用户指引 / 开发说明）、顶栏问号与关于页双入口指向同一份指引、URL 单点定义
- **R-5 更新悬浮块拖动 + 位置记忆** — 可拖动、跨重启恢复、视口钳制
- **R-6 提示词「英文 + 四关」清理** — `PromptBuilder` 等源头英文化，约定成文于 `docs/prompt-authoring.md` 并并入 AGENTS.md 硬规则
- **R-7 临时文档归置 + 项目数据目录隐藏** — 四处提示词统一引导临时文档进 `.wishful-claw/notes/`；`WishfulClawDataDir.EnsureProjectRoot` 单点创建 + Windows 设隐藏属性（幂等）
- **R-8 AI 服务商官网地址 + 详情页入口** — `homepage` 字段、外链入口、内置模型清单刷新（二轮修正并入收尾修复刀）
- **R-9 内置服务商懒物化** — preset 只读基线化；用 `virtual` 运行时字段表达"未物化"，不新增落盘字段、不做迁移；`reconcileProviders` 抽为纯函数并加新装/老配置两场景回归
- **R-10 聊天窗执行态渲染三修** — 吸附卡不透明 + 滚动 GAP 姿态留白带 + 思考内容流式缓冲
- **收尾 Z1/Z2/Z3** — 独立审查报告（9 项 ❌ 当场修完）+ 验证报告 + 本次发版记账

## 验证（2026-09-13 收尾时点重跑实测，未沿用 09-12 报告数字）

- **TypeScript**：`tsc --noEmit` 三配置（web / node / root）各 exit=0、`error TS` 计数 0
- **C#**：`dotnet build src/runtime/WishfulClaw.sln -c Release` exit=0、诊断行 **0**（按 `: (warning|error) [A-Z]+[0-9]+` 计数，不按英文字面量）；`CronRegressionTests` / `MemoryRecallRegressionTests` 不在 sln 内，单独构建同样 0 诊断
- **C# 回归 9/9 exit=0**：Goal 148 / SessionTaskCascade 180 / ChannelToolVisibility 108 assertions / ChannelShellApproval 74 / CompactionSnapshot 2（父）+ 子进程 PASS / Cron 42（父）+ 子 13 与 8 / MemoryRecall 18 / ProviderHeader passed（含可见性金样自洽 + 声明普查 + `BrowserSurfaceAccessChecks`）/ ToolConcurrency passed。父进程具名合计 **572**
- **TS 回归 10/10 exit=0**：`provider-presets` 546 assertions、`ipc-msgpack-routing` 96、`updater-release-notes` 71、`updater-state` 56、`updater-progress` 35、`settings-tabs` 21，另 4 套 passed 不报数
- **可见性金样**：`tests/WishfulClaw.ProviderHeaderRegressionTests/visibility-snapshot.expected.txt` 实测 **112 行 / 12,516 B（LF）**，`ProviderHeaderRegressionTests` 通过即金样与当前判定自洽。**⚠️ `verification_report.md` §1 记的 24,557 B 与现树不符**，且该节自述三组逐格 diff 基线只留在会话临时目录、事后不可自动复算——以本行为准
- **AOT**：`npm run build:worker:prod` 成功，`warn`/`error`/`IL2*`/`IL3*` 零命中，产物 `resources/worker/WishfulClaw.Worker.exe` **23,137,280 B**，捆绑 18 个 CodeGraph grammar
- **生产安装包核验**：`release/v0.2.28/` 下 `latest.yml` 的 `version` / `path` / `files[].url` / `sha512` / `size` 与实测 exe 逐项一致（sha512 独立计算比对相同）；`WishfulClaw.exe` 的 `ProductVersion` = `0.2.28.0`；包内 worker exe 与本地 AOT 产物同尺寸同批次；`app.asar` 抽样命中本迭代标识串（`用量统计` / `UPDATE_BANNER_TOAST_BOTTOM` / `isUpdateBannerVisible` / `shellRequiresApproval` / `wishful-claw/notes`）→ 证明装的是本轮代码而非旧包
  - **打包偏差如实记**：`npm run pack:installer:full` 的 electron-builder 阶段撞 `EBUSY: release\win-unpacked\resources\app.asar`（无残留 WishfulClaw/electron 进程，属外部句柄锁），按 AGENTS.md 既定处置改用新输出目录 `release/v0.2.28/` 重跑 `npx electron-builder --win`，**未清理他人在用文件**。AOT 与 vite 阶段在首次运行即已成功，产物复用
- **真机目视**：#1 面板形态、#2.6 更新弹窗全屏与悬浮窗、#3.3 键入/输入法时序、R-2 三选项卡与错误态、R-3 无人值守三档、R-3.J 真实浏览器表面、R-5.3、R-10.4 —— **由老大 2026-09-13 人工复测确认**。agent 侧无屏幕捕获通路（`browser-use` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`，浏览器通路缺 preload 桥），**`evidence/*.png` 截图证据本次仍未产出**（iter-27 同款欠账，非本迭代新增缺陷）

## 提交粒度（与 AGENTS.md 的偏差，如实记）

AGENTS.md 目标是 **需求数 + 1 = 14 刀**，实际开发期 **21 刀**。超出项集中在三处：R-9 留了 4 刀（立项 docs / feat / fix / test）、R-10 留了 3 刀（feat / 协作纪律 docs / 收尾修正）、修复调整批次出现 **2 次**（`215b0a52` 与 `c3d07d18`，规则只允许 1 次）。折叠需 `reset --soft` + `push --force`，属改写已推送历史的不可逆动作，**本次未做**。代码内容不受影响，回滚仍可按需求刀定位。

## 报告记账已过期（报告记为未完成、现树已修；PROGRESS 不得再列待办）

- **S-1 / review R-3.7「工具提示词主体未动、`BuildToolCapability()` 仍是静态全 27 类」** → 已修：`PromptBuilder.cs:267-288` 只渲 `ToolCategoryCatalog.Core` 的 6 类，注释显式写明"其余经代理发现，在这里列举会描述一份模型实际不持有的清单"。`raw-requirements.md` 尾注里"工具提示词主体本次完全未动"这句话已作废
- **`verification_report.md` §4 R-3 缺口④「交互三件在 `automation` 档仍可见」** → 已闭：`ToolVisibilityScopes.NoHumanToAnswer`（`ToolVisibilityScopes.cs:83`）挂满 6 个注册点（`AskUserToolProvider.cs:40`、`PlanToolProvider.cs:31/41/51/69`、`WidgetToolProvider.cs:39`）
- **`test:cron-integration` 死脚本** → 已删（`64e344de`），`package.json` 内已无该脚本
- **R-7.1 文档归置约定** → 四处载体全部已落地（`GlobalTaskToolsProvider.cs:108`、`AgentRuntimeGlobalTaskExecutor.cs:226`、`task-board-store.ts:103`、`PromptBuilder.cs:334`），plan 里的 `[ ]` 是漏勾，本次已补勾并注明
- **`verification_report.md` §6「分支已 push」** → 写作时点后又有 11 刀未推，收尾时点已随 merge 一并进入 main，不再有悬空提交

## 移交 iter-29（按类，含出处）

**A. 功能缺口（代码侧）**

1. **#1 用量日志无保留策略** — `DbClient.cs` 只建表与索引，全仓无 `request_usage_logs` 的 prune/cleanup，长期占用未测
2. **R-1 收尾两项** — `PersonaGeneratorDialog` 至今零 importer（无 UI 入口，历史遗留）；`PersonaGenerator.cs:22` 仍自建第三套 HTTP 客户端，未收敛到 `WorkerHttpClientFactory`
3. **S-5 渠道 5 字段仍不生效** — `streamingReply` 与 4 个 `permissions.allow*` 只在 `/status` 文本与 UI 展示；`plugin-command-handlers.ts:340,348-350` 自陈 "(not enforced yet)"，UI 文案已注明"仅记录设置"；`readablePathPrefixes` 仍无输入项
4. **S-6 渠道工具开关是死配置** — `plugin:tool-enabled` 只在 `src/main/ipc/reverse-handlers/index.ts:88,153`，C# 侧零处发起
5. **S-12 / F1 ②：两个端点不过滤** — `ToolModule.cs:80` 注册的 `tool/list` 在 `:91` 仍直接 `registry.GetToolDefinitions(preset)`，不过准入判定（渲染端 `sidecar-mapping.ts:319` 发的 `tools` 参数 Worker 不读）；`ProviderCompletionService.cs:221-229,275-283` 的 `provider/complete` 原样写调用方 tools
6. **S-14 / F4：翻译与宠物链路的定时炸弹** — `translate-agent-service.ts` 四处提示词要求模型调 `Write()`/`Edit()`，而这两件声明 `WorkRunsOnly`，在 `global:chat@translation` 下不可见；目前不炸只因 `setAgentMode` 近乎零调用。另有 `TRANSLATION_TOOLS`／`PET_AGENT_TOOLS` 两条渲染端影子清单被 Worker 忽略
7. **F6：可见性判定的两处性能与 fail-open** — `ToolVisibilityPolicy.cs:96` 在 `FilterToolDefinitions` 循环内逐个重渲 `RenderContext`；`AgentRunContextPolicy.cs:144-156` registry 为 null 时仍放行（只补了注释，无断言）
8. **F5：代理侧仍有名字开关** — `AgentRuntimeUseCapabilityDiscovery.cs:107-110` 按类别名 `web` 与前缀 `codegraph_` 判定，落在"逐工具声明"轴之外（直连侧那两处已随 R-3.I 消失）
9. **S-10**：`send_session_message`（`ProjectToolsProvider.cs:61`）与 `update_session_follow_up`（`:93`）现**均**声明 `GlobalSideOnly` = `["global:*@*"]`，`project:*` 全档取不到 → 项目侧 chat 档的轻通道断开。**注意**：审查报告里把它记成一 `GlobalTaskAndWorkRuns` 一 `WorkRunsOnly`，与现树不符，交接时按本行实测形状复述
10. **S-11**：审批轴 3 张 `HashSet<string>`（`ToolCallProcessor.Approval.cs:19,35,45`）与分派轴 12 个 `*ToolNames` 仍在——**不得对外说成"全仓 HashSet 已清零"**，R-3 收的是准入判定轴
11. **S-3 剩余**：`src/renderer/src/lib/tools/cron-runtime.ts:485-486` 仍只发 project/global 两值，不发 `unknown` scope
12. **S-9**：`newSessionDefaultModel` 仍只写不读——四处全是声明与搬运（`settings-store.ts:223` 类型、`:361` 默认值、`:510` persist 白名单、`settings-store-migrate.ts:123-124` 迁移），零行为消费方
13. **S-19（老大 2026-09-13 新增）**：软件自身界面截图能力 + 产物落盘到仓库路径，用于由 Agent 自建《使用指引》配图；R-4.5 配图仍未做，但"属人类专属动作"的旧理由已被老大新口径推翻

**B. 工程门禁缺口**

14. `tests/**` 不被任何 tsconfig 覆盖 → tsc 三绿测不到测试代码；`package.json:32-33` 的 `test:e2e` 指向不存在的 `tests/e2e`（收尾时点实测确认），是死脚本
15. `CronRegressionTests` / `MemoryRecallRegressionTests` 仍未纳入 `WishfulClaw.sln` → 全量构建会静默漏编，需单跑
16. 两个文件超 500 行未拆：`FileAwareEditor.tsx` **520**、`channel-plugin-handlers.ts` **508**（#3 与 R-10 又把它撑长了）

**C. 文档陈旧**

17. `AGENTS.md:19` 与 `docs/project-plan.md:9` 仍写 **Electron 35**，实际打包用 **43.2.0**（README 徽章已是 43）——假事实比不写更糟，须按 AGENTS.md 提示词口径同步
18. `docs/iteration-plan.md` 仍停在 v2-iter-26，未登记 27/28

**D. iter-27 带过来、28 未纳入的（老大当时未答"是否算进 28"，不得默认划完成）**

19. **Plan D 多服务商 fallback** — 设计成文、零代码
20. **A4 更新端到端最后一段** — 装机验证只到"能发现新版 + 能下载"，**下载确认与安装确认仍未实跑**；本迭代 #2/#5 改了更新 UI，这条的验证价值更高了。**Release 后核验要求的"用低于当前 Release 的本地版本实调 `checkForUpdates()`"本会话未执行**
21. **`evidence/*.png` 桌面验证证据未产出**（本迭代同样未产出）
22. **K0 常量收敛残留**、**`CodeGraphDataDir.cs` 兜底不读 `WISHFULCLAW_DATA_DIR`**

## 本迭代未做与不纳入

- 整块未做：R-6.D 登记的三项（plan 明写"本轮不做"）；`ChannelToolVisibilityRegressionTests` 内 5 份复刻名单（"测试内不再复刻名单"那半句对该文件不成立）
- `plan.md` 明列不纳入：Plan D、A4 后半段、桌宠、K0
- **收尾顺序偏差**：本迭代含 R-7（项目级数据目录隐藏）与 R-9（改存量 provider 记录的读路径语义），按 v2-iter-27 定的门禁本应**先出生产包、真机安装验证通过后再 merge/tag/push**。老大以"已都人工复测过"直接授权收尾，顺序未反转，因此**"生产版读存量数据"的装机升级面**（尤其老用户 `activeProviderId` 等选中态指针在 R-9 语义下的解析）属**未单独验证项**——已在 `plan.md` Z3 与本报告同步记账，装上真实数据目录后若发现异常，优先查这里
