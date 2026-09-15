using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers desktop control tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeDesktopExecutor (reverse-request to main process).
/// Available in normal and goal modes only (not sub-agent).
/// </summary>
public sealed class DesktopToolProvider : IToolProvider
{
    public string Category => "desktop";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "DesktopScreenshot",
            "Capture a full desktop screenshot and return it to the agent. Use before mouse or keyboard actions when screen state matters.",
            ToolSchemaBuilder.Object(
                new() { ["delayMs"] = ToolSchemaBuilder.Number("Optional delay in milliseconds before capturing.") }),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "CaptureAppWindow",
            "Capture a screenshot of the Wishful Claw window itself — not the whole desktop. Use it when you need an image of this app's own UI, for example to illustrate a guide or to show the user what a panel looks like. Prefer it over DesktopScreenshot whenever the subject is this app: it never includes unrelated windows, so the result needs no cleanup. Pass `path` to write the PNG to disk; without it you receive the image but nothing is saved.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["path"] = ToolSchemaBuilder.String("Where to write the PNG. Relative paths resolve against the working folder; absolute paths are used as-is. A missing image extension is appended. Example: \"docs/images/usage-panel.png\"."),
                    ["delayMs"] = ToolSchemaBuilder.Number("Optional delay in milliseconds before capturing, to let the UI settle. Capped at 5000.")
                }),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "DesktopClick",
            "Click a desktop coordinate. Supports left/right/middle button with click, double_click, down, or up actions.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["x"] = ToolSchemaBuilder.Number("Absolute X coordinate."),
                    ["y"] = ToolSchemaBuilder.Number("Absolute Y coordinate."),
                    ["button"] = ToolSchemaBuilder.String("Mouse button: left, right, or middle."),
                    ["action"] = ToolSchemaBuilder.String("Mouse action: click, double_click, down, or up.")
                },
                ["x", "y"]),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "DesktopType",
            "Type text, press a special key, or send a keyboard shortcut. Modifiers: Control, Meta, Alt, Shift.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["text"] = ToolSchemaBuilder.String("Type a full text string."),
                    ["key"] = ToolSchemaBuilder.String("Press one special key (Enter, Tab, Escape, etc.)."),
                    ["hotkey"] = ToolSchemaBuilder.ArraySchema("Key chord like [\"Control\", \"L\"].", ToolSchemaBuilder.String("Key name."))
                }),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "DesktopScroll",
            "Scroll on the desktop. Optionally move pointer to x/y first, then apply scrollX/scrollY deltas.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["x"] = ToolSchemaBuilder.Number("Optional X coordinate before scrolling."),
                    ["y"] = ToolSchemaBuilder.Number("Optional Y coordinate before scrolling."),
                    ["scrollX"] = ToolSchemaBuilder.Number("Horizontal scroll delta. Defaults to 0."),
                    ["scrollY"] = ToolSchemaBuilder.Number("Vertical scroll delta.")
                }),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "DesktopWait",
            "Pause desktop automation for a short period before continuing.",
            ToolSchemaBuilder.Object(
                new() { ["delayMs"] = ToolSchemaBuilder.Number("Delay in milliseconds. Defaults to 2000.") }),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly));
    }
}