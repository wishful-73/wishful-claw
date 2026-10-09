# Plan-S181：JsonHelpers.GetBool 宽松解析字符串化布尔

> 归属 iter-v2-38。需求正文见 [`../requirements/S-181.md`](../requirements/S-181.md)。
> 状态：**已实施，门禁 68/68**（2026-10-09）。口径已定：采纳 **乙** —— `GetBool` 对字符串 `"true"` / `"false"`（含首尾空白、大小写不敏感）做宽松解析（老大 2026-10-09 14:37）。**步骤 4（S-180 真机复验）待老大**。
> 一句话：调用方（模型）把布尔序列化成字符串 `"true"` 时，`GetBool` **静默回落 `fallback`** ⇒ 走错分支（现场 = `background` 走前台、主 Agent 被阻塞 49.2 s / 59.5 s）。

---

## 一、目标

让 `JsonHelpers.GetBool` 在属性值是**字符串** `"true"` / `"false"` 时也能正确解析：

- 覆盖 `Trim()` 后的**首尾空白**与**任意大小写**（`" true "` / `"TRUE"` / `"False"`）；
- **不扩大**解析范围 —— `"yes"` / `"1"` / 数字 / 对象 / 数组 / `null` **仍回落 `fallback`**；
- **不改**原生布尔、属性缺失、非 object 的既有行为；
- 一处修复覆盖全部 **42 处**调用点（`src/` 42、`tests/` 0），**不加**任何调用侧校验。

---

## 二、现状（实读，行号为 2026-10-09 快照）

`src/runtime/WishfulClaw.Core/Protocol/JsonHelpers.cs:16-28`：

```csharp
public static bool GetBool(JsonElement element, string name, bool fallback)
{
    if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var property))
    {
        return fallback;
    }
    return property.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => fallback   // ← "true"（字符串）、1、"True"、null 全落这里
    };
}
```

同文件的兄弟方法 `GetIntNullable`（`:35-50`）/ `GetLongNullable`（`:57-72`）/ `GetDoubleNullable`（`:74-89`）**都已经**带「字符串也认」的分支（`property.ValueKind == JsonValueKind.String && xxx.TryParse(...)`）。**只有 `GetBool` 漏了这一支** —— 本条就是把 `GetBool` 补齐到与兄弟方法同等的宽容度。

---

## 三、做法

```csharp
public static bool GetBool(JsonElement element, string name, bool fallback)
{
    if (element.ValueKind != JsonValueKind.Object || !element.TryGetProperty(name, out var property))
    {
        return fallback;
    }
    return property.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        JsonValueKind.String => ParseBoolText(property.GetString(), fallback),
        _ => fallback
    };
}

/// <summary>
/// 宽松解析布尔文本：容忍首尾空白与大小写差异（"true" / " TRUE " / "False"）。
/// 仅识别 true / false 两词，其余（含 null、空串）一律回落。
/// </summary>
private static bool ParseBoolText(string? value, bool fallback)
{
    if (string.IsNullOrWhiteSpace(value))
    {
        return fallback;
    }
    return value.Trim().ToLowerInvariant() switch
    {
        "true" => true,
        "false" => false,
        _ => fallback
    };
}
```

**三个必须守住的点**：

1. **只加一个 `JsonValueKind.String` 分支** —— 原生布尔分支顺序与语义保持原样，`_` 兜底不动。
2. **不做同义扩展** —— 不认 `yes/no`、`1/0`、`on/off`；严格对齐老大口径（就 `true` / `false` 两个词）。
3. **私有辅助方法放同文件、`static class JsonHelpers` 内** —— 不新增文件、不新增依赖、不改 `GetBool` 签名。

---

## 四、测试落点

**新建 `tests/WishfulClaw.JsonHelpersRegressionTests`**（C# 回归套件），并注册进 `tests/WishfulClaw.Tests.sln`。

- 依赖：`ProjectReference` → `..\..\src\runtime\WishfulClaw.Core\WishfulClaw.Core.csproj`（`JsonHelpers` 在 Core，**不**需要 Agent）。
- 工程样式对齐 `tests/WishfulClaw.ToolConcurrencyRegressionTests`：`OutputType Exe`、`net11.0`、`ImplicitUsings enable`、`Nullable enable`，`Main` 返回 `int`；失败抛 `InvalidOperationException("Assertion failed: …")`、`Main` 返回非零。
- `npm test` 靠目录名正则 `^WishfulClaw\..+RegressionTests$` 自动发现（`scripts/run-tests.mjs:32-36`）⇒ **不需要改 `run-tests.mjs`**；套件数将从 **67 → 68**。
- 用例清单（全走 `JsonHelpers.GetBool`）：

| # | 输入 JSON | fallback | 期望 |
|---|---|---|---|
| 1 | `{"a":true}` | false | `true` |
| 2 | `{"a":false}` | true | `false` |
| 3 | `{"a":"true"}` | false | `true`（**本条主修**） |
| 4 | `{"a":"false"}` | true | `false` |
| 5 | `{"a":" true "}` | false | `true`（首尾空白） |
| 6 | `{"a":"FALSE"}` | true | `false`（大小写） |
| 7 | `{"a":" True "}` | false | `true`（空白 + 大小写） |
| 8 | `{"a":"yes"}` | false | `false`（不扩大 ⇒ 回落） |
| 9 | `{"a":"1"}` | true | `true`（不扩大 ⇒ 回落） |
| 10 | `{"a":""}` / `{"a":"   "}` | true | `true`（空/空白 ⇒ 回落） |
| 11 | `{"a":1}` | true | `true`（数字 ⇒ 回落） |
| 12 | `{"a":null}` | true | `true`（null ⇒ 回落） |
| 13 | `{"b":"true"}`（属性缺失） | true | `true`（回落） |
| 14 | 非 object（`[1,2]` / `"x"`） | true | `true`（回落） |
| 15 | `{"a":"true"}` | **true** | `true`（显式 true 不受 fallback 影响） |

