# S-202 审查报告（阶段五）

> 审查人：**独立 subagent**（`code-reviewer`，43 次工具调用）。
> 审查对象：提交 **`8ffd38b4`**（`fix(agent): 主动取消不再按「出错」收尾`，1 文件 / +10 行）。
> 规划依据：[`../requirements/S-202.md`](../requirements/S-202.md)（§三 修法 / §四 验收判据 / §五 非目标 / §七 爆炸半径）。
> 审查方式：**只读**（`git show` / `Read` / `Grep`），未改任何文件、未提交、未跑门禁。
> 出报告：2026-10-14。
> **结论：`PASS`（无阻断项）** —— 主运行面修法正确且完整；发现 **1 处注释引用错号（已修）** + **5 处同类点落在其它表面（待裁定是否扩面）**。

---

## 摘要

现象（用户主动取消却渲染出错误卡片）的**根因判断与修法均属实且生效**：`AgentRuntimeTools.cs:287` 确为「只 catch 标准取消异常」，其余类型落 `catch (Exception)` 发 `error` 事件 + 按 `error` 收尾；新增的 `catch (Exception ex) when (state.IsCancellationRequested)` 判据取**取消意图**而非异常类型，与需求 §三 逐字一致。回归护栏干净（过滤器保证 `IsCancellationRequested == false` 时行为一字不变），catch 子句顺序合法不抢道，非目标守住（单文件 +10 行）。

触发链路经全链路核实**确实能命中新分支**：UI 停止按钮与 PM `stop_session_run` 都走 `cancelStream` → `agent/cancel` → `AgentRuntimeTools.Cancel` → `state.Cancel("user")` → `_cancellation.Cancel()`；**没有走 `RequestStop`**（那个只置 flag、不 cancel token，若走它则新分支不会被命中）。

---

## 一、❌ 必须修

**无。**

## 二、⚠️ 建议

### 2.1 注释引用错号（**已在本轮修掉**）

`AgentRuntimeTools.cs:296` 原文写 `…这里按 aborted 收尾（S-204）。` —— **本需求编号是 S-202**，`requirements/` 下**不存在 S-204.md**（那是早前自造、未登记的编号）。提交信息与需求正文都写 S-202，仅注释不一致。

⇒ **处置**：改为 `（S-202）`，随收尾刀提交。

### 2.2~2.6 同类点：其它表面仍把「取消」当「出错」（**5 处，待裁定是否扩面**）

| # | 位置 | 形状 | 影响面 |
|---|---|---|---|
| 2 | `SubAgentExecutor.cs:272-284` | `catch (OCE) when (childState.IsCancellationRequested)` → 紧接 `catch (Exception ex)` 写 `Sub-agent failed: …` + `success=false` | 子 agent 卡片文案 / `sub_agent_end` 的 success 字段（注册表由 `:307` 事后纠正为 cancelled，但**输出与事件未对齐**） |
| 3 | `SubAgentExecutor.Background.cs:138-157` | 同形状 | 后台子 agent：取消时抛非 OCE ⇒ `BackgroundSubAgentRegistry.Fail(...)` 而非 `Cancel` |
| 4 | `GoalOrchestratorOwnedRun.cs:100-113` | `catch (OCE)` → `GoalAborted`；紧接 `catch (Exception ex)` → `GoalFailed` | goal 状态 / 事件表面 |
| 5 | `AgentLoop.ContextCompression.cs:199-222` | `catch (OCE) when (…)` → 发 `context_compressed "cancelled"`；紧接 `catch (Exception ex)` → 发 `"failed"` | 压缩卡片显示「失败」而非「已取消」 |
| 6 | `GoalSubAgentExecutor.cs:58-66` | `catch (Exception ex)` 无条件 `WorkerLog.Warn("goal sub-agent turn failed …")` 后 `throw` | **仅日志误标**（异常仍上抛，最终由 #4 归类） |

**说明**：#2~#6 **都不产生主会话错误卡片**，不违反 S-202 的验收判据，也不在 §七「爆炸半径 1 文件」内 ⇒ **不阻断本刀**。它们是「判据是取消意图」这条一般原则在其它表面的同类缺口，**是否另开一条扩面，等老大裁定**。

---

## 三、✅ 已核对无碍

| 项 | 核实方式 |
|---|---|
| **口径一致性** | 新增分支判据 `state.IsCancellationRequested`（`AgentRuntimeRunState.cs:92`）与 `CancellationToken`（`:32`）**同源同一个 `_cancellation`** ⇒ 无「flag 与 token 不同步」隐患 |
| **根因行号属实** | `AgentRuntimeTools.cs:287` 逐字核对，与 §二 引用一致 |
| **唯一 error 事件发射点** | 全仓搜 `new AgentRuntimeStreamEvent("error"…)` ⇒ **只有 `:309` 一处**（渲染端错误卡片的唯一来源） |
| **AgentLoop 内部不会误发** | `AgentLoop.cs:364-370` / `:407-410` 两处 catch 均带 `when (ex is not OperationCanceledException …)` 守卫 |
| **Provider 层已带取消守卫** | `OpenAIChatProvider.cs:92` 的 `catch (HttpRequestException) when (!state.CancellationToken.IsCancellationRequested …)` |
| **回归护栏** | 过滤器在 `IsCancellationRequested == false` 时求值为假 ⇒ 落原 `catch (Exception ex)`，行为一字不变 |
| **catch 顺序合法** | `OCE+filter`（派生）→ `Exception+filter`（基类）→ `Exception`（基类）；带 `when` 的子句不触发 CS0160；`when` 按出现顺序求值，OCE 且取消中必被第一条吃掉 |
| **日志不泄密** | 新增分支用 `FormatExceptionSummary` → `SanitizeExceptionMessage`（`AgentRuntimeTools.cs:423`），已对 Bearer / api_key / token 脱敏 |
| **非目标守住** | `git show --stat` = 1 文件 / +10 行；未动 `cancelStream` / abort 传播（§五.1）、未动渲染层 `case 'error'`（§五.2） |

---

## 四、处置与提交

| 项 | 处置 |
|---|---|
| ⚠️ 2.1 注释错号 | **已修**（`S-204` → `S-202`），随收尾刀提交 |
| ⚠️ 2.2~2.6 同类点 | **不修**，登记为待裁定项（是否另开一条扩面） |
| 阶段六验证 | 见迭代级 [`../verification_report.md`](../verification_report.md) 收尾节（编译 + 测试 + 老大真机「测试通过」） |
