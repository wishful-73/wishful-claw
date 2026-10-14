# Plan: S-200 内置搜索工具的「文件路径」目标（`Grep` 单文件 + 三处文案）

> 所属迭代：iter-v2-39 ｜ 需求正文：[`../requirements/S-200.md`](../requirements/S-200.md)
> 状态：**已实施**（`ce182e52` 首刀 + `bae36640` 审查修订，10-14）；阶段五审查 **⚠️ PARTIAL**（❌ 1 已修 / ⚠️ 3），阶段六回归验证**待补**
> 层：**C# 内置工具层**（`src/runtime/WishfulClaw.Agent/Tools/`）—— 协议 / DB / i18n / 渲染端**零改动**
> 门禁基线：`typecheck` 0 错 / `npm test` **71/71**（TS 54 + C# 17）/ `dotnet build sln` 0 警告 0 错误 / 官网 build 0 错 ⇒ 本刀后 C# 套件数 17 → **18**，`npm test` 总数 71 → **72**

---

## 一、目标

三个内置工具（`Grep` / `Glob` / `LS`）在 `path` 指向**真实存在的文件**时：

- `Grep` ⇒ **单文件模式**（搜这一个文件）；
- `Glob` / `LS` ⇒ 报**准确**错误（「是文件，不是目录」）；
- 路径**真不存在**时，三处文案统一为 `Path not found: {root}`（**不再说 `Directory not found`**）。

## 二、不许动（红线）

1. `ToolHelpers.ResolveSearchPath` / `EnsureInsideSandbox` / `PathBoundary` —— 共用解析与沙箱判定。
2. `SearchFilter`（含 `DefaultExcludedDirs` 里的 `node_modules` / `dist` / `obj`）—— 「默认不搜依赖目录」是**有意设计**。
3. `GrepTool` 之外的 `file_pattern` 语义（`CreateFileNameMatcher` / `GlobToRegex` / `ShouldReportPatternRejected` 与 `MatchesFileName` 的既有断言）。
4. `GlobTool.MatchesGlob` 的匹配语义（裸 `package.json` 只匹配根层是**文档化行为**）。
5. 一律**不 `git add` / `commit` / `push` / `reset` / `checkout`** —— 改完留在工作区，由主会话复核后提交。

## 三、改动一：`GrepTool.cs`（单文件模式 + 文案）

`src/runtime/WishfulClaw.Agent/Tools/SearchTools/GrepTool.cs`

### 3.1 判别（替换 `:42-46`）

```csharp
var root = ResolveSearchPath(input, context);
var isSingleFile = File.Exists(root) && !Directory.Exists(root);
if (!isSingleFile && !Directory.Exists(root))
{
    return new ToolResult($"Path not found: {root}", true);
}
```

`File.Exists(<目录>)` 与 `Directory.Exists(<文件>)` **都返回 `false`** ⇒ 三分支判别是干净的。

### 3.2 二进制护栏（`isSingleFile` 时）

```csharp
if (isSingleFile && IsBinaryExtension(root))
{
    return new ToolResult($"Cannot grep a binary file: {root}", true);
}
```

### 3.3 二进制清单抽成共用静态方法

把 `EnumerateSearchableFiles` 里 `:209-213` 的 `ext is ".exe" or …` 内联清单抽出来，**清单内容一字不改**：

```csharp
private static readonly string[] BinaryExtensions =
[
    ".exe", ".dll", ".pdb", ".so", ".dylib", ".bin",
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico",
    ".zip", ".gz", ".tar", ".7z", ".rar", ".pdf"
];

internal static bool IsBinaryExtension(string file)
{
    return BinaryExtensions.Contains(Path.GetExtension(file).ToLowerInvariant());
}
```

原处改为 `if (IsBinaryExtension(file)) { continue; }`（**位置不变** —— 仍在 `matchesFileName` 之后，`stats.PatternRejected` 的计数语义不能变，那是 `WishfulClaw.GrepPatternRegressionTests` 的护栏）。

### 3.4 单文件模式的枚举与展示基准

```csharp
// 单文件模式：展示基准取父目录（Path.GetRelativePath(root, root) 会得到 "."）
var searchBase = isSingleFile ? Path.GetDirectoryName(root) ?? root : root;

foreach (var file in isSingleFile ? [root] : EnumerateSearchableFiles(root, filePattern, excludeDirs, stats))
```

