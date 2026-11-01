/*
 * S-268 回归：截图工具 `path` 参数的解析规则。
 *
 * 缺陷形态：`DesktopScreenshot` 的 schema 里压根没有 `path`，`ExecuteScreenshotAsync`
 * 递下去的是空对象 —— 模型传了 `path` 也照报成功，文件落在默认数据目录，下一轮 Read 扑空。
 * 修法是把 `CaptureAppWindow` 那套解析抽成 `ResolveCaptureTargetPath` 两处共用。
 *
 * 本套件钉的就是这个共用函数 —— 它是「文件到底落在哪」的唯一判据。
 */

using WishfulClaw.Agent;

namespace WishfulClaw.CaptureTargetPathRegressionTests;

internal static class Program
{
    private static int _checks;

    public static int Main()
    {
        try
        {
            RunRelativePathSuite();
            RunAbsolutePathSuite();
            RunMissingPathSuite();

            Console.WriteLine($"Capture target path regression checks passed ({_checks} assertions).");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Capture target path regression test failed: {ex}");
            return 1;
        }
    }

    private static void RunRelativePathSuite()
    {
        var folder = Path.Combine(Path.GetTempPath(), "wc-capture-suite", "project");

        // 1. 核心：相对路径必须挂在会话工作目录下 —— 主进程 cwd 是程序安装目录，不能就着它拼
        var resolved = AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath(
            "docs/images/desktop.png", folder);
        AssertEqual(
            Path.GetFullPath(Path.Combine(folder, "docs", "images", "desktop.png")),
            resolved,
            "相对路径必须解析到会话工作目录下");

        // 2. 只有文件名，落在工作目录根
        AssertEqual(
            Path.GetFullPath(Path.Combine(folder, "shot.png")),
            AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath("shot.png", folder),
            "只有文件名时必须落在工作目录根");

        // 3. `..` 穿越要规范化成绝对路径，不许原样带出去
        var traversed = AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath("../outside.png", folder);
        Assert(traversed is not null, "带 .. 的相对路径也要有结果");
        Assert(Path.IsPathRooted(traversed!), "结果必须已是绝对路径");
        AssertEqual(
            Path.GetFullPath(Path.Combine(Path.GetDirectoryName(folder)!, "outside.png")),
            traversed,
            ".. 必须按工作目录规范化");

        // 4. 没有 workingFolder 时退回进程当前目录，仍然是绝对路径
        var withoutFolder = AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath("shot.png", null);
        Assert(Path.IsPathRooted(withoutFolder!), "没有工作目录时也必须给出绝对路径");
        AssertEqual(
            Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "shot.png")),
            withoutFolder,
            "没有工作目录时退回进程当前目录");

        // 5. 纯空白的工作目录等同没有 —— 空白目录名拼出来的路径是相对路径
        var blankFolder = AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath("shot.png", "   ");
        AssertEqual(
            Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "shot.png")),
            blankFolder,
            "空白工作目录必须等同没有");
    }

    private static void RunAbsolutePathSuite()
    {
        var absolute = Path.Combine(Path.GetTempPath(), "wc-capture-suite", "elsewhere", "a.png");

        // 6. 绝对路径原样采信，不许被工作目录覆盖
        AssertEqual(
            Path.GetFullPath(absolute),
            AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath(absolute, @"C:\some\project"),
            "绝对路径必须原样采信");

        // 7. 中文路径不许被转到别的目录去（真机数据目录就在中文用户名下）
        var chinese = Path.Combine(Path.GetTempPath(), "心相", "截图.png");
        AssertEqual(
            Path.GetFullPath(chinese),
            AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath(chinese, null),
            "中文绝对路径必须原样采信");
    }

    private static void RunMissingPathSuite()
    {
        var folder = Path.Combine(Path.GetTempPath(), "wc-capture-suite", "project");

        // 8/9/10. 没传 / 空串 / 纯空白 ⇒ null（调用方就不传 targetPath，主进程用默认数据目录）
        AssertEqual(null, AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath(null, folder), "没传 path 必须返回 null");
        AssertEqual(null, AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath(string.Empty, folder), "空串必须返回 null");
        AssertEqual(null, AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath("   ", folder), "纯空白必须返回 null");

        // 11. null 不能被当成「当前目录」—— 那会让截图落成工作目录这个名字的文件
        Assert(
            AgentRuntimeDesktopExecutor.ResolveCaptureTargetPath(null, folder) is null,
            "没传 path 时绝不能回落到工作目录本身");
    }

    private static void Assert(bool condition, string message)
    {
        _checks++;
        if (!condition)
            throw new InvalidOperationException($"Assertion failed: {message}");
    }

    private static void AssertEqual(string? expected, string? actual, string message)
    {
        _checks++;
        if (!string.Equals(expected, actual, StringComparison.Ordinal))
            throw new InvalidOperationException(
                $"Assertion failed: {message} (expected '{expected}', actual '{actual}')");
    }
}
