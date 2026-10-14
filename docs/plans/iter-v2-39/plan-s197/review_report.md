# S-197 审查报告（阶段五）

> 审查人：**独立 subagent**（`code-reviewer`）。
> 审查对象：`dev/v2-iter-39` 工作区**未提交**改动（S-197），4 个文件：
> `src/renderer/src/lib/format-duration.ts`（+29）、`src/renderer/src/components/chat/InputArea/composer-status-indicator.tsx`（+32）、`tests/composer-status-elapsed/program.ts`（新增，30 断言）、`package.json`（+1 注册）。
> 工作区另有 S-182/189/193/198 等**无关改动**（`git status --short` 可见），按指示**一律忽略**，只审上表 4 文件。
> 规划依据：`requirements/S-197.md`（以 §4.7 订正版 + §五三条裁定为准）、`plan-s197/plan.md`。
> 审查方式（**只读**）：`git diff` 四文件全文；精读 `composer-status-indicator.tsx`、`lib/format-duration.ts`、`tests/composer-status-elapsed/program.ts`、`AssistantMessage/action-bar.tsx:61-65`、`stores/chat-store/index.ts`（`:155-355 / :470-600 / :1600-1900 / :2098-2131`）、`session-slice.ts:660-740`、`streaming-slice.ts`、`SessionConversationPane.tsx:31-41/280-289`、`InputArea/use-input-area-selectors.ts:200`、`lib/session-runtime-sync.ts:99-105`、`InputArea/types.ts`、`InputArea/utils.ts`；全仓 grep `streamingMessages[` / `setStreamingMessageId` / `beginUserTurn` / `messagesOverride` / `adjustCompactArtifactTimestamps` / `tabular-nums`；用 `package.json` + `assets/main.css` 确认 Tailwind 版本；并**实测** esbuild 打包体积验证「零依赖叶子模块」这一落点理由。未跑 `npm test`（门禁由主会话跑过：`typecheck` 0 错、`npm test` 71/71）。
> 出报告：2026-10-14。
> **结论：✅ 通过（无阻断）—— 判据收紧正确、与操作栏同起点同口径成立、Hooks 合法、渲染与无障碍可用；留 7 条非阻断建议（含 1 处计划文档未同步实际落点、1 条测试脆弱性、1 处低对比度）。**

---

## 摘要

本次改动在输入框左上角状态栏追加一个秒级走字的「本轮 run 耗时」。核心风险不在渲染，而在**口径**——起点必须与跑完后 `action-bar.tsx` 的耗时同源同起点。我逐条独立复核了七个指定断言，结论是**实现正确**：起点取流式 assistant 消息的 `createdAt`（= `sendMessage` 里 `userMessage`/`assistantMessage` 共用的同一个 `now`，`chat-store/index.ts:278/306/322`），操作栏的终点是 `loop_end`/错误分支回写的 `updatedAt`（`index.ts:1665/1673`、`1890/1898`），两条式子同起点、终点都取 `Date.now()`，末值差 ≤ 1 个 tick；`createdAt` 没有被 `adjustCompactArtifactTimestamps`（S-196）触碰（该函数只改压缩工件对，`index.ts:2098-2131` 只动 `messages[boundaryIndex]` / `messages[summaryIndex]`）。计时开关收紧为 `startedAt != null`，在正常路径下与 `isStreaming` 等价且**在跑工具 / 等审批 / 重试 / 子 Agent 期间都不停表**（`request_retry` `index.ts:1761-1779` 不清 `streamingMessages`）。Hooks 位置合法、`nowTick` 未进 `statusView` 的 `useMemo` 依赖（每秒只重渲这 10px 状态行）。测试 30 条断言计数与实现完全对得上，无恒真断言。落点 `lib/format-duration.ts` 的理由经打包实测成立（`InputArea/utils.ts` → **2.81 MB / 30 处 `window.api`**，`format-duration.ts` → **2.2 KB**）。

---

## 一、改动逐文件核对

