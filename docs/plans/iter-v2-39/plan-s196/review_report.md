# S-196 审查报告（阶段五）

> 审查人：**独立 subagent**（`code-reviewer`）。
> 审查对象：`11699421`（分支 `dev/v2-iter-39`，base `5b65a231`），4 文件 +126 / −8。
> 规划依据：`requirements/S-196.md`（方案 B + A 兜底 + 段数补丁）、`plan-s196/plan.md`。
> 审查方式（读码）：`git show 11699421` 全文；`components/chat/renderable-chat-items.ts:118-260 / :360-490`；`stores/chat-store/index.ts:1997-2231`；`lib/api/types.ts:255-290`；`stores/chat-store/db-helpers.ts:114-143 / :437-463`；`components/chat/AssistantMessage/action-bar.tsx:55-70`；`tests/renderable-chat-items/program.ts`（新用例段）；全仓 grep `compactBoundary` / `compactSummary`（消费点）与 `resolveCutTime`。
> 出报告：2026-10-13。
> **结论：✅ 通过（无阻断）—— 根因命中、B（`cutAt`）+ A（`clampCutTime`）+ 段数门三件套落地正确，`cutAt` 经 `dbUpsertMessage → serializeMessage:131` 落库（判据 5 静态成立）；遗留 3 条非阻断观察（`updatedAt` 缺失时上界不夹、live 分支被夹的行为微变、排序仍用被污染的 `createdAt`）。**

---

## 一、改动核对

| 审查项 | 结论 | 证据 |
|---|---|---|
| 方案 B：改写前另存 `cutAt` | ✅ | `chat-store/index.ts:2104-2108` 先取 `const cutAt = Math.max(boundary.createdAt, summary.createdAt)`**再**在 `:2111-2119` 改写 `createdAt`；`:2121-2130` 写回两个 `meta`（展开原对象，不新增字段名以外的形态） |
| `cutAt` 写入 `meta` 用不可变展开 | ✅ | `:2124` `boundary.meta = { ...boundary.meta, compactBoundary: { ...boundaryMeta, cutAt } }`；`:2128` summary 同理 —— 不破坏 `displayAnchor` 等既有键 |
| 类型加 `cutAt?`（两处） | ✅ | `lib/api/types.ts:263-269`（`CompactBoundaryMeta`）、`:284-285`（`CompactSummaryMeta`），均 `cutAt?: number` 可选 ⇒ 老数据无字段不报错 |
| 方案 A：`clampCutTime` 兜底 | ✅ | `renderable-chat-items.ts:202-209`；循环内**两个**分支统一经它取值（`:415` 一处调用覆盖 completed pair 与 live anchor，因 `resolveCutTime` 已对 `pair=null` 内部分支） |
| `resolveCutTime` 优先 `cutAt` | ✅ | `:190-192` `pair.summary.meta?.compactSummary?.cutAt ?? pair.boundary.meta?.compactBoundary?.cutAt`，`typeof === 'number' && > 0` 才采信，否则回落 `:193` `Math.max(boundary.createdAt, summary.createdAt)` |
| 段数补丁 | ✅ | `:464` `const wasSplit = assistantItemIndexes.length > 0`（在推末段**之前**求值）→ `:478` `totalElapsedMs` 增加 `wasSplit &&` 门 |
| `cutAt` 随工件落库（判据 5） | ✅ | `applyCompactArtifactsToSession`（`chat-store/index.ts:2139-2197`）把 `mergedMessages`（含被 `adjust` 改写的对象）赋给 `target.messages`，再对每个工件 `void dbUpsertMessage(sessionId, updated.messages[index], index)`（`:2191-2196`）；`serializeMessage`（`db-helpers.ts:124-138`）`if (msg.meta) Object.assign(meta, msg.meta)` 后 `JSON.stringify` ⇒ `compactBoundary.cutAt` / `compactSummary.cutAt` 落进 `meta` 列 |
| 不动 DDL / 排序语义 / `totalElapsedMs` 算法 | ✅ | diff 内无 C#/SQL；`adjustCompactArtifactTimestamps` 的 `createdAt` 改写分支（`:2111-2119`）保持原逻辑 |
| 无 C# / i18n 改动 | ✅ | `git show --stat 11699421` 4 文件全为 TS（含 1 测试） |

---

## 二、逐条验收判据核验

