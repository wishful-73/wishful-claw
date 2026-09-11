using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.SessionTaskCascadeRegressionTests;

internal static partial class Program
{
    private static void RunSessionFollowUpSuite(string dbPath, DbService db)
    {
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'session_follow_ups'"),
            "session follow-up table exists");
        foreach (var indexName in new[]
                 {
                     "ux_session_follow_ups_notification",
                     "ix_session_follow_ups_source",
                     "ix_session_follow_ups_schedule",
                     "ix_session_follow_ups_todo"
                 })
        {
            AssertEqual(1L, db.QueryScalar<long>(
                    "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = @name",
                    new SqliteParameter("@name", indexName)),
                $"session follow-up index {indexName} exists");
        }

        CreateSession(dbPath, "follow-src", "Follow-up Source", null);
        CreateSession(dbPath, "follow-target", "Follow-up Target", null);
        SeedTask(dbPath, "follow-src", "follow-todo");
        var globalTaskCount = db.QueryScalar<long>("SELECT COUNT(*) FROM global_tasks");
        var globalDispatchCount = db.QueryScalar<long>("SELECT COUNT(*) FROM global_task_dispatches");
        const long dueAt = 1_900_000_000_000;

        var created = DbSessionFollowUpTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-1");
            writer.WriteString("todoId", "follow-todo");
            writer.WriteString("sourceSessionId", "follow-src");
            writer.WriteString("targetSessionId", "follow-target");
            writer.WriteNumber("followUpAt", dueAt);
            writer.WriteString("queryInstruction", "Check the target result");
            writer.WriteString("notificationKey", "follow-notification-1");
        }));
        ExpectNoError(created, "follow-up create succeeds");
        AssertEqual("waiting", MutationFollowUp(created).GetProperty("status").GetString(),
            "new follow-up waits for its countdown");

        var duplicate = DbSessionFollowUpTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-duplicate-id");
            writer.WriteString("todoId", "follow-todo");
            writer.WriteString("sourceSessionId", "follow-src");
            writer.WriteString("targetSessionId", "follow-target");
            writer.WriteNumber("followUpAt", dueAt);
            writer.WriteString("queryInstruction", "Must not duplicate");
            writer.WriteString("notificationKey", "follow-notification-1");
        }));
        ExpectNoError(duplicate, "duplicate notification key returns the existing follow-up");
        AssertEqual("follow-1", MutationFollowUp(duplicate).GetProperty("id").GetString(),
            "duplicate create is idempotent");
        AssertEqual(1L, FollowUpCount(db, "follow-src"), "duplicate create keeps one row");

        SeedTask(dbPath, "follow-src", "follow-conflict-todo");
        var conflictingDuplicate = DbSessionFollowUpTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-conflicting-id");
            writer.WriteString("todoId", "follow-conflict-todo");
            writer.WriteString("sourceSessionId", "follow-src");
            writer.WriteString("targetSessionId", "follow-target");
            writer.WriteNumber("followUpAt", dueAt);
            writer.WriteString("queryInstruction", "Must reject mismatched ownership");
            writer.WriteString("notificationKey", "follow-notification-1");
        }));
        ExpectFailure(conflictingDuplicate, "different follow-up",
            "notification key cannot be reused for another Todo");

        var earlyClaim = DbSessionFollowUpTools.Claim(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-1");
            writer.WriteString("claimToken", "claim-early");
            writer.WriteNumber("now", dueAt - 1);
        }));
        ExpectFailure(earlyClaim, "not due", "follow-up cannot be claimed early");

        var claim = DbSessionFollowUpTools.Claim(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-1");
            writer.WriteString("claimToken", "claim-1");
            writer.WriteNumber("now", dueAt);
        }));
        ExpectNoError(claim, "due follow-up can be claimed");
        AssertEqual("triggered", MutationFollowUp(claim).GetProperty("status").GetString(),
            "claim transitions to triggered");

        var duplicateClaim = DbSessionFollowUpTools.Claim(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-1");
            writer.WriteString("claimToken", "claim-2");
            writer.WriteNumber("now", dueAt);
        }));
        ExpectFailure(duplicateClaim, "already claimed", "follow-up claim is single-flight");

        var wrongComplete = DbSessionFollowUpTools.Complete(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-1");
            writer.WriteString("claimToken", "wrong-token");
        }));
        ExpectFailure(wrongComplete, "no longer owns", "stale claimant cannot complete follow-up");

        var rescheduled = DbSessionFollowUpTools.Reschedule(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-1");
            writer.WriteString("claimToken", "claim-1");
            writer.WriteNumber("followUpAt", dueAt + 60_000);
            writer.WriteString("lastQueryResult", "Target is still running");
        }));
        ExpectNoError(rescheduled, "claimed follow-up can be rescheduled");
        AssertEqual("waiting", MutationFollowUp(rescheduled).GetProperty("status").GetString(),
            "reschedule returns to waiting");

        var secondClaim = DbSessionFollowUpTools.Claim(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-1");
            writer.WriteString("claimToken", "claim-3");
            writer.WriteNumber("now", dueAt + 60_000);
        }));
        ExpectNoError(secondClaim, "rescheduled follow-up can be claimed later");
        var completed = DbSessionFollowUpTools.Complete(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-1");
            writer.WriteString("claimToken", "claim-3");
            writer.WriteString("lastQueryResult", "Target completed");
        }));
        ExpectNoError(completed, "claim owner can complete follow-up");
        AssertEqual("completed", MutationFollowUp(completed).GetProperty("status").GetString(),
            "complete records terminal status");
        AssertEqual("completed", TaskStatus(db, "follow-todo"),
            "complete updates the source Todo in the same transaction");

        SeedTask(dbPath, "follow-src", "follow-send-fail-todo");
        ExpectNoError(DbSessionFollowUpTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-send-fail");
            writer.WriteString("todoId", "follow-send-fail-todo");
            writer.WriteString("sourceSessionId", "follow-src");
            writer.WriteString("targetSessionId", "follow-target");
            writer.WriteNumber("followUpAt", dueAt + 90_000);
            writer.WriteString("queryInstruction", "Check after dispatch");
            writer.WriteString("notificationKey", "follow-send-fail-notification");
        })), "send-failure follow-up created");
        var sendFailed = DbSessionFollowUpTools.Fail(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-send-fail");
            writer.WriteString("sourceSessionId", "follow-src");
            writer.WriteString("lastError", "Message dispatch failed");
        }));
        ExpectNoError(sendFailed, "pre-dispatch failure compensates the follow-up");
        AssertEqual("failed", FollowUpStatus(db, "follow-send-fail"),
            "pre-dispatch failure is terminal");
        AssertEqual("blocked", TaskStatus(db, "follow-send-fail-todo"),
            "pre-dispatch failure blocks the source Todo atomically");

        CreateFollowUp(dbPath, "follow-2", "follow-notification-2", dueAt + 120_000);
        var cancelled = DbSessionFollowUpTools.Cancel(Params(dbPath, writer =>
        {
            writer.WriteString("todoId", "follow-todo");
            writer.WriteString("sourceSessionId", "follow-src");
        }));
        ExpectNoError(cancelled, "Todo cancellation cancels outstanding follow-ups");
        AssertEqual("cancelled", FollowUpStatus(db, "follow-2"), "cancelled follow-up is terminal");

        CreateFollowUp(dbPath, "follow-3", "follow-notification-3", dueAt + 180_000);
        ExpectNoError(DbSessionFollowUpTools.Claim(Params(dbPath, writer =>
        {
            writer.WriteString("id", "follow-3");
            writer.WriteString("claimToken", "interrupted-claim");
            writer.WriteNumber("now", dueAt + 180_000);
        })), "interrupted follow-up is claimed");
        var restored = DbSessionFollowUpTools.ListSchedulable(Params(dbPath, writer =>
            writer.WriteNumber("now", dueAt + 180_000 + 5 * 60 * 1000)));
        ExpectNoError(restored, "stale triggered follow-up is recovered on restore");
        AssertEqual("waiting", FollowUpStatus(db, "follow-3"), "restore releases stale claim");

        var deletedTodo = DbTaskTools.Delete(Params(dbPath, writer =>
            writer.WriteString("id", "follow-todo")));
        ExpectNoError(deletedTodo, "deleting a Todo succeeds");
        AssertEqual("cancelled", FollowUpStatus(db, "follow-3"),
            "deleting a Todo cancels its outstanding follow-ups atomically");

        AssertEqual(globalTaskCount, db.QueryScalar<long>("SELECT COUNT(*) FROM global_tasks"),
            "session follow-ups never create global tasks");
        AssertEqual(globalDispatchCount, db.QueryScalar<long>("SELECT COUNT(*) FROM global_task_dispatches"),
            "session follow-ups never create global dispatches");
    }

    private static void CreateFollowUp(string dbPath, string id, string notificationKey, long followUpAt)
    {
        ExpectNoError(DbSessionFollowUpTools.Create(Params(dbPath, writer =>
        {
            writer.WriteString("id", id);
            writer.WriteString("todoId", "follow-todo");
            writer.WriteString("sourceSessionId", "follow-src");
            writer.WriteString("targetSessionId", "follow-target");
            writer.WriteNumber("followUpAt", followUpAt);
            writer.WriteString("queryInstruction", "Check again");
            writer.WriteString("notificationKey", notificationKey);
        })), $"follow-up {id} created");
    }

    private static JsonElement MutationFollowUp(WorkerResponse response)
    {
        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        return document.RootElement.GetProperty("result").GetProperty("followUp").Clone();
    }

    private static long FollowUpCount(DbService db, string sourceSessionId)
        => db.QueryScalar<long>(
            "SELECT COUNT(*) FROM session_follow_ups WHERE source_session_id = @sourceSessionId",
            new SqliteParameter("@sourceSessionId", sourceSessionId));

    private static string FollowUpStatus(DbService db, string id)
        => db.QueryScalar<string>(
            "SELECT status FROM session_follow_ups WHERE id = @id",
            new SqliteParameter("@id", id));

    private static string TaskStatus(DbService db, string id)
        => db.QueryScalar<string>(
            "SELECT status FROM tasks WHERE id = @id",
            new SqliteParameter("@id", id));
}
