using System.Text;
using System.Text.Json;

// =============================================================================
// CodeGraphToolHandler — the front-load prompt hook (M7-W3 decision A; ≙ the
// upstream `codegraph prompt-hook` UserPromptSubmit entry, bin/codegraph.ts:1177).
// The app calls codegraph/prompt-context with each user prompt + working folder;
// for a structural/flow/impact prompt it returns a <codegraph_context> block the
// renderer injects into the run's context — so the agent's reflex grep/read has
// nothing left to find and reliably uses CodeGraph (the adoption problem).
//
// LOAD-BEARING contract (upstream): the hook must NEVER break the user's prompt.
// Every failure path — non-structural prompt, no index, engine error — returns
// success-shaped Fired:false with a gate Outcome label (the recall funnel),
// never a hard error.
//
// Gate, tiered by confidence (#994, #1126):
//   HIGH   — a structural keyword (any covered language), or a code-shaped token
//            verified in the index → full explore injection (capped 16k).
//   MEDIUM — prose words match indexed symbol-name SEGMENTS ("state machine" →
//            OrderStateMachine): name the symbols, the AGENT writes the query.
//   silent — nothing verified; every other prompt stays a zero-cost no-op.
// =============================================================================
internal static partial class CodeGraphToolHandler
{
    private const int PromptHookMaxChars = 16_000;

    internal static CodeGraphPromptContextResult PromptContext(JsonElement args)
    {
        try
        {
            return PromptContextCore(args);
        }
        catch (Exception ex)
        {
            // Additive context only — an engine error is a no-op, not a failure.
            return new CodeGraphPromptContextResult(true, false, null, "noop-error", ex.Message);
        }
    }

    private static CodeGraphPromptContextResult PromptContextCore(JsonElement args)
    {
        var prompt = JsonHelpers.GetString(args, "prompt") ?? string.Empty;
        var cwd = ResolveWorkingFolder(args);
        if (string.IsNullOrWhiteSpace(prompt) || string.IsNullOrEmpty(cwd))
        {
            return Noop("noop-shape");
        }

        if (IsRefusedRoot(cwd))
        {
            return Noop("noop-refused");
        }

        // Keywords fire on their own; a token or prose word is only a CANDIDATE
        // verified against the graph below, so a tech brand ("JavaScript") that
        // merely looks like code doesn't inject spurious context.
        var keyworded = CodeGraphStructuralPrompt.HasStructuralKeyword(prompt);
        var codeTokens = keyworded ? new List<string>() : CodeGraphStructuralPrompt.ExtractCodeTokens(prompt);
        var proseWords = keyworded ? new List<string>() : CodeGraphIdentifierSegments.ExtractProseCandidates(prompt);
        if (!keyworded && codeTokens.Count == 0 && proseWords.Count == 0)
        {
            return Noop("noop-shape");
        }

        // WHERE the index(es) are: nearest indexed ancestor of cwd, or the monorepo
        // down-scan (#964) — the sub-project the prompt points at plus a projectPath
        // nudge for the others.
        var plan = CodeGraphStructuralPrompt.PlanFrontload(cwd, prompt);
        if (plan.ExploreRoot is null && plan.NudgeProjects.Count == 0)
        {
            return Noop("noop-no-index");
        }

        if (plan.ExploreRoot is null)
        {
            // Several indexed sub-projects, none a clear match — don't guess; tell
            // the agent they exist and how to query one.
            return new CodeGraphPromptContextResult(
                true, true,
                "<codegraph_context note=\"CodeGraph is available for this workspace's indexed sub-projects — query one by passing projectPath to codegraph_explore.\">\n" +
                Nudge(plan.NudgeProjects, "This workspace's CodeGraph indexes live in sub-projects. To use CodeGraph, call codegraph_explore with the projectPath of the relevant one:") +
                "</codegraph_context>",
                "nudge-only");
        }

        var handle = EnsureHandle(plan.ExploreRoot);
        var others = plan.NudgeProjects.Count > 0
            ? "\n" + Nudge(plan.NudgeProjects, "Other indexed projects in this workspace — pass projectPath to query them:")
            : string.Empty;

        // Tier decision against THIS index: candidates must be real here. Keyword-
        // bearing prompts skip verification — the keyword is signal enough.
        var tokenVerified = false;
        if (!keyworded && codeTokens.Count > 0)
        {
            tokenVerified = WithEngineRead(handle, engine =>
            {
                foreach (var token in codeTokens)
                {
                    if (engine.GetNodesByName(token).Count > 0)
                    {
                        return true;
                    }
                }

                return false;
            });
        }

        if (keyworded || tokenVerified)
        {
            var result = Explore(BuildExploreArgs(plan.ExploreRoot, prompt));
            var text = result.Text ?? string.Empty;
            if (result.Success && !result.IsError && result.ErrorKind is null && text.Trim().Length > 0)
            {
                // Cap the injection so a large-repo explore can't flood the prompt.
                var body = text.Length > PromptHookMaxChars
                    ? text[..PromptHookMaxChars] + "\n…(truncated; call codegraph_explore for the rest)"
                    : text;
                var more = plan.ViaSubScan
                    ? $"call codegraph_explore with projectPath: \"{plan.ExploreRoot}\" for more"
                    : "call codegraph_explore for more";
                return new CodeGraphPromptContextResult(
                    true, true,
                    $"<codegraph_context note=\"Structural context from CodeGraph for this prompt — treat returned source as already read; {more}.\">\n{body}{others}\n</codegraph_context>",
                    keyworded ? "high-keyword" : "high-token");
            }

            // A high-* outcome must mean context was actually DELIVERED — an explore
            // error or empty result is a delivery failure, not a gate success (#1143).
            return Noop(keyworded ? "noop-explore-keyword" : "noop-explore-token");
        }

        // MEDIUM: heal a pre-vocab database first (#1142) — RebuildNameSegmentVocab
        // WRITES, so it runs on the writer engine under the gate; on a populated
        // vocab this is one SELECT.
        bool vocabReady;
        handle.Gate.Wait();
        try
        {
            vocabReady = handle.Engine.HealSegmentVocabIfEmpty();
        }
        finally
        {
            handle.Gate.Release();
        }

        if (!vocabReady)
        {
            return Noop("noop-vocab-empty");
        }

        var related = WithEngineRead(handle, engine => engine.GetSegmentMatches(proseWords.ToArray()));
        if (related.Count == 0)
        {
            return Noop("noop-unverified");
        }

        var lines = new StringBuilder();
        foreach (var m in related)
        {
            lines.Append("  - ").Append(m.Name).Append(" (").Append(m.Kind)
                .Append(" — ").Append(m.FilePath).Append(':').Append(m.StartLine).Append(")\n");
        }

        var exampleQuery = string.Join(' ', related.Take(3).Select(m => m.Name));
        var projectHint = plan.ViaSubScan ? $" with projectPath: \"{plan.ExploreRoot}\"" : string.Empty;
        return new CodeGraphPromptContextResult(
            true, true,
            "<codegraph_context note=\"CodeGraph found indexed symbols matching this prompt — query the graph before searching files.\">\n" +
            $"This project's CodeGraph index contains symbols matching this request:\n{lines}" +
            $"Call codegraph_explore ONCE{projectHint} with the relevant names in one query (e.g. \"{exampleQuery}\") " +
            "to get their source, call paths, and blast radius — cheaper and more complete than Read/Grep.\n" + others +
            "</codegraph_context>",
            "medium-segment");
    }

