# 迭代 29 规划合规报告

> 审查时间：2026-09-14
> 被审对象：docs/plans/iter-v2-29/plan.md
> 审查方式：独立 subagent 只读审查
> 结论：**FAIL**（❌ 7 项 > 0，禁止进入用户确认环节）

---

## 一、总体结论

plan.md 的**骨架质量是高的**：10 个需求全覆盖、顺序合理、全局门禁与提交口径清晰、与 raw-requirements 一致（`request_usage_logs` 已明确排除、未擅自分批）。路径勘测整体水平也远超平均——我逐条抽验了 10 个需求约 60 个锚点，**绝大多数行号精确命中**（如 `UsagePanel.tsx:33/314-335/337/452-472`、`AgentLoop.cs:319-328/526-532`、`DesktopToolProvider.cs:17-23`、`DbModule.cs:144-146` 全部对得上）。

但存在 **7 个阻断项**，其中 1 个不是路径笔误而是**技术方案建立在错误事实之上**（S-20.3 的 `{sessionId}` 占位替换，C# 侧 `ResolveHeaderTemplate` 早已实现且语法是 `{{sessionId}}`），其余 6 个是文件/目录路径不存在。分层方面**没有问题**——立项时重点怀疑的 S-19 / S-21 / S-25 三处 C# 落点，实测全部符合 7 层单向依赖（`DbModule.cs` 确实在 Infrastructure/Db/ 下，`DesktopToolProvider.cs` 确实在 Tools/Providers/ 下，不存在 Worker 层误挂）。

统计：**✅ 41 项 / ⚠️ 9 项 / ❌ 7 项**。

---

## 二、逐项检查（按 dev-workflow 阶段三的 5 个检查项分节）

### 检查项1：步骤是否完整覆盖任务目标

**✅ 1.1 10 个需求全部成节，无漏项**
依据：`plan.md:57/79/105/129/153/176/206/233/256/283` 依次是 S-24 / S-20 / S-22 / S-17 / S-23 / S-16 / S-18 / S-19 / S-21 / S-25，与 `raw-requirements.md` 的 S-16 ~ S-25 一一对应，无缺。

**✅ 1.2 未按批次拆分、未砍需求**
依据：`plan.md:10`「不分批，虽然细项多但大部分是小修复小调整」；全文 grep「分批/Phase/阶段一」零命中；`plan.md:53`「10 个需求 + 1 个收尾修复调整 = 11 个提交」与 10 需求数吻合。

**✅ 1.3 各需求步骤粒度可执行**
S-24（.1~.5）、S-20（.1~.6）、S-22（.1~.5）、S-17（.1~.5）、S-23（.0~.5）、S-16（.1~.6）、S-18（.1~.7）、S-19（.1~.5）、S-21（D1~D6）、S-25（.1~.7），每步都是单一可落地的动作，没有「改造整个模块」这类不可拆的巨步。

**✅ 1.4 raw-requirements 点名的附带收益已纳入**
老大原始需求中「请求明细移走后图表调高」→ `plan.md:67` S-24.4 已立项；S-25「保留策略」→ `plan.md:296` S-25.5 已立项。

**⚠️ 1.5 S-25 的 UI 落点未定，目标「用户可随时查看回溯」缺闭环**
依据：`plan.md:297` S-25.6 写的是「落点**若**走右侧面板**则**需新增 `RightPanelTabKind`」——条件句，未决；`plan.md:306` 涉及文件写 `src/renderer/src/components/...`（占位符）。AGENTS.md「迭代交付标准」要求「有入口」，本需求目前无确定入口，且该未决项**未进「执行前需要老大处理」清单**（`plan.md:315-323` 只有 5 条，不含它）。

**⚠️ 1.6 S-23 的开工依赖老大回答，未答则该需求无法执行**
依据：`plan.md:160` S-23.0「须先问到实际配置再动手」+ `plan.md:319` 老大事项 1。这条是合理的（默认值 `tavily + 空 apiKey` 与「返回词典结果」现象确实矛盾，见 `settings-store.ts:337-340`），但意味着**确认环节必须答这一条**，否则 S-23 落地时只能盲修。

### 检查项2：每步是否有明确的验证检查点

**✅ 2.1 每个需求节都有「Mini 验证」**
依据：`plan.md:70/95/120/142/167/192/221/246/272/300`，10 节齐全，格式统一。

**✅ 2.2 多数 Mini 验证可判定（给了现象或命令）**
- S-24「切换四个 Tab 无残留渲染；明细翻页仍走 `loadLogsPage` 且防串号不失效；tsc 三配置零错误」（`plan.md:70`）
- S-20「配一个自定义头后发请求确认带上；`{sessionId}` 被替换成真实会话 id；填 `Authorization` 被拒且有提示」（`plan.md:95`）
- S-17「真实触发一次 `use_capability`，状态条显示真实工具名而非 `use_capability`；skill 与 mcp-tool 两种形态都验」（`plan.md:142`）
- S-19「**实拍一张并落盘到指定仓库路径**」（`plan.md:246`）—— 点名核心验收
- S-16「粘贴 2000+ 字折叠成 chip；草稿保存后重进 chip 仍在；Ctrl+Z 行为符合预期」（`plan.md:192`）

**✅ 2.3 迭代级验证门禁列出的 npm 测试脚本真实存在**
依据：`package.json:22-31` 命中 `test:renderable-chat-items` / `test:provider-presets` / `test:settings-tabs` / `test:ipc-msgpack-routing` / `test:updater-*`，与 `plan.md:330` 一致。

**⚠️ 2.4 S-21 的「状态机测试」无承载工程**
依据：`plan.md:272`「状态机测试覆盖 429/503/超时、有限/无限、全失败、取消」，但 `ls src/runtime/` 只有 8 个生产项目（Agent/CodeGraph/Contracts/Core/Infrastructure/Persona/Worker/Workspace）**+ sln，无任何测试工程**，plan 的涉及文件（`plan.md:274-279`）也没有新增测试项目。这条验证落地时会悬空。

**⚠️ 2.5 S-25「保留策略生效」不可当场判定**
依据：`plan.md:300`。按天数清理的策略无法在实施时验证「生效」，需改为可判定的写法（如：手动把表里 `created_at` 改到阈值前 → 触发清理 → 断言行数下降）。

**⚠️ 2.6 S-22 的结论性验证完全外包给老大**
依据：`plan.md:120`「真机微信复现由老大执行（agent 无微信渠道环境）」+ `plan.md:320`。诚实且已列入老大清单，可接受，但要明确记录：**本需求在 agent 侧没有自验证闭环**，不能算「测通」。

### 检查项3：文件路径是否符合项目结构

> 本项是本次审查的重灾区。已逐条抽验，先列命中的，再列错的。

**✅ 3.1 S-24 全部锚点精确命中**
| plan 引用 | 实测 |
|---|---|
| `UsagePanel.tsx:33` | `type UsageChartTab = 'line' \| 'bar' \| 'stats'` ✅ |
| `:314-335` 切换条 | `:314` `<div ... role="tablist">`，`:316-318` 硬编码中文标签 ✅ |
| `:337` | `{chartTab === 'stats' ? (` ✅ |
| `:452-472` 明细区块 | `:452` `{/* Detail lines */}` … `:471` `</SettingsSection>` ✅ |
| `:218-243` | `loadLogsPage`，含 `logsLoadSeq` 防串号 ✅ |
| `UsagePanelParts.tsx:290` | `const height = 240`（LineChart）✅ |
| `UsagePanelParts.tsx:306` | `className="h-56 w-full"` ✅ |
| `UsagePanelParts.tsx:389` | `const height = 240`（BarChart）✅ |
| `usage-detail-table.tsx:116-127` | props 签名 ✅ |

**✅ 3.2 S-20 传输链锚点精确命中**
`shared/types/provider.ts:349` = `requestOverrides?: RequestOverrides` ✅；`ProviderRequestOverrides.cs:61` = `ApplyHttpHeaderOverrides` 签名 ✅；`sidecar-mapping.ts:155` = `sessionId` ✅、`:168` = `requestOverrides` ✅；`OpenAIChatHeaders.cs:27-32` 与 `:45-50` = opencode-go 的 `x-opencode-session` 特判两处 ✅。

**✅ 3.3 S-22 根因断言经反证成立**
`grep -c registerExternalChannelReply src/renderer/src/lib/tools/project-send-message.ts` → **0**，plan「全文件没有 `registerExternalChannelReply`」成立 ✅；`project-send-message.ts:193` = `await useChatStore.getState().sendMessage({` ✅；`use-channel-auto-reply.ts:487-515` = `activeAutoReplies.get(sessionId)` + `loop_end → sendAgentReply` ✅；`DbPluginSessionRouting.cs:36` = `BuildPluginMessageSessionKey(pluginId, chatId)` ✅、`:49-57` = 按 compositeKey 查 session ✅；`LogsPanel.tsx:111` = `updateSettings({ logLevel })` ✅、`:171-184` = 等级下拉 UI ✅；`logger.ts:39-54`（`src/main/lib/logger.ts`）= `minLevel` / `setLogMinLevel` / `WISHFUL_CLAW_LOG_LEVEL` ✅。

**✅ 3.4 S-17 展示层锚点精确命中**
`runtime-status.tsx:191` = `activeToolName: activeTool?.name ?? null` ✅、`:192` = `pendingApprovalToolName` ✅；`composer-status-indicator.tsx:77` = activeToolName ✅、`:78` = pendingApprovalToolName ✅、`:151-156` = runningTool 文案 ✅、`:117-121` = awaitingApproval 文案 ✅；`use-capability-proxy.ts:51-56` = `skill:` → 固定 `'Skill'` ✅；`stream-event-adapter.ts:45-57` = `tool_use_streaming_start` 构造 `input: {}` ✅、`:94-98` = `tool_call_start` 系列走 `rewriteProxyEvent` ✅；`execution-outline.ts:110-111` = 「unresolved use_capability card is noise, so hide it」注释 ✅。

