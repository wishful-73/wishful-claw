# S-181 规划验证报告（阶段三：规划验证）

❌ 0 / ⚠️ 2 / ℹ️ 2（检查项 8 条）

> 被审计划：`docs/plans/iter-v2-38/plan-s181/plan.md`（2026-10-09，状态「实施中」）
> 需求正文：`docs/plans/iter-v2-38/requirements/S-181.md`
> 依据规范：`docs/dev-workflow.md`（阶段三 :397-418、测试怎么跑 :286-324）、`AGENTS.md`
> 审查方式：只读实读仓库当前代码（HEAD 工作区，分支 `dev/v2-iter-38`），所有行号/计数均为本次实测。
> 审查人：独立规划验证 agent（未参与计划撰写）

---

## 结论速览

| # | 检查项 | 结论 |
|---|---|---|
| 1 | 步骤清单覆盖「目标」，无遗漏环节 | ✅ |
| 2 | 每步带明确、可执行的验证检查点 | ✅（附 ℹ️ 一条改进建议） |
| 3 | 涉及文件路径符合项目结构 | ✅ |
| 4 | 分层依赖正确（Core 归属 / 测试只引 Core 是否可行） | ✅（附 ℹ️ 一条提示） |
| 5 | 行号与现状代码描述与仓库一致 | ⚠️（行号全对；调用点计数 41≠42，且计划内自相矛盾） |
| 6 | 「做法」与「测试用例表」自洽、边界覆盖 | ✅ |
| 7 | 「刻意不做」边界清晰、无回退风险 | ✅ |
| 8 | 两个文档的行尾与 BOM 规范 | ⚠️（BOM 正确；行尾为 LF，非 CRLF） |

**最终结论：❌ = 0 ⇒ 允许进入执行态。** 两项 ⚠️ 均为非阻断项（一条统计数字、一条行尾格式），建议执行前顺手更正（详见文末「行动项」）。

---

## 逐项展开

### 检查项 1：步骤清单是否完整覆盖「目标」 ✅

**目标**（plan §一）：让 `JsonHelpers.GetBool` 对字符串 `"true"` / `"false"`（含首尾空白、大小写不敏感）也能解析；不扩大范围；不改既有行为；一处修复覆盖全部调用点；不加调用侧校验。

**步骤清单**（plan §五，4 步）实测覆盖情况：

- 步骤 1（改 `JsonHelpers.cs`）↔ 目标前半（解析逻辑 + 不扩大范围 + 不改既有行为）—— 覆盖。
- 步骤 2（新建测试工程并挂 sln）↔ 目标的「可验证落地」—— 覆盖。
- 步骤 3（整体门禁：`npm run typecheck` + `dotnet build src/runtime/WishfulClaw.sln` + `npm test` 68/68）↔ 目标「一处修复覆盖全部调用点」的回归确认 —— 覆盖。
- 步骤 4（S-180 真机复验）↔ 需求 §六「本条落地后**必须**重新复验 S-180」—— 覆盖。这是需求明写的强制后续，计划单列成步骤，未遗漏。

需求 §七「独立一刀、独立提交」↔ 步骤 3 的「按『一需求一刀』提交」—— 覆盖。

**无遗漏环节。** 计划还按规范把「规划文档不单独提交、攒进收尾刀」体现到了 §六 涉及文件表（`plan.md` / `raw-requirements.md` / `changelog.md` 回填「攒进收尾刀，不单独提交」），与 `dev-workflow.md:371` 一致。

### 检查项 2：每步是否带明确、可执行的验证检查点 ✅

逐个核对（均为可执行命令 + 可判定结果）：

