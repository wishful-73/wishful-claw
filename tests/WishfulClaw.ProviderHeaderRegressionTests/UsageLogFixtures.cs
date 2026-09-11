using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.ProviderHeaderRegressionTests;

internal static partial class UsageLogChecks
{
    private static void SeedRequest(
        string modelId,
        string status,
        long billableInput,
        long startedAt,
        int attemptIndex,
        string? errorKind = null,
        int? httpStatus = null,
        string? runtimeRole = "sessionAgent",
        string? scope = "project",
        string? collaborationMode = "chat")
    {
        var started = startedAt == 0
            ? DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() - 60_000
            : startedAt;
        DbUsageLogTools.Insert(new RequestUsageLogEntity
        {
            Id = Guid.NewGuid().ToString("N"),
            SessionId = "session-1",
            RuntimeRole = runtimeRole,
            Scope = scope,
            CollaborationMode = collaborationMode,
            ProviderId = "prov-1",
            ProviderType = "openai",
            ModelId = modelId,
            Status = status,
            ErrorKind = errorKind,
            HttpStatusCode = httpStatus,
            AttemptIndex = attemptIndex,
            TotalAttempts = status == "error" && errorKind is null ? null : attemptIndex,
            BillableInputTokens = billableInput,
            InputTokens = billableInput,
            StartedAt = started,
            CompletedAt = started + 100,
            DurationMs = 100
        });
    }

    private static JsonElement Invoke(Func<JsonElement, WorkerResponse> endpoint, object parameters)
    {
        var doc = JsonDocument.Parse(JsonSerializer.Serialize(parameters));
        var response = endpoint(doc.RootElement.Clone());
        var bytes = response.ToJsonBytes(null);
        return JsonDocument.Parse(bytes).RootElement.GetProperty("result").Clone();
    }

    private static AgentRuntimeProviderTurnResult NewTurn(int input, int output, int? cacheRead = null, int? cacheCreation = null)
        => new(
            new AgentRuntimeChatMessage("assistant", "ok", [], []),
            [],
            "end_turn",
            new AgentRuntimeTokenUsage(input, output, CacheReadTokens: cacheRead, CacheCreationTokens: cacheCreation));

    private static AgentRuntimeRunState NewState()
    {
        var state = new AgentRuntimeRunState("run-1", "session-1");
        using var doc = JsonDocument.Parse(
            """{"scope":"project","projectId":"p1","collaborationMode":"chat","sessionMode":"agent"}""");
        state.ReplaceParameters(doc.RootElement.Clone());
        return state;
    }

    private static WorkerRequestContext NewContext()
        => new(
            (_, _, _) =>
            {
                EmittedEvents++;
                return ValueTask.CompletedTask;
            },
            (_, _) =>
            {
                EmittedEvents++;
                return ValueTask.CompletedTask;
            },
            CancellationToken.None);

    private static int EmittedEvents { get; set; }

    private static JsonElement ProviderJson(int? maxRetries = null, double? inputPrice = null)
    {
        WritePersistedProvider(inputPrice);
        var retries = maxRetries.HasValue ? $",\"requestMaxRetries\":{maxRetries.Value}" : string.Empty;
        using var doc = JsonDocument.Parse($$"""
            {"providerId":"prov-1","type":"openai","model":"model-1"{{retries}}}
            """);
        return doc.RootElement.Clone();
    }

    private static void WritePersistedProvider(double? inputPrice)
    {
        var price = inputPrice.HasValue
            ? $",\"inputPrice\":{inputPrice.Value.ToString(System.Globalization.CultureInfo.InvariantCulture)}"
            : string.Empty;
        var providerDirectory = Path.Combine(_dataDir, "ai-provider");
        Directory.CreateDirectory(providerDirectory);
        File.WriteAllText(
            Path.Combine(providerDirectory, "provider-prov-1.json"),
            $$"""{"id":"prov-1","type":"openai","models":[{"id":"model-1"{{price}}}]}""");
    }

    private static void Reset()
    {
        Exec("DELETE FROM request_usage_logs;");
    }

    private static void Exec(string sql)
    {
        using var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private static long RowCount() => Scalar("SELECT COUNT(*) FROM request_usage_logs;");
    private static long ErrorCount() => Scalar("SELECT COUNT(*) FROM request_usage_logs WHERE status='error';");
    private static long SuccessCount() => Scalar("SELECT COUNT(*) FROM request_usage_logs WHERE status='success';");

    private static long Scalar(string sql)
    {
        using var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        return Convert.ToInt64(cmd.ExecuteScalar());
    }

    private static object? Raw(string column, string? where = null)
    {
        using var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT {column} FROM request_usage_logs{(where is null ? string.Empty : " WHERE " + where)} LIMIT 1;";
        var value = cmd.ExecuteScalar();
        return value is DBNull ? null : value;
    }

    private static string? Col(string column) => Convert.ToString(Raw(column));
    private static string? ColWhere(string column, string where) => Convert.ToString(Raw(column, where));
    private static bool ColIsNull(string column) => Raw(column) is null;
    private static bool ColIsNullWhere(string column, string where) => Raw(column, where) is null;
    private static long ColInt(string column) => ColIntWhere(column, null);
    private static long ColIntWhere(string column, string? where)
        => long.TryParse(Convert.ToString(Raw(column, where)), out var v) ? v : -1;
    private static double ColDouble(string column)
        => double.TryParse(Convert.ToString(Raw(column)), System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture, out var v) ? v : double.NaN;

    private static void Assert(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException($"ASSERT FAILED: {message}");
    }
}