**✅ 3.5 S-23 四个 provider / schema / 配置锚点命中**
`WebSearchProviders.cs:18` = Google URL 带 `hl=en` ✅、`:22` = `Accept-Language: en-US,en;q=0.9` ✅、`:37`/`:41` = Bing URL 与 Accept-Language ✅；`WebToolProvider.cs:23` = `["count"] = ToolSchemaBuilder.Number(...)` ✅；`AgentRuntimeWebSearchExecutor.cs:57` = `GetInt(call.Input, "maxResults", ...)` ✅、`:60` = `GetString(call.Input, "searchMode") ?? "web"` ✅（schema 声明 `count`、执行器读 `maxResults` 的入参不匹配**属实**）；`settings-store.ts:337-340` = `tavily` + 空 apiKey ✅。

**✅ 3.6 S-16 粘贴与撤销锚点命中**
`use-composer-interactions.ts:51-74` = `handlePaste` ✅、`:67` = `document.execCommand('insertHTML', ...)` ✅、`:73` = `replaceSelectionWithText(plainText, selection)` ✅；`file-aware-editor-undo-selection.ts:5-7` = `isHistoryInputType` ✅、`:32-40` = `collapseRestoredHistorySelection` ✅（真实路径 `src/renderer/src/components/chat/file-aware-editor-undo-selection.ts`）；`InputArea/index.tsx:262-263` = `getLiveEditorState()` 与 `promptText` 取值 ✅；`FileAwareEditor.tsx` 在 `components/chat/` 下 ✅。

**✅ 3.7 S-18 面板与 Git 锚点命中**
`AgentFilesPanel.tsx:15` = `useState<'files' | 'changes'>('files')` ✅、`:52-57` = 两个裸 `<button>` ✅、`:60` = `activeTab === 'files' ? ... : ...` 三元 ✅；`GitQueryTools.cs:24-39` = operation switch 分发 ✅、`:248-271` = `ListBranchesAsync`（本地/远程分组）✅；`git-cache.ts:125-127` = 三个缓存 Map ✅、`:155-160` = `gitQueryTtl` 中 `list-branches → GIT_QUERY_STABLE_TTL_MS` ✅；`git-handlers.ts:160` = `git:list-branches` ✅；`git-store.ts:88` = `selectRepository` ✅。

**✅ 3.8 S-19 主进程 IPC 锚点命中**
`messagepack-handler.ts:10-25` = `registerMessagePackHandler` ✅；`misc-handlers.ts:19-33` = `registerMiscHandlers` 样板 ✅、`:246-251` = `getGeneratedImagesDir()`（写死 `homedir()/wishful-claw/image`）✅、`:268-292` = `image:persist-generated` ✅；`main-window-registry.ts:22` = `getMainWindow()` ✅；`channel-handlers/qr-page-capture.ts:135` = `win.webContents.capturePage(bounds)` ✅；`Tools/Providers/DesktopToolProvider.cs:17-23` = `DesktopScreenshot` 仅 `delayMs` 入参 ✅。

**✅ 3.9 S-21 调用链锚点命中**
`AgentLoop.cs:319-328` = `while(true)` + `ProviderRetryPolicy.ExecuteAsync(...)` ✅、`:526-532` = `ExecuteTurnAsync` 签名 ✅；`ProviderRetryPolicy.cs:80` = `ExecuteAsync` ✅、`:156-170` = 耗尽 `throw` 的 catch 块 ✅；`AgentRuntimeTools.cs:291-304` = 异常收尾 `EmitLoopEndAsync(..."error")` ✅；`ProviderPanel.tsx`（`components/settings/`）与 `src/shared/types/provider.ts` 均存在 ✅。

**✅ 3.10 S-25 数据层锚点命中**
`DbClient.cs:266` = `CREATE TABLE IF NOT EXISTS goal_events (` ✅；`DbModule.cs:144-146` = `db/goal-events-list` / `-list-page` / `-add` ✅；`goal-session-views.tsx:80` = `export function GoalEventTimeline(` ✅；`ui-types.ts:54-65` = `RightPanelTabKind` union ✅；`RightPanel.tsx:79-99` = tabs 标题映射 ✅、`:193-198` = 按 `tab.kind` 分发面板 ✅。

**❌ 3.11 `locales/zh|en/*.json` 路径不存在（跨 S-24 / S-20 / S-19 / S-18 / S-17 多处）**
依据：`ls -d locales` → `No such file or directory`（仓库根无此目录）；`find . -name settings.json` 只命中 `src/renderer/src/locales/{en,zh}/settings.json`。plan 在 `plan.md:75/101/149/199/229/279/307` 反复写 `locales zh/en — 改`，`plan.md:68` 写 `locales/zh/settings.json:1503`。
正确路径：`src/renderer/src/locales/zh/settings.json`、`src/renderer/src/locales/en/settings.json`。
注：行号**是对的**——`src/renderer/src/locales/zh/settings.json:1503` 正是 `"usage": {`，且 usage 段内确实无 `tabs` 子键（只有 `ranges` :1508 与 `detail` :1541），plan 的判断成立，只是路径少了 `src/renderer/src/` 前缀。

**❌ 3.12 `locales/zh/chat.json:134/:135`（S-17.5，plan.md:140）** — 同上，真实为 `src/renderer/src/locales/zh/chat.json`，且内容核对正确：`:134` = `"runningTool"`，`:135` = `"awaitingApproval"`。

**❌ 3.13 `src/renderer/src/components/settings/ProviderConfigPanel.tsx`（S-20.1，plan.md:88/98）** — 不存在。真实：`src/renderer/src/components/settings/provider/ProviderConfigPanel.tsx`（`find` 唯一命中）。

**❌ 3.14 `src/renderer/src/components/settings/AddProviderDialog.tsx`（S-20.2，plan.md:89/99）** — 不存在。真实：`src/renderer/src/components/settings/provider/AddProviderDialog.tsx`。行号 `39-48` 内容对得上（`:39-41` baseUrl/homepage/apiKey state，`:46-48` `handleAdd` + `addCustomProvider(...)`）。

**❌ 3.15 `WebSearchProviders.cs:195-215` 归错文件（S-23.3，plan.md:163/170）**
依据：`wc -l src/runtime/WishfulClaw.Agent/WebSearchProviders.cs` = **164 行**，195-215 根本不存在；`grep -rn ExtractBaiduResults` 定义落在 `src/runtime/WishfulClaw.Agent/AgentRuntimeWebSearchExecutor.cs:195`，且 `:195-215` 正是 plan 描述的 class 白名单（`c-abstract|content-right_...|content-right|c-span-last|c-color-text|result-op`）。
正确：`src/runtime/WishfulClaw.Agent/AgentRuntimeWebSearchExecutor.cs:195-215`（行号巧合一致，只有文件名错了——显然是抄对了行号、贴错了文件名）。

**❌ 3.16 `src/renderer/src/lib/select-file-editor/*` 目录不存在（S-16.1，plan.md:185/197）**
依据：`ls src/renderer/src/lib/select-file-editor/` 无输出（目录不存在）；`grep -rln serializeEditorDocument` 命中 `src/renderer/src/lib/select-file-editor.ts`（**单文件**）与 `use-composer-editor.ts`；`EditorDocumentNode` 定义在 `src/renderer/src/lib/select-file-editor.ts:41`。
正确：`src/renderer/src/lib/select-file-editor.ts`。

**⚠️ 3.17 S-17.1 的 `resolveProxyDisplay`（`:30-32`）未标文件名，易误读**
依据：若按前文理解为 `stream-event-adapter.ts:30-32`，那里是 `case 'context_compression_start':` 一串 case 标签，与描述无关；实际 `resolveProxyDisplay` 的调用在 `stream-event-adapter.ts:15-17`（`rewriteProxyEvent` 内），本体定义在 `use-capability-proxy.ts:22`，「拿不到 capability_id 返回 null」是 `use-capability-proxy.ts:30`。判定：更可能指 `use-capability-proxy.ts:30`，故不记 ❌，但**必须补上文件名**。

**⚠️ 3.18 S-25 涉及文件用 `src/renderer/src/components/...` 占位**
依据：`plan.md:306`。非真实路径，需在确认环节钉死（与 ⚠️1.5 同一问题）。

### 检查项4：分层依赖是否正确

**✅ 4.1 S-25 的 `DbModule.cs` 确实在 Infrastructure 层（立项时的重点怀疑不成立）**
依据：`ls src/runtime/WishfulClaw.Infrastructure/Db/` 含 `DbModule.cs`；`sed -n '140,150p'` 读到 `context.Register("db/goal-events-list", DbGoalTools.ListEvents)` 等。同目录还有 `DbGoalTools.cs` / `DbTaskTools.cs` / `DbCronRunTools.cs` / `DbSubAgentTools.cs` 等一众 `Db*Tools`，**`DbAgentTimelineTools.cs` 放这里完全符合 AGENTS.md「Infrastructure/Db：DbClient + Entities + Db*Tools」**。`InfrastructureJsonContext.cs` 也在该目录 ✅。

**✅ 4.2 S-25 的注册端点写法与现有 goal-events 一致**
依据：`plan.md:294` 写的 `context.Register("db/agent-timeline", ...)` 与 `DbModule.cs:144-146` 的 `context.Register("db/goal-events-*", DbGoalTools.*)` 同构（短横线命名、静态方法委托），符合现状。

**✅ 4.3 S-25 埋点在 Agent 层、落库在 Infrastructure 层，方向合法**
`plan.md:295` 的埋点落点（全局任务派发/回报、todo 变更、cron、子 Agent）均在 Agent 层，通过 `db/agent-timeline` 端点 → Infrastructure 实现，属 `Agent → Infrastructure` 顺向依赖 ✅，无逆向。

