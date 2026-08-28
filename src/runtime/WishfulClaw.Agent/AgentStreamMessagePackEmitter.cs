/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Encodes AgentRuntimeStreamEnvelope into a WorkerMessagePackEvent.
/// Uses the existing WorkerMessagePackWriter for low-level MessagePack encoding.
/// Field names are camelCase to match the frontend decoder.
/// </summary>
public static class AgentStreamMessagePackEmitter
{
    private const string EventName = "agent/stream";

    public static WorkerMessagePackEvent Encode(AgentRuntimeStreamEnvelope envelope)
    {
        var writer = new WorkerMessagePackWriter();

        writer.WriteMapHeader(6);
        writer.WriteString("event");
        writer.WriteString(EventName);
        writer.WriteString("v");
        writer.WriteInt64(envelope.V);
        writer.WriteString("runId");
        writer.WriteString(envelope.RunId);
        writer.WriteString("sessionId");
        writer.WriteString(envelope.SessionId);
        writer.WriteString("seq");
        writer.WriteInt64(envelope.Seq);
        writer.WriteString("events");
        WriteEvents(writer, envelope.Events);

        return new WorkerMessagePackEvent(EventName, writer.ToArray());
    }

    private static void WriteEvents(WorkerMessagePackWriter writer, AgentRuntimeStreamEvent[] events)
    {
        writer.WriteArrayHeader(events.Length);
        foreach (var streamEvent in events)
        {
            WriteEvent(writer, streamEvent);
        }
    }

    private static void WriteEvent(WorkerMessagePackWriter writer, AgentRuntimeStreamEvent streamEvent)
    {
        writer.WriteMapHeader(CountEventProperties(streamEvent));
        writer.WriteString("type");
        writer.WriteString(streamEvent.Type);

        WriteOptionalInt(writer, "iteration", streamEvent.Iteration);
        WriteOptionalString(writer, "reason", streamEvent.Reason);
        WriteOptionalString(writer, "stopReason", streamEvent.StopReason);
        WriteOptionalString(writer, "text", streamEvent.Text);
        WriteOptionalString(writer, "thinking", streamEvent.Thinking);
        WriteOptionalString(writer, "message", streamEvent.Message);
        WriteOptionalString(writer, "content", streamEvent.Content);
        WriteOptionalString(writer, "provider", streamEvent.Provider);
        WriteOptionalString(writer, "errorType", streamEvent.ErrorType);
        WriteOptionalString(writer, "details", streamEvent.Details);
        WriteOptionalString(writer, "stackTrace", streamEvent.StackTrace);
        WriteOptionalString(writer, "toolCallId", streamEvent.ToolCallId);
        WriteOptionalString(writer, "toolName", streamEvent.ToolName);
        WriteOptionalJson(writer, "partialInput", streamEvent.PartialInput);
        WriteOptionalToolUseBlock(writer, streamEvent.ToolUseBlock);
        WriteOptionalToolCall(writer, streamEvent.ToolCall);
        WriteOptionalToolResults(writer, streamEvent.ToolResults);
        WriteOptionalDebugInfo(writer, streamEvent.DebugInfo);
        WriteOptionalUsage(writer, streamEvent.Usage);
        WriteOptionalTiming(writer, streamEvent.Timing);
        WriteOptionalString(writer, "providerResponseId", streamEvent.ProviderResponseId);
        WriteOptionalString(writer, "operationId", streamEvent.OperationId);
        WriteOptionalInt(writer, "originalCount", streamEvent.OriginalCount);
        WriteOptionalInt(writer, "newCount", streamEvent.NewCount);
        WriteOptionalInt(writer, "keptMessageCount", streamEvent.KeptMessageCount);
        WriteOptionalString(writer, "trigger", streamEvent.Trigger);
        WriteOptionalString(writer, "compressionStatus", streamEvent.CompressionStatus);
        WriteOptionalInt(writer, "preTokens", streamEvent.PreTokens);
        WriteOptionalBool(writer, "summarizerFailed", streamEvent.SummarizerFailed);
        WriteOptionalInt(writer, "messagesSummarized", streamEvent.MessagesSummarized);
        WriteOptionalString(writer, "error", streamEvent.CompressionError);
        WriteOptionalMessages(writer, "compactArtifacts", streamEvent.CompactArtifacts);
        WriteOptionalMessages(writer, "messages", streamEvent.Messages);
        WriteOptionalString(writer, "toolUseId", streamEvent.ToolUseId);
        WriteOptionalInt(writer, "attempt", streamEvent.Attempt);
        WriteOptionalInt(writer, "maxAttempts", streamEvent.MaxAttempts);
        WriteOptionalInt(writer, "delayMs", streamEvent.DelayMs);
        WriteOptionalInt(writer, "statusCode", streamEvent.StatusCode);
        // Sub-agent fields
        WriteOptionalString(writer, "subAgentName", streamEvent.SubAgentName);
        WriteOptionalString(writer, "report", streamEvent.Report);
        WriteOptionalString(writer, "status", streamEvent.Status);
        WriteOptionalJson(writer, "input", streamEvent.Input);
        WriteOptionalJson(writer, "promptMessage", streamEvent.PromptMessage);
        WriteOptionalJson(writer, "result", streamEvent.Result);
        // Memory recall visibility
        WriteOptionalInt(writer, "recallCount", streamEvent.RecallCount);
        WriteOptionalStringArray(writer, "recallHits", streamEvent.RecallHits);
    }

