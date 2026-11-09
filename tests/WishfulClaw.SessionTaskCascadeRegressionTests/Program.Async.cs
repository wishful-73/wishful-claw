// 会话任务级联回归：全局任务执行器与派发协议（异步套件）。
// 拆分自原单文件 Program.cs（S-252，2026-10-28），方法体逐字平移。
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.Json.Serialization.Metadata;
using Microsoft.Data.Sqlite;
using WishfulClaw.Agent.Executors;
using WishfulClaw.Agent;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.SessionTaskCascadeRegressionTests;

internal static partial class Program
{
    // ─── Suite: AgentRuntimeGlobalTaskExecutor glue (CRUD paths) ───

    private static async Task RunGlobalTaskExecutorSuiteAsync(string dbPath)
    {
        CreateSession(dbPath, "s-gtx", title: "Executor Target", projectId: "p-gtx");

        // create_global_task generates its own id and returns an AOT-safe envelope
        var createJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("create_global_task", w =>
            {
                w.WriteString("title", "Executor task");
                w.WriteString("priority", "urgent");
                w.WritePropertyName("tags");
                w.WriteStartArray();
                w.WriteStringValue("exec");
                w.WriteEndArray();
            }),
            default, null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(createJson))
        {
            var root = document.RootElement;
            Assert(!root.TryGetProperty("error", out _), "executor create_global_task succeeds");
            AssertEqual("Executor task", root.GetProperty("title").GetString(), "executor create returns title");
            AssertEqual("pending", root.GetProperty("status").GetString(), "executor create returns pending status");
            Assert(root.GetProperty("taskId").GetString()!.StartsWith("gt_", StringComparison.Ordinal),
                "executor create generates gt_ prefixed id");
        }

