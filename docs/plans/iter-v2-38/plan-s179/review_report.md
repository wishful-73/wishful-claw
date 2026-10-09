# S-179 阶段五 —— 独立代码审查报告

> 归属 iter-v2-38。需求 [`../requirements/S-179.md`](../requirements/S-179.md) / 计划 [`plan.md`](plan.md)。
> 审查者：独立 subagent（`code-reviewer`，只读）。日期 2026-10-09。
> 审查对象：`src/renderer/src/components/chat/SubAgentCard.tsx` 的 `SubAgentStepList` —— 唯一代码改动面。

---

## 一、审查范围与方法

- 已读：`docs/plans/iter-v2-38/requirements/S-179.md`、`docs/plans/iter-v2-38/plan-s179/plan.md`、`src/renderer/src/components/chat/SubAgentCard.tsx`（实读 `:55-154` 改动区、`:180-212`、`:374-395`、`:440-509`）。
- 只读命令：`git status` / `git diff` / `git diff --stat` / `git diff --numstat -- src/` / `git log --oneline`。
- 未修改任何文件、未提交、未跑构建或测试。

---

## 二、结论

**`❌ 0 / ⚠️ 1 / ℹ️ 7`**

| # | 检查点 | 结论 |
|---|---|---|
| 1 | Rules of Hooks（函数顶部 / early return 之前 / 两渲染路径 hook 数一致） | ✔ 通过 |
| 2 | effect 依赖 `[toolCalls.length]` 与注释声称 | ⚠️ 依赖正确，**注释理由过度概括** |
| 3 | ref 挂载点唯一且正确（含 `:204` 另一处 `overflow-y-auto`） | ✔ 通过，未误伤 |
| 4 | 贴底是否破坏用户上滚 | ℹ️ 无条件贴底属已知取舍（A-2 刻意未做），非缺陷 |
| 5 | rAF 时序与卸载安全 | ✔ 通过，无空引用、无卸载后写入 |
| 6 | 分层与依赖 | ✔ 通过，渲染端闭环、零新增依赖 |
| 7 | 无回退 | ✔ 通过，`16+/1-` 单文件 |
| 8 | 注释风格与规范 | ✔ 通过 |

**总评**：改动与计划 A-1 逐字一致，位置、依赖、挂载点、清理四要素全部正确，未引入回归与新依赖；未发现 ❌ 级问题。

---

## 三、逐条明细

### 1. Rules of Hooks —— ℹ️ 通过

三个 hooks 全部位于函数顶部、在 `:96` early return 之前，两条渲染路径 hook 数量一致（均为 3）。

- 证据：`:79` `useReducer` → `:80` `useRef` → `:87-94` `useEffect`，其后才是 `:96` `if (toolCalls.length === 0) { return … }`；非空路径 `:104-152`。两侧均先执行同 3 个 hooks。
- 建议：无需动作。

### 2. effect 依赖正确性 —— ⚠️ 注释措辞过度概括（**唯一可修项**）

依赖取 `toolCalls.length` 是正确选择；但原注释里「`toolCalls` 每次渲染都是新数组引用 ⇒ 直接依赖会逐帧触发」**只对回落路径成立**，对活数据路径不成立，属以偏概全。

- 证据：`:381-382` 活路径 `effectiveToolCalls = tracked.toolCalls`（直接引用 store 数组，切片未变时引用**可保持稳定**）；`:383-393` 回落路径 `(histMeta?.toolCalls ?? []).map(…)` 才**必然**每次渲染产生新数组。
- 附带正向确认：effect body 内**并未引用** `toolCalls`，故 `react-hooks/exhaustive-deps` 不会报警；`length` 作为纯触发器还能覆盖数组被原地修改的情形。
- 建议：改写注释为经得起推敲的理由 —— 只改文案，不动代码。
- **处置：已修**（`SubAgentCard.tsx:82-87` 注释改为「长度变化才是『多了一步』的充要信号；直接依赖数组会沿回落路径每帧触发，并会漏掉原地变更」）。

### 3. ref 挂载点唯一且正确 —— ℹ️ 通过

