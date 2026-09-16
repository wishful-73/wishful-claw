using System.Text.Json;
using WishfulClaw.Agent;

namespace WishfulClaw.GoalRegressionTests;

internal static partial class Program
{
    /// <summary>
    /// 修复 T-7 未覆盖：配对错识别 + 常驻会话里悬空工具调用的修补。
    /// 契约：
    ///   1 识别 —— 只认明确在讲配对的文案，别的 400 一律放行给重试策略
    ///   2 修补 —— conversation 层与 wire 层各扫各的，缺的补占位、已有的不动
    ///   3 幂等 —— 修过再修返回 0，错误驱动分支据此判定「修不动就别空转」
    /// </summary>
    private static void RunToolPairingRepairSuite()
    {
        RunToolPairingErrorSuite();
        RunToolPairingRepairIdempotenceSuite();
        RunToolPairingLayerSuite();
    }

    /// <summary>
    /// 1 识别：文案来自各家 provider，判定必须只认「在讲配对」的那些。
    /// </summary>
    private static void RunToolPairingErrorSuite()
    {
        // 实测原文 —— Console Go 中转（OpenAI 协议），2026-09-16 生产库 request_usage_logs
        const string OpenAiActual =
            "OpenAI-compatible chat request failed HTTP 400: {\"error\":{\"message\":\"Error from provider " +
            "(Console Go): Upstream request failed: [invalid_request_error] An assistant message with " +
            "'tool_calls' must be followed by tool messages responding to each 'tool_call_id'. " +
            "(insufficient tool messages following tool_calls message)\"}}";

        Assert(ToolPairingErrors.IsToolPairingError(new Exception(OpenAiActual)),
            "openai tool_calls pairing error is recognised");

        Assert(ToolPairingErrors.IsToolPairingError(new Exception(
                "messages with role 'tool' must be a response to a preceding message with 'tool_calls'")),
            "orphan tool message is recognised");

        Assert(ToolPairingErrors.IsToolPairingError(new Exception(
                "messages.1: `tool_use` ids were found without `tool_result` blocks immediately after: " +
                "`tool_use` ids: [toolu_01A]. Each `tool_use` block must have a corresponding `tool_result` block")),
            "anthropic tool_use/tool_result mismatch is recognised");

        Assert(ToolPairingErrors.IsToolPairingError(new Exception(
                "tool_use ids were found without tool_result blocks")),
            "anthropic mismatch is recognised without backticks too");

        Assert(ToolPairingErrors.IsToolPairingError(
                new Exception("agent run failed", new InvalidOperationException(OpenAiActual))),
            "pairing error is recognised through InnerException");

        // 反面：不许把该走重试的 400 或无关错误截走
        Assert(!ToolPairingErrors.IsToolPairingError(new Exception(
                "OpenAI-compatible chat request failed HTTP 400: context_length_exceeded")),
            "context overflow is not a pairing error");

        Assert(!ToolPairingErrors.IsToolPairingError(new Exception("HTTP 400: invalid api key")),
            "unrelated 400 is not a pairing error");

        Assert(!ToolPairingErrors.IsToolPairingError(new Exception("connection reset by peer")),
            "transport error is not a pairing error");

        Assert(!ToolPairingErrors.IsToolPairingError(new Exception("")),
            "empty message is not a pairing error");
    }

    /// <summary>
    /// 2 修补 + 3 幂等：缺结果要补上、补在紧随其后的位置、按调用顺序、再修一次无事可做。
    /// </summary>
    private static void RunToolPairingRepairIdempotenceSuite()
    {
        // ── 缺结果：Initialize 时即被补齐 ──
        var dangling = new List<AgentRuntimeChatMessage>
        {
            AgentRuntimeChatMessage.User("do the thing"),
            new("assistant", "calling", [ToolUse("call_a"), ToolUse("call_b")], [])
        };
        var conversation = new SessionConversation();
        conversation.Initialize([], dangling);

        AssertEqual(3, dangling.Count, "dangling tool calls got a synthesised result message");
        AssertEqual(2, dangling[2].ToolResults.Count, "every dangling call is covered");
        AssertEqual("call_a", dangling[2].ToolResults[0].ToolUseId, "placeholder keeps call order (first)");
        AssertEqual("call_b", dangling[2].ToolResults[1].ToolUseId, "placeholder keeps call order (second)");
        AssertEqual(0, conversation.RepairToolPairing(), "repair is idempotent once the gap is closed");

        // ── 配对完整：一个字都不动 ──
        var paired = new List<AgentRuntimeChatMessage>
        {
            new("assistant", "calling", [ToolUse("call_x")], []),
            AgentRuntimeChatMessage.UserToolResults([ToolResult("call_x")])
        };
        var alreadyPaired = new SessionConversation();
        alreadyPaired.Initialize([], paired);

        AssertEqual(2, paired.Count, "a properly paired conversation keeps its message count");
        AssertEqual(0, alreadyPaired.RepairToolPairing(), "nothing to repair when pairing is complete");
        AssertEqual("call_x", paired[1].ToolResults[0].ToolUseId, "existing result is untouched");

        // ── 有结果但覆盖不全：只补缺的那一条 ──
        var partial = new List<AgentRuntimeChatMessage>
        {
            new("assistant", "calling", [ToolUse("call_keep"), ToolUse("call_gone")], []),
            AgentRuntimeChatMessage.UserToolResults([ToolResult("call_keep")])
        };
        var partiallyPaired = new SessionConversation();
        partiallyPaired.Initialize([], partial);

        AssertEqual(3, partial.Count, "only the missing call gets a placeholder message");
        AssertEqual("call_gone", partial[2].ToolResults[0].ToolUseId, "the missing one is the one synthesised");
    }