        // list_global_tasks sees the created task
        var taskId = JsonDocument.Parse(createJson).RootElement.GetProperty("taskId").GetString()!;
        var listJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("list_global_tasks", w => w.WriteString("keyword", "Executor")),
            default, null!, CancellationToken.None);
        Assert(listJson.Contains(taskId), "executor list_global_tasks returns the created task");

        // update_global_task patch roundtrip (archive semantics covered at DB level)
        var updateJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("update_global_task", w =>
            {
                w.WriteString("taskId", taskId);
                w.WritePropertyName("patch");
                w.WriteStartObject();
                w.WriteString("status", "completed");
                w.WriteEndObject();
            }),
            default, null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(updateJson))
        {
            var root = document.RootElement;
            Assert(root.GetProperty("success").GetBoolean(), "executor update_global_task succeeds");
            AssertEqual(taskId, root.GetProperty("taskId").GetString(), "executor update echoes task id");
        }

        // send_work_request without delivery: missing target session fails cleanly
        var badDispatchJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("send_work_request", w =>
            {
                w.WriteString("globalTaskId", taskId);
                w.WriteString("sessionId", "no-such-session");
                w.WriteString("instruction", "do something");
            }),
            default, null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(badDispatchJson))
        {
            Assert(document.RootElement.TryGetProperty("error", out var error)
                    && error.GetString()!.Contains("Target session not found", StringComparison.OrdinalIgnoreCase),
                "executor send_work_request rejects missing session without context");
        }

        // update_dispatch stamps completedAt automatically when absent
        CreateSession(dbPath, "s-gtx2", title: "Executor Target 2", projectId: "p-gtx2");
        ExpectNoError(DbGlobalTaskDispatchTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gd-exec");
            w.WriteString("globalTaskId", taskId);
            w.WriteString("sessionId", "s-gtx2");
            w.WriteString("kind", "work_request");
            w.WriteString("instruction", "seeded for executor test");
        })), "executor suite seeds dispatch gd-exec");

        var dispatchUpdateJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("update_dispatch", w =>
            {
                w.WriteString("dispatchId", "gd-exec");
                w.WritePropertyName("patch");
                w.WriteStartObject();
                w.WriteString("status", "completed");
                w.WriteString("latestReport", "done by executor test");
                w.WriteEndObject();
            }),
            default, null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(dispatchUpdateJson))
        {
            Assert(document.RootElement.GetProperty("success").GetBoolean(), "executor update_dispatch succeeds");
        }
        var dispatchRows = ResultArray(DbGlobalTaskDispatchTools.List(Params(dbPath, w => w.WriteString("status", "completed"))));
        var gdExec = dispatchRows.Single(row => row.GetProperty("id").GetString() == "gd-exec");
        Assert(gdExec.GetProperty("completed_at").GetInt64() > 0,
            "executor auto-stamps completed_at when patch omits it");
    }

    // ─── Suite: dispatch protocol (source session, delivery failure, reply tool) ───

    private static async Task RunDispatchProtocolSuiteAsync(string dbPath)
    {
        // source_session_id roundtrip: dispatch records remember the global session
        CreateSession(dbPath, "s-global-src", title: "Global Agent Session", projectId: null);
        CreateSession(dbPath, "s-proto", title: "Protocol Target", projectId: "p-proto");
        ExpectNoError(DbGlobalTaskTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gt-proto");
            w.WriteString("title", "Protocol task");
        })), "protocol suite creates global task");
        ExpectNoError(DbGlobalTaskDispatchTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gd-proto");
            w.WriteString("globalTaskId", "gt-proto");
            w.WriteString("sessionId", "s-proto");
            w.WriteString("sourceSessionId", "s-global-src");
            w.WriteString("kind", "work_request");
            w.WriteString("instruction", "protocol work");
        })), "dispatch created with sourceSessionId");
        var protoRows = ResultArray(DbGlobalTaskDispatchTools.List(Params(dbPath, w => w.WriteString("globalTaskId", "gt-proto"))));
        AssertEqual("s-global-src", protoRows.Single().GetProperty("source_session_id").GetString(),
            "source_session_id roundtrips on dispatch rows");

        // Delivery failure detection: renderer-style envelopes
        AssertEqual<string?>(null,
            AgentRuntimeGlobalTaskExecutor.ExtractDeliveryFailure(JsonDocument.Parse("{\"success\":true}").RootElement),
            "delivery success envelope passes");
        AssertEqual("No active provider configured",
            AgentRuntimeGlobalTaskExecutor.ExtractDeliveryFailure(
                JsonDocument.Parse("{\"success\":false,\"error\":\"No active provider configured\"}").RootElement),
            "delivery failure envelope is detected");
        AssertEqual<string?>(null,
            AgentRuntimeGlobalTaskExecutor.ExtractDeliveryFailure(JsonDocument.Parse("\"plain text\"").RootElement),
            "non-object delivery response passes");

        // reply_global_dispatch: recorded when no global session is reachable
        ExpectNoError(DbGlobalTaskDispatchTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gd-reply");
            w.WriteString("globalTaskId", "gt-proto");
            w.WriteString("sessionId", "s-proto");
            w.WriteString("kind", "work_request");
            w.WriteString("instruction", "reply suite seed");
        })), "reply suite seeds dispatch without source session");

        var ackJson = await AgentRuntimeGlobalDispatchReplyExecutor.ExecuteAsync(
            ToolCall("reply_global_dispatch", w =>
            {
                w.WriteString("dispatchId", "gd-reply");
                w.WriteString("report", "acknowledged, starting work");
            }),
            Params(dbPath, w => w.WriteString("sessionId", "s-proto")), null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(ackJson))
        {
            var root = document.RootElement;
            Assert(root.GetProperty("success").GetBoolean(), "reply tool succeeds without source session");
            AssertEqual("acknowledged", root.GetProperty("status").GetString(),
                "reply without explicit status acknowledges a pending dispatch");
            Assert(!root.GetProperty("deliveredToGlobalAgent").GetBoolean(),
                "reply is not delivered when the dispatch has no source session");
        }

        var doneJson = await AgentRuntimeGlobalDispatchReplyExecutor.ExecuteAsync(
            ToolCall("reply_global_dispatch", w =>
            {
                w.WriteString("dispatchId", "gd-reply");
                w.WriteString("report", "work finished, all tests green");
                w.WriteString("status", "completed");
            }),
            Params(dbPath, w => w.WriteString("sessionId", "s-proto")), null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(doneJson))
        {
            AssertEqual("completed", document.RootElement.GetProperty("status").GetString(),
                "reply with explicit completed status is honored");
        }
        var replyRows = ResultArray(DbGlobalTaskDispatchTools.List(Params(dbPath, w => w.WriteString("sessionId", "s-proto"))));
        var gdReply = replyRows.Single(row => row.GetProperty("id").GetString() == "gd-reply");
        AssertEqual("work finished, all tests green", gdReply.GetProperty("latest_report").GetString(),
            "reply report is recorded on the dispatch");
        Assert(gdReply.GetProperty("completed_at").GetInt64() > 0,
            "completed reply stamps completed_at");

        // Invalid replies are rejected without mutating the dispatch
        var badStatusJson = await AgentRuntimeGlobalDispatchReplyExecutor.ExecuteAsync(
            ToolCall("reply_global_dispatch", w =>
            {
                w.WriteString("dispatchId", "gd-reply");
                w.WriteString("report", "bad");
                w.WriteString("status", "sent");
            }),
            Params(dbPath, w => w.WriteString("sessionId", "s-proto")), null!, CancellationToken.None);
        Assert(JsonDocument.Parse(badStatusJson).RootElement.TryGetProperty("error", out _),
            "reply rejects status values outside in_progress/completed/blocked");
        var missingJson = await AgentRuntimeGlobalDispatchReplyExecutor.ExecuteAsync(
            ToolCall("reply_global_dispatch", w =>
            {
                w.WriteString("dispatchId", "gd-nope");
                w.WriteString("report", "missing");
            }),
            Params(dbPath, w => w.WriteString("sessionId", "s-proto")), null!, CancellationToken.None);
        Assert(JsonDocument.Parse(missingJson).RootElement.TryGetProperty("error", out _),
            "reply rejects unknown dispatch ids");

        // Reply tool visibility: normal/goal sessions only, never the global agent
        var registry = new ToolRegistry();
        new GlobalDispatchReplyToolProvider().RegisterTools(registry);
        Assert(registry.IsAvailableInMode("reply_global_dispatch", "normal"),
            "reply tool visible in normal mode");
        Assert(registry.IsAvailableInMode("reply_global_dispatch", "goal"),
            "reply tool visible in goal mode");
        Assert(!registry.IsAvailableInMode("reply_global_dispatch", "global"),
            "reply tool hidden from the global agent itself");
    }

    // ─── Suite: S-300 project-side global task scope ───

    /// <summary>
    /// S-300 的判据 1~3 落成断言：项目会话只能看到**自己项目**的全局任务。
    ///
    /// 这条边界只有一个守点 —— projectId 从 <c>sessions.project_id</c> 推导，模型传什么都不算。
    /// 所以这里特意在最后一个断言里让模型传一个**别的项目**的 projectId，期望它被无视。
    /// </summary>
    private static async Task RunProjectTaskScopeSuiteAsync(string dbPath)
    {
        ExpectNoError(DbProjectTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "p-scope-a");
            w.WriteString("name", "Scope A");
        })), "scope project A created");
        ExpectNoError(DbProjectTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "p-scope-b");
            w.WriteString("name", "Scope B");
        })), "scope project B created");
        CreateSession(dbPath, "s-scope-a", title: "Scope A Session", projectId: "p-scope-a");
        CreateSession(dbPath, "s-scope-b", title: "Scope B Session", projectId: "p-scope-b");
        CreateSession(dbPath, "s-scope-global", title: "Scope Global Session", projectId: null);

        ExpectNoError(DbGlobalTaskTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gt-scope-a");
            w.WriteString("title", "Scope task A");
            w.WriteString("projectId", "p-scope-a");
        })), "scope task A created");
        ExpectNoError(DbGlobalTaskTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gt-scope-b");
            w.WriteString("title", "Scope task B");
            w.WriteString("projectId", "p-scope-b");
        })), "scope task B created");
        ExpectNoError(DbGlobalTaskTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "gt-scope-none");
            w.WriteString("title", "Scope task global");
        })), "scope task with no project created");

        // 判据 2：A 项目会话只看得到 A 的任务
        var idsA = await ListProjectTaskIdsAsync(dbPath, "s-scope-a", extra: null);
        Assert(idsA.Contains("gt-scope-a"), "project A session sees its own task");
        Assert(!idsA.Contains("gt-scope-b"), "project A session cannot see project B's task");
        Assert(!idsA.Contains("gt-scope-none"), "project A session cannot see unassigned global tasks");

        // 判据 1：不挂项目的任务只对全局侧可见
        var idsB = await ListProjectTaskIdsAsync(dbPath, "s-scope-b", extra: null);
        Assert(idsB.Contains("gt-scope-b"), "project B session sees its own task");
        Assert(!idsB.Contains("gt-scope-a"), "project B session cannot see project A's task");

        // 判据 4 的正向守卫：模型传别的项目的 projectId 必须被无视
        var idsASpoofed = await ListProjectTaskIdsAsync(dbPath, "s-scope-a", extra: "p-scope-b");
        Assert(idsASpoofed.Contains("gt-scope-a") && !idsASpoofed.Contains("gt-scope-b"),
            "model-supplied projectId is ignored; the session record wins");

        // 全局会话（无项目）没有项目任务可看，必须直接报错而不是返回全量
        var globalJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("list_project_tasks", _ => { }),
            Params(dbPath, w => w.WriteString("sessionId", "s-scope-global")), null!, CancellationToken.None);
        using (var document = JsonDocument.Parse(globalJson))
        {
            Assert(document.RootElement.TryGetProperty("error", out _),
                "session without a project gets an error, not the whole board");
        }

        // 判据 3：置空 projectId ⇒ 任务挂回全局，A 项目会话立刻看不到
        var detachJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("update_global_task", w =>
            {
                w.WriteString("taskId", "gt-scope-a");
                w.WritePropertyName("patch");
                w.WriteStartObject();
                w.WriteString("projectId", "");
                w.WriteEndObject();
            }),
            Params(dbPath, w => w.WriteString("sessionId", "s-scope-global")), null!, CancellationToken.None);
        Assert(JsonDocument.Parse(detachJson).RootElement.GetProperty("success").GetBoolean(),
            "clearing projectId succeeds");
        var idsAAfterDetach = await ListProjectTaskIdsAsync(dbPath, "s-scope-a", extra: null);
        Assert(!idsAAfterDetach.Contains("gt-scope-a"),
            "task disappears from the project session once detached");
        var globalListJson = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("list_global_tasks", w => w.WriteString("keyword", "Scope task A")),
            Params(dbPath, w => w.WriteString("sessionId", "s-scope-global")), null!, CancellationToken.None);
        Assert(globalListJson.Contains("gt-scope-a"),
            "detached task is still visible on the global board");
    }

    /// <summary>
    /// 跑一次 <c>list_project_tasks</c>，返回结果里的任务 id 集合。
    /// <paramref name="extra"/> 非空时把它当模型传的 <c>projectId</c> 塞进入参，用来验证它被无视。
    /// </summary>
    private static async Task<HashSet<string>> ListProjectTaskIdsAsync(
        string dbPath, string sessionId, string? extra)
    {
        var json = await AgentRuntimeGlobalTaskExecutor.ExecuteAsync(
            ToolCall("list_project_tasks", w =>
            {
                if (extra is not null) w.WriteString("projectId", extra);
            }),
            Params(dbPath, w => w.WriteString("sessionId", sessionId)), null!, CancellationToken.None);

        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Array) return new HashSet<string>();
        return root.EnumerateArray()
            .Select(row => row.TryGetProperty("id", out var id) ? id.GetString() : null)
            .Where(id => id is not null)
            .Select(id => id!)
            .ToHashSet(StringComparer.Ordinal);
    }
}
