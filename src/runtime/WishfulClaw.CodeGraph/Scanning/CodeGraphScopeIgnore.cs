using System.Text;
using System.Text.Unicode;

// =============================================================================
// CodeGraphScopeIgnore — the workspace-scope ignore matcher and its supporting
// defaults (port of extraction/index.ts: DEFAULT_IGNORE_DIRS/PATTERNS,
// ANDROID_RES_TYPES, buildDefaultIgnore/defaultsOnlyIgnore, readGitignorePatterns,
// includeStaticRoots, ScopeIgnore, buildScopeIgnore).
//
// ScopeIgnore is the SINGLE source of truth for indexer + sync scope (analysis/05
// §2.5). It layers, in precedence:
//   1. user `exclude` (codegraph.json) — wins always, even on git-tracked paths and
//      inside embedded repos (#999),
//   2. user `include` — forces first-party source in despite `.gitignore`, but never
//      resurfaces a built-in default-ignored dir,
//   3. per-embedded-repo matchers — each embedded repo judged by ITS OWN
//      `.gitignore` + defaults, not the parent's (#514),
//   4. the root matcher (built-in defaults + root `.gitignore`).
// It also keeps ancestor directories of embedded repos / included subtrees walkable
// so a directory-pruning walker still descends to reach them.
// =============================================================================
internal static class CodeGraphIgnoreDefaults
{
    // Directory names that are dependency/build/cache/tooling output — curated from
    // github/gitignore, excluded by default (git or not, tracked or not, #407). The
    // only opt-out is an explicit `.gitignore` negation (`!vendor/`). First-party-
    // prone names (src/lib/app/bin/packages/deps) are deliberately absent.
    // (extraction/index.ts DEFAULT_IGNORE_DIRS)
    public static readonly IReadOnlyList<string> DefaultIgnoreDirs = new[]
    {
        // JS / TS — dependency directories
        "node_modules", "bower_components", "jspm_packages", "web_modules",
        ".yarn", ".pnpm-store",
        // JS / TS — framework & bundler build / cache / deploy output
        ".next", ".nuxt", ".svelte-kit", ".turbo", ".vite", ".parcel-cache", ".angular",
        ".docusaurus", "storybook-static", ".vinxi", ".nitro", "out-tsc",
        ".vercel", ".netlify", ".wrangler",
        // Build output (common across ecosystems)
        "dist", "build", "out", ".output",
        // Test / coverage
        "coverage", ".nyc_output",
        // Python
        "__pycache__", "__pypackages__", ".venv", "venv", ".pixi", ".pdm-build",
        ".mypy_cache", ".pytest_cache", ".ruff_cache", ".tox", ".nox", ".hypothesis",
        ".ipynb_checkpoints", ".eggs",
        // Rust / JVM (Maven, Gradle, Scala)
        "target", ".gradle",
        // .NET
        "obj",
        // Vendored deps (Go, PHP/Composer, Ruby/Bundler)
        "vendor",
        // Swift / iOS
        ".build", "Pods", "Carthage", "DerivedData", ".swiftpm",
        // Dart / Flutter
        ".dart_tool", ".pub-cache",
        // Native (Android NDK, C/C++ deps)
        ".cxx", ".externalNativeBuild", "vcpkg_installed",
        // Scala tooling
        ".bloop", ".metals",
        // Lua / Luau (LuaRocks)
        "lua_modules", ".luarocks",
        // Delphi / RAD Studio IDE backups (duplicate .pas source — would double-count)
        "__history", "__recovery",
        // Generic cache
        ".cache"
    };

    // Android resource directory types — a `res/` tree holds ONLY non-code resources
    // and on an Android app can dominate the file count with zero symbols (#1047).
    // (extraction/index.ts ANDROID_RES_TYPES)
    private static readonly string[] AndroidResTypes =
    {
        "anim", "animator", "color", "drawable", "font", "layout",
        "menu", "mipmap", "navigation", "transition", "values", "xml"
    };

    // Gitignore-style patterns for the matcher: the dirs above as `foo/` globs plus a
    // few globs (Python egg-info, CMake/Bazel build trees, Android res dirs).
    // (extraction/index.ts DEFAULT_IGNORE_PATTERNS)
    public static readonly IReadOnlyList<string> DefaultIgnorePatterns = BuildDefaultPatterns();

    private static List<string> BuildDefaultPatterns()
    {
        var patterns = new List<string>(DefaultIgnoreDirs.Count + AndroidResTypes.Length + 3);
        foreach (var dir in DefaultIgnoreDirs)
        {
            patterns.Add(dir + "/");
        }

        patterns.Add("*.egg-info/");    // Python packaging metadata
        patterns.Add("cmake-build-*/"); // CLion / CMake build trees
        patterns.Add("bazel-*/");       // Bazel output symlink trees
        foreach (var type in AndroidResTypes)
        {
            patterns.Add($"**/res/{type}*/");
        }

        return patterns;
    }

