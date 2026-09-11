# v2-iter-28 规划合规复审报告

- 复审结论：**PASS**
- 阻断项：**0**
- 复审方式：独立只读检查，未修改代码
- 检查对象：`plan.md`、`exploration_findings.md`、`raw-requirements.md`、`usage-analytics-requirement.md`、`updater-ui-issues.md`、`editor-undo-selection-issue.md`、`AGENTS.md`、`docs/dev-workflow.md`、`docs/plans/iter-v2-27/compliance_report.md`
- 当前阶段：**规划期裁定全闭合（R-1 五条 / R-2 三条 / R-3 八条），规划验证通过，可进入执行态**（起点 R-3.1，B 口径）
- 补记（2026-09-11 晚）：R-3 经老大四轮澄清后已把结论全部回填 `plan.md` 的 R-3 节（R-3.A～R-3.G），本轮讨论未新增独立文档。本节记录该节的一致性复核。
- **终审补记（2026-09-11 夜，规划期闭合）**：R-1 / R-2 / R-3 三条需求的**全部待裁项已闭合**（共 5+3+8 条裁定），`plan.md` 已从 618 行增至 **735 行**；`raw-requirements.md` 已回填三条需求的立案标注并**新增「后继需求登记」小节（S-1～S-6）**。本轮结论见下「规划期闭合终审」。

## 上一轮阻断项复核

本迭代为 28 首轮规划验证，**无上一轮合规报告可复核**。iter-27 的 `compliance_report.md` 为 PASS，且 27 已于 2026-09-11 收尾（`v0.2.27`，`main` @ `0388875e`），与 28 无阻断项继承关系。

## 首轮阻断项复核（本轮修复）

首轮独立审计发现 **6 项 ❌**，均为「文件路径不存在或指向错误文件」，全部位于「涉及文件」段与步骤目标中的硬依赖引用。已逐项用 `test -f` 复核实证并在 `plan.md` / `exploration_findings.md` 内修正：

| # | 原路径（错） | 实际路径（正） | 结果 |
|---|---|---|---|
| 1 | `src/main/channels/channel-plugin-handlers.ts` | `src/main/ipc/channel-handlers/channel-plugin-handlers.ts` | PASS（已改，7 处全路径统一） |
| 2 | `src/main/channels/channel-handler-utils.ts` | `src/main/ipc/channel-handlers/channel-handler-utils.ts` | PASS（已改，3 处） |
| 3 | `src/main/channels/channel-command-handlers.ts`（**文件不存在**） | `src/main/channels/plugin-command-handlers.ts:321-325` | PASS（已改，定位到 `/status` 默认值真实落点） |
| 4 | `src/renderer/src/components/editor/FileAwareEditor.tsx` | `src/renderer/src/components/chat/FileAwareEditor.tsx:144,253` | PASS（已改，两个非折叠选区出口行号已实读核对） |
| 5 | `src/renderer/src/components/chat/InputArea/use-channel-auto-reply.ts` | `src/renderer/src/hooks/use-channel-auto-reply.ts:139-143` | PASS（已改） |
| 6 | `src/runtime/WishfulClaw.Agent/ToolPreset.cs` | `src/runtime/WishfulClaw.Core/Tools/ToolPreset.cs:38-119` | PASS（已改；**分层语义已同步修正**，见下） |

**全量复校**：对两份规划文档中被反引号包裹的全部代码路径（32 个）做存在性校验，**0 缺失**。

**分层语义修正**：第 6 项还带来一处分层描述错误——`plan.md` 原称「R-3 落点与 #1 共用 Agent 侧文件」，但 `ToolPreset` 实为 **Core** 层文件。已在 R-3.1 步骤内显式写入分层边界（声明字段与 `ToolPreset` 在 Core；消费/强制层在 Agent），并在「涉及文件」段加「路径前缀速查」，避免执行时把声明字段误加进 Agent 层造成 Core→Agent 逆向依赖。该项原属非阻断建议，修复后一并在报告中留痕。

