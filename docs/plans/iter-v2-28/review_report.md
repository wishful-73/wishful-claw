# 迭代 28 审查报告（Z1）

- 日期：2026-09-12
- 分支：`dev/v2-iter-28`（审查与验证期间**未 push**；Plan 全绿后按 AGENTS.md 一次性 push 本分支，合并 main / 打 tag / Release 仍留老大裁定）
- 基线：`main` @ `0388875e`
- 被审对象：7 个需求提交（`c7287b6e` #2、`f9940a56` #1、`6a6ceff2` R-3、`19dc9433` R-1、`fdce236f` #3、`231f1cd5` R-4、`3897f34d` R-2）+ 收尾未提交改动
  > 哈希说明：审查与验证产生的修正并成收尾那一刀后，R-1 的多余补口刀已按 `commit-tree` 重parent 折进 R-1 那一刀（见下文 R-1 节），因此 `56afafd5`/`c459bf6a`/`d8b08562`/`32c547d3`/`80ccb575` 五个哈希被改写为上表的四个新值；折叠前的整条链留在本地轻量标签 `pre-fold-iter28`（不 push）。折叠的证据分两段：折叠点本身 `git diff 80ccb575 3897f34d` 为 **0 字节**（折进一刀而内容零变化）；从 `pre-fold-iter28` 到最终 HEAD 的差异**只有本报告与 `verification_report.md` 两个文件**，即引用改写的必要修正，无任何代码或资产文件。`c7287b6e`/`f9940a56`/`6a6ceff2` 在折叠点之前，哈希不变。
- 规模：已提交部分 114 files / +8502 / −1511
- 审查方式：本会话自审（无人值守，未另起 subagent）＋ 三件机器门禁（可见性金样摘要、声明普查、IPC 路由清单）＋ 双向复搜（"不存在"与"已生效"都要重跑一遍宽模式检索）＋ **反证探针**（故意写错常量看门禁是否真的拦）

## 结论

| 级别 | 数量 | 状态 |
|------|------|------|
| ❌ 必须修 | 9 | **全部已修**，并入收尾 `fix(迭代28)` 提交 → 可进验证态 |
| ⚠️ 记账（不修，交裁定/后继） | 12 | 已写入本报告与 `plan.md` 对应步骤 |
| ⛔ 主动转后继需求 | 6（R-3.7 / R-3.9 / R-3.10 ＋ S-1…S-9 清单） | 已在 `raw-requirements.md` 文末登记，不得丢失 |

**一句话结论**：7 项需求全部达成——R-3 的 8 格收窄经老大裁定符合本意（收窄即目的，"零行为变化"非需求约束），余下 12 项 ⚠️ 记账与 6 项 ⛔ 转后继，均不阻塞。

> ⚠️ **本报告数字冻结在审查态（第一轮）**：老大随后又下了两条追加裁定，"8 格收窄"与"S-1…S-9 清单"均已被超越——R-3 最终为 **47 格等价 / 58 格收窄 / 0 格放宽**，S-4／S-7／S-8 已关闭、新增 S-10／S-11。**现网口径以 `verification_report.md` 与 `plan.md` R-3.I／R-3.J 为准**，本报告只作审查态的历史记录。

## 逐需求发现

### #1 模型请求日志与用量统计（`f9940a56`）

- ✅ 写入点定在 `ProviderRetryPolicy.ExecuteAsync` 重试循环，避免 Provider 层 `message_end` 丢掉失败请求——这条判断是本需求最关键的设计，已被 7 个写路径套件钉住。
- ❌（审查发现，已修）**面板 i18n 只接了一半**：`UsagePanel.tsx` 23 处 `t('usage.*')` 与 `UsagePanelParts.tsx` 的表头/tooltip 在 zh/en 两份 `settings.json` 里**都没有键**，英文界面会整块显示中文。已补齐两份 locale 共 65 行并给 `UsagePanelParts` 接上 `useTranslation`。
- ⚠️ **越线**：`UsageLogChecks.cs` 新建即 530 行 > 500。已按读写两侧契约拆为 `UsageLogChecks.cs`(321) + `UsageLogChecks.Queries.cs`(221)，同一 `partial class`，行为零变化（重建 0 警告 + 套件复跑通过）。
- ⚠️ **无保留策略**：`request_usage_logs` 只增不删，长期占用未评估。

