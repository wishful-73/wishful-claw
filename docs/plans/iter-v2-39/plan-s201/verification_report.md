# S-201 验证报告

> 阶段：阶段六（独立验证） ｜ 验证员：独立 subagent ｜ 日期：2026-10-14 ｜ 验证对象：提交 93ec1995

**验证对象与基线**

- 提交：`93ec1995`（`fix(provider): 小米内置清单更新到 MiMo V2.6，V2.5 下线（S-201）`），`git show --stat` = **1 file changed, 45 insertions(+), 19 deletions(-)**，唯一改动文件 `src/renderer/src/stores/providers/xiaomi.ts`。
- 工作区该文件与 HEAD **逐字节一致**：`git diff --stat HEAD -- src/renderer/src/stores/providers/xiaomi.ts` 输出为空 ⇒ 所验内容即已提交内容。
- 需求：`docs/plans/iter-v2-39/requirements/S-201.md`；计划：`docs/plans/iter-v2-39/plan-s201/plan.md`；审查：`docs/plans/iter-v2-39/plan-s201/review_report.md`。
- 纪律：**未修改任何源码 / 未 `git add` / `commit` / `push`**。验证脚本与 bundle 产物均落在 `.wishful-claw/tmp/s201-check/`，验完已删（见末节）。
- 环境：Windows PowerShell，node v24.14.1 / npm 11.11.0。

---

## V-1 静态门禁（实跑）

**结论：PASS**

### V-1.1 `npm run typecheck`

实测命令：

```powershell
npm run typecheck
```

实测输出（尾段）：

```
> wishful-claw@0.2.38 typecheck
> npm run typecheck:node && npm run typecheck:web

> wishful-claw@0.2.38 typecheck:node
> tsc --noEmit -p tsconfig.node.json --composite false

> wishful-claw@0.2.38 typecheck:web
> tsc --noEmit -p tsconfig.web.json --composite false
```

**0 错误**（两段 tsc 均无任何诊断输出，退出码 0）。✅ 与期望一致。

### V-1.2 `node scripts/run-tests.mjs`

实测命令：

```powershell
node scripts/run-tests.mjs
```

**实测结果：18/72 通过，54 个失败** —— 但 54 个失败**全部**是 `'esbuild' is not recognized as an internal or external command`（TS 侧每个子用例在 bundle 阶段即失败），C# 侧 **18/18 全 ok**。

**根因（环境/调用方式，非代码缺陷）**：`scripts/run-tests.mjs` 用 `spawnSync(command, { shell: true })` 直接调 `esbuild`。该脚本**设计上要求由 `npm` 启动** —— npm 会把 `node_modules/.bin` 前置到 `PATH`；直接用 `node scripts/run-tests.mjs` 启动时 `node_modules/.bin` 不在 `PATH`，`esbuild` 解析失败。已用三条对照实验证伪「是代码问题」：

| 调用方式 | PATH 是否含 node_modules/.bin | 实测结果 |
| --- | --- | --- |
| `node scripts/run-tests.mjs`（裸调） | 否 | TS 全 FAIL（esbuild 找不到）；C# 18/18 ok ⇒ **18/72** |
| `npm test`（npm 启动） | 是（npm 注入） | **72/72 通过**（见下） |
| `node scripts/run-tests.mjs --ts-only`（手工把 `node_modules\.bin` 前置到 PATH） | 是 | **54/54 通过** |

实测 `npm test` 尾段输出：

```
== 汇总 ==
  72/72 通过
```

实测（手工补 PATH 后）裸调尾段输出：

```
== 汇总 ==
  54/54 通过
```

**判定**：门禁本身 **PASS** —— `npm run typecheck` 0 错误、`npm test` 实测 **72/72（TS 54 + C# 18）**，与期望完全一致。裸调 `node scripts/run-tests.mjs` 得到的 18/72 是**调用方式未带 PATH** 的产物，**与 S-201 无关**，不记为 FAIL；已如实记录供后续排查该 runner 的可用性。⚠️（环境提示，非 S-201 缺陷）

