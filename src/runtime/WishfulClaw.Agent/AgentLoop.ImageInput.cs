using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// 图像输入的剥图与降级（S-236 档 2）。
///
/// **为什么需要这一层。** S-236 之前，本地那张 <c>supportsVision</c> 表替模型决定了
/// 能不能看图：判 false 就静默不附像素。这张表追不上新模型、追不上反代渠道、追不上
/// 用户自定义模型，还会在跨 provider 同名 id 时串号（同一个 <c>glm-5.3</c> 在四个渠道里
/// 标法不一），于是出现「截图能识图、Read 不能」这种自相矛盾的现场。
///
/// 档 2 把判断权交回上游：
/// <list type="number">
/// <item>一律带图发出（<c>FileReadTool</c> / <c>visual-context.ts</c> 已摘掉拦截）；</item>
/// <item>上游回「不吃图像输入」→ <see cref="ImageInputErrors"/> 认出来 → 剥图重发；</item>
/// <item>剥完还失败、或认不出是图像问题 → 正常报错，不静默吞。</item>
/// </list>
///
/// **剥的是哪一份对话。** 只剥 <c>ExecuteTurnAsync</c> 每轮现造的临时副本
/// （wire conversation）。<c>conversation</c> 是 <c>SessionConversation</c> 的活引用，
/// 在它上面删块等于改用户的历史记录 —— 切回会话会发现图没了。这一点是本文件的红线。
/// </summary>
internal static partial class AgentLoop
{
    /// <summary>OpenAI 系的图像块类型名。</summary>
    private const string ImageBlockTypeOpenAi = "image_url";

    /// <summary>Anthropic 系的图像块类型名。</summary>
    private const string ImageBlockTypeAnthropic = "image";

    /// <summary>
    /// 已知这个模型看不到图时，把 image 块从临时副本里剥掉。
    ///
    /// 触发来源有二：本 run 刚撞过一次（<see cref="AgentRuntimeRunState.SuppressImagesForModel"/>），
    /// 或以前撞过并记进了落盘的 <see cref="ImageVisionMemory"/>。都没命中时原样返回（零拷贝）。
    ///
    /// 剥掉 image 之后 text 段仍在 —— <c>FileReadTool</c> 产出的是
    /// <c>[text("Read image: 路径 (尺寸, 类型)"), image]</c>，所以模型仍知道读的是哪个文件、
    /// 多大、什么格式，信息量与旧版「不支持视觉」时的降级输出一致。
    /// </summary>
    private static List<AgentRuntimeChatMessage> StripImagesWhenModelCannotSee(
        JsonElement provider,
        List<AgentRuntimeChatMessage> conversation,
        AgentRuntimeRunState state)
    {
        var known =
            state.SuppressImagesForModel ||
            ImageVisionMemory.IsKnownUnsupported(
                JsonHelpers.GetString(provider, "id"),
                JsonHelpers.GetString(provider, "model"));

        if (!known) return conversation;

        var stripped = 0;
        var result = new List<AgentRuntimeChatMessage>(conversation.Count);
        foreach (var message in conversation)
        {
            if (message.ContentBlocks is not { Count: > 0 } blocks)
            {
                result.Add(message);
                continue;
            }

            var kept = new List<JsonElement>(blocks.Count);
            foreach (var block in blocks)
            {
                if (IsImageContentBlock(block))
                {
                    stripped++;
                    continue;
                }

                kept.Add(block);
            }

            result.Add(kept.Count == blocks.Count ? message : message with { ContentBlocks = kept });
        }

        if (stripped > 0)
        {
            WorkerLog.Debug(
                $"image blocks stripped before provider turn " +
                $"(model={(JsonHelpers.GetString(provider, "model") ?? "?")}) count={stripped}");
        }

        return result;
    }

    /// <summary>
    /// 这份对话里还有没有图像块。catch 分支的**第二道闸**：没有图可剥时，
    /// <see cref="ImageInputErrors"/> 即使匹配成功也没有意义 —— 问题不在图上，
    /// 必须原样抛出去走正常报错，不能被这条降级路径吞掉。
    /// </summary>
    private static bool ConversationHasImageBlocks(List<AgentRuntimeChatMessage> conversation)
    {
        foreach (var message in conversation)
        {
            if (message.ContentBlocks is not { Count: > 0 } blocks)
            {
                continue;
            }

            foreach (var block in blocks)
            {
                if (IsImageContentBlock(block))
                {
                    return true;
                }
            }
        }

        return false;
    }

    /// <summary>
    /// 这个 content 块是不是图像。两种协议的名称都要认：
    /// Anthropic 用 <c>{ "type": "image", "source": {...} }</c>，
    /// OpenAI 用 <c>{ "type": "image_url", "image_url": { "url": ... } }</c>。
    /// 只认这两个名字，别的一律当正文留着 —— 宁可漏剥一个自定义块，也不能把文字删了。
    /// </summary>
    private static bool IsImageContentBlock(JsonElement block)
    {
        if (block.ValueKind != JsonValueKind.Object) return false;
        if (!block.TryGetProperty("type", out var type) || type.ValueKind != JsonValueKind.String)
        {
            return false;
        }

        var name = type.GetString();
        return string.Equals(name, ImageBlockTypeAnthropic, StringComparison.OrdinalIgnoreCase)
            || string.Equals(name, ImageBlockTypeOpenAi, StringComparison.OrdinalIgnoreCase);
    }
}
