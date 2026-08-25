using System.Text.Json;

// Management surface for the plugin settings UI: enumerate every indexed project
// (the centralized layout keys dirs by sha256(root); the root itself is read back
// from each DB's project_metadata) and remove a project's index. Read paths open a
// transient store (WAL allows concurrent readers alongside a cached engine).
internal sealed record CodeGraphProjectInfo(
    string Root,
    string Hash,
    string State,
    int Files,
    int Nodes,
    int Edges,
    long DbSizeBytes,
    long? LastIndexedAt);

internal sealed record CodeGraphProjectListResult(
    bool Success,
    IReadOnlyList<CodeGraphProjectInfo> Projects,
    string? Error = null);

internal sealed record CodeGraphRemoveProjectResult(bool Success, string? Error = null);

internal static class CodeGraphAdminTools
{
    public static CodeGraphProjectListResult ListProjects()
    {
        try
        {
            var baseDir = CodeGraphDataDir.CodeGraphBaseDir();
            if (!Directory.Exists(baseDir))
            {
                return new CodeGraphProjectListResult(true, Array.Empty<CodeGraphProjectInfo>());
            }

            var projects = new List<CodeGraphProjectInfo>();
            foreach (var dir in Directory.EnumerateDirectories(baseDir))
            {
                var dbPath = Path.Combine(dir, "graph.db");
                if (!File.Exists(dbPath))
                {
                    continue; // e.g. the grammars/ cache dir — not a project
                }

                var hash = Path.GetFileName(dir);
                try
                {
                    using var store = CodeGraphStoreFactory.OpenExisting(dbPath);
                    var stats = store.GetStats();
                    projects.Add(new CodeGraphProjectInfo(
                        Root: store.GetMetadata("project_root") ?? string.Empty,
                        Hash: hash,
                        State: store.GetMetadata("index_state") ?? "unknown",
                        Files: stats.FileCount,
                        Nodes: stats.NodeCount,
                        Edges: stats.EdgeCount,
                        DbSizeBytes: DbSizeWithSidecars(dbPath),
                        LastIndexedAt: store.GetLastIndexedAt()));
                }
                catch (Exception ex)
                {
                    // A locked/corrupt DB must not hide the rest of the list.
                    projects.Add(new CodeGraphProjectInfo(
                        Root: string.Empty,
                        Hash: hash,
                        State: $"error: {ex.Message}",
                        Files: 0,
                        Nodes: 0,
                        Edges: 0,
                        DbSizeBytes: DbSizeWithSidecars(dbPath),
                        LastIndexedAt: null));
                }
            }

            projects.Sort(static (a, b) => string.CompareOrdinal(a.Root, b.Root));
            return new CodeGraphProjectListResult(true, projects);
        }
        catch (Exception ex)
        {
            return new CodeGraphProjectListResult(false, Array.Empty<CodeGraphProjectInfo>(), ex.Message);
        }
    }

    public static CodeGraphRemoveProjectResult RemoveProject(string? workingFolder, string? hash)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(workingFolder))
            {
                CodeGraphToolHandler.DropEngine(workingFolder);
                CodeGraphDataDir.Remove(workingFolder);
                return new CodeGraphRemoveProjectResult(true);
            }

            if (!string.IsNullOrWhiteSpace(hash))
            {
                // Fallback for DBs that predate the project_root stamp: delete by dir
                // name. Guard against traversal — a hash is 64 lowercase hex chars.
                if (hash.Length != 64 || !hash.All(static c => c is >= '0' and <= '9' or >= 'a' and <= 'f'))
                {
                    return new CodeGraphRemoveProjectResult(false, "invalid hash");
                }
                var dir = Path.Combine(CodeGraphDataDir.CodeGraphBaseDir(), hash);
                if (Directory.Exists(dir))
                {
                    Directory.Delete(dir, recursive: true);
                }
                return new CodeGraphRemoveProjectResult(true);
            }

            return new CodeGraphRemoveProjectResult(false, "workingFolder or hash is required");
        }
        catch (Exception ex)
        {
            return new CodeGraphRemoveProjectResult(false, ex.Message);
        }
    }

    // RPC adapters (module registration).
    public static WorkerResponse ListProjectsRpc(JsonElement _) =>
        WorkerResponse.Json(ListProjects(), CodeGraphJsonContext.Default.CodeGraphProjectListResult);

    public static WorkerResponse RemoveProjectRpc(JsonElement args) =>
        WorkerResponse.Json(
            RemoveProject(
                JsonHelpers.GetString(args, "workingFolder") ?? JsonHelpers.GetString(args, "projectPath"),
                JsonHelpers.GetString(args, "hash")),
            CodeGraphJsonContext.Default.CodeGraphRemoveProjectResult);

    private static long DbSizeWithSidecars(string dbPath)
    {
        long size = 0;
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            var f = new FileInfo(dbPath + suffix);
            if (f.Exists) size += f.Length;
        }
        return size;
    }
}