**✅ 4.4 S-19 / S-21 的 C# 改动都在 Agent 层**
`Tools/Providers/DesktopToolProvider.cs`、`AgentLoop.cs`、`ProviderRetryPolicy.cs`、`AgentRuntimeTools.cs` 全在 `WishfulClaw.Agent/`，Agent 依赖 Contracts+Core+Infrastructure+Persona，被改动的都是自身文件 ✅。

**✅ 4.5 S-23 的 WebSearch 改动同层，无跨层**
`WebSearchProviders.cs` + `AgentRuntimeWebSearchExecutor.cs` + `Tools/Providers/WebToolProvider.cs` 三者同在 Agent 层，且 `WebSearchProviders.cs:14` 是 `internal static partial class AgentRuntimeWebSearchExecutor` 的 partial 拆分 ✅。

**✅ 4.6 全局门禁的 AOT 口径与 AGENTS.md 一致**
`plan.md:46`「新增具名 DTO 须注册进 `InfrastructureJsonContext` / `WishfulClawJsonContext`（含 `List<T>`）」——两处 JsonContext 均真实存在（`Infrastructure/Db/InfrastructureJsonContext.cs`、`Worker/WishfulClawJsonContext.cs`），符合 AGENTS.md AOT 规范第 5/8 条 ✅。

**✅ 4.7 未发现逆向依赖**
10 个需求的涉及文件里无一处下层引用上层。

### 检查项5：是否参考了正确的源码文件

**✅ 5.1 S-16 的参考源码真实存在且切题**
依据：`ls -la /d/claw/DeepSeek-Reasonix/desktop/frontend/src/components/Composer.tsx` → 199846 字节，存在 ✅，与 `raw-requirements.md:30-35` 登记的勘测来源一致。

**✅ 5.2 S-25 的参考源码路径正确**
依据：`goal-session-views.tsx:80-109` = `GoalEventTimeline` 组件（实测命中）；参考源码节另列 `components/goal/GoalHistoryPanel.tsx` + `goal-history-store.ts`（`plan.md:310`）为溯源指引 ✅。

**✅ 5.3 S-21 复用 iter-27 Plan D 的引用正确**
依据：`plan.md:261` 引 `docs/plans/iter-v2-27/plan.md:195-205`，与 `raw-requirements.md:149` 的移交口径一致。

**⚠️ 5.4 10 个需求节中只有 2 节（S-16 / S-25）有「参考源码」小节**
依据：dev-workflow 阶段二要求 plan.md 四要素（目标 / 步骤+验证点 / 涉及文件 / 参考源码）。本项目 plan 是多需求合一，按「每节都要有」判，缺 8 节。考虑到多数需求不需要外部参考源码，记 ⚠️ 而非 ❌，但 S-19（截屏能力，raw 明确记了 iter-28 的失败通路 `mcp__browser-use__take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`）建议至少把「已验证不可用的外部通路」写进参考/避坑说明，避免重复踩。

**❌ 5.5 S-20.3 的占位替换方案基于错误事实（技术方案级错误，非路径问题）**
依据（详见 §四 阻断项 1）：`ProviderRequestOverrides.cs:126-133` 已有 `ResolveHeaderTemplate`，支持 `{{sessionId}}` / `{{model}}`；且已在 `:84`（`ApplyHttpHeaderOverrides`）与 `:117`（`ApplyDebugHeaderOverrides`）被**自动调用**。plan 写「`{sessionId}` 动态占位 —— 在 C# 或渲染端做占位替换」，一是重复造轮子，二是语法写错（单花括号 vs 既有双花括号）。

**⚠️ 5.6 plan「关键前提」称 `ApplyHttpHeaderOverrides` 已在 4 处被调用，实测 5 处**
依据：`grep -rn ApplyHttpHeaderOverrides src/runtime` 命中 5 个调用点——`AnthropicMessagesProvider.cs:209`、`ContextCompression.cs:550`、`ContextCompression.cs:695`、`OpenAIChatHeaders.cs:26`、`OpenAIResponsesProvider.cs:244`。不影响方案，但说明「已通」的程度比 plan 说的更好。

---

## 三、需求覆盖对照表

| 需求 | raw-requirements 中的要点 | plan 是否覆盖 | 判定 |
|---|---|---|---|
| S-24 | 请求明细移进选项卡；图表调高 | `plan.md:57-75`，新增 `'detail'` Tab + 删原区块 + 图表 height/h-56 + i18n | ✅ |
| S-20 | 自定义服务商可配请求头；头值可能随会话变化；先查清能力面 | `plan.md:79-101`，静态值 + 动态占位 + 保留头校验 + 不动内置 preset | ⚠️ 覆盖完整，但动态占位方案错（见 ❌5.5） |
| S-22 | 回报后助理新消息未推微信；先复现再改 | `plan.md:105-125`，S-22.1 先降日志复现 + 补 `registerExternalChannelReply` + 复用 compositeKey | ✅ 根因断言经反证成立 |
| S-17 | 状态条显示被代理真实工具名；审批提示同口径；卡片是否统一待定 | `plan.md:129-149`，口径 5 已裁定「卡片保持隐藏」并给出 `execution-outline.ts:110-111` 依据 | ✅ |
| S-23 | 中文查询返回词典结果；只修 bug 还是补能力待定 | `plan.md:153-172`，口径 1 裁定「先只修 bug」；去 `hl=en` + 修 `count`/`maxResults` | ⚠️ 覆盖完整，但 Baidu 解析归错文件（❌3.15）；开工依赖老大答配置 |
| S-16 | 长粘贴折 chip；原文无损；提交替换回全文；与 undo 联动 | `plan.md:176-202`，节点类型 + 粘贴分支 + 渲染 + 撤销 + 提交落点 | ⚠️ 覆盖完整，但 `select-file-editor/*` 路径不存在（❌3.16） |
| S-18 | 右侧面板分支视角：本地/远程分支 + 提交图谱；位置待定 | `plan.md:206-229`，口径 6 裁定「第三个 Tab」；新 operation + IPC + 缓存 + SVG 手绘 | ✅ |
| S-19 | 截**软件自身窗口**并落盘仓库路径；截自身还是整桌面待定 | `plan.md:233-252`，口径 4 裁定「先做截自身窗口」；新 IPC + `targetPath` + 工具暴露 + AOT | ✅ |
| S-21 | 限额（5h/周/429/503）自动 fallback，保持上下文连贯 | `plan.md:256-279`，沿用 Plan D 骨架 D1–D6，含取消/无限重试/不循环约束 | ⚠️ 覆盖完整，但「状态机测试」无承载工程（⚠️2.4） |
| S-25 | 自动记录 Agent 干了什么；粒度/建表/作用域/保留策略/UI 落点待定 | `plan.md:283-311`，口径 3 裁定「决策级 + 新建 `agent_timeline_events`」；建表 + 埋点 + 保留策略 + UI | ⚠️ 覆盖完整，但 UI 落点未定（⚠️1.5） |

**一致性专项：**
- **`request_usage_logs` 已排除** ✅ —— `plan.md:288` 明确写「与『Agent 干了什么』无关，**不作为本需求素材**（老大 2026-09-14 点名纠正）」；`plan.md:296` 仅在保留策略处作反面参照（「避免重蹈无 prune 的覆辙」），未并作素材。**符合老大口径。**
- **未擅自分批** ✅ —— `plan.md:10` 明写老大拍板「不分批」，全文无 Phase 拆分。
- **无凭空加项** —— 各节新增内容（S-20.4 保留头校验、S-24.5 i18n 等）均属实现必需的防护或既有硬约束，越界项已在「全局口径裁定」表（`plan.md:33-40`）显式列出待老大过目，属合规做法。

---

## 四、❌ 项清单（阻断项，必须修复才能进用户确认）

### ❌ 1. S-20.3 占位替换方案建立在错误事实上，且语法写错（技术方案级）

**问题**：plan 认为「动态占位需要新做」，实际 C# 侧**早已实现**；且 plan 写的 `{sessionId}`（单花括号）与既有实现的 `{{sessionId}}`（双花括号）不一致。按 plan 实施，要么做无用功，要么做出与既有 `ResolveHeaderTemplate` 冲突的语法，用户配出来的头不生效。

**依据**：
- `src/runtime/WishfulClaw.Agent/ProviderRequestOverrides.cs:126-133`
  ```csharp
  public static string ResolveHeaderTemplate(string value, string sessionId, string model)
  {
      return value
          .Replace("{{sessionId}}", sessionId, StringComparison.Ordinal)
          .Replace("{{ sessionId }}", sessionId, StringComparison.Ordinal)
          .Replace("{{model}}", model, StringComparison.Ordinal)
          .Replace("{{ model }}", model, StringComparison.Ordinal)
          .Trim();
  }
  ```
- 已在 `:84`（`ApplyHttpHeaderOverrides` 内）与 `:117`（`ApplyDebugHeaderOverrides` 内）**自动调用**，无需改动 C#。
- plan 原文 `plan.md:36`（口径 2）与 `plan.md:90`（S-20.3）均写 `{sessionId}`。

**建议怎么改**：
1. S-20.3 改写为「**沿用既有 `ResolveHeaderTemplate`（`ProviderRequestOverrides.cs:126-133`），占位符语法统一为 `{{sessionId}}` / `{{model}}`；C# 侧零改动，只需确认 `sidecar-mapping.ts:155` 的 `sessionId` 与 `:168` 的 `requestOverrides` 已在链上（实测已在）」。
2. 设置页编辑器（`ProviderConfigPanel.tsx`）的占位提示文案与 i18n 同步改成 `{{sessionId}}`。
3. Mini 验证改为「配 `X-Session: {{sessionId}}` → 发请求 → 头值被替换为真实会话 id」。
4. 「关键前提」（`plan.md:84`）补一句：`ApplyHttpHeaderOverrides` 实际在 5 处被调用（Anthropic / ContextCompression ×2 / OpenAI Chat / OpenAI Responses），模板替换是全 provider 通用的。

