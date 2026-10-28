/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Buffers;
using System.Text;
using System.Text.Json;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Core.Tools;

namespace WishfulClaw.Agent;

/// <summary>
/// Concurrency slot acquisition and the shared JSON writer options. Split out per AGENTS.md 大文件拆分 (2026-10-28), bodies moved verbatim.
/// </summary>
public static partial class SubAgentExecutor
{
    // ── S-178: concurrency slot + queued/start notifications ──
    //
    // The renderer reducer already implements the whole "waiting" story:
    // sub_agent_queued creates a queued card, sub_agent_start flips a queued card to
    // running, sub_agent_dequeued removes a queued card. The C# side never emitted
    // queued/dequeued, so every card showed "working" even when it was queued.
    //
    // Ordering contract: queued MUST precede start. A queued event that arrives once
    // the card already exists is ignored, so start must not be emitted before the
    // gate is acquired. Both execution paths emit through AcquireSubAgentSlotAsync.

    private static async Task<IDisposable> AcquireSubAgentSlotAsync(
        SubAgentDefinition definition,
        string toolCallId,
        JsonElement input,
        AgentRuntimeRunState parentState,
        IWorkerRequestContext context,
        CancellationToken cancellationToken)
    {
        var queued = false;
        IDisposable lease;
        try
        {
            lease = await SubAgentConcurrencyLimiter.AcquireAsync(
                cancellationToken,
                onQueued: async () =>
                {
                    queued = true;
                    await TryEmitSubAgentEventAsync(
                        "queued", toolCallId,
                        () => EmitSubAgentQueuedAsync(
                            definition, toolCallId, input, parentState, context));
                });
        }
        catch (OperationCanceledException)
        {
            // Cancelled while queued: the renderer already built a queued card, so take
            // it back — otherwise it would sit there as a ghost card that never moves.
            if (queued)
            {
                await TryEmitSubAgentEventAsync(
                    "dequeued", toolCallId,
                    () => EmitSubAgentDequeuedAsync(definition, toolCallId, parentState, context));
            }

            throw;
        }

        // Lease in hand ⇒ actually running. Emitting start only here is what makes the
        // card's "on" state mean "running" (see the ordering contract above).
        await TryEmitSubAgentEventAsync(
            "start", toolCallId,
            () => EmitSubAgentStartedAsync(definition, toolCallId, input, parentState, context));

        return lease;
    }

    private static readonly JsonWriterOptions WriteOptions = new()
    {
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };
}
