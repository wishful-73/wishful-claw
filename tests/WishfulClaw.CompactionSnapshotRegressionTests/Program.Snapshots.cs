// 压缩快照回归：快照生成、失效重算。
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
    private static void RunSnapshotSuite(string dbPath, string prefix)
    {
        var db = DbClient.GetClient();
        var sessionA = $"{prefix}-session-a";

        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionA);
            writer.WriteString("title", "Snapshot Session A");
        })), "session for snapshot tests is created");

        // Upsert refuses a session without persisted messages.
        var emptySession = $"{prefix}-session-empty";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", emptySession);
            writer.WriteString("title", "Empty Session");
        })), "empty session is created");
        var refused = ResultObject(DbCompactionSnapshotTools.Upsert(UpsertParams(dbPath, emptySession)));
        Assert(!refused.GetProperty("success").GetBoolean(), "upsert refuses a session without messages");

        // Seed messages m0..m4 with distinct created_at/sort_order.
        AddBatchMessages(dbPath, sessionA, prefix, startIndex: 0, count: 5, baseCreatedAt: 1000, baseSortOrder: 0);

        // ── CRUD roundtrip ──
        AssertMutationSuccess(DbCompactionSnapshotTools.Upsert(UpsertParams(dbPath, sessionA, trigger: "auto",
            originalCount: 5, newCount: 2, messagesSummarized: 3)),
            "upsert persists the first snapshot");

        var snapshot = ReadSnapshot(dbPath, sessionA);
        var firstSnapshotId = snapshot.GetProperty("snapshotId").GetString();
        AssertEqual(1, snapshot.GetProperty("version").GetInt32(), "snapshot stores format version 1");
        AssertEqual("auto", snapshot.GetProperty("trigger").GetString(), "snapshot stores trigger");
        AssertEqual(1004L, snapshot.GetProperty("throughCreatedAt").GetInt64(), "cursor uses newest message created_at");
        AssertEqual(4, snapshot.GetProperty("throughSortOrder").GetInt32(), "cursor uses newest message sort_order");
        AssertEqual(5, snapshot.GetProperty("originalCount").GetInt32(), "snapshot stores original count");
        AssertEqual(2, snapshot.GetProperty("newCount").GetInt32(), "snapshot stores new count");
        AssertEqual(3, snapshot.GetProperty("messagesSummarized").GetInt32(), "snapshot stores summarized count");
        Assert(!snapshot.GetProperty("summarizerFailed").GetBoolean(), "snapshot stores summarizer success");
        AssertNullProperty(snapshot, "summaryMessage", "summaryMessage stays null when omitted");
        AssertNullProperty(snapshot, "summaryText", "summaryText stays null when omitted");

        // A second compression inserts a new immutable revision and advances the pointer.
        AssertMutationSuccess(DbCompactionSnapshotTools.Upsert(UpsertParams(dbPath, sessionA, trigger: "manual",
            originalCount: 5, newCount: 1, messagesSummarized: 4, summarizerFailed: true,
            summaryMessage: "{\"id\":\"summary\"}", summaryText: "compressed body")),
            "upsert inserts a new snapshot revision");
        var replaced = ReadSnapshot(dbPath, sessionA);
        AssertEqual("manual", replaced.GetProperty("trigger").GetString(), "replace updates trigger");
        Assert(replaced.GetProperty("summarizerFailed").GetBoolean(), "replace updates degraded flag");
        AssertEqual("compressed body", replaced.GetProperty("summaryText").GetString(), "replace stores summary text");
        Assert(replaced.TryGetProperty("summaryMessage", out var summaryMessage)
                && summaryMessage.ValueKind == JsonValueKind.String
                && IsJsonObjectText(summaryMessage.GetString()),
            "replace stores summary message JSON");

        var manifestResult = ResultObject(DbCompactionSnapshotTools.GetContextManifest(
            Params(dbPath, writer => writer.WriteString("sessionId", sessionA))));
        Assert(manifestResult.GetProperty("success").GetBoolean(), "context manifest read succeeds");
        var manifest = manifestResult.GetProperty("manifest");
        AssertEqual(replaced.GetProperty("snapshotId").GetString(), manifest.GetProperty("currentSnapshotId").GetString(),
            "context manifest points to current snapshot");
        Assert(manifest.GetProperty("hasSnapshot").GetBoolean(), "context manifest reports snapshot presence");
        Assert(manifest.GetProperty("prefixMessageCount").GetInt32() > 0, "context manifest reports prefix count");
        Assert(!manifest.TryGetProperty("wireConversation", out _), "context manifest omits wire conversation payload");
        Assert(!manifest.TryGetProperty("compactArtifacts", out _), "context manifest omits compact artifacts payload");
        Assert(!manifest.TryGetProperty("summaryText", out _), "context manifest omits summary payload");

        AssertEqual(2L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM session_compaction_snapshots WHERE session_id = @sid",
                new SqliteParameter("@sid", sessionA)),
            "upsert retains immutable snapshot history per session");
        Assert(!string.Equals(firstSnapshotId, replaced.GetProperty("snapshotId").GetString(), StringComparison.Ordinal),
            "upsert advances to a new snapshot id");

        // ── Increment after the snapshot commit boundary ──
        // The boundary is the snapshot row's own created_at (commit wall clock), so only
        // messages persisted after it are recovered as the increment.
        var afterCommit = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + 1000;
        AddMessage(dbPath, sessionA, $"{prefix}-m5", afterCommit, 5);
        AddMessage(dbPath, sessionA, $"{prefix}-m6", afterCommit, 6);
        var incrementManifest = ResultObject(DbCompactionSnapshotTools.GetContextManifest(
            Params(dbPath, writer => writer.WriteString("sessionId", sessionA))));
        AssertEqual(2,
            incrementManifest.GetProperty("manifest").GetProperty("incrementalMessageCount").GetInt32(),
            "only messages created after the snapshot commit time count as the increment");

        var incrementRestore = SessionRestoreTools.RestoreFromDb(DbClient.GetClient(), sessionA);
        var restoredTail = incrementRestore.WireMessages
            .Skip(incrementRestore.WireMessages.Count - 2)
            .Select(message => message.GetProperty("id").GetString())
            .ToArray();
        AssertEqual($"{prefix}-m5", restoredTail[0], "restored increment keeps transcript order at equal created_at (first)");
        AssertEqual($"{prefix}-m6", restoredTail[1], "restored increment breaks equal-timestamp ties via sort_order");

        // ── S-141: snapshot-borne stale usage never seeds the compression gate ──
        RunSnapshotUsageStripSuite(dbPath, prefix);

        // ── Delete endpoint ──
        var deleted = ResultObject(DbCompactionSnapshotTools.Delete(Params(dbPath, writer => writer.WriteString("sessionId", sessionA))));
        Assert(deleted.GetProperty("success").GetBoolean(), "delete endpoint succeeds");
        Assert(deleted.GetProperty("deleted").GetBoolean(), "delete removes an existing snapshot");
        AssertNoSnapshot(dbPath, sessionA, "get after delete returns no snapshot");
        var deleteAgain = ResultObject(DbCompactionSnapshotTools.Delete(Params(dbPath, writer => writer.WriteString("sessionId", sessionA))));
        Assert(!deleteAgain.GetProperty("deleted").GetBoolean(), "delete reports absence for missing snapshot");

        // ── Safety validation fallbacks (raw rows) ──
        RunValidationFallbackSuite(dbPath, $"{prefix}-session-g");

        // ── Invalidation rules ──
        RunInvalidationSuite(dbPath, prefix, sessionA);

        // ── Automatic compression usage recovery and overflow classification ──
        RunAutomaticCompressionUsageSuite(dbPath, prefix);

        // ── Summarizer input budget and tool-content truncation ──
        RunSummaryInputBudgetSuite();

        // ── Restore filtering (summary/artifact rows never enter model context) ──
        RunRestoreFilterSuite(dbPath, prefix);

        // ── Coverage boundary vs transcript-index drift ──
        RunCoverageBoundarySuite(dbPath, prefix);

        // ── Compression snapshot persistence failure semantics ──
        RunPersistenceFailureSuite(dbPath, prefix);

        // ── fork/duplicate does not inherit snapshots ──
        RunForkSuite(dbPath, prefix);

        // ── ClearAll removes sessions but retains immutable snapshot history ──
        var sessionD = $"{prefix}-session-d";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionD);
            writer.WriteString("title", "Session D");
        })), "session D is created");
        AddMessage(dbPath, sessionD, $"{prefix}-d1", 2000, 0);
        UpsertSnapshot(dbPath, sessionD);
        var snapshotsBeforeClearAll = db.QueryScalar<long>("SELECT COUNT(*) FROM session_compaction_snapshots");
        var clearAll = ResultObject(DbSessionTools.ClearAll(Params(dbPath)));
        Assert(clearAll.GetProperty("success").GetBoolean(), "clear-all succeeds");
        AssertEqual(snapshotsBeforeClearAll, db.QueryScalar<long>("SELECT COUNT(*) FROM session_compaction_snapshots"),
            "clear-all retains immutable snapshot history for diagnostics");
        AssertEqual(0L, db.QueryScalar<long>("SELECT COUNT(*) FROM sessions WHERE plugin_id IS NULL"),
            "clear-all removes regular sessions");
    }

    private static void RunInvalidationSuite(string dbPath, string prefix, string sessionA)
    {
        var db = DbClient.GetClient();

        // Usage-only persistence updates are display metadata and must keep the snapshot.
        var usageSession = $"{prefix}-session-usage";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", usageSession);
            writer.WriteString("title", "Usage Session");
        })), "usage session is created");
        AddMessage(dbPath, usageSession, $"{prefix}-usage-message", 2500, 0);
        UpsertSnapshot(dbPath, usageSession);
        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-usage-message");
            writer.WriteString("sessionId", usageSession);
            writer.WriteString("role", "user");
            writer.WriteString("content", $"message {prefix}-usage-message");
            writer.WriteNumber("createdAt", 2500);
            writer.WriteNumber("sortOrder", 0);
            writer.WriteString("usage", "{\"contextTokens\":123}");
        })), "usage-only upsert succeeds");
        AssertHasSnapshot(dbPath, usageSession, "usage-only upsert keeps the snapshot");

        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-usage-message");
            writer.WriteString("sessionId", usageSession);
            writer.WriteString("role", "user");
            writer.WriteString("content", "edited content");
            writer.WriteNumber("createdAt", 2500);
            writer.WriteNumber("sortOrder", 0);
            writer.WriteString("usage", "{\"contextTokens\":456}");
        })), "content-changing upsert succeeds");
        AssertHasSnapshot(dbPath, usageSession, "content-changing upsert keeps the snapshot");

        var updateSession = $"{prefix}-session-update";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", updateSession);
            writer.WriteString("title", "Update Session");
        })), "update session is created");
        AddMessage(dbPath, updateSession, $"{prefix}-update-message", 2600, 0);
        UpsertSnapshot(dbPath, updateSession);
        AssertMutationSuccess(DbMessageTools.Update(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-update-message");
            writer.WriteStartObject("patch");
            writer.WriteString("usage", "{\"contextTokens\":789}");
            writer.WriteEndObject();
        })), "usage-only message update succeeds");
        AssertHasSnapshot(dbPath, updateSession, "usage-only message update keeps the snapshot");

        AssertMutationSuccess(DbMessageTools.Update(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-update-message");
            writer.WriteStartObject("patch");
            writer.WriteString("meta", "{\"toolResult\":true}");
            writer.WriteEndObject();
        })), "meta-changing message update succeeds");
        AssertHasSnapshot(dbPath, updateSession, "meta-changing message update keeps the snapshot");

        // Chat-only display artifacts (compression status card / compact boundary)
        // never reach the model context — meta-only lifecycle updates must keep the
        // snapshot (snapshot-contract.md §7.4), while content rewrites still
        // invalidate it. Regression for the "snapshot deleted the moment compression
        // completes" defect: the status card is inserted before PersistSnapshot, so
        // the snapshot cursor anchors on it, and the completion-state merge used to
        // delete the snapshot it was reporting on.
        var artifactSession = $"{prefix}-session-artifact";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", artifactSession);
            writer.WriteString("title", "Artifact Session");
        })), "artifact session is created");
        AddMessage(dbPath, artifactSession, $"{prefix}-artifact-message", 2700, 0);
        AssertMutationSuccess(DbMessageTools.Add(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-status");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "system");
            writer.WriteString("content", "");
            writer.WriteString("meta", "{\"compressionStatus\":{\"operationId\":\"op-1\",\"state\":\"compressing\",\"startedAt\":2700}}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 1);
        })), "compression status card is inserted");
        UpsertSnapshot(dbPath, artifactSession);
        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-status");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "system");
            writer.WriteString("content", "");
            writer.WriteString("meta", "{\"compressionStatus\":{\"operationId\":\"op-1\",\"state\":\"compressed\",\"startedAt\":2700,\"completedAt\":2701}}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 1);
        })), "status card completion-state upsert succeeds");
        AssertHasSnapshot(dbPath, artifactSession, "status card meta-only upsert keeps the snapshot");

        AssertMutationSuccess(DbMessageTools.Add(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-boundary");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "system");
            writer.WriteString("content", "");
            writer.WriteString("meta", "{\"compactBoundary\":{\"trigger\":\"auto\"}}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 2);
        })), "compact boundary row is inserted");
        UpsertSnapshot(dbPath, artifactSession);
        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-boundary");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "system");
            writer.WriteString("content", "");
            writer.WriteString("meta", "{\"compactBoundary\":{\"trigger\":\"manual\",\"preTokens\":123}}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 2);
        })), "boundary meta-only upsert succeeds");
        AssertHasSnapshot(dbPath, artifactSession, "boundary meta-only upsert keeps the snapshot");

        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-status");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "system");
            writer.WriteString("content", "rewritten artifact content");
            writer.WriteString("meta", "{\"compressionStatus\":{\"operationId\":\"op-1\",\"state\":\"compressed\",\"startedAt\":2700,\"completedAt\":2701}}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 1);
        })), "artifact content rewrite upsert succeeds");
        AssertHasSnapshot(dbPath, artifactSession, "artifact content rewrite keeps the snapshot");

        UpsertSnapshot(dbPath, artifactSession);
        AssertMutationSuccess(DbMessageTools.Upsert(Params(dbPath, writer =>
        {
            writer.WriteString("id", $"{prefix}-artifact-message");
            writer.WriteString("sessionId", artifactSession);
            writer.WriteString("role", "user");
            writer.WriteString("content", $"message {prefix}-artifact-message");
            writer.WriteString("meta", "{\"toolResult\":true}");
            writer.WriteNumber("createdAt", 2700);
            writer.WriteNumber("sortOrder", 0);
        })), "regular message meta-only upsert succeeds");
        AssertHasSnapshot(dbPath, artifactSession, "regular message meta-only upsert keeps the snapshot");

        // Deleting a covered message keeps the immutable snapshot and leaves an
        // invalid cursor for explicit repair; it never silently falls back.
        UpsertSnapshot(dbPath, sessionA);
        AssertMutationSuccess(DbMessageTools.Delete(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionA);
            writer.WriteString("messageId", $"{prefix}-m2");
        })), "covered message can be deleted");
        AssertHasSnapshot(dbPath, sessionA, "deleting a covered non-anchor message keeps snapshot restore");

        // Deleting a message after the cursor keeps the snapshot.
        UpsertSnapshot(dbPath, sessionA);
        AddMessage(dbPath, sessionA, $"{prefix}-m7", 1006, 7);
        AssertMutationSuccess(DbMessageTools.Delete(Params(dbPath, writer =>
        {
            writer.WriteString("sessionId", sessionA);
            writer.WriteString("messageId", $"{prefix}-m7");
        })), "tail message can be deleted");
        AssertHasSnapshot(dbPath, sessionA, "deleting a post-cursor message keeps the snapshot");

        // Clearing messages removes the snapshot.
        AssertMutationSuccess(DbMessageTools.Clear(Params(dbPath, writer => writer.WriteString("sessionId", sessionA))),
            "messages clear succeeds");
        AssertNoSnapshot(dbPath, sessionA, "clearing messages removes the snapshot");

        // Reset conversation removes the snapshot.
        var sessionB = $"{prefix}-session-b";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionB);
            writer.WriteString("title", "Session B");
        })), "session B is created");
        AddMessage(dbPath, sessionB, $"{prefix}-b1", 2100, 0);
        UpsertSnapshot(dbPath, sessionB);
        var reset = ResultObject(DbSessionTools.ResetConversation(Params(dbPath, writer => writer.WriteString("sessionId", sessionB))));
        Assert(reset.GetProperty("success").GetBoolean(), "reset conversation succeeds");
        AssertNoSnapshot(dbPath, sessionB, "reset conversation removes the snapshot");

        // Deleting the session removes the snapshot.
        var sessionC = $"{prefix}-session-c";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionC);
            writer.WriteString("title", "Session C");
        })), "session C is created");
        AddMessage(dbPath, sessionC, $"{prefix}-c1", 2200, 0);
        UpsertSnapshot(dbPath, sessionC);
        AssertMutationSuccess(DbSessionTools.Delete(Params(dbPath, writer => writer.WriteString("id", sessionC))),
            "session delete succeeds");
        AssertNoSnapshot(dbPath, sessionC, "deleting the session removes the snapshot");

        // Project delete cascade removes the snapshot.
        var projectId = $"{prefix}-project";
        db.Execute(
            "INSERT INTO projects (id, name, created_at, updated_at) VALUES (@id, @name, 1, 1)",
            new SqliteParameter("@id", projectId),
            new SqliteParameter("@name", "Snapshot Project"));
        var sessionE = $"{prefix}-session-e";
        AssertMutationSuccess(DbSessionTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", sessionE);
            writer.WriteString("title", "Session E");
            writer.WriteString("projectId", projectId);
        })), "project session is created");
        AddMessage(dbPath, sessionE, $"{prefix}-e1", 2300, 0);
        UpsertSnapshot(dbPath, sessionE);
        var projectDelete = ResultObject(DbProjectTools.Delete(Params(dbPath, writer => writer.WriteString("id", projectId))));
        Assert(projectDelete.GetProperty("success").GetBoolean(), "project delete succeeds");
        AssertNoSnapshot(dbPath, sessionE, "project cascade delete removes the snapshot");
    }

    // ─── Suite: automatic compression usage recovery ───
}
