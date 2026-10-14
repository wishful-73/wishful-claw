# S-201 代码审查报告

> 阶段：阶段五（独立审查） ｜ 审查员：独立 subagent ｜ 日期：2026-10-14 ｜ 审查范围：src/renderer/src/stores/providers/xiaomi.ts

**审查基线**

- 被审改动：`src/renderer/src/stores/providers/xiaomi.ts`（工作区未提交；`git diff --numstat` = `45 19`，即 **1 文件 +45 / -19**）。
- 需求：`docs/plans/iter-v2-39/requirements/S-201.md`；计划：`docs/plans/iter-v2-39/plan-s201/plan.md`（含 **§九 阶段三 BLOCK 与裁决记录**）；合规检查：`docs/plans/iter-v2-39/plan-s201/compliance_report.md`。
- 核验方式：纯只读。源码一律 `[IO.File]::ReadAllText($p,[Text.Encoding]::UTF8)` 读取，检索用 `git grep`；**未修改任何源码，未跑构建/测试套件**（门禁由主会话承担）。

---

## 一、数据准确性 ✅

逐项对照「官方事实（题目给定）」与需求正文，diff 中每条数据核验如下（行号为改动后 `xiaomi.ts` 的新行号）：

| 数据项 | diff 值 | 位置（证据：文件:行） | 判定 |
| --- | --- | --- | --- |
| 文本模型 id ×3 | `mimo-v2.6-pro` / `mimo-v2.6-flash` / `mimo-v2.6-pro-ultraspeed` | `xiaomi.ts:35` `id: 'mimo-v2.6-pro',` / `:47` `id: 'mimo-v2.6-flash',` / `:59` `id: 'mimo-v2.6-pro-ultraspeed',` | ✅ 与官方三款一致 |
| 文本模型 name ×3 | `MiMo V2.6 Pro` / `MiMo V2.6 Flash` / `MiMo V2.6 Pro UltraSpeed` | `xiaomi.ts:36` `name: 'MiMo V2.6 Pro',` / `:48` / `:60` | ✅ 沿用旧命名风格，与 id 对应 |
| contextLength ×3 | `1_000_000`（1M） | `xiaomi.ts:39` `contextLength: 1_000_000,` / `:51` / `:63` | ✅ 官方 1M |
| maxOutputTokens ×3 | `131_072`（128K = 128×1024） | `xiaomi.ts:40` `maxOutputTokens: 131_072,` / `:52` / `:64` | ✅ 官方 128K |
| supportsVision ×3 | `true` | `xiaomi.ts:41` `supportsVision: true,` / `:53` / `:65` | ✅ 官方「全模态理解」覆盖三款 |
| supportsFunctionCall ×3 | `true` | `xiaomi.ts:42` `supportsFunctionCall: true,` / `:54` / `:66` | ✅ 官方含函数调用 |
| supportsThinking ×3 | `true` | `xiaomi.ts:43` `supportsThinking: true,` / `:55` / `:67` | ✅ 官方含深度思考 |
| thinkingConfig ×3 | `xiaomiThinkingConfig`（未改） | `xiaomi.ts:44` `thinkingConfig: xiaomiThinkingConfig` / `:56` / `:68` | ✅ 与需求 §三.1「一字不差、不改」一致 |
| 价格 pro | input `0.435` / output `0.87` / cacheHit `0.0036` | `xiaomi.ts:140` `inputPrice: 0.435,` / `:141` `outputPrice: 0.87,` / `:142` `cacheHitPrice: 0.0036` | ✅ 与官方 USD 表一致 |
| 价格 flash | input `0.14` / output `0.28` / cacheHit `0.0028` | `xiaomi.ts:146` `inputPrice: 0.14,` / `:147` `outputPrice: 0.28,` / `:148` `cacheHitPrice: 0.0028` | ✅ 与官方 USD 表一致 |
| 价格 ultraspeed | input `4.35` / output `8.7` / cacheHit `0.036` | `xiaomi.ts:152` `inputPrice: 4.35,` / `:153` `outputPrice: 8.7,` / `:154` `cacheHitPrice: 0.036` | ✅ 订正旧 stale 价（`1.305/2.61/0.0108`），与官方一致 |
| version（套餐 / 直连） | `3` / `3` | `xiaomi.ts:98` `version: 3,` / `:122` `version: 3,` | ✅ 2→3，两处 |
| defaultModel（套餐 / 直连） | `mimo-v2.6-flash` / `mimo-v2.6-flash` | `xiaomi.ts:108` `defaultModel: 'mimo-v2.6-flash',` / `:128` 同 | ✅ 与 §九 老大 10:27 裁决（flash）一致（见下方 ⚠️ 备注） |
| deprecatedModelIds（套餐 / 直连） | 6 条：`mimo-v2-pro`/`mimo-v2-omni`/`mimo-v2-flash` + `mimo-v2.5-pro`/`mimo-v2.5`/`mimo-v2.5-pro-ultraspeed` | `xiaomi.ts:109-115` 与 `:129-135` | ✅ 旧三条保留、新三条追加 |
| type（套餐） | `'openai-chat'`（原 `anthropic`） | `xiaomi.ts:103` `type: 'openai-chat',` | ✅ 与 §九 老大 10:17 裁决一致 |
| defaultBaseUrl（套餐） | `https://token-plan-cn.xiaomimimo.com/v1`（原 `/anthropic`） | `xiaomi.ts:104` `defaultBaseUrl: 'https://token-plan-cn.xiaomimimo.com/v1',` | ✅ 与官方 OpenAI 兼容端点一致 |
| defaultBaseUrl（直连） | `https://api.xiaomimimo.com/v1`（未改） | `xiaomi.ts:125` | ✅ 未动 |
| TTS 三款 | `mimo-v2.5-tts` / `-voicedesign` / `-voiceclone`（未改） | `xiaomi.ts:71` / `:79` / `:87` | ✅ 与需求 §六「不在下线名单」一致 |

