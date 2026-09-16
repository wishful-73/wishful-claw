# v2-iter-30：S-26~S-45 二十项需求

- 状态：**已收尾**（合并 main + tag `v0.2.30` + Release）
- 分支：`dev/v2-iter-30`（base `main` @ `5aca9b1c`，即 v0.2.29 收尾点）
- Plan：`docs/plans/iter-v2-30/plan.md`；原始需求：`raw-requirements.md`
- 产品版本：`0.2.30`
- 日期：2026-09-16

## 范围与功能单元

### S-26 工具输出落盘（spill）

大工具输出不再被截断丢弃，中间段落盘 + 给定位符，agent 可按需回读。

单点改造：所有工具结果进会话前都过 `ToolCallProcessor.ApplyToolOutputLimit`，原 32KB 首尾截断改为「首尾预览 + 中间落盘」。新增 `Spill/SpillStore.cs`（`SpillRef{Locator, Bytes, RetrievalHint}`），落盘到 `~/.wishful-claw/spill/session-<sha256>/<random>-<name>`，`FileMode.CreateNew` 独占、非 Windows 收紧 0700/0600。

**三条硬不变式**：`Read` 永不落盘（防 read→spill→read 死循环）／无 sessionId 退回原截断／先扣通知字节再分配预览；落盘失败退回原截断且**绝不动 `IsError`**。新测 `tests/WishfulClaw.GoalRegressionTests/Program.Spill.cs`（13 断言）。

### S-27 免费对话页

侧栏「新对话」改组合按钮（左主操作 + 右 `Globe` 图标），右侧进入新页面；页面内嵌内置浏览器（与 `BrowserPanel` **同一 webview partition**，登录态共用），站点切换、**不留地址栏**。

### S-28 聊天窗大图预览超出弹窗边界

真因：`DialogContent` 是 border-box + 2px 边框 + `p-2`(16px)，内容区仅 `90vh−18px`，而图片 `max-h=90vh−16px` **天生高 2px**，被 `overflow-hidden` 切掉。修：`UserMessage.tsx` 与 `InputArea/image-preview-strip.tsx` 的 `max-h-[calc(90vh-1rem)]` → `max-h-[calc(90vh-3rem)]`。

### S-29 后台任务执行记录

勘测推翻知识库前提：记录本已齐全（`memory-organization-log.json` + `readOrganizationReports()`），缺口是**展示太弱**（只最近 3 条、一行摘要、无失败原因）。按老大裁定「形态 A」，在**记忆设置**页新增「整理执行记录」区块。

### S-30 渠道会话的 shell 审批走文本消息

根因：渠道 run 强制 `permissionMode:'default'`，审批走渲染端 `confirm()` 对话框，而渠道**没有 UI 消费方** ⇒ 挂死。新增纯模块 `lib/channel/channel-shell-approval.ts`（不 import store/IPC，调用方注入 `send` 回调）：审批以文本消息发进渠道，「同意/y/yes/ok/1」放行、「拒绝/n/no/0」拒绝，不匹配提示重发，超时 10 分钟按拒绝。新测 `tests/channel-shell-approval/`（45 断言）。

> ⚠️ 该需求此前是**死代码** —— 渠道 preset 白名单没有 `shell`，渠道根本拿不到 Bash。S-43 拆掉白名单后才真正生效。

### S-31 / S-32 聊天窗与思考流式跳动（同源，一次修）

**真凶是全局样式**：`src/renderer/src/assets/main.css` 的 `* { scroll-behavior: smooth; }` —— 通配符 + 继承属性 ⇒ 任何 `el.scrollTop = x` 都从瞬时跳变变成几百 ms 缓动动画，而跟随逻辑**每帧重赋值** ⇒ 每帧打断上一个动画从头再来 ⇒ 滚动条持续蠕动。

修法：两处加 **inline** `scrollBehavior: 'auto'`（`ThinkingBlock` 内层 + `MessageList/VirtualListContent` 外层），**不动全局**（其它地方的动画照旧）。另：思考区提前量取 `THINKING_SCROLL_AHEAD_PX = 128`（视口 320px 的 40%），与内容层 `pb-32` 同步；外层水位线恢复「只增不减」，`min-height` 直写 DOM。

