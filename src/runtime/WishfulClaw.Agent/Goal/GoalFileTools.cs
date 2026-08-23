using WishfulClaw.Contracts;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace WishfulClaw.Agent;

/// <summary>
/// File-based goal storage in .wishful-claw/goals/.
/// {goalId}.md — goal description + plan list (Markdown)
/// {goalId}.state.json — execution state (JSON: plan list + each plan's status + result summary + retry count)
/// </summary>
public static class GoalFileTools
{
    private const string GoalDirectoryName = ".wishful-claw/goals";

    // ─── Path Helpers ───

    public static string GetGoalFilePath(string workingFolder, string goalId)
    {
        return Path.Combine(workingFolder, GoalDirectoryName, $"{goalId}.md");
    }

    public static string GetGoalStateFilePath(string workingFolder, string goalId)
    {
        return Path.Combine(workingFolder, GoalDirectoryName, $"{goalId}.state.json");
    }

    private static string EnsureGoalDirectory(string workingFolder)
    {
        var dir = Path.Combine(workingFolder, GoalDirectoryName);
        Directory.CreateDirectory(dir);
        return dir;
    }

    // ─── Write Goal File (Markdown) ───

    public static void WriteGoalFile(string workingFolder, string goalId, string goalText, List<GoalPlanItem> plans)
    {
        EnsureGoalDirectory(workingFolder);
        var filePath = GetGoalFilePath(workingFolder, goalId);

        var sb = new System.Text.StringBuilder();
        sb.AppendLine($"# Goal: {goalText}");
        sb.AppendLine();
        sb.AppendLine($"- **Goal ID**: {goalId}");
        sb.AppendLine($"- **Created**: {DateTimeOffset.UtcNow:yyyy-MM-dd HH:mm:ss} UTC");
        sb.AppendLine();

        sb.AppendLine("## Plans");
        sb.AppendLine();
        for (int i = 0; i < plans.Count; i++)
        {
            var plan = plans[i];
            // Keys must come from GoalPlanStatusValues — hand-written literals
            // drifted from the real vocabulary once already (GL-3).
            var statusIcon = plan.Status switch
            {
                GoalPlanStatusValues.Pending => "[ ]",
                GoalPlanStatusValues.Active => "[~]",
                GoalPlanStatusValues.Complete => "[x]",
                GoalPlanStatusValues.Aborted or GoalPlanStatusValues.Interrupted => "[!]",
                _ => "[ ]"
            };
            sb.AppendLine($"{i + 1}. {statusIcon} **{plan.Title}** (id: `{plan.PlanId}`)");
            sb.AppendLine($"   - Status: {plan.Status}");
            if (!string.IsNullOrEmpty(plan.ResultSummary))
                sb.AppendLine($"   - Result: {plan.ResultSummary}");
            if (plan.RetryCount > 0)
                sb.AppendLine($"   - Retries: {plan.RetryCount}");
            sb.AppendLine();
        }

        File.WriteAllText(filePath, sb.ToString());
    }

    // ─── Write Goal State (JSON) ───

    public static void WriteGoalState(string workingFolder, string goalId, GoalState state)
    {
        EnsureGoalDirectory(workingFolder);
        var filePath = GetGoalStateFilePath(workingFolder, goalId);

        var json = JsonSerializer.Serialize(state, WorkerJsonHelper.GetTypeInfo<GoalState>());
        File.WriteAllText(filePath, json);
    }

    // ─── Read Goal State ───

    public static GoalState? ReadGoalState(string workingFolder, string goalId)
    {
        var filePath = GetGoalStateFilePath(workingFolder, goalId);
        if (!File.Exists(filePath))
            return null;

        var json = File.ReadAllText(filePath);
        return JsonSerializer.Deserialize(json, WorkerJsonHelper.GetTypeInfo<GoalState>());
    }

    // ─── Update Single Plan in State ───

    public static void UpdatePlanInState(string workingFolder, string goalId, GoalPlanItem updatedPlan)
    {
        var state = ReadGoalState(workingFolder, goalId);
        if (state == null)
            return;

        var plan = state.Plans.FirstOrDefault(p => p.PlanId == updatedPlan.PlanId);
        if (plan != null)
        {
            var index = state.Plans.IndexOf(plan);
            state.Plans[index] = updatedPlan;
        }

        state.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        WriteGoalState(workingFolder, goalId, state);
    }
}

// ─── Goal State Models (JSON-serializable) ───

public class GoalState
{
    public string GoalId { get; set; } = string.Empty;
    public string GoalText { get; set; } = string.Empty;
    public string Status { get; set; } = GoalStatusValues.Active;
    public int CurrentPlanIndex { get; set; } = -1;
    public List<GoalPlanItem> Plans { get; set; } = new();
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
}

public class GoalPlanItem
{
    public string PlanId { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Status { get; set; } = "pending";
    public int RetryCount { get; set; }
    public string? ResultSummary { get; set; }
    public string? SubAgentRunId { get; set; }
    public string? OriginalPlanId { get; set; }
}
