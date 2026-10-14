using System.Globalization;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Infrastructure.Db;

public static partial class DbUsageLogQueryTools
{
    /// <summary>
    /// 请求明细筛选里 NULL 列的哨兵（S-190）。`db/usage-by-model` 把 `provider_id` /
    /// `model_id` 的 NULL 显示化为 `'(unknown)'`；渲染端回填筛选键时必须保住
    /// 「这一列是 NULL 还是空串」的区别 —— 用空串代替 NULL 会被拼成 `provider_id = ''`，
    /// 对 DB 中 `provider_id IS NULL` 的行永不命中（选项可点却恒得 0 条）。
    /// </summary>
    private const string NullFilterToken = "\u0000";

    /// <summary>
    /// Shared WHERE clause for the request-detail view: the time window plus the three
    /// optional filters (models / status / httpStatusCodes). Both the COUNT(*) and the
    /// paged SELECT funnel through here so `total` and the returned rows can never drift
    /// apart — a mismatch would make paging skip or repeat rows. Every literal binds as a
    /// SqliteParameter; an empty filter adds no clause at all (never a fallback to all).
    ///
    /// `models` 的每个元素是 `providerId&lt;US&gt;modelId`；任一侧等于 `NullFilterToken`
    /// 时该侧生成 `IS NULL`（而不是 `= $param`），与 `by-model` 的 `(unknown)` 显示化对齐。
    /// </summary>
    private static string BuildDetailWhere(
        JsonElement parameters, (long From, long To) window, List<SqliteParameter> args)
    {
        var where = new System.Text.StringBuilder("started_at >= $from AND started_at < $to");
        args.Add(new SqliteParameter("$from", window.From));
        args.Add(new SqliteParameter("$to", window.To));

        var models = JsonHelpers.GetStringArray(parameters, "models");
        if (models.Length > 0)
        {
            var clauses = new List<string>(models.Length);
            for (var i = 0; i < models.Length; i++)
            {
                // Each element is "providerId\u001FmodelId": the same model_id is served by
                // several providers, so binding model_id alone would merge their traffic.
                var parts = models[i].Split('\u001F', 2);
                var providerToken = parts[0];
                var modelToken = parts.Length > 1 ? parts[1] : string.Empty;

                var providerIsNull = providerToken == NullFilterToken;
                var modelIsNull = modelToken == NullFilterToken;
                if (!providerIsNull)
                {
                    args.Add(new SqliteParameter($"$m{i}p", providerToken));
                }
                if (!modelIsNull)
                {
                    args.Add(new SqliteParameter($"$m{i}m", modelToken));
                }
                clauses.Add(
                    $"({(providerIsNull ? "provider_id IS NULL" : $"provider_id = $m{i}p")} AND " +
                    $"{(modelIsNull ? "model_id IS NULL" : $"model_id = $m{i}m")})");
            }
            // SQLite has no row-value IN, so the (provider, model) pairs expand to an OR group.
            where.Append($" AND ({string.Join(" OR ", clauses)})");
        }

        var statuses = JsonHelpers.GetStringArray(parameters, "status");
        if (statuses.Length > 0)
        {
            var placeholders = new string[statuses.Length];
            for (var i = 0; i < statuses.Length; i++)
            {
                placeholders[i] = $"$st{i}";
                args.Add(new SqliteParameter($"$st{i}", statuses[i]));
            }
            where.Append($" AND status IN ({string.Join(", ", placeholders)})");
        }

        var httpStatusCodes = JsonHelpers.GetStringArray(parameters, "httpStatusCodes");
        var codes = new List<int>(httpStatusCodes.Length);
        foreach (var raw in httpStatusCodes)
        {
            // Non-numeric entries are dropped rather than rejected: a stray value in the
            // text box must not fail the whole request.
            if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var code))
            {
                codes.Add(code);
            }
        }
        if (codes.Count > 0)
        {
            var placeholders = new string[codes.Count];
            for (var i = 0; i < codes.Count; i++)
            {
                placeholders[i] = $"$hs{i}";
                args.Add(new SqliteParameter($"$hs{i}", codes[i]));
            }
            where.Append($" AND http_status_code IN ({string.Join(", ", placeholders)})");
        }

        return where.ToString();
    }
}