日志实测：每 12 帧才补一次、平缓时 ~8px/帧、**尖峰单帧 159px**（渲染池峰值 235 字符）—— 尖峰是「跟不上」的来源，但压平它要动 `use-typewriter` 的全局节奏，**老大未拍板，不动**。

### S-33 队列 banner 新增「立即插入」

队列里的待发消息可手动插进当前这一轮，不必等自动出队。

### S-34 会话 todo 状态与实际执行脱节

取渲染端对齐（**agent 说了算，代码只对齐展示、绝不动数据**）。三态：**执行中**（本会话有活跃 run）／**待续**（run 已结束、`updatedAt` 未超 3 天，转圈停掉）／**已过期**（超 3 天，灰色虚线圆）。

### S-35 文件树「发送到会话」对文件夹不成立

「目录」语义在整条链上不存在，被当成「读不出内容的文件」挂 Read failed 附件。改为判别式统计（`ok` / `directory` / `error`），目录走 `skipped:'directory'` 并给专门文案。新测 `tests/selected-file-context/`（20 断言）。

### S-36 后台子 agent 结论回不到主会话

根因实测钉死：后台子 agent 的流式文本转发**绑死在父 run 的 transport**，父 run finalize 后 `EmitAsync` 抛错被静默吞掉 ⇒ 渲染端只累积到父 run 死之前的文本。**代理调用不是根因**（两条路在 `ToolDispatchRouter` 汇合，同一个 `SubAgentExecutor`）。

修法（甲案）：**报告由 Worker 落库，与父 run 生死解耦**。新增 `SubAgentReportStore.cs` 读-改-写 `sub_agent_runs.data` 的 `finalOutput`/`finalReportAt`；`DbSubAgentTools` upsert 时**保留已有 finalOutput**（防渲染端整份覆盖冲掉权威报告）；渲染端改「权威报告比已有长就采纳」。新测 `Program.S36Report.cs`（12 断言）。

### S-37 / S-38 更新弹窗正文高度 + 顶部提醒宽度

- **S-37**：`DialogContent` 无 grid 行模板 ⇒ `sm:min-h-[70vh]` 撑出的高度没人吃（全屏态补了行模板所以是对的）。修：加 `grid-rows-[auto_minmax(0,1fr)_auto]`，正文去掉写死 `max-h-48` 改 `flex-1`
- **S-38**：API key 提醒与工作目录提醒**没套** `composerWidthClass`（裸 `w-full`）⇒ 比输入框宽

### S-39 内置浏览器洗白 UA

根因两层：`browser:emulation-status` 是**纯 stub**（恒回 `userAgent:''`），渲染端无条件采纳把正确初始值覆盖成空；`stripElectronFromUserAgent` 只剥 ` Electron/<ver>`，留着应用名 token。

修：UA 改为按「平台 + 真实 Chrome 版本」**重建标准 Chromium UA**；UA 与 partition 策略**解耦**；IPC 回空 UA **不采纳**。新测 `tests/browser-user-agent/`（24 断言）。

### S-40 免费对话页改多选项卡

登录态丢失根因：`<webview>` 的 `partition` **仅在元素创建时生效**，而 mount 时 `runtimeReuseEnabled=true`（默认）不带 partition ⇒ 默认 session；IPC 回来变 false 后，只有切站点（key 变、重建）才带上分区 ⇒ **session 换了**，首次打开的登录态丢失。

修：分区**写死** `BUILTIN_BROWSER_PARTITION`；一行选项卡；webview **常驻**（切换只切 `invisible`，不用 `display:none`）；持久化 `freeChatOpenTabIds`/`freeChatActiveTabId`。新测 `tests/free-chat-tabs/`（22 断言）。

### S-41 免费对话清单从设置页迁入免费对话面板

设置页退役该 tab（`normalizeSettingsTab('freeChat')` 回落默认，不渲染空白）；免费对话页新增齿轮弹窗 `FreeChatSitesDialog`。

### S-42 Todo 工具核心化

老大口径：「都进代理了 还专门在提示词上提示，那不是脱了裤子放屁么，还不如直接核心化」「开工 session_todo 这个标签都不应该要」。

