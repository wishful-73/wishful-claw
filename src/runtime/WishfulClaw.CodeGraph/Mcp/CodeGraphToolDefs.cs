using System.Globalization;
using System.Text.Json.Serialization;

// =============================================================================
// CodeGraphToolDefs — the 8 tool definitions for codegraph/tools-list (analysis/04
// §3.1/§3.2, reference/02 §2.5). Immutable source-gen records (NOT `dynamic`): every
// inputSchema is a fixed object graph, and every read-only annotation must survive to
// the wire (Cursor Ask mode refuses any MCP tool lacking readOnlyHint:true, #1018).
//
// Default surface = codegraph_explore ALONE (DEFAULT_MCP_TOOLS = {explore},
// tools.ts:804): the other 7 stay fully executable via their codegraph/* methods but
// are NOT listed to the agent. Three surface transforms on top (ListFor, ≙
// ToolHandler.getTools, tools.ts:945):
//
//   * CODEGRAPH_MCP_TOOLS allowlist — comma-separated short or codegraph_-prefixed
//     names. When set it REPLACES the default surface entirely (any defined tool can
//     be re-enabled) and is enforced AGAIN at execute time (defense in depth against
//     a client that cached a wider list — see CodeGraphToolHandler.RunTool).
//   * Tiny-repo gating (tools.ts:997) — under 500 indexed files only the core trio
//     (explore/search/node) is LISTED; everything stays executable.
//   * Require-projectPath (#993, tools.ts:766) — with no default project to fall
//     back to, every exposed schema is CLONED with projectPath in `required` (a
//     high-salience channel MCP clients validate); the shared static defs are
//     records and are never mutated.
// =============================================================================
internal static class CodeGraphToolDefs
{
    // DEFAULT_MCP_TOOLS (tools.ts:804) — the short names surfaced by tools-list.
    private static readonly string[] DefaultSurface = { "codegraph_explore" };

    // Tiny-repo tool gating (tools.ts:997): under this many indexed files only the
    // core trio below is listed — at that scale callers/callees reduce to one grep,
    // and the n=2 ablation audits pinned this floor (a search-only surface was a
    // catastrophic regression; the trio is the empirical lower bound).
    internal const int TinyRepoFileThreshold = 500;

    private static readonly string[] TinyRepoCoreTools =
    {
        "codegraph_explore",
        "codegraph_search",
        "codegraph_node"
    };

    // READ_ONLY_ANNOTATIONS (tools.ts:520-525). One shared instance — every tool is
    // read-only, non-destructive, idempotent, closed-world.
    private static readonly CodeGraphToolAnnotations ReadOnly =
        new(ReadOnlyHint: true, DestructiveHint: false, IdempotentHint: true, OpenWorldHint: false);

    private static readonly CodeGraphToolProperty ProjectPath =
        new("string", "Absolute path to the project root whose graph to query. Defaults to the active project.");

