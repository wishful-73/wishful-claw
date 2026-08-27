/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Modules.Skills;

/// <summary>
/// Skill catalog — core CRUD operations for ~/.agents/skills/ directory.
/// Ported from WishfulClaw SkillCatalog, adapted for wishful-claw.
/// </summary>
public static partial class SkillCatalog
{
    private const string SkillFileName = "SKILL.md";
    private static readonly object Sync = new();

    // ── Public API (sync handlers) ──

    public static WorkerResponse EnsureBuiltins(JsonElement parameters)
    {
        lock (Sync)
        {
            try
            {
                EnsureBuiltinsCore(parameters);
                return ToResponse(Mutation(true, null));
            }
            catch (Exception ex)
            {
                WorkerLog.Warn($"skills ensure builtins failed error={ex.GetType().Name}: {ex.Message}");
                return ToResponse(Mutation(false, ex.Message));
            }
        }
    }

    public static WorkerResponse EnsureBuiltin(JsonElement parameters)
    {
        var name = JsonHelpers.GetString(parameters, "name")?.Trim() ?? string.Empty;
        if (!BuiltinSkillNameRegex().IsMatch(name))
        {
            return ToResponse(Mutation(false, "Invalid built-in skill name"));
        }

        lock (Sync)
        {
            try
            {
                var bundledDir = ResolveBundledSkillsDirectory(parameters);
                if (bundledDir is null)
                {
                    return ToResponse(Mutation(false, "Bundled skills directory not found"));
                }

                var sourceDir = Path.Combine(bundledDir, name);
                var sourceManifest = Path.Combine(sourceDir, SkillFileName);
                if (!File.Exists(sourceManifest))
                {
                    return ToResponse(Mutation(false, $"Built-in skill \"{name}\" was not found"));
                }

                Directory.CreateDirectory(SkillsDirectory());
                var targetDir = ResolveInstalledSkillPath(name);
                var targetManifest = Path.Combine(targetDir, SkillFileName);
                if (!File.Exists(targetManifest))
                {
                    if (Directory.Exists(targetDir))
                    {
                        Directory.Delete(targetDir, recursive: true);
                    }
                    CopyDirectory(sourceDir, targetDir);
                }

                return ToResponse(new JsonObject
                {
                    ["success"] = true,
                    ["name"] = name
                });
            }
            catch (Exception ex)
            {
                WorkerLog.Warn($"skills ensure builtin failed name={name} error={ex.GetType().Name}: {ex.Message}");
                return ToResponse(Mutation(false, ex.Message));
            }
        }
    }

    public static WorkerResponse List(JsonElement parameters)
    {
        lock (Sync)
        {
            try
            {
                EnsureBuiltinsCore(parameters);
                var config = SkillConfigStore.Load();
                var result = new JsonArray();
                var root = SkillsDirectory();
                if (!Directory.Exists(root))
                {
                    return ToResponse(result);
                }

                foreach (var dir in Directory.EnumerateDirectories(root))
                {
                    var name = Path.GetFileName(dir);
                    var manifest = Path.Combine(dir, SkillFileName);
                    if (string.IsNullOrWhiteSpace(name) || !File.Exists(manifest))
                    {
                        continue;
                    }

                    try
                    {
                        var content = File.ReadAllText(manifest);
                        result.Add((JsonNode?)new JsonObject
                        {
                            ["name"] = name,
                            ["description"] = ExtractDescription(content, name),
                            ["enabled"] = !config.DisabledSkills.Contains(name)
                        });
                    }
                    catch
                    {
                        // Skip unreadable skills.
                    }
                }

                return ToResponse(result);
            }
            catch (Exception ex)
            {
                WorkerLog.Warn($"skills list failed error={ex.GetType().Name}: {ex.Message}");
                return ToResponse(new JsonArray());
            }
        }
    }

    public static WorkerResponse Load(JsonElement parameters)
    {
        var name = JsonHelpers.GetString(parameters, "name") ?? string.Empty;
        lock (Sync)
        {
            try
            {
                var skillDir = ResolveInstalledSkillPath(name);
                var manifest = Path.Combine(skillDir, SkillFileName);
                if (!File.Exists(manifest))
                {
                    return ToResponse(new JsonObject { ["error"] = $"Skill \"{name}\" not found at {manifest}" });
                }

                var raw = File.ReadAllText(manifest);
                return ToResponse(new JsonObject
                {
                    ["content"] = StripFrontmatter(raw).TrimStart(),
                    ["workingDirectory"] = skillDir
                });
            }
            catch (Exception ex)
            {
                return ToResponse(new JsonObject { ["error"] = ex.Message });
            }
        }
    }

