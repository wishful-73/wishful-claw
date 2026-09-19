using System.Text;

using System.Text.Json;

using WishfulClaw.Core.Tools;

using WishfulClaw.Workspace.Memory;



namespace WishfulClaw.Agent.Tools.MemoryTools;



using static WishfulClaw.Agent.Tools.ToolHelpers;



/// <summary>

/// Read hot memory (MEMORY.md) 鈥?full content as plain text.

/// The file path is resolved internally; the agent does not need to know it.

/// </summary>

public sealed class MemoryHotReadTool : IToolExecutor

{

    public string Name => "memory_hot_read";



    public string Description =>

        "Read the full hot memory (MEMORY.md) 鈥?the always-loaded key context. " +

        "Call this to refresh your understanding of key facts.";



    public string[]? VisibleScopes => ToolVisibilityScopes.Everywhere;

    public bool IsCore => true;

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

            // 不带 Encoding 参数 = 无 BOM（iter-32 S-80）。传 Encoding.UTF8 会写出 BOM，
            // 那是这只文件唯一的 BOM 来源，渲染端还得专门 strip。
            await File.WriteAllTextAsync(path, "# Long-Term Memory\n", context.CancellationToken);

        }



        var content = await File.ReadAllTextAsync(path, Encoding.UTF8, context.CancellationToken);

        if (string.IsNullOrWhiteSpace(content))

            return new ToolResult("MEMORY.md is empty.");



        return new ToolResult(content);

    }

}