### #2 更新弹窗与后台悬浮窗（`c7287b6e`）

- ❌（审查发现，已修）**记录在案的 sonner 参数是错的**：`updater-ui-issues.md` 写"桌面默认底距 16px、`z-index:9999`"，实读 `node_modules/sonner` 为 `VIEWPORT_OFFSET='24px'`（16px 是移动端那档）、`z-index:999999999`。抬高量 90 的推导不受影响，已按实测值改写并去掉会漂移的 `App.tsx:217` 行号。
- ⚠️ `#2.6` 老大目视复验未做，步骤保持 `[ ]`。

### #3 编辑器撤销遗留选中（`fdce236f`）

- ❌（审查发现，已修）**第一版修法不成立**：门控读的是 `selectionRef`，而"删除"那一步已把它同步成折叠光标，于是"选中→删除→撤销"本该保留的整段还原选区照样被收起。改为在 `beforeinput`（唯一还能读到未改动 DOM 的时机）用 `selectionWasExpandedBeforeMutation` 记下变更前选区是否展开，撤销时该标记为真则跳过 collapse，并在历史分支里**消费一次即清零**。
- ⚠️ `#3.3` 真机键入/输入法时序复验未做（agent 无法自主复验），步骤保持 `[ ]`。

### R-1 补位模型与三级解析（`19dc9433`）

- ✅ 三级解析（逐请求显式配置 → 补位模型 → 全局激活模型）落地，四个哑字段按裁定删除。
- ❌（审查发现，已修）`provider/complete` 的**解包契约**：Worker 侧 `success:false` 在渲染端是 **resolve** 而不是 reject，早期实现按异常路径处理会把它当成成功。已修正并补来源回归（收尾并入 `19dc9433`）。
- ✅ **提交粒度违规已消除**：原本多出的 R-1 补口刀（折叠前 `c459bf6a`）在收尾按 `git commit-tree` 重parent 折进 R-1 这一刀，**未动工作区**、不用 `rebase -i`；折叠点 `git diff 80ccb575 3897f34d` 为 0 字节，即整条链内容零变化、只是历史少了一刀。折叠前状态留在本地标签 `pre-fold-iter28`。
- ⚠️ `PersonaGeneratorDialog` 自诞生起无 UI 入口（`6ae15912` 只加了组件+store+Worker），R-1 修好了这条链的模型解析，用户仍点不到；`PersonaGenerator` 仍是绕开 Provider 层的第三套 HTTP 实现，只认 anthropic/OpenAI 兼容协议。
- ⚠️ `newSessionDefaultModel`（S-9）已声明、有默认、进 persist 白名单，**全仓零读取点**，不在老大点名的四项清单内故未删。

### R-2 渠道设置全局化（`3897f34d`）

- ❌（审查发现，已修）**读取失败会把"需授权"静默改成"免授权"**：IPC handler 以 `{ error }` 载荷报失败而非 reject，`{error}` 是 truthy，缺失的布尔按 OFF 渲染，下一次整对象写回就把 `shellRequiresApproval:false` 存进配置。修法三层——渲染端 `parseGlobalSettings` 校验八个键齐全否则抛错并置 `globalSettingsError`；Worker 端 `GlobalChannelSettingsStore.IsFullRecord` 拒收不完整/多余键的整对象写；`ReadShellRequiresApproval` 兼容旧数据时回落默认 true。UI 增加错误态与重试。
- ❌（审查发现，已修）**三个新通道没进 msgpack 路由白名单**：`agent:drain-sub-agent-notifications`、`plugin:settings-get`、`plugin:settings-set` 已在 `messagepack-channel-routing.ts` 补登记，并由新增 `tests/ipc-msgpack-routing`（96 断言 / 272 通道）钉住，防同类漏口。
- ❌（审查发现，已修）渠道自启动失败与后台子 Agent 报告排水失败都是**静默吞掉**，已补 `logError('main', …)` 与 `console.error`。
- ⚠️ `streamingReply` + `allowReadHome`/`readablePathPrefixes`/`allowWriteOutside`/`allowSubAgents` **五个字段仍无强制执行点**（S-5）。本次把"流式回复"的界面文案补上"仅记录设置，尚未接入强制执行"，与同面板已有的 `notEnforcedHint` 对齐；`readablePathPrefixes` 连输入项都没有。
- ⚠️ `ChannelInstance.tools` 是**只写不读**的死配置（S-6）：主进程侧整条链已接好（反向请求入口 `reverse-handlers/index.ts:153-158` → `channel-plugin-handlers.ts:169-171` → `channel-handler-utils.ts:271` → `channel-config-store.ts:51`），断点在 **C# Worker 侧零处发起 `plugin:tool-enabled`**，渠道级工具筛选实际仍走 `toolPreset + sessionMode`。修复成本是 Worker 侧补一次调用，不是重建链路。

