using System.Buffers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Result of the DB restore core (<see cref="SessionRestoreTools.RestoreFromDb"/>):
/// the wire messages, their parsed conversation, and whether a compaction
/// snapshot supplied the prefix. Internal-only; never serialized.
/// </summary>
internal sealed record SessionRestoreCoreResult(
    List<JsonElement> WireMessages,
    List<AgentRuntimeChatMessage> Conversation,
    bool FromSnapshot);

/// <summary>
/// Session restore: load messages from DB and rebuild SessionConversation.
/// Backs both the agent/restore-session endpoint and the agent loop's lazy
/// first-turn initialization (the backend conversation is rebuilt on the first
/// agent/run after a restart or session switch, not when the user merely
/// opens the session). Mirrors Reasonix's LoadSession(path) + SetSession(loaded)
/// pattern.
///
/// Strategy (snapshot-contract.md §六): a valid compaction snapshot restores
/// the compressed wire conversation plus the incremental messages after the
/// snapshot cursor; any snapshot problem (missing/unsupported/corrupt/cursor
/// invalid) falls back to full message recovery. Chat-only artifacts
/// (compact boundary / compression status cards) never enter the model context.
///
/// Reconciliation: the chat store keeps tool calls and their results in the
/// same assistant row (meta.toolCalls), but the wire conversation needs a
/// separate user tool_result message after every assistant tool_use message.
/// On restore those result messages are synthesized in memory from the stored
/// results (so completed results survive a crash) with a placeholder for any
/// call that never finished — nothing is re-executed and nothing is written
/// back to the DB, so no intermediate records accumulate.
/// </summary>
internal static class SessionRestoreTools
{
    /// <summary>
    /// Restore a session from the DB. Prefers the compaction snapshot + post-cursor
    /// incremental messages; falls back to loading all messages. Converts the result
    /// to wire-format JsonElements and calls SessionConversation.Initialize().
    /// </summary>
    public static WorkerResponse RestoreSession(JsonElement parameters)
    {
        var sessionId = JsonHelpers.GetString(parameters, "sessionId")?.Trim();
        if (string.IsNullOrEmpty(sessionId))
        {
            return WorkerResponse.Error("sessionId is required.");
        }

        try
        {
            DbClient.EnsureInitialized(parameters);
            var db = DbClient.GetClient(parameters);

            var restored = RestoreFromDb(db, sessionId);
            var wireMessages = restored.WireMessages;
            if (wireMessages.Count == 0)
            {
                // No messages in DB — nothing to restore, leave session empty
                WorkerLog.Info($"agent restore-session: no messages for session={FormatLogValue(sessionId)}");
                return WorkerResponse.Json(new SessionRestoreResponse(true, sessionId, 0), AgentRuntimeJsonContext.Default.SessionRestoreResponse);
            }

            // Initialize the SessionConversation - but only if it's empty.
            // If the session already has messages (e.g. agent loop is running
            // or a previous turn already populated it), skip to avoid
            // clobbering the live conversation state. The emptiness check and
            // the replacement happen atomically inside InitializeIfEmpty, so
            // concurrent restores (fire-and-forget + explicit) can't race a
            // newly started turn into losing its messages.
            var sessionConv = SessionConversationManager.GetOrCreate(sessionId);
            if (!sessionConv.InitializeIfEmpty(wireMessages, restored.Conversation))
            {
                WorkerLog.Info(
                    $"agent restore-session: skipped (session already has {sessionConv.MessageCount} messages) " +
                    $"session={FormatLogValue(sessionId)}");
                return WorkerResponse.Json(new SessionRestoreResponse(true, sessionId, sessionConv.MessageCount, Skipped: true), AgentRuntimeJsonContext.Default.SessionRestoreResponse);
            }
            if (restored.FromSnapshot)
            {
                // Mirrors the manual compression path: don't re-fold the restored
                // summary until new messages are appended beyond it.
                sessionConv.MarkCompactionWatermark(wireMessages.Count);
            }

            WorkerLog.Info(
                $"agent restore-session: loaded {wireMessages.Count} messages " +
                $"source={(restored.FromSnapshot ? "snapshot" : "full")} " +
                $"for session={FormatLogValue(sessionId)}");

            return WorkerResponse.Json(
                new SessionRestoreResponse(true, sessionId, wireMessages.Count,
                    FromSnapshot: restored.FromSnapshot ? true : null),
                AgentRuntimeJsonContext.Default.SessionRestoreResponse);
        }
        catch (Exception ex)
        {
            WorkerLog.Error(
                $"agent restore-session failed session={FormatLogValue(sessionId)} " +
                $"error={ex.GetType().Name}: {ex.Message}");
            return WorkerResponse.Error($"Restore failed: {ex.Message}");
        }
    }

