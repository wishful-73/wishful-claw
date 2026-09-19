
namespace WishfulClaw.Infrastructure.Db;

// ─── Session Entity ───

public class SessionEntity
{
    public string Id { get; set; } = string.Empty;

    public string Title { get; set; } = string.Empty;

    public string? Icon { get; set; }

    public string Mode { get; set; } = "chat";

    public string? Scope { get; set; }

    public string? CollaborationMode { get; set; }

    public string? PermissionMode { get; set; }

    /// <summary>
    /// 会话级「请求上下文上限」（iter-32 S-73，S-84 由开关改成数值），单位 token，
    /// 0 或缺省表示不限制。只在 <see cref="ContextCapModelId"/> 与当前模型一致时生效，
    /// 见 AgentLoop.ApplyContextCap。
    /// </summary>
    public int ContextCapTokens { get; set; }

    /// <summary>设这个上限时的模型 id；null / 空 = 没设过。换模型后上限即作废。</summary>
    public string? ContextCapModelId { get; set; }

    /// <summary>
    /// 会话级「压缩阈值」（iter-32 S-85），0.3~0.9 的比例。0 或缺失 = 跟随全局设置。
    /// 只剩这一段可选覆盖，模型级那个字段从没有消费方，见 S-85 的记档。
    /// </summary>
    public double CompressionThreshold { get; set; }

    public long CreatedAt { get; set; }

    public long UpdatedAt { get; set; }

    public int MessageCount { get; set; }

    public string? ProjectId { get; set; }

    public string? WorkingFolder { get; set; }

    public string? SshConnectionId { get; set; }

    public string? PlanId { get; set; }

    public int Pinned { get; set; }

    public string? PluginId { get; set; }

    public string? PluginType { get; set; }

    public string? ChannelRouteKey { get; set; }

    public string? ExternalChatId { get; set; }

    public string? ExternalChatType { get; set; }

    public string? ProviderId { get; set; }

    public string? ModelId { get; set; }

    public string ModelSelectionMode { get; set; } = "inherit";

    public string? PersonaId { get; set; }

    public string? CurrentSnapshotId { get; set; }

    public long ContextRevision { get; set; }
}

// ─── Session DTO ───

public sealed class SessionRow
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string? Icon { get; set; }
    public string Mode { get; set; } = "chat";
    public string? Scope { get; set; }
    public string? CollaborationMode { get; set; }
    public string? PermissionMode { get; set; }
    /// <summary>会话级「请求上下文上限」（iter-32 S-84），token 数，0 = 不限制。</summary>
    public int ContextCapTokens { get; set; }
    /// <summary>设这个上限时的模型 id；换模型后上限作废。</summary>
    public string? ContextCapModelId { get; set; }
    /// <summary>会话级「压缩阈值」（iter-32 S-85），0.3~0.9；0 = 跟随全局设置。</summary>
    public double CompressionThreshold { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
    public int MessageCount { get; set; }
    public string? ProjectId { get; set; }
    public string? WorkingFolder { get; set; }
    public string? SshConnectionId { get; set; }
    public string? PlanId { get; set; }
    public bool Pinned { get; set; }
    public string? PluginId { get; set; }
    public string? PluginType { get; set; }
    public string? ChannelRouteKey { get; set; }
    public string? ExternalChatId { get; set; }
    public string? ExternalChatType { get; set; }
    public string? ProviderId { get; set; }
    public string? ModelId { get; set; }
    public string? ModelSelectionMode { get; set; }
    public string? PersonaId { get; set; }
    public string? CurrentSnapshotId { get; set; }
    public long ContextRevision { get; set; }

    public static SessionRow FromEntity(SessionEntity e) => new()
    {
    Id = e.Id,
    Title = e.Title,
    Icon = e.Icon,
    Mode = e.Mode,
    Scope = e.Scope,
    CollaborationMode = e.CollaborationMode,
    PermissionMode = e.PermissionMode,
    ContextCapTokens = e.ContextCapTokens,
    ContextCapModelId = e.ContextCapModelId,
    CompressionThreshold = e.CompressionThreshold,
    CreatedAt = e.CreatedAt,
    UpdatedAt = e.UpdatedAt,
    MessageCount = e.MessageCount,
    ProjectId = e.ProjectId,
    WorkingFolder = e.WorkingFolder,
    SshConnectionId = e.SshConnectionId,
    PlanId = e.PlanId,
    Pinned = e.Pinned != 0,
    PluginId = e.PluginId,
    PluginType = e.PluginType,
    ChannelRouteKey = e.ChannelRouteKey,
    ExternalChatId = e.ExternalChatId,
    ExternalChatType = e.ExternalChatType,
    ProviderId = e.ProviderId,
    ModelId = e.ModelId,
    ModelSelectionMode = e.ModelSelectionMode,
    PersonaId = e.PersonaId,
    CurrentSnapshotId = e.CurrentSnapshotId,
    ContextRevision = e.ContextRevision
    };
}

// ─── Session Result Records ───

public sealed record SessionFindResult(bool Success, SessionRow? Session, string? Error);
public sealed record SessionMutationResult(bool Success, int Changed, string? Error);
public sealed record SessionClearAllResult(bool Success, List<string> SessionIds, int DeletedMessages, int DeletedSessions, string? Error);
public sealed record SessionResetResult(bool Success, int DeletedMessages, long UpdatedAt, string? Error);
public sealed record SessionStatusResult(bool Success, bool Found, string? Title, long? CreatedAt, long? UpdatedAt, int MessageCount, string? Error);
