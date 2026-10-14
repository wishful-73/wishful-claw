# S-193 审查报告（阶段五）

> 审查人：**独立 subagent**（`code-reviewer`，后台运行，64 次工具调用 / 39 轮）。
> 审查对象：`ad2ac62f`（分支 `dev/v2-iter-39`，base `2c925c88`）。
> 规划依据：`requirements/S-193.md`（老大口径：方案 B、只清统计不动消息、浮窗「删除会话」换掉、带二次确认）。
> 出报告：2026-10-13。
> **结论：❌ 1（已修）/ ⚠️ 3（1 条已修、2 条留裁定）+ 1 条文档回填 —— 无残留阻断，可进验证态。**

---

## 一、改动核对

| 审查项 | 结论 | 证据 |
|---|---|---|
| 硬约束① 不删消息、不动 `messages.usage` | ✅ | diff 内 C# 只有一条 `UPDATE sessions SET usage_stats_reset_at`（`DbSessionTools.cs:308-311`），**无任何 messages 写操作** |
| 硬约束② 不是与「删除会话」并列 | ✅ | 旧 `DropdownMenuItem` 被整体替换（`SessionConversationPane.tsx:270-272`），菜单内已无 deleteSession 项；侧边栏右键的删除保留（S-193.md §7.4） |
| 硬约束③ 二次确认 | ✅ | `await confirm({ ... variant: 'destructive' })`（`SessionConversationPane.tsx:89-98`） |
| §7.2 不动设置页全局用量 | ✅ | 未触碰 `request_usage_logs` 链路 |
| §7.3 不动上下文环 / §7.5 不加 G 单位 | ✅ | 未触碰任何格式化实现 |
| `EnsureColumn` 对老库 / 新库 | ✅ | 新库：`CREATE TABLE`（`DbClient.cs:87`，不含新列）→ `EnsureColumn` 段（`:520-547`）补列，SQLite 允许带常量默认值的 NOT NULL 列；老库：`PRAGMA table_info` 探测 + 幂等 ALTER。5 处 `INSERT INTO sessions` 全为显式列名，吃 DEFAULT 0 |
| 聚合 SQL 边界（会话不存在 / 值为 0 / 同毫秒） | ✅ | 子查询 NULL → `COALESCE` → 0 → 恒真，与改动前**等价**；用 `>` 而非 `>=` 恰当（`>=` 会把重置那一刻的旧消息重新纳入） |
| **时钟一致性** | ✅ | `messages.created_at` 唯一写入路径是 `DbMessageTools.cs:24` ← `MessageEntity.CreatedAt`（默认 `DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()`，`DbMessageTools.cs:88`）；渲染端给的是 `Date.now()`（`chat-store/index.ts:306/322`）。同为 UTC epoch 毫秒，**无基准错位** |
| 无第二条绕过过滤的统计路径 | ✅ | 全仓 `usage IS NOT NULL` 只命中 `DbMessageCompactTools.cs:67` 一处 SQL；设置页全局用量走独立的 `request_usage_logs`（两处源码注释即证） |
| `message_end` 不会把旧值加回来 | ✅ | `chat-store/index.ts:1084` 只吃本次事件的增量；`sessionUsageTotals` 已被清空 |
| AOT 双注册 | ✅ | `SessionUsageResetResult` 同时注册于 `InfrastructureJsonContext.cs:98` 与 `WishfulClawJsonContext.cs:37` |
| 无 BOM / 全 CRLF / 无 unused import | ✅ | 12 文件逐字节核验：无 `EF BB BF`；`LF-only = 0`；`Trash2` 已移除且零引用，`session` / `useUIStore` 仍在用（`tsconfig.web.json` 开了 `noUnusedLocals`，typecheck 0 错即证） |
| zh / en 文案 | ✅ | 三键命名与顺序完全对应，`sidebar` 子对象 key 集合同为 65 : 65 |
| 图标与 destructive 变体 | ✅ | `RotateCcw` 已导入（`:3`）且仓内 20+ 处在用；`confirm({ variant: 'destructive' })` 是仓库主流写法（20+ 处） |

---

## 二、❌ 项（1 条，已修）

### ❌-1 重置后底部数字不会归零 —— 会退化成「驻留窗口逐条相加」

**这是与验收硬口径直接冲突的缺陷，主用例（重置一个空闲会话）下不成立，重启后依然不成立。**

链路：

1. `db-helpers.ts:609` —— `return result?.success && result.hasUsage ? result : null`，而 `hasUsage = AssistantReplies > 0`（`DbMessageCompactTools.cs:87`）。重置刚做完时过滤后没有任何 assistant 消息 ⇒ **`hasUsage = false` ⇒ 返回 `null`**（常见路径，不是边角）。
2. 原实现在 `null` 时把 `usageBaseline` 置为 `undefined`（`session-slice.ts`），同时 `sessionUsageTotals = undefined`。
3. `runtime-status.tsx:101` 判空失败 ⇒ 落到 `:110-114` 的兜底分支，把 `session.messages` 每条的 `usage` 相加 ⇒ 底部显示的是**驻留窗口（默认 15 轮）的 token 之和，而不是 0**。
4. 该值持久：非 runtime-resident 会话重载时同样受 `if (usageBaseline)` 守卫，返回 null 就不写 baseline ⇒ 切走再回来、重启后依旧。

