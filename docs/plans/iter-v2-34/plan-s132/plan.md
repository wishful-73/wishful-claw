# Plan: iter-v2-34 S-132 —— 彻底去掉子代理轮次上限

> 2026-09-22 建。需求口径权威源 = 同目录 `../raw-requirements.md` 的 `### S-132`，本文件只排步骤与文件面，不重复取证。
> 立项缘由：老大 2026-09-22 原话「我再说一次我不希望因为轮次上限卡死，需要去掉轮次上限，这是一个需求」，随后拍定方案 **B（治本）**。
> 与 `plan-b2.md`（S-107 / S-108 / S-109 / S-115）**互不依赖**，可独立实施、独立成刀。
> **阶段三验证：PASS（❌ 0 / ⚠️ 2，两条建议均已采纳并回写本文件）** —— 见同目录 `compliance_report.md`。

## 目标

**产品层不再拿 `maxTurns` 当硬截断依据**：任何真子代理 run 一律不限轮次，`maxTurns` 降级为「轮次提醒点」。同时堵掉「撞上限即被截断、状态却报 `completed`、产出全丢」这条可见性缺口。

## 不变量（★ 本计划最容易踩的坑）

`maxIterations` **不是**「子代理轮次上限」的同义词 —— 侧边栏 / 辅助请求正用 `maxIterations: 1` 表达 **「只发一轮、不调工具」**。无脑抹掉它会顺手炸掉生成标题、记忆整合、翻译、记忆自动化。

| 调用方 | 值 | 语义 |
|---|:--:|---|
| `lib/ipc/agent-bridge-streaming.ts:84` | `1` | providerTurn 单轮 |
| `runSidecarTextRequest`（`args.maxIterations ?? 1`） | `1` | 单轮 |
| `lib/.../generate-title.ts:249` | `1` | 单轮 |
| `memory-automation-*` | `1` | 单轮 |
| `translate-agent-service.ts:242`（`MAX_ITERATIONS`） | `12` | 翻译 |

⇒ **判据必须是「这是不是一个真子代理 run」（`sessionMode ∈ {subAgent, goalSubAgent}`），不是「有没有传 `maxIterations`」。**

## 现状（阶段一补探产出）

四层根因，已逐层查实：

| 层 | 事实 | 文件 |
|:--:|---|---|
| 1 定义层**已**放开 | `private const int DefaultMaxTurns = 0; // 0 = 不限轮次`（iter-31 S-53 改的） | `SubAgentDefinition.cs:42` |
| 2 解析层仍读显式值 | `maxTurns ?? maxIterations ?? DefaultMaxTurns` | `SubAgentDefinition.cs:108` |
| 3 执行层**仍把它当硬上限送进去** | `writer.WriteNumber("maxIterations", definition.MaxTurns)` | `SubAgentExecutor.Parameters.cs:68` |
| 4 运行层见 `> 0` 即设硬上限 | `hasIterationLimit = requestedMaxIterations > 0`；循环条件 `!hasIterationLimit \|\| iteration <= requestedMaxIterations` | `AgentLoop.cs:250` / `:266` |

**机器上定义目录新旧混杂**（`C:\Users\龚翼\.wishful-claw\agents\` 17 份）：其余 15 份 `maxIterations: 0`，**`reviewer.md = maxTurns: 8`、`researcher.md = maxTurns: 10`** ⇒ 实测「调 `reviewer` 正好 8 轮」与此吻合。**产品层改完后这两份 md 无需改动即自动失效**（A 方案的治标点被顺带解决）。

**为什么 1 层改完仍没用**：`DefaultMaxTurns = 0` 只在定义**没写**该字段时生效；只要 md 里显式写了 `maxTurns: 8`，第 3 层照样把它送进 `maxIterations`。⇒ 收口必须在 **第 3 层**，并以 **第 4 层**兜底。

## 改法（方案 B）

### 改动点 1（主收口）：`src/runtime/WishfulClaw.Agent/SubAgentExecutor.Parameters.cs`

**1a.** `BuildChildParameters` 的拷贝 skip 列表（`:56-63`）增加 `maxIterations`：

```csharp
if (prop.NameEquals("messages") ||
    prop.NameEquals("personaId") ||
    prop.NameEquals("userRules") ||
    prop.NameEquals("providerTurnOnly") ||
    prop.NameEquals("runtimeRole") ||
    prop.NameEquals("maxIterations"))   // ← 新增：下面统一恒写 0
{
    continue;
}
```

> 顺带修一个既有缺陷：父参数若带 `maxIterations`，原先会**先被拷贝一次**、再被 `:68` 覆盖写一次 ⇒ 输出 JSON 出现**重复键**（解析取最后一个，行为恰好对，但产物不合法）。加进 skip 列表后只写一次。

**1b.** `:67-68` 改为恒写 0：

```csharp
// ⚠️ 恒写 0 = 不限轮次（iter-34 S-132）。definition.MaxTurns 已降级为「轮次提醒点」，
// 不再作为硬截断依据 —— 它曾在这里直接送进 maxIterations，撞上限即被掐断且状态仍报
// completed，产出全丢。防跑飞由轮次提醒（AgentLoop.SubAgentReminder）与父 run 的
// 取消令牌承担，与 goalSubAgent 一路（GoalSubAgentExecutor.cs:107）保持一致。
writer.WriteNumber("maxIterations", 0);
```

### 改动点 2（运行层兜底）：`src/runtime/WishfulClaw.Agent/AgentLoop.cs`

`:249-250` 把子代理 run 排除在硬上限之外：

```csharp
var requestedMaxIterations = JsonHelpers.GetInt(parameters, "maxIterations", 0); // 0 = unlimited
// S-132：真子代理 run 不接受轮次上限。判据在此自算，不复用 :59-60 的变量 ——
// 那对变量读的是归一化（:171）之前的参数且用 StringComparison.Ordinal，等于依赖
// 「调用方写对大小写」这个隐式约定。sidecar 单轮语义不受影响。
var isSubAgentRun =
    sessionModeForConv.Equals("subAgent", StringComparison.OrdinalIgnoreCase) ||
    sessionModeForConv.Equals("goalSubAgent", StringComparison.OrdinalIgnoreCase);
