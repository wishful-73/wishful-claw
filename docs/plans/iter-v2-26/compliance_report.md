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
