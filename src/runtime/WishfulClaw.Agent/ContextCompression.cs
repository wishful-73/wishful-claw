/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// LLM-based context compression, inspired by Reasonix's compact.go.
///
/// Flow:
/// 1. PlanCompaction: split conversation into pinned prefix + foldable middle + recent tail
/// 2. PartitionFold: in the middle, keep small user turns verbatim, fold assistant/tool messages
/// 3. SummarizeAsync: call the provider's LLM (no tools) to distill the foldable region into a briefing
/// 4. On failure: MechanicalFold (deterministic stand-in)
/// 5. Replace: session becomes [pinned prefix] + [kept user turns] + [summary] + [recent tail]
///
/// The summary is wrapped in &lt;compaction-summary&gt; tags so the model can distinguish it
/// from live user input.
/// </summary>
public static partial class ContextCompression
{
    // ── HttpClient for summarization calls ──

    private static readonly HttpClient Http = new(new HttpClientHandler
    {
        MaxConnectionsPerServer = 4
    })
    {
        Timeout = TimeSpan.FromSeconds(400)
    };

    // ── Constants (aligned with Reasonix compact.go) ──

    private const int PreserveHeadCount = 2;       // system + first user
    private const int PreserveTailCount = 12;       // recent tail messages
    private const int DefaultTailTokens = 16384;    // verbatim recent-tail token budget
    private const int MinCompactMessages = 2;       // skip compaction below this many foldable messages
    private const int MinFoldTokens = 400;          // skip if fold region too small
    private const double FallbackTokPerChar = 0.25; // ~4 chars/token before usage data
    private const int DefaultContextCompressionLimit = 200_000; // fallback when provider has no contextLength
    private const int MaxPinnedFirstUserTokens = 1500;
    private const double PinnedFirstUserWindowFrac = 0.15;
    private const int SummaryInputBaseCharBudget = 400_000;
    private const int SummaryMaxAttempts = 3;
    private const int SummaryRetryDelayMs = 1_500;
    private const int SummaryMaxOutputTokens = 8_192;

    // Long summaries routinely exceed two minutes, so the wait window matches the
    // OpenCowork bound; the HttpClient timeout stays slightly above it so the CTS —
    // not the transport — is what reports a stuck summarizer.
    private static readonly TimeSpan SummaryTimeout = TimeSpan.FromSeconds(360);

    // ── Summary system prompt ──
    //
    // Deliberately a coverage checklist, not a fixed section template: a rigid skeleton
    // forces the model to pad empty sections or drop real content to fit it, and an
    // English skeleton additionally anchors the whole summary to English even in a
    // Chinese conversation. The model chooses whatever structure the conversation
    // actually warrants and writes it in the user's own language.

    private const string SummarySystemPrompt =
        "You are compacting the earlier part of a coding agent's conversation to save context.\n" +
        "The agent keeps your summary alongside the user's own turns (kept verbatim) and the recent tail; your job is to fold the assistant/tool work into a briefing it can resume from.\n" +
        "Return only a concise Markdown summary, with no preface. Organise it however best fits what actually happened — do not force a fixed template, and leave out anything the conversation does not contain.\n\n" +
        "Whatever structure you choose, make sure none of the following is lost if it occurred:\n" +
        "- Standing facts and constraints: everything the user stated that still governs the work — names, paths, IDs, versions, preferences, and hard \"never do X\" rules — in their own words. Be exhaustive here; this is the durable contract, so prefer over- to under-including.\n" +
        "- Goal: the user's request and intent, including any shift in it along the way.\n" +
        "- Decisions and rationale: key choices made and why, so they are not re-litigated or reversed.\n" +
        "- Files and code: files read or modified, with the facts that matter — signatures, line locations, data shapes, exact edits applied. Be concrete; this is what lets the agent act without re-reading everything.\n" +
        "- Commands and outcomes: commands run (builds, tests, git) and what they produced — what passed, what failed, the error text that matters.\n" +
        "- Errors and fixes: problems hit and how they were resolved (or not), so the same dead ends are not repeated.\n" +
        "- Pending work and next step: what is still in progress or unstarted, and the single most concrete next action to take.\n\n" +
        "Rules: write in the same language the user writes in — if the user writes Chinese, the summary and its headings are Chinese; keep code, file paths, identifiers, commands, error text and numbers in their original form, never translated. Be terse: bullet points and fragments, not prose. Preserve identifiers, paths, and numbers exactly. Do NOT invent anything not present in the messages; if something is unknown, leave it out rather than guessing.";

