# v2-iter-26 探索结论

## 当前状态

- 分支：`dev/v2-iter-26`，基线 `v0.2.25` / `5625d363`。
- 本阶段只读核验了 Electron 更新、托盘、Preload、Renderer 和发布配置；未修改功能源码。
- `electron-updater@6.6.2` 已接入，`autoDownload=false`、`autoInstallOnAppQuit=false`。

## 当前实现与关键文件

- `src/main/updater.ts`：持有 `autoUpdater`、single-flight check/download promise、更新状态和 `quitAndInstall()` 唯一现有调用点；当前进度事件只发送 percent。
- `src/main/index.ts`：持有主窗口与托盘；窗口 close 在非退出状态下 hide；托盘目前只有“显示主窗口/退出”；更新 IPC 使用通用 MessagePack handler。
- `src/preload/index.ts`、`src/preload/index.d.ts`：已有通用 `window.api.invoke/on`，足以承载新增更新事件，无需扩展 Electron 暴露面。
- `src/shared/updater/types.ts`：当前状态仅有 phase、版本、releaseNotes、percent 和 error，缺操作标识、字节、速度、耗时和声明包大小。
- `src/renderer/src/hooks/use-app-updater.ts`：监听 available/progress/downloaded/error，并在挂载时读取 `update:status`；这可以作为 Renderer 重载后的恢复机制。
- `src/renderer/src/App.tsx`：顶层挂载更新弹窗，适合放置跨 splash/main/settings 的常驻横幅并监听托盘恢复事件。
- `src/renderer/src/components/updater/UpdateReleaseNotes.tsx`：使用 `<pre>{notes}</pre>`，是 Atom HTML 标签裸显的直接原因。
- `electron-builder.yml` / `dev-app-update.yml`：正式与开发更新源均为 GitHub。开发态取证走 `dev-app-update.yml`，不需要隔离构建副本或 localhost generic feed；障碍是 `app.getVersion()` 读 `package.json`，本地版本不低于线上 Release 时检查不到更新，需临时降版本号触发（取证后还原、不提交）。

## Release 资产与差分事实

- v0.2.25 `latest.yml` 声明完整安装包为 127,316,506 bytes；Release 包含 EXE、latest.yml 和 blockmap。
- v0.2.24 安装包约 127,352,200 bytes，与 v0.2.25 大小接近；远端 EXE 支持 HTTP Range。
- `NsisUpdater` 默认优先差分下载，失败后回退完整 EXE；原生日志可出现 `Full` 与 `To download`。
- 现有日志缺少目标升级对应的 `Full / To download / transferred`，所以“数秒完成”只能视为差分或缓存命中的合理迹象，不能当作模式已实测。老大已确认本迭代不复现该升级，故 24→25 固定记为“未确定”；Plan C 的价值在于让后续任何一次真实下载都留下可判定证据。

## Reasonix 可借鉴范围

- 借鉴：常驻状态入口、字节级进度、操作标识与 expectedVersion、错误恢复、用户明确安装。
- 不借鉴：Go/Wails 自研 updater、自定义 manifest、长期 CDN fallback、独立后台服务、签名服务和强制自动安装。

## 主要风险与约束

1. `downloadUpdate()` 当前 IPC 等待完整 promise；若要点击后立即收起弹窗，Main 必须改为启动后确认、后台 promise 自行处理终态。
2. 原生 progress 事件不携带业务 operationId；必须依靠 Main single-flight 与 expectedVersion 约束，不能让失败重试后的旧事件覆盖新状态。
3. `update-downloaded` 不能触发安装；`quitAndInstall()` 必须保持只有用户按钮调用的一条路径。
4. 主窗口隐藏不会终止 Main，下载可继续；托盘“退出”会结束进程，26 不承诺退出后继续。
5. 真实安装版旧→新升级验证已移出本迭代范围（老大 2026-09-08 确认暂缓）。因此安装期行为（安装成功、失败回退、磁盘空间不足、升级前后用户数据完整性）在本迭代**均未验证**，报告中必须显式标记为未验证，不得由开发态取证推断。
6. Release Notes 输入不可信，必须先解析 raw HTML 再按最小白名单清洗，并单独限制 URL 协议；不得使用 `dangerouslySetInnerHTML`。
7. Windows 发布者签名暂缓，不得阻塞本次体验改进，也不得在实现中顺手扩大发布范围。

