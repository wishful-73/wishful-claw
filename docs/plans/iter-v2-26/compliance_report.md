# v2-iter-26 计划合规审查报告（第二轮复审）

- 审查日期：2026-09-08
- 审查对象：`docs/plans/iter-v2-26/plan.md`（2026-09-08 按首轮审查意见修订后的现行版本，覆盖 Plan A~G 全部七个 Plan）
- 声明：**本报告为第二轮复审，整体替代同目录前一份报告**。前一份报告（2026-09-08 出具，文件内自标“第二轮”，系替代 2026-09-07 仅覆盖 Plan A~C 的更早版本；按本次复审口径记为“首轮”）结论为 **BLOCKED：❌ 2 项（同一根因，Plan G 发送路径盘点错误）+ ⚠️ 3 项**。本轮任务：核验修订是否解除全部 5 项遗留、修订本身是否引入新问题。
- 对照文档：`AGENTS.md`（7 层结构、AOT 规范、编译验证）、`docs/dev-workflow.md:217-238`（阶段三检查项与阻断规则）。
- 审查方式：对修订涉及的 Plan E / Plan G 全部 `file:line` 声明逐条实证核对；Plan A~F 沿用首轮已实证结论并抽样复核（本轮独立重验 12 处，全部命中，见第三节）；对 Plan G 的发送路径盘点做了独立穷举 grep（`apiKey:` 全 Renderer 命中 26 处逐一归类）。未修改任何源码、plan.md 与 exploration_findings.md。
- Plan C 收缩（只做下载可观测性、不做真实安装版升级验证）为老大 2026-09-08 明确裁定（plan.md:8,132,370），**不作为缺陷**。

## 结论

**PASS：❌ 0 项，⚠️ 2 项（均为文字精度问题，不影响执行正确性）。依据 `docs/dev-workflow.md:238` 阻断规则，plan.md 可进入用户确认环节。**

首轮 2 个 ❌ 与 3 个 ⚠️ 全部实证解除；修订未引入新的阻断级问题。

## 一、首轮遗留项逐条复核

| 首轮项 | 判定 | 修订落点（plan.md） | 独立实证（源码） |
|---|---|---|---|
| ❌-1 / ❌-2（同一根因）：Plan G 误判“全部 7 个发送点都经 `buildProviderPayload`，改一处即全覆盖” | **已解除** | :311-317 改为“4 处独立构造点”盘点并逐处标注缺/已带字段；:322-327 文件范围扩为 4 处修改；:334 明确不修改清单重写；:341 新增硬契约“4 个发送路径必须全部覆盖……只改 buildProviderPayload 会漏掉主聊天路径——这是本轮规划复审判 ❌ 的原因，不得重犯”；:347-351 G1 步骤与 Mini 验证同步重写（含反向兜底 grep） | 见下方“Plan G 盘点独立穷举验证”，4 处构造点、7 个调用点、3 处已带字段、无第 5 处遗漏，全部命中 |
| ⚠️-1：Plan E toast 时序描述不准 + 裸 `catch {}` 吞异常未列为根因 | **已解除** | (a) :225 如实写“`toast.success` 位于 `:259`，确实在 `await` 之后”；(b) :226 新增整段“吞异常的轮询 catch”作为第二根因（“需用户手动点击启用”的另一成因）；(c) :233 文件范围动作 ⑤ 要求改造 `:273-275` 裸 catch——保存/启动包独立 try/catch，失败 `cleanup()` + `setLoginStatus('error')` + `setStatusMessage` 并 `return`，**不得** `setTimeout` 重排，轮询 IPC 瞬时失败保留静默重试、两类异常分支区分；(d) :243 硬契约“保存或启动失败必须**终止轮询**并进入 error 状态”；(e) :248 E1 Mini 验证含 `grep -c "catch {" = 0`（当前源码恰 1 处命中即 :273，改后归零可验证）+ 人工复核 diff 失败分支有 `setLoginStatus('error')` 且无 `setTimeout(... poll ...)` 重排 | 逐行核对 `plugin-panel-qr.tsx:115-292`：微信路径 :125-165（patch :131-145 含 `autoStart:true` :143、updateChannel 检查+throw :146-152、startChannel 检查+throw :154-160、toast :164）、依赖数组 :191 五项；飞书路径 :245-261（:247-249 cleanup/connected/文案在 await **前**、:251-258 updateChannel 未检查返回值、无 startChannel、无 autoStart、toast.success 在 :259 await 后）、裸 catch :273-275 静默重排、外层错误分支 :279-282、依赖数组 :283 缺 startChannel——plan.md 修订后的每一处行号与描述均与源码一致 |
| ⚠️-2：`IWorkerRequestContext` 成员列举漏 `ConnectionCancellationToken` | **已解除** | :309 现为“当前只有 `CancellationToken`、`ConnectionCancellationToken`、`ForBackgroundOperation()` 和 `Emit*` 方法”，引用区间 `:9-22` | `src/runtime/WishfulClaw.Contracts/IWorkerRequestContext.cs`：接口体 :9-22，`CancellationToken` :11、`ConnectionCancellationToken` :13、`ForBackgroundOperation()` :15、三个 `Emit*` 方法 :17-21。成员清单完整吻合，无 SessionId 类成员，“不需要改契约”结论成立 |
| ⚠️-3：`ToolModule.cs` / `channel-feishu-handlers.ts` / `channel-store.ts` 路径缩写 | **已解除** | :189 `src/runtime/WishfulClaw.Agent/Tools/ToolModule.cs:35-95`；:229 `src/main/ipc/channel-handlers/channel-feishu-handlers.ts:319-331`；:229 `src/renderer/src/stores/channel-store.ts:18`、`:66`、`:133` | 三个全路径均真实存在；ToolModule.cs providers 数组自 :35、Push/Register/Pop 注册循环在 :61-73（落于 :35-95 区间）；feishu handlers `plugin:feishu:install-start`/`install-poll` 注册于 :319-331；channel-store `autoStart: boolean` :18、接口 `startChannel` :66、实现 `startChannel: async (id)` :133。行号与内容全部命中 |

### Plan G 盘点独立穷举验证（❌-1/❌-2 解除依据）

`grep -rn "apiKey:" src/renderer/src --include=*.ts --include=*.tsx` 共 26 处命中，逐一归类：

**(a) 4 处待修改构造点——行号精确、确实缺 `providerBuiltinId`、确实汇入 `agent/run`**（四者均经 `useChatStore.sendMessage` → `src/renderer/src/stores/chat-store/index.ts:362` `workerRequest('agent/run', ...)`）：

