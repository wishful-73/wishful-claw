# S-193 计划（会话底部用量统计可重置）

> 状态：**已实施**（`ad2ac62f`，2026-10-13）+ 阶段五审查已出（`review_report.md`：❌ 1 已修（工作区，攒收尾刀）/ ⚠️ 3，其中 2 条留裁定）+ 阶段六验证已出（`verification_report.md`：**PARTIAL**，E-1 ~ E-6 待实机；另见迭代级 [`../verification_report.md`](../verification_report.md) §七）。
> 需求：`requirements/S-193.md`。
> 老大口径：2026-10-13 10:25 提出 → 10:28 澄清边界（「不清理数据库内的，只是单纯清理底部统计」）→ 10:51 拍板**方案 B**（「可以 按照B来改动，确实应该是重置用量统计」）。
> 归属：**iter-v2-39**（bug 修复 + 体验优化）。

---

## 一、目标

给会话底部那排 token 指标一个**只清统计、不动消息**的出口：点击后底部归零，消息与逐条 token 摘要原样保留，且**重启后不复活**。同时把浮窗「更多」里代价过大的「删除会话」替换掉。

## 二、落点

| 侧 | 文件 | 改什么 |
|---|---|---|
| C# | `Infrastructure/Db/DbClient.cs` | `EnsureColumn("sessions", "usage_stats_reset_at", "INTEGER NOT NULL DEFAULT 0")`（落在既有增量列块，照 `context_revision` 模式） |
| C# | `Infrastructure/Db/DbMessageCompactTools.cs` | `UsageStats` 聚合加 `AND created_at > COALESCE((SELECT usage_stats_reset_at FROM sessions WHERE id = @sid), 0)`；`hasUsage` 改为 `AssistantReplies > 0 \|\| resetAt > 0` |
| C# | `Infrastructure/Db/DbSessionTools.cs` | 新增 `ResetUsageStats`：只写起点时间戳，不碰 messages |
| C# | `Infrastructure/Db/DbModule.cs` | 注册 `db/session-reset-usage-stats` |
| C# | `Entities/SessionEntity.cs` + 两个 JsonContext | 新增 `SessionUsageResetResult` 并双处 AOT 注册 |
| TS | `stores/chat-store/db-helpers.ts` | 新增 `dbResetSessionUsageStats` |
| TS | `stores/chat-store/session-slice.ts` | 抽模块级 `baselineFromUsageRollup()` 共用于「首次加载 / 重置」；新增 `resetSessionUsageStats` action；`ZERO_USAGE_BASELINE` |
| UI | `components/layout/SessionConversationPane.tsx` | 浮窗「更多」第二项整体替换为「重置用量统计」 |
| UI | `locales/{zh,en}/layout.json` | 三条文案 |

**不走跨端四处登记** —— 那是给 agent 用的工具才要；`db/*` 走 WorkerRequest 通道，`DbModule` 注册一行即可。

## 三、步骤（终止检查）

- [✓] 1. C# 加列迁移 + 聚合过滤 + 新 record/注册 + `ResetUsageStats` + 通道注册
- [✓] 2. TS wrapper + store action + 口径抽公共函数
- [✓] 3. UI 菜单项替换 + 双语文案
- [✓] 4. 门禁三连（typecheck / npm test / dotnet build）
- [✓] 5. 提交 `ad2ac62f`（12 文件，+131 / −36）
- [✓] 6. 阶段五：派独立 subagent 审查 → `plan-s193/review_report.md`
- [✓] 7. 审查 ❌1 修复 + 文档回填（工作区，攒收尾刀）

**0 个 [ ] 残留 ⇒ 已进阶段五。**

## 四、门禁（审查修复后复跑）

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npm test` | 69/69（TS 52 + C# 17） |
| `dotnet build src/runtime/WishfulClaw.sln` | 0 警告 0 错误 |

## 五、验收判据

1. **主判据**：点「重置用量统计」并确认 ⇒ 输入框下方 token 数字**归零**；切走会话再回来仍为 0；**重启应用后仍为 0**。
2. 消息未受影响：会话内消息条数不变，AI 消息下方的逐条 token 摘要仍在。
3. 重置后继续对话 ⇒ 底部只累计**重置之后**新产生的量。
4. 浮窗「更多」里不再有「删除会话」，只有「重命名」+「重置用量统计」；侧边栏右键的「删除会话」仍在。
5. 设置页 · 用量统计（全局）**不受影响**。

## 六、非目标（刻意不做）

1. 不删消息、不清 `messages.usage`、不动 DB 体积 —— 老大 10:28 明确。
2. 不动设置页全局用量（独立走 `request_usage_logs`，另一条线）。
3. 不动「上下文用量」环（瞬时值，非累计）。
4. 不删侧边栏右键的「删除会话」。
5. 不加 G 单位、不合并三套 token 格式化实现 —— 老大未拍板，另议。