    private static int CountEventProperties(AgentRuntimeStreamEvent streamEvent)
    {
        var count = 1; // type
        if (streamEvent.Iteration.HasValue) count++;
        if (streamEvent.Reason is not null) count++;
        if (streamEvent.StopReason is not null) count++;
        if (streamEvent.Text is not null) count++;
        if (streamEvent.Thinking is not null) count++;
        if (streamEvent.Message is not null) count++;
        if (streamEvent.Content is not null) count++;
        if (streamEvent.Provider is not null) count++;
        if (streamEvent.ErrorType is not null) count++;
        if (streamEvent.Details is not null) count++;
        if (streamEvent.StackTrace is not null) count++;
        if (streamEvent.ToolCallId is not null) count++;
        if (streamEvent.ToolName is not null) count++;
        if (HasJson(streamEvent.PartialInput)) count++;
        if (streamEvent.ToolUseBlock is not null) count++;
        if (streamEvent.ToolCall is not null) count++;
        if (streamEvent.ToolResults is not null) count++;
        if (streamEvent.DebugInfo is not null) count++;
        if (streamEvent.Usage is not null) count++;
        if (streamEvent.Timing is not null) count++;
        if (streamEvent.ProviderResponseId is not null) count++;
        if (streamEvent.OperationId is not null) count++;
        if (streamEvent.OriginalCount.HasValue) count++;
        if (streamEvent.NewCount.HasValue) count++;
        if (streamEvent.KeptMessageCount.HasValue) count++;
        if (streamEvent.Trigger is not null) count++;
        if (streamEvent.CompressionStatus is not null) count++;
        if (streamEvent.PreTokens.HasValue) count++;
        if (streamEvent.SummarizerFailed.HasValue) count++;
        if (streamEvent.MessagesSummarized.HasValue) count++;
        if (streamEvent.CompressionError is not null) count++;
        if (streamEvent.CompactArtifacts is not null) count++;
        if (streamEvent.Messages is not null) count++;
        if (streamEvent.ToolUseId is not null) count++;
        if (streamEvent.Attempt.HasValue) count++;
        if (streamEvent.MaxAttempts.HasValue) count++;
        if (streamEvent.DelayMs.HasValue) count++;
        if (streamEvent.StatusCode.HasValue) count++;
        // Sub-agent fields
        if (streamEvent.SubAgentName is not null) count++;
        if (streamEvent.Report is not null) count++;
        if (streamEvent.Status is not null) count++;
        if (HasJson(streamEvent.Input)) count++;
        if (HasJson(streamEvent.PromptMessage)) count++;
        if (HasJson(streamEvent.Result)) count++;
        // Memory recall visibility
        if (streamEvent.RecallCount.HasValue) count++;
        if (streamEvent.RecallHits is not null) count++;
        return count;
    }

    // ── Optional field writers ──

    private static void WriteOptionalInt(WorkerMessagePackWriter writer, string name, int? value)
    {
        if (!value.HasValue) return;
        writer.WriteString(name);
        writer.WriteInt64(value.Value);
    }

    private static void WriteOptionalString(WorkerMessagePackWriter writer, string name, string? value)
    {
        if (value is null) return;
        writer.WriteString(name);
        writer.WriteString(value);
    }

    private static void WriteOptionalBool(WorkerMessagePackWriter writer, string name, bool? value)
    {
        if (!value.HasValue) return;
        writer.WriteString(name);
        writer.WriteBoolean(value.Value);
    }

    private static void WriteOptionalStringArray(WorkerMessagePackWriter writer, string name, string[]? values)
    {
        if (values is null) return;
        writer.WriteString(name);
        writer.WriteArrayHeader(values.Length);
        foreach (var value in values)
        {
            writer.WriteString(value);
        }
    }

