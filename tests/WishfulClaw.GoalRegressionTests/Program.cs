using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    private static int _passed;

    private static void SeedTestProvider()
    {
        var provider = WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString("id", "test-provider");
            writer.WriteString("name", "Regression Provider");
            writer.WriteString("type", "openai");
            writer.WriteString("baseUrl", "http://127.0.0.1:1");
            writer.WriteEndObject();
        });
        ProviderStore.Save(provider);
    }

    public static int Main()
    {
        var testRoot = Path.Combine(
            Path.GetTempPath(),
            $"wishful-goal-regression-{Guid.NewGuid():N}");
        Directory.CreateDirectory(testRoot);
        var dbPath = Path.Combine(testRoot, "legacy.db");
        Environment.SetEnvironmentVariable("WISHFULCLAW_DATA_DIR", testRoot);
        SeedTestProvider();

        try
        {
            SeedLegacyDatabase(dbPath);
            RunRegressionSuite(dbPath);
            RunLifecycleRegressionSuite(dbPath);
            RunSubAgentConcurrencySuiteAsync().GetAwaiter().GetResult();
            Console.WriteLine($"Goal regression tests passed: {_passed}");
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"Goal regression test failed: {ex}");
            return 1;
        }
        finally
        {
            Environment.SetEnvironmentVariable("WISHFULCLAW_DATA_DIR", null);
            TryDeleteDirectory(testRoot);
        }
    }

    private static void RunRegressionSuite(string dbPath)
    {
        var initialization = DbClient.Initialize(dbPath);
        Assert(initialization.Success, $"legacy migration initializes: {initialization.Error}");
        var db = DbClient.GetClient();

        AssertEqual(4L, db.QueryScalar<long>("SELECT COUNT(*) FROM goals"),
            "migration preserves every legacy goal");
        AssertEqual("project-a", ScalarString(db,
            "SELECT project_id FROM goals WHERE goal_id = 'goal-complete-a'"),
            "migration backfills project_id from session");
        AssertEqual("project-b", ScalarString(db,
            "SELECT project_id FROM goals WHERE goal_id = 'goal-complete-b'"),
            "migration keeps projects isolated");

        AssertEqual(1L, db.QueryScalar<long>(
            "SELECT COUNT(*) FROM goals WHERE session_id = 'session-a' " +
            "AND status IN ('pending','active')"),
            "migration leaves one current goal per session");
        AssertEqual("pending", ScalarString(db,
            "SELECT status FROM goals WHERE goal_id = 'goal-pending-a'"),
            "migration keeps newest current goal");
        AssertEqual("aborted", ScalarString(db,
            "SELECT status FROM goals WHERE goal_id = 'goal-active-a'"),
            "migration archives older current goal");
        AssertEqual(1L, db.QueryScalar<long>(
            "SELECT COUNT(*) FROM goal_events WHERE goal_id = 'goal-active-a' AND event_type = 'aborted'"),
            "migration records archival event");

        AssertThrows<SqliteException>(() => db.Execute(
            "INSERT INTO goals " +
            "(goal_id, session_id, project_id, objective, status, tokens_used, time_used_seconds, " +
            "plan_count, completed_plan_count, current_plan_index, created_at, updated_at) " +
            "VALUES ('goal-conflict', 'session-a', 'project-a', 'conflict', 'active', 0, 0, 0, 0, -1, 400, 400)"),
            "partial unique index rejects a second pending/active goal");

        var current = DbGoalTools.GetBySessionId("session-a");
        AssertEqual("goal-pending-a", current?.GoalId,
            "current query returns the non-terminal goal");
        var aborted = DbGoalTools.SetStatusByGoalId(
            "goal-pending-a",
            "session-a",
            GoalStatusValues.Pending,
            GoalStatusValues.Aborted,
            "Pending goal cancelled by regression test");
        AssertEqual(GoalStatusValues.Aborted, aborted?.Status,
            "pending cancellation persists aborted");
        AssertEqual(1L, db.QueryScalar<long>(
            "SELECT COUNT(*) FROM goal_events WHERE goal_id = 'goal-pending-a' AND event_type = 'aborted'"),
            "pending cancellation preserves an aborted event");

        var created = DbGoalTools.CreateCurrentGoal(GoalParameters(
            dbPath,
            "session-a",
            "goal-new-a",
            "new pending",
            GoalStatusValues.Pending));
        AssertEqual("project-a", created.ProjectId,
            "new goal snapshots its session project");
        AssertEqual(5L, db.QueryScalar<long>("SELECT COUNT(*) FROM goals"),
            "creating a new goal preserves terminal history");
        AssertThrows<InvalidOperationException>(() => DbGoalTools.CreateCurrentGoal(GoalParameters(
            dbPath,
            "session-a",
            "goal-second-current",
            "second current",
            GoalStatusValues.Active)),
            "application guard rejects a second current goal");

        AssertEqual(1, DbGoalTools.AbortInterruptedPendingGoals(),
            "worker restart archives interrupted pending goals");
        AssertEqual(GoalStatusValues.Aborted,
            DbGoalTools.GetByGoalId("goal-new-a", "session-a")?.Status,
            "restart leaves interrupted pending goal in history");

        DbGoalTools.CreateCurrentGoal(GoalParameters(
            dbPath,
            "session-a",
            "goal-terminal-a",
            "terminal history",
            GoalStatusValues.Complete));
        DbGoalTools.CreateCurrentGoal(GoalParameters(
            dbPath,
            "session-a",
            "goal-active-new-a",
            "current active",
            GoalStatusValues.Active));
        AssertEqual(7L, db.QueryScalar<long>("SELECT COUNT(*) FROM goals"),
            "terminal and current goals coexist without replacement");

        Assert(GoalOrchestrator.ResumeFromDb("goal-active-new-a", "session-a").GetAwaiter().GetResult(),
            "active goal restores as idle after restart");
        Assert(GoalOrchestrator.GetContext("goal-active-new-a") != null,
            "restored active goal enters runtime context");
        var abortAction = GoalOrchestrator
            .AbortAsync("goal-active-new-a", SilentRequestContext.Instance)
            .GetAwaiter()
            .GetResult();
        Assert(abortAction.Success && abortAction.Status == GoalStatusValues.Aborted,
            "active idle goal cancels through orchestrator");
        Assert(GoalOrchestrator.GetContext("goal-active-new-a") == null,
            "active idle cancellation removes runtime context");
        AssertEqual(GoalStatusValues.Aborted,
            DbGoalTools.GetByGoalId("goal-active-new-a", "session-a")?.Status,
            "active idle cancellation persists aborted");
        AssertEqual(1L, db.QueryScalar<long>(
            "SELECT COUNT(*) FROM goal_events WHERE goal_id = 'goal-active-new-a' AND event_type = 'aborted'"),
            "active idle cancellation preserves aborted event");

        db.Execute(
            "INSERT INTO goal_events (session_id, goal_id, event_type, message, created_at) " +
            "VALUES ('session-a', 'goal-terminal-a', 'completed', 'terminal event', 500)");
        db.Execute(
            "INSERT INTO goal_events (session_id, goal_id, event_type, message, created_at) " +
            "VALUES ('session-a', 'goal-active-new-a', 'status_changed', 'active event', 501)");

        var projectAGoals = ReadResultArray(DbGoalTools.List(ListParameters(dbPath, "project-a")));
        Assert(projectAGoals.All(item => item.GetProperty("projectId").GetString() == "project-a"),
            "project list returns only the requested project");
        Assert(projectAGoals.Any(item => item.GetProperty("goalId").GetString() == "goal-complete-a"),
            "project list includes terminal history");
        var projectBGoals = ReadResultArray(DbGoalTools.List(ListParameters(dbPath, "project-b")));
        AssertEqual(1, projectBGoals.Count,
            "project list does not leak goals across projects");

        var terminalEvents = ReadResultArray(DbGoalTools.ListEvents(EventParameters(
            dbPath,
            "session-a",
            "goal-terminal-a")));
        Assert(terminalEvents.Count > 0 && terminalEvents.All(item =>
                item.GetProperty("goalId").GetString() == "goal-terminal-a"),
            "event history is isolated by goalId");

        db.Execute("DELETE FROM sessions WHERE id = 'session-a'");
        AssertEqual(6L, db.QueryScalar<long>(
            "SELECT COUNT(*) FROM goals WHERE project_id = 'project-a'"),
            "deleting a session does not delete goal history");
        var afterSessionDelete = ReadResultArray(DbGoalTools.List(ListParameters(dbPath, "project-a")));
        Assert(afterSessionDelete.Any(item =>
                item.GetProperty("goalId").GetString() == "goal-active-new-a"),
            "project history remains queryable after session deletion");

        db.Execute(
            "INSERT INTO sessions (id, project_id, title, mode, created_at, updated_at) " +
            "VALUES ('session-page', 'project-a', 'Paging', 'goal', 700, 700)");
        foreach (var index in Enumerable.Range(1, 5))
        {
            var goalId = $"goal-page-{index}";
            DbGoalTools.CreateCurrentGoal(GoalParameters(
                dbPath,
                "session-page",
                goalId,
                $"page objective {index}",
                GoalStatusValues.Complete));
            db.Execute(
                "UPDATE goals SET created_at = 800, updated_at = 800 WHERE goal_id = @goalId",
                new SqliteParameter("@goalId", goalId));
            db.Execute(
                "INSERT INTO goal_events (session_id, goal_id, event_type, message, created_at) " +
                "VALUES ('session-page', @goalId, 'completed', @message, 900)",
                new SqliteParameter("@goalId", goalId),
                new SqliteParameter("@message", $"page event {index}"));
        }

        var firstGoalPage = DbGoalTools.QueryGoalPage(GoalPageParameters(
            dbPath,
            "session-page",
            limit: 2));
        AssertEqual(2, firstGoalPage.Items.Count, "goal pagination returns requested page size");
        Assert(firstGoalPage.HasMore && firstGoalPage.NextGoalId != null,
            "goal pagination returns a stable cursor");
        var secondGoalPage = DbGoalTools.QueryGoalPage(GoalPageParameters(
            dbPath,
            "session-page",
            limit: 3,
            firstGoalPage));
        var pagedGoalIds = firstGoalPage.Items.Concat(secondGoalPage.Items)
            .Select(item => item.GoalId)
            .ToList();
        AssertEqual(5, pagedGoalIds.Distinct(StringComparer.Ordinal).Count(),
            "goal cursor pagination has no duplicates with equal timestamps");
        Assert(pagedGoalIds.Contains("goal-page-1") && pagedGoalIds.Contains("goal-page-5"),
            "goal cursor pagination has no omissions");

        var firstEventPage = DbGoalTools.QueryGoalEventPage(GoalEventPageParameters(
            dbPath,
            "session-page",
            "goal-page-1",
            limit: 1));
        Assert(firstEventPage.Items.Count == 1 && firstEventPage.HasMore,
            "goal event pagination returns a cursor");
        var secondEventPage = DbGoalTools.QueryGoalEventPage(GoalEventPageParameters(
            dbPath,
            "session-page",
            "goal-page-1",
            limit: 10,
            firstEventPage));
        AssertEqual(
            firstEventPage.Items.Count + secondEventPage.Items.Count,
            firstEventPage.Items.Concat(secondEventPage.Items).Select(item => item.Id).Distinct().Count(),
            "goal event cursor pagination has no duplicates");

        var sourceBefore = DbGoalTools.GetByGoalId("goal-page-1", "session-page")!;
        var reopen = DbGoalTools.ReopenGoal(ReopenParameters(
            dbPath,
            "session-page",
            "goal-page-1",
            "reopened objective"));
        Assert(reopen.Success && reopen.Goal?.Status == GoalStatusValues.Pending,
            "reopen creates a new pending goal");
        Assert(reopen.Goal?.GoalId != sourceBefore.GoalId,
            "reopen preserves source identity and creates a new goalId");
        var sourceAfter = DbGoalTools.GetByGoalId("goal-page-1", "session-page")!;
        AssertEqual(sourceBefore.Status, sourceAfter.Status,
            "reopen does not mutate source status");
        AssertEqual(sourceBefore.UpdatedAt, sourceAfter.UpdatedAt,
            "reopen does not mutate source timestamps");
        AssertEqual(sourceBefore.PlansJson, sourceAfter.PlansJson,
            "reopen does not mutate source plan snapshot");
        AssertEqual(1L, db.QueryScalar<long>(
            "SELECT COUNT(*) FROM goal_events WHERE goal_id = 'goal-page-1' " +
            "AND event_type = 'reopened' AND metadata_json LIKE '%\"newGoalId\"%'"),
            "source goal receives an audit link to the reopened goal");
        AssertEqual(1L, db.QueryScalar<long>(
            "SELECT COUNT(*) FROM goal_events WHERE goal_id = @goalId " +
            "AND event_type = 'reopened_from' AND metadata_json LIKE '%\"sourceGoalId\"%'",
            new SqliteParameter("@goalId", reopen.Goal!.GoalId)),
            "reopened goal receives an audit link to the source goal");
        var blockedReopen = DbGoalTools.ReopenGoal(ReopenParameters(
            dbPath,
            "session-page",
            "goal-page-2"));
        Assert(!blockedReopen.Success && blockedReopen.Error?.Contains("current goal", StringComparison.Ordinal) == true,
            "reopen rejects a second current goal");
    }

}
