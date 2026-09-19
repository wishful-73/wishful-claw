using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Persona;

namespace WishfulClaw.GoalRegressionTests;

/// <summary>
/// iter-32 S-79 —— 沙箱段进系统提示词。
///
/// 守两件事：
/// 1. 段只在开关开着时出现（关掉时零 token 成本，也不能在提示词里留下「你在沙箱里」的假话）。
/// 2. 开关状态必须进 SystemPromptCache 的 cacheKey。
///    这条最容易漏，而漏了的表现是「切了开关仍返回旧提示词」—— 静默失效、不报错，所以钉死。
/// </summary>
internal static partial class Program
{
    private static void RunSandboxPromptSuite()
    {
        const string sandboxHeading = "## Sandbox mode";

        var enabled = ParseJson("""{"sandboxEnabled": true}""");
        var disabled = ParseJson("""{"sandboxEnabled": false}""");

        var withSandbox = BuildBootstrapPrompt(enabled, sandboxEnabled: true);
        var withoutSandbox = BuildBootstrapPrompt(disabled, sandboxEnabled: false);

        AssertEqual(
            true,
            withSandbox.Contains(sandboxHeading, StringComparison.Ordinal),
            "开关开着时提示词必须含沙箱段");
        AssertEqual(
            false,
            withoutSandbox.Contains(sandboxHeading, StringComparison.Ordinal),
            "开关关掉时提示词不能含沙箱段");

        // 段里必须点明「命令行内容不在校验范围」—— 代码拦不住的那半只能靠提示词讲清楚。
        AssertEqual(
            true,
            withSandbox.Contains("command contents", StringComparison.Ordinal),
            "沙箱段必须说明命令行内容不受校验");

        // 默认值：老调用方不传该参数时按「开」处理，结果要与显式 true 完全一致。
        var defaulted = PromptBuilder.Build(
            PromptProfile.Bootstrap,
            null,
            enabled,
            personaId: null,
            workingFolder: null,
            language: null,
            userRules: null);
        AssertEqual(withSandbox, defaulted, "sandboxEnabled 默认值必须等价于显式 true");

        // cacheKey：开关必须改变 key。
        var keyOn = SystemPromptCache.ComputeKey("p", "w", "zh", null, null, null, "chat", null, null, true);
        var keyOff = SystemPromptCache.ComputeKey("p", "w", "zh", null, null, null, "chat", null, null, false);
        AssertEqual(
            false,
            string.Equals(keyOn, keyOff, StringComparison.Ordinal),
            "cacheKey 必须区分沙箱开关（漏了会静默返回旧提示词）");
        AssertEqual(
            keyOn,
            SystemPromptCache.ComputeKey("p", "w", "zh", null, null, null, "chat", null, null),
            "不传 sandboxEnabled 时按开处理，key 与显式 true 一致");
    }

    private static string BuildBootstrapPrompt(JsonElement parameters, bool sandboxEnabled)
        => PromptBuilder.Build(
            PromptProfile.Bootstrap,
            null,
            parameters,
            personaId: null,
            workingFolder: null,
            language: null,
            userRules: null,
            sandboxEnabled: sandboxEnabled);
}
