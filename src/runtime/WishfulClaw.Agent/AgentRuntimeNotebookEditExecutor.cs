using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// NotebookEdit tool executor — Jupyter notebook cell editing.
/// Simplified port: basic JSON notebook manipulation.
/// Ported from WishfulClaw (NotebookEdit native tool concept).
/// </summary>
public static class AgentRuntimeNotebookEditExecutor
{
    public static bool IsNotebookEditTool(string toolName) =>
        string.Equals(toolName, "NotebookEdit", StringComparison.Ordinal);

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        CancellationToken cancellationToken)
    {
        var path = JsonHelpers.GetString(call.Input, "notebook_path")?.Trim() ?? string.Empty;
        if (path.Length == 0)
            return EncodeError("notebook_path is required");

        if (!File.Exists(path))
            return EncodeError($"Notebook not found: {path}");

        var cellId = JsonHelpers.GetString(call.Input, "cell_id")?.Trim();
        var cellType = JsonHelpers.GetString(call.Input, "cell_type")?.Trim();
        var editMode = JsonHelpers.GetString(call.Input, "edit_mode")?.Trim() ?? "replace";
        var newSource = JsonHelpers.GetString(call.Input, "new_source")?.Trim() ?? string.Empty;

        var json = await File.ReadAllTextAsync(path, cancellationToken);
        if (string.IsNullOrWhiteSpace(json))
        {
            return EncodeError(
                $"Notebook file is empty (0 bytes): {path}. A valid .ipynb must contain a JSON object " +
                "with a \"cells\" array. Create the notebook with content first, e.g. " +
                "{\"cells\":[],\"metadata\":{},\"nbformat\":4,\"nbformat_minor\":5}.");
        }

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(json);
        }
        catch (JsonException ex)
        {
            return EncodeError($"Notebook file is not valid JSON: {path}. Parse error: {ex.Message}");
        }
        using (doc)
        {
            var root = doc.RootElement.Clone();

            using var ms = new MemoryStream();
            using (var writer = new Utf8JsonWriter(ms, new JsonWriterOptions { Indented = true }))
            {
                writer.WriteStartObject();
                foreach (var prop in root.EnumerateObject())
                {
                    if (prop.NameEquals("cells") && prop.Value.ValueKind == JsonValueKind.Array)
                    {
                        writer.WritePropertyName("cells");
                        writer.WriteStartArray();
                        var edited = false;
                        foreach (var cell in prop.Value.EnumerateArray())
                        {
                            if (ShouldEditCell(cell, cellId, cellType))
                            {
                                WriteEditedCell(writer, cell, newSource, editMode);
                                edited = true;
                            }
                            else
                            {
                                cell.WriteTo(writer);
                            }
                        }
                        if (!edited && editMode == "insert")
                        {
                            writer.WriteStartObject();
                            writer.WriteString("cell_type", cellType ?? "code");
                            writer.WritePropertyName("source");
                            writer.WriteStartArray();
                            writer.WriteStringValue(newSource);
                            writer.WriteEndArray();
                            writer.WriteEndObject();
                        }
                        writer.WriteEndArray();
                    }
                    else
                    {
                        prop.WriteTo(writer);
                    }
                }
                writer.WriteEndObject();
            }

            var result = System.Text.Encoding.UTF8.GetString(ms.ToArray());
            await File.WriteAllTextAsync(path, result, cancellationToken);
        }

        return "{\"success\":true,\"message\":\"Notebook cell updated.\"}";
    }

    private static bool ShouldEditCell(JsonElement cell, string? cellId, string? cellType)
    {
        if (!string.IsNullOrEmpty(cellId))
        {
            return cell.TryGetProperty("id", out var id) &&
                id.ValueKind == JsonValueKind.String &&
                id.GetString() == cellId;
        }
        if (!string.IsNullOrEmpty(cellType))
        {
            return cell.TryGetProperty("cell_type", out var ct) &&
                ct.ValueKind == JsonValueKind.String &&
                ct.GetString() == cellType;
        }
        return false;
    }

    private static void WriteEditedCell(Utf8JsonWriter writer, JsonElement cell, string newSource, string editMode)
    {
        writer.WriteStartObject();
        foreach (var prop in cell.EnumerateObject())
        {
            if (prop.NameEquals("source"))
            {
                writer.WritePropertyName("source");
                writer.WriteStartArray();
                writer.WriteStringValue(newSource);
                writer.WriteEndArray();
            }
            else
            {
                prop.WriteTo(writer);
            }
        }
        writer.WriteEndObject();
    }

    private static string EncodeError(string message)
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream))
        { w.WriteStartObject(); w.WriteString("error", message); w.WriteEndObject(); }
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }
}