**⚠️ 备注（不构成数据错误）**：`defaultModel = mimo-v2.6-flash` 与需求正文 §四-3 登记的「⇒ `mimo-v2.6-pro`（待老大点头）」**字面不符**，但计划 §九 有明确裁决记录（老大 2026-10-14 10:27「defaultModel 默认是 flash 系列的，主要是便宜点」），且 §九 声明需求正文将在**收尾刀**订正。故判定数据本身正确，差异归入第七节「正文同步」。

**一句话**：diff 内每一条数据（id / name / contextLength / maxOutputTokens / supportsVision / 价格三元组 / version / defaultModel / deprecatedModelIds / type / defaultBaseUrl）均可与官方事实及需求正文对上，**无错值**。

---

## 二、红线遵守 ✅（计划 §二 七条逐条核）

| # | 红线（计划 §二） | 证据 | 判定 |
| --- | --- | --- | --- |
| 1 | `xiaomiThinkingConfig`（`:11-14`）内容不动 | `xiaomi.ts:11-14` 仍为 `bodyParams: { thinking: { type: 'enabled' } }` / `disabledBodyParams: { thinking: { type: 'disabled' } }`；diff 首个 hunk 从 `@@ -21,22 +21,31 @@` 起，**未覆盖 11-14 行** | ✅ |
| 2 | TTS 三款不动 | `xiaomi.ts:70-93` 三款 TTS 全字段原样；diff 无 TTS 相关行 | ✅ |
| 3 | `tests/provider-presets/program.ts` 不改 | `git diff --name-only` 不含该文件；`git grep -ni "xiaomi\|mimo" -- tests` **零命中** | ✅ |
| 4 | C# 运行时 / DB / i18n / 官网零改动 | 本刀 diff **仅** `xiaomi.ts` 一个文件（见第三节） | ✅ |
| 5 | `opencode-go.ts` 不动 | diff 不含 `src/renderer/src/stores/providers/opencode-go.ts` | ✅ |
| 6 | `upgradeProviderFromPreset` 合并规则不改 | diff 不含 `src/renderer/src/stores/provider-preset-upgrade.ts` | ✅ |
| 7 | 不 `git add`/`commit`/`push` | `git diff --cached --name-only` 为空（无暂存）；HEAD 仍 `bae36640`，工作区未提交 | ✅ |

**一句话**：七条红线条条守住。

---

## 三、范围 ✅

**证据 1（本刀只此一文件）**：`git diff --stat -- src/renderer/src/stores/providers/xiaomi.ts` ⇒ `1 file changed, 45 insertions(+), 19 deletions(-)`；`git diff --numstat` 首列同为该文件 `45 19`。