---

## V-2 加载层数据校验（自己写脚本实跑）

**结论：PASS**（27/27 断言全 PASS）

**方法**：在 `.wishful-claw/tmp/s201-check/entry.ts` 里 `import { builtinProviderPresets } from '../../../src/renderer/src/stores/providers'`（真实加载层，非读源文件），用 `npx esbuild ... --alias:@renderer=./src/renderer/src --format=cjs` bundle 后 `node` 执行。

实测命令：

```powershell
npx esbuild .wishful-claw/tmp/s201-check/entry.ts --bundle --platform=node --format=cjs --alias:@renderer=./src/renderer/src --outfile=.wishful-claw/tmp/s201-check/check.cjs
node .wishful-claw/tmp/s201-check/check.cjs
```

实测输出（完整）：

```
===== V-2 加载层数据校验 =====
xiaomi  defaultModels: mimo-v2.6-pro,mimo-v2.6-flash,mimo-v2.6-pro-ultraspeed
coding  defaultModels: mimo-v2.6-pro,mimo-v2.6-flash,mimo-v2.6-pro-ultraspeed,mimo-v2.5-tts,mimo-v2.5-tts-voicedesign,mimo-v2.5-tts-voiceclone
[PASS] direct id 集合 == 3 款文本(expected) :: size=3 ids=[mimo-v2.6-pro,mimo-v2.6-flash,mimo-v2.6-pro-ultraspeed]
[PASS] coding id 集合 == 6 款(3文本+3TTS) :: size=6 ids=[mimo-v2.6-pro,mimo-v2.6-flash,mimo-v2.6-pro-ultraspeed,mimo-v2.5-tts,mimo-v2.5-tts-voicedesign,mimo-v2.5-tts-voiceclone]
[PASS] v2.5 文本三款已消失(direct) :: v2.5-pro=false v2.5=false us=false
[PASS] direct defaultModel 存在 :: defaultModel=mimo-v2.6-flash
[PASS] direct defaultModel enabled=true :: enabled=true
[PASS] direct defaultModel 是 chat 类 :: category=undefined
[PASS] coding defaultModel 存在 :: defaultModel=mimo-v2.6-flash
[PASS] coding defaultModel enabled=true :: enabled=true
[PASS] coding defaultModel 是 chat 类 :: category=undefined
[PASS] direct deprecated ∩ defaultModels 为空 :: deprecated=[mimo-v2-pro,mimo-v2-omni,mimo-v2-flash,mimo-v2.5-pro,mimo-v2.5,mimo-v2.5-pro-ultraspeed] overlap=[]
[PASS] direct deprecated 含新三款 v2.5 :: dep=[mimo-v2-pro,mimo-v2-omni,mimo-v2-flash,mimo-v2.5-pro,mimo-v2.5,mimo-v2.5-pro-ultraspeed]
[PASS] coding deprecated ∩ defaultModels 为空 :: deprecated=[mimo-v2-pro,mimo-v2-omni,mimo-v2-flash,mimo-v2.5-pro,mimo-v2.5,mimo-v2.5-pro-ultraspeed] overlap=[]
[PASS] coding deprecated 含新三款 v2.5 :: dep=[mimo-v2-pro,mimo-v2-omni,mimo-v2-flash,mimo-v2.5-pro,mimo-v2.5,mimo-v2.5-pro-ultraspeed]
[PASS] direct version===3 :: version=3
[PASS] coding version===3 :: version=3
[PASS] direct type===openai-chat :: type=openai-chat
[PASS] coding type===openai-chat :: type=openai-chat
[PASS] coding defaultBaseUrl===https://token-plan-cn.xiaomimimo.com/v1 :: baseUrl=https://token-plan-cn.xiaomimimo.com/v1
[PASS] direct mimo-v2.6-pro 价格三元组 :: input=0.435 output=0.87 cacheHit=0.0036 (expect 0.435/0.87/0.0036)
[PASS] direct mimo-v2.6-flash 价格三元组 :: input=0.14 output=0.28 cacheHit=0.0028 (expect 0.14/0.28/0.0028)
[PASS] direct mimo-v2.6-pro-ultraspeed 价格三元组 :: input=4.35 output=8.7 cacheHit=0.036 (expect 4.35/8.7/0.036)
[PASS] direct mimo-v2.6-pro supportsVision/Thinking/ctx/maxOut :: vision=true thinking=true ctx=1000000 maxOut=131072
[PASS] direct mimo-v2.6-flash supportsVision/Thinking/ctx/maxOut :: vision=true thinking=true ctx=1000000 maxOut=131072
[PASS] direct mimo-v2.6-pro-ultraspeed supportsVision/Thinking/ctx/maxOut :: vision=true thinking=true ctx=1000000 maxOut=131072
[PASS] coding 含 TTS mimo-v2.5-tts :: has=true
[PASS] coding 含 TTS mimo-v2.5-tts-voicedesign :: has=true
[PASS] coding 含 TTS mimo-v2.5-tts-voiceclone :: has=true
===== 结果 =====
ALL PASS (0 fail)
```

