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
    private static readonly string[] Markers =
    [
        // OpenAI 及兼容中转：明确点名 image_url 这个内容类型
        "image_url is only supported",
        "image_url is not supported",
        "image input is not supported",
        // 覆盖 does not support image / images / image input / image content
        "does not support image",
        // S-261：上游对「格式不收」的原文形态。现场原句是
        //   `.messages[477].image[0]: You have uploaded an unsupported image ...`
        // 它与上面 `does not support image` **词形不同**（un**supported** ≠ does not support），
        // 修复前一条都匹配不上 ⇒ 剥图自愈进不去，脏块留历史每轮 400，会话废掉。
        //
        // 这条比其它 marker 宽，敢放的理由是**判据有两道闸兜底**（AgentLoop.cs:464）：
        //   ①本 run 已剥过一次还撞同一个错 ⇒ 原样抛；②本轮压根没有 image 块可剥 ⇒ 原样抛。
        // 也就是「宽匹配」最多多剥一次图，不会把无关 400 吞成图像问题（S-236 判据 10 红线）。
        "unsupported image",
        // 同族的其它原文形态
        "image format is not supported",
        "image is not supported",
        "invalid image",
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
        "不支持视觉",
        // S-261：中文侧「格式不收」的语序与上面相反，单独列
        "图片格式不支持",
        "图像格式不支持"
    ];

    internal static bool IsImageUnsupportedError(Exception exception)
    {
        for (Exception? current = exception; current is not null; current = current.InnerException)
        {
            if (string.IsNullOrEmpty(current.Message))
            {
                continue;
            }

            foreach (var marker in Markers)
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
