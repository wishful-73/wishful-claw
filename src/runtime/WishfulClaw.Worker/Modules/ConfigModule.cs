/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Worker;

internal sealed class ConfigModule : IWorkerModule
{
    public string Name => "config";

    public void Register(IWorkerModuleContext context)
    {
        context.Register("config/read", ConfigStore.Read);
        context.Register("config/write", ConfigStore.Write);
        context.Register("config/get", ConfigStore.Get);
        context.Register("config/set", ConfigStore.Set);
        context.Register("config/delete", ConfigStore.Delete);
        // S-103: 工作目录父目录。读/写各一个端点而不是复用 config/get+config/set ——
        // 前端要拿到的是「生效路径」和「是否显式配置过」，设置值可能是 null（未配置），
        // 而默认值只应该有一处定义（C# 侧），不该让渲染端再复刻一遍常量。
        context.Register("config/projects-parent", ProjectsParentDirectory.ReadResponse);
        context.Register("config/projects-parent/set", ProjectsParentDirectory.WriteResponse);
    }
}
