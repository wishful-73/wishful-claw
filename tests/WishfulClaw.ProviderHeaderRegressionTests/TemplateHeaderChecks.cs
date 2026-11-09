using System.Net.Http;
using System.Text.Json;
using WishfulClaw.Agent.Llm;
using WishfulClaw.Agent;

namespace WishfulClaw.ProviderHeaderRegressionTests;

/// <summary>
/// S-316：<c>requestOverrides.headers</c> 的值模板从「只认 sessionId / model」扩到
/// 「provider 顶层任意标量」，以及「用户手配的同名头必须压过内置注入」。
///
/// 走 <see cref="OpenAIChatProvider.ApplyHeaders"/> 而不是直接调
/// <c>ProviderRequestOverrides</c>，因为这里要钉的死角是**注入顺序**：
/// 内置注入跑在 <c>ApplyHttpHeaderOverrides</c> 之后，而
/// <c>TryAddWithoutValidation</c> 对已存在的头是追加第二个值，不是替换。
/// </summary>
internal static class TemplateHeaderChecks
{
    public static void Run()
    {
        TemplateExpandsOrganizationAndProject();
        EmptyTemplateDropsTheHeader();
        UnknownPlaceholderIsLeftUntouched();
        DebugMirrorIsCaseInsensitive();
    }

    private static void TemplateExpandsOrganizationAndProject()
    {
        var provider = BuildProvider(
            new Dictionary<string, string>
            {
                ["OpenAI-Organization"] = "{{organization}}",
                ["OpenAI-Project"] = "{{ project }}"
            },
            organization: "org-123",
            project: "proj-456");

        using var request = NewRequest();
        OpenAIChatProvider.ApplyHeaders(request, provider, "secret-key", null);

        AssertValue(request, "OpenAI-Organization", "org-123", "{{organization}} expands from the provider field");
        AssertValue(request, "OpenAI-Project", "proj-456", "{{ project }} (spaced) expands too");
    }

    private static void EmptyTemplateDropsTheHeader()
    {
        // 预设里无条件声明这两条头，用户没填 organization 时必须整条不发 —— 否则
        // 每个 openai provider 都会带上一个值为空字符串的组织头。
        var provider = BuildProvider(
            new Dictionary<string, string>
            {
                ["OpenAI-Organization"] = "{{organization}}",
                ["OpenAI-Project"] = "{{project}}"
            });

        using var request = NewRequest();
        OpenAIChatProvider.ApplyHeaders(request, provider, "secret-key", null);

        Assert(!request.Headers.Contains("OpenAI-Organization"), "unset organization drops the header entirely");
        Assert(!request.Headers.Contains("OpenAI-Project"), "unset project drops the header entirely");

        var debug = OpenAIChatProvider.BuildDebugHeaders(provider, null);
        Assert(!HasKey(debug, "OpenAI-Organization"), "debug view drops it too");
    }

    private static void UnknownPlaceholderIsLeftUntouched()
    {
        // 只替换已知字段，未知的按字面量发出去 —— 用户可能真想发一段含花括号的值，
        // 静默清空比留下原文更糟。
        var provider = BuildProvider(new Dictionary<string, string>
        {
            ["X-Custom"] = "prefix-{{unknown}}-suffix"
        });

        using var request = NewRequest();
        OpenAIChatProvider.ApplyHeaders(request, provider, "secret-key", null);

        AssertValue(request, "X-Custom", "prefix-{{unknown}}-suffix", "unknown placeholders survive verbatim");
    }

    private static void DebugMirrorIsCaseInsensitive()
    {
        // HasHeaderKey 大小写不敏感：用户手配 `x-opencode-session` 时，内置注入不能
        // 再写一个值进去，debug 镜像里也必须只出现一次。
        var provider = BuildProvider(
            new Dictionary<string, string> { ["x-opencode-session"] = "user-typed" },
            providerBuiltinId: "opencode-go");

        var debug = OpenAIChatProvider.BuildDebugHeaders(provider, "session-abc");

        var matches = debug.Keys
            .Where(key => string.Equals(key, "x-opencode-session", StringComparison.OrdinalIgnoreCase))
            .ToArray();
        Assert(matches.Length == 1, "debug view lists the injected header exactly once regardless of casing");
        Assert(debug[matches[0]] == "user-typed", "debug view shows the user's value, not the injected one");
    }

    // ── helpers ──

    private static HttpRequestMessage NewRequest()
    {
        return new HttpRequestMessage(HttpMethod.Post, "https://example.test/v1/chat/completions");
    }

    private static JsonElement BuildProvider(
        Dictionary<string, string>? overrideHeaders = null,
        string? organization = null,
        string? project = null,
        string providerBuiltinId = "openai")
    {
        var provider = new Dictionary<string, object?>
        {
            ["apiKey"] = "secret-key",
            ["userAgent"] = "test-agent",
            ["providerBuiltinId"] = providerBuiltinId,
            ["sessionId"] = "session-abc",
            ["model"] = "gpt-test"
        };
        if (organization is not null)
        {
            provider["organization"] = organization;
        }
        if (project is not null)
        {
            provider["project"] = project;
        }
        if (overrideHeaders is not null)
        {
            provider["requestOverrides"] = new Dictionary<string, object?>
            {
                ["headers"] = overrideHeaders
            };
        }
        return JsonSerializer.SerializeToElement(provider);
    }

    private static void AssertValue(HttpRequestMessage request, string name, string expected, string message)
    {
        if (!request.Headers.TryGetValues(name, out var values))
        {
            throw new InvalidOperationException($"Assertion failed: {message} (header absent)");
        }

        var actual = string.Join(" | ", values);
        if (actual != expected)
        {
            throw new InvalidOperationException($"Assertion failed: {message} (expected \"{expected}\", got \"{actual}\")");
        }
    }

    private static bool HasKey(IReadOnlyDictionary<string, string> headers, string name)
    {
        return headers.Keys.Any(key => string.Equals(key, name, StringComparison.OrdinalIgnoreCase));
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"Assertion failed: {message}");
        }
    }
}
