# S-181 审查报告（阶段五：审查态）

❌ 0 / ⚠️ 0 / ℹ️ 2（检查项 5 条）

> 被审改动：S-181「`JsonHelpers.GetBool` 宽松解析字符串化布尔（`"true"` / `"false"`，含首尾空白）」
> 分支：`dev/v2-iter-38`（工作区，未提交）
> 改动文件：`src/runtime/WishfulClaw.Core/Protocol/JsonHelpers.cs`（+20）、`tests/WishfulClaw.JsonHelpersRegressionTests/`（新建）、`tests/WishfulClaw.Tests.sln`（+14）
> 依据规范：`docs/dev-workflow.md`（阶段五审查态）、`AGENTS.md`
> 审查方式：只读实读工作区源码 + `git diff` + 命令实测
> 审查人：独立审查 agent（未参与本刀实施）
> 时间：2026-10-09

---

## 结论

**可通过审查，进入验证态。** 5 项检查 ❌ = 0、⚠️ = 0，另 2 条 ℹ️ 为非阻断提示。按 `docs/dev-workflow.md`，❌ = 0 ⇒ 不阻断，允许进入阶段六验证态。

---

## 检查项 1：分层约定 ✅

- **`WishfulClaw.Core` 未被引入不该有的依赖** —— 实读 `src/runtime/WishfulClaw.Core/WishfulClaw.Core.csproj`：`ItemGroup`（:10-12）仅一条 `<ProjectReference Include="..\WishfulClaw.Contracts\WishfulClaw.Contracts.csproj" />`，**无** Agent / Workspace / Infrastructure / 第三方包引用。
- `JsonHelpers.cs:1` 唯一 `using` 为 `System.Text.Json`，未引入其它命名空间。
- **测试工程只引 Core 成立** —— 实读 `tests/WishfulClaw.JsonHelpersRegressionTests/WishfulClaw.JsonHelpersRegressionTests.csproj`：`ItemGroup`（:10-12）仅一条 `<ProjectReference Include="..\..\src\runtime\WishfulClaw.Core\WishfulClaw.Core.csproj" />`，无其它引用、无 NuGet 包。
- 依赖方向：测试工程 → `WishfulClaw.Core` → `WishfulClaw.Contracts`，单向、无环，符合分层（上层测试依赖下层库）。`JsonHelpers` 只暴露 `JsonElement` 入参与原语返回，无上层类型泄漏，只引 Core 足以编译并调用。
- 复核：`dotnet build src/runtime/WishfulClaw.sln` 全绿（见验证报告），说明 Core 独立可编，未因本刀被拉进新依赖。

## 检查项 2：硬编码路径与密钥 ✅

- 对三个改动文件（`JsonHelpers.cs`、`Program.cs`、`.csproj`）执行 `Select-String`，模式 `C:\\ | D:\\ | \\ | password | secret | token | api[_-]?key | temp`（不区分大小写）—— **0 命中**。
- 测试用例全部用内联 JSON 字面量（C# 原始字符串 `"""{"a":"true"}"""`）构造，经 `JsonDocument.Parse` 解析，**无任何文件系统 / 网络 / 环境变量 / 凭据依赖**；`.csproj` 仅声明框架与工程引用，无路径常量。
- 结论：无硬编码路径、无凭据、无临时目录。

## 检查项 3：参考源码逻辑适配 ✅（附 2 条 ℹ️）

- **与兄弟方法宽容度风格一致** —— 实读同文件：`GetIntNullable`（:65）、`GetLongNullable`（:87）、`GetDoubleNullable`（:104）**都已**带 `property.ValueKind == JsonValueKind.String && xxx.TryParse(property.GetString(), out value)` 分支；本刀给 `GetBool` 补上对应的 `JsonValueKind.String => ParseBoolText(...)`（:26）分支，把 `GetBool` 补齐到与兄弟方法同等的「字符串也认」宽容度，方向一致。
- **区域性（culture）无隐患** —— `ParseBoolText`（:42）用 `value.Trim().ToLowerInvariant()`：`ToLowerInvariant()` 使用不变文化，规避土耳其语 I/ı 大小写歧义；`Trim()`（无参）按 `char.IsWhiteSpace`（Unicode 判定）去除首尾空白，安全。
- **`IsNullOrWhiteSpace` 前置判断（:38）** —— 从「结果」看，空串 / 纯空白经 `Trim()` 后同样落 `_ => fallback`，该判断对结果**是冗余的**；但它对 `null` 有真实防护价值（`null.Trim()` 会抛 `NullReferenceException`）。`property.GetString()` 在 `ValueKind == String` 时理论上不返回 null，故这是**防御性写法，非缺陷**，也非有害冗余。判为 ✅。