var hasIterationLimit = requestedMaxIterations > 0 && !isSubAgentRun;
```

- `sessionModeForConv` 定义于 `:58`，早于本行 ⇒ 可直接引用。
- **为什么不复用 `isSubAgentLoop` / `isGoalSubAgentLoop`**（阶段三 ⚠️1）：那对变量在 `:59-60` 算，而参数归一化在 `:171` ⇒ 它们用的是**归一化前**的值，且比较用 `Ordinal`（大小写敏感）。实测当前两处子代理入口都写正确大小写，无现实风险，但属隐式约定；内联自算把它显式化，且**不触碰 `:59-60`**（避免改变 `conversationKey` 行为）。
- `:266` 循环条件与 `:263` 日志都依赖 `hasIterationLimit`，**无需再改**，日志会自动打 `maxIterations=unlimited`。
- 这道兜底的意义：即使将来又有新入口绕过 `BuildChildParameters` 写出正的 `maxIterations`，子代理 run 也不会再被截断。

### 改动点 3（前端配套）：`src/renderer/src/lib/agent/sub-agents/limits.ts`

`DEFAULT_SUB_AGENT_MAX_TURNS = 12` → `0`，消除「默认 12 轮」这个隐性契约。

- **实测无运行消费**：全域 `renderer/src` 内 `maxTurns` 仅出现于 `catalog.ts` / `limits.ts` / `types.ts`（元数据透传），且 `catalog.ts` **无任何 import**（疑似死代码）；`session-slice.ts` 的 `maxTurns` 是消息切片同名局部参数，与本需求无关。
- 保留 `resolveSubAgentMaxTurns` 对**显式值**的透传，提醒点信息不丢。
- 执行前二次确认 `catalog.ts` 无 barrel 导出消费；若有消费，改为仅影响展示文案，不影响行为。

### 明确不动（防扩大范围）

| 项 | 为什么不改 |
|---|---|
| 侧边栏 / 辅助请求的 `maxIterations: 1`、`translate` 的 `12` | 有意语义，见「不变量」 |
| `SubAgentDefinition.cs:108` 解析层**继续读**显式 `maxTurns` | 降级为**提醒点**后仍要读得到；改它会让 `definition.MaxTurns` 恒 0，提醒失效 |
| 已有的 `maxTurns: 8` / `maxIterations: 7` 解析断言 | 解析行为未变，断言应继续通过（改不动它才是回归） |
| 用户机器上的 `reviewer.md` / `researcher.md` | 产品层改完自动失效，**不碰用户文件**（A 方案治标点顺带解决） |
| `GoalSubAgentExecutor.cs:107` | 已恒写 0，无需改 |

## 单文件 500 行红线核查

行数为 2026-09-22 实测（`Get-Content \| Measure-Object -Line`）：

| 文件 | 实测行数 | 判定 |
|---|:--:|---|
| `SubAgentExecutor.Parameters.cs` | 145 | 在线内，本刀 +1 行 |
| `AgentLoop.cs` | 635 | **已超线**（改动前即超）；`partial class`，已分片（`AgentLoop.SubAgentReminder.cs` 等）⇒ 本刀仅改 2 行，**不做拆分**（拆分与「一个需求一刀」冲突） |
| `SubAgentDefinition.cs` | 166 | 在线内，本刀不动 |
| `limits.ts` | 13 | 在线内，本刀改 1 行 |
| `catalog.ts` / `types.ts` | 121 / 192 | 在线内，本刀不动 |

## 步骤清单

| # | 步骤 | 落点 |
|:--:|---|---|
| 1 | skip 列表加 `maxIterations` + 恒写 0 + 注释 | `SubAgentExecutor.Parameters.cs:56-68` |
| 2 | `hasIterationLimit` 排除子代理 run | `AgentLoop.cs:249-250` |
| 3 | `DEFAULT_SUB_AGENT_MAX_TURNS` → 0 | `limits.ts:8` |
| 4 | `BuildChildParameters` `private` → `internal`（供回归测试） | `SubAgentExecutor.Parameters.cs:39` |
| 5 | 新增回归断言：组装后 `maxIterations == 0`，且定义显式写 `maxTurns: 8` 也不例外 | `tests/WishfulClaw.GoalRegressionTests/Program.SubAgentReminder.cs`（新节，既有断言不动） |
| 6 | 关 dev 实例 → 编译两 sln → 跑 C# 测试；**真机各触发一次生成标题与记忆整合**（⚠️2 回归） | — |
| 7 | `npm run typecheck` + `npm test` | — |
| 8 | 真机：用 `reviewer`（md 里 `maxTurns: 8`）跑一个需 > 8 轮的任务，确认不再第 8 轮被掐 | 老大 |
| 9 | **提交（本需求一刀）** | — |
| 10 | 迭代进度记录 | `docs/progress/v2-iter-34.md` |

## 涉及文件

| 文件 | 动作 |
|---|---|
| `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Parameters.cs` | 改（步骤 1 + 4） |
| `src/runtime/WishfulClaw.Agent/AgentLoop.cs` | 改（步骤 2） |
| `src/renderer/src/lib/agent/sub-agents/limits.ts` | 改（步骤 3） |
| `tests/WishfulClaw.GoalRegressionTests/Program.SubAgentReminder.cs` | 新增断言（步骤 5） |
| `docs/progress/v2-iter-34.md` | 记录（步骤 10，非代码） |
| `docs/plans/iter-v2-34/raw-requirements.md` | 只读（口径源，不单独成刀） |

## 验证方式

- `npm run typecheck` → `EXIT=0`
- C# 两 sln 编译 → **0 错 0 警**
- `npm test` → 45/45 + 新增断言通过
- **回归重点**：生成标题 / 记忆整合 / 翻译仍正常（证明 sidecar 的 `maxIterations: 1` 未被误伤）
- **真机断言**：`reviewer` 不再停在第 8 轮，且报告里出现轮次提醒而非静默截断

## 风险与回退

| # | 风险 | 对策 |
|:--:|---|---|
| R1 | 误伤侧边栏单轮语义 | 判据绑定 `isSubAgentLoop \|\| isGoalSubAgentLoop`，不绑「有没有传」；回归跑标题生成 |
| R2 | 子代理跑飞（无上限） | 轮次提醒（`AgentLoop.SubAgentReminder`）+ 父 run 取消令牌 + 用户手动停止 —— iter-31 S-53 既有设计，本刀不引入新机制 |
| R3 | 老机器 md 里的 `maxTurns` 意外生效 | 第 3 层恒写 0 ⇒ 自动失效，**无需改用户文件** |
| R4 | 前端 `catalog.ts` 若被消费 | 步骤 3 执行前二次确认；有消费则仅降级为展示值 |

**回退**：单刀 `git revert`，无跨刀耦合。

## 提交节奏

- **本需求独立一刀**（「一个需求一刀」）。改动面 3 个源文件 + 1 个测试文件，不掺其他需求。
- **不推送** —— 迭代内只 commit，遵守「收尾推一次」。

## 参考源码

- `src/runtime/WishfulClaw.Agent/SubAgentDefinition.cs:42` / `:108` / `:132` / `:139`
- `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Parameters.cs:39-68`
- `src/runtime/WishfulClaw.Agent/AgentLoop.cs:59-64` / `:249-266`
- `src/runtime/WishfulClaw.Agent/Goal/GoalSubAgentExecutor.cs:101-108`
- `src/runtime/WishfulClaw.Agent/AgentLoop.SubAgentReminder.cs`
- `tests/WishfulClaw.GoalRegressionTests/Program.SubAgentReminder.cs`
- `docs/progress/v2-iter-31.md:49-53`（S-53 口径「上限只是提醒作用，其实是无限」）
- `src/renderer/src/lib/agent/sub-agents/limits.ts` / `catalog.ts` / `types.ts`