    /// <summary>
    /// layer：上游只认 wire，而 conversation 层的 ToolUses 依赖解析成功。
    /// 两层都要独立修补，插入位置各算各的（共用位置只在逐条同构时才成立）。
    /// </summary>
    private static void RunToolPairingLayerSuite()
    {
        // ── wire 层看得见、conversation 层看不见（解析不出 ToolUses）──
        var opaque = new List<AgentRuntimeChatMessage>
        {
            AgentRuntimeChatMessage.User("hi"),
            new("assistant", "calling", [], [])
        };
        var wireMessages = new List<JsonElement>
        {
            Wire("{\"role\":\"user\",\"content\":\"hi\"}"),
            Wire("{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"call_w\",\"name\":\"Read\",\"input\":{}}]}")
        };
        var wireOnly = new SessionConversation();
        wireOnly.Initialize(wireMessages, opaque);

        var repairedWire = wireOnly.GetWireConversation();
        AssertEqual(3, repairedWire.Count, "wire layer is repaired independently of the parsed layer");
        AssertEqual("call_w", FirstWireToolResultId(repairedWire[2]),
            "the synthesised wire result carries the dangling call id");

        // ── 两层同时缺：补在各自索引上，尾部消息不被挤错位 ──
        var layered = new List<AgentRuntimeChatMessage>
        {
            AgentRuntimeChatMessage.User("hi"),
            new("assistant", "calling", [ToolUse("call_c")], []),
            AgentRuntimeChatMessage.User("next")
        };
        var layeredWire = new List<JsonElement>
        {
            Wire("{\"role\":\"user\",\"content\":\"hi\"}"),
            Wire("{\"role\":\"assistant\",\"content\":[{\"type\":\"tool_use\",\"id\":\"call_c\",\"name\":\"Read\",\"input\":{}}]}"),
            Wire("{\"role\":\"user\",\"content\":\"next\"}")
        };
        var bothLayers = new SessionConversation();
        bothLayers.Initialize(layeredWire, layered);

        AssertEqual(4, layered.Count, "conversation layer inserts at its own index");
        AssertEqual("call_c", layered[2].ToolResults[0].ToolUseId, "placeholder sits right after the call");
        AssertEqual("next", layered[3].Text, "the trailing user turn survives the repair");

        var bothWire = bothLayers.GetWireConversation();
        AssertEqual(4, bothWire.Count, "wire layer inserts at its own index too");
        AssertEqual("call_c", FirstWireToolResultId(bothWire[2]),
            "wire placeholder sits right after the call");
        AssertEqual("next", WireText(bothWire[3]), "the trailing wire user turn survives too");
    }

    private static AgentRuntimeChatToolUse ToolUse(string id)
    {
        return new AgentRuntimeChatToolUse(id, "Read", JsonDocument.Parse("{}").RootElement.Clone(), null);
    }

    private static AgentRuntimeToolResult ToolResult(string toolUseId)
    {
        return new AgentRuntimeToolResult(
            toolUseId,
            JsonDocument.Parse("\"ok\"").RootElement.Clone(),
            null);
    }

    private static JsonElement Wire(string json)
    {
        return JsonDocument.Parse(json).RootElement.Clone();
    }

    private static string FirstWireToolResultId(JsonElement message)
    {
        if (!message.TryGetProperty("content", out var content) ||
            content.ValueKind != JsonValueKind.Array)
        {
            return string.Empty;
        }

        foreach (var block in content.EnumerateArray())
        {
            if (block.TryGetProperty("type", out var type) &&
                type.GetString() == "tool_result" &&
                block.TryGetProperty("toolUseId", out var id))
            {
                return id.GetString() ?? string.Empty;
            }
        }

        return string.Empty;
    }

    private static string WireText(JsonElement message)
    {
        return message.TryGetProperty("content", out var content) && content.ValueKind == JsonValueKind.String
            ? content.GetString() ?? string.Empty
            : string.Empty;
    }
}
