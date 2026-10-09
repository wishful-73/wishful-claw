# Plan-S179 独立规划验证 · 合规报告

> 验证人：独立规划验证员（只读）
> 时间：2026-10-09 12:04 (+08:00)
> 计划：`docs/plans/iter-v2-38/plan-s179/plan.md`
> 需求正文：`docs/plans/iter-v2-38/requirements/S-179.md`
> 核实范围：白名单 5 个文件（只读，未做任何 git / 构建 / 测试操作）

**一句话结论**：计划与代码事实**逐条吻合**，唯一的缓解项是 §二②「全仓唯一卡片内自带滚动条」这句表述过宽（本文件 `:189` 就有第二处 `overflow-y-auto`），但不影响修法；`❌ 0 / ⚠️ 1 / ℹ️ 3` ⇒ **可以进入用户确认与实施**。

---

## 一、逐条核实表

| # | 断言 | 结论 | 证据（文件:行） |
|---|---|---|---|
| 1 | `SubAgentStepList` 函数体 `:72-139`，函数内零 `ref`/`useEffect`/`scrollTop`，只有 `:79` 的 `useReducer` | ✅ 成立 | `SubAgentCard.tsx:72`（`function SubAgentStepList({`）、`:79`（`const [, forceUpdate] = React.useReducer(...)`）、`:139`（函数收尾 `}`）。通读 72–139 行，确无 `useRef`/`useEffect`/`scrollTop` |
| 2 | 滚动容器 = `:90` 的 `max-h-[240px] overflow-y-auto`；「全仓唯一卡片内自带滚动条」 | 容器 ✅；「全仓唯一」⚠️ | 容器：`SubAgentCard.tsx:90` `className="max-h-[240px] overflow-y-auto px-3 py-1"`。**反例**：同一文件 `:189` 也有 `overflow-y-auto`（`SubAgentHoverContent` 的 Prompt 区，`max-h-[60vh]`）。若限定为「`SubAgentCard` 卡片主体内唯一」则成立，字面「全仓唯一」过宽 |
| 3 | `:81-87` 有 `toolCalls.length === 0` early return，且位于 `:79` 的 `useReducer` 之后；新 hooks 必须插在 `:79` 与 `:81` 之间 | ✅ 成立且必要 | `SubAgentCard.tsx:79`（useReducer）→ `:81` `if (toolCalls.length === 0) {` → `:82-86` return JSX → `:87` `}`。位置合规：`useReducer` 无条件执行，early return 在 hooks 之后；若把新 hooks 放到 `:81` 之后，则「有步骤/无步骤」两条渲染路径 hooks 数量不同，违反 hooks 规则（React 报错）。计划要求的位置**合法且必要** |
| 4 | 挂载点 `:464-479`：`AnimatePresence` + `isExpanded && hasSteps`，外层 `motion.div` 0.15s 高度动画 + `overflow-hidden`；数据源 `effectiveToolCalls` 在 `:474` | ✅ 成立 | `SubAgentCard.tsx:464`（`<AnimatePresence initial={false}>`）、`:465`（`{isExpanded && hasSteps && (`）、`:466-470`（`motion.div` initial/animate/exit + `transition={{ duration: 0.15 }}`）、`:471`（`className="overflow-hidden ..."`）、`:473`（`<SubAgentStepList`）、`:474`（`toolCalls={effectiveToolCalls}`）、`:479`（`</AnimatePresence>`）。`hasSteps` 定义在 `:363` |
| 5 | 候选 B：`SubAgentExecutionDetail.tsx:379` 的 `autoScrollToBottom` 绑 `isRunning`；`TranscriptMessageList.tsx:108-117` 在该 flag 为假时直接 return 不贴底 | ✅ 成立 | `SubAgentExecutionDetail.tsx:379` `autoScrollToBottom={Boolean(effectiveAgent?.isRunning)}`；`TranscriptMessageList.tsx:108` effect 开始、`:109` `if (!autoScrollToBottom) return`、`:113-116` rAF 内 `scrollTop = scrollHeight` + cleanup、`:117` 依赖数组 |
| 6 | §四代码片段（`listRef` + `useEffect([toolCalls.length])` + rAF + `cancelAnimationFrame`）能否直接落地 | ✅ 可按原样落地 | `SubAgentCard.tsx:1` `import * as React from 'react'` ⇒ 文件全程以 `React.useXxx` 形式调用（`:249` useMemo / `:282` useState / `:283`,`:293` useEffect / `:296` useRef）。片段用的 `React.useRef` / `React.useEffect` 命名**一致**，无需改成具名 import。`requestAnimationFrame`/`cancelAnimationFrame` 为全局，可直接用。`ref` 目标 class 与 `:90` 完全一致 |
| 7 | 4 步是否覆盖目标、每步有无可验证检查点、步骤 4 标 blocked 是否合理 | ✅ 基本覆盖 | 目标 = 步骤追加时自动贴底。步骤 1/2 = 落实现（ref + effect + 挂 ref），步骤 3 = 整体门禁，步骤 4 = 真机复验。检查点：步骤 1/2「`npm run typecheck` 0 错」、步骤 3「typecheck + dotnet build + npm test 全绿」、步骤 4「视觉驻留最新一步」——均可验证。步骤 4 标 ⏳blocked 合理（依赖老大真机，外部不可自证）。ℹ️ 见下 |
| 8 | §七「刻意不做」5 条与代码事实相符（尤其第 2、4 条） | ✅ 成立 | 第 2 条：「`autoScrollToBottom` 绑 `isRunning` 是有意为之」→ 与 `SubAgentExecutionDetail.tsx:379` 相符；§七.2 引用的排队期 `isRunning=false` 与 `SubAgentCard.tsx:260`（`isRunning = (tracked?.isRunning ?? false) && !isQueued`）方向一致。第 4 条：「不改 `max-h-[240px]`」→ 与 `SubAgentCard.tsx:90` 相符。第 1/3/5 条（不碰 A-2 / B / C、不引依赖不建文件）为方向声明，与需求 §六及白名单外约定一致，无可证伪点 |

