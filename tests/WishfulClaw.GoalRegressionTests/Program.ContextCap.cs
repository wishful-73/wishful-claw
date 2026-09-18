using System.Text.Json;
using WishfulClaw.Agent;

namespace WishfulClaw.GoalRegressionTests;

/// <summary>
/// iter-32 S-73 —— 会话级「请求上下文上限」在 Worker 侧的施加点。
///
/// 四条 contextLength 读取点（ShouldCompress / ManualCompressionValueFloorTokens /
/// ContextCompression 的尾部预算与钉住预算）全部读同一个 provider 副本，所以夹心只做一次：
/// AgentLoop.ExecuteLoopAsync 在 provider 定稿后调 ApplyContextCap，四处自然一致。
/// 这组断言守的就是「只夹大窗口、不动小窗口、不动别的字段」这三件事。
/// </summary>
internal static partial class Program
{
    private static void RunContextCapSuite()
    {
        const string bigModel = """{"model":"m","apiKey":"k","contextLength":1048576}""";
        const string smallModel = """{"model":"m","apiKey":"k","contextLength":131072}""";
        const string noWindow = """{"model":"m","apiKey":"k"}""";

        // 关着：一个字节都不许动。
        AssertEqual(
            1048576,
            ContextLengthOf(AgentLoop.ApplyContextCap(Parse(bigModel), false)),
            "开关关闭时不动 contextLength");

        // 开着且模型窗口大于上限：夹到 256K。
        AssertEqual(
            256 * 1024,
            ContextLengthOf(AgentLoop.ApplyContextCap(Parse(bigModel), true)),
            "开关开启时 1M 窗口夹到 256K");

        // 开着但模型本来就更小：保持原值，开关不该把小模型也压下去。
        AssertEqual(
            131072,
            ContextLengthOf(AgentLoop.ApplyContextCap(Parse(smallModel), true)),
            "开关开启时小于上限的窗口保持原值");

        // 没声明 contextLength：不凭空造一个出来（压缩走 20 万兜底，与上限无关）。
        var noWindowProvider = AgentLoop.ApplyContextCap(Parse(noWindow), true);
        AssertEqual(
            false,
            noWindowProvider.TryGetProperty("contextLength", out _),
            "未声明 contextLength 时不新增该字段");

        // 其余字段原样保留。
        var capped = AgentLoop.ApplyContextCap(Parse(bigModel), true);
        AssertEqual("m", capped.GetProperty("model").GetString(), "夹心不动 model");
        AssertEqual("k", capped.GetProperty("apiKey").GetString(), "夹心不动 apiKey");

        // 边界：恰好等于上限时也不改写。
        var exact = Parse($$"""{"contextLength":{{256 * 1024}}}""");
        AssertEqual(
            256 * 1024,
            ContextLengthOf(AgentLoop.ApplyContextCap(exact, true)),
            "恰好等于上限时保持原值");
    }

    private static JsonElement Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static int ContextLengthOf(JsonElement provider)
        => provider.GetProperty("contextLength").GetInt32();
}