    // The master array (all 8). Order matches analysis/04 §3.1.
    private static readonly CodeGraphToolDefinition[] AllTools =
    {
        new(
            "codegraph_explore",
            "PRIMARY code-intelligence tool. Give a natural-language question OR a bag of "
                + "symbol/file names and get verbatim source grouped by file, the call path among "
                + "those symbols, and the blast-radius of changing them — in one capped call. Prefer "
                + "this over Read/Grep for understanding how code fits together.",
            new CodeGraphToolInputSchema(
                "object",
                new Dictionary<string, CodeGraphToolProperty>
                {
                    ["query"] = new("string", "Natural-language question, or a space-separated bag of symbol/file names."),
                    ["maxFiles"] = new("number", "Max files to include (default 12; a size-tiered budget may cap it)."),
                    ["projectPath"] = ProjectPath
                },
                new[] { "query" }),
            ReadOnly),
        new(
            "codegraph_search",
            "Quick symbol search by name. Returns locations only (name, kind, file:line), no code. "
                + "Supports field-qualified queries (kind:/lang:/path:/name:). Generated files are down-ranked.",
            new CodeGraphToolInputSchema(
                "object",
                new Dictionary<string, CodeGraphToolProperty>
                {
                    ["query"] = new("string", "Symbol name or field-qualified query."),
                    ["kind"] = new(
                        "string",
                        "Restrict to one node kind.",
                        new[]
                        {
                            "function", "method", "constructor", "class", "interface",
                            "type", "variable", "route", "component"
                        }),
                    ["limit"] = new("number", "Max results (default 10)."),
                    ["projectPath"] = ProjectPath
                },
                new[] { "query" }),
            ReadOnly),
        new(
            "codegraph_node",
            "Read a symbol or a file. With `file` alone: numbered source (Read-like) plus its "
                + "dependents. With `symbol`: signature, body, and the caller/callee trail; an "
                + "ambiguous name returns every matching definition.",
            new CodeGraphToolInputSchema(
                "object",
                new Dictionary<string, CodeGraphToolProperty>
                {
                    ["symbol"] = new("string", "Symbol name to read (symbol mode)."),
                    ["file"] = new("string", "File path to read (file mode), or disambiguate a symbol."),
                    ["kind"] = new(
                        "string",
                        "Optional node kind filter for same-named symbols (for example `constructor`).",
                        new[]
                        {
                            "function", "method", "constructor", "class", "struct", "interface",
                            "property", "field", "variable", "constant", "enum", "module", "namespace",
                            "component", "route"
                        }),
                    ["includeCode"] = new("boolean", "Include the symbol body in symbol mode (default false)."),
                    ["symbolsOnly"] = new("boolean", "Structural outline only (default false)."),
                    ["line"] = new("number", "Disambiguate a symbol by its start line."),
                    ["offset"] = new("number", "File-mode window start line (Read semantics)."),
                    ["limit"] = new("number", "File-mode window size (default 2000-line cap)."),
                    ["projectPath"] = ProjectPath
                },
                null),
            ReadOnly),
        new(
            "codegraph_callers",
            "List the functions that call <symbol>.",
            SymbolSchema("Symbol whose callers to list.", "limit", "Max callers (default 20)."),
            ReadOnly),
        new(
            "codegraph_callees",
            "List the functions that <symbol> calls.",
            SymbolSchema("Symbol whose callees to list.", "limit", "Max callees (default 20)."),
            ReadOnly),
        new(
            "codegraph_impact",
            "Show the symbols affected by changing <symbol> (the blast radius; run before a refactor).",
            SymbolSchema("Symbol whose impact radius to compute.", "depth", "Traversal depth (default 2)."),
            ReadOnly),
        new(
            "codegraph_files",
            "List the indexed file tree with per-file language/symbol counts.",
            new CodeGraphToolInputSchema(
                "object",
                new Dictionary<string, CodeGraphToolProperty>
                {
                    ["path"] = new("string", "Directory filter."),
                    ["pattern"] = new("string", "Glob filter."),
                    ["format"] = new("string", "Output layout (default tree).", new[] { "tree", "flat", "grouped" }),
                    ["includeMetadata"] = new("boolean", "Include language/symbol counts (default true)."),
                    ["maxDepth"] = new("number", "Max tree depth."),
                    ["projectPath"] = ProjectPath
                },
                null),
            ReadOnly),
        new(
            "codegraph_status",
            "Index health as agent text: files, nodes, edges, DB size, backend, journal mode, "
                + "pending references, and staleness.",
            new CodeGraphToolInputSchema(
                "object",
                new Dictionary<string, CodeGraphToolProperty> { ["projectPath"] = ProjectPath },
                null),
            ReadOnly)
    };

    // The STATIC surface (≙ getStaticTools, tools.ts:784): the allowlist-filtered
    // definitions with no project-aware shaping. What tools-list answers when the
    // caller supplied no workingFolder context at all.
    public static CodeGraphToolsListResult ListDefault() =>
        new(Success: true, Tools: VisibleTools());

    // The project-aware surface (≙ ToolHandler.getTools, tools.ts:945).
    //   * hasDefaultProject:false — no project is resolvable for this session, so
    //     every exposed schema is cloned with projectPath required (#993).
    //   * indexedFileCount:null — a project is known but its stats are unavailable
    //     (not yet indexed, or the stats read failed): serve the un-shaped surface,
    //     exactly like the upstream getTools catch branch.
    //   * indexedFileCount set — tiny-repo gating + the dynamic explore budget
    //     suffix scaled to project size (tools.ts:1003/:1013).
    public static CodeGraphToolsListResult ListFor(bool hasDefaultProject, int? indexedFileCount)
    {
        var visible = VisibleTools();
        if (!hasDefaultProject)
        {
            return new CodeGraphToolsListResult(Success: true, Tools: WithRequiredProjectPath(visible));
        }

        if (indexedFileCount is not { } fileCount)
        {
            return new CodeGraphToolsListResult(Success: true, Tools: visible);
        }

        if (fileCount < TinyRepoFileThreshold)
        {
            visible = visible.Where(t => Array.IndexOf(TinyRepoCoreTools, t.Name) >= 0).ToArray();
        }

        var callBudget = CodeGraphExploreBudget.GetCallBudget(fileCount);
        visible = visible
            .Select(t => t.Name == "codegraph_explore"
                ? t with
                {
                    Description = t.Description
                        + $" Budget: make at most {callBudget} calls for this project "
                        + $"({fileCount.ToString("N0", CultureInfo.InvariantCulture)} files indexed)."
                }
                : t)
            .ToArray();
        return new CodeGraphToolsListResult(Success: true, Tools: visible);
    }