    private const string SummaryTagOpen = "<compaction-summary>";
    private const string SummaryTagClose = "</compaction-summary>";

    // ── Public API ──

    /// <summary>
    /// Single logical result of one compression pass — the sole source for the
    /// Agent memory replacement, the chat artifacts (boundary + summary) and the
    /// persistence snapshot (contract: compression-contract.md §七).
    /// </summary>
    public sealed record CompactionOutcome(
        List<AgentRuntimeChatMessage> Conversation,
        List<JsonElement> WireConversation,
        bool Compacted,
        bool SummarizerFailed,
        int MessagesSummarized,
        int OriginalCount,
        string? SummaryMessageId);

    /// <summary>
    /// Compacts the conversation: summarizes the foldable middle, keeps pinned prefix and recent tail.
    /// Returns a <see cref="CompactionOutcome"/>; <c>Compacted=false</c> means there was nothing
    /// to fold. On LLM failure, falls back to mechanical fold (SummarizerFailed=true).
    /// </summary>
    public static async Task<CompactionOutcome> CompactAsync(
        List<AgentRuntimeChatMessage> conversation,
        List<JsonElement> wireConversation,
        JsonElement provider,
        IWorkerRequestContext context,
        CancellationToken cancellationToken,
        Func<string, ValueTask>? onSummaryDelta = null,
        bool preserveTail = true)
    {
        var originalCount = conversation.Count;

        var (head, start, ok) = PlanCompaction(conversation, provider, MinCompactMessages, preserveTail);

        if (!ok)
        {
            // Try with min=1 for a single huge message
            (head, start, ok) = PlanCompaction(conversation, provider, 1, preserveTail);
            if (!ok)
                return new CompactionOutcome(conversation, wireConversation, false, false, 0, originalCount, null);
        }

        var region = conversation.Skip(head).Take(start - head).ToList();

        // Partition: keep small user turns + prior summaries, fold the rest
        var (kept, fold) = PartitionFold(region, provider);

        if (fold.Count == 0)
            return new CompactionOutcome(conversation, wireConversation, false, false, 0, originalCount, null);

        // Economic check: skip if fold region too small
        if (EstimateMessagesTokens(fold) < MinFoldTokens)
            return new CompactionOutcome(conversation, wireConversation, false, false, 0, originalCount, null);

        // Summarize the foldable region
        string summary;
        var summarizerFailed = false;
        try
        {
            summary = await SummarizeAsync(fold, provider, context, cancellationToken, onSummaryDelta);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // SummaryTimeout fired (linked CTS CancelAfter) while the caller is
            // still running — degrade to mechanical fold instead of letting the
            // OCE escape and fail the whole run. Caller-initiated cancellation
            // (token requested) is rethrown below.
            WorkerLog.Warn("context compression summarization timed out; falling back to mechanical fold");
            summary = MechanicalFoldDigest(fold.Count);
            summarizerFailed = true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            WorkerLog.Warn($"context compression LLM summarization failed after all input budgets: {ex.GetType().Name}: {ex.Message}");
            summary = MechanicalFoldDigest(fold.Count);
            summarizerFailed = true;
        }

        // Build the compacted conversation
        var newConversation = new List<AgentRuntimeChatMessage>();
        var newWireConversation = new List<JsonElement>();

        // Pinned prefix
        for (var i = 0; i < head; i++)
        {
            newConversation.Add(conversation[i]);
            newWireConversation.Add(wireConversation[i]);
        }

        // Kept user turns (from the foldable region)
        var keptOffset = head;
        foreach (var keptMsg in kept)
        {
            var keptIdx = conversation.IndexOf(keptMsg, keptOffset);
            if (keptIdx >= 0)
            {
                newConversation.Add(keptMsg);
                newWireConversation.Add(wireConversation[keptIdx]);
                keptOffset = keptIdx + 1;
            }
        }

        // Summary message — same id + meta flow into the chat artifacts and the
        // persistence snapshot so restore never re-inserts a duplicate.
        //
        // The wrapper carries no prose of its own: the tag is the semantic marker for
        // the model, and the human-facing "this is a compaction summary" line is
        // rendered from the renderer's i18n so it follows the UI language instead of
        // being frozen as English text inside the durable conversation.
        var summaryContent = $"{SummaryTagOpen}\n{summary}\n{SummaryTagClose}";
        var summaryMessage = AgentRuntimeChatMessage.User(summaryContent);
        var summaryMessageId = $"compact-summary-{Guid.NewGuid():N}";
        newConversation.Add(summaryMessage);
        newWireConversation.Add(CreateSummaryWireMessage(
            summaryMessageId,
            summaryContent,
            fold.Count,
            recentMessagesPreserved: start < conversation.Count,
            summarizerFailed));

        // Recent tail
        for (var i = start; i < conversation.Count; i++)
        {
            newConversation.Add(conversation[i]);
            newWireConversation.Add(wireConversation[i]);
        }

        WorkerLog.Info(
            $"context compression completed: original={conversation.Count} " +
            $"folded={fold.Count} kept={kept.Count} summary={summary.Length}chars " +
            $"result={newConversation.Count} summarizerFailed={summarizerFailed}");

        return new CompactionOutcome(
            newConversation,
            newWireConversation,
            true,
            summarizerFailed,
            fold.Count,
            originalCount,
            summaryMessageId);
    }

