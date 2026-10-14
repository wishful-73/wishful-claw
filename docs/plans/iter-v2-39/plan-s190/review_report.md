# S-190 代码审查报告

> 审查者：独立 subagent（阶段五「审查」）｜日期：2026-10-12｜分支 `dev/v2-iter-39`
> 审查对象：S-190「设置页 · 用量统计 · 请求明细增加筛选条」—— **工作区未提交改动**（6 个 `M` 文件，+510 / −21）
> 基准文档：`requirements/S-190.md`、`plan-s190/plan.md`、`plan-s190/compliance_report.md`
> 纪律：**只读审查**（仅 `git status/diff/log`、Read、Grep）。未执行 `git add/commit/push/reset/checkout`；未跑 `npm test` / `npm run typecheck` / `dotnet build`（阶段六职责）。唯一写动作 = 本报告文件。

## 审查范围

| # | 文件 | 改动摘要 |
|---|---|---|
| 1 | `src/renderer/src/components/settings/UsagePanel.tsx` | 筛选 state、`requestUsageLogs` 参数扩容、`filtersRef` 隔离、`modelOptions` 组装、翻页/每页条数带筛选 |
| 2 | `src/renderer/src/components/settings/usage-detail-table.tsx` | 工具栏新增 `ModelFilter`（搜索多选）/ `StatusFilter`（含「只看失败」）/ HTTP 状态码输入框；新增 `UsageFilters` / `UsageModelOption` / `modelFilterKey` 导出 |
| 3 | `src/renderer/src/locales/zh/settings.json` | +13 行：`usage.detail.filters.*`（11 键） |
| 4 | `src/renderer/src/locales/en/settings.json` | +13 行：`usage.detail.filters.*`（11 键） |
| 5 | `src/runtime/WishfulClaw.Infrastructure/Db/DbUsageLogQueryTools.cs` | 新增私有 `BuildDetailWhere`；`Logs` 的 `COUNT(*)` 与明细 SELECT 改为共用 |
| 6 | `tests/WishfulClaw.ProviderHeaderRegressionTests/UsageLogChecks.Queries.cs` | 新增 `RunDetailFilterSuite` + `AssertDetailConsistent` + `SeedRequestFor` |

`git status --short` 证据：除上述 6 个 `M` 外，其余全为 `??` 的 iter-v2-39 文档。`DbModule.cs`（端点注册）、`DbClient.cs`（DB schema）、`package.json`、`*.csproj` **均未改动** ⇒ 无新端点、无 schema 变更、无新依赖。

---

## 逐项审查

### 1. 前后端参数契约一致

**判据**：`db/usage-logs` 实际接收的参数名/类型，与渲染端请求体逐字段一致（`models` 的 `providerId<US>modelId` 编码、US 字符、空数组省略、`httpStatusCodes` 的 `string[]` 与切分时机）。

**证据**

- 前端发送（`UsagePanel.tsx:140-150`）：
  ```ts
  const params: Record<string, unknown> = { range, limit, offset: page * limit }
  if (filters.models.length > 0) params.models = filters.models
  if (filters.status.length > 0) params.status = filters.status
  const httpStatusCodes = parseHttpStatusCodes(filters.httpStatusCodes)
  if (httpStatusCodes.length > 0) params.httpStatusCodes = httpStatusCodes
  ```