---

# 追加项探索结论（2026-09-08）

来源：`D:\koda\Obsidian\02-AI教学\wishfulclaw\issues\bugs.md` 与 `改进.md`。本节为只读核验，未修改功能源码。

## 追加项 1：渠道会话看不到项目列表（🔴 缺陷）

> **2026-09-08 老大裁定后本节结论已修订**：老大指出“渠道会话就是特殊的 global”。核实后确认缺陷不在各 Provider 把 `availableModes` 写死成 `["global"]`，而在 `AgentRunContextPolicy.ResolveAvailableMode` 没有像同文件 `Resolve` 那样把 `channel` 归一为 `global`。原“只改 `availableModes`”的结论（修法 A）**已废弃**，改为“改 `ResolveAvailableMode` 一处”（修法 B）。下文证据保留，结论以本段与 plan.md 的 Plan D 章节为准。

渠道会话的工具可见性有**三层过滤**，缺陷出在第 2 层的 mode 解析：

1. `src/renderer/src/hooks/use-channel-auto-reply.ts:268,276,283` — 渠道会话发送 `toolPreset:'channel'`、`sessionMode:'channel'`、`channelSession:true`。另一个入口 `src/renderer/src/hooks/use-chat-actions.ts:251` 同样发 `'channel'`（`isChannelSession ? 'channel' as const : opts?.sessionMode`）。
2. `src/runtime/WishfulClaw.Agent/AgentLoop.cs:161-170` — 先 `registry.GetToolDefinitions(toolPreset, sessionMode)`（第 1 层 preset + 第 2 层 mode），再 `AgentRunContextPolicy.FilterToolDefinitions(...)`（第 3 层白名单）。
3. `src/runtime/WishfulClaw.Core/Tools/ToolRegistry.cs:215-236` — `:230` 按 `Array.IndexOf(modes, sessionMode) >= 0` 精确匹配；`modes` 为空才视为全模式可用。
4. `src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs:117,150-157` — 运行时再用 `IsAvailableInMode(name, availableMode)` 与 `IsToolAllowed(...)` 复检，即使定义泄露也执行不了。

**根因**：`src/runtime/WishfulClaw.Agent/AgentRunContextPolicy.cs:121-126` 已按“渠道是特殊 global”把 `scope` 归一为 `"global"`，注释写着 “A channel is a specialized global session. Keep the global scope semantics while using a **distinct** available-mode/tool policy”，但同文件 `ResolveAvailableMode:164-182` 只做 `agent|chat → normal` 归一，随后 `:169-170` 在 `sessionMode.Length > 0` 时直接返回字面量 `"channel"`，**永远走不到** `:172-173` 的 `context.Scope == "global" → return "global"`。于是第 2 层拿 `"channel"` 去匹配 `["global"]`，工具被剔除，**根本到不了已经放行它们的第 3 层白名单**。

**同一处不一致造成三个症状**（第三个是 2026-09-08 复核新发现，Obsidian 待办未记录）：

