// S-144 回归：沙箱路径判定 —— 中文名 / 下划线 / 多层子目录必须放行，越界必须被拒。
//
// 知识库把触发项记成「嵌套两层子目录 / 中文文件名 / 下划线文件名」，这三个在本套件里逐条固化：
// 它们本来就不该被拦（判定只是一次前缀比较），真正会拦住正常写入的是「run params 漏带
// workingFolder」——见 PathBoundary.ResolveProjectWorkingFolder 的注释。本套件锁住前者的行为，
// 免得日后有人靠改判定逻辑去"修"一个不在判定逻辑里的问题。

using System;
using System.IO;
using System.Text.Json;
using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

var passed = 0;
var failed = 0;

void Check(bool condition, string label)
{
    if (condition)
    {
        passed++;
        return;
    }
    failed++;
    Console.WriteLine($"FAIL {label}");
}

var root = Path.Combine(Path.GetTempPath(), "wc-sandbox-" + Guid.NewGuid().ToString("N"));
var working = Path.Combine(root, "工作目录");
var deep = Path.Combine(working, "子层一", "子层二");
Directory.CreateDirectory(deep);

try
{
    // ── IsInsideAnyRoot ──
    string[] roots = [working];
    Check(PathBoundary.IsInsideAnyRoot(working, roots), "the root itself counts as inside");
    Check(PathBoundary.IsInsideAnyRoot(deep, roots), "two-level subdirectory is inside");
    Check(
        PathBoundary.IsInsideAnyRoot(Path.Combine(deep, "生产台账_卷1.md"), roots),
        "chinese file name with an underscore is inside");
    Check(
        PathBoundary.IsInsideAnyRoot(working.ToUpperInvariant(), roots),
        "comparison is case-insensitive on Windows");
    Check(
        !PathBoundary.IsInsideAnyRoot(Path.Combine(root, "工作目录备份"), roots),
        "a sibling sharing the prefix is outside");
    Check(
        !PathBoundary.IsInsideAnyRoot(root, roots),
        "the parent of the root is outside");
    Check(
        PathBoundary.IsInsideAnyRoot(Path.Combine(root, "任意位置"), []),
        "an empty root set allows everything (caller must check the switch first)");

    // ── ResolveFilePath：相对路径挂工作目录，再多层中文名 ──
    var projectContext = new ToolExecutionContext(
        WorkingFolder: working,
        SandboxEnabled: true,
        SandboxRoots: roots);

    var resolved = ToolHelpers.ResolveFilePath(Input("子层一/子层二/生产台账_卷1.md"), projectContext);
    Check(resolved is not null, "relative path resolves");
    Check(
        resolved!.StartsWith(working, StringComparison.OrdinalIgnoreCase),
        "relative path is anchored to the working folder");
    Check(
        resolved.EndsWith("生产台账_卷1.md", StringComparison.Ordinal),
        "chinese file name survives resolution");

    // 越界（项目目录之外）必须被拒 —— 这是沙箱该做的事，不是缺陷。
    var outsideRejected = false;
    try
    {
        ToolHelpers.ResolveFilePath(Input(Path.Combine(root, "别处", "x.md")), projectContext);
    }
    catch (PathSandboxViolationException)
    {
        outsideRejected = true;
    }
    Check(outsideRejected, "an absolute path outside the roots is rejected");

    // 沙箱关掉：一切放行。
    var openContext = new ToolExecutionContext(WorkingFolder: working, SandboxEnabled: false);
    var openResolved = ToolHelpers.ResolveFilePath(Input(Path.Combine(root, "别处", "x.md")), openContext);
    Check(openResolved is not null, "sandbox off allows paths outside the roots");

    // 拒绝文案必须同时说清「哪条路径」和「允许的根」，否则 agent 只会反复重试同一条路径。
    var message = PathBoundary.BuildViolationMessage(Path.Combine(root, "别处", "x.md"), roots);
    Check(message.Contains("别处", StringComparison.Ordinal), "violation message names the rejected path");
    Check(message.Contains(working, StringComparison.Ordinal), "violation message names the allowed roots");
}
finally
{
    try
    {
        Directory.Delete(root, recursive: true);
    }
    catch
    {
        // 临时目录清不掉不影响断言结果。
    }
}

Console.WriteLine($"passed: {passed}, failed: {failed}");
return failed == 0 ? 0 : 1;

static JsonElement Input(string path)
{
    using var document = JsonDocument.Parse(JsonSerializer.Serialize(new { file_path = path }));
    return document.RootElement.Clone();
}