`ToolCategoryCatalog` 新增 `todo` 类别并进 `Core`；`PromptBuilder` 删掉整个 `<session_todo>` 块；`WriteStandaloneSummary` 返回值加 `progress` 事实行（**只给事实、不加嘱咐**）。

**顺带修掉一个真 bug**：preset 白名单漏洞 —— 直连注入要过「白名单 ∧ IsCore」两道门，只改第二道 ⇒ `inspect`/`call` 猜名仍能通。新增防复发断言：`Core` 里每个类别必须被 `chat` 与 `coding` 白名单覆盖。

### S-43 ToolPreset 机制整体退役

老大口径：「我建立正经规则的目的就是为了替换掉它，之前的太混乱了」。

删前 golden 逐上下文比对结论：`chat`/`coding` 与无过滤**完全一致**（零收窄）、`channel` 只砍 shell 且**这个收窄本身是错的**、`automation` 真机零调用方、`minimal`（宠物）整条链是死代码、`skill-installer` 是空壳。

删掉 `ToolPreset.cs` 整个类，可见性收敛为**单轨**（`VisibleScopes`/`ExcludedScopes` + `AgentRunContextPolicy`）。渲染端 8 处 `toolPreset` 传参全清。golden 从多 preset 段压成 15 行单段。

### S-44 会话 todo 每轮注入现状

根因：`InjectTransientPrefix` 是系统唯一「每轮注入」通道，但**一个 user turn 只注入一次**且写进历史；todo 恰恰在 turn 执行中才创建 ⇒ agent 之后看不见。

新增 `AgentLoop.SessionTodo.cs`（`InjectSessionTodo` + 纯函数 `BuildSessionTodoBlock`），走**临时副本**（`conversation` 一字不动，避免废掉前缀缓存）。四条设计：只给事实零嘱咐／只在有未完成项时注入／一律 `\n`／未完成项上限 8。新测 `Program.SessionTodo.cs`（17 断言）。

### S-45 配对错无自愈：悬空 tool_calls 让会话永久 400

见 `raw-requirements.md` S-45 详述。要点：

- **现场**：生产库 13 条 400 / 3 个会话，`lOzL9w1ou1FUddATk2XEq` 21:03 **连挂 5 次**。文案 `An assistant message with 'tool_calls' must be followed by tool messages...`
- **根因**：assistant 进会话后，工具结果写回**排在工具执行下游** ⇒ 异常/中断直接穿出去，补齐整段被跳过；`SessionConversation` 是进程级常驻的，悬空调用留在内存 ⇒ 之后每次请求都 400
- **修法**：P0 工具执行改 `try/finally`（结果写回放进 `finally`）；P2 catch 链加错误驱动分支（识别配对错 → 修 → 重发，上限 2 次，**修不动就 `throw`，不空转**）；`ProviderRetryPolicy` 把配对错从 400 重试里让出去（**普通 400 的重试资格按原设计不动** —— 那是 2026-08-28 确认过的）；`RepairToolPairing` 改 **conversation 层 / wire 层各扫各的**
- **P1（发请求前无条件规范化）老大明确砍掉**：「这个太浪费时间了」
- 新测 `Program.ToolPairing.cs`（27 断言）

### 额外修复

- **BUG-A/B 跨会话发送撞锁致渲染端丢 run**（`e27daf62`）— 项目会话在跑时从全局会话发任务，`project-send-message.ts` 直接调 `chatStore.sendMessage` **绕过入队判定**，撞上 worker 的单会话单 run 锁。修法放在 **store 层**（覆盖所有绕过 hook 的调用方）
- **清尾巴收口**（`7865e570`）— `use_capability` 的 `capability_id`/`arguments` 参数描述改为**平级**语义并压到 266 字符、文件树图标间距 `gap-0`→`gap-1`、缓存统计口径、todo banner 点击区
- **回复时间戳改用结束时间**（`ac30a723`）— `loop_end` / `error` 分支写入 `finishedAt`（**只盖 assistant**），渲染受 `!isStreaming` 管

## 验证（2026-09-16 收尾时点重跑实测）