    private static void WriteOptionalJson(WorkerMessagePackWriter writer, string name, JsonElement? value)
    {
        if (!value.HasValue || value.Value.ValueKind == JsonValueKind.Undefined) return;
        writer.WriteString(name);
        writer.WriteJsonElement(value.GetValueOrDefault());
    }

    private static void WriteOptionalToolUseBlock(WorkerMessagePackWriter writer, AgentRuntimeToolUseBlock? block)
    {
        if (block is null) return;
        writer.WriteString("toolUseBlock");
        writer.WriteMapHeader(HasJson(block.ExtraContent) ? 4 : 3);
        writer.WriteString("id");
        writer.WriteString(block.Id);
        writer.WriteString("name");
        writer.WriteString(block.Name);
        writer.WriteString("input");
        writer.WriteJsonElement(block.Input);
        WriteOptionalJson(writer, "extraContent", block.ExtraContent);
    }

    private static void WriteOptionalToolCall(WorkerMessagePackWriter writer, AgentRuntimeToolCallState? toolCall)
    {
        if (toolCall is null) return;
        writer.WriteString("toolCall");
        WriteToolCall(writer, toolCall);
    }

    private static void WriteToolCall(WorkerMessagePackWriter writer, AgentRuntimeToolCallState toolCall)
    {
        writer.WriteMapHeader(CountToolCallProperties(toolCall));
        writer.WriteString("id");
        writer.WriteString(toolCall.Id);
        writer.WriteString("name");
        writer.WriteString(toolCall.Name);
        writer.WriteString("input");
        writer.WriteJsonElement(toolCall.Input);
        writer.WriteString("status");
        writer.WriteString(toolCall.Status);
        WriteOptionalJson(writer, "output", toolCall.Output);
        WriteOptionalString(writer, "error", toolCall.Error);
        writer.WriteString("requiresApproval");
        writer.WriteBoolean(toolCall.RequiresApproval);
        if (toolCall.StartedAt.HasValue)
        {
            writer.WriteString("startedAt");
            writer.WriteInt64(toolCall.StartedAt.Value);
        }
        if (toolCall.CompletedAt.HasValue)
        {
            writer.WriteString("completedAt");
            writer.WriteInt64(toolCall.CompletedAt.Value);
        }
    }

    private static int CountToolCallProperties(AgentRuntimeToolCallState toolCall)
    {
        var count = 5; // id, name, input, status, requiresApproval
        if (HasJson(toolCall.Output)) count++;
        if (toolCall.Error is not null) count++;
        if (toolCall.StartedAt.HasValue) count++;
        if (toolCall.CompletedAt.HasValue) count++;
        return count;
    }

    private static void WriteOptionalToolResults(WorkerMessagePackWriter writer, AgentRuntimeToolResult[]? results)
    {
        if (results is null) return;
        writer.WriteString("toolResults");
        writer.WriteArrayHeader(results.Length);
        foreach (var result in results)
        {
            writer.WriteMapHeader(result.IsError.HasValue ? 3 : 2);
            writer.WriteString("toolUseId");
            writer.WriteString(result.ToolUseId);
            writer.WriteString("content");
            writer.WriteJsonElement(result.Content);
            if (result.IsError.HasValue)
            {
                writer.WriteString("isError");
                writer.WriteBoolean(result.IsError.Value);
            }
        }
    }

    private static void WriteOptionalDebugInfo(WorkerMessagePackWriter writer, AgentRuntimeRequestDebugInfo? debugInfo)
    {
        if (debugInfo is null) return;
        writer.WriteString("debugInfo");
        writer.WriteMapHeader(CountDebugInfoProperties(debugInfo));
        writer.WriteString("url");
        writer.WriteString(debugInfo.Url);
        writer.WriteString("method");
        writer.WriteString(debugInfo.Method);
        writer.WriteString("headers");
        writer.WriteMapHeader(debugInfo.Headers.Count);
        foreach (var item in debugInfo.Headers)
        {
            writer.WriteString(item.Key);
            writer.WriteString(item.Value);
        }
        WriteOptionalString(writer, "body", debugInfo.Body);
        writer.WriteString("timestamp");
        writer.WriteInt64(debugInfo.Timestamp);
        WriteOptionalString(writer, "providerId", debugInfo.ProviderId);
        WriteOptionalString(writer, "providerBuiltinId", debugInfo.ProviderBuiltinId);
        WriteOptionalString(writer, "model", debugInfo.Model);
        WriteOptionalString(writer, "executionPath", debugInfo.ExecutionPath);
        WriteOptionalString(writer, "transport", debugInfo.Transport);
        WriteOptionalString(writer, "bodyRef", debugInfo.BodyRef);
        if (debugInfo.BodyBytes.HasValue)
        {
            writer.WriteString("bodyBytes");
            writer.WriteInt64(debugInfo.BodyBytes.Value);
        }
    }

