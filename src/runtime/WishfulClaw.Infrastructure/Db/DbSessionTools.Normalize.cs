/*
 * Ported from OpenCowork.
 * Original: Copyright 2026 AIDotNet
 * Licensed under the Apache License, Version 2.0 (the "License");
 * Modified by the Wishful 心相 team for Wishful Claw.
 */

using System.Text.Json.Serialization.Metadata;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Input parsing and normalization helpers shared by the session endpoints.
/// Split out per AGENTS.md 大文件拆分 (2026-10-28); bodies moved verbatim.
/// </summary>
public static partial class DbSessionTools
{
    private static SessionEntity ReadSessionInput(JsonElement parameters)
    {
        var providerId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "providerId"));
        var modelId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "modelId"));
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        // 上限只在设它的那个模型上生效，所以 tokens 与 model id 必须成对写入；
        // tokens <= 0 表示「不限制」，此时 model id 不写。
        var contextCapTokens = JsonHelpers.GetInt(parameters, "contextCapTokens", 0);
        var input = new SessionEntity
        {
            Id = RequireString(parameters, "id"),
            Title = RequireString(parameters, "title"),
            Icon = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "icon")),
            Mode = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "mode")) ?? "chat",
            Scope = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "scope")),
            CollaborationMode = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "collaborationMode")),
            PermissionMode = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "permissionMode")),
            // tokens <= 0 = 不限制，不写 model id（留着会让人以为上限还在）。
            ContextCapTokens = contextCapTokens > 0 ? contextCapTokens : 0,
            ContextCapModelId = contextCapTokens > 0
                ? DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "contextCapModelId"))
                : null,
            // 压缩阈值（iter-32 S-85）：0 = 跟随全局；只记 0.3~0.9 的合法值。
            CompressionThreshold = NormalizeCompressionThreshold(
                JsonHelpers.GetDoubleNullable(parameters, "compressionThreshold") ?? 0),
            CreatedAt = JsonHelpers.GetLong(parameters, "createdAt", now),
            UpdatedAt = JsonHelpers.GetLong(parameters, "updatedAt", now),
            MessageCount = 0,
            ProjectId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "projectId")),
            WorkingFolder = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "workingFolder")),
            SshConnectionId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "sshConnectionId")),
            PlanId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "planId")),
            Pinned = JsonHelpers.GetBool(parameters, "pinned", false) ? 1 : 0,
            PluginId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "pluginId")),
            ProviderId = providerId,
            ModelId = modelId,
            ModelSelectionMode = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "modelSelectionMode")) ??
                (providerId is not null && modelId is not null ? "manual" : "inherit"),
            PersonaId = DbProjectTools.NormalizeOptional(JsonHelpers.GetString(parameters, "personaId"))
        };
        NormalizeSessionContext(input);
        return input;
    }

    private static void ApplyProjectDefaults(DbService db, SessionEntity input)
    {
        if (input.ProjectId is null ||
            (input.WorkingFolder is not null && input.SshConnectionId is not null))
        {
            return;
        }

        var project = db.QueryFirstOrDefault(
            "SELECT * FROM projects WHERE id = @id",
            EntityMappers.MapProject,
            new SqliteParameter("@id", input.ProjectId));
        if (project is null) return;

        input.WorkingFolder ??= project.WorkingFolder;
        input.SshConnectionId ??= project.SshConnectionId;
    }

    private static void ApplySessionPatch(JsonElement patch, SessionEntity row)
    {
        TryPatchString(patch, "title", v => row.Title = v);
        TryPatchString(patch, "icon", v => row.Icon = v);
        TryPatchString(patch, "mode", v => row.Mode = v);
        TryPatchNullableString(patch, "scope", v => row.Scope = v);
        TryPatchNullableString(patch, "collaborationMode", v => row.CollaborationMode = v);
        TryPatchNullableString(patch, "permissionMode", v => row.PermissionMode = v);

        if (JsonHelpers.GetLongNullable(patch, "updatedAt") is { } updatedAt)
        {
            row.UpdatedAt = updatedAt;
        }
        else
        {
            row.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        }

        TryPatchNullableString(patch, "projectId", v => row.ProjectId = v);
        TryPatchNullableString(patch, "workingFolder", v => row.WorkingFolder = v);
        TryPatchNullableString(patch, "sshConnectionId", v => row.SshConnectionId = v);
        TryPatchNullableString(patch, "planId", v => row.PlanId = v);
        TryPatchNullableString(patch, "pluginId", v => row.PluginId = v);
        TryPatchNullableString(patch, "providerId", v => row.ProviderId = v);
        TryPatchNullableString(patch, "modelId", v => row.ModelId = v);
        TryPatchNullableString(patch, "modelSelectionMode", v => row.ModelSelectionMode = v ?? "inherit");
        TryPatchNullableString(patch, "personaId", v => row.PersonaId = v);

        if (patch.TryGetProperty("pinned", out var pinnedEl))
        {
            row.Pinned = pinnedEl.ValueKind switch
            {
                JsonValueKind.True => 1,
                JsonValueKind.False => 0,
                JsonValueKind.Number when pinnedEl.TryGetInt32(out var v) => v == 0 ? 0 : 1,
                _ => row.Pinned
            };
        }

        if (patch.TryGetProperty("contextCapTokens", out var capEl))
        {
            var capTokens = capEl.ValueKind switch
            {
                JsonValueKind.Number when capEl.TryGetInt32(out var v) && v > 0 => v,
                _ => 0
            };
            row.ContextCapTokens = capTokens;
            if (capTokens > 0)
            {
                if (patch.TryGetProperty("contextCapModelId", out var capModelEl) &&
                    capModelEl.ValueKind == JsonValueKind.String)
                {
                    row.ContextCapModelId = DbProjectTools.NormalizeOptional(capModelEl.GetString());
                }
            }
            else
            {
                row.ContextCapModelId = null;
            }
        }

        if (patch.TryGetProperty("compressionThreshold", out var thresholdEl))
        {
            // 非数字 / 越界一律回落 0 = 跟随全局，不保留脏值。
            row.CompressionThreshold = thresholdEl.ValueKind == JsonValueKind.Number &&
                                       thresholdEl.TryGetDouble(out var threshold)
                ? NormalizeCompressionThreshold(threshold)
                : 0;
        }

        NormalizeSessionContext(row);
    }

    private static double NormalizeCompressionThreshold(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return 0;
        }

        return value >= MinSessionCompressionThreshold && value <= MaxSessionCompressionThreshold
            ? value
            : 0;
    }

    private static void NormalizeSessionContext(SessionEntity session)
    {
        session.Scope = session.Scope is "global" or "project"
            ? session.Scope
            : session.ProjectId is null ? "global" : "project";

        if (session.Scope == "global")
        {
            session.CollaborationMode = "chat";
            // Permission mode is independent of collaboration mode (iter-31 S-59): a
            // global/chat session may store fullAccess too. Only unknown or missing
            // values fall back to "default"; the renderer forces "default" for channel
            // sessions at send time, so this cannot be used to un-gate a channel.
            session.PermissionMode = NormalizePermissionMode(session.PermissionMode);
            session.ProjectId = null;
            session.WorkingFolder = null;
            session.SshConnectionId = null;
            return;
        }

        if (session.ProjectId is null)
        {
            throw new InvalidOperationException("Project sessions require projectId.");
        }

        session.CollaborationMode = session.CollaborationMode is "chat" or "cowork"
            ? session.CollaborationMode
            : "cowork";
        session.PermissionMode = NormalizePermissionMode(session.PermissionMode);
    }

    /// <summary>
    /// 权限档与协作模式解绑后，存储层只做合法性校验：default / fullAccess 原样保留，
    /// 其余（含 NULL）一律回落 default。缺省值仍由渲染端按协作模式给出。
    /// </summary>
    private static string NormalizePermissionMode(string? permissionMode)
    {
        return permissionMode is "default" or "fullAccess" ? permissionMode : "default";
    }

    private static void TryPatchString(JsonElement patch, string name, Action<string> setter)
    {
        if (patch.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String)
        {
            var v = el.GetString();
            if (!string.IsNullOrEmpty(v)) setter(v);
        }
    }

    private static void TryPatchNullableString(JsonElement patch, string name, Action<string?> setter)
    {
        if (patch.TryGetProperty(name, out var el))
        {
            setter(el.ValueKind == JsonValueKind.String
                ? DbProjectTools.NormalizeOptional(el.GetString())
                : null);
        }
    }

    private static string RequireString(JsonElement parameters, string name)
    {
        return JsonHelpers.GetString(parameters, name) is { Length: > 0 } value
            ? value
            : throw new InvalidOperationException($"Missing required field: {name}");
    }

    private static WorkerResponse Mutation(int changed)
    {
        return WorkerResponse.Json(new SessionMutationResult(true, changed, null), InfrastructureJsonContext.Default.SessionMutationResult);
    }

    private static WorkerResponse MutationError(string error)
    {
        return WorkerResponse.Json(new SessionMutationResult(false, 0, error), InfrastructureJsonContext.Default.SessionMutationResult);
    }
}