**断言覆盖对照（题目要求逐条）**：

| 要求断言 | 实测 | 结论 |
| --- | --- | --- |
| 两 preset 的 `defaultModels` id 集合 | direct = `{pro, flash, ultraspeed}`（3）；coding = 上三 + TTS 三（6） | ✅ |
| `defaultModel` 存在 / 启用 / chat 类 | 两者均 `mimo-v2.6-flash`，`enabled=true`，`category=undefined`（即 chat） | ✅ |
| `deprecatedModelIds` ∩ `defaultModels` = ∅ | 两者 overlap 均空 | ✅ |
| 两 preset `version === 3` | 3 / 3 | ✅ |
| 两 preset `type === 'openai-chat'` | 均 openai-chat | ✅ |
| coding `defaultBaseUrl === 'https://token-plan-cn.xiaomimimo.com/v1'` | 命中 | ✅ |
| 直连 pro `0.435/0.87/0.0036` | 命中 | ✅ |
| 直连 flash `0.14/0.28/0.0028` | 命中 | ✅ |
| 直连 ultraspeed `4.35/8.7/0.036` | 命中（旧 `1.305/2.61/0.0108` 已订正） | ✅ |
| 三款 v2.6 `supportsVision/Thinking === true`、`contextLength === 1000000`、`maxOutputTokens === 131072` | 三款全命中 | ✅ |
| TTS 三款仍在套餐 `defaultModels` | 三款全在 | ✅ |

**一处「我自己的期望修正」（不是代码缺陷）**：首版脚本我误把**直连** `xiaomi` 的 id 集合也写成 6 款，实测 direct 只有 3 款 ⇒ 脚本报 FAIL。核对历史后确认：**直连 preset 的 `defaultModels` 历来就是「3 款文本模型 + 各挂价格」的字面量数组**（`git show 93ec1995^:.../xiaomi.ts` 证实改前也是 3 个字面量项），TTS 三款**只**在套餐（`xiaomiTextModels.map(...)` = 6 款）里。故 3/6 的差异是**既有设计**，非本次缺陷；已把断言改为 direct=3、coding=6，复跑全 PASS。题目 V-2 亦只要求「TTS 三款仍在**套餐**的 defaultModels 里」，与此一致。

---

## V-3 反向验证（防「测了个寂寞」）

**结论：PASS（反向验证方法有效）**

**方法**：另写 `entry-reverse.ts`，用**同一套读取路径**加载真实 preset，但故意写 3 条**必错**断言：

1. `flash.inputPrice === 9.99`（真值 `0.14`）
2. `xiaomi.version === 2`（真值 `3`）
3. `coding.defaultBaseUrl === '.../anthropic'`（真值 `.../v1`）