| # | 文件 | 改了什么 | 结论 | 证据 |
|---|---|---|---|---|
| 1 | `lib/format-duration.ts` | 新增纯函数 `resolveRunningElapsedLabel({ startedAt, now, disabled })`（`:34-61`） | ✅ | 零 import 叶子模块；三处 `return null` 守门 + `Number.isFinite` 兜底；命中口径时 `formatDurationMs(now - startedAt)`，与操作栏喂给 `formatDurationMs` 的式子同形 |
| 2 | `InputArea/composer-status-indicator.tsx` | ① selector 带出 `streamingStartedAt: message?.createdAt ?? null`（`:56-58`）；② `useState`/`useEffect` tick（`:97-108`）；③ 状态文案后追加耗时段（`:258-264`） | ✅ | selector 用 `s.streamingMessages[targetSessionId]` 定位消息（`:38-43`）；tick 照 `SubAgentCard.tsx` 惯用法，卸载/翻转即 `clearInterval`；形态 B（`shrink-0` 独立一段）按裁定 ① 落地 |
| 3 | `tests/composer-status-elapsed/program.ts` | 新增 4 组 / 30 断言 | ✅ | 断言计数 = 8 + 11 + 6 + 5 = **30**，与文件末尾输出一致；无恒真断言（详见 §二-5） |
| 4 | `package.json` | 注册 `test:composer-status-elapsed`（`:76`） | ✅ | 脚本 alias 齐全（`@renderer`/`@shared`）；`run-tests.mjs` 按 `test:*` 前缀自动发现 |
| — | `AssistantMessage/action-bar.tsx:61-65` | **未改**（参照物） | ✅ | diff 中无此文件；耗时仍为 `updatedAt != null && createdAt != null && updatedAt > createdAt ? updatedAt - createdAt : null` |

---

## 二、七条指定断言的独立复核

