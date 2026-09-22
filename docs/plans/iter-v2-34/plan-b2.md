# Plan: iter-v2-34 本体需求实施（第二批：S-107 / S-108 / S-109 / S-115）

> 2026-09-22 建。**需求口径权威源 = 同目录 `raw-requirements.md`**，本文件只排步骤与文件面，不重复取证。
> 上一批（S-112 + S-111）见同目录 `plan.md`，已各自成刀（`14468e3f`、`31b53119`），本批**不改动其任何结论**。
> 建立缘由：本批四项是 `raw-requirements.md` 中**唯一尚未实施**的已立项需求。老大 2026-09-22 指令「根据 docs 下开发工作流 把登记的需求全部推进」⇒ 按 `docs/dev-workflow.md` 六阶段推进，先补阶段一探索（本文件「探索结论」节即其产出），再进规划验证。

## 目标

把本迭代剩余四项需求按工作流实施完，**每项独立成刀**：

1. **S-115** —— `create_session` 建会话必崩（**崩溃级 bug，根因已定，优先级最高**）
2. **S-109** —— 更新弹窗主按钮语义（零待裁定，改动最小）
3. **S-108** —— 模型窗口 384K 未生效（后端按 200K 兜底）—— **卡在一条日志取证**
4. **S-107** —— 全局「请求上下文上限」设置项 + 会话默认继承 —— **盖章链须待 S-108 结案**（理由见「范围与顺序」）

## 范围与顺序

| 序 | 需求 | 阻断现状 | 排这个位置的理由 |
|:--:|---|---|---|
| 1 | **S-115** | **无阻断**（根因已定） | 崩溃级 bug；改动是一个 INSERT，风险最低，先把功能性问题清掉 |
| 2 | **S-109** | 待老大拍 1 条（「稍后」去留） | 单文件 + 2 条 locale，本批最小 |
| 3 | **S-108** | **待取证**（Worker DIAG 行 `contextLength=` 的值） | **必须排在 S-107 之前**：S-107 的步骤 10（盖章链）是否真有作用，取决于后端到底吃哪个窗口 —— 取证前做等于盲改。退化路径见下注 |
| 4 | **S-107** | 待老大拍 4 条（量纲 / 继承落地 / 与 capModelId 共存 / 是否保留会话级覆盖） | 有明确范式可抄（会话级压缩阈值），但需先定口径，**且步骤 10 需 S-108 结案** |

> **S-108 退化路径（避免它无限挡住 S-107）**：若老大拿不到 DIAG 日志，S-108 按「只做步骤 14（静默失败变可见）」结案 —— 结案后 S-107 即可照常实施。步骤 14 的告警恰好覆盖「全局值被后端同样忽略」这一风险，两条需求的次序约束至此解除。

### 明确不在本批范围

| 项 | 为什么不排 |
|---|---|
| **S-129** 更新源切官网 | 老大已明确「官网先上线，等备案过了再调整」⇒ **后置**，本批不动 |
| **S-110** | 已撤销（随 S-111 砍浮块失去实施对象），仅留档 |
| 待登记 #12 遗留测试工程体量 | 未立项。老大点过名，本批**只出只读清单**（见步骤「附」），不占实施位、不删任何工程 |

## 探索结论（阶段一产出，2026-09-22 只读探测）

### S-115 —— 根因已定死

**报错**：`SQLite Error 19: NOT NULL constraint failed: sessions.model_selection_mode`（老大实跑，两个项目同一错误）。

**全仓 `INSERT INTO sessions` 共 4 条**，列清单比对结果：

| 位置 | 含 `model_selection_mode` | 说明 |
|---|---|---|
| `src/runtime/WishfulClaw.Infrastructure/Db/DbSessionTools.cs:98` | ✅ `@msm` | 一般建会话路径 |
| `src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionTools.cs:159` | ✅ | 渠道建会话路径 |
| `src/runtime/WishfulClaw.Infrastructure/Db/DbPluginSessionRouting.cs:78` | ✅ | 渠道路由建会话 |
| **`src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs:227`** | ❌ **漏列** | **`create_session` 工具走的就是这条** |

**证据链**：

