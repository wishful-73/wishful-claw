/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License").
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json.Serialization.Metadata;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

public static partial class DbSessionTools
{
    // 分部文件（AGENTS.md 大文件拆分，2026-10-28；方法体逐字平移，零行为改动）：
    //   DbSessionTools.Read.cs      —— List / Get / Status
    //   DbSessionTools.Write.cs     —— Create / Update / Delete / ClearAll / ResetConversation / ResetUsageStats
    //   DbSessionTools.Normalize.cs —— 入参解析、补丁与归一化辅助

    /// <summary>
    /// 会话级压缩阈值（iter-32 S-85）的合法区间，与全局设置的钳制口径一致。
    /// 落在区间外或非有限值一律当「没设」，返回 0 = 跟随全局。
    /// </summary>
    internal const double MinSessionCompressionThreshold = 0.3;
    internal const double MaxSessionCompressionThreshold = 0.9;
}