**证据 2（改动内容仅限计划承诺项）**：diff 全部 hunk 覆盖：头部 v3 注释追加、`xiaomiTextModels` 三款文本模型换 V2.6、两个 preset 的 `version`/`defaultModel`/`deprecatedModelIds`、套餐 `type`/`defaultBaseUrl`、直连三条价格。**无任何与 S-201 无关的改动**（无格式化、无 import、无别的 preset）。

**证据 3（我能识别出 11 个无关遗留文件，它们不应进本刀提交）**：`git diff --name-only` 除 `xiaomi.ts` 外，另有 **11 个**被修改但与本需求**无关**的遗留文件，逐条列出如下——

1. `docs/plans/iter-v2-37/requirements/S-169.md`
2. `docs/plans/iter-v2-39/plan-s186/plan.md`
3. `docs/plans/iter-v2-39/requirements/S-182.md`
4. `docs/plans/iter-v2-39/requirements/S-186.md`
5. `docs/release-workflow.md`
6. `scripts/site-stats.mjs`
7. `src/renderer/src/stores/chat-store/session-slice.ts`
8. `src/runtime/WishfulClaw.Infrastructure/Db/DbMessageCompactTools.cs`
9. `src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionTools.cs`
10. `tests/WishfulClaw.SessionTaskCascadeRegressionTests/CreateSessionInsertTests.cs`
11. `website/src/lib/site-stats.ts`

外加大量 **untracked 文档**（`docs/plans/iter-v2-39/plan-s18x/`、`requirements/S-18x.md`、`plan.md`、`raw-requirements.md` 等）。

⇒ **识别确认**：上述 11 个已跟踪修改文件（含 C# / DB / 官网 / 测试 / 无关文档）**均非本刀内容**，不得随 S-201 一起提交；本刀提交面**必须**且**只应**含 `src/renderer/src/stores/providers/xiaomi.ts`（迭代文档按计划攒在收尾刀，另计）。未发现任何与 S-201 沾边的额外文件。

**一句话**：改动画布干净，唯一边界外风险是「收口时误把 11 个遗留文件一并提交」——属提交操作注意项，非本 diff 缺陷。

---

## 四、内部一致性 ✅

1. **下标引用未错位** ✅
   - 证据：`xiaomi.ts:139` `...xiaomiTextModels[0],` / `:145` `...[1],` / `:151` `...[2],`；数组顺序为 `[0]=mimo-v2.6-pro`（`:35`）、`[1]=mimo-v2.6-flash`（`:47`）、`[2]=mimo-v2.6-pro-ultraspeed`（`:59`）。
   - 价格与下标模型一一对应：`[0]`→pro 价 `0.435/0.87/0.0036`（`:140-142`）、`[1]`→flash 价 `0.14/0.28/0.0028`（`:146-148`）、`[2]`→ultraspeed 价 `4.35/8.7/0.036`（`:152-154`）。**下标语义（pro / flash / ultraspeed）与改前一致，未错位。**

2. **套餐 preset 的 `map` 副本不漏字段** ✅
   - 证据：`xiaomi.ts:117` `defaultModels: xiaomiTextModels.map((model) => ({ ...model }))`——浅拷贝展开全部字段，与改前写法同款；套餐侧**依原设计不挂价格**（改前即无价格字段），故「无价格」是既有语义、非本次漏字段。

3. **`deprecatedModelIds` 与 `defaultModels` 无交集** ✅（测试套件全局断言 `tests/provider-presets/program.ts:92-98` 会卡这一条）
   - 证据：diff 后两 preset 的 `defaultModels` 活 id = `{mimo-v2.6-pro, mimo-v2.6-flash, mimo-v2.6-pro-ultraspeed, mimo-v2.5-tts, mimo-v2.5-tts-voicedesign, mimo-v2.5-tts-voiceclone}`；`deprecatedModelIds` = `{mimo-v2-pro, mimo-v2-omni, mimo-v2-flash, mimo-v2.5-pro, mimo-v2.5, mimo-v2.5-pro-ultraspeed}`。断言用精确 `Set.has(id)`（`program.ts:94-96` `const live = new Set(...); check(!live.has(id), ...)`），`mimo-v2.5` ≠ `mimo-v2.5-tts`，**交集为空**。
   - 佐证：`git grep -ni "xiaomi\|mimo" -- tests` 零命中 ⇒ 无 xiaomi 专属断言会因条数/价格变动而红；`npm test` 门禁由主会话报 72/72。