    // Whether a tool passes the CODEGRAPH_MCP_TOOLS allowlist (≙ isToolAllowed,
    // tools.ts:938). No allowlist -> everything is allowed at EXECUTE time (the
    // default surface only trims what is LISTED, never what runs). Accepts short or
    // codegraph_-prefixed names.
    internal static bool IsToolAllowed(string name)
    {
        var allow = ToolAllowlist();
        return allow is null || allow.Contains(ShortName(name));
    }

    // The full master array (all 8) — exposed for tests / future allowlist surfacing.
    public static CodeGraphToolDefinition[] All() => AllTools;

    // Allowlist or default surface (≙ the getTools visible-set selection). An
    // explicit allowlist REPLACES the default surface entirely.
    private static CodeGraphToolDefinition[] VisibleTools()
    {
        var allow = ToolAllowlist();
        return allow is null
            ? AllTools.Where(t => Array.IndexOf(DefaultSurface, t.Name) >= 0).ToArray()
            : AllTools.Where(t => allow.Contains(ShortName(t.Name))).ToArray();
    }

    // CODEGRAPH_MCP_TOOLS parse (≙ toolAllowlist, tools.ts:923): comma-separated,
    // trimmed, codegraph_ prefix optional. Unset/blank/no-valid-entries -> null
    // (no allowlist).
    private static HashSet<string>? ToolAllowlist()
    {
        var raw = Environment.GetEnvironmentVariable("CODEGRAPH_MCP_TOOLS");
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var part in raw.Split(','))
        {
            var shortName = ShortName(part.Trim());
            if (shortName.Length > 0)
            {
                set.Add(shortName);
            }
        }

        return set.Count > 0 ? set : null;
    }

    private static string ShortName(string name) =>
        name.StartsWith("codegraph_", StringComparison.Ordinal)
            ? name["codegraph_".Length..]
            : name;

    // withRequiredProjectPath (tools.ts:766): clone each schema with projectPath in
    // `required`. PURE — the records make the clone natural (`with`), and the shared
    // static defs are never mutated. A tool without a projectPath property, or one
    // that already requires it, passes through untouched; explore's ["query"] becomes
    // ["query","projectPath"], and a tool with no required list (status/files) gains
    // ["projectPath"].
    private static CodeGraphToolDefinition[] WithRequiredProjectPath(CodeGraphToolDefinition[] defs) =>
        defs
            .Select(tool =>
            {
                if (!tool.InputSchema.Properties.ContainsKey("projectPath"))
                {
                    return tool;
                }

                var required = tool.InputSchema.Required ?? Array.Empty<string>();
                if (Array.IndexOf(required, "projectPath") >= 0)
                {
                    return tool;
                }

                return tool with
                {
                    InputSchema = tool.InputSchema with
                    {
                        Required = required.Append("projectPath").ToArray()
                    }
                };
            })
            .ToArray();

    // symbol* (required) + one extra numeric arg + optional file disambiguator +
    // projectPath — the shared shape for callers/callees/impact.
    private static CodeGraphToolInputSchema SymbolSchema(string symbolDesc, string extraName, string extraDesc) =>
        new(
            "object",
            new Dictionary<string, CodeGraphToolProperty>
            {
                ["symbol"] = new("string", symbolDesc),
                ["file"] = new("string", "Disambiguate the symbol by its file."),
                [extraName] = new("number", extraDesc),
                ["projectPath"] = ProjectPath
            },
            new[] { "symbol" });
}

// ---------------------------------------------------------------------------
// Tool-definition wire DTOs (analysis/04 §3.1/§3.2). Modeled as source-gen records,
// never `dynamic` — inputSchema is a fixed object graph.
// ---------------------------------------------------------------------------
internal sealed record CodeGraphToolsListResult(
    bool Success,
    CodeGraphToolDefinition[] Tools);

internal sealed record CodeGraphToolDefinition(
    string Name,
    string Description,
    CodeGraphToolInputSchema InputSchema,
    CodeGraphToolAnnotations Annotations);

// A JSON-Schema object: { type:"object", properties:{...}, required:[...] }.
internal sealed record CodeGraphToolInputSchema(
    string Type,
    Dictionary<string, CodeGraphToolProperty> Properties,
    string[]? Required);

// One property schema. `Enum` -> JSON "enum" (a keyword-clean member name).
internal sealed record CodeGraphToolProperty(
    string Type,
    string? Description = null,
    [property: JsonPropertyName("enum")] string[]? Enum = null);

// MCP tool annotations (tools.ts:520-525). MUST survive every transform.
internal sealed record CodeGraphToolAnnotations(
    bool ReadOnlyHint,
    bool DestructiveHint,
    bool IdempotentHint,
    bool OpenWorldHint);
