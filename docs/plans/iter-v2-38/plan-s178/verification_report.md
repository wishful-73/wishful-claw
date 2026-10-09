# 验证报告：plan-s178（阶段六 · 验证态）

> 被验证对象：`docs/plans/iter-v2-38/plan-s178/plan.md`（+ 需求正文 `requirements/S-178.md`）
> 落地形态：工作区未提交改动 —— 5 个源码文件（4 C#/TS 行为改动 + 1 测试）+ 文档
> 验证方式：独立跑门禁（编译 + 全量回归）；三层链路逐段实读核对；真机部分标 PARTIAL
> 前置：阶段五 `review_report.md` = **❌ 0 / ⚠️ 3 / ℹ️ 5**（已放行进验证态）
> 验证时间：2026-10-09
> **真机复验补记（2026-10-09 13:45）**：老大确认「178和179都测试通过了」⇒ §六 三项真机项**全部闭环**，本报告结论由 **PARTIAL 升为 PASS**。

---

## 一、总体结论

**PASS** —— 编译与回归**全绿**（`typecheck` 0 错 / `dotnet build` 0 错 0 警 / `npm test` **67/67** 退出码 0），三层链路（`limiter.onQueued` → 执行器 queued/start/dequeued → 渲染端两 case）**逐段实读成立**；阶段五 3 条 ⚠️ 已处置（2 修 + 1 写明缺口）；「并发上限 2、5 个 Task ⇒ 2 张工作中 + 3 张等待中、跑完自动转」的**真机闭环已由老大确认通过**（2026-10-09 13:45，plan §五 步骤 7）。

> 说明：验证时点本报告判 **PARTIAL**（真机未做）；真机通过后升级为 **PASS**，其余证据未变。

---

## 二、编译证据

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `npm run typecheck`（`typecheck:node` + `typecheck:web` 两配置） | **0** | 0 错 |
| 2 | `dotnet build src/runtime/WishfulClaw.sln` | **0** | `已成功生成。0 个警告 0 个错误` |

> 注：本轮修 ⚠️1 时首编译曾报 `CS0103: 当前上下文中不存在名称"WorkerLog"`（`SubAgentConcurrencyLimiter.cs:56`）—— limiter 原文件无 `using`，补 `using WishfulClaw.Core.Protocol;` 后复编译通过。属编译期即可发现的错误，未流出。

---

## 三、测试证据

### 3.1 总门禁

```
npm test  →  67/67 通过      （ES 51 + C# 16）  退出码 0
```

### 3.2 本需求专项覆盖

**无独立套件**；断言并入既有 C# `Goal` 套件（套件数不变，断言论 **331 → 335**）。新增/修订 5 条：

| # | 断言 | 内容 |
|---|---|---|
| 1 | 不排队零回调 | 容量有空位时 `onQueued` **一次都不调** |
| 2 | 恰好一次 | 真正入队者 `onQueued` **恰好一次** |
| 3 | 预取消零回调 | token 已取消者**入队前**返回（`Queued=false`）⇒ 不回调 |
| 4 | **顺序契约** | `AssertQueuedPrecedesLeaseAsync`：`onQueued` 完成**先于** lease 交付（本轮为落实 compliance ⚠️1 新增） |
| 5 | 全员释放 | `Assert(true, …)` **恒真断言改为 `AssertEqual(3, queuedOrder.Count, …)`**（审查 ℹ️1，消除假绿灯） |

> 第 1~4 条经阶段五独立推演「非恒真且不 flaky」（`onQueued` 与 `AcquireAsync` 首段同步执行，计数/顺序在 `await Task.Delay(25)` 前已定）。
> **缺口（审查 ⚠️2，已接受并写明）**：以上均为 **limiter 层**断言；**执行器层**的「queued 先于 start」**仅有结构保证**，无回归网 —— 见 plan §七.8 的「改此处必读」约定。

---

## 四、链路核对（实读，非推断）

