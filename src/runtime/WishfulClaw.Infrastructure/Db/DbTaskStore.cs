using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Table access for <c>tasks</c> — the session-scoped agent Todo list (OpenCowork semantics).
///
/// Contract: this class owns every SQL literal that touches <c>tasks</c>. Callers pass/receive
/// <see cref="TaskEntity"/> in its raw storage shape — <c>blocks</c> / <c>blocked_by</c> stay as
/// JSON text here; parsing them into id arrays is the caller's business.
///
/// Both a plain and an in-transaction overload exist on purpose: the dependency graph update
/// (delete a task, then strip its id out of other rows' blocks/blocked_by) must commit or roll
/// back as one unit, so those callers cannot borrow a non-transactional connection.
/// </summary>
public static class DbTaskStore
{
    /// <summary>
    /// Explicit column list instead of <c>SELECT *</c>: <c>EntityMappers.MapTask</c> reads by
    /// ordinal-free name, so an added column would silently keep working — but a renamed or
    /// dropped one would blow up at runtime instead of compile time. Keep this in sync with
    /// <see cref="TaskEntity"/>.
    /// </summary>
    private const string SelectColumns =
        "SELECT id, session_id, plan_id, subject, description, active_form, status, owner, " +
        "blocks, blocked_by, metadata, sort_order, created_at, updated_at FROM tasks";

    /// <summary>All tasks of one session, in todo display order.</summary>
    public static List<TaskEntity> ListBySession(DbService db, string sessionId) =>
        db.Query(
            $"{SelectColumns} WHERE session_id = @sessionId ORDER BY sort_order ASC",
            EntityMappers.MapTask,
            DbService.Param("@sessionId", sessionId));

    /// <summary>In-transaction variant of <see cref="ListBySession(DbService, string)"/>.</summary>
    public static List<TaskEntity> ListBySession(
        DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId) =>
        db.Query(
            conn, tx,
            $"{SelectColumns} WHERE session_id = @sessionId ORDER BY sort_order ASC",
            EntityMappers.MapTask,
            DbService.Param("@sessionId", sessionId));

    /// <summary>
    /// One task, scoped to its session — a task id alone is not a key we trust from the model,
    /// so the session filter is part of the lookup, not an optional extra.
    /// </summary>
    public static TaskEntity? GetById(DbService db, string taskId, string? sessionId)
    {
        if (string.IsNullOrEmpty(sessionId)) return null;
        return db.QueryFirstOrDefault(
            $"{SelectColumns} WHERE id = @id AND session_id = @sessionId LIMIT 1",
            EntityMappers.MapTask,
            DbService.Param("@id", taskId),
            DbService.Param("@sessionId", sessionId));
    }

    /// <summary>In-transaction variant of <see cref="GetById(DbService, string, string?)"/>.</summary>
    public static TaskEntity? GetById(
        DbService db, SqliteConnection conn, SqliteTransaction tx, string taskId, string? sessionId)
    {
        if (string.IsNullOrEmpty(sessionId)) return null;
        return db.QueryFirstOrDefault(
            conn, tx,
            $"{SelectColumns} WHERE id = @id AND session_id = @sessionId LIMIT 1",
            EntityMappers.MapTask,
            DbService.Param("@id", taskId),
            DbService.Param("@sessionId", sessionId));
    }

    /// <summary>Insert a fully populated row (all 14 columns).</summary>
    public static void Insert(DbService db, SqliteConnection conn, SqliteTransaction tx, TaskEntity task) =>
        db.Execute(conn, tx,
            "INSERT INTO tasks (id, session_id, plan_id, subject, description, active_form, status, owner, " +
            "blocks, blocked_by, metadata, sort_order, created_at, updated_at) VALUES " +
            "(@id, @sessionId, @planId, @subject, @description, @activeForm, @status, @owner, " +
            "@blocks, @blockedBy, @metadata, @sortOrder, @createdAt, @updatedAt)",
            DbService.Param("@id", task.Id),
            DbService.Param("@sessionId", task.SessionId),
            DbService.Param("@planId", task.PlanId),
            DbService.Param("@subject", task.Subject),
            DbService.Param("@description", task.Description),
            DbService.Param("@activeForm", task.ActiveForm),
            DbService.Param("@status", task.Status),
            DbService.Param("@owner", task.Owner),
            DbService.Param("@blocks", task.Blocks),
            DbService.Param("@blockedBy", task.BlockedBy),
            DbService.Param("@metadata", task.Metadata),
            DbService.Param("@sortOrder", task.SortOrder),
            DbService.Param("@createdAt", task.CreatedAt),
            DbService.Param("@updatedAt", task.UpdatedAt));

    /// <summary>
    /// Update the mutable half of a row: content, status, owner, dependency ids, metadata.
    ///
    /// Deliberately does NOT touch <c>session_id</c>, <c>plan_id</c>, <c>sort_order</c> or
    /// <c>created_at</c> — a task never migrates between sessions or plans, and rewriting its
    /// sort position or birth timestamp on every status flip would corrupt the todo ordering
    /// that the model depends on. Do not "unify" this with a full-row update.
    /// </summary>
    public static void UpdateRow(DbService db, SqliteConnection conn, SqliteTransaction tx, TaskEntity task) =>
        db.Execute(conn, tx,
            "UPDATE tasks SET subject = @subject, description = @description, active_form = @activeForm, " +
            "status = @status, owner = @owner, blocks = @blocks, blocked_by = @blockedBy, " +
            "metadata = @metadata, updated_at = @updatedAt WHERE id = @id",
            DbService.Param("@subject", task.Subject),
            DbService.Param("@description", task.Description),
            DbService.Param("@activeForm", task.ActiveForm),
            DbService.Param("@status", task.Status),
            DbService.Param("@owner", task.Owner),
            DbService.Param("@blocks", task.Blocks),
            DbService.Param("@blockedBy", task.BlockedBy),
            DbService.Param("@metadata", task.Metadata),
            DbService.Param("@updatedAt", task.UpdatedAt),
            DbService.Param("@id", task.Id));

    /// <summary>
    /// Delete one row. Reference cleanup in the surviving rows' <c>blocks</c> / <c>blocked_by</c>
    /// is the caller's job — it needs the parsed id arrays, which this layer does not handle.
    /// </summary>
    public static void DeleteById(
        DbService db, SqliteConnection conn, SqliteTransaction tx, string taskId) =>
        db.Execute(conn, tx, "DELETE FROM tasks WHERE id = @id", DbService.Param("@id", taskId));

    /// <summary>How many tasks a session holds (quota checks).</summary>
    public static int CountBySession(
        DbService db, SqliteConnection conn, SqliteTransaction tx, string sessionId) =>
        db.QueryScalar<int>(
            conn, tx,
            "SELECT COUNT(*) FROM tasks WHERE session_id = @sessionId",
            DbService.Param("@sessionId", sessionId));
}
