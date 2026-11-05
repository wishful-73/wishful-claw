/*
 * 窗口枚举与按窗口截图 —— S-272 第二段 · D。
 *
 * 为什么在 worker（C#）里枚举而不是主进程：主进程只有 Electron 的 API，`BrowserWindow`
 * 只认识自己的窗口；要枚举别人的窗口就得带原生模块进来。worker 本来就是 Windows 原生进程，
 * `user32.dll` 零成本。
 *
 * **坐标系写死为屏幕物理像素**，与 `DesktopScreenshot` 一套。为此进程必须先声明
 * per-monitor DPI aware，否则 `GetWindowRect` 给的是被系统虚拟化过的 DIP 值（150% 屏上
 * 差 1.5 倍），截出来的窗口就会偏。
 */

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Executors;

public static partial class AgentRuntimeDesktopExecutor
{
    /// <summary>一次最多回报这么多窗口 —— 桌面乱起来能有一百多个，全塞给模型只是噪声。</summary>
    private const int MaxListedWindows = 60;

    private const int DwmwaExtendedFrameBounds = 9;
    private const int DwmwaCloaked = 14;

    private static readonly object DpiAwarenessLock = new();
    private static bool dpiAwarenessAttempted;

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;

        public readonly int Width => Right - Left;

        public readonly int Height => Bottom - Top;
    }

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextW(IntPtr hWnd, StringBuilder text, int count);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowTextLengthW(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassNameW(IntPtr hWnd, StringBuilder name, int count);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out NativeRect rect);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out NativeRect rect, int size);

    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr hwnd, int attribute, out int value, int size);

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr value);

    /// <summary>
    /// 声明 per-monitor DPI aware（`DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2`）。
    ///
    /// 失败就算了：老系统没有这个 API、或进程已经设过而系统不允许再改，两种情况都不该让
    /// 截图工具整个不可用 —— 退化成「可能偏 1.5 倍」也比报错好。
    /// </summary>
    private static void EnsureProcessDpiAwareness()
    {
        lock (DpiAwarenessLock)
        {
            if (dpiAwarenessAttempted)
            {
                return;
            }
            dpiAwarenessAttempted = true;
        }

        try
        {
            SetProcessDpiAwarenessContext(new IntPtr(-4));
        }
        catch
        {
            // 见方法注释：尽力而为
        }
    }

    /// <summary>
    /// 枚举可见顶层窗口。按面积从大到小 —— 模型最想找的通常是最大的那个窗口。
    /// </summary>
    private static List<DesktopWindowEntry> EnumerateWindows()
    {
        EnsureProcessDpiAwareness();

        var results = new List<DesktopWindowEntry>();

        EnumWindows(
            (hWnd, _) =>
            {
                try
                {
                    if (!IsWindowVisible(hWnd))
                    {
                        return true;
                    }

                    // 幽灵窗口：UWP / 应用切换器留下的透明壳，可见但什么都没画
                    if (DwmGetWindowAttribute(hWnd, DwmwaCloaked, out int cloaked, sizeof(int)) == 0 &&
                        cloaked != 0)
                    {
                        return true;
                    }

                    var titleLength = GetWindowTextLengthW(hWnd);
                    if (titleLength <= 0)
                    {
                        return true;
                    }

                    var titleBuilder = new StringBuilder(titleLength + 1);
                    if (GetWindowTextW(hWnd, titleBuilder, titleBuilder.Capacity) == 0)
                    {
                        return true;
                    }

                    var classBuilder = new StringBuilder(256);
                    GetClassNameW(hWnd, classBuilder, classBuilder.Capacity);

                    var rect = ReadWindowRect(hWnd);
                    if (rect is null || rect.Value.Width <= 0 || rect.Value.Height <= 0)
                    {
                        return true;
                    }

                    GetWindowThreadProcessId(hWnd, out uint processId);
                    results.Add(new DesktopWindowEntry(
                        titleBuilder.ToString(),
                        classBuilder.ToString(),
                        (int)processId,
                        ResolveProcessName((int)processId),
                        rect.Value.Left,
                        rect.Value.Top,
                        rect.Value.Width,
                        rect.Value.Height,
                        IsIconic(hWnd)));
                }
                catch
                {
                    // 单个窗口读失败不该中断整次枚举 —— 继续下一个
                }

                return true;
            },
            IntPtr.Zero);

        results.Sort((left, right) =>
        {
            var areaComparison = ((long)right.Width * right.Height).CompareTo((long)left.Width * left.Height);
            return areaComparison != 0
                ? areaComparison
                : string.CompareOrdinal(left.Title, right.Title);
        });

        return results;
    }

    /// <summary>
    /// 取窗口矩形：优先 DWM 的扩展边框（去掉 Win10 的隐形阴影边），退回 `GetWindowRect`。
    /// 两者在 DPI 感知进程里都是物理像素。
    /// </summary>
    private static NativeRect? ReadWindowRect(IntPtr hWnd)
    {
        if (DwmGetWindowAttribute(
                hWnd,
                DwmwaExtendedFrameBounds,
                out NativeRect frame,
                Marshal.SizeOf<NativeRect>()) == 0 &&
            frame.Width > 0 &&
            frame.Height > 0)
        {
            return frame;
        }

        return GetWindowRect(hWnd, out NativeRect plain) && plain.Width > 0 && plain.Height > 0
            ? plain
            : null;
    }

    private static string ResolveProcessName(int processId)
    {
        try
        {
            using var process = Process.GetProcessById(processId);
            return process.ProcessName;
        }
        catch
        {
            return string.Empty;
        }
    }

    /// <summary>
    /// `DesktopListWindows` —— 把整屏的搜索空间拆成一个个窗口矩形，模型可以直接说
    /// 「第 3 个窗口的右上角区域」而不是在 2560×1440 里猜。
    /// </summary>
    private static RendererToolResult ExecuteListWindows(JsonElement input)
    {
        var match = JsonHelpers.GetString(input, "match")?.Trim();

        var windows = EnumerateWindows();
        var capturable = new List<DesktopWindowEntry>();
        foreach (var window in windows)
        {
            if (!DesktopWindowLocator.IsCapturable(window))
            {
                continue;
            }
            if (!string.IsNullOrEmpty(match) &&
                window.Title.IndexOf(match, StringComparison.OrdinalIgnoreCase) < 0)
            {
                continue;
            }
            capturable.Add(window);
            if (capturable.Count >= MaxListedWindows)
            {
                break;
            }
        }

        return StringResult(EncodeJsonObject(writer =>
        {
            writer.WriteBoolean("success", true);
            writer.WriteNumber("count", capturable.Count);
            writer.WritePropertyName("windows");
            writer.WriteStartArray();
            foreach (var window in capturable)
            {
                writer.WriteStartObject();
                writer.WriteString("title", window.Title);
                writer.WriteString("className", window.ClassName);
                writer.WriteString("processName", window.ProcessName);
                writer.WriteNumber("processId", window.ProcessId);
                writer.WriteNumber("x", window.X);
                writer.WriteNumber("y", window.Y);
                writer.WriteNumber("width", window.Width);
                writer.WriteNumber("height", window.Height);
                writer.WriteEndObject();
            }
            writer.WriteEndArray();
            writer.WriteString(
                "message",
                capturable.Count == 0
                    ? "No visible window matched. Window titles may differ from what you expect — call again without `match` to list them all."
                    : $"Listed {capturable.Count} visible window(s). Rectangles are screen physical pixels, the same frame DesktopClick uses.");
        }));
    }

    /// <summary>
    /// 按标题关键字找到窗口矩形，供 `DesktopScreenshot({ window })` 裁剪。
    /// 找不到时给模型一句能照着做的错，而不是只报「找不到」。
    /// </summary>
    private static bool TryResolveWindowTarget(
        string keyword,
        out DesktopWindowEntry? match,
        out RendererToolResult? errorResult)
    {
        EnsureProcessDpiAwareness();
        match = DesktopWindowLocator.FindBest(EnumerateWindows(), keyword);
        if (match is not null)
        {
            errorResult = null;
            return true;
        }

        errorResult = StringResult(
            EncodeError(
                $"No visible window matches \"{keyword}\". Call DesktopListWindows to see the exact titles, " +
                "or capture the whole desktop and measure from it."),
            true);
        return false;
    }
}
