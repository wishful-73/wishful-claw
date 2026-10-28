using System.Buffers;
using System.Diagnostics;
using System.Net;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// Reasoning-details accumulation (OpenRouter streaming fragments) and its private accumulator. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
internal static partial class OpenAIChatProvider
{
    private static void AppendReasoningDetails(JsonElement element, List<ReasoningDetailAccumulator> destination)
    {
        if (!element.TryGetProperty("reasoning_details", out var details) ||
            details.ValueKind != JsonValueKind.Array)
        {
            return;
        }

        foreach (var detail in details.EnumerateArray())
        {
            MergeReasoningDetail(detail, destination);
        }
    }

    /// <summary>
    /// Merges a streaming reasoning_details fragment into the accumulated details.
    /// OpenRouter emits one fragment per delta; fragments sharing the same index
    /// must be merged before being passed back on the next request:
    /// reasoning.text concatenates text, reasoning.encrypted concatenates base64 data.
    /// Non-streaming responses already arrive merged and are adopted as-is.
    /// </summary>
    private static void MergeReasoningDetail(JsonElement detail, List<ReasoningDetailAccumulator> destination)
    {
        if (detail.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var index = JsonHelpers.GetInt(detail, "index", 0);
        var existing = destination.FirstOrDefault(acc => acc.Index == index);
        if (existing is null)
        {
            existing = new ReasoningDetailAccumulator(index);
            destination.Add(existing);
        }
        existing.Absorb(detail);
    }

    private sealed class ReasoningDetailAccumulator
    {
        private readonly StringBuilder _text = new();
        private readonly StringBuilder _data = new();

        public ReasoningDetailAccumulator(int index)
        {
            Index = index;
        }

        public int Index { get; }
        public string Type { get; private set; } = string.Empty;
        public string Format { get; private set; } = string.Empty;
        public bool IsSummary { get; private set; }

        public void Absorb(JsonElement detail)
        {
            if (JsonHelpers.GetString(detail, "type") is { Length: > 0 } type)
            {
                Type = type;
            }
            if (JsonHelpers.GetString(detail, "format") is { } format)
            {
                Format = format;
            }
            if (detail.TryGetProperty("summary", out var summary) &&
                summary.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                IsSummary = summary.GetBoolean();
            }

            if (JsonHelpers.GetString(detail, "text") is { } text)
            {
                _text.Append(text);
            }
            if (JsonHelpers.GetString(detail, "data") is { } data)
            {
                _data.Append(data);
            }
        }

        public JsonElement ToJsonElement()
        {
            return AgentRuntimeProviderSupport.CreateObjectElement(writer =>
            {
                writer.WriteString("type", Type);
                if (_text.Length > 0)
                {
                    writer.WriteString("text", _text.ToString());
                }
                if (_data.Length > 0)
                {
                    writer.WriteString("data", _data.ToString());
                }
                writer.WriteString("format", Format);
                writer.WriteNumber("index", Index);
                if (IsSummary)
                {
                    writer.WriteBoolean("summary", true);
                }
            });
        }
    }
}
