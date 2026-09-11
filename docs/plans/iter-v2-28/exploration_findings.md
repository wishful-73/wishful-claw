# v2-iter-28 探索记录

> 阶段：探索态（补充轮 —— 针对 R-1 / R-2 / R-3 / R-4 未勘查项）
> 日期：2026-09-11
> 基线：`main` @ `0388875e` / `v0.2.27`
> 开发分支：`dev/v2-iter-28`
> 关联：需求 #1 的 C# 写入点调研结论另见 `usage-analytics-requirement.md` 第 6/10 节

## 1. 工作流与仓库状态

- 已读 `docs/dev-workflow.md`，本迭代遵循六阶段：探索 → 规划 → 规划验证 → 执行 → 审查 → 验证。
- 分支 `dev/v2-iter-28` 已从 `main` @ `0388875e` / `v0.2.27` 切出。
- 工作区状态：`M docs/plans/iter-v2-28/raw-requirements.md`（R-1 定向复搜结论回填）、`?? docs/plans/iter-v2-28/plan.md`（本轮新写）。两处均为本迭代规划产物，按工作流「规划文档不单独提交，随所属需求提交入库」，**不重置**。
- `git log origin/main..HEAD --oneline` → 仅 `c7287b6e`（需求 #2）一个未推送 commit。
- `stash@{0}` / `stash@{1}` 分属 dev/iter-14、dev/iter-11 遗留，**与本迭代无关，不得 pop**。
- `docs/iteration-plan.md` 内容陈旧（只登记到 v2-iter-26），**不作为 28 迭代范围依据**；28 范围唯一权威是 `raw-requirements.md` 文末「状态」小节。
- `docs/PROGRESS.md` 尚无 28 行（迭代未收尾，符合预期）。

## 2. 需求 #1（模型请求日志）C# 写入点调研结论

已在 `usage-analytics-requirement.md` 第 6/10 节固化，本轮复核确认：

- 现有 usage 事件产出点在 Provider 层（Anthropic / OpenAI Chat / Gemini / Vertex），`recordUsageEvent` 三处调用点位于渲染端 `lib/usage-analytics.ts`，下沉后**直接删除**。
- `billableInput` 唯一正确口径在 `src/runtime/WishfulClaw.Infrastructure/Db/DbMessageCompactTools.cs:186`（已减 `cacheCreation`）；Provider 层回退值少减该项，**不得抄**。
- 交叉验证手段：`requestTimings` 长度对账行数。
- 结论未变：需求 #1-P1～P4 骨架可用，执行前仍需在动手时按当时行号复核。

## 3. R-1 补位模型：落点勘查

### 3.1 完整调用链（已实读）

```
use-prompt-optimizer.ts:55-80       取 active provider / model
  ↓ providerStore.getActiveProvider() + activeModelId||defaultModel||首个启用
use-prompt-optimizer.ts:84-94       组装 providerConfig（含 providerId: activeProvider.id）
  ↓ optimizePrompt(text, providerConfig, lang, signal)
optimizer.ts:48-72                  completeOnce() 构造 params
  ↓ params.provider = { type, baseUrl, apiKey }   ← providerId 在此丢失
optimizer.ts:93-97                  workerRequestWithId('provider/complete', params, cancelId)
  ↓
ProviderTestModule.cs:14            context.Register("provider/complete", ...)
  ↓
ProviderCompletionService.cs:25     CompleteAsync(JsonElement, IWorkerRequestContext)
```

### 3.2 已核验事实

