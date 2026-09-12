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

**一句话结论**：7 项需求里 6 项按口径达成；R-3 的"零行为变化"口径**实测不成立**，偏离面已量化为 8 格并交老大在收尾裁定（保留 or 回滚）。

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
- ⚠️ `ChannelInstance.tools` 整条主进程链零调用方（S-6），渠道级工具筛选实际仍走 `toolPreset + sessionMode`。

### R-3 工具可见性注册期声明（`6a6ceff2`）

- ✅ 机制层达成：`ctxStr` 单点渲染、`ToolVisibilityPolicy` 唯一判定入口、`VisibleScopes` 声明、`use_capability` 的 description/`list`/`call` 三载体同源。
- ❌（审查发现，已修）**金样摘要的档位标签名不副实**：13 个场景里有 3 个的场景 JSON 没带 `collaborationMode`，而 `AgentRunContextPolicy.Resolve` 对项目档缺省归一为 `cowork`——标签写 chat、跑的是 cowork，`ProjectChatTools` 整条分支从未进快照。补齐每档 `collaborationMode`、另留 `project:cowork-by-default` 钉住缺省归一，并补 `project:chat@subagent`、`global:chat@subagent` 两档，快照从 13 档/91 格扩到 **15 档 / 105 格**。
- ❌（审查发现，已修）**"零行为变化"这句未经复测就写进文档**：以 R-3 动手前的 `f9940a56` 开 worktree 取基线摘要逐格比对，实测 97 格逐字节相同、**8 格被收窄**（子 Agent 档的 `Browser*`）。相关口径已在 `plan.md` R-3.H 与 `raw-requirements.md` S-2/S-4 改写，"任一档位逐字节等价"这句话已撤回。
- ❌（审查发现，已修）**声明会腐烂却无人值守**：新增第 5 组 `RunDeclarationCensusSuite`——遍历生产注册表，逐条 `VisibleScopes` 模式与快照的 15 档做匹配，并断言每个声明了作用域的工具 `Evaluate(...) == Declared`，下界 `declaredTools >= 15`。有效性经**反证探针**确认：把 `*:channel@*` 误写成 `*:chanell@*` 后该套件立即失败，随后还原（`ToolVisibilityScopes.cs` 与 HEAD 字节一致）。
- ❌（审查发现，已修）`ToolVisibilityPolicy` 里 `IsVisible(ToolDefinition)` 重载零调用方，已删；测试桩里的匿名类型 `Schema()` 改为 `JsonDocument` 克隆，避免 AOT 口径下的坏示范。
- ⚠️ **第四个载体的漏口未修**（S-4）：`FilterToolDefinitions` 在 `!channelSession && BypassesChatAllowlist(context)` 时**原样返回**，cowork/goal/automation 三档因此绕过 `IsGloballyExcluded`。实测两处后果：`preset=full` + `project:cowork` 可见 22 个渠道专用工具；`project:cowork@subagent`/`@goalsubagent` 的直连集合里 9 个 `Browser*` 仍在，而同档 `use_capability` 已拒。修它属首次真正启用收窄，必须与差异表同批做。
- ⚠️ `IsCore` 字段已按 R-3.1 走通四处注册路径，但 `PromptBuilder.BuildToolCapability()` 未接线（R-3.7 ⛔），**当前只声明、无消费方**；`<tool_calling>` 段仍输出静态全 27 类。

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
