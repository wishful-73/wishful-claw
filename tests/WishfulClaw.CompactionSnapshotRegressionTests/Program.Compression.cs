// 压缩快照回归：压缩用量、摘要输入预算、冷 Worker 压缩、持久化失败、分叉与用量剥离。
// 拆分自原单文件 Program.cs（S-252，2026-10-28），方法体逐字平移。
using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.CompactionSnapshotRegressionTests;

internal static partial class Program
{
    private static void RunAutomaticCompressionUsageSuite(string dbPath, string prefix)
    {
        var wireMessages = new List<JsonElement>
        {
            Json(@"{""role"":""assistant"",""content"":""first"",""usage"":{""contextTokens"":111}}"),
            Json(@"{""role"":""user"",""content"":""next""}"),
            Json(@"{""role"":""assistant"",""content"":""second"",""usage"":{""contextTokens"":222}}"),
            Json(@"{""role"":""assistant"",""content"":""invalid"",""usage"":""malformed""}")
        };
        AssertEqual(222, AgentLoop.FindRecentContextUsage(wireMessages),
            "recent context usage scans backward to the latest valid provider usage");
        AssertEqual(0, AgentLoop.FindRecentContextUsage(
            [Json(@"{""role"":""user"",""content"":""none""}"), Json(@"{""usage"":null}")]),
            "recent context usage returns zero when no valid usage exists");
        AssertEqual(0, AgentLoop.FindRecentContextUsage(
            [Json(@"{""usage"":{""contextTokens"":""not-a-number""}}")]),
            "recent context usage ignores malformed context token values");

        var sessionId = $"{prefix}-restore-usage";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionId);
            writer.WriteString("title", "Restore Usage Session");
        })), "restore usage session is created");
        AssertMutationSuccess(DbMessageTools.AddBatch(Params(dbPath, writer =>
        {
            writer.WriteStartArray("messages");
            writer.WriteStartObject();
            writer.WriteString("id", $"{prefix}-usage-valid");
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", "assistant");
            writer.WriteString("content", "valid usage");
            writer.WriteString("usage", "{\"contextTokens\":654,\"inputTokens\":600}");
            writer.WriteNumber("createdAt", 3300);
            writer.WriteNumber("sortOrder", 0);
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteString("id", $"{prefix}-usage-non-object");
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", "user");
            writer.WriteString("content", "non-object usage");
            writer.WriteString("usage", "[]");
            writer.WriteNumber("createdAt", 3301);
            writer.WriteNumber("sortOrder", 1);
            writer.WriteEndObject();
            writer.WriteStartObject();
            writer.WriteString("id", $"{prefix}-usage-corrupt");
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", "assistant");
            writer.WriteString("content", "corrupt usage");
            writer.WriteString("usage", "{corrupt");
            writer.WriteNumber("createdAt", 3302);
            writer.WriteNumber("sortOrder", 2);
            writer.WriteEndObject();
            writer.WriteEndArray();
        })), "messages with persisted usage are inserted");

        var restored = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(), sessionId);
        AssertEqual(3, restored.WireMessages.Count, "usage restore keeps every regular message");
        Assert(restored.WireMessages[0].TryGetProperty("usage", out var restoredUsage) &&
               restoredUsage.ValueKind == JsonValueKind.Object &&
               restoredUsage.GetProperty("contextTokens").GetInt32() == 654 &&
               restoredUsage.GetProperty("inputTokens").GetInt32() == 600,
            "database restore writes the persisted usage object back to the wire message");
        Assert(!restored.WireMessages[1].TryGetProperty("usage", out _),
            "database restore ignores non-object usage JSON");
        Assert(!restored.WireMessages[2].TryGetProperty("usage", out _),
            "database restore ignores malformed usage JSON");
        AssertEqual(654, AgentLoop.FindRecentContextUsage(restored.WireMessages),
            "restored wire conversation exposes the latest persisted context usage");

        Assert(ContextCompression.IsContextWindowExceededError(
                new InvalidOperationException("maximum context length exceeded")),
            "context overflow classifier recognizes a direct provider error");
        Assert(ContextCompression.IsContextWindowExceededError(
                new InvalidOperationException("outer", new Exception("INPUT TOKEN COUNT EXCEEDS the model limit"))),
            "context overflow classifier recognizes an inner provider error case-insensitively");
        Assert(!ContextCompression.IsContextWindowExceededError(
                new InvalidOperationException("HTTP 400 invalid request payload")),
            "context overflow classifier does not misclassify an ordinary provider error");

        var providerCalls = 0;
        using var retryState = new AgentRuntimeRunState("overflow-retry-test", sessionId);
        var overflowError = new ProviderHttpException(
            "test-provider",
            System.Net.HttpStatusCode.BadRequest,
            "{\"error\":\"context_length_exceeded\"}",
            null);
        try
        {
            ProviderRetryPolicy.ExecuteAsync(
                    () =>
                    {
                        providerCalls++;
                        return Task.FromException<AgentRuntimeProviderTurnResult>(overflowError);
                    },
                    retryState,
                    SilentRequestContext.Instance)
                .GetAwaiter()
                .GetResult();
            throw new InvalidOperationException("provider retry policy unexpectedly swallowed context overflow");
        }
        catch (ProviderHttpException ex)
        {
            Assert(ReferenceEquals(overflowError, ex),
                "provider retry policy propagates the original context overflow error");
        }
        AssertEqual(1, providerCalls,
            "provider retry policy skips ordinary HTTP retry for context overflow");
    }

    private static void RunSummaryInputBudgetSuite()
    {
        var older = AgentRuntimeChatMessage.User("older:" + new string('o', 900));
        var middle = AgentRuntimeChatMessage.User("middle:" + new string('m', 900));
        var recent = AgentRuntimeChatMessage.User("recent-working-state:" + new string('r', 300));
        var budgeted = ContextCompression.BuildSummaryRequestBody([older, middle, recent], 1_024);
        Assert(budgeted.Length <= 1_024,
            "summary input never exceeds the requested character budget");
        Assert(!budgeted.Contains("older:", StringComparison.Ordinal) &&
               budgeted.Contains("recent-working-state:", StringComparison.Ordinal),
            "summary input drops complete oldest messages and preserves the recent working state");
        Assert(budgeted.Contains("older message(s) omitted", StringComparison.Ordinal),
            "summary input reports when older messages were omitted");

        var single = ContextCompression.BuildSummaryRequestBody(
            [AgentRuntimeChatMessage.User("single:" + new string('s', 2_000))], 1_024);
        Assert(single.Length <= 1_024 && single.Contains("[truncated]", StringComparison.Ordinal),
            "a single oversized message is truncated within the final budget");

        using var toolInputDoc = JsonDocument.Parse("{\"payload\":\"" + new string('i', 1_000) + "\"}");
        using var toolResultDoc = JsonDocument.Parse("\"" + new string('r', 1_200) + "\"");
        var toolMessage = new AgentRuntimeChatMessage(
            "assistant",
            string.Empty,
            [new AgentRuntimeChatToolUse("tool-1", "demo_tool", toolInputDoc.RootElement.Clone())],
            []);
        var resultMessage = AgentRuntimeChatMessage.UserToolResults(
            [new AgentRuntimeToolResult("tool-1", toolResultDoc.RootElement.Clone())]);
        var toolTranscript = ContextCompression.BuildSummaryRequestBody(
            [toolMessage, resultMessage], 10_000);
        var callLine = toolTranscript.Split('\n').First(line => line.StartsWith("[assistant calls", StringComparison.Ordinal));
        var resultLines = toolTranscript.Split('\n');
        var resultHeaderIndex = Array.FindIndex(resultLines,
            line => line.StartsWith("[tool tool-1 result", StringComparison.Ordinal));
        Assert(callLine.Length <= "[assistant calls demo_tool] ".Length + 500,
            "summary tool-call input is capped at 500 characters");
        Assert(resultHeaderIndex >= 0 && resultHeaderIndex + 1 < resultLines.Length &&
               resultLines[resultHeaderIndex + 1].Length <= 800,
            "summary tool result is capped at 800 characters");
    }

    // ─── Suite: restore filtering (artifacts never enter model context) ───

    /// <summary>
    /// Regression for the restart incident: the renderer keeps only a paged slice of the
    /// transcript and a freshly started Worker holds no conversation, so a manual
    /// compression used to fold those few caller rows and answer "nothing to compress"
    /// (or silently succeed without persisting anything) on a session whose real context
    /// was far larger. Manual compression must first rebuild the same conversation the
    /// next agent run would send.
    /// </summary>
    private static void RunColdWorkerCompressionSuite(string dbPath, string prefix)
    {
        var db = DbClient.GetClient();
        var callerTranscript = """[{"id":"caller-1","role":"user","content":"paged transcript row"}]""";

        // ── A cold Worker rebuilds the session from the DB and compresses that ──
        var coldSession = $"{prefix}-cold-db";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", coldSession);
            writer.WriteString("title", "Cold Worker Compression Session");
        })), "cold worker compression session is created");
        AddBatchMessages(dbPath, coldSession, coldSession,
            startIndex: 0, count: 5,
            baseCreatedAt: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 500_000,
            baseSortOrder: 0);

        var cold = ResultObject(Compress(CompressParams(dbPath, coldSession, callerTranscript)));
        AssertEqual(5, SessionConversationManager.GetOrCreate(coldSession).MessageCount,
            "a cold manual compression restores the session into the Worker first");
        AssertEqual(5, cold.GetProperty("result").GetProperty("originalCount").GetInt32(),
            "the restored DB conversation is the compression input, not the caller transcript");
        AssertEqual("skipped", cold.GetProperty("result").GetProperty("status").GetString(),
            "five short rows are honestly reported as not foldable");

        // ── A session with no persisted history says so instead of folding the caller ──
        var emptySession = $"{prefix}-cold-empty";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", emptySession);
            writer.WriteString("title", "Cold Worker Empty Session");
        })), "cold worker empty session is created");
        var empty = ResultObject(Compress(CompressParams(dbPath, emptySession, callerTranscript)));
        AssertEqual("nothing to compress", empty.GetProperty("result").GetProperty("error").GetString(),
            "an empty session is not compressed from the caller's rows");
        AssertEqual(0, empty.GetProperty("result").GetProperty("originalCount").GetInt32(),
            "the caller transcript contributes no count for a real session");

        // ── Real corruption blocks, and says why in a machine-readable way ──
        var brokenSession = $"{prefix}-cold-broken";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", brokenSession);
            writer.WriteString("title", "Cold Worker Broken Session");
        })), "cold worker broken session is created");
        AddBatchMessages(dbPath, brokenSession, brokenSession,
            startIndex: 0, count: 5,
            baseCreatedAt: DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 400_000,
            baseSortOrder: 0);
        UpsertSnapshot(dbPath, brokenSession);
        db.Execute(
            "UPDATE session_compaction_snapshots SET version = 99 WHERE session_id = @sid",
            new SqliteParameter("@sid", brokenSession));

        var brokenRevisionBefore = db.QueryScalar<long>(
            "SELECT context_revision FROM sessions WHERE id = @sid",
            new SqliteParameter("@sid", brokenSession));
        var broken = ResultObject(Compress(CompressParams(dbPath, brokenSession, callerTranscript)));
        AssertEqual("blocked", broken.GetProperty("result").GetProperty("status").GetString(),
            "a corrupt snapshot blocks manual compression instead of reporting a skip");
        AssertEqual("restore_failed", broken.GetProperty("result").GetProperty("reason").GetString(),
            "the blocker is machine-readable so the renderer can suggest a new session");
        Assert(!broken.GetProperty("result").GetProperty("compressed").GetBoolean(),
            "a blocked compression reports no success");
        AssertEqual(0, SessionConversationManager.GetOrCreate(brokenSession).MessageCount,
            "a blocked compression leaves the Worker conversation untouched");
        AssertEqual(1L, db.QueryScalar<long>(
            "SELECT COUNT(*) FROM session_compaction_snapshots WHERE session_id = @sid",
            new SqliteParameter("@sid", brokenSession)),
            "a blocked compression persists no new snapshot row");
        AssertEqual(brokenRevisionBefore, db.QueryScalar<long>(
            "SELECT context_revision FROM sessions WHERE id = @sid",
            new SqliteParameter("@sid", brokenSession)),
            "a blocked compression leaves the context revision alone");

        // ── Sessionless callers keep using their own messages ──
        var stateless = ResultObject(Compress(CompressParams(dbPath, sessionId: null,
            """[{"id":"solo","role":"user","content":"single row"}]""")));
        AssertEqual(1, stateless.GetProperty("result").GetProperty("originalCount").GetInt32(),
            "a sessionless request still compresses the caller's messages");
    }

    private static WorkerResponse Compress(JsonElement parameters)
        => AgentRuntimeContextCompressionTools.CompressAsync(
            parameters,
            SilentRequestContext.Instance).GetAwaiter().GetResult();

    private static JsonElement CompressParams(string dbPath, string? sessionId, string messagesJson)
        => Params(dbPath, writer =>
        {
            if (sessionId is not null) writer.WriteString("sessionId", sessionId);
            writer.WriteString("trigger", "manual");
            writer.WritePropertyName("provider");
            writer.WriteStartObject();
            writer.WriteString("providerType", "openai");
            writer.WriteString("apiKey", "regression-test-key");
            writer.WriteString("baseUrl", "http://127.0.0.1:9/v1");
            writer.WriteString("model", "regression-test-model");
            writer.WriteNumber("contextLength", 200_000);
            writer.WriteEndObject();
            writer.WritePropertyName("messages");
            using var document = JsonDocument.Parse(messagesJson);
            document.RootElement.WriteTo(writer);
        });

    private static void RunPersistenceFailureSuite(string dbPath, string prefix)
    {
        var outcome = new ContextCompression.CompactionOutcome(
            [AgentRuntimeChatMessage.User("compressed")],
            [Json(@"{""id"":""summary"",""role"":""user"",""content"":""compressed""}")],
            true,
            false,
            1,
            2,
            "summary");
        var invalidArtifacts = new[] { default(JsonElement) };

        var retainedSession = $"{prefix}-persist-retained";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", retainedSession);
            writer.WriteString("title", "Retained Snapshot Session");
        })), "retained snapshot session is created");
        AddMessage(dbPath, retainedSession, $"{prefix}-persist-retained-message", 3400, 0);
        UpsertSnapshot(dbPath, retainedSession);
        var oldSnapshot = ReadSnapshot(dbPath, retainedSession);

        var retainedFailure = ContextCompression.PersistSnapshot(
            outcome, invalidArtifacts, retainedSession, "manual", 123);
        Assert(!retainedFailure.Success && !retainedFailure.Skipped && retainedFailure.Error is not null,
            "snapshot persistence returns a structured failure");

        var afterFailure = ReadSnapshot(dbPath, retainedSession);
        AssertEqual(oldSnapshot.GetProperty("updatedAt").GetInt64(), afterFailure.GetProperty("updatedAt").GetInt64(),
            "failed snapshot persistence keeps the previous snapshot row");
        AssertEqual(oldSnapshot.GetProperty("wireConversation").GetString(), afterFailure.GetProperty("wireConversation").GetString(),
            "failed snapshot persistence keeps the previous snapshot payload");

        var fallbackSession = $"{prefix}-persist-fallback";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", fallbackSession);
            writer.WriteString("title", "Fallback Snapshot Session");
        })), "fallback snapshot session is created");
        AddMessage(dbPath, fallbackSession, $"{prefix}-persist-fallback-message-1", 3410, 0);
        AddMessage(dbPath, fallbackSession, $"{prefix}-persist-fallback-message-2", 3411, 1);

        var fallbackFailure = ContextCompression.PersistSnapshot(
            outcome, invalidArtifacts, fallbackSession, "auto", 456);
        Assert(!fallbackFailure.Success && !fallbackFailure.Skipped,
            "snapshot persistence failure is reported without an existing snapshot");
        AssertNoSnapshot(dbPath, fallbackSession,
            "failed first snapshot persistence does not create a snapshot");

        var restored = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(), fallbackSession);
        AssertEqual(2, restored.WireMessages.Count,
            "session restore falls back to complete regular message history without a snapshot");
        Assert(!restored.FromSnapshot,
            "no snapshot after persistence failure reports full-history source");
    }

    private static void RunForkSuite(string dbPath, string prefix)
    {
        var source = $"{prefix}-fork-source";
        var forked = $"{prefix}-fork-target";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", source);
            writer.WriteString("title", "Fork Source");
        })), "fork source session is created");
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", forked);
            writer.WriteString("title", "Fork Target");
        })), "fork target session is created");

        AddBatchMessages(dbPath, source, $"{prefix}-fork-src", startIndex: 0, count: 3, baseCreatedAt: 2400, baseSortOrder: 0);
        UpsertSnapshot(dbPath, source);

        // Fork copies messages under new ids into the target session.
        AddBatchMessages(dbPath, forked, $"{prefix}-fork-tgt", startIndex: 0, count: 3, baseCreatedAt: 2400, baseSortOrder: 0);
        AssertNoSnapshot(dbPath, forked, "forked session does not inherit the source snapshot");
        AssertHasSnapshot(dbPath, source, "fork leaves the source snapshot untouched");
    }

    /// <summary>
    /// S-141: a compaction snapshot's wire is copied out of the folded (pre-compression)
    /// context, so its <c>usage</c> reports a token count the restored wire no longer
    /// matches. Restore must drop that stale usage — otherwise the first turn after a
    /// restart compresses a context that is nowhere near the limit — while keeping the
    /// usage of messages created after the snapshot commit (theirs describes exactly the
    /// restored context).
    /// </summary>
    private static void RunSnapshotUsageStripSuite(string dbPath, string prefix)
    {
        var sessionId = $"{prefix}-snapshot-usage";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionId);
            writer.WriteString("title", "Snapshot Usage Session");
        })), "S-141 session is created");

        AddMessage(dbPath, sessionId, $"{prefix}-susage-seed", 5000, 0);

        AssertMutationSuccess(DbCompactionSnapshotTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("trigger", "auto");
            writer.WriteString("wireConversation",
                "[{\"id\":\"wire-folded\",\"role\":\"assistant\",\"content\":\"folded\",\"usage\":{\"contextTokens\":144083}},"
                + "{\"id\":\"wire-kept\",\"role\":\"user\",\"content\":\"kept\"}]");
            writer.WriteString("compactArtifacts", "[{\"id\":\"compact-boundary\"}]");
            writer.WriteNumber("originalCount", 3);
            writer.WriteNumber("newCount", 2);
            writer.WriteNumber("messagesSummarized", 1);
            writer.WriteBoolean("summarizerFailed", false);
        })), "S-141 snapshot with a usage-bearing wire is upserted");

        var afterCommit = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 1000;
        AssertMutationSuccess(DbMessageTools.Add(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-susage-turn");
            writer.WriteString("sessionId", sessionId);
            writer.WriteString("role", "assistant");
            writer.WriteString("content", "fresh turn");
            writer.WriteString("usage", "{\"contextTokens\":21000}");
            writer.WriteNumber("createdAt", afterCommit);
            writer.WriteNumber("sortOrder", 1);
        })), "S-141 post-snapshot turn with fresh usage is inserted");

        var restored = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(), sessionId);
        Assert(restored.FromSnapshot, "S-141 restore takes the snapshot branch");
        Assert(!restored.WireMessages[0].TryGetProperty("usage", out _),
            "S-141 snapshot-borne stale usage is stripped from the restored wire");
        AssertEqual(21000, AgentLoop.FindRecentContextUsage(restored.WireMessages),
            "S-141 compression gate reads the post-snapshot turn's real usage, not the stale one");
    }

    // ─── Helpers ───
}
