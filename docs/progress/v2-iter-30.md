# v2-iter-30：S-26~S-35 十项需求 + 跨会话撞锁修复 + 清尾巴收口

- 状态：**代码与门禁已就绪，待老大裁定合并 main**
- 分支：`dev/v2-iter-30`（base `main` @ `5aca9b1c`，即 v0.2.29 收尾点）
- Plan: `docs/plans/iter-v2-30/plan.md`；原始需求：`raw-requirements.md`
- 产品版本: `0.2.29`（**尚未 bump**，等收尾发布）
- 日期: 2026-09-16

## 范围与功能单元

### 正式需求 S-26~S-35

- **S-26 工具输出落盘（spill）** — 大工具输出不再被截断丢弃，中间段落盘 + 给定位符，agent 可按需回读。单点改造：所有工具结果进会话前都过 `ToolCallProcessor.ApplyToolOutputLimit`，原 32KB 首尾截断改为「首尾预览 + 中间落盘」。新增 `Spill/SpillStore.cs`（`SpillRef{Locator, Bytes, RetrievalHint}`），落盘到 `~/.wishful-claw/spill/session-<sha256>/<random>-<name>`，`FileMode.CreateNew` 独占、非 Windows 收紧 0700/0600。**三条硬不变式**：`Read` 永不落盘（防 read→spill→read 死循环）／无 sessionId 退回原截断／先扣通知字节再分配预览；落盘失败退回原截断且**绝不动 `IsError`**。新测 `tests/WishfulClaw.GoalRegressionTests/Program.Spill.cs`（13 断言）
- **S-27 免费对话页** — 侧栏「新对话」改组合按钮（左主操作 + 右 `Globe` 图标），右侧进入新页面；页面内嵌内置浏览器（与 `BrowserPanel` **同一 webview partition**，登录态共用），站点横向单选切换、**不留地址栏**；站点清单做成配置项（设置页 → AI 服务 → 免费对话清单，可增删 + 恢复默认，默认 5 站：DeepSeek / Kimi / 智谱清言 / 腾讯元宝 / 豆包）
- **S-28 聊天窗大图预览超出弹窗边界** — 真因：`DialogContent` 是 border-box + 2px 边框 + `p-2`(16px)，内容区仅 `90vh−18px`，而图片 `max-h=90vh−16px` **天生高 2px**，被 `overflow-hidden` 切掉。修：`UserMessage.tsx` 与 `InputArea/image-preview-strip.tsx` 的 `max-h-[calc(90vh-1rem)]` → `max-h-[calc(90vh-3rem)]`
- **S-29 后台任务执行记录** — 勘测推翻知识库前提：记录本已齐全（`memory-organization-log.json` + `readOrganizationReports()`），缺口是**展示太弱**（只最近 3 条、一行摘要、无失败原因）。按老大裁定「形态 A」，在**记忆设置**页新增「整理执行记录」区块，让用户看到是否执行、成功与否
- **S-30 渠道会话的 shell 审批走文本消息** — 根因：渠道 run 强制 `permissionMode:'default'`，审批走渲染端 `confirm()` 对话框，而渠道**没有 UI 消费方** ⇒ 挂死。新增纯模块 `lib/channel/channel-shell-approval.ts`（不 import store/IPC，调用方注入 `send` 回调）：审批以文本消息发进渠道，回复「同意/y/yes/ok/1」放行、「拒绝/n/no/0」拒绝，不匹配提示重发，超时 10 分钟按拒绝；支持「总是允许」落 `permission-policy` allow；开关复用既有 `shellRequiresApproval`。新测 `tests/channel-shell-approval/`（45 断言）
- **S-31 / S-32 聊天窗与思考流式跳动** — 同一根因，一次修。`ThinkingBlock` 原「攒够 48px 才滚一次」把连续跟随拆成离散台阶，改为**每帧无门槛推进**（底部 48px 留白交给容器 `pb-12`）；`useMessageListScroll` 在撤留白**之前**先把视口对齐到真实内容底 —— 原来水位线同帧清 0 但 DOM `min-height` 要等下一次提交才撤，`scrollToBottomImmediate` 按含留白的 `scrollHeight` 推到底、下一帧留白消失被浏览器 clamp 回来，**那一下就是回跳**。渲染池 catch-up 上限**未动**（老大口径：不能让内容去适应缓冲）
- **S-33 队列 banner 新增「立即插入」按钮** — 队列里的待发消息可手动插进当前这一轮，不必等自动出队
- **S-34 会话 todo 状态与实际执行脱节** — 取渲染端对齐（**agent 说了算，代码只对齐展示、绝不动数据**）。三态：**执行中**（本会话有活跃 run）／**待续**（run 已结束、`updatedAt` 未超 3 天，转圈停掉）／**已过期**（超 3 天，灰色虚线圆）；banner 汇总图标改为**真有 run 在跑**才转圈。零新链路（`TaskItem` 本就带 `createdAt`/`updatedAt`）、零 schema 变更
- **S-35 文件树「发送到会话」对文件夹不成立** — 「目录」语义在整条链上不存在，被当成「读不出内容的文件」挂 Read failed 附件。改为判别式统计（`ok` / `directory` / `error`），目录走 `skipped:'directory'` 并给专门文案；hover 按钮放开目录。新测 `tests/selected-file-context/`（20 断言，已验证真能抓 bug）

### 额外修复