1. `use-chat-actions.ts:210-225` — `handleSendMessage` 主聊天路径，内联 14 字段 provider 对象，无该字段；:364-366 注释自证 `buildProviderPayload` 是“matching handleSendMessage's logic”的复制品。✅ 与 plan.md:312 一致
2. `use-chat-actions.ts:385-399` — `buildProviderPayload` 返回对象，13 字段，无该字段。✅ 与 plan.md:313 一致
3. `use-channel-auto-reply.ts:223-235` — 渠道自动回复，11 字段，无该字段。✅ 与 plan.md:314 一致
4. `project-send-message.ts:87-97` — `send_session_message` 派发路径，9 字段，无该字段。✅ 与 plan.md:315 一致

**(b) 无第 5 处遗漏**：其余 22 处命中均不属于“缺字段的 agent/run 载荷”——`PersonaGeneratorDialog.tsx:55` 走 `persona/generate`（persona-store.ts:175）；`provider-store.ts:209,221` 走 `provider/test` / `provider/fetch-models` 且 :210,:222 已传 `builtinId`；`generate-title.ts:216`、`optimizer.ts:65`、`use-prompt-optimizer.ts:86` 为标题生成/提示词优化端点；`sidecar-mapping.ts:129` 属 sidecar 映射（:153 已透传）；`sub-agents/builtin/index.ts:31` 属已裁决排除的 fast-model 路径；其余为设置表单、鉴权、store 默认值、类型声明（settings-store、translate-store、provider-auth*、ProviderConfigPanel、provider-store-helpers:75、use-input-area-selectors:42,148、sidecar-mapping:209）。全部可落入 G1 反向兜底（plan.md:351）的三类判定。✅

**(c) 3 处“已带字段”声明属实**：`cron-runtime.ts:111`（`buildProviderConfig` :101 起，`providerBuiltinId: provider.builtinId` :111）、`memory-automation-utils.ts:271`、`sidecar-mapping.ts:153`（`mapSidecarProvider` 条件透传）。✅ 与 plan.md:316 逐字吻合

**(d) 出范围裁决的事实前提属实**：`provider-store-helpers.ts:34` 接口声明 `getFastProviderConfig: () => { providerId; model; apiKey?; requiresApiKey?; baseUrl? } | null`——确无 `builtinId`（plan.md:317 未标可选符，属排版级微差，不影响结论）；`provider-store.ts:101-107` 实现同样不返回 `builtinId`；`sub-agents/builtin/index.ts:17-37` 的 `getProviderConfig()` 在 :20 消费它，`sidecar-mapping.ts:290-291` 在 :290 消费它；plan.md:317 所列其他消费者 `generate-title.ts:201`、`use-input-area-selectors.ts:127`、`ModelSwitcher.tsx:69`、`use-completion-summary.ts:71` 四处 grep 全部命中。blast radius 论述与“迭代后记入 Obsidian 待办”的处置成立。✅

**(e) 7 个调用点行号复核**：`use-chat-actions.ts:432,488,567,678`、`use-background-subagent-wakeup.ts:79`、`goal-session-views.tsx:197`、`cron-runtime.ts:395`——grep `buildProviderPayload\(` 全仓命中恰为这 7 处 + 定义 :367。✅

## 二、五项检查项判定（dev-workflow.md:221-226）

| # | 检查项 | 判定 | 证据摘要 |
|---|---|---|---|
| 1 | 步骤是否完整覆盖任务目标 | ✅ | Plan A~F 沿用首轮结论（覆盖完整）；**Plan G 缺口已补**：G1（plan.md:347-351）现覆盖全部 4 处构造点，主聊天路径 `use-chat-actions.ts:210-225` 列为第一处；硬契约 :341 把“4 路径全覆盖”固化为不得重犯的条款；G4 实机正反取证（:361）恰好回归主路径。各 Plan 验收断言（:100,128,165,214,252,297,363）均有对应步骤支撑 |
| 2 | 每步是否有明确的验证检查点 | ✅ | A1~A3、B1~B5、C1~C5、D1~D3、E1~E3、F1~F5、G1~G4 每步均有可运行命令 + 预期结果。修订新增的检查点同样具体：E1 的 `grep -c "catch {" = 0` 与“失败分支无 setTimeout 重排”人工复核（:248）；G1 的“Renderer diff 恰好 3 文件”“五文件 grep 各至少 1 命中”“26 处 `apiKey:` 反向兜底三分类”（:349-351）。无空泛检查点 |
| 3 | 文件路径是否符合项目结构（AGENTS.md） | ✅ | 待修改文件全部存在（首轮已验 + 本轮抽验 `plugin-panel-qr.tsx`、`feishu-install.ts`、`channel-feishu-handlers.ts`、`channel-store.ts`、`ToolModule.cs`、`OpenAIChatHeaders.cs`、`OpenAIChatProvider.cs`、4 个 Renderer 发送路径文件、`provider-store.ts`、`provider-store-helpers.ts`、`sub-agents/builtin/index.ts`）；G 新增 3 个待修改 Renderer 文件（use-chat-actions / use-channel-auto-reply / project-send-message）均为既有文件；新增文件落点不变且正确（`tests/WishfulClaw.ProviderHeaderRegressionTests/` 与既有 4 个回归测试同构、`tests/WishfulClaw.ChannelToolVisibilityRegressionTests/` 同）。⚠️-3 缩写路径已全部展开 |
| 4 | 分层依赖是否正确 | ✅ | Plan G 仍只改 Agent 层 C#（`OpenAIChatHeaders.cs`/`OpenAIChatProvider.cs`，均属 `WishfulClaw.Agent`）+ Renderer，明确不给 Contracts 的 `IWorkerRequestContext` 加成员（:309,334）；扩围的 3 个文件全在 Renderer，不触 C# 分层。Plan D 只改 Agent 层 `availableModes` 字面量；E 只改 Renderer + Main 注释；F 纯 Renderer。无逆向依赖 |
| 5 | 是否参考了正确的源码文件 | ✅ | 首轮被证伪的 plan.md 旧 :307 断言已删除并重写为 :311-317 的 4 处盘点，本轮独立穷举验证全部命中（见第一节 (a)~(e)）；Plan E 修订新增的 :226（裸 catch）、:225（toast :259）与源码逐行一致；Plan A~F 其余引用沿用首轮实证 + 本轮 12 处抽验（updater.ts:202-203、ProjectToolsProvider :11,26,39,54,73、GlobalTaskToolsProvider :13,33,51,77,93,114,138、ToolModule :35-95、Anthropic :213 / Responses :248 独立 BuildDebugHeaders、AgentRuntimeRunState :29、provider.ts :303/:351、OpenCowork 预设数 39(41-2) vs WC 20(22-2)、opencode-go.ts :366 builtinId / :369 preset 级 `type:'openai-chat'`）无一失手 |

## 三、逐 Plan 复核

### Plan A：Release Notes 安全富文本 —— ✅

沿用首轮实证（`UpdateReleaseNotes.tsx` 现状、react-markdown/remark-gfm 已有、rehype-raw/sanitize 待装、新文件落点）。本轮复核：A3 证据指向 `download-observability-report.md`（:98）与 `evidence/release-notes-safe.png`（:98），plan.md 内 grep `upgrade-test-report` 0 命中（仅旧审查报告自引，非 plan.md）。