- 切分时机（`UsagePanel.tsx:127-132`）：`parseHttpStatusCodes` 在**发送时**按 `,` 切分 + `trim` + 去空；state 里 `httpStatusCodes` 是 `string`（`usage-detail-table.tsx:70-72` 注释：「单行文本，进请求前按逗号切分」）。契约层是 `string[]` —— 与 plan「参数契约」表一致。
- US 分隔符两端一致：前端 `usage-detail-table.tsx:85` `export const MODEL_FILTER_SEP = '\u001F'`、`:87-92` `modelFilterKey(p, m) = \`${p ?? ''}${SEP}${m ?? ''}\``；后端 `DbUsageLogQueryTools.cs:329` `models[i].Split('\u001F', 2)`，`:330-331` 取 `parts[0]`/`parts[1]`。
- 后端取参：`DbUsageLogQueryTools.cs:321`（`models`）、`:340`（`status`）、`:352`（`httpStatusCodes`）全部走 `JsonHelpers.GetStringArray`（`JsonHelpers.cs:111-140`：支持 JSON 数组与逗号串两条分支，非数组/非字符串回落空数组）。
- 省略语义一致：前端**不发**空数组（`:146-149` 三个 `if` 才赋值）；后端**空数组 = 不加条件**（`:322` / `:341` / `:363` 三个 `Length > 0` / `Count > 0` 守卫）。

**结论**：✅ 逐字段一致（参数名 `models` / `status` / `httpStatusCodes` 与 C# 读取名全等；编码、分隔符、空数组语义、切分时机均对齐）。

### 2. 只作用于「请求明细」表（上方 4 个端点不重取）

**判据**：筛选变化不得触发 `overview` / `buckets` / `model-buckets` / `by-model` 重取；只有 `range` 变化才重取概览。

**证据**

- `load`（整面板刷新）定义于 `UsagePanel.tsx:182-231`，`useCallback(..., [])`（`:230`）—— 依赖数组**为空**，不捕获 `filters`。
- 明细请求在 `load` 内读 ref：`:206` `requestUsageLogs(next, detailPage, detailLimit, filtersRef.current)`。
- `filtersRef` 声明 `:176`，仅在 `handleFiltersChange`（`:273`）里写入；`filters` state 的**唯一**修改入口也是 `:272`，故 ref 与 state 恒同步。
- 面板 effect：`:280-286` `useEffect(..., [load, range])`，`load` 引用稳定 ⇒ 实际只随 `range` 变。
- `handleFiltersChange`（`:270-278`）只调 `loadLogsPage(range, 0, logsPageSize, next)`（`:275`），**不调 `load`** ⇒ 上方 4 端点不被触碰。
- C# 侧：`git diff` 仅命中 `Logs`（`:261-305`）与新函数 `BuildDetailWhere`（`:314-375`）；`Overview` / `Buckets` / `ModelBuckets` / `ByModel` 的 SQL 行（`:58` / `:112` / `:163` / `:230`）**零 diff**。
- `by-model` 仅被**读取**：`UsagePanel.tsx:202-205` 拉取 → `:300-310` 组装 `modelOptions`（`:42` plan 口径），其查询本体未改。

**结论**：✅ 满足「筛选只作用明细表」；`filtersRef` 是有效的隔离手法，注释（`:174-175`）准确说明了动机。

### 3. C# WHERE 构造正确性

**判据**：`COUNT(*)` 与明细 SELECT 必须共用同一 WHERE（否则 total 与 rows 口径漂移）；空数组不加条件；非法状态码丢弃；**全部参数化绑定**。

**证据**

- 共用：`DbUsageLogQueryTools.cs:272-273` 构造一次 `filterArgs` + `detailWhere`；COUNT 用 `:275-278`（`$@"… WHERE {detailWhere};"` + `filterArgs.ToArray()`）；SELECT 用 `:280-296`（`WHERE {detailWhere}` + `[.. filterArgs, $limit, $offset]`）。
- 基础窗口段 `:317-319`（`started_at >= $from AND started_at < $to` + 两个 `SqliteParameter`），与改动前的硬编码 WHERE 语义等价。
- 模型段 `:321-338`：SQLite 无行值 IN，展开为 `(provider_id = $m{i}p AND model_id = $m{i}m)` 的 `OR` 组 —— 与 plan 第 33 行的契约写法一致。
- 状态段 `:340-350`：`status IN ($st0, …)`。
- 状态码段 `:352-372`：先 `int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var code)` 过滤（`:358`），再 `http_status_code IN ($hs0, …)`（`:371`）—— 与 DB 列类型一致（`DbClient.cs:441` `http_status_code INTEGER`）。
- 参数化：`:318-319`、`:333-334`、`:347`、`:369` 全部 `new SqliteParameter(...)`；SQL 文本里只有 `$m{i}p` 这类**占位符名**与固定列名，**无任何字符串拼接进 SQL 的值** ⇒ 无注入面。

