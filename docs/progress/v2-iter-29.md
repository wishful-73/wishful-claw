# v2-iter-29：S-16~S-25 十项正式需求 + T-1~T-15 十五项临时需求 + 渠道配置页改版 + 限额自动接管收口

- 状态：已完成，已合并 main
- 分支：`dev/v2-iter-29`（tip `c205b889`，2026-09-15 已合并 main 并删除本地与远程分支）
- Plan: `docs/plans/iter-v2-29/plan.md`；原始需求：`raw-requirements.md`；探索：`exploration_findings.md`；独立审查：`review_report.md`；验证：`verification_report.md`；合规：`compliance_report.md`；专项：`S-21-call-chain-notes.md`
- VERDICT: **PASS**（编译与回归零回退，29 个需求全部落代码与提交；剩余挂账均为「agent 无环境」类真机项）
- 产品版本: `0.2.29`（`package.json` + `package-lock.json` + README 徽章同步）
- Tag: `v0.2.29`（annotated，指向 merge commit `2bb5438f`）
- Commit: `2bb5438f`（merge 进 main，已推送）
- 日期: 2026-09-15

## 范围与功能单元（29 项：正式 10 + 临时 15 + 收尾期追加 4）

### 正式需求 S-16~S-25

- **S-16 输入框长粘贴折叠块** — `<pasted-block>` 标签方案，超长粘贴在输入框折叠为可展开 chip
- **S-17 代理调用状态显示真实工具名** — 状态条经 `resolveProxyStatusName` 显示被 `use_capability` 代理的真实工具，与卡片用的 `resolveProxyDisplay` 分开
- **S-18 右侧面板 Git 分支视图** — 分支列表 + 提交图谱（`commit-graph-layout.ts` 纯布局模块），超限时补「仅显示最近 N 条」提示（F-12）
- **S-19 软件自身界面截图** — 主进程 `window-capture-handler` + 通用落盘 `image-persist.ts`（路径解析放在 Worker，避开主进程 cwd）
- **S-20 自定义服务商可配置请求头** — 编辑器 + 保留头拦截 + RFC token 校验；载荷侧由 F-8 修复后主聊天链路真正带上
- **S-21 多服务商限额自动 fallback** — 见下方「限额自动接管」小节
- **S-22 全局任务回报后新消息回推渠道** — 回报注入引发的新一轮助理消息成对入队与清理
- **S-23 搜索能力收敛到 BrowserSearch** — 退役 WebSearch API 链路与 `WebSearchProviders.cs`，统一走多引擎抓取（`bing_cn` 摘除、引擎域豁免、轮转 + 去重）；`web:fetch` 承接抓取
- **S-24 用量统计请求明细上移进选项卡** — 4 档收敛为 3 档，明细复用 `loadLogsPage` 与既有防串号
- **S-25 Agent 工作时间线（自动履历）** — 新表 `agent_timeline` + 9 类事件 + 右侧面板 timeline Tab；metadata 经 `Utf8JsonWriter` 构造（F-11）

### 临时追加 T-1~T-15

- **T-1** 消息时间口径：助理回复显示最后更新时间
- **T-2** 底部统计条改读会话级基线 + 增量，不再依赖已加载消息
- **T-3** 发新消息时把内存消息窗口收缩到最近 N 轮（阈值可配）
- **T-4** 流式光标两次口径修正，最终定稿「任何时刻只有一个」（思考中有、最下方无）
- **T-5** 用量面板分栏与明细可控，退役 `usage-by-source` 死端点
- **T-6** 测试工程独立成 `tests/WishfulClaw.Tests.sln`，移除 playwright e2e
- **T-7** 中断后未配对 tool_calls 导致下次请求 400（写入时补配对 + 首次加载校验）
- **T-8** 思考流式渲染时聊天窗上下跳动（真因：滚动容器 `overflow-anchor`；残留：两行缓冲 + `useLayoutEffect`）
- **T-9** 吸附卡遮挡内容区顶部（首行 inline paddingTop）
- **T-10** 压缩 head 前缀不再 pin 住孤立 tool_result
- **T-11** `use_capability` 的 `arguments` 改为自由对象，与执行侧口径一致
- **T-12** 空响应（provider 零输出）纳入重试策略，不再直接判死 run（`ProviderEmptyResponseException`）
- **T-13** 聊天窗长粘贴 chip 化 —— 标签落库 + 所有「把消息文本当正文读」的路径展开（含 C# `SessionRestoreTools.ExpandPastedBlocks` 兜住冷启动）
- **T-14** 底部统计条口径统一到 DB 基线（真因：进程内跑过一轮后守卫挡住基线）
- **T-15** 思考流式追赶算法由三档阶跃改为连续单调 `ceil(pool/K)`（有界收敛，不滞后；20045 断言锁死数学性质）

