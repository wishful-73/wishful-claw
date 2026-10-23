# Plan: S-218 WorkBuddy 账号接入

> 补写于 2026-10-23。本文件还原实施时的步骤划分与验证检查点；`[✓]` 表示已完成并验证，`[ ]` 表示未开工。
> 需求正文见 `../requirements/S-218.md`，契约细节（接口、错误码、请求头）全在那份文档的 §3，本文不复述。

## 目标

把 WorkBuddy 作为「授权 AI 服务商」接入：用户拿自己的 WorkBuddy 账号登录，消耗已有套餐额度，不填 API Key、不做客户端注册。国内外两个 build 都要支持。

## 步骤清单

| # | 步骤 | 验证检查点 | 状态 |
|---|---|---|---|
| 1 | `OAuthFlowType` 增加 `'server_poll'`；`OAuthConfig` 补 `stateUrl` / `accountUrl` / `accountsUrl` / `pollIntervalMs` / `pollTimeoutMs` 等字段；`OAuthToken` 补 `uid` / `enterpriseId` / `domain` / `autoCheckin` | `tsc -p tsconfig.web.json` 与 `-p tsconfig.node.json` 均 0 错 | [✓] |
| 2 | 双版预设 `stores/providers/workbuddy.ts`：两个 build 的基址、静态请求头、模型清单（中国版 15 个 / 国际版 16 个） | 预设能被 `flowType === 'server_poll'` 筛出；tsc 0 错 | [✓] |
| 3 | 登录链路 `lib/auth/workbuddy-signin.ts`：铸 state → 开浏览器 → 轮询 token（重试 `11217`）→ 轮询 account（重试 `12151`）→ 企业号查 `accountsUrl` 挑 `enterpriseId` | tsc 0 错；三个轮询分支的退出条件与超时都能对上 §3.2 | [✓] |
| 4 | 令牌续期 `refreshWorkBuddyToken` + `provider-auth-accounts.ts` 前置条件放开（`server_poll` 不要求 `clientId`） | tsc 0 错；`server_poll` 走新分派、其余流程走原分派 | [✓] |
| 5 | 身份头注入：`provider-payload.ts` 传 `oauthAccount`，后端 `ProviderHttpHeaders.cs` 发 `X-User-Id` / `X-Domain`，企业号另发 `X-Enterprise-Id` / `X-Tenant-Id` | `dotnet build src\runtime\WishfulClaw.sln` 0 警告 0 错误 | [✓] |
| 6 | 签到（渲染端 `workbuddy-checkin.ts` + 主进程 `workbuddy-checkin-scheduler.ts` + 授权页开关） | tsc 0 错；开关写 `oauth.autoCheckin`，定时器每分钟重读 provider 文件 | [✓] |
| 7 | 设置页新增「授权 AI 服务商」页签：`ui-types.ts` 的 `SETTINGS_TABS` 与 `SettingsPage.tsx` 渲染分支两处同步；**判据为 `authMode === 'oauth'`**（`ProviderAuthPanel` 内进一步按 `flowType === 'server_poll'` 收窄）；Codex / Copilot / Moonshot 一并迁入；`ProviderPanel.tsx:182/:190` 加 `authMode !== 'oauth'` 过滤，避免重复出现 | 两处 id 一致；tsc 0 错 | [✓] 两处同步完成；**迁入与过滤未做**（见 §10.2 偏差 3、审查 ⚠️47） |
| 8 | 请求侧修补：工具 schema 畸形规避、工具名非法字符转义与还原、`X-Conversation-*` 四个会话头、内容指纹规避（§3.3.1 / §3.4 / §3.7） | 真账号发一次带工具的请求，不报 `11133`；工具名往返一致 | [ ] |
| 9 | 模型清单 `/v3/config` 拉取 + 拉空落兜底表并标「以本地内置为准」 | 断网时卡片出现兜底标记，不报错 | [ ] |
| 10 | 额度显示：个人读 `resource-summary`、企业读 `enterprise-user-usage`；`"438.88"` 这类字符串容量值不崩 | 两种账号各显示一次 | [ ] |
| 11 | 计费倍率 `credits` 口径接入用量统计 | 用量面板金额与 WorkBuddy 后台一致 | [ ] |
| 12 | **§5.1 接入前三层风险提示**（非官方接入 / 腾讯可限制账号 / 勾选确认，缺一不算尽责）+ **§5.2 服务商「第三方」角标** | 添加服务商时必须先勾选，未勾选「登录」不可点；卡片上有「第三方」标识 | [✓] 阶段五审查 ❌4/❌5 后补做（`ProviderAuthPanel.tsx`） |
| 13 | **§5.3 错误码人话翻译**：`11140` / `14018` / `unapproved channel` 三类不得显示成笼统「请求失败」；归口 `ProviderRetryPolicy.cs` + 文案表，不新建 Dialect | 无套餐账号看到 `14018` 的专属提示 | [ ] 签到链路已按验证码正则分流，**对话链路未接**（`S-218.md §10.3` 已记缺口） |

