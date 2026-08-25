using System.Text.RegularExpressions;

// =============================================================================
// Resolution contract types + the ResolutionContext facade (resolution/types.ts).
//
// CodeGraphResolutionContext is the graph-access FACADE every resolver/matcher/
// import-resolver consumes (name-matcher + import-resolver take it as `ctx`). It is
// an ABSTRACT base, not an interface, so the "optional (perf)" members from the TS
// `ResolutionContext?` shape can carry working default bodies (a minimal test
// context overrides only the abstract required members). The production impl over
// CodeGraphStore + a stack of CodeGraphLruCache is CodeGraphStoreResolutionContext,
// at the bottom of this file.
//
// GLOBAL namespace, all-internal, reflection-free/AOT (Decision 16/17). Config
// parsing (aliases / go.mod / workspaces) is delegated to CodeGraphImportResolver
// (the Match slice) which uses JsonDocument, never JsonSerializer.Deserialize<T>.
// =============================================================================

// ---------------------------------------------------------------------------
// CodeGraphResolvedRef — the outcome of a single resolution attempt (≙ ResolvedRef
// in resolution/types.ts, minus `original`: the resolver already holds the ref it
// passed in and pairs the two when it builds the edge). The Match slice's matchers
// and (M3b) framework resolvers RETURN this.
//   * TargetId    — id of the resolved target node (edges.target).
//   * Confidence  — 0..1; the resolver keeps the highest-confidence candidate and
//                   short-circuits at >= 0.9.
//   * ResolvedBy  — a CodeGraphResolvedBy.* tag; drives edge metadata.resolvedBy and
//                   the byMethod stats. REQUIRED (this is the faithful ResolvedRef
//                   discriminator).
//   * EdgeKind    — optional explicit edge-kind override (a CodeGraphEdgeKind.*
//                   value). null = derive from the ref: function_ref -> references,
//                   then the extends->implements / calls->instantiates promotions.
//                   Reserved for framework resolvers; the base pipeline leaves null.
//   * Metadata    — optional pre-built raw-JSON metadata a framework may attach.
//                   Reserved (M3b); the base pipeline builds metadata itself and
//                   ignores this.
// ---------------------------------------------------------------------------
internal sealed record CodeGraphResolvedRef(
    string TargetId,
    double Confidence,
    string ResolvedBy,
    string? EdgeKind = null,
    string? Metadata = null);

// The `resolvedBy` vocabulary (resolution/types.ts:45). Stored only inside edge
// metadata + the byMethod stats — never a column, so plain string constants.
internal static class CodeGraphResolvedBy
{
    public const string ExactMatch = "exact-match";
    public const string Import = "import";
    public const string QualifiedName = "qualified-name";
    public const string Framework = "framework";
    public const string Fuzzy = "fuzzy";
    public const string InstanceMethod = "instance-method";
    public const string FilePath = "file-path";
    public const string FunctionRef = "function-ref";
}

// Aggregate counts of a resolution pass (≙ ResolutionResult.stats). The batched
// pass returns only counts — resolved/unresolved arrays are persisted per batch, not
// accumulated. ByMethod keys are CodeGraphResolvedBy.* plus the deferred-pass tags.
internal sealed record CodeGraphResolutionResult(
    int Total,
    int Resolved,
    int Unresolved,
    IReadOnlyDictionary<string, int> ByMethod);

// One import binding extracted from a file (≙ ImportMapping, resolution/types.ts:241).
// Produced by CodeGraphImportResolver.ExtractImportMappings, cached per file by the
// context. ResolvedPath is set only for local (in-project) imports.
internal sealed record CodeGraphImportMapping(
    string LocalName,
    string ExportedName,
    string Source,
    bool IsDefault,
    bool IsNamespace,
    string? ResolvedPath = null);

// A re-export declared by a barrel file (≙ the ReExport union, resolution/types.ts:
// 261). Modeled as one record with a Kind discriminator (no C# discriminated
// unions). `named`: ExportedName/OriginalName set (OriginalName differs on rename).
// `wildcard`: only Source set. Source is always the upstream module specifier.
internal sealed record CodeGraphReExport(
    string Kind,
    string Source,
    string? ExportedName = null,
    string? OriginalName = null);

