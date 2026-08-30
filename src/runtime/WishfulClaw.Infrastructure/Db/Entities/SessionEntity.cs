
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

    public static SessionRow FromEntity(SessionEntity e) => new()
    {
    Id = e.Id,
    Title = e.Title,
    Icon = e.Icon,
    Mode = e.Mode,
    Scope = e.Scope,
    CollaborationMode = e.CollaborationMode,
    PermissionMode = e.PermissionMode,
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
    PersonaId = e.PersonaId
    };
}

// ─── Session Result Records ───

public sealed record SessionFindResult(bool Success, SessionRow? Session, string? Error);
public sealed record SessionMutationResult(bool Success, int Changed, string? Error);
public sealed record SessionClearAllResult(bool Success, List<string> SessionIds, int DeletedMessages, int DeletedSessions, string? Error);
public sealed record SessionResetResult(bool Success, int DeletedMessages, long UpdatedAt, string? Error);
public sealed record SessionStatusResult(bool Success, bool Found, string? Title, long? CreatedAt, long? UpdatedAt, int MessageCount, string? Error);