4. **`defaultModel` 落在 enabled 模型集合内** ✅
   - 证据：`xiaomi.ts:108`/`:128` `defaultModel: 'mimo-v2.6-flash'`；对应模型 `xiaomi.ts:47-57` `id: 'mimo-v2.6-flash'` + `:50` `enabled: true`。

**一句话**：数组顺序虽变（同位置替换），但下标引用、价格映射、map 副本、deprecated 交集四项均自洽。

---

## 五、口径一致性——「不做老用户迁移链」 ✅

**结论**：这与我的判定一致，**不是遗漏，是 §九 有记录的老大裁决（方案 C）**，不报缺陷。

**证据 1（裁决记录）**：`plan.md` §九 原文——「**裁决（老大 2026-10-14 10:29 原话）**：『你操心的太多了，我已经说了，用户配置我们不关注，这次只是更新内置清单信息……』⇒ 采**方案 C**：只改内置 preset 数据，**不建立老用户迁移链**」。

**证据 2（技术成因，佐证「迁移链本就不存在」）**：活路径 `reconcileProviders` 对已持久化记录**只**刷 `homepage`——`provider-materialization.ts:140` `providers.push(existing ? { ...existing, homepage: preset.homepage } : createProviderFromPreset(preset))`；`provider-materialization.ts:102` 注释「`upgradeProviderFromPreset` **is dead code**」。即：`version` bump、`deprecatedModelIds` 增补对**已配置老用户**均无实际投影效果（既不清旧模型、也不补新模型）——与「方案 C 不迁移」完全自洽。

**证据 3（新装/未配置用户仍拿到 V2.6）**：`provider-materialization.ts:131-140` 对无持久化记录的 preset 走 `createProviderFromPreset(preset)`（`:16-37`），其 `type`（`:22`）/ `baseUrl`（`:24`）/ `models`（`:27`）直接取当前 preset ⇒ 未配置用户得到 V2.6 清单与套餐 `openai-chat` 协议，**新装路径不受「不迁移」影响**。

**佐证（`defaultModel` 悬空有兜底）**：`provider-store-helpers.ts:249-256` `pickDefaultModel`（defaultModel 命中 → 首个 enabled chat → 首个 enabled → `[0]`）与 `provider-store.ts:92-98` 同级回退，老用户即便 `defaultModel` 指向已失效 id 也不会白屏。

**一句话**：待审改动与 §九 方案 C 口径一致，**如实判为「已裁决、非缺陷」**。

---

## 六、回归风险 ⚠️

结论：**无阻断级回归，但有 2 处需登记的外部影响**（一处属「方案 C」的自然结果、一处属待真机验证项）。

1. **⚠️ `isUnownedBuiltin` 的 `baseUrl` 比较会被本次 `defaultBaseUrl` 变更「顺手」改变行为**
   - 证据：`provider-materialization.ts:65` `if (provider.baseUrl && provider.baseUrl !== preset.defaultBaseUrl) return false`。旧记录 `xiaomi-coding.baseUrl` 恒为 `.../anthropic`，而 preset 现值改为 `.../v1` ⇒ 该守卫从「相等（可回收）」变为「不等（判为已被用户拥有，不回收）」。
   - 影响：老的**未启用、无 apiKey、未手改协议**的 `xiaomi-coding` 记录，以前可能被回收为 virtual 投影、现改为**保留为真实记录**（保守方向，不丢用户数据）。
   - 判定：⚠️ 与「方案 C 不迁移」同向，**非 bug**；但属本次改动的**副作用**，建议在验证报告/收尾刀里明示（预期行为变化，非回归）。

