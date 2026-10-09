# 审查报告：plan-s173（阶段五 · 审查态）

> 被审查对象：需求 `docs/plans/iter-v2-38/requirements/S-173.md` / 计划 `docs/plans/iter-v2-38/plan-s173/plan.md` / 落地提交 `17dafdc1`
> 审查方式：独立 subagent（code-reviewer，只读源码；未改任何文件、未跑构建/测试）
> 时间：2026-10-09

## 一、总体结论

**❌ 项 = 0 · 可进入验证态。**

`17dafdc1`（11 文件 / +271 −39）与三个核定口径（**方案 A** / **接线走甲（Worker 送达）** / **指定位悬空即报错、不回落**）自洽落地：分层边界干净（主进程只读自己的 provider store，未读 `config.json`；渲染端只走 Worker RPC），S-166 三级回落**纯新增、一行未改**，无新增依赖、无硬编码密钥/路径。发现的问题均为 ⚠️/ℹ️ 级（图片档「选了 provider 但无图像模型」会把整块保存卡死、错误文案中英混排、`resolveExplicitImageEndpoint` 未校验 provider `enabled`、默认 baseUrl 字面量重复），**不阻断验证**。

最值得处理的一条：⚠️ **保存闸门** —— 图片档的服务商下拉是「全部启用 provider」，未按档过滤；选中一个没有 `category === 'image'` 模型的服务商后 `imageModelId` 落 `null`，`IsPair` 第四对校验会拒掉**整块**保存（连带前三档），且报错文案「Provider and model must be configured together」不指明是哪一档。

## 二、逐项结论

