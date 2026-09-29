namespace WishfulClaw.Core.Tools;

/// <summary>
/// 渲染端抽出来的一帧（S-145 §六）。
/// </summary>
/// <param name="Data">base64 图像数据，不含 <c>data:</c> 前缀。</param>
/// <param name="MediaType">帧的 MIME。当前恒为 <c>image/jpeg</c> —— 抽帧统一转 JPEG，体积可控。</param>
/// <param name="TimestampSec">这一帧取在视频的第几秒，写进给模型的说明里。</param>
public sealed record VideoFrame(string Data, string MediaType, double TimestampSec);

/// <summary>
/// 一次视频抽帧的结果（S-145 §六）。
///
/// 视频抽帧只能在渲染端做（那里才有解码器），C# 的 Read 通过
/// <see cref="ToolExecutionContext.VideoFrameExtractor"/> 把请求递过去。
/// <see cref="Error"/> 非空表示拿不到像素 —— 调用方必须把这个原因写进返回给模型的文本里，
/// 不允许静默降级：模型看不到像素却以为看到了，会开始编内容。
/// </summary>
/// <param name="Frames">抽样帧，按时间顺序。</param>
/// <param name="DurationSec">视频时长，用于那句说明。</param>
/// <param name="Width">视频像素宽（未缩放）。</param>
/// <param name="Height">视频像素高（未缩放）。</param>
/// <param name="Error">失败原因；成功时为 null。</param>
public sealed record VideoFrameExtraction(
    IReadOnlyList<VideoFrame>? Frames = null,
    double DurationSec = 0,
    int Width = 0,
    int Height = 0,
    string? Error = null);
