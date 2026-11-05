/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json.Serialization.Metadata;
﻿using System.Text.Json;
using WishfulClaw.Agent.Executors;
using WishfulClaw.Contracts;

namespace WishfulClaw.Agent.Modules.Git;

/// <summary>
/// Registers git IPC handlers: exec-local, scan-repositories, status-detailed, query, query-local.
/// SSH remote git operations are not included.
/// </summary>
public sealed class GitModule : IWorkerModule
{
    public string Name => "git";

    public void Register(IWorkerModuleContext context)
    {
        context.Register("git/exec-local", ExecLocalAsync);
        context.Register("git/scan-repositories", ScanRepositoriesAsync);
        context.Register("git/status-detailed", StatusDetailedAsync);
        context.Register("git/query", QueryAsync);
        context.Register("git/query-local", QueryAsync); // same handler, local only
    }

    private static string GetCwd(JsonElement parameters)
    {
        return GitExecutor.GetString(parameters, "cwd") ?? Environment.CurrentDirectory;
    }

    private static async Task<WorkerResponse> ExecLocalAsync(JsonElement parameters)
    {
        try
        {
            var cwd = GetCwd(parameters);
            var args = GetStringArray(parameters, "args");
            var timeoutMs = GitExecutor.GetInt(parameters, "timeoutMs", 60_000);
            var maxStdoutChars = GitExecutor.GetInt(parameters, "maxStdoutChars", 512 * 1024);
            var maxStderrChars = GitExecutor.GetInt(parameters, "maxStderrChars", 64 * 1024);
            var result = await GitExecutor.ExecAsync(args, cwd, timeoutMs, maxStdoutChars, maxStderrChars);
            return WorkerResponse.Json(result, AgentRuntimeJsonContext.Default.GitExecResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Error(ex.Message);
        }
    }

    private static async Task<WorkerResponse> ScanRepositoriesAsync(JsonElement parameters)
    {
        try
        {
            var cwd = GetCwd(parameters);
            var repositories = await GitScanTools.ScanRepositoriesAsync(parameters, cwd);
            return WorkerResponse.Json(repositories, AgentRuntimeJsonContext.Default.ListGitRepositorySummary);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Error(ex.Message);
        }
    }

    private static async Task<WorkerResponse> StatusDetailedAsync(JsonElement parameters)
    {
        var cwd = GetCwd(parameters);
        var result = await GitStatusTools.StatusDetailedAsync(cwd);
        return WorkerResponse.Json(result, AgentRuntimeJsonContext.Default.GitStatusDetailedResult);
    }

    private static async Task<WorkerResponse> QueryAsync(JsonElement parameters)
    {
        try
        {
            var cwd = GetCwd(parameters);
            var result = await GitQueryTools.QueryAsync(parameters, cwd);
            return WorkerResponse.Json(result, AgentRuntimeJsonContext.Default.GitQueryResult);
        }
        catch (Exception ex)
        {
            return WorkerResponse.Json(GitQueryResult.Failure(ex.Message), AgentRuntimeJsonContext.Default.GitQueryResult);
        }
    }

    private static string[] GetStringArray(JsonElement parameters, string name)
    {
        if (parameters.ValueKind != JsonValueKind.Object ||
            !parameters.TryGetProperty(name, out var prop) ||
            prop.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var result = new List<string>();
        foreach (var item in prop.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { } value)
            {
                result.Add(value);
            }
        }
        return result.ToArray();
    }
}
