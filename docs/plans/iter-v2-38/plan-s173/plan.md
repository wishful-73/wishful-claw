# Plan-S173：图片生成指定模型位（「模型管理」第四档用途位 + 主进程解析接入）

> 归属 iter-v2-38。需求正文见 [`../requirements/S-173.md`](../requirements/S-173.md)。
> 状态：**已完成**（2026-10-08；实施记录见 [`../requirements/S-173.md`](../requirements/S-173.md) §九）。裁定：① 走方案 A，落点 = 现役三档所在的 `ProviderCompletionSettingsPanel`（13:40 / 13:41）；② 接线走**甲（Worker 送达）** —— 指定位由 Worker 读取、随 `image:generate` 反向请求送达，**主进程不读 `config.json`**（16:28）；③ 指定位**悬空即报错、不回落**（16:32）。

---

## 一、目标

在设置页「模型管理」tab 的 `ProviderCompletionSettingsPanel` 加**第四档用途位「图片生成」**（服务商 + 模型双下拉，与现役三档同形）；生图端点解析优先读这个显式指定位，读不到再走 S-166 的三级回落。**不另起 UI，不动 AI 服务商页。**

---

## 二、关键勘测结论（决定做法）

| 事实 | 证据 | 影响 |
|---|---|---|
| 用途位三档的数据落在 **Worker 的 `~/.wishful-claw/config.json`** 的 `providerCompletion` 节点 | `Infrastructure/Storage/ConfigStore.cs:22`（`config.json`）+ `ProviderCompletionSettings.cs:22`（`ConfigKey = "providerCompletion"`） | 第四档沿用同一通道即可，**不改存储位置** |
| 面板读写走 `provider/completion-config-read` / `-write`（Worker 侧注册在 `Modules/ProviderTestModule.cs:16-17`） | 面板 `:42` / `:80` | 渲染端只加一个下拉档，通道不动 |
| **现状（S-166 既有链，不是本需求新增的）**：生图端点的解析发生在**主进程** —— `image-reverse-handler.ts:52-59` 读的是渲染端持久化的 provider store，**看不到 Worker 的 `config.json`** | `main/lib/ai-provider-store.ts:224` + `image-endpoint.ts:72` | ⚠️ 本需求真正的接线点在这里：步骤 3 给主进程解析器加「显式指定位」支持，**不改它现在的位置** |
| **Worker 与主进程读同一份 provider 存储**（同一 `resolveDataDir()`、同一 `ai-provider/index.json + provider-{id}.json` 布局） | `Infrastructure/Storage/ProviderStore.cs:11-17` ↔ `main/lib/ai-provider-store.ts:6-9,224` | ⇒ **甲可行**：Worker 只需传 `providerId` / `modelId`，主进程按 id 查得到同一份 provider，**不必新读 `config.json`** |
| Worker 侧已有现成的「显式指定位 + 存在性校验」范式 | `ProviderCompletionSettings.cs:145-190`（`TryResolveExplicit`）、`:192-216`（`TryResolveStored` 校验 provider / model 存在） | 生图**不复制**这套回落逻辑（避免两处回落链打架），只借「传 id、由出口侧校验」的形状 |
| 模型下拉现役过滤只列 chat | `ProviderCompletionSettingsPanel.tsx:70-74`（`!model.category \|\| model.category === 'chat'`） | 「图片生成」档必须放宽到 `category === 'image'` |
| 「模型管理」tab 的文案是「管理**辅助请求**使用的服务商和模型」 | `zh/settings.json` `tabs.modelManagement.desc` | 第四档不是辅助请求 ⇒ **tab 描述需一并改口径**（否则语义不符） |

**为什么不把指定位改存渲染端**：那样会出现「应用侧一份、Worker 一份」两个真相，而三档已经落在 Worker 侧 —— 同一次保存、同一份文件、同一个通道最省心。

**为什么走甲（Worker 送达）而不是乙（主进程直读 `config.json`）**：配置的「家」在 Worker（三档同处 `config.json`），消费者也是 Worker。由 Worker 读出来、随 `image:generate` 请求送达，**主进程不碰 `config.json`** —— 读取责任单一，也不会出现「主进程与 Worker 各自解析一遍 `config.json`」的时序分歧。代价是显式指定位只在 **Worker 发起的生图链**上生效；眼下这是唯一生图入口，够用。若将来渲染端直接调生图（S-174 画布那类），再议是否补主进程读取。