## 全面检查

**覆盖性**：7 项需求在 `plan.md` 均有对应小节与步骤清单，全部带验证检查点或明确的「待老大裁定」开放项。按审计规则，**BY DESIGN 的待裁项不计入 ❌**——只要该项仍具备具体步骤清单与验证检查点，且开放决策点被逐条列出。

- **#2 更新弹窗/悬浮窗**：`plan.md` 需求 #2 节，`#2.1`–`#2.5` 已提交（`c7287b6e`），`#2.6` 为老大目视复验并写明「未过不得勾成完成」，正确。
- **#1 请求日志与统计**：`plan.md` 需求 #1 节，P1–P4 四步各带验证（P1 行数对账、P2 AOT `JsonTypeInfo`、P3 `tsc` 三配置、P4 全仓零命中）。硬约束段明确 AOT（具名 DTO 注册含 `List<T>`、`WorkerResponse.Json` 显式传 `JsonTypeInfo`）与 `billableInput` 取 `DbMessageCompactTools.cs:186` 口径（该文件与 `:186` 内容已实读核对）。
- **#3 编辑器撤销选中态**：`plan.md` 三步带验证，并明确 agent 无法自主复验的边界（依赖真实键入与输入法时序）。
- **R-1 补位模型**：`plan.md` R-1 节，步骤 `R-1.0`–`R-1.6` 骨架齐全，三条待裁项逐条列出，且写明 `R-1.0` 之前不得动手。核心事实已复核无误：`optimizer.ts:60-69` 构造 `params` 确实丢失 `providerId`；`ProviderCompletionService.cs` 全文 **384 行，`runtime_role` 零命中**；`ProviderCompletionResult` 确为 `AotResultTypes.cs:84-88` 的具名 record。
- **R-2 渠道设置页**：`plan.md` R-2 节，`R-2.1`–`R-2.5` 带 Mini 验证，三条待裁项完整，并两次标注与 R-3 共用文件不得并行改。
- **R-3 工具可见性**：`plan.md` R-3 节（现为 R-3.A～R-3.G 七个子节），`R-3.0`–`R-3.9` 带验证，待裁项已从原五条收敛为四条；新字段落点（`ToolTypes.cs:8-14` / `IToolExecutor.cs:33` 旁 / `ToolDefinitionPlaceholder.cs:12-25` / `ToolRegistry.Register:44`）已实读确认零反射、符合 AOT。

**R-3 节一致性复核（2026-09-11 晚补记）**：经老大四轮澄清，R-3 的三处核心结论已定并回填，与代码实读一致：
- R-3.A 语义模型（scope 只有 project/global、协作只属项目下、全局=PM 助手、渠道是 global 特例、`global:cowork` 不成立）——与 `AgentRunContextPolicy.cs:125-130,134-137` 两条折算一致，且据此确认折算**是正确的、本次不动**。
- R-3.C 全量 12 场景映射——每个场景的来源行号已实读核对（`use-chat-actions.ts:252`、`use-channel-auto-reply.ts:291`、`SubAgentExecutor.Parameters.cs:44,77-80`、`cron-runtime.ts:484-491`、`project-send-message.ts:205`、`pet-agent.ts:194`）。
- R-3.F 全局会话能力边界——`GlobalChatTools` 名单里写/执行类工具**全部不在**已逐项核对；此前"全局能不能改文档"的疑问由此实证回答。
- 讨论期间曾产生的三份临时文档（R-3-决策讨论稿 / 统一过滤方案设计 / 全局会话能力边界）已全部收拢进 `plan.md` 并删除，目录产物回归工作流规定的最小集。
- **R-4 使用指引**：`plan.md` R-4 节，`R-4.0`–`R-4.6` 带验证，截图脱敏硬前置已写明；两处入口落点（`TitleBar.tsx:94-138`、`SettingsPage.tsx` 的 `AboutPanel()`）已实读核对。
- **收尾**：`Z1` 全量审查 → `review_report.md`、`Z2` → `verification_report.md`、`Z3` 用户手动发起收尾，齐备；**「不纳入」**段存在（Plan D、A4 后半段、桌宠、K0）。
- **探索态输出**：`exploration_findings.md` 已产出，含仓库状态、参考源码位置、潜在风险与依赖三节要求内容。

