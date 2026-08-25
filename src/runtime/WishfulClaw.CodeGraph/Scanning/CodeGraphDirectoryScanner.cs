// =============================================================================
// CodeGraphDirectoryScanner — the real ICodeGraphFileScanner (analysis/05 §2.5 /
// §6.4; port of extraction/index.ts scanDirectory + scanDirectoryWalk). Two
// enumeration paths, unified so behavior is identical with or without git:
//
//   1. Git fast path — CodeGraphGitFileEnumerator.GetGitVisibleFiles (respects
//      `.gitignore` at every level, embedded-repo/gitlink recursion). Its output is
//      kept to recognized source files.
//   2. FS-walk fallback — a recursive readdir for non-git projects, applying the
//      built-in defaults + the root `.gitignore` + per-directory nested `.gitignore`
//      matchers (git-style scoping), with a realpath+visited symlink-cycle guard and
//      a skip of `.git` / any `.codegraph*` data dir. The `include` whitelist is
//      unioned in either path.
//
// For each discovered source file the scanner reads its bytes off disk, SKIPPING
// files over 1 MB (generated bundles / minified blobs blow the parse budget for no
// useful symbols — extraction/index.ts MAX_FILE_SIZE) and anything outside the root.
// The returned CodeGraphScannedFile.Path is the project-root-relative POSIX path that
// lands in nodes.file_path; Bytes are supplied so the engine does not re-read.
// =============================================================================
internal sealed class CodeGraphDirectoryScanner : ICodeGraphFileScanner
{
    // Skip files larger than this (bytes) — matches extraction/index.ts MAX_FILE_SIZE.
    private const long MaxFileSize = 1024 * 1024;

    public static readonly CodeGraphDirectoryScanner Instance = new();

    public IReadOnlyList<CodeGraphScannedFile> EnumerateFiles(string root, CodeGraphProjectConfig config)
    {
        var gitFiles = CodeGraphGitFileEnumerator.GetGitVisibleFiles(root, config);
        IEnumerable<string> paths = gitFiles is not null
            ? gitFiles.Where(p => CodeGraphFileClassifier.IsSourceFile(p, config))
            : ScanDirectoryWalk(root, config);

        return ReadScanned(root, paths);
    }

    // ------------------------------------------------------------------------
    // FS-walk fallback (non-git projects)
    // ------------------------------------------------------------------------