| # | 断言 | 结论 | 证据（真实代码） |
|---|---|---|---|
| 1 | 口径与操作栏一致？`createdAt` 会被别处改写吗？ | **成立** | 起点同源：`index.ts:278 const now = Date.now()` → `:306 userMessage.createdAt = now` **且** `:322 assistantMessage.createdAt = now`，再 `:332 beginUserTurn(..., assistantMessage.id)`。操作栏终点 `updatedAt` 只在 run 收尾写：`loop_end` 分支 `:1665 const finishedAt = Date.now()` → `:1673 if (msg.role === 'assistant') msg.updatedAt = finishedAt`；错误分支 `:1890/1898` 同理。**全仓 grep 内存侧 `msg.updatedAt =` 只有这两处**（其余 `updatedAt =` 均为 session/project 或 `db-helpers` 的 DB 列 patch）。`adjustCompactArtifactTimestamps`（`:2098-2131`）只改 `messages[boundaryIndex]`（boundary 工件）与 `messages[summaryIndex]`（summary 工件）的 `createdAt`，**不碰**流式 assistant 消息；且只在 `isNewBoundary` 时被调用（`:2173-2176`，操作的是 `merged` 副本）。⇒ S-196 与本条**零交叉**，末值不会因工件重定位而跳字（差值 ≤ 1 tick，皆为 `Date.now()`） |
| 2 | 开关「`startedAt != null`」在所有路径下等价于 `isStreaming`？窗口 (a)/(b)？ | **正常路径恒等；恢复路径「近似等价」** | `isStreaming = Boolean(s.streamingMessages[resolvedSessionId])`（`SessionConversationPane.tsx:39-41`），而 selector 用 `s.streamingMessages[targetSessionId]`（`composer-status-indicator.tsx:40`），`targetSessionId = sessionId`（组件 prop，由 `InputArea/index.tsx:345 sessionId={draftSessionId}`、`use-input-area-selectors.ts:200 draftSessionId = sessionId ?? …` 传入，SCP 处 `sessionId={resolvedSessionId}`），**同一份数据**。**(b)** `streaming-slice.ts:44-62`（`setStreamingMessageId`：`if (existing && existing !== id) return`，不覆盖）与 `session-slice.ts:730-732`（`beginUserTurn`：`if (!streaming.streamingMessages[sessionId])`，不覆盖）**同为「不覆盖」**，无分歧。**(a)** 正常发送路径里 `beginUserTurn` 在**同一次 immer `set()`** 里先 push 消息再挂 `streamingMessages`（`:700-734`），原子、无窗口；`request_retry`（`:1761-1779`）只写 retry 状态、不清 `streamingMessages` ⇒ 重试期间**继续走字**。唯一「`isStreaming` 真但 `startedAt` 空」的窗口在**恢复路径**：`session-runtime-sync.ts:103-105` 的 `set_streaming_message` 只 `setStreamingMessageId`、**不保证**消息已在 `session.messages`（若该消息尚未落地，则 `message` 为 undefined ⇒ `startedAt` 为 null ⇒ 那一刻不显示耗时）。这是**瞬态**（消息落地即出现），既不产生错值也不停表，符合「宁可没有」的态度；仅此一处与「恒等价」有偏差 |
| 3 | Hooks 规则 | **合法** | `useState`/`useEffect` 在组件顶层、**无条件调用**（`composer-status-indicator.tsx:101-108`），位于 `useMemo` 之前但无条件、顺序稳定；`nowTick` **不在** `statusView` 的 `useMemo` 依赖里（依赖表 `:226-243` 无 `nowTick`）⇒ 每秒只重渲状态行、不重算 `statusView`。依赖 `[elapsedStartedAt, messagesOverride]`：`messagesOverride` 在唯一调用点恒为 `undefined`（`InputArea/index.tsx:345` 只透传 `composerRunStatus`，不含该字段）⇒ 依赖只随起点变化，起/清表时机正确。会话切换：`{draftSessionId && <ComposerStatusIndicator …>}` 是**同位置同类型 ⇒ 同实例重渲（非重挂）**，靠 `elapsedStartedAt` 变化触发 cleanup+重启；A→B 切会话 `createdAt` 不同 ⇒ 行为正确（仅当两会话流式消息 `createdAt` 恰好相同时才会漏一次重启，实践不可达） |
| 4 | 渲染与无障碍 | **可用（对比度偏低，见 S-4）** | Tailwind **v4.3.3**（`package.json:136` + `@tailwindcss/vite ^4.3.3`；`assets/main.css:1 @import 'tailwindcss'`），`tabular-nums` 是 v4 合法工具类、仓库已 20+ 处在用（如 `assistant/action-bar.tsx:150`、`ImageGeneratingLoader.tsx:199`）。`aria-hidden="true"` 把该 span 移出无障碍树，现代读屏不会为被 `aria-hidden` 子树内的每秒变化触发 `aria-live` 播报（外层 `:254 aria-live={isStreaming ? 'polite' : 'off'}` 仍会为**状态文案**变化播报，正是预期）。**「Ready 分支 `text-muted-foreground/55` + `opacity-70`」这一担忧不可达**：耗时出现 ⟹ `startedAt != null` ⟹ `streamingMessages[sessionId]` 存在 ⟹ `isStreaming` 为真 ⟹ `statusView` 必经 `Thinking`/`Generating`/`Waiting`/工具/审批/重试等非 Ready 分支，二者**不可能同帧共存**。布局：外层 `absolute left-5 top-2`（`:250`）为绝对定位，shrink-to-fit 宽度被 containing block（`.composer-shell relative`）约束，故文案 `truncate`（`:257 min-w-0 truncate`）生效、耗时 `shrink-0`（`:261`）不被挤掉——形态 B 的落点成立 |
| 5 | 测试是否真在测 | **在测；计数相符；无恒真断言** | 计数 8+11+6+5=**30**，与 `program.ts:166` 输出一致。守门组（`:33-77`）含 `startedAt=null` / `disabled` / `now=0` / `now===startedAt` / `now<startedAt`（时钟回拨）/ `NaN` / `Infinity`——任一「该 null 却出数」都会失败。同口径组（`:84-93`）11 条 `=== formatDurationMs(Δt)`，改实现口径即失败。阶梯组（`:97-104`）用字面量锁 `999ms/1.2s/12s/1m/1m5s/1h2m`。第 4 组（`:118-152`）扫源码 `export function resolveRunningElapsedLabel(` 唯一实现、消费方唯一。**脆弱性见 S-2**（barrel 再导出会误报），但**当前正确**，且其 `__dirname` 上溯三级（`tests/composer-status-elapsed/out` → 仓库根）在 Windows 与本仓库 `path.join` 用法下均成立 |
| 6 | 纯函数落点 | **理由成立；无更合适落点（SRP 轻微，见 S-3/建议）** | 实测（esbuild，`--bundle --platform=node`）：`InputArea/utils.ts` 打成 **2,812,061 字节（2.81 MB）**、内含 **30 处 `window.api`**、且报错链为 `utils.ts → … → goal-history-store.ts → @shared/messagepack/binary-ipc`（IPC 层）；`lib/format-duration.ts` 打成 **2,237 字节**——与验证报告 §2.1 的 2.7 MB / 7.4 kb 同量级。⇒「落 `InputArea/utils.ts` 则 node 侧不可测、纯口径逻辑永远没有单测」**成立**。`lib/format-duration.ts` 现无任何 import，是真叶子模块 |
| 7 | 其它坑 | **无新增阻断** | 多会话：`draftSessionId` = 当前会话 ⇒ 只反映当前会话、不串会话（`use-input-area-selectors.ts:200`）。历史回放：`disabled: messagesOverride != null`（`:113`）+ effect 提前 return（`:103`）**双保险**（但见 S-5：该分支当前无调用方）。极端值：`now` 回拨 / `NaN` / `Infinity` → null（`format-duration.ts:58-59`）；跑几小时 → `formatDurationMs` 有 `h` 档（`:22-27`）；`createdAt = 0` 见 **S-1**；`NaN` 已被 `Number.isFinite` 挡住。run 结束→重渲**无残留帧**：`loop_end`/error 在**同一次 `set()`** 里 `delete streamingMessages` 并回写 `updatedAt`（`:1653-1681` / `:1877-…`），`startedAt` 与 `isStreaming` 同帧翻空 |