| 层 | 位置 | 结论 |
|---|---|---|
| ① 闸门 | `SubAgentConcurrencyLimiter.cs` `AcquireWithFlag` | 「是否排队」判定与 `_queue.Enqueue` **同在 `lock (_sync)`**，无竞态窗口；`Pump`/`Release`/`Cancel`/`Remove` 未改动 ⇒ 并发语义逐行等价 |
| ② 通知 | 同文件 `AcquireAsync` | `onQueued` 在锁外、**先于** `await pending`；续体经 `RunContinuationsAsynchronously` ⇒ 不在锁内跑 IO |
| ③ 执行器 | `SubAgentExecutor.cs` `AcquireSubAgentSlotAsync` | 排队发 `queued`、lease 到手发 `start`、排队中被取消补发 `dequeued`；前台（`:258`）与后台（`Background.cs:53`）**同一 helper**；顶部无条件 `start` 已删 |
| ④ 适配 | `adapt-sub-agent-event.ts` | 补 `sub_agent_queued`（带 `input`）/ `sub_agent_dequeued` 两 case；全仓仅此一处取闸门，无遗漏执行点 |
| ⑤ 渲染 | `sub-agent-slice.ts` / `SubAgentCard.tsx` | 既有语义未动：queued 建卡、start 翻 running、dequeued 删卡，对错序/重复事件幂等 |

---

## 五、阶段五 3 条 ⚠️ 的处置

| ⚠️ | 内容 | 处置 |
|---|---|---|
| ⚠️1 | `onQueued` 抛异常 ⇒ waiter 已入队却无人 await，`Pump()` 仍发放**永不 Dispose 的 lease** ⇒ 容量永久缩水（当前调用方不可达） | **已修** —— `AcquireAsync` 内 `try/catch` 兜住并 `WorkerLog.Warn`；与「事件失败不反噬」的既有哲学一致，XML 注释同步写明契约 |
| ⚠️2 | 执行器层「queued 先于 start」无自动化回归网 | **取舍：不补断言，写明缺口** —— 补执行器级断言需给 `AgentLoop` 引入 provider stub（属独立测试基建，塞进本刀会让改动面膨胀）⇒ 落 plan §七.8 的「改此处必读」约定 |
| ⚠️3 | 排队卡可被持久化：`buildPersistedSubAgentSnapshot` 因 `isRunning=false` 早返回 ⇒ 排队窗口内异常结束后，历史里留一张**永远「Queued」**的死卡（本次新点亮的路径） | **已修** —— `sub-agent-utils.ts` 增 `isQueued` 分支：归一化为 `isQueued:false` + `completedAt` + `reportStatus` 兜底 `missing` |

ℹ️ 5 条：ℹ️1 已顺手改（见 3.2 第 5 条）；ℹ️3（`BackgroundSubAgentRegistry.Register` 在闸门前置 Running ⇒ 排队窗口内模型侧 `SubAgentStatus` 报 Running 而 UI 报 Queued）为**既有语义 + 本刀新观测面**，已落 plan §七.6 供真机留意；ℹ️2/ℹ️4/ℹ️5 记备案、无需动作。

---

## 六、真机部分（PARTIAL）

| 项 | 状态 |
|---|---|
| 并发上限 2，发 5 个 Task ⇒ 2 张「工作中」+ 3 张「等待中」 | ✅ **已通过**（老大 2026-10-09 13:45） |
| 第 1 个完成后等待卡陆续转「工作中」 | ✅ **已通过** |
| 附带留意 `SubAgentStatus` 是否出现「已注册但卡片未亮」错位（plan §七.6） | ✅ 真机未报告此错位 |

---

## 七、结论

- **可提交**：本刀编译 + 回归全绿，需求目标在代码路径上成立（并发上限 2、5 个 Task 时 2 跑 3 等、`Pump()`→lease→start 自动转态）。
- **未闭环项**：真机复验（步骤 7）⇒ **已闭环**（2026-10-09 13:45 老大确认通过）；仅余执行器层顺序无回归网（plan §七.8 已写明约定）。
- **提交口径**：按「一需求一刀」提交，文档（含本报告与 `review_report.md`）随该刀入库。
