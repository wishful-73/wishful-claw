# 迭代 29 验证报告

> 验证时间：2026-09-15
> 验证对象：`dev/v2-iter-29` @ `ae1f866f`（基线 `4710c6d2` / tag `v0.2.28`）
> 验证方式：编译门禁 + 全部既有回归套件实跑；功能面以真机为准的部分单列
> **结论：门禁 PASS / 功能 PARTIAL**（编译与既有回归零回退；审查发现的功能缺口见 `review_report.md`，本报告不含未验证的猜测）

---

## 一、编译门禁

| 项 | 命令 | 结果 |
|---|---|---|
| TS web | `npx tsc --noEmit -p tsconfig.web.json` | ✅ 0 错误 |
| TS node | `npx tsc --noEmit -p tsconfig.node.json` | ✅ 0 错误 |
| TS root | `npx tsc --noEmit -p tsconfig.json` | ✅ 0 错误 |
| C# 产品（自举口径） | `dotnet build src/runtime/WishfulClaw.Worker/WishfulClaw.Worker.csproj -p:BaseOutputPath=D:\claw\wc-verify\bin\` | ✅ 0 警告 0 错误 |
| C# 测试 | `dotnet build tests/WishfulClaw.Tests.sln -p:BaseOutputPath=D:\claw\wc-verify-tests\bin\` | ✅ 0 警告 0 错误 |
| AOT | `npm run build:worker:prod` | ✅ 编译成功，无 IL2026 / IL3050 / IL3051 |

> 产品 sln 直构被运行中实例锁 bin 的问题依旧存在，按既定口径改用 `-p:BaseOutputPath=` 独立输出目录；测试侧改造后已可独立编译（T-6）。

## 二、TS 回归（12 套，全 PASS）

`renderable-chat-items` / `provider-presets` / `settings-tabs` / `ipc-msgpack-routing` / `channel-cancel-commands` / `provider-fallback` / `channel-reply-event-policy` / `updater-release-notes` / `updater-state` / `updater-progress` / `select-file-tags`（18 断言）/ `streaming-render-pool`（本迭代新增，20045 断言）

## 三、C# 回归（11 工程，全 PASS）

| 工程 | 结果 |
|---|---|
| ProviderHeaderRegressionTests（含 `visibility-snapshot` golden、`UsageLogChecks`） | ✅ passed |
| AgentTimelineRegressionTests | ✅ passed |
| CompactionSnapshotRegressionTests | ✅ parent checks 2 + pasted-block 11 |
| ~~ProviderFallbackRegressionTests~~ | ⛔ **2026-09-15 已删除**（恒真断言，见 review F-10） |
| ToolConcurrencyRegressionTests | ✅ passed |
| ChannelShellApprovalRegressionTests | ✅ 74 断言 |
| GoalRegressionTests | ✅ 148 |
| SessionTaskCascadeRegressionTests | ✅ 180 |
| ChannelToolVisibilityRegressionTests | ✅ 108 断言 |
| CronRegressionTests | ✅ 42 |
| MemoryRecallRegressionTests | ✅ 18 |

## 四、结论与边界

**可以做结论的**：本迭代的编译面与既有回归面**零回退**；25 个需求都落了代码与提交。

**不能由本报告背书的**：门禁跑不出「功能是否真接上」——`review_report.md` 的 3 条功能性 ❌（S-21 的两条、S-20 的一条）全部属于「编译通过、回归通过、但用户路径不生效」类型。这类问题只能靠真机或事件日志定性，故本报告不给 PASS。

## 五、待真机 / 待人工（agent 无环境，不猜）

1. S-21.D7：两个可控 provider 触发 429 → 自动切 + 自动推进（**并顺带验 review F-1 / F-2 / F-3**）
2. S-20：配一个自定义头 → 发消息 → 看 `request_debug` 事件的 headers（**验 review F-8**）
3. S-22：全局派发 → 项目回报 → 助理回复 → 微信端收到
4. T-13.6：粘贴 → chip → 重启后仍在且点开是全文
5. T-14.3：只加载 5 轮历史时统计 == 完整加载；切走再切回不回退不重复
6. T-11.2：`use_capability(action="call", capability_id="builtin:Task" / "mcp-tool:*" / "skill:*")` 三类带参
7. T-15：长思考时前端不滞后、观感不跳
8. S-17 / S-18 / S-19 / S-24：目视验收（状态条真实工具名、分支视图与图谱、自窗口截图落盘、用量面板四态）
