# 迭代 29 审查报告

> 审查时间：2026-09-15
> 被审对象：`dev/v2-iter-29`，commit 区间 `4710c6d2..ae1f866f`（31 个提交 / 173 文件 / +10948 / -3505）
> 审查范围：25 个需求（S-16～S-25 正式 10 项 + T-1～T-15 临时 15 项）
> 审查方式：独立审查。原计划 4 个只读 subagent 并行审查，**全部因执行预算上限（约 12 轮 / 23 次工具调用）未产出报告**（报告留到最后写 → 没写成），改为人工作业；关键结论逐条读代码取证。
> **结论：FAIL**（❌ 5 项 > 0）
> 统计：✅ 20 / ⚠️ 9 / ❌ 5
>
> **修复进展（2026-09-15）**：F-8 与 F-2 已修复并验证 —— 同一个病根（`agent/run` 的 provider 载荷靠手搓），见 F-2 / F-8 各节与 `plan.md` 的「修复」节。
> 未处理：**F-1**（S-21 切换不粘会话）、**F-9**（S-21 三刀未折叠）、**F-10**（`S-21.D7` 撞号 + 空壳测试工程），以及 ⚠️ 各项。

---

## 一、总体结论

**功能面基本落地**：25 个需求都有实现与提交，plan 声明的落点绝大部分对得上，无需求漏做；C# 侧分层（Agent → Infrastructure 顺向）干净，无硬编码密钥，无新增生产依赖，AOT/JSON context 注册完整，本迭代新增的 i18n key 中英**完全对称**（chat +6/+6、common +16/+16、layout +23/+23、settings +99/+99）。

**但 S-21（限额自动 fallback）有 2 个功能性硬伤**，而且这条需求的价值全在「自动切换 + 自动推进」能不能真的接上：切完**不粘会话**、推进那一轮**丢了会话级运行参数**。另有 1 个功能性问题在 S-20（自定义请求头在主聊天链路上不生效）。三者都能用「读代码 + 一次真机/日志」确认。

---

## 二、逐项检查（按需求）

| # | 需求 | 结论 | 说明 |
|---|---|---|---|
| 1 | S-24 用量明细上移进选项卡 | ✅ | 4 档收敛为 3 档（line/bar/detail），明细复用 `loadLogsPage` 与既有防串号；无残留渲染 |
| 2 | S-20 自定义服务商请求头 | ❌ | 见 **F-8**：编辑器/校验/保留头拦截都对，但主聊天链路不带 `requestOverrides` |
| 3 | S-22 回报后回推渠道 | ⚠️ | 实现正确（守卫 + 成对清理），**无微信环境，真机待验** |
| 4 | S-17 状态条显示真实工具名 | ✅ | `resolveProxyStatusName` 独立于卡片用的 `resolveProxyDisplay`，理由清楚；真机待验 |
| 5 | S-23 搜索收敛到 BrowserSearch | ✅ | 见下「S-23 细项」 |
| 6 | S-16 输入框长粘贴 chip | ✅ | 与 T-13 同一套标签方案，正/反解析（`renderDocument` / `parseDomToDocument`）都覆盖 |
| 7 | S-18 右侧面板 Git 分支视图 | ⚠️ | 限 50 条且无截断提示，见 **F-12** |
| 8 | S-19 自窗口截图 | ✅ | 路径解析放在 Worker（避免主进程 cwd），延迟钳制、错误透传；见 **F-13** 安全边界备注 |
| 9 | S-21 多服务商限额 fallback | ❌ | 见 **F-1 / F-2**（+ F-3/F-4/F-5/F-9/F-10） |
| 10 | S-25 Agent 工作时间线 | ✅ | 表 + 索引 + `Prune` 挂 DB init + DTO 注册进 `InfrastructureJsonContext`（含 `List<T>`）+ 9 个事件类型双语齐；见 **F-11** |
| 11 | T-1 消息时间口径 | ✅ | |
| 12 | T-2 底部统计条改读会话总统计 | ✅ | |
| 13 | T-3 长驻进程渲染膨胀 | ✅ | 窗口收缩阈值可配 |
| 14 | T-4 移除流式光标 | ✅ | |
| 15 | T-5 用量面板体验收口 | ✅ | 死端点 `db/usage-by-source` 已彻底退役（全仓零残留） |
| 16 | T-6 测试工程独立 sln + 移除 e2e | ✅ | `tests/WishfulClaw.Tests.sln` 收录全部 11 个测试工程，产品 sln 已清空测试项；`@playwright/test` 依赖与脚本已删 |
| 17 | T-7 中断后 400 | ✅ | `EnsureEveryCallHasResult`（写入时）+ `RepairToolPairing`（仅入口各调一次，未进热路径） |
| 18 | T-8 思考区上下跳 | ✅ | `overflow-anchor: none` + 两行缓冲；老大真机已确认 |
| 19 | T-9 吸附卡遮挡 | ✅ | 首行 inline paddingTop 遵循文件内既有约定 |
| 20 | T-10 压缩 head 前缀 pin 孤立 tool_result | ✅ | `PinnedPrefixLen` 补 `ToolResults.Count == 0` |
| 21 | T-11 `arguments` 自由对象 | ✅ | schema 改为对象，与执行侧口径一致 |
| 22 | T-12 空响应纳入重试 | ✅ | `ProviderEmptyResponseException` → `ProviderRetryPolicy` 重试分支 |
| 23 | T-13 聊天窗 chip 化 | ✅ | 展开点覆盖发模型 / 记忆 / 导出 / 标题；C# 侧 `SessionRestoreTools.ExpandPastedBlocks` 兜住冷启动；坏 payload 整段保留 |
| 24 | T-14 底部统计条口径 | ✅ | 每次加载重取 DB 基线 + 同趟清零增量；真机待验 |
| 25 | T-15 渲染追赶 | ✅ | 连续单调公式 `ceil(pool/K)`；新增回归 20045 断言；**真机观感待验** |

