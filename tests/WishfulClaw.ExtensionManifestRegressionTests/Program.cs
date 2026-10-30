using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using WishfulClaw.Agent.Modules.Extensions;
using WishfulClaw.Contracts;

namespace WishfulClaw.ExtensionManifestRegressionTests;

/// <summary>
/// S-240 回归：插件清单的 <c>views</c> / <c>assets</c> 归一化，以及「零工具、只声明 views」的插件
/// 必须能出现在 <c>extension/list</c> 里。
///
/// 走的是渲染端真实看到的那条路 —— <see cref="ExtensionManifestStore.List"/> →
/// <c>ListExtensionsCore</c> → <c>ReadNormalizedManifestNode</c>。另一条 <c>ExtensionManifestReader</c>
/// 的 C# 模型路径 List 不走，测了也证明不了渲染端能看见。
///
/// 数据目录用 <c>WISHFULCLAW_DATA_DIR</c> 指到临时目录，既隔离本机数据，也让这个测试能在别人机器上跑。
/// </summary>
internal static class Program
{
    private static int _passed;

    public static int Main()
    {
        var root = Path.Combine(Path.GetTempPath(), "wishfulclaw-ext-manifest-" + Guid.NewGuid().ToString("N")[..8]);
        var previousDataDir = Environment.GetEnvironmentVariable(WishfulClawPaths.DataDirEnvVar);
        Environment.SetEnvironmentVariable(WishfulClawPaths.DataDirEnvVar, root);

        try
        {
            SeedViewOnly(root);
            SeedLegacyToolOnly(root);
            SeedEscapingEntry(root);
            SeedEmptyManifest(root);

            var instances = ListInstances();

            CheckViewOnlyListed(instances);
            CheckLegacyToolOnlyUnchanged(instances);
            CheckRejectedManifestsStayHidden(instances);

            Console.WriteLine($"Extension manifest regression checks passed: {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Extension manifest regression test failed: {ex}");
            return 1;
        }
        finally
        {
            Environment.SetEnvironmentVariable(WishfulClawPaths.DataDirEnvVar, previousDataDir);
            TryDelete(root);
        }
    }

    // ── 断言 ──

    private static void CheckViewOnlyListed(JsonArray instances)
    {
        var instance = FindById(instances, "demo-view");
        Check(instance is not null, "view-only extension should be listed by extension/list");
        if (instance is null)
        {
            return;
        }

        var manifest = instance["manifest"]!.AsObject();

        Check(
            manifest["tools"] is JsonArray tools && tools.Count == 0,
            "view-only manifest should normalize missing tools to an empty array");

        var views = manifest["views"]?.AsArray();
        Check(views is { Count: 1 }, "view-only manifest should expose exactly one view");
        if (views is not { Count: 1 })
        {
            return;
        }

        var view = views[0]!.AsObject();
        Check((string?)view["entry"] == "ui/index.html", "view entry should keep its relative path");
        Check((string?)view["title"] == "演示主面板", "view title should survive normalization");
        Check((string?)view["mode"] == "window", "views should normalize to window mode in this iteration");
        Check(view["nav"]?["order"]?.GetValue<int>() == 10, "view nav.order should survive normalization");

        var assets = manifest["assets"]?.AsArray();
        Check(
            assets is { Count: 1 } &&
            (string?)assets[0]!["id"] == "asr/model" &&
            assets[0]!["optional"]?.GetValue<bool>() == true,
            "assets should normalize id + optional");
    }

    private static void CheckLegacyToolOnlyUnchanged(JsonArray instances)
    {
        var instance = FindById(instances, "legacy-tool");
        Check(instance is not null, "tool-only extension should keep working");
        if (instance is null)
        {
            return;
        }

        var manifest = instance["manifest"]!.AsObject();
        Check(
            manifest["tools"] is JsonArray tools && tools.Count == 1,
            "tool-only manifest should keep its tool");
        Check(
            manifest["views"] is null,
            "tool-only manifest must not grow an empty views array — that would be a wire-format change");
    }

