# S-201 规划合规检查报告

> 阶段：阶段三（规划合规检查） ｜ 检查员：独立 subagent ｜ 日期：2026-10-14

**被检计划**：`docs/plans/iter-v2-39/plan-s201/plan.md`
**需求正文**：`docs/plans/iter-v2-39/requirements/S-201.md`
**核验方式**：只读（未改任何源码/文档；未跑构建/测试）。源码用 `[IO.File]::ReadAllText/ReadAllLines` + `git grep` 逐条回核。
**一句话结论**：计划对 `xiaomi.ts` 的数据改动与行号引用**准确可核验**，但**对「升级/重投影机制」的认知与代码不符**（§一-6、§3.2、§七-1），并把**「套餐协议切换」这一需求外改动当成既定方案**。总判定 **BLOCK**。

---

## 一、覆盖度（需求条目 → 计划落点 → 判定）

| # | 需求条目 | 计划落点 | 判定 |
| --- | --- | --- | --- |
| 1 | §四-1 新增 v2.6 三款（pro / flash / pro-ultraspeed） | §3.1 | ⚠️ 三款 `supportsVision` 一律写 `true`，而需求 §五-1 仍为「待定」、§五-5 指出 ultraspeed 能力列为空「待核」 |
| 2 | §四-2 价格（含订正 ultraspeed stale 价） | §3.3 | ✅ 数值与需求 §三.3 海外美元表一致：pro `0.435/0.87/0.0036`、flash `0.14/0.28/0.0028`、ultraspeed `4.35/8.7/0.036` |
| 3 | §四-3 `defaultModel` → 换不换 | §3.2 | ⚠️ 计划直接改成 `mimo-v2.6-pro`，未标注需求 §五-3「待老大点头」 |
| 4 | §四-4 `deprecatedModelIds` 是否纳入 v2.5 | §3.2 | ⚠️ 计划默认「现在就清」，未标注需求 §五-2「现在清 vs 10-21 后清 需口径」 |
| 5 | §四-5 `version` 2 → 3 | §3.2 | ❌ 计划理由「触发已配置用户记录重投影」与代码不符（详 二-8） |
| 6 | §四-6 套餐与直连共用数组 + 确认其思考下发路径 | §一-5 / §3.4 / §四 | ⚠️ 计划把「确认」升级为「把 `${type}` 从 anthropic 切到 openai-chat」，超出需求范围 |
| 7 | §五-4 小米 anthropic 端点是否接受 `{type:'disabled'}` | §一-5 用「切协议」绕开该问题 | ⚠️ 绕开未验证项，但新协议（openai-chat）的鉴权/端点又成新未验证项 |
| 8 | §六 非目标（不动 opencode-go / C# / 渲染层 / DB） | §二 红线 1-7 | ✅ 计划红线与需求 §六 一致 |
| 9 | §六「不动渲染层 / 协议 / C# / DB」 | §3.4 改 `xiaomiCodingPreset.type` | ⚠️ 与「不动协议」表述存在张力：`type` 是 preset 数据，但决定运行时协议 |

**覆盖度小结**：⚠️ 需求 §四 的 6 条建议改动均有落点，但 §四-1 / §四-3 / §四-4 三条需求**明写「待定/待口径」**的子项被计划**悄悄定案**；§四-6 被扩大为协议切换；§四-5 的理由错误。

---

## 二、事实正确性（逐条回源码）