| # | 审查项 | 结论 | 证据 / 说明 |
|---|---|---|---|
| 1 | 分层约定（主/渲染/Worker/C#） | ✅ | 主进程只读自己的 provider store：`image-reverse-handler.ts:57` `readPersistedProviderStore()`，新分支 `:64-77` 也只吃反向请求里的两个 id，**无 `config.json` 引用**；`image-endpoint.ts` 无 electron/fs import（新函数 `:121-166` 只用 `readString`/`getHost`/`URL`）。渲染端只经 Worker RPC：`ProviderCompletionSettingsPanel.tsx:53` `provider/completion-config-read`、`:89` `provider/completion-config-write`，未直连主进程 store。Worker 侧 `AgentRuntimeImageGenerateExecutor.cs:66` 读配置、`:84-91` 只透传 id（只读不解析）。C# 依赖方向合法：新 `using WishfulClaw.Infrastructure.Storage;`（`AgentRuntimeImageGenerateExecutor.cs:11`）为 Agent → Infrastructure，符合 AGENTS.md「Agent 依赖 Contracts+Core+Infrastructure+Persona」，无逆引用 |
| 2 | 硬编码路径 / 密钥 / 默认模型名 | ⚠️ | 无密钥、无绝对路径、无新增默认模型名。`KNOWN_IMAGE_MODELS`（`image-endpoint.ts:35-38`，host→model，S-166 既有）**判为合理硬编码**：它是「已知厂商默认模型」表、按 host 而非 provider 名匹配，且**显式指定位完全绕过它**（`resolveExplicitImageEndpoint` 不查该表，`:154-162` 直取 provider），因此不会覆盖用户选择；注释也写明「猜一个不存在的模型比让用户声明更糟」。问题项见 §三 #2（默认 baseUrl 字面量 `'https://api.openai.com/v1'` 在 `:87` 与 `:154` 重复）、#3（错误文案中英混排、未走 i18n） |
| 3 | 参考逻辑实现（OpenCowork `ModelPage.tsx:1383-1388`） | ✅（适配，非照搬） | 参考点实读为 `imageOutput` 能力勾选（`ModelPage.tsx:1383-1388` `Capability ... capabilities.imageOutput`）+ 全局 `activeImageProviderId`/`activeImageModelId` 成对位。本仓**未照搬存储位置**（那对值在 OpenCowork 属 provider-store；本仓渲染端 `stores/provider-store.ts:142-143` 仍留着同名字段，仅被 `AppPluginPanel.tsx:202` / `app-plugin-store.ts:250` 消费，**无 setter、未被本刀接线**）：本刀把新的指定位收在 Worker `config.json`，与现役三档同源同一次保存（`ProviderCompletionSettings.cs:24-25,46-47,60-61`）。**成对语义被保留**：写入侧 `ProviderCompletionSettingsService.cs:32,46-47`（`IsPair` 第四对）、UI 侧 `Panel.tsx:71-75`（`updateRoute` 同时写 provider+model）。能力位**复用 S-166 既有的 `category === 'image'`** 而非新引 `capabilities` 对象（本仓 main 侧无 `capabilities` 字段，grep 证实）—— 属合理适配；代价：将来若引入 `capabilities.imageOutput`，两套「图像能力」表达会并存（见 §三 #4） |
| 4 | 错误处理充分性 | ✅（有 ⚠️） | 悬空三路全覆盖且**都不回落**：provider 不存在 `image-endpoint.ts:126-132`、无 apiKey `:133-138`、模型不在该 provider `:140-152`；handler 命中 `error` 即早退 `image-reverse-handler.ts:69-72`，**不落 `resolveImageEndpoint`**。S-166 三级回落未破坏：`resolveImageEndpoint`（`:72-103`）本次 diff **纯新增、零改动**，handler 仅在两 id 皆空时调它（`:74-79`）。⚠️ 缺口见 §三 #1/#3/#5：① 无 provider `enabled` 校验；② 模型只校验 id 存在、不校验 `category`/`enabled`；③ 单边 id（手工改 `config.json` 可能造出）会走到「model '' no longer exists」这种带空引号的可操作但难看文案 |
| 5 | 引入不必要依赖 | ✅ | `git show --stat 17dafdc1` = 11 文件，无 `package.json`/lockfile/`.csproj` 改动；新增引用全部仓内（`resolveExplicitImageEndpoint` 来自既有 `image-endpoint.ts`；C# 引用既有 Infrastructure 项目）。无第三方库引入 |
| 6 | 回归风险（未指定指定位用户 / S-166 逐条） | ✅ | 未指定用户：Worker 不写两个键（`AgentRuntimeImageGenerateExecutor.cs:84-91` 仅非空才写）⇒ 主进程 `readString(undefined)` = `''`（`image-endpoint.ts:40-42`）⇒ 两 id 皆空 ⇒ 走原 `resolveImageEndpoint`，**行为逐条不变**；测试新增断言 `tests/image-endpoint/program.ts`「未指定指定位时仍走 S-166 三级回落」。S-166 三级回落函数体一行未改（diff 纯加），既有 31 条断言未动、总数 31→43。可见变化仅两处（均属需求本身）：设置页多一个「图片生成」档；保存后 `config.json` 的 `providerCompletion` 多两个 `null` 键（`Read` 默认 `null`，向下兼容）。另：`IsPair` 新增第四对**只在新 id 单边出现时**才拒写，正常 UI 路径从不同时触发（见 §三 #1 的构造路径） |
| 7 | 域外顺手改动 | ℹ️ | 两处首行 UTF-8 BOM 被抹（`ProviderCompletionSettingsService.cs:1`、`ProviderCompletionSettingsPanel.tsx:1`）—— 无行为变化，方向与仓库多数文件一致，**已在 `plan.md` §七.3 事后申报**（提交时未申报，属事后知晓项）。`tabs.modelManagement.desc` / `runtimePage.auxiliaryModels.hint` 文案改动（`zh`/`en`）**属本刀范围内**（第四档落同一面板，原描述「辅助请求」语义不符），非域外 |


## 三、问题与建议

