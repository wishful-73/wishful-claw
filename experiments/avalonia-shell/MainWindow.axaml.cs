using System.Globalization;
using Avalonia;
using Avalonia.Controls;
using Avalonia.Layout;
using Avalonia.Media;
using Avalonia.Media.Imaging;
using Avalonia.Threading;

namespace WishfulClaw.AvaloniaProbe;

public partial class MainWindow : Window
{
    private readonly ProbeOptions _options;
    private readonly MemoryProbe _probe;
    private readonly DispatcherTimer _countdown;
    private readonly DispatcherTimer _streamTimer;
    private StackPanel? _streamPanel;
    private int _streamLines;

    public MainWindow()
    {
        _options = App.ProbeOptions;
        _probe = new MemoryProbe(_options);

        InitializeComponent();

        Width = _options.Width;
        Height = _options.Height;

        // 计时器必须先建：BuildStage() 里 Text 阶段会直接 Start() 它。
        _streamTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(40) };
        _streamTimer.Tick += OnStreamTick;

        BuildStage();

        _probe.Start(text => Dispatcher.UIThread.Post(() => StatusText.Text = text));

        _countdown = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _countdown.Tick += OnCountdownTick;
        _countdown.Start();
    }

    private TimeSpan _remaining => TimeSpan.FromSeconds(_options.Seconds);

    private void OnCountdownTick(object? sender, EventArgs e)
    {
        var elapsed = DateTime.UtcNow - _startedAtUtc;
        if (elapsed < _remaining) return;

        _countdown.Stop();
        _streamTimer.Stop();

        var report = _probe.Finish();
        var line = MemoryProbe.FormatReport(report);

        Console.WriteLine();
        Console.WriteLine($"== report ({_options.Stage}) ==");
        Console.WriteLine(line);
        Console.WriteLine(report.ToMarkdownRow());

        if (!string.IsNullOrWhiteSpace(_options.ReportPath))
        {
            try
            {
                File.WriteAllText(_options.ReportPath!, line + Environment.NewLine);
                Console.WriteLine($"written: {_options.ReportPath}");
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"report write failed: {ex.Message}");
            }
        }

        _probe.Dispose();
        Close();
    }

    private readonly DateTime _startedAtUtc = DateTime.UtcNow;

    /// <summary>
    /// 三态共用同一个 Grid 容器，只换内容 —— 这样「空 / 文本 / 图」之间的差值
    /// 才只归因于内容本身，不掺进第二套布局。
    /// </summary>
    private void BuildStage()
    {
        switch (_options.Stage)
        {
            case ProbeStage.Empty:
                break;

            case ProbeStage.Text:
                BuildTextStage();
                break;

            case ProbeStage.Image:
                BuildImageStage();
                break;
        }
    }

    /// <summary>
    /// 流式文本：每 40 ms 追加一行，模拟聊天窗一直有新内容进来。
    /// 这是最贴近「跑起来会涨」的场景 —— 纯静态一屏文本说明不了问题。
    /// </summary>
    private void BuildTextStage()
    {
        _streamPanel = new StackPanel { Spacing = 6 };

        var scroller = new ScrollViewer
        {
            Content = _streamPanel,
            VerticalScrollBarVisibility = Avalonia.Controls.Primitives.ScrollBarVisibility.Auto
        };

        ContentHost.Children.Add(scroller);
        _streamTimer.Start();
    }

    private void OnStreamTick(object? sender, EventArgs e)
    {
        if (_streamPanel is null) return;

        _streamLines += 1;

        var line = new TextBlock
        {
            Text = string.Create(
                CultureInfo.InvariantCulture,
                $"#{_streamLines:D5}  流式输出行 —— 这一段用来模拟 agent 一直在往聊天窗写内容，" +
                $"检查追加渲染时托管堆与工作集怎么走。"),
            Foreground = new SolidColorBrush(Color.Parse("#C9C9D1")),
            FontSize = 14,
            TextWrapping = TextWrapping.Wrap
        };

        _streamPanel.Children.Add(line);

        // 保持滚动到底部，跟真实聊天窗一样 —— 否则新行不进可视区，量的就不是「渲染中」。
        if (_streamPanel.Parent is ScrollViewer scroller)
        {
            scroller.ScrollToEnd();
        }

        // 上限 400 行：再多就不是「流式」，而是压力测试了，原型不负责那个。
        if (_streamPanel.Children.Count > 400)
        {
            _streamPanel.Children.RemoveAt(0);
        }
    }

    /// <summary>
    /// 一张 2520×1680 的图 —— 尺寸对齐我们桌面截图工具的产出。
    /// 用程序生成 PNG 再解码，而不是直接给控件一个内存位图：
    /// 真实场景是「PNG 落盘 → 解码 → 显示」，跳过解码会把内存量偏。
    /// </summary>
    private void BuildImageStage()
    {
        const int width = 2520;
        const int height = 1680;

        var pngPath = Path.Combine(Path.GetTempPath(), "wishfulclaw-avalonia-probe-2520x1680.png");
        ScreenshotFixture.EnsurePng(pngPath, width, height);

        var bitmap = new Bitmap(pngPath);

        var image = new Image
        {
            Source = bitmap,
            Stretch = Stretch.Uniform,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Center
        };

        ContentHost.Children.Add(image);
    }
}
