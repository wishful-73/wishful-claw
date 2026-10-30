// iter-v3-5 S-279 —— 普通消息派活另建 global_message_dispatches（方案 C）。
//
// 钉住四件事：
//   1. 老库启动自动建表：只存在 global_task_dispatches 的旧库，Initialize 之后
//      global_message_dispatches 必须在，且旧表数据一个字节不动；
//   2. 幂等：**另起一个进程**再 Initialize 同一个库必须成功。这是 CREATE TABLE
//      IF NOT EXISTS 的反向验证锚点 —— 把 IF NOT EXISTS 去掉，本项必红；
//   3. 路由：gm_ 前缀走消息表，其余走任务表。前缀常量只在 DispatchTableRouter 一处；
//   4. 状态机：completed_implicit 不是终态，显式回执必须能覆盖它（S-280 的地基）。
//
// 为什么幂等要用子进程：DbClient.Initialize 有 _initialized 早退，同进程第二次调用
// 直接 return，根本不重跑 CreateSchema —— 那样测等于没测。

using System.Diagnostics;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Infrastructure;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.TestSupport;

namespace WishfulClaw.DispatchRouterRegressionTests;

internal static class Program
{
    private static int _passed;
    private static int _failed;

    public static int Main(string[] args)
    {
        // 子进程入口：模拟「应用第二次启动」，验证建表语句幂等。
        if (args.Length >= 2 && args[0] == "--second-boot")
            return SecondBoot(args[1]);

        try
        {
            WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);

            var testRoot = Path.Combine(TestOutputRoot.Resolve(), $"dispatch-router-{Guid.NewGuid():N}");
            Directory.CreateDirectory(testRoot);
            try
            {
                var dbPath = Path.Combine(testRoot, "regression.db");

                // ── 1. 造一个「老库」：只有任务派活表，没有消息派活表 ──
                CreateLegacyDatabase(dbPath);
                Assert(TableExistsRaw(dbPath, "global_task_dispatches"),
                    "legacy db has global_task_dispatches before Initialize");
                Assert(!TableExistsRaw(dbPath, "global_message_dispatches"),
                    "legacy db does NOT have global_message_dispatches before Initialize");

                // ── 2. Initialize：老库自动补建新表 ──
                var initialization = DbClient.Initialize(dbPath);
                Assert(initialization.Success, $"database initializes on legacy file: {initialization.Error}");
                Assert(TableExistsRaw(dbPath, "global_message_dispatches"),
                    "global_message_dispatches is created automatically on an existing db");

                var db = DbClient.GetClient();

                // 旧表数据必须原样保留（零数据搬运的反向证据）。
                var legacyRows = db.QueryScalar<long>("SELECT COUNT(*) FROM global_task_dispatches");
                Assert(legacyRows == 1, $"legacy task dispatch row survives migration (got {legacyRows})");

                var legacyInstruction = db.Query(
                    "SELECT instruction FROM global_task_dispatches WHERE id = @id",
                    r => r.GetString("instruction"),
                    new SqliteParameter("@id", "gd_legacy_row"));
                Assert(legacyInstruction.Count == 1 && legacyInstruction[0] == "legacy instruction",
                    "legacy task dispatch content is untouched byte for byte");

                // ── 3. 幂等：另起进程再启动一次 ──
                AssertSecondBootSucceeds(dbPath);

                // ── 4. 路由 ──
                Assert(DispatchTableRouter.ResolveTable("gm_abc") == DispatchTableRouter.MessageDispatchTable,
                    "gm_ prefix routes to global_message_dispatches");
                Assert(DispatchTableRouter.ResolveTable("gd_abc") == DispatchTableRouter.TaskDispatchTable,
                    "gd_ prefix routes to global_task_dispatches");
                Assert(DispatchTableRouter.ResolveTable("something-else") == DispatchTableRouter.TaskDispatchTable,
                    "unknown prefix falls back to the task dispatch table");
                Assert(DispatchTableRouter.ResolveTable(null) == DispatchTableRouter.TaskDispatchTable,
                    "null id falls back to the task dispatch table");
                Assert(DispatchTableRouter.IsMessageDispatch(DispatchTableRouter.NewMessageDispatchId()),
                    "NewMessageDispatchId() produces an id that routes to the message table");

                // ── 5. 状态机 ──
                Assert(DispatchStatusMachine.IsTerminal(GlobalTaskDispatchStatusValues.Completed),
                    "completed is terminal");
                Assert(DispatchStatusMachine.IsTerminal(GlobalTaskDispatchStatusValues.Failed),
                    "failed is terminal");
                Assert(DispatchStatusMachine.IsTerminal(GlobalTaskDispatchStatusValues.Cancelled),
                    "cancelled is terminal");
                Assert(!DispatchStatusMachine.IsTerminal(GlobalTaskDispatchStatusValues.CompletedImplicit),
                    "completed_implicit is NOT terminal (explicit reply must still override it)");
                Assert(DispatchStatusMachine.IsImplicitCompletion(GlobalTaskDispatchStatusValues.CompletedImplicit),
                    "completed_implicit is recognised as implicit completion");
                Assert(!DispatchStatusMachine.IsImplicitCompletion(GlobalTaskDispatchStatusValues.Completed),
                    "explicit completed is not mistaken for implicit completion");

                // 显式永远覆盖隐式 —— S-280 的地基。
                Assert(
                    DispatchStatusMachine.ResolveExplicitReply(
                        GlobalTaskDispatchStatusValues.CompletedImplicit,
                        GlobalTaskDispatchStatusValues.Completed) == GlobalTaskDispatchStatusValues.Completed,
                    "explicit completed overrides completed_implicit");
                Assert(
                    DispatchStatusMachine.ResolveExplicitReply(
                        GlobalTaskDispatchStatusValues.CompletedImplicit,
                        GlobalTaskDispatchStatusValues.Blocked) == GlobalTaskDispatchStatusValues.Blocked,
                    "explicit blocked overrides completed_implicit");
                Assert(
                    DispatchStatusMachine.ResolveExplicitReply(
                        GlobalTaskDispatchStatusValues.Pending, null) == GlobalTaskDispatchStatusValues.Acknowledged,
                    "untouched pending dispatch becomes acknowledged on a bare reply");
                Assert(
                    DispatchStatusMachine.ResolveExplicitReply(
                        GlobalTaskDispatchStatusValues.InProgress, null) == GlobalTaskDispatchStatusValues.InProgress,
                    "in_progress stays in_progress on a bare reply");

                // 隐式代标只在「还没有显式结论」时发生。
                Assert(DispatchStatusMachine.ShouldMarkImplicitCompletion(GlobalTaskDispatchStatusValues.InProgress),
                    "in_progress can be archived as implicit completion");
                Assert(!DispatchStatusMachine.ShouldMarkImplicitCompletion(GlobalTaskDispatchStatusValues.CompletedImplicit),
                    "completed_implicit is not re-archived");
                Assert(!DispatchStatusMachine.ShouldMarkImplicitCompletion(GlobalTaskDispatchStatusValues.Blocked),
                    "explicit blocked is never overwritten by implicit completion");

                var rejected = false;
                try
                {
                    DispatchStatusMachine.ResolveExplicitReply(
                        GlobalTaskDispatchStatusValues.Pending, "bogus_status");
                }
                catch (InvalidOperationException)
                {
                    rejected = true;
                }
                Assert(rejected, "an unknown explicit status is rejected");

                // ── 6. 端到端：真库跑 Create / Get / Update / Cancel ──
                RunMessageDispatchRoundTrip(db);

                // ── 7. S-280：统一归档层一把覆盖两张表 ──
                RunImplicitArchiveChecks(db);

                // ── 8. S-280：显式永远覆盖隐式（状态机纯函数 + 真库回执） ──
                RunExplicitOverridesImplicitChecks();
                RunExplicitReplyAfterArchive(db);

                return _failed == 0 ? 0 : 1;
            }
            finally
            {
                TryDeleteDirectory(testRoot);
            }
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[FATAL] {ex.GetType().Name}: {ex.Message}");
            Console.Error.WriteLine(ex.StackTrace);
            return 1;
        }
    }

    /// <summary>子进程：只做一次 Initialize，验证建表语句可以重复执行。</summary>
    private static int SecondBoot(string dbPath)
    {
        try
        {
            WorkerJsonHelper.ConfigureAotResolver(InfrastructureJsonContext.Default);
            var result = DbClient.Initialize(dbPath);
            if (!result.Success)
            {
                Console.Error.WriteLine($"[second-boot] Initialize failed: {result.Error}");
                return 1;
            }
            return 0;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[second-boot] {ex.GetType().Name}: {ex.Message}");
            return 1;
        }
    }

    private static void AssertSecondBootSucceeds(string dbPath)
    {
        var exePath = Environment.ProcessPath;
        if (string.IsNullOrEmpty(exePath))
        {
            Assert(false, "second boot: could not resolve the test executable path");
            return;
        }

        var startInfo = new ProcessStartInfo(exePath)
        {
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            UseShellExecute = false
        };
        startInfo.ArgumentList.Add("--second-boot");
        startInfo.ArgumentList.Add(dbPath);

        using var process = Process.Start(startInfo);
        if (process is null)
        {
            Assert(false, "second boot: failed to start the child process");
            return;
        }

        var stderr = process.StandardError.ReadToEnd();
        process.StandardOutput.ReadToEnd();
        process.WaitForExit();

        Assert(process.ExitCode == 0,
            $"a second boot against the same db succeeds (exit={process.ExitCode}) {stderr.Trim()}");
    }

    private static void RunMessageDispatchRoundTrip(DbService db)
    {
        const string sessionId = "session-project-a";
        const string sourceSessionId = "session-global-a";
        const string projectId = "project-a";
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        db.Execute(
            "INSERT INTO sessions (id, project_id, title, created_at, updated_at) VALUES (@id, @pid, @title, @now, @now)",
            new SqliteParameter("@id", sessionId),
            new SqliteParameter("@pid", projectId),
            new SqliteParameter("@title", "project session"),
            new SqliteParameter("@now", now));

        var dispatchId = DispatchTableRouter.NewMessageDispatchId();

        var create = DbGlobalMessageDispatchTools.Create(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", dispatchId);
            w.WriteString("sessionId", sessionId);
            w.WriteString("sourceSessionId", sourceSessionId);
            w.WriteString("instruction", "顺手问一句进度");
            w.WriteString("status", GlobalTaskDispatchStatusValues.Pending);
            w.WriteEndObject();
        }));
        Assert(MutationSucceeded(create), "Create on the message dispatch table succeeds");

        var get = DbGlobalMessageDispatchTools.Get(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", dispatchId);
            w.WriteEndObject();
        }));
        Assert(TryReadDispatch(get, out var row, out var getError), $"Get returns the message dispatch: {getError}");
        Assert(DispatchStatusMachine.ReadStatus(row) == GlobalTaskDispatchStatusValues.Pending,
            "a fresh message dispatch starts as pending");
        Assert(row.GetProperty("kind").GetString() == GlobalTaskDispatchKindValues.Message,
            "message dispatches report kind=message");
        Assert(row.GetProperty("source_session_id").GetString() == sourceSessionId,
            "source_session_id is stored so replies can route back");
        Assert(row.GetProperty("global_task_id").GetString() == string.Empty,
            "message dispatches carry an empty global_task_id (no global task attached)");

        var implicitPatch = DbGlobalMessageDispatchTools.Update(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", dispatchId);
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteString("status", GlobalTaskDispatchStatusValues.CompletedImplicit);
            w.WriteString("latestReport", "target session finished without an explicit reply");
            w.WriteEndObject();
            w.WriteEndObject();
        }));
        Assert(MutationSucceeded(implicitPatch), "Update can archive a message dispatch as completed_implicit");

        Assert(TryReadDispatch(DbGlobalMessageDispatchTools.Get(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", dispatchId);
            w.WriteEndObject();
        })), out var archived, out _), "re-read the archived dispatch");
        Assert(DispatchStatusMachine.ReadStatus(archived) == GlobalTaskDispatchStatusValues.CompletedImplicit,
            "archived status is completed_implicit, not completed");

        // 终态不可取消：completed_implicit 不是终态，可以取消；completed 才是。
        var explicitPatch = DbGlobalMessageDispatchTools.Update(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", dispatchId);
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteString("status", GlobalTaskDispatchStatusValues.Completed);
            w.WriteEndObject();
            w.WriteEndObject();
        }));
        Assert(MutationSucceeded(explicitPatch), "an explicit completed reply can overwrite completed_implicit");

        var cancelAfterCompletion = DbGlobalMessageDispatchTools.Cancel(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", dispatchId);
            w.WriteEndObject();
        }));
        Assert(!MutationSucceeded(cancelAfterCompletion),
            "a terminal dispatch cannot be cancelled");

        // 另一条派活用来验取消。
        var cancellableId = DispatchTableRouter.NewMessageDispatchId();
        Assert(MutationSucceeded(DbGlobalMessageDispatchTools.Create(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", cancellableId);
            w.WriteString("sessionId", sessionId);
            w.WriteString("sourceSessionId", sourceSessionId);
            w.WriteString("instruction", "催一下");
            w.WriteEndObject();
        }))), "second message dispatch is created");

        Assert(MutationSucceeded(DbGlobalMessageDispatchTools.Cancel(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", cancellableId);
            w.WriteEndObject();
        }))), "a pending message dispatch can be cancelled");

        // 两张表互不干扰：任务派活表里查不到 gm_ 记录。
        var leaked = db.QueryScalar<long>(
            "SELECT COUNT(*) FROM global_task_dispatches WHERE id = @id",
            new SqliteParameter("@id", dispatchId));
        Assert(leaked == 0, "message dispatches never land in global_task_dispatches");

        // 目标 session 必须是项目会话：全局会话不能当派活目标。
        var rejectNonProject = DbGlobalMessageDispatchTools.Create(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", DispatchTableRouter.NewMessageDispatchId());
            w.WriteString("sessionId", sourceSessionId);
            w.WriteString("instruction", "should be rejected");
            w.WriteEndObject();
        }));
        Assert(!MutationSucceeded(rejectNonProject),
            "a non-project (global) session cannot be a message dispatch target");
    }

    /// <summary>
    /// S-280 端到端：一条已被归档成 completed_implicit 的派活，目标会话事后补交回执
    /// （不带 status，只有正文）时，按真实链路 —— 读状态 → <see cref="DispatchStatusMachine.ResolveExplicitReply"/>
    /// → Update —— 必须落地成 completed，而不是退回 acknowledged。
    /// </summary>
    private static void RunExplicitReplyAfterArchive(DbService db)
    {
        const string sessionId = "session-project-reply";
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        db.Execute(
            "INSERT INTO sessions (id, project_id, title, created_at, updated_at) VALUES (@id, @pid, @title, @now, @now)",
            new SqliteParameter("@id", sessionId),
            new SqliteParameter("@pid", "project-reply"),
            new SqliteParameter("@title", "reply target"),
            new SqliteParameter("@now", now));

        var dispatchId = DispatchTableRouter.NewMessageDispatchId();
        Assert(MutationSucceeded(DbGlobalMessageDispatchTools.Create(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", dispatchId);
            w.WriteString("sessionId", sessionId);
            w.WriteString("sourceSessionId", "session-global-reply");
            w.WriteString("instruction", "跑完报一声");
            w.WriteEndObject();
        }))), "reply-target dispatch is created");

        // 会话结束 → 归档层代标隐式完成。
        DispatchArchive.ArchiveImplicitCompletions(sessionId);
        Assert(ReadDispatchStatus(db, "global_message_dispatches", dispatchId)
            == GlobalTaskDispatchStatusValues.CompletedImplicit,
            "the dispatch is archived as completed_implicit before the late reply");

        // 事后补交回执：agent 只给了正文，没给 status —— 真实 executor 就是这么调的。
        var current = ReadDispatchStatus(db, "global_message_dispatches", dispatchId);
        Assert(DispatchStatusMachine.AcceptsExplicitReply(current),
            "a late explicit reply is accepted on a completed_implicit dispatch");
        var resolved = DispatchStatusMachine.ResolveExplicitReply(current, null);
        Assert(resolved == GlobalTaskDispatchStatusValues.Completed,
            $"a bare late reply resolves to completed, not acknowledged (got {resolved})");

        Assert(MutationSucceeded(DbGlobalMessageDispatchTools.Update(WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("id", dispatchId);
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteString("status", resolved);
            w.WriteString("latestReport", "其实干完了，补个回执");
            w.WriteEndObject();
            w.WriteEndObject();
        }))), "the late reply is written back");

        var finalStatus = ReadDispatchStatus(db, "global_message_dispatches", dispatchId);
        Assert(finalStatus == GlobalTaskDispatchStatusValues.Completed,
            $"the dispatch ends up completed after the late reply (got {finalStatus})");

        var finalReport = ReadDispatchReport(db, "global_message_dispatches", dispatchId);
        Assert(finalReport == "其实干完了，补个回执",
            $"the explicit report replaces the implicit marker (got {finalReport})");
        Assert(finalReport != DispatchArchive.ImplicitCompletionReport,
            "the implicit '未显式回复' marker is gone once the agent really replied");
    }

    /// <summary>
    /// S-280 铁律：**显式永远覆盖隐式**。completed_implicit 不是终态，
    /// 目标会话事后补一条显式回执必须能把它升级成 completed，绝不能被降级成 acknowledged。
    /// </summary>
    private static void RunExplicitOverridesImplicitChecks()
    {
        const string implicitStatus = GlobalTaskDispatchStatusValues.CompletedImplicit;
        const string completed = GlobalTaskDispatchStatusValues.Completed;
        const string acknowledged = GlobalTaskDispatchStatusValues.Acknowledged;

        Assert(!DispatchStatusMachine.IsTerminal(implicitStatus),
            "completed_implicit is NOT terminal, otherwise an explicit reply could never land");
        Assert(DispatchStatusMachine.AcceptsExplicitReply(implicitStatus),
            "completed_implicit still accepts an explicit reply");
        Assert(DispatchStatusMachine.IsImplicitCompletion(implicitStatus),
            "completed_implicit is recognised as an implicit completion");

        // 本次修掉的真缺陷：不带 status 的显式回执曾把它退回 acknowledged（降级）。
        Assert(DispatchStatusMachine.ResolveExplicitReply(implicitStatus, null) == completed,
            "an explicit reply without a status upgrades completed_implicit to completed");
        Assert(DispatchStatusMachine.ResolveExplicitReply(implicitStatus, completed) == completed,
            "an explicit reply declaring completed keeps completed");

        // 归档层不得重复处理已经隐式完成的记录。
        Assert(!DispatchStatusMachine.ShouldMarkImplicitCompletion(implicitStatus),
            "an already implicitly completed dispatch is not archived twice");

        // 既有语义不能因为这次改动漂移。
        Assert(DispatchStatusMachine.ResolveExplicitReply(GlobalTaskDispatchStatusValues.Pending, null) == acknowledged,
            "a pending dispatch with a bare reply becomes acknowledged");
        Assert(DispatchStatusMachine.ResolveExplicitReply(GlobalTaskDispatchStatusValues.InProgress, null)
            == GlobalTaskDispatchStatusValues.InProgress,
            "an in-progress dispatch keeps its status on a bare reply");
        Assert(!DispatchStatusMachine.AcceptsExplicitReply(completed),
            "a genuinely completed dispatch rejects further explicit replies");
        // completed_implicit 不是终态 ⇒ 沿用全表一致的语义：可以取消。
        // 取消是人的显式动作，不会把「未回执」伪装成「已完成」；反过来禁掉取消，
        // 全局会话就会有一张「未显式回复」的卡片永久挂在那里，既清不掉也关不掉。
        Assert(DispatchStatusMachine.CanCancel(implicitStatus),
            "completed_implicit can still be cancelled by hand, like any non-terminal dispatch");

        var rejected = false;
        try
        {
            DispatchStatusMachine.ResolveExplicitReply(implicitStatus, "completed_implicit");
        }
        catch (InvalidOperationException)
        {
            rejected = true;
        }
        Assert(rejected, "agent may not declare completed_implicit by hand — only the archive layer may");
    }

    /// <summary>
    /// S-280：统一归档层必须**一把覆盖两张表** —— 任务派活（gd_）与普通消息派活（gm_）
    /// 走同一个 DispatchArchive.ArchiveImplicitCompletions，状态判据只有一份。
    /// </summary>
    private static void RunImplicitArchiveChecks(DbService db)
    {
        const string sessionId = "session-archive-target";
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        // 直接插行，绕开 Create 的校验（这里只测归档层的状态流转）。
        db.Execute(
            "INSERT INTO global_task_dispatches (id, global_task_id, project_id, session_id, source_session_id, kind, " +
            "instruction, status, created_at, updated_at) VALUES " +
            "(@id, @gtid, NULL, @sid, @src, 'work_request', 'pending work request', @status, @now, @now)",
            new SqliteParameter("@id", "gd_archive_pending"),
            new SqliteParameter("@gtid", "gt_archive"),
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@src", "session-global-archive"),
            new SqliteParameter("@status", GlobalTaskDispatchStatusValues.Pending),
            new SqliteParameter("@now", now));

        db.Execute(
            "INSERT INTO global_message_dispatches (id, project_id, session_id, source_session_id, instruction, status, " +
            "created_at, updated_at) VALUES (@id, NULL, @sid, @src, 'pending message', @status, @now, @now)",
            new SqliteParameter("@id", "gm_archive_pending"),
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@src", "session-global-archive"),
            new SqliteParameter("@status", GlobalTaskDispatchStatusValues.Pending),
            new SqliteParameter("@now", now));

        // 已经显式完成的记录绝不能被隐式覆盖。
        db.Execute(
            "INSERT INTO global_task_dispatches (id, global_task_id, project_id, session_id, source_session_id, kind, " +
            "instruction, status, latest_report, created_at, updated_at) VALUES " +
            "(@id, @gtid, NULL, @sid, @src, 'work_request', 'explicitly done', @status, 'done by hand', @now, @now)",
            new SqliteParameter("@id", "gd_archive_explicit"),
            new SqliteParameter("@gtid", "gt_archive"),
            new SqliteParameter("@sid", sessionId),
            new SqliteParameter("@src", "session-global-archive"),
            new SqliteParameter("@status", GlobalTaskDispatchStatusValues.Completed),
            new SqliteParameter("@now", now));

        // 空 sessionId 必须安全返回 0（不能扫全库）。
        Assert(DispatchArchive.ArchiveImplicitCompletions(null) == 0,
            "archiving with a null session id is a no-op");
        Assert(DispatchArchive.ArchiveImplicitCompletions("   ") == 0,
            "archiving with a blank session id is a no-op");

        var archived = DispatchArchive.ArchiveImplicitCompletions(sessionId);
        Assert(archived == 2, $"one pending dispatch per table is archived (got {archived})");

        var taskStatus = ReadDispatchStatus(db, "global_task_dispatches", "gd_archive_pending");
        Assert(taskStatus == GlobalTaskDispatchStatusValues.CompletedImplicit,
            $"pending task dispatch becomes completed_implicit (got {taskStatus})");

        var messageStatus = ReadDispatchStatus(db, "global_message_dispatches", "gm_archive_pending");
        Assert(messageStatus == GlobalTaskDispatchStatusValues.CompletedImplicit,
            $"pending message dispatch becomes completed_implicit (got {messageStatus})");

        var explicitStatus = ReadDispatchStatus(db, "global_task_dispatches", "gd_archive_explicit");
        Assert(explicitStatus == GlobalTaskDispatchStatusValues.Completed,
            $"an explicitly completed dispatch is never overwritten (got {explicitStatus})");

        var explicitReport = ReadDispatchReport(db, "global_task_dispatches", "gd_archive_explicit");
        Assert(explicitReport == "done by hand",
            $"an explicit report survives archiving (got {explicitReport})");

        var implicitReport = ReadDispatchReport(db, "global_message_dispatches", "gm_archive_pending");
        Assert(implicitReport == DispatchArchive.ImplicitCompletionReport,
            $"implicit completion records the '未显式回复' marker (got {implicitReport})");
        Assert(DispatchArchive.ImplicitCompletionReport.Contains("未显式回复"),
            "the implicit marker literally says 未显式回复");

        // 幂等：再跑一次不重复计数、不重复写。
        var secondRun = DispatchArchive.ArchiveImplicitCompletions(sessionId);
        Assert(secondRun == 0, $"re-archiving the same session is a no-op (got {secondRun})");

        var completedAt = db.QueryScalar<long>(
            "SELECT COUNT(*) FROM global_message_dispatches WHERE id = @id AND completed_at IS NOT NULL",
            new SqliteParameter("@id", "gm_archive_pending"));
        Assert(completedAt == 1, "implicit completion stamps completed_at");

        // 别的会话不受影响：归档只动目标 session 名下的记录。
        const string otherSessionId = "session-archive-bystander";
        db.Execute(
            "INSERT INTO global_message_dispatches (id, project_id, session_id, source_session_id, instruction, status, " +
            "created_at, updated_at) VALUES (@id, NULL, @sid, @src, 'bystander', @status, @now, @now)",
            new SqliteParameter("@id", "gm_archive_bystander"),
            new SqliteParameter("@sid", otherSessionId),
            new SqliteParameter("@src", "session-global-archive"),
            new SqliteParameter("@status", GlobalTaskDispatchStatusValues.Pending),
            new SqliteParameter("@now", now));

        DispatchArchive.ArchiveImplicitCompletions(sessionId);
        var bystanderStatus = ReadDispatchStatus(db, "global_message_dispatches", "gm_archive_bystander");
        Assert(bystanderStatus == GlobalTaskDispatchStatusValues.Pending,
            $"another session's pending dispatch is untouched (got {bystanderStatus})");
    }

    private static string ReadDispatchStatus(DbService db, string table, string id)
    {
        return db.QueryScalar<string>(
            $"SELECT status FROM {table} WHERE id = @id",
            new SqliteParameter("@id", id)) ?? string.Empty;
    }

    private static string? ReadDispatchReport(DbService db, string table, string id)
    {
        var rows = db.Query(
            $"SELECT latest_report FROM {table} WHERE id = @id",
            r => r.GetNullableString("latest_report"),
            new SqliteParameter("@id", id));
        return rows.Count > 0 ? rows[0] : null;
    }

    // ─── helpers ───
    private static void CreateLegacyDatabase(string dbPath)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = """
            CREATE TABLE global_task_dispatches (
                id TEXT PRIMARY KEY NOT NULL,
                global_task_id TEXT NOT NULL,
                project_id TEXT,
                session_id TEXT NOT NULL,
                source_session_id TEXT,
                kind TEXT NOT NULL DEFAULT 'message',
                instruction TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                latest_report TEXT,
                error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                completed_at INTEGER
            );
            CREATE INDEX ix_global_dispatches_task ON global_task_dispatches(global_task_id);
            CREATE INDEX ix_global_dispatches_session ON global_task_dispatches(session_id);
            INSERT INTO global_task_dispatches
                (id, global_task_id, session_id, kind, instruction, status, created_at, updated_at)
            VALUES ('gd_legacy_row', 'gt_legacy', 'session-legacy', 'work_request',
                    'legacy instruction', 'completed', 1, 1);
            """;
        command.ExecuteNonQuery();
    }

    private static bool TableExistsRaw(string dbPath, string tableName)
    {
        using var connection = new SqliteConnection($"Data Source={dbPath}");
        connection.Open();
        using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = @name";
        command.Parameters.AddWithValue("@name", tableName);
        return Convert.ToInt64(command.ExecuteScalar() ?? 0L) > 0;
    }

    private static bool MutationSucceeded(WorkerResponse response)
    {
        try
        {
            using var document = JsonDocument.Parse(response.ToJsonBytes(null));
            var root = document.RootElement;
            if (root.TryGetProperty("error", out _)) return false;
            var result = root.GetProperty("result");
            return result.ValueKind == JsonValueKind.Object
                && result.TryGetProperty("success", out var success)
                && success.GetBoolean();
        }
        catch
        {
            return false;
        }
    }

    private static bool TryReadDispatch(WorkerResponse response, out JsonElement dispatch, out string? error)
    {
        dispatch = default;
        try
        {
            using var document = JsonDocument.Parse(response.ToJsonBytes(null));
            var root = document.RootElement;
            if (root.TryGetProperty("error", out var envelopeError))
            {
                error = envelopeError.GetString();
                return false;
            }
            var result = root.GetProperty("result");
            if (!result.TryGetProperty("dispatch", out var row) || row.ValueKind != JsonValueKind.Object)
            {
                error = result.TryGetProperty("error", out var resultError)
                    ? resultError.GetString()
                    : "Dispatch not found";
                return false;
            }
            dispatch = row.Clone();
            error = null;
            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }

    private static void TryDeleteDirectory(string path)
    {
        try
        {
            if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        }
        catch
        {
            // A locked sqlite file on Windows must not fail the run.
        }
    }

    private static void Assert(bool condition, string description)
    {
        if (condition)
        {
            _passed += 1;
            Console.WriteLine($"  PASS  {description}");
        }
        else
        {
            _failed += 1;
            Console.WriteLine($"  FAIL  {description}");
        }
    }
}
