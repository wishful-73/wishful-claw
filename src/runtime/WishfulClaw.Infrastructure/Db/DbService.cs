using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// AOT-safe database service wrapper around Microsoft.Data.Sqlite.
/// Zero reflection — all mapping is done via explicit mapper delegates.
/// Replaces SqlSugarScope as the return type of DbClient.GetClient().
/// </summary>
public sealed class DbService
{
    private readonly string _connectionString;

    public DbService(string connectionString)
    {
        _connectionString = connectionString;
    }

    /// <summary>
    /// Create an open SqliteConnection with PRAGMAs configured.
    /// Caller is responsible for disposing (use using).
    /// </summary>
    public SqliteConnection CreateConnection()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();

        // PRAGMA configuration (applied per-connection)
        using var pragma = conn.CreateCommand();
        pragma.CommandText =
            "PRAGMA journal_mode = WAL;" +
            "PRAGMA synchronous = NORMAL;" +
            "PRAGMA busy_timeout = 5000;" +
            "PRAGMA foreign_keys = ON;";
        pragma.ExecuteNonQuery();

        return conn;
    }

    // ─── Query ───

    /// <summary>
    /// Execute a query and map each row via the provided mapper delegate.
    /// </summary>
    public List<T> Query<T>(string sql, Func<SqliteDataReader, T> map, params SqliteParameter[] parameters)
    {
        using var conn = CreateConnection();
        using var cmd = BuildCommand(conn, sql, parameters);
        using var reader = cmd.ExecuteReader();
        var list = new List<T>();
        while (reader.Read())
        {
            list.Add(map(reader));
        }
        return list;
    }

    public List<T> Query<T>(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string sql,
        Func<SqliteDataReader, T> map,
        params SqliteParameter[] parameters)
    {
        using var cmd = BuildCommand(connection, sql, parameters, transaction);
        using var reader = cmd.ExecuteReader();
        var list = new List<T>();
        while (reader.Read())
        {
            list.Add(map(reader));
        }
        return list;
    }

    /// <summary>
    /// Execute a query and return the first row, or default if no rows.
    /// </summary>
    public T? QueryFirstOrDefault<T>(string sql, Func<SqliteDataReader, T> map, params SqliteParameter[] parameters)
        where T : class
    {
        using var conn = CreateConnection();
        using var cmd = BuildCommand(conn, sql, parameters);
        using var reader = cmd.ExecuteReader();
        return reader.Read() ? map(reader) : null;
    }

    public T? QueryFirstOrDefault<T>(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string sql,
        Func<SqliteDataReader, T> map,
        params SqliteParameter[] parameters)
        where T : class
    {
        using var cmd = BuildCommand(connection, sql, parameters, transaction);
        using var reader = cmd.ExecuteReader();
        return reader.Read() ? map(reader) : null;
    }

    /// <summary>
    /// Execute a query that returns a single scalar value (e.g. COUNT, MAX).
    /// DB-3: Convert.ChangeType throws for Nullable&lt;T&gt; target types —
    /// unwrap to the underlying type first.
    /// </summary>
    public T QueryScalar<T>(string sql, params SqliteParameter[] parameters)
    {
        using var conn = CreateConnection();
        using var cmd = BuildCommand(conn, sql, parameters);
        var result = cmd.ExecuteScalar();
        return result == null || result == DBNull.Value
            ? default!
            : (T)Convert.ChangeType(result, Nullable.GetUnderlyingType(typeof(T)) ?? typeof(T));
    }

    public T QueryScalar<T>(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string sql,
        params SqliteParameter[] parameters)
    {
        using var cmd = BuildCommand(connection, sql, parameters, transaction);
        var result = cmd.ExecuteScalar();
        return result == null || result == DBNull.Value
            ? default!
            : (T)Convert.ChangeType(result, Nullable.GetUnderlyingType(typeof(T)) ?? typeof(T));
    }

    // ─── Execute ───

    /// <summary>
    /// Execute a non-query (INSERT/UPDATE/DELETE). Returns rows affected.
    /// </summary>
    public int Execute(string sql, params SqliteParameter[] parameters)
    {
        using var conn = CreateConnection();
        using var cmd = BuildCommand(conn, sql, parameters);
        return cmd.ExecuteNonQuery();
    }

    public int Execute(
        SqliteConnection connection,
        SqliteTransaction transaction,
        string sql,
        params SqliteParameter[] parameters)
    {
        using var cmd = BuildCommand(connection, sql, parameters, transaction);
        return cmd.ExecuteNonQuery();
    }

    public void ExecuteInTransaction(Action<SqliteConnection, SqliteTransaction> action)
    {
        ExecuteInTransaction<object?>((connection, transaction) =>
        {
            action(connection, transaction);
            return null;
        });
    }

    public T ExecuteInTransaction<T>(Func<SqliteConnection, SqliteTransaction, T> action)
    {
        using var conn = CreateConnection();
        using var transaction = conn.BeginTransaction();
        try
        {
            var result = action(conn, transaction);
            transaction.Commit();
            return result;
        }
        catch
        {
            try
            {
                transaction.Rollback();
            }
            catch (Exception rollbackEx)
            {
                // Don't let a failed rollback mask the original exception.
                WorkerLog.Warn($"transaction rollback failed: {rollbackEx.GetType().Name}: {rollbackEx.Message}");
            }
            throw;
        }
    }

    /// <summary>
    /// Execute an INSERT and return the last insert rowid (auto-increment identity).
    /// </summary>
    public long ExecuteReturnIdentity(string sql, params SqliteParameter[] parameters)
    {
        using var conn = CreateConnection();
        using var cmd = BuildCommand(conn, sql, parameters);
        cmd.ExecuteNonQuery();
        cmd.CommandText = "SELECT last_insert_rowid()";
        return (long)cmd.ExecuteScalar()!;
    }

    /// <summary>
    /// Check if any row exists matching the given SQL (e.g. "SELECT 1 FROM table WHERE ... LIMIT 1").
    /// </summary>
    public bool Exists(string sql, params SqliteParameter[] parameters)
    {
        using var conn = CreateConnection();
        using var cmd = BuildCommand(conn, sql, parameters);
        using var reader = cmd.ExecuteReader();
        return reader.HasRows;
    }

    // ─── DataTable (for backward compatibility) ───

    /// <summary>
    /// Execute a query and return results as a DataTable.
    /// Used by MemoryFtsService for FTS5 search results.
    /// </summary>
    /// <summary>
    /// Execute a query and return a SqliteDataReader for direct row access.
    /// AOT-safe: avoids DataTable.Load which uses reflection.
    /// Caller must dispose the reader.
    /// </summary>
    public SqliteDataReader ExecuteReader(string sql, params SqliteParameter[] parameters)
    {
        var conn = CreateConnection();
        var cmd = BuildCommand(conn, sql, parameters);
        return cmd.ExecuteReader(System.Data.CommandBehavior.CloseConnection);
    }

    // ─── Helpers ───

    private static SqliteCommand BuildCommand(
        SqliteConnection conn,
        string sql,
        SqliteParameter[] parameters,
        SqliteTransaction? transaction = null)
    {
        var cmd = conn.CreateCommand();
        cmd.Transaction = transaction;
        cmd.CommandText = sql;
        foreach (var p in parameters)
        {
            cmd.Parameters.Add(p);
        }
        return cmd;
    }

    /// <summary>
    /// Convenience factory for SqliteParameter.
    /// </summary>
    public static SqliteParameter Param(string name, object? value)
    {
        return new SqliteParameter(name, value ?? DBNull.Value);
    }
}