### Plan B：后台下载、托盘继续与明确安装 —— ✅

沿用首轮实证。抽验：`src/main/updater.ts` `configureUpdater` 内 `autoDownload = false`（:202）、`autoInstallOnAppQuit = false`（:203）与 §3.2 契约（plan.md:60）一致。§3.1/§3.2 硬契约、B1~B5 检查点未因修订变动。

### Plan C：下载可观测性（已按用户裁定收缩） —— ✅

沿用首轮实证。收缩声明三处一致（:8,:132,:370）；判定规则（:146-151）、临时降版不提交（:159）、未取证显式记录（:161）、验收断言明示安装版升级不在范围（:165）。无真实安装版升级测试**不是缺陷**（用户裁定）。

### Plan D：渠道会话开放项目/全局任务工具 —— ✅

沿用首轮全量实证。本轮抽验：`ProjectToolsProvider.cs` Category :11、`availableModes: new[] { "global" }` :26,39,54,73；`GlobalTaskToolsProvider.cs` Category :13、六处 :33,51,77,93,114,138；`ToolModule.cs` 全路径 :35-95 注册顺序（Push :65 / Register :66 / Pop :67 区域）——全部精确命中。修订未触碰 Plan D 文本，⚠️-3 的路径展开已落实（:189）。

### Plan E：飞书扫码绑定后自动启用并启动 —— ✅（修订后全部声明与源码一致）

见第一节 ⚠️-1 行的完整实证。补充核对：文件范围六动作 ①~⑥（:233）与微信路径逐项对等（patch features 保留既有开关的写法对应微信 :140-144 的 `?? true` 语义）；“明确不修改”（:237）与六动作无矛盾——动作 ⑤ 只改飞书 poll 的 catch 结构，不动微信 :171-180 的错误呈现 catch；硬契约 4 条（:241-244）覆盖假成功、吞异常、轮询终止、微信对等；E3 用户依赖诚实处理（:250,:254）。`feishu-install.ts` 仅改头注释（:234），首轮已证头注释与 `pollFeishuInstall`（:192-250）行为矛盾属实。

### Plan F：同步 OpenCowork 内置服务商预设（17 个） —— ✅

沿用首轮全量实证。本轮抽验：WC `stores/providers/` 22 个 .ts（20 预设 + index + types）、OpenCowork 副本 41 个（39 预设），差集 19 与排除 2 项后 17 个的名单一致；`opencode-go.ts`（OpenCowork 副本）:366 `builtinId: 'opencode-go'`、:369 preset 级 `type: 'openai-chat'` 精确命中（支撑 Plan G gate 与 F/G 依赖）。修订未触碰 Plan F 文本。

### Plan G：OpenCode Go 注入 x-opencode-session —— ✅（首轮 ❌ 根因已消除）

- C# 侧沿用首轮实证并抽验：`OpenAIChatHeaders.cs` `ApplyHeaders` :12-28 顺序（Bearer → ApiUserAgent.Apply → 可选 Org :17-20 → 可选 Project :21-24 → Overrides :26 → Ensure :27）与 `BuildDebugHeaders` :30-41；`OpenAIChatProvider.cs` :43 调 BuildDebugHeaders、:59 调 ApplyHeaders、:53 读 `providerId`、:54 读 `providerBuiltinId`；`ExecuteTurnAsync` 签名 :28-34 已带 `AgentRuntimeRunState state`；`AgentRuntimeRunState.cs:29` `public string SessionId { get; }`；Anthropic :213 / Responses :248 独立 BuildDebugHeaders（爆炸半径 1 个 Provider）。全部精确命中。
- Renderer 侧 4 处构造点、7 个调用点、3 处已带字段、fast-model 出范围裁决——本轮独立穷举全部成立（第一节 (a)~(e)）。
- 注入设计（:329-330）：overrides 之后 + `Contains` 判重 + `Ordinal` 精确比较，用户显式头优先且唯一，与 G3 断言（:354-359）一一对应。
- “明确不修改”（:334）与修改清单（:322-331）无矛盾：7 个调用点不改（改函数本体即覆盖）、3 个已带字段文件不改、fast-model 三文件不改、Contracts 不改——与 4 处修改点互斥且并集完整。
- 附带发现（`providerId`/`id` 命名不一致，:318）明确不修、记待办，处置得当。

## 四、横切专项

| 专项 | 判定 | 证据 |
|---|---|---|
| Plan G“明确不修改”vs 修改清单 & “恰好 3 个 Renderer 文件” | ⚠️ | 实质一致：4 处构造点分布于 3 个文件（use-chat-actions.ts 占 2 处），G1 的“diff 恰好 3 个文件”（:349）与修改清单（:323-326）自洽；不修改清单（:334）与之互斥无矛盾。**唯一措辞瑕疵**：:349 括注“`buildProviderPayload` 的 7 个调用点……不得出现在 diff 中”若按**文件**粒度解读会与 use-chat-actions.ts 在 diff 中相矛盾（7 个调用点中 4 个位于该文件）；按**行**粒度解读（不得在调用点各自拼 provider，:334 已有原话）则完全一致。见 ⚠️-2 |
| §6 总门槛完整性 | ✅ | plan.md:386-396 列全 6 个测试（`test:updater-release-notes`、`test:updater-state`、`test:updater-progress`、`ChannelToolVisibilityRegressionTests`、`ProviderHeaderRegressionTests`、`test:provider-presets`）+ 三套 tsc + `dotnet build` 0 错误 + D/G AOT 0 警告 + `npm run build` + `git diff --check` + C4 取证，与各 Plan 承诺一一对应，无缺漏无多余 |
| F→G 执行顺序 | ✅ | :383“F 必须先于 G”与 F 硬契约（:286）、G 硬契约（:343）三处双向声明一致；`opencode-go` 预设确由 F3 引入（本仓 providers/ 目录现无该文件），gate 依赖成立 |
| 证据产物路径一致性 | ✅ | `download-observability-report.md` 于 :98,141,158,163 一致；`evidence/` 7 个截图名（release-notes-safe / background-download / downloaded-awaiting-install / channel-project-tools / feishu-bind-autostart / provider-list-synced / opencode-go-session-header）在文件范围与步骤 Mini 验证中两两一致；plan.md 与 exploration_findings.md 内 grep `upgrade-test-report` 0 命中，无陈旧引用 |
| 用户依赖三步骤的诚实处理 | ✅ | E3（:250,:254 需真实飞书扫码）、F5 真实对话子项（:295 无 key 记“未做+原因”）、G4（:361,:365 无凭据记“待用户验证”，仅以 G3 单测为证）；§6 :397 统一规定三步未做整体最高 PARTIAL、不得冒充。G4 未因修订降低要求（仍正反两次取证 + 脱敏） |
| AOT 合规（AGENTS.md 10 条） | ✅ | §3.3 第 4 条（:69）+ G2（:352）对 D/G 要求 AOT 0 警告、禁反射/匿名类型 JSON/裸 JsonSerializerOptions；实质改动 AOT 安全：D 为数组字面量扩容，G 为 `TryAddWithoutValidation` + `JsonHelpers.GetString`（既有 API，OpenAIChatProvider.cs:53-54 已在用），无新增可序列化类型；两个新 C# 测试项目与既有回归测试同构（Exe + 单 ProjectReference） |
| plan.md 头部修订行准确性 | ⚠️ | :12“首轮独立复审判 BLOCKED（2 个 ❌ 同一根因……；1 个 ⚠️：Plan E 漏掉吞异常的裸 catch）”——❌ 计数与根因描述准确，但首轮报告实为 **3 个 ⚠️**（另两项：`IWorkerRequestContext` 漏列 `ConnectionCancellationToken`、三处路径缩写），且该 2 项也已在本版落实（:309、:189,:229）。“三处均已在本版修订”实为五处。见 ⚠️-1 |
| 大文件/耦合拆分约定 | ✅ | 修订未新增文件拆分需求；G 扩围只改 3 个既有文件各一处对象字面量，E 动作 ⑤ 在原文件内重构 catch 结构，均不触发 500 行拆分线 |

