using System.Text.Json;
using WishfulClaw.Infrastructure.Storage;
using WishfulClaw.TestSupport;

namespace WishfulClaw.ProviderHeaderRegressionTests;

internal static class ProviderCompletionResolutionChecks
{
    public static void Run()
    {
        var previous = Environment.GetEnvironmentVariable("WISHFULCLAW_DATA_DIR");
        var root = Path.Combine(TestOutputRoot.Resolve(), "wishful-provider-resolution-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        Environment.SetEnvironmentVariable("WISHFULCLAW_DATA_DIR", root);
        try
        {
            SaveProvider("explicit", "explicit-model");
            SaveProvider("configured", "configured-model");
            SaveProvider("fallback", "fallback-model");
            SaveProvider("global", "global-model");
            ProviderCompletionSettingsStore.Write(new ProviderCompletionSettings(
                FallbackProviderId: "fallback",
                FallbackModelId: "fallback-model",
                PromptOptimizerProviderId: "configured",
                PromptOptimizerModelId: "configured-model"));

            var explicitResolution = Resolve("promptOptimizer", new
            {
                provider = new { providerId = "explicit", type = "openai-chat", baseUrl = "https://explicit.test/v1", model = "explicit-model" },
                model = "explicit-model"
            });
            Assert(explicitResolution.Config?.ProviderId == "explicit" && explicitResolution.Config.Model == "explicit-model", "explicit route wins over configured route");

            var configured = Resolve("promptOptimizer", new
            {
                provider = new { providerId = "global", type = "openai-chat", baseUrl = "https://global.test/v1", model = "global-model" },
                providerRole = "global",
                globalActiveModel = new { providerId = "global", modelId = "global-model" }
            });
            Assert(configured.Config?.ProviderId == "configured", "request-specific configured route wins over global candidate");

            var fallback = Resolve("persona", new
            {
                providerRole = "global",
                globalActiveModel = new { providerId = "global", modelId = "global-model" }
            });
            Assert(fallback.Config?.ProviderId == "fallback" && fallback.Config.Model == "fallback-model", "fallback route is used when request-specific route is absent");

            // 裁定② 的事故链：用户在模型管理里删掉模型、但不切 provider，持久化的
            // 路由 id 就此悬空。读取时必须校验存在性并降级，不能静默用不存在的模型。
            ProviderCompletionSettingsStore.Write(new ProviderCompletionSettings(
                FallbackProviderId: "fallback",
                FallbackModelId: "fallback-model",
                PromptOptimizerProviderId: "configured",
                PromptOptimizerModelId: "deleted-model"));
            var danglingModel = Resolve("promptOptimizer", new
            {
                providerRole = "global",
                globalActiveModel = new { providerId = "global", modelId = "global-model" }
            });
            Assert(danglingModel.Config?.ProviderId == "fallback",
                $"a configured route whose model was deleted degrades to the fallback instead of using it (got {danglingModel.Config?.ProviderId})");

            ProviderCompletionSettingsStore.Write(new ProviderCompletionSettings(
                FallbackProviderId: "fallback",
                FallbackModelId: "fallback-model",
                PersonaProviderId: "retired-provider",
                PersonaModelId: "persona-model"));
            var danglingProvider = Resolve("persona", new
            {
                providerRole = "global",
                globalActiveModel = new { providerId = "global", modelId = "global-model" }
            });
            Assert(danglingProvider.Config?.ProviderId == "fallback",
                $"a configured route whose provider was deleted degrades to the fallback (got {danglingProvider.Config?.ProviderId})");

            ProviderCompletionSettingsStore.Write(new ProviderCompletionSettings());
            var invalidGlobal = Resolve("other", new
            {
                providerRole = "global",
                globalActiveModel = new { providerId = "global", modelId = "deleted-model" }
            });
            Assert(invalidGlobal.Config is null && invalidGlobal.Error?.Contains("no longer exists", StringComparison.Ordinal) == true, "invalid global active model fails visibly");
        }
        finally
        {
            Environment.SetEnvironmentVariable("WISHFULCLAW_DATA_DIR", previous);
            try { Directory.Delete(root, recursive: true); } catch { }
        }
    }

    private static (ResolvedProviderConfig? Config, string? Error) Resolve(string kind, object value)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(value));
        return ProviderCompletionResolver.Resolve(document.RootElement, kind);
    }

    private static void SaveProvider(string id, string model)
    {
        using var document = JsonDocument.Parse(JsonSerializer.Serialize(new
        {
            id,
            type = "openai-chat",
            baseUrl = "https://example.test/v1",
            apiKey = "test-key",
            models = new[] { new { id = model, enabled = true } }
        }));
        ProviderStore.Save(document.RootElement);
    }

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException($"Assertion failed: {message}");
    }
}
