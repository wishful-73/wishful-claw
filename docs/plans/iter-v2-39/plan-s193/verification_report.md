# S-193 验证报告（阶段六）

**VERDICT: PARTIAL**

一句话结论：门禁三绿、S-193 的 **C# / TS / UI 三侧改动**与审查 ❌-1 的修复链路**逐条静态核实闭环**（含旧库迁移、时钟一致性、三条读取路径的一致性）；但核心验收（**重置后底部归零、重启后仍为 0、消息与逐条 token 摘要不受影响**）**必须实机点击**才能兑现 ⇒ 判 **PARTIAL**，无 FAIL、无阻断项。

> 验证者：**主会话**（本需求的阶段五审查已由独立 subagent 出具 `plan-s193/review_report.md`；验证由主会话现场跑，证据口径与被举荐的 S-191 报告一致：能跑必须跑、必须有工具证据）。
> 范围：`dev/v2-iter-39`（base `2c925c88`），工作区 = `ad2ac62f` + 审查 ❌-1 修复（**未提交，攒收尾刀**）。
> 基准：`plan-s193/plan.md` + `plan-s193/review_report.md`（❌ 1 已修 / ⚠️ 2 留裁定）。

---

## 一、门禁证据

**环境前置**：`Get-Process | Where-Object { $_.Path -like "D:\claw\wishful-claw\*" }` → **空**（仓库内无 dev 实例 / Worker 命中，仅有打包版在 `C:\Program Files\WishfulClaw\`，不锁仓库 `bin\`）⇒ 门禁可跑。

| 命令 | 结果 | 关键输出 |
|---|---|---|
| `npm run typecheck` | **0 错误** | `typecheck:node` / `typecheck:web` 两段均无诊断输出，`exit=0` |
| `npm test` | **69 / 69 通过**（TS 52 + C# 17） | 汇总行 `69/69 通过`；C# 侧 17 套件全绿 |
| `dotnet build src/runtime/WishfulClaw.sln` | **0 警告 0 错误** | `已成功生成。0 个警告 0 个错误`，`WishfulClaw.Worker -> …\bin\Debug\net11.0\WishfulClaw.Worker.dll` |

三条与 `plan.md` §四基线**一致，无回归**。

---

## 二、静态验证（逐改动）

| 改动 | 位置 | 验证结论 |
|---|---|---|
| 1 · 加列迁移 | `Infrastructure/Db/DbClient.cs` | 落点在既有增量列块（`:520-547`，与 `context_revision` 同模式）：`EnsureColumn("sessions", "usage_stats_reset_at", "INTEGER NOT NULL DEFAULT 0")`。`EnsureColumn`（`:754`）走 `PRAGMA table_info` + 幂等 `ALTER TABLE`。**新库**：`sessions` CREATE TABLE（`:87`）不含新列，由该块补 ⇒ 新老库路径一致。**5 处 `INSERT INTO sessions` 均为显式列名**，吃 DEFAULT 0 |
| 2 · 聚合过滤 | `Infrastructure/Db/DbMessageCompactTools.cs` `UsageStats` | 聚合 SQL 加 `AND created_at > COALESCE((SELECT usage_stats_reset_at FROM sessions WHERE id=@sid), 0)`。会话行缺失 / 列为 0 ⇒ 子查询 NULL → `COALESCE` → 0 → 恒真，**与改动前完全等价**（`QueryScalar<T>` 查不到给 `default(long)=0`）。用 `>` 而非 `>=` 恰当 |
| 3 · **❌-1 根修** | 同上 | `hasUsage` 改判 `AssistantReplies > 0 \|\| resetAt > 0`（新增 `resetAt` 查询）⇒ 重置过的会话即使过滤后 0 条也返回**有效（0）**，不再落到「null ⇒ 逐条相加」的老兜底。**一条修覆盖三条读取路径**：重置动作 / 切会话重载 / 重启后加载 |
| 4 · 重置写入 | `Infrastructure/Db/DbSessionTools.cs` `ResetUsageStats` | **只** `UPDATE sessions SET usage_stats_reset_at = @at WHERE id = @id`，**不碰 messages**（硬约束①）。序列化走 `InfrastructureJsonContext.Default.SessionUsageResetResult` |
| 5 · 通道注册 | `Infrastructure/Db/DbModule.cs:41` | `db/session-reset-usage-stats`（**单数**，与 `db/session-reset-conversation` / `db/session-status` 同风格）。**不走跨端四处登记** —— `db/*` 走 WorkerRequest 通道，注册一行即可 |
| 6 · AOT 双注册 | `InfrastructureJsonContext.cs:98` + `WishfulClaw.Worker/WishfulClawJsonContext.cs:37` | `SessionUsageResetResult` 两处齐 —— 漏一处运行时当场报错 |
| 7 · renderer 通道 | `stores/chat-store/db-helpers.ts` | `dbResetSessionUsageStats(sessionId)` → `'db/session-reset-usage-stats'`，与 C# 注册名**逐字符一致** |
| 8 · 口径共用 | `stores/chat-store/session-slice.ts` | 抽模块级 `baselineFromUsageRollup(rollup)`，「首次加载会话」与「重置」**共用同一换算口径**（rollup 的 `totalInput` 不含缓存，故把 `cacheRead` / `cacheCreation` 加回，与状态栏累加口径对齐） |
| 9 · **❌-1 兜底** | 同上 | 新增 `ZERO_USAGE_BASELINE`；重置后不再把 `usageBaseline` 置 `undefined`，落 `baselineFromUsageRollup(usageBaseline)` 或零值 ⇒ 走 `runtime-status.tsx:101` **正路**，不进 `:110-114` 兜底分支。失败分支补 `console.warn('[DB] resetSessionUsageStats rejected by worker:', sessionId)`（⚠️-1） |
| 10 · 入口替换 | `components/layout/SessionConversationPane.tsx` | 浮窗「更多」第二项旧 `DropdownMenuItem`（deleteSession）**被整体替换**为「重置用量统计」（`:270-272`，**非并列**，硬约束②），带 `confirm({ variant: 'destructive' })`（硬约束③）；`Trash2` → `RotateCcw`，无残留未用 import |
| 11 · 文案 | `locales/zh/layout.json:235-237` + `locales/en/layout.json:235-237` | 三键 `resetUsageStats` / `resetUsageStatsConfirmTitle` / `resetUsageStatsConfirmDesc`，zh / en **1 : 1**，`sidebar` 子对象 key 集合 65 : 65 |
| 12 · 时钟一致性 | `DbMessageTools.cs:24/88` + `chat-store/index.ts:306/322` | `messages.created_at` 唯一写入路径 = `MessageEntity.CreatedAt`（默认 `DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()`）；渲染端入参是 `Date.now()`。**同为 UTC epoch 毫秒**，与重置写的同一时间基准 ⇒ **无错位**（`>` 判定不会误伤同毫秒旧消息，也不会漏掉新消息） |
| 13 · 无第二条绕过路径 | 全仓 | `usage IS NOT NULL` 只命中 `DbMessageCompactTools.cs:67` 一处 SQL；设置页全局用量走独立的 `request_usage_logs`（`DbUsageLogQueryTools`）⇒ 过滤生效面可控（非目标 2 成立） |

**文件卫生**：改动文件**无 BOM**（`EF BB BF` 未命中）、**全 CRLF**（`bareLF = 0`）；zh / en 文案与代码内联字符串一致。

**范围核对（对照 `plan.md` §六非目标）**：未删消息、未清 `messages.usage`、未动设置页全局用量、未动上下文环、未删侧边栏右键的「删除会话」、未加 G 单位、未合并三套 token 格式化实现 —— **7 条非目标全部守住**。

---

## 三、实机验证项（**分级**；PARTIAL 的来源）

> 起实例方式：`docs/dev-workflow.md`。**E-1 ~ E-3 是本需求的验收主干，缺一不可合口。**

**必测**

1. **E-1 · 重置后底部归零（含重启）** —— 本需求的**主判据**，也是审查 ❌-1 的落点。
   验什么：挑一个底部数字较大的会话 → 浮窗「更多」→「重置用量统计」→ 二次确认 → 输入框下方那排 token 指标**变成 0**（不是「变成某个非零小数」——若仍是驻留窗口的量，说明 ❌-1 没修透）；**切走会话再切回**仍为 0；**重启应用**仍为 0。
   怎么验：`npm run dev:full` → 进入会话 → 点重置 → 记录三次数值（重置瞬间 / 切回后 / 重启后）。

2. **E-2 · 消息与逐条摘要不受影响** —— 硬约束①。
   验什么：重置后**消息条数不变**；AI 消息下方的逐条 token 摘要（`AssistantMessage/token-summary.tsx`）**仍在**；会话历史可正常上下翻。
   怎么验：同一会话，重置前后各扫一遍消息列表。

3. **E-3 · 重置后只累计新量** —— 验收判据 3。
   验什么：重置后继续发 1~2 轮对话 ⇒ 底部从 0 起累计，**只**计新产生的量（含缓存读写），不含重置前那 1127M。
   怎么验：重置 → 发一轮 → 观察增量是否为「一轮的合理量级」而非「旧值 + 一轮」。

**可选（静态已核，实机为确认）**

4. **E-4 · 浮窗菜单形态** —— 硬约束②③。
   验什么：「更多」里**不再有**「删除会话」，只有「重命名」+「重置用量统计」；点重置先弹二次确认，取消不生效。
   怎么验：点开「更多」直接看；点一次再取消。

5. **E-5 · 侧边栏右键的「删除会话」仍在** —— 非目标 4。
   验什么：会话列表右键菜单里删除会话**保留**，删除仍弹确认且真删。
   怎么验：右键任一（可丢弃的）会话看菜单项。

6. **E-6 · 设置页全局用量不受影响** —— 非目标 2。
   验什么：重置某会话后，设置 · 用量统计的上方概览与请求明细**不发生变化**。
   怎么验：重置前后各截一次设置页数字。

---

## 四、新发现问题

**无新增**。审查阶段遗留两条**留裁定**项，随本报告一并上报：

1. **（⚠️-2，中）`DbClient.EnsureColumn` 的 `catch {}` 静默吞异常**（`DbClient.cs:773-776`）—— 一旦 ALTER 静默失败，`db/messages-usage-stats` 会因 `no such column: usage_stats_reset_at` **整体抛错** ⇒ **全仓所有会话**的底部统计退化成「驻留窗口逐条相加」，且无日志无提示。`EnsureColumn` 是所有表共用的迁移原语，加日志 / 重试属**通用改动**，超出 S-193 范围 ⇒ **待老大裁定**是否单排一条需求。
2. **（⚠️-3，中）无回归测试** —— `tests/**` 搜 `usage-stats|UsageStats|usage_stats|usageBaseline|sessionUsageTotals` **0 命中**。仓库有现成模式可照抄（C# `WishfulClaw.CompactionSnapshotRegressionTests` / TS `tests/*/program.ts`），一条「重置前 N / 重置后 0 / 再插一条只统计新的」即可同时兜住 ❌-1。加套件会动 `package.json` 计数（**69 → 70**）⇒ 属范围外新增，**待老大裁定**。

---

## 五、汇总

- **门禁**：`typecheck` 0 错误 / `npm test` 69/69 / `dotnet build sln` 0 警告 0 错误（现场复跑，与基线一致）。
- **静态验证**：13 项逐条核实通过；**审查 ❌-1 的根修已闭环**（`hasUsage` 语义修正 + renderer 零值兜底，覆盖三条读取路径）；7 条非目标全部守住；文件卫生（无 BOM / 全 CRLF）达标。
- **VERDICT**：**PARTIAL** —— 静态面**全过**，0 FAIL、0 阻断项；差 **6 项实机**（其中 **E-1 ~ E-3 为验收主干**）。
- **待办**：E-1 ~ E-3 实机后即可把本条从 PARTIAL 收敛；两条留裁定项（EnsureColumn 静默失败 / 无回归测试）等老大定去留。