## 五、⚠️ 非阻断项（不阻断用户确认，可在执行前顺手修）

1. **⚠️-1（plan.md:12 修订行 ⚠️ 计数不准）**：头部写“1 个 ⚠️”，首轮报告实为 3 个 ⚠️（Plan E 裸 catch、`IWorkerRequestContext` 成员漏列、路径缩写），三项均已实际修复。建议把 :12 改为“3 个 ⚠️：Plan E 漏掉吞异常的裸 catch、`IWorkerRequestContext` 成员列举不全、三处文件路径缩写”并将“三处均已在本版修订”改为“五项均已在本版修订”。纯修订记录准确性问题，不影响任何步骤执行。
2. **⚠️-2（plan.md:349 括注措辞歧义）**：“`buildProviderPayload` 的 7 个调用点与已带字段的 3 个文件均不得出现在 diff 中”——7 个调用点中 4 个位于 `use-chat-actions.ts`（该文件因 :210-225 与 :385-399 两处修改**必然**出现在 diff 中），按文件粒度解读自相矛盾；按行粒度解读（不得在调用点各自拼 provider）则与 :334 一致且无歧义。建议改为“7 个调用点**所在行**不得被逐一改动（`buildProviderPayload` 函数本体的修改除外），已带字段的 3 个文件不得出现在 diff 中”。执行者按 :334 原话不会走偏，不阻断。

## 六、计数与最终判定

- ❌ 阻断项：**0**
- ⚠️ 非阻断项：**2**（见第五节，均为文字精度问题）
- 首轮 5 项遗留（2 ❌ + 3 ⚠️）：**全部已解除**（逐条实证见第一节）
- 五项检查项：5 ✅ / 0 ⚠️ / 0 ❌；横切专项 8 项：6 ✅ / 2 ⚠️ / 0 ❌

**最终判定：PASS。** Plan A~G 的目标覆盖、验证检查点、文件路径、分层依赖与源码引用全部实证通过；首轮唯一阻断根因（Plan G 发送路径盘点）已被独立穷举验证确认修复，修订未引入新的阻断级问题。依据 `docs/dev-workflow.md:238`（❌ > 0 禁止进入用户确认环节），❌ = 0，**plan.md 可进入用户确认环节**。两个 ⚠️ 建议在用户确认前顺手修订 plan.md:12 与 :349 措辞，不构成前置条件。

---

# 第三轮复审（仅针对 Plan D 修法变更）

- 复审对象：plan.md「Plan D：渠道会话按"特殊的 global 会话"统一工具可见性」（修法 B：`ResolveAvailableMode` 一处归一 channel → global）及 `exploration_findings.md`「追加项 1」。第一、二轮针对旧修法 A 的 Plan D 结论按 plan.md:13 声明作废，本节为全新独立复审。
- 复审方式：不采信计划文本与影响分析表，对 `src/runtime/` 全部 C# 与 `src/renderer|main|preload|shared` 全部 TS 逐点 grep + 逐文件读源码重新推导。
- 结论先行：**❌ 3 项、⚠️ 3 项，BLOCKED**。其中 ❌-1 是修法 B 与 `NormalizeRuntimeParameters` 的破坏性交互：**绑定项目的渠道会话在改动后每次运行必崩**，而计划把该消费点标注为"幂等/无影响"，且 D2/D3 的验证设计恰好都测不到它。

## 一、独立推导的 `sessionMode` 消费点全量清单

grep 范围：`src/runtime/**/*.cs`（`sessionMode|SessionMode` 命中 14 文件，其中 `DbModule.cs:166`、`DbPluginSessionTools.cs:39` 为 `SyncPluginSessionModels` 的子串误命中，非消费点）+ `src/{renderer,main,preload,shared}/**/*.{ts,tsx}`（`sessionModel*` 系列为误命中，已剔除）。"计划表覆盖？"列对照 plan.md:208-218 的影响分析表。