| 症状 | 工具 | 第 2 层 `availableModes` | 第 1 层 `channel` preset | 第 3 层白名单 |
|---|---|---|---|---|
| 项目工具不可见（待办记录） | `list_projects`、`get_project_details`、`create_session`、`send_session_message`（`ProjectToolsProvider.cs:17,30,43,58`） | `["global"]` ✗ | 含 `"project"` ✅ | `SharedChatTools:77,80` + `GlobalChatTools:99,105` ✅ |
| 全局任务工具不可见（老大裁定一起修） | `create_global_task`、`list_global_tasks`、`update_global_task`、`list_global_dispatches`、`update_dispatch`、`send_work_request`（`GlobalTaskToolsProvider.cs:33,51,77,93,114,138`） | `["global"]` ✗ | **不含** `"global-task"`（有意，见下）| `GlobalChatTools:98-108` ✅ |
| **`Plugin*` 渠道消息工具不可见** | `PluginSendMessage`、`PluginReplyMessage`、`PluginGetGroupMessages`、`PluginListGroups`、`PluginSummarizeGroup`、`PluginGetCurrentChatMessages`（`PluginToolProvider.cs:26,40,54,61,75,84`） | `["normal","goal","global"]` ✗ | 含 `"plugin"` ✅ | `ChannelOnlyTools:29-53` 逐字列出，`:200-201` 对 `channelSession` 直接 `return true` ✅ |

第三行是最强的反证：第 3 层专门为渠道会话开了 `ChannelOnlyTools` 白名单，第 2 层又把它们挡在门外，**代码自相矛盾**，说明第 2 层是缺陷而非设计。

**第 1 层与第 3 层均已就绪，无需改动**：

- `AgentRunContextPolicy.cs:77,80` — `SharedChatTools` 已含 `get_project_details`、`list_projects`。
- `AgentRunContextPolicy.cs:99,105` — `GlobalChatTools` 追加 `create_session`、`send_session_message`。
- `AgentRunContextPolicy.cs:121-126` — 渠道会话强制 `scope="global"`；`:140-143` 强制 `collaborationMode="chat"` → 走 `GlobalChatTools`。
- `src/runtime/WishfulClaw.Core/Tools/ToolPreset.cs:76-85` — `"channel"` preset 的 AllowedCategories（`:82-83`）已含 `"project"` 与 `"plugin"`，不含 `"cron"`/`"desktop"`/`"team"`/`"skill-management"`/`"global-task"`。
- preset 取自独立参数 `toolPreset`（`AgentLoop.cs:161-164`），**不由 sessionMode 推导**，所以修法 B 不影响第 1 层。

**关键澄清：`global-task` 分类不进任何 preset 是有意设计，不得“顺手补上”**（2026-09-08 复核）：

- `GlobalTaskToolsProvider.Category => "global-task"`（`:13`），而 `"global-task"` **不在任何 `ToolPreset` 的 AllowedCategories 中**（`ToolPreset.cs` 全文核查）。
- 这不是遗漏：`AgentRuntimeUseCapabilityExecutor.cs:28-38` 明确注释 “Tool categories that are NOT directly registered in chat/coding presets. Tools in these categories are accessible only via use_capability.”，并把 `"global-task"`、`"global-dispatch-reply"`、`"project"`、`"task"`、`"desktop"`、`"cron"` 等一并列入 `ProxiedCategories`；`ToolCategoryCatalog.cs:68` 也只登记分类元数据，不参与 preset 放行。
- 因此正确改法是**不动 `ToolPreset.cs`**。加 preset 会破坏代理设计、双重暴露并膨胀工具列表。

**代理路径被同一道门挡住，且共有三道 gate（第三轮复审补全），所以一处修复同时恢复三条路径**：`use_capability` 的 `call` 在 `AgentRuntimeUseCapabilityExecutor.cs:316-321`、`list` 在 `AgentRuntimeUseCapabilityDiscovery.cs:150-152`（另见 `:90` 的 `IsProxiedBuiltinTool`）、`inspect` 在 `AgentRuntimeUseCapabilityEncoding.cs:128-130`，三处都调用 `registry.IsAvailableInMode(toolName, sessionMode)`（实现 `ToolRegistry.cs:87-98`）并叠加 `IsProxiedBuiltinTool` + `IsToolAllowed`。渠道会话下这道检查同样因 `"channel"` 匹配不上 `["global"]` 而失败，报 “is not available through the capability proxy in this session mode”。把 mode 解析归一后，直接调用（项目工具、`Plugin*` 工具）与三条代理路径（全局任务工具的 list/inspect/call）同时恢复。取证时三条 gate 都要实测，不能只验 `call`。

