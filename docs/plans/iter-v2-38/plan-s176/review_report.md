# 审查报告：plan-s176（阶段五 · 审查态）

> 被审查对象：需求 `docs/plans/iter-v2-38/requirements/S-176.md` / 计划 `docs/plans/iter-v2-38/plan-s176/plan.md` / 落地提交 `e330a8a3`（由 `3ab4f19c` amend 而来）
> 审查方式：独立 subagent（code-reviewer，只读源码；未改任何文件、未跑构建/测试）
> 时间：2026-10-09

## 一、总体结论

**❌ 阻断项 = 0，可进入验证态。** 落地提交 `e330a8a3` 与需求 `S-176.md`、计划 `plan.md` 一致；纯渲染端改动、零新增依赖；新增的 `scroll-watermark.ts` 是零依赖纯函数模块，与 `scroll-collapse-gate.ts` 同形；顺序契约（先对齐 `scrollTop`、再压 `min-height`）有机器可验证断言兜住（`tests/scroll-watermark/program.ts:163-187`），**没有违背 iter-30 写死在代码里的反面理由**。另有 6 条 ⚠️ 建议级问题（多为边界/取值口径），均不影响上线判断，交验证态真机与后续收尾决定。

## 二、逐项结论（审查项 5 条 + 回归风险 + 域外改动，共 7 行表）

| # | 审查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 分层约定（纯渲染端，不碰主进程 / Worker） | ✅ 通过 | 改动全在 `src/renderer/src/components/chat/MessageList/` 与 `tests/`；`scroll-watermark.ts` **零 import**（`git show e330a8a3:.../scroll-watermark.ts` 无任何 import/require）；`useMessageListScroll.ts:24-38` 只 import 同目录两个模块 |
| 2 | 魔法数字 / 时限 / 像素值 | ⚠️ 建议 | `48 / 24 / 240` 三个值集中在 `WATERMARK_CONFIG`（`scroll-watermark.ts:57-61`）且**条条有出处与调法**（`:50-56`、`plan.md §八`）；`240ms` 沿用既有 `COLLAPSE_GATE_CONFIG`。问题在：①`maxGap=240` 与 `STREAMING_BOTTOM_FOLLOW_CHUNK=240`、测试里的 `const CHUNK = 240` **三处各写一份**；②定时器 `delay + 1` 的 `+1` 无注释（`useMessageListScroll.ts:208,224`） |
| 3 | 正确性（时间制判定 + 顺序契约；是否重踩 iter-30 的坑） | ✅ 通过（附 2 条 ℹ️） | 状态机自洽：上抬立即、回落需 `holdMs` + `ε` 双阈、同刻观测幂等（`observeFloor:106-119`）；顺序契约 `resolveReclaimPlan:171-179` 保证 `scrollTop + clientHeight === minHeight` ⇒ 压完无 clamp 余量（§四详述） |
| 4 | 错误处理 / 边界（连续增删组件、冷却中途、回流中断） | ⚠️ 建议 | 组件卸载与切会话都清了两个定时器（`:648-652`、`:837-838`）；`collapseRetryDelay:212-215` 时钟回拨 / NaN 返回 `null` 不排、不锁死。**但定时器回调路径绕过了 effect 里的两道门（`pendingAskUserQuestion` / `isLoadingOlderMessagesRef`）**，见 §三 #2 |
| 5 | 是否引入不需要的依赖 | ✅ 通过 | `package.json` 只加一条 `test:scroll-watermark` 脚本（`:65`），无新增 npm 依赖；新模块不引任何第三方 |
| 6 | 回归风险（是否重新引入「`scrollHeight` 骤减 → clamp `scrollTop` → 跳动」） | ⚠️ 建议（已断链，残留一次性位移需真机确认） | clamp 链**已断**（成对落位 + 写序在压序之前，压后 `maxScrollTop ≥ scrollTop`，见 §四）；残留的是「回收本身使内容下移一段」的单向位移，非 iter-30 那种来回跳；老大 08:27 真机已证「无跳动 ✅」，本条只是把「仍需真机盯 ⑤ 用户上滚不被拽」记在账上 |
| 7 | 域外顺手改动 | ℹ️ 知晓 | 删 `trackContentBottom` 及其断言属 S-150 文件（`scroll-collapse-gate.ts` / `tests/scroll-collapse-gate/program.ts`），超出 S-176 主题范围，但有 08:19 老大口径背书、两处留指针、无悬挂调用点（全仓 grep 旧符号只剩注释），可接受 |

## 三、问题与建议

| # | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| 1 | ⚠️ 建议 | `useMessageListScroll.ts:293-296` + `scroll-watermark.ts:176` | 回收分支只在 `plan.minHeight < contentHeightWatermarkRef.current` 时才写 DOM，但 `resolveReclaimPlan` 无条件返回收紧后的 `minHeight`。二者口径不同（一个「成对值」、一个「只在变小时写」），若将来有人把 `applyMinHeight` 的调用条件改掉，「先对齐、再压」的配对就可能被拆散 | 保持现状即可，但建议在 `:293` 那行补一句注释点明「这里必须与 `ref.scrollTop = plan.scrollTop` 成对出现」，或把两行也一起收进一个 `applyReclaimPlan(ref, plan)` 里，让「成对」在代码结构上不可拆 |
| 2 | ⚠️ 建议 | `useMessageListScroll.ts:205-208`、`:221-224` | 两个补位定时器到点直接调 `scrollToBottomImmediateRef.current()`，**绕过了** bottom-anchor effect 里的 `if (pendingAskUserQuestion) return`（`:732`）与 `isLoadingOlderMessagesRef.current` 门（`:733`）。加载历史消息 / 弹出提问卡时被定时器拽视口，属未验证路径 | 在定时器回调里补同样两道门（或抽一个 `guardedScrollToBottomImmediate()` 给 effect 与定时器共用）。当前仅在流式 + 偏低/冷却场景才会排到，触发面窄，故列建议不列阻断 |
| 3 | ⚠️ 建议 | `scroll-watermark.ts:132-134`、`:176-177` | `resolveGapTarget` 的兜底是 `target > 0 ? target : 0`，`resolveReclaimPlan` 的兜底是 `Math.max(0, ...)` —— 两者语义都只是「**不越界 / 不为负**」，**不保证等于 `gapTarget`**（`S-176.md:138` 记录了实施中正是按这个口径「改断言不改代码」）。读代码时容易误读成「兜到 `gapTarget`」 | 无需改。若要更直白，可把 `resolveGapTarget` 的兜底写成 `Math.max(0, Math.min(...))`，与 `resolveReclaimPlan` 同形、一行内自解释 |
| 4 | ⚠️ 建议 | `scroll-watermark.ts:60`、`:54`；`utils.ts:221`；`tests/scroll-watermark/program.ts:140` | `240` 这个数在四处各写一份（`WATERMARK_CONFIG.maxGap`、注释引用的 `STREAMING_BOTTOM_FOLLOW_CHUNK`、`utils.ts` 定义、测试里的 `const CHUNK`）。真机调参若只改一处会静默漂移 | 测试里的 `CHUNK` 改成从 `utils.ts` 导入（现有测试已 import 同目录模块，成本极低）；`maxGap` 与 `CHUNK` 的「同值」关系已在注释里点明，若担心耦合可保留，但至少让测试不再手抄 |
| 5 | ℹ️ 知晓 | `useMessageListScroll.ts:340` | `scrollToBottomImmediateRef.current = scrollToBottomImmediate` 在**渲染期**赋值（渲染副作用）。在 React 18 并发 / `StrictMode` 双渲染下，被丢弃的那次渲染也会写 ref；因两个 ref 指向同一函数语义，实践中无害 | 想更「正统」可挪进 `React.useEffect`（但会引入「effect 前定时器拿到旧值」的窗口）。当前写法与仓内既有 `canAutoScrollRef.current = canAutoScroll`（`:171`）同风格，保持一致性即可 |
| 6 | ℹ️ 知晓 | `useMessageListScroll.ts:253`（`realContentBottomRef.current = realBottom` 在 `canAutoScrollRef` 门**之前**） | 下界现在**会降**，于是「用户手动上滚阅读」时 `realContentBottomRef` 也可能被压低 → `syncBottomState`（`:357-374`）里的 `dist` 变小，理论上存在把 `autoScrollModeRef` 从 `'off'` **重新抬回 `'stream'`**（`:372`）的路径，从而在后续跟随里把用户拽回底部 —— 与需求 §六.2 验收 ⑤「用户手动上滚阅读时不被拽」正面对上 | 属**推理所得、未经真机证伪**的可疑路径（触发还需一次 scroll 事件）。建议验证态把「上滚阅读 + 并发工具卡折叠」作为一个专门场景盯一下；若真被拽，最小改法是：`canAutoScroll` 为假时**不要**更新 `realContentBottomRef`（或让下界回落只在钉底时采信） |
| 7 | ℹ️ 知晓 | `scroll-watermark.ts:115` | `observeFloor` 里「亚阈值偏低」会**清空 `lowSince`**。若实测值在 `ε` 边界上下反复横跳（例：`floor=1000`，`raw` 在 700 与 980 之间交替），每次回落都被重置，确认永远攒不满 ⇒ 真收缩不被采信 | 场景要求内联行 280px 的往复，概率低；且表现退化为「留白不收」而非「跳」，属安全方向。记在此备查，不必现在改 |