### 已确认「不是坑」（避免误报）

- **首帧亚秒读数**：首个 tick 若 `Δ≈50ms` 会短暂显示 `50ms`（`formatDurationMs` `<1000 → …ms`）——与操作栏**同一个** formatter，属既定观感，非缺陷。
- **`aria-hidden` 是否挡得住 `aria-live`**：按 ARIA，`aria-hidden` 子树不进入无障碍树，live region 以无障碍树变化为准 ⇒ 不播报；合规。
- **形态 B 的 `shrink-0`**：绝对定位容器的 shrink-to-fit 已被约束，耗时不会被长工具名挤掉（见 §二-4）。
- **`isStreaming` prop 与 selector 是否会不一致**：二者同源同键（`resolvedSessionId` == `draftSessionId`），SCP/浮动窗两条调用链一致。

---

## 三、发现

### 阻断项（必须改）

**无。**

### 建议项（可留收尾刀 · 均非阻断）

| 编号 | 严重度 | 位置 | 证据 / 问题 | 建议 |
|---|---|---|---|---|
| **S-1** | info | `lib/format-duration.ts:58-59` | 守门写的是 `startedAt == null`，**`startedAt === 0` 不被拦**：`0` 既非 null、又 `Number.isFinite`，`now > 0` ⇒ 会算出 `formatDurationMs(now - 0)` 这种**荒谬大数**（正是操作栏 `481h56m` 同族）。注释却宣称「宁可没有，不可报 0 或负数」。**可达性低**：流式消息的 `createdAt` 恒为 `Date.now()`（`index.ts:322`），只有畸变消息才会是 0 | 把首条守门改成 `if (disabled || startedAt == null || !(startedAt > 0)) return null`，与注释承诺对齐 |
| **S-2** | info（低） | `tests/composer-status-elapsed/program.ts:118-152` | 第 4 组以 `text.includes('resolveRunningElapsedLabel')` 判「消费方」、以 `export function resolveRunningElapsedLabel(` 判「实现」。任何**barrel 再导出**（`export { resolveRunningElapsedLabel } from …`）或**别处注释里提到该标识符**，都会让 `consuming.length` 变 2 ⇒ **误报失败**（实现没坏，测试先红） | 改为匹配 **import 语句**（如 `/from ['"][^'"]*format-duration['"]/`）或排除仅含 `export {` 的行；或将断言降级为「≤ 2」以免误伤 |
| **S-3** | info | `plan-s197/plan.md:32` | 计划 §三 落点仍写 `components/chat/InputArea/utils.ts`，**与实现（`lib/format-duration.ts`）不一致**（需求/计划文档未同步实际落点，`verification_report.md` §2.1 已记录该订正） | 把 plan §三 那一行改成实际落点，或加一行「订正：实际落 `lib/format-duration.ts`，理由见 `format-duration.ts:42-44`」 |
| **S-4** | info（a11y） | `composer-status-indicator.tsx:261` | `text-[10px]`（继承父 `statusView.className` 的颜色）+ `opacity-70` 后对比度偏低：白底下 `Running {{tool}}` 分支 `text-sky-500/85 × 0.7` 估算 **≈1.8:1**（即便**不加** opacity，父文案本身也仅 ≈2.4:1）。WCAG AA（小字 4.5:1）不达标。属仓库既有「弱化」风格，但耗时恰是长任务**唯一的读数** | 若在意可读性：`opacity-70 → opacity-90/100`，或单独给更亮的色档；若刻意弱化，可维持（不阻断） |
| **S-5** | info | `composer-status-indicator.tsx:37-39/103/113` | `messagesOverride` / `disabled` 分支**当前无任何调用方**：`ComposerStatusIndicator` 唯一调用点 `InputArea/index.tsx:345` 不传 `messagesOverride`（`composerRunStatus` 只含 `isStreaming/draftInputTokens/isOptimizing/pendingImageReads/contextCompression*`）⇒ 历史回放护栏是**死代码**（防御性、合理，但集成层未覆盖，实机 E-6 也验不到） | 保留即可；若日后有回放调用方，建议在 `tests/` 补一条「`messagesOverride` 非空时不渲染耗时段」的集成断言 |
| **S-6** | info | `lib/session-runtime-sync.ts:103-105` | 恢复路径 `set_streaming_message` 只 `setStreamingMessageId`、不保证消息已在 `session.messages` ⇒ 存在**瞬态**：`isStreaming` 真而 `startedAt` 空 ⇒ 那一拍状态栏不显示耗时（消息落地即出现）。**不产生错值、不停表**，但使 §4.7 的「恒等价」在该路径上只是「近似等价（可能晚一拍）」 | 无需改（符合「宁可没有」）；若想彻底，可在 `set_streaming_message` 前确保 `add_message` 已应用，或容差内接受 |
| **S-7** | info | `composer-status-indicator.tsx:102-108` | effect 依赖 `[elapsedStartedAt, messagesOverride]`，**字面不含 `sessionId`**（与需求 §六-2「依赖里带上 `sessionId`」措辞不同）。实际靠派生值变化起/清表，切会话行为正确 | 无需改；如需与文档对齐，可在依赖里补 `sessionId`（无行为变化） |