---

## 二、分组

### ❌ 必须修
无。

### ⚠️ 建议修
- **§二②「全仓唯一卡片内自带滚动条」表述过宽** —— 同一文件 `SubAgentCard.tsx:189`（HoverCard 的 Prompt 区）就带 `overflow-y-auto`。建议把话收成「**`SubAgentCard` 卡片主体内唯一**」或「卡片内步骤列表这一处」，避免后续被人拿 `:189` 反咬。不影响修法本身。

### ℹ️ 提示
- **ℹ️-1（断言 7 附带）**：步骤 3 声称跑 `npm run typecheck`＋`dotnet build`＋`npm test` —— 这三个脚本定义在 `package.json` / 解决方案文件里，**不在本次白名单**，无法逐字核实脚本名与个数；且本刀为纯前端一行改动，`dotnet build` 大概率无关（门禁惯例，非错误）。
- **ℹ️-2（断言 6 附带）**：片段用 `useEffect`（而非 `useLayoutEffect`）＋ rAF —— 与仓库既有的 `TranscriptMessageList.tsx:113` 同一套路，风格一致；计划 §四.3 对「rAF 而非同步设值」的理由（布局未完成）在技术上是成立的。
- **ℹ️-3（数据源）**：§二④「步骤只追加、不重排」在 `SubAgentCard` 内的可见部分是成立的（`:99` `key={tc.id ?? idx}`，同 id 步骤就地更新、不重排队列），但「只追加」属 store 侧（`sub-agent-slice.ts`）行为，**不在白名单**，未逐行核实；对本刀（依赖长度变化）无影响。

---

## 三、结论

- 8 条断言：**7 条 ✅ 完全成立，1 条（#2 的「全仓唯一」措辞）⚠️ 需收口**，另附 3 条 ℹ️ 提示。
- ❌ 计数 = **0** ⇒ **可以进入用户确认与实施**。
- 实施时唯一建议：把 §二② 的「全仓唯一」改成「卡片主体内唯一」；代码片段可按原样落地（`import * as React` 形式已匹配）。