## 四、与 iter-30 既有结论的关系（本刀是否与写死在代码里的 iter-30 理由冲突）

**结论：不冲突。本刀把 iter-30 的「禁止项」精确到了它的成立前提，并把前提显式写进代码与断言。**

iter-30 写死在代码里的理由共三处，逐条对照：

| iter-30 写死的位置 | 原话（要点） | 本刀是否违背 | 依据 |
|---|---|---|---|
| `useMessageListScroll.ts:734-735`（保留） | 「只要水位线**不降**，就没有 clamp，也就没有回跳」 | **部分推翻，但改了「降」的代价描述** | 本刀只抬不压的那半句仍留在 effect（`:737-740` 明写「本 effect 里**只抬不压**」）；「压」被搬进 `scrollToBottomImmediate` 的回收分支，且**先对齐 `scrollTop` 再压** |
| `utils.ts` 里 `STREAMING_BOTTOM_FOLLOW_CHUNK` 旧注释（本刀改写） | 「位移全部由 `scrollTop` 承担，**不碰 `min-height`** —— `scrollHeight` 不变就没有 clamp」 | **前提被显式标注为已失效** | 新注释（`utils.ts:204-212`）写明：「『绝不压 min-height』是 iter-30 的结论，那条结论的前提是**不对齐就压**，现已被 S-176 取代」。没有偷偷删旧结论，而是把旧结论的前提与取代理由一起留在原位 |
| `useMessageListScroll.ts:772-779`（保留，且被本刀当作先例引用） | 流式结束撤水位线前「**先**把视口对齐到真实内容底」 | **完全一致** | 本刀的 `resolveReclaimPlan` 是把这段既有顺序**搬进流式中途**；`:289` 注释明写「流式结束那一帧早就这么干了……本需求只是把它搬进流式中途」 |

**§四.2 硬约束（顺序必须是「先对齐、再撤」）逐条核对**：
1. 顺序 —— `useMessageListScroll.ts:291-296`：`markProgrammaticScroll()` → `ref.scrollTop = plan.scrollTop` → `applyMinHeight(plan.minHeight)`，顺序正确。
2. 「不另起一套」—— `resolveReclaimPlan` 与流式结束分支（`:780-793`）是同一个思路的两个实例；回收分支复用同一把 `collapseGateRef` 冷却锁（`:277-283`），未新开锁。
3. 「别碰 `scroll-behavior: smooth` 覆盖」—— 未动 `VirtualListContent.tsx:137`，`git show` 里该文件**不在改动清单**，满足。
4. 「不得与冷却锁 / 单调下界打架，要动得给出推理」—— 冷却锁原样复用（`COLLAPSE_GATE_CONFIG.cooldownMs=240` 未改）；单调下界由 `trackContentBottom` 换成 `observeFloor`，推理写在 `scroll-collapse-gate.ts:65-74`（「不是噪声过滤不需要了……问题是『只增不减』把真收缩一并滤掉了」），并给出「方向 → 持续时长」的替换依据。

**「回不去 iter-30」这件事是否只是注释**：不是。`tests/scroll-watermark/program.ts:163-187` 用 `resolveReclaimPlan` 的成对返回值把 `scrollTop + clientHeight === minHeight` 钉成断言（含三组几何 + 负内容底兜底），谁把配对改坏（只改一边、或退回「先压后对齐」）套件立刻红。这是本刀**最强的防回退装置**，比注释可信。

**一个必须说清的残差**：「先对齐、再压」断掉的是**clamp 造成的来回跳**，不等于「回收瞬间视口内容不下移」。回收本身会把内容整体下移 `scrollTop - plan.scrollTop`（本次真机实测该值约 100+px 量级也被判「无跳动」）。也就是说，本刀兑现的是「不产生浏览器 clamp 式回跳」，而「回收这一次的单向位移有多可感知」仍需真机口径，`S-176.md §六.2` 已把 ② 列为待测项 —— 结论与需求自述一致，不算隐瞒。

## 五、非本刀欠账（记录，不纳入本刀）

