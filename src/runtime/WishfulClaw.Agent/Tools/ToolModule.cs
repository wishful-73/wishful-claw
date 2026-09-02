using System.Linq;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;
using WishfulClaw.Agent.Tools.FileTools;
using WishfulClaw.Agent.Tools.MemoryTools;
using WishfulClaw.Agent.Tools.SearchTools;
using WishfulClaw.Agent.Tools.ShellTools;
using WishfulClaw.Workspace.Memory;
using WishfulClaw.Agent;

namespace WishfulClaw.Agent.Tools;

/// <summary>
/// Worker module that registers all tool executors and definitions.
/// 
/// Registration modes:
/// 1. Direct registration — tools with real IToolExecutor implementations (File, Memory, Search, Shell, Task).
/// 2. Auto-discovered providers — IToolProvider implementations found via reflection scanning.
///    Each provider registers tool definitions for its category (Desktop, Web, Browser, Plugin, etc.).
///    Execution of these tools is intercepted by ToolDispatchRouter.
/// </summary>
public sealed class ToolModule : IWorkerModule
{
    public string Name => "tools";

    public void Register(IWorkerModuleContext context)
    {
        var registry = new ToolRegistry();

        // ── Mode 1: Direct registration (tools with real executors) ──
        RegisterDirectExecutors(registry);

        // ── Mode 2: Direct registration of all IToolProvider implementations ──
        IToolProvider[] providers =
        [
            new Providers.AskUserToolProvider(),
            new Providers.BrowserToolProvider(),
            new Providers.ChannelPluginToolProvider(),
            new Providers.CodeGraphToolProvider(),
            new Providers.CodeCompatibleToolProvider(),
            new Providers.CronToolProvider(),
            new Providers.DesktopToolProvider(),
            new Providers.GlobalDispatchReplyToolProvider(),
            new Providers.GlobalTaskToolsProvider(),
            new Providers.GoalToolProvider(),
            new Providers.ImageGenerateToolProvider(),
            new Providers.NotebookToolProvider(),
            new Providers.PlanToolProvider(),
            new Providers.PluginToolProvider(),
            new Providers.ProjectToolsProvider(),
            new Providers.SkillManagementToolProvider(),
            new Providers.SkillToolProvider(),
            new Providers.SshToolProvider(),
            new Providers.TaskToolProvider(),
            new Providers.TeamToolProvider(),
            new Providers.UseCapabilityToolProvider(),
            new Providers.WebToolProvider(),
            new Providers.WidgetToolProvider(),
        ];
        foreach (var provider in providers.OrderBy(p => p.GetType().Name, StringComparer.Ordinal))
        {
            try
            {
                registry.PushCategory(provider.Category);
                provider.RegisterTools(registry);
                registry.PopCategory();
            }
            catch (Exception ex)
            {
                WorkerLog.Warn($"[ToolModule] Failed to register provider '{provider.GetType().Name}': {ex.Message}");
            }
        }

        // Expose via shared state for AgentLoop to access
        ToolModuleState.Registry = registry;

        // Register IPC handler: tool/list — returns tool definitions for the LLM
        // Optional "preset" parameter filters tools by scenario (chat/coding/channel/automation/minimal/full).
        context.Register("tool/list", args =>
        {
            var presetId = args.TryGetProperty("preset", out var presetEl)
                ? presetEl.GetString() ?? "full"
                : "full";

            var preset = ToolPreset.BuiltIn.TryGetValue(presetId, out var p)
                ? p
                : ToolPreset.BuiltIn["full"];

            var defs = registry.GetToolDefinitions(preset).ToList();

            return Task.FromResult(WorkerResponse.FromWriter(writer =>
            {
                writer.WriteStartObject();
                writer.WriteString("preset", preset.Id);
                writer.WriteNumber("count", defs.Count);
                writer.WritePropertyName("tools");
                writer.WriteStartArray();
                foreach (var def in defs)
                {
                    writer.WriteStartObject();
                    writer.WriteString("name", def.Name);
                    writer.WriteString("description", def.Description);
                    if (!string.IsNullOrWhiteSpace(def.Category))
                        writer.WriteString("category", def.Category);
                    writer.WriteNumber("priority", def.Priority);
                    writer.WritePropertyName("inputSchema");
                    def.InputSchema.WriteTo(writer);
                    writer.WriteEndObject();
                }
                writer.WriteEndArray();
                writer.WriteEndObject();
            }));
        });
    }

    /// <summary>
    /// Register tools that have real IToolExecutor implementations.
    /// These tools execute directly in the Worker process.
    /// </summary>
    private static void RegisterDirectExecutors(ToolRegistry registry)
    {
        // File tools (category: "file" — included in chat/coding presets)
        registry.Register(new FileReadTool(), "file");
        registry.Register(new FileWriteTool(), "file");
        registry.Register(new FileEditTool(), "file");
        registry.Register(new FileListTool(), "file");

        // Search tools (category: "search" — included in chat/coding presets)
        registry.Register(new GlobTool(), "search");
        registry.Register(new GrepTool(), "search");

        // Shell tools (category: "shell" — included in chat/coding presets)
        registry.Register(new ShellExecuteTool(), "shell");

        // Sub-agent Task tool — load agent definitions from disk into registry first,
        // then construct TaskTool so its description/schema reflect available agent types.
        Agent.SubAgentRegistry.LoadFromDisk();
        registry.Register(new TaskTool(), "task");

        // Sub-agent status and detail query tools
        registry.Register(new SubAgentStatusTool(), "task");
        registry.Register(new SubAgentDetailTool(), "task");

        // Memory tools (category: "memory" — included in chat/coding presets)
        var memorySearch = new MemoryFtsService();
        registry.Register(new MemoryHotReadTool(), "memory");
        registry.Register(new MemoryHotWriteTool(), "memory");
        registry.Register(new MemoryAppendTool(), "memory");
        registry.Register(new MemoryUpdateTool(), "memory");
        registry.Register(new MemorySearchTool(memorySearch), "memory");

        // Expose shared instances for AgentLoop
        ToolModuleState.MemorySearch = memorySearch;
    }
}