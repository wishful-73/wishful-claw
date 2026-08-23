using System.Text;

using System.Text.Json;

using WishfulClaw.Core.Tools;

using WishfulClaw.Workspace.Memory;



namespace WishfulClaw.Agent.Tools.MemoryTools;



using static WishfulClaw.Agent.Tools.ToolHelpers;



/// <summary>

/// Read hot memory (MEMORY.md) — full content as plain text.

/// The file path is resolved internally; the agent does not need to know it.

/// </summary>

public sealed class MemoryHotReadTool : IToolExecutor

{

    public string Name => "memory_hot_read";



    public string Description =>

        "Read the full hot memory (MEMORY.md) — the always-loaded key context. " +

        "Call this to refresh your understanding of key facts.";



    public JsonElement InputSchema { get; } = ParseSchema(

        """{"type":"object","properties":{},"required":[]}""");



    public async Task<ToolResult> ExecuteAsync(JsonElement input, ToolExecutionContext context)

    {

        var scope = MemoryToolHelpers.ResolveScope(context);

        var path = MemoryPathResolver.GetMemoryFilePath(scope);



        // Ensure file exists

        if (!File.Exists(path))

        {

            Directory.CreateDirectory(Path.GetDirectoryName(path)!);

            await File.WriteAllTextAsync(path, "# Long-Term Memory\n", Encoding.UTF8, context.CancellationToken);

        }



        var content = await File.ReadAllTextAsync(path, Encoding.UTF8, context.CancellationToken);

        if (string.IsNullOrWhiteSpace(content))

            return new ToolResult("MEMORY.md is empty.");



        return new ToolResult(content);

    }

}

