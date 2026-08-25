// =============================================================================
// CodeGraphPosixPath — the forward-slash, project-relative path helper (analysis/02
// §5.6). The whole resolution layer assumes posix, project-relative paths
// (dir-proximity scoring, workspace rewrites, tsconfig alias rewrites, relative
// import resolution). Node's `path.posix.*` guarantees `/`; `System.IO.Path` uses
// `\` on Windows and would corrupt every graph path — so NEVER call
// System.IO.Path.Combine / GetDirectoryName / GetRelativePath on graph paths. This
// helper reproduces the handful of `path` operations the import resolver ports
// (join / dirname / resolve / relative / isAbsolute), always emitting `/`.
//
// Semantics mirror Node's `path.posix`: `resolve` collapses `.`/`..` and returns an
// absolute path with no trailing slash; `relative` returns the minimal `../`-prefixed
// hop between two absolute paths. Inputs are `\`-normalized to `/` first so a Windows
// absolute projectRoot (`C:\repo`) is handled like `C:/repo`.
// =============================================================================
internal static class CodeGraphPosixPath
{
    // An absolute path: posix root `/…`, or a Windows drive `C:…` (after `\`→`/`).
    internal static bool IsAbsolute(string path)
    {
        var p = path.Replace('\\', '/');
        if (p.Length == 0)
        {
            return false;
        }

        if (p[0] == '/')
        {
            return true;
        }

        return p.Length >= 2 && p[1] == ':' && IsAlpha(p[0]);
    }

    // path.posix.join(a, b): concatenate then normalize (collapses `.`/`..`, dedups
    // slashes). An empty operand is dropped.
    internal static string Join(string a, string b)
    {
        var pa = a.Replace('\\', '/');
        var pb = b.Replace('\\', '/');
        string combined;
        if (pa.Length == 0)
        {
            combined = pb;
        }
        else if (pb.Length == 0)
        {
            combined = pa;
        }
        else
        {
            combined = pa + "/" + pb;
        }

        return NormalizeKeepRoot(combined);
    }

    // path.posix.dirname(p): the path minus its last segment. `/x`→`/`, `x`→`.`.
    internal static string Dirname(string path)
    {
        var p = path.Replace('\\', '/');
        if (p.Length == 0)
        {
            return ".";
        }

        var (root, body, isAbsolute) = SplitRoot(p);
        var trimmed = body;
        while (trimmed.Length > 0 && trimmed[^1] == '/')
        {
            trimmed = trimmed[..^1];
        }

        var idx = trimmed.LastIndexOf('/');
        if (idx < 0)
        {
            return isAbsolute ? root : ".";
        }

        var dirBody = trimmed[..idx];
        if (isAbsolute)
        {
            return dirBody.Length == 0 ? root : root + dirBody;
        }

        return dirBody;
    }

    // path.posix.resolve(a, b): resolve `b` against `a`. `a` is assumed absolute (the
    // resolver always passes a projectRoot-derived base); if `b` is absolute it wins.
    // Result is absolute, `.`/`..` collapsed, no trailing slash.
    internal static string Resolve(string a, string b)
    {
        var pb = b.Replace('\\', '/');
        var combined = IsAbsolute(pb) ? pb : (a.Replace('\\', '/').Length == 0 ? pb : a.Replace('\\', '/') + "/" + pb);
        return NormalizeKeepRoot(combined);
    }

    // path.posix.relative(from, to): the minimal relative hop from `from` to `to`
    // (both absolute). Escaping segments become `../`. Different roots → `to` verbatim.
    internal static string Relative(string from, string to)
    {
        var f = NormalizeKeepRoot(from.Replace('\\', '/'));
        var t = NormalizeKeepRoot(to.Replace('\\', '/'));
        if (f == t)
        {
            return string.Empty;
        }

        var (fromRoot, fromBody, _) = SplitRoot(f);
        var (toRoot, toBody, _) = SplitRoot(t);
        if (!string.Equals(fromRoot, toRoot, StringComparison.Ordinal))
        {
            return t;
        }

        var fromSegs = fromBody.Length == 0 ? Array.Empty<string>() : fromBody.Split('/');
        var toSegs = toBody.Length == 0 ? Array.Empty<string>() : toBody.Split('/');
        var common = 0;
        while (common < fromSegs.Length && common < toSegs.Length &&
               string.Equals(fromSegs[common], toSegs[common], StringComparison.Ordinal))
        {
            common++;
        }

        var parts = new List<string>();
        for (var i = common; i < fromSegs.Length; i++)
        {
            parts.Add("..");
        }

        for (var i = common; i < toSegs.Length; i++)
        {
            parts.Add(toSegs[i]);
        }

        return string.Join("/", parts);
    }

    // Collapse `.`/`..`/empty segments while preserving the root (`/` or `C:/`). Above
    // an absolute root, `..` is dropped (can't escape); on a relative path it survives.
    private static string NormalizeKeepRoot(string path)
    {
        var (root, body, isAbsolute) = SplitRoot(path);
        var stack = new List<string>();
        foreach (var seg in body.Split('/'))
        {
            if (seg.Length == 0 || seg == ".")
            {
                continue;
            }

            if (seg == "..")
            {
                if (stack.Count > 0 && stack[^1] != "..")
                {
                    stack.RemoveAt(stack.Count - 1);
                }
                else if (!isAbsolute)
                {
                    stack.Add("..");
                }
            }
            else
            {
                stack.Add(seg);
            }
        }

        var joined = string.Join("/", stack);
        if (isAbsolute)
        {
            return root + joined; // root already carries its trailing slash
        }

        return joined.Length == 0 ? "." : joined;
    }

    // Split into (root, body, isAbsolute). root is "" (relative), "/" (posix), or
    // "C:/" (drive); body is the remainder with no leading slash.
    private static (string Root, string Body, bool IsAbsolute) SplitRoot(string p)
    {
        if (p.Length >= 1 && p[0] == '/')
        {
            return ("/", p[1..], true);
        }

        if (p.Length >= 2 && p[1] == ':' && IsAlpha(p[0]))
        {
            if (p.Length >= 3 && p[2] == '/')
            {
                return (p[..3], p[3..], true);
            }

            // `C:foo` (drive-relative) — normalize to `C:/foo` for our purposes.
            return (p[..2] + "/", p[2..], true);
        }

        return (string.Empty, p, false);
    }

    private static bool IsAlpha(char c) => (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z');
}