| # | 级别 | 位置 | 问题 | 建议 |
|---|---|---|---|---|
| 1 | ⚠️ 建议 | `ProviderCompletionSettingsPanel.tsx:123-131`（服务商下拉）+ `:68-77`（`updateRoute`）+ `ProviderCompletionSettingsService.cs:32-35` | 图片档的服务商下拉列的是**全部启用 provider**（未按档过滤模型）。选中一个不含 `category === 'image'` 模型的服务商 ⇒ `modelId` 落 `null` ⇒ 保存时 `IsPair(ImageProviderId, ImageModelId)` 判「不成对」⇒ 返回 `Provider and model must be configured together`，**整块保存（含前三档）被拒**，且文案不指明哪一档。三档原本也有此形状，但图片档命中概率高得多（多数 provider 无图像类模型） | ① 图片档的服务商下拉只列「至少含一个 `category === 'image'` 模型」的 provider（与 `acceptsModel` 同源，可在 `updateRoute`/渲染处复用）；或 ② 选中无图像模型的服务商时立即把 `imageModelId` 清空并给内联提示；③ 顺带让 Worker 的成对校验报错带上档位（如 `imageProviderId/imageModelId`） |
| 2 | ⚠️ 建议 | `image-endpoint.ts:87` 与 `:154`；`:130` / `:136` / `:150` | 三处错误文案被工具卡片直显（`image-endpoint.ts:168-171` 注释证实），却是「英文句子 + 中文『模型管理』」混排（`:130`、`:150`），且整个字符串不参与 i18n —— 与既有 `image-reverse-handler.ts:82-84` 的纯英文风格也不一致。另默认 baseUrl 字面量 `'https://api.openai.com/v1'` 在 `:87` / `:154` 重复 | 抽 `const DEFAULT_OPENAI_BASE` 常量复用；错误文案改为纯英文或走可注入的文案键（`Settings → Model Management` / 中文用 locale）。若坚持中英混排，请在注释里写明这是刻意的（当前 `:57` 旧文案用的是 `Settings → Models`，口径亦不统一） |
| 3 | ℹ️ 知晓 | `image-endpoint.ts:133-138`（缺 `enabled` 校验）、`:140-152`（只校验 `id`） | 显式解析**不校验** ① provider `enabled === false`（用户后来停用了该 provider，指定位仍会命中并发请求，报错文案也不会出现）；② 模型 `enabled` / `category`（用户后来把该模型改回 `chat`，仍被当作生图模型使用）。S-166 的 `resolveImageEndpoint` 同样不校验 `enabled`，故**行为一致**、非回退 | 若产品口径是「停用的 provider 不该发请求」，可在 `:133` 前加一条 `provider.enabled === false` ⇒ 报「已在服务商页停用」；否则在注释里显式声明「指定位只认存在性，不认 enabled」以固定口径 |
| 4 | ℹ️ 知晓 | `Panel.tsx:22-25`（`acceptsModel`）vs 参考实现 `ModelPage.tsx:1383-1388` | 参考实现的能力位是 `capabilities.imageOutput` 布尔；本刀复用 S-166 既有 `category === 'image'`（本仓 main 无 `capabilities` 字段）。若将来本仓引入 `capabilities`，两个「图像能力」表达会并存 | 现状可接受（`category` 是本仓既有的唯一表达）。将来引入 `capabilities` 时，把 `acceptsModel` 的 image 分支与该字段合并，保持「一处知道差别」（现注释已保证单点，符合其设计意图） |
| 5 | ℹ️ 知晓 | `image-endpoint.ts:126`、`:141-146`；`image-reverse-handler.ts:66-77` | 若只有一侧 id 非空（正常 UI 路径不可能：Worker 只在非空才写、`IsPair` 又保证成对；仅手工改 `config.json` 可造出），`readString(item.id) === ''` / `readString(model.id) === ''` 可能意外匹配到 id 缺失的记录；否则落到「model '' no longer exists」这种带空引号的文案。**仍会报错不回落**，无静默错打风险 | 低优先。可在 `resolveExplicitImageEndpoint` 入口对空串 id 直接返回「配置不完整」类错误，避免空引号文案 |
| 6 | ℹ️ 知晓 | `ProviderCompletionSettingsService.cs:1`、`ProviderCompletionSettingsPanel.tsx:1` | 提交顺带抹掉两文件首行 BOM（域外改动，见 §二 #7），提交信息未申报、`plan.md` §七.3 事后补记 | 无需回滚（方向与仓库多数文件一致、零行为变化）。惯例建议：此类白空格/BOM 变更单独一刀或提前申报 |


## 四、非本刀欠账（记录，不纳入本刀）

1. **真机验收缺口**：`plan.md` 步骤 4（真机生图 → 确认打的是指定位 provider/model；清空指定位后回落不变）**未做**，需真实 provider，留老大侧。功能闭环最后一环未验 —— 本阶段（审查态）不代跑。
2. **生图链覆盖范围**：显式指定位**只在 Worker 发起的 `image:generate` 链上生效**（`AgentRuntimeImageGenerateExecutor.cs:84-91` → 反向请求）。若将来渲染端直接调生图（S-174 画布那类），需另议是否补主进程读取 —— 已在 `requirements/S-173.md` §遗留 申报。
3. **渲染端遗留同名概念未接线**：`stores/provider-store.ts:142-143` 的 `activeImageProviderId` / `activeImageModelId`（OpenCowork 迁移残留，无 setter，仅 `AppPluginPanel.tsx:202` / `app-plugin-store.ts:250` 读）与本刀的 Worker 侧指定位**并存但互不相干**。本刀未动它，也不应由本刀清理。
4. **`KNOWN_IMAGE_MODELS` 映射表**（`image-endpoint.ts:35-38`）与 `resolveImageEndpoint` 不校验 provider `enabled` 的既有形状，均为 S-166 遗产，本刀未改（§三 #3 只建议补注释固定口径）。
5. **i18n 覆盖**：工具卡片直显的主进程错误文案（`image-endpoint.ts:130/136/150`）不在 `settings.json` 体系内 —— 属主进程错误文案的**全局**欠账，非 S-173 独有。

