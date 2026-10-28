// Goal 回归：目标生命周期套件。
// 拆分自原单文件 Program.Lifecycle.cs（S-252，2026-10-28），方法体逐字平移。
using System.Text.Json;
using WishfulClaw.Agent;
using WishfulClaw.Agent.Tools.Providers;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Tools;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    private static void RunLifecycleRegressionSuite(string dbPath)
    {
        var db = DbClient.GetClient();
        db.Execute(
            "INSERT INTO sessions (id, project_id, title, mode, created_at, updated_at) " +
            "VALUES ('session-lifecycle', 'project-a', 'Lifecycle', 'chat', 600, 600)");

        var runStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var releaseRun = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var runCount = 0;
        GoalOrchestrator.OwnedRunOverride = async (_, _, runtimeState, _) =>
        {
            Interlocked.Increment(ref runCount);
            runStarted.TrySetResult();
            await releaseRun.Task.WaitAsync(runtimeState.CancellationToken);
        };

        try
        {
            var confirmContext = new ReverseRequestContext(confirmed: true);
            var confirmedResult = ExecuteCreateGoal(
                dbPath,
                "session-lifecycle",
                "confirm lifecycle",
                confirmContext);
            var confirmedGoalId = confirmedResult
                .GetProperty("goal")
                .GetProperty("goalId")
                .GetString();
            Assert(!string.IsNullOrEmpty(confirmedGoalId),
                "pending confirmation returns the persisted goalId");
            AssertEqual(confirmedGoalId, confirmContext.GoalId,
                "pending confirmation keeps goalId unchanged");
            AssertEqual(GoalStatusValues.Active,
                DbGoalTools.GetByGoalId(confirmedGoalId!, "session-lifecycle")?.Status,
                "pending confirmation persists active");
            runStarted.Task.Wait(TimeSpan.FromSeconds(5));
            AssertEqual(1, Volatile.Read(ref runCount),
                "confirmed goal starts one owned loop");

            var pauseResult = GoalOrchestrator.Pause(confirmedGoalId!);
            Assert(pauseResult.Success && pauseResult.RunState == GoalRunStateValues.Paused,
                "pause keeps the owned loop and enters paused run state");
            var pausedResume = GoalOrchestrator.Resume(
                confirmedGoalId!,
                "session-lifecycle",
                SilentRequestContext.Instance);
            Assert(pausedResume.Success && pausedResume.Action == "resumed",
                "resume wakes the paused owned loop");
            AssertEqual(1, Volatile.Read(ref runCount),
                "pause and resume do not replace the owned loop");

            var duplicateResume = GoalOrchestrator.Resume(
                confirmedGoalId!,
                "session-lifecycle",
                SilentRequestContext.Instance);
            Assert(duplicateResume.Success && duplicateResume.Action == "already_running",
                "resume while running reuses the owned loop");
            AssertEqual(1, Volatile.Read(ref runCount),
                "duplicate resume does not start another loop");

            var abortTask = GoalOrchestrator.AbortAsync(
                confirmedGoalId!,
                SilentRequestContext.Instance);
            Assert(abortTask.Wait(TimeSpan.FromSeconds(5)),
                "active abort waits for the owned loop to exit");
            var abortResult = abortTask.GetAwaiter().GetResult();
            Assert(abortResult.Success && abortResult.Status == GoalStatusValues.Aborted,
                "running active goal cancels through orchestrator");
            Assert(GoalOrchestrator.GetContext(confirmedGoalId!) == null,
                "running cancellation removes runtime context");
            AssertEqual(GoalStatusValues.Aborted,
                DbGoalTools.GetByGoalId(confirmedGoalId!, "session-lifecycle")?.Status,
                "running cancellation persists aborted");

            var discardResult = ExecuteCreateGoal(
                dbPath,
                "session-lifecycle",
                "discard lifecycle",
                new ReverseRequestContext(confirmed: false));
            Assert(discardResult.TryGetProperty("error", out _),
                "pending discard returns a tool error result");
            var discarded = DbGoalTools.GetBySessionId("session-lifecycle");
            Assert(discarded == null,
                "pending discard leaves no current goal");
            AssertEqual(0, AgentRuntimeReverseRequests.PendingCount,
                "pending discard releases the reverse resolver");
            Assert(GoalOrchestrator.GetPendingGoalId("session-lifecycle") == null,
                "pending discard releases pending goal memory");

            var failingContext = new ReverseRequestContext(
                confirmed: true,
                failBackgroundContext: true);
            var failedResult = ExecuteCreateGoal(
                dbPath,
                "session-lifecycle",
                "startup failure",
                failingContext);
            Assert(failedResult.TryGetProperty("error", out _),
                "confirmation startup failure returns a tool error result");
            var failedGoalId = failingContext.GoalId;
            Assert(!string.IsNullOrEmpty(failedGoalId),
                "startup failure still identifies the pending goal");
            // Startup failure is a system-side event: the business status
            // stays active (only a user cancel produces aborted); the goal
            // remains resumable and no runtime zombie is left behind.
            AssertEqual(GoalStatusValues.Active,
                DbGoalTools.GetByGoalId(failedGoalId!, "session-lifecycle")?.Status,
                "confirmation startup failure keeps the goal active");
            Assert(GoalOrchestrator.GetContext(failedGoalId!) == null,
                "confirmation startup failure leaves no active zombie");
            AssertEqual(0, AgentRuntimeReverseRequests.PendingCount,
                "confirmation startup failure releases the reverse resolver");
            Assert(GoalOrchestrator.GetPendingGoalId("session-lifecycle") == null,
                "confirmation startup failure releases pending goal memory");

            // The startup-failure goal legitimately stays active (system
            // failures never produce aborted). Simulate the user cancelling
            // it so later steps get a clean current-goal slot.
            var cancelledAfterFailure = DbGoalTools.SetStatusByGoalId(
                failedGoalId!,
                "session-lifecycle",
                GoalStatusValues.Active,
                GoalStatusValues.Aborted,
                "Startup-failure goal cancelled by regression cleanup");
            AssertEqual(GoalStatusValues.Aborted, cancelledAfterFailure?.Status,
                "user cancel archives the startup-failure goal");

            var listResult = ExecuteGoalTool(
                dbPath,
                "session-lifecycle",
                "list_goals",
                writer => writer.WriteNumber("limit", 2),
                SilentRequestContext.Instance);
            Assert(listResult.GetProperty("goals").GetArrayLength() == 2
                   && listResult.GetProperty("hasMore").GetBoolean(),
                "list_goals executes cursor pagination through the agent dispatcher");

            var historySourceId = failingContext.GoalId!;
            var historyResult = ExecuteGoalTool(
                dbPath,
                "session-lifecycle",
                "get_goal_history",
                writer =>
                {
                    writer.WriteString("goalId", historySourceId);
                    writer.WriteNumber("limit", 1);
                },
                SilentRequestContext.Instance);
            AssertEqual(historySourceId,
                historyResult.GetProperty("goal").GetProperty("goalId").GetString(),
                "get_goal_history stays scoped to the current session");
            Assert(historyResult.GetProperty("events").GetArrayLength() == 1,
                "get_goal_history returns a paged audit trail");

            var reopenedResult = ExecuteGoalTool(
                dbPath,
                "session-lifecycle",
                "reopen_goal",
                writer =>
                {
                    writer.WriteString("goalId", historySourceId);
                    writer.WriteString("objective", "reopened through agent tool");
                },
                new ReverseRequestContext(confirmed: false));
            Assert(reopenedResult.TryGetProperty("error", out _),
                "reopen_goal uses the same confirmation boundary as create_goal");
            Assert(DbGoalTools.GetBySessionId("session-lifecycle") == null,
                "reopen_goal cancellation leaves no current goal");
            AssertEqual(GoalStatusValues.Aborted,
                ScalarString(DbClient.GetClient(),
                    "SELECT status FROM goals WHERE session_id = 'session-lifecycle' " +
                    "AND objective = 'reopened through agent tool' ORDER BY created_at DESC LIMIT 1"),
                "reopen_goal cancellation archives the new goal");
            AssertEqual(1L, DbClient.GetClient().QueryScalar<long>(
                "SELECT COUNT(*) FROM goal_events WHERE goal_id = @goalId AND event_type = 'reopened'",
                new Microsoft.Data.Sqlite.SqliteParameter("@goalId", historySourceId)),
                "reopen_goal persists source audit metadata through the agent dispatcher");

            RunUseCapabilityGoalRegressionSuite(dbPath, historySourceId);

            foreach (var terminalStatus in new[]
                     {
                         GoalStatusValues.Complete,
                         GoalStatusValues.Aborted
                     })
            {
                var terminalGoalId = $"goal-terminal-{terminalStatus}";
                DbGoalTools.CreateCurrentGoal(GoalParameters(
                    dbPath,
                    "session-lifecycle",
                    terminalGoalId,
                    $"terminal {terminalStatus}",
                    terminalStatus));
                Assert(!GoalOrchestrator.ResumeFromDb(terminalGoalId, "session-lifecycle")
                        .GetAwaiter()
                        .GetResult(),
                    $"worker restart does not restore {terminalStatus} goals");
                Assert(GoalOrchestrator.GetContext(terminalGoalId) == null,
                    $"{terminalStatus} goal remains outside runtime memory");
            }
        }
        finally
        {
            releaseRun.TrySetResult();
            GoalOrchestrator.OwnedRunOverride = null;
        }
    }

}
