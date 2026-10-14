# Plan: S-190 —— 设置页 · 用量统计 · 请求明细增加筛选条件

> 归口：`docs/plans/iter-v2-39/requirements/S-190.md`（原文 / 现状 / 筛选集合 / 作用范围已定）。
> 口径：12:34 筛选集合 3 项；12:37 纳入 39（体验优化）；**13:42 作用范围 = 只作用明细表，上方概览保持全局条件**。
> 开工：老大 2026-10-12 18:32「39迭代内没做的需求 都根据开发工作流开始推进」。

## 目标

给「请求明细」表加 **3 个筛选条件**（模型 / 状态 / HTTP 状态码），**只作用于明细表**；上方概览数字、折线 / 柱状图、按模型汇总**一律保持全局口径**（只受时间窗口影响）。

## 已拍定的实施契约（开工前先钉死，避免实施漂移）

### 参数契约（`db/usage-logs` 新增 3 个可选参数）

| 参数 | 类型 | 取值 | 说明 |
|---|---|---|---|
| `models` | `string[]` | 元素 = `providerId + "\u001F" + modelId` | **US 分隔符**（`\u001F`）：模型名与 providerId 都可能含 `-` `_` `.` `/` `:`，用 US 零歧义、**无需 JSON 解析** |
| `status` | `string[]` | `"success"` / `"error"` | 值域与 `DbUsageLogQueryTools` 内既有聚合口径一致（`:47-48`） |
| `httpStatusCodes` | `string[]` | 数字字符串，如 `["429","503"]` | C# 侧 `int.TryParse`，**解析失败的项丢弃**（不报错）。⚠️ 前端 UI 侧它是**一个文本输入框**（state 为 `string`），发送时才按逗号切分成数组 —— 契约层是 `string[]`，两者不矛盾 |

取参一律走已有助手 `JsonHelpers.GetStringArray`（`src/runtime/WishfulClaw.Core/Protocol/JsonHelpers.cs:111`）⇒ **不动协议层**。

### 共用 WHERE 构造（**本需求最容易回归的点**）

`DbUsageLogQueryTools.Logs` 现在 `COUNT(*)`（`:272-276`）与明细查询（`:278-297`）**各自硬编码** `WHERE started_at >= $from AND started_at < $to`。**必须抽成一个共用函数**，两处共用，否则 `total` 与 `rows` 口径不一致、**一翻页就飘**：

```csharp
private static string BuildDetailWhere(
    JsonElement parameters, UsageWindow window, List<SqliteParameter> args)
```

- 基础段：`started_at >= $from AND started_at < $to`（参数 `$from` / `$to`，沿用现有 `$` 前缀风格）
- `models` 非空 ⇒ `AND (((provider_id = $m0p AND model_id = $m0m)) OR ((...)))` —— **SQLite 不支持行值 IN**，必须展开成 OR 组
- `status` 非空 ⇒ `AND status IN ($st0, $st1)`
- `httpStatusCodes` 非空 ⇒ `AND http_status_code IN ($hs0, ...)`
- **全部字面量走 `SqliteParameter`**；IN 列表按元素个数动态生成占位符；空数组 = 不加该条件（**不回退成全选、也不报错**）

### 其他钉死的约束

- **不动上方 4 个端点**：`overview` / `buckets` / `model-buckets` / `by-model`（`by-model` 只被**读取**当模型选项来源）。
- **不改 DB**（无迁移）、**不加端点**。
- **模型选项来源** = 当前窗口 `db/usage-by-model` 的返回（`UsagePanel.tsx:173-176` 已在拉），行键天然是 `(providerId, modelId)`。
- **筛选控件内联在工具栏**（「显示列」按钮左侧）。

## 步骤清单

- [x] **步骤 1 —— C# 侧：抽共用 WHERE 构造 + 3 个筛选**
  文件 `src/runtime/WishfulClaw.Infrastructure/Db/DbUsageLogQueryTools.cs`（只动 `Logs`，`:261-306`）：
  - 新增 `BuildDetailWhere(...)`（私有静态），返回 WHERE 片段并把新参数追加进 `args`；
  - `COUNT(*)` 与明细查询**都改用它**；
  - `Logs` 入口读 `models` / `status` / `httpStatusCodes` 三个新参数（用 `JsonHelpers.GetStringArray`）。
  - **验证检查点**：`dotnet build src/runtime/WishfulClaw.sln` 0 错误；`git diff` 确认 `Logs` 外的方法（`Overview` / `Buckets` / `ModelBuckets` / `ByModel`）**零改动**。