    public static WorkerResponse Read(JsonElement parameters)
    {
        var name = JsonHelpers.GetString(parameters, "name") ?? string.Empty;
        lock (Sync)
        {
            try
            {
                var manifest = Path.Combine(ResolveInstalledSkillPath(name), SkillFileName);
                if (!File.Exists(manifest))
                {
                    return ToResponse(new JsonObject { ["error"] = $"Skill \"{name}\" not found" });
                }

                return ToResponse(new JsonObject { ["content"] = File.ReadAllText(manifest) });
            }
            catch (Exception ex)
            {
                return ToResponse(new JsonObject { ["error"] = ex.Message });
            }
        }
    }

    public static WorkerResponse ListFiles(JsonElement parameters)
    {
        var name = JsonHelpers.GetString(parameters, "name") ?? string.Empty;
        lock (Sync)
        {
            try
            {
                var skillDir = ResolveInstalledSkillPath(name);
                if (!Directory.Exists(skillDir))
                {
                    return ToResponse(new JsonObject { ["error"] = $"Skill \"{name}\" not found" });
                }

                return ToResponse(new JsonObject { ["files"] = ListFileInfos(skillDir) });
            }
            catch (Exception ex)
            {
                return ToResponse(new JsonObject { ["error"] = ex.Message });
            }
        }
    }

    public static WorkerResponse Delete(JsonElement parameters)
    {
        var name = JsonHelpers.GetString(parameters, "name") ?? string.Empty;
        lock (Sync)
        {
            try
            {
                var skillDir = ResolveInstalledSkillPath(name);
                if (!Directory.Exists(skillDir))
                {
                    return ToResponse(Mutation(false, $"Skill \"{name}\" not found"));
                }

                Directory.Delete(skillDir, recursive: true);
                WorkerLog.Debug($"skills delete name={name}");
                return ToResponse(Mutation(true, null));
            }
            catch (Exception ex)
            {
                return ToResponse(Mutation(false, ex.Message));
            }
        }
    }

    public static WorkerResponse ResolvePath(JsonElement parameters)
    {
        var name = JsonHelpers.GetString(parameters, "name") ?? string.Empty;
        try
        {
            var skillDir = ResolveInstalledSkillPath(name);
            if (!Directory.Exists(skillDir))
            {
                return ToResponse(Mutation(false, $"Skill \"{name}\" not found"));
            }

            return ToResponse(new JsonObject
            {
                ["success"] = true,
                ["path"] = skillDir
            });
        }
        catch (Exception ex)
        {
            return ToResponse(Mutation(false, ex.Message));
        }
    }

    public static WorkerResponse Save(JsonElement parameters)
    {
        var name = JsonHelpers.GetString(parameters, "name") ?? string.Empty;
        var content = JsonHelpers.GetString(parameters, "content") ?? string.Empty;
        lock (Sync)
        {
            try
            {
                var skillDir = ResolveInstalledSkillPath(name);
                if (!Directory.Exists(skillDir))
                {
                    return ToResponse(Mutation(false, $"Skill \"{name}\" not found"));
                }

                File.WriteAllText(Path.Combine(skillDir, SkillFileName), content);
                WorkerLog.Debug($"skills save name={name}");
                return ToResponse(Mutation(true, null));
            }
            catch (Exception ex)
            {
                return ToResponse(Mutation(false, ex.Message));
            }
        }
    }

    // ── Private helpers ──

    private static void EnsureBuiltinsCore(JsonElement parameters)
    {
        var bundledDir = ResolveBundledSkillsDirectory(parameters);
        if (bundledDir is null)
        {
            return;
        }

        Directory.CreateDirectory(SkillsDirectory());
        foreach (var sourceDir in Directory.EnumerateDirectories(bundledDir))
        {
            var name = Path.GetFileName(sourceDir);
            if (string.IsNullOrWhiteSpace(name) ||
                !File.Exists(Path.Combine(sourceDir, SkillFileName)))
            {
                continue;
            }

            var targetDir = ResolveInstalledSkillPath(name);
            if (Directory.Exists(targetDir))
            {
                continue;
            }
            CopyDirectory(sourceDir, targetDir);
        }
    }