- `:94` 的 `Path.GetRelativePath(root, file)` 改用 **`searchBase`** ⇒ 单文件模式输出 `package.json:12: …`；目录模式 `searchBase == root` ⇒ **行为一字不变**。
- **单文件模式忽略 `file_pattern`**：上面那个三元里**不传** `file_pattern` ⇒ `stats` 保持 0/0 ⇒ `ShouldReportPatternRejected` 不会触发 ⇒ 没命中就是干净的 `No matches found.`。

### 3.5 工具自述（口径要写给模型看，不靠猜）

`schema` 里 `path` 的 `description` 改为：

```
Root directory, or a single file, to search from. Defaults to working folder. When a single file is given, file_pattern is ignored.
```

`Description` 属性末尾补一句：`path` 可以是一个**文件**（此时 `file_pattern` 被忽略）。

## 四、改动二：`GlobTool.cs`（**仅文案**）

`:79-85` 的判别替换为：

```csharp
if (!Directory.Exists(root))
{
    if (File.Exists(root))
    {
        return Task.FromResult(new ToolResult(
            $"Not a directory: {root} is a file. " +
            "Glob matches files under a directory — pass the directory, or use Read / Grep for a single file.",
            true));
    }

    return Task.FromResult(new ToolResult($"Path not found: {root}", true));
}
```

**不加单文件模式**（理由见需求 §3.2）。

## 五、改动三：`FileListTool.cs`（**仅文案**）

`src/runtime/WishfulClaw.Agent/Tools/FileTools/FileListTool.cs` 的 `:77-84`，同一形态，文案换成 LS 版：

```csharp
return Task.FromResult(new ToolResult(
    $"Not a directory: {root} is a file. " +
    "LS lists directory contents — pass a directory, or use Read / Grep for a single file.",
    true));
```

## 六、改动四：新建回归套件

`tests/WishfulClaw.SearchToolTargetRegressionTests/`

- **形态照抄** `tests/WishfulClaw.SandboxPathRegressionTests/`（top-level statements 的普通 exe；`.csproj` 与其引用结构一致）—— 目录名必须匹配 `^WishfulClaw\..+RegressionTests$`，否则 `scripts/run-tests.mjs` 收不到。
- **在 `tests/WishfulClaw.Tests.sln` 里登记**（照 SandboxPath 那条同格式加一行 + 对应 GUID/配置节；不确定就 `dotnet sln tests/WishfulClaw.Tests.sln add <csproj>` 后用 `git diff` 核对没把别的行改乱）。
- 夹具用 `Path.GetTempPath()` 下的随机目录，`try/finally` 里删（照 SandboxPath 写法）。结构与断言：

```
tmp/
  top.json                     内容: { "needle": 1 }
  sub/inner.txt                内容: needle here
  blob.exe                     内容: needle (二进制护栏用)
  node_modules/pkg/index.js    内容: needle          (回归 #7 用)
```

| # | 调用 | 断言 |
|---|---|---|
| 1 | `Grep("needle", path: tmp/top.json)` | **非** err；含 `top.json:1:`；**不含** `not found` |
| 2 | `Grep("needle", path: tmp/top.json, file_pattern: "*.ts")` | **非** err；仍含 `top.json:1:`（`file_pattern` 被忽略） |
| 3 | `Grep("zzz", path: tmp/top.json)` | **非** err；等于 `No matches found.` |
| 4 | `Grep("needle", path: tmp/nope/x.txt)` | **是** err；含 `Path not found`；**不含** `Directory not found` |
| 5 | `Grep("needle", path: tmp)` | **非** err；含 `sub/inner.txt:1:`（**目录模式回归**：相对路径仍以 root 为基准） |
| 6 | `Grep("needle", path: tmp, file_pattern: "*.ts")` | **非** err；含 `matched none of the`（**回归**：`PatternRejected` 提示还活着） |
| 7 | `Grep("needle", path: tmp/blob.exe)` | **是** err；含 `binary` |
| 8 | `Grep("needle", path: tmp/node_modules)` | **非** err；含 `pkg/index.js:1:`（**回归**：`node_modules` 作显式 root 时能搜到 —— 需求 §2.1） |
| 9 | `Grep("needle", path: tmp)` | **不**含 `node_modules`（**回归**：默认排除仍生效） |
| 10 | `Glob("*.json", path: tmp/top.json)` | **是** err；含 `Not a directory`；**不含** `Directory not found` |
| 11 | `Glob("**/*.txt", path: tmp/nope)` | **是** err；含 `Path not found`；**不含** `Directory not found` |
| 12 | `Glob("**/*.txt", path: tmp)` | **非** err；含 `sub/inner.txt`（**目录模式回归**） |
| 13 | `LS(path: tmp/top.json)` | **是** err；含 `Not a directory`；**不含** `Directory not found` |
| 14 | `LS(path: tmp/nope)` | **是** err；含 `Path not found`；**不含** `Directory not found` |
| 15 | `LS(path: tmp)` | **非** err；含 `top.json`（**目录模式回归**） |