### ❌ 2. `locales/zh|en/*.json` 路径不存在（跨 5 个需求）

**问题**：plan 把 i18n 文件写成仓库根 `locales/`，实际在 `src/renderer/src/locales/`。出现在 `plan.md:68`（S-24）、`:101`（S-20）、`:149`（S-17）、`:199`（S-16）、`:229`（S-18）、`:279`（S-21）、`:307`（S-25）。

**依据**：`ls -d locales` → `No such file or directory`；`find . -name settings.json` 仅命中 `./src/renderer/src/locales/en/settings.json` 与 `./src/renderer/src/locales/zh/settings.json`。

**建议**：全文替换为 `src/renderer/src/locales/{zh,en}/settings.json` 与 `src/renderer/src/locales/{zh,en}/chat.json`。行号无需改（`zh/settings.json:1503` = `"usage": {` 已核对正确）。

### ❌ 3. `locales/zh/chat.json:134/:135`（S-17.5）

**问题 / 依据 / 建议**：同 ❌2，真实路径 `src/renderer/src/locales/zh/chat.json`，行号 134（`runningTool`）/ 135（`awaitingApproval`）**正确**，只改路径。

### ❌ 4. `settings/ProviderConfigPanel.tsx` 不存在（S-20.1）

**依据**：`find src -iname "*ProviderConfigPanel*"` → `src/renderer/src/components/settings/provider/ProviderConfigPanel.tsx`。
**建议**：`plan.md:88`（步骤）与 `:98`（涉及文件）改为 `src/renderer/src/components/settings/provider/ProviderConfigPanel.tsx`。

### ❌ 5. `settings/AddProviderDialog.tsx` 不存在（S-20.2）

**依据**：`find src -iname "*AddProviderDialog*"` → `src/renderer/src/components/settings/provider/AddProviderDialog.tsx`；`:39-48` 内容核对无误。
**建议**：`plan.md:89` 与 `:99` 补 `provider/` 层级。

### ❌ 6. S-23.3 的 Baidu 解析归错文件（`WebSearchProviders.cs:195-215`）

**问题**：`WebSearchProviders.cs` 只有 164 行，195-215 不存在；plan 描述的「class 白名单」实际在另一个文件。

**依据**：`wc -l src/runtime/WishfulClaw.Agent/WebSearchProviders.cs` = 164；`grep -rn ExtractBaiduResults` → 定义在 `src/runtime/WishfulClaw.Agent/AgentRuntimeWebSearchExecutor.cs:195`，`:195-215` 内含 `c-abstract|content-right_[^\"']*|content-right|c-span-last|c-color-text|result-op[^\"']*` 白名单正则，正是 plan 要改的东西。

**建议**：S-23.3 与涉及文件统一改为 `src/runtime/WishfulClaw.Agent/AgentRuntimeWebSearchExecutor.cs:195-215`（行号不变，只换文件名）。

### ❌ 7. `lib/select-file-editor/*` 目录不存在（S-16.1）

**问题**：plan 按目录写，实际是单文件。S-16 的核心改动（新增 `pasted-block` 节点类型）落点因此是错的。

**依据**：`ls src/renderer/src/lib/select-file-editor/` 无输出；`grep -rln serializeEditorDocument src/renderer/src` → `src/renderer/src/lib/select-file-editor.ts`（单文件）+ `use-composer-editor.ts`；`EditorDocumentNode` 定义在 `src/renderer/src/lib/select-file-editor.ts:41`（`= EditorTextNode | EditorFileNode | EditorPluginNode`，加 `EditorPastedBlockNode` 即在此）。

**建议**：S-16.1 与涉及文件改为 `src/renderer/src/lib/select-file-editor.ts`（`:41` 起）。若实施中该文件超过 500 行需按 AGENTS.md 拆分，再另立目录并同步更新 plan。

---

## 五、⚠️ 项清单（非阻断，但执行前要处理）

1. **S-25 UI 落点未决**（`plan.md:297/306`）——「若走右侧面板则需新增 `RightPanelTabKind`」是条件句，涉及文件写 `src/renderer/src/components/...` 占位。AGENTS.md 要求「有入口」，建议在确认环节一并钉死（复用 `RightPanelTabKind`（`ui-types.ts:54-65`）+ `RightPanel.tsx:193-198` 分发是可行路径），并把落点写进涉及文件。
2. **S-23 开工依赖老大回答实际 provider 配置**（`plan.md:160/319`）——默认 `tavily + 空 apiKey`（`settings-store.ts:337-340`）与现象矛盾。确认环节必须答，否则只能盲修。
3. **S-21「状态机测试」无承载工程**（`plan.md:272`）——`src/runtime/` 下只有 8 个生产项目，无测试工程。建议明确测试怎么落地（新增测试项目 / 用 `tests/` 下的 esbuild+node 风格脚本 / 改为手工 Mock endpoint 验证并写明步骤）。
4. **S-25「保留策略生效」不可当场判定**（`plan.md:300`）——建议改成可操作断言（改 `created_at` 到阈值前 → 触发清理 → 断言行数下降）。
5. **S-17.1 的 `resolveProxyDisplay`（`:30-32`）未标文件名**（`plan.md:136`）——按 stream-event-adapter 读是一串 case 标签；实际是 `use-capability-proxy.ts:30`（`if (!capabilityId) return null`）；调用点在 `stream-event-adapter.ts:15-17`。补文件名。
6. **S-20.5 未点名要验 `x-opencode-session`**（`plan.md:92`）——代码里已知 OpenCode Go 的真实头名是 `x-opencode-session`（`OpenAIChatHeaders.cs:27-32`），Mini 验证应明确用这个头跑一遍，才算「覆盖同一场景」。
7. **S-20.4 可复用既有 `IsSensitiveHeader`**（`ProviderRequestOverrides.cs:135-141`，已覆盖 authorization/api-key/apikey/token）——但注意它当前用于 debug 脱敏而非覆盖拦截，语义不同；若要复用需确认不会误伤，否则另写保留头清单。
8. **S-22 无 agent 侧自验证闭环**（`plan.md:120/320`）——真机微信只能老大验。建议在需求提交时明确标注「本需求未自测通，待老大复现」，不要按「测通即提交」的默认口径直接当 PASS。
9. **参考源码节只覆盖 2/10 需求**（dev-workflow 阶段二四要素）——至少 S-19 建议补一条避坑说明：raw-requirements.md:106 已记录 `mcp__browser-use__take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`、in-app browser 指向 dev 渲染进程拿不到内容，**浏览器通路不能替代真机**，勿重复踩。
10. **S-20.2 标「可选」**（`plan.md:89`）——范围边界模糊，建议明确做或不做（建议做，否则新建服务商时仍配不了头，闭环不完整）。

---

## 六、执行前必须复核的未决项

plan 自标的未决项（原文摘录 + 处理要求）：

| # | 出处 | plan 原文 | 处理要求 |
|---|---|---|---|
| 1 | `plan.md:67` | 「立项时复核 BarChart 的 CSS 高度类（**未逐行确认 `:400-440`**）」 | S-24.4 开工前先读 `UsagePanelParts.tsx:400-440`。注意 LineChart 与 BarChart 是**两套并存**（`:290`/`:306` 与 `:389`），改漏一处会高低不齐。 |
| 2 | `plan.md:160` | S-23.0「**须先问到实际配置再动手**」 | **必须在确认环节由老大回答**（已列老大事项 1）。未答不得开工。 |
| 3 | `plan.md:268` | S-21.D4「切出 `openai-responses` 会丢 `OpenAIResponsesState` 的 response id（**未实测，须验**）」 | 实施 S-21.D4 时**必须实测**：从 `openai-responses` 切走再切回 / 切到别家，验证 response id 丢失是否断上下文。这是 Plan D 唯一标红的技术风险。 |
| 4 | `plan.md:5` | 「**行号均为 2026-09-14 实读，实施时按当时代码复核**」 | 全局适用。本次抽验显示行号质量高，但实施时仍以当时代码为准，不要在行号对不上时硬套。 |
| 5 | `plan.md:244` | S-19.5「落点待老大定」+「`docs/user-guide.md` 文末原有 10 处待配图清单，**实施时先核对还差哪些**」 | 开工前先核对清单剩余项，别按 10 处全做。 |
| 6 | `plan.md:297` | S-25.6「落点**若**走右侧面板**则**需新增 `RightPanelTabKind`」 | **未进老大事项清单**，需补问。见 ⚠️1。 |

另需在执行前复核（非 plan 自标，本次审查补充）：

7. **`ProviderRequestOverrides.cs:126-133` 的既有模板能力** —— 复核后再定 S-20.3 是否真的零改动 C#（❌1）。
8. **`src/renderer/src/lib/select-file-editor.ts` 的当前体积** —— 若接近 500 行，S-16 新增 `pasted-block` 节点后须按 AGENTS.md 拆分（❌7）。
9. **`ExtractBaiduResults` 的实际行号** —— 本次实测 `AgentRuntimeWebSearchExecutor.cs:195`，但该文件 371 行、改动后行号会漂移，实施时重新定位（❌6）。

---

> 报告结论：**FAIL**。修完 §四 的 7 项（其中 ❌1 是方案级修正，其余 6 项是路径订正）后可重新提交验证；§五 的 ⚠️ 与 §六 的未决项不阻断，但 §六 第 2、3、6 项必须在用户确认环节拿到答案或安排实测。

---

# 复审（第二轮）

> 复审时间：2026-09-14
> 复审对象：plan.md R2 修订稿（`docs/plans/iter-v2-29/plan.md`，修订记录 R2 行）
> 复审方式：独立只读复验（本轮未修改任何仓库文件，本文件为唯一追加输出）
> 复审结论：**FAIL**（7 个旧 ❌ 全部修对，但修正过程引入 1 个新 ❌）

---

## 一、7 个 ❌ 的修复复验

### ❌1 —— S-20.3 占位方案建立在错误事实上 → **✅ 已修复**

