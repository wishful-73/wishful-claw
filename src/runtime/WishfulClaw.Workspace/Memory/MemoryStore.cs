using System.Collections.Concurrent;
using System.Text;
using System.Text.RegularExpressions;

namespace WishfulClaw.Workspace.Memory;

/// <summary>
/// File-based hot memory store — only manages MEMORY.md.
/// MB-3: read-modify-write cycles (Upsert/Delete) are serialized per scope
/// with a semaphore so concurrent writers cannot silently drop each other's
/// changes. Reads stay lock-free.
/// </summary>
public sealed class MemoryStore : IMemoryStore
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> ScopeLocks = new(StringComparer.Ordinal);

    private static SemaphoreSlim GetScopeLock(string scope) =>
        ScopeLocks.GetOrAdd(scope, static s => new SemaphoreSlim(1, 1));

    public Task EnsureMemoryLayoutAsync(string scope, CancellationToken ct = default)
    {
        var root = MemoryPathResolver.ResolveRoot(scope);
        Directory.CreateDirectory(root);
        var memoryFile = MemoryPathResolver.GetMemoryFilePath(scope);
        if (!File.Exists(memoryFile))
        {
            File.WriteAllText(memoryFile, "# Long-Term Memory\n");
        }
        return Task.CompletedTask;
    }

    public async Task<IReadOnlyList<MemorySection>> ReadMemoryAsync(string scope, CancellationToken ct = default)
    {
        var path = MemoryPathResolver.GetMemoryFilePath(scope);
        if (!File.Exists(path))
            return [];
        var content = await File.ReadAllTextAsync(path, ct);
        return MemoryMarkdownParser.ParseSections(content);
    }

    public async Task WriteMemoryAsync(string scope, string content, CancellationToken ct = default)
    {
        await GetScopeLock(scope).WaitAsync(ct);
        try
        {
            var path = MemoryPathResolver.GetMemoryFilePath(scope);
            await EnsureMemoryLayoutAsync(scope, ct);
            await File.WriteAllTextAsync(path, content, ct);
        }
        finally
        {
            GetScopeLock(scope).Release();
        }
    }

    public async Task UpsertSectionAsync(string scope, string title, string body, CancellationToken ct = default)
    {
        await GetScopeLock(scope).WaitAsync(ct);
        try
        {
            var path = MemoryPathResolver.GetMemoryFilePath(scope);
            await EnsureMemoryLayoutAsync(scope, ct);
            var content = File.Exists(path)
                ? await File.ReadAllTextAsync(path, ct)
                : "# Long-Term Memory\n";
            var updated = MemoryMarkdownParser.UpsertSection(content, title, body);
            await File.WriteAllTextAsync(path, updated, ct);
        }
        finally
        {
            GetScopeLock(scope).Release();
        }
    }

    public async Task<bool> DeleteSectionAsync(string scope, string title, CancellationToken ct = default)
    {
        await GetScopeLock(scope).WaitAsync(ct);
        try
        {
            var path = MemoryPathResolver.GetMemoryFilePath(scope);
            if (!File.Exists(path))
                return false;
            var content = await File.ReadAllTextAsync(path, ct);
            var updated = MemoryMarkdownParser.DeleteSection(content, title);
            if (updated == content)
                return false; // Section not found
            await File.WriteAllTextAsync(path, updated, ct);
            return true;
        }
        finally
        {
            GetScopeLock(scope).Release();
        }
    }

    public Task<MemoryStats> GetStatsAsync(string scope, CancellationToken ct = default)
    {
        var memoryFile = MemoryPathResolver.GetMemoryFilePath(scope);
        var hotCount = 0;
        if (File.Exists(memoryFile))
        {
            var content = File.ReadAllText(memoryFile);
            hotCount = MemoryMarkdownParser.ParseSections(content).Count;
        }
        return Task.FromResult(new MemoryStats
        {
            HotCount = hotCount,
            WarmCount = 0,
            ColdCount = 0,
            TopicsCount = 0,
            DailyCount = 0
        });
    }
}
