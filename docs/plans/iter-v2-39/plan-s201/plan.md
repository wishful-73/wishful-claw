# Plan: S-201 小米 MiMo 内置清单过期（v2.6 上线 / v2.5 下线 + 套餐切 OpenAI 协议）

> 所属迭代：iter-v2-39 ｜ 需求正文：[`../requirements/S-201.md`](../requirements/S-201.md)
> 状态：**规划中**（阶段二，2026-10-14）
> 层：**渲染端内置 provider preset**（`src/renderer/src/stores/providers/xiaomi.ts`）—— C# / DB / i18n / 官网 **零改动**
> 时限：官方 2026-10-14 18:00（UTC+8）起 `mimo-v2.5*` 自动转发 V2.6 系列；2026-10-21 10:00（UTC+8）起旧模型名调用直接报错

---

## 一、目标

把小米两款内置 preset（直连 `xiaomi` / 套餐 `xiaomi-coding`）的模型清单从 V2.5 世代更新到 V2.6 世代：

1. 新增 `mimo-v2.6-pro` / `mimo-v2.6-flash` / `mimo-v2.6-pro-ultraspeed` 三款；
2. 移除 `mimo-v2.5-pro` / `mimo-v2.5` / `mimo-v2.5-pro-ultraspeed` 三款，并写入 `deprecatedModelIds`；
3. 订正 `ultraspeed` 价格（旧值是已作废的「3 倍体验价」）；
4. `defaultModel` 指向 `mimo-v2.6-flash`（flash 更便宜，老大 2026-10-14 口径）；
5. 套餐 preset 协议从 `anthropic` 切到 `openai-chat`（OpenAI 兼容端点支持模型列表拉取）；
6. 两个 preset `version` 2 → 3 —— **仅作版本记号**：升级链是死代码（见 §九），本刀**不承诺老用户自动迁移**，按老大 2026-10-14 裁决「用户配置我们不关注，只更新内置清单信息」。

## 二、不许动（红线）

1. `xiaomiThinkingConfig`（`:11-14`）—— 与官方文档一字不差，**内容不动**。
2. TTS 三款 `mimo-v2.5-tts` / `-voicedesign` / `-voiceclone` —— **不在下线名单，不动**。
3. `tests/provider-presets/program.ts` —— 本次**不需要**改（理由见 §八-1）；**不顺手**把 `xiaomi` 塞进 `expectedNewPresetIds`。
4. C# 运行时（`src/runtime/**`）、DB、i18n、官网 —— **零改动**。
5. `src/renderer/src/stores/providers/opencode-go.ts` —— S-169 独立链路，不动。
6. `upgradeProviderFromPreset` 的合并规则 —— 不新增字段、不改既有语义。
7. 一律不 `git add` / `commit` / `push` / `reset` / `checkout`（由主会话收口）。

## 三、改动一：`src/renderer/src/stores/providers/xiaomi.ts`

### 3.1 共享数组 `xiaomiTextModels`（`:24-85`）三款文本模型换成 V2.6

数组**长度与顺序不变**（`xiaomiPreset` 靠下标 `...[0][1][2]` 引用，改顺序会错位）：

| 下标 | id（新） | name（新） | supportsVision |
| --- | --- | --- | --- |
| 0 | `mimo-v2.6-pro` | `MiMo V2.6 Pro` | `true` |
| 1 | `mimo-v2.6-flash` | `MiMo V2.6 Flash` | `true` |
| 2 | `mimo-v2.6-pro-ultraspeed` | `MiMo V2.6 Pro UltraSpeed` | `true` |
| 3-5 | TTS 三款 | —— | 原样保留 |

三款文本模型其余字段一律沿用原写法：`icon: 'mimo'`、`enabled: true`、`contextLength: 1_000_000`、`maxOutputTokens: 131_072`、`supportsFunctionCall: true`、`supportsThinking: true`、`thinkingConfig: xiaomiThinkingConfig`。

头部注释（`:16-23`）需要追加一段 V2.6 沿革说明（保留原 V2 / V2.5 沿革记录，只追加，不删旧账）。

### 3.2 两个 preset 的公共字段

- `defaultModel: 'mimo-v2.5-pro'` → **`'mimo-v2.6-flash'`**（`:96` 套餐、`:109` 直连，**两处**）。
- `deprecatedModelIds` 追加三个：`'mimo-v2.5-pro'`、`'mimo-v2.5'`、`'mimo-v2.5-pro-ultraspeed'` ⇒ 最终数组 = 原三个（`mimo-v2-pro` / `mimo-v2-omni` / `mimo-v2-flash`）+ 新三个（`:97`、`:110`，**两处**）。
- `version: 2` → **`3`**（`:89`、`:103`，**两处**）。

