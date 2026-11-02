using Avalonia;
using Avalonia.Controls.ApplicationLifetimes;
using Avalonia.Markup.Xaml;

namespace WishfulClaw.AvaloniaProbe;

public partial class App : Application
{
    /// <summary>由 <see cref="Program.Main"/> 在启动前写入。</summary>
    internal static ProbeOptions ProbeOptions { get; set; } =
        ProbeOptions.Parse(Array.Empty<string>());

    public override void Initialize() => AvaloniaXamlLoader.Load(this);

    public override void OnFrameworkInitializationCompleted()
    {
        if (ApplicationLifetime is IClassicDesktopStyleApplicationLifetime desktop)
        {
            desktop.MainWindow = new MainWindow();
        }

        base.OnFrameworkInitializationCompleted();
    }
}