    private static int CountDebugInfoProperties(AgentRuntimeRequestDebugInfo debugInfo)
    {
        var count = 4; // url, method, headers, timestamp
        if (debugInfo.Body is not null) count++;
        if (debugInfo.ProviderId is not null) count++;
        if (debugInfo.ProviderBuiltinId is not null) count++;
        if (debugInfo.Model is not null) count++;
        if (debugInfo.ExecutionPath is not null) count++;
        if (debugInfo.Transport is not null) count++;
        if (debugInfo.BodyRef is not null) count++;
        if (debugInfo.BodyBytes.HasValue) count++;
        return count;
    }

    private static void WriteOptionalUsage(WorkerMessagePackWriter writer, AgentRuntimeTokenUsage? usage)
    {
        if (usage is null) return;
        writer.WriteString("usage");
        writer.WriteMapHeader(CountUsageProperties(usage));
        writer.WriteString("inputTokens");
        writer.WriteInt64(usage.InputTokens);
        writer.WriteString("outputTokens");
        writer.WriteInt64(usage.OutputTokens);
        WriteOptionalInt(writer, "billableInputTokens", usage.BillableInputTokens);
        WriteOptionalInt(writer, "cacheReadTokens", usage.CacheReadTokens);
        WriteOptionalInt(writer, "reasoningTokens", usage.ReasoningTokens);
        WriteOptionalInt(writer, "contextTokens", usage.ContextTokens);
        WriteOptionalInt(writer, "cacheCreationTokens", usage.CacheCreationTokens);
        WriteOptionalInt(writer, "cacheCreation5mTokens", usage.CacheCreation5mTokens);
        WriteOptionalInt(writer, "cacheCreation1hTokens", usage.CacheCreation1hTokens);
        if (usage.CacheReadRatio.HasValue)
        {
            writer.WriteString("cacheReadRatio");
            writer.WriteDouble(usage.CacheReadRatio.Value);
        }
        WriteOptionalInt(writer, "sessionCacheHitTokens", usage.SessionCacheHitTokens);
        WriteOptionalInt(writer, "sessionCacheMissTokens", usage.SessionCacheMissTokens);
        WriteOptionalString(writer, "usageSource", usage.UsageSource);
    }

    private static int CountUsageProperties(AgentRuntimeTokenUsage usage)
    {
        var count = 2; // inputTokens, outputTokens
        if (usage.BillableInputTokens.HasValue) count++;
        if (usage.CacheReadTokens.HasValue) count++;
        if (usage.ReasoningTokens.HasValue) count++;
        if (usage.ContextTokens.HasValue) count++;
        if (usage.CacheCreationTokens.HasValue) count++;
        if (usage.CacheCreation5mTokens.HasValue) count++;
        if (usage.CacheCreation1hTokens.HasValue) count++;
        if (usage.CacheReadRatio.HasValue) count++;
        if (usage.SessionCacheHitTokens.HasValue) count++;
        if (usage.SessionCacheMissTokens.HasValue) count++;
        if (usage.UsageSource is not null) count++;
        return count;
    }

    private static void WriteOptionalTiming(WorkerMessagePackWriter writer, AgentRuntimeRequestTiming? timing)
    {
        if (timing is null) return;
        writer.WriteString("timing");
        writer.WriteMapHeader(CountTimingProperties(timing));
        writer.WriteString("totalMs");
        writer.WriteInt64(timing.TotalMs);
        if (timing.TtftMs.HasValue)
        {
            writer.WriteString("ttftMs");
            writer.WriteInt64(timing.TtftMs.Value);
        }
        if (timing.Tps.HasValue)
        {
            writer.WriteString("tps");
            writer.WriteDouble(timing.Tps.Value);
        }
    }

    private static int CountTimingProperties(AgentRuntimeRequestTiming timing)
    {
        var count = 1; // totalMs
        if (timing.TtftMs.HasValue) count++;
        if (timing.Tps.HasValue) count++;
        return count;
    }

    private static void WriteOptionalMessages(WorkerMessagePackWriter writer, string name, JsonElement[]? messages)
    {
        if (messages is null) return;
        writer.WriteString(name);
        writer.WriteArrayHeader(messages.Length);
        foreach (var message in messages)
        {
            writer.WriteJsonElement(message);
        }
    }

    private static bool HasJson(JsonElement? value)
    {
        return value.HasValue && value.Value.ValueKind != JsonValueKind.Undefined;
    }
}