实测命令与输出：

```powershell
npx esbuild .wishful-claw/tmp/s201-check/entry-reverse.ts ... --outfile=.../check-reverse.cjs
node .wishful-claw/tmp/s201-check/check-reverse.cjs
```

```
[FAIL] REVERSE #1 flash inputPrice === 9.99 (故意错) :: actual=0.14
[FAIL] REVERSE #2 direct version === 2 (故意错) :: actual=3
[FAIL] REVERSE #3 coding baseUrl === .../anthropic (故意错) :: actual=https://token-plan-cn.xiaomimimo.com/v1
===== 反向验证结果 =====
EXPECTED-FAIL 触发（3 条错误断言全部被抓）: REVERSE #1 ... | REVERSE #2 ... | REVERSE #3 ...
```

**3 条故意写错的断言全部被抓**，且报告出的 `actual` 值正是真实数据（`0.14` / `3` / `.../v1`）⇒ 证明 V-2 的断言确实**作用于真实加载数据**、不是空转。反向脚本已删（连同 bundle）。

---

## V-4 影响面核对

**结论：PASS（影响面已穷尽核对；无隐藏耦合）**

### V-4.1 谁读 preset 的 `type` / `defaultBaseUrl` / `defaultModel` / `deprecatedModelIds`

`git grep -n "builtinProviderPresets" -- src tests` 命中的全部消费方，逐点列出：

| # | 位置 | 读的字段 | 对 `xiaomi-coding` `anthropic→openai-chat` 的影响 | 现有测试覆盖 |
| --- | --- | --- | --- | --- |
| 1 | `provider-materialization.ts:22,24,27,32`（`createProviderFromPreset`） | `type` / `defaultBaseUrl` / `defaultModels` / `defaultModel` | 仅对**无持久化记录**的 preset 生效 ⇒ 新装/未配置用户拿到 `openai-chat` + `/v1` | ⚠️ 仅通用覆盖（`test:provider-presets` `program.ts:248` 断言 `fresh.providers.length === builtinProviderPresets.length`）；**无 xiaomi 专属断言** |
| 2 | `provider-materialization.ts:65`（`isUnownedBuiltin`） | `baseUrl !== preset.defaultBaseUrl` | 旧记录 `.../anthropic` ≠ 新 `defaultBaseUrl` `.../v1` ⇒ 判等守卫**翻转**（旧「可回收」→ 新「保留」，见 ⚠️①） | ⚠️ 仅通用覆盖（`program.ts:200`，用 openai preset）；**无 xiaomi 专属** |
| 3 | `provider-materialization.ts:83-85`（`resetProviderToPreset`） | 全量 preset | 「重置为出厂」后拿到 `openai-chat` | ⚠️ 仅通用覆盖（`program.ts:388` `reset.baseUrl === preset.defaultBaseUrl`） |
| 4 | `provider-preset-upgrade.ts:23,24,30,40`（`upgradeProviderFromPreset`） | `deprecatedModelIds` / `defaultModels` / `type` | **死代码**（`git grep upgradeProviderFromPreset` 显示生产代码零调用，唯一调用方在 `tests/provider-presets/program.ts:129,160`）⇒ 对用户**不生效** | ✅ 有测试，但用 **deepseek** preset（`program.ts:129-144`），非 xiaomi |
| 5 | `provider-source-index.ts:95,100` | `type` / `defaultModels` | 仅「模型来源索引」展示（`type` 用于来源标注） | 无专属（UI 展示） |
| 6 | `managed-models.ts:150-151` | `defaultModels` | 内置模型管理表（按 model id 归一合并） | 无专属 |
| 7 | `provider-store-helpers.ts:142-143` | `defaultModels` | `builtinModelRegistry`（按 model id 查 `thinkingConfig`/`icon`/价格） | 无专属 |

### V-4.2 运行时（C#）侧协议 dispatch