internal static class CodeGraphReExportKind
{
    public const string Named = "named";
    public const string Wildcard = "wildcard";
}

// A single tsconfig/jsconfig `paths` alias pattern (≙ AliasPattern, path-aliases.ts:
// 31). HasWildcard true => `*` in each replacement is filled with the captured
// wildcard portion. Replacements are stored relative to AliasMap.BaseUrl.
internal sealed record CodeGraphAliasPattern(
    string Prefix,
    string Suffix,
    bool HasWildcard,
    IReadOnlyList<string> Replacements);

// Project import-path aliases (≙ AliasMap, path-aliases.ts:47). Patterns ordered by
// specificity (longer prefix first, literal before wildcard).
internal sealed record CodeGraphAliasMap(
    string BaseUrl,
    IReadOnlyList<CodeGraphAliasPattern> Patterns);

// Go module info from the root go.mod (≙ GoModule, go-module.ts:15). Lets the Go
// import branch tell in-module cross-package imports from third-party packages.
internal sealed record CodeGraphGoModule(
    string ModulePath,
    string RootDir);

// Monorepo workspace member packages (≙ WorkspacePackages, workspace-packages.ts:31).
// ByName: package name -> directory relative to projectRoot (posix). EntryByName:
// package name -> declared ENTRY FILE relative to projectRoot (ohpm `main`); absent
// for npm/pnpm members.
internal sealed record CodeGraphWorkspacePackages(
    IReadOnlyDictionary<string, string> ByName,
    IReadOnlyDictionary<string, string>? EntryByName);

// Node kinds / edge kinds the resolver + context share for supertype walks
// (SUPERTYPE_BEARING_KINDS, index.ts:32). Kept here so both slices reference one set.
internal static class CodeGraphResolutionKinds
{
    // Kinds that can declare supertypes (extends/implements).
    internal static readonly HashSet<string> SupertypeBearing = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Class,
        CodeGraphNodeKind.Struct,
        CodeGraphNodeKind.Interface,
        CodeGraphNodeKind.Trait,
        CodeGraphNodeKind.Protocol,
        CodeGraphNodeKind.Enum
    };

    // The two edge kinds a supertype walk follows.
    internal static readonly string[] SupertypeEdges =
    {
        CodeGraphEdgeKind.Implements,
        CodeGraphEdgeKind.Extends
    };
}

// ---------------------------------------------------------------------------
// CodeGraphResolutionContext — the abstract facade. REQUIRED members are abstract;
// the OPTIONAL (perf/advanced) members are virtual with working default bodies
// (a minimal test context need only implement the abstracts). The production impl
// overrides the virtuals with cached / store-backed versions.
// ---------------------------------------------------------------------------
internal abstract class CodeGraphResolutionContext
{
    // --- Required members (types.ts:69-134) ---

    /// <summary>All nodes declared in a file (ordered by start line).</summary>
    public abstract IReadOnlyList<CodeGraphNode> GetNodesInFile(string filePath);

    /// <summary>All nodes with an exact name.</summary>
    public abstract IReadOnlyList<CodeGraphNode> GetNodesByName(string name);

    /// <summary>All nodes with an exact qualified name.</summary>
    public abstract IReadOnlyList<CodeGraphNode> GetNodesByQualifiedName(string qualifiedName);

    /// <summary>All nodes of a kind (CodeGraphNodeKind.*). Full materialized list.</summary>
    public abstract IReadOnlyList<CodeGraphNode> GetNodesByKind(string kind);

    /// <summary>Nodes by SQL lower(name) — O(1) case-insensitive/fuzzy lookup.</summary>
    public abstract IReadOnlyList<CodeGraphNode> GetNodesByLowerName(string lowerName);

    /// <summary>Whether a project-relative file exists (indexed OR on disk).</summary>
    public abstract bool FileExists(string filePath);

    /// <summary>File content, or null when the read fails (also cached).</summary>
    public abstract string? ReadFile(string filePath);