## 五、结论

**❌ 项 = 0 ⇒ 可进入验证态。**

- 阻断级问题：**无**（无安全/正确性/数据破坏风险；悬空指定位不会静默错打别家，未配置用户行为逐条不变）。
- 附带条件（建议在验证态一并观察，不阻断）：§三 #1 的「图片档选了无图像模型的服务商 ⇒ 整块保存被拒且文案不指明档位」在真机上最容易撞到，建议验证时**专门试一次**（真机步骤 4 已含「选模型 → 保存」路径，可顺带覆盖）。
- 真机验证（`plan.md` 步骤 4）仍为未做项，属**验证态**的验收内容，与本审查态结论不冲突。

## 六、审查范围自述

**读过（只读，未改任何源码/计划/需求）：**

- 需求与计划：`docs/plans/iter-v2-38/requirements/S-173.md`（全文 134 行）、`docs/plans/iter-v2-38/plan-s173/plan.md`（全文 111 行）、`docs/plans/iter-v2-38/plan-s173/compliance_report.md`（全文 61 行，先读以避免重复其文档层结论）。
- 落地代码（当前 HEAD 工作区版本）：`src/main/lib/image-endpoint.ts`（全文 192 行）、`src/main/ipc/reverse-handlers/image-reverse-handler.ts`（含 `17dafdc1^` 版本对照）、`src/renderer/src/components/settings/ProviderCompletionSettingsPanel.tsx`（全文 169 行）、`src/runtime/WishfulClaw.Agent/ProviderCompletionSettingsService.cs`（全文 55 行）、`AGENTS.md`（分层约定 1-120 行）。
- 旁证：`src/runtime/WishfulClaw.Infrastructure/Storage/ProviderCompletionSettings.cs`（grep 定位 17-63 行）、`src/renderer/src/stores/provider-store.ts`（:138-145）、`provider-store-helpers.ts`（:49-57）、`app-plugin-store.ts`（:246-256）、`AppPluginPanel.tsx`（:202-247、:456-466）、参考项目 `D:\claw\OpenCowork\src\renderer\src\settings\pages\model\ModelPage.tsx:1370-1399`。

**跑过的命令（全部只读）：**

- `git -C D:\claw\wishful-claw show --stat 17dafdc1`
- `git -C D:\claw\wishful-claw show 17dafdc1 -- src/main/lib/image-endpoint.ts src/main/ipc/reverse-handlers/image-reverse-handler.ts`
- `git -C D:\claw\wishful-claw show 17dafdc1 -- src/runtime src/renderer/src/components/settings/ProviderCompletionSettingsPanel.tsx`
- `git -C D:\claw\wishful-claw show 17dafdc1 -- src/renderer/src/locales tests/image-endpoint/program.ts`
- `git -C D:\claw\wishful-claw show 17dafdc1^:src/main/ipc/reverse-handlers/image-reverse-handler.ts`（改动前对照）
- `git -C D:\claw\wishful-claw log --oneline -3 17dafdc1`、`git -C D:\claw\wishful-claw status --porcelain`
- Grep：`ProviderCompletionSettings\(|ImageProviderId|ImageModelId|imageProviderId`（src 全树）、`acceptsModel|capabilities|imageOutput`（main）、`activeImage*`（stores 等）
- Read / Glob / `Get-Content`（AGENTS.md、OpenCowork ModelPage.tsx 片段）

**未做（按阶段约束）**：未修改任何文件（除本产物）、未 commit / push、未跑构建或测试（`npm run typecheck` / `npm test` / `dotnet build` / `test:image-endpoint` 结论直接采信计划与合规报告，未复核）。