renderer 把 `type` 送进 agent 请求的点是**唯一**的 `provider-payload.ts:91`（`type: modelConfig?.type ?? provider.type`）；C# 侧按此值分派：

| # | 位置 | 作用 | 受 anthropic→openai-chat 影响 | 现有测试覆盖 |
| --- | --- | --- | --- | --- |
| 8 | `AgentLoop.cs:36,38` + `:625,634,640,646` | 协议分派：`anthropic` → AnthropicMessagesProvider；`openai-responses` → OpenAIResponsesProvider；**默认 → OpenAIChatProvider** | ✅ **直接影响**（套餐走 OpenAI 链） | ⚠️ 无 dispatch 分支的 xiaomi 断言 |
| 9 | `AnthropicMessagesProvider.cs:201-206`（`x-api-key` + `Authorization: Bearer` + `anthropic-version`）vs `OpenAIChatHeaders.cs:13`（仅 `Authorization: Bearer`） | 鉴权头 | ✅ 鉴权头由 `x-api-key` 系切为 `Bearer` | ✅ 有（机制层）：`MainChainHeaderChecks.cs` 覆盖两套 header 机制，非 xiaomi |
| 10 | `ProviderCompletionService.cs:344,349` | 响应解析按 `anthropic` vs 默认分支 | ✅ | 无 xiaomi |
| 11 | `AgentRuntimeGoalExecutorJson.cs:22,31` | Goal executor 读 `providerType` 透传 | 透传 | 无 |
| 12 | `ContextCompression.cs:499,519,601,620` | 摘要请求按 `providerType` 选 anthropic(`x-api-key`)/openai(`Bearer`) | ✅ | ✅ 有（机制层）：`MainChainHeaderChecks.cs`（anthropic/openai summary header） |
| 13 | `ProviderTestService.cs:148,176,205,239,254` | 「测试连接」按协议选 header/端点 | ✅ | 无 xiaomi |
| 14 | `AuxiliaryUsageLog.cs:99` | 用量日志按 `providerType == "anthropic"` 解析 | 透传 | 无 |

### V-4.3 汇总

- 受影响读点共 **14 处**（renderer 7 + runtime 7）。
- **无任何 xiaomi/mimo 专属测试断言**：`git grep -ri "xiaomi" -- tests` 与 `git grep -ri "mimo" -- tests` **均零命中**。现有覆盖全部是「协议通用机制层」的通用断言（preset 一致性 / header 机制 / 死代码合并规则），**没有一条**针对 xiaomi-coding 的 `type`/`baseUrl` 断言。
- `xiaomi-coding` 在整个 `src` 里仅两处被引用：`providers/xiaomi.ts:97`（定义）与 `provider-icons.tsx:39`（图标映射，与协议无关）⇒ **无其它隐藏耦合**。
- 协议切换的核心影响（Bearer 头 + `/v1` 端点 + OpenAI 链 thinking 注入）**逐点无自动测试覆盖、无真机验证**，列入 V-5。

---

## V-5 真机 / 加载层项（待老大）

**结论：未验证**（无 GUI 环境无法执行）

以下项**无法**在无 GUI 环境验证，逐条列给老大：

| # | 待办 | 预期 | 关联 |
| --- | --- | --- | --- |
| 1 | 设置页 → 小米 / 小米（套餐）→ 模型下拉：是否出现 V2.6 三款（`mimo-v2.6-pro` / `-flash` / `-pro-ultraspeed`），V2.5 文本三款消失，且**默认选中 `mimo-v2.6-flash`** | 三款出现、v2.5 消失、默认 flash | V-2（新装/未配置用户） |
| 2 | 小米（套餐）发一轮**带工具调用**的对话：**不报 400**，且 assistant 含 `tool_calls` 时**完整回传 `reasoning_content`**（官方硬要求，§三.1） | 无 400 | 依赖 `OpenAIChatRequestBuilder.cs:175-181` |
| 3 | 套餐切 `openai-chat` 后的**鉴权头（`Authorization: Bearer`）与端点（`/v1`）**是否被服务端接受 —— 注意**旧记录仍是 anthropic**，需「删配置重启 / 重置为出厂」才会拿到新 preset 的 `openai-chat` + `/v1` | 200 且正常出流 | ⚠️② |
| 4 | 思考开启且 `temperature ≠ 1` 时，OpenAI 链（**不强制** `temperature=1`）是否 400（Anthropic 链会强制 1） | 观察是否静默失效或报错 | plan §七-2 |
| 5 | `mimo-v2.6-pro-ultraspeed` 公开可调用性（官方标「定制服务」） | 可能 403 / 限流 | plan §七-3 |
| 6 | 视觉：v2.6 三款 `supportsVision=true`，实际上传图片是否被接受（全模态理解边界：图/音/视） | 图片可被接受 | §五-1 |