**结论**：✅ 两处共用同一 WHERE、空数组不加条件、非法码丢弃、全参数化绑定，无 SQL 注入风险。`total` 与 `rows` 不可能口径漂移。

> 观察（非阻断）：`filterArgs` 里的 `SqliteParameter` 实例被 COUNT 与 SELECT 两条命令先后复用。Microsoft.Data.Sqlite 下顺序复用同一参数对象是常见可行的；本需求新增的单测（下述第 7 项）恰好走到这条路径，可作为运行时佐证 —— 但本次审查未运行测试，**留阶段六确认**。

### 4. 状态码语义

**判据**：精确匹配多值（`IN` 或等价）；前端切分/清洗与后端解析一致。

**证据**

- 后端 `:371` `http_status_code IN (...)` = 精确匹配多值 ✅（非 `LIKE`、无模糊）。
- 前端清洗 `usage-detail-table.tsx:420-425`：`event.target.value.replace(/[^\d,\s]/g, '')`（只留数字/逗号/空白）；发送时 `parseHttpStatusCodes`（`UsagePanel.tsx:127-132`）按 `,` 切分、`trim`、去空 ⇒ `429, 503` → `['429','503']`。
- 后端 `int.TryParse` 能处理前后带空白的项（`NumberStyles.Integer` 允许前导/尾随空白）⇒ 前后端对「逗号 + 空格」输入口径一致 ✅。
- 非数字项丢弃（不报错）：`:356-361` 注释与实现一致；单测 `:237-241` 断言 `['not-a-code','429']` 只命中 1 条。

**结论**：✅ 语义与需求一致。

### 5. i18n 键齐全

**判据**：zh / en 新增键**集合完全一致**；组件引用的每个 `usage.detail.filters.*` 都存在于两个语言文件。

**证据**

- zh `settings.json:1832` / en `settings.json:1693` 起各新增 `filters` 节点，均为**同一 11 键**（逐键比对 diff，两文件键名与顺序全等）：`model` / `modelCount` / `modelSearch` / `modelEmpty` / `status` / `statusCount` / `statusSuccess` / `statusError` / `onlyFailed` / `httpStatusPlaceholder` / `httpStatusHint`。
- 引用侧（组件）实测 11 处：`modelCount:245`、`modelSearch:256`、`statusCount:314`、`status:318`/`324`、`statusSuccess:332`、`statusError:340`、`onlyFailed:348`、`httpStatusPlaceholder:426`、`httpStatusHint:429`，另 `model`（`:247-248`）/ `modelEmpty`（`:263`）—— 与定义件一一对应，**无孤儿键、无缺键**。
- 既有门禁 `tests/i18n-coverage/program.ts` 正是「代码引用集 vs 文件定义集」+「zh vs en」双向比对（该文件 `:6-16` 注释自述其存在理由）⇒ 阶段六会自动复验。

**结论**：✅ 键集一致、无错键（组件全部带 `defaultValue` 兜底，风险进一步降低）。

### 6. 交互细节

**判据**：筛选变化重置页码为第 1 页；翻页 / 改每页条数**带着当前筛选**请求。

**证据**

