using System;

using System.Collections.Generic;

using System.IO;

namespace WishfulClaw.Agent.Tools.FileTools;

/// <summary>
/// 视频文件的最小探测（S-145 §六）。只做一件事：按扩展名认出视频并给出 mediaType。
///
/// 尺寸不在这里读：容器尺寸要么在 mvhd / Track 头里（ISO BMFF），要么得解 EBML 变长整数
/// （Matroska/WebM），为一句说明写两套盒子解析不划算 —— 抽帧时渲染端本来就会报回
/// videoWidth / videoHeight，说明里的尺寸用它。
///
/// <see cref="MediaTypes"/> 必须与渲染端 `src/renderer/src/lib/media-file-types.ts` 的
/// VIDEO_MIME_TYPES 逐项一致：一边认得出、另一边认不出，表现就是「能播却抽不了帧」这种半可用。
/// 跨语言没法共用代码，`WishfulClaw.ReadVideoRegressionTests` 会逐项比对两侧。
/// </summary>
internal static class VideoFileProbe
{
    /// <summary>抽几帧。四帧足够看清开头/发展/结尾，再多就是白烧上下文。</summary>
    internal const int FrameCount = 4;

    /// <summary>帧长边上限（像素）。只缩不放：模型不需要原始分辨率，token 却按像素算。</summary>
    internal const int MaxEdge = 768;

    /// <summary>抽帧的文件体积上限（256 MB）。超过就降级说明，不让渲染端去搬一个巨型文件。</summary>
    internal const long MaxBytes = 256L * 1024 * 1024;

    /// <summary>扩展名 → MIME。单一份表，判定与枚举都读它。</summary>
    internal static IReadOnlyDictionary<string, string> MediaTypes { get; } =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            [".mp4"] = "video/mp4",
            [".webm"] = "video/webm",
            [".ogv"] = "video/ogg",
            [".ogg"] = "video/ogg",
            [".mov"] = "video/quicktime",
            [".m4v"] = "video/x-m4v",
            [".mkv"] = "video/x-matroska",
            [".avi"] = "video/x-msvideo",
            [".mpeg"] = "video/mpeg",
            [".mpg"] = "video/mpeg",
            [".3gp"] = "video/3gpp",
            [".3g2"] = "video/3gpp2",
            [".mts"] = "video/mp2t",
            [".m2ts"] = "video/mp2t"
        };

    /// <summary>按扩展名判断是不是本工具认的视频；不是则返回 null。</summary>
    public static string? MediaTypeFor(string path) =>
        MediaTypes.TryGetValue(Path.GetExtension(path).ToLowerInvariant(), out var mediaType) ? mediaType : null;

    public static bool IsVideoPath(string path) => MediaTypeFor(path) is not null;
}
