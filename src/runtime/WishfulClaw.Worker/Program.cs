/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text;
using System.Text.Json.Serialization.Metadata;
using WishfulClaw.Contracts;
using WishfulClaw.Agent;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Worker;

// Configure AOT-safe JSON serialization
WorkerJsonHelper.ConfigureAotResolver(
    JsonTypeInfoResolver.Combine(
        WishfulClawJsonContext.Default,
        AgentRuntimeJsonContext.Default));

Console.OutputEncoding = Encoding.UTF8;

// Register global exception handlers so crashes are logged before the process dies
AppDomain.CurrentDomain.UnhandledException += (_, e) =>
{
    var ex = e.ExceptionObject as Exception;
    try
    {
        WorkerLog.Error($"[FATAL] AppDomain.UnhandledException: {ex?.GetType().Name}: {ex?.Message} | StackTrace: {ex?.StackTrace}");
    }
    catch { /* logging itself failed, nothing more we can do */ }
};

TaskScheduler.UnobservedTaskException += (_, e) =>
{
    try
    {
        WorkerLog.Error($"[FATAL] TaskScheduler.UnobservedTaskException: {e.Exception.GetType().Name}: {e.Exception.Message} | StackTrace: {e.Exception.StackTrace}");
    }
    catch { }
    e.SetObserved(); // prevent process crash
};

try
{
    // CodeGraph tree-sitter grammars resolve from the bundled grammars dir
    // (WISHFULCLAW_CODEGRAPH_GRAMMARS_DIR, or <binary>/grammars fallback);
    // a missing grammar disables one language, never boot.
    CodeGraphNativeLibraryResolver.Install();

    var endpoint = WorkerEndpoint.Parse(args);
    await WorkerHost.CreateDefault(endpoint).RunAsync();
    return 0;
}
catch (Exception ex)
{
    WorkerLog.Error($"[FATAL] Program.Main uncaught: {ex.GetType().Name}: {ex.Message} | StackTrace: {ex.StackTrace}");
    return 1;
}