### 3.3 `xiaomiPreset`（直连，`:101-131`）价格

`defaultModels` 的下标引用**保持不变**，只订正数值：

| 下标 | 模型 | inputPrice | outputPrice | cacheHitPrice | 说明 |
| --- | --- | --- | --- | --- | --- |
| 0 | `mimo-v2.6-pro` | 0.435 | 0.87 | 0.0036 | 与旧 v2.5-pro 同价 |
| 1 | `mimo-v2.6-flash` | 0.14 | 0.28 | 0.0028 | 与旧 v2.5 同价 |
| 2 | `mimo-v2.6-pro-ultraspeed` | **4.35** | **8.7** | **0.036** | 旧值 `1.305 / 2.61 / 0.0108` 作废 |

### 3.4 `xiaomiCodingPreset`（套餐，`:87-99`）切协议

- `type: 'anthropic'` → **`'openai-chat'`**
- `defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/anthropic'` → **`'https://token-plan-cn.xiaomimimo.com/v1'`**
- `defaultEnabled: false` / `homepage` / `apiKeyUrl` 不动。

## 四、连带影响（协议切换后 thinking 的真正生效路径）

勘察确认的两条消费链：

- **Anthropic 路径**（`src/runtime/WishfulClaw.Agent/AnthropicMessagesInputWriter.cs:431-458`）只读 `thinkingConfig.enabled` / `budgetTokens`，**完全不读 `bodyParams`** ⇒ 套餐现状（anthropic）下的 `xiaomiThinkingConfig.bodyParams` 是**空转**。
- **OpenAI 路径**（`src/runtime/WishfulClaw.Agent/OpenAIChatRequestBuilder.cs:401-487`）在 `provider.thinkingEnabled === true` 时把 `bodyParams` 逐键写入请求 body（`:429-443`），关闭时写 `disabledBodyParams`（`:467-478`）。

⇒ 本次协议切换**顺带让套餐侧的思考配置真正生效**（行为变好，不是回归），与官方「该参数非 OpenAI 标准参数、我们直写 body 不受影响」的结论一致。`xiaomiThinkingConfig` 内容因此**不需要改**。

## 五、验证检查点

1. `npm run typecheck` ⇒ **0 错误**。
2. `npm test` ⇒ **72/72**（TS 54 + C# 18）不变 —— 本刀不新增/不修改测试（理由见 §八-1）。
3. `dotnet build src/runtime/WishfulClaw.sln` ⇒ **0 警告 0 错误**。
4. `cd website; npm run build` ⇒ **0 错**（与本次无关，作为基线跑）。
5. 数据自检（一次性脚本，不入库，跑完删）：两个 preset 的 `defaultModels` id 集合、`defaultModel` 是否在集合内且 enabled、`deprecatedModelIds` 与 `defaultModels` 是否无交集。
6. **真机（老大）**：设置页 → 小米 / 小米（套餐）→ 模型下拉出现 V2.6 三款、V2.5 三款消失、默认选中 `mimo-v2.6-pro`；发一轮带工具调用的对话不报 400。

## 六、涉及文件

- 代码：`src/renderer/src/stores/providers/xiaomi.ts`（**唯一**改动文件）
- 测试：无
- 文档：本目录 `plan.md`（本文件）、`compliance_report.md`、`review_report.md`、`verification_report.md`

## 七、风险 / 待验证

1. **已配置用户不迁移（本刀有意为之，老大已裁决）**：`upgradeProviderFromPreset` 是死代码、`reconcileProviders` 对已持久化记录只刷 `homepage`（证据见 §九），所以已配好的用户 `provider.models` 会永远停在 V2.5 清单。老大 2026-10-14 10:29 裁决「用户配置我们不关注……要么自己维护，要么删了恢复成我们内置的」⇒ 采**方案 C**，不建迁移链。**这意味着老用户不会自动拿到 V2.6**，10-21 后其 V2.5 模型调用会报错，需自行重置或手动维护 —— 已向老大说明并明确接受。附带的既有兜底：用户记录里的 `defaultModel` 若悬空，运行时由 `pickDefaultModel`（`provider-store-helpers.ts:249-256`）与 `provider-store.ts:92-98` 三级回退到首个 enabled chat 模型。
2. **思考模式下温度**：官方称思考模式 `temperature` / `top_p` 不支持自定义。Anthropic 路径会强制 `temperature: 1`（`AnthropicMessagesInputWriter.cs:451-455`），**OpenAI 路径不强制**。套餐切 OpenAI 后若用户设了 `temperature ≠ 1` 是否 400 —— **待真机验证**（直连 preset 早已是 openai-chat，风险面未新增）。本刀不擅自加温度强制。
3. **`ultraspeed` 限流**：官方标注「定制服务，请 联系我们」，公开可调用性未知，真机可能 403/限流 —— 仍入清单（老大要求）。
4. **套餐集群**：官方另有 `sgp` / `ams` 集群，本刀只按国内 `token-plan-cn` 写死（与现状一致）。
5. **思考默认态**：官方默认开启思考；我方由 `settings.thinkingEnabled` 控制 —— 既有语义，本刀不动。

