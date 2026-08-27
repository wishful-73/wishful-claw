using System.Text.Json;
using WishfulClaw.Contracts;

namespace WishfulClaw.Agent;

/// <summary>
/// Executes the skill management tool (list_installed_skills)
/// by routing to the renderer via reverse-request.
/// </summary>
public static class AgentRuntimeSkillManagementExecutor
{
    private static readonly HashSet<string> SkillManagementTools = new(StringComparer.Ordinal)
    {
        "list_installed_skills"
    };

    public static bool IsSkillManagementTool(string toolName)
    {
        return SkillManagementTools.Contains(toolName);
    }

    public static async Task<string> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await AgentRuntimeReverseRequests.RequestAsync(
                context,
                "skill-management:execute",
                CreateRequestPayload(call),
                cancellationToken);

            return result.ValueKind == JsonValueKind.String
                ? result.GetString() ?? string.Empty
                : result.ToString();
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            return $$"""{"error":"Skill management tool execution failed: {{ex.Message}}"}""";
        }
    }

    private static JsonElement CreateRequestPayload(AgentRuntimeNativeToolCall call)
    {
        var element = WorkerJsonHelper.BuildJsonElement(w =>
        {
            w.WriteStartObject();
            w.WriteString("toolName", call.Name);
            w.WritePropertyName("input");
            call.Input.WriteTo(w);
            w.WriteEndObject();
        });
        return element;
    }
}