### 收尾期追加（需求 26~29）

- **需求 26 S-21 收口** — 候选链改「服务商 + 首选模型」（删掉按名字猜模型的 `pickFallbackModelId`）；两层配置（设置页全局默认 + 模型选择器 Auto 右侧面板的会话级覆盖，内存态不落库）；auto 会话撞限额**不渲染报错卡片**，改自动切换 + 自动发「继续推进」，延迟执行落空时把卡片补回；「切换粘会话」改由会话绑定承载（F-1 最终修法）
- **需求 27 渠道配置页改版** — 全局设置占主体在上，渠道改手风琴折叠块；状态文字徽章替代 2px 色点；缩进统一；删除死代码 `selectedChannelId` / `setSelectedChannel`
- **需求 28 渠道全局设置去选项卡** — 8 键砍到 2 键（`autoStart` / `shellRequiresApproval`），删掉六个「存了不用」的字段；保留 `allowShell` 旧键兼容读
- **需求 29 顶栏浏览器快捷入口** — 文件与终端图标之间的 `Globe` 按钮，复用 `ensureBrowserTab`，不受 `hasProject` 约束

### 收尾期修复

- **F-8 / F-2** agent/run 的 provider 载荷改单点构造（`provider-payload.ts`），五个发送点收敛 —— 修掉「自定义请求头 / userAgent 在主聊天链路不生效」与「自动推进那一轮 Worker 靠猜 scope」
- **协议取值改模型级优先** — `type: modelConfig?.type ?? provider.type`；影响 `openai` / `azure-openai` / `copilot-oauth` 共 37 个模型端点由 `/chat/completions` 改走 `/responses`
- **F-1 / F-3 / F-4 / F-5** S-21 收口：切换粘会话 / 限额判定收紧（搬进纯模块 `quota-failure.ts`）/ 400ms 竞态重校验 / 会话删除时清理内存链
- **F-11 / F-12 / F-14 / F-15** 时间线 metadata JSON 构造、图谱截断提示、「全部会话」作用域、en locale 缺 32 个 key
- **F-9 / F-10** 流程项：S-21 三刀不折叠（老大裁定，历史已推送）；删除恒真空壳测试工程
- **i18n 误删恢复** — 恢复被行号范围删除误伤的 `followGlobalModel`，补 17 个缺失 key，新增引用一致性守卫 `tests/i18n-coverage`
- **渠道 descriptor 文案走 i18n** — 8 条 `description` 改 key；`displayName` 未动（它是存库默认名）
- **底部统计条 auto 显示「服务商 · 模型」** — 仅 auto 渲染，数据源与发消息同一条解析函数，切换后立即跟随

## 验证（2026-09-15 收尾时点重跑实测）

