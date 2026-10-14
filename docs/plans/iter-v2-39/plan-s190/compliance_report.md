# S-190 规划合规报告

> 检查者：独立 subagent；日期：2026-10-12
> 被检文件：`docs/plans/iter-v2-39/plan-s190/plan.md`
> 参照：`requirements/S-190.md`、`docs/dev-workflow.md` §阶段三、`AGENTS.md`

| # | 检查项 | 结论 | 证据 |
|---|---|---|---|
| 1 | 步骤完整覆盖需求目标 | ✅ | 需求三筛选集合 F1 模型 / F2 状态 / F3 HTTP 状态码：步骤 1（C# 侧 3 个可选参数 + 共用 WHERE）、步骤 3（前端筛选 state + 参数组装）、步骤 4（工具栏 3 个控件，含 F2 的「只看失败」快捷、F1 的「搜索式多选 · 服务商 · 模型」）。作用范围（只作用明细表、上方 4 端点不动）由「已拍定的实施契约」+步骤 1 检查点「`Overview`/`Buckets`/`ModelBuckets`/`ByModel` 零改动」钉死；i18n 由步骤 5 覆盖；单测由步骤 2 覆盖需求 §六 的「COUNT 与明细口径一致」 |
| 2 | 每步有明确验证检查点 | ✅ | 步骤 1「`dotnet build` 0 错 + `git diff` 确认 `Logs` 外方法零改动」；步骤 2「`npm test` 全绿 + C# 用例数增加」；步骤 3/4「`npm run typecheck` 0 错」；步骤 5「zh/en 键集完全一致」；步骤 6「三条命令退出码 0」；步骤 7「无 dev 实例记 PARTIAL」——每步可判定 |
| 3 | 文件路径合项目结构 / 分层正确 | ✅ | 改动文件均存在且层级正确：`WishfulClaw.Infrastructure/Db/DbUsageLogQueryTools.cs`（Infrastructure/Db）、`tests/WishfulClaw.ProviderHeaderRegressionTests/UsageLogChecks.Queries.cs`（实测存在）、`renderer/src/components/settings/UsagePanel.tsx` 与 `usage-detail-table.tsx`（实测存在）、`locales/{zh,en}/settings.json`（实测存在）。**分层依赖正确**：plan 取参走 `JsonHelpers.GetStringArray`（Core/Protocol），Infrastructure 依赖 Core 属合法单向依赖（`DbUsageLogQueryTools.cs:5` 已 `using WishfulClaw.Core.Protocol;`）；「不动协议层」判断成立 |
| 4 | 引用的源码文件与行号正确 | ✅ | 逐条实测：① `DbUsageLogQueryTools.Logs` = `:261-306`（实测 `public static WorkerResponse Logs` 在 261，方法收于 306，吻合）；② `COUNT(*)` = `:272-276`（实测吻合）；③ 明细查询 = `:278-297`（实测吻合）；④ 状态聚合口径 `:47-48` = `Overview` 中 `SUM(status='success')`/`SUM(status='error')`（实测吻合，值域 success/error 正确）；⑤ `JsonHelpers.cs:111` = `GetStringArray`（实测方法签名在 111，吻合）；⑥ `UsagePanel.tsx:120-130` = `requestUsageLogs`（吻合）、`:173-176` = 拉 `db/usage-by-model`（吻合）、`:204-232` = `loadLogsPage`（吻合，含越界回退）、`:423` = `onPageChange`（吻合）、`:94-97` = `RANGES`（吻合）、`:378-381` = 三 tab 定义（吻合，实际 378-382）；⑦ `usage-detail-table.tsx:211-240` = 「显示列」工具栏控件（实测 211-242，吻合）；⑧ i18n：`usage.detail` 节点下 `columns`/`pagination` 为同级兄弟（zh settings.json 1806/1811/1824 行实测），plan 拟新增同级 `filters` 成立；⑨ `DbModule.cs:67` = `Register("db/usage-logs", …)`（吻合）；⑩ `UsagePanelParts.tsx` `sourceLabel`（实测第 47 行） |
| 5 | 有无遗漏的调用点 / 消费方 | ✅ | 全仓 `grep usage-logs`（排除 docs）：唯一**调用方**是 `UsagePanel.tsx:125`，唯一**注册点**是 `DbModule.cs:67`；`UsageDetailTable` 只被 `UsagePanel.tsx` 引用（`:6` import、`:416` 使用）。故「改 `db/usage-logs` 入参」的影响面就是 `UsagePanel` 单点，前端无其它处调用，plan 无遗漏。C# 侧 `Logs` 只被 Logs 端点使用，无第二消费方 |
| 6 | 有无需要但未列出的文件改动 | ⚠️ | 主体文件齐备（C# 1 + 测试 1 + 渲染 2 + i18n 2）。两点提示（均非阻断）：① plan 要求「模型多选（搜索式）」，若需新增/抽取一个可搜索多选控件（`components/ui/*`），该文件未在「涉及文件」列出 —— 若复用现有组件则无碍，建议实施前确认并补列；② 「参数契约」表把 `httpStatusCodes` 标为 `string[]`，而步骤 3 前端 state 存 `string`（按逗号切分后发数组），措辞需统一（实现无碍，`GetStringArray` 同时兼容数组与逗号串） |

## 阻断判定
❌ 项数：0（可进入用户确认环节）

## 待决问题
- **测试基线「由 17 增加」无法静态核实**：plan 步骤 2 写「C# 用例数**由 17 增加**」。实测 `tests/WishfulClaw.ProviderHeaderRegressionTests/Program.cs` 的 C# 套件仅打印 `"Provider header regression checks passed."`、**不带计数**，`scripts/run-tests.mjs` 只在套件输出 `passed: N` 时才展示断言数（`:49-52`），故 `npm test` 汇总里的「68」是**套件（目录）数**、非断言数。这个「17」既非 `run-tests.mjs` 输出的套件数也非可静态枚举的断言数，**来源不明、建议实施时以实际 `npm test` 输出为准回填**（不阻断规划方向）。
- **未点名可搜索多选控件的落点**：见第 6 项第 ① 点，建议实施前坐实「复用哪一个现有组件 / 是否新增文件」。
- **i18n 键集一致性有现成门禁**：仓库存在 `tests/i18n-coverage` 套件，plan 步骤 5 的「zh/en 键集完全一致」检查点与之方向一致，实施时可直接以该套件结果佐证（供参考，无需改 plan）。
