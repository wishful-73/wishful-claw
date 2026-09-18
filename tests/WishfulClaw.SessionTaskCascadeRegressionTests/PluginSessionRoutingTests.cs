using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Infrastructure.Db;

namespace WishfulClaw.SessionTaskCascadeRegressionTests;

internal static partial class Program
{
    private static void RunPluginSessionRoutingSuite(string dbPath, DbService db)
    {
        const string pluginId = "weixin-regression";
        const string chatId = "bound-weixin-chat";
        var routeKey = DbPluginSessionTools.BuildPluginMessageSessionKey(pluginId, chatId);

        var firstSessionId = RoutePluginSession(dbPath, pluginId, chatId);
        AssertEqual(1L, db.QueryScalar<long>(
            "SELECT COUNT(*) FROM sessions WHERE channel_route_key = @routeKey",
            new SqliteParameter("@routeKey", routeKey)),
            "plugin route persists the first session");
        AssertEqual("global", db.QueryScalar<string>(
            "SELECT scope FROM sessions WHERE id = @id",
            new SqliteParameter("@id", firstSessionId)),
            "plugin route persists global scope");
        AssertEqual("chat", db.QueryScalar<string>(
            "SELECT collaboration_mode FROM sessions WHERE id = @id",
            new SqliteParameter("@id", firstSessionId)),
            "plugin route persists chat collaboration mode");
        // iter-31 S-59：渠道会话默认 YOLO —— 对面没人守着，弹审批只会把这一轮挂死。
        AssertEqual("fullAccess", db.QueryScalar<string>(
            "SELECT permission_mode FROM sessions WHERE id = @id",
            new SqliteParameter("@id", firstSessionId)),
            "plugin route persists YOLO permission mode");

        var reusedSessionId = RoutePluginSession(dbPath, pluginId, chatId);
        AssertEqual(firstSessionId, reusedSessionId, "plugin route reuses the persisted session");
        AssertEqual(1L, db.QueryScalar<long>(
            "SELECT COUNT(*) FROM sessions WHERE channel_route_key = @routeKey",
            new SqliteParameter("@routeKey", routeKey)),
            "plugin route does not create a duplicate session");

        ExpectNoError(DbPluginSessionTools.CreatePluginSession(Params(dbPath, writer =>
        {
            writer.WriteString("id", "legacy-plugin-session");
            writer.WriteString("pluginId", "legacy-plugin");
            writer.WriteString("title", "Legacy Plugin Session");
            writer.WriteString("externalChatId", "legacy-chat");
        })), "legacy plugin session created");
        var legacySessionId = RoutePluginSession(dbPath, "legacy-plugin", "legacy-chat");
        AssertEqual("legacy-plugin-session", legacySessionId,
            "plugin route reuses legacy plugin/external chat metadata");
    }

    private static string RoutePluginSession(string dbPath, string pluginId, string chatId)
    {
        var response = DbPluginSessionRouting.RoutePluginSession(Params(dbPath, writer =>
        {
            writer.WriteString("pluginId", pluginId);
            writer.WriteString("pluginType", "weixin-official");
            writer.WriteString("chatId", chatId);
            writer.WriteString("chatType", "p2p");
            writer.WriteString("initialTitle", "微信对话");
        }));

        using var document = JsonDocument.Parse(response.ToJsonBytes(null));
        var result = document.RootElement.GetProperty("result");
        Assert(result.GetProperty("success").GetBoolean(), "plugin route request succeeds");
        return result.GetProperty("sessionId").GetString()
            ?? throw new InvalidOperationException("plugin route did not return sessionId");
    }
}