    private static CodeGraphPromptContextResult Noop(string outcome) =>
        new(true, false, null, outcome);

    // Read on a pooled read-only engine, falling back to the writer gate.
    private static T WithEngineRead<T>(EngineHandle handle, Func<CodeGraphEngine, T> body)
    {
        if (handle.TryWithReader(body, out var result))
        {
            return result;
        }

        handle.Gate.Wait();
        try
        {
            return body(handle.Engine);
        }
        finally
        {
            handle.Gate.Release();
        }
    }

    private static string Nudge(IReadOnlyList<string> projects, string lead)
    {
        var sb = new StringBuilder(lead).Append('\n');
        foreach (var p in projects)
        {
            sb.Append("  - projectPath: \"").Append(p).Append("\"\n");
        }

        return sb.ToString();
    }

    private static JsonElement BuildExploreArgs(string projectPath, string query)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("workingFolder", projectPath);
            writer.WriteString("query", query);
            writer.WriteEndObject();
        }

        using var doc = JsonDocument.Parse(stream.ToArray());
        return doc.RootElement.Clone();
    }

    internal static WorkerResponse PromptContextRpc(JsonElement args) =>
        WorkerResponse.Json(PromptContext(args), CodeGraphJsonContext.Default.CodeGraphPromptContextResult);
}

// codegraph/prompt-context — the front-load hook envelope. Fired:false is the
// common case and always success-shaped; Outcome carries the gate funnel label
// (high-keyword / high-token / medium-segment / nudge-only / noop-*).
internal sealed record CodeGraphPromptContextResult(
    bool Success,
    bool Fired,
    string? Text,
    string? Outcome,
    string? Error = null,
    string? ErrorKind = null);