| # | 判据（S-196 §五） | 结论 | 证据 |
|---|---|---|---|
| 1 | 主判据：被压缩切过的 assistant 消息显示 `15:58 · 7m40s`，不再 `481h56m` | **符合（静态）** | 新数据走 `cutAt`（`:190-192`）；`clampCutTime`（`:202-209`）保证切点落在 `[createdAt, updatedAt]`，末段 `elapsedMs`（`action-bar.tsx:64-65`）≤ 本轮跨度。实机由阶段六 |
| 2 | 实测反例 `5zAy…`：末段区间 `07:50:43 → 07:58:23` = 7m40s | **符合（静态）** | 该对工件带 `cutAt`（改写前 = 真实落刀时刻 ≈ 07:50 前后）⇒ 末段 `createdAt = cutAt`、`updatedAt = message.updatedAt(=07:58:23)`；若 `cutAt < message.createdAt` 则被夹到 `07:50:43` ⇒ 结果同为约 7m40s |
| 3 | 切点落在消息开头时**不出现** `07:30 · 共 07:30` 重复 | **符合** | `:464` `wasSplit` 门；测试 `testRelocatedArtifactCutTime` 第三组断言 `onlySegment.fragment?.totalElapsedMs === undefined`。注意该门依据「是否真的产出过 `before` 片段」，而 `before` 片段在 `splitAt=0` 时被 `:221 end <= start` 丢弃 ⇒ 只剩末段时不挂总量 |
| 4 | 压缩真发生在流式中途时，分段仍在、首尾相接、`共 X` 照常 | **符合（静态）** | `cutAt ∈ (createdAt, updatedAt)` 时 `clampCutTime` 不改值 ⇒ `before.updatedAt = after.createdAt = cutAt`；`wasSplit=true` ⇒ 挂 `totalElapsedMs`。测试第一组断言覆盖 |
| 5 | 重启 / 切会话后数字不变（`cutAt` 已落库） | **符合（静态，已核序列化路径）** | 见 §一「`cutAt` 随工件落库」；`deserializeMessage` 从 `meta` JSON 还原，故重载后 `resolveCutTime` 仍读到 `cutAt` |
| 6 | 历史老数据（无 `cutAt`）数字不超本轮跨度，最多分段塌成一段 | **基本符合（`updatedAt` 缺失时为部分覆盖，见 💡-1）** | `updatedAt` 存在时 `clampCutTime` 上下界都夹（`:207-208`）；测试第二组断言 `legacyBefore.updatedAt === messageStart`。`updatedAt == null` 时只夹下界（`:206`），本仓该批老消息 `elapsedMs` 要求 `updatedAt != null`（`action-bar.tsx:65`）故不显示 —— 影响面见 💡-1 |

---

## 三、发现

### 💡-1 `clampCutTime` 在 `message.updatedAt` 缺失时只夹下界（`:206`）

```ts
if (upper == null || upper <= lower) return cutTime < lower ? lower : cutTime
```

当 `updatedAt` 为 `null`（需求 §5.1⑤ 记录：09-23 之前的 assistant 消息 `updated_at` 全为 null），若被污染的切点 `cutTime > lower`，函数原样返回、**不夹上界**。理论后果：该消息的 `before` 片段拿到 `createdAt=msgStart`、`updatedAt=cutTime`，若 `cutTime` 远大于 `msgStart`，会显示一个超出真实跨度的耗时。

**可达性低**：`before`/`after` 片段都渲染自己的操作栏，但本仓 `elapsedMs` 要求两端非 null；`after` 段 `updatedAt = message.updatedAt = null` ⇒ 不显示。`before` 段 `updatedAt = cutTime`（非 null）⇒ **可能显示**。不过「工件锚定的那条消息本身 `updatedAt` 为 null」需 `displayAnchor` 指向一条从未收尾的老消息，实践中压缩锚点通常落在「当前已收尾的 assistant 消息」（有 `updatedAt`），故多半不可达。

**建议**：`updatedAt == null` 时改为「保守塌成消息起点」（即 `return lower`），与方案 A「宁可想不起分段，也不能报出荒谬数字」的既定取舍一致；并在测试里补一条 `updatedAt` 缺失用例。非阻断。

### 💡-2 live 分支也被 `clampCutTime` 夹（`:189` + `:415`）—— 行为微变

