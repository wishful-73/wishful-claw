using System.Collections.Concurrent;
using System.Text.Json;

namespace WishfulClaw.Agent;

/// <summary>
/// Tracks sub-agent execution state so the main agent can query
/// their status and execution details via SubAgentStatus / SubAgentDetail tools.
/// Records both foreground and background sub-agents.
/// </summary>
public static class BackgroundSubAgentRegistry
{
    public enum SubAgentRunStatus
    {
        Running,
        Completed,
        Failed,
        Cancelled
    }

    /// <summary>
    /// Summary of a single tool call within a sub-agent run.
    /// Stored for detailed execution queries.
    /// </summary>
    public sealed record SubAgentToolCallEntry(
        string Id,
        string Name,
        string? KeyParam,
        string Status);

    public sealed record SubAgentRecord(
        string ToolUseId,
        string AgentName,
        string Description,
        string Prompt,
        DateTimeOffset StartedAt,
        SubAgentRunStatus Status,
        string? Output,
        int ToolCallCount,
        int Iterations,
        string? Error,
        DateTimeOffset? CompletedAt,
        bool IsBackground,
        IReadOnlyList<SubAgentToolCallEntry> ToolCallEntries);

    private static readonly ConcurrentDictionary<string, SubAgentRecord> _records = new();

    // SA-1: the worker is a long-lived process. Terminal records carry full
    // output strings — without eviction they accumulate forever. Keep the most
    // recent N terminal records; running records are never evicted.
    private const int MaxTerminalRecords = 100;

    private static void EvictOldTerminalRecords()
    {
        var terminal = new List<(string Id, DateTimeOffset CompletedAt)>();
        foreach (var (id, record) in _records)
        {
            if (record.Status != SubAgentRunStatus.Running && record.CompletedAt.HasValue)
            {
                terminal.Add((id, record.CompletedAt.Value));
            }
        }

        if (terminal.Count <= MaxTerminalRecords)
        {
            return;
        }

        foreach (var (id, _) in terminal
                     .OrderByDescending(t => t.CompletedAt)
                     .Skip(MaxTerminalRecords))
        {
            _records.TryRemove(id, out _);
        }
    }

    public static void Register(
        string toolUseId,
        string agentName,
        string description,
        string prompt,
        bool isBackground)
    {
        _records[toolUseId] = new SubAgentRecord(
            toolUseId,
            agentName,
            description,
            prompt,
            DateTimeOffset.UtcNow,
            SubAgentRunStatus.Running,
            null,
            0,
            0,
            null,
            null,
            isBackground,
            []);
    }

    public static void UpdateProgress(
        string toolUseId,
        int toolCallCount,
        int iterations,
        IReadOnlyList<SubAgentToolCallEntry>? toolCallEntries = null)
    {
        if (_records.TryGetValue(toolUseId, out var existing))
        {
            _records[toolUseId] = existing with
            {
                ToolCallCount = toolCallCount,
                Iterations = iterations,
                ToolCallEntries = toolCallEntries ?? existing.ToolCallEntries
            };
        }
    }

    public static void Complete(
        string toolUseId,
        string output,
        int toolCallCount,
        int iterations,
        IReadOnlyList<SubAgentToolCallEntry>? toolCallEntries = null)
    {
        if (_records.TryGetValue(toolUseId, out var existing))
        {
            _records[toolUseId] = existing with
            {
                Status = SubAgentRunStatus.Completed,
                Output = output,
                ToolCallCount = toolCallCount,
                Iterations = iterations,
                ToolCallEntries = toolCallEntries ?? existing.ToolCallEntries,
                CompletedAt = DateTimeOffset.UtcNow
            };
            EvictOldTerminalRecords();
        }
    }

    public static void Fail(
        string toolUseId,
        string error,
        int toolCallCount,
        int iterations,
        IReadOnlyList<SubAgentToolCallEntry>? toolCallEntries = null)
    {
        if (_records.TryGetValue(toolUseId, out var existing))
        {
            _records[toolUseId] = existing with
            {
                Status = SubAgentRunStatus.Failed,
                Error = error,
                ToolCallCount = toolCallCount,
                Iterations = iterations,
                ToolCallEntries = toolCallEntries ?? existing.ToolCallEntries,
                CompletedAt = DateTimeOffset.UtcNow
            };
            EvictOldTerminalRecords();
        }
    }

    public static void Cancel(string toolUseId)
    {
        if (_records.TryGetValue(toolUseId, out var existing))
        {
            _records[toolUseId] = existing with
            {
                Status = SubAgentRunStatus.Cancelled,
                CompletedAt = DateTimeOffset.UtcNow
            };
            EvictOldTerminalRecords();
        }
    }

