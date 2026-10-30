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
            "Capture a full desktop screenshot and return it to the agent. Use before mouse or keyboard actions when screen state matters. " +
            "The returned text states the image size, its origin, the display scale factor and every display's rectangle — those numbers are the " +
            "coordinate frame for DesktopClick/DesktopScroll. Coordinates are pixel positions in the returned image, which is never rescaled. " +
            "Pass `window` to capture a single window instead of the whole desktop: that shrinks the search space a lot and the text then reports the " +
            "window's own origin. Pass `grid: true` when you need to count pixels — it draws labelled ticks every 200px. " +
            "Every capture is also saved to the data directory; the text reports that path, so you can Read it again later instead of re-capturing " +
            "a desktop that has since changed. Pass `path` only to choose a different location.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["path"] = ToolSchemaBuilder.String("Where to write the PNG. Relative paths resolve against the working folder; absolute paths are used as-is. A missing image extension is appended. Example: \"docs/images/desktop.png\"."),
                    ["delayMs"] = ToolSchemaBuilder.Number("Optional delay in milliseconds before capturing. Capped at 5000."),
                    ["grid"] = ToolSchemaBuilder.Boolean("Draw a labelled 200px reference grid on the image. Default false — turn it on when you need to measure a position."),
                    ["window"] = ToolSchemaBuilder.String("Capture only the window whose title matches this text (case-insensitive, exact match preferred, then prefix, then substring). Use DesktopListWindows to see the exact titles. Window capture only covers the primary display.")
                }),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "DesktopListWindows",
            "List the visible top-level windows with their title, class, process and screen rectangle. " +
            "Use it when you need to aim at a specific application: it turns 'somewhere on a 2560x1440 screen' into 'this window, offset (dx, dy) from its origin'. " +
            "Rectangles are screen physical pixels — the same frame DesktopClick uses, so you can pass a window's origin straight into a click. " +
            "Minimized windows are not listed; restore them first.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["match"] = ToolSchemaBuilder.String("Optional title filter (case-insensitive substring). Omit to list everything.")
                }),
            availableModes: ["normal", "goal", "global"],
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly));

        registry.Register(new ToolDefinitionPlaceholder(
            "CaptureAppWindow",
            "Capture a screenshot of the Wishful Claw window itself — not the whole desktop. Use it when you need an image of this app's own UI, for example to illustrate a guide or to show the user what a panel looks like. Prefer it over DesktopScreenshot whenever the subject is this app: it never includes unrelated windows, so the result needs no cleanup. The returned text also states where the window sits on screen (DIP and pixels), so you can turn an offset you measured in the image into a DesktopClick coordinate. The PNG is always saved to the data directory and the text reports that path; pass `path` only to choose a different location.",
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
            "Click a desktop coordinate. Supports left/right/middle button with click, double_click, down, or up actions. " +
            "x/y are screen pixels, in the same frame as the most recent screenshot: start from the image origin reported by " +
            "DesktopScreenshot or CaptureAppWindow, then add the offset you measured in that image. " +
            "Alternatively pass 0~1 fractions (e.g. x:0.62, y:0.28) to mean 'this share of the last screenshot' — that survives any " +
            "downscaling the image went through and is the safer choice when the screenshot was a single window.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["x"] = ToolSchemaBuilder.Number("Screen X in pixels in the last screenshot's frame, or a 0~1 fraction of that image's width."),
                    ["y"] = ToolSchemaBuilder.Number("Screen Y in pixels in the last screenshot's frame, or a 0~1 fraction of that image's height."),
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
            "Scroll on the desktop. Optionally move pointer to x/y first, then apply scrollX/scrollY deltas. " +
            "x/y follow the same rule as DesktopClick: absolute pixels in the last screenshot's frame, or 0~1 fractions of that image.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["x"] = ToolSchemaBuilder.Number("Optional screen X in pixels before scrolling, or a 0~1 fraction of the last screenshot's width."),
                    ["y"] = ToolSchemaBuilder.Number("Optional screen Y in pixels before scrolling, or a 0~1 fraction of the last screenshot's height."),
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