## 八、不需要改的东西（已核对）

1. `tests/provider-presets/program.ts` **无需改动**：`xiaomi` / `xiaomi-coding` 不在 `expectedNewPresetIds`（`:14-34`）⇒ `requireDefaultModel = false`，不校验 defaultModel / 模型唯一性 / 非空。对**全部** preset 生效的只有四条：`version` 为正整数、`type ∈ allowedPresetTypes`（含 `openai-chat`）、`homepage` 为 https、`deprecatedModelIds` 与 `defaultModels` 无交集（`:92-98`）—— 改后均满足。
2. C# 侧无需改动：「assistant 含 `tool_calls` 必须回传 `reasoning_content`」那条硬要求已由 `OpenAIChatRequestBuilder.cs:175-181` 满足。
3. `xiaomiThinkingConfig` 与官方文档一字不差，不动。
4. TTS 三款不在下线名单，不动。
5. `opencode-go.ts` 属 S-169 链路，不动。
6. `upgradeProviderFromPreset` 保留 `apiKey` / `baseUrl` / 用户自定义模型 / 用户 per-model `enabled` 的既有规则，不改。

## 九、阶段三 BLOCK 与裁决记录（2026-10-14）

独立 subagent 的规划合规检查判 **BLOCK（❌ 2 / ⚠️ 18）**，两条 ❌ 同一根因，经主会话逐条复核**成立**。

**计划的错误前提**：本计划初稿 §一-6 写「`version` 2 → 3 触发已配置用户记录重投影」。实际情况：

| 证据 | 位置 | 原文 / 事实 |
| --- | --- | --- |
| 注释自证 | `provider-materialization.ts:102` | 「`upgradeProviderFromPreset` **is dead code**」 |
| 调用点 | `git grep upgradeProviderFromPreset -- src tests` | 生产代码只有定义（`provider-preset-upgrade.ts:19`），唯一调用方是测试 |
| 门禁已废 | `provider-store-helpers.ts:213` | 「The old `presetVersion` upgrade gate is **gone**」 |
| 活路径 | `provider-materialization.ts:140` | 已持久化记录 = `{ ...existing, homepage: preset.homepage }`，只刷 homepage |
| 无比较点 | `git grep presetVersion -- src tests` | 仅赋值（`createProviderFromPreset:29` 等），无任何比较 |

**后果**：任何 preset 数据订正（新模型 / 价格 / contextLength）都到不了已配置用户，`version` bump 是摆设。**未物化**（没配过 key、没改过任何东西）的记录每次启动都会重投影 ⇒ **新装 / 全新用户不受影响，受影响的是已配好 API Key 的那批**。

**裁决（老大 2026-10-14 10:29 原话）**：

> 「你操心的太多了，我已经说了，用户配置我们不关注，这次只是更新内置清单信息，用户想更新新的 要么自己维护，要么删了恢复成我们内置的」

⇒ 采**方案 C**：只改内置 preset 数据，**不建立老用户迁移链**。被否决的**方案 A**（把 `upgradeProviderFromPreset` 接回 `reconcileProviders`，让 preset 可刷新字段跟着走）与**方案 B**（窄修，只剔除 preset 声明废弃的模型）**留作未来独立需求** —— 它们属 R-9.2「已物化的用户自己管理」的设计变更，需单独立项 + 独立审查。

**其余 ⚠️ 的处理**：

- 「套餐切 `openai-chat` 属需求外改动」→ 老大 2026-10-14 10:17 已拍板「两种协议都兼容的情况下优先使用 OpenAI 协议」，按拍板执行；需求正文 §六 的「不动协议」措辞留**收尾刀**订正。
- 「三款 `supportsVision: true` 的依据」→ 官方模型列表页能力表 `rowSpan=3`，「全模态理解」覆盖 v2.6-pro / v2.6-flash / v2.6-pro-ultraspeed / v2.5，判 `true` 有依据。
- 「`defaultModel` 取值」→ 老大 2026-10-14 10:27：「defaultModel 默认是 flash 系列的，主要是便宜点」⇒ 定 `mimo-v2.6-flash`。
- 「`npm test` 72/72 未验证」→ 本刀后已实测 **72/72**（TS 54 + C# 18）。
- 「协议切换的鉴权头差异」→ 鉴权头由运行时按 `type` 决定，属既有链路，本刀不新增代码；真机验证项已列入 §五-6。
