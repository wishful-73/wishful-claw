using System.Text.Json;

using System.Text;

using WishfulClaw.Core.Tools;

using WishfulClaw.Workspace.Memory;



namespace WishfulClaw.Agent.Tools.MemoryTools;



using static WishfulClaw.Agent.Tools.ToolHelpers;



/// <summary>

/// Search memory entries in SQLite. FTS5 trigram first, LIKE fallback.

/// </summary>

public sealed class MemorySearchTool : IToolExecutor

{

    private readonly IMemorySearch _search;



    public MemorySearchTool(IMemorySearch search) => _search = search;



    public string Name => "memory_search";



    public string Description =>

        "Search memory entries in the database by keyword. " +

        "Uses fast FTS index first; falls back to LIKE scan if no results. " +

        "Results include entry id 鈥?use memory_update to modify entries.";



    public string[]? VisibleScopes => ToolVisibilityScopes.Everywhere;

    public bool IsCore => true;

    public JsonElement InputSchema { get; } = ParseSchema(

        """{"type":"object","properties":{"query":{"type":"string","description":"Search query"},"include_deprecated":{"type":"boolean","default":false,"description":"Include deprecated entries in results"},"limit":{"type":"integer","default":10,"minimum":1,"maximum":50}},"required":["query"]}""");



    public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)

    {

        var query = GetString(input, "query");

        if (string.IsNullOrWhiteSpace(query))

            return new ToolResult("memory_search requires a non-empty 'query' parameter", true);



        var limit = GetInt(input, "limit", 10);

        var scope = MemoryToolHelpers.ResolveScope(context);

        var includeDeprecated = GetBool(input, "include_deprecated", false);



        var hits = await _search.SearchAsync(query!, scope, limit, includeDeprecated, context.CancellationToken);



        if (hits.Count == 0)

            return new ToolResult("No matching memory entries found.");



        var sb = new StringBuilder();

        sb.AppendLine($"Matches: {hits.Count}");

        foreach (var hit in hits)

        {

            sb.AppendLine($"\n[id={hit.Id}] {hit.Title} (priority={hit.Priority}, scope={hit.Scope})");

            var content = hit.Content;

            if (content.Length > 400)

                content = content[..400] + "\u2026";

            sb.AppendLine("  " + content.Replace("\n", "\n  ", StringComparison.Ordinal));

        }

        return new ToolResult(sb.ToString().TrimEnd());

    }



}

