/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using WishfulClaw.Contracts;

namespace WishfulClaw.Agent.Modules.Channels;

public sealed class ChannelConfigModule : IWorkerModule
{
    public string Name => "channels";

    public void Register(IWorkerModuleContext context)
    {
        context.Register("channel/config-list", ChannelConfigStore.List);
        context.Register("channel/config-write", ChannelConfigStore.Write);
        context.Register("channel/config-get", ChannelConfigStore.Get);
        context.Register("channel/config-add", ChannelConfigStore.Add);
        context.Register("channel/config-update", ChannelConfigStore.Update);
        context.Register("channel/config-remove", ChannelConfigStore.Remove);
        context.Register("channel/settings-read", GlobalChannelSettingsService.Read);
        context.Register("channel/settings-write", GlobalChannelSettingsService.Write);
        context.Register("channel/qq-session-load", QqSessionStore.Load);
        context.Register("channel/qq-session-save", QqSessionStore.Save);
        context.Register("channel/qq-session-clear", QqSessionStore.Clear);
    }
}