    /// <summary>The absolute project root.</summary>
    public abstract string GetProjectRoot();

    /// <summary>Every tracked file path (posix, project-relative).</summary>
    public abstract IReadOnlyList<string> GetAllFiles();

    /// <summary>Cached import mappings for a file (via CodeGraphImportResolver).</summary>
    public abstract IReadOnlyList<CodeGraphImportMapping> GetImportMappings(string filePath, string language);

    // --- Optional (perf / advanced) members — virtual defaults (types.ts:77-181) ---

    /// <summary>Stream nodes of a kind without materializing the per-kind array
    /// (synthesizer memory, #1212). Default falls back to GetNodesByKind.</summary>
    public virtual IEnumerable<CodeGraphNode> IterateNodesByKind(string kind) => GetNodesByKind(kind);

    /// <summary>ReadFile split into lines (LRU-cached per file), or null. The default
    /// splits ReadFile on /\r?\n/.</summary>
    public virtual IReadOnlyList<string>? GetFileLines(string filePath)
    {
        var content = ReadFile(filePath);
        return content is null ? null : SplitLines(content);
    }

    /// <summary>Method-definition nodes matching typeName::methodName in `language`
    /// (resolveMethodOnType's kind/language/qualified-name-suffix filter). Default is
    /// uncached, over GetNodesByName; the production impl caches it (#1122).</summary>
    public virtual IReadOnlyList<CodeGraphNode> GetMethodMatches(string typeName, string methodName, string language)
    {
        var want = typeName + "::" + methodName;
        var suffix = "::" + want;
        var matches = new List<CodeGraphNode>();
        foreach (var m in GetNodesByName(methodName))
        {
            if (m.Kind != CodeGraphNodeKind.Method || m.Language != language)
            {
                continue;
            }

            if (m.QualifiedName == want || m.QualifiedName.EndsWith(suffix, StringComparison.Ordinal))
            {
                matches.Add(m);
            }
        }

        return matches;
    }

    /// <summary>Direct supertypes (extends/implements targets, by simple name) of the
    /// same-language type named `typeName`. EMPTY during the first pass (edges not yet
    /// built), populated for the conformance pass. Default empty (test contexts).</summary>
    public virtual IReadOnlyList<string> GetSupertypes(string typeName, string language) => Array.Empty<string>();

    /// <summary>A node by id (matchers deriving the from-symbol's scope). Default null.</summary>
    public virtual CodeGraphNode? GetNodeById(string id) => null;

    /// <summary>Outgoing edges from a node id, optionally kind-filtered — the graph
    /// access the dynamic-edge synthesizers consume (≙ QueryBuilder.getOutgoingEdges).
    /// Default empty (a minimal test context has no edge store).</summary>
    public virtual IReadOnlyList<CodeGraphEdge> GetOutgoingEdges(string nodeId, IReadOnlyList<string>? kinds = null) =>
        Array.Empty<CodeGraphEdge>();

    /// <summary>Incoming edges into a node id, optionally kind-filtered (≙
    /// QueryBuilder.getIncomingEdges). Default empty.</summary>
    public virtual IReadOnlyList<CodeGraphEdge> GetIncomingEdges(string nodeId, IReadOnlyList<string>? kinds = null) =>
        Array.Empty<CodeGraphEdge>();

    /// <summary>tsconfig/jsconfig `paths` alias map, or null. Default null.</summary>
    public virtual CodeGraphAliasMap? GetProjectAliases() => null;

    /// <summary>Root go.mod module info, or null. Default null.</summary>
    public virtual CodeGraphGoModule? GetGoModule() => null;

    /// <summary>Monorepo workspace member packages, or null. Default null.</summary>
    public virtual CodeGraphWorkspacePackages? GetWorkspacePackages() => null;

    /// <summary>Re-exports declared by a barrel file. Default empty.</summary>
    public virtual IReadOnlyList<CodeGraphReExport> GetReExports(string filePath, string language) =>
        Array.Empty<CodeGraphReExport>();

    /// <summary>Immediate subdirectories of a project-relative path. Default empty.</summary>
    public virtual IReadOnlyList<string> ListDirectories(string relativePath) => Array.Empty<string>();

