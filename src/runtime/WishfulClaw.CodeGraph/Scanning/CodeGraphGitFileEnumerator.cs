using System.Diagnostics;
using System.Text;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphGitFileEnumerator — the git fast path of the scanner (port of
// extraction/index.ts getGitVisibleFiles / collectGitFiles / classifyGitDir /
// findNestedGitRepos / listIgnoredDirs / findIgnoredEmbeddedRepos / collectIncluded).
//
// Enumerates every file git considers part of the project — tracked + untracked,
// `.gitignore`-respected at every level — by shelling `git ls-files` (analysis/05
// §2.5). `-z` NUL-separation keeps non-ASCII (CJK) paths intact (#541); `-s` (stage)
// carries the file mode so unexpanded gitlinks (160000) are spotted and recursed
// into (#1031/#1033). Embedded git repos (a nested `.git` that is not a submodule —
// the CMake super-repo layout, #193) and active submodules (`--recurse-submodules`)
// are pulled in; git worktrees are skipped as duplicate views (#848/#945).
//
// The result is then filtered through the shared ScopeIgnore (built-in defaults
// applied uniformly, per-embedded-repo `.gitignore`, user exclude/include) and the
// `include` whitelist is force-added off disk. Returns null on any non-git root (or
// a root gitignored by a parent repo) so the caller falls back to the FS walk.
//
// git is invoked through a bounded-timeout System.Diagnostics.Process, mirroring the
// worker's GitTools process pattern (analysis/05 §4 "reuse that helper"). git not
// being on PATH, or any hard failure of the primary listing, degrades to null.
// =============================================================================
internal static class CodeGraphGitFileEnumerator
{
    private const int GitProbeTimeoutMs = 5_000;
    private const int GitListTimeoutMs = 30_000;

    // Max directory depth searched below an ignored dir for nested `.git` roots.
    private const int EmbeddedRepoSearchDepth = 4;

    // Max directories examined per embedded search — a huge ignored data dir must
    // never stall a scan.
    private const int EmbeddedRepoSearchEntries = 2000;

    // A worktree's `.git` pointer lives under some repo's `.git/worktrees/<name>`
    // (optionally `.git/modules/<module>/worktrees/<name>` for a submodule worktree).
    private static readonly Regex WorktreePointer =
        new(@"(^|[\\/])\.git[\\/](modules[\\/][^\\/]+[\\/])?worktrees[\\/]", RegexOptions.CultureInvariant);

    private static readonly Regex GitDirLine =
        new(@"^gitdir:\s*(.+)$", RegexOptions.Multiline | RegexOptions.CultureInvariant);

    private static readonly StringComparison PathComparison =
        OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;

    // All files visible to git (tracked + untracked, `.gitignore`-respected), or null
    // for a non-git project / a root a parent repo gitignores. (getGitVisibleFiles)
    public static HashSet<string>? GetGitVisibleFiles(string rootDir, CodeGraphProjectConfig config)
    {
        // `git rev-parse --show-toplevel` — non-git (or git absent) → FS-walk fallback.
        var (topOk, top) = RunGit(new[] { "rev-parse", "--show-toplevel" }, rootDir, GitProbeTimeoutMs);
        if (!topOk)
        {
            return null;
        }

        var gitRoot = top.Trim();
        if (gitRoot.Length > 0 && !string.Equals(FullPath(gitRoot), FullPath(rootDir), PathComparison))
        {
            // rootDir lives inside a parent repo. If that parent gitignores rootDir,
            // `git ls-files` here returns nothing — fall back to the FS walk. `git
            // check-ignore -q` exits 0 when the path IS ignored.
            var (ignored, _) = RunGit(new[] { "check-ignore", "-q", FullPath(rootDir) }, rootDir, GitProbeTimeoutMs);
            if (ignored)
            {
                return null;
            }
        }

        var files = new HashSet<string>(StringComparer.Ordinal);
        var embeddedRoots = new HashSet<string>(StringComparer.Ordinal);
        var includeIgnored = CodeGraphScopeIgnore.LoadIncludeIgnoredMatcher(config);
        if (!CollectGitFiles(rootDir, string.Empty, files, embeddedRoots, includeIgnored, topLevel: true))
        {
            // The root's own `git ls-files` failed — treat as non-git.
            return null;
        }

        // Apply the shared scope matcher uniformly (defaults to tracked files too,
        // per-embedded-repo rules, user exclude/include). (#407/#514/#999)
        var scope = CodeGraphScopeIgnore.Build(rootDir, config, embeddedRoots);
        var visible = new HashSet<string>(StringComparer.Ordinal);
        foreach (var f in files)
        {
            if (!scope.Ignores(f))
            {
                visible.Add(f);
            }
        }

        // Force-include first-party source whitelisted in `codegraph.json` `include`
        // — gitignored, so `git ls-files` never listed it; discover it off disk.
        foreach (var f in CollectIncludedFilesForRoot(rootDir, config))
        {
            visible.Add(f);
        }

        return visible;
    }

    // ------------------------------------------------------------------------
    // git file collection
    // ------------------------------------------------------------------------

    // Collect git-visible files from the repo at `repoDir`, prefixing each with
    // `prefix` so paths stay relative to the original scan root. Recurses into
    // embedded repos / unexpanded gitlinks / opted-in ignored embedded repos. Returns
    // false only when the top-level tracked listing fails (→ non-git); embedded
    // recursion is best-effort. (collectGitFiles)
    private static bool CollectGitFiles(
        string repoDir,
        string prefix,
        HashSet<string> files,
        HashSet<string> embeddedRoots,
        CodeGraphGitIgnoreMatcher? includeIgnored,
        bool topLevel)
    {
        // Tracked files. `--recurse-submodules` inlines active submodules (#147); `-s`
        // gives each entry its mode so gitlinks (160000) `--recurse-submodules` did
        // NOT expand are spotted and recursed into below (#1031/#1033).
        var (trackedOk, tracked) = RunGit(
            new[] { "ls-files", "-z", "-s", "--recurse-submodules" }, repoDir, GitListTimeoutMs);
        if (!trackedOk)
        {
            return !topLevel; // embedded failures are non-fatal; the root's is fatal
        }

        var gitlinkRels = new List<string>();
        foreach (var entry in tracked.Split('\0'))
        {
            if (entry.Length == 0)
            {
                continue;
            }

            var tab = entry.IndexOf('\t');
            if (tab < 0)
            {
                continue; // `-s` always emits "<mode> <object> <stage>\t<path>"
            }

            var rel = entry[(tab + 1)..];
            if (entry.Length >= 6 && string.Equals(entry[..6], "160000", StringComparison.Ordinal))
            {
                gitlinkRels.Add(rel); // an unexpanded gitlink — recursed into below
                continue;
            }

            files.Add(CodeGraphScanPaths.Posix(prefix + rel));
        }

        // Untracked files. Embedded git repos surface as a single opaque "subdir/"
        // entry git refuses to descend into — recurse into those as their own repos.
        var (untrackedOk, untracked) = RunGit(
            new[] { "ls-files", "-z", "-o", "--exclude-standard" }, repoDir, GitListTimeoutMs);
        if (untrackedOk)
        {
            var defaultsOnly = CodeGraphIgnoreDefaults.DefaultsOnlyIgnore();
            foreach (var rel in untracked.Split('\0'))
            {
                if (rel.Length == 0)
                {
                    continue;
                }

                if (rel.EndsWith('/'))
                {
                    var childDir = CodeGraphScanPaths.NativeJoin(repoDir, rel);
                    // A git worktree also surfaces as an opaque untracked dir — skip it
                    // (#848). Never descend into default-ignored locations (#407).
                    if (ClassifyGitDir(childDir) == GitDirKind.Embedded && !defaultsOnly.Ignores(rel))
                    {
                        embeddedRoots.Add(CodeGraphScanPaths.Posix(prefix + rel));
                        CollectGitFiles(childDir, prefix + rel, files, embeddedRoots, includeIgnored, topLevel: false);
                    }

                    continue;
                }

                files.Add(CodeGraphScanPaths.Posix(prefix + rel));
            }
        }

        // Gitlink entries (160000) `--recurse-submodules` left unexpanded — an
        // embedded repo `git add`ed without `.gitmodules`, or an inactive submodule.
        // Recurse into ones with a real checkout on disk. (#1031/#1033)
        if (gitlinkRels.Count > 0)
        {
            var defaults = CodeGraphIgnoreDefaults.DefaultsOnlyIgnore();
            var repoIgnore = CodeGraphIgnoreDefaults.BuildDefaultIgnore(repoDir);
            foreach (var rel in gitlinkRels)
            {
                var relDir = rel.EndsWith('/') ? rel : rel + "/";
                if (GitlinkEmbeddedRepoSkipped(relDir, prefix, defaults, repoIgnore, includeIgnored))
                {
                    continue;
                }

                var childDir = CodeGraphScanPaths.NativeJoin(repoDir, rel);
                if (ClassifyGitDir(childDir) != GitDirKind.Embedded)
                {
                    continue;
                }

                embeddedRoots.Add(CodeGraphScanPaths.Posix(prefix + relDir));
                CollectGitFiles(childDir, prefix + relDir, files, embeddedRoots, includeIgnored, topLevel: false);
            }
        }

        // Embedded repos hidden by THIS repo's ignore rules — recursed into only when
        // the project opted the dir in via `includeIgnored` (#622/#699); by default
        // `.gitignore` is respected (#970/#976).
        foreach (var rel in FindIgnoredEmbeddedRepos(repoDir, includeIgnored, prefix))
        {
            embeddedRoots.Add(CodeGraphScanPaths.Posix(prefix + rel));
            CollectGitFiles(
                CodeGraphScanPaths.NativeJoin(repoDir, rel), prefix + rel, files, embeddedRoots, includeIgnored, topLevel: false);
        }

        return true;
    }

    // ------------------------------------------------------------------------
    // embedded-repo discovery
    // ------------------------------------------------------------------------

    private enum GitDirKind
    {
        None,
        Embedded,
        Worktree
    }

    // Classify a directory's `.git` entry. A `.git` DIR is an embedded clone (index
    // it); a `.git` FILE pointing into `…/worktrees/…` is a duplicate view (skip).
    // (classifyGitDir)
    private static GitDirKind ClassifyGitDir(string absDir)
    {
        var gitPath = Path.Combine(absDir, ".git");
        try
        {
            if (Directory.Exists(gitPath))
            {
                return GitDirKind.Embedded;
            }

            if (!File.Exists(gitPath))
            {
                return GitDirKind.None;
            }
        }
        catch
        {
            return GitDirKind.None;
        }

        try
        {
            var text = File.ReadAllText(gitPath);
            var match = GitDirLine.Match(text);
            var gitdir = match.Success ? match.Groups[1].Value.Trim() : null;
            if (!string.IsNullOrEmpty(gitdir) && WorktreePointer.IsMatch(gitdir))
            {
                return GitDirKind.Worktree;
            }
        }
        catch
        {
            // Unreadable `.git` pointer — fall back to "index it".
        }

        return GitDirKind.Embedded;
    }

    // Find git repositories nested under `absDir` (inclusive), shallow bounded BFS.
    // Stops at each repo root found; skips default-ignored dirs and codegraph data
    // dirs; depth- and entry-capped. (findNestedGitRepos)
    private static List<string> FindNestedGitRepos(string absDir, string relPrefix)
    {
        var found = new List<string>();
        var defaults = CodeGraphIgnoreDefaults.DefaultsOnlyIgnore();
        var queue = new Queue<(string Abs, string Rel, int Depth)>();
        queue.Enqueue((absDir, relPrefix, 0));
        var examined = 0;

        while (queue.Count > 0)
        {
            var (abs, rel, depth) = queue.Dequeue();
            if (++examined > EmbeddedRepoSearchEntries)
            {
                break;
            }

            var kind = ClassifyGitDir(abs);
            if (kind == GitDirKind.Worktree)
            {
                continue; // duplicate view (#848)
            }

            if (kind == GitDirKind.Embedded)
            {
                found.Add(rel);
                continue; // its own git handles everything below
            }

            if (depth >= EmbeddedRepoSearchDepth)
            {
                continue;
            }

            IEnumerable<string> entries;
            try
            {
                entries = Directory.EnumerateDirectories(abs);
            }
            catch
            {
                continue;
            }

            foreach (var childAbs in entries)
            {
                var name = Path.GetFileName(childAbs);
                if (name == ".git" || CodeGraphScanPaths.IsCodeGraphDataDir(name))
                {
                    continue;
                }

                var childRel = rel + name + "/";
                if (defaults.Ignores(childRel))
                {
                    continue;
                }

                queue.Enqueue((childAbs, childRel, depth + 1));
            }
        }

        return found;
    }

    // List the gitignored DIRECTORIES of a repo (collapsed, trailing-slash), relative
    // to `repoDir`. These are invisible to every other ls-files mode. (listIgnoredDirs)
    private static List<string> ListIgnoredDirs(string repoDir)
    {
        var (ok, output) = RunGit(
            new[] { "ls-files", "-z", "-o", "-i", "--exclude-standard", "--directory" }, repoDir, GitListTimeoutMs);
        if (!ok)
        {
            return new List<string>();
        }

        var dirs = new List<string>();
        foreach (var e in output.Split('\0'))
        {
            if (e.EndsWith('/') && !IsWholeCwdEntry(e))
            {
                dirs.Add(e);
            }
        }

        return dirs;
    }

    // Embedded repos hidden by `repoDir`'s OWN gitignore — opt-in only, via
    // `includeIgnored`. Returns [] otherwise (#970/#976). (findIgnoredEmbeddedRepos)
    private static List<string> FindIgnoredEmbeddedRepos(
        string repoDir, CodeGraphGitIgnoreMatcher? includeIgnored, string prefix)
    {
        if (includeIgnored is null)
        {
            return new List<string>();
        }

        var defaults = CodeGraphIgnoreDefaults.DefaultsOnlyIgnore();
        var repos = new List<string>();
        foreach (var dir in ListIgnoredDirs(repoDir))
        {
            if (defaults.Ignores(dir))
            {
                continue;
            }

            if (!includeIgnored.Ignores(CodeGraphScanPaths.Posix(prefix + dir)))
            {
                continue;
            }

            repos.AddRange(FindNestedGitRepos(CodeGraphScanPaths.NativeJoin(repoDir, dir), dir));
        }

        return repos;
    }

    // Whether a tracked gitlink must be SKIPPED: it sits in a default-ignored
    // location, or the repo's own `.gitignore` covers it and the project did not opt
    // it in via `includeIgnored`. (gitlinkEmbeddedRepoSkipped)
    private static bool GitlinkEmbeddedRepoSkipped(
        string relDir,
        string prefix,
        CodeGraphGitIgnoreMatcher defaults,
        CodeGraphGitIgnoreMatcher repoIgnore,
        CodeGraphGitIgnoreMatcher? includeIgnored)
    {
        if (defaults.Ignores(relDir))
        {
            return true; // default-ignored — never index, opt-in can't revive
        }

        if (!repoIgnore.Ignores(relDir))
        {
            return false; // not ignored at all — index as before
        }

        // Gitignored by the repo's own rules — skip unless the project opted it in.
        return !(includeIgnored?.Ignores(CodeGraphScanPaths.Posix(prefix + relDir)) ?? false);
    }

    private static bool IsWholeCwdEntry(string entry) =>
        entry == "./" || entry == "." || entry.Length == 0;

    // ------------------------------------------------------------------------
    // include-whitelist discovery (codegraph.json `include`)
    // ------------------------------------------------------------------------

    // The included source files for a scan root, or empty when nothing is
    // force-included. (collectIncludedFilesForRoot)
    public static HashSet<string> CollectIncludedFilesForRoot(string rootDir, CodeGraphProjectConfig config)
    {
        var include = CodeGraphScopeIgnore.LoadIncludeMatcher(config);
        if (include is null)
        {
            return new HashSet<string>(StringComparer.Ordinal);
        }

        var roots = CodeGraphIgnoreDefaults.IncludeStaticRoots(config.Include);
        return CollectIncludedFiles(rootDir, include, CodeGraphScopeIgnore.LoadExcludeMatcher(config), roots, config);
    }

    // Actively discover the source files an `include` whitelist forces in — a
    // filtered filesystem walk of just the opted-in subtrees (`git ls-files` never
    // lists gitignored files). (collectIncludedFiles)
    private static HashSet<string> CollectIncludedFiles(
        string rootDir,
        CodeGraphGitIgnoreMatcher include,
        CodeGraphGitIgnoreMatcher? exclude,
        IReadOnlyList<string> roots,
        CodeGraphProjectConfig config)
    {
        var outFiles = new HashSet<string>(StringComparer.Ordinal);
        var defaults = CodeGraphIgnoreDefaults.DefaultsOnlyIgnore();
        var visited = new HashSet<string>(StringComparer.Ordinal);

        void Walk(string absDir)
        {
            string realDir;
            try
            {
                realDir = CodeGraphScanPaths.RealPath(absDir);
            }
            catch
            {
                return;
            }

            if (!visited.Add(realDir))
            {
                return; // symlink-cycle guard
            }

            IEnumerable<string> entries;
            try
            {
                entries = Directory.EnumerateFileSystemEntries(absDir);
            }
            catch
            {
                return;
            }

            foreach (var abs in entries)
            {
                var name = Path.GetFileName(abs);
                if (name == ".git" || CodeGraphScanPaths.IsCodeGraphDataDir(name))
                {
                    continue;
                }

                var rel = CodeGraphScanPaths.Posix(Path.GetRelativePath(rootDir, abs));
                if (rel.Length == 0 || rel.StartsWith("..", StringComparison.Ordinal))
                {
                    continue;
                }

                bool isDir;
                try
                {
                    isDir = Directory.Exists(CodeGraphScanPaths.RealPath(abs));
                }
                catch
                {
                    continue; // broken symlink — skip
                }

                if (isDir)
                {
                    if (defaults.Ignores(rel + "/"))
                    {
                        continue; // never node_modules/dist/… via include
                    }

                    if (exclude is not null && exclude.Ignores(rel + "/"))
                    {
                        continue; // an explicit exclude always wins
                    }

                    Walk(abs);
                }
                else
                {
                    if (defaults.Ignores(rel))
                    {
                        continue;
                    }

                    if (!include.Ignores(rel))
                    {
                        continue;
                    }

                    if (exclude is not null && exclude.Ignores(rel))
                    {
                        continue;
                    }

                    if (!CodeGraphFileClassifier.IsSourceFile(rel, config))
                    {
                        continue;
                    }

                    outFiles.Add(rel);
                }
            }
        }

        foreach (var root in roots)
        {
            Walk(root.Length == 0 ? rootDir : CodeGraphScanPaths.NativeJoin(rootDir, root));
        }

        return outFiles;
    }

    // ------------------------------------------------------------------------
    // git process runner (bounded-timeout, mirroring GitTools)
    // ------------------------------------------------------------------------

    // Run `git <args>` in `cwd` with a bounded timeout. Returns (exit==0, stdout).
    // `-z` NUL bytes survive verbatim in the decoded UTF-8 string. Any launch/timeout
    // failure returns (false, ""). git-not-on-PATH surfaces here as a start failure.
    private static (bool Ok, string Stdout) RunGit(IReadOnlyList<string> args, string cwd, int timeoutMs)
    {
        try
        {
            using var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = "git",
                WorkingDirectory = cwd,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            foreach (var arg in args)
            {
                process.StartInfo.ArgumentList.Add(arg);
            }

            try
            {
                process.Start();
            }
            catch
            {
                return (false, string.Empty); // git not installed / not on PATH
            }

            // Drain both streams concurrently to avoid a full-pipe deadlock.
            var stdoutTask = process.StandardOutput.ReadToEndAsync();
            var stderrTask = process.StandardError.ReadToEndAsync();

            if (!process.WaitForExit(Math.Max(1_000, timeoutMs)))
            {
                try
                {
                    if (!process.HasExited)
                    {
                        process.Kill(entireProcessTree: true);
                    }
                }
                catch
                {
                    // best effort
                }

                return (false, string.Empty);
            }

            // Ensure the async stdout/stderr reads have flushed after exit.
            try
            {
                process.WaitForExit();
            }
            catch
            {
                // ignore
            }

            string stdout;
            try
            {
                stdout = stdoutTask.GetAwaiter().GetResult();
            }
            catch
            {
                stdout = string.Empty;
            }

            try
            {
                _ = stderrTask.GetAwaiter().GetResult();
            }
            catch
            {
                // stderr is diagnostic only
            }

            return (process.ExitCode == 0, stdout);
        }
        catch
        {
            return (false, string.Empty);
        }
    }

    private static string FullPath(string path)
    {
        try
        {
            return Path.GetFullPath(path);
        }
        catch
        {
            return path;
        }
    }
}

// -----------------------------------------------------------------------------
// CodeGraphScanPaths — the handful of path helpers shared by the git enumerator and
// the FS-walk scanner. Graph paths are POSIX (forward-slash, project-relative); real
// filesystem paths are OS-native. Keep the two straight.
// -----------------------------------------------------------------------------
internal static class CodeGraphScanPaths
{
    private const string DefaultCodeGraphDir = ".codegraph";

    // Normalize a graph path to forward slashes (utils.ts normalizePath).
    public static string Posix(string path) => path.Replace('\\', '/');

    // Join an OS-native base directory with a POSIX relative path, yielding an
    // OS-native path (for shelling git / statting on disk).
    public static string NativeJoin(string baseDir, string posixRel) =>
        Path.Combine(baseDir, posixRel.Replace('/', Path.DirectorySeparatorChar));

    // Resolve symlinks to the real target of an existing path; falls back to the
    // full path when the target can't be resolved. Throws (to the caller's skip
    // path) only on a genuinely inaccessible path.
    public static string RealPath(string path)
    {
        if (Directory.Exists(path))
        {
            var info = new DirectoryInfo(path);
            return info.ResolveLinkTarget(returnFinalTarget: true)?.FullName ?? info.FullName;
        }

        if (File.Exists(path))
        {
            var info = new FileInfo(path);
            return info.ResolveLinkTarget(returnFinalTarget: true)?.FullName ?? info.FullName;
        }

        return Path.GetFullPath(path);
    }

    // Whether `name` (a single path segment) is a CodeGraph data directory — the
    // default `.codegraph`, the `CODEGRAPH_DIR` override, or any `.codegraph-*`
    // sibling. The indexer skips ALL of these so two environments sharing a working
    // tree don't index each other's index dir (#636). (directory.ts isCodeGraphDataDir)
    public static bool IsCodeGraphDataDir(string name) =>
        name == DefaultCodeGraphDir ||
        name == CodeGraphDirName() ||
        name.StartsWith(DefaultCodeGraphDir + "-", StringComparison.Ordinal);

    // The active data-dir name, honoring the CODEGRAPH_DIR override when it is a plain
    // directory name (no separators / `..` / absolute). (directory.ts codeGraphDirName)
    private static string CodeGraphDirName()
    {
        var raw = Environment.GetEnvironmentVariable("CODEGRAPH_DIR")?.Trim();
        if (string.IsNullOrEmpty(raw))
        {
            return DefaultCodeGraphDir;
        }

        var invalid =
            raw == "." ||
            raw.Contains("..", StringComparison.Ordinal) ||
            raw.Contains('/') ||
            raw.Contains('\\') ||
            Path.IsPathRooted(raw);
        return invalid ? DefaultCodeGraphDir : raw;
    }
}
