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
    public static void Register(string projectRoot, string? dataRoot)
    {
        if (string.IsNullOrWhiteSpace(projectRoot) || string.IsNullOrWhiteSpace(dataRoot))
        {
            return;
        }

        var key = Path.GetFullPath(projectRoot);
        var value = Path.GetFullPath(dataRoot.Trim());
        DataRoots[key] = value;
    }

    // The explicit data dir for a root, or null when unmapped (centralized default).
    public static string? TryGet(string projectRoot)
    {
        return DataRoots.TryGetValue(Path.GetFullPath(projectRoot), out var dir) ? dir : null;
    }

    // Test/maintenance hook: drop all mappings.
    public static void Clear() => DataRoots.Clear();
}
