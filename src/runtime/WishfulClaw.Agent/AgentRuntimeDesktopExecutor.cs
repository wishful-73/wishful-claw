/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Encodings.Web;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Desktop control tool executor that routes to the main process via reverse-request.
/// Supports screenshot, click, type, scroll, and wait operations.
/// Ported from WishfulClaw AgentRuntimeDesktopExecutor.
/// </summary>
public static partial class AgentRuntimeDesktopExecutor
{
    /// <summary>
    /// Tools routed through this executor. All of them reverse-request into the main
    /// process, which is the only reason `CaptureAppWindow` lives here — its subject is
    /// the app's own window, not the desktop, but it shares the same transport.
    /// </summary>
    private static readonly HashSet<string> DesktopToolNames = new(StringComparer.Ordinal)
    {
        "DesktopScreenshot",
        "DesktopClick",
        "DesktopType",
        "DesktopScroll",
        "DesktopWait",
        "CaptureAppWindow"
    };

    private static readonly HashSet<string> AllowedButtons = new(StringComparer.Ordinal)
    {
        "left", "right", "middle"
    };

    private static readonly HashSet<string> AllowedClickActions = new(StringComparer.Ordinal)
    {
        "click", "double_click", "down", "up"
    };

    private static readonly HashSet<string> AllowedModifiers = new(StringComparer.Ordinal)
    {
        "Control", "Meta", "Alt", "Shift"
    };

    private static readonly HashSet<string> AllowedNamedKeys = new(StringComparer.Ordinal)
    {
        "Enter", "Tab", "Escape", "Backspace", "Delete",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
        "Home", "End", "PageUp", "PageDown", "Space"
    };