**修订后原文**

- `plan.md:43`（口径 2）：「占位语法沿用既有 C# 实现 `ResolveHeaderTemplate`（`ProviderRequestOverrides.cs:126-133`），写作 `{{sessionId}}` / `{{model}}`（双花括号）——不是新做，是接上已有轮子」
- `plan.md:95`：「动态占位已实现：`ProviderRequestOverrides.ResolveHeaderTemplate`（`:126-133`）在 `:84`（正常头）与 `:117`（debug 头）被自动调用」
- `plan.md:98`：「⚠️ 立项稿曾误判……**C# 侧零改动**，本需求是纯渲染端工作」
- `plan.md:104`：「S-20.3：**动态占位 —— 不用改代码，只做验证**」
- `plan.md:109` Mini 验证：「配 `x-opencode-session: {{sessionId}}` ……确认被替换成真实会话 id」

**实测事实**

- `src/runtime/WishfulClaw.Agent/ProviderRequestOverrides.cs`（143 行）：`:126` = `public static string ResolveHeaderTemplate(string value, string sessionId, string model)`，`:127-132` 依次 Replace `{{sessionId}}` / `{{ sessionId }}` / `{{model}}` / `{{ model }}`，`:133` = `}` → `:126-133` 精确命中。
- `grep -n ResolveHeaderTemplate` → 调用点 `:84`、`:117`，定义 `:126`，与 plan 完全一致。
- `grep -rn ApplyHttpHeaderOverrides src/runtime` → 5 处：`AnthropicMessagesProvider.cs:209`、`ContextCompression.cs:550`、`ContextCompression.cs:695`、`OpenAIChatHeaders.cs:26`、`OpenAIResponsesProvider.cs:244`，与 `plan.md:94`「已在 **5 处**被调用」完全一致（上一轮 ⚠️5.6 同步收口）。
- 全文已无单花括号 `{sessionId}`。

**判定：✅ 已修复**（方案级错误已纠正，且不是简单改词——口径表 / 关键前提 / 步骤 / Mini 验证四处同步订正）

---

### ❌2 —— `locales/zh|en/*.json` 缺 `src/renderer/src/` 前缀 → **✅ 已修复**

**修订后原文**：`plan.md:75`（S-24.5）、`:82`（S-24 涉及文件）、`:115`（S-20）、`:164`（S-17）、`:215`（S-16）、`:245`（S-18）、`:269`（S-19）、`:301`（S-21）、`:335`（S-25）。

**实测事实**

- `ls -d locales` → `No such file or directory`（仓库根无此目录，原判成立）。
- `ls src/renderer/src/locales/` → `en` / `index.ts` / `zh`；`zh/` 与 `en/` 下各有 7 个 json：`agent.json`、`chat.json`、`common.json`、`layout.json`、`settings.json`、`ssh.json`、`taskboard.json`。
- 因此 `src/renderer/src/locales/{zh,en}/*.json` 是合法 glob，`src/renderer/src/locales/{zh,en}/chat.json` 是真实文件。
- 修订后 plan 已无裸 `locales/` 写法。

**判定：✅ 已修复**

---

### ❌3 —— `locales/zh/chat.json:134/:135` → **✅ 已修复**

**修订后原文**：`plan.md:155`「S-17.5：i18n（`src/renderer/src/locales/zh/chat.json:134` runningTool、`:135` awaitingApproval，en 同步）」

**实测事实**：`sed -n '132,137p' src/renderer/src/locales/zh/chat.json` → `:134` = `"runningTool": "运行 {{tool}}"`，`:135` = `"awaitingApproval": "等待批准：{{tool}}"`。行号与内容均正确；`en/chat.json` 存在。

**判定：✅ 已修复**

---

### ❌4 —— `settings/ProviderConfigPanel.tsx` 不存在 → **✅ 已修复**

**修订后原文**：`plan.md:102`（S-20.1 步骤）、`:112`（涉及文件）均写 `components/settings/provider/ProviderConfigPanel.tsx`。

**实测事实**：`find src -iname "*ProviderConfigPanel*"` → 唯一命中 `src/renderer/src/components/settings/provider/ProviderConfigPanel.tsx`。同目录还有 `AddProviderDialog.tsx` / `ModelFormDialog.tsx` / `ThinkingConfigDialog.tsx` / `constants.ts`。

**判定：✅ 已修复**

---

### ❌5 —— `settings/AddProviderDialog.tsx` 不存在 → **✅ 已修复**

**修订后原文**：`plan.md:103`（S-20.2 步骤，写 `components/settings/provider/AddProviderDialog.tsx:39-48`）、`:113`（涉及文件）。

**实测事实**：`find src -iname "*AddProviderDialog*"` → 唯一命中 `src/renderer/src/components/settings/provider/AddProviderDialog.tsx`。`sed -n '35,50p'` → `:39` baseUrl、`:40` homepage、`:41` apiKey、`:44` setActiveProvider、`:46` `const handleAdd = (): void => {`、`:48` `addCustomProvider(...)` → `:39-48` 区间内容与原报告描述一致。

**判定：✅ 已修复**

---

### ❌6 —— Baidu 解析归错文件 → **✅ 已修复**

**修订后原文**：`plan.md:178`「落点是 **`AgentRuntimeWebSearchExecutor.cs:195` 的 `ExtractBaiduResults`**（该文件 371 行；`WebSearchProviders.cs` 只有 164 行，是 partial 的另一半，别找错文件）」；`plan.md:186` 涉及文件同步改。

**实测事实**

- `wc -l` → `AgentRuntimeWebSearchExecutor.cs` = **371** 行；`WebSearchProviders.cs` = **164** 行（plan 两个行数断言均属实）。
- `sed -n '190,220p'` → `:195` = `private static List<WebSearchResult> ExtractBaiduResults(string html, int maxResults)`，`:208-210` 正是 plan 描述的 class 白名单正则（`c-abstract` / `content-right_...` / `content-right` / `c-span-last` / `c-color-text` / `result-op...`）。
- 同节附带核实：`AgentRuntimeWebSearchExecutor.cs:57` = `GetInt(call.Input, "maxResults", ...)`、`:60` = `GetString(call.Input, "searchMode") ?? "web"`、`WebToolProvider.cs:23` = `["count"] = ToolSchemaBuilder.Number(...)` → S-23.4 的入参不匹配断言成立。

**判定：✅ 已修复**（并把「两个 partial 半体」的易混淆点写进 plan，防重复踩）

---

### ❌7 —— `lib/select-file-editor/*` 目录不存在 → **✅ 路径已改对，但修正引入新 ❌（见 §二 B1）**

**修订后原文**：`plan.md:200`（「在 `src/renderer/src/lib/select-file-editor.ts:41` 的 `EditorDocumentNode`（现 `= EditorTextNode | EditorFileNode | EditorPluginNode`）增加 `pasted-block` 节点类型」）、`:201`（「⚠️ **该文件现已是 504 行**……实施时**先拆**」）、`:213`（涉及文件）。

**实测事实**

- `wc -l src/renderer/src/lib/select-file-editor.ts` = **504** 行（断言属实）。
- `:41` = `export type EditorDocumentNode = EditorTextNode | EditorFileNode | EditorPluginNode` —— **正是定义行**。
- `ls -d src/renderer/src/lib/select-file-editor/` → `No such file or directory`（作为「待新建」表述合理）。
- AGENTS.md:240「超过 500 行必须拆分」→ plan 的「先拆再改」有规可依。

**判定：路径与行数 ✅ 已修复；但拆分方案与涉及文件清单出现新的错误断言，另计新 ❌（见 §二 B1）。本条不计为未修复。**

---

## 二、修正是否引入新问题

### ❌（新，阻断）B1 —— S-16 渲染落点断言错误：`renderDocument` 根本不在 `select-file-editor.ts`，且涉及文件漏列真正落点

**涉及原文**

- `plan.md:200`：「确保能进 `serializeEditorDocument`（草稿）与被 `renderDocument` 渲染」
- `plan.md:201`：「新建 `lib/select-file-editor/` 目录，按 `types.ts`（节点定义）/ `serialize.ts` / `render.ts` 拆开，`index.ts` 桶导出」
- `plan.md:213`：「`src/renderer/src/lib/select-file-editor.ts` — **拆为 `lib/select-file-editor/` 目录**（节点类型 + 序列化 + 渲染）」
- `plan.md:203`（S-16.3）：「`renderDocument` 渲染 chip」

**实测事实**

- `grep -n -i "render|parseDom" src/renderer/src/lib/select-file-editor.ts` → **零命中**。该文件 504 行只有：节点类型（`EditorTextNode` / `EditorFileNode` / `EditorPluginNode` / `EditorDocumentNode`）、纯文本计算（`getNodePlainText` :208、`editorDocumentToPlainText` :221）、**序列化**（`serializeEditorDocument` :228、`deserializeEditorState` :264）与选区/节点操作，**没有任何渲染代码**。
- `grep -rn renderDocument src/renderer/src` → 定义唯一落在 `src/renderer/src/components/chat/file-aware-editor-utils.ts:212`（同文件 `:275` `isSameDocument`、`:313` `parseDomToDocument`）；调用点在 `FileAwareEditor.tsx:257`（`:3` import）。
- `wc -l src/renderer/src/components/chat/file-aware-editor-utils.ts` = **526** 行。

**为什么算 ❌ 而非 ⚠️**

1. **技术断言错误**：plan 把「渲染」算作 `select-file-editor.ts` 的既有职责，并据此规划出 `render.ts` 拆分件。这与旧 ❌1 同类——方案建立在错误事实上。按此实施会把新 chip 的渲染塞进一个不含渲染的纯数据模块，与既有 `file-aware-editor-utils.ts:212` 的渲染主链割裂，形成两套渲染入口。
2. **涉及文件漏关键项**：S-16 涉及文件（`plan.md:211-215`）列了 `FileAwareEditor.tsx — 可能改`，但 **chip 渲染必改的 `file-aware-editor-utils.ts` 完全没有出现**。该文件本身已 526 行、超 AGENTS.md:240 的 500 行阈值，属本需求必须一并处理的对象，plan 未提。

