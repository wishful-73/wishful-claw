namespace WishfulClaw.AvaloniaProbe;

/// <summary>原型要展示的阶段。三态各量一次，才有「壳的基线 / 加文本 / 加图」的差值。</summary>
internal enum ProbeStage
{
    /// <summary>只有窗口，什么都不放。这是 Avalonia 壳的裸基线。</summary>
    Empty,

    /// <summary>流式追加文本，模拟聊天窗一直在出新内容。</summary>
    Text,

    /// <summary>一张 2520×1680 的图 —— 与我们截图工具产出的尺寸一致。</summary>
    Image,

    /// <summary>
    /// 完整聊天场景：虚拟化消息列表 + 段落 + 代码块 + 工具卡 + 图片。
    /// 空窗口只说明壳的基线，说明不了换壳能不能治内存 —— 这个阶段才是真对比。
    /// </summary>
    Chat
}

internal sealed class ProbeOptions
{
    public ProbeStage Stage { get; private init; } = ProbeStage.Empty;

    /// <summary>跑多久后自动退出。默认 20 秒 —— 内存要等布局稳定才准。</summary>
    public int Seconds { get; private init; } = 20;

    /// <summary>报告落盘路径；不给就只打到控制台。</summary>
    public string? ReportPath { get; private init; }

    /// <summary>窗口尺寸。默认接近我们主窗（1440×900 逻辑像素）。</summary>
    public int Width { get; private init; } = 1440;

    public int Height { get; private init; } = 900;

    /// <summary>
    /// 强制软件渲染。加这个开关是为了回答一个问题：
    /// 空窗口那 150+ MB 里有多少是 GPU/GLES 上下文？Astra Gate 报的 50 MB
    /// 如果是在无 GPU 加速的环境下测的，那就跟带 GPU 的客户端不可比。
    /// </summary>
    public bool SoftwareRendering { get; private init; }

    /// <summary>Chat 阶段造多少条历史消息。默认 200 —— 大致是重度用户一两天的量。</summary>
    public int MessageCount { get; private init; } = 200;

    /// <summary>Chat 阶段是否开流式追加。静态历史量的是「加载后常驻」，流式量的是「边跑边涨」。</summary>
    public bool Streaming { get; private init; }

    public static ProbeOptions Parse(string[] args)
    {
        var stage = ProbeStage.Empty;
        var seconds = 20;
        string? report = null;
        var width = 1440;
        var height = 900;
        var software = false;
        var messageCount = 200;
        var streaming = false;

        for (var i = 0; i < args.Length; i++)
        {
            var current = args[i];
            var next = i + 1 < args.Length ? args[i + 1] : null;

            switch (current)
            {
                case "--stage" when next is not null:
                    stage = next.ToLowerInvariant() switch
                    {
                        "empty" => ProbeStage.Empty,
                        "text" => ProbeStage.Text,
                        "image" => ProbeStage.Image,
                        "chat" => ProbeStage.Chat,
                        _ => throw new ArgumentException($"unknown stage: {next}")
                    };
                    i++;
                    break;
                case "--seconds" when next is not null:
                    seconds = Math.Clamp(int.Parse(next), 3, 600);
                    i++;
                    break;
                case "--report" when next is not null:
                    report = next;
                    i++;
                    break;
                case "--width" when next is not null:
                    width = Math.Clamp(int.Parse(next), 320, 7680);
                    i++;
                    break;
                case "--height" when next is not null:
                    height = Math.Clamp(int.Parse(next), 240, 4320);
                    i++;
                    break;
                case "--software":
                    software = true;
                    break;
                case "--messages" when next is not null:
                    messageCount = Math.Clamp(int.Parse(next), 1, 5000);
                    i++;
                    break;
                case "--stream":
                    streaming = true;
                    break;
            }
        }

        return new ProbeOptions
        {
            Stage = stage,
            Seconds = seconds,
            ReportPath = report,
            Width = width,
            Height = height,
            SoftwareRendering = software,
            MessageCount = messageCount,
            Streaming = streaming
        };
    }
}
