# S-194 审查报告（阶段五）

> 审查人：**独立 subagent**（`code-reviewer`）。
> 审查对象：`f3eed21b`（分支 `dev/v2-iter-39`，base `ad2ac62f`），7 文件 +177 / −30。
> 规划依据：`requirements/S-194.md`（§四 定案方案）、`plan-s194/plan.md`。
> 审查方式（读码）：`git show f3eed21b` 全文；`src/renderer/src/lib/format-tokens.ts`（全文）；`components/chat/TokenCounter.tsx`（全文）；`components/settings/UsagePanel.tsx` / `UsagePanelParts.tsx` / `usage-detail-table.tsx` / `RuntimePanel.tsx`（相关行）；`tests/token-format/program.ts`（全文）；全仓 grep `function formatTokens` / `formatTokensDecimal` / `toFixed` + `[kK]`。
> 出报告：2026-10-13。
> **结论：⚠️ 有条件通过 —— S-194 自身的四条验收判据全部符合，「仓内只剩一份实现」的字面口径成立但**实质不成立**（仓内仍有 3 处同族 token 格式化器各吐一种串）。条件见 §三，不阻断进阶段六。**

---

## 一、改动核对

| 审查项 | 结论 | 证据 |
|---|---|---|
| 合并为一份实现 | ✅ | 仓内 `function formatTokens(` 只剩 `lib/format-tokens.ts:49`（`git grep` 实测 1 处，测试文件里的字符串匹配不算定义） |
| 删除 `formatTokensDecimal` | ✅ | 全仓 0 处调用；仅 `tests/token-format/program.ts:5/11/97` 以字符串形式提及（作负向断言） |
| `UsagePanelParts` 本地副本删除 | ✅ | `UsagePanelParts.tsx` 已无 `formatTokens` 导出（`git grep '^export '` 列出的 9 个导出里无它）；`formatTokens` 调用改由 `:4` 的 import 提供 |
| 四个调用方改 import | ✅ | `TokenCounter.tsx:9`、`UsagePanel.tsx:22`、`UsagePanelParts.tsx:4`、`usage-detail-table.tsx:13` 均 `from '@renderer/lib/format-tokens'`；`usage-detail-table.tsx:14` 仍从 `./UsagePanelParts` 取 `sourceLabel`（正确） |
| 单位阶梯 `k/M/G/T` | ✅ | `format-tokens.ts:17-22` `TOKEN_UNITS`；`1e12 → '1.00T'`（测试断言） |
| 进位升档 | ✅ | `format-tokens.ts:57` `if (Number(text) >= 1_000 && index < len-1) continue`；`999999 → 1.00M`、`999_999_999 → 1.00G`、`999_999_999_999 → 1.00T` |
| 精度分档按「已四舍五入值」判定 | ✅ | `format-tokens.ts:29-33` `formatScaledUnit` 用 `Math.round(scaled*100)/100` 与 `Math.round(scaled*10)/10` 判定桶位；`9_999 → '10.0k'`、`99_999 → '100k'` |
| 非整数先取整 | ✅ | `:51` `Math.round(n)`；`850.4 → '850'`、`999.6 → '1.00k'` |
| 防御 `!isFinite || <=0` | ✅ | `:50`；`0/-1/NaN/Infinity → '0'` |
| 后缀大小写 | ✅ | `k` 小写、`M/G/T` 大写（`:18-21`），测试 `testSuffixCase` 锁死 |
| 无 C# / DB / i18n 改动 | ✅ | `git show --stat f3eed21b` 7 文件全在 TS/JSON，无 C#、无 locale |
| 新增测试脚本进 `npm test` | ✅ | `package.json:75` `test:token-format`；`scripts/run-tests.mjs:29` 收集全部 `test:*`（除 `test:clean`） |

---

## 二、逐条验收判据核验

| # | 判据（S-194 §六） | 结论 | 证据 |
|---|---|---|---|
| 1 | §四 换算对照 **9 行逐字符吻合** | **符合** | `tests/token-format/program.ts:37-46` 逐行断言；逐值手算实测：`850/1000/1234/12500/123456/999999/1127850000/1e12` 全吻合 |
| 2 | 同一数值在**上下文环 / 输入框计数器 / 设置页概览 / 设置页明细**四处完全一致 | **符合** | 四处现均 import 同一 `formatTokens`（`context-ring.tsx:11`、`TokenCounter.tsx:9`、`UsagePanel.tsx:22`、`usage-detail-table.tsx:13`）；无残留本地副本 |
| 3 | `1127850000` 显示 `1.13G` | **符合** | 手算 `k` 段 `1127850`→`≥1000` continue，`M` 段 `1128`→continue，`G` 段 `1.12785.toFixed(2)='1.13'` ⇒ `'1.13G'`；测试同值断言 |
| 4 | 仓内 `formatTokens` 实现**只有一份** | **符合（字面）/ 实质见 ⚠️-1** | `git grep 'function formatTokens'` = 1（`format-tokens.ts:49`）；但**仅**按该函数名计数，未覆盖同族 `formatNum` / `formatTokenMetric` / `formatGoalTokens` |
| 5 | 门禁（typecheck / npm test / dotnet build） | **无法静态核验** | 由主会话跑；本报告只核静态代码，无 C# 改动故 dotnet 预期无影响 |

---

## 三、发现

### ⚠️-1 仓内仍有 3 处同族「token → 带单位串」实现未收敛 —— 「同一数值不同串」的问题只解决了四分之一

