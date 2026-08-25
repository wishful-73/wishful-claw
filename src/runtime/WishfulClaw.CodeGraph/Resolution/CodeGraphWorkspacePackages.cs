using System.Text.Json;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphWorkspaces — JS/TS monorepo workspace-package resolution (≙
// workspace-packages.ts). A cross-package import like `@scope/ui/widgets` is LOCAL to
// a monorepo, but to a single-package resolver it looks exactly like a third-party npm
// specifier — so `IsExternalImport` would flag it external and the consumer↔definition
// edge would never be created (a false "0 callers" on a live component, #629). This
// maps each member package's declared `name` to its directory so the resolver can
// rewrite `@scope/ui/widgets` → `packages/ui/widgets`, then run extension/index
// resolution.
//
// Scope (mirrors path-aliases): reads `workspaces` (array OR `{ packages: [...] }`)
// from package.json + a minimal pnpm-workspace.yaml `packages:` list; expands one
// level of `*`/`**` globs. HarmonyOS ohpm members come from `oh-package.json5`
// `file:` deps (a bounded walk), with each member's `main` recorded in EntryByName.
// All manifest parsing is reflection-free via JsonDocument.
// =============================================================================
internal static class CodeGraphWorkspaces
{
    private static readonly Regex SlashRun = new("/{2,}", RegexOptions.CultureInvariant);
    private static readonly Regex PnpmPackagesHeader = new(@"^\s*packages\s*:", RegexOptions.CultureInvariant);
    private static readonly Regex PnpmListItem = new(@"^\s*-\s*(.+?)\s*$", RegexOptions.CultureInvariant);
    private static readonly Regex PnpmQuoteTrim = new(@"^['""]|['""]$", RegexOptions.CultureInvariant);
    private static readonly Regex IndentedLine = new(@"^\s", RegexOptions.CultureInvariant);

    // Load workspace member packages for `projectRoot`, or null when the project
    // declares no workspaces (the common single-package case).
    public static CodeGraphWorkspacePackages? Load(string projectRoot)
    {
        var byName = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var pattern in ReadWorkspaceGlobs(projectRoot))
        {
            foreach (var dir in ExpandWorkspaceGlob(projectRoot, pattern))
            {
                var pkgName = ReadPackageName(CodeGraphPosixPath.Join(projectRoot, dir));
                // First declaration wins — patterns are tried in order.
                if (pkgName is not null && !byName.ContainsKey(pkgName))
                {
                    byName[pkgName] = dir;
                }
            }
        }

        // HarmonyOS/OpenHarmony (ArkTS) modular projects: every module's
        // oh-package.json5 declares its local siblings as `"data": "file:../../core/data"`
        // dependencies, and code then imports the bare name (`import { X } from "data"`).
        // Same monorepo problem as npm workspaces, different manifest
        // (workspace-packages.ts:68).
        var entryByName = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var (name, dir) in CollectOhpmFileDeps(projectRoot))
        {
            if (byName.ContainsKey(name))
            {
                continue;
            }

            byName[name] = dir;
            var entry = ReadOhpmMain(projectRoot, dir);
            if (entry is not null)
            {
                entryByName[name] = entry;
            }
        }

        if (byName.Count == 0)
        {
            return null;
        }

        return new CodeGraphWorkspacePackages(byName, entryByName.Count > 0 ? entryByName : null);
    }

    // --- ohpm (oh-package.json5) support (workspace-packages.ts:87–:198) ---

    private const string OhpmManifest = "oh-package.json5";
    private const int OhpmWalkMaxDepth = 6;
    private const int OhpmWalkDirBudget = 8000;
    private static readonly HashSet<string> OhpmSkipDirs = new(StringComparer.Ordinal)
    {
        "node_modules", "oh_modules", ".git", ".codegraph", ".hvigor", ".preview",
        "build", "dist", "out", "oh-package-lock.json5"
    };

    // JSON5 in practice = JSON + comments + trailing commas for these manifests;
    // JsonDocumentOptions covers both. Unquoted-key manifests fail the parse and are
    // skipped (missing edge over wrong edge).
    private static readonly JsonDocumentOptions Json5Tolerant = new()
    {
        CommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    // Scan for oh-package.json5 manifests; collect `file:`-protocol dependencies as
    // workspace members (dep name → target dir, projectRoot-relative posix). A name
    // declared with DIFFERENT target dirs in different manifests (every sample in a
    // samples monorepo has its own "common") is AMBIGUOUS and dropped entirely. The
    // walk is bounded (depth + directory budget) and prunes build/dependency dirs, so
    // non-ArkTS projects pay one readdir at the root and nothing else.
    private static Dictionary<string, string> CollectOhpmFileDeps(string projectRoot)
    {
        var byName = new Dictionary<string, string>(StringComparer.Ordinal);
        var ambiguous = new HashSet<string>(StringComparer.Ordinal);

        var queue = new Queue<(string Rel, int Depth)>();
        queue.Enqueue((string.Empty, 0));
        var visited = 0;
        while (queue.Count > 0)
        {
            var (rel, depth) = queue.Dequeue();
            if (++visited > OhpmWalkDirBudget)
            {
                break;
            }

            var abs = rel.Length == 0 ? projectRoot : CodeGraphPosixPath.Join(projectRoot, rel);

            bool hasManifest;
            var manifestAbs = CodeGraphPosixPath.Join(abs, OhpmManifest);
            try
            {
                hasManifest = File.Exists(manifestAbs);
            }
            catch
            {
                continue;
            }

            if (hasManifest)
            {
                foreach (var (depName, target) in ReadOhpmFileDeps(manifestAbs))
                {
                    var targetAbs = CodeGraphPosixPath.Resolve(abs, target);
                    var targetRel = CodeGraphPosixPath.Relative(projectRoot, targetAbs).Replace('\\', '/');
                    if (targetRel.StartsWith("..", StringComparison.Ordinal))
                    {
                        continue; // escapes the project
                    }

                    if (!byName.TryGetValue(depName, out var existing))
                    {
                        if (!ambiguous.Contains(depName))
                        {
                            byName[depName] = targetRel;
                        }
                    }
                    else if (existing != targetRel)
                    {
                        byName.Remove(depName);
                        ambiguous.Add(depName);
                    }
                }
            }

            if (depth >= OhpmWalkMaxDepth)
            {
                continue;
            }

            try
            {
                foreach (var dirAbs in Directory.EnumerateDirectories(abs))
                {
                    var name = LeafName(dirAbs);
                    if (name.Length == 0 || name[0] == '.' || OhpmSkipDirs.Contains(name))
                    {
                        continue;
                    }

                    queue.Enqueue((rel.Length == 0 ? name : rel + "/" + name, depth + 1));
                }
            }
            catch
            {
                // unreadable directory
            }
        }

        return byName;
    }

    // Parse one oh-package.json5's dependencies → (name, file-target) pairs
    // (workspace-packages.ts:178).
    private static List<(string Name, string Target)> ReadOhpmFileDeps(string manifestAbs)
    {
        var result = new List<(string, string)>();
        try
        {
            var raw = File.ReadAllText(manifestAbs);
            using var doc = JsonDocument.Parse(raw, Json5Tolerant);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("dependencies", out var deps) &&
                deps.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in deps.EnumerateObject())
                {
                    if (prop.Value.ValueKind != JsonValueKind.String)
                    {
                        continue;
                    }

                    var value = prop.Value.GetString() ?? string.Empty;
                    if (!value.StartsWith("file:", StringComparison.Ordinal))
                    {
                        continue; // registry deps stay external
                    }

                    var target = value["file:".Length..].Trim();
                    if (target.Length > 0)
                    {
                        result.Add((prop.Name, target));
                    }
                }
            }
        }
        catch
        {
            // unreadable/unparsable manifest
        }

        return result;
    }

    // An ohpm member's declared entry file: `<dir>/oh-package.json5`'s `main`,
    // normalized projectRoot-relative posix; null when missing/escaping
    // (workspace-packages.ts:87).
    private static string? ReadOhpmMain(string projectRoot, string dirRel)
    {
        try
        {
            var dirAbs = CodeGraphPosixPath.Join(projectRoot, dirRel);
            var raw = File.ReadAllText(CodeGraphPosixPath.Join(dirAbs, OhpmManifest));
            using var doc = JsonDocument.Parse(raw, Json5Tolerant);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("main", out var main) &&
                main.ValueKind == JsonValueKind.String)
            {
                var value = (main.GetString() ?? string.Empty).Trim();
                if (value.Length == 0)
                {
                    return null;
                }

                var entryAbs = CodeGraphPosixPath.Resolve(dirAbs, value);
                var entryRel = CodeGraphPosixPath.Relative(projectRoot, entryAbs).Replace('\\', '/');
                return entryRel.StartsWith("..", StringComparison.Ordinal) ? null : entryRel;
            }
        }
        catch
        {
            // no / invalid manifest
        }

        return null;
    }

    // Rewrite a bare workspace import to a projectRoot-relative path WITHOUT an
    // extension (the caller applies the language's extension/index resolution).
    // `@scope/ui/widgets` → `packages/ui/widgets`; bare `@scope/ui` → its directory.
    // null when no member package name matches.
    public static string? ResolveImport(string importPath, CodeGraphWorkspacePackages ws)
    {
        // Longest matching package name wins (`@scope/ui/core` over `@scope/ui`).
        string? bestName = null;
        foreach (var name in ws.ByName.Keys)
        {
            if (importPath == name || importPath.StartsWith(name + "/", StringComparison.Ordinal))
            {
                if (bestName is null || name.Length > bestName.Length)
                {
                    bestName = name;
                }
            }
        }

        if (bestName is null)
        {
            return null;
        }

        var dir = ws.ByName[bestName];
        var subpath = importPath[bestName.Length..]; // "" or "/widgets"
        if (subpath.Length == 0 && ws.EntryByName is not null && ws.EntryByName.TryGetValue(bestName, out var entry))
        {
            return entry;
        }

        return SlashRun.Replace(dir + subpath, "/");
    }

    // package.json `workspaces` (npm/yarn/bun) + pnpm-workspace.yaml `packages:`.
    private static List<string> ReadWorkspaceGlobs(string projectRoot)
    {
        var result = new List<string>();

        try
        {
            var raw = File.ReadAllText(CodeGraphPosixPath.Join(projectRoot, "package.json"));
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("workspaces", out var ws))
            {
                if (ws.ValueKind == JsonValueKind.Array)
                {
                    AddStrings(result, ws);
                }
                else if (ws.ValueKind == JsonValueKind.Object &&
                         ws.TryGetProperty("packages", out var packages) &&
                         packages.ValueKind == JsonValueKind.Array)
                {
                    AddStrings(result, packages);
                }
            }
        }
        catch
        {
            // no / invalid package.json — not a workspace root
        }

        try
        {
            var yaml = File.ReadAllText(CodeGraphPosixPath.Join(projectRoot, "pnpm-workspace.yaml"));
            result.AddRange(ParsePnpmPackages(yaml));
        }
        catch
        {
            // no pnpm-workspace.yaml
        }

        return result;
    }

    private static void AddStrings(List<string> into, JsonElement array)
    {
        foreach (var el in array.EnumerateArray())
        {
            if (el.ValueKind == JsonValueKind.String)
            {
                var s = el.GetString();
                if (s is not null)
                {
                    into.Add(s);
                }
            }
        }
    }

    // Minimal pnpm-workspace.yaml `packages:` extractor — the only shape pnpm uses.
    private static List<string> ParsePnpmPackages(string yaml)
    {
        var result = new List<string>();
        var inPackages = false;
        foreach (var line in yaml.Split('\n'))
        {
            var current = line.EndsWith("\r", StringComparison.Ordinal) ? line[..^1] : line;
            if (PnpmPackagesHeader.IsMatch(current))
            {
                inPackages = true;
                continue;
            }

            if (inPackages)
            {
                var item = PnpmListItem.Match(current);
                if (item.Success)
                {
                    result.Add(PnpmQuoteTrim.Replace(item.Groups[1].Value, string.Empty));
                    continue;
                }

                // A non-list, non-blank line ends the `packages:` block.
                if (current.Trim().Length != 0 && !IndentedLine.IsMatch(current))
                {
                    inPackages = false;
                }
            }
        }

        return result;
    }

    // Expand one level of a `packages/*` / `apps/**` glob to member directories
    // (projectRoot-relative posix).
    private static List<string> ExpandWorkspaceGlob(string projectRoot, string pattern)
    {
        var norm = pattern.Replace('\\', '/').TrimEnd('/');
        var star = norm.IndexOf('*');
        if (star == -1)
        {
            return new List<string> { norm }; // exact directory
        }

        var basePath = norm[..star].TrimEnd('/');
        var result = new List<string>();
        try
        {
            var readDir = basePath.Length == 0 ? projectRoot : CodeGraphPosixPath.Join(projectRoot, basePath);
            foreach (var full in Directory.EnumerateDirectories(readDir))
            {
                var name = LeafName(full);
                if (name.Length == 0 || name[0] == '.' || name == "node_modules")
                {
                    continue;
                }

                result.Add(basePath.Length == 0 ? name : basePath + "/" + name);
            }
        }
        catch
        {
            // ignore unreadable directories
        }

        return result;
    }

    // Read the `name` field from a member directory's package.json.
    private static string? ReadPackageName(string dirAbs)
    {
        try
        {
            var raw = File.ReadAllText(CodeGraphPosixPath.Join(dirAbs, "package.json"));
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind == JsonValueKind.Object &&
                doc.RootElement.TryGetProperty("name", out var name) &&
                name.ValueKind == JsonValueKind.String)
            {
                var s = name.GetString();
                return string.IsNullOrEmpty(s) ? null : s;
            }
        }
        catch
        {
            // no / invalid package.json
        }

        return null;
    }

    private static string LeafName(string osPath)
    {
        var p = osPath.Replace('\\', '/').TrimEnd('/');
        var slash = p.LastIndexOf('/');
        return slash >= 0 ? p[(slash + 1)..] : p;
    }
}
