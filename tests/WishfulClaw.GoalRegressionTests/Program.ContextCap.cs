using System.Text.Json;
using WishfulClaw.Agent;

namespace WishfulClaw.GoalRegressionTests;

/// <summary>
/// iter-32 S-73 / S-84 —— 会话级「请求上下文上限」在 Worker 侧的施加点。
///
/// 四条 contextLength 读取点（ShouldCompress / ManualCompressionValueFloorTokens /
/// ContextCompression 的尾部预算与钉住预算）全部读同一个 provider 副本，所以夹心只做一次：
/// AgentLoop.ExecuteLoopAsync 在 provider 定稿后调 ApplyContextCap，四处自然一致。
/// 渲染端随 run 下发的已经是「判过模型 id」之后的数 —— 换模型后传 0，这里就不用再判模型。
/// 这组断言守的就是「只夹大窗口、不动小窗口、不动别的字段、0 等于不动」这四件事。
/// </summary>
internal static partial class Program
{
    private const int Cap256K = 256 * 1024;

    private static void RunContextCapSuite()
    {
        const string bigModel = """{"model":"m","apiKey":"k","contextLength":1048576}""";
        const string smallModel = """{"model":"m","apiKey":"k","contextLength":131072}""";
        const string noWindow = """{"model":"m","apiKey":"k"}""";

        // 0 = 不限制：一个字节都不许动。
        AssertEqual(
            1048576,
            ContextLengthOf(AgentLoop.ApplyContextCap(Parse(bigModel), 0)),
            "上限为 0 时不动 contextLength");

        // 设了上限且模型窗口更大：夹到上限。
        AssertEqual(
            Cap256K,
            ContextLengthOf(AgentLoop.ApplyContextCap(Parse(bigModel), Cap256K)),
            "1M 窗口夹到 256K");

        // 上限比模型窗口还大：保持原值，不该把小模型也抬上来或压下去。
        AssertEqual(
            131072,
            ContextLengthOf(AgentLoop.ApplyContextCap(Parse(smallModel), Cap256K)),
            "小于上限的窗口保持原值");

        // 没声明 contextLength：不凭空造一个出来（压缩走 20 万兜底，与上限无关）。
        var noWindowProvider = AgentLoop.ApplyContextCap(Parse(noWindow), Cap256K);
        AssertEqual(
            false,
            noWindowProvider.TryGetProperty("contextLength", out _),
            "未声明 contextLength 时不新增该字段");

        // 其余字段原样保留。
        var capped = AgentLoop.ApplyContextCap(Parse(bigModel), Cap256K);
        AssertEqual("m", capped.GetProperty("model").GetString(), "夹心不动 model");
        AssertEqual("k", capped.GetProperty("apiKey").GetString(), "夹心不动 apiKey");

        // 边界：恰好等于上限时也不改写。
        var exact = Parse($$"""{"contextLength":{{Cap256K}}}""");
        AssertEqual(
            Cap256K,
            ContextLengthOf(AgentLoop.ApplyContextCap(exact, Cap256K)),
            "恰好等于上限时保持原值");

        // 用户自己拖出来的非整数上限也得原样用上（200K 是滑杆下限）。
        AssertEqual(
            200 * 1024,
            ContextLengthOf(AgentLoop.ApplyContextCap(Parse(bigModel), 200 * 1024)),
            "自定义上限照用");
    }

    private static JsonElement Parse(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static int ContextLengthOf(JsonElement provider)
        => provider.GetProperty("contextLength").GetInt32();
}