**定性**：旁证表明是实现疏忽而非有意 —— `db-helpers.ts:582-583` 的既有注释写「callers fall back to a **zero** baseline」，`runtime-status.tsx:111` 把兜底定性为「从未取过 baseline 的会话」；S-193 新造出「baseline 为空但消息带 usage」的状态，恰好踩进这条老兜底。

**修法（已落地，两处）**：

- **C# 主修**（`DbMessageCompactTools.cs`）—— 修正 `hasUsage` 的语义：它表示「有没有可用的统计结果」，而不是「有没有 assistant 消息」。重置过的会话结果就是 0，仍是有效统计：

  ```csharp
  var resetAt = db.QueryScalar<long>(
      "SELECT COALESCE(usage_stats_reset_at, 0) FROM sessions WHERE id = @sid",
      new SqliteParameter("@sid", sessionId));
  // HasUsage 参数改为：
  stats.AssistantReplies > 0 || resetAt > 0
  ```

  这一改**同时覆盖三条路径**（重置动作 / 切会话重载 / 重启后加载）。会话行不存在时 `QueryScalar` 给 `default(long) = 0`（`DbService.cs:106-114`），行为与改动前完全一致。

- **renderer 防御**（`session-slice.ts`）—— 新增模块级 `ZERO_USAGE_BASELINE`（全零 `TokenUsage`），`usageBaseline` 不再置 `undefined`。即使 `hasUsage` 语义将来再变，也不会重新掉进兜底分支。

---

## 三、⚠️ 项

- **⚠️-1（已修）重置失败静默** —— `if (!success) return` 既无 toast 也无日志；外层 `catch` 只抓异常，Worker 返回的 `success = false` 进不来。用户点了一个不可逆动作却毫无反馈。**已补 `console.warn`**（`session-slice.ts`）。toast 未加（store 层调 UI 不合分层，且仓库里 toast 都在组件层）—— 留裁定。
- **⚠️-2（留裁定）`EnsureColumn` 的 `catch {}` 静默吞异常**（`DbClient.cs:773-776`）。改动前聚合 SQL 不碰 `sessions`；改动后一旦 ALTER 静默失败，`db/messages-usage-stats` 会因 `no such column: usage_stats_reset_at` **整体抛错** ⇒ **全仓所有会话**的底部统计退化成「驻留窗口逐条相加」，且无日志无提示。**未改**：`EnsureColumn` 是所有表共用的迁移原语，加日志/重试属于通用改动，超出 S-193 范围 —— 等老大定是否单排一条。
- **⚠️-3（留裁定）无回归测试** —— 本改动引入了新的 SQL 过滤 + 新的 store action，`tests/**` 搜 `usage-stats|UsageStats|usage_stats|usageBaseline|sessionUsageTotals` **0 命中**。仓库有现成模式可照抄（C# `WishfulClaw.CompactionSnapshotRegressionTests` / TS `tests/*/program.ts`），一条「重置前 N / 重置后 0 / 再插一条只统计新的」即可同时兜住 ❌-1。**未加**：会改 `tests/` 与 `package.json` 的套件计数（69 → 70），属范围外的新增，等老大定。
- **（文档回填，已做）§5 落地清单**把端点写成 `db/sessions-reset-usage-stats`（复数），实际注册的是 **`db/session-reset-usage-stats`**（单数，与既有 `db/session-reset-conversation` / `db/session-status` 同风格）—— 已订正为实际值。
- **（附带观察，无需改）** `sessionCacheHit` / `sessionCacheMiss` 重置后不清。当前不可见（`runtime-status.tsx` / `composer-status-indicator.tsx` 只把它们塞进 selector，组件体内不读；底部「缓存」用的是已被正确归零的 `effectiveTotals.cacheReadTokens`）。若将来有 UI 直接展示这两个字段，重置后会露出旧值。
- **（附带观察，语义确认）** `plugin-command-stats.ts`（渠道 `/stats` 命令）与 `db-helpers.ts` 共用同一端点。修 ❌-1 后，被重置的会话 `hasUsage = true` ⇒ 渠道会报「0 tokens」而非「No token usage data available」—— 语义更准（统计被重置，值是 0）。渠道会话没有 UI 入口，实际永远不会被重置。

---

## 四、门禁证据（❌-1 修复后复跑）

- `npm run typecheck` → **0 错误**
- `npm test` → **69/69**（TS 52 + C# 17）
- `dotnet build src/runtime/WishfulClaw.sln` → **0 警告 0 错误**

---

## 五、提交范围

- `ad2ac62f`（已提交）= S-193 实施刀：12 文件，+131 / −36。
- ❌-1 与 ⚠️-1 的修复、以及本报告与文档回填，**一律攒进收尾刀** `fix(迭代39): 审查与验证修复调整`，不单独提交（依 `docs/dev-workflow.md`）。
- 修复涉及：`src/runtime/WishfulClaw.Infrastructure/Db/DbMessageCompactTools.cs`、`src/renderer/src/stores/chat-store/session-slice.ts`（均已在 `ad2ac62f` 中提交过，现为工作区增量改动）。