S-194 的目标（需求 §二-2、§四-1）是「同一数值不再在不同位置显示成不同串，合并成一份实现」。commit message 与 `format-tokens.ts:38` 的注释都写着 **「The only implementation in the repo」**。但实测仓内另有 3 处独立实现，且对同一数值给出**与统一实现不同**的串：

| 文件:行 | 函数 | 规则 | `1127850000` | `1234` | 调用点 |
|---|---|---|---|---|---|
| `src/main/channels/plugin-command-stats.ts:38-42` | `formatNum` | `k`：`.toFixed(1)`；`M`：`.toFixed(2)` | `1127.85M` | `1.2k` | 渠道 `/stats` 命令（`:52-54`）— **会话总量**，最易破 1e9 |
| `src/renderer/src/components/chat/AssistantMessage/utils.ts:334-339` | `formatTokenMetric` | 大写 `K`；`k`：`.toFixed(1)`；`M` 分档 | `1127.9M` | `1.2K` | 助手消息「完成摘要」`use-completion-summary.ts:50/110/125/140/155/170/190/224` |
| `src/renderer/src/lib/agent/goal-context.ts:49-54` | `formatGoalTokens` | 大写 `K`；分档 | `1127.9M` | `1.2K` | Goal 面板 `GoalHistoryPanel.tsx:358`、`GoalSessionControls.tsx:82/91`、`goal-session-utils.tsx:141/142/144`、`goal-session-views.tsx:56` |

**为什么算同族**：三者都是「整数 token → 带 `k/K/M` 单位串」，与 `formatTokens` 同职同域；且**用户可见**（`/stats` 渠道回执、助手消息完成摘要、Goal 面板）。落在同一会话里的例子：完成摘要（`formatTokenMetric`）与上下文环（`formatTokens`）对同一批 token 一个显示 `1.2K`、一个显示 `1.23k` ⇒ 正是 S-194 要消掉的病征。

**性质**：`requirements/S-194.md` §三静态定位只列了 3 处实现（漏了这 3 处），§五落地清单也据此只列 5 个源文件；因此**实施忠于计划**，属计划/需求**漏点**而非实现缺陷。但 `tests/token-format/program.ts` 的 `testSingleImplementation` 只扫 `function formatTokens(`，把「只剩一份」证成了一个**比实际范围窄**的命题 —— 这条断言会给人「已完成收敛」的错觉。

**建议（择一）**：
- 若认可这 3 处属本轮范围：让它们改走 `@renderer/lib/format-tokens` 的 `formatTokens`（字段是 token，语义完全一致；`goal-context.ts` 需保留其 `Math.floor` 语义或改为直接传原值）。
- 若判定超范围：在 `requirements/S-194.md` §七「刻意不做」补一句「`formatNum` / `formatTokenMetric` / `formatGoalTokens` 本轮不收敛」，并修正 `format-tokens.ts:38` 注释与 `testSingleImplementation` 的措辞（当前「only implementation in the repo」会误导后来者）。

### 💡-1 `formatTokens` 末尾 `return String(value)` 为**不可达代码**（`format-tokens.ts:60`）

循环 `for index 0..3`，在 `index === TOKEN_UNITS.length - 1`（即 3）时 `:57` 的 `index < TOKEN_UNITS.length - 1` 恒为 false，故该轮必走 `:58` 的 `return`。因此 `:60` 永不执行。无功能危害（纯防御），但既然 §五判据 6 关心「T 以上」，可顺手删掉或加注释说明「阶梯到 T 封顶，超出走 `1000T`」。实测 `1e15 → '1000T'`（可接受）。

### 💡-2 上下文环「刻度」用的是另一套单位换算（非 `formatTokens` 的错，但同屏两种口径）

`context-ring.tsx:411-412` 的刻度 `formatTokens(capRange.min/max)` 已统一；但环体百分比/刻度分档另有逻辑，不在本改动面。仅提示：`formatTokens` 现在对 `1000` 会输出 `1.00k`（旧实现输出 `1.0k`），凡把输出串再喂给宽度/对齐计算处需确认不依赖旧串长（本仓未见此类反向解析，故仅 💡）。

---

## 四、建议

1. **先裁决 ⚠️-1**：这 3 处同族格式化器是本需求「统一显示」目标的实际缺口，且渠道 `/stats` 与会话总量统计直接暴露 `1127.85M`。建议至少纳入本轮，或明确登记为后续。
2. `testSingleImplementation` 的扫描条件从 `function formatTokens(` 收紧为「`formatTokens` / 任何 `*Tokens*` 且含 `toFixed(/ 1_000` 的实现」，或直接改为白名单式断言，避免「只扫函数名」的假阴性。
3. 删除或注释 `:60` 死代码。

---

## 五、门禁证据 / 提交范围

- 门禁（主会话）：`npm run typecheck` 0 错误；`npm test` 70/70（含新增 `test:token-format` 27 断言）；无 C# 改动。
- 提交范围：`f3eed21b` = 7 文件（6 源 + 1 测试 + `package.json` 脚本），+177 / −30，与需求 §五「5 源 + 1 测试 + 脚本」一致。
- 本报告仅新增 `docs/plans/iter-v2-39/plan-s194/review_report.md`，未改任何源码。

---

## 六、遗留项

- ⚠️-1（同族未收敛）—— 待老大裁决是否纳入本轮；纳入则需回归四处以外的新调用点。
- 阶段六实机核验项（非静态可验）：上下文环 / 输入框计数器 / 设置页概览 / 设置页明细四处对同一数值显示同一串；`1127.85M` 不再出现，改为 `1.13G`。