    /// <summary>
    /// Restore core shared by the agent/restore-session endpoint and the agent
    /// loop's lazy first-turn initialization: snapshot + post-cursor increment,
    /// full-history fallback, and tool-result reconciliation (snapshot-contract.md
    /// §六). Pure DB read — never touches SessionConversation and returns no
    /// WorkerResponse; the caller decides how to apply the result. An empty
    /// WireMessages list means the session has no persisted messages.
    /// </summary>
    internal static SessionRestoreCoreResult RestoreFromDb(DbService db, string sessionId)
    {
        // Snapshot path: validated read (version/payload/cursor) shared with the
        // db endpoint; any problem downgrades to full recovery (reason is logged
        // inside TryGetValidSnapshot).
        CompactionSnapshotEntity? snapshot = null;
        try
        {
            snapshot = DbCompactionSnapshotTools.TryGetValidSnapshot(db, sessionId, out _);
        }
        catch (Exception ex)
        {
            WorkerLog.Warn(
                $"agent restore: snapshot read failed, falling back to full recovery " +
                $"session={FormatLogValue(sessionId)} error={ex.GetType().Name}: {ex.Message}");
        }

        var wireMessages = new List<JsonElement>();

        // Tool-call ids already covered by a stored tool_result row (legacy
        // split format) — pre-scanned so the synthesized results for the
        // preceding assistant rows don't duplicate them.
        var providedResultIds = new HashSet<string>(StringComparer.Ordinal);

        if (snapshot is not null)
        {
            wireMessages.AddRange(
                JsonSerializer.Deserialize(snapshot.WireConversation, AgentRuntimeJsonContext.Default.ListJsonElement)
                ?? []);

            // Ids already covered by the snapshot — dedupes the summary row whose
            // timestamp was relocated into the covered range by the chat store.
            var snapshotIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (var message in wireMessages)
            {
                if (message.ValueKind == JsonValueKind.Object &&
                    message.TryGetProperty("id", out var idProperty) &&
                    idProperty.ValueKind == JsonValueKind.String &&
                    idProperty.GetString() is { Length: > 0 } id)
                {
                    snapshotIds.Add(id);
                }
            }

            // Incremental messages strictly after the snapshot cursor
            // (snapshot-contract.md §3.1).
            var incremental = db.Query(
                "SELECT * FROM messages WHERE session_id = @sid AND " +
                "(created_at > @tca OR (created_at = @tca AND sort_order > @tso)) " +
                "ORDER BY created_at ASC, sort_order ASC",
                EntityMappers.MapMessage,
                new SqliteParameter("@sid", sessionId),
                new SqliteParameter("@tca", snapshot.ThroughCreatedAt),
                new SqliteParameter("@tso", snapshot.ThroughSortOrder));

            // Tool-call ids already covered by a stored tool_result row
            // (legacy split format) — suppresses duplicate synthesized results.
            var filteredIncremental = incremental
                .Where(entity => !snapshotIds.Contains(entity.Id) && !IsChatOnlyArtifact(entity))
                .ToList();

            CollectProvidedResultIds(filteredIncremental, providedResultIds);

            foreach (var entity in filteredIncremental)
            {
                AddEntityWireMessages(wireMessages, entity, providedResultIds);
            }
        }
        else
        {
            // Full recovery: load all messages ordered by (created_at, sort_order)
            var entities = db.Query(
                "SELECT * FROM messages WHERE session_id = @sid ORDER BY created_at ASC, sort_order ASC",
                EntityMappers.MapMessage, new SqliteParameter("@sid", sessionId));

            if (entities.Count == 0)
            {
                return new SessionRestoreCoreResult(wireMessages, [], false);
            }

            var filteredEntities = entities
                .Where(entity => !IsChatOnlyArtifact(entity))
                .ToList();

            CollectProvidedResultIds(filteredEntities, providedResultIds);

            foreach (var entity in filteredEntities)
            {
                AddEntityWireMessages(wireMessages, entity, providedResultIds);
            }
        }

        return new SessionRestoreCoreResult(wireMessages, ParseWireMessages(wireMessages), snapshot is not null);
    }