### S-23 细项（需求 5）
- ✅ `bing_cn` 已从引擎注册表摘除（全仓零命中）；`isLowQualityCard(url, engineHost)` 带**引擎自身域豁免**；`interleaveByEngine` 轮转 + `deduplicate(..., query)` 相关性优先级均在位。
- ✅ UA：搜索走 `web:fetch` → Worker 的 WebFetch executor（已是桌面 Chrome UA + `Accept-Language: zh-CN`），「旧渲染端零 UA」这条确实只存在于被删的旧链路。
- ✅ 旧名兼容：C# 侧只声明 `WebSearch`（`BrowserToolProvider.cs:112`），`BrowserSearch` 仅保留在**展示名单**与别名表 `tool-name-aliases.ts:13`，方向正确。
- ✅ 目录拆分后 `lib/tools/browser-search/index.ts` 保持同名 import 路径，消费方未改。
- ℹ️ `visibility-snapshot.expected.txt` 未在本迭代改动是**正确的**——该 golden 只收 IsCore 直连工具（iter-28 收窄），Browser/Desktop 类工具不在其中；仓库内 `tests/**/bin/**` 下那几份含 `BrowserSearch` 的旧副本是**构建产物**（已被 `.gitignore` 忽略，无跟踪）。

---

## 三、发现清单

### ❌ F-1（S-21）自动切换「不粘会话」，只对自动推进那一轮有效

`applyAutoFallbackTarget` 落的是 `session.providerId/modelId`，并把 `modelSelectionMode` 保持 `'auto'`：

```ts
// src/renderer/src/stores/chat-store/session-slice.ts:592-602
session.providerId = providerId
session.modelId = modelId
session.modelSelectionMode = 'auto'   // 注释：下一次失败还要继续往下切
```

但 **auto 模式下 `session.providerId` 不参与路由**：

```ts
// src/renderer/src/lib/session-model-resolution.ts:118-131
if (!session?.pluginId && mode === 'auto') {
  return { ..., providerId: activeProviderId, modelId: activeModelId || null, isSessionBound: false }
}
```

`resolveSendModel` 只多一条优先分支，而该表**全仓没有写入方**：

```
$ grep -rn setAutoModelSelection src/ → 仅声明（ui-store-interface.ts:81）与实现（ui-store.ts:197），0 个调用点
→ useUIStore.autoModelSelectionsBySession 恒为 {}
```

