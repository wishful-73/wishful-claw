using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    private static void RunImageContentSuite()
    {
        const string pastedPngDataUrl =
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        const string pastedPngBase64 =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

        var conversation = new List<AgentRuntimeChatMessage>
        {
            new(
                "user",
                "请查看我刚刚粘贴的截图",
                [],
                [],
                ContentBlocks:
                [
                    TextBlock("请查看我刚刚粘贴的截图"),
                    ImageBlock(pastedPngDataUrl),
                    EmptyImageBlock()
                ])
        };
        var toolDefs = Array.Empty<ToolDefinition>();
        var parameters = EmptyObject();
        var openAiProvider = Provider("openai", "https://api.openai.com/v1/chat/completions");
        var responsesProvider = Provider("openai-responses", "https://api.openai.com/v1/responses");
        var anthropicProvider = Provider("anthropic", "https://api.anthropic.com/v1/messages");

        using var state = new AgentRuntimeRunState("image-content-test", "image-content-session");

        var chatBody = OpenAIChatProvider.BuildRequestBodyForTests(
            parameters, openAiProvider, conversation, toolDefs, state);
        using var chatDocument = JsonDocument.Parse(chatBody);
        var chatContent = FindMessageContent(chatDocument.RootElement, "messages");
        var chatImage = FindBlock(chatContent, "image_url");
        AssertEqual("image_url", chatImage.GetProperty("type").GetString(),
            "OpenAI Chat emits an image_url content block");
        AssertEqual($"data:image/png;base64,{pastedPngBase64}",
            chatImage.GetProperty("image_url").GetProperty("url").GetString(),
            "OpenAI Chat normalizes the pasted PNG data URL");
        Assert(!chatBody.Contains("base64,data:image", StringComparison.Ordinal),
            "OpenAI Chat does not duplicate the data URL prefix");
        AssertEqual(1, CountBlocks(chatContent, "image_url"),
            "OpenAI Chat filters the empty image block");

        var responsesBody = OpenAIResponsesProvider.BuildRequestBodyForTests(
            responsesProvider, conversation, toolDefs);
        using var responsesDocument = JsonDocument.Parse(responsesBody);
        var responsesContent = FindResponsesMessageContent(responsesDocument.RootElement);
        var responsesImage = FindBlock(responsesContent, "input_image");
        AssertEqual("input_image", responsesImage.GetProperty("type").GetString(),
            "OpenAI Responses emits an input_image content block");
        AssertEqual($"data:image/png;base64,{pastedPngBase64}",
            responsesImage.GetProperty("image_url").GetString(),
            "OpenAI Responses normalizes the pasted PNG data URL");
        Assert(!responsesBody.Contains("base64,data:image", StringComparison.Ordinal),
            "OpenAI Responses does not duplicate the data URL prefix");
        AssertEqual(1, CountBlocks(responsesContent, "input_image"),
            "OpenAI Responses filters the empty image block");

        var anthropicBody = AnthropicMessagesProvider.BuildRequestBodyForTests(
            parameters, anthropicProvider, conversation, toolDefs, state);
        using var anthropicDocument = JsonDocument.Parse(anthropicBody);
        var anthropicContent = FindMessageContent(anthropicDocument.RootElement, "messages");
        var anthropicImage = FindBlock(anthropicContent, "image");
        var anthropicSource = anthropicImage.GetProperty("source");
        AssertEqual("image", anthropicImage.GetProperty("type").GetString(),
            "Anthropic emits an image content block");
        AssertEqual("base64", anthropicSource.GetProperty("type").GetString(),
            "Anthropic uses a base64 image source for pasted screenshots");
        AssertEqual("image/png", anthropicSource.GetProperty("media_type").GetString(),
            "Anthropic preserves the pasted screenshot media type");
        AssertEqual(pastedPngBase64, anthropicSource.GetProperty("data").GetString(),
            "Anthropic strips the data URL prefix from image data");
        Assert(!anthropicSource.GetProperty("data").GetString()!.Contains("data:image", StringComparison.Ordinal),
            "Anthropic does not send a data URL prefix in source data");
        AssertEqual(1, CountBlocks(anthropicContent, "image"),
            "Anthropic filters the empty image block");
    }

    private static JsonElement Provider(string type, string baseUrl)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("type", type);
            writer.WriteString("model", "test-vision-model");
            writer.WriteString("baseUrl", baseUrl);
            writer.WriteNumber("maxTokens", 256);
            writer.WriteEndObject();
        });

    private static JsonElement EmptyObject()
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteEndObject();
        });

    private static JsonElement TextBlock(string text)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", text);
            writer.WriteEndObject();
        });

    private static JsonElement ImageBlock(string dataUrl)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("type", "image");
            writer.WriteStartObject("source");
            writer.WriteString("type", "base64");
            writer.WriteString("mediaType", "image/png");
            writer.WriteString("data", dataUrl);
            writer.WriteEndObject();
            writer.WriteEndObject();
        });

    private static JsonElement EmptyImageBlock()
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("type", "image");
            writer.WriteStartObject("source");
            writer.WriteString("type", "base64");
            writer.WriteString("mediaType", "image/png");
            writer.WriteString("data", "");
            writer.WriteEndObject();
            writer.WriteEndObject();
        });

    private static JsonElement FindMessageContent(JsonElement root, string messagesProperty)
        => root.GetProperty(messagesProperty)
            .EnumerateArray()
            .First(message => message.GetProperty("role").GetString() == "user")
            .GetProperty("content");

    private static JsonElement FindResponsesMessageContent(JsonElement root)
        => root.GetProperty("input")
            .EnumerateArray()
            .First(message => message.GetProperty("type").GetString() == "message")
            .GetProperty("content");

    private static JsonElement FindBlock(JsonElement content, string type)
        => content.EnumerateArray()
            .First(block => block.GetProperty("type").GetString() == type);

    private static int CountBlocks(JsonElement content, string type)
        => content.EnumerateArray()
            .Count(block => block.GetProperty("type").GetString() == type);
}
