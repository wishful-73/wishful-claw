# 迭代 29 验证报告（收尾终态）

> 验证时间：2026-09-15 晚（收尾时点重跑，**不沿用 09-15 上午的旧数字**）
> 验证对象：`dev/v2-iter-29` @ `e173f96a`（基线 `4710c6d2` / tag `v0.2.28`）
> 验证方式：编译门禁 + 全部回归套件实跑；功能面以真机为准的部分单列，不猜
> **结论：PASS**（编译与回归零回退；29 个需求全部落代码与提交；剩余挂账均为「agent 无环境」类真机项，见 §五）

---

## 一、编译门禁（实测 exit code）

| 项 | 命令 | 结果 |
|---|---|---|
| TS web | `npx tsc --noEmit -p tsconfig.web.json` | ✅ exit=0 |
| TS node | `npx tsc --noEmit -p tsconfig.node.json` | ✅ exit=0 |
| TS root | `npx tsc --noEmit -p tsconfig.json` | ✅ exit=0 |
| C# 测试 sln | `dotnet build tests/WishfulClaw.Tests.sln -p:BaseOutputPath=D:\claw\wc-verify-tests\bin\` | ✅ 0 警告 0 错误 |
| C# 产品（自举口径） | `dotnet build src/runtime/WishfulClaw.Worker/WishfulClaw.Worker.csproj -p:BaseOutputPath=D:\claw\wc-verify\bin\` | ✅ 0 警告 0 错误 |
| AOT | `npm run build:worker:prod` | ✅ 成功，**无 IL2026 / IL3050 / IL3051**；产物 `resources/worker/WishfulClaw.Worker.exe` = 23,150,592 B |

> 产品 sln 直构会被运行中的生产实例锁住 bin，按既定口径改用 `-p:BaseOutputPath=` 独立输出目录；**不要**覆盖 `BaseIntermediateOutputPath`（触发 MSB4006）。

## 二、TS 回归（19 套，全 exit=0）

| 套件 | 断言 |
|---|---|
| `streaming-render-pool` | 20045 |
| `provider-presets` | 546（46 presets） |
| `updater-release-notes` | 71 |
| `updater-state` | 56 |
| `provider-payload` | 54 |
| `provider-fallback` | 40 |
| `updater-progress` | 35 |
| `session-model-resolution` | 23 |
| `fallback-chain` | 22 |
| `settings-tabs` | 22 |
| `live-cursor` | 20 |
| `session-follow-up` | 20 |
| `select-file-tags` | 18 |
| `renderable-chat-items` | 16 |
| `channel-account-label` | 12 |
| `i18n-coverage` | 2（引用一致性守卫） |
| `ipc-msgpack-routing` | 96（270 注册通道） |
| `channel-cancel-commands` | passed |
| `channel-reply-event-policy` | passed |

## 三、C# 回归（10 工程，全 exit=0）

| 工程 | 结果 |
|---|---|
| ProviderHeaderRegressionTests | ✅ passed（含 `visibility-snapshot` golden 自洽 + `UsageLogChecks`） |
| AgentTimelineRegressionTests | ✅ 25 断言 |
| CompactionSnapshotRegressionTests | ✅ exit=0（父检查 2 + 子进程套件 / pasted-block 11） |
| ToolConcurrencyRegressionTests | ✅ passed |
| ChannelShellApprovalRegressionTests | ✅ 72 断言 |
| GoalRegressionTests | ✅ 148 |
| SessionTaskCascadeRegressionTests | ✅ 180 |
| ChannelToolVisibilityRegressionTests | ✅ 108 |
| CronRegressionTests | ✅ 42 |
| MemoryRecallRegressionTests | ✅ 18 |

> `WishfulClaw.ProviderFallbackRegressionTests` 已于本迭代删除（恒真断言，假安全感），测试 sln 由 13 工程收敛到 12。

## 四、逐需求 VERDICT（29 项）