1. `create_session` 工具的执行体是 `AgentRuntimeProjectExecutor.CreateSessionAsync`（`ToolDispatchRouter.cs:440-442` 按 `IsProjectTool` 路由；定义见 `Tools/Providers/ProjectToolsProvider.cs:67-71`）。该函数**在 Agent 层手写 INSERT**，不经过 `DbSessionTools`。
2. 它的 INSERT 只列 10 列（`id, title, mode, created_at, updated_at, message_count, project_id, working_folder, ssh_connection_id, pinned`）—— **`model_selection_mode` 不在其中**。
3. 列定义有两处来源，**不一致**：
   - 新库建表（`DbClient.cs:87-114`）：`model_selection_mode TEXT NOT NULL DEFAULT 'inherit'` ⇒ 不列该列也能取到 DEFAULT。
   - 存量库迁移（`DbClient.cs:530`）：`EnsureColumn("sessions","model_selection_mode","TEXT")` ⇒ 只加 `TEXT`；`EnsureColumn` 实现（`DbClient.cs:754-773`）是「列不存在才 `ALTER TABLE ADD COLUMN <原样类型>`」，**列已存在则跳过，不会补上 DEFAULT**。
4. ⇒ **老大的库该列是 NOT NULL 且没有 DEFAULT**（iter-11 `32409a34` 由 SqlSugar 迁 Sqlite 时引入，见 `git log -S model_selection_mode`），Agent 那条不列该列 ⇒ 写入 NULL ⇒ **NOT NULL 约束失败**。新装库不会复现（有 DEFAULT），这就是「两个项目都报同一错误」的原因 —— 同一个 profile 库。

**对照组**：`DbSessionTools.Create` 的 `@msm` 值来自 `ReadSessionInput`（`DbSessionTools.cs:360-361`）：`NormalizeOptional(...) ?? (providerId && modelId ? "manual" : "inherit")` —— **永远非 null**，所以那条路径不会崩。这也解释了为什么只有 `create_session` 工具报错。

**修法（最小且充分）**：给 `AgentRuntimeProjectExecutor.CreateSessionAsync` 的 INSERT 补 `model_selection_mode` 列，值为 `'inherit'`（工具建的是项目协作会话，没有模型覆盖语义）。**不**去动 `DbClient` 的历史列定义 —— SQLite 无法给已有列补 DEFAULT（除非整表重建），代价远大于收益，且 INSERT 层补列对所有库都正确。

**同类风险**：该 INSERT 还漏了 `scope` / `collaboration_mode`（两列**可为 NULL**，不是 NOT NULL，故本次不崩；且它是既有行为，**不扩大范围**，只记档）。

### S-108 —— 两条链已定位，卡在一条日志

**症状**（老大原话）：「模型上设置的最大上下文」是 384K，没设会话上限，**前端看着正常、后端约 46% 就压缩** ⇒ 后端用的窗口不是 384K。

**取值链事实（已核实）**：

| 环节 | 事实 | 位置 |
|---|---|---|
| 后端窗口唯一来源 | 只读 `provider.contextLength`，读不到**兜底 `200_000`** | `AgentLoop.cs:671`、`ContextCompression.cs:289/355`、常量 `AgentLoop.cs:22` |
| payload 传窗口 | `contextLength: modelConfig?.contextLength ?? undefined`；`modelConfig = provider.models.find(m => m.id === modelId)` ⇒ **找不到就丢字段**（JSON 里消失）⇒ 后端吃 200K | `lib/agent/provider-payload.ts:51,75` |
| 发送侧模型解析 | `resolveSendModel(sessionId)`（`hooks/use-chat-actions.ts:323-351`）→ 调 `resolveSessionModelSelection`，**与 UI 显示同源** | 同上 |
| **可疑分叉** | `resolveSendModel` 的兜底分支（`use-chat-actions.ts:345-349`）：`selection.providerId` 查不到 provider 时改用 `getActiveProvider()`，并把 `resolvedModelId` 置 null；**但它并不就此返回 null** —— `:351-355` 会用 `providerStore.activeModelId \|\| provider.defaultModel \|\| 首个 enabled` 回填（仅整条 provider 都没有时才在 `:350` 返回 null）。风险在回填值：`activeModelId` 是**全局**值，未必属于兜底后的这个 provider ⇒ `provider.models.find(m => m.id === modelId)`（`provider-payload.ts:51`）落空 ⇒ `contextLength` 丢字段（`:75`）⇒ 后端吃 200K。UI 侧 `useActiveModelConfig`（`use-active-model-config.ts:19-36`）在 `!providerId \|\| !modelId` 时直接返回 null，由调用方另取窗口 ⇒ **两条链在「selection 的 provider 不在 store」场景确实分叉** | `use-chat-actions.ts:345-355`、`provider-payload.ts:51,75` |
| 会话上限叠加 | `ApplyContextCap` 仅在 `provider.contextLength > capTokens` 时改写；老大**没设上限** ⇒ `resolveSessionContextCapTokens` 返回 0 ⇒ 此条**不参与** | `AgentLoop.Helpers.cs:58-88`、`context-compression-config.ts:139-148` |