**步骤 8~11、13 未开工的共同原因**：没有可用套餐账号，写完也验不了。按 `AGENTS.md`「迭代交付标准」的「有闭环」要求，S-218 在步骤 8 完成前不能算交付。

**步骤 12 的来源说明**：本条与步骤 13 是阶段三合规检查补登记的 —— 首版 plan 只列了「能做出来的功能」，把 §5「风险与产品口径」整节漏在步骤表外，导致实施时无人认领，最后由阶段五审查判为 ❌。

## 涉及文件

### 新增

- `src/renderer/src/stores/providers/workbuddy.ts` — 双版预设、静态头、模型清单
- `src/renderer/src/lib/auth/workbuddy-signin.ts` — 登录与续期
- `src/renderer/src/lib/auth/workbuddy-checkin.ts` — 渲染端签到
- `src/renderer/src/components/settings/ProviderAuthPanel.tsx` — 授权服务商页
- `src/main/lib/workbuddy-checkin-scheduler.ts` — 主进程签到定时器

### 修改

- `src/shared/types/provider.ts` — 流程类型与 token 字段
- `src/renderer/src/stores/providers/index.ts` — 注册预设
- `src/renderer/src/lib/auth/oauth.ts` — `server_poll` 分派
- `src/renderer/src/lib/auth/provider-auth-accounts.ts` — 续期前置条件
- `src/renderer/src/lib/agent/provider-payload.ts` — `oauthAccount` 下发
- `src/renderer/src/stores/ui-types.ts` — 设置页签
- `src/renderer/src/components/settings/SettingsPage.tsx` — 页签与渲染分支
- `src/main/index.ts` — 启动定时器
- `src/runtime/WishfulClaw.Agent/ProviderHttpHeaders.cs` — 身份头

## 参考源码

- `.wishful-claw/tmp/astra-plugins/`（Apache-2.0，WorkBuddy 插件参考实现）
  - `src_sites.mjs` — 两个 build 的基址与域名
  - `src_request.mjs` — 四个会话 id 的生成规则、静态头
  - `src_signin.mjs` — 登录轮询与重试码
  - `src_checkin.mjs` — 签到路径与 `10001` 语义
  - `src_models.mjs` — 模型清单字段
  - `src_api.mjs` — `{code, msg, data}` 信封与 `WBError`

## 分层说明

后端**不新建 Dialect**：WorkBuddy 的请求体是标准 `openai-chat`，现有 `OpenAIChatProvider` 直接能发；差异全在请求头与少量出站修补上，落在 `ProviderHttpHeaders.cs` 这一个既有注入点。当初评估过的 `WorkBuddyDialect.cs` / `WorkBuddyAuthService.cs` / `WorkBuddyModelCatalog.cs` / `WorkBuddyBilling.cs` 四个模块**经勘察判定不需要**。