1. **真机调参未做** —— `refloorHoldMs=48` / `shrinkEpsilon=24` / `maxGap=240` 全是建议初值（`S-176.md:116`、`plan.md §八` 自述「只信真机，不信推算」）。验证态需按 `plan.md §八` 的调法逐项确认，并回填 `tests/scroll-watermark/program.ts:15-16` 提到的数值对齐。
2. **冷却锁 `240ms` 是否为唯一瓶颈未验** —— `plan.md:181` 已写明「若仍嫌白，再**单独**动冷却锁（240 → 80）并**单独**验拉锯」，属下一刀，不在本刀。
3. **「用户在上方阅读」的内容锚定** —— `plan.md §七` / `S-176.md §七` 明确本次不做；但 §三 #6 提出的「下界回落可能把 `autoScrollMode` 抬回 `stream`」是与它相邻的风险面，建议验证态顺带盯。
4. **`scheduleShrinkProbe` / `scheduleReclaimRetry` 的延迟函数有单测，但定时器与 effect 的编排本身没有回归覆盖** —— `tests/scroll-watermark` 只测纯函数，`useMessageListScroll.ts` 无测试（仓内既有口径，非本刀新增欠账）。
5. **`ThinkingBlock` 独立滚动链路**（`THINKING_SCROLL_AHEAD_PX`）与「半屏 `gapCeiling` 在 `ThinkingBlock` 侧是否也要降」—— 需求 §七 已划定不做。

## 六、结论

**❌ = 0 ⇒ 允许进入验证态。**

- 需求 / 计划 / 落地提交三者一致：`e330a8a3` 的文件清单与 `plan.md §六`、`S-176.md §八` 逐项对得上（含 2026-10-09 的 `trackContentBottom` 删除与文档回填）。
- 分层、依赖、纯度三项硬指标全过；新增 `scroll-watermark.ts` 零依赖、零 React / DOM，与既有 `scroll-collapse-gate.ts` / `tests/scroll-collapse-gate` 同形。
- 与 iter-30 的既有结论**不冲突**：保留了「先对齐、再撤」的顺序契约并用断言钉死；对旧注释采取「标注前提失效 + 写取代理由」而非删除。
- 6 条 ⚠️ 建议（其中 §三 #2 定时器绕过两道门、#6 上滚可能被抬回 `stream`）与 3 条 ℹ️ 均为**真机可测**项，不构成阻断；建议验证态把它们并入验收 ⑤（用户上滚不被拽）与边界场景一起盯。
- 门禁数字（typecheck 0 错 / `npm test` 67/67 / 套件 88 checks）本阶段**未复跑**（阶段五只审查），交由验证态复核。

## 七、审查范围自述

**读了什么（只读）**：

- 需求：`docs/plans/iter-v2-38/requirements/S-176.md`（全文 140 行）。
- 计划：`docs/plans/iter-v2-38/plan-s176/plan.md`（全文 181 行）。
- 落地提交：`git show --stat e330a8a3`、`git show e330a8a3 -- <各文件>` 的完整 diff（含 commit message），并核对 `git diff --stat 3ab4f19c e330a8a3`（amend 前后的差异范围）。
- 源码现状（不只 diff，读了全文相关段落）：`scroll-watermark.ts`（全文 216 行）、`scroll-collapse-gate.ts`（全文 74 行）、`useMessageListScroll.ts`（`:120-460`、`:700-860`）、`utils.ts`（`STREAMING_BOTTOM_FOLLOW_CHUNK` 注释段）。
- 测试：`tests/scroll-watermark/program.ts`（全文 259 行）、`tests/scroll-collapse-gate/program.ts` 的 diff。
- 旁证：`VirtualListContent.tsx:135-149`（`scrollBehavior: 'auto'` / `min-height` 直写约定）、`docs/plans/iter-v2-30/raw-requirements.md`（iter-30 原话，注意该文件为 GBK 乱码，仅作定位不引用字面）。

**跑了什么命令（全部只读）**：

```
git log --oneline -3 e330a8a3
git show --stat e330a8a3
git show e330a8a3 -- src/renderer/src/components/chat/MessageList/scroll-collapse-gate.ts .../utils.ts package.json
git show e330a8a3 -- src/renderer/src/components/chat/MessageList/useMessageListScroll.ts
git show e330a8a3 -- tests/scroll-collapse-gate/program.ts
git cat-file -t 3ab4f19c ; git diff --stat 3ab4f19c e330a8a3
git show e330a8a3:.../scroll-watermark.ts | Select-String "^import|require\("
Select-String 全仓 grep：trackContentBottom / streamingBottomFloorRef / refloorFrames / lowFrames / gapCeiling / syncBottomState / setTimeout / clearTimeout / performance.now
```

**没做什么（边界）**：未修改任何源码 / 计划 / 需求文件；未 commit / push；未跑 `npm run typecheck`、未跑 `npm test`、未跑任何构建；未在任何生产实例上操作。本阶段唯一写出的文件是这份 `review_report.md`。

**结论边界**：本报告只做静态审查。①「回收那一下内容单向下移多少 px 可感知」②「用户上滚时是否被拽回」③「48 / 24 / 240 三个值合不合适」④ 门禁数字是否仍为 67/67 —— 均属真机 / 复跑范畴，本报告不出结论，交验证态。