- [x] **步骤 2 —— C# 单测：钉住「COUNT 与明细口径一致」**
  文件 `tests/WishfulClaw.ProviderHeaderRegressionTests/UsageLogChecks.Queries.cs`（沿用现有 `UsageLogFixtures` 造数）：
  - 断言：**同一组筛选**下 `COUNT(*)` == 明细查询实际命中行数（跨页合计）；
  - 覆盖 `models` 组合（同 modelId 不同 providerId **不得互相匹配**）、`status`、`httpStatusCodes` 多值、以及**三项叠加**。
  - **验证检查点**：`npm test` 全绿且 C# 用例数 **由 17 增加**（新增用例计入 68 基线 → 新基线）。
    - ⚠️ **2026-10-12 实施后订正**：实际**未增加套件数** —— 断言以 `RunDetailFilterNullSuite()` **并入既有 `ProviderHeader` 套件**（`UsageLogChecks.Queries.cs:182`，由 `RunDetailQuerySuite()` 调用）⇒ **C# 套件仍 17、总数仍 68**。原「由 17 增加」的预期作废。

- [x] **步骤 3 —— 渲染端：`UsagePanel.tsx` 筛选状态 + 参数组装**
  文件 `src/renderer/src/components/settings/UsagePanel.tsx`：
  - 加筛选 state（`models: string[]` / `status: string[]` / `httpStatusCodes: string`）；
  - `requestUsageLogs`（`:120-130`）签名扩容，带上 3 个参数（`httpStatusCodes` 在**前端按逗号切分并 trim**，空串不发）；
  - **翻页 `onPageChange`（`:423`）必须带上筛选**；`loadLogsPage`（`:204-232`）里「越界回退到最后一页」那段**同样带筛选取数**（筛选变窄后当前页码大概率越界，正好复用）；
  - 向下传 `modelOptions`（`usageByModel` 的行键）。
  - **验证检查点**：`npm run typecheck` 0 错误。

- [x] **步骤 4 —— 渲染端：`usage-detail-table.tsx` 工具栏控件**
  文件 `src/renderer/src/components/settings/usage-detail-table.tsx`：
  - props 扩 `filters` / `onFiltersChange` / `modelOptions`；
  - 工具栏「显示列」按钮**左侧**加：模型多选（搜索式，展示 `服务商 · 模型`）/ 状态（成功 / 失败 + 「只看失败」快捷）/ HTTP 状态码文本输入框；
  - **不改**现有列显示逻辑与分页逻辑。
  - **验证检查点**：`npm run typecheck` 0 错误。

- [x] **步骤 5 —— i18n**
  文件 `src/renderer/src/locales/zh/settings.json` + `src/renderer/src/locales/en/settings.json`：
  - 在 `usage.detail.*` 下**新增 `filters` 节点**（与 `columns` / `pagination` 同级），**中英同步**。
  - **验证检查点**：两个 json 键集**完全一致**（可用脚本对比键路径）。

- [x] **步骤 6 —— 门禁**
  - `npm run typecheck` 0 错误（三配置）；`npm test` 全绿（新基线，见步骤 2）；`dotnet build src/runtime/WishfulClaw.sln` 0 警告 0 错误（**先读 `dev-workflow.md` §「编译环境」**）。
  - **验证检查点**：三条命令退出码 0。

- [ ] **步骤 7 —— 实机验证（**未执行** —— 无 dev 实例，留验证态）**
  按 `S-190.md` §六 的 7 项：选模型 / 只看失败 / 状态码 / 三项叠加 / 翻页保持 / 清空回全量 / 筛到 0 条出空态；外加**「切到按模型图确认上方数字未受影响」**。
  - **验证检查点**：无 dev 实例则记 **PARTIAL**，逐项写进 `verification_report.md`。

## 涉及文件

- `src/runtime/WishfulClaw.Infrastructure/Db/DbUsageLogQueryTools.cs` — 改（步骤 1）
- `tests/WishfulClaw.ProviderHeaderRegressionTests/UsageLogChecks.Queries.cs` — 改（步骤 2，新增用例）
- `src/renderer/src/components/settings/UsagePanel.tsx` — 改（步骤 3）
- `src/renderer/src/components/settings/usage-detail-table.tsx` — 改（步骤 4）
- `src/renderer/src/locales/zh/settings.json` / `en/settings.json` — 改（步骤 5）
- 只读参照（不改）：`DbModule.cs`（端点注册）、`UsagePanelParts.tsx`

## 参考源码

无（本地功能增补，不涉及 OpenCowork / KodaClaw 搬码）。

## 风险与边界

- **代码文件行数**：`DbUsageLogQueryTools.cs` 已 300+ 行，新增约 40 行 ⇒ 仍在 200~500 行区间内，**不拆**；若实施后超 500 行，按 `dev-workflow.md` §阶段四「大文件拆分」原则拆出 `DbUsageLogQueryTools.Filters.cs`（同类 partial）。
- **刻意不做**：关键字搜索 / 来源筛选 / 只看重试行 / 数值区间 / `session_id` 精确筛选 / 表格排序（`S-190.md` §三 已裁定砍掉）。
- **不做「以上方概览也参与筛选」**：方案 B 已否决（13:42）。