- **TypeScript**：`tsc --noEmit` 三配置（web / node / root）各 exit=0
- **C#**：`dotnet build tests/WishfulClaw.Tests.sln` 与 `WishfulClaw.Worker.csproj` 各 **0 警告 0 错误**（按既定 `-p:BaseOutputPath=` 独立输出目录避开运行实例锁 bin）
- **C# 回归 10/10 exit=0**：AgentTimeline 25 / ChannelShellApproval 72 / ChannelToolVisibility 108 / CompactionSnapshot（父 2 + 子进程）/ Cron 42 / Goal 148 / MemoryRecall 18 / ProviderHeader passed（含可见性金样 + UsageLogChecks）/ SessionTaskCascade 180 / ToolConcurrency passed
- **TS 回归 19/19 exit=0**：`streaming-render-pool` 20045 / `provider-presets` 546 / `updater-release-notes` 71 / `updater-state` 56 / `provider-payload` 54 / `provider-fallback` 40 / `updater-progress` 35 / `session-model-resolution` 23 / `fallback-chain` 22 / `settings-tabs` 22 / `live-cursor` 20 / `session-follow-up` 20 / `select-file-tags` 18 / `renderable-chat-items` 16 / `channel-account-label` 12 / `i18n-coverage` 2 / `ipc-msgpack-routing` 96（270 通道）/ `channel-cancel-commands`、`channel-reply-event-policy` passed
- **AOT**：`npm run build:worker:prod` 成功，**无 IL2026 / IL3050 / IL3051**，产物 `resources/worker/WishfulClaw.Worker.exe` = 23,150,592 B（含 18 个 CodeGraph grammar 捆绑）
- **残留扫描**：全仓 1416 个 `.cs/.ts/.tsx`，退役标识符（`autoReply` / `streamingReply` / `AllowReadHome` / `ReadablePathPrefixes` / `allowWriteOutside` / `allowSubAgents` / `pickFallbackModelId` / `selectedChannelId` / `setAutoModelSelection` / `autoModelSelectionsBySession`）**全部零命中**
- **真机目视**：需求 27 / 28 / 29 与渠道描述 i18n 由老大 2026-09-15 人工复测确认

## 遗留

**待人真机验收（agent 无环境，优先级由高到低）**：

1. **需求 26「切换要粘住」** —— auto 会话撞限额自动切换后，**再发普通消息应仍走新服务商**；同时验候选试完时报错卡片照常出现
2. **协议取值改模型级优先的影响面** —— 37 个模型端点改走 `/responses`，需确认能正常出话
3. T-13 重启后 chip 仍在且点开是全文；T-14 只加载 5 轮历史的统计 == 完整加载
4. T-15 长思考不滞后、不失帧；T-4 光标「思考中有、最下方无」
5. T-11.2 `use_capability` 调 `builtin:Task` / `mcp-tool:*` / `skill:*` 三类带参
6. S-20 自定义请求头（看 `request_debug` 事件的 headers）
7. S-22 微信回推（**需微信环境**）
8. 目视类：S-19 / S-18 / S-24 / S-17

**技术欠账**：

- **截图证据**：本迭代仍未产出 `evidence/*.png`（agent 侧无屏幕捕获通路），与 iter-27 / iter-28 同款，非本迭代新增
- **下版本待议**：①渠道会话的 shell 审批没有出口（默认 `shellRequiresApproval=true` 下渠道跑 shell 会挂在用户看不见的审批上）；②渠道 `displayName` 的 i18n（它是存库默认名，改 key 会把库写坏，只能在渲染端按 `channel.type` 映射）；③`meta.requestModel` 全仓零写入方，导致无法显示「上一条消息真正用了谁」；④`serviceTier` / fast mode 功能整体未落地（preset 标了但没有任何路径发出去，带上会把请求静默切到 priority 计费档）

## 提交粒度（与 AGENTS.md 的偏差，如实记录）

AGENTS.md 的目标是「需求数 + 1」= **30 刀**，本迭代实际 **51 刀**（`v0.2.28..c205b889`）。超出项集中在三处：

- **S-21 早期 3 刀**（`c98339c2` / `63fcfa42` / `164acc99`）+ 收口 4 刀 —— 全部**已推送**，折叠需 `push --force`
- **修复调整批出现多次**（`52206f43` / `986e7fdb` / `95f9a1b4` / `73fdc379` / `e173f96a` / `a7ecbc38`）—— 修复期老大要求「不要改一点就提交」，故按批攒着收口，但仍多于 1 刀
- **临时需求 15 项**本身就是迭代中途追加的，登记与实现常有独立刀

**老大 2026-09-15 裁定：不折叠。** 历史已推送，改写需 force push，风险大于收益；回滚仍可按需求刀定位。**代码内容不受影响。**

## 报告记账

- `review_report.md`：原结论 FAIL（❌ 5 项）→ 收尾日复评 **PASS**。F-1 / F-2 / F-8 修复，F-9 老大裁定不折叠，F-10 空壳工程已删；收尾期追加第五节覆盖需求 26~29 与全部修复
- `verification_report.md`：重写为收尾终态，含逐需求 29 项 VERDICT 与只剩真机项的挂账清单
- `compliance_report.md` / `exploration_findings.md` / `S-21-call-chain-notes.md`：随迭代主体提交存档