| # | 消费点（file:line） | 读/写 | 归一后行为 | 计划表覆盖？ |
|---|---|---|---|---|
| 1 | `AgentRunContextPolicy.cs:113,121,129,152`（`Resolve`，被 AgentLoop:150/:165、ToolCallProcessor:105、UseCapabilityExecutor:126、MemoryRecall:41 共 5 处调用） | 读 | 第 1 次调用（写回前）不变；**第 2 次及以后调用读到的是写回后的 `"global"`，channel 分支（:121）不再触发** → 对 renderer 发来 `scope:"project"` 的渠道会话，scope 解析结果从"强制 global"变为"project"，详见 ❌-1 | ⚠️ 部分覆盖：表内只写"`AgentLoop.cs:165-166` 第二次 Resolve/ResolveAvailableMode（**幂等**）"——该断言对绑定项目的渠道会话为**假** |
| 2 | `AgentRunContextPolicy.cs:164-182`（`ResolveAvailableMode`，改动点本体；调用方 AgentLoop:151/:166、ToolCallProcessor:117、UseCapabilityExecutor:127） | 读 | channel → "global"（目标效果） | ✅ |
| 3 | `AgentLoop.cs:56-62` conversationKey（读**写回前**原始 parameters） | 读 | 只比对 `"subAgent"`/`"goalSubAgent"`，channel 不受影响 | ✅ |
| 4 | `AgentLoop.cs:161-164` toolPreset 独立参数 | 读 | 第 1 层不变，仍 `channel` preset | ✅ |
| 5 | `AgentLoop.cs:168` `GetToolDefinitions(toolPreset, sessionMode)` + `ToolRegistry.cs:215-236`（:230 `Array.IndexOf`） | 读 | 目标效果：三症状修复 | ✅ |
| 6 | `AgentLoop.cs:203-206` `SystemPromptCache.ComputeKey(..., sessionMode, pluginId, externalChatId)`（`SystemPromptCache.cs:54,65`） | 读 | 渠道会话缓存 key 中 `channel`→`global`；因 pluginId/externalChatId 仍在 key 中，不与桌面全局串缓存，旧条目自然失效。**良性但属实际行为变化** | ❌ **未覆盖**（见 ❌-2） |
| 7 | `AgentLoop.cs:209` `includeSessionTodoPrompt = sessionMode != "global"` → `PromptBuilder.cs:96-98` `BuildSessionTodoPrompt()`（:344-354） | 读 | **渠道会话从此丢失 `<session_todo>` prompt 段**（改前 `"channel" != "global"` 为 true，改后为 false）。这是计划未声明的第三处 prompt 行为变更 | ❌ **未覆盖**（见 ❌-2） |
| 8 | `AgentLoop.cs:211` `PromptBuilder.Build(parameters=写回后)` → `PromptBuilder.cs:67-77` | 读 | 渠道会话新增 `<global_agent>`（`BuildGlobalAgentPrompt` 实际位于 :410-428，计划写 :410-422，见 ⚠️-3）。已声明的有意变更 | ✅ |
| 9 | `PromptBuilder.cs:61` + `:310-314` 本地 `IsChannelSession`（channelSession/pluginId/externalChatId/pluginChatId，不读 sessionMode） | 读 | `<channel_session>`（:316-331）保留 | ✅ |
| 10 | `ToolCallProcessor.cs:105` `Resolve(parameters)` + `:106-113` 按 `runContext.Scope=="project"` 提取 workingFolder/projectId/sshConnectionId | 读 | 绑定项目的渠道会话在改后此处 scope 变为 "project"（若未被 ❌-1 的 throw 先拦截，工具白名单会从 GlobalChatTools 换成 ProjectChatTools，create_session/send_session_message 与 6 个全局任务工具在第 3 层被拒） | ❌ **未覆盖**（表内只列了 :117 的 mode 复检；并入 ❌-1） |
| 11 | `ToolCallProcessor.cs:117` + `:150-157` 运行时 `IsAvailableInMode` 复检 | 读 | 目标效果 | ✅ |
| 12 | `ToolCallProcessor.cs:563` + `:589-593` 本地 `IsChannelSession`（只读 channelSession 布尔） | 读 | 渠道文件工具免审批特判保留 | ✅ |
| 13 | `AgentRuntimeUseCapabilityExecutor.cs:126-128` `Resolve`/`ResolveAvailableMode`/`IsChannelSession`（读 `state.Parameters`，已写回） | 读 | mode 归一生效；Resolve 受 ❌-1 同族影响 | ✅（:127 已列） |
| 14 | `AgentRuntimeUseCapabilityExecutor.cs:315-321` `call` gate `IsAvailableInMode` | 读 | 目标效果（代理恢复） | ✅ |
| 15 | `AgentRuntimeUseCapabilityDiscovery.cs:144-157`（:151）`list` gate | 读 | 目标效果 | ✅ |
| 16 | `AgentRuntimeUseCapabilityEncoding.cs:115-133`（:129）`inspect` gate `EncodeBuiltinInspectResponse` 同样调用 `IsAvailableInMode(name, sessionMode)` | 读 | 目标效果同向（inspect 恢复，D3 步骤 ② 明确依赖它） | ❌ **未覆盖**：计划正文只引 call（Executor:316-321）与 list（Discovery:150-152）两道 gate，inspect 这第三道 gate 全文未提（见 ❌-3） |
| 17 | `AgentLoop.MemoryRecall.cs:41` 只调 `Resolve` 取 scope | 读 | 全局渠道会话不变；绑定项目的渠道会话并入 ❌-1 | ✅ |
| 18 | `AgentLoop.Helpers.cs:117-160` `NormalizeRuntimeParameters` 写回（:140-143 覆盖、:151-153 补写）+ `AgentLoop.cs:153` `state.ReplaceParameters` | 写 | 写回属实，下游确实读到 `"global"`；**但计划只引 :140-143/:151-153，未提 :128 `omitProjectContext` 与 :135-138——渠道会话（scope 判为 global）的 `projectId`/`workingFolder`/`sshConnectionId` 被删除而 `scope:"project"` 原样保留**，这正是 ❌-1 的崩溃机制 | ⚠️ 部分覆盖（机制关键行未引，并入 ❌-1） |
| 19 | 写入方：`AgentRuntimeGlobalDispatchReplyExecutor.cs:132`（写死 "global"）、`Goal/GoalSubAgentExecutor.cs:101`（写死 "goalSubAgent"）、`SubAgentExecutor.Parameters.cs:77`（写传入的 subAgent/goalSubAgent，不继承父 channel） | 写 | 均非渠道路径，无影响（已逐一核实） | ✅ |
| 20 | Renderer 来源：`use-channel-auto-reply.ts:276`、`use-chat-actions.ts:251`（全仓 TS 仅此两处产生 `'channel'` 值，grep 复核成立）；类型联合 `use-chat-actions.ts:29`、`chat-store/index.ts:124`、`sidecar-mapping.ts:234`、`sidecar-protocol-types.ts:234`、`shared/hooks/types.ts:293`；透传 `sidecar-mapping.ts:337` | 写/类型 | Worker 侧归一不回传，Renderer 不需改动，成立。其余 sessionMode 写点（`project-send-message.ts:104` 'normal'、`cron-runtime.ts:491` 'normal'、`pet-agent.ts:194` 'chat'、`InputArea/index.tsx:271` goal/global/normal）均不产生 channel，不受影响 | ✅（类型声明处计划只引 sidecar-mapping.ts:234，其余 4 处为纯类型无行为，不计缺口） |
| 21 | `db/projects-list` 链路：`stores/chat-store/db-helpers.ts:588` → `DbModule.cs:26` | — | 独立 RPC，与 sessionMode 无关，计划声明属实 | ✅ |

## 二、发现项

### ❌-1（阻断）：修法 B 使"绑定项目的渠道会话"每次运行必崩，计划表却标注"幂等/无影响"，且 D2/D3 均检测不到

**事实链（全部实证）**：