    /// <summary>C/C++ -I include search dirs (compile_commands.json). Default empty.</summary>
    public virtual IReadOnlyList<string> GetCppIncludeDirs() => Array.Empty<string>();

    /// <summary>Drop every per-resolver LRU cache between passes so the next pass sees
    /// fresh DB state (index.ts clearCaches). Lifetime-immutable config (aliases /
    /// go.mod / workspaces) is NOT reset. Default no-op (test contexts).</summary>
    public virtual void ClearCaches()
    {
    }

    // Split on /\r?\n/ exactly: split on '\n', then strip a single trailing '\r' (the
    // one consumed by the delimiter). A lone mid-line '\r' is preserved.
    protected static string[] SplitLines(string content)
    {
        var parts = content.Split('\n');
        for (var i = 0; i < parts.Length; i++)
        {
            if (parts[i].Length > 0 && parts[i][^1] == '\r')
            {
                parts[i] = parts[i][..^1];
            }
        }

        return parts;
    }
}

// ---------------------------------------------------------------------------
// CodeGraphStoreResolutionContext — the production facade over CodeGraphStore + fs +
// a stack of CodeGraphLruCache (index.ts:397 createContext + the cache fields at
// :226-243). Import/module/config loading is delegated to CodeGraphImportResolver so
// all JsonDocument parsing lives in one place (the Match slice).
// ---------------------------------------------------------------------------
internal sealed class CodeGraphStoreResolutionContext : CodeGraphResolutionContext
{
    private const int DefaultCacheLimit = 5000;