    private static string? ResolveBundledSkillsDirectory(JsonElement parameters)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty("bundledDirCandidates", out var candidates) ||
            candidates.ValueKind != JsonValueKind.Array)
        {
            return null;
        }

        foreach (var candidate in candidates.EnumerateArray())
        {
            if (candidate.ValueKind != JsonValueKind.String) continue;
            var raw = candidate.GetString();
            if (string.IsNullOrWhiteSpace(raw)) continue;
            var path = Path.GetFullPath(raw);
            if (Directory.Exists(path)) return path;
        }

        return null;
    }

    private static JsonArray ListFileInfos(string root)
    {
        var files = new JsonArray();
        WalkFiles(root, (fullPath, relativePath) =>
        {
            var info = new FileInfo(fullPath);
            var extension = Path.GetExtension(fullPath).ToLowerInvariant();
            files.Add((JsonNode?)new JsonObject
            {
                ["name"] = relativePath,
                ["size"] = info.Length,
                ["type"] = string.IsNullOrWhiteSpace(extension) ? "unknown" : extension
            });
        });
        return files;
    }

    internal static void WalkFiles(string root, Action<string, string> onFile)
    {
        foreach (var file in Directory.EnumerateFiles(root))
        {
            onFile(file, NormalizeRelativePath(Path.GetRelativePath(root, file)));
        }
        foreach (var directory in Directory.EnumerateDirectories(root))
        {
            WalkFiles(directory, (fullPath, _) =>
            {
                onFile(fullPath, NormalizeRelativePath(Path.GetRelativePath(root, fullPath)));
            });
        }
    }

    internal static void CopyDirectory(string sourceDir, string targetDir)
    {
        Directory.CreateDirectory(targetDir);
        foreach (var file in Directory.EnumerateFiles(sourceDir))
        {
            File.Copy(file, Path.Combine(targetDir, Path.GetFileName(file)), overwrite: true);
        }
        foreach (var directory in Directory.EnumerateDirectories(sourceDir))
        {
            CopyDirectory(directory, Path.Combine(targetDir, Path.GetFileName(directory)));
        }
    }

    private static string ExtractDescription(string content, string fallback)
    {
        var match = FrontmatterRegex().Match(content);
        if (match.Success)
        {
            var descMatch = DescriptionRegex().Match(match.Groups[1].Value);
            if (descMatch.Success)
            {
                var desc = descMatch.Groups[1].Value.Trim().Trim('"', '\'');
                if (desc.Length > 0)
                {
                    return desc.Length > 200 ? desc[..200] + "..." : desc;
                }
            }
        }

        var inFrontmatter = false;
        foreach (var rawLine in content.Replace("\r\n", "\n").Replace('\r', '\n').Split('\n'))
        {
            var line = rawLine.Trim();
            if (line == "---")
            {
                inFrontmatter = !inFrontmatter;
                continue;
            }
            if (inFrontmatter || line.Length == 0 || line.StartsWith('#'))
            {
                continue;
            }
            return line.Length > 120 ? line[..120] + "..." : line;
        }

        return fallback;
    }

    private static string StripFrontmatter(string content)
    {
        return FrontmatterStripRegex().Replace(content, string.Empty);
    }

    internal static string ResolveInstalledSkillPath(string name)
    {
        if (!IsSafeSkillName(name))
        {
            throw new InvalidOperationException("Invalid skill name");
        }
        var root = Path.GetFullPath(SkillsDirectory());
        var target = Path.GetFullPath(Path.Combine(root, name));
        if (target != root && !target.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.Ordinal))
        {
            throw new InvalidOperationException("Path escapes skills directory");
        }
        return target;
    }

    private static bool IsSafeSkillName(string name)
    {
        return !string.IsNullOrWhiteSpace(name) &&
            !name.Contains(Path.DirectorySeparatorChar) &&
            !name.Contains(Path.AltDirectorySeparatorChar) &&
            name != "." &&
            name != "..";
    }

    private static string SkillsDirectory()
    {
        return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".agents",
            "skills");
    }

    private static string NormalizeRelativePath(string value)
    {
        return value.Replace(Path.DirectorySeparatorChar, '/').Replace(Path.AltDirectorySeparatorChar, '/');
    }

    internal static string ReadNodeString(JsonObject obj, string name)
    {
        return obj.TryGetPropertyValue(name, out var value) &&
            value is JsonValue jsonValue &&
            jsonValue.TryGetValue<string>(out var text)
                ? text
                : string.Empty;
    }

    internal static JsonObject Mutation(bool success, string? error)
    {
        var result = new JsonObject { ["success"] = success };
        if (!string.IsNullOrWhiteSpace(error))
        {
            result["error"] = error;
        }
        return result;
    }

    internal static WorkerResponse ToResponse(JsonNode node)
    {
        return WorkerResponse.RawJson(node.ToJsonString(WorkerJsonHelper.JsonOptions));
    }

    // ── Regex (generated) ──

    [GeneratedRegex(@"^---\s*\r?\n([\s\S]*?)\r?\n---", RegexOptions.CultureInvariant)]
    private static partial Regex FrontmatterRegex();

    [GeneratedRegex(@"^description:\s*(.+)$", RegexOptions.Multiline | RegexOptions.CultureInvariant)]
    private static partial Regex DescriptionRegex();

    [GeneratedRegex(@"^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n)?", RegexOptions.CultureInvariant)]
    private static partial Regex FrontmatterStripRegex();

    [GeneratedRegex(@"^[a-z0-9-]+$", RegexOptions.CultureInvariant)]
    private static partial Regex BuiltinSkillNameRegex();
}