**分层依赖**：实读各层 `csproj` —— Core 仅引用 Contracts，Infrastructure 引用 Contracts+Core，Workspace 引用 Contracts+Infrastructure，Persona 引用 Contracts+Core+Workspace，Agent 引用 Contracts+Core+Persona+Infrastructure，Worker 引用全部 + CodeGraph。计划内 R-3 把新声明字段加在 Core 的 `ToolDefinition`，**不构成逆向依赖**；无步骤会引入反向依赖。

**AOT 约束落实**：需求 #1 硬约束段与 R-1 节（`ProviderCompletionResult` 改字段须同步 AOT 注册）均已声明，符合 `AGENTS.md` 的 Native AOT 章节要求。

**源码引用正确性**：抽查 20+ 处行号与内容，均准确或仅存轻微行号漂移（plan 已声明「执行时以当时行号复核」，漂移不构成 ❌）。例：`AgentRunContextPolicy.cs` 的 `IsToolAllowed:199-222` 准确；`ChannelToolVisibilityRegressionTests/Program.cs:20-53,68-83,174` 内容相符；`ToolConcurrencyRegressionTests/Program.cs:41-49,92-99` 确含 `runtimeRole:"automation"`。

## 规划期闭合终审（2026-09-11 夜）

本轮复核对象为**规划期全部裁定的闭合度与回填完整性**（此前各轮为路径与分层合规，见上）。

### 一、R-1 补位模型（5 条裁定全闭合）

| 裁定 | 结论 | 回填位置 |
|---|---|---|
| ① 范围边界 | 四条清单：提示词优化 / 新建角色辅助 / 后台定时执行 / 定时任务会话执行 | `plan.md` R-1 裁定 ① |
| ② "最近使用"口径 | **作废**（悬空 id 属**外部不可抗力**，不作缺陷立案，但足以否定该口径）→ 改显式配置 + 补位兜底 | `plan.md` R-1 裁定 ② |
| ③ 四个哑字段 | **全删**（`contextCompressionModel` / `useGlobalActiveModel` / `ClaudeCodeConfig` / `promptRecommendationModels`） | `plan.md` R-1 裁定 ③ |
| ④ 显式模型配置 | 提示词优化与新建角色辅助**各加一项**，形态对齐定时任务 `agentId`+`model`；**新建字段，不复用删掉的哑字段** | `plan.md` R-1 裁定 ④ |
| ⑤ 三级解析第 ③ 级 | **保留 + 强制存在性校验**；失效即报可见错误，不静默 | `plan.md` R-1 裁定 ⑤（本轮新增） |

**一致性核验**：裁定 ⑤ 与裁定 ② 不冲突——② 否定的是"把最近使用当作主口径"（不可靠），⑤ 保留的是"最后兜底 + 强制校验"，**差别在"是否校验"**。`plan.md` R-1.3 的验证项已相应升级为"第 ③ 级 `activeModelId` 已悬空时显式失败"。

**实读支撑复核**（本轮新查，已实证）：`provider-store.ts:78-89` 的清理逻辑**只在 `setActiveProvider` 内**，用户"只删模型、不切 provider"时 `activeModelId` 会悬空且永不清理——这正是裁定 ② 所述踩坑的成因，也是裁定 ⑤ 强制校验的直接依据。

### 二、R-2 渠道设置页（3 条裁定全闭合）

