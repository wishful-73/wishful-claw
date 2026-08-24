using System.Collections.Concurrent;
using WishfulClaw.Core.Protocol;

namespace WishfulClaw.Agent;

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
    /// </summary>
    public static string ComputeKey(
        string? personaId,
        string? workingFolder,
        string? language,
        string? userRules,
        string? sshConnectionId,
        string? projectId,
        string? sessionMode = null)
    {
        return string.Join('|',
            personaId ?? string.Empty,
            workingFolder ?? string.Empty,
            language ?? string.Empty,
            userRules ?? string.Empty,
            sshConnectionId ?? string.Empty,
            projectId ?? string.Empty,
            sessionMode ?? string.Empty,
            GetPersonaFingerprint(personaId, workingFolder));
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
            var globalDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                ".wishful-claw", "personas", personaId);
            var dir = !string.IsNullOrWhiteSpace(workingFolder)
                ? Path.Combine(workingFolder, ".wishful-claw", "personas", personaId)
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
