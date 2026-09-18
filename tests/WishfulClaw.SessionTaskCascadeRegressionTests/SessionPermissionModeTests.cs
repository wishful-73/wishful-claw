using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.SessionTaskCascadeRegressionTests;

/// <summary>
/// iter-31 S-59 —— 存储层的权限档归一化。
///
/// 以前 <c>DbSessionTools.NormalizeSessionContext</c> 按协作模式把权限档抹平
/// （global 恒 default、project+chat 恒 default），所以前端就算把 fullAccess 存进来，
/// 也会在 Worker 这一层被打回。前端改半天没用，根子在这儿。
///
/// 现在存储层只做合法性校验：default / fullAccess 原样保留，其余（含 NULL）回落 default。
/// 缺省值由渲染端按协作模式给出，存储层不再替它做决定。
/// </summary>
internal static partial class Program
{
    private static void RunSessionPermissionModeSuite(string dbPath, DbService db)
    {
        ExpectNoError(DbProjectTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", "p-perm");
            w.WriteString("name", "Permission Suite Project");
        })), "permission suite project created");

        // ── 全局会话：以前恒 default，现在显式值必须活下来 ──
        CreateSessionWithPermission(dbPath, "s-perm-g-yolo", "global", collaborationMode: null, permissionMode: "fullAccess");
        AssertEqual("fullAccess", PermissionOf(db, "s-perm-g-yolo"), "global 会话保留显式 fullAccess");
        AssertEqual("chat", CollaborationOf(db, "s-perm-g-yolo"), "global 会话协作模式恒为 chat");

        CreateSessionWithPermission(dbPath, "s-perm-g-plain", "global", collaborationMode: null, permissionMode: "default");
        AssertEqual("default", PermissionOf(db, "s-perm-g-plain"), "global 会话保留显式 default");

        CreateSessionWithPermission(dbPath, "s-perm-g-absent", "global", collaborationMode: null, permissionMode: null);
        AssertEqual("default", PermissionOf(db, "s-perm-g-absent"), "global 会话缺省回落 default（不主动放开）");

        CreateSessionWithPermission(dbPath, "s-perm-g-bogus", "global", collaborationMode: null, permissionMode: "whitelist");
        AssertEqual("default", PermissionOf(db, "s-perm-g-bogus"), "global 会话非法值回落 default");

        // ── 项目 chat 会话：以前恒 default，现在同样解绑 ──
        CreateSessionWithPermission(dbPath, "s-perm-p-chat-yolo", "project", collaborationMode: "chat", permissionMode: "fullAccess");
        AssertEqual("fullAccess", PermissionOf(db, "s-perm-p-chat-yolo"), "项目 chat 会话保留显式 fullAccess");

        CreateSessionWithPermission(dbPath, "s-perm-p-chat-absent", "project", collaborationMode: "chat", permissionMode: null);
        AssertEqual("default", PermissionOf(db, "s-perm-p-chat-absent"), "项目 chat 会话缺省回落 default");

        // ── 项目 cowork 会话：行为不变 ──
        CreateSessionWithPermission(dbPath, "s-perm-p-cowork-yolo", "project", collaborationMode: "cowork", permissionMode: "fullAccess");
        AssertEqual("fullAccess", PermissionOf(db, "s-perm-p-cowork-yolo"), "项目 cowork 会话保留 fullAccess");

        CreateSessionWithPermission(dbPath, "s-perm-p-cowork-absent", "project", collaborationMode: "cowork", permissionMode: null);
        AssertEqual("default", PermissionOf(db, "s-perm-p-cowork-absent"), "项目 cowork 会话缺省回落 default");

        // ── 更新路径：patch 也要走同一套规则，否则改档就丢 ──
        ExpectNoError(DbSessionTools.Update(Params(dbPath, w =>
        {
            w.WriteString("id", "s-perm-p-chat-absent");
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteString("permissionMode", "fullAccess");
            w.WriteEndObject();
        })), "chat 会话可以事后改成 fullAccess");
        AssertEqual("fullAccess", PermissionOf(db, "s-perm-p-chat-absent"), "更新路径同样保留 fullAccess");

        ExpectNoError(DbSessionTools.Update(Params(dbPath, w =>
        {
            w.WriteString("id", "s-perm-g-yolo");
            w.WritePropertyName("patch");
            w.WriteStartObject();
            w.WriteString("permissionMode", "whitelist");
            w.WriteEndObject();
        })), "global 会话 patch 非法值不报错");
        AssertEqual("default", PermissionOf(db, "s-perm-g-yolo"), "更新路径非法值回落 default");

        // ── 读回路径：Get 也不能改写已存的档位 ──
        var found = DbSessionTools.Get(Params(dbPath, w => w.WriteString("id", "s-perm-p-chat-yolo")));
        ExpectNoError(found, "Get 返回 chat+YOLO 会话");
        AssertEqual("fullAccess", PermissionOf(db, "s-perm-p-chat-yolo"), "Get 之后档位仍然是 fullAccess");
    }

    private static void CreateSessionWithPermission(
        string dbPath,
        string id,
        string scope,
        string? collaborationMode,
        string? permissionMode)
    {
        ExpectNoError(DbSessionTools.Create(Params(dbPath, w =>
        {
            w.WriteString("id", id);
            w.WriteString("title", $"Session {id}");
            w.WriteString("scope", scope);
            if (scope == "project") w.WriteString("projectId", "p-perm");
            if (collaborationMode is not null) w.WriteString("collaborationMode", collaborationMode);
            if (permissionMode is not null) w.WriteString("permissionMode", permissionMode);
        })), $"session {id} created");
    }

    private static string PermissionOf(DbService db, string sessionId)
        => db.QueryScalar<string>(
            "SELECT permission_mode FROM sessions WHERE id = @id",
            new SqliteParameter("@id", sessionId));

    private static string CollaborationOf(DbService db, string sessionId)
        => db.QueryScalar<string>(
            "SELECT collaboration_mode FROM sessions WHERE id = @id",
            new SqliteParameter("@id", sessionId));
}