    // Barrel `.d.ts`/`.[cm]tsx?`/`.[cm]jsx?`/`.ets` test — re-key a re-export chase on
    // the barrel's own JS-family extension (index.ts:593, getReExports).
    private static readonly Regex JsFamilyFile = new(
        @"\.(?:d\.ts|[cm]?tsx?|[cm]?jsx?|ets)$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private readonly CodeGraphStore store;
    private readonly string projectRoot;
    private readonly CodeGraphImportResolver importResolver;

    // Per-file / per-name LRU caches (bounded — memory stays flat on 20k+-file repos).
    private readonly CodeGraphLruCache<string, IReadOnlyList<CodeGraphNode>> nodeCache;
    private readonly CodeGraphLruCache<string, string?> fileCache;
    private readonly CodeGraphLruCache<string, IReadOnlyList<CodeGraphImportMapping>> importMappingCache;
    private readonly CodeGraphLruCache<string, IReadOnlyList<CodeGraphReExport>> reExportCache;
    private readonly CodeGraphLruCache<string, IReadOnlyList<CodeGraphNode>> nameCache;
    private readonly CodeGraphLruCache<string, IReadOnlyList<CodeGraphNode>> lowerNameCache;
    private readonly CodeGraphLruCache<string, IReadOnlyList<CodeGraphNode>> qualifiedNameCache;
    private readonly CodeGraphLruCache<string, IReadOnlyList<string>?> fileLinesCache;
    private readonly CodeGraphLruCache<string, IReadOnlyList<CodeGraphNode>> methodMatchCache;

    // Node kinds are a small fixed set, so this stays a plain Dictionary, not an LRU
    // (index.ts:243 nodesByKindCache). Returned lists are treated as read-only.
    private readonly Dictionary<string, IReadOnlyList<CodeGraphNode>> nodesByKindCache =
        new(StringComparer.Ordinal);

    // Known file paths for the O(1) FileExists short-circuit — built lazily, cleared
    // by ClearCaches (index.ts knownFiles). null = not built.
    private HashSet<string>? knownFiles;

    // Lifetime-immutable config (index.ts undefined/null/computed convention). Loaded
    // once via the import resolver; NOT reset by ClearCaches.
    private bool aliasesLoaded;
    private CodeGraphAliasMap? aliases;
    private bool goModuleLoaded;
    private CodeGraphGoModule? goModule;
    private bool workspacePackagesLoaded;
    private CodeGraphWorkspacePackages? workspacePackages;

    internal CodeGraphStoreResolutionContext(
        CodeGraphStore store,
        string projectRoot,
        CodeGraphImportResolver importResolver)
    {
        this.store = store ?? throw new ArgumentNullException(nameof(store));
        this.projectRoot = projectRoot ?? throw new ArgumentNullException(nameof(projectRoot));
        this.importResolver = importResolver ?? throw new ArgumentNullException(nameof(importResolver));

        var limit = ResolveCacheLimit();
        // Content caches (full file text / split-line arrays) are heavier — a fifth of
        // the metadata budget, floored at 64 (index.ts:263).
        var contentLimit = Math.Max(64, limit / 5);
        nodeCache = new CodeGraphLruCache<string, IReadOnlyList<CodeGraphNode>>(limit);
        fileCache = new CodeGraphLruCache<string, string?>(contentLimit);
        importMappingCache = new CodeGraphLruCache<string, IReadOnlyList<CodeGraphImportMapping>>(limit);
        reExportCache = new CodeGraphLruCache<string, IReadOnlyList<CodeGraphReExport>>(limit);
        nameCache = new CodeGraphLruCache<string, IReadOnlyList<CodeGraphNode>>(limit);
        lowerNameCache = new CodeGraphLruCache<string, IReadOnlyList<CodeGraphNode>>(limit);
        qualifiedNameCache = new CodeGraphLruCache<string, IReadOnlyList<CodeGraphNode>>(limit);
        fileLinesCache = new CodeGraphLruCache<string, IReadOnlyList<string>?>(contentLimit);
        methodMatchCache = new CodeGraphLruCache<string, IReadOnlyList<CodeGraphNode>>(limit);
    }

    // A single integer applied to all caches, overridable for tuning (index.ts:59).
    private static int ResolveCacheLimit()
    {
        var raw = Environment.GetEnvironmentVariable("CODEGRAPH_RESOLVER_CACHE_SIZE");
        if (string.IsNullOrEmpty(raw))
        {
            return DefaultCacheLimit;
        }

        return int.TryParse(raw, out var parsed) && parsed > 0 ? parsed : DefaultCacheLimit;
    }

    public override IReadOnlyList<CodeGraphNode> GetNodesInFile(string filePath)
    {
        if (nodeCache.TryGet(filePath, out var cached))
        {
            return cached;
        }

        var result = store.GetNodesByFile(filePath);
        nodeCache.Set(filePath, result);
        return result;
    }

    public override IReadOnlyList<CodeGraphNode> GetNodesByName(string name)
    {
        if (nameCache.TryGet(name, out var cached))
        {
            return cached;
        }

        var result = store.GetNodesByName(name);
        nameCache.Set(name, result);
        return result;
    }

    public override IReadOnlyList<CodeGraphNode> GetNodesByQualifiedName(string qualifiedName)
    {
        if (qualifiedNameCache.TryGet(qualifiedName, out var cached))
        {
            return cached;
        }

        var result = store.GetNodesByQualifiedNameExact(qualifiedName);
        qualifiedNameCache.Set(qualifiedName, result);
        return result;
    }

    public override IReadOnlyList<CodeGraphNode> GetNodesByKind(string kind)
    {
        if (nodesByKindCache.TryGetValue(kind, out var cached))
        {
            return cached;
        }

        var result = store.GetNodesByKind(kind);
        nodesByKindCache[kind] = result;
        return result;
    }

    // Streamed + uncached — synthesizers scan whole kinds; both the array and the
    // per-kind cache retention are O(nodes) memory (index.ts:455).
    public override IEnumerable<CodeGraphNode> IterateNodesByKind(string kind) =>
        store.IterateNodesByKind(kind);

    public override IReadOnlyList<CodeGraphNode> GetNodesByLowerName(string lowerName)
    {
        if (lowerNameCache.TryGet(lowerName, out var cached))
        {
            return cached;
        }

        var result = store.GetNodesByLowerName(lowerName);
        lowerNameCache.Set(lowerName, result);
        return result;
    }

    public override bool FileExists(string filePath)
    {
        var known = KnownFiles();
        var normalized = filePath.Replace('\\', '/');
        if (known.Contains(filePath) || known.Contains(normalized))
        {
            return true;
        }

        // Fall back to the filesystem for files not yet indexed.
        try
        {
            return File.Exists(Path.Combine(projectRoot, filePath));
        }
        catch
        {
            return false;
        }
    }

    public override string? ReadFile(string filePath)
    {
        if (fileCache.TryGet(filePath, out var cached))
        {
            return cached;
        }

        try
        {
            var content = File.ReadAllText(Path.Combine(projectRoot, filePath));
            fileCache.Set(filePath, content);
            return content;
        }
        catch
        {
            // A failed read is cached as null so it isn't retried per ref.
            fileCache.Set(filePath, null);
            return null;
        }
    }

    public override IReadOnlyList<string>? GetFileLines(string filePath)
    {
        if (fileLinesCache.TryGet(filePath, out var cached))
        {
            return cached;
        }

        var source = ReadFile(filePath);
        IReadOnlyList<string>? lines = source is null ? null : SplitLines(source);
        fileLinesCache.Set(filePath, lines);
        return lines;
    }

    public override IReadOnlyList<CodeGraphNode> GetMethodMatches(string typeName, string methodName, string language)
    {
        var key = language + " " + typeName + "::" + methodName;
        if (methodMatchCache.TryGet(key, out var cachedMatches))
        {
            return cachedMatches;
        }

        // Reuse the name cache for the method-name candidate set.
        if (!nameCache.TryGet(methodName, out var candidates))
        {
            candidates = store.GetNodesByName(methodName);
            nameCache.Set(methodName, candidates);
        }

        var want = typeName + "::" + methodName;
        var suffix = "::" + want;
        var matches = new List<CodeGraphNode>();
        foreach (var m in candidates)
        {
            if (m.Kind != CodeGraphNodeKind.Method || m.Language != language)
            {
                continue;
            }

            if (m.QualifiedName == want || m.QualifiedName.EndsWith(suffix, StringComparison.Ordinal))
            {
                matches.Add(m);
            }
        }

        methodMatchCache.Set(key, matches);
        return matches;
    }

    public override string GetProjectRoot() => projectRoot;

    // Pre-parse framework detection (≙ ensureDetectedFrameworks(files)): on a FIRST
    // index the files table is still empty, so extraction-time detection supplies the
    // scanned file list here and GetAllFiles serves it instead of the store.
    internal IReadOnlyList<string>? AllFilesOverride { get; init; }

    public override IReadOnlyList<string> GetAllFiles()
    {
        if (AllFilesOverride is not null)
        {
            return AllFilesOverride;
        }

        var files = store.GetFiles();
        var paths = new List<string>(files.Count);
        foreach (var f in files)
        {
            paths.Add(f.Path);
        }

        return paths;
    }

    // The store already serves this from its own LRU node cache.
    public override CodeGraphNode? GetNodeById(string id) => store.GetNodeById(id);

    // Edge reads go straight to the store (edges are not context-cached), so a
    // synthesizer pass sees the edges a prior GoPrePass pass just persisted.
    public override IReadOnlyList<CodeGraphEdge> GetOutgoingEdges(string nodeId, IReadOnlyList<string>? kinds = null) =>
        store.GetOutgoingEdges(nodeId, kinds);

    public override IReadOnlyList<CodeGraphEdge> GetIncomingEdges(string nodeId, IReadOnlyList<string>? kinds = null) =>
        store.GetIncomingEdges(nodeId, kinds);

    // Union the implements/extends targets of every same-named, same-language type
    // node — reconciles a type split across a declaration + an extension node
    // (index.ts:522 getSupertypes). Populated only after edges are persisted.
    public override IReadOnlyList<string> GetSupertypes(string typeName, string language)
    {
        List<CodeGraphNode>? typeNodes = null;
        foreach (var n in GetNodesByName(typeName))
        {
            if (CodeGraphResolutionKinds.SupertypeBearing.Contains(n.Kind) && n.Language == language)
            {
                (typeNodes ??= new List<CodeGraphNode>()).Add(n);
            }
        }

        if (typeNodes is null)
        {
            return Array.Empty<string>();
        }

        var supertypes = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var tn in typeNodes)
        {
            foreach (var edge in store.GetOutgoingEdges(tn.Id, CodeGraphResolutionKinds.SupertypeEdges))
            {
                var target = store.GetNodeById(edge.Target);
                if (target is not null && !string.IsNullOrEmpty(target.Name) && target.Name != typeName && seen.Add(target.Name))
                {
                    supertypes.Add(target.Name);
                }
            }
        }

        return supertypes;
    }