**已排除的伪风险（第三轮复审判 ❌，老大 2026-09-08 裁定前提不成立）**：复审认为 `NormalizeRuntimeParameters` 的归一化不幂等（`AgentLoop.Helpers.cs:135-138` 删掉 `projectId`/`workingFolder`/`sshConnectionId`，但 `"scope"` 不在删除名单里），修法 B 会让“绑定项目的渠道会话”第二次 `Resolve` 落到 `:134-136` 抛异常。**该前提不成立：渠道会话不可能绑定项目。** 代码证据：

- `src/main/channels/auto-reply.ts:177` 建渠道会话时 `projectId: null` 是**硬编码**，不是可选路径；
- 因此 `DbPluginSessionRouting.cs:42-47` 的 `requestedProjectId is not null` 恒为假，`project` 恒为 `null`，`:69-74` 的 `scope` 恒为 `"global"`、`workingFolder`/`sshConnectionId` 恒为 `null`，`:151-153` 返回的 `ProjectId` 也恒为 `null`；
- 唯一能把 `project_id` 写进渠道会话的 `SyncPluginSessionProject`（`DbPluginSessionTools.cs:60-84`，注册为 `db/plugin-sync-session-project`）在 `src/renderer`/`src/main`/`src/preload`/`src/shared` 全量 grep 只有 `messagepack-channel-routing.ts:256` 的路由白名单一条命中，**没有任何调用方**；
- 故 `use-channel-auto-reply.ts:143` 的 `scope: task.projectId ? 'project' : 'global'` 恒走 `'global'` 分支，`:270-276` 发出的 `scope` 恒为 `"global"`。

`NormalizeRuntimeParameters` 的不幂等性客观存在，但触发它需要“`scope:"project"` + 无 `projectId`”这一渠道链路产生不了的入参形态，**Plan D 不为它改任何代码**，记入迭代收尾待办备查。**结论：Plan D 维持单文件改法，不动 `AgentLoop.Helpers.cs`。**

**修法 B 的附带影响已全量清点**（`AgentLoop.cs:150-153` 经 `NormalizeRuntimeParameters`（`AgentLoop.Helpers.cs:117-160`，`:140-143`/`:151-153`）+ `state.ReplaceParameters` 把归一结果写回 parameters，所有下游读到 `"global"`）：

