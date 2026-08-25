using System.Text.Json;

// =============================================================================
// CodeGraphPathAliases — project import-path alias loading (≙ path-aliases.ts). Reads
// `compilerOptions.paths` from tsconfig.json / jsconfig.json at the project root and
// converts the patterns into the CodeGraphAliasMap the import resolver consults. This
// is the single biggest lever for JS/TS resolution accuracy: `@/components/Foo` style
// aliases (Next/Nuxt/Nest/Vite scaffolds) point into a `paths` map that would
// otherwise leave every aliased import unresolvable.
//
// Config parsing is REFLECTION-FREE (Decision on AOT config parsing): JsonDocument
// with ReadCommentHandling=Skip + AllowTrailingCommas handles the JSONC that tsconfigs
// carry in the wild (`//` `/* */` comments, trailing commas) — NEVER
// JsonSerializer.Deserialize<T>. The loader is called once per project by the context
// (lifetime-immutable cache).
//
// Scope (mirrors the TS): reads tsconfig then jsconfig; honours top-level baseUrl +
// paths; supports the `*` wildcard; does NOT follow `extends` chains or Vite/webpack
// configs.
// =============================================================================
internal static class CodeGraphPathAliases
{
    private static readonly JsonDocumentOptions JsoncOptions = new()
    {
        CommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true
    };

    // Load aliases for `projectRoot`, or null when no tsconfig/jsconfig is present or
    // the file has no usable `paths`.
    public static CodeGraphAliasMap? Load(string projectRoot)
    {
        string[] candidates = { "tsconfig.json", "jsconfig.json" };
        foreach (var name in candidates)
        {
            var p = CodeGraphPosixPath.Join(projectRoot, name);
            if (!SafeExists(p))
            {
                continue;
            }

            var parsed = ParseAliases(projectRoot, p);
            if (parsed is not null)
            {
                return parsed;
            }
        }

        return null;
    }

    // Resolve an import path through an AliasMap → the candidate project-relative posix
    // paths, in tsconfig priority order (multiple replacements per alias). Empty when no
    // alias matches. Callers still try each candidate with the language's extension list.
    public static IReadOnlyList<string> ApplyAliases(string importPath, CodeGraphAliasMap aliases, string projectRoot)
    {
        foreach (var pat in aliases.Patterns)
        {
            if (!importPath.StartsWith(pat.Prefix, StringComparison.Ordinal))
            {
                continue;
            }

            if (pat.Suffix.Length > 0 && !importPath.EndsWith(pat.Suffix, StringComparison.Ordinal))
            {
                continue;
            }

            var captured = string.Empty;
            if (pat.HasWildcard)
            {
                captured = importPath.Substring(pat.Prefix.Length, importPath.Length - pat.Suffix.Length - pat.Prefix.Length);
            }
            else if (importPath != pat.Prefix)
            {
                // Literal pattern must match exactly.
                continue;
            }

            var result = new List<string>();
            foreach (var target in pat.Replacements)
            {
                var filled = pat.HasWildcard ? ReplaceFirst(target, "*", captured) : target;
                var absolute = CodeGraphPosixPath.Resolve(aliases.BaseUrl, filled);
                var relative = CodeGraphPosixPath.Relative(projectRoot, absolute);
                // Skip if the rewrite escapes the project root.
                if (relative.StartsWith("..", StringComparison.Ordinal))
                {
                    continue;
                }

                result.Add(relative.Replace('\\', '/'));
            }

            return result;
        }

        return Array.Empty<string>();
    }

    private static CodeGraphAliasMap? ParseAliases(string projectRoot, string filePath)
    {
        JsonDocument doc;
        try
        {
            var raw = File.ReadAllText(filePath);
            doc = JsonDocument.Parse(raw, JsoncOptions);
        }
        catch
        {
            return null;
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            var baseUrlRel = ".";
            var hasCompilerOptions = root.TryGetProperty("compilerOptions", out var compilerOptions) &&
                                     compilerOptions.ValueKind == JsonValueKind.Object;
            if (hasCompilerOptions &&
                compilerOptions.TryGetProperty("baseUrl", out var baseUrlEl) &&
                baseUrlEl.ValueKind == JsonValueKind.String)
            {
                baseUrlRel = baseUrlEl.GetString() ?? ".";
            }

            var baseUrl = CodeGraphPosixPath.Resolve(projectRoot, baseUrlRel);

            // baseUrl alone isn't an alias; with no `paths` we'd just redirect the whole
            // tree — the existing resolver already handles relative imports.
            if (!hasCompilerOptions ||
                !compilerOptions.TryGetProperty("paths", out var paths) ||
                paths.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            var patterns = new List<CodeGraphAliasPattern>();
            foreach (var entry in paths.EnumerateObject())
            {
                if (entry.Value.ValueKind != JsonValueKind.Array)
                {
                    continue;
                }

                var replacements = new List<string>();
                foreach (var target in entry.Value.EnumerateArray())
                {
                    if (target.ValueKind == JsonValueKind.String)
                    {
                        var s = target.GetString();
                        if (s is not null)
                        {
                            replacements.Add(s);
                        }
                    }
                }

                if (replacements.Count == 0)
                {
                    continue;
                }

                var (prefix, suffix, hasWildcard) = SplitWildcard(entry.Name);
                patterns.Add(new CodeGraphAliasPattern(prefix, suffix, hasWildcard, replacements));
            }

            if (patterns.Count == 0)
            {
                return null;
            }

            // Specificity sort (STABLE — matches V8's stable Array.sort): longer prefix
            // first; literal patterns before wildcard patterns of the same prefix length.
            var sorted = new List<CodeGraphAliasPattern>(patterns.Count);
            foreach (var p in patterns
                         .Select((pat, idx) => (pat, idx))
                         .OrderByDescending(x => x.pat.Prefix.Length)
                         .ThenBy(x => x.pat.HasWildcard ? 1 : 0)
                         .ThenBy(x => x.idx))
            {
                sorted.Add(p.pat);
            }

            return new CodeGraphAliasMap(baseUrl, sorted);
        }
    }

    private static (string Prefix, string Suffix, bool HasWildcard) SplitWildcard(string pattern)
    {
        var star = pattern.IndexOf('*');
        if (star == -1)
        {
            return (pattern, string.Empty, false);
        }

        return (pattern[..star], pattern[(star + 1)..], true);
    }

    // JS String.prototype.replace(string, string) replaces only the FIRST occurrence —
    // C# string.Replace replaces all, so this reproduces the single-replacement semantics
    // tsconfig `*` fill relies on.
    private static string ReplaceFirst(string value, string search, string replacement)
    {
        var idx = value.IndexOf(search, StringComparison.Ordinal);
        if (idx < 0)
        {
            return value;
        }

        return value[..idx] + replacement + value[(idx + search.Length)..];
    }

    private static bool SafeExists(string path)
    {
        try
        {
            return File.Exists(path);
        }
        catch
        {
            return false;
        }
    }
}
