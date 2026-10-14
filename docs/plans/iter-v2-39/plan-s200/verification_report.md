# S-200 验证报告（阶段六）

> 验证人：**独立 subagent**（`test-automator`，16 次工具调用）。
> 验证对象：提交 **`ce182e52`**（S-200 首刀）+ **`bae36640`**（审查修订）—— 两者均在 HEAD 历史内，验证的是 HEAD 代码。
> 判据依据：[`../requirements/S-200.md`](../requirements/S-200.md) §四（8 条验收判据）。
> 验证方式：**只读 + 跑测试**（读源码 / 编译 / 运行套件），未改任何文件、未提交。
> 出报告：2026-10-14。
> **VERDICT：`PASS`** —— 判据 1~7 全绿；判据 8 按指示只跑 2/4 腿（均绿），其余 3 腿归入迭代收尾的门禁复跑。

---

## 环境前置（已核）

- **无开发实例占用 dll**：`Get-CimInstance Win32_Process -Filter "Name='WishfulClaw.Worker.exe'" | Where-Object { $_.ExecutablePath -like '*\bin\Debug\*' }` → **空输出**。
- `git rev-parse HEAD` = `8ffd38b4…`；`ce182e52`（首刀）与 `bae36640`（审查修订）均在历史内。
- 自证只读：本轮只读源码 / 跑编译与测试，未产生任何新增改动。

---

## 8 条判据逐条

| # | 判据 | 结论 | 证据 |
|---|---|---|---|
| **1** | `Grep` 传真实文件 ⇒ 命中且行前缀是文件名 | ✅ PASS | 断言 #1（4 条）：`!IsError` + `Content.StartsWith("top.json:1:")` + 不含绝对路径 + 无 `not found` |
| **2** | `Grep` 传不存在路径 ⇒ 说「路径不存在」，无 `Directory not found` | ✅ PASS | 断言 #4：`IsError` + `Contains("Path not found")` + `!Contains("Directory not found")`。另 `git grep -n "Directory not found" -- src/runtime` → **0 命中** |
| **3** | `Grep` 真实文件 + 不匹配 `file_pattern` ⇒ 仍返回匹配 | ✅ PASS | 断言 #2：`!IsError` + `StartsWith("top.json:1:")`（pattern `*.ts` 被忽略） |
| **4** | `Glob` 传真实文件 ⇒ 报「是文件，不是目录」 | ✅ PASS | 断言 #10：`IsError` + `Contains("Not a directory")` + `!Contains("Directory not found")` |
| **5** | `LS` 传真实文件 ⇒ 报「是文件，不是目录」 | ✅ PASS | 断言 #13：同上形状 |
| **6** | 回归护栏：三工具传目录行为一字不变 | ✅ PASS（1 处无直接断言，见下） | 断言 #5（以 root 为基准、无绝对路径）/ #6（`file_pattern` 全拒提示仍触发）/ #9（`node_modules` 默认排除仍生效）/ #12（`Glob **/*.txt` 命中 `sub/inner.txt`）/ #15（`LS` 列出 `top.json`）。**源码 diff 核证**：`FileListTool.cs` / `GlobTool.cs` 改动**全部落在 `!Directory.Exists(root)` 错误分支内**，目录模式零改动；`GrepTool.cs` 仅新增单文件判定 + `searchBase`，二进制扩展名清单**逐字一致**（抽成 `IsBinaryExtension`，行为等价） |
| **7** | 回归护栏：`Grep` 传 `node_modules` 仍能搜到 | ✅ PASS | 断言 #8：`path=<tmp>/node_modules` ⇒ `!IsError` + `Contains("pkg/index.js:1:")` |
| **8** | 门禁四绿 | ⚠️ PARTIAL（按指示仅跑 2/4 腿） | `dotnet build src/runtime/WishfulClaw.sln` → **0 警告 0 错误**（3.32s）✅；本套件 37/37 ✅。**typecheck / `npm test` 全量 / 官网 build 未跑**（指示明确排除） |

---

## 套件运行实测

- 编译：`dotnet build tests/WishfulClaw.SearchToolTargetRegressionTests/…csproj` → 0 警告 0 错误；过程中 `WishfulClaw.Agent.dll` 被重新生成（确保非旧产物）。
- 运行：`…/bin/Debug/net11.0/WishfulClaw.SearchToolTargetRegressionTests.exe` → **`passed: 37, failed: 0`**，退出码 0。
- 断言数：**37**（`ce182e52` 首刀 35 → `bae36640` 收紧为 37）。套件内 15 组断言覆盖 8 条判据；另含 2 条超出 §四 的加固断言（#3 单文件无命中 ⇒ 恰为 `No matches found.`；#7 二进制单文件 ⇒ 报含 "binary" 的错误）。
- 注册核证：`tests/WishfulClaw.Tests.sln` 含 **18** 个 `*RegressionTests` 工程（与「17 → 18」相符）。

---

## 未能自动验证的项

1. **判据 8 的其余 3 腿**：`npm run typecheck`、`npm test` 全量、官网 `npm run build` —— 归入迭代收尾的门禁复跑那一步。
2. **判据 6 中「`LS` 条目上限」**：套件未对 `MaxItems=100` 上限做断言（#15 只验列表含 `top.json`）。以源码核证其未被 diff 触碰 ⇒ 行为不变可信，但**无自动断言背书**。
3. **断言的「非恒真」性**：`bae36640` 提交信息称已用变异法自证 #1/#2/#5 非恒真，但该证伪过程需改代码，只读模式下无法复现。

---

## 新发现的问题

**无**（S-200 范围内未发现缺陷）。

> **环境提示（非 S-200 问题）**：验证时工作树并非干净 —— 有 14 个 tracked 文件处于已修改未提交状态（`DbMessageCompactTools.cs` / `DbPluginSessionTools.cs` / `en|zh chat.json` / `session-slice.ts` / `website/src/lib/site-stats.ts` 等）。`dotnet build sln` 编译的是「HEAD + 这些既有未提交改动」。**S-200 的三个工具文件不在此清单内**，故本次验证结果等价于 HEAD 代码。这些改动非验证 subagent 产生。
