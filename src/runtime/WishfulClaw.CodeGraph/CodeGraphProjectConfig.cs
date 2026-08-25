using System.Text.Json;

// =============================================================================
// CodeGraphProjectConfig — the project-scoped `codegraph.json` at the project root,
// a committed file a team shares through version control (analysis/05 §3.3; port of
// project-config.ts).
//
// Schema (every field optional):
//   extensions      — { ".ext": "language" } custom extension → supported language,
//                     merged ON TOP of the built-in EXTENSION_MAP (wins on conflict).
//   includeIgnored  — gitignore-style patterns: gitignored dirs whose EMBEDDED git
//                     repos should be indexed anyway (#622/#699).
//   exclude         — gitignore-style patterns to keep OUT even when git-TRACKED,
//                     which .gitignore cannot express (#999).
//   include         — gitignore-style patterns to force first-party source IN despite
//                     .gitignore (SVN/Perforce-only source).
//
// Defensive by construction: EVERY failure mode (missing file, bad JSON, wrong type,
// typo'd language) degrades to the zero-config default and never throws — an
// unparseable project file must not break indexing. mtime-cached per root, so the
// per-index/scan/sync/watch calls collapse to one stat while one file is in force.
//
// Reflection-free: parsed with System.Text.Json's JsonDocument (no source-gen DTO
// needed — the shape is dynamic and read positionally), matching the AOT contract.
// =============================================================================
internal sealed class CodeGraphProjectConfig
{
    public const string FileName = "codegraph.json";

    // The shared zero-config default (allocates nothing beyond these empties).
    public static readonly CodeGraphProjectConfig Empty = new(
        new Dictionary<string, string>(0),
        Array.Empty<string>(),
        Array.Empty<string>(),
        Array.Empty<string>());

    private static readonly HashSet<string> SupportedLanguages = BuildSupportedLanguages();

    // Cache keyed by project root; guarded so the daemon's concurrent RPCs don't race
    // the stat/parse. Keying by root isolates two projects in one process.
    private static readonly Dictionary<string, CacheEntry> Cache = new(StringComparer.Ordinal);
    private static readonly object CacheGate = new();

    public CodeGraphProjectConfig(
        IReadOnlyDictionary<string, string> extensions,
        IReadOnlyList<string> includeIgnored,
        IReadOnlyList<string> exclude,
        IReadOnlyList<string> include)
    {
        Extensions = extensions;
        IncludeIgnored = includeIgnored;
        Exclude = exclude;
        Include = include;
    }

    // `.ext` (lowercase) → supported language id, merged on top of the built-ins.
    public IReadOnlyDictionary<string, string> Extensions { get; }

    // Gitignore-style patterns: gitignored dirs whose embedded git repos to index.
    public IReadOnlyList<string> IncludeIgnored { get; }

    // Gitignore-style patterns to keep out even when git-tracked.
    public IReadOnlyList<string> Exclude { get; }

    // Gitignore-style patterns to force first-party source in despite .gitignore.
    public IReadOnlyList<string> Include { get; }

    // Load the validated config for a project, mtime-cached. Missing/malformed → the
    // zero-config default. One stat (and at most one read/parse) while a single
    // `codegraph.json` is in force. (project-config.ts loadParsedConfig)
    public static CodeGraphProjectConfig Load(string projectRoot)
    {
        var file = Path.Combine(projectRoot, FileName);

        long mtimeMs;
        try
        {
            mtimeMs = new DateTimeOffset(File.GetLastWriteTimeUtc(file)).ToUnixTimeMilliseconds();
        }
        catch
        {
            // No config file (or unstattable) — drop any stale cache entry, default.
            lock (CacheGate)
            {
                Cache.Remove(projectRoot);
            }

            return Empty;
        }

        // GetLastWriteTimeUtc returns a sentinel (1601-01-01) for a missing file rather
        // than throwing; treat that as "no config".
        if (!File.Exists(file))
        {
            lock (CacheGate)
            {
                Cache.Remove(projectRoot);
            }

            return Empty;
        }

        lock (CacheGate)
        {
            if (Cache.TryGetValue(projectRoot, out var entry) && entry.MtimeMs == mtimeMs)
            {
                return entry.Config;
            }
        }

        var config = ParseFile(file);
        lock (CacheGate)
        {
            Cache[projectRoot] = new CacheEntry(mtimeMs, config);
        }

        return config;
    }