    /// <summary>
    /// Append the wire message(es) for one DB entity, reconciling tool results:
    /// an assistant row with tool calls also emits a synthesized user tool_result
    /// message so every restored tool_use block is paired with a result, exactly
    /// like the live loop's CreateToolResultsWireMessage. Stored results are
    /// recovered as-is; calls that never finished get an interruption placeholder
    /// so the restored conversation stays valid for the provider API.
    /// </summary>
    private static void AddEntityWireMessages(
        List<JsonElement> wireMessages,
        MessageEntity entity,
        IReadOnlySet<string> providedResultIds)
    {
        wireMessages.Add(ConvertToWireMessage(entity));

        if (entity.Role != "assistant") return;

        var synthesized = SynthesizeToolResultsWireMessage(entity, providedResultIds);
        if (synthesized is not null)
        {
            wireMessages.Add(synthesized.Value);
        }
    }

    /// <summary>
    /// Pre-scan pass: collect the tool-call ids that legacy user rows already
    /// carry as stored tool results, so synthesis can skip them.
    /// </summary>
    private static void CollectProvidedResultIds(
        IReadOnlyList<MessageEntity> entities,
        HashSet<string> providedResultIds)
    {
        foreach (var entity in entities)
        {
            if (entity.Role != "user") continue;
            foreach (var id in ReadToolCallIds(entity.Meta))
            {
                providedResultIds.Add(id);
            }
        }
    }