### R-3 工具可见性注册期声明（`6a6ceff2`）

- ✅ 机制层达成：`ctxStr` 单点渲染、`ToolVisibilityPolicy` 唯一判定入口、`VisibleScopes` 声明、`use_capability` 的 description/`list`/`call` 三载体同源。
- ❌（审查发现，已修）**金样摘要的档位标签名不副实**：13 个场景里有 3 个的场景 JSON 没带 `collaborationMode`，而 `AgentRunContextPolicy.Resolve` 对项目档缺省归一为 `cowork`——标签写 chat、跑的是 cowork，`ProjectChatTools` 整条分支从未进快照。补齐每档 `collaborationMode`、另留 `project:cowork-by-default` 钉住缺省归一，并补 `project:chat@subagent`、`global:chat@subagent` 两档，快照从 13 档/91 格扩到 **15 档 / 105 格**。
- ✅（已修 + 已裁定）**"零行为变化"这句未经复测就写进文档**：以 R-3 动手前的 `f9940a56` 开 worktree 取基线摘要逐格比对，实测 97 格逐字节相同、**8 格被收窄**（子 Agent 档的 `Browser*`）。相关口径已在 `plan.md` R-3.H 与 `raw-requirements.md` S-2/S-4 改写，"任一档位逐字节等价"这句话已撤回。**老大 2026-09-12 裁定**：R-3 的本意就是收窄权限、把混乱的权限重新梳理清楚，"零行为变化"是 agent 规划时自设的步骤而非需求约束——故 8 格收窄**不构成偏离，保留不回滚**，R-3 判为达成。
  > **【2026-09-12 追加裁定后再复测，数字以此为准】**上句的 **97 格等价／8 格差异是收敛前的中间测量**，已被 R-3.I 的整体收敛重跑取代：**105 格 = 69 格逐字节等价 / 36 格收窄 / 0 格放宽**（差异分组与裁定出处见 `plan.md` R-3.I；比按时须把 `global:chat@automation` 与 `global:cowork@automation` 视为同一格改名，否则键集不平、凭空多 7 格差）。这次重跑同时暴露了 `raw-requirements.md` S-2 的两处失真（把 `project:cowork@subagent` 的 30 件误记成 `global:chat@subagent`，并称该档 `Edit`/`Write`/`Bash` 仍在——实测该档全 preset 均为 21 件且不含这三类），已在该文件就地修正。
