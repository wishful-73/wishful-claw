# S-229 实施方案 · 内置 OAuth 预设投影丢协议字段

> 迭代 v3-iter-1（追加，Bug）· 2026-10-26
> 触发：老大 10:59「授权服务商怎么只有这么一个提示啊？workbuddy呢？国际版 国内版列出来啊」

## 一、探索结论（已实查）

### 1.1 根因

`ProviderAuthPanel.tsx:169`：

```ts
const targets = useMemo(() => providers.filter(isServerPollProvider), [providers])
// isServerPollProvider(provider)
//   = provider.authMode === 'oauth' && provider.oauthConfig?.flowType === 'server_poll'
```

`providers` 里的内置服务商是 **虚拟投影**，投影函数
`stores/provider-materialization.ts:16-37` `createProviderFromPreset` 只投 14 个字段：

```
id / name / type / apiKey / baseUrl / homepage / enabled / models /
builtinId / presetVersion / createdAt / requiresApiKey / defaultModel / virtual
```

`authMode`、`oauthConfig` **不在其中 ⇒ 恒为 undefined ⇒ 筛选恒假 ⇒ targets = []**。

页面渲染 `targets.length === 0` 分支：「暂无支持账号登录的服务商。」⇒ 老大看到的「只有提示」。

### 1.2 预设本身完好

| 版本 | builtinId | 名称 | baseUrl | flowType |
|---|---|---|---|---|
| 国内版 | `workbuddy` | WorkBuddy | `https://copilot.tencent.com/v2` | `server_poll` |
| 国际版 | `workbuddy-ai` | WorkBuddy AI | `https://www.workbuddy.ai/v2` | `server_poll` |

`stores/providers/workbuddy.ts:138` / `:158`，均已注册进 `providers/index.ts:92-93`。

### 1.3 同一个根因的四个面

| 断点 | 位置 | 后果 |
|---|---|---|
| 收录不到 | `ProviderAuthPanel.tsx:24` | 卡片不渲染 |
| 登录失败 | `workbuddy-signin.ts:204-205` 读 `provider.oauthConfig` | 抛「该服务商没有 OAuth 配置」 |
| 续期失败 | `provider-auth-accounts.ts:20-22` | `authMode !== 'oauth'` 直接 return false |
| 请求头不全 | 投影漏 `userAgent` / `requestOverrides` | `workbuddy.ts:149`「缺它报 10085」；`X-IDE-Type` 等头缺失 |

### 1.4 为什么现在才发现

R-9（`7cb22530`，2026-09-13 迭代 28）引入虚拟投影时漏的。

- 老 OAuth 服务商（codex / copilot / moonshot）多有 R-9 之前落盘的**完整**记录，
  `reconcileProviders:140` 对已物化记录原样保留 ⇒ 不爆。
- WorkBuddy 是 2026-10-25 才加的，**从未落盘**，每次启动都是新投影 ⇒ 必踩。
- 这也是 S-218 一直 blocked 在「需真账号实测」的原因 —— 真测必撞。

### 1.5 收录范围为什么不能顺手放宽

`ProviderAuthPanel.handleSignIn`（`:174-196`）**硬编码调 `signInWithWorkBuddy`**。
全 `renderer/src` 搜 `authorizeUrl` / `deviceCodeUrl`，**组件层 0 命中** ——
`copilot-oauth` / `moonshot`（`flow_type: device_code`）与 `codex-oauth`（authorize 跳转）
没有可复用的通用登录入口。

⇒ 若把筛选放宽到所有 `authMode === 'oauth'`，会给这几家渲染出**点了必然报错**的卡片。
故本轮**保持 server_poll 筛选**，放宽单列 S-231（需先做通用登录分发）。

## 二、方案

### 2.1 投影补齐协议字段（`createProviderFromPreset`）

按 `AIProvider` 与 `BuiltinProviderPreset` 的交集补 10 个：