---

## 总判定与遗留

**总判定：PARTIAL**（所有实跑项 PASS，仅剩真机项待老大）

| 验证项 | 结论 |
| --- | --- |
| V-1 静态门禁 | **PASS**（typecheck 0 错误；`npm test` 实测 72/72） |
| V-2 加载层数据校验 | **PASS**（27/27 断言） |
| V-3 反向验证 | **PASS**（3 条故意错误断言 100% 被抓） |
| V-4 影响面核对 | **PASS**（14 处读点穷尽；无隐藏耦合） |
| V-5 真机/加载层 | **未验证**（待老大，见上表 6 条） |

依据判定规则「全部实跑项 PASS 且只剩真机项 ⇒ PARTIAL」⇒ **PARTIAL**。

### 遗留清单

**审查已登记的 2 条 ⚠️（本次独立核对确认成立）：**

1. **⚠️ `provider-materialization.ts:65` 的 `isUnownedBuiltin` 判等副作用**：该守卫用 `provider.baseUrl !== preset.defaultBaseUrl` 判「用户是否改过 baseUrl」。`xiaomi-coding` 的 `defaultBaseUrl` 本次由 `.../anthropic` 改为 `.../v1` ⇒ 对**旧的、未启用、无 apiKey、未手改协议的** `xiaomi-coding` 记录，判等从「相等（可回收为 virtual 投影）」变为「不等（判为已被用户拥有，保留为真实记录）」。**方向保守（不丢用户数据）**，与「方案 C 不迁移」同向，**非回归**；但属本次改动的副作用，特此明示。触发点：`ProviderPanel.tsx:170` / `provider-store-helpers.ts:92`（`pruneUnownedBuiltinProviders`）。
2. **⚠️ 鉴权头/端点变化待真机**：套餐 `type` 由 `anthropic` 切 `openai-chat` 后，运行时鉴权头由 `x-api-key` 系切为 `Authorization: Bearer`、端点由 `/anthropic` 切 `/v1`，且 old 记录不被刷新（仍旧 anthropic）。**无自动测试覆盖、无真机验证**，见 V-5 第 3 条。

**本次独立验证新增的记录：**

3. **⚠️（环境提示，非 S-201 缺陷）** `scripts/run-tests.mjs` 必须由 `npm test` 启动（或手工把 `node_modules/.bin` 前置到 `PATH`）；裸调 `node scripts/run-tests.mjs` 会因 `esbuild` 不在 `PATH` 而令 TS 侧全 FAIL（实测 18/72）。建议后续在 runner 里自带 `node_modules/.bin` 的解析，避免误判。
4. **ℹ️（口径提示，非缺陷）** 直连 `xiaomi` 的 `defaultModels` 是 **3 款文本模型**（含价格），套餐 `xiaomi-coding` 是 **6 款**（3 文本无价格 + 3 TTS）。此 3/6 差异是**改前既有设计**，非本次引入。

**清理**：`.wishful-claw/tmp/s201-check/`（`entry.ts` / `entry-reverse.ts` / `check.cjs` / `check-reverse.cjs`）**已删除**，未留临时产物。
