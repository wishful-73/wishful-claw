using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

public static partial class DbGoalTools
{
    public static WorkerResponse Reopen(JsonElement parameters)
    {
        try
        {
            var result = ReopenGoal(parameters);
            return WorkerResponse.Json(result, InfrastructureJsonContext.Default.GoalReopenResult);
        }
        catch (Exception ex)
        {
            WorkerLog.Error($"DbGoalTools.Reopen failed: {ex.Message}");
            return WorkerResponse.Error(ex.Message);
        }
    }

    public static GoalReopenResult ReopenGoal(JsonElement parameters)
    {
        DbClient.EnsureInitialized(parameters);
        var db = DbClient.GetClient(parameters);
        var sessionId = GetString(parameters, "sessionId")
            ?? throw new InvalidOperationException("sessionId is required");
        var sourceGoalId = GetString(parameters, "goalId")
            ?? throw new InvalidOperationException("goalId is required");
        var objectiveOverride = GetString(parameters, "objective")?.Trim();
        var reopened = db.ExecuteInTransaction((connection, transaction) =>
        {
            var source = db.QueryFirstOrDefault(
                connection,
                transaction,
                "SELECT * FROM goals WHERE goal_id = @goalId AND session_id = @sessionId LIMIT 1",
                EntityMappers.MapGoal,
                new SqliteParameter("@goalId", sourceGoalId),
                new SqliteParameter("@sessionId", sessionId));
            if (source == null)
                return new GoalReopenResult(false, SourceGoalId: sourceGoalId, Error: "Goal not found");
            if (!GoalStatusValues.IsTerminal(source.Status))
                return new GoalReopenResult(false, SourceGoalId: sourceGoalId, Error: "Only terminal goals can be reopened");

            var current = db.QueryFirstOrDefault(
                connection,
                transaction,
                "SELECT * FROM goals WHERE session_id = @sessionId " +
                "AND status IN ('pending', 'active') LIMIT 1",
                EntityMappers.MapGoal,
                new SqliteParameter("@sessionId", sessionId));
            if (current != null)
                return new GoalReopenResult(false, SourceGoalId: sourceGoalId, Error: "Session already has a current goal");

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var newGoalId = $"goal-{Guid.NewGuid():N}".Substring(0, 21);
            var objective = string.IsNullOrWhiteSpace(objectiveOverride)
                ? source.Objective
                : objectiveOverride;
            var entity = new GoalEntity
            {
                GoalId = newGoalId,
                SessionId = sessionId,
                ProjectId = source.ProjectId,
                Objective = objective,
                Status = GoalStatusValues.Pending,
                TokenBudget = source.TokenBudget,
                WorkingFolder = source.WorkingFolder,
                CurrentPlanIndex = -1,
                CreatedAt = now,
                UpdatedAt = now
            };
            db.Execute(
                connection,
                transaction,
                "INSERT INTO goals (goal_id, session_id, project_id, objective, status, token_budget, tokens_used, " +
                "time_used_seconds, plans_json, plan_count, completed_plan_count, current_plan_index, " +
                "working_folder, created_at, updated_at) " +
                "VALUES (@goalId, @sessionId, @projectId, @objective, @status, @tokenBudget, 0, 0, NULL, 0, 0, -1, " +
                "@workingFolder, @createdAt, @updatedAt)",
                new SqliteParameter("@goalId", newGoalId),
                new SqliteParameter("@sessionId", sessionId),
                new SqliteParameter("@projectId", (object?)source.ProjectId ?? DBNull.Value),
                new SqliteParameter("@objective", objective),
                new SqliteParameter("@status", GoalStatusValues.Pending),
                new SqliteParameter("@tokenBudget", (object?)source.TokenBudget ?? DBNull.Value),
                new SqliteParameter("@workingFolder", (object?)source.WorkingFolder ?? DBNull.Value),
                new SqliteParameter("@createdAt", now),
                new SqliteParameter("@updatedAt", now));

            InsertEvent(
                db,
                connection,
                transaction,
                sessionId,
                sourceGoalId,
                "reopened",
                $"Goal reopened as {newGoalId}",
                BuildReopenMetadata("newGoalId", newGoalId),
                now);
            InsertEvent(
                db,
                connection,
                transaction,
                sessionId,
                newGoalId,
                "reopened_from",
                $"Goal reopened from {sourceGoalId}",
                BuildReopenMetadata("sourceGoalId", sourceGoalId),
                now);
            return new GoalReopenResult(true, GoalRow.FromEntity(entity), sourceGoalId);
        });
        return reopened;
    }