| 字段 | 处理 |
|---|---|
| `useSystemProxy` | 直传（workbuddy 两个 preset 都为 `true`） |
| `userAgent` | 直传（缺它 WorkBuddy 报 10085） |
| `authMode` | 直传 |
| `oauthConfig` | **浅拷贝** `{ ...preset.oauthConfig }` —— 共享引用会让运行时改写污染全站 |
| `channelConfig` | 浅拷贝（`authMode: 'channel'` 的服务商同样在丢） |
| `requestOverrides` | **结构化拷贝**：`{ ...o, headers: { ...o.headers }, body: { ...o.body } }` |
| `instructionsPrompt` | 直传 |
| `ui` | 浅拷贝 |
| `websocketUrl` / `websocketMode` | 直传 |

不补：`allowInsecureTls` / `sendTemperature` / `sendMaxOutputTokens` / `cacheTtl`
（用户偏好，preset 无对应字段）；`apiKeyUrl` / `deprecatedModelIds`
（preset 独有的元数据，`AIProvider` 上不存在）。

### 2.2 已物化记录：只补缺失，不覆盖（`reconcileProviders:140`）

现状 `existing ? { ...existing, homepage: preset.homepage } : createProviderFromPreset(preset)`。

改为：在 homepage 刷新之外，对 2.1 那组**协议字段**逐项 `??=` 式补空：

```ts
function fillMissingProtocolFields(existing: AIProvider, preset: BuiltinProviderPreset): AIProvider
```

**硬约束**：只在 `existing.X === undefined` 时写入 preset 值。用户改过的
`userAgent` / `oauthConfig` / `requestOverrides` 一律保留 —— 否则等于静默重置配置。

### 2.3 卡片副标题标注国内版 / 国际版（老大 11:04：按推荐来）

`name` 不动（`WorkBuddy` / `WorkBuddy AI` 保持原样），新增展示字段：

- `BuiltinProviderPreset.tagline?: string` —— `workbuddy`「国内版」/ `workbuddy-ai`「国际版」
- `AIProvider.tagline?: string` —— 由投影带过去
- `ProviderAuthPanel` 卡片副标题：已连接且有账号 ⇒ 显示账号；否则显示
  `tagline · homepage`（现在只显示 homepage）

### 2.4 签到按钮加 flowType 守卫

`ProviderAuthPanel.tsx:90-103` 的「签到」按钮当前对**所有已连接**的卡片显示。
只有 `flowType === 'server_poll'` 有签到接口。加条件，避免以后放宽收录时给
device_code 服务商渲染无效按钮。

## 三、验收标准

1. 「授权 AI 服务商」页出现 **两张卡片**：WorkBuddy（副标题含「国内版」）、WorkBuddy AI（含「国际版」）。
2. 未勾选风险确认时，两个「登录」按钮均 disabled。
3. `provider.oauthConfig` 实际有值（`stateUrl` / `tokenUrl` / `accountUrl` 齐全），点登录不再抛「没有 OAuth 配置」。
4. `provider.userAgent` 为 `WorkBuddy/5.5.6`，`requestOverrides.headers` 含 `X-IDE-Type`。
5. 投影对象与 preset **不共享引用**：改 `provider.oauthConfig.stateUrl` 不影响下一次投影。
6. 已物化记录（用户改过字段）在重投影后，用户值被保留，仅空字段被补齐。
7. `typecheck` 0 错；`npm test` 通过；`dotnet build` 不受影响（无 C# 改动）。

## 四、范围外

- **放宽收录范围到 codex / copilot / moonshot** —— 需通用登录分发，单列 **S-231**。
- **Qoder 接入** —— 代码 0 命中，缺契约，单列 **S-230**。
- 不改 device_code / authorize 流程；不改签到逻辑；不改 `providers/index.ts` 预设清单。
- 不 bump preset `version`（虚拟投影每次重建，新字段自动生效；已物化记录由 2.2 补）。
