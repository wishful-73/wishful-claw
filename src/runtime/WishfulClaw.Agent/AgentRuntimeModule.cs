/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

/// <summary>
/// Agent runtime module: registers agent/run, agent/cancel, agent/request-stop,
/// agent/append-messages, and agent/reverse-response.
/// </summary>
public sealed class AgentRuntimeModule : IWorkerModule
{
    public string Name => "agent-runtime";

    public void Register(IWorkerModuleContext context)
    {
        context.Register("agent/run", AgentRuntimeTools.RunAsync);
        context.Register("agent/configure-runtime", AgentRuntimeTools.ConfigureRuntime);
        context.Register("agent/cancel", AgentRuntimeTools.Cancel);
        context.Register("agent/request-stop", AgentRuntimeTools.RequestStop);
        context.Register("agent/append-messages", AgentRuntimeTools.AppendMessages);
        context.Register("agent/drain-sub-agent-notifications", AgentRuntimeTools.DrainSubAgentNotifications);
        context.Register("agent/reverse-response", AgentRuntimeTools.ReverseResponse);
        context.Register("agent/clear-session", AgentRuntimeTools.ClearSession);
        context.Register("agent/restore-session", SessionRestoreTools.RestoreSession);
    }
}