- **BUG-A/B 跨会话发送撞锁致渲染端丢 run** — 项目会话在跑时从全局会话发任务，`project-send-message.ts` 直接调 `chatStore.sendMessage` **绕过入队判定**，撞上 worker 的单会话单 run 锁（`MaxConcurrentRuns`），报错卡片 + 原 run 事件流被渲染端丢弃（现象 1+2）。修法放在 **store 层**（覆盖所有绕过 hook 的调用方：渠道自动回复 / cron / sub-agent 唤醒）：`sendMessage` 内部前置判忙、忙则入队
- **清尾巴收口**（`7865e570`）— 跳动修复、`use_capability` 的 `capability_id`/`arguments` 参数描述改为**平级**语义并压到 266 字符、文件树图标间距 `gap-0`→`gap-1`、越权写 C# 的白名单与需求登记
- **缓存统计「缓存 > 总」** — `session-slice.ts` 的 `inputTokens` 用 billable（不含缓存），而展示端按含缓存总额累加；改为 `totalInput + totalCacheRead + totalCacheCreation`（只在「重启后加载历史会话」时复现）
- **回复时间戳改用结束时间** — iter-29 遗留。`action-bar` 时间戳此前**无条件渲染**（同组件正文却受 `!isStreaming` 管），且 live 消息 `updatedAt` 恒 undefined（`serializeMessage` 不传、`dbUpsertMessage` 不回写内存）⇒ 一直显示创建时间。修：`loop_end` / `error` 分支写入 `finishedAt`（**只盖 assistant**，用户消息永远显示创建时间）+ 渲染受 `!isStreaming` 管

## 验证（2026-09-16 收尾时点重跑实测）

- **TypeScript**：`npm run typecheck`（node + web）exit=0
- **TS 回归 21/21 exit=0**：`renderable-chat-items` / `channel-cancel-commands` / `session-follow-up` / `updater-release-notes` / `updater-state` / `updater-progress` / `provider-presets` / `provider-fallback` / `provider-payload` / `session-model-resolution` / `fallback-chain` / `i18n-coverage` / `live-cursor` / `channel-account-label` / `settings-tabs` / `select-file-tags` / `selected-file-context` / `streaming-render-pool` / `channel-reply-event-policy` / `ipc-msgpack-routing` / `channel-shell-approval`
- **C#**：`dotnet build tests/WishfulClaw.Tests.sln` **0 警告 0 错误**
- **C# 回归 10/10 exit=0**：AgentTimeline / ChannelShellApproval / ChannelToolVisibility / CompactionSnapshot / Cron / Goal（含 spill 13 断言）/ MemoryRecall / ProviderHeader / SessionTaskCascade / ToolConcurrency
- **AOT**：`npm run build:worker:prod` 成功，**无 IL2026 / IL3050 / IL3051**，产物 `resources/worker/WishfulClaw.Worker.exe` = 23,157,248 B（含 18 个 CodeGraph grammar 捆绑）
- **BOM**：本次触碰文件全部无 BOM

## 遗留

**待人真机验收（agent 无环境）**：

1. **S-26 spill** —— 跑一次大输出工具，确认落盘文件存在、通知文案里的定位符可被 `Read` 回读；确认 `Read` 自身输出永不落盘
2. **S-27 免费对话页** —— 组合按钮 / 页面跳转 / 站点切换 / **登录态与内置浏览器共用**；设置页增删站点
3. **S-31 / S-32 跳动** —— 长思考 + 组件展开/收起时，聊天窗是否还会回跳（这是本轮最需要真机确认的一项）
4. **S-34 todo 三态** —— 跑一轮长任务，观察 run 结束后转圈是否停掉、超 3 天条目是否标灰
5. **回复时间戳 4 条** —— 回复中不显示 / 结束显示结束时间 / 中断报错也显示 / 重启后历史不变
6. **S-30 渠道 shell 审批**（**需渠道环境**）—— 渠道里触发 shell，确认文本审批能收到、回复词能放行
7. **BUG-A/B** —— 项目会话执行中从全局会话发任务，确认消息进队列而非报错卡片
8. **目视类**：S-28 大图预览边界 / S-33 立即插入 / S-35 文件夹发送 / 清尾巴的文件树间距

**技术欠账**：

- **S-34 的 run 活跃度**未覆盖 `_startingSessionSends` 瞬态窗口（`hasActiveSessionRunForSession` 有、组件订阅没有）；该窗口极短，暂不处理
- **回复时间戳**只在 `loop_end` / `error` 两个分支写 `updatedAt`，其它中断路径未覆盖
- **下版本待议**（沿 iter-29）：②渠道 `displayName` 的 i18n（存库默认名，改 key 会写坏库）；③`meta.requestModel` 全仓零写入方；④`serviceTier` / fast mode 整体未落地
- **`use_capability` 参数错层代码层兜底**（把误塞进 `arguments` 的 `capability_id` / `action` 自动提到顶层）—— 本轮先只改了描述文案，**观察效果后再决定是否升级**

## 提交粒度

本迭代 13 刀（`5aca9b1c..HEAD`），其中 2 刀文档（plan 预算 + 裁定记录）、1 刀收尾合并修复。

- 需求刀 8：S-26 / S-28 / S-29 / S-30 / S-27 / S-33 / S-34 / S-35
- 修复刀 3：S-31+S-32 跳动（并入清尾巴收口刀）/ BUG-A/B 跨会话撞锁 / 收尾（时间戳）
- 文档刀 2：`docs(plan)` 需求清单与裁定记录

未超出「需求数 + 收尾 1~5」的口径，**无需折叠**。
