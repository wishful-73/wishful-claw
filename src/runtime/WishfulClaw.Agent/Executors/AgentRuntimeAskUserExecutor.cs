/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Executors;

/// <summary>
/// AskUserQuestion tool executor that routes to the renderer via reverse-request.
/// The renderer shows an interactive question card and returns the user's answers.
/// Ported from WishfulClaw AgentRuntimeAskUserExecutor.
/// </summary>
internal static partial class AgentRuntimeAskUserExecutor
{
    private const string AskUserToolName = "AskUserQuestion";
    private const int MaxQuestions = 4;
    private const int MaxHeaderChars = 12;

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static bool IsAskUserTool(string toolName)
    {
        return string.Equals(toolName, AskUserToolName, StringComparison.Ordinal);
    }

    public static async Task<RendererToolResult> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        JsonElement parameters,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var questions = CoerceQuestions(GetQuestionsInput(call.Input));
        if (questions.Count == 0)
        {
            return new RendererToolResult(CreateStringElement(EncodeError("At least one question is required")), true, "At least one question is required");
        }

        var validationError = ValidateQuestions(questions);
        if (validationError is not null)
        {
            return new RendererToolResult(CreateStringElement(EncodeError(validationError)), true, validationError);
        }

        var normalizedQuestions = NormalizeQuestions(questions);
        var metadataSource = ReadMetadataSource(call.Input);

        var response = await RequestUserAnswersAsync(
            call.Id,
            normalizedQuestions,
            parameters,
            context,
            cancellationToken);

        if (!TryReadAnswers(response, out var answers))
        {
            return new RendererToolResult(CreateStringElement(EncodeError("No answers provided")), true, "No answers provided");
        }

        var result = BuildStructuredResult(
            normalizedQuestions,
            answers,
            ReadAnnotations(response),
            metadataSource);
        return new RendererToolResult(CreateStringElement(result), false, null);
    }

    // ── Question extraction & coercion ──

}
