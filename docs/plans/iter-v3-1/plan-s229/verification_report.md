# S-229 验证报告（阶段六）

> 2026-10-26 · 环境：Windows / Node v24.14.1 / .NET SDK 11.0.100

## 一、自动化门禁

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | **0 错**（node + web 两侧） |
| 单元测试（全量） | `npm test` | **83/83 通过** |
| 预设一致性回归 | `npm run test:provider-presets` | **601 断言全过**（48 个预设）—— 本需求新增 26 条断言 |
| C# 构建 | `dotnet build src\runtime\WishfulClaw.sln` | **未完成，非代码原因**：`WishfulClaw.Worker (PID 28564)` 正在运行并锁定 `bin\Debug\net11.0\*.dll`，14 个错误全为 `MSB3021 / MSB3027` 文件占用，**0 个编译错误**。本需求零 C# 改动，不影响 runtime |

## 二、代码位点核对

| 验收项（`plan.md` §三） | 实现 | 状态 |
|---|---|---|
| 1. 授权页出现两张卡片（WorkBuddy / WorkBuddy AI） | `createProviderFromPreset` 投出 `authMode` + `oauthConfig` ⇒ `isServerPollProvider` 成立 | ✅ 代码位点确认，真机待看 |
| 2. 未勾选风险时两个「登录」禁用 | 原有 `signInDisabled={!riskAccepted}` 未改 | ✅ 不变 |
| 3. `oauthConfig` 有值（`stateUrl` / `tokenUrl` / `accountUrl`） | `protocolFieldsOf` → `clonePlain(preset.oauthConfig)`；回归断言校验 `flowType` | ✅ |
| 4. `userAgent` = `WorkBuddy/5.5.6`，`requestOverrides.headers` 含 `X-IDE-Type` | 同上；断言 2 条 | ✅ |
| 5. 投影与 preset 不共享引用 | `clonePlain` 递归拷贝；断言覆盖 `requestOverrides.headers` / `omitBodyKeys` / `oauthConfig.stateRequestHeaders` | ✅ |
| 6. 已物化记录只补缺失、不覆盖用户值 | `fillMissingProtocolFields` 用 `=== undefined` 判定；断言覆盖 `userAgent` / `instructionsPrompt: ''` / `oauthConfig.stateUrl` / `requestOverrides` | ✅ |
| 7. `typecheck` 0 错 / `npm test` 通过 | 见上 | ✅ |

## 三、审查整改后新增的两处（不在原方案内）

1. **`isProviderAuthReady` 补 `oauth` 分支**（`review_report.md` ❌1）—— 不补则 WorkBuddy 登录后在模型选择器里消失。连带效果：codex / copilot / moonshot 登录后也可选（同源缺陷一并转正）。
2. **`extraBuiltinRecords` 补协议字段**（⚠️4）—— 同预设的中转条目同样可能是老投影产物。

## 四、待真机验收（老大）

1. 设置 →「授权 AI 服务商」：看到 **两张卡片**，副标题分别是「国内版 · https://copilot.tencent.com」「国际版 · https://www.workbuddy.ai」。
2. 勾选风险确认 → 点国内版「登录」→ 浏览器完成登录 → 卡片变「已连接」并显示账号。
3. 登录后顶栏模型选择器里**能选到 WorkBuddy**（❌1 的回归点，必须验）。
4. 点「签到」出结果 toast（成功 / 今日已签）。
5. 关掉应用重开，卡片仍是「已连接」（走的是 `fillMissingProtocolFields` 修过的落盘记录）。
6. 顺手扫一眼 Qwen / Moonshot 的请求是否正常（UA 恢复，`review_report.md` ℹ️1）。

## 五、范围外留档

- **Qoder 未接入**：全仓 `qoder` 0 命中，参考实现 `astragate-community/astra-gate-plugins` 本地不存在 ⇒ **无契约可抄**，不编造。单列 S-230，需要老大给参考来源或官方抓包。
- 放宽收录范围到 codex / copilot / moonshot（需通用登录分发）：S-231。
