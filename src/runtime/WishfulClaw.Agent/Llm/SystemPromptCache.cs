using System.Collections.Concurrent;
using WishfulClaw.Contracts;
using WishfulClaw.Core.Protocol;
using WishfulClaw.Infrastructure.Storage;
using WishfulClaw.Workspace.Memory;

namespace WishfulClaw.Agent.Llm;

/// <summary>
/// Caches built system prompts by input parameters.
/// Design inspired by Reasonix: system prompt is built once (boot equivalent)
/// and stays byte-stable across turns to maximize provider prefix cache hits.
/// Memory content (MEMORY.md) is read once and cached — mid-session changes
/// don't touch the prefix, they ride transient user-message injection.
/// </summary>
public static class SystemPromptCache
{
    private static readonly ConcurrentDictionary<string, string> _cache = new();

    /// <summary>
    /// Returns cached prompt if key matches, otherwise builds and caches.
    /// </summary>
    public static string GetOrBuild(string cacheKey, Func<string> builder)
    {
        return _cache.GetOrAdd(cacheKey, _ => builder());
    }

    /// <summary>
    /// Invalidate a specific cache entry (e.g., persona edited).
    /// </summary>
    public static void Invalidate(string cacheKey)
    {
        _cache.TryRemove(cacheKey, out _);
    }

    /// <summary>
    /// Clear all cached prompts.
    /// </summary>
    public static void Clear() => _cache.Clear();

    /// <summary>
    /// Compute a cache key from the parameters that affect system prompt content.
    /// Changes to any of these will miss the cache and rebuild.
    /// AL-2: the key also carries a content fingerprint of the persona's
    /// markdown files (identity/soul/ontology/agents) so editing a persona in
    /// place — same personaId, changed files — naturally misses instead of
    /// serving a stale prompt until worker restart. MEMORY.md mtime rides along
    /// so memory hot-writes rebuild on the next session too.
    /// iter-32 S-79: the sandbox flag rides along because the prompt carries a
    /// sandbox section — toggling the setting must rebuild, not serve a prompt
    /// that disagrees with what the tool layer actually enforces.
    /// </summary>
    public static string ComputeKey(
        string? personaId,
        string? workingFolder,
        string? language,
        string? userRules,
        string? sshConnectionId,
        string? projectId,
        string? sessionMode = null,
        string? pluginId = null,
        string? externalChatId = null,
        bool sandboxEnabled = true,
        bool memoryFullInjection = false)
    {
        return string.Join('|',
            personaId ?? string.Empty,
            workingFolder ?? string.Empty,
            language ?? string.Empty,
            userRules ?? string.Empty,
            sshConnectionId ?? string.Empty,
            projectId ?? string.Empty,
            sessionMode ?? string.Empty,
            pluginId ?? string.Empty,
            externalChatId ?? string.Empty,
            sandboxEnabled ? "sandbox" : "nosandbox",
            // S-313 §6.6：两种模式产出的提示完全不同（全文 vs 一行指针），必须各自成键，
            // 否则切换开关后会命中另一种模式的旧提示。
            memoryFullInjection ? "memfull" : "memptr",
            GetPersonaFingerprint(personaId, workingFolder),
            memoryFullInjection
                ? GetMemoryFingerprint(sshConnectionId, projectId, workingFolder)
                : string.Empty);
    }

    /// <summary>
    /// S-314：MEMORY.md 的 mtime，**只在全文注入模式下才进 key**。
    ///
    /// 指针模式里提示不含记忆内容，把 mtime 放进去只会让前缀在内容没变时白白重建 ——
    /// 拿缓存命中率换一个不存在的收益。全文模式下它是必需的：上面那段注释早就写着
    /// 「memory hot-writes rebuild on the next session too」，可在此之前 key 里根本没有
    /// MEMORY.md，那句话从来没成立过，跨会话一直读到的是旧快照。
    /// </summary>
    private static string GetMemoryFingerprint(string? sshConnectionId, string? projectId, string? workingFolder)
    {
        try
        {
            var scope = MemoryPathResolver.ResolveScope(sshConnectionId, projectId, workingFolder);
            var path = MemoryPathResolver.GetMemoryFilePath(scope);
            return File.Exists(path)
                ? File.GetLastWriteTimeUtc(path).Ticks.ToString(System.Globalization.CultureInfo.InvariantCulture)
                : string.Empty;
        }
        catch (Exception ex)
        {
            WorkerLog.Debug($"SystemPromptCache: memory fingerprint failed: {ex.Message}");
            return string.Empty;
        }
    }

    /// <summary>
    /// Cheap fingerprint: max LastWriteTimeUtc ticks across the persona's four
    /// markdown files (or empty when the persona has no directory). Ticks are
    /// stable while files are untouched, change on any edit.
    /// </summary>
    private static string GetPersonaFingerprint(string? personaId, string? workingFolder)
    {
        if (string.IsNullOrWhiteSpace(personaId))
        {
            return string.Empty;
        }

        try
        {
            var globalDir = WishfulClawDataDir.Resolve("personas", personaId);
            var dir = !string.IsNullOrWhiteSpace(workingFolder)
                ? Path.Combine(WishfulClawDataDir.ProjectRoot(workingFolder), "personas", personaId)
                : globalDir;

            long latest = 0;
            if (Directory.Exists(dir))
            {
                foreach (var f in Directory.EnumerateFiles(dir, "*.md"))
                {
                    var ticks = File.GetLastWriteTimeUtc(f).Ticks;
                    if (ticks > latest) latest = ticks;
                }
            }
            else if (Directory.Exists(globalDir))
            {
                foreach (var f in Directory.EnumerateFiles(globalDir, "*.md"))
                {
                    var ticks = File.GetLastWriteTimeUtc(f).Ticks;
                    if (ticks > latest) latest = ticks;
                }
            }

            return latest.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        catch (Exception ex)
        {
            // Fingerprinting must never break prompt building; on failure the
            // key just loses its file-sensitivity for this run.
            WorkerLog.Debug($"SystemPromptCache: persona fingerprint failed id={personaId}: {ex.Message}");
            return string.Empty;
        }
    }
}
