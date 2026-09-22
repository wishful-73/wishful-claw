# 规划验证报告 — iter-v2-34 第二批（plan-b2.md）

结论：PASS（复验后；首轮 ❌1/⚠️3 已闭环）

| # | 检查项 | 结论 | 证据 |
|---|--------|:--:|------|
| 1 | 步骤完整覆盖任务目标 | ✅ | S-115/S-109/S-107/S-108 各成一部分 + 附步骤16 只读清单（plan-b2.md:137-194） |
| 2 | 每步有验证检查点 | ✅ | 步骤 1-16 每步均带 `**验证**`：build/typecheck/grep/先跑确认 FAIL（:142、:145、:167、:145） |
| 3 | 文件路径符合项目结构 | ✅ | 涉及 src/runtime/WishfulClaw.Agent、src/renderer/src、tests、docs；实测目标均存在 |
| 4 | 分层依赖合理（Core 不依赖上层） | ✅ | 仅改 Agent 层手写 SQL + renderer 层；基础设施 DbClient.cs 明确不动（:59、:127） |
| 5 | 参考源码存在 | ✅ | settings-store.ts:150/462、context-compression-config.ts:105、DbSessionTools.cs:98、OpenCowork TitleBar.tsx 均存在 |
| 6 | 「涉及文件」表覆盖全部步骤文件 | ⚠️ | 步骤14 备选 use-chat-actions.ts、步骤16 写 raw-requirements.md 未入表（:209-210、:194） |
| 7 | 单文件 500 行红线 | ⚠️ | settings-store.ts=555、chat-store/index.ts=2306 已超线仍改；context-ring.tsx=476 逼近，计划未提红线 |
| 8 | 提交节奏一需求一刀 | ✅ | commit1 S-115 / commit2 S-109 / commit3 S-107 / commit4 S-108 + 收尾（:235-239） |
| 9 | 计划内部自相矛盾 | ❌ | 依赖声明「S-107 落地前必须先有 S-108 结论」（:23、:229）与步骤/提交顺序 S-107 先于 S-108 冲突 |

## 独立复核 A

全仓 `INSERT INTO sessions` 共 4 条（大小写不敏感 grep 同结果）。其中 DbSessionTools.cs:98、DbPluginSessionTools.cs:159、DbPluginSessionRouting.cs:78 三条列清单均含 `model_selection_mode`；唯 AgentRuntimeProjectExecutor.cs:227-229 那条 10 列止于 `pinned`，确漏该列。与计划表（plan-b2.md:41-46）逐条一致，**A 结论成立**。

## 独立复核 B

新库建表 DbClient.cs:110 为 `model_selection_mode TEXT NOT NULL DEFAULT 'inherit'`；存量迁移 DbClient.cs:530 调 `EnsureColumn("sessions","model_selection_mode","TEXT")`，实现（DbClient.cs:754-773）为「列不存在才 ALTER TABLE ADD COLUMN <原样类型>，已存在即跳过」，不回填 DEFAULT。两处类型/默认值确实不一致，**B 结论成立**，计划（:52-55）取证准确。

## 独立复核 C

分叉方向对，但机制描述有误。use-chat-actions.ts:345-349 兜底确置 `resolvedModelId = null`，但紧接 :351-355 用 `activeModelId || provider.defaultModel || 首个 enabled` 回填，**不会**返回 `modelId: null`（仅整条无 provider 时 :350 返回 null）；UI 侧 use-active-model-config.ts:32-35 在 `!providerId||!modelId` 时直接 null。二者在「selection 有 modelId 但其 provider 不在 store」等场景确会分歧，但计划（:74）所述 `find(m=>m.id===null) ⇒ undefined` 因果链与代码不符。

## 独立复核 D

死条件成立。UpdateDialog.tsx:212 的 `isDownloading ?` 分支先于 :231 的 `hasAvailableUpdate ?` 匹配，故 `isDownloading=true` 时永不渲染到 :232，其 `disabled={isDownloading}` 恒为 false。**D 结论成立**，计划（:107）判断正确。

## 阻断项

- ❌ 步骤与提交顺序和「S-107 须待 S-108 结论」依赖冲突（plan-b2.md:23 对 :176-189、:235-238）：按现序执行，S-107 步骤 10 盖章改动将在 S-108 结论之前落地，正是计划自身（:229）要规避的风险。执行前须重排（S-108 取证先行）或显式降级 S-107 的步骤 10。

## 复验（2026-09-22，修正后）

F1 ✅ —— 三处已一致把 S-108 排在 S-107 之前：「目标」节（plan-b2.md:13-14）S-108 列为第 3 项、S-107 第 4 项并注明「盖章链须待 S-108 结案」；「范围与顺序」表（:22-23）序 3=S-108、序 4=S-107；「提交节奏」节（:254-255）commit 3=S-108（步骤 15）、commit 4=S-107（步骤 12），并注「其步骤 10 须在 S-108 结案后落地，故排在后」。退化路径已补（:25 注 + :248 风险表）：拿不到 DIAG 日志时 S-108 退化为「只做步骤 14（静默失败变可见）」结案，结案后 S-107 即可照常实施，次序约束至此解除，不再无限阻塞。

F2 ✅ —— 「涉及文件」表（:213-226）已补入 `src/renderer/src/hooks/use-chat-actions.ts`（:225，步骤 14 备选落点，与 provider-payload.ts 二选一）与 `docs/plans/iter-v2-34/raw-requirements.md`（:226，步骤 16 只读清单落点，注明按提交纪律不单独成刀）。步骤 14 / 步骤 16 的文件面均已入表。

F3 ✅ —— 新增「单文件 500 行红线核查」节（:137-148），四行文件均有豁免/行内判定：`settings-store.ts`=524 已超线 ⇒ 高内聚 store 豁免（仅加 1 字段）；`chat-store/index.ts`=1473 已超线 ⇒ 高内聚 store 豁免（仅换 1 处解析）；`use-chat-actions.ts`=889 已超线 ⇒ 高内聚 hook 集合豁免（最多 1 处告警）；`context-ring.tsx`=447 未超线 ⇒ 加「跟随全局」约 +10 行后约 457 仍在线内。实测行数 524/1473/889/447 与计划逐一吻合。

F4 ✅ —— 「探索结论 → S-108」表「可疑分叉」行（:76）已按真实代码改正：兜底分支（use-chat-actions.ts:345-349）置 `resolvedModelId = null` 后**并不就此返回 null**，而由 :351-355 `providerStore.activeModelId || provider.defaultModel || 首个 enabled` 回填（仅整条 provider 都没有时才在 :350 返回 null）。风险落在回填的**全局** `activeModelId` 未必属于兜底后的该 provider ⇒ provider-payload.ts:51 `find(m => m.id === modelId)` 落空 ⇒ :75 `contextLength` 丢字段 ⇒ 后端吃 200K。与实读 use-chat-actions.ts:345-356 一致，首轮「find(m=>m.id===null) ⇒ undefined」的错误因果链已消除。

复验结论：PASS（首轮 ❌1/⚠️3 已闭环）