    // An `ignore` matcher seeded with the built-in defaults + the project's root
    // `.gitignore` (so a negation like `!vendor/` overrides a default). Shared by
    // both enumeration paths so behavior is identical with or without git.
    // (extraction/index.ts buildDefaultIgnore)
    public static CodeGraphGitIgnoreMatcher BuildDefaultIgnore(string rootDir)
    {
        var ig = new CodeGraphGitIgnoreMatcher().Add(DefaultIgnorePatterns);
        var rootGitignore = Path.Combine(rootDir, ".gitignore");
        if (File.Exists(rootGitignore))
        {
            ig.Add(ReadGitignorePatterns(rootGitignore));
        }

        return ig;
    }

    // Defaults-only matcher (no root `.gitignore` merged) — used inside embedded
    // child repos, whose own `git ls-files` already enforced their gitignore (#514).
    // (extraction/index.ts defaultsOnlyIgnore)
    public static CodeGraphGitIgnoreMatcher DefaultsOnlyIgnore() =>
        new CodeGraphGitIgnoreMatcher().Add(DefaultIgnorePatterns);

    // Read a `.gitignore` and return patterns safe to hand to the matcher, never
    // throwing. Two real-world failure modes (#682): a non-UTF-8 file (DLP-encrypted
    // in place) is skipped whole; a single uncompilable line is dropped by the
    // matcher's per-line guard (so here we only guard the encoding). Returns "" when
    // there is nothing usable. (extraction/index.ts readGitignorePatterns)
    public static string ReadGitignorePatterns(string giPath)
    {
        byte[] buf;
        try
        {
            buf = File.ReadAllBytes(giPath);
        }
        catch
        {
            return string.Empty; // unreadable (permissions / race) — treat as absent
        }

        // A NUL byte never appears in real gitignore text; a failed UTF-8 validation
        // catches the encrypted-in-place case. Either way it isn't patterns at all.
        if (Array.IndexOf(buf, (byte)0) >= 0 || !Utf8.IsValid(buf))
        {
            return string.Empty;
        }

        return Encoding.UTF8.GetString(buf);
    }

    // The static directory prefix of each `include` pattern — the literal leading
    // path up to the first glob segment, trailing-slashed. Used to walk only the
    // opted-in subtrees and to keep ScopeIgnore descending toward them. A pattern
    // that starts with a glob yields "" (walk the whole tree). Nested roots collapse.
    // (extraction/index.ts includeStaticRoots)
    public static List<string> IncludeStaticRoots(IReadOnlyList<string> patterns)
    {
        var roots = new HashSet<string>(StringComparer.Ordinal);
        foreach (var pattern in patterns)
        {
            var p = pattern.TrimStart('/');
            var trailingSlash = p.EndsWith('/');
            if (trailingSlash)
            {
                p = p[..^1];
            }

            var segs = p.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var lead = new List<string>();
            foreach (var s in segs)
            {
                if (HasGlobMeta(s))
                {
                    break;
                }

                lead.Add(s);
            }

            var hadWildcard = lead.Count < segs.Length;
            // A wholly-literal pattern with no trailing slash names a file — drop its
            // last segment so we walk the containing dir.
            if (!hadWildcard && !trailingSlash && lead.Count > 0)
            {
                lead.RemoveAt(lead.Count - 1);
            }

            if (lead.Count == 0)
            {
                // A top-level glob forces a whole-tree walk; nothing narrower matters.
                return new List<string> { string.Empty };
            }

            roots.Add(string.Join('/', lead) + "/");
        }

        // Collapse roots nested under a broader one (drop `a/b/` if `a/` is present).
        var all = roots.ToList();
        return all.Where(r => !all.Any(other => other != r && r.StartsWith(other, StringComparison.Ordinal))).ToList();
    }

    // Glob metacharacters that end the static (literal) prefix of an include pattern.
    private static bool HasGlobMeta(string s)
    {
        foreach (var c in s)
        {
            if (c is '*' or '?' or '[' or ']' or '{' or '}' or '!')
            {
                return true;
            }
        }

        return false;
    }
}

// The workspace-scope ignore object. Ordinary paths get the root matcher; paths
// inside an embedded repo get that repo's own matcher; user exclude/include layer on
// top. (extraction/index.ts ScopeIgnore)
internal sealed class CodeGraphScopeIgnore
{
    private readonly CodeGraphGitIgnoreMatcher rootMatcher;
    private readonly List<EmbeddedMatcher> embedded;
    private readonly CodeGraphGitIgnoreMatcher defaults = CodeGraphIgnoreDefaults.DefaultsOnlyIgnore();
    private readonly CodeGraphGitIgnoreMatcher? exclude;
    private readonly CodeGraphGitIgnoreMatcher? include;
    private readonly IReadOnlyList<string> includeRoots;