**后果**：切过去之后，用户**下一条正常消息**回到全局 active provider（刚限额的那个）→ 再报限额 → 再切下一候选。表现为「每条消息都要先失败一次」，而不是 plan 写的「切过去就粘在当前会话，不回头」（`provider-auto-fallback.ts:19`）。只有 `runAutoFallback` 显式带 `provider` 载荷的那一轮走新服务商。

**修复建议**：`setSessionAutoFallbackTarget` 同时写 `useUIStore.getState().setAutoModelSelection(sessionId, {...})`（`resolveSendModel:334` 在 auto 模式下本来就优先读它；字段形状 `AutoModelSelectionStatus` 见 `ui-types.ts:25`）。既粘住会话，又保持 auto 语义让下次失败继续往下切。

### ❌ F-2（S-21）自动推进那一轮的运行参数与手动发消息**不一致**

> ✅ **已修复（2026-09-15）** —— 与 F-8 同源，一并处理：见 `plan.md` 的「修复」节。

`plan.md` S-21.D5 明确写「参数与用户手动发消息一致」。实际只传 4 个字段：

```ts
// provider-auto-fallback.ts:214-219
await useChatStore.getState().sendMessage({
  provider: buildAutoFallbackProviderConfig(target),
  messages: [{ role: 'user', content: text }],
  userMessageText: text,
  sessionId
})
```

手动路径（`use-chat-actions.ts:222-243`）还传 `toolPreset / workingFolder / sshConnectionId / projectId / collaborationMode`。Worker 直接从 parameters 读、**无会话兜底**：

```csharp
// AgentLoop.cs:189 —— 缺 toolPreset 默认 "full"（手动路径给的是 "chat"/"coding"）
var toolPresetId = JsonHelpers.GetString(parameters, "toolPreset") ?? "full";

// AgentRunContextPolicy.cs:33-60 —— 缺 projectId/workingFolder/scope 时推断
var scope = ... sessionMode == "global" || (projectId.Length == 0 && workingFolder.Length == 0) ? "global" : "project";
WorkerLog.Warn($"AgentRunContextPolicy: inferred scope={scope}; callers should provide an explicit scope");
if (scope == "global") collaborationMode = "chat";
```

**后果**：**project + cowork** 会话（最容易撞限额、最需要推进）撞限额后，自动推进那一轮以 `scope=global` + `collaborationMode=chat` + `toolPreset=full` 运行——项目级工具被 scope 过滤掉，agent 收到「继续推进」却干不了项目里的活；每次还打一条 `inferred scope` 警告。另 `temperature / maxTokens / thinkingEnabled / thinkingConfig / reasoningEffort` 也没带（`buildAutoFallbackProviderConfig` 9 字段 vs `buildProviderPayload` 15 字段）。

**修复建议**：复用 `resolveSendModel(sessionId)` + `buildProviderPayload(...)`，并按会话补齐参数，与手动路径共用同一构造器。

### ❌ F-8（S-20）自定义请求头在**主聊天链路**上不生效

> ✅ **已修复（2026-09-15）** —— provider 载荷改为单点构造（`lib/agent/provider-payload.ts`），五个发送点全部收敛；`sessionId` 由 chat store 盖章。见 `plan.md` 的「修复」节。

界面侧没问题（编辑器 / 保留头拦截 / RFC token 校验 / i18n 都在）。问题是**链路**：C# 只从「本次请求的 provider 元素」里读 `requestOverrides`，而主聊天链路发的 provider 是手搓字面量，**不含该字段**。

```csharp
// ProviderRequestOverrides.cs:18 / :66 —— 唯一取值处
if (!provider.TryGetProperty("requestOverrides", out var overrides) ...
// AgentLoop.cs:34 / :173 —— provider 只来自参数
var provider = GetObject(parameters, "provider");
// 全仓 requestOverrides 的 C# 引用只有 ProviderRequestOverrides.cs 与 OpenAIAudioTools.cs —— 无 ProviderStore 兜底
```