    private static void CheckRejectedManifestsStayHidden(JsonArray instances)
    {
        Check(
            FindById(instances, "escape-view") is null,
            "view entry escaping the extension directory must be rejected");
        Check(
            FindById(instances, "empty-manifest") is null,
            "manifest with neither tools nor views must be rejected");
    }

    // ── 造数 ──

    private static void SeedViewOnly(string root)
    {
        var dir = NewExtensionDir(root, "demo-view");
        Directory.CreateDirectory(Path.Combine(dir, "ui"));
        File.WriteAllText(Path.Combine(dir, "ui", "index.html"), "<!doctype html><title>demo</title>");

        WriteManifest(dir, """
            {
              "schemaVersion": 1,
              "id": "demo-view",
              "name": "Demo View",
              "version": "1.0.0",
              "description": "纯 UI 插件：只声明 views，一个工具也没有。",
              "views": [
                {
                  "id": "main",
                  "title": "演示主面板",
                  "entry": "ui/index.html",
                  "nav": { "order": 10 }
                }
              ],
              "assets": [
                { "id": "asr/model", "optional": true }
              ]
            }
            """);
    }

    private static void SeedLegacyToolOnly(string root)
    {
        var dir = NewExtensionDir(root, "legacy-tool");
        File.WriteAllText(Path.Combine(dir, "index.js"), "export function handler() { return {}; }");

        WriteManifest(dir, """
            {
              "schemaVersion": 1,
              "id": "legacy-tool",
              "name": "Legacy Tool",
              "version": "0.1.0",
              "entry": "index.js",
              "tools": [
                { "name": "legacy_echo", "description": "echo", "kind": "js", "handler": "handler" }
              ]
            }
            """);
    }

    private static void SeedEscapingEntry(string root)
    {
        var dir = NewExtensionDir(root, "escape-view");

        WriteManifest(dir, """
            {
              "schemaVersion": 1,
              "id": "escape-view",
              "name": "Escape View",
              "version": "1.0.0",
              "views": [
                { "id": "main", "title": "越界", "entry": "../../evil.html" }
              ]
            }
            """);
    }

    private static void SeedEmptyManifest(string root)
    {
        var dir = NewExtensionDir(root, "empty-manifest");

        WriteManifest(dir, """
            {
              "schemaVersion": 1,
              "id": "empty-manifest",
              "name": "Empty",
              "version": "1.0.0",
              "description": "既没有 tools 也没有 views，必须被拒。"
            }
            """);
    }

    private static string NewExtensionDir(string root, string id)
    {
        var dir = Path.Combine(root, "extensions", id);
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static void WriteManifest(string extensionDir, string json) =>
        File.WriteAllText(Path.Combine(extensionDir, "extension.json"), json);

    // ── 调用 ──

    private static JsonArray ListInstances()
    {
        using var parameters = JsonDocument.Parse("{}");
        var response = ExtensionManifestStore.List(parameters.RootElement);
        var json = Encoding.UTF8.GetString(response.ToJsonBytes(null));

        using var document = JsonDocument.Parse(json);
        if (!document.RootElement.TryGetProperty("result", out var result) ||
            result.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidOperationException($"extension/list returned no result array: {json}");
        }

        return JsonNode.Parse(result.GetRawText())!.AsArray();
    }

    // ── 工具 ──

    private static JsonObject? FindById(JsonArray instances, string id) =>
        instances.OfType<JsonObject>().FirstOrDefault(node => (string?)node["id"] == id);

    private static void Check(bool condition, string message)
    {
        if (!condition)
        {
            throw new InvalidOperationException($"assertion failed: {message}");
        }

        _passed++;
    }

    private static void TryDelete(string directory)
    {
        try
        {
            if (Directory.Exists(directory))
            {
                Directory.Delete(directory, recursive: true);
            }
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }
}
