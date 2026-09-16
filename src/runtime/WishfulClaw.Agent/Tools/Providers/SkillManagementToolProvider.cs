using System.Text.Json;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers placeholder tool definitions for skill management tools.
/// These tools execute in the renderer process via reverse-request.
/// Category "skill-management" is reachable through use_capability: the tool is not core, so it
/// arrives as a proxied capability rather than a direct definition, in every run.
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
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.Everywhere
        ), Category);
    }
}