1. ✅ **`xiaomiPreset` 靠下标引用 `xiaomiTextModels`**。证据：`src/renderer/src/stores/providers/xiaomi.ts:113` `...xiaomiTextModels[0],`、`:119` `...xiaomiTextModels[1],`、`:125` `...xiaomiTextModels[2],`。计划 §3.1「靠下标 `...[0][1][2]` 引用，改顺序会错位」属实。
2. ✅ **计划对 `xiaomi.ts` 的行号引用全部一致**（文件共 131 行）。证据：`xiaomiThinkingConfig` = `:11-14`；头部注释 = `:16-23`；数组 `xiaomiTextModels` = `:24-85`；`xiaomiCodingPreset` = `:87-99`；`version: 2` = `:89`、`:103`；`defaultModel: 'mimo-v2.5-pro'` = `:96`、`:109`；`deprecatedModelIds` = `:97`、`:110`；`xiaomiPreset` = `:101-131`。全部命中（计划把 89/103、96/109、97/110 分别标为「两处」亦正确）。
3. ✅ **测试套件事实**。证据：`tests/provider-presets/program.ts:14-34` 的 `expectedNewPresetIds` 不含 `xiaomi` / `xiaomi-coding`；`:71` `checkPreset(preset, expectedNewPresetSet.has(...) && !dynamicPresetIds.has(...))` ⇒ 二者 `requireDefaultModel=false`；对全部 preset 生效的正是四条：`:46`（version 正整数）、`:47`（type 合法，`allowedPresetTypes` 含 `openai-chat`）、`:48`（homepage https）、`:92-98`（`deprecatedModelIds` 与 `defaultModels` 无交集）。且 `git grep -i "xiaomi\|mimo" -- tests` **零命中**。⇒ 计划 §八-1「测试无需改动」**成立**（注意：这与**需求 §七「模型条数/version/价格断言会红」相矛盾**，以代码为准，是需求 §七 高估了爆炸半径）。
4. ✅ **Anthropic 路径只读 `enabled` / `budgetTokens`**。证据：`src/runtime/WishfulClaw.Agent/AnthropicMessagesInputWriter.cs:431-458`；`:439` `var enabled = JsonHelpers.GetBool(thinkingConfig, "enabled", false);`、`:442` `GetIntNullable(thinkingConfig, "budgetTokens") ?? 10000`；全方法**无 `bodyParams` 读取**。计划 §四 属实。
5. ✅ **OpenAI 路径的开关分支**。证据：`src/runtime/WishfulClaw.Agent/OpenAIChatRequestBuilder.cs:401-487`；`thinkingEnabled` 为真时 `:429-443` 逐键写 `bodyParams`；为假时 `:467-478` 写 `disabledBodyParams`。计划 §四 属实。
6. ✅ **`reasoning_content`**。证据：`OpenAIChatRequestBuilder.cs:169` `if (message.ToolUses.Count > 0)`，`:178-181` 写 `reasoning_content`。计划 §八-2（标 175-181，含注释行）与需求 §三.1 的描述属实。
7. ✅ **回退链**。证据：`provider-store-helpers.ts:249-256` `pickDefaultModel` = `defaultModel` 命中 →首个 `enabled && chat` →首个 `enabled` →`[0]`；`provider-store.ts:92-98` 同级回退。计划 §七-1 行号属实；在 `defaultModels` 顺序下确会「兜到首个 enabled chat 模型」（即 `mimo-v2.6-pro`）。
8. ❌ **计划 §一-6 / §3.2「version 2 → 3 触发已配置用户记录重投影」与代码不符**。证据：`git grep -n "presetVersion" -- src` 仅出现在赋值与注释（`provider-materialization.ts:29`、`provider-preset-upgrade.ts:43`、`provider-store-helpers.ts:213` 注释），**无任何比较/门禁**；`upgradeProviderFromPreset` 的唯一引用是自身、测试、以及 `provider-materialization.ts:102` 的注释「`upgradeProviderFromPreset` is dead code」（**死代码，全仓无调用点**）；活路径是 `ensureBuiltinPresets`（`provider-store-helpers.ts:218-224`）→ `reconcileProviders`（`provider-materialization.ts:109-140`），对已有持久化记录**只**做 `:140` `providers.push(existing ? { ...existing, homepage: preset.homepage } : createProviderFromPreset(preset))` —— **不刷 `models` / `type` / `defaultModel`，也不读 `version`**。⇒ 对「已配置用户」，version bump 是**空操作**，v2.6 模型**不会**因本次改动出现在其下拉里。
9. ⚠️ **协议切换的覆盖面被高估**。证据同上（`provider-materialization.ts:140` 只刷 `homepage`）：`type` 切换只对**未配置（virtual）**用户/新装生效；**已配置**的套餐用户其 `type`（仍是 `anthropic`）与 `baseUrl`（仍是 `.../anthropic`）**都不会随版本刷新**。故计划 §四「本次协议切换顺带让套餐侧的思考配置真正生效」仅对未配置用户成立。
10. ⚠️ **计划 §七-1 前提「v2.5 被删后……」不成立**。证据同上：已配置用户的 `models` 数组不会被刷新，v2.5 三款**不会**「被删」，`defaultModel` 悬空问题在该前提下并不按计划所述方式发生（真实行为是「模型清单整体保持旧值」）。
11. ⚠️ **与迭代任务清单不一致**。证据：本迭代 Steps 面板「阶段四：同步 provider-presets 测试断言并跑门禁四绿」「收口：代码一刀提交（渲染端 + 测试断言）」期望改测试；而计划 §八-1 论证**测试无需改**（二-3 已证实计划正确）。⇒ 二者必须对齐（要么修任务清单，要么计划漏了别的断言文件）。