    public CodeGraphScopeIgnore(
        CodeGraphGitIgnoreMatcher rootMatcher,
        IEnumerable<EmbeddedMatcher> embedded,
        CodeGraphGitIgnoreMatcher? exclude = null,
        CodeGraphGitIgnoreMatcher? include = null,
        IReadOnlyList<string>? includeRoots = null)
    {
        this.rootMatcher = rootMatcher;
        // Longest root first so paths in nested embedded repos hit the innermost.
        this.embedded = embedded.OrderByDescending(e => e.Root.Length).ToList();
        this.exclude = exclude;
        this.include = include;
        this.includeRoots = includeRoots ?? Array.Empty<string>();
    }

    public bool Ignores(string rel)
    {
        // 1. User `exclude` (#999) — checked first, against the full root-relative
        //    path: it must drop git-tracked paths and apply everywhere.
        if (exclude is not null && exclude.Ignores(rel))
        {
            return true;
        }

        // 2. User `include` — force first-party source in despite `.gitignore`. Never
        //    resurfaces a built-in default-ignored dir (node_modules/dist/…).
        if (include is not null && !defaults.Ignores(rel))
        {
            if (rel.EndsWith('/'))
            {
                // A directory on/leading to an included subtree stays walkable.
                foreach (var r in includeRoots)
                {
                    if (r.StartsWith(rel, StringComparison.Ordinal) || rel.StartsWith(r, StringComparison.Ordinal))
                    {
                        return false;
                    }
                }
            }
            else if (include.Ignores(rel))
            {
                return false;
            }
        }

        // 3. Embedded repos — each judged by its own matcher, but the built-in
        //    defaults still apply to the FULL path uniformly (#407).
        foreach (var e in embedded)
        {
            if (rel.StartsWith(e.Root, StringComparison.Ordinal))
            {
                var inner = rel[e.Root.Length..];
                if (inner.Length == 0)
                {
                    return false;
                }

                return defaults.Ignores(rel) || e.Matcher.Ignores(inner);
            }
        }

        // Never prune a directory that leads to an embedded repo.
        if (rel.EndsWith('/'))
        {
            foreach (var e in embedded)
            {
                if (e.Root.StartsWith(rel, StringComparison.Ordinal))
                {
                    return false;
                }
            }
        }

        // 4. Root matcher (defaults + root `.gitignore`).
        return rootMatcher.Ignores(rel);
    }

    // Build the scope matcher for a scan whose embedded roots the caller already
    // discovered (the git enumerator collects them during ls-files). Include/exclude
    // come from the project config. (extraction/index.ts buildScopeIgnore)
    public static CodeGraphScopeIgnore Build(
        string rootDir,
        CodeGraphProjectConfig config,
        IEnumerable<string> embeddedRoots)
    {
        var include = LoadIncludeMatcher(config);
        var embedded = embeddedRoots
            .Select(root => new EmbeddedMatcher(
                root,
                CodeGraphIgnoreDefaults.BuildDefaultIgnore(Path.Combine(rootDir, root.Replace('/', Path.DirectorySeparatorChar)))))
            .ToList();

        return new CodeGraphScopeIgnore(
            CodeGraphIgnoreDefaults.BuildDefaultIgnore(rootDir),
            embedded,
            LoadExcludeMatcher(config),
            include,
            include is not null ? CodeGraphIgnoreDefaults.IncludeStaticRoots(config.Include) : Array.Empty<string>());
    }

    // Matcher for `codegraph.json` `includeIgnored` — the opt-in to index embedded
    // git repos under gitignored dirs (#622/#699). Null when nothing opted in.
    public static CodeGraphGitIgnoreMatcher? LoadIncludeIgnoredMatcher(CodeGraphProjectConfig config) =>
        config.IncludeIgnored.Count > 0 ? new CodeGraphGitIgnoreMatcher().Add(config.IncludeIgnored) : null;

    // Matcher for `codegraph.json` `exclude` — paths to keep out even when tracked.
    public static CodeGraphGitIgnoreMatcher? LoadExcludeMatcher(CodeGraphProjectConfig config) =>
        config.Exclude.Count > 0 ? new CodeGraphGitIgnoreMatcher().Add(config.Exclude) : null;

    // Matcher for `codegraph.json` `include` — first-party source forced in.
    public static CodeGraphGitIgnoreMatcher? LoadIncludeMatcher(CodeGraphProjectConfig config) =>
        config.Include.Count > 0 ? new CodeGraphGitIgnoreMatcher().Add(config.Include) : null;

    internal readonly record struct EmbeddedMatcher(string Root, CodeGraphGitIgnoreMatcher Matcher);
}
