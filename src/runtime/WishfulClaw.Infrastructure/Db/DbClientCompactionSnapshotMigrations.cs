using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

public static partial class DbClient
{
    private const string LegacyCompactionSnapshotTable = "session_compaction_snapshots_legacy_v1";

    private static readonly string[] SnapshotColumns =
    [
        "snapshot_id",
        "session_id",
        "version",
        "trigger",
        "wire_conversation",
        "compact_artifacts",
        "summary_message",
        "summary_text",
        "through_created_at",
        "through_sort_order",
        "original_count",
        "new_count",
        "messages_summarized",
        "summarizer_failed",
        "created_at",
        "updated_at"
    ];

    private sealed record CompactionSnapshotColumn(string Name, int PrimaryKey);

    private static void EnsureCompactionSnapshotSchema()
    {
        if (_db is null) return;

        _db.ExecuteInTransaction((connection, transaction) =>
        {
            EnsureSessionContextColumns(connection, transaction);

            var table = GetTableColumns(connection, transaction, "session_compaction_snapshots");
            if (table.Count == 0)
            {
                throw new InvalidOperationException(
                    "Missing session_compaction_snapshots table after base schema creation.");
            }

            var hasSnapshotIdPrimaryKey = table.Any(column =>
                string.Equals(column.Name, "snapshot_id", StringComparison.OrdinalIgnoreCase) &&
                column.PrimaryKey == 1);
            var hasSessionId = table.Any(column =>
                string.Equals(column.Name, "session_id", StringComparison.OrdinalIgnoreCase));

            if (hasSnapshotIdPrimaryKey && hasSessionId)
            {
                EnsureColumns(table, SnapshotColumns, "session_compaction_snapshots");
                if (GetTableColumns(connection, transaction, LegacyCompactionSnapshotTable).Count > 0)
                {
                    throw new InvalidOperationException(
                        $"Unexpected leftover migration table: {LegacyCompactionSnapshotTable}.");
                }
                CreateCompactionSnapshotIndexes(connection, transaction);
                return;
            }

            if (!hasSessionId)
            {
                throw new InvalidOperationException(
                    "Unsupported session_compaction_snapshots schema: missing session_id.");
            }

            ValidateLegacySnapshotSchema(table);
            MigrateLegacyCompactionSnapshots(connection, transaction);
        });
    }

    private static void EnsureSessionContextColumns(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        var columns = GetTableColumns(connection, transaction, "sessions");
        if (!columns.Any(column => string.Equals(column.Name, "current_snapshot_id", StringComparison.OrdinalIgnoreCase)))
        {
            _db!.Execute(connection, transaction,
                "ALTER TABLE sessions ADD COLUMN current_snapshot_id TEXT;");
        }

        if (!columns.Any(column => string.Equals(column.Name, "context_revision", StringComparison.OrdinalIgnoreCase)))
        {
            _db!.Execute(connection, transaction,
                "ALTER TABLE sessions ADD COLUMN context_revision INTEGER NOT NULL DEFAULT 0;");
        }
    }

    private static List<CompactionSnapshotColumn> GetTableColumns(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string tableName)
    {
        return _db!.Query(
            connection,
            transaction,
            $"PRAGMA table_info({tableName});",
            reader => new CompactionSnapshotColumn(
                reader.GetString("name"),
                reader.GetInt32("pk")));
    }