**待取证（一条就能对半砍）**：Worker 日志已内建诊断行（`WorkerLog.Warn`，每次判定都打，`AgentLoop.cs:698`）：

```
context compression DIAG: inputTokens=… contextLength=… effectiveWindow=… thresholdRatio=… trigger=… -> WOULD COMPRESS / skip
```

- 若 `contextLength=200000` ⇒ 窗口没到后端（modelId 无效走兜底 / 档案里本就没有 384K）⇒ **根因在前端 payload 链**
- 若 `contextLength=384000` 而 `trigger` 与前端不一致 ⇒ **根因在后端算式**（阈值 / reserved / buffer 常量）

**待老大提供**：当前会话 id、该模型档案的 id 与 `contextLength`、以及该次请求日志里的 DIAG 行。

### S-107 —— 现状已核实

| 事实 | 位置 |
|---|---|
| 全局设置页「上下文压缩」节**只有两项**：启用开关 + 触发比例滑条（30~90%），**没有上限项** | `components/settings/RuntimePanel.tsx:274-318` |
| 全局设置存储**无上限字段**（只有 `contextCompressionThreshold`，`:150/:299/:462`） | `stores/settings-store.ts` |
| 会话级上限控件在输入区上下文环弹出面板：滑条 + 「Model max / 具体值」两态，**仅在 `capRange !== null && capModelId !== null` 时渲染** | `components/chat/InputArea/context-ring.tsx:363-401` |
| 会话级上限只在**设它的那个模型**上有效，换模型返回 0 | `lib/agent/context-compression-config.ts:139-148` |
| 落库字段 `Session.contextCapTokens` + `contextCapModelId` | `stores/chat-store/types.ts:84`、`db-helpers.ts:373` |
| 运行期盖章：`sendMessage` 写 `contextCapTokens` run param | `stores/chat-store/index.ts:418-423` |
| **范式参照**：会话级压缩阈值 = 会话设过用会话的、否则用全局（`0` 哨兵 + 面板「跟随全局」还原出口） | `context-compression-config.ts:92-111`（`clampSessionCompressionThreshold` / `resolveSessionCompressionThreshold`） |

### S-109 —— 现状已核实

| 事实 | 位置 |
|---|---|
| 发现新版本时主按钮 = key `updater.dialog.download`，**中文值就是「后台下载」**，`onClick=onDownload` | `UpdateDialog.tsx:231-235`；`locales/zh/settings.json` 的 `updater.dialog.download` |
| 下载中（`isDownloading`）第二个按钮 = `updater.dialog.later`「稍后」⇒ `handleOpenChange(false)` 收起 | `UpdateDialog.tsx:212-215` |
| 下载中另有提示「下载会在后台继续，关闭此窗口不会中断」 | `:166-177` |
| **死条件**：`hasAvailableUpdate` 分支的 `disabled={isDownloading}` 不可达（`isDownloading` 已被更靠前的分支截走） | `:232` |

## 待老大确认（★ 必停节点：规划验证通过后、执行前）

工作流规定本节点必须停。以下 5 条是**规划无法自行拍板**的口径项，每条我已给**推荐选项**：

| # | 需求 | 待定项 | 我的推荐 |
|:--:|---|---|---|
| 1 | S-109 | 下载中是否保留「稍后」 | **砍掉「稍后」** —— 与「后台下载」行为完全一致（都只是收起），留着是同义重复；`available` 态主按钮改「开始下载」，`downloading` 态变「后台下载」并收起 |
| 2 | S-107 | 全局值的量纲 | **绝对 token 数**（0 = 不限制/跟随模型窗口）。会话级滑杆、模型档案 `contextLength`、`formatTokens` 全是十进制绝对 token；做成百分比跨模型没有意义 |
| 3 | S-107 | 会话默认继承怎么落地 | **沿用 `contextCapTokens` + 0 哨兵**，与会话级压缩阈值**完全同构**（`resolveSessionCompressionThreshold` 就是这么做的）；新增 `resolveEffectiveContextCapTokens(session, global)` |
| 4 | S-107 | 与「换模型作废」（S-84）共存 | 会话级**保留**换模型作废（老大原口径）；**全局值不绑模型**（它本来就不是在某个模型上设的）⇒ 不受该约束 |
| 5 | S-107 | 是否保留会话级覆盖与「跟随全局」出口 | **保留**，与压缩阈值对齐（面板加「跟随全局」还原项） |

