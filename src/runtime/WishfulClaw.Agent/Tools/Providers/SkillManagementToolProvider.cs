using System.Text.Json;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers placeholder tool definitions for skill management tools.
/// These tools execute in the renderer process via reverse-request.
/// Category "skill-management" is proxied via use_capability in normal chat/coding,
/// but directly visible to the skill-installer sub-agent preset.
/// </summary>
public sealed class SkillManagementToolProvider : IToolProvider
{
    public string Category => "skill-management";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "list_installed_skills",
            "List all skills currently installed in the local skills directory. Returns each skill's name, description, and enabled status.",
            ToolSchemaBuilder.Object(),
            availableModes: ["normal", "goal", "global"]
        ), Category);
    }
}