    // ── Legacy truncation (kept as fallback) ──

    /// <summary>
    /// Simple token-based truncation. Used as a last-resort fallback when LLM summarization is unavailable.
    /// </summary>
    public static (List<AgentRuntimeChatMessage> conversation, List<JsonElement> wireConversation) TruncateMessages(
        List<AgentRuntimeChatMessage> conversation,
        List<JsonElement> wireConversation,
        JsonElement provider)
    {
        var total = conversation.Count;
        if (total <= PreserveHeadCount + PreserveTailCount)
            return (conversation, wireConversation);

        var headCount = Math.Min(PreserveHeadCount, total);
        var tailCount = Math.Min(PreserveTailCount, total - headCount);

        var newConversation = new List<AgentRuntimeChatMessage>();
        var newWireConversation = new List<JsonElement>();

        for (var i = 0; i < headCount; i++)
        {
            newConversation.Add(conversation[i]);
            newWireConversation.Add(wireConversation[i]);
        }

        var tailStart = total - tailCount;
        for (var i = tailStart; i < total; i++)
        {
            newConversation.Add(conversation[i]);
            newWireConversation.Add(wireConversation[i]);
        }

        return (newConversation, newWireConversation);
    }

    // ── Planning ──

    /// <summary>
    /// Locates the region to summarize.
    /// head = count of leading messages preserved verbatim (system + first user + prior summaries).
    /// start = where the preserved recent tail begins.
    /// msgs[head:start] is the compactable region.
    /// </summary>
    private static (int head, int start, bool ok) PlanCompaction(
        List<AgentRuntimeChatMessage> conversation,
        JsonElement provider,
        int min,
        bool preserveTail)
    {
        var head = PinnedPrefixLen(conversation, provider);
        var contextLength = JsonHelpers.GetIntNullable(provider, "contextLength") ?? DefaultContextCompressionLimit;

        int start;
        if (!preserveTail)
        {
            // Manual compression folds through the end of the conversation — the
            // OpenCowork reference records keepMessageIds: [] for manual cuts. No
            // verbatim tail means the summary lands at the transcript tail, exactly
            // where the live compression card sits, so completion swaps in place.
            start = conversation.Count;
        }
        else if (contextLength > 0)
        {
            var budget = DefaultTailTokens;
            var maxByWin = (int)(contextLength * 0.5); // defaultCompactTarget
            if (maxByWin < budget) budget = maxByWin;
            start = TailStart(conversation, head, budget);
        }
        else
        {
            // No window: keep a fixed count of recent messages
            start = conversation.Count - PreserveTailCount;
            // Align off any tool result
            while (start > head && conversation[start].Role == "user" && conversation[start].ToolResults.Count > 0)
                start--;
        }

        if (start < head) start = head;
        if (start - head < min) return (head, start, false);
        return (head, start, true);
    }

