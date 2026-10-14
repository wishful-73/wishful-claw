# S-196 计划（消息耗时 481h56m）

> 状态：**已实施**（`11699421`，2026-10-13）；阶段五审查已出（`review_report.md`）；阶段六验证已出（迭代级 [`../verification_report.md`](../verification_report.md) §8.4：**PARTIAL**，实机项见 §8.5 第 16 项）。
> 需求：`requirements/S-196.md`。
> 老大口径：2026-10-13 16:34 报问题 → 16:48 补时序（压缩发生在干活之前）→ 16:58「根据你的建议去登记」⇒ 按 §五 定案**方案 B + A 兜底**实施。
> 归属：**iter-v2-39**（bug 修复）。

---

## 一、目标

操作栏的「本轮耗时」不再把压缩工件的**历史归属时刻**当成段起点：真实耗时 7m40s 的消息显示 7m40s，不再显示 481h56m；且只剩一段时不再重复报「共 X」。

## 二、落点

| 文件 | 改什么 |
|---|---|
| `lib/api/types.ts` | `CompactBoundaryMeta` / `CompactSummaryMeta` 各加 `cutAt?: number`（真实落刀时刻，epoch ms） |
| `stores/chat-store/index.ts` | `adjustCompactArtifactTimestamps`：改写 `createdAt` **之前**取 `cutAt = max(boundary.createdAt, summary.createdAt)`，改写后写进两个工件的 `meta` |
| `components/chat/renderable-chat-items.ts` | ① `resolveCutTime` 优先读 `meta.cutAt`；② 新增 `clampCutTime` 兜底，切点夹进 `[message.createdAt, message.updatedAt]`，循环里两个分支统一用它；③ `totalElapsedMs` 加 `wasSplit = assistantItemIndexes.length > 0` 门 |
| `tests/renderable-chat-items/program.ts` | 夹具透传 `cutAt`；新增 `testRelocatedArtifactCutTime`（3 组断言） |

**不动 DDL**：`meta` 是 JSON 列，加键无需迁移。**无 C# / 无 i18n 键**（沿用 `messageActions.elapsedTotal`）。

## 三、步骤（终止检查）

- [✓] 1. `meta` 类型加 `cutAt`（两处）
- [✓] 2. `adjustCompactArtifactTimestamps` 改写前另存 `cutAt`
- [✓] 3. `resolveCutTime` 优先 `cutAt` + `clampCutTime` 兜底
- [✓] 4. `totalElapsedMs` 段数门
- [✓] 5. 回归断言：`cutAt` 优先 / clamp 兜底 / 段数门 —— 套件 18 项全过
- [✓] 6. 门禁：`npm run typecheck` 0 错误；`npm test` **70/70**（TS 53 + C# 17）
- [✓] 7. 提交 `11699421`（4 文件，+126 / −8）
- [ ] 8. 阶段五：独立 subagent 审查
- [ ] 9. 阶段六：验证（实机确认操作栏数字 + `共 X` 是否还在不该出现时出现）

**0 个 [ ] 残留（除审查 / 验证）⇒ 已进阶段五。**

## 四、门禁

| 门禁 | 结果 |
|---|---|
| `npm run typecheck` | 0 错误 |
| `npm test` | 70/70（TS 53 + C# 17） |
| `tests/renderable-chat-items` | 18 项全过（原 17 + 新 1） |
| `dotnet build src/runtime/WishfulClaw.sln` | 本条无 C# 改动，收尾统一跑 |

## 五、验收判据

1. **主判据**：跨天会话里那条被压缩切过的 assistant 消息，操作栏显示 `15:58 · 7m40s`，不再是 `481h56m`。
2. 实测反例（线上库会话 `5zAy138pPr_rZQLMT8Hej`）：末段区间 = `07:50:43 → 07:58:23` = 7m40s。
3. 切点落在消息开头（压缩发生在消息之前）时，**不出现** `07:30 · 共 07:30` 这种重复。
4. 压缩真发生在流式中途时，分段仍在、各段耗时仍首尾相接（`共 X` 照常出现）。
5. 重启应用 / 切走会话再回来，数字不变（`cutAt` 已随工件落库）。
6. 历史老数据（无 `cutAt`，全库 3 条）：数字不超出本轮跨度，最多表现为分段塌成一段。

## 六、非目标（刻意不做）

1. **不动 `adjustCompactArtifactTimestamps` 的排序语义** —— 它解决的是「重载后工件被推到末尾」这个真实问题，改它会把 DB 排序搞坏。
2. **不改 `totalElapsedMs` 的算法** —— 它是对的，且是这个 bug 的「参照物」（正是它让矛盾暴露出来）。
3. **不给操作栏加「异常值」静默屏蔽**（如「超过 24h 就不显示」）—— 那是掩盖，不是修复。
4. **不用方案 C（读锚点消息时间）** —— 实测证伪：`displayAnchor.assistantMessageId` 恒等于被切那条消息自己，取它的时间等于把切点拽回消息开头，会吃掉真分段（需求 §5.1 ②）。
5. **不顺手修 §5.1 ⑤ 的两条待查**（上一条消息时间区间重叠、09-23 前 assistant 消息 `updated_at` 全 null ⇒ 不显示耗时）—— 与本条无关，另行裁定。