| 裁定 | 结论 | 回填位置 |
|---|---|---|
| ① 旧逐渠道值处置 | **摘白名单丢弃**（默认值以全局唯一真源为准，不从既有渠道搬初值） | `plan.md` R-2 裁定 ① |
| ② 5 个"只展示不生效"字段 | **只搬家 + 记账**；**唯 `allowShell` 例外，本次接真且语义改写** | `plan.md` R-2 裁定 ② + 新增步骤 **R-2.6 / R-2.7** |
| ③ 全局设置存哪 | 沿用 `plugins.json` 既有路径，**以增加字段的方式**承载，**不另开文件** | `plan.md` R-2 裁定 ③ |

**`allowShell` 语义改写的合规要点**（本轮实读新证，已逐条写入）：

- **语义**：由"是否允许 Shell"（疑似可见性开关）改为"**是否需用户授权**"——`Bash` **恒可见**且恒在核心集（`shell` priority 30）；`false` = 默认需授权（每次调用需用户确认），`true` = 免授权直接调用。
- **实读实证**：`bash-tool.ts:50` 的 `requiresApproval: ctx => !ctx.channelPermissions.allowShell` **语义本就符合新口径**，但 `channelPermissions` **全仓零赋值点**（仅 `tool-types.ts:44` 声明 + `:50` 读取）→ `ctx.channelPermissions` 恒为 `undefined` → **该字段从未影响过任何一次调用**（"半死"）。本次须一并修注入（R-2.6③）。
- **⚠️ 两条必改项已写入步骤**：① 命名/文案（`allowShell` 读起来像"允许 Shell"，与"需授权"相反；`plugin-panel-detail.tsx:191-192` 的「Shell 执行」/「允许 AI 执行 shell 命令」是旧语义）；② **强制执行须落在 C# Worker 侧**——`bash-tool.ts` 的 `execute` 只返回 `nativeOnlyBashResult()`，真实执行在 C#，只在渲染端做等于没做（重蹈"零注入"覆辙）。
- **4 个仍不生效的 `allow*`**（`allowReadHome` / `readablePathPrefixes` / `allowWriteOutside` / `allowSubAgents`）已核出**全部无强制执行点**（三个仅在 `plugin-command-handlers.ts:338-341` 打印，`readablePathPrefixes` 连读取点都没有），已立 **R-2.7 记账**并登记为 `raw-requirements.md` 的 **S-5**。

### 三、R-3 工具可见性（8 条裁定全闭合 + 本次范围 = B）

**八条裁定**：① 语义模型（R-3.A）；② 串语法 `scope:mode@role`（R-3.B）；③ 定时任务拆两类（R-3.C 6a/6b）；④ 定时任务与子 Agent 同类；⑤ 默认可见（R-3.D）；⑥ 全局保留只读工具（R-3.F）；⑦ **核心工具集原则**（R-3.C-bis）；⑧ **本次范围 = B**。

**本轮新增第 ⑨ 条裁定（`use_capability` 三载体同源同裁）**：

- **裁定内容**：提示词核心集 / `use_capability` 的 description 分类清单 / `action="list"` 的返回，**三者在本档位下必须是同一套可见面**。
- **实读新证（本节点是缺陷，非待确认项）**：三动作"一好两缺"——`call`（`AgentRuntimeUseCapabilityExecutor.cs:322-327`）与 `inspect`（`AgentRuntimeUseCapabilityEncoding.cs:115-133`）**已调 `IsToolAllowed`**；**唯 `list` 缺**（`AgentRuntimeUseCapabilityDiscovery.cs:148-153` 只调 `registry.IsAvailableInMode`，而 `ToolRegistry.cs:87-98` 对未声明 `availableModes` 的工具**直接 `return true`**）。
- **后果**：浏览器 9 个工具未设 `availableModes` → `project:cowork@subagent` 档下 `list` **照样列出**，子 Agent 拿到 `capability_id`；`call` 虽拦，但**能力已暴露且三方口径自相矛盾**。
- **修法已写入步骤**：`BuildCapabilitySummaries` 签名**已含** `runContext`/`sessionMode`/`channelSession`（由 `ExecuteAsync:125` 的 `Resolve` 一路传下），**只需补一个 `!IsToolAllowed(...)`，无需改调用链**；与 `EncodeBuiltinInspectResponse` **共用同一判定**。**R-3.8d 由"验证类"升级为"实现类"**。