    /// <summary>
    /// Counts leading messages a fold keeps verbatim: system prompt, first user turn (if small enough),
    /// and any prior compaction summaries.
    /// </summary>
    private static int PinnedPrefixLen(List<AgentRuntimeChatMessage> conversation, JsonElement provider)
    {
        var i = 0;

        // Skip system messages
        while (i < conversation.Count && conversation[i].Role == "system")
            i++;

        // First user turn (if pinnable)
        if (i < conversation.Count &&
            conversation[i].Role == "user" &&
            !IsCompactionSummary(conversation[i]) &&
            IsPinnableUserTurn(conversation[i], provider))
        {
            i++;
        }

        // Prior compaction summaries
        while (i < conversation.Count && IsCompactionSummary(conversation[i]))
            i++;

        return i;
    }

    private static bool IsPinnableUserTurn(AgentRuntimeChatMessage message, JsonElement provider)
    {
        var budget = MaxPinnedFirstUserTokens;
        var contextLength = JsonHelpers.GetIntNullable(provider, "contextLength") ?? DefaultContextCompressionLimit;
        if (contextLength > 0)
        {
            var fracBudget = (int)(contextLength * PinnedFirstUserWindowFrac);
            if (fracBudget < budget) budget = fracBudget;
        }
        return EstimateTextTokens(message.Text) <= budget;
    }

    /// <summary>
    /// Walks newest→oldest, growing the verbatim tail until the next message would push its
    /// token estimate past budgetTokens. Aligns the boundary back off any tool result.
    /// </summary>
    private static int TailStart(List<AgentRuntimeChatMessage> conversation, int head, int budgetTokens)
    {
        var start = conversation.Count;
        var acc = 0;
        var minKeep = 2;

        for (var i = conversation.Count - 1; i > head; i--)
        {
            var tok = EstimateMessageTokens(conversation[i]);
            if (conversation.Count - i > minKeep && acc + tok > budgetTokens)
                break;
            acc += tok;
            start = i;
        }

        // Align off tool results (don't start tail with an orphan tool result)
        while (start > head && start < conversation.Count &&
               conversation[start].Role == "user" && conversation[start].ToolResults.Count > 0)
            start--;

        return start;
    }

    // ── Partitioning ──

    /// <summary>
    /// Splits a compaction region into:
    /// - kept: small user turns (verbatim) + prior compaction summaries
    /// - fold: assistant messages, tool results, large user messages (to be summarized)
    /// </summary>
    private static (List<AgentRuntimeChatMessage> kept, List<AgentRuntimeChatMessage> fold) PartitionFold(
        List<AgentRuntimeChatMessage> region,
        JsonElement provider)
    {
        var kept = new List<AgentRuntimeChatMessage>();
        var fold = new List<AgentRuntimeChatMessage>();

        foreach (var message in region)
        {
            if (IsCompactionSummary(message) ||
                (message.Role == "user" && message.ToolResults.Count == 0 && IsPinnableUserTurn(message, provider)))
            {
                kept.Add(message);
            }
            else
            {
                fold.Add(message);
            }
        }

        return (kept, fold);
    }

    // ── Summarization ──

