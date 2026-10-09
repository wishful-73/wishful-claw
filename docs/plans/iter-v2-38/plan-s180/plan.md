# Plan-S180：主 Agent 死等后台子 Agent —— 补「不要等」规则（甲 + 丙）

> 归属 iter-v2-38。需求正文见 [`../requirements/S-180.md`](../requirements/S-180.md)。
> 状态：**实施中**（2026-10-09）。口径已定：**纳入 38**、**只做甲 + 丙**、**乙不做**（老大 2026-10-09 14:00 / 14:02）。
> 一句话：后台子 Agent 完成**会自动唤醒主会话**，但这条规则**没写在模型调用前能读到的地方** ⇒ 主 Agent 自己 `sleep` / 长 `timeout` 空转。

---

## 一、目标

让主 Agent 在 `background=true` 派完子 Agent 后**不要阻塞等待**：

- **甲**：`Task type` 工具的**描述与 schema**（模型**调用前**必读）补上「后台不要等、完成会自动送达」；
- **丙**：后台启动的**占位返回值文本**（模型**调用后**立刻读到）**整段改写** —— 现在这段自己打架（一句说「你可以继续干活」，一句教你「用 SubAgentStatus 去查进度」），把后者改成「收手、结束回合」。

**不动任何行为逻辑**，只改两处 C# 字符串。

---

## 二、现状（实读，行号为 2026-10-09 快照）

### 甲 ① —— `src/runtime/WishfulClaw.Agent/Tools/TaskTool.cs` `BuildDescription()`

```csharp
74  sb.AppendLine("Usage notes:");
75  sb.AppendLine("- Delegate complex tasks immediately; do simple 1-3 step tasks yourself.");
76  sb.AppendLine("- Sub-agents are stateless and do not see this conversation — write self-contained prompts with all needed context.");
77  sb.AppendLine("- Set background=true to run without blocking; check progress with SubAgentStatus/SubAgentDetail.");
```

⇒ `:77` **只教「去查进度」，把模型推向轮询**，全文无「不要等」。

### 甲 ② —— 同文件 `BuildSchema()` 的 `background` 参数

```csharp
108  "background": {
109    "type": "boolean",
110    "default": false,
111    "description": "If true, runs in the background and returns a sub-agent ID immediately; check progress with SubAgentStatus. If false (default), waits for completion."
112  }
```

⇒ 同样只有「立即返回」，没有「完成会自动通知」。

### 丙 —— `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs` 占位返回

```csharp
204  $"Background sub-agent started.\n" +
205  $"  ID: {toolCallId}\n" +
206  $"  Agent: {definition.Name}\n" +
207  $"  Description: {description}\n" +
208  $"The sub-agent is running in the background. You can continue working.\n" +
209  $"Use SubAgentStatus to check its progress. When it completes, you will be notified automatically.";
```

⇒ `:208`「你可以继续干活」（= 别等）与 `:209`「**用 SubAgentStatus 去查进度**」（= 去轮询）**互相抵消**；`:209` 后半句的「会通知你」压不住前半句的引导。

> **实测确认**：这段文本**全仓只此一处**（`.cs/.ts/.tsx/.mjs` 全树扫描），**无任何测试断言锁住它** ⇒ 改写零测试风险。

### 链路（规则真实存在，佐证「等是白等」）

`SubAgentExecutor.Background.cs` fire-and-forget → 完成时构造 `[Background Sub-Agent Completed]` 通知 → 先试注入父 run 队列，父 run 已 finalize 则**缓冲** → `emit sub_agent_end` → 渲染端 `use-background-subagent-wakeup.ts` 取回缓冲、**以一条新 user 消息重开主 run**。

⇒ 主 Agent 是**被新的一轮消息唤醒**的；同 run 内 `sleep` / 轮询**永远等不到任何东西**。

---

## 三、做法（甲 + 丙，只改字符串）

### 甲 ① `TaskTool.cs:74-77` —— 加一条、改一条

```csharp
sb.AppendLine("Usage notes:");
sb.AppendLine("- Delegate complex tasks immediately; do simple 1-3 step tasks yourself.");
sb.AppendLine("- Sub-agents are stateless and do not see this conversation — write self-contained prompts with all needed context.");
sb.AppendLine("- Set background=true to run without blocking. Do NOT block, sleep, or poll for a background sub-agent — when it finishes, its report is delivered to you automatically.");
sb.AppendLine("- Use SubAgentStatus/SubAgentDetail only for a deliberate mid-flight progress check, never as a way to wait for completion.");
```

（原 `:77` 一行拆为两行：**先「别等」，再「何时才该查」** —— 顺序本身就是引导。）

### 甲 ② `TaskTool.cs:111` —— `background` 参数描述

```json
"description": "If true, runs in the background and returns a sub-agent ID immediately. Do NOT block, sleep, or poll for it — its report is delivered to you automatically when it finishes (use SubAgentStatus only for a deliberate mid-flight check). If false (default), waits for completion."
```

### 丙 `Background.cs:208-209` —— 整段改写

```csharp
$"The sub-agent is running in the background. Do not block, sleep, or poll for it.\n" +
$"Continue with other work, or end your turn — when it finishes, its report is delivered to you automatically as a new message.\n" +
$"Call SubAgentStatus only if you deliberately want a mid-flight progress check.";
```