1. 插件会话可以绑定项目：`DbPluginSessionTools.SyncPluginSessionProject`（`DbPluginSessionTools.cs:60-83`）把 `project_id`/`working_folder`/`ssh_connection_id` 写入带 `plugin_id` 的 session；`session-context.ts:29-34,67-73` 规定有 projectId 的会话 `scope='project'`。
2. 渠道发送路径会把它发出去：`use-channel-auto-reply.ts:270-276`（`session.scope === 'project'` 时携带 workingFolder/sshConnectionId/projectId，`scope: session.scope`，`sessionMode:'channel'`）；`use-chat-actions.ts:247-258` 同理。
3. **改前**：`AgentLoop.cs:150` 第 1 次 `Resolve` 走 channel 分支（`AgentRunContextPolicy.cs:121-126`）→ scope="global"；`NormalizeRuntimeParameters`（`AgentLoop.Helpers.cs:128,135-138`）因 scope=global **删除 projectId**，但 `scope:"project"` 属性原样保留，`sessionMode` 写回仍是 `"channel"`；`AgentLoop.cs:165` 第 2 次 `Resolve` 再次命中 channel 分支 → scope="global"，不抛异常。**现状能跑，靠的是每次 Resolve 都能重新识别 `"channel"`。**
4. **改后（修法 B）**：第 1 次 Resolve 不变；写回的 sessionMode 变成 `"global"`；第 2 次 Resolve（`AgentLoop.cs:165`）不再命中 :121 channel 分支，读到 `scope:"project"`（合法字面量，跳过 :127 推断）且 `projectId` 已被 :135-138 删成空 → 命中 `AgentRunContextPolicy.cs:134-136` → **`throw new InvalidOperationException("scope=project requires projectId")`**，整个 agent run 在进入 Provider 前失败。`ToolCallProcessor.cs:105`、`AgentRuntimeUseCapabilityExecutor.cs:126` 的 Resolve 同族。
5. 计划表（plan.md:206）声称"`AgentLoop.cs:165-166` 的第二次 Resolve/ResolveAvailableMode（**幂等**）"——对绑定项目的渠道会话为假：第一次与第二次 Resolve 的 scope 结果不同（global vs project→throw）。
6. **验证盲区**：D2 的 fixture `{"sessionMode":"channel","channelSession":true,"pluginId":"feishu","externalChatId":"oc_test"}` 不含 `scope`/`projectId`，走 :127 推断分支，测不到；D3 只要求"进入一个渠道会话"，若不特意选绑定项目的渠道会话也测不到。计划自己的验证步骤无法发现计划自己引入的回归——这与首轮 Plan G"4 处构造点只盘点 1 处"是同一类错误。
7. 计划硬契约（plan.md:236）把生产改动锁死在 `ResolveAvailableMode` 内，等于禁止顺手修 `Resolve`/`NormalizeRuntimeParameters`，矛盾无法在执行态内部化解。

**后果**：修法 B 按现稿执行后，飞书/微信里绑定了项目的渠道会话从"看不到项目工具"恶化为"完全无法对话"（每次请求抛异常）。修复方向（供修订参考，不代计划决策）：写回时同步归一 `scope`（用 rawRunContext.Scope 覆盖）、或让 Resolve 的 channel 判定改用 `channelSession` 布尔（与 IsChannelSession:184-188 同源，不依赖 sessionMode）、或 NormalizeRuntimeParameters 对渠道会话不删 projectId——任一方案都超出"只改 ResolveAvailableMode"的现有硬契约，Plan D 文件范围与 D2 断言（必须新增 `{"sessionMode":"channel","scope":"project","projectId":"p1",...}` 不抛异常且 scope 仍归一为 global 的用例）需要重写。

### ❌-2（阻断）：消费点清单遗漏 `AgentLoop.cs:203-213`——渠道会话静默丢失 `<session_todo>` prompt 段，属未声明的第三处行为变更

- `AgentLoop.cs:204` 把归一后的 sessionMode 传入 `SystemPromptCache.ComputeKey`（`SystemPromptCache.cs:54,65`）：缓存 key 从 `…|channel|<pluginId>|<externalChatId>|…` 变为 `…|global|…`。因 pluginId/externalChatId 仍在 key 中，不会与桌面全局会话串缓存，影响良性，但计划表未列。
- `AgentLoop.cs:209` `includeSessionTodoPrompt = sessionMode != "global"`：改前渠道会话为 true（注入 `BuildSessionTodoPrompt`，`PromptBuilder.cs:96-98,344-354`），改后为 false——**渠道会话的 System Prompt 少一段 `<session_todo>`**。计划通篇声明的附带行为变更只有两项（`<global_agent>` 注入、`Plugin*` 恢复可见，plan.md:13/:179），这是未声明的第三项；D3 的 prompt 断言只查 `<channel_session>` 与 `<global_agent>` 两段，检测不到该段的消失。
- 实质影响评估：`<session_todo>` 指引经 `use_capability` 调 Task* 工具，而 Task* 只在 `ProjectChatTools`（`AgentRunContextPolicy.cs:87-94`）不在 `GlobalChatTools`，渠道会话（scope=global）第 3 层本来就拒绝它们——即该段今天在渠道会话里本就是"指引了用不了的工具"，删除它方向上无害甚至更一致。**但"全量清点"表（plan.md:204-218 标题即"已全量清点"）漏掉了一个真实发生行为变化的消费点，且未把它列为有意变更供老大裁定**，按本轮审计口径为阻断项。修订成本极低：表内补一行 + 在"附带影响"里声明第三项变更（并说明其与第 3 层的一致性），可选地把 D3 prompt 断言扩为"不含 `<session_todo>`"。

### ❌-3（阻断，低危）：消费点清单遗漏 `AgentRuntimeUseCapabilityEncoding.cs:115-133` 的 `inspect` gate

- `EncodeBuiltinInspectResponse`（`AgentRuntimeUseCapabilityEncoding.cs:115-133`）在 :129 同样调用 `registry.IsAvailableInMode(toolName, sessionMode)`，是 `use_capability` 三道 gate（list/call/inspect）中的第三道。计划正文（plan.md:193）与影响表（plan.md:213）只引了 call（`AgentRuntimeUseCapabilityExecutor.cs:316-321`）与 list（`AgentRuntimeUseCapabilityDiscovery.cs:150-152`），全文未提 inspect；`exploration_findings.md:85` 同漏。
- 影响方向与 call/list 完全同向（归一后 inspect 恢复，是 D3 步骤 ②"成功 inspect 与 call 各一次"的直接依赖），无行为风险；但与 ❌-2 同理，"已全量清点"的表漏列了真实消费点。修订成本：表内补一行。

### ⚠️-1：D2 断言 `ResolveAvailableMode({"sessionMode":"subAgent"}) 返回 "subAgent"` 与源码不符，照写必挂

`AgentRunContextPolicy.cs:166` 先经 `Normalize`（:238 `ToLowerInvariant`），:169-170 直接返回归一小写后的字面量，实际返回 **`"subagent"`**（全小写），改前改后皆然。D2 按 plan.md:259 原文实现该断言会失败，并可能诱导执行者去"修"本不该动的生产代码。应改为断言 `"subagent"`（或注明大小写语义）。非阻断：属测试规格笔误，不涉及生产行为。

### ⚠️-2：D2"桌面全局会话不回归"断言（`GetToolDefinitions(BuiltIn["chat"], "global")` 与改前逐项相等）对所审改动零检测力