- **有意的行为变更 1**：`PromptBuilder.cs:67-78` 按 `sessionMode == "global"` 注入 `BuildGlobalAgentPrompt()`（`:410-428`），渠道会话此前拿不到。该 prompt 内容是“跨项目全局产品经理助手 + 全局任务工具走 `use_capability` 代理 + 6 个工具名 + 派发/回复工作流”，与已归一的 `scope="global"`、已放行的 `GlobalChatTools` 一致；渠道会话缺它正是 Agent 不知道代理工作流存在、表现为“完全无从下手”的直接原因。
- **有意的行为变更 2**：上表第三行 6 个 `Plugin*` 工具恢复可见。
- **有意的行为变更 3（第三轮复审补录）**：`AgentLoop.cs:203-213` 两处受影响。`:204-206` `SystemPromptCache.ComputeKey(...)` 把 `sessionMode` 计入键 → 渠道会话缓存键一次性变化，首请求 miss 一次，无害（`:205-206` 已计入 `pluginId`/`externalChatId`，不会与桌面全局会话撞键）；`:209` `includeSessionTodoPrompt = sessionMode != "global"` → 归一后为 `false`，**渠道会话不再注入 `<session_todo>` 段**。与 `:208` 既有注释 “the global agent host opts out” 语义一致：渠道会话的编排由新增的 `<global_agent>` 段描述，`<session_todo>` 属普通会话 Agent 的指引。**禁止**为此在 `:209` 加 channel 分叉（那等于在 `AgentLoop.cs` 里再造一处“渠道 ≠ global”的判定，与老大裁定相反）；若实机观察到实际功能损失，回规划态重新裁定。
- **不受影响**：`AgentLoop.cs:56-63` conversationKey 在 `:56` 读的是**归一化之前**的原始 parameters（`:57-58` 用 `StringComparison.Ordinal` 比对 `subAgent`/`goalSubAgent`），归一化发生在 `:150-153` 之后，故不受影响；`PromptBuilder.cs:61,310-314` 与 `ToolCallProcessor.cs:563,589-593` 各有本地 `IsChannelSession`，基于 `channelSession`/`pluginId`/`externalChatId`/`pluginChatId`，**不读 sessionMode**，故 `<channel_session>` prompt 与渠道文件工具特判都保留；`AgentLoop.MemoryRecall.cs:41` 只调 `Resolve`；写入方 `AgentRuntimeGlobalDispatchReplyExecutor.cs:132`、`Goal/GoalSubAgentExecutor.cs:101`、`SubAgentExecutor.Parameters.cs:77` 均非渠道路径。
- **不会过度暴露**：`cron`(6)/`desktop`(5)/`team`(4)/`skill-management`(1) 的 `availableModes` 含 `"global"`，第 2 层归一后通过，`list_installed_skills` 还在 `SharedChatTools:79` 里第 3 层也放行，但这四个分类**不在** `channel` preset 的 AllowedCategories 中，第 1 层先丢弃。
- **遗留死条目**：`ChannelPluginToolProvider.cs` 16 处 `["normal","goal","global","channel"]` 的 `"channel"` 归一后不再可能匹配；因 `"global"` 仍在列表中，行为不变。本迭代不清理，记入收尾待办。

**修法 A 的现成参照已失效**：`ChannelPluginToolProvider.cs:24,30,43,55,63` 的 `availableModes: ["normal","goal","global","channel"]` 曾被当作“逐处追加 channel”的样板，修法 B 下不再需要照它改。

**两个 Provider 修好后的可见性不对称，这是预期结果**：`project`、`plugin` 已在 `channel` preset 的 AllowedCategories 中 → 4 个项目工具与 6 个 `Plugin*` 工具在渠道会话**直接出现在工具列表**（正是待办要求的“开放给 channel”）；`global-task` 不在任何 preset → 6 个全局任务工具在渠道会话**只经 `use_capability` 代理可达**，与桌面全局会话的现状一致。验收时不得因为“列表里看不到全局任务工具”而误判为修复失败。

**测试可达性**：`AgentRunContextPolicy` 是 `internal static class`（`:12`），`AgentRunContext` 是 `internal readonly record struct`（`:7-10`），跨程序集断言需要 `InternalsVisibleTo`。`WishfulClaw.Agent.csproj:18-20` 已有三条（GoalRegressionTests / CompactionSnapshotRegressionTests / ToolConcurrencyRegressionTests），新增测试项目按同一方式追加第四条即可。测试工程模板见 `tests/WishfulClaw.ToolConcurrencyRegressionTests/`（`net11.0` + `OutputType=Exe` + `Main` 返回 0/1，`Program.cs:13-27`），且 4 个既有 C# 测试项目均无 npm 脚本，沿用 `dotnet run --project` 约定。

**顺带核到的既有隐患（本 Plan 不修，记入迭代收尾待办）**：`ToolRegistry.GetToolDefinitions` 用大小写敏感的 `Array.IndexOf(modes, sessionMode)`（`:222-232`），而 `IsAvailableInMode` 用 `OrdinalIgnoreCase`（`:87-98`），两者不一致。已核到一个受害者：`GoalToolProvider.cs:117` 的 `update_goal_progress` 声明 `availableModes: ["subAgent"]`，但 `ResolveAvailableMode:169-170` 经 `Normalize:238` 的 `ToLowerInvariant` 返回小写 `"subagent"` → 大小写敏感匹配不上 → 该工具在子 Agent 的工具定义列表中静默缺失（`GoalPromptTemplates.cs:163` 的提示语写成 “If the update_goal_progress tool is available” 恰好兜住，故未暴露）。与 Plan D 无因果关系：Plan D 只新增 `channel → global` 归一，两侧字面量都是全小写，不受该不一致影响。

