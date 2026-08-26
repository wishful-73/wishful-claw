using System.Text.Json.Serialization;
using WishfulClaw.Contracts;
using WishfulClaw.Agent.Modules.Git;
using WishfulClaw.Agent.Modules.Extensions;

namespace WishfulClaw.Agent;

/// <summary>
/// Source-generated JsonSerializerContext for AgentRuntime types.
/// </summary>
[JsonSourceGenerationOptions(
    GenerationMode = JsonSourceGenerationMode.Metadata,
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
[JsonSerializable(typeof(GoalPlanItem))]
[JsonSerializable(typeof(List<GoalPlanItem>))]
[JsonSerializable(typeof(GoalToolGoal))]
[JsonSerializable(typeof(GoalToolProgress))]
[JsonSerializable(typeof(GoalToolResult))]
[JsonSerializable(typeof(GoalToolEvent))]
[JsonSerializable(typeof(List<GoalToolEvent>))]
[JsonSerializable(typeof(GoalToolPageResult))]
[JsonSerializable(typeof(GoalToolHistoryResult))]
[JsonSerializable(typeof(GoalActionResult))]
[JsonSerializable(typeof(GoalRunStateChanged))]
[JsonSerializable(typeof(GoalProgressErrorPayload))]
[JsonSerializable(typeof(AgentRuntimeReverseRequestEnvelope))]
[JsonSerializable(typeof(AgentRuntimeReverseCancelEnvelope))]
[JsonSerializable(typeof(AgentRuntimeReverseResponseResult))]
[JsonSerializable(typeof(AgentRuntimeRunResult))]
[JsonSerializable(typeof(AgentRuntimeCancelResult))]
[JsonSerializable(typeof(AgentRuntimeStopResult))]
[JsonSerializable(typeof(AgentRuntimeAppendMessagesResult))]
[JsonSerializable(typeof(AgentRuntimeDrainResult))]
[JsonSerializable(typeof(ClearSessionResult))]
[JsonSerializable(typeof(ProviderTestResult))]
[JsonSerializable(typeof(ProviderTestModelsResult))]
[JsonSerializable(typeof(ProviderModelInfo))]
[JsonSerializable(typeof(List<ProviderModelInfo>))]
[JsonSerializable(typeof(ProviderCompletionResult))]
[JsonSerializable(typeof(ProviderCompletionToolCall))]
[JsonSerializable(typeof(List<ProviderCompletionToolCall>))]
[JsonSerializable(typeof(SessionRestoreResponse))]
[JsonSerializable(typeof(GitExecResult))]
[JsonSerializable(typeof(GitStatusDetailedResult))]
[JsonSerializable(typeof(GitQueryResult))]
[JsonSerializable(typeof(GitRepositorySummary))]
[JsonSerializable(typeof(List<GitRepositorySummary>))]
[JsonSerializable(typeof(NativeExtensionToolExecutionResult))]
public sealed partial class AgentRuntimeJsonContext : JsonSerializerContext
{
}