    public static SubAgentRecord? Get(string toolUseId)
    {
        return _records.TryGetValue(toolUseId, out var record) ? record : null;
    }

    // SA-7: stable ordering (newest first) so repeated SubAgentStatus list
    // calls return a deterministic sequence for the LLM.
    public static IReadOnlyList<SubAgentRecord> GetAll()
    {
        return _records.Values
            .OrderByDescending(r => r.StartedAt)
            .ToList();
    }

    // ── Formatters ──

    /// <summary>
    /// Brief one-line summary for list view.
    /// </summary>
    public static string FormatBrief(SubAgentRecord r)
    {
        var statusText = FormatStatus(r.Status);
        return $"[{r.ToolUseId}] {r.AgentName} — {statusText} — {r.ToolCallCount} calls — {r.Description}";
    }

    /// <summary>
    /// Short status info: ID, name, description, status, tool call count,
    /// iterations, elapsed time. For finished sub-agents the final report is
    /// appended (truncated) so a single SubAgentStatus call answers "is it
    /// done and what did it find" without a follow-up SubAgentDetail call.
    /// </summary>
    public static string FormatStatusInfo(SubAgentRecord r)
    {
        var statusText = FormatStatus(r.Status);
        var elapsed = FormatElapsed(r);

        var lines = new List<string>
        {
            $"Sub-Agent: {r.AgentName}",
            $"  ID: {r.ToolUseId}",
            $"  Description: {r.Description}",
            $"  Mode: {(r.IsBackground ? "background" : "foreground")}",
            $"  Status: {statusText}",
            $"  Elapsed: {elapsed}",
            $"  Tool calls: {r.ToolCallCount}",
            $"  Iterations: {r.Iterations}"
        };

        if (!string.IsNullOrEmpty(r.Error))
            lines.Add($"  Error: {r.Error}");

        // Terminal states carry the result — include the report so the main
        // agent gets the answer in one call. Running agents have no report yet.
        if (r.Status != SubAgentRunStatus.Running && !string.IsNullOrEmpty(r.Output))
        {
            var report = r.Output;
            if (report.Length > 2000)
                report = report[..2000] + "\n... [truncated — use SubAgentDetail for the full report]";
            lines.Add("  Report:");
            lines.Add(Indent(report, "    "));
        }

        return string.Join("\n", lines);
    }

    /// <summary>
    /// Full execution detail: status info + complete output report +
    /// step-by-step tool call log (name, key parameter, status).
    /// </summary>
    public static string FormatDetail(SubAgentRecord r)
    {
        var sb = new System.Text.StringBuilder();
        sb.AppendLine(FormatStatusInfo(r));

        // Output report
        if (!string.IsNullOrEmpty(r.Output))
        {
            var output = r.Output;
            if (output.Length > 4000)
                output = output[..4000] + "\n... [truncated]";
            sb.AppendLine();
            sb.AppendLine("  Output:");
            sb.AppendLine(Indent(output, "    "));
        }

        // Tool call log
        if (r.ToolCallEntries.Count > 0)
        {
            sb.AppendLine();
            sb.AppendLine($"  Tool Call Log ({r.ToolCallEntries.Count}):");
            for (var i = 0; i < r.ToolCallEntries.Count; i++)
            {
                var tc = r.ToolCallEntries[i];
                var paramPart = string.IsNullOrEmpty(tc.KeyParam) ? "" : $"({tc.KeyParam})";
                sb.AppendLine($"    {i + 1}. {tc.Name}{paramPart} → {tc.Status}");
            }
        }

        return sb.ToString().TrimEnd();
    }

    // ── Helpers ──

    private static string FormatStatus(SubAgentRunStatus status)
    {
        return status switch
        {
            SubAgentRunStatus.Running => "running",
            SubAgentRunStatus.Completed => "completed",
            SubAgentRunStatus.Failed => "failed",
            SubAgentRunStatus.Cancelled => "cancelled",
            _ => status.ToString().ToLowerInvariant()
        };
    }

    private static string FormatElapsed(SubAgentRecord r)
    {
        var elapsed = r.CompletedAt.HasValue
            ? (r.CompletedAt.Value - r.StartedAt).TotalSeconds
            : (DateTimeOffset.UtcNow - r.StartedAt).TotalSeconds;
        return $"{elapsed:F1}s";
    }

    private static string Indent(string s, string indent) =>
        indent + s.Replace("\n", "\n" + indent, StringComparison.Ordinal);
}
