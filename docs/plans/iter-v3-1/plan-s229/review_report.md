# S-229 审查报告（阶段五）

> 2026-10-26 · 独立 subagent（code-reviewer）全量审查 + 逐条处理
> 审查范围：`git diff` 的 5 个业务文件，前后交叉读过 `provider-store.ts`、`provider-store-helpers.ts`、`provider-payload.ts`、`api-user-agent.ts`、`sidecar-mapping.ts`、`provider-auth*.ts`、`workbuddy-checkin.ts`、`src/main/lib/ai-provider-store.ts`、`src/runtime/**/*.cs` 的消费点。

## 一、审查结论

**❌ 2 / ⚠️ 6 / ℹ️ 6**

## 二、❌ 必修项与处理

### ❌1 补 `authMode` 后 OAuth 服务商会从模型选择器消失 —— 已修

- **问题**：`provider-store.ts:386` `isProviderAuthReady` 里 `authMode === 'apiKey'` 才走可用判断，其余一律 `return false`。投影不带 `authMode` 时走的是 `'apiKey'` 兜底，`requiresApiKey === false` 让它恒可用；补上 `authMode: 'oauth'` 之后直接返回 `false` ⇒ `isProviderAvailableForModelSelection` 全假 ⇒ `ModelSwitcher.tsx:116`、`AutomationModelSelector.tsx:32`、`MemorySettingsPanel.tsx:125`、`AppPluginPanel.tsx:215`、`GoalConfirmCard.tsx:51`、`memory-automation-utils.ts:249` 全部选不到 WorkBuddy。**登录了也用不上**，等于把 S-218 从「登录不了」换成「登录了不能选」。
- **处理**：`isProviderAuthReady` 新增 `authMode === 'oauth'` 分支 —— `provider.oauth?.accessToken` 或 `oauthAccounts?.length > 0` 即视为就绪。判据与授权页一致（有 token），不改 `channel` 分支语义。
- **副作用评估**：codex-oauth / copilot-oauth / moonshot 三个老 OAuth 服务商从此也能进模型选择器（它们落盘记录本来就带 `authMode: 'oauth'`，一直是 `false`）。方向正确 —— 登录过的 OAuth 服务商当然应该可选；这条以前被掩盖，属同源缺陷。

### ❌2 `fillMissingProtocolFields` 漏补 4 个字段 —— 已修

- **问题**：手抄的补齐清单只写了 6 个键，`useSystemProxy` / `instructionsPrompt` / `websocketUrl` / `websocketMode` 不补。`workbuddy-checkin.ts:89` 读的是 `provider.useSystemProxy`（不是 `oauthConfig` 里的），所以老记录会出现「换 token 走代理、签到直连」的割裂。
- **处理**：补齐逻辑改为由 `protocolFieldsOf(preset)` **驱动**（唯一字段来源），投影与补缺共用同一份清单，消除两处手抄漂移。测试里显式 `delete broken.useSystemProxy` 并断言补回，避免「从新投影克隆 ⇒ 自证」的假通过。

## 三、⚠️ 建议项与处理

| # | 问题 | 处理 |
|---|---|---|
| 1 | 「不覆盖」用的是 falsy 判断，用户显式清成 `''` 会被重置 | **采纳** —— 统一改 `=== undefined`；测试补 `instructionsPrompt: ''` 用例 |
| 2 | `cloneRequestOverrides` 漏 `omitBodyKeys`（codex-oauth 是数组），共享引用 | **采纳** —— 换 `clonePlain` 递归拷贝；测试补 `omitBodyKeys` 隔离断言 |
| 3 | `oauthConfig` 浅拷贝，`stateRequestHeaders` / `extraParams` 等内层 map 仍共享 | **采纳** —— `oauthConfig` / `requestOverrides` / `channelConfig` / `ui` 全部走 `clonePlain`；测试补内层 header 隔离断言 |
| 4 | `extraBuiltinRecords`（同预设第二条，官方 + 中转）不补协议字段 | **采纳** —— push 前按 `builtinId` 找 preset 补缺；**不动** `homepage` / `tagline`（用户可能正拿它当中转条目展示）；测试补用例 |
| 5 | `tagline` 只加不删，且与 `homepage` 契约不一致 | **采纳** —— 改成无条件 `tagline: preset.tagline`（`undefined` 被 `JSON.stringify` 丢弃，顺带清残留） |
| 6 | 新增测试挡回归能力偏弱（未覆盖 `useSystemProxy` / 只测单个字段 / 无第二条记录用例） | **采纳** —— 断言从 13 条增到 26 条，覆盖上述全部洞 |

## 四、ℹ️ 记录项

| # | 内容 | 处置 |
|---|---|---|
| 1 | 下游消费点核查：`useSystemProxy` 在 `src/main` 与 `src/runtime/**/*.cs` **无消费点**，只在 renderer 的 auth / sidecar / cron 透传；`instructionsPrompt` 仅 2 处透传；`websocketUrl` / `websocketMode` 仅弹窗与 sidecar mapping；无任何 preset 声明这四项。真正生效的是 `userAgent` + `requestOverrides`（`ApiUserAgent.cs:23`、`ProviderHttpHeaders.cs:47/58/66-68`） | 记录。Qwen / Moonshot 的 UA 恢复 **待真机扫一眼**（恢复的是 preset 本意，不是新行为） |
| 2 | `ui.hideOAuthSettings` 全仓无消费点 ⇒ 补投 `ui` 本刀无行为变化 | 记录。验收标准不写「OAuth 设置区被隐藏」 |
| 3 | 已连接但无 `accountId` / `uid` 时副标题退回 `tagline · homepage`（`homepage` 必填，不会空） | 无需改 |
| 4 | 面板已被 `isServerPollProvider` 过滤，`canCheckin` 与它第二条件重复 | 保留 —— 卡片组件是独立单元，不该假设调用方过滤过；注释已说明 |
| 5 | 原注释「a token already stored under `oauthConfig`」与事实不符（token 在 `oauth` / `oauthAccounts`） | **已订正** |
| 6 | 补齐在内存态，`ensureBuiltinPresets` 的 `setState` 触发 persist 写回 ⇒ 主进程签到定时器读盘能看到新字段 | 记录（正面链路） |

## 五、结论

❌ 全部修复，⚠️ 全部采纳，ℹ️ 记录在案。整改后复跑：`typecheck` 0 错、`test:provider-presets` **601 断言全过**。