- 步骤 1：「`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警；`git diff` 只动该文件、只在 `GetBool` 与其后新增一个私有方法，其余方法一字未动」—— 可执行、可判定。实测 `src/runtime/WishfulClaw.sln` 存在（`Test-Path` = True）✅。
- 步骤 2：「`dotnet build tests/WishfulClaw.Tests.sln` 0 错 0 警；单跑 `tests/WishfulClaw.JsonHelpersRegressionTests/bin/Debug/net11.0/WishfulClaw.JsonHelpersRegressionTests.exe` 返回 0、打印断言计数」—— 可执行。实测 `tests/WishfulClaw.Tests.sln` 存在 ✅，且 exe 路径形态与既有套件一致（`dev-workflow.md:311` 示例同形）✅。
- 步骤 3：「`npm run typecheck`（node + web 两配置）0 错 + `dotnet build ...` + `npm test` 68/68」—— 可执行。实测 `package.json` 有 `typecheck = npm run typecheck:node && npm run typecheck:web`，与 dev-workflow 要求的两个配置吻合 ✅。
- 步骤 4：「`agent_timeline_events.run_id` 出现 `subagent-bg-` 前缀；S-180 阶段六报告 PARTIAL 转正」—— 可判定（有 DB 证据口径）✅。属老大侧执行，计划已标注。

**ℹ️ 改进建议（非阻断）**：`scripts/run-tests.mjs:49` 用正则 `/passed[:\s]+(\d+)/i` 从套件输出里抓断言数，命中才显示 `N assertions`。`WishfulClaw.ToolConcurrencyRegressionTests/Program.cs:19` 只打印 `"...checks passed."`，抓不到（故既有 C# 套件多数不显示计数）。若希望新套件在 `npm test` 汇总里显示断言数，步骤 2 应把「打印断言计数」写实为具体格式，例如 `Console.WriteLine($"{count} assertions passed");` 或 `Console.WriteLine($"passed: {count}");`。当前措辞「打印断言计数」不指向具体串，执行时可能落空。

### 检查项 3：涉及文件路径是否符合项目结构 ✅

- `src/runtime/WishfulClaw.Core/Protocol/JsonHelpers.cs` —— 实测存在 ✅；与 `AGENTS.md` 分层（Core = 基础工具/协议）一致。
- `tests/WishfulClaw.JsonHelpersRegressionTests/WishfulClaw.JsonHelpersRegressionTests.csproj`、`.../Program.cs` —— 目标目录名 `WishfulClaw.<名字>RegressionTests` 与 `dev-workflow.md:324` 及既有 16 个同构目录完全一致（实测 `tests/` 下同类目录：AgentTimeline / ChannelShellApproval / ChannelToolVisibility / CompactionSnapshot / Cron / Goal / GrepPattern / MemoryRecall / ProviderHeader / ReadImage / ReadVideo / SandboxPath / SessionTaskCascade / StreamSegment / TerminalTool / ToolConcurrency，共 16 个）✅。
- `tests/WishfulClaw.Tests.sln` —— 实测存在 ✅；注册方式（`Project(...)` 条目 + `ProjectConfigurationPlatforms`）与文件现状一致：实测每工程在 `ProjectConfigurationPlatforms` 下恰为 **12 行**（6 组配置 Any CPU/x64/x86 × Debug/Release，各 ActiveCfg + Build.0），`SolutionConfigurationPlatforms` 恰为 6 条 —— 计划 §五「12 行」的描述准确 ✅。
- `docs/plans/iter-v2-38/plan-s181/` 下四份文档名 —— 实测 `plan-s180/` 同构目录含 `compliance_report.md` / `plan.md` / `review_report.md` / `verification_report.md`，与计划 §六 所列一致 ✅。

### 检查项 4：分层依赖是否正确（实读 csproj 与命名空间） ✅

**JsonHelpers 归属 Core —— 实读确认**：
- `src/runtime/WishfulClaw.Core/Protocol/JsonHelpers.cs:3` `namespace WishfulClaw.Core.Protocol;`，`:5` `public static class JsonHelpers` ⇒ 确在 `WishfulClaw.Core` 程序集 ✅。
- `src/runtime/WishfulClaw.Core/WishfulClaw.Core.csproj:10-12` 仅 `<ProjectReference ... WishfulClaw.Contracts.csproj />` 一条，无 Agent/Workspace/Infrastructure 依赖 ⇒ Core 可独立编译 ✅。
- `JsonHelpers.cs` 唯一 `using` 是 `System.Text.Json`（`:1`）⇒ 无额外传递依赖 ✅。

**测试工程只引 Core 是否可行 —— 实读确认可行**：
- 计划 §四拟用 `ProjectReference → ..\..\src\runtime\WishfulClaw.Core\WishfulClaw.Core.csproj`，目标框架 `net11.0`（Core.csproj:4 为 `net11.0`）⇒ 一致 ✅。
- 实测 `JsonHelpers` 只暴露 `System.Text.Json.JsonElement` 入参、返回 `string?/bool/int/...` 原语，无 Agent 类型泄漏 ⇒ 只引 Core 足以编译并调用 ✅。
- 依赖方向：测试工程引用 Core 属「上层测试 → 下层库」，不产生 Core→上层 的反向依赖 ⇒ 分层正确、不违规 ✅。

**ℹ️ 提示（非阻断）**：实测 16 个既有 C# 测试工程中，**无一单独引用 `WishfulClaw.Core`**（最少也是引 Agent 或 Infrastructure，如 `WishfulClaw.AgentTimelineRegressionTests` 引 Infrastructure、`WishfulClaw.GrepPatternRegressionTests` 引 Agent）。本工程将是首例「只引 Core」的套件。架构上无碍（Core 是普通 SDK 类库），仅提示执行时留意这是新形态、若 CI/门禁对引用有隐含假设需一并确认。

### 检查项 5：行号与现状代码描述是否与仓库当前代码一致 ⚠️

**行号 —— 逐条实测，全部吻合 ✅**（对照 `src/runtime/WishfulClaw.Core/Protocol/JsonHelpers.cs` 当前内容）：

| 计划/需求声明 | 实测 | 结论 |
|---|---|---|
| `GetBool` 位于 `:16-28` | `:16` 签名、`:28` 闭合 `}` | ✅ |
| `GetIntNullable` 位于 `:35-50` | `:35` 签名、`:50` 闭合 | ✅ |
| `GetLongNullable` 位于 `:57-72` | `:57` 签名、`:72` 闭合 | ✅ |
| `GetDoubleNullable` 位于 `:74-89` | `:74` 签名、`:89` 闭合 | ✅ |
| 「兄弟方法都已带字符串分支」（`int.TryParse` 等） | `:45` `int.TryParse`、`:67` `long.TryParse`、`:84` `double.TryParse` | ✅ |
| 计划 §二/§三 引用的 `GetBool` 源码片段与现状一致 | 逐行比对无差异 | ✅ |

**调用点计数 —— 与现状不符 ⚠️**（需求 `S-181.md` §四 与计划 §一 均写 **41 处**；计划 §六「不动」又写 **其余 40 处**）：

实测 `JsonHelpers.GetBool(` 在全仓 `src/` + `tests/` 的真实调用点 = **42 处**，分布在 **27 个文件**（`tests/` 下 0 处；定义行 `JsonHelpers.cs:16` 已排除）：

```
 5  src\runtime\WishfulClaw.Agent\AgentRuntimeDesktopExecutor.cs
 4  src\runtime\WishfulClaw.Agent\AgentLoop.cs
 4  src\runtime\WishfulClaw.Agent\AgentRuntimeTerminalExecutor.cs
 2  src\runtime\WishfulClaw.Agent\AgentLoop.MemoryRecall.cs
 2  src\runtime\WishfulClaw.CodeGraph\Mcp\CodeGraphToolHandler.cs
 2  src\runtime\WishfulClaw.Agent\AgentRunContextPolicy.cs
 2  src\runtime\WishfulClaw.Agent\AgentRuntimeSshToolExecutor.cs
 2  src\runtime\WishfulClaw.Agent\ToolDispatchRouter.cs
 1  AgentRuntimeBrowserExecutor.cs / AgentRuntimeChannelPluginExecutor.cs / AgentRuntimeImageGenerateExecutor.cs
 1  AgentRuntimeMcpExecutor.cs / AgentRuntimeNotifyExecutor.cs / AgentRuntimePlanExecutor.cs
 1  AnthropicMessagesInputWriter.cs / ConversationCodec.cs / OpenAIResponsesInputWriter.cs
 1  SessionRestoreTools.cs / SubAgentExecutor.cs / ToolCallProcessor.Approval.cs
 1  Modules\Media\MediaFileTools.cs / Tools\PathBoundary.cs / Tools\AgentChanges\AgentChangeTools.cs
 1  Persona\PromptBuilder.cs  1  Infrastructure\Db\DbCompactionSnapshotTools.cs
 1  Infrastructure\Db\DbProjectTools.cs  1  Infrastructure\Db\DbSessionTools.cs
```

- 偏差：**41（声明）vs 42（实际）**，且计划内部 **41 / 40 自相矛盾**。
- 影响评估：**非阻断**。计数只是「影响面」的佐证，不改变修法（一处修、全局受益），也不改变任何步骤。但它是一处会「烂」的统计副本 —— 建议执行时直接删掉绝对数字，改写成「全仓 42 处调用点（以 `grep` 为准）」，或干脆只写「全部 `GetBool` 调用点」。
- 顺带核对需求 §四 列举的 3 个示例调用点：`MediaFileTools.cs:37`（`deleteWhenDone`）✅ 实测吻合；`AgentChangeTools.cs:211`（`beforeExists`）✅ 吻合；`PathBoundary.cs:49`（`sandboxEnabled`）✅ 吻合（实为 `Tools/PathBoundary.cs`）。

### 检查项 6：「做法」代码片段与「测试用例表」是否自洽 ✅

按「做法」（plan §三）的**逐分支**逻辑，核对 15 条用例的期望值：

| 用例 | 输入 → 命中分支 → 结果 | 期望 | 自洽 |
|---|---|---|---|
| 1 `{"a":true}` | `JsonValueKind.True` → `true` | `true` | ✅ |
| 2 `{"a":false}` | `JsonValueKind.False` → `false` | `false` | ✅ |
| 3 `{"a":"true"}` | `String` → `ParseBoolText` → 去空白/小写 = `"true"` → `true` | `true` | ✅（主修） |
| 4 `{"a":"false"}` | `String` → `"false"` → `false` | `false` | ✅ |
| 5 `{"a":" true "}` | `String` → `Trim()` 后 `"true"` → `true` | `true` | ✅ |
| 6 `{"a":"FALSE"}` | `String` → `ToLowerInvariant()` 后 `"false"` → `false` | `false` | ✅ |
| 7 `{"a":" True "}` | `String` → 去空白 + 小写 = `"true"` → `true` | `true` | ✅ |
| 8 `{"a":"yes"}` | `String` → 不匹配 → `_ => fallback` = `false` | `false` | ✅ |
| 9 `{"a":"1"}` | `String` → 不匹配 → `fallback` = `true` | `true` | ✅ |
| 10 `{"a":""}` / `{"a":"   "}` | `String` → `IsNullOrWhiteSpace` → `fallback` = `true` | `true` | ✅ |
| 11 `{"a":1}` | `Number` → `_ => fallback` = `true` | `true` | ✅ |
| 12 `{"a":null}` | **`JsonValueKind.Null` → `_ => fallback`** = `true` | `true` | ✅ |
| 13 `{"b":"true"}`（缺 `a`） | `TryGetProperty("a")` 失败 → 提前 `return fallback` = `true` | `true` | ✅ |
| 14 非 object（`[1,2]` / `"x"`） | `ValueKind != Object` → 提前 `return fallback` = `true` | `true` | ✅ |
| 15 `{"a":"true"}`, fallback=**true** | `String` → `"true"` → `true`（不受 fallback 影响） | `true` | ✅ |

**专项核对任务点名的四类边界**：
- `JsonValueKind.Null` → 落 `_` 分支 → `fallback`；用例 12 期望 `fallback` ⇒ **吻合** ✅（计划未给 `Null` 单列分支，正确，`_` 已兜住）。
- 空串 / 纯空白 → `ParseBoolText` 的 `IsNullOrWhiteSpace` 提前回落；用例 10 期望回落 ⇒ 吻合 ✅。
- 非 object → `element.ValueKind != Object` 提前回落；用例 14（`[1,2]` 与 `"x"`）期望回落 ⇒ 吻合 ✅。
- 属性缺失 → `!TryGetProperty` 提前回落；用例 13 期望回落 ⇒ 吻合 ✅。

**无矛盾、无「期望值与代码逻辑打架」的用例。**

**未覆盖但本可覆盖（ℹ️，非必须）**：
- 数组值属性 `{"a":[true]}`（走 `_` → fallback）—— 计划在用例 11/12 已覆盖「非标量 ⇒ 回落」的同族，可加可不加。
- 「非空且不匹配字符串 + fallback 与期望**相反**」—— 已由用例 8（`"yes"`, fb=false ⇒ false）与用例 9（`"1"`, fb=true ⇒ true）覆盖，双保险到位。
- 大小写全拼变体只需 1~2 个代表，用例 6/7 已够，无需穷举。

### 检查项 7：「刻意不做」边界是否清晰、有无回退风险或与需求冲突 ✅

逐条核对计划 §七（5 条）与需求 `S-181.md` §五/§四：

1. 「不扩展到 `yes/no`、`1/0`、`on/off`」—— 与需求 §五「边界（写死免得下轮走回去）：只识别 true/false 两词」完全一致 ✅。
2. 「不加调用侧校验或告警（不采纳方案甲）」—— 与需求 §五「甲：不采纳」「乙：一处修复覆盖全部调用点」一致 ✅。
3. 「不改 `GetBool` 签名，不加重载」—— 与需求 §四影响面「全部受益，无一处会改坏」的「零调用侧改动」前提一致 ✅。
4. 「不新建源码文件（除测试工程），不引入新依赖」—— 一致，且步骤 1 的 `git diff` 检查点能守住 ✅。
5. 「不顺手改兄弟方法（`GetIntNullable` 等已具备字符串宽容度，且 `int.TryParse` 宽容度更高）」—— 实测兄弟方法确有字符串分支（`:45/:67/:84`），此判断成立 ✅。

**回退风险**：本刀唯一行为变化是「字符串 `"true"`/`"false"`（含空白/大小写）由回落 → 正确解析」。计划已声明这是**期望变化**，且需求 §四给出了「改前/改后」对照表。无「顺手扩大范围」的隐性回退路径。**与需求无冲突。**

### 检查项 8：两个文档的行尾与 BOM 是否规范 ⚠️

用 `[IO.File]::ReadAllBytes` 逐字节实测（口径：应 **CRLF + UTF-8 无 BOM**）：

| 文件 | BOM | CRLF | 裸 LF | 判定 |
|---|---|---|---|---|
| `requirements/S-181.md` | False | **0** | **88** | ⚠️ 行尾为 LF |
| `plan-s181/plan.md` | False | **0** | **176** | ⚠️ 行尾为 LF |
| （对照）`src/.../JsonHelpers.cs` | False | 149 | 0 | ✅ CRLF |
| （对照）`AGENTS.md` / `docs/dev-workflow.md` / `docs/project-structure.md` / `README.md` | False | 全 > 0 | 0 | ✅ CRLF |
| （对照）`iter-v2-38/plan.md` / `changelog.md` / `raw-requirements.md` / `requirements/S-177.md` | False | 全 > 0 | 0 | ✅ CRLF |
| （对照）`requirements/S-180.md` / `plan-s180/plan.md` | False | 0 | 113 / 161 | ⚠️ 同为 LF |

- **BOM：两文件均为「无 BOM」✅ 符合口径。**
- **行尾：两文件均为纯 LF，不符合「应 CRLF」⇒ ⚠️。**
- 归因：该偏差**非本计划独有** —— 同迭代兄弟 `S-180.md`、`plan-s180/plan.md` 同为 LF，而仓库主流文件（AGENTS.md、dev-workflow.md、迭代 plan.md/changelog.md、S-177.md）均为 CRLF。故这更像**某个写入路径的系统性行为**，而非计划撰写者一次性手误。
- 建议：执行态落地前把这两份（以及 S-180 同族）统一转 CRLF，或确认「per-requirement md 用 LF」是否为有意约定并在规范里写明 —— 二者取一，避免继续漂移。

---

## 行动项（按优先级）

| 优先级 | 项 | 位置 | 说明 |
|---|---|---|---|
| P1（建议执行前做） | 调用点计数更正 | `requirements/S-181.md` §四、`plan-s181/plan.md` §一/§六 | 实际 **42 处**；计划内 41 与 40 自相矛盾；建议改为「全部 `GetBool` 调用点」或以 `grep` 现查，别再写死数字 |
| P1（建议执行前做） | 行尾转 CRLF | `requirements/S-181.md`、`plan-s181/plan.md`（合规报告本身按 CRLF 输出） | 现为 LF；与仓库主流 CRLF 不一致 |
| P2（执行步骤 2 时落实） | 断言计数打印格式写实 | `plan-s181/plan.md` §五 步骤 2 | 需打印匹配 `/passed[:\s]+(\d+)/i` 的串，才能在 `npm test` 汇总显示计数 |
| P3（知悉即可） | 首个只引 Core 的测试工程 | `plan-s181/plan.md` §四 | 架构无碍，执行时留意为新形态 |

---

## 最终结论

**是否允许进入执行态：允许。** 8 项检查中 ❌ = 0，⚠️ = 2（其一为统计数字偏差、其一为文档行尾格式），二者均不改变计划的正确性与步骤可执行性，也不与需求冲突。按 `docs/dev-workflow.md:414`「❌ 项 > 0 时禁止进入用户确认环节」，本计划**通过规划验证**，可提交用户确认并进入执行态；上述 P1 两项建议在落地时顺手修正。

---

*本报告为只读规划验证产物，未修改仓库任何其它文件；建议随 S-181 需求提交一并入库（`dev-workflow.md:410`）。*