- 重置页码：`UsagePanel.tsx:274` `setLogsPage(0)`（与 `:275` 的取数一起）。
- 翻页带筛选：`:486` `onPageChange={(page) => void loadLogsPage(range, page, logsPageSize, filters)}` —— 用 `filters` state（当前值）。
- 改每页条数带筛选：`:487-490` `onPageSizeChange={(size) => { setLogsPageSize(size); void loadLogsPage(range, 0, size, filters) }}`。
- 越界回退也带筛选：`loadLogsPage` 内 `:245` 与回退分支 `:251` 均传 `activeFilters` ⇒ 筛选变窄后当前页越界时会回落到正确页且**筛选不丢**（正是需求 §五 点名的易回归处）。
- 刷新按钮 `:344` 走 `load(range, logsPage, logsPageSize)`，内部读 `filtersRef.current` ⇒ 手动刷新同样保留筛选。
- 清空筛选回全量：空数组在两侧均为 no-op（第 1、3 项证据）。

**结论**：✅ 页码重置、翻页/改条数携带筛选、越界回退三处均正确。

### 7. C# 单测质量

**判据**：用例真正断言筛选行为；覆盖单条件 / 多条件 / 空筛选 / 非法状态码。

**证据**（`UsageLogChecks.Queries.cs`）

- 挂载：`:173` 在既有 `Logs` 用例末尾调用 `RunDetailFilterSuite()`。
- 直接驱动端点：`:193` / `:200` / `:206` / `:213` / `:225` / `:237` / `:244` 均 `Invoke(DbUsageLogQueryTools.Logs, …)`，`Invoke`（`UsageLogFixtures.cs`）是 `JsonSerializer.Serialize(params)` → `JsonElement` → 真调端点 → 解析 `result` 的**真实链路**，非桩。
- 关键断言（有具体数值，非「跑而不挂」）：
  - ① `:193-198` 模型对 `prov-1\u001Fmodel-a` ⇒ `total == 2`，并显式断言「同 modelId 不同 provider **不互相匹配**」；
  - ② `:200-204` `status=['error']` ⇒ `total == 2`；
  - ③ `:206-211` `httpStatusCodes=['429','503']` ⇒ `total == 3`；
  - ④ `:213-222` 三项叠加 ⇒ `total == 1`（交集语义）；
  - ⑤ `:225-233` 空数组三参数 ⇒ `total == 5`（全窗口，非报错、非静默全选）；
  - ⑥ `:237-241` `['not-a-code','429']` ⇒ `total == 1`（丢弃非法项）；
  - ⑦ `:244-246` `status=['error'], limit=1` ⇒ `total == 2 && rows == 1`（筛选同时作用于 total 与当前页）。
- 每个用例另跑 `AssertDetailConsistent`（`:249-254`，`total == rows`）钉住「COUNT 与明细一致」这一本需求最易回归的点。
- 造数 `SeedRequestFor`（`:256-…`）通过 `DbUsageLogTools.Insert` 写入真实表，并在 suite 开头 `Reset()`（`:185`，`UsageLogFixtures.cs` 的 `DELETE FROM request_usage_logs;`）。

**结论**：✅ 覆盖 4 类要求场景 + 交集 + 分页不变式，断言具体、可失败、真跑端点。

### 8. 代码规范

**判据**：命名、注释密度与准确性、文件行数（代码 200~500 为宜）、无新增依赖。

**证据**