`ToolRegistry.GetToolDefinitions(preset, sessionMode)`（`ToolRegistry.cs:215-236`）是纯查表，从不调用 `ResolveAvailableMode`；本 Plan 的 diff 也不触及 ToolRegistry 与任何 Provider（D1 已用 `git diff --name-only` 钉死）。因此该"逐项相等"断言在修法 B 下**不可能失败**——基线可以取得（改前跑同一直接调用即可，非不可实现），但它检测不了它声称要检测的"桌面全局会话回归"。真正有检测力的是同步骤里 `ResolveAvailableMode({"sessionMode":"global"})=="global"`、`agent|chat→normal` 等映射断言（这些经过被改函数）。建议保留但降格注明，或改为对桌面全局 parameters 走 `Resolve`+`ResolveAvailableMode`+`GetToolDefinitions` 全链路的断言。非阻断。

### ⚠️-3：`BuildGlobalAgentPrompt` 行号引用偏差

plan.md:214 与 exploration_findings.md:89 引 `:410-422`；实际方法体为 `PromptBuilder.cs:410-428`（`<global_agent>` 模板 :413-426）。内容描述（跨项目全局产品经理 + use_capability 代理 + 6 工具名 + 派发/回复工作流）与源码逐条相符。纯引用精度问题。

## 三、逐项实证通过的部分（✅，摘要）

| 计划声明 | 核验结果 |
|---|---|
| `AgentRunContextPolicy.cs:121-126` channel→scope="global" + "specialized global session…distinct available-mode/tool policy" 注释 | ✅ 原文逐字相符 |
| `ResolveAvailableMode:164-182` 只做 agent/chat→normal，:169-170 直接返回 `"channel"`，永远走不到 :172-173 | ✅ |
| 症状 1：`ProjectToolsProvider.cs:17,30,43,58` 四工具 `new[]{"global"}`（category "project"） | ✅ 工具名与行号全部实核（:17/:30/:43/:58 为工具名行，availableModes 在 :26/:39/:54/:73） |
| 症状 2：`GlobalTaskToolsProvider.cs:33,51,77,93,114,138` 六工具 `new[]{"global"}`（category "global-task"） | ✅ 六处行号即 availableModes 行，逐一相符 |
| 症状 3：`PluginToolProvider.cs:26,40,54,61,75,84` 六工具 `["normal","goal","global"]`（category "plugin"） | ✅ 六处行号即 availableModes 行，逐一相符 |
| 第 3 层已放行：`SharedChatTools:55-85`（含 get_project_details:77、list_projects:80、list_installed_skills:79）、`GlobalChatTools:96-109`（含 create_session:99、send_session_message:105 与 6 个全局任务工具 :98-108）、`ChannelOnlyTools:29-53` 逐字含 6 个 `Plugin*`（:47-52）、`:200-201` channelSession 直通 return true、`:140-143` collaborationMode 强制 "chat" | ✅ 全部实核相符 |
| 代理路径同门：`AgentRuntimeUseCapabilityExecutor.cs:316-321`（call）、`AgentRuntimeUseCapabilityDiscovery.cs:150-152`（list）、`ToolRegistry.cs:87-98`（IsAvailableInMode，OrdinalIgnoreCase） | ✅（inspect gate 遗漏另计 ❌-3） |
| `channel` preset：`ToolPreset.cs:76-85`，AllowedCategories（:82-83）含 "project"/"plugin"，不含 cron/desktop/team/skill-management/global-task | ✅ |
| 不过度暴露：cron 6 工具（`CronToolProvider.cs:31-71`）、desktop 5（`DesktopToolProvider.cs:17-68`）、team 4（`TeamToolProvider.cs:16-62`）、skill-management 1（`SkillManagementToolProvider.cs:18-22`）availableModes 均含 "global"，category 均不在 channel preset → 第 1 层先丢 | ✅ 工具数量与 D2 点名的 CronAdd/CronCreate/CronUpdate/DesktopScreenshot/DesktopClick/DesktopType/TeamCreate/TeamStatus/TeamDelete/list_installed_skills 全部真实存在 |
| `"global-task"` 不进 preset 是有意设计：`AgentRuntimeUseCapabilityExecutor.cs:28-38` 注释 + ProxiedCategories 含 global-task/project/task 等 | ✅ |
| preset 取自独立参数 `toolPreset`（`AgentLoop.cs:161-164`），不由 sessionMode 推导 | ✅ |
| `IsChannelSession:184-188` 基于 channelSession/pluginId/externalChatId/pluginChatId，不读 sessionMode；PromptBuilder（:61,:310-314）与 ToolCallProcessor（:563,:589-593）各有本地实现 | ✅ 渠道专属行为不受归一影响成立 |
| 写回机制：`AgentLoop.cs:150-153` → `NormalizeRuntimeParameters`（`AgentLoop.Helpers.cs:117-157`，:140-143 覆盖、:151-153 补写）→ `state.ReplaceParameters` | ✅ 机制属实（但 :128/:135-138 的 omitProjectContext 副作用被计划忽略，构成 ❌-1） |
| D1 grep 基线：`availableModes` 计数 4/6/6/16（合计 32）、`grep -c '"channel"' AgentRunContextPolicy.cs` 改前 = 1 | ✅ 本机实测完全一致，命令可运行、断言可判定 |
| 测试基建：`tests/WishfulClaw.ToolConcurrencyRegressionTests/*.csproj`（net11.0/Exe/ImplicitUsings/Nullable/仅 ProjectReference Agent）、`Program.cs:13-27` try/catch 返回 0/1、`WishfulClaw.Agent.csproj:18-20` 三条 InternalsVisibleTo、sln 既有 `..\..\tests\...` 条目、`ToolModule.cs:65-67` PushCategory/RegisterTools/PopCategory 注册顺序 | ✅ 全部实核相符，D2 新测试项目同构方案可行（Agent 传递引用 Core，ToolRegistry/ToolPreset 可达） |
| 分层与 AOT：改动落在 WishfulClaw.Agent（不触 Core，不产生逆向依赖）；测试项目仅引用 Agent 属既有惯例；不引入反射/匿名 JSON/新序列化类型 | ✅ 符合 agents.md 分层约定与 AOT 规范 |
| `GlobalDispatchReplyToolProvider.cs` modes `["normal","goal"]`（:37），"明确不修改"清单成立 | ✅ |
| Renderer 不需改动：全仓 TS 仅 `use-channel-auto-reply.ts:276`、`use-chat-actions.ts:251` 两处产生 `'channel'`；`sidecar-mapping.ts:234`（类型）/:337（透传）属实 | ✅ |
| 与 plan.md 3.3/5/6 节及 exploration_findings 的一致性：3.3 门槛对 D 的 AOT 要求、5 节"Plan D 不做的事"、6 节 `dotnet run --project tests/WishfulClaw.ChannelToolVisibilityRegressionTests` 均与 D1-D3 一致，无内部矛盾（除 ❌-1 所述"幂等"断言与硬契约的矛盾） | ✅ |

## 四、五项检查项判定（dev-workflow.md:221-226，仅 Plan D）

