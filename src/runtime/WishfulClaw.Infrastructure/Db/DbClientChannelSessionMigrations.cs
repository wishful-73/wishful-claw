using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

public static partial class DbClient
{
    private sealed record LegacyChannelSessionRow(string Id, string PluginId, string CompositeKey);

    private static void NormalizeChannelSessionMetadata()
    {
        if (_db is null) return;

        var legacyRows = _db.Query(
            "SELECT id, plugin_id, external_chat_id FROM sessions " +
            "WHERE plugin_id IS NOT NULL AND plugin_id != '' " +
            "AND channel_route_key IS NULL AND external_chat_id LIKE 'plugin:%:chat:%'",
            reader => new LegacyChannelSessionRow(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2)));

        foreach (var row in legacyRows)
        {
            var prefix = $"plugin:{row.PluginId}:chat:";
            if (!row.CompositeKey.StartsWith(prefix, StringComparison.Ordinal)) continue;

            var encodedChatId = row.CompositeKey[prefix.Length..];
            string chatId;
            try
            {
                chatId = Uri.UnescapeDataString(encodedChatId);
            }
            catch
            {
                chatId = encodedChatId;
            }

            _db.Execute(
                "UPDATE sessions SET channel_route_key = @routeKey, external_chat_id = @chatId WHERE id = @id",
                new SqliteParameter("@routeKey", row.CompositeKey),
                new SqliteParameter("@chatId", chatId),
                new SqliteParameter("@id", row.Id));
        }
    }
}
