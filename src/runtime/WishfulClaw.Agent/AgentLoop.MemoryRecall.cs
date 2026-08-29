using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Workspace.Memory;

namespace WishfulClaw.Agent;

/// <summary>
/// Memory recall injection — runs on iteration 1 to search memories
/// and inject relevant results as an untrusted user message.
/// </summary>
internal static partial class AgentLoop
{
    /// <summary>
    /// Searches memory for relevant entries based on the latest user message
    /// and injects them into the conversation as untrusted reference data.
    /// </summary>
    private static async Task TryInjectMemoryRecallAsync(
        JsonElement parameters,
        List<AgentRuntimeChatMessage> conversation,
        SessionConversation sessionConversation,
        AgentRuntimeRunState state,
        IWorkerRequestContext context)
    {
        try
        {
            var memorySearch = ToolModuleState.MemorySearch;
            if (memorySearch is null)
                return;

            var userMessage = conversation
                .Where(m => m.Role == "user")
                .Select(m => m.Text)
                .LastOrDefault();

            if (string.IsNullOrWhiteSpace(userMessage))
                return;

            var projectId = JsonHelpers.GetString(parameters, "projectId");
            var sshConnectionId = JsonHelpers.GetString(parameters, "sshConnectionId");
            var workingFolder = JsonHelpers.GetString(parameters, "workingFolder");

            string scope;
            if (!string.IsNullOrWhiteSpace(sshConnectionId))
            {
                var scopeId = !string.IsNullOrWhiteSpace(projectId) ? projectId : sshConnectionId;
                scope = $"project:ssh:{scopeId}";
            }
            else if (!string.IsNullOrWhiteSpace(workingFolder))
            {
                scope = $"project:{workingFolder}";
            }
            else
            {
                scope = "global";
            }

            var recall = new MemoryRecallService(
                memorySearch,
                new ContextBudgetPlanner(),
                memorySearch as IMemoryReheat);

            // Recall tuning comes from renderer settings via run params;
            // defaults preserve the previous hard-coded behaviour.
            var maxNotes = JsonHelpers.GetInt(parameters, "memoryRecallMaxNotes", 5);
            var maxChars = JsonHelpers.GetInt(parameters, "memoryRecallMaxChars", 4000);
            var minScore = JsonHelpers.GetDoubleNullable(parameters, "memoryRecallMinScore") ?? 0;
            var globalFallback = JsonHelpers.GetBool(parameters, "memoryRecallGlobalFallback", true);

            bool ShouldInject(MemorySearchResult hit)
            {
                var fingerprint = CreateMemoryFingerprint(hit);
                return sessionConversation.NeedsMemoryInjection(hit.Id, fingerprint);
            }

            var outcome = await recall.TryInjectRecallAsync(
                userMessage, scope,
                maxChars: maxChars, maxNotes: maxNotes,
                minScore: minScore, globalFallback: globalFallback,
                state.CancellationToken,
                candidateFilter: ShouldInject);

            var injected = outcome.InjectedText;
            if (!string.IsNullOrWhiteSpace(injected))
            {
                var recallBlock = $"<memory-recall>\n{injected}\n</memory-recall>\n\n";
                state.PendingMemoryRecall = recallBlock;
                
                // Inject directly into the conversation's last user message,
                // BEFORE the <current_time> block that InjectTransientPrefix added.
                var injectedIntoConversation = false;
                for (var i = conversation.Count - 1; i >= 0; i--)
                {
                    if (conversation[i].Role == "user" && conversation[i].ToolResults.Count == 0)
                    {
                        conversation[i] = conversation[i] with { Text = recallBlock + conversation[i].Text };
                        injectedIntoConversation = true;
                        break;
                    }
                }

                if (injectedIntoConversation)
                {
                    foreach (var hit in outcome.InjectedHits)
                        sessionConversation.MarkMemoryInjected(hit.Id, CreateMemoryFingerprint(hit));
                }
                WorkerLog.Info($"memory recall injected runId={state.RunId} hits={outcome.InjectedHits.Count} length={injected.Length}");
            }
            else
            {
                WorkerLog.Info($"memory recall: nothing injected runId={state.RunId} reason={outcome.Reason}");
            }

            // Recall diagnostics event. Off → no event metadata is emitted.
            if (JsonHelpers.GetBool(parameters, "memoryRecallVisibility", true))
            {
                var hits = outcome.InjectedHits
                    .Select(h => string.IsNullOrWhiteSpace(h.Title) ? $"#{h.Id}" : h.Title)
                    .ToArray();
                await AgentRuntimeTools.EmitAsync(state, context, new AgentRuntimeStreamEvent(
                    "memory_recall",
                    Reason: outcome.Reason,
                    RecallCount: outcome.InjectedHits.Count,
                    RecallHits: hits));
            }
        }
        catch (OperationCanceledException) when (state.CancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            WorkerLog.Warn($"memory recall injection failed runId={state.RunId} error={ex.GetType().Name}: {ex.Message}");
        }
    }

    private static string CreateMemoryFingerprint(MemorySearchResult hit)
    {
        var payload = $"{hit.Scope}\u001f{hit.Title}\u001f{hit.Content}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
    }
}