`ref={listRef}` 只挂在真正带 `overflow-y-auto` 的那个容器上；文件内另一处同结构滚动容器属**另一个组件**，未被误伤或漏挂。

- 证据：`:105` `<div ref={listRef} className="max-h-[240px] overflow-y-auto px-3 py-1">`；另一处 `:204` `<div className="max-h-[60vh] overflow-y-auto …">` 位于 `SubAgentHoverContent`（`:158` 起），与 `listRef` 无关联、未改动。
- 建议：无需动作。

### 4. 贴底 vs 用户上滚 —— ℹ️ 已知取舍

无条件贴底；候选 A-2「用户手动上滚就不打扰」按计划**刻意未做**，不作缺陷上报。

- 证据：`:87-94` effect 无任何用户滚动态判断，长度一变即 `scrollTop = scrollHeight`（`:91`）；`plan.md` §七.1 明写不做 A-2。
- 附注：折叠后再展开走 `AnimatePresence` 重挂载（`:479-494`），effect 在挂载时也必然执行一次 ⇒ 重开卡片直接落到最新一步，符合本需求预期。
- 建议：无需动作；日后若要 A-2，另开一刀并复用 S-176 的 `autoScrollMode` 语义。

### 5. rAF 时序与卸载安全 —— ℹ️ 通过

`listRef.current` 为空时在调度前即 `return`；卸载/重跑由 cleanup 统一 `cancelAnimationFrame`，无「卸载后写入」面。

- 证据：`:88-89` `if (!node) return`（空路径 `:96-101` 不挂 ref ⇒ 恒安全）；`:90-93` `const frame = requestAnimationFrame(…); return () => cancelAnimationFrame(frame)`。effect 内无 setState，唯一副作用是帧内对已捕获 `node` 写 `scrollTop`；快速连续追加时，上一次未触发的帧会被 cleanup 取消后再调度新帧。
- 建议：无需动作。风格提示见第 8 条。

### 6. 分层与依赖 —— ℹ️ 通过

渲染端内闭环，零新增依赖，未越界到主进程 / 共享层，无硬编码路径、密钥、环境量。

- 证据：`git diff` 仅触及 `SubAgentCard.tsx`；新增符号只有 `listRef` 与一个 `React.useEffect`，无新增 import。
- 建议：无需动作。

### 7. 无回退 —— ℹ️ 通过

纯新增 + 一处属性注入，未删改任何与本需求无关的既有逻辑。

- 证据：`git diff --numstat -- src/` = `16  1  src/renderer/src/components/chat/SubAgentCard.tsx` —— 唯一删除是 `:105` 原 `<div className=…>` 被替换为带 `ref` 的同款标签，className 逐字未变。
- 附注：`git status` 里另有一批未提交的文档改动（`docs/dev-workflow.md`、`changelog.md`、`plan-s172/173/175/176`、`requirements/S-172/173/175/176`），经逐段查看属 S-172/173/175/176 的回填与 changelog 补写，**与 S-179 无关、非本刀产物**。
- 建议：无需动作。

### 8. 注释风格与代码规范 —— ℹ️ 通过

新注释为英文，与文件既有风格一致（该文件无中文注释）；缩进 2 空格、命名 `listRef` 与既有同族。

- 证据：`:82-87` 英文说明；`:70` `// ── Step List Component ──`、`:380` `// Build tool calls list: …` 同为英文。
- 建议：可选风格统一 —— 把 `:90` / `:93` 的裸 `requestAnimationFrame` / `cancelAnimationFrame` 写成 `window.` 前缀，与同仓三处同型实现（`TranscriptMessageList.tsx:113` / `bash-output.tsx:103` / `file-change-previews.tsx:35`）一致；**不改亦无功能影响，本次不取**。

---

## 四、处置汇总

| 级别 | 条数 | 处置 |
|---|---|---|
| ❌ | 0 | —— |
| ⚠️ | 1 | **已修**：`:82-87` 注释理由改写（仅文案，不动代码） |
| ℹ️ | 7 | 6 条无需动作；1 条（第 8 条 `window.` 前缀）**不取**，落为可选项 |

⇒ 审查通过，可进阶段六验证。
