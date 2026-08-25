using System.Collections.Concurrent;

// =============================================================================
// CodeGraphDataRootRegistry — WishfulClaw extension over the vendored centralized
// layout (reference/04 Decision 3). Maps a canonicalized project root to an explicit
// per-project data directory (e.g. {workingFolder}/.wishful-claw/codegraph), so the
// graph DB lives next to the project's other .wishful-claw/ state instead of the
// global ~/.wishful-claw/codegraph/<hash>/ store.
//
// The registry is consulted by CodeGraphDataDir when resolving GraphDbPath — this
// keeps every vendored engine/facade signature unchanged (no dataRoot threading
// through Open/OpenReadOnly/IndexAll/...). The host (main-process IPC) injects
// dataRoot as an optional RPC arg; CodeGraphToolHandler.ResolveWorkingFolder's
// callers register the mapping right after resolving the root, BEFORE any
// EnsureHandle/IsInitialized read, so the first open already lands in the right dir.
//
// Entries are sticky for the process lifetime: a project never flips storage
// location mid-session (the cached engines hold open SQLite handles on the old
// path). Absent mapping = the vendored centralized default.
// Reflection-free, AOT-safe.
// =============================================================================
internal static class CodeGraphDataRootRegistry
{
    private static readonly ConcurrentDictionary<string, string> DataRoots = new(StringComparer.Ordinal);

    // Register (or confirm) the explicit data dir for a project root. A null/empty/
    // whitespace dataRoot is a no-op (keep whatever is registered; default otherwise).
    // A leading `~` expands to the user profile first — Path.GetFullPath does NOT
    // expand it, and would otherwise anchor the dir under the process CWD.
    public static void Register(string projectRoot, string? dataRoot)
    {
        if (string.IsNullOrWhiteSpace(projectRoot) || string.IsNullOrWhiteSpace(dataRoot))
        {
            return;
        }

        var trimmed = dataRoot.Trim();
        if (trimmed == "~" || trimmed.StartsWith("~/", StringComparison.Ordinal) || trimmed.StartsWith("~\\", StringComparison.Ordinal))
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            if (string.IsNullOrEmpty(home))
            {
                home = Environment.GetEnvironmentVariable("HOME") ?? string.Empty;
            }

            if (!string.IsNullOrEmpty(home))
            {
                trimmed = Path.Combine(home, trimmed.Length == 1 ? string.Empty : trimmed[2..]);
            }
        }

        var key = Path.GetFullPath(projectRoot);
        var value = Path.GetFullPath(trimmed);
        var changed = !DataRoots.TryGetValue(key, out var existing) ||
                      !string.Equals(existing, value, StringComparison.OrdinalIgnoreCase);
        DataRoots[key] = value;
        if (changed)
        {
            // The mapping moved mid-session: any cached engine for this root was
            // opened against the previous location — drop it so the next open lands
            // in the registered dir instead of silently reading the old DB.
            CodeGraphToolHandler.DropEngine(key);
        }
    }

    // The explicit data dir for a root, or null when unmapped (centralized default).
    public static string? TryGet(string projectRoot)
    {
        return DataRoots.TryGetValue(Path.GetFullPath(projectRoot), out var dir) ? dir : null;
    }

    // Test/maintenance hook: drop all mappings.
    public static void Clear() => DataRoots.Clear();
}