- ❌（审查发现，已修）**声明会腐烂却无人值守**：新增第 5 组 `RunDeclarationCensusSuite`——遍历生产注册表，逐条 `VisibleScopes` 模式与快照的 15 档做匹配，并断言每个声明了作用域的工具 `Evaluate(...) == Declared`，下界 `declaredTools >= 15`。有效性经**反证探针**确认：把 `*:channel@*` 误写成 `*:chanell@*` 后该套件立即失败，随后还原（`ToolVisibilityScopes.cs` 与 HEAD 字节一致）。
- ❌（审查发现，已修）`ToolVisibilityPolicy` 里 `IsVisible(ToolDefinition)` 重载零调用方，已删；测试桩里的匿名类型 `Schema()` 改为 `JsonDocument` 克隆，避免 AOT 口径下的坏示范。
- ✅（追加裁定后已修）**第四个载体的漏口**（原 ⚠️ / S-4，现已关闭）：`FilterToolDefinitions` 曾在 `!channelSession && BypassesChatAllowlist(context)` 时**原样返回**，cowork/goal/automation 三档因此绕过 `IsGloballyExcluded`。当时实测两处后果：`preset=full` + `project:cowork` 可见 22 个渠道专用工具；`project:cowork@subagent`/`@goalsubagent` 的直连集合里 9 个 `Browser*` 仍在，而同档 `use_capability` 已拒。**老大 2026-09-12 追加裁定后按 R-3.I 整体收敛修掉**：`BypassesChatAllowlist`、`IndependentRuntimeRoles`、原样返回短路三者均已不存在，6 张中心名字表（含 `SharedChatTools`/`ProjectChatTools`/`GlobalChatTools`/`ChannelOnlyTools`/交互黑名单/proxy 名字表）全部删除，准入改由逐工具 `VisibleScopes`/`ExcludedScopes` 声明裁决，判定对 105 格每一格都执行。上述两处漏口逐格复测**均已收口**（差异表组① 的 −22、组② 的 −9），四载体同源同裁对直连侧同样成立。改动面、普查硬约束与 36 格差异见 `plan.md` R-3.I。
- ⚠️ `IsCore` 字段已按 R-3.1 走通四处注册路径，但 `PromptBuilder.BuildToolCapability()` 未接线（R-3.7 ⛔），**当前只声明、无消费方**；`<tool_calling>` 段仍输出静态全 27 类。
- ✅（最终追加裁定）`Bash` 已通过自身普通声明设为 `IsCore=true` + `VisibleScopes=Everywhere`，没有在 preset、准入策略或执行路由中增加名字特判。15 个运行场景逐一断言全可见；现有 `full/chat/coding` 三个 preset 的 24 格新增 `Bash`，其余不含 shell category 的 preset 保持原样。

### R-4 使用指引与 README 拆分（`231f1cd5`）

- ❌（审查发现，已修）**搬移丢块**：旧 README 的「💻 Tech Stack」表与「📦 数据持久化」小节在拆分时既没留下也没搬走。已在 `docs/development.md` 按实测补回（技术选型逐项对 `package.json`/`csproj`；持久化按 22 张业务表 + `memory_fts` 虚拟表（`DbClient` 去重 23 条建表语句）与 Markdown + JSON 三类载体，并指向已有的 `docs/data-storage.md`）。表数取证口径与启动日志 `43 tables` 名不副实的修正见 `plan.md` R-4「审查补口」第 1 条。
- ❌（审查发现，已修）**徽章过期**：README 与 `docs/development.md` 都还写 Electron 35，实际自 `8c6d8f93` 起就是 `electron ^43.2.0`（已安装同为 43.2.0），两处改 43。
- ❌（审查发现，已修）**指引第 10 节描述了不存在的东西**：原文"绑定一个项目会话"——`ChannelInstance.projectId` 是死字段（创建写 `null`，还有迁移主动清空历史值），真实路由是 `plugin:{pluginId}:chat:{chatId}` 自动开专属会话。整节按现状重写（含入口布局、扫码绑定仅微信/飞书、全局三选项卡各自的生效面）。
- ⚠️ `AGENTS.md` 与 `docs/project-plan.md` 里的 Electron 35 **未动**——前者是老大的常驻指令文件，不擅自改。
- ⚠️ R-4.5 配图**未做**（公开仓库 + 整桌面截图 + 清场只能本人做），停在门前，10 处落点清单已写进 `user-guide.md` 文末。

## 规范符合性核对