    private static readonly JsonWriterOptions WriterOptions = new()
    {
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    public static bool IsDesktopTool(string toolName)
    {
        return DesktopToolNames.Contains(toolName);
    }

    public static async Task<RendererToolResult> ExecuteAsync(
        AgentRuntimeNativeToolCall call,
        IWorkerRequestContext context,
        string? workingFolder,
        CancellationToken cancellationToken)
    {
        return call.Name switch
        {
            "DesktopScreenshot" => await ExecuteScreenshotAsync(call.Input, context, cancellationToken),
            "DesktopClick" => await ExecuteClickAsync(call.Input, context, cancellationToken),
            "DesktopType" => await ExecuteTypeAsync(call.Input, context, cancellationToken),
            "DesktopScroll" => await ExecuteScrollAsync(call.Input, context, cancellationToken),
            "DesktopWait" => await ExecuteWaitAsync(call.Input, cancellationToken),
            "CaptureAppWindow" => await ExecuteAppWindowCaptureAsync(call.Input, context, workingFolder, cancellationToken),
            _ => StringResult(EncodeError($"Unsupported desktop tool: {call.Name}"), true)
        };
    }

    private static async Task<RendererToolResult> ExecuteScreenshotAsync(
        JsonElement input,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var delayMs = Math.Clamp(JsonHelpers.GetInt(input, "delayMs", 0), 0, 5_000);
        if (delayMs > 0)
        {
            await Task.Delay(delayMs, cancellationToken);
        }

        var response = await InvokeMainAsync(
            context, "desktop:screenshot:capture",
            CreateJsonObject(_ => { }), cancellationToken);

        var data = JsonHelpers.GetString(response, "data");
        if (!JsonHelpers.GetBool(response, "success", false) || string.IsNullOrEmpty(data))
        {
            return StringResult(
                EncodeError(JsonHelpers.GetString(response, "error") ?? "Failed to capture desktop screenshot."),
                true);
        }

        return new RendererToolResult(CreateScreenshotContent(response, data), false, null);
    }

    /// <summary>
    /// Screenshot the app's own window and optionally write it to disk.
    ///
    /// The path is resolved here rather than in the main process: the main process's
    /// cwd is the application directory, so a relative `docs/images/foo.png` handed to
    /// it would land somewhere entirely unrelated to the user's working folder.
    /// </summary>
    private static async Task<RendererToolResult> ExecuteAppWindowCaptureAsync(
        JsonElement input,
        IWorkerRequestContext context,
        string? workingFolder,
        CancellationToken cancellationToken)
    {
        var requestedPath = JsonHelpers.GetString(input, "path")?.Trim();
        var delayMs = Math.Clamp(JsonHelpers.GetInt(input, "delayMs", 0), 0, 5_000);

        string? targetPath = null;
        if (!string.IsNullOrEmpty(requestedPath))
        {
            var baseDir = string.IsNullOrWhiteSpace(workingFolder)
                ? Environment.CurrentDirectory
                : workingFolder;
            targetPath = Path.IsPathRooted(requestedPath)
                ? Path.GetFullPath(requestedPath)
                : Path.GetFullPath(Path.Combine(baseDir, requestedPath));
        }

        var response = await InvokeMainAsync(
            context, "window:capture-self",
            CreateJsonObject(writer =>
            {
                if (delayMs > 0) writer.WriteNumber("delayMs", delayMs);
                if (targetPath is not null) writer.WriteString("targetPath", targetPath);
            }), cancellationToken);

        var data = JsonHelpers.GetString(response, "data");
        if (!JsonHelpers.GetBool(response, "success", false) || string.IsNullOrEmpty(data))
        {
            return StringResult(
                EncodeError(JsonHelpers.GetString(response, "error") ?? "Failed to capture the app window."),
                true);
        }

        return new RendererToolResult(CreateAppWindowCaptureContent(response, data), false, null);
    }

    private static async Task<RendererToolResult> ExecuteClickAsync(
        JsonElement input,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var x = JsonHelpers.GetDoubleNullable(input, "x");
        var y = JsonHelpers.GetDoubleNullable(input, "y");
        var button = JsonHelpers.GetString(input, "button") ?? "left";
        var action = JsonHelpers.GetString(input, "action") ?? "click";

        if (!x.HasValue || !y.HasValue)
        {
            return StringResult(EncodeError("DesktopClick requires numeric x and y coordinates."), true);
        }
        if (!AllowedButtons.Contains(button))
        {
            return StringResult(EncodeError($"Unsupported button: {button}."), true);
        }
        if (!AllowedClickActions.Contains(action))
        {
            return StringResult(EncodeError($"Unsupported action: {action}."), true);
        }

        var response = await InvokeMainAsync(
            context, "desktop:input:click",
            CreateJsonObject(writer =>
            {
                writer.WriteNumber("x", x.Value);
                writer.WriteNumber("y", y.Value);
                writer.WriteString("button", button);
                writer.WriteString("action", action);
            }), cancellationToken);

        if (!JsonHelpers.GetBool(response, "success", false))
        {
            return StringResult(
                EncodeError(JsonHelpers.GetString(response, "error") ?? "Desktop click failed."), true);
        }

        var resultX = JsonHelpers.GetDoubleNullable(response, "x") ?? x.Value;
        var resultY = JsonHelpers.GetDoubleNullable(response, "y") ?? y.Value;
        var resultButton = JsonHelpers.GetString(response, "button") ?? button;
        var resultAction = JsonHelpers.GetString(response, "action") ?? action;
        return StringResult(EncodeJsonObject(writer =>
        {
            writer.WriteBoolean("success", true);
            writer.WriteNumber("x", resultX);
            writer.WriteNumber("y", resultY);
            writer.WriteString("button", resultButton);
            writer.WriteString("action", resultAction);
            writer.WriteString("message", $"Desktop {resultAction} executed at ({resultX}, {resultY}) with {resultButton} button.");
        }));
    }

    private static async Task<RendererToolResult> ExecuteTypeAsync(
        JsonElement input,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var text = JsonHelpers.GetString(input, "text");
        var key = JsonHelpers.GetString(input, "key");
        var hotkey = ReadStringArray(input, "hotkey");
        var providedCount = (!string.IsNullOrEmpty(text) ? 1 : 0) +
            (!string.IsNullOrEmpty(key) ? 1 : 0) +
            (hotkey.Count > 0 ? 1 : 0);

        if (providedCount != 1)
        {
            return StringResult(EncodeError("DesktopType requires exactly one of: text, key, or hotkey."), true);
        }
        if (!string.IsNullOrEmpty(key) && !AllowedNamedKeys.Contains(key) && !IsSupportedSingleKey(key))
        {
            return StringResult(EncodeError($"Unsupported key: {key}."), true);
        }
        if (hotkey.Count > 0)
        {
            if (hotkey.Count < 2)
            {
                return StringResult(EncodeError("DesktopType hotkey must include at least one modifier and one key."), true);
            }
            var modifiers = hotkey.Take(hotkey.Count - 1).ToArray();
            if (modifiers.Any(item => !AllowedModifiers.Contains(item)))
            {
                return StringResult(EncodeError($"DesktopType hotkey modifiers must be one of: {string.Join(", ", AllowedModifiers)}."), true);
            }
            if (string.IsNullOrEmpty(hotkey[^1]))
            {
                return StringResult(EncodeError("DesktopType hotkey requires a trailing key."), true);
            }
        }

        var response = await InvokeMainAsync(
            context, "desktop:input:type",
            CreateJsonObject(writer =>
            {
                WriteNullableString(writer, "text", text);
                WriteNullableString(writer, "key", key);
                writer.WritePropertyName("hotkey");
                if (hotkey.Count == 0) { writer.WriteNullValue(); }
                else
                {
                    writer.WriteStartArray();
                    foreach (var item in hotkey) { writer.WriteStringValue(item); }
                    writer.WriteEndArray();
                }
            }), cancellationToken);

        if (!JsonHelpers.GetBool(response, "success", false))
        {
            return StringResult(EncodeError(JsonHelpers.GetString(response, "error") ?? "Desktop typing failed."), true);
        }

        var mode = JsonHelpers.GetString(response, "mode") ?? string.Empty;
        var textLength = JsonHelpers.GetInt(response, "textLength", text?.Length ?? 0);
        var resultKey = JsonHelpers.GetString(response, "key") ?? key;
        var resultHotkey = ReadStringArray(response, "hotkey");
        return StringResult(EncodeJsonObject(writer =>
        {
            writer.WriteBoolean("success", true);
            writer.WriteString("mode", mode);
            writer.WriteNumber("textLength", textLength);
            WriteNullableString(writer, "key", resultKey);
            writer.WritePropertyName("hotkey");
            WriteStringArrayOrNull(writer, resultHotkey.Count > 0 ? resultHotkey : hotkey);
            writer.WriteString("message", BuildTypeMessage(mode, textLength, resultKey, resultHotkey, hotkey));
        }));
    }

    private static async Task<RendererToolResult> ExecuteScrollAsync(
        JsonElement input,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var x = JsonHelpers.GetDoubleNullable(input, "x");
        var y = JsonHelpers.GetDoubleNullable(input, "y");
        var scrollX = JsonHelpers.GetDoubleNullable(input, "scrollX") ?? 0;
        var scrollY = JsonHelpers.GetDoubleNullable(input, "scrollY") ?? 0;

        if ((x.HasValue && !y.HasValue) || (!x.HasValue && y.HasValue))
        {
            return StringResult(EncodeError("DesktopScroll requires both x and y when specifying a scroll anchor."), true);
        }

        var response = await InvokeMainAsync(
            context, "desktop:input:scroll",
            CreateJsonObject(writer =>
            {
                if (x.HasValue) { writer.WriteNumber("x", x.Value); } else { writer.WriteNull("x"); }
                if (y.HasValue) { writer.WriteNumber("y", y.Value); } else { writer.WriteNull("y"); }
                writer.WriteNumber("scrollX", scrollX);
                writer.WriteNumber("scrollY", scrollY);
            }), cancellationToken);

        if (!JsonHelpers.GetBool(response, "success", false))
        {
            return StringResult(EncodeError(JsonHelpers.GetString(response, "error") ?? "Desktop scroll failed."), true);
        }

        var resultX = JsonHelpers.GetDoubleNullable(response, "x");
        var resultY = JsonHelpers.GetDoubleNullable(response, "y");
        var resultScrollX = JsonHelpers.GetDoubleNullable(response, "scrollX") ?? scrollX;
        var resultScrollY = JsonHelpers.GetDoubleNullable(response, "scrollY") ?? scrollY;
        return StringResult(EncodeJsonObject(writer =>
        {
            writer.WriteBoolean("success", true);
            WriteOptionalNumber(writer, "x", resultX);
            WriteOptionalNumber(writer, "y", resultY);
            writer.WriteNumber("scrollX", resultScrollX);
            writer.WriteNumber("scrollY", resultScrollY);
            writer.WriteString("message",
                resultX.HasValue && resultY.HasValue
                    ? $"Desktop scroll executed at ({resultX}, {resultY}) with delta ({resultScrollX}, {resultScrollY})."
                    : $"Desktop scroll executed with delta ({resultScrollX}, {resultScrollY}).");
        }));
    }

    private static async Task<RendererToolResult> ExecuteWaitAsync(
        JsonElement input, CancellationToken cancellationToken)
    {
        var delayMs = JsonHelpers.GetDoubleNullable(input, "delayMs") ?? 2_000;
        if (double.IsNaN(delayMs) || double.IsInfinity(delayMs) || delayMs < 0)
        {
            return StringResult(EncodeError("DesktopWait requires a non-negative numeric delayMs."), true);
        }

        var boundedDelayMs = (int)Math.Min(delayMs, 10_000);
        if (boundedDelayMs > 0)
        {
            await Task.Delay(boundedDelayMs, cancellationToken);
        }

        return StringResult(EncodeJsonObject(writer =>
        {
            writer.WriteBoolean("success", true);
            writer.WriteNumber("delayMs", boundedDelayMs);
            writer.WriteString("message", $"Desktop wait completed after {boundedDelayMs}ms.");
        }));
    }

    // ── Helpers ──

    private static async Task<JsonElement> InvokeMainAsync(
        IWorkerRequestContext context, string method,
        JsonElement request, CancellationToken cancellationToken)
    {
        return await AgentRuntimeReverseRequests.RequestAsync(context, method, request, cancellationToken);
    }

}