- **TypeScript**：`npm run typecheck`（node + web）exit=0
- **TS 回归 23/23 exit=0**：`renderable-chat-items` / `channel-cancel-commands` / `session-follow-up` / `updater-release-notes` / `updater-state` / `updater-progress` / `provider-presets` / `provider-fallback` / `provider-payload` / `session-model-resolution` / `fallback-chain` / `i18n-coverage` / `live-cursor` / `channel-account-label` / `settings-tabs` / `select-file-tags` / `selected-file-context` / `streaming-render-pool` / `channel-reply-event-policy` / `ipc-msgpack-routing` / `channel-shell-approval` / `browser-user-agent` / `free-chat-tabs`
- **C#**：`dotnet build tests/WishfulClaw.Tests.sln` **0 警告 0 错误**
- **C# 回归 10/10 exit=0**：AgentTimeline / ChannelShellApproval（72）/ ChannelToolVisibility（98）/ CompactionSnapshot / Cron（42）/ **Goal（213，含 spill 13 + S-36 12 + S-44 17 + S-45 27）** / MemoryRecall（18）/ ProviderHeader / SessionTaskCascade（180）/ ToolConcurrency
- **AOT**：`npm run build:worker:prod` 成功，**无 IL2026 / IL3050 / IL3051**，产物 = 23,159,296 B
- **BOM**：本次触碰文件全部无 BOM

## 遗留

**待人真机验收（agent 无环境）**：

1. **S-26 spill** —— 跑一次大输出工具，确认落盘文件存在、定位符可被 `Read` 回读；确认 `Read` 自身输出永不落盘
2. **S-31 / S-32 跳动** —— 长思考 + 组件展开/收起时是否还会回跳（**已真机确认「这次整体效果就很好」**）
3. **S-39 / S-40 免费对话页** —— 切 tab 不重载 / 登录态保持 / 重开页面恢复 tab / × 掉重开需重载但不必重登
4. **S-42 / S-44 todo** —— 跑三步以上任务，确认 agent 主动建 todo 并**中途更新**（重启 dev 后验）
5. **S-30 渠道 shell 审批**（**需渠道环境**）—— 渠道里触发 shell，确认文本审批能收到
6. **S-45** —— 跑一个会被中断的任务（工具执行中取消），确认之后不再 400
7. **目视类**：S-28 大图预览边界 / S-33 立即插入 / S-35 文件夹发送 / S-37 更新弹窗 / S-38 顶部提醒宽度

**技术欠账**：

- **S-34 的 run 活跃度**未覆盖 `_startingSessionSends` 瞬态窗口；该窗口极短，暂不处理
- **回复时间戳**只在 `loop_end` / `error` 两个分支写 `updatedAt`，其它中断路径未覆盖
- **`RepairToolPairing` 只处理「缺 result」方向**，不处理孤儿 tool_result（本次实测未遇到该形态）
- **`ConversationCodec.cs:90-121` 与 `SessionRestoreTools.cs:645-676` 是两份逐字相同的解析代码** —— 改一边漏一边是迟早的事
- **下版本待议**（沿 iter-29）：②渠道 `displayName` 的 i18n；③`meta.requestModel` 全仓零写入方；④`serviceTier` / fast mode 整体未落地
- **`use_capability` 参数错层代码层兜底** —— 本轮先只改了描述文案，观察效果后再决定是否升级

## 提交粒度

本迭代 **25 刀**（`5aca9b1c..HEAD`），**超出「需求数 + 1」的口径**。

- **需求刀 16**：S-26 / S-27 / S-28 / S-29 / S-30 / S-31+S-32 / S-33 / S-34 / S-35 / S-36 / S-37+S-38 / S-39 / S-40 / S-41 / S-42+S-43+S-44 / S-45
- **修复刀 5**：BUG-A/B 撞锁 / 清尾巴收口 / 时间戳 / S-40 的两次微调
- **文档刀 4**：plan 预算、裁定记录、S-41~S-44 登记、删除早期测试方案

**未折叠的原因**：25 刀里 15 刀已推送（改不了）；剩余 10 刀中 `raw-requirements.md` 被 4 刀分别修改，按 hunk 折叠的风险大于收益。**如需要，可在下个迭代开工前用 `git rebase -i` 处理。**