    private static void EnsureColumns(
        IReadOnlyCollection<CompactionSnapshotColumn> table,
        IEnumerable<string> requiredColumns,
        string tableName)
    {
        var present = table.Select(column => column.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var missing = requiredColumns.Where(column => !present.Contains(column)).ToArray();
        if (missing.Length > 0)
        {
            throw new InvalidOperationException(
                $"Unsupported {tableName} schema: missing columns {string.Join(", ", missing)}.");
        }
    }

    private static void ValidateLegacySnapshotSchema(IReadOnlyCollection<CompactionSnapshotColumn> table)
    {
        EnsureColumns(table, SnapshotColumns.Skip(1), "session_compaction_snapshots");
        if (table.Any(column => string.Equals(column.Name, "snapshot_id", StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException(
                "Unsupported session_compaction_snapshots schema: snapshot_id exists but is not the primary key.");
        }
    }

    private static void MigrateLegacyCompactionSnapshots(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        _db!.Execute(
            connection,
            transaction,
            $"DROP INDEX IF EXISTS idx_session_compaction_updated;");
        _db.Execute(
            connection,
            transaction,
            $"DROP INDEX IF EXISTS idx_session_compaction_session_created;");
        _db.Execute(
            connection,
            transaction,
            $"ALTER TABLE session_compaction_snapshots RENAME TO {LegacyCompactionSnapshotTable};");

        _db.Execute(
            connection,
            transaction,
            @"CREATE TABLE session_compaction_snapshots (
                snapshot_id TEXT PRIMARY KEY NOT NULL,
                session_id TEXT NOT NULL,
                version INTEGER NOT NULL,
                ""trigger"" TEXT NOT NULL,
                wire_conversation TEXT NOT NULL,
                compact_artifacts TEXT NOT NULL,
                summary_message TEXT,
                summary_text TEXT,
                through_created_at INTEGER NOT NULL,
                through_sort_order INTEGER NOT NULL,
                original_count INTEGER NOT NULL,
                new_count INTEGER NOT NULL,
                messages_summarized INTEGER NOT NULL,
                summarizer_failed INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );");

        _db.Execute(
            connection,
            transaction,
            $@"INSERT OR IGNORE INTO session_compaction_snapshots (
                    snapshot_id, session_id, version, ""trigger"", wire_conversation,
                    compact_artifacts, summary_message, summary_text, through_created_at,
                    through_sort_order, original_count, new_count, messages_summarized,
                    summarizer_failed, created_at, updated_at)
                SELECT 'legacy-' || session_id || '-v1', session_id, version, ""trigger"",
                    wire_conversation, compact_artifacts, summary_message, summary_text,
                    through_created_at, through_sort_order, original_count, new_count,
                    messages_summarized, summarizer_failed, created_at, updated_at
                FROM {LegacyCompactionSnapshotTable}
                ORDER BY updated_at DESC, rowid DESC;");

        var sourceCount = _db.QueryScalar<int>(
            connection,
            transaction,
            $"SELECT COUNT(*) FROM {LegacyCompactionSnapshotTable};");
        var distinctSessionCount = _db.QueryScalar<int>(
            connection,
            transaction,
            $"SELECT COUNT(DISTINCT session_id) FROM {LegacyCompactionSnapshotTable};");
        var targetCount = _db.QueryScalar<int>(
            connection,
            transaction,
            "SELECT COUNT(*) FROM session_compaction_snapshots;");
        if (sourceCount != distinctSessionCount)
        {
            WorkerLog.Warn(
                $"DbClient: compaction snapshot migration collapsed duplicate sessions " +
                $"sourceRows={sourceCount} selectedRows={distinctSessionCount}; " +
                "selected updated_at DESC, rowid DESC");
        }
        if (distinctSessionCount != targetCount)
        {
            throw new InvalidOperationException(
                $"Compaction snapshot migration count mismatch: selected={distinctSessionCount} target={targetCount}.");
        }

        var invalidRows = _db.QueryScalar<int>(
            connection,
            transaction,
            "SELECT COUNT(*) FROM session_compaction_snapshots " +
            "WHERE snapshot_id IS NULL OR session_id IS NULL OR wire_conversation IS NULL " +
            "OR compact_artifacts IS NULL OR through_created_at IS NULL " +
            "OR through_sort_order IS NULL OR original_count IS NULL OR new_count IS NULL " +
            "OR messages_summarized IS NULL OR created_at IS NULL OR updated_at IS NULL;");
        if (invalidRows != 0)
        {
            throw new InvalidOperationException(
                $"Compaction snapshot migration found invalid rows: {invalidRows}.");
        }

        var mismatchedRows = _db.QueryScalar<int>(
            connection,
            transaction,
            $@"WITH ranked AS (
                    SELECT *, ROW_NUMBER() OVER (
                        PARTITION BY session_id
                        ORDER BY updated_at DESC, rowid DESC) AS rn
                    FROM {LegacyCompactionSnapshotTable})
                SELECT COUNT(*)
                FROM ranked legacy
                LEFT JOIN session_compaction_snapshots snapshot
                  ON snapshot.snapshot_id = 'legacy-' || legacy.session_id || '-v1'
                WHERE legacy.rn = 1
                  AND (snapshot.snapshot_id IS NULL
                    OR snapshot.session_id IS NOT legacy.session_id
                    OR snapshot.version IS NOT legacy.version
                    OR snapshot.""trigger"" IS NOT legacy.""trigger""
                    OR snapshot.wire_conversation IS NOT legacy.wire_conversation
                    OR snapshot.compact_artifacts IS NOT legacy.compact_artifacts
                    OR snapshot.summary_message IS NOT legacy.summary_message
                    OR snapshot.summary_text IS NOT legacy.summary_text
                    OR snapshot.through_created_at IS NOT legacy.through_created_at
                    OR snapshot.through_sort_order IS NOT legacy.through_sort_order
                    OR snapshot.original_count IS NOT legacy.original_count
                    OR snapshot.new_count IS NOT legacy.new_count
                    OR snapshot.messages_summarized IS NOT legacy.messages_summarized
                    OR snapshot.summarizer_failed IS NOT legacy.summarizer_failed
                    OR snapshot.created_at IS NOT legacy.created_at
                    OR snapshot.updated_at IS NOT legacy.updated_at);");
        if (mismatchedRows != 0)
        {
            throw new InvalidOperationException(
                $"Compaction snapshot migration field validation failed: rows={mismatchedRows}.");
        }

        _db.Execute(
            connection,
            transaction,
            @"UPDATE sessions
                SET current_snapshot_id = (
                    SELECT snapshot_id
                    FROM session_compaction_snapshots snapshot
                    WHERE snapshot.session_id = sessions.id
                    ORDER BY snapshot.updated_at DESC, snapshot.created_at DESC
                    LIMIT 1)
                WHERE current_snapshot_id IS NULL
                  AND EXISTS (
                    SELECT 1
                    FROM session_compaction_snapshots snapshot
                    WHERE snapshot.session_id = sessions.id); ");

        _db.Execute(
            connection,
            transaction,
            $"DROP TABLE {LegacyCompactionSnapshotTable};");
        CreateCompactionSnapshotIndexes(connection, transaction);
    }

    private static void CreateCompactionSnapshotIndexes(
        SqliteConnection connection,
        SqliteTransaction transaction)
    {
        _db!.Execute(
            connection,
            transaction,
            "CREATE INDEX IF NOT EXISTS idx_session_compaction_session_created " +
            "ON session_compaction_snapshots(session_id, created_at DESC);");
        _db.Execute(
            connection,
            transaction,
            "CREATE INDEX IF NOT EXISTS idx_session_compaction_updated " +
            "ON session_compaction_snapshots(updated_at DESC);");
    }
}