    public override IReadOnlyList<CodeGraphImportMapping> GetImportMappings(string filePath, string language)
    {
        if (importMappingCache.TryGet(filePath, out var cached))
        {
            return cached;
        }

        var content = ReadFile(filePath);
        if (content is null)
        {
            importMappingCache.Set(filePath, Array.Empty<CodeGraphImportMapping>());
            return Array.Empty<CodeGraphImportMapping>();
        }

        var mappings = importResolver.ExtractImportMappings(filePath, content, language);
        importMappingCache.Set(filePath, mappings);
        return mappings;
    }

    public override CodeGraphAliasMap? GetProjectAliases()
    {
        if (!aliasesLoaded)
        {
            aliases = importResolver.LoadProjectAliases(projectRoot);
            aliasesLoaded = true;
        }

        return aliases;
    }

    public override CodeGraphGoModule? GetGoModule()
    {
        if (!goModuleLoaded)
        {
            goModule = importResolver.LoadGoModule(projectRoot);
            goModuleLoaded = true;
        }

        return goModule;
    }

    public override CodeGraphWorkspacePackages? GetWorkspacePackages()
    {
        if (!workspacePackagesLoaded)
        {
            workspacePackages = importResolver.LoadWorkspacePackages(projectRoot);
            workspacePackagesLoaded = true;
        }

        return workspacePackages;
    }

