using Microsoft.Data.Sqlite;

namespace WishfulClaw.Infrastructure.Db;

/// <summary>
/// Null-safe extension methods for SqliteDataReader.
/// All methods are AOT-safe (no reflection — column ordinals resolved at runtime via GetOrdinal).
/// </summary>
public static class DbReaderExtensions
{
    public static string? GetNullableString(this SqliteDataReader r, string name)
    {
        var ord = r.GetOrdinal(name);
        return r.IsDBNull(ord) ? null : r.GetString(ord);
    }

    public static long GetInt64(this SqliteDataReader r, string name)
    {
        return r.GetInt64(r.GetOrdinal(name));
    }

    public static long? GetNullableInt64(this SqliteDataReader r, string name)
    {
        var ord = r.GetOrdinal(name);
        return r.IsDBNull(ord) ? null : r.GetInt64(ord);
    }

    public static int GetInt32(this SqliteDataReader r, string name)
    {
        return r.GetInt32(r.GetOrdinal(name));
    }

    public static int? GetNullableInt32(this SqliteDataReader r, string name)
    {
        var ord = r.GetOrdinal(name);
        return r.IsDBNull(ord) ? null : r.GetInt32(ord);
    }

    public static string GetString(this SqliteDataReader r, string name)
    {
        return r.GetString(r.GetOrdinal(name));
    }

    public static double? GetNullableDouble(this SqliteDataReader r, string name)
    {
        var ord = r.GetOrdinal(name);
        return r.IsDBNull(ord) ? null : r.GetDouble(ord);
    }

    public static int GetBoolAsInt(this SqliteDataReader r, string name)
    {
        var ord = r.GetOrdinal(name);
        return r.IsDBNull(ord) ? 0 : r.GetInt32(ord);
    }
}
