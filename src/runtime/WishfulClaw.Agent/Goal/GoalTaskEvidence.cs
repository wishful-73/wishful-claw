namespace WishfulClaw.Agent;

/// <summary>
/// Host-observed receipts for one Goal task execution. Populated by the
/// SubAgentExecutor from the child loop's tool-call stream — NOT from the
/// model's own report — so the evaluator can check claims against what
/// actually ran (files written, commands executed and their outcomes).
/// Modeled after DeepSeek-Reasonix's evidence.Receipt ledger.
/// </summary>
public sealed class GoalTaskEvidence
{
    private readonly object _sync = new();
    private readonly List<GoalTaskEvidenceItem> _items = [];

    public void Record(string toolName, string keyArgument, bool success)
    {
        lock (_sync)
        {
            _items.Add(new GoalTaskEvidenceItem(toolName, keyArgument, success));
        }
    }

    /// <summary>
    /// Rendered digest for the evaluator prompt: grouped mutation vs
    /// read/other receipts, capped so a pathological run cannot blow up the
    /// evaluation context. Empty string when the run made no tool calls.
    /// </summary>
    public string ToDigest()
    {
        List<GoalTaskEvidenceItem> items;
        lock (_sync)
        {
            if (_items.Count == 0) return string.Empty;
            items = [.. _items];
        }

        const int maxLines = 40;
        var sb = new System.Text.StringBuilder();
        var mutations = items.Where(i => IsMutationTool(i.ToolName)).ToList();
        var others = items.Where(i => !IsMutationTool(i.ToolName)).ToList();

        if (mutations.Count > 0)
        {
            sb.AppendLine($"Host-observed mutations ({mutations.Count}):");
            foreach (var m in mutations.Take(maxLines))
                sb.AppendLine($"  - {m.ToolName}({m.KeyArgument}) -> {(m.Success ? "ok" : "FAILED")}");
        }
        else
        {
            sb.AppendLine("Host-observed mutations: NONE (no write/edit/shell tool succeeded)");
        }

        if (others.Count > 0)
        {
            sb.AppendLine($"Host-observed reads/other ({others.Count}):");
            foreach (var o in others.Take(maxLines))
                sb.AppendLine($"  - {o.ToolName}({o.KeyArgument}) -> {(o.Success ? "ok" : "FAILED")}");
        }

        return sb.ToString().TrimEnd();
    }

    /// <summary>Tools that change state on disk or run arbitrary commands.</summary>
    private static bool IsMutationTool(string toolName) => toolName is
        "Write" or "WriteFile" or "CreateFile" or "Edit" or "MultiEdit" or "NotebookEdit"
        or "Bash" or "ShellExec" or "PowerShell";

    public bool HasAnyEntry()
    {
        lock (_sync)
        {
            return _items.Count > 0;
        }
    }
}

public sealed record GoalTaskEvidenceItem(string ToolName, string KeyArgument, bool Success);