    public override IReadOnlyList<CodeGraphReExport> GetReExports(string filePath, string language)
    {
        if (reExportCache.TryGet(filePath, out var cached))
        {
            return cached;
        }

        var content = ReadFile(filePath);
        if (content is null)
        {
            reExportCache.Set(filePath, Array.Empty<CodeGraphReExport>());
            return Array.Empty<CodeGraphReExport>();
        }

        // Re-key the parse on the BARREL's own extension (a JS-family barrel is parsed
        // as typescript no matter the consumer's language, #629).
        var lang = JsFamilyFile.IsMatch(filePath) ? CodeGraphLanguage.TypeScript : language;
        var reExports = importResolver.ExtractReExports(content, lang);
        reExportCache.Set(filePath, reExports);
        return reExports;
    }

    public override IReadOnlyList<string> ListDirectories(string relativePath)
    {
        var target = relativePath.Length == 0 || relativePath == "."
            ? projectRoot
            : Path.Combine(projectRoot, relativePath);
        try
        {
            var dirs = new List<string>();
            foreach (var d in Directory.EnumerateDirectories(target))
            {
                dirs.Add(Path.GetFileName(d));
            }

            return dirs;
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    public override IReadOnlyList<string> GetCppIncludeDirs() => importResolver.LoadCppIncludeDirs(projectRoot);

    public override void ClearCaches()
    {
        nodeCache.Clear();
        fileCache.Clear();
        importMappingCache.Clear();
        reExportCache.Clear();
        nameCache.Clear();
        lowerNameCache.Clear();
        qualifiedNameCache.Clear();
        fileLinesCache.Clear();
        methodMatchCache.Clear();
        nodesByKindCache.Clear();
        knownFiles = null;
        // aliases / goModule / workspacePackages are lifetime-immutable — NOT reset.
    }

    private HashSet<string> KnownFiles()
    {
        if (knownFiles is null)
        {
            var set = new HashSet<string>(StringComparer.Ordinal);
            foreach (var f in store.GetFiles())
            {
                set.Add(f.Path);
            }

            knownFiles = set;
        }

        return knownFiles;
    }
}
