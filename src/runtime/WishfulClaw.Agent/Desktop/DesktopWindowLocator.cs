using System;
using System.Collections.Generic;
using System.Linq;

namespace WishfulClaw.Agent.Desktop;

/// <summary>
/// 一个可见顶层窗口（S-272 第二段 · D）。
///
/// 坐标是**屏幕物理像素**，与 <c>DesktopScreenshot</c> 的坐标系同一套 —— 不一致的话
/// 「按窗口截图」截出来的位置就不对，而且这种错法很难从画面上看出来。
/// </summary>
internal sealed record DesktopWindowEntry(
    string Title,
    string ClassName,
    int ProcessId,
    string ProcessName,
    int X,
    int Y,
    int Width,
    int Height,
    bool Minimized);

/// <summary>
/// 窗口匹配与筛选的纯逻辑 —— 与 P/Invoke 分开放，才能写回归。
///
/// 枚举本身在 <see cref="AgentRuntimeDesktopExecutor"/>（Windows 特定 API），这里只回答
/// 「这批窗口里，模型说的那个是哪个」。
/// </summary>
internal static class DesktopWindowLocator
{
    /// <summary>
    /// 能被截图的窗口：有标题、有面积、没最小化。
    ///
    /// 排除最小化是刻意的：最小化窗口的矩形还停在原来的位置，但画面上什么都没有。把它算作
    /// 候选，模型会截到一张空图，然后怀疑是工具坏了 —— 不如当它不存在，让它先恢复窗口。
    /// </summary>
    public static bool IsCapturable(DesktopWindowEntry window)
    {
        return !window.Minimized
            && window.Width > 0
            && window.Height > 0
            && !string.IsNullOrWhiteSpace(window.Title);
    }

    /// <summary>
    /// 按标题关键字找窗口，找不到返回 <c>null</c>。
    ///
    /// 优先级：完全相同 → 前缀命中 → 包含命中；同一档里取**面积最大**的那个（用户说的
    /// 「那个记事本」几乎总是指最大的那个窗口，而不是某个 200×120 的小提示框）。
    ///
    /// 比较忽略大小写；不做模糊音、不做拼音 —— 猜错了比找不到更糟，找不到它会换个词再试。
    /// </summary>
    public static DesktopWindowEntry? FindBest(
        IEnumerable<DesktopWindowEntry> windows,
        string? keyword)
    {
        var needle = keyword?.Trim();
        if (string.IsNullOrEmpty(needle))
        {
            return null;
        }

        var candidates = windows.Where(IsCapturable).ToList();
        if (candidates.Count == 0)
        {
            return null;
        }

        foreach (var tier in new[]
                 {
                     MatchTier.Exact,
                     MatchTier.Prefix,
                     MatchTier.Contains
                 })
        {
            var best = candidates
                .Where(window => Classify(window.Title, needle) == tier)
                .OrderByDescending(window => (long)window.Width * window.Height)
                .ThenBy(window => window.Title, StringComparer.Ordinal)
                .FirstOrDefault();
            if (best is not null)
            {
                return best;
            }
        }

        return null;
    }

    internal enum MatchTier
    {
        None = 0,
        Contains = 1,
        Prefix = 2,
        Exact = 3
    }

    internal static MatchTier Classify(string title, string keyword)
    {
        if (string.Equals(title, keyword, StringComparison.OrdinalIgnoreCase))
        {
            return MatchTier.Exact;
        }
        if (title.StartsWith(keyword, StringComparison.OrdinalIgnoreCase))
        {
            return MatchTier.Prefix;
        }
        if (title.Contains(keyword, StringComparison.OrdinalIgnoreCase))
        {
            return MatchTier.Contains;
        }
        return MatchTier.None;
    }
}
