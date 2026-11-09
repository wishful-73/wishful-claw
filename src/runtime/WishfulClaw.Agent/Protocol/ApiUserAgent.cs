/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent.Protocol;

/// <summary>
/// Simplified User-Agent resolver for API requests.
/// </summary>
public static class ApiUserAgent
{
    private const string AppName = "WishfulClaw";
    private const string HeaderName = "User-Agent";

    public static string Resolve(JsonElement provider)
    {
        return Resolve(JsonHelpers.GetString(provider, "userAgent"));
    }

    public static string Resolve(string? configured)
    {
        var trimmed = configured?.Trim();
        return IsResolved(trimmed) ? trimmed! : AppName;
    }

    public static void Apply(HttpRequestMessage request, JsonElement provider)
    {
        request.Headers.Remove(HeaderName);
        request.Headers.TryAddWithoutValidation(HeaderName, Resolve(provider));
    }

    public static void Ensure(HttpRequestMessage request, JsonElement provider)
    {
        if (!request.Headers.TryGetValues(HeaderName, out var values))
        {
            Apply(request, provider);
            return;
        }

        foreach (var value in values)
        {
            if (IsResolved(value))
            {
                return;
            }
        }

        Apply(request, provider);
    }

    public static void ApplyDebug(Dictionary<string, string> headers, JsonElement provider)
    {
        headers[HeaderName] = Resolve(provider);
    }

    public static void EnsureDebug(Dictionary<string, string> headers, JsonElement provider)
    {
        string? existingKey = null;
        foreach (var key in headers.Keys)
        {
            if (key.Equals(HeaderName, StringComparison.OrdinalIgnoreCase))
            {
                existingKey = key;
                break;
            }
        }

        if (existingKey is null || !IsResolved(headers[existingKey]))
        {
            headers[HeaderName] = Resolve(provider);
        }
    }

    private static bool IsResolved(string? value)
    {
        return !string.IsNullOrWhiteSpace(value) &&
            !value.Contains('\r') &&
            !value.Contains('\n') &&
            !value.Equals(AppName, StringComparison.Ordinal);
    }
}