**建议怎么改**

1. S-16.1 删除「`render.ts` 拆出来」的规划，改为「`types.ts` + `serialize.ts` 两个拆分件（其余纯函数按职责归到 `serialize.ts` 或保留在桶文件）」。
2. S-16.3 明确写「chip 渲染落点 `src/renderer/src/components/chat/file-aware-editor-utils.ts:212` 的 `renderDocument`；同文件 `:313` 的 `parseDomToDocument` 需同步支持 chip 反解析」。
3. S-16 涉及文件补一行：`src/renderer/src/components/chat/file-aware-editor-utils.ts — 改（chip 渲染 + DOM 反解析）；该文件已 526 行，超 500 行阈值，改动后按 AGENTS.md「大文件拆分」一并处理`。

---

### ✅ B2 —— `select-file-editor.ts:41` 确为 `EditorDocumentNode` 定义行
实测 → `:41` = `export type EditorDocumentNode = EditorTextNode | EditorFileNode | EditorPluginNode`。属实。

### ✅ B3 —— `ui-types.ts:54` 的 `RightPanelTabKind` 确有 plan 说的 11 个 kind
实测 `sed -n '45,70p'` → `:54` = `export type RightPanelTabKind =`，其后 `:55-65` 依次为 `activity` / `memory` / `context` / `review` / `files` / `preview` / `browser` / `subagent` / `terminal` / `goal` / `summary`，**与 `plan.md:320` 列举的 11 个一字不差、顺序一致**。

### ✅ B4 —— `RightPanel.tsx:77-101` 确为标题映射，风格与 plan 描述一致
实测 `sed -n '70,105p'`（文件 309 行）→ `:77` = `const tabs = useMemo(() => {`，`:79` = `scopedTabs.map(...)`，`:80-97` 是 5 组 `if (tab.kind === '...') { return { ...tab, title: t('...', { defaultValue: '...' }) } }`（activity / memory / files / browser / summary），`:98` 注释「subagent tabs keep their own title」，`:99` `return tab`，`:101` `}, [rightPanelOpen, scopedTabs, t])`。
→ `:77-101` 区间精确；「逐个 `if (tab.kind === ...)` 赋值 `t(...)`，照抄风格」属实。
补充事实（plan 未误导，实施时注意）：映射只覆盖 5 个 kind，其余 kind 的 title 取自 `RightPanelTabInstance.title`；新增 `timeline` 按同一写法加一条即可。

### ✅ B5 —— `provider/` 层级属实
`ls src/renderer/src/components/settings/provider/` → `AddProviderDialog.tsx` / `ModelFormDialog.tsx` / `ProviderConfigPanel.tsx` / `ThinkingConfigDialog.tsx` / `constants.ts`。plan 两处引用均带 `provider/`。

### ✅ B6 —— `src/renderer/src/locales/{zh,en}/*.json` 写法对应真实文件
zh/en 各 7 个 json（见 ❌2 实测），glob 与具名两种写法都能落到真实文件。

### ✅ B7 —— `tests/WishfulClaw.ProviderHeaderRegressionTests` 真实存在
`ls tests/` 列出 9 个 C# 回归工程，含 `WishfulClaw.ProviderHeaderRegressionTests`；且它在 sln 内（`WishfulClaw.sln:32`）。`plan.md:109` 的引用成立。

### ✅ B8 —— plan 说「`CronRegressionTests` / `MemoryRecallRegressionTests` 不在 .sln」属实
实测：`grep -c '^Project(' src/runtime/WishfulClaw.sln` = **15**；其中回归测试工程 7 个 —— Goal / CompactionSnapshot / SessionTaskCascade / ToolConcurrency / ChannelToolVisibility / ProviderHeader / ChannelShellApproval。**`WishfulClaw.CronRegressionTests` 与 `WishfulClaw.MemoryRecallRegressionTests` 确在 `tests/` 下但不在 sln**（在 sln 中 grep `RegressionTests` 无这两条）。
→ `plan.md:291`「必须同时加进 .sln，否则会像 Cron / MemoryRecall 一样静默漏编」的警示**有据、成立**，S-21 新工程入 sln 的要求不是臆测。

### ⚠️（新，非阻断）B9 —— S-17.1 补文件名补对了，但行号 `:30` 实测是 `:32`

- 原文 `plan.md:151`：「`resolveProxyDisplay`（**本体在 `lib/agent/use-capability-proxy.ts:22`，拿不到 capability_id 的 return null 在 `:30`**）」
- 实测 → `:22` = `export function resolveProxyDisplay(`（✅），`:25` = `if (!input ...) return null`，`:28` = `if (action.toLowerCase() !== 'call') return null`，`:30` = `const capabilityId =`，`:31` = `typeof input.capability_id === 'string' ...`，**`:32` = `if (!capabilityId) return null`**。
- 判定：文件名补写正确（⚠️3.17 已收口），但行号沿用了上一轮报告 §五.5 的同一笔误，偏 2 行。函数体仅 20 行，不影响定位，记 ⚠️，建议改为 `:32`。
- 同节其余锚点全对：`use-capability-proxy.ts:51-56` = `skill:` → `'Skill'`（`:51` if、`:53` `name: 'Skill'`、`:54` SkillName）✅；`stream-event-adapter.ts:15-17` = `const resolved = resolveProxyDisplay(` 起三行 ✅；`:45-57` = `case 'tool_use_streaming_start':` + `input: {}` ✅。

### ⚠️（轻微，沿用）B10 —— `usage-detail-table.tsx:116-127` 区间略偏
实测 `sed -n '114,128p'` → `:114` 起已是解构参数（`:114` total、`:116` pageSize、`:120` `}: {`、`:127` `onPageChange: (page: number) => void`）。真正的 props 签名起点早于 `:116`。上一轮已判 ✅，本次不升级，实施时按函数名定位即可。

### ℹ️ B11 —— `dotnet run --project tests/<项目> --no-build` 无文档依据但非错误
`grep -rn RegressionTests package.json AGENTS.md docs/*.md` → 零命中，仓库未登记回归工程跑法。plan 的写法是标准 dotnet CLI 用法，合理；建议实施时确认 `--no-build` 前已完成该工程编译。

---

## 三、⚠️ 项收口抽查

| # | 上一轮 ⚠️ | 是否真的写进 plan | 实测证据 |
|---|---|---|---|
| 1 | S-25 UI 落点钉死 | **✅ 已收口** | `plan.md:44`（口径 3）「UI 落点：右侧面板新增 `RightPanelTabKind = 'timeline'`」+ `:319-322` S-25.6「落点钉死」三小项（ui-types.ts:54 / RightPanel.tsx:77-101 / 复用 GoalEventTimeline）+ `:353`「已在规划阶段自行钉死、不再问你」。三条落点锚点实测全部命中（见 B3 / B4）；`components/goal/goal-session-views.tsx:80` = `export function GoalEventTimeline({` ✅ |
| 2 | S-21 新建测试工程并入 sln | **✅ 已收口** | `plan.md:291` D7「新建 `tests/WishfulClaw.ProviderFallbackRegressionTests`……⚠️ **必须同时加进 `src/runtime/WishfulClaw.sln`**」+ `:300` 涉及文件「新建（**并入 .sln**）」。断言依据实测成立（B8） |
| 3 | S-20.2 明确做 | **✅ 已收口** | `plan.md:103`「**做，不做则新建服务商时仍配不了头，闭环不完整**」，条件句已去 |
| 4 | S-22 标注无自验证闭环 | **✅ 已收口** | `plan.md:135`「⚠️ **本需求在 agent 侧没有自验证闭环**……提交时按『代码逻辑自洽 + 静态断言通过』入库，**不按默认口径标为『测通』**，收尾时单列待验」；老大事项 `:350` 同步 |
| 5 | S-25 保留策略改为可判定 | **✅ 已收口** | `plan.md:326`「手动把若干行 `created_at` 改到阈值之前 → 触发清理 → 断言这些行已消失、阈值内的行仍在」 |
| 6 | S-17.1 补文件名 | **✅ 已收口（行号有小误）** | `plan.md:151` 已点名 `use-capability-proxy.ts:22`，但 `:30` 实测为 `:32`，见 B9 |
| 7 | S-20.5 点名 `x-opencode-session` | **✅ 已收口** | `plan.md:109`「配 `x-opencode-session: {{sessionId}}`（**点名用 OpenCode Go 的真实头名跑一遍**）」。实测 `OpenAIChatHeaders.cs:29/31/47/49` 确为该头名 ✅ |
| 8 | S-19 补避坑说明 | **✅ 已收口** | `plan.md:271-272` 新增「避坑说明」小节，写明 `mcp__browser-use__take_screenshot` 报 `NATIVE_BROWSER_VIEWPORT_UNAVAILABLE`、in-app browser 指向 dev 渲染进程拿不到内容、「浏览器截图不能替代真机 capturePage」，并引 `raw-requirements.md:106` |
| 9 | S-20.4 不复用 `IsSensitiveHeader` | **✅ 已收口** | `plan.md:105`「⚠️ 既有 `IsSensitiveHeader`（`:135-141`）当前用于 **debug 脱敏**而非覆盖拦截，语义不同，**不要直接复用**，另写保留头清单」。实测 `ProviderRequestOverrides.cs:135-141` 正是 `IsSensitiveHeader`（authorization / api-key / apikey / token）✅ |

**收口结论：9 条全部落进 plan，其中 8 条完全正确，1 条（#6）文件名对、行号偏 2 行。**

---

## 四、终判

按 dev-workflow 阶段三的 5 个检查项重判：