---

## 五、步骤清单

- [x] **步骤 1：改 `JsonHelpers.cs`**
  - 加 `JsonValueKind.String` 分支 + 私有 `ParseBoolText`
  - 验证检查点：`dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警；`git diff` 只动该文件、只在 `GetBool` 与其后新增一个私有方法；其余方法**一字未动** ⇒ **达成**（`git diff --stat` = 1 file, +20/−0）
- [x] **步骤 2：新建测试工程并挂 sln**
  - `tests/WishfulClaw.JsonHelpersRegressionTests/{csproj, Program.cs}`（15 条用例）
  - `tests/WishfulClaw.Tests.sln` 注册（`Project(...)` 条目 + `ProjectConfigurationPlatforms` 12 行 x64/x86/Any CPU×Debug/Release）
  - 验证检查点：`dotnet build tests/WishfulClaw.Tests.sln` 0 错 0 警；单独跑 `tests/WishfulClaw.JsonHelpersRegressionTests/bin/Debug/net11.0/WishfulClaw.JsonHelpersRegressionTests.exe` 返回 0、打印断言计数 ⇒ **达成**（退 0，`JsonHelpers regression checks passed: 24`；sln 实为 +14 行）
- [x] **步骤 3：整体门禁**
  - `npm run typecheck`（node + web 两配置）0 错 ＋ `dotnet build src/runtime/WishfulClaw.sln` 0 错 0 警 ＋ `npm test` **68/68**（本刀**新增 1 个套件**：67 → 68）
  - 验证检查点：全绿 ⇒ 本刀测通，按「一需求一刀」提交 ⇒ **达成**（typecheck 0 错 / build 0 错 0 警 / `npm test` 68/68，新套件 `JsonHelpers` 24 assertions）
- [ ] **步骤 4：S-180 真机复验（老大侧）** —— **blocked：等老大真机复验**
  - 修好后重跑 S-180 步骤 4：派一个 `background=true`（**这回是真布尔**）的子 Agent，观察主 Agent 是否立即收手、完成后被自动唤醒
  - 验证检查点：`agent_timeline_events.run_id` 出现 **`subagent-bg-` 前缀**；S-180 阶段六验证报告从 **PARTIAL** 转正

---

## 六、涉及文件

| 文件 | 动作 |
|---|---|
| `src/runtime/WishfulClaw.Core/Protocol/JsonHelpers.cs` | 修改：`GetBool` `:16-28` 加 String 分支 + 新增私有 `ParseBoolText` |
| `tests/WishfulClaw.JsonHelpersRegressionTests/WishfulClaw.JsonHelpersRegressionTests.csproj` | 新建 |
| `tests/WishfulClaw.JsonHelpersRegressionTests/Program.cs` | 新建（15 条用例） |
| `tests/WishfulClaw.Tests.sln` | 修改：注册新工程 |
| `docs/plans/iter-v2-38/plan-s181/` | 本计划 + `compliance_report.md` + `review_report.md` + `verification_report.md` |
| `docs/plans/iter-v2-38/{plan.md, raw-requirements.md, changelog.md}` | 回填状态（按纪律**攒进收尾刀**，不单独提交） |

**不动**：

- `src/runtime/WishfulClaw.Agent/Tools/TaskTool.cs` —— S-180 已改的提示词文本，本条不碰；`background` 参数校验属**未采纳的甲**。
- `src/runtime/WishfulClaw.Core/Protocol/JsonHelpers.cs` 的其余方法 —— `GetString` / `GetInt` / `GetLong` / `GetDouble` / `GetStringArray` / `ResolveEffectiveReasoningEffort` **一字不动**。
- `scripts/run-tests.mjs` —— 靠目录名自动发现，无需改。
- 全部 42 处 `GetBool` 调用点 —— 一处修复全局受益，**不加**调用侧校验。

**参考源码**：无 —— 本仓自有基础工具的宽容度补齐，不涉及 OpenCowork / KodaClaw / OpenClaw.net。

---

## 七、刻意不做（写死免得下一轮走回去）

1. **不扩展到 `yes/no`、`1/0`、`on/off`** —— 老大口径只有 `true` / `false` 两词。
2. **不加调用侧校验或告警** —— 不采纳方案甲；不引入「类型不符即抛」的新语义（41 处调用点全部依赖 `fallback` 兜底）。
3. **不改 `GetBool` 签名**，不加重载。
4. **不新建源码文件**（除测试工程），不引入新依赖。
5. **不顺手改兄弟方法** —— `GetIntNullable` 等已具备字符串宽容度，且 `int.TryParse` 的宽容度高于本次口径，**不动**。

---

## 八、待确认

| # | 问题 | 状态 |
|---|---|---|
| 1 | 采纳哪个方案？ | **已定**：乙（老大 14:37） |
| 2 | 宽松范围？ | **已定**：`true` / `false` 两词，含首尾空白、大小写不敏感；其余回落 |
| 3 | 测试落点：新建工程还是并入既有？ | **已定**（助手工程判断）：**新建** `WishfulClaw.JsonHelpersRegressionTests` —— `JsonHelpers` 是 Core 基础工具、跨模块，独立工程职责最清 |
| 4 | 落 38 还是 39？ | **已定**（助手工程判断）：**落 38** —— 与 S-180 同源，且 S-180 复验卡在本条上 |
| 5 | S-180 真机复验？ | **本条落地后重做**（步骤 4），老大侧执行 |
