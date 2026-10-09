# 合规报告：plan-s176（阶段三 · 规划验证）

> 被验证对象：`docs/plans/iter-v2-38/plan-s176/plan.md`（+ 需求正文 `requirements/S-176.md`）
> 检查项来源：`docs/dev-workflow.md` 阶段三（第 353-372 行）
> 验证方式：独立 subagent（`code-reviewer`，只读；未改任何文件、未跑构建/测试），以 `git show e330a8a3`（含 amend 前 `3ab4f19c`）逐文件比对
> 落地提交：`e330a8a3`（fix(chat): 聊天窗留白封顶 —— 下界允许回落 + 回收触发线降到下界（S-176），9 files, +791/−166）
> 时间：2026-10-09（事后补验）

---

## 一、总体结论

**❌ 项 = 0 · 可进入执行态。**

「**先对齐、再压水位线**」这条与 iter-30 的分野，在代码里如实落地：`useMessageListScroll.ts:290-296` 确为「先写 `scrollTop`、再 `applyMinHeight`」同帧顺序。三处判定抽进零依赖的 `scroll-watermark.ts`（含 `observeFloor` 状态机），回归套件 `tests/scroll-watermark/` 58 checks 全绿。3 条 ⚠️ 全为文档层面（行号快照漂移、`[ ]` 残留形式、参数未真机标定），**无阻断级问题**。

**最值得处理的一条**：步骤 4 真机验证 blocked —— 本需求是纯渲染端手感修复，「只信真机」的五个参数尚未标定。

---

## 二、逐项结论（8 项）

| # | 检查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 步骤完整覆盖目标 | ✅ | 五步覆盖「抽纯函数 → 接入 → 回归套件 → 真机 → 整体测通」 |
| 2 | 每步有验证检查点 | ✅ | 步骤 1-5 全带检查点（`plan.md:76/84/90/96/101`） |
| 3 | 文件路径合规 | ✅ | `scroll-watermark.ts` 落 `components/chat/MessageList/`（与 `scroll-collapse-gate.ts` 同处）；`tests/scroll-watermark/` + `package.json` 注册 `test:scroll-watermark` |
| 4 | 分层依赖正确 | ✅ | `scroll-watermark.ts` **零依赖纯函数**（无 React / DOM），渲染端内部引用；`utils.ts` 只改注释 |
| 5 | 行号属实 | ⚠️→✅ | §二 行号为**实施前快照**，实测属实但已漂移（`useMessageListScroll.ts` 现 870 行，最多 +90）。当前锚点已补进 §二 |
| 6 | 现状描述与代码一致 | ✅ | 根因 ①（单调下界只增不减）/ ②（回收线给到半屏）与原代码吻合；流式结束分支 `:683-705`（旧行号）确为「先对齐再撤」的先例 |
| 7 | 刻意不做 / 不回退既有修复 | ✅ | 后半屏口径「留一部分当输出缓冲」保留（回收目标是 `gapTarget` 不是 0）；240ms 冷却锁**共用** `collapseGateRef`，未另起一把；S-150 的噪声过滤本意保留（改判定方式，不删） |
| 8 | CRLF / 无 BOM | ✅ | `plan.md` 182 CRLF / 0 裸 LF / 无 BOM；`S-176.md` 433 / 0 / 无 BOM |

---

## 三、验证报告点出、已在本轮订正的文档问题

| # | 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|---|
| 1 | 低 | `plan.md` §二 | 行号是**实施前快照**，实施后漂移最多 +90（`useMessageListScroll.ts` 现 870 行） | ✅ §二 顶部加「行号为实施前快照」警示 + 当前锚点（水位线 ref `:132`、`applyMinHeight` `:137-140`、tracker `:152`、`scrollToBottomImmediate` `:227-337`、回收分支 `:271-298`、bottom-anchor effect `:731-805`、流式结束分支 `:772-795`） |
| 2 | 低 | `plan.md:93/:97` | 步骤 4 残留 `[ ]`，与 `dev-workflow.md:417`「0 个 `[ ]` 残留」形式冲突 | ✅ 步骤 4 标题改标 **blocked：待老大真机**，并注明「此处 `[ ]` 属显式 blocked 项，非遗漏」 |
| 3 | 低 | `plan.md` §四.1 / 步骤 1 | 三个真机参数仍是**建议初值**未标定：`refloorHoldMs = 48`（`scroll-watermark.ts:57-61`）、`SHRINK_EPS = 24`、`maxGap = 240` | ✅ §四.1 加「参数现状（事后补验）」，注明真机调完须回填 `tests/scroll-watermark/program.ts:15` |

---

## 四、复核为「无误」的项

- **§四.3 顺序契约如实落地**：`useMessageListScroll.ts:290-296` 先写 `scrollTop` 再 `applyMinHeight` —— 这是与 iter-30 被否方案的本质区别，代码里没有走回头路。
- **帧计数改造自洽**：`streamingBottomFloorRef` → `streamingBottomTrackerRef`（`FloorTracker`），`observeFloor` 每帧恰好一次 —— 计划原写「两处都数」会因 `scrollToBottomImmediate` 每帧被调 2 次以上而把 K 减半，实施时识破并修正，**属主动申报的自洽偏离**（§五 步骤 1 已记）。
- **`test:scroll-watermark` 58 checks** 覆盖计划要求的六类断言（单帧骤降不认 / 连续偏低认 / 增长即采信 / 触发线在 `gapTarget` / 冷却窗口压制 / 时钟异常按不冷却），另加「20 帧一串收缩合并成少数几次回收」的集成模拟。
- **门禁**：`typecheck` 0 错、`npm test` **67/67**（基线 66 + 1），与 plan 步骤 5 记载一致。

---

## 五、非本刀欠账（记录，不纳入本刀）

- **真机验收缺口（blocked）**：步骤 4 五条现象未逐条真机确认 —— ① 折叠后留白不再累计几百 px；② 折叠过程无回跳；③ 滚动条长度与内容量大致诚实；④ 流式结束后留白归零；⑤ 手动上滚不被拽。
- **08:27 真机反馈那一轮修复**（判定改时间制 + 自驱动重判 + 冷却到期重判）已并入 `e330a8a3`，但其效果同样**待真机复验** ⇒ 与步骤 4 是同一道验收门。
- 三个参数（`refloorHoldMs` / `SHRINK_EPS` / `maxGap`）**只信真机，不信推算**。

---

## 六、结论

**可进入执行态** —— 代码已落地（`e330a8a3`）并通过门禁（`typecheck` 0 错 / `npm test` 67/67），文档论断订正完毕，随需求一刀提交。**唯一未闭合项是真机验收（blocked）**，属验收环而非计划合规问题。

> 说明：本报告为 2026-10-09 老大指令「38 迭代的其它计划都按照开发工作流去验证一遍」的**事后补验**产物。S-172 ~ S-176 原实施时未落 `compliance_report.md`（历史省略该产物），本次按工作流补齐。
