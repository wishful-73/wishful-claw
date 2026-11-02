using Avalonia;
using Avalonia.Controls;

namespace WishfulClaw.AvaloniaProbe;

/// <summary>
/// S-295 原型入口。唯一职责：按 <c>--stage</c> 摆出对应界面，量常驻内存。
///
/// 用法：
///   WishfulClaw.AvaloniaProbe --stage empty|text|image [--seconds 20] [--report &lt;path&gt;]
///
/// 刻意不做的事：不连 worker、不读仓库数据、不装依赖注入。原型多一样东西，
/// 量出来的数就少一分可比性。
/// </summary>
internal static class Program
{
    [STAThread]
    public static int Main(string[] args)
    {
        var options = ProbeOptions.Parse(args);

        App.ProbeOptions = options;

        BuildAvaloniaApp().StartWithClassicDesktopLifetime(args);

        return 0;
    }

    public static AppBuilder BuildAvaloniaApp()
    {
        var builder = AppBuilder.Configure<App>().UsePlatformDetect();

        if (App.ProbeOptions.SoftwareRendering)
        {
            // 只用软件光栅，不建 GLES/ANGLE 上下文。用来把「GPU 上下文的固定开销」
            // 从空窗口基线里剥出来。
            builder = builder.With(new Win32PlatformOptions
            {
                RenderingMode = new[] { Win32RenderingMode.Software }
            });
        }

        return builder.LogToTrace();
    }
}
