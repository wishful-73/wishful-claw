# 验证报告：plan-s180（阶段六 · 验证态）

> 被验证对象：`docs/plans/iter-v2-38/plan-s180/plan.md`（+ 需求正文 `requirements/S-180.md`）
> 落地形态：工作区未提交改动 —— **2 个源码文件**（`TaskTool.cs` `4+/2-`、`SubAgentExecutor.Background.cs` `5+/2-`）+ 文档
> 验证方式：独立跑门禁（typecheck + C# 编译 + 全量回归）；改动面逐行实读核对；真机部分标 PARTIAL
> 前置：阶段五 `review_report.md` = **❌ 0 / ⚠️ 0 / ℹ️ 5**（无 ❌、无需本刀修的 ⚠️ ⇒ 放行进验证态）
> 验证时间：2026-10-09
> **真机复验待老大**（plan §五 步骤 4）⇒ 本轮结论为 **PARTIAL**。

---

## 一、总体结论

**PARTIAL** —— 编译与回归**全绿**（`npm run typecheck` 0 错 / `dotnet build` 0 错 0 警 / `npm test` **67/67** 退出码 0），三处文本改动**逐行实读成立**、JSON schema 重建解析**有效**；但本需求**唯一的验收判据是模型行为**（主 Agent 派完后台子 Agent 后是否还会自己 `sleep` / 长 `timeout` 空转），**只能真机观察** ⇒ 未闭环。

> 与 S-179 的**关键差别**：S-179 的验收对象是 DOM 观感，可由老大一眼确认；本刀的验收对象是**模型的决策倾向**，**既无自动化断言可写，也没有稳定的单次复现手法** —— 属"改了之后应当不再发生"的概率性改善，不是二值开关。

---

## 二、编译证据

| # | 命令 | 退出码 | 关键输出 |
|---|---|---|---|
| 1 | `npm run typecheck`（`typecheck:node` + `typecheck:web` 两配置） | **0** | 0 错 |
| 2 | `dotnet build src/runtime/WishfulClaw.sln` | **0** | `已成功生成。0 个警告 0 个错误` |

> **首次 `dotnet build` 失败（非代码错）**：`error MSB3021` / `MSB3027`，文件被 `WishfulClaw.Worker (14556)` 锁定，**一个 `CS####` 都没有**。按 `docs/dev-workflow.md`「编译环境」节处置 —— 以 `ExecutablePath -like '*\bin\Debug\*'` 过滤，**只关 dev 实例**（`src\runtime\WishfulClaw.Worker\bin\Debug\net11.0\`），打包版（`C:\Program Files\WishfulClaw\...`）**未碰**；关后重编 **0 错 0 警**。

---

## 三、测试证据

### 3.1 总门禁

```
npm test  →  67/67 通过      （ES 51 + C# 16）  退出码 0
```

### 3.2 本需求专项覆盖

**无独立套件，也无新增断言**，且**套件数不变（仍 67）** —— 本刀只改**面向模型的文本**，不改任何行为逻辑。

现有测试基建**不可能覆盖**本需求：验收判据是「模型读到文本后会不会改变行为」，既非渲染端 DOM、也非可单测的纯函数。故验证以**编译 + 回归不破 + 逐行实读 + schema 重建解析**为准，**真机行为**为最终判据。

> **缺口已写明，不虚构断言** —— 与 S-179 同一处理方式（S-179 缺渲染端滚动断言，本刀缺模型行为断言）。

---

## 四、改动面核对（实读，非推断）

| # | 位置 | 内容 | 核对 |
|---|---|---|---|
| ①（甲） | `TaskTool.cs:77` | `- Set background=true to run without blocking. Do NOT block, sleep, or poll for a background sub-agent — when it finishes, its report is delivered to you automatically.` | **原 `:77` 一行拆为两行**；原反向引导 `check progress with SubAgentStatus/SubAgentDetail` 已从本行移除 |
| ②（甲） | `TaskTool.cs:78` | `- Use SubAgentStatus/SubAgentDetail only for a deliberate mid-flight progress check, never as a way to wait for completion.` | 新增行；把「查进度」明确降级为「主动要查才查」，**与 ① 顺序即引导** |
| ③（甲） | `TaskTool.cs:112` | `"description": "If true, … returns a sub-agent ID immediately. Do NOT block, sleep, or poll for it — its report is delivered to you automatically when it finishes (use SubAgentStatus only for a deliberate mid-flight check). If false (default), waits for completion."` | 单行替换；处于 `$$"""…"""` raw string 内，**无内嵌 `"`、无 `{{`/`}}`** ⇒ 不触碰 `:105` 的 `{{enumItems}}` 插值 |
| ④（丙） | `Background.cs:208` | `The sub-agent is running in the background. Do not block, sleep, or poll for it.` | 原「You can continue working」被替换为明确的「不要阻塞」 |
| ⑤（丙） | `Background.cs:209` | `Continue with other work, or end your turn — when it finishes, its report is delivered to you automatically as a new message.` | **原「Use SubAgentStatus to check its progress」整句删除**（这句是「自己死等」的诱导源之一）；措辞为「继续干别的**或**结束回合」，**未写死「立即结束」** |
| ⑥（丙） | `Background.cs:210` | `Call SubAgentStatus only if you deliberately want a mid-flight progress check.` | 新增行；与 ② / ③ 口径一致 |

