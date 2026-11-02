using System.Collections.ObjectModel;
using System.ComponentModel;

namespace WishfulClaw.AvaloniaProbe;

/// <summary>
/// 一条聊天消息的最小投影。
///
/// 只保留「会变成控件」的四样东西：段落、代码块、工具卡、图片。
/// 这四样正好是我们真实聊天窗里一条助手消息最占渲染成本的部分 ——
/// 消息列表本身是虚拟化的，贵的是单条消息内部的控件数量。
/// </summary>
internal sealed class ChatMessage : INotifyPropertyChanged
{
    public ChatMessage(bool isUser, string title)
    {
        IsUser = isUser;
        Title = title;
    }

    public bool IsUser { get; }

    public string Title { get; }

    /// <summary>
    /// 段落用 ObservableCollection：流式输出时直接往里加，
    /// 走的是增量渲染路径，跟真实聊天窗一致。换成整体重建就不是同一个成本模型了。
    /// </summary>
    public ObservableCollection<string> Paragraphs { get; } = new();

    public string? CodeBlock { get; init; }

    public string? ToolName { get; init; }

    public string? ToolDetail { get; init; }

    public bool HasImage { get; init; }

    private bool _isStreaming;

    public bool IsStreaming
    {
        get => _isStreaming;
        set
        {
            if (_isStreaming == value) return;
            _isStreaming = value;
            PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsStreaming)));
        }
    }

    public event PropertyChangedEventHandler? PropertyChanged;
}