    // Test/maintenance hook: forget cached config (e.g. after rewriting it in a test).
    public static void ClearCache()
    {
        lock (CacheGate)
        {
            Cache.Clear();
        }
    }

    // Read + parse one codegraph.json. Every failure degrades to the default.
    private static CodeGraphProjectConfig ParseFile(string file)
    {
        string raw;
        try
        {
            raw = File.ReadAllText(file);
        }
        catch
        {
            return Empty;
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(raw);
        }
        catch (JsonException)
        {
            // Not valid JSON — warn-and-default (the CLI's logWarn; here we just skip).
            return Empty;
        }

        using (document)
        {
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return Empty;
            }

            var extensions = ExtractExtensions(root);
            var includeIgnored = ExtractStringArray(root, "includeIgnored");
            var exclude = ExtractStringArray(root, "exclude");
            var include = ExtractStringArray(root, "include");

            if (extensions.Count == 0 && includeIgnored.Count == 0 && exclude.Count == 0 && include.Count == 0)
            {
                return Empty;
            }

            return new CodeGraphProjectConfig(extensions, includeIgnored, exclude, include);
        }
    }

    // Validate the `extensions` map: normalize keys to `.ext`, keep only values naming
    // a supported language. A bad key/value warns-and-skips (here: silently skipped).
    // (project-config.ts extractExtensions)
    private static Dictionary<string, string> ExtractExtensions(JsonElement root)
    {
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        if (!root.TryGetProperty("extensions", out var exts) || exts.ValueKind != JsonValueKind.Object)
        {
            return result;
        }

        foreach (var property in exts.EnumerateObject())
        {
            var key = NormalizeExtKey(property.Name);
            if (key is null || property.Value.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            var value = property.Value.GetString();
            if (value is null || !SupportedLanguages.Contains(value))
            {
                continue;
            }

            result[key] = value;
        }

        return result;
    }

    // Validate a gitignore-style pattern array: non-empty trimmed strings only. A
    // non-array or bad entry warns-and-skips. (project-config.ts extract{IncludeIgnored,Exclude,Include})
    private static List<string> ExtractStringArray(JsonElement root, string field)
    {
        var result = new List<string>();
        if (!root.TryGetProperty(field, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return result;
        }

        foreach (var entry in arr.EnumerateArray())
        {
            if (entry.ValueKind != JsonValueKind.String)
            {
                continue;
            }

            var value = entry.GetString();
            if (string.IsNullOrWhiteSpace(value))
            {
                continue;
            }

            result.Add(value.Trim());
        }

        return result;
    }

    // Normalize a user extension key to the `.ext` lowercase form the built-in map
    // uses. Returns null for keys that can never match a real file extension: empty /
    // just ".", multi-part (".d.ts" — detection keys off the FINAL extension only),
    // or anything with a path separator. (project-config.ts normalizeExtKey)
    private static string? NormalizeExtKey(string raw)
    {
        var ext = raw.Trim().ToLowerInvariant();
        if (ext.Length == 0)
        {
            return null;
        }

        if (!ext.StartsWith('.'))
        {
            ext = "." + ext;
        }

        var body = ext[1..];
        if (body.Length == 0)
        {
            return null;
        }

        if (body.Contains('.') || body.Contains('/') || body.Contains('\\'))
        {
            return null;
        }

        return ext;
    }

    // The set an extension value must belong to: every real language id (the `unknown`
    // sentinel is excluded — mapping an extension to `unknown` is never useful).
    private static HashSet<string> BuildSupportedLanguages()
    {
        var set = new HashSet<string>(CodeGraphLanguage.All, StringComparer.Ordinal);
        set.Remove(CodeGraphLanguage.Unknown);
        return set;
    }

    private readonly record struct CacheEntry(long MtimeMs, CodeGraphProjectConfig Config);
}