    /// <summary>
    /// Calls the provider's LLM (no tools) to distill the foldable region into a structured briefing.
    /// </summary>
    private static async Task<string> SummarizeAsync(
        List<AgentRuntimeChatMessage> fold,
        JsonElement provider,
        IWorkerRequestContext context,
        CancellationToken cancellationToken,
        Func<string, ValueTask>? onSummaryDelta)
    {
        var providerType = JsonHelpers.GetString(provider, "type") ?? string.Empty;
        Exception? lastError = null;

        for (var attempt = 0; attempt < SummaryMaxAttempts; attempt++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var charBudget = SummaryInputBaseCharBudget >> attempt;
            var requestBody = BuildSummaryRequestBody(fold, charBudget);
            var attemptDeltas = onSummaryDelta is null ? null : new List<string>();
            Func<string, ValueTask>? attemptDelta = onSummaryDelta is null
                ? null
                : text =>
                {
                    attemptDeltas!.Add(text);
                    return ValueTask.CompletedTask;
                };
            try
            {
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
                cts.CancelAfter(SummaryTimeout);
                var summary = providerType switch
                {
                    "anthropic" => await CallAnthropicSummary(requestBody, provider, cts.Token, attemptDelta),
                    "openai-chat" => await CallOpenAISummary(requestBody, provider, cts.Token, attemptDelta),
                    "openai-responses" => await CallOpenAISummary(requestBody, provider, cts.Token, attemptDelta),
                    _ => throw new InvalidOperationException($"Unsupported provider for summarization: {providerType}")
                };

                if (string.IsNullOrWhiteSpace(summary))
                    throw new InvalidOperationException("Summarizer returned empty output");

                if (onSummaryDelta is not null && attemptDeltas is not null)
                {
                    foreach (var delta in attemptDeltas)
                    {
                        await onSummaryDelta(delta);
                    }
                }

                return summary.Trim();
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                lastError = new TimeoutException($"Context compression summarizer timed out at input budget {charBudget} characters.");
                WorkerLog.Warn($"context compression attempt timed out attempt={attempt + 1} inputChars={requestBody.Length}");
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                lastError = ex;
                WorkerLog.Warn(
                    $"context compression attempt failed attempt={attempt + 1} budget={charBudget} " +
                    $"overflow={IsContextWindowExceededError(ex)} error={ex.GetType().Name}: {ex.Message}");
            }

            if (attempt + 1 < SummaryMaxAttempts &&
                (lastError is null || !IsContextWindowExceededError(lastError)))
            {
                await Task.Delay(SummaryRetryDelayMs * (1 << attempt), cancellationToken);
            }
        }

        throw lastError ?? new InvalidOperationException("Summarizer returned empty output");
    }

    /// <summary>
    /// Builds the summarizer input with an independent character budget. Whole older
    /// messages are removed first; a single message may then be truncated as a last resort.
    /// </summary>
    internal static string BuildSummaryRequestBody(
        IReadOnlyList<AgentRuntimeChatMessage> messages,
        int charBudget)
    {
        return RenderTranscript(messages, Math.Max(1_024, charBudget));
    }

    /// <summary>
    /// Output ceiling for one summary call. A detailed briefing routinely needs far
    /// more than a provider's chat-tuned default, but must never exceed what the
    /// provider itself allows, so the two are clamped together.
    /// </summary>
    private static int SummaryOutputTokens(JsonElement provider)
    {
        var configuredMaxTokens = JsonHelpers.GetIntNullable(provider, "maxTokens") ?? SummaryMaxOutputTokens;
        return Math.Min(
            SummaryMaxOutputTokens,
            configuredMaxTokens > 0 ? configuredMaxTokens : SummaryMaxOutputTokens);
    }

    /// <summary>
    /// Calls Anthropic Messages API for summarization (no tools, no streaming).
    /// </summary>
    private static async Task<string> CallAnthropicSummary(
        string transcript,
        JsonElement provider,
        CancellationToken ct,
        Func<string, ValueTask>? onSummaryDelta = null)
    {
        var model = JsonHelpers.GetString(provider, "model") ?? string.Empty;
        var apiKey = JsonHelpers.GetString(provider, "apiKey") ?? string.Empty;
        var baseUrl = (JsonHelpers.GetString(provider, "baseUrl") ?? "https://api.anthropic.com").Trim().TrimEnd('/');
        var url = $"{baseUrl}/v1/messages";

        var bodyJson = WorkerJsonHelper.BuildJsonString(w =>
        {
            w.WriteStartObject();
            w.WriteString("model", model);
            w.WriteNumber("max_tokens", SummaryOutputTokens(provider));
            if (onSummaryDelta is not null)
                w.WriteBoolean("stream", true);
            w.WriteString("system", SummarySystemPrompt);
            w.WritePropertyName("messages");
            w.WriteStartArray();
            w.WriteStartObject();
            w.WriteString("role", "user");
            w.WriteString("content", transcript);
            w.WriteEndObject();
            w.WriteEndArray();
            w.WriteEndObject();
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(bodyJson, Encoding.UTF8, "application/json");
        request.Headers.Add("x-api-key", apiKey);
        request.Headers.Add("anthropic-version", "2023-06-01");

        using var response = await Http.SendAsync(
            request,
            onSummaryDelta is null ? HttpCompletionOption.ResponseContentRead : HttpCompletionOption.ResponseHeadersRead,
            ct);
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"Anthropic summarization HTTP {response.StatusCode}: {errorBody}");
        }

        if (onSummaryDelta is null)
        {
            var responseJson = await response.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(responseJson);
            return string.Join("", doc.RootElement
                .GetProperty("content")
                .EnumerateArray()
                .Where(b => b.GetProperty("type").GetString() == "text")
                .Select(b => b.GetProperty("text").GetString() ?? ""));
        }

        var summary = new StringBuilder();
        await using var responseStream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(responseStream, Encoding.UTF8);
        var dataBuilder = new StringBuilder();
        var rawResponseBuilder = new StringBuilder();
        var sawSsePayload = false;
        string? line;
        while ((line = await reader.ReadLineAsync(ct)) is not null)
        {
            if (line.Length == 0)
            {
                if (dataBuilder.Length > 0)
                {
                    await AppendAnthropicSummaryDeltaAsync(dataBuilder.ToString(), summary, onSummaryDelta);
                    dataBuilder.Clear();
                }
                continue;
            }

            if (line.StartsWith("data:", StringComparison.Ordinal))
            {
                sawSsePayload = true;
                if (dataBuilder.Length > 0) dataBuilder.Append('\n');
                dataBuilder.Append(line[5..].TrimStart());
            }
            else if (!line.StartsWith("event:", StringComparison.Ordinal))
            {
                if (rawResponseBuilder.Length > 0) rawResponseBuilder.Append('\n');
                rawResponseBuilder.Append(line);
            }
        }
        if (dataBuilder.Length > 0)
            await AppendAnthropicSummaryDeltaAsync(dataBuilder.ToString(), summary, onSummaryDelta);
        if (!sawSsePayload && rawResponseBuilder.Length > 0)
        {
            var fallback = ParseAnthropicSummaryResponse(rawResponseBuilder.ToString());
            if (!string.IsNullOrEmpty(fallback))
            {
                summary.Append(fallback);
                await onSummaryDelta(fallback);
            }
        }
        return summary.ToString();
    }