**桌面端项目列表与工具无关**：`src/renderer/src/stores/chat-store/db-helpers.ts:588` → `workerRequest('db/projects-list')` → `src/runtime/WishfulClaw.Infrastructure/Db/DbModule.cs:26`，是独立 RPC，**无需新增 IPC**。

## 追加项 2：飞书扫码绑定后未自动启用（🔴 缺陷）

**根因**：`src/renderer/src/components/settings/plugin-panel-qr.tsx:245-260` 飞书授权成功分支只做了 `updateChannel(channel.id, { config: {...appId, appSecret}, enabled: true })`，**没有调用 `startChannel`**，也**没有设置 `features.autoStart`**。凭据和 enabled 标志落库了，但渠道服务没起来，用户必须再手动点“启用”。

**对照微信的正确实现**（同文件 `:125-165`）：

| 环节 | 微信 | 飞书 |
|---|---|---|
| patch 内容 | `enabled:true` + `features:{autoReply, streamingReply, autoStart:true}`（`:131-145`） | 仅 `enabled:true`（`:251-258`） |
| updateChannel 返回值 | 检查，失败抛错（`:146-152`） | **不检查** |
| 启动服务 | `await startChannel(channel.id)` 并检查返回值（`:154-160`） | **无** |
| 成功文案 | “绑定成功，渠道已启动!”（`:163-164`） | “飞书授权成功!”（`:249`） |
| useCallback 依赖 | 含 `startChannel`（`:191`） | **不含**（`:283`） |

**次要缺陷**：飞书在 `:248-249` **先**把 `loginStatus` 设为 `'connected'` 并弹成功文案，**再** await `updateChannel`；保存失败时 UI 已经显示成功。微信是先保存成功再置状态。

**后端只返回凭据、不落库不启用**：`src/main/channels/providers/feishu/feishu-install.ts:241-249` 的 `pollFeishuInstall` 仅返回 `appId`/`appSecret`/`domain`/`userId`。该文件头注释第 5 步写的 “Save credentials to channel config, enable channel” **实际未实现**，是注释与代码不一致。IPC 注册在 `src/main/ipc/channel-handlers/channel-feishu-handlers.ts:319-331`。

**相关定义**：`startChannel` 在 `src/renderer/src/stores/channel-store.ts:66,133`；`autoStart` 在 `channel-store.ts:18`。扫码绑定只有 weixin / feishu 两个渠道支持（`plugin-panel-qr.tsx:301`）。

## 追加项 3：同步 OpenCowork 最新内置服务商列表（🟡 改进）

**数量差距**：WishfulClaw `src/renderer/src/stores/providers/` 有 20 个 preset 文件，OpenCowork 同目录 39 个。**WishfulClaw 缺 19 个**，且没有 OpenCowork 不具备的 preset（干净的子集关系）。

缺失清单：`cerebras` `fireworks` `groq` `huggingface` `hunyuan` `infini` `lmstudio` `meta` `mistral` `modelscope` `novita` `nvidia` `opencode` `opencode-go` `ppio` `routin-ai` `stepfun` `together` `vertex-ai`。

**类型基础已对齐**：

- `BuiltinProviderPreset` 字段两边**完全一致**；WishfulClaw 放在 `src/shared/types/provider.ts:351-387`，OpenCowork 内联在 `providers/types.ts`（WishfulClaw 的 `providers/types.ts` 只是 1 行 re-export）。
- `ReasoningEffortLevel` 8 个值（none/minimal/low/medium/high/xhigh/max/ultra）两边一致，仅顺序不同（`src/shared/types/provider.ts:29-37`）。
- `ProviderType` 已含 `openai-responses` 和 `vertex-ai`（`src/shared/types/provider.ts:11-19`）。
- `RequestOverrides`（headers / body / omitBodyKeys）已存在（`:93-100`）。

