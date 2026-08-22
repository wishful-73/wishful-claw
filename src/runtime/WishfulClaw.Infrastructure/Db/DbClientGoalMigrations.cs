using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

public static partial class DbClient
{
    private static void EnsureGoalHistorySchema()
    {
        _db!.ExecuteInTransaction((connection, transaction) =>
        {
            _db.Execute(
                connection,
                transaction,
                "DROP INDEX IF EXISTS ux_goals_session_id");
            _db.Execute(
                connection,
                transaction,
                "UPDATE goals SET project_id = (" +
                "SELECT sessions.project_id FROM sessions WHERE sessions.id = goals.session_id) " +
                "WHERE project_id IS NULL AND EXISTS (" +
                "SELECT 1 FROM sessions WHERE sessions.id = goals.session_id)");

            ArchiveConflictingCurrentGoals(connection, transaction);

            _db.Execute(
                connection,
                transaction,
                "CREATE UNIQUE INDEX IF NOT EXISTS ux_goals_session_current " +
                "ON goals(session_id) WHERE status IN ('pending', 'active')");
            _db.Execute(
                connection,
                transaction,
                "CREATE INDEX IF NOT EXISTS ix_goals_project_updated_goal " +
                "ON goals(project_id, updated_at DESC, goal_id DESC)");
            _db.Execute(
                connection,
                transaction,
                "CREATE INDEX IF NOT EXISTS ix_goals_session_updated_goal " +
                "ON goals(session_id, updated_at DESC, goal_id DESC)");
            _db.Execute(
                connection,
                transaction,
                "CREATE INDEX IF NOT EXISTS ix_goal_events_goal_created_id " +
                "ON goal_events(goal_id, created_at DESC, id DESC)");
            _db.Execute(
                connection,
                transaction,
                "CREATE INDEX IF NOT EXISTS ix_goal_plans_goal_updated " +
                "ON goal_plans(goal_id, updated_at DESC, ordinal DESC)");
            _db.Execute(
                connection,
                transaction,
                "CREATE INDEX IF NOT EXISTS ix_goal_execution_runs_goal_started " +
                "ON goal_execution_runs(goal_id, started_at DESC, attempt_no DESC)");
        });
    }

    private static void ArchiveConflictingCurrentGoals(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        var conflicts = new List<GoalMigrationConflict>();
        using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText =
                "SELECT goal_id, session_id FROM goals AS candidate " +
                "WHERE candidate.status IN ('pending', 'active') AND EXISTS (" +
                "SELECT 1 FROM goals AS newer " +
                "WHERE newer.session_id = candidate.session_id " +
                "AND newer.status IN ('pending', 'active') " +
                "AND (newer.updated_at > candidate.updated_at " +
                "OR (newer.updated_at = candidate.updated_at AND newer.created_at > candidate.created_at) " +
                "OR (newer.updated_at = candidate.updated_at AND newer.created_at = candidate.created_at " +
                "AND newer.rowid > candidate.rowid)))";
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                conflicts.Add(new GoalMigrationConflict(
                    reader.GetString(0),
                    reader.GetString(1)));
            }
        }

        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var conflict in conflicts)
        {
            _db!.Execute(
                connection,
                transaction,
                "UPDATE goals SET status = 'aborted', updated_at = @updatedAt " +
                "WHERE goal_id = @goalId AND session_id = @sessionId " +
                "AND status IN ('pending', 'active')",
                new SqliteParameter("@updatedAt", now),
                new SqliteParameter("@goalId", conflict.GoalId),
                new SqliteParameter("@sessionId", conflict.SessionId));
            _db.Execute(
                connection,
                transaction,
                "INSERT INTO goal_events " +
                "(session_id, goal_id, event_type, message, metadata_json, created_at) " +
                "VALUES (@sessionId, @goalId, 'aborted', " +
                "'Goal archived during history migration because a newer current goal exists', NULL, @createdAt)",
                new SqliteParameter("@sessionId", conflict.SessionId),
                new SqliteParameter("@goalId", conflict.GoalId),
                new SqliteParameter("@createdAt", now));
        }
    }

    private sealed record GoalMigrationConflict(string GoalId, string SessionId);

    /// <summary>
    /// Sweep stale goal state left behind by a previous process: at DB init time
    /// no goal runtime exists yet, so any goal still marked active (and its
    /// executing plans / round tasks) was interrupted by an app shutdown.
    /// The goal itself stays active (resumable, still visible in the UI); its
    /// plans and tasks are marked interrupted so the panel no longer shows
    /// fake "executing" entries with a running timer.
    /// </summary>
    public static void SweepInterruptedGoals()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        var affected = _db!.Query(
            "SELECT goal_id, plans_json FROM goals WHERE status = 'active' AND plans_json IS NOT NULL",
            reader => new GoalPlansJsonMigrationRow(
                reader.GetString("goal_id"),
                reader.GetString("plans_json")));

        foreach (var row in affected)
        {
            try
            {
                if (JsonNodeUtility.RewriteExecutingPlans(row.PlansJson) is { } rewritten)
                {
                    _db.Execute(
                        "UPDATE goals SET plans_json = @plans WHERE goal_id = @goalId",
                        new SqliteParameter("@plans", rewritten),
                        new SqliteParameter("@goalId", row.GoalId));
                }
            }
            catch (JsonException)
            {
                // Leave malformed plans_json untouched; round tasks are still swept below.
            }
        }

        _db.Execute(
            "UPDATE goal_plan_tasks SET status = 'interrupted', finished_at = @now WHERE status = 'executing'",
            new SqliteParameter("@now", now));

        // Sweep goal_plans: any plan still 'active' was interrupted by the shutdown.
        _db.Execute(
            "UPDATE goal_plans SET status = 'interrupted', updated_at = @now WHERE status = 'active' AND started_at IS NOT NULL",
            new SqliteParameter("@now", now));

        // Sweep goal_tasks: same logic — interrupted, resumable on the next run.
        _db.Execute(
            "UPDATE goal_tasks SET status = 'interrupted', updated_at = @now WHERE status = 'active' AND started_at IS NOT NULL",
            new SqliteParameter("@now", now));

        // Sweep goal_execution_runs: mark executing attempts as interrupted.
        _db.Execute(
            "UPDATE goal_execution_runs SET status = 'interrupted', finished_at = @now WHERE status = 'executing'",
            new SqliteParameter("@now", now));
    }

    private static class JsonNodeUtility
    {
        /// <summary>Rewrite plans with status=executing to interrupted. Returns null when nothing changed.</summary>
        public static string? RewriteExecutingPlans(string plansJson)
        {
            JsonNode? root;
            try { root = JsonNode.Parse(plansJson); }
            catch (JsonException) { return null; }
            if (root is not JsonArray arr) return null;

            var changed = false;
            foreach (var node in arr)
            {
                if (node is not JsonObject obj) continue;
                if (obj["status"]?.GetValue<string>() == "executing")
                {
                    obj["status"] = "interrupted";
                    changed = true;
                }
            }
            return changed ? arr.ToJsonString() : null;
        }
    }
}