**B 口径（两步走）的边界与自检**：

- **B 的含义**：本次**只做机制、零行为变化**——新串完整表达现状（当前"全放行"的档位先声明成 `*:*`），可见集收窄与核心集名单收窄留到下一步独立提交。
- **据此的执行范围**：R-3.1～R-3.6、R-3.8～R-3.9、R-3.11～R-3.13（含 3.8b/3.8c/3.8d）；**R-3.7（定时任务两类落地）与 R-3.10（显式化 early-return）留下一步**（两者均改变可见集）。
- **零变化自检**（`plan.md` R-3.G 文末已写）：跑完本次所有步骤后，**任一档位的可见工具集合与提示词内容都应逐字节等价于改动前**；出现任何差异即说明该处本质是行为变更，须移入后继需求。
- **合规确认**：本次步骤中**无一项**会改变现有可见面，符合"规划态不产生行为变更"的约束。

### 四、后继需求登记（防丢失，本轮补齐）

`raw-requirements.md` 文末已新增「后继需求登记」小节：

| # | 内容 | 性质 |
|---|---|---|
| S-1 | 核心集名单收窄（等价现状 → 7 类 / PM 那套） | 行为变更 |
| S-2 | `global:chat@subagent` 集合收束 | 行为变更 |
| S-3 | 后台定时三类排除启用 | 行为变更 |
| S-4 | 显式化 early-return（cowork/goal/automation 首次被拦） | 行为变更 |
| S-5 | 4 个 `allow*` 权限字段仍不生效 | 记账 |
| S-6 | `ChannelInstance.tools` 零调用方（C# 侧零处发起） | 记账，与 R-3.9 同批 |

**合规确认**：S-1～S-4 均为**行为变更**且已在 `plan.md` R-3.13 与 `raw-requirements.md` 双处登记，**不丢失**；S-5/S-6 为本次刻意"不接真"的记账项，已防后续误认"已生效"。

### 五、本轮复核结论

- **阻断项：0**（本轮无新增阻断，上述"缺陷"均已作为**步骤**写入 plan，而非留作开放项）。
- **全部待裁字样已清除**：`plan.md` 内仅余 2 处历史标注（R-1 两从属问题改为"✅ 已由裁定 ④⑤ 闭合"、R-2 三条改为"✅ 已全部裁定"）。
- **路径引用复校**：`plan.md` 33 个代码路径全部 `test -f` 通过（**0 缺失**）。
- **规划期状态**：**裁定全闭合，可进执行态**（起点 R-3.1，B 口径）。

## 非阻断建议

1. **`FilterToolDefinitions` 行号漂移**：plan 写 `:230-236`，实测区间为 `:224-248`。不影响执行（plan 已声明行号复核机制），建议动手时以实际为准。
2. **R-2/R-3 共用文件清单已双处标注**，建议执行时把该清单同步进「执行顺序与理由」表，防止 R-2 先做时提前改动 `channel-handler-utils.ts` 而影响 R-3。
3. **R-1.6 与需求 #1 的耦合**：plan 已标注「R-1.6 是否必要取决于 #1 的写入钩子位置，以 #1 落地后的实际钩子位置复核」。执行 R-1 时应先确认 #1 已完成并复查该判断，勿预设结论。
4. **R-3.3 属行为变更**（`:212-216` early-return 显式化会让 cowork/goal/automation 首次开始被拦），plan 已要求「由老大确认并单独记账」。执行时须单独出可见集前后差异表，不得混在其他步骤里静默进行。
5. **`docs/iteration-plan.md` 内容陈旧**（只登记到 v2-iter-26），28 范围权威为 `raw-requirements.md` 文末「状态」小节。该文件的滞后不阻断执行，但若后续迭代仍引用它作为范围依据需另行更新。

## 免责声明

本报告只证明规划具备可执行条件，不代表代码、AOT、真机升级或渠道回归已经通过。