- `git diff --numstat -- src/` ⇒ `4  2  src/runtime/WishfulClaw.Agent/Tools/TaskTool.cs` + `5  2  src/runtime/WishfulClaw.Agent/SubAgentExecutor.Background.cs`（**唯一源码改动面，共 2 文件**）。
- 插值占位符 `{toolCallId}` / `{definition.Name}` / `{description}` **均在**（`Background.cs:205-207`）；`placeholder` 变量类型与 `ToolResult` 构造**未变**（`:212`）。
- 无新增依赖、无新增 `using`、无硬编码路径与密钥、无跨层改动。

### 4.1 三处文本口径一致性（本刀核心）

| 落点 | 「不要等」 | 「完成会自动送达」 | 「查进度」的正确用法 |
|---|---|---|---|
| 甲① `TaskTool.cs:77` | ✅ Do NOT block, sleep, or poll | ✅ delivered to you automatically | —— |
| 甲② `TaskTool.cs:78` | ✅ never as a way to wait | —— | ✅ only for a deliberate mid-flight check |
| 甲③ `TaskTool.cs:112` | ✅ Do NOT block, sleep, or poll | ✅ delivered to you automatically | ✅ only for a deliberate mid-flight check |
| 丙 `Background.cs:208` | ✅ Do not block, sleep, or poll | —— | —— |
| 丙 `Background.cs:209` | ✅（`or end your turn`） | ✅ as a new message | —— |
| 丙 `Background.cs:210` | —— | —— | ✅ only if you deliberately want a mid-flight check |

⇒ **三处全部含「不要等」+「会自动送达」，无一处残留无对冲的轮询引导**（这正是丙必须**整段改写**而非追加一句的原因：原 `:209` 前半句就是引导）。

---

## 五、阶段五审查结论的处置

阶段五 = **❌ 0 / ⚠️ 0 / ℹ️ 5** ⇒ **无阻断项、无需本刀修的 ⚠️**，故本刀**未因审查产生任何代码改动**。

ℹ️ 5 条的处置（均判定**本刀不动**）：

| ℹ️ | 内容 | 处置 |
|---|---|---|
| ℹ️1 | 乙（`PromptBuilder.cs`）为已裁定的**主动排除**，非疏漏 | 保留为残留缺口 —— **若真机复验仍复现，作首选补点**（写进 §七） |
| ℹ️2 | 渲染端镜像 `create-tool.ts` 的 `TASK_DESCRIPTION` **确不发给模型**（`execute` 只返 `nativeOnlyTaskResult()`） | 非模型面，**不改** |
| ℹ️3 | `SubAgentStatusTool` / `SubAgentDetail` 描述为中性功能说明、不教唆轮询 | 无需加对冲，**不改** |
| ℹ️4 | `Do NOT` 与 `Do not` 风格微差（甲用前者、丙用后者） | 纯风格，**不改** |
| ℹ️5 | 步骤 4 真机复验未决 | 属本报告 §六 范畴 |

---

## 六、真机部分（PARTIAL）

| # | 项 | 状态 |
|---|---|---|
| 1 | 派一个 `background=true` 的子 Agent ⇒ **主 Agent 结束回合**（不再 `sleep` / 长 `timeout` 等它） | ⏳ **待老大真机** |
| 2 | 子 Agent 完成后，报告**自动以新消息送达**并重开主 run（链路本就如此，本刀未动） | ⏳ **待老大真机** |
| 3 | 主 Agent 若确有别的活，**继续干别的**而不被本刀文案误导去结束回合 | ⏳ **待老大真机**（对应 ⑤ 的措辞取舍） |

> **验证手法建议**：随便派一个 `background=true` 的子 Agent，**观察主 Agent 这一轮是否还出现 `Start-Sleep` / 长 `timeout` 之类的挂起调用**。本刀改前，主 Agent 在同一场景下确实会这么做（2026-10-09 14:00 前实测——派后台勘测子 agent 后自行 `Start-Sleep -Seconds 150` 等待）。
>
> **若当场无法稳定复现**（如 S-177 的处境）：按工作流标 `blocked`、转**实机长期观察**，本报告维持 PARTIAL。

---

## 七、结论

- **可提交**：编译 + 回归全绿（`typecheck` 0 错 / `dotnet build` 0 错 0 警 / `npm test` 67/67），三处改动逐行实读成立、schema 合法、口径一致、零测试引用、零行为逻辑改动。
- **未闭环项**：§六 三项真机观察（本需求唯一验收判据）⇒ **PARTIAL**；**残留缺口** = 乙未做（若真机仍复现，首选补 `PromptBuilder.cs` `<tool_calling>`）。
- **本刀不写自动化断言**，理由见 §三.2（缺口已写明，非疏漏）。
- **提交口径**：按「一需求一刀」提交 —— 本刀带 `TaskTool.cs` + `SubAgentExecutor.Background.cs` + `requirements/S-180.md` + `plan-s180/plan.md`；`compliance_report.md` / `review_report.md` / `verification_report.md` 与迭代级文档（`plan.md` / `raw-requirements.md` / `changelog.md` / `dev-workflow.md` 等）一并**攒进收尾刀**。