    /// <summary>
    /// Build the synthesized user tool_result wire message for an assistant row's
    /// meta.toolCalls, or null when nothing needs synthesizing.
    /// </summary>
    private static JsonElement? SynthesizeToolResultsWireMessage(
        MessageEntity entity,
        IReadOnlySet<string> providedResultIds)
    {
        if (string.IsNullOrEmpty(entity.Meta)) return null;

        JsonElement toolCallsEl;
        try
        {
            using var doc = JsonDocument.Parse(entity.Meta);
            var meta = doc.RootElement;
            if (meta.ValueKind != JsonValueKind.Object ||
                !meta.TryGetProperty("toolCalls", out var toolCalls) ||
                toolCalls.ValueKind != JsonValueKind.Array ||
                toolCalls.GetArrayLength() == 0)
            {
                return null;
            }
            toolCallsEl = toolCalls.Clone();
        }
        catch
        {
            return null;
        }

        var buffer = new ArrayBufferWriter<byte>();
        var wroteAny = false;
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        }))
        {
            writer.WriteStartObject();
            writer.WriteString("id", entity.Id + "-tool-results");
            writer.WriteString("role", "user");
            writer.WritePropertyName("content");
            writer.WriteStartArray();

            foreach (var tc in toolCallsEl.EnumerateArray())
            {
                var tcId = JsonHelpers.GetString(tc, "id");
                if (string.IsNullOrEmpty(tcId)) continue;
                if (providedResultIds.Contains(tcId)) continue;

                var status = JsonHelpers.GetString(tc, "status");
                var output = JsonHelpers.GetString(tc, "output");
                var error = JsonHelpers.GetString(tc, "error");

                string content;
                bool isError;
                if (status == "completed" || status == "error")
                {
                    // Finished before the crash — recover the stored result as-is.
                    content = output ?? error ?? string.Empty;
                    isError = status == "error";
                }
                else
                {
                    // Never finished (running/streaming/no status) — placeholder so
                    // the model knows there is no result and can re-invoke if needed.
                    content =
                        "[INTERRUPTED] This tool call was interrupted before it completed; " +
                        "no result is available. Re-invoke the tool if you still need it.";
                    isError = true;
                }

                writer.WriteStartObject();
                writer.WriteString("type", "tool_result");
                writer.WriteString("toolUseId", tcId);
                writer.WriteString("content", content);
                if (isError)
                {
                    writer.WriteBoolean("isError", true);
                }
                writer.WriteEndObject();
                wroteAny = true;
            }

            writer.WriteEndArray();
            writer.WriteNumber("createdAt", entity.CreatedAt);
            writer.WriteEndObject();
        }

        if (!wroteAny) return null;

        using var resultDoc = JsonDocument.Parse(buffer.WrittenMemory);
        return resultDoc.RootElement.Clone();
    }

    private static IEnumerable<string> ReadToolCallIds(string? metaJson)
    {
        if (string.IsNullOrEmpty(metaJson)) yield break;

        JsonElement toolCallsEl;
        try
        {
            using var doc = JsonDocument.Parse(metaJson);
            var meta = doc.RootElement;
            if (meta.ValueKind != JsonValueKind.Object ||
                !meta.TryGetProperty("toolCalls", out var toolCalls) ||
                toolCalls.ValueKind != JsonValueKind.Array)
            {
                yield break;
            }
            toolCallsEl = toolCalls.Clone();
        }
        catch
        {
            yield break;
        }

        foreach (var tc in toolCallsEl.EnumerateArray())
        {
            var id = JsonHelpers.GetString(tc, "id");
            if (!string.IsNullOrEmpty(id)) yield return id;
        }
    }

    /// <summary>
    /// Chat-window display artifacts (compact boundary separator, compression status
    /// card) and compression summary messages never enter the model context on
    /// restore. The boundary/status rows are display-only; the summary row is
    /// redundant because the summarized history is restored alongside it (without
    /// a snapshot the full history is loaded, with one the wire conversation
    /// already carries the summary) — re-injecting it would double the content
    /// and undo the compression. Legacy summary rows carry only the wrapped
    /// &lt;compaction-summary&gt; text without meta.compactSummary (compression-contract.md §4.2).
    /// </summary>
    private static bool IsChatOnlyArtifact(MessageEntity entity)
    {
        if (!string.IsNullOrEmpty(entity.Meta))
        {
            try
            {
                using var doc = JsonDocument.Parse(entity.Meta);
                var meta = doc.RootElement;
                if (meta.ValueKind == JsonValueKind.Object &&
                    (meta.TryGetProperty("compactBoundary", out _) ||
                     meta.TryGetProperty("compressionStatus", out _) ||
                     meta.TryGetProperty("compactSummary", out _)))
                {
                    return true;
                }
            }
            catch
            {
                // Unparseable meta falls through to the legacy text check.
            }
        }

        return entity.Role == "user" &&
               entity.Content.AsSpan().TrimStart().StartsWith("<compaction-summary>", StringComparison.Ordinal);
    }

    /// <summary>
    /// Convert a DB MessageEntity to a wire-format JsonElement that matches
    /// what the frontend sends in the "messages" array:
    ///   - Plain text: { role: "user", content: "text" }
    ///   - With tool calls: { role: "assistant", content: [{type:"text",...},{type:"tool_use",...}] }
    ///   - With tool results: { role: "user", content: [{type:"tool_result",...}] }
    /// </summary>
    private static JsonElement ConvertToWireMessage(MessageEntity entity)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, new JsonWriterOptions
        {
            Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
        }))
        {
            writer.WriteStartObject();
            writer.WriteString("id", entity.Id);
            writer.WriteString("role", entity.Role);

            // Parse meta to check for tool calls
            JsonElement? meta = null;
            if (!string.IsNullOrEmpty(entity.Meta))
            {
                try
                {
                    meta = JsonDocument.Parse(entity.Meta).RootElement.Clone();
                }
                catch { /* ignore parse errors */ }
            }

            JsonElement? usage = null;
            if (!string.IsNullOrEmpty(entity.Usage))
            {
                try
                {
                    usage = JsonDocument.Parse(entity.Usage).RootElement.Clone();
                }
                catch { /* ignore parse errors */ }
            }

            // Check if this message has tool calls in meta
            var hasToolCalls = false;
            if (meta is { } m && m.TryGetProperty("toolCalls", out var toolCallsEl) && toolCallsEl.ValueKind == JsonValueKind.Array)
            {
                hasToolCalls = toolCallsEl.GetArrayLength() > 0;
            }

            if (entity.Role == "assistant" && hasToolCalls && meta is { } metaVal)
            {
                // Assistant message with tool calls → content as array
                writer.WritePropertyName("content");
                writer.WriteStartArray();

                // Text block (if any)
                if (!string.IsNullOrEmpty(entity.Content))
                {
                    writer.WriteStartObject();
                    writer.WriteString("type", "text");
                    writer.WriteString("text", entity.Content);
                    writer.WriteEndObject();
                }

                // Tool use blocks
                if (metaVal.TryGetProperty("toolCalls", out var tcEl))
                {
                    foreach (var tc in tcEl.EnumerateArray())
                    {
                        var tcId = JsonHelpers.GetString(tc, "id");
                        var tcName = JsonHelpers.GetString(tc, "name");
                        if (string.IsNullOrEmpty(tcId) || string.IsNullOrEmpty(tcName)) continue;

                        writer.WriteStartObject();
                        writer.WriteString("type", "tool_use");
                        writer.WriteString("id", tcId);
                        writer.WriteString("name", tcName);
                        writer.WritePropertyName("input");
                        if (tc.TryGetProperty("input", out var inputEl))
                        {
                            inputEl.WriteTo(writer);
                        }
                        else
                        {
                            writer.WriteStartObject();
                            writer.WriteEndObject();
                        }
                        writer.WriteEndObject();
                    }
                }

                writer.WriteEndArray();
            }
            else if (entity.Role == "user" && hasToolCalls && meta is { } metaVal2)
            {
                // User message that is actually tool_results (paired with previous assistant tool_use)
                writer.WritePropertyName("content");
                writer.WriteStartArray();

                if (metaVal2.TryGetProperty("toolCalls", out var tcEl))
                {
                    foreach (var tc in tcEl.EnumerateArray())
                    {
                        var tcId = JsonHelpers.GetString(tc, "id");
                        if (string.IsNullOrEmpty(tcId)) continue;

                        var tcStatus = JsonHelpers.GetString(tc, "status");
                        var isError = tcStatus == "error";
                        var output = JsonHelpers.GetString(tc, "output") ?? JsonHelpers.GetString(tc, "error") ?? "";

                        writer.WriteStartObject();
                        writer.WriteString("type", "tool_result");
                        writer.WriteString("toolUseId", tcId);
                        writer.WriteString("content", output);
                        if (isError)
                        {
                            writer.WriteBoolean("isError", true);
                        }
                        writer.WriteEndObject();
                    }
                }

                writer.WriteEndArray();
            }
            else
            {
                // Plain text message
                writer.WriteString("content", entity.Content);
            }

            writer.WriteNumber("createdAt", entity.CreatedAt);
            if (usage is { ValueKind: JsonValueKind.Object } usageValue)
            {
                writer.WritePropertyName("usage");
                usageValue.WriteTo(writer);
            }
            writer.WriteEndObject();
        }

        using var doc = JsonDocument.Parse(buffer.WrittenMemory);
        return doc.RootElement.Clone();
    }

    /// <summary>
    /// Parse wire-format messages to AgentRuntimeChatMessage list.
    /// Reuses the same parsing logic as ConversationCodec.ReadConversation.
    /// </summary>
    private static List<AgentRuntimeChatMessage> ParseWireMessages(IReadOnlyList<JsonElement> messages)
    {
        var result = new List<AgentRuntimeChatMessage>();

        foreach (var message in messages)
        {
            var role = JsonHelpers.GetString(message, "role");
            if (string.IsNullOrEmpty(role)) continue;

            if (!message.TryGetProperty("content", out var content)) continue;

            if (content.ValueKind == JsonValueKind.String)
            {
                result.Add(new AgentRuntimeChatMessage(
                    role,
                    content.GetString() ?? string.Empty,
                    [], [],
                    JsonHelpers.GetString(message, "providerResponseId")));
                continue;
            }

            if (content.ValueKind != JsonValueKind.Array) continue;

            var text = new StringBuilder();
            var toolUses = new List<AgentRuntimeChatToolUse>();
            var toolResults = new List<AgentRuntimeToolResult>();
            var contentBlocks = new List<JsonElement>();

            foreach (var block in content.EnumerateArray())
            {
                if (block.ValueKind == JsonValueKind.Object)
                {
                    contentBlocks.Add(block.Clone());
                }

                switch (JsonHelpers.GetString(block, "type"))
                {
                    case "text":
                        if (JsonHelpers.GetString(block, "text") is { Length: > 0 } blockText)
                        {
                            text.Append(blockText);
                        }
                        break;
                    case "tool_use":
                        if (JsonHelpers.GetString(block, "id") is { Length: > 0 } id &&
                            JsonHelpers.GetString(block, "name") is { Length: > 0 } name)
                        {
                            var input = block.TryGetProperty("input", out var inputElement)
                                ? inputElement.Clone()
                                : AgentRuntimeProviderSupport.CreateEmptyObjectElement();
                            var extraContent = block.TryGetProperty("extraContent", out var extra) &&
                                extra.ValueKind == JsonValueKind.Object
                                    ? extra.Clone()
                                    : (JsonElement?)null;
                            toolUses.Add(new AgentRuntimeChatToolUse(id, name, input, extraContent));
                        }
                        break;
                    case "tool_result":
                        if (JsonHelpers.GetString(block, "toolUseId") is { Length: > 0 } toolUseId)
                        {
                            var resultContent = block.TryGetProperty("content", out var contentElement)
                                ? contentElement.Clone()
                                : AgentRuntimeProviderSupport.CreateStringElement(string.Empty);
                            var isError = JsonHelpers.GetBool(block, "isError", false);
                            toolResults.Add(new AgentRuntimeToolResult(
                                toolUseId, resultContent, isError ? true : null));
                        }
                        break;
                }
            }

            result.Add(new AgentRuntimeChatMessage(
                role, text.ToString(), toolUses, toolResults,
                JsonHelpers.GetString(message, "providerResponseId"),
                contentBlocks));
        }

        return result;
    }

    private static string FormatLogValue(string? value)
    {
        if (string.IsNullOrEmpty(value)) return "<empty>";
        return value.Length <= 12 ? value : value[..12] + "...";
    }
}
