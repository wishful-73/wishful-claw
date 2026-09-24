/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Text.Json;
using WishfulClaw.Agent.Tools.FileTools;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// 视频抽帧的反向请求通路（S-145 §六）：worker 里的 Read 命中视频文件时，帧只能由渲染端解出来。
///
/// 为什么不在 C# 侧解码：解码器只存在于渲染端的 Chromium。引 ffmpeg 之类的库要带进
/// 一个几十 MB 的原生二进制和它的许可问题，而同一台机器上已经有一个能解码的 Chromium。
/// 所以走既有的 `agent/reverse-request` 通道（`AgentRuntimeBrowserExecutor` 用的是同一条），
/// 渲染端抽好 JPEG 再送回来。
///
/// 抽帧的参数（几帧、多大、文件上限）是产品策略，全部落在 <see cref="VideoFileProbe"/>，
/// 由这里随请求发下去；渲染端只执行，不自己定策略。
/// </summary>
internal static class AgentRuntimeVideoFrameExtraction
{
    /// <summary>与渲染端 `renderer-tool-bridge` 里注册的方法名一致。</summary>
    internal const string Method = "vision/extract-video-frames";

    /// <summary>
    /// 交给 <see cref="ToolExecutionContext.VideoFrameExtractor"/> 的回调。
    /// 失败一律变成 <see cref="VideoFrameExtraction.Error"/> 而不是异常：抽不到帧是预期结果之一
    /// （编码不支持、文件太大、模型不看图），不该让整条工具调用链崩掉。
    /// </summary>
    internal static Func<string, CancellationToken, Task<VideoFrameExtraction>> CreateExtractor(
        IWorkerRequestContext context) =>
        (path, cancellationToken) => ExtractAsync(context, path, cancellationToken);

    private static async Task<VideoFrameExtraction> ExtractAsync(
        IWorkerRequestContext context,
        string path,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await AgentRuntimeReverseRequests.RequestAsync(
                context,
                Method,
                BuildRequest(path),
                cancellationToken);

            return Parse(result);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            return new VideoFrameExtraction(Error: $"the renderer could not extract frames ({ex.Message})");
        }
    }

    private static JsonElement BuildRequest(string path)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            writer.WriteString("path", path);
            writer.WriteNumber("frameCount", VideoFileProbe.FrameCount);
            writer.WriteNumber("maxEdge", VideoFileProbe.MaxEdge);
            writer.WriteNumber("maxBytes", VideoFileProbe.MaxBytes);
            writer.WriteEndObject();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static VideoFrameExtraction Parse(JsonElement result)
    {
        if (result.ValueKind != JsonValueKind.Object)
        {
            return new VideoFrameExtraction(Error: "the renderer returned no result");
        }

        var error = JsonHelpers.GetString(result, "error");
        if (!string.IsNullOrEmpty(error))
        {
            return new VideoFrameExtraction(Error: error);
        }

        if (!result.TryGetProperty("frames", out var framesElement) ||
            framesElement.ValueKind != JsonValueKind.Array)
        {
            return new VideoFrameExtraction(Error: "the renderer returned no frames");
        }

        var frames = new List<VideoFrame>();
        foreach (var item in framesElement.EnumerateArray())
        {
            var data = JsonHelpers.GetString(item, "data");
            if (string.IsNullOrEmpty(data)) continue;

            frames.Add(new VideoFrame(
                data,
                JsonHelpers.GetString(item, "mediaType") ?? "image/jpeg",
                JsonHelpers.GetDoubleNullable(item, "timestampSec") ?? 0));
        }

        if (frames.Count == 0)
        {
            return new VideoFrameExtraction(Error: "the renderer returned an empty frame list");
        }

        return new VideoFrameExtraction(
            frames,
            JsonHelpers.GetDoubleNullable(result, "durationSec") ?? 0,
            JsonHelpers.GetInt(result, "width", 0),
            JsonHelpers.GetInt(result, "height", 0));
    }
}