| # | 需求 | VERDICT | 备注 |
|---|---|---|---|
| 1 | S-24 用量统计请求明细上移进选项卡 | ✅ | 目视待验 |
| 2 | S-20 自定义服务商可配置请求头 | ✅ | F-8 已修（载荷单点构造），真机可反证 |
| 3 | S-22 全局任务回报后新消息回推微信 | ⚠️ | **无微信环境** |
| 4 | S-17 代理调用状态显示真实工具名 | ✅ | 目视待验 |
| 5 | S-23 搜索能力收敛到 BrowserSearch | ✅ | |
| 6 | S-16 输入框长粘贴折叠块 | ✅ | |
| 7 | S-18 右侧面板 Git 分支视图 | ✅ | F-12 已补截断提示；目视待验 |
| 8 | S-19 软件自身界面截图能力 | ✅ | 目视待验；F-13 路径边界待老大裁定 |
| 9 | S-21 多服务商限额自动 fallback | ✅ | F-1~F-5 全部修复；**B1 真机待验** |
| 10 | S-25 Agent 工作时间线 | ✅ | |
| 11 | T-1 消息时间显示口径 | ✅ | |
| 12 | T-2 底部统计条改读会话总统计 | ✅ | |
| 13 | T-3 长驻进程渲染膨胀 | ✅ | |
| 14 | T-4 流式光标 | ✅ | 口径两次修正，最终「任何时刻只有一个」 |
| 15 | T-5 用量统计面板体验收口 | ✅ | |
| 16 | T-6 测试工程独立 sln + 移除 playwright e2e | ✅ | |
| 17 | T-7 中断后 400 | ✅ | |
| 18 | T-8 思考区上下跳 | ✅ | 老大真机确认 |
| 19 | T-9 吸附卡遮挡 | ✅ | |
| 20 | T-10 压缩 head 前缀 pin 孤立 tool_result | ✅ | |
| 21 | T-11 `arguments` 自由对象 | ✅ | |
| 22 | T-12 空响应纳入重试 | ✅ | |
| 23 | T-13 聊天窗 chip 化 | ✅ | 真机待验（重启后 chip 仍在） |
| 24 | T-14 底部统计条口径统一 | ✅ | 真机待验 |
| 25 | T-15 思考流式追赶 | ✅ | 数学性质已由 20045 断言锁死；观感待真机 |
| 26 | S-21 收口：候选链改「服务商+模型」+ 两层配置 + 吞卡片 | ✅ | **本轮最核心，B1 待真机** |
| 27 | 渠道配置页改版 | ✅ | 老大真机确认 |
| 28 | 渠道全局设置去选项卡、字段 8→2 | ✅ | 老大真机确认 |
| 29 | 顶栏浏览器快捷入口 | ✅ | 老大真机确认 |

## 五、挂账：只能靠真机（agent 无环境，不猜）

**优先级从高到低：**

1. **需求 26「切换要粘住」**（本轮最核心）—— auto 会话撞限额 → 自动切下一家 + 自动发「继续推进」；此后**再发一条普通消息，应仍走新服务商**而不是回到刚限额那家。同时验「不吞错」（候选试完时卡片照常出现）。
2. **协议取值改模型级优先的影响面** —— `openai` / `azure-openai` / `copilot-oauth` 共 37 个模型端点由 `/chat/completions` 改为 `/responses`，需真机确认这些模型能正常出话。
3. T-13：粘贴 → chip → 重启应用后 chip 仍在且点开是全文。
4. T-14：只加载 5 轮历史的会话，底部统计 == 完整加载；切走再切回不重复不回退。
5. T-15 / T-4：长思考时不滞后、不失帧；光标「思考时有、最下方无」。
6. T-11.2：`use_capability(action="call", capability_id="builtin:Task" / "mcp-tool:*" / "skill:*")` 三类带参。
7. S-20：配一个自定义头 → 发消息 → 看 `request_debug` 事件的 headers。
8. S-22：全局派发 → 项目回报 → 助理回复 → 微信端收到（**需微信环境**）。
9. 目视类：S-19 自窗口截图落盘、S-18 分支视图、S-24 用量面板、S-17 状态条真实工具名。
10. 需求 28 的 `shellRequiresApproval` 生效性（渠道侧 shell 审批出口问题已登记下版本）。

## 六、证据边界（如实声明）

- **本报告能背书**：编译面、回归面、AOT 面零回退；29 个需求都有实现与提交；全仓残留扫描（1416 文件）无退役标识符泄漏。
- **本报告不能背书**：门禁跑不出「功能是否真接上用户路径」。§五 的挂账项全部属于这一类，需真机或事件日志定性。
- **截图证据**：本迭代仍未产出 `evidence/*.png`（agent 侧无屏幕捕获通路），与 iter-27 / iter-28 同款欠账，非本迭代新增缺口。