    private static string ParseAnthropicSummaryResponse(string responseJson)
    {
        using var doc = JsonDocument.Parse(responseJson);
        return string.Join("", doc.RootElement
            .GetProperty("content")
            .EnumerateArray()
            .Where(b => b.GetProperty("type").GetString() == "text")
            .Select(b => b.GetProperty("text").GetString() ?? ""));
    }

    private static async Task AppendAnthropicSummaryDeltaAsync(
        string data,
        StringBuilder summary,
        Func<string, ValueTask> onSummaryDelta)
    {
        if (data == "[DONE]") return;
        using var doc = JsonDocument.Parse(data);
        var root = doc.RootElement;
        if (JsonHelpers.GetString(root, "type") != "content_block_delta" ||
            !root.TryGetProperty("delta", out var delta) ||
            JsonHelpers.GetString(delta, "type") != "text_delta")
            return;
        var text = JsonHelpers.GetString(delta, "text");
        if (string.IsNullOrEmpty(text)) return;
        summary.Append(text);
        await onSummaryDelta(text);
    }

    /// <summary>
    /// Calls OpenAI Chat Completions API for summarization (no tools).
    /// </summary>
    private static async Task<string> CallOpenAISummary(
        string transcript,
        JsonElement provider,
        CancellationToken ct,
        Func<string, ValueTask>? onSummaryDelta = null)
    {
        var model = JsonHelpers.GetString(provider, "model") ?? string.Empty;
        var apiKey = JsonHelpers.GetString(provider, "apiKey") ?? string.Empty;
        // Mirror OpenAIChatProvider's URL convention: baseUrl already includes
        // the version segment (default https://api.openai.com/v1), so append
        // /chat/completions directly — appending another /v1 here produced
        // .../v1/v1/chat/completions and 404s on versioned gateways (e.g. Gemini's
        // OpenAI-compatible endpoint), degrading every summary to mechanical fold.
        var baseUrl = (JsonHelpers.GetString(provider, "baseUrl") ?? "https://api.openai.com/v1").Trim().TrimEnd('/');
        var url = $"{baseUrl}/chat/completions";

        var bodyJson = WorkerJsonHelper.BuildJsonString(w =>
        {
            w.WriteStartObject();
            w.WriteString("model", model);
            w.WriteNumber("max_tokens", SummaryOutputTokens(provider));
            if (onSummaryDelta is not null)
                w.WriteBoolean("stream", true);
            w.WritePropertyName("messages");
            w.WriteStartArray();
            w.WriteStartObject();
            w.WriteString("role", "system");
            w.WriteString("content", SummarySystemPrompt);
            w.WriteEndObject();
            w.WriteStartObject();
            w.WriteString("role", "user");
            w.WriteString("content", transcript);
            w.WriteEndObject();
            w.WriteEndArray();
            w.WriteEndObject();
        });

        using var request = new HttpRequestMessage(HttpMethod.Post, url);
        request.Content = new StringContent(bodyJson, Encoding.UTF8, "application/json");
        request.Headers.Add("Authorization", $"Bearer {apiKey}");

        using var response = await Http.SendAsync(
            request,
            onSummaryDelta is null ? HttpCompletionOption.ResponseContentRead : HttpCompletionOption.ResponseHeadersRead,
            ct);
        if (!response.IsSuccessStatusCode)
        {
            var errorBody = await response.Content.ReadAsStringAsync(ct);
            throw new InvalidOperationException($"OpenAI summarization HTTP {response.StatusCode}: {errorBody}");
        }

        if (onSummaryDelta is null)
        {
            var responseJson = await response.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(responseJson);
            return doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString() ?? "";
        }

        var summary = new StringBuilder();
        await using var responseStream = await response.Content.ReadAsStreamAsync(ct);
        using var reader = new StreamReader(responseStream, Encoding.UTF8);
        var dataBuilder = new StringBuilder();
        var rawResponseBuilder = new StringBuilder();
        var sawSsePayload = false;
        string? line;
        while ((line = await reader.ReadLineAsync(ct)) is not null)
        {
            if (line.Length == 0)
            {
                if (dataBuilder.Length > 0)
                {
                    await AppendOpenAISummaryDeltaAsync(dataBuilder.ToString(), summary, onSummaryDelta);
                    dataBuilder.Clear();
                }
                continue;
            }
            if (line.StartsWith("data:", StringComparison.Ordinal))
            {
                sawSsePayload = true;
                if (dataBuilder.Length > 0) dataBuilder.Append('\n');
                dataBuilder.Append(line[5..].TrimStart());
            }
            else if (!line.StartsWith("event:", StringComparison.Ordinal))
            {
                if (rawResponseBuilder.Length > 0) rawResponseBuilder.Append('\n');
                rawResponseBuilder.Append(line);
            }
        }
        if (dataBuilder.Length > 0)
            await AppendOpenAISummaryDeltaAsync(dataBuilder.ToString(), summary, onSummaryDelta);
        if (!sawSsePayload && rawResponseBuilder.Length > 0)
        {
            var fallback = ParseOpenAISummaryResponse(rawResponseBuilder.ToString());
            if (!string.IsNullOrEmpty(fallback))
            {
                summary.Append(fallback);
                await onSummaryDelta(fallback);
            }
        }
        return summary.ToString();
    }