| 项 | 结论 |
|----|------|
| 分层单向依赖 | 未引入逆向依赖；新增类型均落在本层（Core/Infrastructure/Agent） |
| AOT 九条 | 新增 DTO 全部具名并注册 `InfrastructureJsonContext`（含 `List<T>`），`WorkerResponse.Json` 显式传 `JsonTypeInfo`；无反射扫描、无匿名类型序列化；`publish-aot-worker` 0 警告 |
| 硬编码路径/密钥 | 本迭代 diff 内 `src/` 无绝对用户路径、无凭据字面量 |
| 错误处理 | 审查期补的正是三处静默失败（渠道设置读、渠道自启动、子 Agent 报告排水）；`parseGlobalSettings` 走"报错并显式呈现"而不是"默认值兜底"，与"修根因不加逃生舱"一致 |
| 新增依赖 | 无 |
| 大文件 >500 行 | 本迭代把 3 个文件推过线：`UsageLogChecks.cs`(530，已拆) / `channel-plugin-handlers.ts`(508) / `FileAwareEditor.tsx`(510)。后两个**未拆**并在此记账——两者分别是 IPC 注册表与自带 `beforeinput`/`input`/`paste` 时序的 contenteditable 组件，按 AGENTS.md 例外条款（高度内聚、拆出需大量 ref/state 搬运）判定，且紧邻一次已验证的行为修复，收尾前不宜再动 |
| i18n | 审查期补齐 `usage.*` 双语；新 UI 串均带 `defaultValue` 且 locale 有键 |
| 提交粒度 | **达成**：收尾后 `main..HEAD` = 7 个需求提交 + 1 个收尾 `fix(迭代28)` 提交。原本多出的 R-1 补口刀已用 `git commit-tree` 重parent 折叠（不用 `rebase -i`、不动工作区），折叠点 `git diff 80ccb575 3897f34d` 为 0 字节 |
| `tests/**` 类型覆盖 | ⚠️ 没有任何 `tsconfig` 覆盖 `tests/`，`npx tsc` 三配置**测不到测试代码**；`test:cron-integration` 是死脚本（`tests/cron-integration` 已不存在，C# 侧 `WishfulClaw.CronRegressionTests` 取代），`pretest:e2e`/`test:e2e` 指向不存在的 `tests/e2e` |
| 解决方案成员 | ⚠️ `WishfulClaw.CronRegressionTests` 与 `WishfulClaw.MemoryRecallRegressionTests` 在盘上、被 git 跟踪，却**不在 `WishfulClaw.sln` 里**，`dotnet build` 整解决方案不会编到它们（本次单独构建运行，42 / 18 断言均通过）。加入 sln 属构建配置变更，未擅动 |

## 已并入收尾提交的修正

代码：`FileAwareEditor.tsx` + `file-aware-editor-undo-selection.ts`（#3 根因）、`channel-store.ts` + `GlobalChannelSettings.cs` + `GlobalChannelSettingsService.cs` + `channel-plugin-handlers.ts` + `use-background-subagent-wakeup.ts` + `messagepack-channel-routing.ts`（R-2 失败面）、`UsagePanel.tsx` + `UsagePanelParts.tsx` + zh/en `settings.json` + `plugin-panel-global.tsx`（i18n 与未生效提示）、`ToolVisibilityPolicy.cs`（删死重载）、`ToolDeclarationChecks.cs` + `VisibilitySnapshot.cs` + `visibility-snapshot.expected.txt` + `UsageLogChecks*.cs`（金样/普查/拆分）、`ChannelShellApprovalRegressionTests/Program.cs`、`package.json`（两个新测试脚本）、`tests/ipc-msgpack-routing/`（新增）。
文档：`README.md`、`docs/development.md`、`docs/user-guide.md`、`docs/plans/iter-v2-28/{plan,raw-requirements,updater-ui-issues}.md` + 本报告与 `verification_report.md`。

---

## 独立复审（2026-09-12，R-3 专项）

- 触发：老大要求"审查 28 迭代，特别是 R-3"，并复述 R-3 的目的——**"拿工具时都要把当前自身的情况组合成类似 `project:cowork@subagent` 的串，再做统一过滤"**。
- 口径：以这句话为验收标准反查代码，不看文档结论。方式为纯静态复读（本环境 `dotnet build` 当时因 NuGet 路径解析失败跑不起来，见文末"本次未做的取证"——**该障碍已于当晚解除并更正**，但本节结论不依赖构建）。
- 结论：**准入判定这一半达成了，且做得干净；"都"这个字还没做到——六条取工具出口里三条旁路。**

### 一、逐出口核对（对照上图）