**17 个可直接搬**：逐个 grep 确认不依赖 WishfulClaw 缺失的字段——`cerebras` `fireworks` `groq` `huggingface` `hunyuan` `infini` `lmstudio` `meta` `mistral` `modelscope` `novita` `nvidia` `opencode` `opencode-go` `ppio` `stepfun` `together`。

**2 个搬进来跑不通（老大 2026-09-08 裁定本迭代排除）**：

- `vertex-ai.ts` — preset 声明 `type:'vertex-ai'`（`:7`）、baseUrl 指向 `aiplatform.googleapis.com`（`:9`）。但 C# 只在 `AgentLoop.cs:533-541` 分派 `anthropic` / `openai-responses`，其余落 openai-chat；全 C# 无 vertex-ai 或 gemini 运行时（`gemini|vertex` 仅命中无关的 `ContextCompression.cs`）。搬入会得到一个无法对话的死服务商，违反 AGENTS.md「迭代交付必须完整可用」。
- `routin-ai.ts` — 使用 `offPeakInputPrice` / `offPeakOutputPrice` / `offPeakCacheCreationPrice` / `offPeakCacheHitPrice` / `pricingSchedule` / `pricingTiers` / `supportsWebsocket`。WishfulClaw 的 `ModelPricingSchedule`、`ModelPricingTier`、`pricingTiers`、`offPeak*` **全部 0 命中**，且 OpenCowork 依赖的 `src/shared/gpt-context.ts` 在 WishfulClaw 不存在。补齐需要同时实现分时/阶梯定价计算逻辑，会影响所有服务商的费用统计。

**`AIModelConfig` 已双向分叉**（同步时需注意，不能整文件覆盖）：

- OpenCowork 独有：`longContextLength`、`supportsLongContext`、`enableLongContext`、`offPeak*` 四项、`pricingSchedule`、`pricingTiers`。
- WishfulClaw 独有：`contextCompressionThreshold`。

**OpenCowork `providers/index.ts` 还有 WishfulClaw 没有的机制**（184 行 vs 52 行）：`applyGptLongContextDefaults`、`applyServerToolCapabilityDefaults`、`BUILTIN_SEARCH_CAPABLE_PRESETS`、`IMAGE_GENERATION_CAPABLE_PRESETS`。本次只做 preset 注册，不移植这些机制。

**参考副本新鲜度**：`D:\claw\OpenCowork` 停在 `2736a5d1`（2026-08-31，v1.3.25），remote 为 `731471991/OpenCowork`，距 2026-09-08 已 8 天。要满足“最新”需先 `git pull`。

## 追加项 4：OpenCode Go 注入 `x-opencode-session`（🟡 改进）

**关键澄清：OpenCode Go 是一个 AI 服务商 preset，不是独立集成。** 定义在 `D:\claw\OpenCowork\src\renderer\src\stores\providers\opencode-go.ts:365-375`：`builtinId:'opencode-go'`、`name:'OpenCode Go'`、`type:'openai-chat'`、`defaultBaseUrl:'https://opencode.ai/zen/go/v1'`、`version:5`、24 个模型。因此**本项依赖追加项 3 先把该 preset 搬进来**。

**这是新需求，不是移植**：`x-opencode-session` 在整个 OpenCowork 仓库**零命中**。

**可行性已核验**：

- 会话 ID 在 C# 侧可得：`parameters` 里带 `sessionId`，多处已这样读（`AgentRuntimeContextCompressionTools.cs:36`、`AgentRuntimePlanExecutor.cs:84`、`AgentRuntimeGlobalTaskExecutor.cs:193` 等）；渲染侧在 `use-chat-actions.ts:232` 发送。
- 注入点：`OpenAIChatHeaders.cs:12` 的 `ApplyHeaders(request, provider, apiKey)`，由 `OpenAIChatProvider.cs:59` 调用，该处 `parameters` 在作用域内，可把 sessionId 传下去。
- 现成的请求头注入先例：`ProviderRequestOverrides.ApplyHttpHeaderOverrides(request, provider)`（`OpenAIChatHeaders.cs:25`，实现在 `src/runtime/WishfulClaw.Agent/ProviderRequestOverrides.cs`）和 `ApiUserAgent.Apply`。