2. **⚠️ 套餐切 `openai-chat` 后，运行时协议与鉴权头随之改变——未真机验证**
   - 证据：运行时按 `providerType` 选协议——`src/runtime/WishfulClaw.Agent/AgentLoop.cs:38` `if (providerType is not ("openai-chat" or "anthropic" or "openai-responses"))`、`:640` `if (providerType == "openai-responses")`、`:646` `// Default: openai-chat`。`type` 决定 Anthropic 链 vs OpenAI 链（鉴权头 `x-api-key` vs `Authorization: Bearer`、端点 `/anthropic` vs `/v1`）。
   - 消费面清点（回应「除 `type`/`baseUrl` 外还有谁在读」）：`git grep` 全仓读 preset 这两字段的**仅** `provider-materialization.ts:22`（`type: preset.type`）、`:24`（`baseUrl: preset.defaultBaseUrl`，用于 `createProviderFromPreset`）、`provider-preset-upgrade.ts:40`（`type: current.typeOverridden ? current.type : preset.type`，**死代码**）、`provider-source-index.ts:95`（`type: preset.type`，仅做模型来源索引展示）。**无第三个「业务语义」消费方**，无隐藏耦合。
   - 副作用范围：只对**新装/未配置**用户生效（老用户 `type` 不被刷新，见第五节）；`agentLoop` 对新用户走 OpenAI 链，需真机确认 `/v1` 端点 + Bearer 头可通、思考 `bodyParams` 真正注入。
   - 判定：⚠️ **未验证（原因：按题目约定不跑真机/不发信；计划 §五-6 与 §九已把它列为真机验证项）**。属计划已登记的待验证点，非 diff 缺陷。

**一句话**：改动不牵动其他 preset；两处外部影响一处同向于既定口径、一处已被计划列为真机验证项，故记 ⚠️ 不记 ❌。

---

## 七、遗漏 ⚠️

**功能面遗漏：无。** 需求 §四 六条逐条落点齐全——

- §四-1 新增 V2.6 三款 ⇒ `xiaomi.ts:34-69` ✅
- §四-2 价格（含订正 ultraspeed）⇒ `xiaomi.ts:139-155` ✅
- §四-3 defaultModel ⇒ `:108`/`:128`（取 flash，依 §九 裁决）✅
- §四-4 deprecatedModelIds 纳入 v2.5 三款 ⇒ `:109-115`/`:129-135` ✅
- §四-5 version 2→3 两处 ⇒ `:98`/`:122` ✅
- §四-6 套餐与直连共用数组 + 思考下发路径确认 ⇒ 共用 `xiaomiTextModels` 不变，且按 §九 10:17 裁决切 `openai-chat` ✅

**⚠️ 正文同步缺口（文档项，非代码缺陷）**：

1. 需求正文 §四-3 仍写「⇒ `mimo-v2.6-pro`（待老大点头）」，实现取 `mimo-v2.6-flash`（依 §九 10:27 裁决）——**正文未随裁决更新**。
2. 需求正文 §六 仍写「**不动渲染层 / 协议 / C# / DB**」，而本次套餐 `type` 由 `anthropic` 切 `openai-chat`（依 §九 10:17 裁决）——**正文与实现存在文本张力**。
   - 计划 §九 已自陈：「需求正文 §六 的『不动协议』措辞留**收尾刀**订正」。故上述两条属**已登记待订正的文档滞后**，不在本刀代码范围内，标 ⚠️ 提示收尾刀勿漏。

**判定**：代码无缺项；仅需求正文两处措辞滞后待收尾刀同步。

---

## 统计与判定

- 审查项结论：一 ✅ ｜ 二 ✅ ｜ 三 ✅ ｜ 四 ✅ ｜ 五 ✅ ｜ 六 ⚠️ ｜ 七 ⚠️
- 计数：**❌ 0 / ⚠️ 2 / ✅ 5**

**总判定：PASS**（❌ = 0）

**放行说明**：被审 diff 只含 `src/renderer/src/stores/providers/xiaomi.ts` 一个文件、只含计划承诺的数据订正；数据准确、红线全守、内部自洽、「不做迁移链」与 §九 老大裁决一致。两处 ⚠️ 分别为①`isUnownedBuiltin` 的 `baseUrl` 判等随 `defaultBaseUrl` 变更的**同向副作用**（非回归）、②套餐切 `openai-chat` 的**运行时鉴权/端点未真机验证**（计划已登记）；均非本 diff 缺陷，无需阻断。

**收口提醒（非阻断）**：本刀提交**只应含** `xiaomi.ts`，**切勿**把第三节列出的 11 个无关已跟踪修改文件一并带入；迭代文档按计划攒在收尾刀。