`resolveCutTime(pair=null, liveState)` 返回 `liveState.startedAt`（「现在」）；改动前不经夹取，改动后会夹进 `[message.createdAt, message.updatedAt]`。流式压缩时 `startedAt` 常晚于 `message.updatedAt`（消息尚在流式），故 live `before` 片段的 `updatedAt` 由 `startedAt` 变为 `message.updatedAt`（略早），`cursorTime` 随之。可见读数由「运行中」状态掩盖，影响可忽略，但**属未在计划中点名的行为变化**。建议：若有意为之，在 `clampCutTime` 注释注明「live 切点同样夹取」；若无意，可对 `pair === null` 跳过夹取。

### 💡-3 同消息多刀时，排序仍用被重定位的 `createdAt`（`:154-155`），未改用 `cutAt`

```ts
const aScore = Math.max(a.boundary.createdAt, a.summary.createdAt)
```

`buildRenderableChatItems` 内 `pairs.sort` 用工件 `createdAt`（= 归属位置）排序多刀。S-196 引入了语义更准的 `cutAt`，但**未**同步此处；当同一条消息挂了两刀、且两刀的 `cutAt` 顺序与归属位置顺序不一致时，切分顺序可能不反映真实先后。属**既有逻辑**、非本次引入，且「同消息多刀且顺序反转」概率极低。仅记为观察，建议后续把该处也切到 `cutAt`（并保留对无 `cutAt` 老数据的回落）以保持口径统一。

### （附带观察，无需改）`cutAt` 只在 `isNewBoundary` 分支生成

`:2173-2178` 仅在工件**本次新建**时调 `adjustCompactArtifactTimestamps` ⇒ 已存在于会话里的旧工件永远不补 `cutAt`，恒走 clamp 兜底。与需求「历史数据走兜底」一致，符合预期。

### （全仓排查）无别处把 `compactBoundary` / `compactSummary` 键当**封闭集合**用

grep 全部消费点（`CompactBoundaryMessage.tsx:18`、`ContextCompressionMessage.tsx:80-81`、`locator-utils.ts:75-76/93/153-154`、`useMessageListData.ts:357`、`context-compression.ts:47/51/192/243/335`、`SessionSummaryPanel.tsx:270/399`、`sidecar-mapping.ts:82-87`、`chat-store/index.ts:2010-2128`）均为**逐字段可选读**。`sidecar-mapping.ts:82-87` 的 `const { displayAnchor, ...compactSummary } = meta.compactSummary` 是 rest 展开、保留 `cutAt`。⇒ 加 `cutAt` 无兼容风险，与需求 §六结论一致。

---

## 四、建议

1. `clampCutTime` 的 `updatedAt == null` 分支改为保守夹到 `lower`（💡-1），并补测试用例。
2. 明确 live 分支是否应夹取，并落注释或改为跳过（💡-2）。
3. 后续把 `renderable-chat-items.ts:154-155` 的排序口径切到 `cutAt`（💡-3，非本轮阻塞）。
4. 测试补一条 `cutAt` 被污染为**大于** `updatedAt` 的用例（当前 `testRelocatedArtifactCutTime` 只覆盖 `cutAt < lower`），以锁死上界夹取。

---

## 五、门禁证据 / 提交范围

- 门禁（主会话）：`npm run typecheck` 0 错误；`npm test` 70/70（TS 53 + C# 17）；`tests/renderable-chat-items` 18 项全过（原 17 + 新 `testRelocatedArtifactCutTime`）。本条无 C# 改动。
- 提交范围：`11699421` = 4 文件（`renderable-chat-items.ts`、`lib/api/types.ts`、`chat-store/index.ts`、`tests/renderable-chat-items/program.ts`），+126 / −8。
- 本报告仅新增 `docs/plans/iter-v2-39/plan-s196/review_report.md`，未改任何源码。

---

## 六、遗留项

- 💡-1 `updatedAt` 缺失时上界不夹（建议修，非阻断）。
- 💡-2 live 分支被夹的行为变化（建议注释或跳过）。
- 💡-3 多刀排序未切到 `cutAt`（观察）。
- 阶段六实机核验项：跨天会话那条消息操作栏显示 `15:58 · 7m40s`；重启/切会话数字不变；切点在消息开头时不出现重复「共 X」。
