using System.Collections.Concurrent;
using System.Text.Json;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;

namespace WishfulClaw.Agent;

/// <summary>
/// S-236 档 2 的「记住」：某个 (provider, model) 经**真实请求**撞出过「不吃图像输入」，
/// 下次不必再白送一遍图、再吃一次 400。
///
/// 与配置里的 <c>supportsVision</c> 的区别，是这一整条链的关键：
///
/// | | 配置的 supportsVision | 这里的记忆 |
/// |---|---|---|
/// | 来源 | 预设表 / 用户手填 | **上游真回了错** |
/// | 首次行为 | 直接拒，不给模型看的机会 | **先给模型看** |
/// | 出错时 | 静默吞图 | 剥图重试，用户仍拿到回答 |
///
/// 一句话：**配置不许替模型说「你不行」，只有上游真的说了才算。**
/// 所以这张表只由 <see cref="ProviderRetryPolicy"/> 之外的失败路径写入
/// （<c>AgentLoop</c> 的图像降级分支），不读用户配置、也不回写用户配置 ——
/// 回写会把「一次误判」变成「永久改坏用户的模型设置」。
///
/// 存放位置跟随全局数据目录（<see cref="WishfulClawDataDir.Root"/>），dev 与正式实例天然隔离。
/// 读写失败一律不影响主流程：记不住只是多撞一次 400，不能让读图功能因此挂掉。
/// </summary>
internal static class ImageVisionMemory
{
    private const string FileName = "image-vision-unsupported.json";

    /// <summary>key = <c>{providerId}:{modelId}</c>，value = 首次撞上的时刻（给 UI 显示「经实测」的日期）。</summary>
    private static readonly ConcurrentDictionary<string, DateTimeOffset> Entries =
        new(StringComparer.OrdinalIgnoreCase);

    private static readonly object Gate = new();
    private static bool _loaded;

    private static string FilePath => WishfulClawDataDir.Resolve(FileName);

    /// <summary>这个 (provider, model) 是否已知不吃图。用于组包前直接剥图，省掉一次必败的往返。</summary>
    internal static bool IsKnownUnsupported(string? providerId, string? modelId)
    {
        var key = BuildKey(providerId, modelId);
        if (key is null) return false;
        EnsureLoaded();
        return Entries.ContainsKey(key);
    }

    /// <summary>撞上了就记下来。重复撞同一个不会刷新时间 —— 首次实测日期更有信息量。</summary>
    internal static void RememberUnsupported(string? providerId, string? modelId)
    {
        var key = BuildKey(providerId, modelId);
        if (key is null) return;

        EnsureLoaded();
        if (!Entries.TryAdd(key, DateTimeOffset.Now))
        {
            return;
        }

        Persist(key);
    }

    /// <summary>首次撞上的时刻；没有记录返回 null。</summary>
    internal static DateTimeOffset? GetRememberedAt(string? providerId, string? modelId)
    {
        var key = BuildKey(providerId, modelId);
        if (key is null) return null;
        EnsureLoaded();
        return Entries.TryGetValue(key, out var at) ? at : null;
    }

    private static string? BuildKey(string? providerId, string? modelId)
    {
        var provider = providerId?.Trim();
        var model = modelId?.Trim();
        if (string.IsNullOrEmpty(provider) || string.IsNullOrEmpty(model))
        {
            // 身份不全就不记：一条不知道属于哪个渠道的记录，下次可能把能读图的模型记成瞎的。
            return null;
        }

        return $"{provider}:{model}";
    }

    private static void EnsureLoaded()
    {
        if (_loaded) return;
        lock (Gate)
        {
            if (_loaded) return;
            _loaded = true;

            try
            {
                if (!File.Exists(FilePath)) return;
                var raw = File.ReadAllText(FilePath);
                if (string.IsNullOrWhiteSpace(raw)) return;

                var parsed = JsonSerializer.Deserialize<Dictionary<string, DateTimeOffset>>(raw);
                if (parsed is null) return;
                foreach (var item in parsed)
                {
                    Entries[item.Key] = item.Value;
                }
            }
            catch (Exception ex) when (ex is IOException or JsonException or UnauthorizedAccessException)
            {
                // 文件坏了就当没记过 —— 顶多重撞一次 400，不影响功能。
                WorkerLog.Warn($"image vision memory could not be loaded: {ex.Message}");
            }
        }
    }

    private static void Persist(string justAddedKey)
    {
        lock (Gate)
        {
            try
            {
                var directory = Path.GetDirectoryName(FilePath);
                if (!string.IsNullOrEmpty(directory))
                {
                    Directory.CreateDirectory(directory);
                }

                var snapshot = new Dictionary<string, DateTimeOffset>(Entries, StringComparer.OrdinalIgnoreCase);
                var json = JsonSerializer.Serialize(
                    snapshot,
                    new JsonSerializerOptions { WriteIndented = true });

                // 先写临时文件再替换：半截写入的 json 会让下次启动读不出全部记录。
                var temp = FilePath + ".tmp";
                File.WriteAllText(temp, json);
                File.Move(temp, FilePath, overwrite: true);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                WorkerLog.Warn($"image vision memory could not be saved ({justAddedKey}): {ex.Message}");
            }
        }
    }
}
