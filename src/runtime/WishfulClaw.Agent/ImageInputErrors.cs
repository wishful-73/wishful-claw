namespace WishfulClaw.Agent;

/// <summary>
/// 识别上游因「这个模型不吃图像输入」而拒绝请求的错误（S-236 档 2）。
///
/// 触发场景：我们按「不确定就放行」的策略把 image 块送了出去（见 <c>FileReadTool.ReadImage</c>
/// 与渲染端 <c>visual-context.ts</c> 的注释），上游回 400 说它不支持图像。
/// 这不是用户的错，也不是配置该提前预言的事 —— 交给上游回答，撞上了就剥图重试。
///
/// 判定刻意保守，理由与 <see cref="ToolPairingErrors"/> 完全一致：只认「明确在讲图像输入」的文案。
/// 其它 400（模型不存在、参数错、配额）一律不匹配，它们要继续走
/// <see cref="ProviderRetryPolicy"/> 的重试（400 可重试是有意设计）。
///
/// 即便如此，单靠文案仍可能误伤（比如「does not support image generation」讲的是生成不是输入）。
/// 所以**调用方必须先确认「本轮请求里真的带 image 块」再来问这里** —— 没有图可剥时
/// 匹配成功也没有意义，直接放行走原报错路径。这层前置检查在 <c>AgentLoop</c> 的
/// catch 分支里，是保守判定的第二道闸。
///
/// 另一个已知局限：中转渠道可能把上游报错改写成一句笼统的 400。那时认不出来，
/// 用户看到的是明确的 400 报错 —— 仍然好过 S-236 修复前「静默吞掉像素让模型猜内容」。
/// </summary>
internal static class ImageInputErrors
{
    /// <summary>
    /// **「这张图坏了」** 的原文形态（S-264 拆出）。
    ///
    /// 与 <see cref="CapabilityMarkers"/> 的区别是这条线的全部要害：模型可能**有**视觉能力，
    /// 只是这一张图它解析不了。S-261 的现场原文 `You have uploaded an unsupported image`
    /// （语序是「你上传的不受支持的图像」）属于这一类 —— 不是「模型不支持图像输入」。
    ///
    /// 分开的理由不在剥图（两类都该剥），在**记忆**：`ImageVisionMemory` 是落盘永久、
    /// 无解封路径的，把「这张图坏了」记成「这个模型永远不能看图」是不可逆的误伤。
    /// </summary>
    private static readonly string[] DataRejectionMarkers =
    [
        // S-261 现场原句：`.messages[477].image[0]: You have uploaded an unsupported image ...`
        "unsupported image",
        "invalid image",
        "image is not valid",
        "image format is not supported",
        "unsupported image format",
        // 中文侧「格式不收」，语序与能力类的「不支持图片」相反
        "图片格式不支持",
        "图像格式不支持"
    ];

    /// <summary>
    /// **「模型没有视觉能力」** 的原文形态。
    ///
    /// 只有这一种才配写进 <see cref="ImageVisionMemory"/> —— 它是真的能力边界，
    /// 下次不用再白送一遍图。判据刻意保守：认不出归哪一类就不写，宁可多撞一次 400，
    /// 也不能把能看图的模型记成瞎的。
    /// </summary>
    private static readonly string[] CapabilityMarkers =
    [
        // OpenAI 及兼容中转：明确点名 image_url 这个内容类型
        "image_url is only supported",
        "image_url is not supported",
        "image input is not supported",
        // 覆盖 does not support image / images / image input / image content
        "does not support image",
        "image is not supported",
        // DeepSeek / serde 系：content 里的 image_url variant 直接被反序列化拒掉
        // 注意原文用反引号包住标识符，正反两种引号都列上
        "unknown variant `image_url`",
        "unknown variant \"image_url\"",
        // Anthropic 系
        "not a multimodal",
        "does not support multimodal",
        // 中文渠道（智谱 / 通义 / 豆包等）
        "不支持图片",
        "不支持图像",
        "不支持多模态",
        "不支持视觉"
    ];

    /// <summary>
    /// 上游因为图像而拒绝请求 —— **两类都算**。剥图行为对两类是一样的，所以这里不区分。
    /// </summary>
    internal static bool IsImageUnsupportedError(Exception exception)
    {
        return MatchesAny(exception, DataRejectionMarkers) ||
               MatchesAny(exception, CapabilityMarkers);
    }

    /// <summary>
    /// 这次拒绝是**「图本身有问题」**（S-264）：命中脏图 marker，且没有任何能力 marker。
    ///
    /// 刻意要求「能力 marker 一条都没命中」才返回 true —— 两条都命中时无法判断是哪种，
    /// 按旧行为（写记忆）处理。这个方向的选择理由是代价不对称：多撞一次 400 只是慢，
    /// 误记成瞎的是**不可逆**的。
    /// </summary>
    internal static bool IsImageDataRejection(Exception exception)
    {
        return MatchesAny(exception, DataRejectionMarkers) &&
               !MatchesAny(exception, CapabilityMarkers);
    }

    private static bool MatchesAny(Exception exception, string[] markers)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (string.IsNullOrEmpty(current.Message))
            {
                continue;
            }

            foreach (var marker in markers)
            {
                if (current.Message.Contains(marker, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
        }

        return false;
    }
}
