using System.Buffers;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// CronRuns tool executor (S-87): read-only listing of scheduled-task run history.
///
/// Deliberately does NOT go through <see cref="AgentRuntimeCronExecutor"/>'s reverse-request
/// path. The rows live in the local database, so a round trip to the main process buys
/// nothing, and <c>DbCronRunTools.List</c>'s orphan sweep needs the renderer's set of live
/// run ids — calling it from here would abort runs that are still executing. See
/// <see cref="DbCronRunTools.ListReadOnly"/>.
/// </summary>
internal static class AgentRuntimeCronRunReader
{
    public const string ToolName = "CronRuns";

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static string Execute(AgentRuntimeNativeToolCall call) =>
        ForwardDbResult(DbCronRunTools.ListReadOnly(BuildParameters(call.Input)));

    /// <summary>
    /// Maps the tool's public <c>jobId</c> onto the column's <c>cronId</c> (the name the rest
    /// of the cron surface uses) and forwards the optional limit.
    /// </summary>
    private static JsonElement BuildParameters(JsonElement input)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();

            var jobId = input.ValueKind == JsonValueKind.Object ? JsonHelpers.GetString(input, "jobId") : null;
            if (!string.IsNullOrWhiteSpace(jobId))
            {
                writer.WriteString("cronId", jobId);
            }

            writer.WriteNumber("limit", input.ValueKind == JsonValueKind.Object ? JsonHelpers.GetInt(input, "limit", 20) : 20);

            writer.WriteEndObject();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    /// <summary>Returns the DB result JSON verbatim, or an encoded error envelope.</summary>
    private static string ForwardDbResult(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var root = document.RootElement;
        if (root.TryGetProperty("error", out var error))
        {
            return EncodeJsonObject(w => w.WriteString("error", error.GetString() ?? "DB operation failed"));
        }

        return root.GetProperty("result").GetRawText();
    }

    private static string EncodeJsonObject(Action<Utf8JsonWriter> writeProperties)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriterOptions))
        {
            writer.WriteStartObject();
            writeProperties(writer);
            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}