    public static GoalRow? ConfirmByGoalId(
        string goalId,
        string sessionId,
        string? modelConfigJson,
        string eventMessage)
    {
        var db = DbClient.GetClient();
        var entity = db.ExecuteInTransaction((connection, transaction) =>
        {
            var current = db.QueryFirstOrDefault(
                connection,
                transaction,
                "SELECT * FROM goals WHERE goal_id = @goalId AND session_id = @sessionId LIMIT 1",
                EntityMappers.MapGoal,
                new SqliteParameter("@goalId", goalId),
                new SqliteParameter("@sessionId", sessionId));
            if (current == null || !string.Equals(current.Status, GoalStatusValues.Pending, StringComparison.Ordinal))
                return null;

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                connection,
                transaction,
                "UPDATE goals SET status = @status, model_config_json = @modelConfigJson, updated_at = @updatedAt " +
                "WHERE goal_id = @goalId AND session_id = @sessionId AND status = @expectedStatus",
                new SqliteParameter("@status", GoalStatusValues.Active),
                new SqliteParameter("@modelConfigJson", (object?)modelConfigJson ?? DBNull.Value),
                new SqliteParameter("@updatedAt", now),
                new SqliteParameter("@goalId", goalId),
                new SqliteParameter("@sessionId", sessionId),
                new SqliteParameter("@expectedStatus", GoalStatusValues.Pending));
            if (changed != 1)
                return null;

            InsertEvent(db, connection, transaction, sessionId, goalId, "confirmed", eventMessage, null, now);
            current.Status = GoalStatusValues.Active;
            current.ModelConfigJson = modelConfigJson;
            current.UpdatedAt = now;
            return current;
        });

        return entity == null ? null : GoalRow.FromEntity(entity);
    }

    public static GoalRow? SetStatusByGoalId(
        string goalId,
        string sessionId,
        string expectedStatus,
        string status,
        string eventMessage)
    {
        var db = DbClient.GetClient();
        var entity = db.ExecuteInTransaction((connection, transaction) =>
        {
            var current = db.QueryFirstOrDefault(
                connection,
                transaction,
                "SELECT * FROM goals WHERE goal_id = @goalId AND session_id = @sessionId LIMIT 1",
                EntityMappers.MapGoal,
                new SqliteParameter("@goalId", goalId),
                new SqliteParameter("@sessionId", sessionId));
            if (current == null || !string.Equals(current.Status, expectedStatus, StringComparison.Ordinal))
                return null;

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            var changed = db.Execute(
                connection,
                transaction,
                "UPDATE goals SET status = @status, updated_at = @updatedAt " +
                "WHERE goal_id = @goalId AND session_id = @sessionId AND status = @expectedStatus",
                new SqliteParameter("@status", status),
                new SqliteParameter("@updatedAt", now),
                new SqliteParameter("@goalId", goalId),
                new SqliteParameter("@sessionId", sessionId),
                new SqliteParameter("@expectedStatus", expectedStatus));
            if (changed != 1)
                return null;

            InsertEvent(
                db,
                connection,
                transaction,
                sessionId,
                goalId,
                StatusEventType(status),
                eventMessage,
                null,
                now);
            current.Status = status;
            current.UpdatedAt = now;
            return current;
        });

        return entity == null ? null : GoalRow.FromEntity(entity);
    }

    public static int AbortInterruptedPendingGoals()
    {
        var db = DbClient.GetClient();
        return db.ExecuteInTransaction((connection, transaction) =>
        {
            var pending = new List<GoalEntity>();
            using (var command = connection.CreateCommand())
            {
                command.Transaction = transaction;
                command.CommandText = "SELECT * FROM goals WHERE status = 'pending'";
                using var reader = command.ExecuteReader();
                while (reader.Read())
                    pending.Add(EntityMappers.MapGoal(reader));
            }

            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            foreach (var goal in pending)
            {
                db.Execute(
                    connection,
                    transaction,
                    "UPDATE goals SET status = 'aborted', updated_at = @updatedAt " +
                    "WHERE goal_id = @goalId AND session_id = @sessionId AND status = 'pending'",
                    new SqliteParameter("@updatedAt", now),
                    new SqliteParameter("@goalId", goal.GoalId),
                    new SqliteParameter("@sessionId", goal.SessionId));
                InsertEvent(
                    db,
                    connection,
                    transaction,
                    goal.SessionId,
                    goal.GoalId,
                    "aborted",
                    "Pending goal confirmation was interrupted by worker restart",
                    null,
                    now);
            }
            return pending.Count;
        });
    }

    private static string BuildReopenMetadata(string propertyName, string goalId)
        => WorkerJsonHelper.BuildJsonElement(writer =>
        {
            writer.WriteStartObject();
            writer.WriteString(propertyName, goalId);
            writer.WriteEndObject();
        }).GetRawText();

    private static string StatusEventType(string status)
        => status switch
        {
            "active" => "confirmed",
            "complete" => "completed",
            "failed" => "failed",
            "aborted" => "aborted",
            _ => "status_changed"
        };
}