```ts
// use-chat-actions.ts:205-220（主聊天）
const provider = { id, name, type, apiKey, baseUrl, providerBuiltinId, model, contextLength,
  temperature, maxTokens, thinkingEnabled, thinkingConfig, reasoningEffort,
  requestTimeoutSeconds, requestMaxRetries }        // ← 无 requestOverrides，也无 userAgent
```

而 `requestOverrides` 只在**旁路**被映射进载荷：

```
sidecar-mapping.ts:168  ...(provider.requestOverrides ? { requestOverrides: provider.requestOverrides } : {}),
sidecar-mapping.ts:154  userAgent: resolveProviderUserAgent(provider.userAgent),
→ 其唯一入口 buildSidecarAgentRunRequest 的调用方：agent-bridge-streaming（providerTurn / 压缩）、pet-agent、cron-runtime、translate-agent-service
```

本迭代只动过 `requestOverrides` 的那一刀（`6837d6d6`）**没有改任何传输层**，`:168` 是既有代码。

**后果**：用户在设置里配的额外头（例：`x-opencode-session: {{sessionId}}`）在**正常聊天**里不会发出；同一原因也让 `userAgent`（Moonshot / Codex / Copilot 依赖）与 `omitBodyKeys`（Kimi 依赖）在主链路失效。plan 的 Mini 验证「配一个自定义头后发请求，确认头带上」与代码路径矛盾。

**一次就能定性**：配一个头 → 发一条消息 → 看 `request_debug` 事件（C# 在 `OpenAIChatProvider.cs:52-64` 用同一个 provider 元素生成）里的 headers。**若那里能看到自定义头，则我读错了，本条降级为文档问题**；若看不到，即坐实。

**修复建议**：把三处手搓 provider 载荷（`use-chat-actions.ts:205`、`buildProviderPayload:382`、`project-send-message.ts:181`）合并成**唯一构造器**，字段集对齐 `mapSidecarProvider`；这样既修 F-8，也顺手消掉 F-2 的同类病根。

### ❌ F-9（流程）S-21 未按「一个需求一个提交」——3 刀未折叠

`c98339c2`（D1+D7 骨架）/ `63fcfa42`（D2 配置面）/ `164acc99`（D3-D6 前端）属同一需求。`plan.md:76` 自己写了「收尾阶段用 `rebase` 折叠回单刀」——**还没做**。

### ❌ F-10（流程/文档）plan.md 的 `S-21.D7` 编号撞车 + 一个空壳 C# 测试工程

- 同一节里 `S-21.D7` 出现两次：一次是「真机验证（老大做）」（未勾选），一次是「回归测试工程」（已勾选）。读的人会误判进度。
- `tests/WishfulClaw.ProviderFallbackRegressionTests` 只有 1 条 sanity 断言（D1 备注承诺「状态机测试在 D3 填实」，但 D3 改前端方案后 C# 侧已无状态机可测），**却已进 `.sln` 参与编译**。前端真回归 `tests/provider-fallback/program.ts`（18 断言）只覆盖配置持久化的浅拷贝 bug 与纯函数，**没覆盖 F-1/F-2 两条主链**。

### ⚠️ F-3（S-21）`isQuotaFailure` 匹配过宽，可能误触发自动切换

```ts
// provider-auto-fallback.ts:29-41
const QUOTA_PHRASE_PATTERNS = [/rate[_\s-]?limit/i, /\bquota\b/i, /usage[_\s-]?limit/i, /overload/i, /\bcapacity\b/i]
```

`overload` / `capacity` 是通用词，任何非限额错误文案里带上它们（如工具/编译报错里的 "No overload matches this call"、"at capacity"），且会话是 auto + 配了 fallback 时，会被判成限额 → **自动换服务商并自动再发一条消息**（用户没要求的动作）。判定入口 `chat-store/index.ts:1710` 的 error 分支，`event.message` 不保证只来自 provider 请求层。
**建议**：收紧为 `HTTP 429/503` + 明确限额短语，去掉通用词；或同时校验错误来源。

### ⚠️ F-4（S-21）切换后 400ms 内竞态未处理
`scheduleAutoFallback:197-205` 当场算好 target，400ms 后才执行，执行时**不重新校验**会话是否仍是 auto、用户是否已手动切模型/发消息。窗口内的手动操作会被这条延迟动作覆盖。