---

## 三、步骤清单

- [x] **步骤 1：Worker 侧 —— 配置扩容 + 请求携带**
  - `ProviderCompletionSettings`（`Infrastructure/Storage/ProviderCompletionSettings.cs:12-18`）尾部追加 `ImageProviderId` / `ImageModelId`（默认 `null` ⇒ 现有 `new ProviderCompletionSettings()` 调用不破）。
  - `ProviderCompletionSettingsStore.Read` / `Write` 增 `imageProviderId` / `imageModelId` 两个键。
  - `AgentRuntimeImageGenerateExecutor.BuildPayload`（`AgentRuntimeImageGenerateExecutor.cs:64-84`）增两个字段：`imageProviderId` / `imageModelId`，取值为 `ProviderCompletionSettingsStore.Read()` 的第四档；**空则不写该键**（与现有 `size` / `quality` 的可选写法一致）。此处**只读不解析、不校验** —— 解析与校验的唯一真相在主进程（步骤 3）。
  - **验证检查点**：`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警；`ProviderCompletionResolutionChecks`（命名参数构造）不破；AOT 0 警告（该 record 已注册 `AgentRuntimeJsonContext.cs:45`，无需新增注册）。

- [x] **步骤 2：渲染端第四档**
  - `ProviderCompletionSettingsPanel.tsx`：`ProviderCompletionSettings` 接口 + `EMPTY` 各加两字段；`RouteName` 增 `'image'`；渲染顺序 `promptOptimizer → persona → fallback → image`（图片生成排最后，因为它是「产出能力」不是「辅助通道」）。
  - `modelOptions` 由「统一 chat 过滤」改为**按档传谓词**：三档维持 `category === 'chat' || 无 category`，`image` 档用 `category === 'image'`；`updateRoute` 里自动带出的默认模型同步按档取。
  - i18n：`zh/settings.json` + `en/settings.json` 增 `runtimePage.auxiliaryModels.image.label` / `.desc`；**同时改 `tabs.modelManagement.desc`** 的口径（覆盖「辅助请求 + 图片生成」）。
  - **验证检查点**：`npm run typecheck` 三配置 0 错；`npm test` 的 `i18n-coverage`、`settings-tabs` 两套全绿（新增 key 必须在 zh/en 两侧齐备）。

- [x] **步骤 3：主进程 —— 解析接入（不读 `config.json`）**
  - `image-endpoint.ts` 的 `resolveImageEndpoint`：**新增显式指定位参数**（`explicitProviderId` / `explicitModelId`，或收敛成 options 对象）。命中规则：指定位 provider 存在、有 `apiKey`，且 `explicitModelId` 在其 `models` 里 ⇒ **优先于 `activeProviderId` 命中**并返回。
  - `image-reverse-handler.ts:52-59`：从反向请求入参取 `params.imageProviderId` / `params.imageModelId` 传进解析器（`ImageGenerateParams` 接口同步加两个可选字段）。
  - 返回值语义：命中的 `model` 必须回填到 `ResolvedImageEndpoint.model`，供请求体使用。
  - **不做**：主进程不新读 `config.json`、不新建 `main/lib/provider-completion-config.ts`（甲已把这条路去掉）。
  - **验证检查点**：`npm run typecheck` 0 错；`tests/image-endpoint/program.ts` 增断言：① 指定位命中优先于 `activeProviderId`；② 指定位悬空（provider 不存在 / 模型不在该 provider / `apiKey` 为空）走文末裁定的口径；③ 未指定（两个新参数都缺）时 S-166 三级回落**逐条不变**。

- [x] **步骤 4：真机验证（与 S-174 的联动点）**
  - 「模型管理」→ 图片生成档选一个 `category === 'image'` 的模型 → 保存 → 发一次生图 → 确认请求打的是该 provider / model（抓 `image:generate` 反向请求或看日志）。
  - 清空指定位 → 确认 S-166 三级回落行为不变（回到「跟随当前对话 provider」）。
  - **验证检查点**：真机两次结果与预期一致，截图或日志留证。

- [x] **步骤 5：整体测通**
  - `npm run typecheck` 三配置 0 错；`npm test` **65/65**（含步骤 3 新增断言）；`dotnet build` 0 错 0 警。
  - **验证检查点**：全绿 ⇒ 本刀测通，按一需求一刀提交。

---

## 七、执行结果（2026-10-08）

五步全部落地。与计划的两处出入：

1. **步骤 3 的实现形态**：没有给 `resolveImageEndpoint` 加显式指定位参数，而是**另起 `resolveExplicitImageEndpoint`**（返回 `{ endpoint, error }`）。原因：显式位失败语义与回落链相反（报错 vs 继续找），合进一个返回值会逼调用方反推意图；分开也让 **S-166 的既有断言一条未改**（计划原意是「增断言」，这里做到了既增又不改）。反向处理器按「两个 id 任一存在」二选一。
2. **步骤 3 的校验位置**：三关（provider 存在 / 模型在该 provider / `apiKey` 非空）全部落在主进程的新函数里。计划只写了「命中规则」，没写放哪一侧；按「校验与使用同一份数据」定在主进程 —— 它是拿着 provider store 真正发请求的那一侧。

门禁：`npm run typecheck` 0 错 / `npm test` **66/66**（`i18n-coverage`、`settings-tabs` 全绿）/ `dotnet build` 0 错 0 警 / `test:image-endpoint` **43 checks**。真机生图验证（步骤 4）未做，需真实 provider，留给老大侧。

---

## 四、涉及文件

| 文件 | 动作 |
|---|---|
| `src/runtime/WishfulClaw.Infrastructure/Storage/ProviderCompletionSettings.cs` | 修改：record 扩两字段 + Read/Write 增两键 |
| `src/renderer/src/components/settings/ProviderCompletionSettingsPanel.tsx` | 修改：第四档 + 按档过滤 |
| `src/renderer/src/locales/zh/settings.json` | 修改：新增 image 档文案 + 改 tab 描述 |
| `src/renderer/src/locales/en/settings.json` | 修改：同上（英文） |
| `src/runtime/WishfulClaw.Agent/AgentRuntimeImageGenerateExecutor.cs` | 修改：`BuildPayload` 增 `imageProviderId` / `imageModelId` |
| `src/main/lib/image-endpoint.ts` | 修改：`resolveImageEndpoint` 支持显式指定位 |
| `src/main/ipc/reverse-handlers/image-reverse-handler.ts` | 修改：把指定位传进解析器 |
| `tests/image-endpoint/program.ts` | 修改：新增指定位断言 |
| `docs/plans/iter-v2-38/requirements/S-173.md` | 回填「代价与取舍」「刻意不做」与实施记录 |

**不涉及**：`ModelManagementPanel.tsx`（在 AI 服务商页，是本需求的排除项）、`ModelFormDialog.tsx` 的「使用方式 = 图像」（保留，不删 —— 它是 S-166 的声明路径）。

---

## 五、参考源码

| 项目 | 位置 | 参考什么 |
|---|---|---|
| OpenCowork（`D:\claw\open-cowork-1.4.0`） | `settings/pages/model/ModelPage.tsx:1383-1388` | `imageOutput` 能力位 + `activeImageProviderId` / `activeImageModelId` 的成对写法 —— **注意**：它把这对值存在 provider-store，我方收起在 Worker `config.json`（与三档同源），只借它的「成对指定位」语义，不照搬存储位置 |
| 本仓 | `src/main/lib/image-endpoint.ts`、S-166 三级回落 | 收敛前后的复用对象 |

---

## 六、裁定结果：悬空即报错，不回落（2026-10-08 16:32）

**指定位解析失败时**（用户在「模型管理」选了 provider + model，之后删了该 provider 或删了该模型）：

- **裁定 = 报错、不回落**。明确告诉用户「指定的生图模型不可用了，请到模型管理重选」，**不静默回落 S-166 三级链**。
- 理由：本需求立起来的正是「显式指定位」这个数据源，悄悄打到别家会把这个意图抹掉，用户查不出来；与 blockmap 那次「宁缺勿错」同一取向。
- 步骤 3 的实施口径：指定位两个参数**已提供但解析不中**（provider 不存在 / 模型不在该 provider / `apiKey` 为空）⇒ 返回**可操作错误**，不进三级回落；两个参数**都没提供**（未指定）⇒ 照旧走 S-166 三级回落，**行为逐条不变**。