    private static string ParseOpenAISummaryResponse(string responseJson)
    {
        using var doc = JsonDocument.Parse(responseJson);
        return doc.RootElement
            .GetProperty("choices")[0]
            .GetProperty("message")
            .GetProperty("content")
            .GetString() ?? "";
    }

    private static async Task AppendOpenAISummaryDeltaAsync(
        string data,
        StringBuilder summary,
        Func<string, ValueTask> onSummaryDelta)
    {
        if (data == "[DONE]") return;
        using var doc = JsonDocument.Parse(data);
        var root = doc.RootElement;
        if (!root.TryGetProperty("choices", out var choices) ||
            choices.ValueKind != JsonValueKind.Array ||
            choices.GetArrayLength() == 0)
            return;
        var choice = choices[0];
        if (!choice.TryGetProperty("delta", out var delta)) return;
        var text = JsonHelpers.GetString(delta, "content");
        if (string.IsNullOrEmpty(text)) return;
        summary.Append(text);
        await onSummaryDelta(text);
    }

    // ── Mechanical fold (fallback) ──

    /// <summary>
    /// Deterministic stand-in used when the summarizer is unreachable.
    /// </summary>
    private static string MechanicalFoldDigest(int messageCount)
    {
        return $"{messageCount} earlier message(s) were folded here to free context, " +
               "but the automatic summary was unavailable. " +
               "Ask the user if you need details from before this point.";
    }

}