## 检查项 4：错误处理 / 无行为倒退 ✅

逐分支对照改前（`git diff` 基线）与改后：

| 输入 | 改前行为 | 改后行为 | 是否倒退 |
|---|---|---|---|
| 原生 `true` / `false` | `true` / `false`（`JsonValueKind.True/False`） | **完全不变**（`:24-25`，diff 未动这两行） | 无 |
| 字符串 `"true"` / `"false"`（任意大小写、含首尾空白） | 回落 `fallback` | **正确解析**（`:26 → ParseBoolText`） | 期望变化（本刀目标） |
| 其它字符串（`"yes"` / `"1"` / `"on"` / `""` / 纯空白） | 回落 `fallback` | 回落 `fallback`（`ParseBoolText` 的 `IsNullOrWhiteSpace` 或 `_`） | 无 |
| 数字 / 对象 / 数组 / `null` | 回落（`_ => fallback`） | 回落（`:27 _ => fallback`，未动） | 无 |
| 属性缺失 / 非 object 元素 | 回落 `fallback`（`:18-21`） | **完全不变**（守卫未动） | 无 |

- 未知字符串 → `ParseBoolText` 的 `_ => fallback`；`null` → `IsNullOrWhiteSpace` → `fallback`；非 object / 属性缺失 → 提前 `return fallback`；**全程不抛异常**。
- `_` 兜底分支与原生 bool 分支**一字未动**（diff 仅新增 `JsonValueKind.String` 一行与紧随其后的私有方法），确认无行为倒退。
- 另核：diff 中 `GetString` / `GetInt` / `GetLong` / `GetDouble` / `GetStringArray` / `ResolveEffectiveReasoningEffort` **均未出现在 diff**，一字未动。

## 检查项 5：多余依赖 / 死代码 ✅

- `JsonHelpers.cs`：无未用 `using`（仅 `System.Text.Json`，且被 `JsonElement`/`JsonValueKind` 使用）；改动窄（20 行新增，全在 `GetBool` 及其后一个私有方法内）。
- `Program.cs`：`using System.Text.Json`（`:70 JsonDocument.Parse`）与 `using WishfulClaw.Core.Protocol`（`:71 JsonHelpers`）**均被使用**；无未用变量、无未用成员（`_passed` / `Main` / `RunBoolParsingSuite` / `GetBool` / `Assert*` 全部被调用）。
- 测试目录（非 bin/obj）仅 `Program.cs` + `WishfulClaw.JsonHelpersRegressionTests.csproj` 两个源文件，**无残留临时文件**（`bin/` `obj/` 为正常编译产物）。
- `tests/WishfulClaw.Tests.sln`：新工程 GUID `{6DA97E0D-...}` 实测出现 **13 处**（1 条 `Project(...)` + 12 条 `ProjectConfigurationPlatforms` 配置行），与既有工程注册形态完全一致，无冗余行。

---

## ℹ️ 非阻断提示（2 条）

1. **`IsNullOrWhiteSpace` 对结果冗余**（`JsonHelpers.cs:38`）：删去它（改为直接 `Trim().ToLowerInvariant() switch`）结果不变，但需先确认 `GetString()` 返回非 null；保留亦无碍。可选加注释点明其「防 null」意图。
2. **`Trim()` 宽容度略高于兄弟方法**：`Trim()` 按 Unicode 空白判定，而兄弟方法的 `int.TryParse` / `double.TryParse` 默认只吃 ASCII 空白。方向是「更宽」而非「更严」，无副作用，仅作记录。

---

## 行动项

| 优先级 | 项 | 说明 |
|---|---|---|
| — | 无阻断项 | ❌ = 0，⚠️ = 0，可直接进入阶段六验证态 |

*本报告为阶段五审查态产物；依据规范随 S-181 收尾一并入库。*
