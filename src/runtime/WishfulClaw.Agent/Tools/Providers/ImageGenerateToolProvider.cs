using WishfulClaw.Agent.Tools;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent.Tools.Providers;

/// <summary>
/// Registers image generation tool definitions.
/// Execution: ToolDispatchRouter → AgentRuntimeImageGenerateExecutor (reverse-request to main process).
/// </summary>
public sealed class ImageGenerateToolProvider : IToolProvider
{
    public string Category => "image-generate";

    public void RegisterTools(ToolRegistry registry)
    {
        registry.Register(new ToolDefinitionPlaceholder(
            "ImageGenerate",
            "Generate images when the user needs visual content. Use proactively whenever an image would help. count defaults to 1, max 4.",
            ToolSchemaBuilder.Object(
                new()
                {
                    ["prompt"] = ToolSchemaBuilder.String("Complete visual prompt: subject, style, composition, lighting/mood. Be specific and concrete."),
                    ["count"] = ToolSchemaBuilder.Number("How many images to generate. Defaults to 1, max 4."),
                    ["reference_images"] = ToolSchemaBuilder.ArraySchema("Optional local image paths as references.", ToolSchemaBuilder.String("Image path.")),
                    ["size"] = ToolSchemaBuilder.String("Image size.", ["auto", "1024x1024", "1024x1536", "1536x1024"]),
                    ["quality"] = ToolSchemaBuilder.String("Image quality.", ["auto", "low", "medium", "high"])
                },
                ["prompt"]),
            visibleScopes: ToolVisibilityScopes.WorkRunsOnly));
    }
}