| 检查项 | 判定 | 依据 |
|---|---|---|
| 1. 步骤是否完整覆盖任务目标 | **✅** | 10 个需求节齐全、未分批、粒度可执行（沿用 R1 结构，本轮未破坏）。S-25 UI 落点由条件句改为钉死（⚠️1.5 消除），S-23 开工依赖仍在老大清单 `:347` |
| 2. 每步是否有明确的验证检查点 | **✅** | 10 节 Mini 验证齐全；S-21 测试承载由 D7 补齐（⚠️2.4 消除）；S-25 保留策略改为可判定（⚠️2.5 消除）；S-22 明确标注无自验证闭环（⚠️2.6 消除） |
| 3. 文件路径是否符合项目结构 | **❌** | 7 个旧 ❌ 的路径全部订正到位（见 §一），但 S-16 修正过程中**新增一处落点错误**：把渲染职责安在不含渲染代码的 `select-file-editor.ts` 上，且涉及文件漏列真正落点 `file-aware-editor-utils.ts:212`（B1） |
| 4. 分层依赖是否正确 | **✅** | 本轮改动未触碰 C# 分层；S-25 仍为 Agent → Infrastructure 顺向；S-21 新测试工程属 `tests/` 平级，不破坏 7 层单向依赖 |
| 5. 是否参考了正确的源码文件 | **✅** | 旧 ❌1 的占位方案已改为引用真实存在的 `ResolveHeaderTemplate`；S-19 补避坑说明；`docs/plans/iter-v2-27/plan.md:195-205` 复核属实（实测 `:195` = 「### Plan D：多服务商有限重试后 fallback」） |

**结论：FAIL。**

- 旧 ❌ 项：**7 → 0**（全部核实修对，不存在「改了但没改对」）
- 本轮新引入 ❌：**1**（S-16 渲染落点断言错误 + 涉及文件漏列，见 §二 B1）
- ❌ 项合计 = **1 > 0**，按规则**不可进入用户确认环节**

修法很轻：**S-16.1 删掉 `render.ts` 拆分件；S-16.3 写明渲染落点 `file-aware-editor-utils.ts:212`；S-16 涉及文件补 `src/renderer/src/components/chat/file-aware-editor-utils.ts`（并注明其 526 行已超阈值）**。改完这三项即可判 PASS，无需重开全面审查。

---

## 五、遗留未决项

**A. 执行前必须复核（本轮新增 / 沿用）**

1. **【新增·本轮必改】** S-16 渲染落点：`renderDocument` 在 `src/renderer/src/components/chat/file-aware-editor-utils.ts:212`，`parseDomToDocument` 在同文件 `:313`。改 chip 渲染必动这两个函数，且该文件已 526 行、超 AGENTS.md:240 的 500 行阈值，需一并规划拆分（B1）。
2. **【沿用】** `plan.md:67`：S-24.4 开工前先读 `UsagePanelParts.tsx:400-440`；LineChart（`:290` / `:306`）与 BarChart（`:389`）两套并存，改漏一处会高低不齐。
3. **【沿用】** `plan.md:268`：S-21.D4「切出 `openai-responses` 会丢 `OpenAIResponsesState` 的 response id」——**未实测，实施时必须验**（切走再切回 / 切到别家，验证 response id 丢失是否断上下文）。这是 Plan D 唯一标红的技术风险。
4. **【沿用】** `plan.md:260`：S-19.5 开工前先核对 `docs/user-guide.md` 文末 10 处待配图清单**还差哪些**，别按 10 处全做。
5. **【沿用】** `plan.md:5`：全部行号均为 2026-09-14 实读，实施时按当时代码复核；S-23.3 已自注「行号改动后会漂移，实施时重新定位」。
6. **【新增·轻微】** B9：`use-capability-proxy.ts` 的 return null 实际在 `:32` 而非 `:30`，实施时按符号名定位。
7. **【新增·轻微】** B11：回归测试跑法（`dotnet run --project tests/<项目> --no-build`）仓库无文档登记，实施时确认 `--no-build` 前已完成编译。

**B. 必须由老大回答（确认环节，未答不得开工相关需求）**

1. **S-23（阻塞开工）**：确认实际使用的搜索 provider 配置。默认值 `tavily + 空 apiKey`（`settings-store.ts:337-340`，实测属实）按理会直接报错而不是返回词典结果，与现象矛盾，见 `plan.md:347`。
2. **S-19**：定配图落盘目录约定（建议 `docs/assets/`，以及是否要求与 `docs/user-guide.md` 里的引用路径单点对应）。
3. **S-21**：提供两个可控的测试 provider / Mock endpoint，或授权自带 mock server 起一个。
4. **S-22**：真机复现（agent 无微信渠道环境）——本需求 agent 侧无法自测通，提交后需老大走一遍「全局派发 → 项目回报 → 助理回复」确认微信端收到。
5. **收尾**：真机人工复测（本次多条需求是 UI 与渠道，最终目视仍由老大确认）。

> 本轮已在规划阶段自行钉死、不再问的（`plan.md:353`）：S-25 的 UI 落点、S-16 的文件拆分、S-21 的测试承载。其中 **S-16 的拆分方案需按 B1 订正后重新钉死**。

---

# 第三轮复审（收口）

> 复审时间：2026-09-14
> 复审对象：plan.md R3 修订稿（`docs/plans/iter-v2-29/plan.md`，修订记录 R3 行）
> 复审方式：独立只读复验（本轮未修改仓库任何文件，本文件为唯一追加输出）
> 复审结论：**PASS**

---

## 一、R3 两个修订点的复验

### 修订点 1 —— S-16 的 chip 渲染落点（第二轮 ❌B1）→ **✅ 已修复**

**修订后原文**

- `plan.md:201`（S-16.1）：「在 `src/renderer/src/lib/select-file-editor.ts:41` 的 `EditorDocumentNode`……增加 `pasted-block` 节点类型……确保能进 `serializeEditorDocument`（草稿）与被 `renderDocument` 渲染」
- `plan.md:202`（S-16.1 拆分）：「新建 `lib/select-file-editor/` 目录，按 `types.ts`（节点定义）/ `serialize.ts`（`serializeEditorDocument`）拆开，`index.ts` 桶导出，保持对外 API 不变」
- `plan.md:203`（新增警示）：「⚠️ **渲染不在本文件** —— `select-file-editor.ts` 全文 grep `render` 零命中。渲染真身在 `src/renderer/src/components/chat/file-aware-editor-utils.ts:212` 的 `renderDocument`（526 行，同样超阈值），S-16.3 的 chip 渲染要落那里」
- `plan.md:205`（S-16.3）：「chip 渲染 —— 落点是 `src/renderer/src/components/chat/file-aware-editor-utils.ts:212` 的 `renderDocument`（**不是 `select-file-editor.ts`**）」
- `plan.md:216`（涉及文件）：「`src/renderer/src/components/chat/file-aware-editor-utils.ts` — 改（`renderDocument:212` 渲染 chip）」

**实测事实**

| 断言 | 实测命令 | 结果 |
|---|---|---|
| `renderDocument` 定义在 `file-aware-editor-utils.ts:212` | `grep -rn "renderDocument" src/renderer/src` | 定义唯一命中 `:212` = `export function renderDocument(`；调用点 `FileAwareEditor.tsx:257`（`:3` import） |
| `select-file-editor.ts` 无渲染代码 | `grep -c "render" src/renderer/src/lib/select-file-editor.ts` | **0**（含 `-i` 亦为 0），plan 断言属实 |
| 该文件 526 行 | `wc -l` | `file-aware-editor-utils.ts` = 526 ✅；`select-file-editor.ts` = 504 ✅ |
| 拆分清单已去掉 `render.ts` | 全文 `grep -n "render" plan.md` | 命中项均为 `renderDocument` / `ProviderPanel` / `renderable-chat-items` 等，**无 `render.ts` 拆分件**；`:202` 只写 `types.ts` + `serialize.ts` 两件 |
| 涉及文件已补真正落点 | `plan.md:216` | 已补 `src/renderer/src/components/chat/file-aware-editor-utils.ts`（第二轮漏列项） |
| 无「`select-file-editor` 含渲染」残留 | 全文检索 | `:201` 的「被 `renderDocument` 渲染」已由 `:203`「渲染不在本文件」与 `:205`「**不是 `select-file-editor.ts`**」双重澄清，**无残留错误表述** |

**判定：✅ 已修复**（路径 / 行数 / 涉及文件 / 拆分件四项全对，且不是删词了事——新增一行显式警示防重复踩）

---

### 修订点 2 —— `use-capability-proxy.ts` 行号 `:30` → `:32`（第二轮 ⚠️B9）→ **✅ 已修复**

**修订后原文**：`plan.md:152`「`resolveProxyDisplay`（**本体在 `lib/agent/use-capability-proxy.ts:22`，`if (!capabilityId) return null` 在 `:32`**）」

**实测事实**：`sed -n '20,36p' src/renderer/src/lib/agent/use-capability-proxy.ts` →

- `:22` = `export function resolveProxyDisplay(` ✅
- `:25` = `if (!input || typeof input !== 'object') return null`
- `:28` = `if (action.toLowerCase() !== 'call') return null`
- `:30` = `const capabilityId =`
- `:31` = `typeof input.capability_id === 'string' ? ...`
- **`:32` = `if (!capabilityId) return null`** ✅

**判定：✅ 已修复**（行号精确命中；`:30` 现为 `const capabilityId` 声明行，旧的错误写法已消除）

---

## 二、R3 是否引入新问题

对 R3 改动面（S-16 节全节 + S-17.1 行号 + 修订记录 R3 行）做全文扫描与逐锚点实测：

### ✅ C1 —— S-16 节全部锚点复验，无一错

