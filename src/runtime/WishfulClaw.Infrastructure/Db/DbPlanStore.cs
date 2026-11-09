using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Table access for <c>plans</c> — the per-session plan document (drafting → awaiting_review).
///
/// Contract: this class owns every SQL literal that touches <c>plans</c>. Only the plan store
/// uses <see cref="PlanEntity"/>, so no in-transaction overload is offered — plan writes are
/// single statements with no combinatorial invariant to protect.
/// </summary>
public static class DbPlanStore
{
    /// <summary>
    /// Explicit column list rather than <c>SELECT *</c>: <c>EntityMappers.MapPlan</c> reads by
    /// name, so a future column addition must not be able to change what this query returns.
    /// </summary>
    private const string SelectColumns =
        "SELECT id, session_id, title, status, file_path, content, spec_json, created_at, updated_at FROM plans";

    /// <summary>
    /// The session's most recently updated plan. "Latest" is <c>updated_at DESC</c>, not
    /// <c>created_at</c>: a plan that is still being revised must win over a newer abandoned one.
    /// </summary>
    public static PlanEntity? GetLatestBySession(DbService db, string sessionId) =>
        db.QueryFirstOrDefault(
            $"{SelectColumns} WHERE session_id = @sid ORDER BY updated_at DESC LIMIT 1",
            EntityMappers.MapPlan,
            DbService.Param("@sid", sessionId));

    public static PlanEntity? GetById(DbService db, string planId) =>
        db.QueryFirstOrDefault(
            $"{SelectColumns} WHERE id = @id",
            EntityMappers.MapPlan,
            DbService.Param("@id", planId));

    /// <summary>Insert a fully populated row. Nullable text columns are stored as NULL, not "".</summary>
    public static int Insert(DbService db, PlanEntity plan) =>
        db.Execute(
            "INSERT INTO plans (id, session_id, title, status, file_path, content, spec_json, created_at, updated_at) " +
            "VALUES (@id, @sid, @title, @status, @fp, @content, @spec, @ca, @ua)",
            DbService.Param("@id", plan.Id),
            DbService.Param("@sid", plan.SessionId),
            DbService.Param("@title", plan.Title),
            DbService.Param("@status", plan.Status),
            DbService.Param("@fp", (object?)plan.FilePath ?? DBNull.Value),
            DbService.Param("@content", (object?)plan.Content ?? DBNull.Value),
            DbService.Param("@spec", (object?)plan.SpecJson ?? DBNull.Value),
            DbService.Param("@ca", plan.CreatedAt),
            DbService.Param("@ua", plan.UpdatedAt));

    /// <summary>
    /// Rewrite only title + status + updated_at. The plan body (<c>content</c>) is written once at
    /// creation and never re-sent on a status transition, so it must stay out of this statement —
    /// a full-row update here would clobber the stored body with whatever the caller happens to hold.
    /// </summary>
    public static int UpdateStatus(
        DbService db, string planId, string title, string status, long updatedAt) =>
        db.Execute(
            "UPDATE plans SET title = @title, status = @status, updated_at = @ua WHERE id = @id",
            DbService.Param("@title", title),
            DbService.Param("@status", status),
            DbService.Param("@ua", updatedAt),
            DbService.Param("@id", planId));

    public static int DeleteById(DbService db, string planId) =>
        db.Execute("DELETE FROM plans WHERE id = @id", DbService.Param("@id", planId));
}
