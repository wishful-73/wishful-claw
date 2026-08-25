using System.Text;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphGitIgnoreMatcher — a from-scratch git-semantics `.gitignore` matcher
// (analysis/05 R7 / §2.5). This is the REPLACEMENT for the `ignore` npm package the
// TS scanner leans on everywhere (buildDefaultIgnore / ScopeIgnore / the FS-walk).
//
// The worker's own Modules/File IgnoreMatcher is deliberately NOT reused: it is
// root-only, has no negations, and no nested/per-directory semantics (analysis/05
// §4 "Reimplement"). This one reproduces the git ignore spec:
//   * blank lines and `#` comments are skipped (`\#` / `\!` un-escape a literal),
//   * a leading `!` NEGATES (re-includes) — last matching rule wins,
//   * a leading or interior `/` ANCHORS the pattern to the matcher's own root; a
//     pattern with no interior slash matches at ANY depth,
//   * a trailing `/` makes the pattern match a DIRECTORY (and everything under it),
//   * `*` matches within a path segment, `?` one non-`/` char, `[...]` a class,
//     and `**` spans directories (`**/`, `/**`, `a/**/b`),
//   * a directory that is ignored ignores all of its contents, and a file whose
//     parent directory is ignored CANNOT be re-included (the git parent rule) —
//     reproduced by a recursive parent-first test.
//
// Each pattern compiles to one .NET Regex tested against a project-relative POSIX
// path (forward slashes). Compilation is defensive: a pattern whose regex won't
// build is dropped (mirroring the `ignore` library's lazy-throw line skip, #682)
// rather than aborting the whole matcher.
// =============================================================================
internal sealed class CodeGraphGitIgnoreMatcher
{
    private readonly List<Rule> rules = new();

    // Path → ignored memo. Parent directories are re-tested constantly during a
    // scan (every file under `src/` re-derives `src/`), so caching the recursive
    // result collapses that to one test per distinct path. Cleared whenever rules
    // change; in practice a matcher is fully built before any Ignores() call.
    private readonly Dictionary<string, bool> cache = new(StringComparer.Ordinal);

    // Add a newline-delimited block of patterns (a whole `.gitignore` body, or the
    // joined DEFAULT_IGNORE_PATTERNS). Blank/comment lines are skipped.
    public CodeGraphGitIgnoreMatcher Add(string patternsBlock)
    {
        if (string.IsNullOrEmpty(patternsBlock))
        {
            return this;
        }

        foreach (var line in patternsBlock.Split('\n'))
        {
            AddLine(line);
        }

        return this;
    }

    // Add a sequence of individual patterns (already one-per-entry).
    public CodeGraphGitIgnoreMatcher Add(IEnumerable<string> patterns)
    {
        foreach (var pattern in patterns)
        {
            AddLine(pattern);
        }

        return this;
    }

    // Whether `relPath` (project/matcher-relative, POSIX) is ignored. Directory
    // paths are conventionally passed with a trailing slash (so dir-only rules can
    // match); file paths without.
    public bool Ignores(string relPath) => CheckPath(relPath);

    // ------------------------------------------------------------------------
    // Matching
    // ------------------------------------------------------------------------

    // Recursive, parent-first per git's rule that an ignored directory ignores all
    // of its contents and that a file under an ignored directory cannot be
    // re-included by a later negation (which only re-including the directory could
    // do). Returns the final ignored verdict for `path`.
    private bool CheckPath(string path)
    {
        if (cache.TryGetValue(path, out var cached))
        {
            return cached;
        }

        var trimmed = path.Length > 0 && path[^1] == '/' ? path[..^1] : path;
        var slash = trimmed.LastIndexOf('/');
        if (slash >= 0)
        {
            var parent = trimmed[..slash] + "/";
            if (CheckPath(parent))
            {
                // Parent directory is ignored (after its own negations) — the git
                // rule forbids re-including a descendant, so stop here.
                cache[path] = true;
                return true;
            }
        }

        // Own-rules test: last matching rule wins (a negation un-ignores).
        var ignored = false;
        foreach (var rule in rules)
        {
            if (rule.Regex.IsMatch(path))
            {
                ignored = !rule.Negative;
            }
        }

        cache[path] = ignored;
        return ignored;
    }

    // ------------------------------------------------------------------------
    // Pattern compilation
    // ------------------------------------------------------------------------

    private void AddLine(string raw)
    {
        var line = raw.EndsWith('\r') ? raw[..^1] : raw;
        line = TrimTrailingUnescapedWhitespace(line);
        if (line.Length == 0)
        {
            return;
        }

        // Comments: an unescaped leading `#`. `\#` is a literal `#`.
        if (line[0] == '#')
        {
            return;
        }

        var negative = false;
        if (line[0] == '!')
        {
            negative = true;
            line = line[1..];
        }
        else if (line.StartsWith("\\!", StringComparison.Ordinal) || line.StartsWith("\\#", StringComparison.Ordinal))
        {
            // Un-escape a literal leading `!`/`#`.
            line = line[1..];
        }

        if (line.Length == 0)
        {
            return;
        }

        string regexBody;
        try
        {
            regexBody = BuildRegex(line);
        }
        catch
        {
            // A pattern that can't be compiled is dropped, not fatal (#682 parity).
            return;
        }

        Regex regex;
        try
        {
            regex = new Regex(regexBody, RegexOptions.CultureInvariant);
        }
        catch
        {
            return;
        }

        rules.Add(new Rule(regex, negative));
        cache.Clear();
    }

