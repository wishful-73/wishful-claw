// =============================================================================
// CodeGraphPathSafety — the security-critical path helpers ported from
// CodeGraph utils.ts (analysis/05 §3.4, risks §5.8; #527/#935/#383).
//
//   * NormalizePath        — backslash → forward slash (graph-path normalization).
//   * IsConfigLeafNode     — the #383 secret-redaction gate: a `constant` node in a
//                            pure config/data language (yaml/properties) is a single
//                            key whose on-disk value is routinely a secret; surface
//                            the KEY only, never read the value.
//   * ValidatePathWithinRoot — lexical (`../`) + realpath (symlink-escape)
//                            containment. The chokepoint that keeps out-of-root file
//                            contents from leaking into agent context.
//
// NOTE: ValidatePathWithinRoot resolves REAL filesystem paths to read actual files
// off disk, so it MUST use OS-native System.IO.Path (never CodeGraphPosixPath — that
// helper is for the posix graph paths stored in the DB, a different concern). The
// input `filePath` may be a project-relative posix graph path; combining it with the
// OS-native root to reach a readable file is exactly the intended operation.
// =============================================================================
internal static class CodeGraphPathSafety
{
    // Config "languages" whose nodes are pure key/value DATA lifted from a config
    // file, not source (utils.ts CONFIG_LEAF_LANGUAGES).
    private static readonly HashSet<string> ConfigLeafLanguages =
        new(StringComparer.Ordinal) { CodeGraphLanguage.Yaml, CodeGraphLanguage.Properties };

    // Backslash → forward slash so glob/segment matching is consistent across
    // platforms (utils.ts normalizePath).
    public static string NormalizePath(string filePath) => filePath.Replace('\\', '/');

    // A config-leaf node is `kind: 'constant'` in a CONFIG_LEAF_LANGUAGES language.
    // Its value is routinely a secret (DB password, API key, JDBC creds); the context
    // builder must surface the key only (#383). (utils.ts isConfigLeafNode)
    public static bool IsConfigLeafNode(string kind, string? language) =>
        kind == CodeGraphNodeKind.Constant &&
        !string.IsNullOrEmpty(language) &&
        ConfigLeafLanguages.Contains(language);

    // Validate that `filePath` stays within `projectRoot`, resolving symlinks.
    // Returns the resolved absolute path (realpath when it exists), or null if it
    // escapes the root. Two layers: a cheap lexical `../`-traversal check, then a
    // realpath check that catches an in-repo symlink whose real target points outside
    // the root (#527).
    //
    // `allowSymlinkEscape` waives ONLY the realpath-escape rejection (the lexical
    // guard still applies) for the INDEXING read path, which must agree with a
    // directory walk that deliberately descended an in-root symlink pointing outside
    // the root (#935). Content-serving sinks must never pass it. (utils.ts
    // validatePathWithinRoot)
    public static string? ValidatePathWithinRoot(
        string projectRoot,
        string filePath,
        bool allowSymlinkEscape = false)
    {
        string resolved;
        string normalizedRoot;
        try
        {
            normalizedRoot = Path.GetFullPath(projectRoot);
            resolved = Path.GetFullPath(Path.Combine(normalizedRoot, filePath));
        }
        catch
        {
            return null;
        }

        // 1. Lexical containment — catches `../` traversal. Applies even on the
        //    indexing read path.
        if (!IsWithinDir(resolved, normalizedRoot))
        {
            return null;
        }

        // 2. Symlink-aware containment. A non-existent target is the ENOENT case (a
        //    file about to be written, or an index entry for a since-deleted file):
        //    the lexical check already passed, so allow the lexical path. Any other
        //    resolution failure (ELOOP, EACCES) is unsafe → reject.
        try
        {
            var realRoot = RealPath(normalizedRoot);
            var realResolved = RealPath(resolved);
            if (realRoot is null || realResolved is null)
            {
                return resolved;
            }

            if (allowSymlinkEscape)
            {
                return realResolved;
            }

            return IsWithinDir(realResolved, realRoot) ? realResolved : null;
        }
        catch
        {
            return null;
        }
    }

    // Resolve symlinks on an existing path (the whole final target). Returns null when
    // the path does not exist (ENOENT); throws (to the caller's reject path) on a
    // genuine resolution failure. Note: this resolves the leaf link chain, matching
    // the common #527 case (an in-repo symlink file/dir); ancestor-only symlink
    // escapes are a lower-risk gap deferred with the full FileLock.
    private static string? RealPath(string path)
    {
        if (File.Exists(path))
        {
            var info = new FileInfo(path);
            return info.ResolveLinkTarget(returnFinalTarget: true)?.FullName ?? info.FullName;
        }

        if (Directory.Exists(path))
        {
            var info = new DirectoryInfo(path);
            return info.ResolveLinkTarget(returnFinalTarget: true)?.FullName ?? info.FullName;
        }

        return null;
    }

    // Whether `child` is `parent` itself or sits underneath it. Case-insensitive on
    // Windows (NTFS is case-insensitive, and realpath can hand back a different case
    // than the lexical root) (utils.ts isWithinDir).
    private static bool IsWithinDir(string child, string parent)
    {
        var c = child;
        var p = parent;
        if (OperatingSystem.IsWindows())
        {
            c = c.ToLowerInvariant();
            p = p.ToLowerInvariant();
        }

        if (string.Equals(c, p, StringComparison.Ordinal))
        {
            return true;
        }

        var withSep = p.EndsWith(Path.DirectorySeparatorChar) ? p : p + Path.DirectorySeparatorChar;
        return c.StartsWith(withSep, StringComparison.Ordinal);
    }
}
