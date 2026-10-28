
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Database client singleton + DB initialization.
/// Replaces SqlSugarScope with DbService (Microsoft.Data.Sqlite, zero reflection, AOT-safe).
/// dbPath = ~/.wishful-claw/index.db
/// </summary>
public static partial class DbClient
{
    private static readonly object InitLock = new();
    private static DbService? _db;
    private static string? _dbPath;
    private static bool _initialized;

    /// <summary>
    /// Resolve dbPath. Prioritize parameter, fallback to ~/.wishful-claw/index.db
    /// </summary>
    public static string ResolveDbPath(JsonElement? parameters = null)
    {
        if (parameters.HasValue &&
            parameters.Value.ValueKind == JsonValueKind.Object &&
            parameters.Value.TryGetProperty("dbPath", out var dbPathEl) &&
            dbPathEl.ValueKind == JsonValueKind.String &&
            !string.IsNullOrWhiteSpace(dbPathEl.GetString()))
        {
            return Path.GetFullPath(dbPathEl.GetString()!);
        }

        return WishfulClawDataDir.Resolve("index.db");
    }

    /// <summary>
    /// Initialize DB: create directory, open connection, hand-written CREATE TABLE, PRAGMA.
    /// Thread-safe, executes once.
    /// </summary>
    public static DbInitializeResult Initialize(string? dbPathOverride = null)
    {
        var dbPath = dbPathOverride ?? ResolveDbPath();
        // DB-1: concurrent first access (multiple modules hitting IPC at
        // startup) must not run Initialize twice — guard with a lock.
        lock (InitLock)
        {
            // Idempotent early-out: once initialized, a later call with a
            // different dbPath must not silently re-point the global DB.
            if (_initialized && _db is not null)
            {
                if (!string.Equals(_dbPath, dbPath, StringComparison.OrdinalIgnoreCase))
                {
                    WorkerLog.Warn(
                        $"DbClient: ignoring Initialize for different dbPath={dbPath}; keeping {_dbPath}");
                }
                return new DbInitializeResult(true, _dbPath!, null);
            }

        try
        {
            var dir = Path.GetDirectoryName(dbPath);
            if (!string.IsNullOrEmpty(dir))
            {
                Directory.CreateDirectory(dir);
            }

            _dbPath = dbPath;
            var connectionString = $"Data Source={dbPath}";
            _db = new DbService(connectionString);

            WorkerLog.Info("DbClient: starting table creation");

            CreateSchema();

            RunMigrations();

            _initialized = true;
            WorkerLog.Info($"DbClient: initialization completed successfully dbPath={dbPath}");
            return new DbInitializeResult(true, dbPath, null);
        }
        catch (Exception ex)
        {
            _initialized = false;
            // Drop the half-opened client so the next GetClient rebuilds from a
            // clean slate instead of reusing a connection from a failed init.
            _db = null;
            WorkerLog.Error($"DbClient: initialization FAILED at dbPath={dbPath} error={ex.GetType().Name}: {ex.Message}\n{ex.StackTrace}");
            return new DbInitializeResult(false, dbPath, ex.Message);
        }
        }
    }

    /// <summary>
    /// Get the initialized DbService. Auto-initializes with default path if needed.
    /// </summary>
    public static DbService GetClient(JsonElement? parameters = null)
    {
        if (_db is null || !_initialized)
        {
            var dbPath = parameters.HasValue ? ResolveDbPath(parameters) : ResolveDbPath();
            var result = Initialize(dbPath);
            if (!result.Success)
            {
                throw new InvalidOperationException($"DB initialization failed: {result.Error}");
            }
        }

        return _db!;
    }

    /// <summary>
    /// Ensure DB is initialized (from IPC parameters).
    /// </summary>
    public static void EnsureInitialized(JsonElement parameters)
    {
        if (_db is null || !_initialized)
        {
            var dbPath = ResolveDbPath(parameters);
            var result = Initialize(dbPath);
            if (!result.Success)
            {
                throw new InvalidOperationException($"DB initialization failed: {result.Error}");
            }
        }
    }
    /// <summary>
    /// Ensure DB is initialized (no-arg version, for non-IPC contexts).
    /// </summary>
    public static void EnsureInitialized()
    {
        if (_db is null || !_initialized)
        {
            throw new InvalidOperationException("DB has not been initialized. Call EnsureInitialized(parameters) from an IPC handler first.");
        }
    }

}
