using System.Text;

// =============================================================================
// CodeGraphDataDir — the per-project graph-DB location resolver (reference/04
// Decision 3 / 00-overview Decision 3).
//
// The graph DB is CENTRALIZED, never co-located in the repo:
//     ~/.wishful-claw/codegraph/<sha256(projectRoot)>/graph.db
//
// Rationale (Decision 3): keeps user repos clean (no stray dir to gitignore), the
// app already owns ~/.wishful-claw/, works for SSH/remote working folders where
// in-repo writes fail, and eliminates the whole #925 inode-replace self-heal class
// (isReplacedOnDisk / reopenIfReplaced) that only existed because standalone
// CodeGraph wrote into a repo other processes could `rm -rf`.
//
// The hash is a full lowercase-hex SHA-256 of the canonicalized absolute project
// root, reusing CodeGraphNodeIdFactory.ContentHash (Decision 17 shares one hash
// implementation). These are REAL filesystem paths, so System.IO.Path is correct
// here (never CodeGraphPosixPath — that is only for the posix graph paths stored in
// the DB).
// =============================================================================
internal static class CodeGraphDataDir
{
    // The codegraph base under the app's data dir. `CODEGRAPH_HOME` overrides the
    // whole base (single dir) — chiefly a test hook so a suite does not scribble in
    // the developer's real ~/.wishful-claw/.
    //
    // WishfulClaw extension: a project registered in CodeGraphDataRootRegistry (the
    // host maps {workingFolder} -> {workingFolder}/.wishful-claw/codegraph) stores its
    // graph DB project-locally instead of the centralized base. Unregistered roots
    // keep the vendored Decision 3 layout.
    public static string CodeGraphBaseDir(string? projectRoot = null)
    {
        if (!string.IsNullOrEmpty(projectRoot))
        {
            var local = CodeGraphDataRootRegistry.TryGet(projectRoot);
            if (!string.IsNullOrEmpty(local))
            {
                return local;
            }
        }

        var overrideDir = Environment.GetEnvironmentVariable("CODEGRAPH_HOME");
        if (!string.IsNullOrEmpty(overrideDir))
        {
            return overrideDir;
        }

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrEmpty(home))
        {
            home = Environment.GetEnvironmentVariable("HOME") ?? ".";
        }

        return Path.Combine(home, ".wishful-claw", "codegraph");
    }

    // The per-project data directory (…/codegraph/<hash>, or the registered
    // project-local dir). Hashing is skipped entirely for registered roots — their
    // dir IS the data dir, no per-project subdirectory.
    public static string CodeGraphDir(string projectRoot)
    {
        var local = string.IsNullOrEmpty(projectRoot)
            ? null
            : CodeGraphDataRootRegistry.TryGet(projectRoot);
        if (!string.IsNullOrEmpty(local))
        {
            return local;
        }

        return Path.Combine(CodeGraphBaseDir(), HashRoot(projectRoot));
    }

    // The per-project graph DB path (…/codegraph/<hash>/graph.db). Its parent dir is
    // created lazily by CodeGraphConnectionFactory on open.
    public static string GraphDbPath(string projectRoot) =>
        Path.Combine(CodeGraphDir(projectRoot), "graph.db");

    // Whether a graph DB has been created for this project ("initialized" ≙ the DB
    // file exists — the centralized model has no separate `.codegraph/` dir to check).
    public static bool IsInitialized(string projectRoot) =>
        File.Exists(GraphDbPath(projectRoot));

    // Delete the project's whole data directory (graph.db + WAL/SHM sidecars). The
    // facade's uninitialize path; symlink-safe (Directory.Delete does not follow the
    // top link's target).
    public static void Remove(string projectRoot)
    {
        var dir = CodeGraphDir(projectRoot);
        if (Directory.Exists(dir))
        {
            Directory.Delete(dir, recursive: true);
        }
    }

    // sha256(canonicalized absolute root) as 64-char lowercase hex. Canonicalization:
    // resolve to a full path, forward-slash it, drop a trailing slash, and lowercase
    // on Windows (its FS is case-insensitive, so two casings of one dir must share an
    // index). POSIX keeps case (its FS is case-sensitive).
    private static string HashRoot(string projectRoot)
    {
        var full = Path.GetFullPath(projectRoot).Replace('\\', '/').TrimEnd('/');
        if (full.Length == 0)
        {
            full = "/";
        }

        if (OperatingSystem.IsWindows())
        {
            full = full.ToLowerInvariant();
        }

        return CodeGraphNodeIdFactory.ContentHash(Encoding.UTF8.GetBytes(full));
    }
}
