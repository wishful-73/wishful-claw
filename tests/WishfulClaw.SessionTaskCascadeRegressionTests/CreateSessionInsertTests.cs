using System.Text.Json;
using System.Text.Json.Serialization.Metadata;
using WishfulClaw.Agent;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.SessionTaskCascadeRegressionTests;

/// <summary>
/// iter-34 S-115 —— <c>create_session</c> 在存量库上不能再崩。
///
/// sessions.model_selection_mode 是 NOT NULL 且**没有默认值**：新库由 DbClient 的
/// CREATE TABLE 建出 DEFAULT 'inherit'，老库那一列却是 SqlSugar 迁移的产物 —— 只有类型、
/// 没有 DEFAULT。INSERT 漏掉它在开发机上悄无声息，在存量库上直接撞 NOT NULL 约束，
/// 「从项目里新建会话」这条路整条断掉。
///
/// 所以这里不满足于断言 SQL 文本里出现过列名：先把 sessions 表还原成存量形态
/// （NOT NULL 列一律不带 DEFAULT），再逼一次真插入。列名哪天再被删掉，这条会立刻红。
/// </summary>
internal static partial class Program
{
    private static async Task RunCreateSessionInsertSuiteAsync(string dbPath, DbService db)
    {
        ExpectNoError(DbProjectTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "p-s115");
            w.WriteString("name", "S-115 Probe Project");
        })), "S-115 探针项目建好");

        // 还原存量库形态。context_revision 除外 —— 老库里它确实带 DEFAULT 0。
        db.Execute("DROP TABLE sessions");
        db.Execute(
            "CREATE TABLE sessions (" +
            "id varchar(255) NOT NULL, title varchar(255) NOT NULL, mode varchar(255) NOT NULL, " +
            "created_at bigint NOT NULL, updated_at bigint NOT NULL, message_count INTEGER NOT NULL, " +
            "project_id varchar(255), working_folder varchar(255), ssh_connection_id varchar(255), " +
            "pinned INTEGER NOT NULL, model_selection_mode varchar(255) NOT NULL, " +
            "context_revision INTEGER NOT NULL DEFAULT 0)");

        var call = ToolCall("create_session", w =>
        {
            w.WriteString("projectId", "p-s115");
            w.WriteString("sessionName", "S-115 Probe Session");
        });
        var raw = await AgentRuntimeProjectExecutor.ExecuteAsync(
            call, Params(dbPath), SilentRequestContext.Instance, CancellationToken.None);

        using var document = JsonDocument.Parse(raw);
        Assert(!document.RootElement.TryGetProperty("error", out _),
            $"create_session 不再撞 NOT NULL：{raw}");
        AssertEqual(1L, db.QueryScalar<long>(
                "SELECT COUNT(*) FROM sessions WHERE title = 'S-115 Probe Session'"),
            "create_session 的行真的落库");
        AssertEqual("inherit", db.QueryScalar<string>(
                "SELECT model_selection_mode FROM sessions WHERE title = 'S-115 Probe Session'"),
            "model_selection_mode 落到 inherit");
    }

    private sealed class SilentRequestContext : IWorkerRequestContext
    {
        public static SilentRequestContext Instance { get; } = new();

        public CancellationToken CancellationToken => CancellationToken.None;

        public CancellationToken ConnectionCancellationToken => CancellationToken.None;

        public IWorkerRequestContext ForBackgroundOperation() => this;

        public ValueTask EmitEventAsync<T>(string eventName, T parameters, JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;

        public ValueTask EmitEventIgnoringCancellationAsync<T>(
            string eventName, T parameters, JsonTypeInfo<T> typeInfo)
            => ValueTask.CompletedTask;

        public ValueTask EmitMessagePackEventAsync(string eventName, ReadOnlyMemory<byte> payload)
            => ValueTask.CompletedTask;
    }
}