---

## 四、建议（按优先级）

1. **S-1** 一处守门小改（`startedAt > 0`），把「不可报荒谬数字」的承诺真正兑现——**最便宜、最值得顺手做**。
2. **S-3** 同步「计划 §三 落点」与实现（纯文档，防后人踩坑）。
3. **S-2** 第 4 组扫源码改成匹配 import 语句，消除重构/加 barrel 时的误报。
4. **S-4** 视老大对可读性的取舍决定是否提升耗时的不透明度。
5. **S-5/S-6/S-7** 记录在案即可，不改代码。

> 不为凑数：以上 7 条中 S-1/S-2/S-3 有明确落点与收益，S-4 取决于主观取舍，S-5/S-6/S-7 属「已核实、无需动」的登记。

---

## 五、门禁与范围佐证

- 本报告为阶段五**唯一新增文件**（`docs/plans/iter-v2-39/plan-s197/review_report.md`），**未改任何源码**，未 commit、未跑 `npm test`。
- 门禁（主会话，与 `verification_report.md` §一一致）：`npm run typecheck` **0 错**；`npm test` **71/71**（含新增 `test:composer-status-elapsed`，30 断言）；`dotnet build` 0 警告 0 错误；本条不碰官网，`website build` 免跑。
- 审查范围：**4 个文件**（`git diff --stat` 中 S-197 部分 = `format-duration.ts` +29、`composer-status-indicator.tsx` +32、`package.json` +1，另 `tests/composer-status-elapsed/` 为新增目录）；其余工作区改动（S-182/189/193/198 等）按指示忽略。

---

## 六、结论

**✅ 通过（无阻断）** —— 判据收紧正确、与操作栏同起点同口径成立（末值差 ≤ 1 tick）、跑工具/等审批/重试/子 Agent 期间不停表、Hooks 合法、形态 B 与无障碍落地正确；仅留 7 条非阻断建议（其中 S-1「`startedAt === 0` 未拦」、S-3「计划落点未同步」、S-2「第 4 组扫源码脆弱」值得顺手收）。