**三个必须守住的点**：

1. **不写死「end your turn」单一路径** —— 主 Agent 可能还有别的活；措辞是「继续干别的**或**结束回合」，不是「立刻结束」。
2. **把「查进度」明确降级为「主动要查才查」** —— 三处文本口径一致，不留对冲句。
3. **不动 `\n` 结构与字符串拼接形态** —— 只替换文本内容，`{toolCallId}` / `{definition.Name}` / `{description}` 插值原样保留。

---

## 四、步骤清单

- [ ] **步骤 1（甲）：`TaskTool.cs` 两处文本**
  - 改 `BuildDescription()` `:77` → 拆为「别等」+「何时才查」两行
  - 改 `BuildSchema()` `:111` `background` 描述
  - 验证检查点：`npm run typecheck` 0 错；`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警；`git diff` 只动这两处字符串，`{{enumItems}}` 插值与 JSON 结构未变
- [ ] **步骤 2（丙）：`SubAgentExecutor.Background.cs:208-209` 整段改写**
  - 验证检查点：`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警；插值占位符 `{toolCallId}` / `{definition.Name}` / `{description}` 仍在；`placeholder` 变量类型与 `ToolResult` 构造未变
- [ ] **步骤 3：整体门禁**
  - `npm run typecheck`（node + web）0 错 ＋ `dotnet build` 0 错 0 警 ＋ `npm test` **67/67**（本刀只改字符串，**套件数与断言论不变**）
  - 验证检查点：全绿 ⇒ 本刀测通，按「一需求一刀」提交
- [ ] **步骤 4：真机复验（老大侧）**
  - 派一个 `background=true` 的子 Agent，观察主 Agent **是否结束回合**而不是 `sleep` / 长 `timeout` 等它
  - 验证检查点：主 Agent 不再自己挂住；子 Agent 完成后报告**自动以新消息送达**
  - ⚠️ 若当场无法稳定复现（如 S-177），按工作流标 `blocked` + 转实机长期观察

---

## 五、涉及文件

| 文件 | 动作 |
|---|---|
| `src/runtime/WishfulClaw.Agent/Tools/TaskTool.cs` | 修改：`BuildDescription()` `:74-77` + `BuildSchema()` `:111`（**甲**） |
| `src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs` | 修改：占位返回文本 `:204-209` 的 `:208-209`（**丙**） |
| `docs/plans/iter-v2-38/requirements/S-180.md` | 回填：状态头 + 实施记录 |
| `docs/plans/iter-v2-38/plan-s180/` | 本计划 + `compliance_report.md` + `review_report.md` + `verification_report.md` |
| `docs/plans/iter-v2-38/plan.md`、`raw-requirements.md` | 回填状态（按纪律**攒进收尾刀**，不单独提交） |
| `docs/plans/iter-v2-38/changelog.md` | 追加本刀流水（同上，攒收尾刀） |

**不动**：

- `src/renderer/src/lib/agent/sub-agents/create-tool.ts` —— 渲染端镜像的 `Task` 描述**不发给模型**（`execute` 只返 `nativeOnlyTaskResult()`），**不是修点**；
- `src/runtime/WishfulClaw.Persona/PromptBuilder.cs` —— **乙**，老大明确不做；
- `src/runtime/WishfulClaw.Agent/Tools/SubAgentStatusTool.cs` —— 工具本身行为正确，不属本条；
- `src/runtime/WishfulClaw.Agent/ToolDispatchRouter.cs:44` —— 那是 **cron 非交互 run 的 ask-user 拦截**，与子 Agent 等待语义无关，**易改错的地方**。

**参考源码**：无 —— 本仓自有的提示词缺陷，不涉及 OpenCowork / KodaClaw / OpenClaw.net。

---

## 六、刻意不做（写死免得下一轮走回去）

1. **不做乙**（`PromptBuilder.cs` `<tool_calling>` 补规则） —— 老大 2026-10-09 14:00 明确「乙不处理」。
2. **不做丁**（改运行时 persona `AGENTS.md` / 设置 `userRules`） —— 属用户级自定义，不落产品默认；仅在需要临时验话术时用。
3. **不改任何行为逻辑** —— 不动 fire-and-forget、不动缓冲通知、不动唤醒链路、不动 `SubAgentStatus` 工具实现；只改三处**面向模型的文本**。
4. **不给 `SubAgentStatus` 加限制** —— 它本身是正确的工具，本刀只改「引导模型何时用它」的措辞。
5. **不引入新依赖**；不新建源码文件。

---

## 七、待老大确认

| # | 问题 | 状态 |
|---|---|---|
| 1 | 走甲 / 乙 / 甲+乙？ | **已定**：只做甲 + 丙（14:00 / 14:02） |
| 2 | 是否纳入 38？ | **已定**：纳入 38（14:02） |
| 3 | 丙是否有额外效果、做不做？ | **已定**：做 —— 丙的落点在**调用后的决策瞬间**，比 schema 描述更贴身；但现文本自相打架，**必须整段改写**才有意义 |
| 4 | 是否要真机复验？ | **建议做**（步骤 4）；若当场无法稳定复现，按工作流标 `blocked`、转实机长期观察 |