- **调用侧已经持有 `providerId`**：`use-prompt-optimizer.ts:84-94` 的 `providerConfig` 带 `providerId: activeProvider.id`（类型 `ProviderConfig`，`src/renderer/src/lib/api/types.ts:459` 确有该字段），但 `optimizer.ts:60-69` 构造 `params.provider` 时**只取 type/baseUrl/apiKey**，`providerId` 与 `model` 都没进 `params.provider`（`model` 作为 `params.model` 顶层传了）。
- **`provider/complete` 全仓只有一个调用方**：`optimizer.ts:94`。用户 R-1 举的例子（提示词优化）就是当前唯一在跑的"不可见请求"。
- **`ProviderCompletionService.CompleteAsync` 内无 `runtime_role`、无来源标识**：`grep runtime_role|RuntimeRole` 在该文件 0 命中（全文 384 行）。第 10 节那张 usage 产出点表只覆盖 Provider 层，未覆盖这条旁路 —— 这是 R-1 与 #1 的交界空白：若 #1 的写入钩子设在 Provider 层，这条旁路能否被 `runtime_role` 正确标注，取决于 R-1 是否补传来源。
- **`provider/complete` 的 DTO 是具名 record**：`ProviderCompletionResult`（`AotResultTypes.cs:84-88`），已在 AOT 结果类型集合内，新增字段须同步该处与对应 JsonContext。
- **重试/超时现状**：`MaxAttempts = 10`，HttpClient timeout 180s，指数退避 1s→2s→…capped 30s，`retryable = 429/408/≥500`。即"不可见请求"当前**只有单 provider 内重试，没有跨 provider 兜底**——正是 R-1 要补的缺口，且与 Plan D（可见主对话 fallback）正交。
- **四个同族字段全部为哑数据**（本轮复核再确认）：`contextCompressionModel`（`settings-store.ts:131` 声明 / `:284` 默认 null / `:452` 持久化）、`SessionDefaultModelBinding.useGlobalActiveModel`（`settings-store-types.ts:13-15`，全仓仅类型定义一处命中）、`ClaudeCodeConfig` 整块（`settings-store-types.ts:17` 起，含 `smallFastModelId`）、`promptRecommendationModels`（`settings-store.ts:225` 声明 / `:365-371` 默认 / `:523` 持久化）。`src/runtime` / `src/main` / `src/shared` 对上述键名零命中。
- **唯一活着的模型解析**：`useProviderStore.activeProviderId / activeModelId`（`provider-store.ts:19-20` 声明、`:29-33` getActiveProvider 回落 `providers[0]`、`:93` setActiveProvider、`:95` setActiveModel、`:305-306` 持久化）。会话级绑定回退形状见 `AssistantMessage/index.tsx:89-126`。
- **无 recency 埋点**：`lastUsedAt` 全仓只属 `ProviderOAuthAccount`（`src/shared/types/provider.ts:188`），写点 `lib/auth/provider-auth-accounts.ts:127-130` 是 OAuth 账号轮转戳，与模型选择无关。

### 3.3 落点约束（决定 R-1 可怎么改）

- **不能只在渲染端改**：AGENTS.md 明确「功能只有 C# Worker 版本才算完成」。兜底模型的解析与路由若只写在 renderer，等于把决策留在渲染端，与既有 `ProviderCompletionService` 的服务端职责冲突。
- **最省事的可用形态**：`params.provider.providerId` + `params.provider.model` 补传（调用侧已有值），服务端按"配置的补位模型 → 全局激活模型 → 当前上下文 provider"三级解析。但"配置的补位模型存哪"未定（见待裁②）。
- **配置存储两难**：存渲染端 `settings-store`（= 主进程 `general.json`）与 AGENTS.md 的 C# 完成度要求冲突（同 R-2 已记录的同一根问题）；存 C# 侧需新增配置读写端点。

---

## 4. R-2 渠道设置页：落点勘查

结论已在 `plan.md` R-2 节固化（2026-09-11 勘查），本轮不重复。要点：

- 「功能设置」7 字段中**只有 2 个真生效**：`features.autoReply`（`src/renderer/src/hooks/use-channel-auto-reply.ts:139-143`）、`features.autoStart`（`src/main/ipc/channel-handlers/channel-plugin-handlers.ts:167-176`，由 `index.ts:607` 调）。
- `streamingReply` 与 4 个 `permissions.*` 只展示不驱动行为（`bash-tool.ts:50` 读的 `channelPermissions.allowShell` 全仓无赋值点，是死分支）。
- `ChannelInstance.tools`（`channel-types.ts:66`）**零调用方**；`plugin:tool-enabled` 主进程链完好（`reverse-handlers/index.ts:88,153-158` → `src/main/ipc/channel-handlers/channel-plugin-handlers.ts:163-165` → `src/main/ipc/channel-handlers/channel-handler-utils.ts:268` → `channel-config-store.ts:51`）但 **C# 侧零处发起**，不参与运行时。
- 渠道配置唯一落盘处：C# 侧 `~/.wishful-claw/plugins.json`（`ChannelConfigStore.cs:19,181-184`），读写经主进程转发。
- 页面**无 shadcn `Tabs` 可用**（`components/ui/` 下无 `tabs.tsx`）；自绘选项卡样板取 `plugin-panel-detail.tsx:221-260,352-358`；`mcp-panel.tsx:101,215` / `skill-panel.tsx:180,201` 用「两块 div 常驻 + `hidden`」保挂载，**改成条件渲染会丢状态**。
- `autoStart` 默认值现存 5 处不一致：seed `false`（`src/main/ipc/channel-handlers/channel-plugin-handlers.ts:292`）、UI 兜底 `true`（`plugin-panel-detail.tsx:107`）、启动判定 `?? true`（`:170`）、`/status` 兜底 `true`（`plugin-command-handlers.ts:321-325`）、`src/renderer/src/hooks/use-channel-auto-reply.ts:139`。

---

## 5. R-3 工具可见性：落点勘查

结论已在 `plan.md` R-3 节固化（含 5 条会改变落地形态的发现）。补充本轮确认：