| 出口 | 落点 | 过统一判定 |
|---|---|---|
| 直连工具集 | `AgentLoop.cs:168-170` | ✅ |
| `use_capability` description | `AgentRuntimeUseCapabilityDiscovery.cs:188-204` | ✅ |
| `use_capability` `action=list` | 同文件 `:260-277` | ✅ |
| `use_capability` `action=inspect` | `AgentRuntimeUseCapabilityEncoding.cs:129` | ✅ |
| `use_capability` `action=call` | `AgentRuntimeUseCapabilityExecutor.cs:310` | ✅ |
| 工具执行时二次准入 | `ToolCallProcessor.cs:152` | ✅ |
| **系统提示词 `<tool_calling>`** | `PromptBuilder.cs:242-259` | ❌ 静态全 27 类（= S-1，已知） |
| **IPC `tool/list`** | `ToolModule.cs:80-114` | ❌ 只按 preset |
| **`provider/complete` 的 `tools`** | `ProviderCompletionService.cs:221-253 / 275-300` | ❌ 直写 provider body |

四条 proxy 出口共用 `IsProxyBuiltinVisible` 一个谓词、`RenderContext` 除自身外零调用点（实测 grep），这两条**属实且干净**。

### 二、本次新发现（文档里没有的）

**F1 ⚠️ `tool/list` 是第二套工具真源，且不在判定内 —— 建议本轮收口**
`ToolModule.cs:80` 返回 `registry.GetToolDefinitions(preset)`，**无 `FilterToolDefinitions`**；渲染端 `lib/tools/tool-cache.ts` 把它缓存后经 `sidecar-mapping.ts:319` 塞进 `agent/run` 请求的 `tools`。**而 Worker 根本不读这个字段**——`AgentRuntimeTools.cs` 无任何 `tools` 引用、`AgentLoop.cs:168` 从注册表重建，全仓 `grep '"tools"'` 在 agent 路径零命中（命中的都是 Provider 输出侧与 MCP manifest）。故**现状无害，但它是"一条没人过滤的工具清单 + 一段没人读的载荷"**。一旦将来有人让 Worker 尊重 `parameters.tools`（例如为了省一次注册表遍历），旁路立刻变成真漏口。二选一：删掉请求里的 `tools`，或让 `tool/list` 也走同一个谓词。

**F2 ⚠️ `provider/complete` 不设防**
`ProviderCompletionService.cs` 把调用方给的 `tools` 数组原样写进 OpenAI/Anthropic 请求体，不经注册表、不经判定。当前唯一调用方（`lib/prompt-optimizer/optimizer.ts:101`）不传工具，所以没炸。但它是"拿工具"的第五条路，与"统一"口径不符。

**F3 ❗ 后台无人值守档仍看得见交互三件 —— 已裁定并修复（R-3.K）**
修复前实测金样：`grep "^  project:cowork@automation" visibility-snapshot.expected.txt` → 含 `AskUserQuestion`、`ExitPlanMode`、`visualize_show_widget`（修复后这三件在该档全部消失，见 R-3.K 的 8 格差异表）。
成因：`AgentRunContextPolicy.cs:68-71` 把 `runtimeRole=="automation"` 归一成 `collaborationMode="cowork"`，于是串是 `project:cowork@automation`；交互三件声明 `HumanAttended = ["*:chat@*","*:cowork@*"]`（`ToolVisibilityScopes.cs:46`），`*:cowork@*` 照样命中。这正是 R-3.D 收窄 5 ③ 要挡的（"后台无人可答，会挂住"）。
> **【更正：本报告初稿的结论有一处说错了】** 初稿写"要表达『后台不行、会话内定时任务行』必须落到 role 粒度，**改声明值解决不了**"。**这句话对"只用白名单"成立，对"黑名单"不成立**——`ExcludedScopes` 本身就是声明，veto 在 `ToolVisibilityPolicy.IsVisible` 里排在 grant 与默认可见之前（`:96-106`），所以只加一个排除字段即可，不必把 role 枚举进白名单，判定代码一行不用动。老大当日据此裁定走黑名单，已按 **R-3.K** 落地（`ToolVisibilityScopes.NoHumanToAnswer = ["*:*@automation", "*:channel@*"]`，三件各挂 `ExcludedScopes`），金样 **8 格收窄、0 放宽**。
> 顺带纠正另一处：`ExitPlanMode` 声明的**不是** `HumanAttended` 而是 `WorkRunsOnly`（`PlanToolProvider.cs:48`）——`plan.md` R-3.8 的 R-3.I 修正里"三件各自在注册点带这个形状"与代码不符（只有两件是），已就地更正。channel 那一半则**本就已被白名单形状挡住**（`global:channel` 7 格全等价），加进黑名单属冗余但显式的兜底。
> **【R-3.M 当日扩围收口】** 老大同日再裁两条：① 计划族**收全族**（`EnterPlanMode`／`SubmitPlanReview`／`UpdatePlanStep` 一并挂 veto，不再只挂 `ExitPlanMode`，消除了 R-3.K 新造的计划族内部不对称）；② **子 Agent 需要排除**（老大：「子 agent 需要排除，因为子 agent 其实类似后台执行」），`NoHumanToAnswer` 的角色轴改为直接取 `UnattendedRoles`，`@subagent`／`@goalsubagent` 一并纳入。累计收窄 **27 格**、0 放宽；三类无人档位（`@subagent`／`@goalsubagent`／`@automation`）与六件交互面工具（计划四件 + 交互两件）的交集**残留实测 0**。金样 112 行 / **24,557 B**。**S-2 ② 与 S-13 的剩余问题全部关闭。**
> 一处实读发现留档：计划族对子 Agent 的排除在当前档位组合下是**防御性**的——四件都声明 `availableModes: ["normal"]`，而子 Agent 档的 `AvailableMode` 是 `subagent`（`AgentRunContextPolicy.cs:97-98`），故它们在子 Agent 档本就不进 preset 可见集（脚本实测：16 格 subagent 变更的减项全是 `AskUserQuestion`／`visualize_show_widget`，一件计划工具都没减掉）。这条 veto 的价值在于**不依赖 `availableModes` 这个间接闸门**。