    // Compile one cleaned pattern (no leading `!`, no trailing whitespace) into a
    // regex string tested against a full relative posix path.
    private static string BuildRegex(string pattern)
    {
        var p = pattern;

        var dirOnly = p.EndsWith('/');
        if (dirOnly)
        {
            p = p[..^1];
        }

        var hadLeadingSlash = p.StartsWith('/');
        p = p.TrimStart('/');

        // Anchored when there is a separator at the start or the interior of the
        // pattern; otherwise it floats to any depth (git spec).
        var anchored = hadLeadingSlash || p.Contains('/');

        var sb = new StringBuilder();
        sb.Append(anchored ? "^" : "(?:^|/)");
        AppendBody(sb, p);
        sb.Append(dirOnly ? "/" : "(?:$|/)");
        return sb.ToString();
    }

    // Translate the glob body (segment-aware `*`/`?`/`[...]`/`**`) into regex.
    private static void AppendBody(StringBuilder sb, string p)
    {
        var i = 0;
        var n = p.Length;
        while (i < n)
        {
            var c = p[i];
            if (c == '\\' && i + 1 < n)
            {
                // A backslash escapes the next char (git: `\*` is a literal `*`).
                sb.Append(Regex.Escape(p[i + 1].ToString()));
                i += 2;
                continue;
            }

            if (c == '*')
            {
                var j = i;
                while (j < n && p[j] == '*')
                {
                    j++;
                }

                var starCount = j - i;
                if (starCount >= 2)
                {
                    var prevSlash = i == 0 || p[i - 1] == '/';
                    var nextSlash = j == n || p[j] == '/';
                    if (prevSlash && nextSlash)
                    {
                        if (j < n)
                        {
                            // "**/" — zero or more leading directory segments.
                            sb.Append("(?:.*/)?");
                            i = j + 1; // consume the trailing '/'
                        }
                        else
                        {
                            // trailing "**" — everything remaining, dirs included.
                            sb.Append(".*");
                            i = j;
                        }

                        continue;
                    }
                }

                // A lone `*` (or `**` not bounded by slashes) matches within a
                // single path segment.
                sb.Append("[^/]*");
                i = j;
                continue;
            }

            if (c == '?')
            {
                sb.Append("[^/]");
                i++;
                continue;
            }

            if (c == '/')
            {
                sb.Append('/');
                i++;
                continue;
            }

            if (c == '[')
            {
                i = AppendCharClass(sb, p, i);
                continue;
            }

            sb.Append(Regex.Escape(c.ToString()));
            i++;
        }
    }

    // Copy a `[...]` character class, translating git's leading `!` negation to the
    // regex `^` form. Returns the index just past the closing `]`. An unterminated
    // class falls back to a literal `[`.
    private static int AppendCharClass(StringBuilder sb, string p, int start)
    {
        var n = p.Length;
        var i = start + 1;
        if (i >= n)
        {
            sb.Append("\\[");
            return start + 1;
        }

        // Find the closing bracket (a `]` immediately after `[` or `[!`/`[^` is a
        // literal member, so it doesn't close the class).
        var scan = i;
        var negated = scan < n && (p[scan] == '!' || p[scan] == '^');
        if (negated)
        {
            scan++;
        }

        if (scan < n && p[scan] == ']')
        {
            scan++;
        }

        while (scan < n && p[scan] != ']')
        {
            scan++;
        }

        if (scan >= n)
        {
            // No closing bracket — treat the '[' as a literal.
            sb.Append("\\[");
            return start + 1;
        }

        sb.Append('[');
        if (negated)
        {
            sb.Append('^');
            i++;
        }

        for (var k = i; k < scan; k++)
        {
            var ch = p[k];
            if (ch == '\\' || ch == '^' || ch == ']')
            {
                sb.Append('\\');
            }

            sb.Append(ch);
        }

        sb.Append(']');
        return scan + 1; // past the closing ']'
    }

    // Strip trailing whitespace unless the final space is backslash-escaped (git
    // keeps a `\ `-terminated pattern's trailing space).
    private static string TrimTrailingUnescapedWhitespace(string line)
    {
        var end = line.Length;
        while (end > 0 && (line[end - 1] == ' ' || line[end - 1] == '\t'))
        {
            // Count the run of backslashes before this space; an odd count escapes it.
            var backslashes = 0;
            var k = end - 2;
            while (k >= 0 && line[k] == '\\')
            {
                backslashes++;
                k--;
            }

            if (backslashes % 2 == 1)
            {
                break; // escaped trailing space — keep it (and everything before)
            }

            end--;
        }

        return end == line.Length ? line : line[..end];
    }

    private readonly record struct Rule(Regex Regex, bool Negative);
}
