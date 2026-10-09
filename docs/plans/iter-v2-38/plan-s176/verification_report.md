# 验证报告：plan-s176（阶段六 · 验证态）

> 被验证对象：`docs/plans/iter-v2-38/plan-s176/plan.md`（+ 需求正文 `requirements/S-176.md`）
> 落地提交：`e330a8a3`（fix(chat)，9 files，+791/−166；由 `3ab4f19c` amend 而来）
> 验证方式：独立跑门禁 + 本需求专项回归套件（`tests/scroll-watermark`）+ 相邻套件（`tests/scroll-collapse-gate`）。
> 验证时间：2026-10-09（事后补验）

---

## 一、总体结论

**PARTIAL** —— 编译与回归**全绿**（typecheck 0 错 / `npm test` 67/67 / `test:scroll-watermark` **88 checks** / 相邻 `test:scroll-collapse-gate` 25 checks），「先对齐、再压水位线」的顺序契约有**纯函数 + 机器断言**双重保险；但本需求是**手感修复**，plan 步骤 4 的真机五条现象**全部未验**，故不判 PASS。

---

## 二、编译证据

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `npm run typecheck`（两配置） | **0** | 0 错 |
| 2 | `dotnet build src/runtime/WishfulClaw.sln` | **0** | `已成功生成。0 个警告 0 个错误`（本刀纯渲染端改动，此步为整体门禁） |

---

## 三、测试证据

### 3.1 总门禁

```
npm test  →  67/67 通过      （ES 51 + C# 16）  退出码 0
```

其中 `test:scroll-watermark  88 assertions`（在本刀引入，使基线由 66 → 67）。

### 3.2 专项套件（本需求）

| 套件 | checks/assertions | 结果 |
|---|---|---|
| `test:scroll-watermark` | **88** | 全过（退出码 0） |
| `test:scroll-collapse-gate`（相邻，防回归） | **25** | 全过（退出码 0） |

套件覆盖 plan 要求的六类断言，另加集成模拟：

1. 单帧骤降**不**认（噪声）；
2. 连续偏低**认**（真收缩）；
3. 增长方向**永远采信**；
4. 回收触发线在 `gapTarget` 而非半屏；
5. 冷却窗口内压掉重复回收；
6. 时钟异常（回拨 / `NaN`）按「不冷却」处理；
7. **顺序契约**：`resolveReclaimPlan` 产出的 `scrollTop` 与 `minHeight` 满足 `maxScrollTop == scrollTop`（机器断言钉住「先对齐再撤」）；
8. 集成：「20 帧一串收缩合并成少数几次回收」。

---

## 四、逐项验证（对照 plan 步骤 1-5）

| 步骤 | 检查点 | 结论 | 证据 |
|---|---|---|---|
| 1 | 抽纯函数（`scroll-watermark.ts` 零依赖） | ✅ | 文件内**无一条 `import`**（Select-String 结果为空）；`npm run typecheck` 0 错 |
| 2 | 接入 `useMessageListScroll.ts`（下界回落 + 回收线 + 顺序契约 + 共用冷却锁） | ✅ | 回收执行处为「先写 `scrollTop`、再 `applyMinHeight`」同帧配对；用户手动上滚时**先早退**，不回收、不压水位线 |
| 3 | 回归套件（`test:scroll-watermark`） | ✅ | **88 checks** 全过，`npm test` 计数 66 → 67 |
| 4 | **真机验证（本需求重头）** | ❌ **未做** | plan 已显式标 **blocked：待老大真机**；`refloorHoldMs=48` / `SHRINK_EPS=24` / `maxGap=240` 仍是建议初值 |
| 5 | 整体测通 | ✅ | `typecheck` 0 错；`npm test` 67/67；改动文件 CRLF 无 BOM |

**「没走回 iter-30 老路」复核**：✅
- iter-30 被否的是「**不对齐就撤** `min-height`」（必跳）；
- 本刀执行顺序为**先对齐 `scrollTop`、再压 `minHeight`**，此时 `scrollHeight == 水位线`、`maxScrollTop == 刚写的 scrollTop` ⇒ 浏览器**没有可 clamp 的余量**；
- 该顺序由纯函数契约（`resolveReclaimPlan`）+ 集成断言（`tests/scroll-watermark/program.ts`）**双重机器保险**，不靠注释约束。

---

## 五、未覆盖项（PARTIAL 的直接原因）