- 调用方式照 `SandboxPathRegressionTests`：`new ToolExecutionContext(WorkingFolder: tmp, SandboxEnabled: false)` + `JsonDocument.Parse(JsonSerializer.Serialize(new { pattern, path, file_pattern }))` 得到的 `JsonElement` 传给 `ExecuteAsync(...).Result`（或 `.GetAwaiter().GetResult()`）。
- 断言失败**打清「哪条 + 期望 vs 实际」**，退出码非 0；成功打印 `passed: N, failed: 0`（`run-tests.mjs` 会抓 `passed[: ]+(\d+)`）。
- **`GrepTool.MatchesFileName` / `ShouldReportPatternRejected` 的既有断言不许改**（那是 S-88 的护栏）。

## 七、Mini 验证（每一步做完立刻做）

1. 改完 `GrepTool.cs` ⇒ `dotnet build src/runtime/WishfulClaw.sln --nologo -v q` 0 警告 0 错误。
2. 三项全改完 ⇒ 同上。
3. 新套件建成 ⇒ `dotnet run --project tests/WishfulClaw.SearchToolTargetRegressionTests/WishfulClaw.SearchToolTargetRegressionTests.csproj`（或编完直接跑 exe）⇒ 失败必须为 0。
4. 端到端 ⇒ `npm test`（先关掉可能锁 `bin/` 的 dev 实例）⇒ **72/72**，且 `GrepPattern` 套件仍绿。

## 八、验收判据

= 需求 `S-200.md` §四 的 8 条（1~7 由新套件覆盖，8 = 四道门禁）。

## 九、回滚

本刀只动 3 个 C# 文件 + 1 个新套件 + sln 一行 ⇒ 出问题 `git checkout -- <3 files>` + 删新目录即可；**无 DB / 无迁移 / 无协议**，不需要数据回滚。

## 十、实施记录（2026-10-14）

| 步骤 | 结果 |
|---|---|
| 首刀 | **`ce182e52`** —— 3 个 C# 工具源 + 新套件（35 断言）+ `tests/WishfulClaw.Tests.sln`；门禁四绿（`typecheck` 0 错 / `npm test` 72/72 / `dotnet build` 0 警告 0 错误 / 官网 build 0 错）。代码刀**不带文档**（文档攒迭代收尾刀） |
| 阶段五审查 | **独立 subagent**（`code-reviewer`）⇒ **⚠️ PARTIAL**：❌ 1 + ⚠️ 4。报告：[`review_report.md`](review_report.md) |
| 审查修订刀 | **`bae36640`** —— ❌-1 按本文件 §3.5 原文补齐 `InputSchema` 里 `path` 的描述（首刀只改了 `Description`）；⚠️-1 把 `#1/#2/#5` 的路径断言从 `Contains` 收紧为 `StartsWith` + 两条「不含绝对路径」否定断言（35 → **37** 断言），并做**证伪测试**（`searchBase` 改回 `root` ⇒ 2 红；改用绝对路径 ⇒ 4 红）。门禁复跑四绿 |
| 偏差 | 本文件 §3.3 写 `IsBinaryExtension` 为 `internal`，实现取 `private`（更紧的封装，无外部消费者）；§3.5 的 schema 描述**首刀漏改**、修订刀补齐 |
| 阶段六验证 | **待补** —— 工具层的自动断言部分已由新套件覆盖（37 断言）；端到端实机项等老大验 |