---

## 三、范围

1. ✅ 未改 C#（`src/runtime/**`）、DB、i18n、官网 —— 与需求 §六 一致，无擅自扩大。
2. ✅ 未动 `opencode-go.ts` —— 与需求 §六 / 计划 §二-5 一致。
3. ✅ 未改别的 preset，未把 `xiaomi` 塞进 `expectedNewPresetIds` —— 与计划 §二-3 一致。
4. ✅ 未改测试，且该判断经二-3 证实**正确**。
5. ⚠️ **需求外改动**：`xiaomiCodingPreset.type` anthropic → openai-chat、`defaultBaseUrl` `/anthropic` → `/v1`（计划 §3.4）。需求 §四-6 只要求「确认它的思考下发路径是 Anthropic 协议」，§六 明写「不动协议」。该改动有先例（`deepseek.ts:11-15` v4 同样由 Anthropic 切 openai-chat），但**不在本需求授权范围内**，应回到老大/需求侧确认后再落。

---

## 四、验证充分性（§五 检查点）

1. ✅ 检查点 1 `npm run typecheck` = 0 错 —— 可执行。
2. ✅ 检查点 3 `dotnet build`、检查点 4 `website; npm run build` —— 可执行。
3. ✅ 检查点 5「数据自检脚本（一次性、不入库、跑完删）」—— 可执行，且与测试 `:92-98` 的 `deprecated∩defaultModels` 校验互补。
4. ✅ 检查点 6 真机（下拉出现 v2.6、v2.5 消失、默认选中 v2.6-pro、带工具调用不报 400）—— 可执行。
5. ⚠️ 检查点 2「`npm test` 72/72（TS 54 + C# 18）」的**数量未验证**（未跑测试；套件内 `check()` 计数会随 `program.ts:404` 的 `${checks}` 变化，但与 54/18 的对应关系无法在此核实）。
6. ⚠️ **缺「已配置用户是否真的拿到 v2.6」的验证** —— 正对二-8/二-9：真机检查点 6 只描述「设置页出现 v2.6」，未区分「全新/未配置」与「已配置老用户」，无法证明 deadline 前老用户可用。
7. ⚠️ **缺套餐切 openai-chat 的后端到端验证**（鉴权头、`/v1` 端点、apiKey 兼容）—— 检查点 6 未覆盖该协议的独立发信。

---

## 五、风险完整性（§七）

1. ✅ 已列 5 条：defaultModel 非写回 / 思考下温度 / ultraspeed 限流 / 套餐集群 / 思考默认态 —— 条目本身在。
2. ⚠️ 缺 **`supportsVision` 判定依据**：计划对三款（含能力列为空的 `mimo-v2.6-pro-ultraspeed`）一律置 `true`，正是需求 §五-1/§五-5 未决之处，却未登记为风险。
3. ⚠️ 缺 **协议切换的鉴权头差异**：Anthropic 走 `x-api-key`、OpenAI 兼容走 `Authorization: Bearer`（`type` 决定运行时协议），切协议对已配置用户可能因子经不同头而失败，未提及。
4. ⚠️ 缺 **`typeOverridden` 用户行为**：`upgradeProviderFromPreset` 的语义是「用户手改过协议则保留」；但活路径（`reconcileProviders`）根本不刷 `type`，故「手动切到 anthropic 的用户 vs 未 overridden 用户」在本次切换下的行为差异未被评估。
5. ⚠️ 缺 **TTS 是否为下线边界**：官方横幅只点名 `MiMo-V2.5-Pro` / `MiMo-V2.5`（需求 §一 引文），计划据「不在名单」保留 `mimo-v2.5-tts*`，判断方向正确，但 `mimo-v2.5-tts*` 同属 `v2.5` 族，建议把这条边界登记为待核。
6. ⚠️ 缺 **「已配置记录模型清单不刷新」** 这条（与二-10 同根），而这恰是本需求「10-21 前让用户切 v2.6」能否达成的关键。

---

## 统计与判定

`❌ 2 / ⚠️ 18 / ✅ 17`

**总判定：BLOCK**（❌ > 0）

阻塞项：**计划 §一-6 / §3.2 / §七-1 依赖「version bump ⇒ 已配置用户记录重投影」这一与代码不符的前提**（`upgradeProviderFromPreset` 为死代码，活路径 `reconcileProviders` 仅刷新 `homepage`）。该前提直接决定「10-21 死线前老用户能否拿到 v2.6」，必须重写机制或显式声明本次只覆盖未配置/新装用户，并补相应验证。