> **S-108 无待拍**，但**必须老大提供那条 DIAG 日志**才能进执行。若老大拿不到，退一步：本批可只做「payload 层对 `contextLength` 缺失显式告警」这一条（见步骤 4），把静默失败变可见，再等真机复现。

## 关键工程决策（阶段三重点挑战对象）

| 项 | 决策 | 依据 / 待确认 |
|---|---|---|
| S-115 修哪一层 | **只补 Agent 层 INSERT 的列**，不动 `DbClient` 历史列定义 | SQLite 加 DEFAULT 需整表重建，代价 >> 收益；INSERT 层补列对所有库正确 |
| S-115 值取什么 | `'inherit'`（与会话默认一致） | `SessionEntity.ModelSelectionMode` 默认值即 `"inherit"`（`Entities/SessionEntity.cs:68`） |
| S-115 补不补测试 | **补一条**走项目工具路径的建会话回归断言 | 现有 `SessionTaskCascadeRegressionTests` 只覆盖 `DbSessionTools.Create`；**该 INSERT 的列偏差正是没测试才漏了 3 个月** |
| S-107 全局值 0 的语义 | 0 = 不限制（会话没设过 ⇒ 取全局；全局为 0 ⇒ 不限制） | 与 `compressionThreshold` 的 0 哨兵同构 |
| S-107 全局 UI 控件形态 | **数字输入（token 数）+ 「不限制」开关**，不照抄会话级滑条 | 全局值跨模型，**没有「当前模型窗口」可当量程上限**，滑条没有 max 可定 |
| S-108 修法 | **待取证后定**；本批先做「静默失败变可见」 | 取证前任何改动都是猜 |
| S-109 文案落点 | 新增 key `updater.dialog.startDownload`，**不改** `download` 的既有语义 | 「后台下载」在 `downloading` 态仍要用 |

## 单文件 500 行红线核查

本批改动面涉及的**已超线**文件，逐条给出豁免依据（`AGENTS.md` 三类豁免：单一数据对象 / 高内聚 store·hook / 拆分需大量 props 透传）：

| 文件 | 实测行数 | 判定 |
|---|:--:|---|
| `stores/settings-store.ts` | 524 | **已超线**；属高内聚 store（Zustand 定义 + persist + migrate 单一职责）⇒ 豁免，本批仅加 1 个字段 |
| `stores/chat-store/index.ts` | 1473 | **已超线**；高内聚 store ⇒ 豁免，本批仅把步骤 10 的一处解析换成新函数 |
| `hooks/use-chat-actions.ts` | 889 | **已超线**；高内聚 hook 集合 ⇒ 豁免，本批最多 1 处告警（步骤 14 备选落点） |
| `components/chat/InputArea/context-ring.tsx` | 447 | 未超线；加「跟随全局」项约 +10 行 ⇒ 改后约 457，**仍在线内** |

> 行数为 2026-09-22 实测（`Get-Content | Measure-Object -Line`）。本批**不**对上述文件做拆分 —— 拆分会让改动面失控，与「一个需求一刀」冲突。

## 步骤清单

### 第一部分：S-115（崩溃修复，1 个文件 + 1 条测试）