| plan 引用 | 实测 | 判定 |
|---|---|---|
| `select-file-editor.ts:41` = `EditorDocumentNode` | `:41` = `export type EditorDocumentNode = EditorTextNode \| EditorFileNode \| EditorPluginNode` | ✅ |
| `serializeEditorDocument` / `deserializeEditorState` 在该文件 | `:228` / `:264` | ✅ |
| `use-composer-interactions.ts:51-74` 粘贴分支 | `:51` = `const handlePaste = React.useCallback(` … `:74` 收尾 | ✅ |
| `:67` = `execCommand('insertHTML')` | 命中 | ✅ |
| `:73` = `replaceSelectionWithText(plainText, selection)` | 命中 | ✅ |
| `file-aware-editor-undo-selection.ts:5-7` | `:5` = `export function isHistoryInputType(` | ✅ |
| 同文件 `:32-40` | `:32` = `collapseRestoredHistorySelection` … `:40` `return true` | ✅ |
| `InputArea/index.tsx:262-263` | `:262` = `const liveEditorState = getLiveEditorState()`、`:263` = `const promptText = liveEditorState.promptText.trim()` | ✅ |
| `file-aware-editor-utils.ts:212` `renderDocument` | 见 §一 | ✅ |

### ✅ C2 —— 无「三个拆分件」之类自相矛盾

`plan.md:202`（步骤）、`:215`（涉及文件）、`:13`（修订记录）、`:356`（自行钉死项）四处口径一致：**两件**（`types.ts` + `serialize.ts`），全文无第三件残留、无 `render.ts`。

### ✅ C3 —— 修订记录 R3 行描述与实际改动一致

- 「chip 渲染落点从 `select-file-editor.ts`（grep `render` 零命中）改到 `components/chat/file-aware-editor-utils.ts:212` 的 `renderDocument`（526 行，同超阈值）」—— 三项子断言（零命中 / `:212` / 526 行）**全部实测属实**。
- 「从拆分清单里去掉 `render.ts`」—— 属实。
- 「`if (!capabilityId) return null` 行号 `:30` → `:32`」—— 属实。
- R3 行未声称做了实际未做的改动，不存在「写过但没改」。

### ✅ C4 —— S-17 节其余锚点未被动坏

`:22`（本体）、`:45-57`（`tool_use_streaming_start`）、`:15-17`（`rewriteProxyEvent` 调用）、`:51-56`（`skill:` → `'Skill'`）沿用第二轮已验结论，R3 仅改行号，未波及其他。

**结论：R3 未引入任何新的 ❌。**

---

## 三、终判

| 检查项 | 判定 | 依据 |
|---|---|---|
| 1. 步骤是否完整覆盖任务目标 | ✅ | 10 需求节齐全、未分批；S-16 步骤链（节点类型 → 粘贴分支 → 渲染 → 撤销 → 提交 → i18n）完整 |
| 2. 每步是否有明确的验证检查点 | ✅ | 10 节 Mini 验证齐全；S-16 含「草稿重进 chip 仍在且原文无损」「提交后模型收到完整原文」 |
| 3. 文件路径是否符合项目结构 | ✅ | 一二轮共 7 个路径 ❌ 全部订正；二轮新增的 S-16 渲染落点 ❌ 本轮订正到位（§一）；本轮复验 S-16 全部 9 个锚点无一错 |
| 4. 分层依赖是否正确 | ✅ | R3 改动纯前端（components/chat + lib），不触碰 C# 7 层；无逆向依赖 |
| 5. 是否参考了正确的源码文件 | ✅ | chip 渲染落点现指向真实存在的 `renderDocument`；S-16 参考源码 `Composer.tsx` 路径未变（第一轮已验存在） |

**❌ 项计数：**

- 第一轮 ❌：7
- 第二轮复验后：7 → 0，新增 1（B1：S-16 渲染落点断言错误 + 涉及文件漏列）
- 第三轮复验：B1 → 0；R3 新增 → 0
- **❌ 项合计 = 0**

> **PASS。❌ 项 = 0，可进入用户确认环节。**

---

## 四、本轮 ⚠️（非阻断，执行前处理即可）

1. **【建议补 · 轻】S-16 涉及文件条目未带超阈值标注** —— `plan.md:216` 只写「改（`renderDocument:212` 渲染 chip）」，未标「该文件已 526 行、超 AGENTS.md:240 的 500 行阈值」。信息在 `:203` 已写、不误导，但建议条目补一句「（526 行，同超阈值，改动后按大文件拆分一并处理）」，与 `:215` 的 select-file-editor 条目口径对齐。

2. **【实施必做】S-16.3 未点名 `parseDomToDocument`** —— 第二轮建议第 2 点的后半（「同文件 `:313` 的 `parseDomToDocument` 需同步支持 chip 反解析」）**未被采纳**。实测 `parseDomToDocument` 确在 `file-aware-editor-utils.ts:313`（与 `renderDocument` 同文件、相隔约 100 行，是配对的正 / 反解析函数）。
   **风险**：chip 是 DOM 节点，若反解析不支持，DOM → document 回读时 chip 会丢，「草稿保存后重进 chip 仍在」「原文无损」两条 Mini 验证必挂（`FileAwareEditor.tsx:250` 的注释说明该处有 DOM/state 一致性比对 `isSameDocument`）。
   **处理**：实施 S-16.3 时同步改 `:313`，无需回改 plan（该文件已在涉及文件清单内）。

3. **【轻】`:215` 目标目录简写缺前缀** —— 写「拆为 `lib/select-file-editor/` 目录」，同一行前半已给全路径 `src/renderer/src/lib/select-file-editor.ts`，不构成误导（与上一轮 ❌2 的全局根级路径错误性质不同），但建议统一写全。

4. **【轻】拆分两件未交代其余纯函数归属** —— `select-file-editor.ts` 除类型与序列化外还有 `getNodePlainText`（`:208`）、`editorDocumentToPlainText`（`:221`）、选区/节点操作等纯函数，plan 只说「`types.ts` / `serialize.ts`」。建议补一句「其余纯文本与选区工具函数随 `serialize.ts` 或保留在 `index.ts` 桶文件」（第二轮建议原文有此句，R3 采纳「两件」时略去）。「保持对外 API 不变」的约束已写明，不阻断。

5. **【沿用 · 轻微】** `usage-detail-table.tsx:116-127` 区间略偏（第二轮 B10），实施时按函数名定位。

6. **【沿用】** 全部行号为 2026-09-14 实读，实施时按当时代码复核（`plan.md:5`）。

---

## 五、进入执行前必须复核的未决项（汇总三轮）

### A. 技术侧（开工时自行复核，不需老大介入）

| # | 项 | 出处 | 要求 |
|---|---|---|---|
| A1 | **S-16 chip 反解析** | 本轮 ⚠️2 | `file-aware-editor-utils.ts:313` 的 `parseDomToDocument` 须同步支持 chip，否则「原文无损」验证必挂 |
| A2 | **S-16 两个大文件拆分** | `plan.md:202/203` | `select-file-editor.ts`（504 行）先拆 `types.ts` / `serialize.ts`；`file-aware-editor-utils.ts`（526 行）改后同样超阈值，按 AGENTS.md:240 一并处理 |
| A3 | **S-21.D4 response id 丢失** | `plan.md:291` | 切出 `openai-responses` 会丢 `OpenAIResponsesState` 的 response id —— **未实测，实施时必须验**（切走再切回 / 切到别家，确认是否断上下文）。Plan D 唯一标红的技术风险 |
| A4 | **S-24.4 图表高度** | `plan.md:75` | 开工前先读 `UsagePanelParts.tsx:400-440`；LineChart（`:290` / `:306`）与 BarChart（`:389`）两套并存，改漏一处会高低不齐 |
| A5 | **S-19.5 配图清单** | `plan.md:263` | 先核对 `docs/user-guide.md` 文末 10 处待配图清单**还差哪些**，别按 10 处全做 |
| A6 | **S-23.3 行号漂移** | `plan.md:179` | `ExtractBaiduResults` 现 `:195`，改动后行号会漂，实施时重新定位；注意 `WebSearchProviders.cs`（164 行）是 partial 另一半，别找错文件 |
| A7 | **回归测试跑法** | `plan.md:294` | `dotnet run --project tests/<项目> --no-build` 仓库无文档登记，确认 `--no-build` 前该工程已编译 |
| A8 | **行号时效** | `plan.md:5` | 全部行号为 2026-09-14 实读，对不上时按符号名定位，不要硬套 |

### B. 必须由老大在确认环节回答（未答不得开工相关需求）

1. **S-23（阻塞开工）**：实际使用的搜索 provider 配置。默认值 `tavily + 空 apiKey`（`settings-store.ts:337-340`）按理会直接报错而非返回词典结果，与现象矛盾。
2. **S-19**：配图落盘目录约定（建议 `docs/assets/`，以及是否要求与 `docs/user-guide.md` 的引用路径单点对应）。
3. **S-21**：提供两个可控的测试 provider / Mock endpoint，或授权自带 mock server 起一个。
4. **S-22**：真机微信复现（agent 无微信渠道环境）—— 本需求 agent 侧无法自测通，提交后需老大走一遍「全局派发 → 项目回报 → 助理回复」确认微信端收到。
5. **收尾**：真机人工复测（本次多条需求是 UI 与渠道，最终目视由老大确认）。

### C. 规划阶段已自行钉死、不再问（`plan.md:356`）

S-25 的 UI 落点（右侧面板新 Tab `timeline`）、S-16 的文件拆分、S-21 的测试承载（新建 `tests/WishfulClaw.ProviderFallbackRegressionTests` 并**并入 .sln**）。

> 其中「S-16 的文件拆分」在第二轮曾因落点错误需重新钉死，**本轮复验已属实，可正式钉死**（两件拆分 + 渲染落点 `file-aware-editor-utils.ts:212`）。

---

> 本轮结论：**PASS**。三轮累计 ❌：7 → 1 → **0**。plan 可进入用户确认环节；确认环节需拿到 §五 B 的 5 条答案，执行时按 §五 A 的 8 条复核。§四 的 6 条 ⚠️ 不阻断，其中第 2 条（chip 反解析）实施时必做。
