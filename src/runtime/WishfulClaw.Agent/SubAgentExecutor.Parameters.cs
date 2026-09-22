using System.Buffers;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

public static partial class SubAgentExecutor
{

    private static SubAgentDefinition? ResolveDefinition(
        string subAgentType,
        JsonElement parameters,
        JsonElement input)
    {
        if (string.Equals(subAgentType, CustomSubAgentType, StringComparison.OrdinalIgnoreCase))
        {
            var workingFolder = JsonHelpers.GetString(parameters, "workingFolder");
            return SubAgentDefinitionLoader.CreateCustomDefinition(workingFolder);
        }

        if (subAgentType is "goal-decomposer" or "goal-evaluator" or "goal-orchestrator" or "task-decomposer")
        {
            var systemPrompt = JsonHelpers.GetString(input, "systemPrompt")
                ?? "Return only the requested structured JSON.";
            return SubAgentDefinitionLoader.CreateStructuredDefinition(
                subAgentType,
                "Goal structured response agent",
                systemPrompt);
        }

        // Look up in the in-memory registry (populated at startup)
        return SubAgentRegistry.Get(subAgentType);
    }

    // ── Child parameter building ──

    internal static JsonElement BuildChildParameters(
        JsonElement parentParameters,
        SubAgentDefinition definition,
        string prompt,
        int childDepth,
        string sessionMode = "subAgent",
        string? goalContextId = null)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer, WriteOptions))
        {
            writer.WriteStartObject();

            // Copy all properties from parent, except messages (will be replaced)
            // and personaId/userRules (sub-agent uses its own system prompt)
            foreach (var prop in parentParameters.EnumerateObject())
            {
                if (prop.NameEquals("messages") ||
                    prop.NameEquals("personaId") ||
                    prop.NameEquals("userRules") ||
                    prop.NameEquals("providerTurnOnly") ||
                    prop.NameEquals("runtimeRole") ||
                    prop.NameEquals("maxIterations"))   // ← 新增：下面统一恒写 0，避免重复键
                {
                    continue;
                }
                prop.WriteTo(writer);
            }

            // ⚠️ 恒写 0 = 不限轮次（iter-34 S-132）。definition.MaxTurns 已降级为「轮次提醒点」，
            // 不再作为硬截断依据 —— 它曾在这里直接送进 maxIterations，撞上限即被掐断且状态仍报
            // completed，产出全丢。防跑飞由轮次提醒（AgentLoop.SubAgentReminder）与父 run 的
            // 取消令牌承担，与 goalSubAgent 一路（GoalSubAgentExecutor.cs:107）保持一致。
            writer.WriteNumber("maxIterations", 0);
            if (definition.ProviderTurnOnly)
                writer.WriteBoolean("providerTurnOnly", true);

            // Set sub-agent depth for recursion control
            writer.WriteNumber("subAgentDepth", childDepth);

            // Sub-agents use "subAgent" mode - they should not inherit
            // plan tools (normal mode) or goal tools (goal mode)
            writer.WriteString("sessionMode", sessionMode);
            writer.WriteString("runtimeRole", string.Equals(sessionMode, "goalSubAgent", StringComparison.OrdinalIgnoreCase)
                ? "goalSubAgent"
                : "subAgent");
            if (!string.IsNullOrWhiteSpace(goalContextId))
                writer.WriteString("goalContextId", goalContextId);

            // Override system prompt in provider
            var provider = AgentLoop.GetObject(parentParameters, "provider");
            if (provider.ValueKind == JsonValueKind.Object)
            {
                writer.WritePropertyName("provider");
                writer.WriteStartObject();
                var hasSystemPrompt = false;
                foreach (var prop in provider.EnumerateObject())
                {
                    if (prop.NameEquals("systemPrompt"))
                    {
                        writer.WriteString("systemPrompt", definition.SystemPrompt);
                        hasSystemPrompt = true;
                    }
                    else if (prop.NameEquals("model") && !string.IsNullOrWhiteSpace(definition.Model))
                    {
                        writer.WriteString("model", definition.Model);
                    }
                    else if (prop.NameEquals("temperature") && definition.Temperature.HasValue)
                    {
                        writer.WriteNumber("temperature", definition.Temperature.Value);
                    }
                    else
                    {
                        prop.WriteTo(writer);
                    }
                }
                if (!hasSystemPrompt)
                {
                    writer.WriteString("systemPrompt", definition.SystemPrompt);
                }
                writer.WriteEndObject();
            }

            // Build messages array with just the user prompt
            writer.WritePropertyName("messages");
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("id", $"wc_subagent_{Guid.NewGuid():N}");
            writer.WriteString("role", "user");
            writer.WritePropertyName("content");
            writer.WriteStartArray();
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString("text", prompt);
            writer.WriteEndObject();
            // System reminder: final message is the report
            writer.WriteStartObject();
            writer.WriteString("type", "text");
            writer.WriteString(
                "text",
                "<system-reminder>\n" +
                "Your final assistant message is returned verbatim to the parent agent as the task report.\n" +
                "The parent agent relies on this report to answer follow-up questions from the user, " +
                "so it MUST be self-contained and include:\n" +
                "- What you did and why\n" +
                "- Key findings or information discovered\n" +
                "- What was modified (file names, specific changes)\n" +
                "- Any problems encountered and how they were resolved\n" +
                "Do NOT just say \"done\" or \"completed\" — the parent agent must be able to answer " +
                "questions like \"what files were read?\" or \"what was changed?\" from your report alone.\n" +
                "Do not call tools after writing that final report.\n" +
                "</system-reminder>");
            writer.WriteEndObject();
            writer.WriteEndArray();
            writer.WriteNumber("createdAt", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            writer.WriteEndObject();
            writer.WriteEndArray();

            writer.WriteEndObject();
        }

        using var document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    // ── Prompt building ──
}
