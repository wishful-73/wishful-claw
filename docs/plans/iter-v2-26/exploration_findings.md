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

渠道会话的工具可见性有**三层过滤**，缺陷出在第一层：

1. `src/renderer/src/hooks/use-channel-auto-reply.ts:268,276,283` — 渠道会话发送 `toolPreset:'channel'`、`sessionMode:'channel'`、`channelSession:true`。
2. `src/runtime/WishfulClaw.Agent/AgentLoop.cs:161-170` — 先 `registry.GetToolDefinitions(toolPreset, sessionMode)`，再 `AgentRunContextPolicy.FilterToolDefinitions(...)`。
3. `src/runtime/WishfulClaw.Core/Tools/ToolRegistry.cs:215-236` — `:230` 按 `Array.IndexOf(modes, sessionMode) >= 0` 精确匹配；`modes` 为空才视为全模式可用。
4. `src/runtime/WishfulClaw.Agent/ToolCallProcessor.cs:150-152` — 运行时再用 `IsAvailableInMode(name, availableMode)` 拦截，即使定义泄露也执行不了。

**根因**：`src/runtime/WishfulClaw.Agent/Tools/Providers/ProjectToolsProvider.cs:26,39,54,73` 的 `list_projects` / `get_project_details` / `create_session` / `send_session_message` 全部注册 `availableModes: new[] { "global" }`，而渠道会话 `sessionMode="channel"`，在 `ToolRegistry.cs:230` 第一层就被剔除，**根本到不了已经放行它们的白名单层**。

**白名单与 preset 均已就绪，无需改动**：

- `AgentRunContextPolicy.cs:77,80` — `SharedChatTools` 已含 `get_project_details`、`list_projects`。
- `AgentRunContextPolicy.cs:99,105` — `GlobalChatTools` 追加 `create_session`、`send_session_message`。
- `AgentRunContextPolicy.cs:121-126` — 渠道会话强制 `scope="global"`；`:140-143` 强制 `collaborationMode="chat"` → 走 `GlobalChatTools`。
- `src/runtime/WishfulClaw.Core/Tools/ToolPreset.cs:76-85` — `"channel"` preset 的 AllowedCategories 已含 `"project"`。

**同类潜在缺陷（老大 2026-09-08 确认一起修）**：`GlobalTaskToolsProvider.cs:33,51,77,93,114,138` 的 6 个全局任务工具同样只注册 `["global"]`，而 `AgentRunContextPolicy.cs:98-108` 白名单也已放行 `create_global_task` / `list_global_tasks` / `update_global_task` / `list_global_dispatches` / `update_dispatch` / `send_work_request`，因此渠道会话同样看不到。

**关键澄清：`global-task` 分类不进任何 preset 是有意设计，不得“顺手补上”**（2026-09-08 复核）：

- `GlobalTaskToolsProvider.Category => "global-task"`（`:13`），而 `"global-task"` **不在任何 `ToolPreset` 的 AllowedCategories 中**（`ToolPreset.cs` 全文核查）。
- 这不是遗漏：`AgentRuntimeUseCapabilityExecutor.cs:28-38` 明确注释 “Tool categories that are NOT directly registered in chat/coding presets. Tools in these categories are accessible only via use_capability.”，并把 `"global-task"`、`"global-dispatch-reply"`、`"project"`、`"task"`、`"desktop"`、`"cron"` 等一并列入 `ProxiedCategories`；`ToolCategoryCatalog.cs:68` 也只登记分类元数据，不参与 preset 放行。
- 因此正确改法是**只改 `availableModes`**，不动 `ToolPreset.cs`。加 preset 会破坏代理设计、双重暴露并膨胀工具列表。

**代理路径被同一道门挡住，所以一处修复同时恢复两条路径**：`use_capability` 的 `call` 在 `AgentRuntimeUseCapabilityExecutor.cs:316-321` 也调用 `registry.IsAvailableInMode(toolName, sessionMode)`，`list` 在 `AgentRuntimeUseCapabilityDiscovery.cs:150-152` 同样调用（另见 `:90` 的 `IsProxiedBuiltinTool`）。渠道会话下这道检查同样因 `["global"]` 而失败，报 “is not available through the capability proxy in this session mode”。把 `availableModes` 补上 `"channel"` 后，直接调用（项目工具）与代理调用（全局任务工具）同时恢复。

**改法有现成参照**：`ChannelPluginToolProvider.cs:24,30,43,55,63` 用的就是 `availableModes: ["normal", "goal", "global", "channel"]`。

**两个 Provider 修好后的可见性不对称，这是预期结果**：`project` 已在 `channel` preset 的 AllowedCategories 中 → 4 个项目工具在渠道会话**直接出现在工具列表**（正是待办要求的“开放给 channel”）；`global-task` 不在任何 preset → 6 个全局任务工具在渠道会话**只经 `use_capability` 代理可达**，与桌面全局会话的现状一致。验收时不得因为“列表里看不到全局任务工具”而误判为修复失败。

**测试可达性**：`AgentRunContextPolicy` 是 `internal static class`（`:12`），跨程序集断言第三层需要 `InternalsVisibleTo`。`WishfulClaw.Agent.csproj:18-20` 已有三条（GoalRegressionTests / CompactionSnapshotRegressionTests / ToolConcurrencyRegressionTests），新增测试项目按同一方式追加第四条即可。测试工程模板见 `tests/WishfulClaw.ToolConcurrencyRegressionTests/`（`net11.0` + `OutputType=Exe` + `Main` 返回 0/1，`Program.cs:13-27`），且 4 个既有 C# 测试项目均无 npm 脚本，沿用 `dotnet run --project` 约定。

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
2. 追加项 1 **一起修**全局任务工具：`ProjectToolsProvider` 4 个 + `GlobalTaskToolsProvider` 6 个，共 10 处 `availableModes`。
3. 追加项 4 **补 `providerBuiltinId` 到 `buildProviderPayload`**，按 builtinId 精确 gate，不用 baseUrl 前缀判断。