**障碍（老大 2026-09-08 裁定按 builtinId 精确 gate）**：`buildProviderPayload`（`use-chat-actions.ts:385-399`）返回的载荷**不含 builtinId**，只有 `type: activeProvider.type`。而 `OpenAIChatProvider.cs:57` 已经在读 `JsonHelpers.GetString(provider, "providerBuiltinId")` 用于 `request_debug` 事件——说明 C# 期望这个字段但渲染端从来没发，该字段目前**恒为空**。补发 `providerBuiltinId` 既满足精确 gate，也顺带修好这个既有缺口。

**协议语义差异需注意**：`opencode-go.ts` 的模型里有 `type:'anthropic'`（minimax-m3/m2.7/m2.5、qwen3.8-max 等）和 `type:'openai-responses'`（grok-4.5、muse-spark-1.2-contributor、gpt-5.6-luna）。但 WishfulClaw 只按 **preset 级** type 分派（`AgentLoop.cs:533` 读 `provider.type`，而 `buildProviderPayload:388` 发的是 `activeProvider.type`），preset type 是 `openai-chat` → 这些模型全部走 OpenAIChatProvider，**模型级 type 被忽略**。好处是头注入只需覆盖 OpenAIChatProvider 一处；风险是这些模型的实际协议与上游语义不同，必须在验证阶段实测能否正常对话，不能只验编译通过。

## 追加项范围裁定（老大 2026-09-08）

1. 服务商同步**只搬 17 个可用的**，`vertex-ai` 与 `routin-ai` 本迭代排除并记入 Obsidian 待办。
2. 追加项 1 **一起修**全局任务工具。**修法已于同日二次裁定变更**：老大指出“渠道会话就是特殊的 global”，故不再逐处追加 `availableModes`（原“`ProjectToolsProvider` 4 个 + `GlobalTaskToolsProvider` 6 个，共 10 处”的修法 A **已废弃**），改为修法 B：在 `AgentRunContextPolicy.ResolveAvailableMode` 把 `channel` 归一为 `global`。四个 Provider 的 `availableModes` 一行不动。修法 B 同时修好第三个症状（`PluginToolProvider` 6 个 `Plugin*` 工具）。**第三轮复审判 BLOCKED（❌ 3、⚠️ 3）的处置**：❌-1（归一化不幂等会让“绑定项目的渠道会话”必崩）**经老大裁定前提不成立已排除**——老大明确“全局会话和渠道会话本质上都是全局会话，不会绑定项目”，代码侧亦证实 `auto-reply.ts:177` 硬编码 `projectId: null`、`db/plugin-sync-session-project` 无渲染端调用方（详见“追加项 1”章节的“已排除的伪风险”）；❌-2/❌-3/⚠️ 三项属实的已补全修正。故修法 B 的最终范围仍是**一处**——只改 `ResolveAvailableMode`，**不动 `AgentLoop.Helpers.cs`**。老大同日裁定**跳过第四轮独立复审，直接进入执行态**。详见“追加项 1”章节与 plan.md 的 Plan D。
3. 追加项 4 **补 `providerBuiltinId`**，按 builtinId 精确 gate，不用 baseUrl 前缀判断。**发送点数量已复核修正**：不是只有 `buildProviderPayload` 一处，`agent/run` 的 provider 载荷有 **4 处独立构造点**（`use-chat-actions.ts:210-225` 主聊天内联、`use-chat-actions.ts:385-399` `buildProviderPayload`、`use-channel-auto-reply.ts:223-235`、`project-send-message.ts:87-97`），四处都缺该字段，必须全覆盖。只改 `buildProviderPayload` 会漏掉主聊天路径——这是首轮规划复审判 ❌ 的原因。