### ⚠️ F-5（S-21）`attemptedBySession` 只有惰性清理；`clearAutoFallbackAttempts` 无调用方
`:58-71` 仅在会话再次被读取时删过期项；`clearAutoFallbackAttempts`（`:73-75`）全仓无调用点，建议挂到会话删除/关闭。

### ⚠️ F-11（S-25）`metadata_json` 手工字符串拼 JSON
`AgentLoop.cs` / `AgentRuntimeGlobalDispatchReplyExecutor.cs:133` / `AgentRuntimeTaskExecutor.cs` / cron 四处用 `$"{{\"task_id\":\"{taskId}\"}}"` 这类插值。当前插入值都是 id/枚举，实用风险低，且面板只用 `message` 列（不 parse metadata，`TimelinePanel.tsx` 无 `JSON.parse`），但插值值含 `"` / `\` 时会写出非法 JSON。**建议**改用 `JsonSerializer` 或 `JsonWriter`。

### ⚠️ F-12（S-18）提交图谱限 50 条且无截断提示
`git-store-types.ts:COMMIT_GRAPH_LIMIT = 50`，C# 上限 200，面板无「仅显示最近 N 条」的说明 —— 老仓库里旧提交静默不可见，用户会以为图谱不全。

### ⚠️ F-13（S-19）落盘路径无边界
`image-persist.ts:persistImageBuffer` 对 `targetPath` 不做任何限制（绝对路径直接 `normalize`、相对路径相对 `baseDir`，含 `..`），工具入参来自模型。cowork 会话本就有 shell 权限，增量风险有限，但与「截图落盘」这个用途相比边界过宽。**建议**：限定在工作目录内，或至少拒绝非工作目录的绝对路径。

### ⚠️ F-14（S-25）「全部会话」作用域实际按 projectId 过滤
`TimelinePanel.tsx:65` 在 global 作用域下传 `params.projectId = projectId ?? undefined` —— 当前有激活项目时，「全部会话」只显示该项目的记录，与标签语义不符（无项目时才是真全局）。

### ⚠️ F-15（存量，非本迭代引入）i18n 缺口
本迭代新增 key **完全对称**；但 `zh/settings.json` 有 **32 个 channel/qr/feishu/dingtalk/wecom key 在 en 缺失**（`zh=1378` vs `en=1346`），另 `en/chat.json` 有 4 处值为中文（`folderSelector.sshComingSoon`、`folderSelector.sshPlaceholder`、`input.runtimeMetrics.input`、`input.runtimeMetrics.cacheHit`）、`en/chat.json` 缺 `goal.pendingTitle`。抽查确认**均非本迭代引入**，建议另开需求。

### ⚠️ F-16（S-21/F-2 同源）provider 载荷构造器三处重复、字段集互不相同
`use-chat-actions.ts:205`（15 字段）、`buildProviderPayload:382`（15 字段，含 temperature/maxTokens）、`project-send-message.ts:181`（9 字段）、`provider-auto-fallback.ts:165`（9 字段）、`mapSidecarProvider`（30+ 字段）。任何新增 provider 字段都会漏掉其中几处 —— F-2 与 F-8 都是这个结构问题的表现。

---

## 四、未能验证项（不做猜测）

1. **S-21.D7 真机验证**：需两个可控 provider / mock 429，agent 侧无闭环。
2. **S-22 微信回推**：无渠道环境，需真机走一遍「全局派发 → 项目回报 → 助理回复」。
3. **T-13.6**：粘贴 → chip → 重启后仍在（需真机）。
4. **T-14.3**：只加载 5 轮历史时统计与完整加载一致（需真机）。
5. **T-11.2**：`use_capability` 调 `builtin:Task` / `mcp-tool:*` / `skill:*` 三类带参（需真实模型）。
6. **T-15 观感**：不滞后 + 不跳（需真机；本次已用回归断言锁住数学性质）。
7. **S-20 的实际生效性**（F-8）：代码路径判定为「主链路不生效」，需一次真机/`request_debug` 反证。
8. **S-19 / S-18 / S-24 / S-17 的目视验收**：需真机。
