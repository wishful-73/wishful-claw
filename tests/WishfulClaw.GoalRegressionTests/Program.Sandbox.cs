using System.Text.Json;
using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.GoalRegressionTests;

/// <summary>
/// iter-32 S-79 —— 沙箱模式：工具路径参数必须落在允许的工作目录内。
///
/// 这里守三件事：
/// 1. 边界判定本身（含两个最容易错的地方：目录前缀陷阱 C:\a vs C:\abc，和 .. 逃逸）
/// 2. 开关与边界集合的三种组合（关 / 开但无根 / 开且有根）
/// 3. 「没有根就不拦」这条降级 —— 沙箱是保护措施，不能反过来把正常干活挡死
/// </summary>
internal static partial class Program
{
    private static void RunSandboxSuite()
    {
        // 用临时目录拼一棵真实存在的树，避免写死盘符导致跨平台失败。
        var root = Path.Combine(Path.GetTempPath(), "wc-sandbox-root");
        var inside = Path.Combine(root, "src", "file.cs");
        var sibling = root + "-sibling";           // 前缀相同但不是子目录
        var outside = Path.GetTempPath();
        var escaped = Path.GetFullPath(Path.Combine(root, "..", "wc-sandbox-root-sibling", "x.cs"));

        IReadOnlyList<string> roots = [root];

        AssertEqual(true, PathBoundary.IsInsideAnyRoot(root, roots), "根目录自身算在内");
        AssertEqual(true, PathBoundary.IsInsideAnyRoot(inside, roots), "根的子目录算在内");
        AssertEqual(
            false,
            PathBoundary.IsInsideAnyRoot(sibling, roots),
            "前缀相同但不同目录必须拒绝（C:\\a 不能放行 C:\\abc）");
        AssertEqual(false, PathBoundary.IsInsideAnyRoot(outside, roots), "根之外的路径必须拒绝");
        AssertEqual(false, PathBoundary.IsInsideAnyRoot(escaped, roots), ".. 逃逸必须拒绝");
        AssertEqual(
            true,
            PathBoundary.IsInsideAnyRoot(outside, []),
            "没有任何根时一律放行（项目列表为空的降级路径）");

        // 多根（全局会话）：命中任一即放行。
        var secondRoot = Path.Combine(Path.GetTempPath(), "wc-sandbox-root-2");
        IReadOnlyList<string> multi = [root, secondRoot];
        AssertEqual(
            true,
            PathBoundary.IsInsideAnyRoot(Path.Combine(secondRoot, "a.txt"), multi),
            "多根时命中第二个根即放行");

        // ── 开关 × 边界集合 ──
        var off = ParseJson("""{"sandboxEnabled":false}""");
        AssertEqual(false, PathBoundary.IsEnabled(off), "显式关闭沙箱");
        AssertEqual(false, PathBoundary.ResolvePolicy(off).Enabled, "关闭时不计算边界");

        var unset = ParseJson("{}");
        AssertEqual(true, PathBoundary.IsEnabled(unset), "字段缺失时按默认开（跟设置页默认一致）");

        var projectParams = ParseJson(
            $$"""{"scope":"project","workingFolder":{{JsonSerializer.Serialize(root)}}}""");
        var projectPolicy = PathBoundary.ResolvePolicy(projectParams);
        AssertEqual(true, projectPolicy.Enabled, "项目会话默认开沙箱");
        AssertEqual(1, projectPolicy.Roots.Count, "项目会话只有一个根");
        AssertEqual(root, projectPolicy.Roots[0], "项目会话的根就是该项目工作目录");

        // 项目会话没给 workingFolder：没有根可依，解析结果为空（= 不拦）。
        AssertEqual(
            0,
            PathBoundary.ResolvePolicy(ParseJson("""{"scope":"project"}""")).Roots.Count,
            "项目会话缺 workingFolder 时没有根");

        // 关掉开关时不查库也不算根 —— 全局会话走的就是这条。
        AssertEqual(0, PathBoundary.ResolvePolicy(off).Roots.Count, "关闭的开关不带根");

        // ── 执行层：工具 helper 真的会拦 ──
        var disabled = new ToolExecutionContext(SandboxEnabled: false);
        EnsureDoesNotThrow(() => ToolHelpers.EnsureInsideSandbox(outside, disabled), "开关关闭时不拦");

        var enabled = new ToolExecutionContext(SandboxEnabled: true, SandboxRoots: roots);
        EnsureDoesNotThrow(
            () => ToolHelpers.EnsureInsideSandbox(inside, enabled), "开关开启时根内路径放行");

        // 开关开着但没有根：等同未开，不能拦。
        EnsureDoesNotThrow(
            () => ToolHelpers.EnsureInsideSandbox(outside, new ToolExecutionContext(SandboxEnabled: true)),
            "开启但无根时不拦");

        var violation = CaptureViolation(
            () => ToolHelpers.EnsureInsideSandbox(outside, enabled));
        AssertEqual(true, violation is not null, "开关开启时越界必须抛 PathSandboxViolationException");
        if (violation is not null)
        {
            AssertEqual(true, violation.Contains(outside), "越界文案要带上被拒的路径");
            AssertEqual(true, violation.Contains(root), "越界文案要带上允许的根，模型才知道该往哪儿落");
        }

        // 相对路径 + 工作目录：解析成绝对路径后照样受边界约束。
        var relative = ParseJson("""{"file_path":"../wc-sandbox-root-sibling/x.cs"}""");
        var relativeContext = new ToolExecutionContext(
            WorkingFolder: root, SandboxEnabled: true, SandboxRoots: roots);
        var relativeViolation = CaptureViolation(
            () => ToolHelpers.ResolveFilePath(relative, relativeContext));
        AssertEqual(true, relativeViolation is not null, "相对路径拼出根外绝对路径同样要拦");

        var okRelative = ParseJson("""{"file_path":"src/file.cs"}""");
        AssertEqual(
            Path.GetFullPath(Path.Combine(root, "src", "file.cs")),
            ToolHelpers.ResolveFilePath(okRelative, relativeContext),
            "根内的相对路径正常解析");
    }

    private static JsonElement ParseJson(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static void EnsureDoesNotThrow(Action action, string message)
    {
        try
        {
            action();
        }
        catch (Exception ex)
        {
            throw new Exception($"Assertion failed: {message} (threw {ex.GetType().Name}: {ex.Message})");
        }
    }

    private static string? CaptureViolation(Action action)
    {
        try
        {
            action();
            return null;
        }
        catch (PathSandboxViolationException ex)
        {
            return ex.Message;
        }
    }
}
