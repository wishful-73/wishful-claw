using System.Diagnostics;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Agent;

/// <summary>
/// Adaptive decision parsing: the LLM decision record, its parsing candidates and the
/// repetition detector that feeds system reminders back into the loop.
/// Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class GoalOrchestrator
{
    /// <summary>
    /// One entry in the adaptive execution log fed back to every decision call.
    /// </summary>
    private sealed record AdaptiveStepRecord(int Step, string Title, string Description, string Outcome);

    /// <summary>
    /// LLM decision call: given the goal and the full step log, pick the next
    /// action. Returns null when the output cannot be parsed (counted against
    /// the circuit breaker). A provider 429 is NOT a parse failure: it runs
    /// the shared backoff loop and then retries the decision transparently.
    /// </summary>
    private static async Task<AdaptiveDecision?> DecideNextActionAsync(
        GoalContext goal,
        List<AdaptiveStepRecord> log,
        int step,
        JsonElement parameters,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var stepLog = RenderStepLog(log);
        var prompt = GoalPromptTemplates.BuildAdaptiveDecisionUserPrompt(
            goal.GoalText, stepLog, log.Count);

        var input = CreateTaskInput(
            prompt,
            "Next action decision",
            "goal-orchestrator",
            GoalPromptTemplates.AdaptiveOrchestratorSystemPrompt);
        var toolCallId = $"goal-decide-{Guid.NewGuid():N}";

        while (true)
        {
            string output;
            try
            {
                var result = await SubAgentExecutor.ExecuteAsync(
                    input, parameters, parentState, context, toolCallId);
                ct.ThrowIfCancellationRequested();
                output = StripCodeFence(result.Content?.Trim() ?? string.Empty);
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception ex)
            {
                output = ex.Message;
            }

            // Provider rate-limited: run the shared backoff (fast → minute
            // polling → 6h timeout) and retry the same decision. This is not a
            // parse failure and must not consume circuit-breaker attempts.
            if (IsRateLimitText(output))
            {
                var backoffOutcome = await Handle429BackoffAsync(
                    goal, goal.Plans.Count > 0 ? goal.Plans[0] : new GoalPlanItem { PlanId = GoalIds.NewPlanId(), Title = "Adaptive execution", Description = goal.GoalText },
                    step - 1,
                    new PlanExecutionResult { Is429 = true, Error = output },
                    parameters, parentState, context, ct);
                await ReachSafePointAsync(goal, context, ct);
                if (backoffOutcome == BackoffOutcome.Timeout)
                {
                    return null; // caller's breaker will fail the goal with the count
                }
                continue;
            }

            // Parse leniently: models routinely prepend reasoning text before
            // the JSON ("The goal is to build... {\"action\":..."). Scan for
            // the first balanced {...} that parses AND carries a known action;
            // fall back to the raw output.
            var decision = TryParseDecision(output)
                ?? TryParseDecision(ExtractJsonObject(output) ?? string.Empty);
            if (decision == null)
            {
                WorkerLog.Warn($"adaptive decide unparseable output: {HeadTail(output, 300)}");
                return null;
            }
            return decision;
        }
    }

    /// <summary>
    /// Parse a decision from text: scan every balanced {...} block and accept
    /// the LAST one carrying a known action. Reasoning models put their final
    /// decision at the END (thinking/prose first), so right-to-left is the
    /// correct priority order. A bare prose answer still fails but logs its
    /// head/tail for diagnosis.
    /// </summary>
    private static AdaptiveDecision? TryParseDecision(string output)
    {
        if (string.IsNullOrWhiteSpace(output)) return null;

        AdaptiveDecision? last = null;
        foreach (var candidate in JsonCandidates(output))
        {
            var parsed = TryParseDecisionJson(candidate);
            if (parsed != null) last = parsed; // keep scanning — later blocks win
        }
        return last;
    }

    private static AdaptiveDecision? TryParseDecisionJson(string candidate)
    {
        try
        {
            using var doc = JsonDocument.Parse(candidate);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            var action = root.TryGetProperty("action", out var a) ? a.GetString() ?? "" : "";
            if (action is not ("execute" or "complete" or "failed")) return null;

            return new AdaptiveDecision(
                Action: action,
                Title: root.TryGetProperty("title", out var t) ? t.GetString() : null,
                Description: root.TryGetProperty("description", out var d) ? d.GetString() : null,
                Summary: root.TryGetProperty("summary", out var s) ? s.GetString() : null,
                Reason: root.TryGetProperty("reason", out var r) ? r.GetString() : null);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    /// <summary>
    /// Yields parse candidates: the full text first, then every balanced
    /// {...} block (outermost only, string-aware — same scanner as
    /// ExtractJsonObject but yielding all top-level objects).
    /// </summary>
    private static IEnumerable<string> JsonCandidates(string text)
    {
        yield return text;
        var start = 0;
        while ((start = text.IndexOf('{', start)) >= 0)
        {
            var depth = 0;
            var inString = false;
            for (var i = start; i < text.Length; i++)
            {
                var c = text[i];
                if (inString)
                {
                    if (c == '\\') i++;
                    else if (c == '"') inString = false;
                    continue;
                }
                if (c == '"') inString = true;
                else if (c == '{') depth++;
                else if (c == '}')
                {
                    depth--;
                    if (depth == 0)
                    {
                        yield return text.Substring(start, i - start + 1);
                        start = i + 1;
                        break;
                    }
                }
            }
            if (depth != 0) break; // unbalanced tail — no more candidates
        }
    }

    private static string RenderStepLog(List<AdaptiveStepRecord> log)
    {
        var sb = new StringBuilder();

        // Spin detector (reminder-based, user-confirmed): when the last N
        // actions look near-identical, inject a system reminder so the LLM
        // changes approach itself — the host never hard-kills for this.
        if (log.Count >= AdaptiveSpinReminderThreshold && IsSpinning(log))
        {
            sb.AppendLine($"<system-reminder event=\"adaptive_spin\">Your last {AdaptiveSpinReminderThreshold} actions were near-identical and produced no new progress. You are spinning. Change approach: try a fundamentally different method, split the work into smaller concrete steps, or declare failed with a reason if the goal is truly blocked.</system-reminder>");
            sb.AppendLine();
            WorkerLog.Warn($"adaptive spin detected after {log.Count} steps — reminder injected");
        }

        if (log.Count == 0)
        {
            sb.AppendLine("(nothing executed yet — this is the first action)");
            return sb.ToString();
        }

        const int maxCharsPerStep = 3000;
        foreach (var entry in log)
        {
            sb.AppendLine($"--- Step {entry.Step}: {entry.Title} ---");
            sb.AppendLine(HeadTail(entry.Outcome, maxCharsPerStep));
            sb.AppendLine();
        }
        return sb.ToString();
    }

    /// <summary>
    /// True when the trailing window of executed actions is near-identical:
    /// same normalized title AND every one of them failed. Repeating a
    /// *succeeding* action is legitimate progress and never counts as spinning.
    /// </summary>
    private static bool IsSpinning(List<AdaptiveStepRecord> log)
    {
        var window = log.TakeLast(AdaptiveSpinReminderThreshold).ToList();
        if (window.Count < AdaptiveSpinReminderThreshold) return false;
        var normalized = NormalizeTitle(window[0].Title);
        return window.All(s => NormalizeTitle(s.Title) == normalized)
            && window.All(s => s.Outcome.StartsWith("FAILED", StringComparison.Ordinal));
    }

    /// <summary>Lowercase, digits/underscores collapsed — tolerant title match.</summary>
    private static string NormalizeTitle(string title)
        => System.Text.RegularExpressions.Regex.Replace(title.Trim().ToLowerInvariant(), @"[\d_]+", "#");

    private sealed record AdaptiveDecision(
        string Action,
        string? Title,
        string? Description,
        string? Summary,
        string? Reason);
}