| 检查项 | 判定 | 依据 |
|---|---|---|
| 步骤是否完整覆盖任务目标 | ❌ | D1-D3 覆盖了三个症状的修复与验证，但按现稿执行会引入 ❌-1 的新回归（绑定项目的渠道会话崩溃），且 D2/D3 的验证设计检测不到它——"完整可用"不成立 |
| 每步是否有明确的验证检查点 | ⚠️ | D1 检查点全部可运行可判定（grep 基线实测吻合）；D2 有一处断言与源码矛盾（⚠️-1 subAgent 大小写）、一处断言零检测力（⚠️-2）、缺 ❌-1 场景用例；D3 检查点可执行但缺"绑定项目的渠道会话"路径 |
| 文件路径是否符合项目结构（AGENTS.md） | ✅ | 所有引用路径实核存在且行号基本精确（仅 ⚠️-3 一处偏差 2 行）；tests/ 新目录符合既有回归测试布局 |
| 分层依赖是否正确 | ✅ | 生产改动仅 WishfulClaw.Agent；Core 零改动；测试项目仅引用 Agent（传递引用可达 Core 类型），无逆向依赖 |
| 是否参考了正确的源码文件 | ✅ | 三层过滤、Provider、白名单、写回链路的引用全部与真实源码对上；遗漏的 3 个消费点（❌-1/2/3）属清点不全而非引错 |

## 五、计数与最终判定（第三轮）

- ❌ 阻断项：**3**（❌-1 绑定项目的渠道会话必崩且计划标注"幂等"、验证测不到；❌-2 遗漏 `AgentLoop.cs:203-213` 消费点，`<session_todo>` 静默消失未声明；❌-3 遗漏 `AgentRuntimeUseCapabilityEncoding.cs:129` inspect gate）
- ⚠️ 非阻断项：**3**（⚠️-1 D2 "subAgent" 断言应为 "subagent"；⚠️-2 桌面全局基线断言零检测力；⚠️-3 BuildGlobalAgentPrompt 行号 :410-422 应为 :410-428）
- 其余实证：三层根因分析、三症状工具名/行号、channel preset、不过度暴露论证、grep 基线、测试基建方案、分层与 AOT、Renderer 零改动结论——全部 ✅

**最终判定：BLOCKED。** 依据 `docs/dev-workflow.md:238`（❌ > 0 时禁止进入用户确认环节），❌ = 3，**修订后的 Plan D 不得进入用户确认环节**。三个 ❌ 同源于一处方法缺陷：影响分析表自称"sessionMode 消费点已全量清点"，但既漏掉了两个真实消费点（`AgentLoop.cs:203-213`、`AgentRuntimeUseCapabilityEncoding.cs:115-133`），又对写回机制（`NormalizeRuntimeParameters` 的 omitProjectContext 删 projectId 而保留 scope）与二次 Resolve 的交互做了错误的"幂等"断言——后者会把"渠道会话看不到项目工具"修成"绑定项目的渠道会话完全无法运行"。建议修订方向：① 把 channel→global 的归一同时落到 `Resolve` 的输入侧或写回侧（如写回时以 rawRunContext.Scope 覆盖 `scope` 属性，或让 Resolve 的渠道判定改读 `channelSession` 布尔），并相应放宽"生产改动仅限 ResolveAvailableMode"的硬契约；② D2 增加 `{"sessionMode":"channel","scope":"project","projectId":"p1"}` 用例（断言不抛异常、scope 归一为 global、二次 Resolve 幂等）；③ 影响表补齐 #6/#7/#16 三行并把 `<session_todo>` 消失声明为第三项有意变更；④ 顺手修正 ⚠️-1/2/3。修订后需第四轮复审。

---

## 六、处置结果（老大 2026-09-08 裁定）

上文第三轮判定原文保留不改写，作为审计记录。逐项处置如下：

- **❌-1 —— 前提不成立，已排除（老大裁定）。** 老大明确："全局会话和渠道会话本质上都是全局会话，不会绑定项目。" 代码侧独立复核证实该裁定：
  - `src/main/channels/auto-reply.ts:177` 建渠道会话时 `projectId: null` 是**硬编码**，不存在带 projectId 的路径；
  - 故 `DbPluginSessionRouting.cs:42-47` 的 `requestedProjectId is not null` 恒为假，`project` 恒为 `null`，`:69` 的 `scope` 恒为 `"global"`、`:73-74` 的 `workingFolder`/`sshConnectionId` 恒为 `null`、`:151-153` 返回的 `ProjectId` 恒为 `null`；
  - 唯一能把 `project_id` 写进渠道会话的 `SyncPluginSessionProject`（`DbPluginSessionTools.cs:60-84`，注册为 `db/plugin-sync-session-project`，`DbModule.cs:167`）在 `src/renderer`/`src/main`/`src/preload`/`src/shared` 全量 grep 只有 `messagepack-channel-routing.ts:256` 的路由白名单一条命中，**没有任何调用方**；
  - 故 `use-channel-auto-reply.ts:143` 的 `scope: task.projectId ? 'project' : 'global'` 恒走 `'global'` 分支，复审构造的 `{"sessionMode":"channel","scope":"project","projectId":"p1"}` 入参形态在渠道路径上产生不出来。

  `NormalizeRuntimeParameters` 的不幂等性客观存在，但不可触发。按"不为不可能发生的场景加防御"的约定**不顺手修**，记入迭代收尾待办备查。**Plan D 维持单文件改法，不动 `AgentLoop.Helpers.cs`**；修订方向 ① 与 D2 的项目绑定用例一并作废。
- **❌-2 —— 属实，已修。** `AgentLoop.cs:203-213` 消费点已补入影响分析表；`:209` 的 `includeSessionTodoPrompt = sessionMode != "global"` 归一后为 `false`，已声明为**第三个有意的行为变更**（渠道会话不再注入 `<session_todo>`）。`:204-206` 的 SystemPromptCache 缓存键一次性变化经核为无害（`pluginId`/`externalChatId` 已计入键，不与桌面全局会话撞键）。计划中明确**禁止**为此在 `:209` 加 channel 分叉。
- **❌-3 —— 属实，已修。** `AgentRuntimeUseCapabilityEncoding.cs:128-130` 的 `inspect` gate 已补入，代理路径由两道更正为**三道**（`call`/`list`/`inspect`），D3 取证要求三道 gate 都实测。
- **⚠️-1/⚠️-2/⚠️-3 —— 均属实，已修。** D2 的 `{"sessionMode":"subAgent"}` 断言改为返回小写 `"subagent"`；桌面全局基线的零检测力断言替换为直接断言 `ResolveAvailableMode`；`BuildGlobalAgentPrompt` 行号更正为 `:410-428`。
- **第四轮复审 —— 老大裁定跳过，直接进入执行态。** 修订后的 Plan D 生产代码范围为**一个文件**：`src/runtime/WishfulClaw.Agent/AgentRunContextPolicy.cs`。
