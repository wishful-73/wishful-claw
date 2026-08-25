/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using WishfulClaw.Contracts;
using WishfulClaw.Agent;
using WishfulClaw.Worker.Modules;
using WishfulClaw.Infrastructure.Db;
using WishfulClaw.Agent.Tools.AgentChanges;
using WishfulClaw.Worker.Modules.AgentChanges;
using WishfulClaw.Agent.Modules.Git;
using WishfulClaw.Agent.Modules.Channels;
using WishfulClaw.Agent.Modules.Media;
using WishfulClaw.Agent.Modules.OpenAIAudio;
using WishfulClaw.Agent.Modules.Extensions;
using WishfulClaw.Agent.Modules.Skills;
using WishfulClaw.Agent.Modules.Video;
using WishfulClaw.Persona;
using WishfulClaw.Agent.Tools;
using WishfulClaw.Agent.Modules;

namespace WishfulClaw.Worker;

public static class WorkerModuleCatalog
{
    public static IReadOnlyList<IWorkerModule> Default { get; } =
    [
        new SystemModule(),
        new ConfigModule(),
        new ProviderModule(),
        new ProviderTestModule(),
        new AgentRuntimeModule(),
        new ToolModule(),
        new DbModule(),
        new PersonaModule(),
        new MemoryModule(),
        new GitModule(),
        new MediaFileModule(),
        new AgentChangeModule(),
        new OpenAIAudioModule(),
        new ChannelConfigModule(),
        new SeedanceVideoModule(),
        new XaiVideoModule(),
        new ExtensionModule(),
        new SkillModule(),
        new WebFetchModule(),
        new GoalModule(),
        // CodeGraph（vendored，全局命名空间 + internal，经 InternalsVisibleTo 可见）
        new CodeGraphModule()
    ];
}