| # | 项 | 为什么没做 | 谁来做 |
|---|---|---|---|
| 1 | **真机五条现象**：① 折叠后留白不再累计几百 px；② 折叠过程无回跳；③ 滚动条长度大致诚实；④ 流式结束后留白归零；⑤ 手动上滚不被拽 | ~~需真实会话~~ ⇒ **已于 2026-10-09 11:13 由老大复验**：**视口正常（主目标达成）**；但**滚动条未到底、高度未在流式期回收（「越拉越长」）**，输出结束时才回收 ⇒ 现象 ③ **未达**，①②④⑤ 未逐条确认（见 `requirements/S-176.md` §九） | 老大侧（残留是否接受待定） |
| 2 | **三个参数标定**（`refloorHoldMs` / `SHRINK_EPS` / `maxGap`） | 「只信真机，不信推算」；真机调完须回填 `tests/scroll-watermark/program.ts` 的测试常量 | 老大侧 + 随后回填 |
| 3 | 08:27 真机反馈那一轮修复（判定改时间制 + 自驱动重判 + 冷却到期重判）的效果 | 已并入 `e330a8a3`，但与步骤 4 是**同一道验收门** | 老大侧 |

> 「用户在上方阅读时内容收缩造成的位移」为**已知盲区**（老大已认），不在本刀范围。

---

## 六、补充审查发现（阶段五第二轮，须跟进，不阻断）

| # | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| 1 | ⚠️ 需修 | `useMessageListScroll.ts:201-209`（调用点 `:250` / `:751`） | **探针自激风险**：当 `lowSince` 已置而 `getRealContentBottom()` 返回 `0`/`NaN`（内容为空帧）时，`observeFloor` 原样返回且**不清 `lowSince`**，`shrinkProbeDelay` 得 `remaining ≤ 0` ⇒ 返回 `0` ⇒ `setTimeout(..., 1ms)` 触发回调、回调内再次排探针 ⇒ **1ms 自激循环**（CPU 空转 + 反复调 `scrollToBottomImmediate`），直到会话切换或卸载才 clear。属边界健壮性（需 `raw` 恰落 0/空内容帧） | 给探针加**变更检测或有界重试**（例如仅当 `lowSince` 与上轮不同、或 `raw > 0` 时才续排），**不动「怎么收」** |
| 2 | 💡 建议 | `scroll-watermark.ts:176-177` | `resolveReclaimPlan` 对非有限 `clientHeight` 无兜底：`Math.max(0, NaN) === NaN` ⇒ 会写出 `scrollTop = NaN` | 加 `Number.isFinite` 守卫兜 0 |
| 3 | 💡 建议 | `useMessageListScroll.ts:244-250` 与 `:746-751` | 同一四行序列（`observeFloor` + `scheduleShrinkProbe`）重复两次 | 抽 `observeStreamingFloor()` 局部函数 |
| 4 | 💡 建议 | `useMessageListScroll.ts:340` | `scrollToBottomImmediateRef.current = …` 在 **render 期**赋值 | React 惯例更偏 `useLayoutEffect`；可保留（幂等、无副作用） |
| 5 | 💡 建议（docs） | `requirements/S-176.md:33-40` | §二「现状机制」仍以**实施前行号**描述、且仍写**已删除**的 `trackContentBottom`（plan 有「实施前快照」免责，需求正文没有） | 标注「实施前快照」或回填当前符号名 |
| 6 | ⚠️ **真机盯**（出自 review_report §四） | `useMessageListScroll.ts` 下界回落 + `syncBottomState` | **下界现在会降** ⇒ 用户上滚阅读时 `realContentBottomRef` 可能被压低 ⇒ `syncBottomState` 理论上可把 `autoScrollModeRef` 从 `'off'` 抬回 `'stream'`，**把人拽回底** —— 正对验收 ⑤（手动上滚不被拽）。属**未证伪的可疑路径**，只能真机判定 | 真机跑 ⑤ 时重点盯：上滚阅读数秒后是否被拽回底 |
| 7 | ℹ️ 知晓 | `observeFloor` 亚阈值分支 | 亚阈值偏低会**清空 `lowSince`** ⇒ 内容在 ε 边界反复横跳时确认攒不满，退化为「留白不收」（**方向安全**，不会跳） | 无需动作，记录备查 |

---

## 七、结论

| 项 | 结果 |
|---|---|
| 编译 | ✅ 0 错 / 0 警 |
| 回归 | ✅ `npm test` 67/67；`test:scroll-watermark` **88 checks**；相邻套件 25 checks |
| 顺序契约（与 iter-30 的分野） | ✅ 纯函数 + 机器断言双重保险，代码里未走回老路 |
| 用户上滚不抢位置 | ✅ 早退先于回收分支与水位线压制 |
| 真机验收（2026-10-09 11:13） | ⚠️ **主目标达成**（视口完全正常、留白不可见）；残留「流式期高度不回收 / 越拉越长 / 结束时才回收」待老大定夺 |
| 参数标定 | ❌ 未做（三值仍为建议初值） |
| 阶段五 ⚠️ 项 | 1 条（探针 1ms 自激，边界场景，建议随收尾刀处置） |

**最终判定：PARTIAL**（工程侧全绿；本需求的成败在真机手感，验收门未闭合）。

> 说明：本报告为 2026-10-09 老大指令「按开发工作流推进」的**事后补验**产物。