    // Recursively walk `rootDir`, honoring built-in defaults + nested per-directory
    // `.gitignore` matchers, and return the project-relative posix paths of every
    // recognized source file. (scanDirectoryWalk)
    private static List<string> ScanDirectoryWalk(string rootDir, CodeGraphProjectConfig config)
    {
        var files = new List<string>();
        var visitedDirs = new HashSet<string>(StringComparer.Ordinal);

        // A nested `.gitignore` matcher scoped to the directory that declared it —
        // patterns are relative to that directory, so paths are tested relative to it,
        // mirroring how git applies `.gitignore` at every level.
        ScopedIgnore? LoadIgnore(string dir)
        {
            var giPath = Path.Combine(dir, ".gitignore");
            if (!File.Exists(giPath))
            {
                return null;
            }

            var patterns = CodeGraphIgnoreDefaults.ReadGitignorePatterns(giPath);
            if (patterns.Length == 0)
            {
                return null;
            }

            return new ScopedIgnore(dir, new CodeGraphGitIgnoreMatcher().Add(patterns));
        }

        bool IsIgnored(string fullPath, bool isDir, IReadOnlyList<ScopedIgnore> matchers)
        {
            foreach (var m in matchers)
            {
                var rel = CodeGraphScanPaths.Posix(Path.GetRelativePath(m.Dir, fullPath));
                if (rel.Length == 0 || rel.StartsWith("..", StringComparison.Ordinal))
                {
                    continue; // not under this matcher's dir
                }

                if (isDir)
                {
                    rel += "/"; // dir-only rules (e.g. `build/`) only match with the slash
                }

                if (m.Ig.Ignores(rel))
                {
                    return true;
                }
            }

            return false;
        }

        void Walk(string dir, List<ScopedIgnore> matchers)
        {
            string realDir;
            try
            {
                realDir = CodeGraphScanPaths.RealPath(dir);
            }
            catch
            {
                return; // unresolvable directory
            }

            if (!visitedDirs.Add(realDir))
            {
                return; // symlink cycle
            }

            // This directory's own `.gitignore` applies to everything below it. The
            // root's is already merged into the seeded base matcher (so a negation
            // there can override a built-in default), so skip it here.
            var own = string.Equals(dir, rootDir, StringComparison.Ordinal) ? null : LoadIgnore(dir);
            var active = own is { } o ? new List<ScopedIgnore>(matchers) { o } : matchers;

            FileSystemInfo[] infos;
            try
            {
                infos = new DirectoryInfo(dir).EnumerateFileSystemInfos().ToArray();
            }
            catch
            {
                return; // unreadable directory
            }

            foreach (var info in infos)
            {
                var name = info.Name;
                if (name == ".git" || CodeGraphScanPaths.IsCodeGraphDataDir(name))
                {
                    continue; // never descend git internals or a codegraph data dir
                }

                var fullPath = info.FullName;
                var relativePath = CodeGraphScanPaths.Posix(Path.GetRelativePath(rootDir, fullPath));

                if ((info.Attributes & FileAttributes.ReparsePoint) != 0)
                {
                    // Symlink — resolve the target and treat it by what it points at.
                    try
                    {
                        var real = CodeGraphScanPaths.RealPath(fullPath);
                        if (Directory.Exists(real))
                        {
                            if (!IsIgnored(fullPath, true, active))
                            {
                                Walk(fullPath, active);
                            }
                        }
                        else if (File.Exists(real))
                        {
                            if (!IsIgnored(fullPath, false, active) &&
                                CodeGraphFileClassifier.IsSourceFile(relativePath, config))
                            {
                                files.Add(relativePath);
                            }
                        }
                    }
                    catch
                    {
                        // broken symlink — skip
                    }

                    continue;
                }

                if ((info.Attributes & FileAttributes.Directory) != 0)
                {
                    if (!IsIgnored(fullPath, true, active))
                    {
                        Walk(fullPath, active);
                    }
                }
                else
                {
                    if (!IsIgnored(fullPath, false, active) &&
                        CodeGraphFileClassifier.IsSourceFile(relativePath, config))
                    {
                        files.Add(relativePath);
                    }
                }
            }
        }

        // Seed a base matcher with the built-in defaults (merged with the root
        // `.gitignore`). Nested `.gitignore`s still layer per-dir. The user `exclude`
        // patterns are rooted at the project so they match root-relative paths.
        var baseMatchers = new List<ScopedIgnore>
        {
            new(rootDir, CodeGraphIgnoreDefaults.BuildDefaultIgnore(rootDir))
        };
        var exclude = CodeGraphScopeIgnore.LoadExcludeMatcher(config);
        if (exclude is not null)
        {
            baseMatchers.Add(new ScopedIgnore(rootDir, exclude));
        }

        Walk(rootDir, baseMatchers);

        // Force-include first-party source whitelisted in `codegraph.json` `include`
        // (the walk honored `.gitignore`, so anything gitignored was dropped).
        var included = CodeGraphGitFileEnumerator.CollectIncludedFilesForRoot(rootDir, config);
        if (included.Count > 0)
        {
            var seen = new HashSet<string>(files, StringComparer.Ordinal);
            foreach (var f in included)
            {
                if (seen.Add(f))
                {
                    files.Add(f);
                }
            }
        }

        return files;
    }

    // ------------------------------------------------------------------------
    // Byte reading
    // ------------------------------------------------------------------------

    // Read each discovered file's bytes, skipping files over 1 MB, files that escape
    // the root, and unreadable files. Deduplicates by path.
    private static List<CodeGraphScannedFile> ReadScanned(string root, IEnumerable<string> paths)
    {
        var result = new List<CodeGraphScannedFile>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        foreach (var path in paths)
        {
            if (!seen.Add(path))
            {
                continue;
            }

            var abs = CodeGraphPathSafety.ValidatePathWithinRoot(root, path, allowSymlinkEscape: true);
            if (abs is null)
            {
                continue; // refuses to read outside the project root
            }

            byte[] bytes;
            try
            {
                var info = new FileInfo(abs);
                if (!info.Exists || info.Length > MaxFileSize)
                {
                    continue; // vanished, or a >1 MB generated/vendored blob
                }

                bytes = File.ReadAllBytes(abs);
            }
            catch
            {
                continue; // unreadable (permissions / race) — skip, never fatal
            }

            result.Add(new CodeGraphScannedFile(path, bytes));
        }

        return result;
    }

    private readonly record struct ScopedIgnore(string Dir, CodeGraphGitIgnoreMatcher Ig);
}