- 命名与注释：`BuildDetailWhere` / `MODEL_FILTER_SEP` / `modelFilterKey` / `parseHttpStatusCodes` 语义直白；`BuildDetailWhere` 的 `<summary>`（`:307-313`）准确点出「两处共用防漂移」「空数组不加条件」；模型段注释（`:327-328`）解释了「同 modelID 多 provider 会混」的动机。注释与实现一致，**无过时描述**。
- 无新增依赖：`package.json`（`cmdk ^1.1.1` / `radix-ui ^1.6.4` 均已存在）、`*.csproj`、`DbModule.cs`、`DbClient.cs` 无 diff；新用到的 `ui/popover.tsx`、`ui/command.tsx`、`ui/dropdown-menu.tsx` 都是仓库既有组件。
- **文件规模超口径**：`DbUsageLogQueryTools.cs` HEAD 513 行 → **582** 行；`usage-detail-table.tsx` HEAD 420 → **643** 行；`UsagePanel.tsx` HEAD 467 → **530** 行。三者在 `plan.md` §风险 与 `dev-workflow.md`（「每个文件 200~500 行为宜」）的口径外，且 plan §风险 已写明「若实施后超 500 行 ⇒ 拆出 `DbUsageLogQueryTools.Filters.cs`」——触发条件已满足但未执行；plan 另把该文件基线误记为「已 300+ 行」（实测 HEAD 已达 513 行）。见问题 #1。
- 类型安全：`UsageFilters` / `UsageModelOption` 显式导出并双端复用（`UsagePanel.tsx:6-12` import），props 全量标注，无 `any`。

**结论**：⚠️ 命名/注释/依赖均无问题；**行数超口径**（3 个代码文件），记 ⚠️ #1。

### 9. 遗漏检查

**判据**：模型选项来源是否仍按全局窗口、选项是否去重、无数据时下拉行为、以及其它该改未改的落点。

**证据**

- `by-model` 仍按全局窗口返回（`DbUsageLogQueryTools.cs:212` `ResolveWindow(parameters)`、`:231` `WHERE started_at >= $from AND started_at < $to`，无筛选注入）✅ 与需求 §四 口径一致。
- 选项去重：`UsagePanel.tsx:301-305` 用 `Set<string>` 按 `modelFilterKey` 去重 ✅。
- 无数据时下拉：`options` 为空 ⇒ `CommandEmpty`（`usage-detail-table.tsx:261-264`）显示「无匹配模型 / No matching models」✅。
- 展示文案：`:308` `` `${providerLabel(...)} · ${row.modelId}` `` = 「服务商 · 模型」，与需求 F1 一致 ✅。
- 「只看失败」快捷：`usage-detail-table.tsx:343-350` `onSelect={() => onChange(['error'])}` ✅。
- **边界发现**：选项来源 `by-model` 把 NULL 显示化后再映射：`:220`/`:235` `COALESCE(provider_id,'(unknown)')` → `reader.GetString(0) == "(unknown)" ? null : …`（**只映射 providerId**，`model_id` 保留字面量 `(unknown)`，`:236`）。当前端用 `modelFilterKey(null, modelId)` 生成键，后端展开为 `provider_id = '' AND model_id = …`，对 DB 中 `provider_id IS NULL` 的行（列可空，`DbClient.cs:435` `provider_id TEXT`）**永不命中** ⇒ 用户选中该模型选项会得到 0 条，与列表上明明有流量相矛盾。见问题 #2。

**结论**：⚠️ 主链路无遗漏；`(unknown)`/NULL 边界存在不一致（#2）。

---

## 问题汇总