**F4 ⚠️ 两条渲染端影子清单，其中一条与声明语义直接冲突**
`translate-agent-service.ts:21 TRANSLATION_TOOLS`、`pet-agent.ts:65 PET_AGENT_TOOLS` 是渲染端手写工具定义，同样被 Worker 忽略。更要紧的是**语义冲突**：翻译的系统提示词明确要求模型调 `Write()`/`Edit()` 写缓冲区（`translate-agent-service.ts:124,149,178,193`），而 `Write`/`Edit` 现声明 `WorkRunsOnly`（`FileWriteTool.cs:24`、`FileEditTool.cs:23`），在 `global:chat@translation` 下**不可见**；改前 `translation` 在 `IndependentRuntimeRoles` 里全放行所以是通的。目前不炸只因 `agentMode` 恒为 false（`setAgentMode` 全仓零调用）、宠物也无线程入口——**死代码里的定时炸弹**。`plan.md` R-3.I 把这几格的理由写成"翻译只需要读+回文本"，**与代码事实不符**，建议就地改口径并立后继（接真 agent 翻译时须给 `Write`/`Edit` 补 `*:chat@translation` 形状，或把 translation 归到 cowork）。

**F5 口径：目前只统一了"准入轴"，工具清单实际由四层决定**
`ToolPreset`（类别白/黑名单）→ `availableModes` → `VisibleScopes/ExcludedScopes` → **两个按名字的功能开关**（`AgentLoop.cs:179` 的 `WebSearch`/`WebFetch`、`:190` 的 `codegraph_` 前缀），后两者在统一判定**之后**执行。文档已分别记为 preset 轴 / S-11，但对外表述不能越界：准确说法是"**准入判定**轴已单点"，不是"工具可见性已收敛为单一机制"。

**F6 判定细节两处（小）**
① `IsVisible` 每次调用都重渲 `ctxStr`（`ToolVisibilityPolicy.cs:94`），`FilterToolDefinitions` 对约 100 件工具即约 100 次重渲；功能无误，纯开销，可在 `FilterToolDefinitions` 里渲一次传下去。
② `IsToolAllowed` 在 `registry is null` 时 **fail-open（全可见）**（`:146-148`）。AgentLoop 那条路 registry 为 null 时 `toolDefs` 本就为空所以不炸，但这是"传错参数即静默全开"的形状，值得加断言。

### 三、做得好的地方（留档）

- `ctxStr` 只有 `RenderContext` 一处生成，除自身外零调用点。
- 两个策略文件 `HashSet<string>` 零命中（实测只剩 `Discovery:137` 的局部累加器与 `Executor:32` 的类别级 `ProxiedCategories`，都不是工具名表）。
- 声明普查是**硬约束**：未声明即红、死串即红、自身声明致不可达也红（`ToolDeclarationChecks.cs:38-76`），且有反证探针记录。
- 105 格金样 + worktree 取基线的方法是可复用的取证手段。