- [ ] 步骤 1 —— `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs:226-237`
  - INSERT 列清单补 `model_selection_mode`，值 `'inherit'`（与 `SessionEntity` 默认一致）
  - 顺手核对：该 INSERT 其余 10 列与 schema 的 NOT NULL 列一一对得上（`scope` / `collaboration_mode` 可空，本次不动，记档）
  - **验证**：`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警（先按 `docs/dev-workflow.md`「编译环境」关开发实例）；`grep "INSERT INTO sessions" src/` 四条全部含 `model_selection_mode`
- [ ] 步骤 2 —— 补回归断言
  - 在 `tests/WishfulClaw.SessionTaskCascadeRegressionTests` 增加**一条**覆盖「项目工具路径建会话」的用例（或至少断言该 INSERT 的列与 schema NOT NULL 列一致）
  - **验证**：`npm test -- --filter SessionTaskCascade` 通过；断言的失败模式**能真的抓到**本次 bug（补前先跑一次，确认它会 FAIL）
- [ ] 步骤 3 —— 真机验证 + 需求提交
  - 用 `create_session` 工具建会话成功（老大的库是复现环境）
  - **验证**：`npm run typecheck` EXIT=0 + `npm test` 全绿 ⇒ **commit（S-115 独立一刀）**

### 第二部分：S-109（更新弹窗按钮语义，1 个文件 + 2 条 locale）

- [ ] 步骤 4 —— `components/updater/UpdateDialog.tsx`
  - `available` 态：主按钮文案 → `updater.dialog.startDownload`（「开始下载」），行为仍是 `onDownload`
  - `downloading` 态：主按钮 = 「后台下载」，点击 `handleOpenChange(false)` 收起
  - 按待定项 #1 的裁定处置「稍后」（推荐：删）
  - 顺手清理 `:232` 的死条件 `disabled={isDownloading}`（已成不可达）
  - **验证**：`npx tsc --noEmit -p tsconfig.web.json` 0 错；三段分支（available / downloading / downloaded）逐条对照裁定
- [ ] 步骤 5 —— locale：`locales/{zh,en}/settings.json`
  - 新增 `updater.dialog.startDownload`；按裁定删或保留 `later`
  - **验证**：两语言 JSON 可解析；`grep -c "startDownload"` 两文件各 ≥1
- [ ] 步骤 6 —— 复验 + 需求提交
  - **验证**：`npm run typecheck` EXIT=0 + `npm test` 全绿（含 `i18n-coverage`）⇒ **commit（S-109 独立一刀）**

### 第三部分：S-107（全局上限设置项，口径待定项 #2~#5）

- [ ] 步骤 7 —— `stores/settings-store.ts`：新增 `contextCapTokens: number`（默认 0），进 `partialize` 白名单
  - **验证**：`npx tsc --noEmit -p tsconfig.web.json` 0 错；确认字段真的进了 `partialize`（**S-111 的教训：不在白名单等于没持久化**）
- [ ] 步骤 8 —— `lib/agent/context-compression-config.ts`：新增 `resolveEffectiveContextCapTokens`（会话设过且模型匹配 → 会话值；否则 → 全局值；全局 0 = 不限制）
  - **验证**：纯函数，`tests/` 下加 `test:context-cap` 用例覆盖（会话命中 / 会话未设回落全局 / 全局 0 / 换模型作废）
- [ ] 步骤 9 —— `components/settings/RuntimePanel.tsx:274-318`：在「上下文压缩」节新增「请求上下文上限」控件（数字输入 + 不限制开关）
  - **验证**：`tsc` 0 错；`grep contextCapTokens RuntimePanel.tsx` 命中
- [ ] 步骤 10 —— 盖章链改走新解析：`stores/chat-store/index.ts:418-423` 用 `resolveEffectiveContextCapTokens`（代入全局值）
  - **验证**：`tsc` 0 错；机械判据 `grep -n "resolveEffectiveContextCapTokens" src/renderer/src/stores/chat-store/index.ts` 命中
- [ ] 步骤 11 —— `context-ring.tsx`：面板补「跟随全局」还原出口（与压缩阈值面板同款）
  - **验证**：`tsc` 0 错；面板在会话未设时显示为「跟随全局」
- [ ] 步骤 12 —— 复验 + 需求提交
  - **验证**：`npm run typecheck` + `npm test` 全绿 ⇒ **commit（S-107 独立一刀）**

### 第四部分：S-108（取证后实施）

- [ ] 步骤 13 —— 取 DIAG 日志（**老大提供**），按结论二选一：
  - `contextLength=200000` ⇒ 修 payload 链（`resolveSendModel` 兜底置 null / 模型 id 对不上）
  - `contextLength=384000` ⇒ 修后端算式（阈值 / reserved / buffer）
  - **验证**：结论与证据一并写进实施记录
- [ ] 步骤 14 —— **不论结论如何都要做**：payload 层 `contextLength` 缺失时**显式告警**（不再静默 undefined）
  - 位置：`lib/agent/provider-payload.ts:75` 或 `use-chat-actions.ts` 的调用侧
  - **验证**：构造 `modelId` 无效场景，确认能观察到告警
- [ ] 步骤 15 —— 按步骤 13 结论修复 + 复验 + 需求提交
  - **验证**：`npm run typecheck` + `npm test` 全绿 ⇒ **commit（S-108 独立一刀）**

### 附（非实施，只读产出）

- [ ] 步骤 16 —— 出「遗留测试工程体量」现状清单（待登记 #12）：工程名 / 断言数 / 是否被 `run-tests.mjs` 收编 / 最后一次改动时间
  - **只读，不删任何工程**；清单写进 `raw-requirements.md` 的待登记 #12 下，等老大裁定去留

## 涉及文件

| 文件 | 动作 |
|---|---|
| `src/runtime/WishfulClaw.Agent/AgentRuntimeProjectExecutor.cs` | 改（步骤 1） |
| `tests/WishfulClaw.SessionTaskCascadeRegressionTests/**` | 改（步骤 2） |
| `src/renderer/src/components/updater/UpdateDialog.tsx` | 改（步骤 4） |
| `src/renderer/src/locales/{zh,en}/settings.json` | 改（步骤 5） |
| `src/renderer/src/stores/settings-store.ts` | 改（步骤 7） |
| `src/renderer/src/lib/agent/context-compression-config.ts` | 改（步骤 8） |
| `src/renderer/src/components/settings/RuntimePanel.tsx` | 改（步骤 9） |
| `src/renderer/src/stores/chat-store/index.ts` | 改（步骤 10） |
| `src/renderer/src/components/chat/InputArea/context-ring.tsx` | 改（步骤 11） |
| `src/renderer/src/lib/agent/provider-payload.ts` | 改（步骤 14，主落点） |
| `src/renderer/src/hooks/use-chat-actions.ts` | 改（步骤 14 备选落点，与上一行**二选一**） |
| `docs/plans/iter-v2-34/raw-requirements.md` | 改（步骤 16 只读清单落点；按提交纪律**不单独成刀**） |

## 参考源码

| 项目 | 路径 | 参考什么 |
|---|---|---|
| 本仓 | `stores/settings-store.ts` 的 `contextCompressionThreshold` 全链 | S-107 的字段 + persist 范式 |
| 本仓 | `context-compression-config.ts:92-111` | S-107 的 0 哨兵 + 回落全局范式 |
| 本仓 | `DbSessionTools.cs:87-133` | S-115 的「列清单对齐 schema」正例 |
| OpenCowork | `D:\koda\OpenCowork\src\renderer\src\components\layout\TitleBar.tsx` | S-109 仅作按钮语义对照（不搬代码） |

**不抄清单**：S-108 不照抄任何参考项目的窗口兜底（我们后端 `DefaultContextCompressionLimit` 是自有常量）。

## 风险与回退

| 风险 | 处置 |
|---|---|
| S-115 改动后老库仍崩 | 先确认真机库的 `PRAGMA table_info(sessions)` 里 `model_selection_mode` 的 notnull/default；补列后 `create_session` 必须实跑通过 |
| S-115 测试抓不到真 bug | 步骤 2 明确要求「补前先跑一次确认 FAIL」，抓不到就换断言点 |
| S-107 字段没进 `partialize` | 步骤 7 显式验证（S-111 踩过） |
| S-107 全局值被后端同样忽略 | **S-108 未结案前不实施 S-107 的盖章改动**（步骤 10）；若 S-108 结论是 payload 丢字段，先修 S-108 |
| S-109 删「稍后」影响已下载态的出口 | 已下载 / 安装态是**另一个分支**（`isFinished`），那里仍有「稍后」，不受影响 |
| S-108 无日志无法推进 | 退化为只做步骤 14（告警），S-108 挂账等真机复现 |

## 提交节奏

- 步骤 3 完成 ⇒ **commit 1：S-115**
- 步骤 6 完成 ⇒ **commit 2：S-109**
- 步骤 15 完成 ⇒ **commit 3：S-108**（走退化路径、只做步骤 14 时同样在此成刀）
- 步骤 12 完成 ⇒ **commit 4：S-107**（其步骤 10 须在 S-108 结案后落地，故排在后）
- 迭代收尾再一刀「审查与验证修复调整」
- **迭代内一律不 push**；步骤 16 的清单属文档产出，**不单独提交**，攒进收尾那一刀