| # | 级别 | 位置（文件:行号） | 问题 | 建议 |
|---|---|---|---|---|
| 1 | ⚠️ | `DbUsageLogQueryTools.cs:307-375`（582 行）、`usage-detail-table.tsx:213-433`（643 行）、`UsagePanel.tsx:126-310`（530 行） | 三个代码文件超出 plan/dev-workflow 的「200~500 行」口径；plan §风险 已写明「超 500 行 ⇒ 拆出 `DbUsageLogQueryTools.Filters.cs`」，触发后未执行（且 plan 把基线误记为「300+ 行」，实测 HEAD 已 513 行） | 补一刀：把 `BuildDetailWhere` 移到新建 `DbUsageLogQueryTools.Filters.cs`（同类 `partial`，与现有 `UsageLogChecks.Queries.cs` 拆分惯例一致）；渲染端可将 `ModelFilter`/`StatusFilter`/状态码输入框抽到 `usage-detail-filters.tsx`。或在本需求内明确记录豁免理由 |
| 2 | ⚠️ | `UsagePanel.tsx:300-310` ↔ `DbUsageLogQueryTools.cs:220,235-236` ↔ `:329-334` | 模型选项源自 `by-model` 的「NULL → `(unknown)` → `null`」显示化值：选中此类选项时前端发 `"\u001FmodelId"`，后端展开成 `provider_id = '' AND …`，对 `provider_id IS NULL` 的行永不命中 ⇒ 选项可点但必得 0 条 | 二选一：① `modelFilterKey` 为空 provider 时用哨兵（如 `""`→`IS NULL`），后端 `BuildDetailWhere` 对该哨兵生成 `provider_id IS NULL`；② 选项侧过滤掉 providerId 为 `null` 的行并在 UI 给「未知服务商」提示 |
| 3 | ⚠️ | `usage-detail-table.tsx:423` + `UsagePanel.tsx:127-132` + `DbUsageLogQueryTools.cs:352-362` | 输入清洗保留空白：`replace(/[^\d,\s]/g,'')` 未去中间空格，`"4 29"` 会被前端当作有效 token 发出（判定「有筛选」），后端 `int.TryParse` 丢弃 ⇒ **静默无过滤**，界面却显示筛选已生效 | 清洗改 `/[^\d,]/g`（去掉 `\s`），或在 `parseHttpStatusCodes` 里先 `replace(/\s+/g,'')`；若想更稳，后端对「收到非空但全部被丢弃」可考虑返回提示字段 |

---

## 正面记录

1. **最容易回归的点被正面钉死**：`BuildDetailWhere` 抽成单一函数供 `COUNT(*)` 与明细 SELECT 共用（`DbUsageLogQueryTools.cs:272-296`），并用 7 个用例的 `AssertDetailConsistent` 断言 `total == rows` —— 正是需求 §五 与 §六 点名要求的那条不变式。
2. **隔离手法干净**：`filtersRef`（`UsagePanel.tsx:176`）避免把 `filters` 塞进 `load` 依赖，从根上杜绝「改筛选顺带重取上方 4 端点」；注释把「为什么用 ref」写清楚了。
3. **改动面与口径严守**：`git diff` 证明 `Overview`/`Buckets`/`ModelBuckets`/`ByModel` 零改动，`by-model` 只读；无新端点、无 schema 变更、无新依赖。
4. **参数化彻底**：所有值走 `SqliteParameter`，IN 列表按元素数动态生成占位符（`$m0p` / `$st0` / `$hs0`），无一处值拼接进 SQL。
5. **越界回退带筛选**（`:249-253`）：筛选变窄后页码越界这一「副作用路径」被主动覆盖，说明作者预判到了交互链路。
6. **i18n 双语言同步且键集全等**，组件全部带 `defaultValue` 兜底，配合既有 `tests/i18n-coverage` 门禁形成闭环。
7. **单测是真链路 + 具体数值**：`Invoke` 走 `JsonSerializer.Serialize` → 端点 → 结果解析（`UsageLogFixtures.cs`），每个用例都断言具体条数，能真正失败。

---

## 结论

**❌ 0 项 / ⚠️ 3 项。**

- 无阻断问题：契约一致（#1 项）、作用范围严格（#2 项）、WHERE 共用且全参数化（#3 项）、语义正确（#4 项）、i18n 齐（#5 项）—— 均通过。
- 3 个 ⚠️ 分别为「文件超 500 行」（可维护性/与 plan 自身约定的偏差）、「`(unknown)`/NULL 模型选项永不命中」（边界功能瑕疵）、「状态码中间空格致静默无过滤」（输入清洗瑕疵），均**不阻断验证**，建议在验证态前后择机处理。

⇒ **可以进入验证态**（阶段六：`npm run typecheck` / `npm test` / `dotnet build src/runtime/WishfulClaw.sln` 三门禁 + 实机 7 项 + 「切按模型图确认上方数字未受影响」）。