- **新属性的最小落点可行且零反射（符合 AOT）**：`ToolTypes.cs:8-14` 的 `ToolDefinition` record + `IToolExecutor.cs:33` 旁 + `ToolDefinitionPlaceholder.cs:12-25` + `ToolRegistry.Register:44`。
- **准入决策集中在 `AgentRunContextPolicy.cs`**：A 类 10 张硬编码表决定准入；B 类 30 个 `Is*Tool` 谓词决定路由；`IsToolAllowed:199-222` 与 `FilterToolDefinitions:230-236` 判断重复；`:212-216` 两个 early-return 使 automation/pet/providerturn/translation 全部放行。
- **两类旁路**：`mcp__*` / `extension__*` 不在 registry，靠 `IsAvailableInMode` 返回 false 的副作用被拒（`ToolRegistry.cs:89-90`）；`use_capability:call`（`AgentRuntimeUseCapabilityExecutor.cs:290,302,346`）本就绕过 `ToolCallProcessor`。
- **必改回归测试 3 组**：`WishfulClaw.ChannelToolVisibilityRegressionTests/Program.cs`（复刻 5 份清单 `:20-53`，断言 `:68-83,174`）、`GoalRegressionTests/Program.Lifecycle.cs:245-315`、`ToolConcurrencyRegressionTests/Program.cs:41-49,92-99`。
- **死代码线索**：`AgentRunContextPolicy.cs:62` 的硬编码清单含 `DesktopScreenshot` / `BrowserScreenshot`（与 R-4 交界）。

---

## 6. R-4 使用指引：落点勘查

- **顶栏问号落点已定位**：`TitleBar.tsx` 右侧图标组 `:94-138`。现有顺序：`hasProject` 时渲染 `FolderOpen`(Files) + `SquareTerminal`(Terminal) → `PanelRightClose/PanelRightOpen`(toggleRightPanel) → `<WindowControls />`。问号应插在**现有图标组左侧**（即 `hasProject` 块之前），按钮类名沿用 `titlebar-no-drag flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground`，配 `<Tooltip><TooltipContent side="bottom">`。
- **关于页落点已定位**：`SettingsPage.tsx` 的 `AboutPanel()`（`:260-338`），现有 `SettingsSection id="sec-about-updates"` 可作按钮样板；`ABOUT_FEATURE_KEYS` 7 项；已 import `Button`/`Loader2`/`RefreshCw`/`Switch`/`toast`。
- **截图能力不缺**：`DesktopScreenshot`（整桌面、仅主显示器、base64 PNG、不落盘，`AgentRuntimeDesktopExecutor.cs:26,81-104` → IPC `desktop:screenshot:capture`，`desktop-control.ts:122`）、`BrowserScreenshot`（视口）。落盘通道 `image:persist-generated`（`misc-handlers.ts:268-277`）落点固定在 `~/wishful-claw/image/`（`:243-251`），**不能指定目录**。
- **外链约定**：`setWindowOpenHandler` → `shell.openExternal`（口径来源 `docs/plans/iter-v2-26/plan.md:101`）。
- **仓库地址（URL 单点定义用）**：`https://github.com/wishful-73/wishful-claw.git` → 网页地址 `https://github.com/wishful-73/wishful-claw`。
- **侧边栏版本号落点**：`WorkspaceSidebar.tsx:408-417`（含设置按钮 `openSettings('provider')` 与 `APP_VERSION_LABEL`）。

---

## 7. 主要风险与依赖

1. **R-1 的配置落盘位置与 AGENTS.md「C# 完成度」要求存在张力**（同 R-2），不先定会让新字段再落进渲染端哑字段堆。
2. **R-1 与需求 #1 共用"来源标识"这一概念**：若 #1 的 usage 写入钩子依赖 `runtime_role`，而 `provider/complete` 旁路当前无该标识，两条会产生字段耦合。规划时须明确谁先定。
3. **R-2 与 R-3 共用 4 个文件**（`channel-types.ts:56-76`、`channel-config-store.ts:42-58`、`src/main/ipc/channel-handlers/channel-plugin-handlers.ts:292-299,344-357`、`src/main/ipc/channel-handlers/channel-handler-utils.ts:251-263`），**不得并行改**。
4. **R-3 涉及行为变更**（`:212-216` early-return 显式化会让 cowork/goal/automation 首次开始被拦），不是纯重构，必须单独确认。
5. **#2.6 与 #3 依赖老大真机目视复验**，agent 无法自主完成；工作流规定「未过不得勾成完成」。
6. **R-4 截图脱敏是硬前置**：整桌面截图会拍进桌面其它内容，用于对外文档前必须清场。
7. 四个哑字段若不先处置就新增同类槽位，同类问题会继续累积（R-1 待裁③）。

## 8. 不纳入本迭代

见 `plan.md` 文末「不纳入」小节（Plan D、A4 后半段、桌宠、K0 等）。