### 四、建议处置

| # | 项 | 建议 |
|---|---|---|
| F1 | `tool/list` 旁路 | 本轮收口（删载荷或接判定），二选一即可，改动小 → **已立 S-12** |
| F2 | `provider/complete` 旁路 | 本轮加一句判定，或明确记为"非可见性路径" → **已立 S-12** |
| F3 | automation 档交互三件 | 原建议"承认它（改文档口径）或调形状到 role 粒度"→ 已立 S-13；**老大当日裁定改走黑名单 → 已落地 R-3.K，并由 R-3.M 扩围（计划族收全族 + 子 Agent 排除），S-13 与 S-2 ② 全部关闭** |
| F4 | 翻译/宠物影子清单 | 改 `plan.md` R-3.I 那格的理由，并立后继需求 → **已立 S-14，文档已更正** |
| F5 | 表述口径 | 文档里"统一"限缩为"准入判定轴" → **已写进 `plan.md` R-3.I 与 `raw-requirements.md`** |
| F6 | 渲染开销 / fail-open | 顺手改，非阻塞 |

**复审结论回填的文档改动**（无代码改动）：`plan.md` R-3.I「未做与遗留」新增四条（组④ 更正 / S-12 / S-13 / 口径收紧）；`raw-requirements.md` 后继需求登记新增 S-12／S-13／S-14 三行；`verification_report.md` §5 目视配方的"翻译"一条就地更正。

**后续两批已含代码改动**（不在上句范围内）：R-3.K（`ToolVisibilityScopes.NoHumanToAnswer` + 三注册点 + 金样 8 格）与 R-3.M（常量角色轴改取 `UnattendedRoles` + `PlanToolProvider` 三件补 veto + 金样再 19 格）。**两批已于 2026-09-12 晚补编译并跑测试通过**（解决方案 0 警告 0 错误；`ProviderHeaderRegressionTests` `checks passed`，含金样 `AssertMatchesGolden`；`ChannelToolVisibilityRegressionTests` `passed (108 assertions)`）——金样虽为脚本重算，但已被机器断言确认自洽。详见 `plan.md` R-3.K／R-3.M 末条与 `verification_report.md`。

### 五、本次未做的取证（如实，**结论已更正**）

> **⚠️ 本节记录的障碍已于 2026-09-12 晚解除，见下方更正。**

原记录：`dotnet build src/runtime/WishfulClaw.sln -c Release` 在本会话**跑不起来**：NuGet 报 `Value cannot be null. (Parameter 'path1')`（`NuGet.targets(796,5)`，15 个项目全中），`--no-restore` 则转为 `NETSDK1060 读取资产文件时出错`。加 `HOME`/`USERPROFILE`/`NUGET_PACKAGES` 显式 Windows 路径、以及关沙箱重试均同样失败，判断为本会话环境问题而非代码问题。因此**本报告结论为静态复读所得**。

**更正（2026-09-12 晚）**：根因是 bash 会话**不继承 Windows 核心环境变量** —— `APPDATA` 为空，使 NuGet 在 `Settings.LoadUserSpecificSettings` 里走到 `Path.Combine(path1, null)`。当时补的是 `HOME`/`NUGET_PACKAGES`，**补错了变量组**，故误判为不可解。手动 export `APPDATA` / `LOCALAPPDATA` / `SystemRoot` / `windir` / `ComSpec` / `ProgramData` / `DOTNET_ROOT` 并把 `D:\claw\dotnet-sdk` 加进 `PATH` 后，构建与测试**均正常**：

- `dotnet build src/runtime/WishfulClaw.sln` → 15 项目 **0 警告 0 错误**
- `dotnet run --project tests/WishfulClaw.ProviderHeaderRegressionTests` → `checks passed`
- `dotnet run --project tests/WishfulClaw.ChannelToolVisibilityRegressionTests` → `passed (108 assertions)`

**但这不改变第一至四节的结论**：它们是对"六条取工具出口是否统一走判定"的代码推理，与能否编译无关。恢复构建后补跑的，只是 R-3.K／R-3.M 两批代码改动的门禁。
