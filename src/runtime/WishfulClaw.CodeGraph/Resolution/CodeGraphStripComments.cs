// =============================================================================
// CodeGraphStripComments — verbatim port of strip-comments.ts (analysis/02 §5.4,
// "must be exact"). An OFFSET-PRESERVING per-language comment/string blanker: it
// replaces comment characters (and string/docstring contents that hide routing-shaped
// text) with SPACES — not removal — so a regex `match.index` on the stripped output
// still maps to the same line/column in the original source. Newlines are preserved
// so downstream line numbers stay valid.
//
// Foundational for the framework route extractors (~15 regex scanners). This is the
// state machine ported char-for-char; it is deliberately a pragmatic helper, not a
// parser (no JS regex-literal detection, f-string expressions, or heredocs).
//
// `lang` is a CodeGraphLanguage.* value; only the C-style family, python, ruby, rust,
// erlang, php, and go have dedicated blankers. Any other language returns content
// unchanged (the TS default branch).
// =============================================================================
internal static class CodeGraphStripComments
{
    public static string StripForRegex(string content, string lang)
    {
        switch (lang)
        {
            case CodeGraphLanguage.Python:
                return StripPython(content);
            case CodeGraphLanguage.Ruby:
                return StripRuby(content);
            case CodeGraphLanguage.Rust:
                return StripRust(content);
            case CodeGraphLanguage.Erlang:
                return StripErlang(content);
            case CodeGraphLanguage.Php:
                return StripPhp(content);
            case CodeGraphLanguage.Go:
                return StripGo(content);
            case CodeGraphLanguage.JavaScript:
            case CodeGraphLanguage.TypeScript:
            case CodeGraphLanguage.Java:
            case CodeGraphLanguage.CSharp:
            case CodeGraphLanguage.Swift:
            case CodeGraphLanguage.C:
            case CodeGraphLanguage.Cpp:
                return StripCStyle(content, allowSingleQuoteStrings: lang == CodeGraphLanguage.JavaScript || lang == CodeGraphLanguage.TypeScript);
            default:
                return content;
        }
    }

    // Replace every char in [start, end) with a space, but keep newlines so line
    // numbers computed downstream remain valid.
    private static void BlankRange(char[] buf, int start, int end, string src)
    {
        for (var i = start; i < end && i < buf.Length; i++)
        {
            buf[i] = src[i] == '\n' ? '\n' : ' ';
        }
    }

    // src[i] ?? '' — JS out-of-bounds yields undefined (never equals a real char); a
    // '\0' sentinel reproduces that for the equality checks below.
    private static char CharAt(string s, int i) => i >= 0 && i < s.Length ? s[i] : '\0';

    private static bool StartsWithAt(string s, string sub, int at)
    {
        if (at < 0 || at + sub.Length > s.Length)
        {
            return false;
        }

        return s.AsSpan(at, sub.Length).SequenceEqual(sub.AsSpan());
    }

    // ---------- Python ----------
    private static string StripPython(string src)
    {
        var outBuf = src.ToCharArray();
        var i = 0;
        var n = src.Length;

        while (i < n)
        {
            var c = src[i];
            var c2 = CharAt(src, i + 1);
            var c3 = CharAt(src, i + 2);

            // Triple-quoted string: """...""" or '''...'''
            if ((c == '"' || c == '\'') && c2 == c && c3 == c)
            {
                var quote = c;
                var start = i;
                i += 3;
                while (i < n)
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        i += 2;
                        continue;
                    }

                    if (src[i] == quote && CharAt(src, i + 1) == quote && CharAt(src, i + 2) == quote)
                    {
                        i += 3;
                        break;
                    }

                    i++;
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            // Single-line string: '...' or "..."
            if (c == '"' || c == '\'')
            {
                var quote = c;
                i++;
                while (i < n && src[i] != quote)
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        i += 2;
                        continue;
                    }

                    if (src[i] == '\n')
                    {
                        break; // unterminated
                    }

                    i++;
                }

                if (i < n && src[i] == quote)
                {
                    i++;
                }

                continue;
            }

            // Line comment
            if (c == '#')
            {
                var start = i;
                while (i < n && src[i] != '\n')
                {
                    i++;
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            i++;
        }

        return new string(outBuf);
    }

    // ---------- Ruby ----------
    private static string StripRuby(string src)
    {
        var outBuf = src.ToCharArray();
        var i = 0;
        var n = src.Length;
        var atLineStart = true;

        while (i < n)
        {
            var c = src[i];

            // =begin / =end block comments must be at start of line (after optional whitespace)
            if (atLineStart && c == '=' && StartsWithAt(src, "=begin", i))
            {
                var start = i;
                i += "=begin".Length;
                while (i < n)
                {
                    if (src[i] == '\n')
                    {
                        var j = i + 1;
                        while (j < n && (src[j] == ' ' || src[j] == '\t'))
                        {
                            j++;
                        }

                        if (StartsWithAt(src, "=end", j))
                        {
                            i = j + "=end".Length;
                            while (i < n && src[i] != '\n')
                            {
                                i++;
                            }

                            break;
                        }
                    }

                    i++;
                }

                BlankRange(outBuf, start, i, src);
                atLineStart = i > 0 && src[i - 1] == '\n';
                continue;
            }

            // String literals
            if (c == '"' || c == '\'')
            {
                var quote = c;
                i++;
                while (i < n && src[i] != quote)
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        i += 2;
                        continue;
                    }

                    if (src[i] == '\n')
                    {
                        break;
                    }

                    i++;
                }

                if (i < n && src[i] == quote)
                {
                    i++;
                }

                atLineStart = false;
                continue;
            }

            // Line comment
            if (c == '#')
            {
                var start = i;
                while (i < n && src[i] != '\n')
                {
                    i++;
                }

                BlankRange(outBuf, start, i, src);
                atLineStart = false;
                continue;
            }

            if (c == '\n')
            {
                atLineStart = true;
                i++;
                continue;
            }

            if (c == ' ' || c == '\t')
            {
                i++;
                continue;
            }

            atLineStart = false;
            i++;
        }

        return new string(outBuf);
    }

    // ---------- C-style (JS/TS/Java/C#/Swift/C/C++) ----------
    private static string StripCStyle(string src, bool allowSingleQuoteStrings)
    {
        var outBuf = src.ToCharArray();
        var i = 0;
        var n = src.Length;

        while (i < n)
        {
            var c = src[i];
            var c2 = CharAt(src, i + 1);

            // Block comment
            if (c == '/' && c2 == '*')
            {
                var start = i;
                i += 2;
                while (i < n && !(src[i] == '*' && CharAt(src, i + 1) == '/'))
                {
                    i++;
                }

                if (i < n)
                {
                    i += 2;
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            // Line comment
            if (c == '/' && c2 == '/')
            {
                var start = i;
                while (i < n && src[i] != '\n')
                {
                    i++;
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            // String literals
            if (c == '"' || (allowSingleQuoteStrings && c == '\'') || c == '`')
            {
                var quote = c;
                i++;
                while (i < n && src[i] != quote)
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        i += 2;
                        continue;
                    }

                    // Template literal can span lines; regular strings break on newline.
                    if (quote != '`' && src[i] == '\n')
                    {
                        break;
                    }

                    i++;
                }

                if (i < n && src[i] == quote)
                {
                    i++;
                }

                continue;
            }

            i++;
        }

        return new string(outBuf);
    }

    // ---------- PHP ----------
    private static string StripPhp(string src)
    {
        var outBuf = src.ToCharArray();
        var i = 0;
        var n = src.Length;

        while (i < n)
        {
            var c = src[i];
            var c2 = CharAt(src, i + 1);

            // Block comment
            if (c == '/' && c2 == '*')
            {
                var start = i;
                i += 2;
                while (i < n && !(src[i] == '*' && CharAt(src, i + 1) == '/'))
                {
                    i++;
                }

                if (i < n)
                {
                    i += 2;
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            // // line comment
            if (c == '/' && c2 == '/')
            {
                var start = i;
                while (i < n && src[i] != '\n')
                {
                    i++;
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            // # line comment (PHP supports both)
            if (c == '#')
            {
                var start = i;
                while (i < n && src[i] != '\n')
                {
                    i++;
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            // String literals: ', ", `
            if (c == '"' || c == '\'' || c == '`')
            {
                var quote = c;
                i++;
                while (i < n && src[i] != quote)
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        i += 2;
                        continue;
                    }

                    if (src[i] == '\n')
                    {
                        break;
                    }

                    i++;
                }

                if (i < n && src[i] == quote)
                {
                    i++;
                }

                continue;
            }

            i++;
        }

        return new string(outBuf);
    }

    // ---------- Go ----------
    private static string StripGo(string src)
    {
        var outBuf = src.ToCharArray();
        var i = 0;
        var n = src.Length;

        while (i < n)
        {
            var c = src[i];
            var c2 = CharAt(src, i + 1);

            // Block comment
            if (c == '/' && c2 == '*')
            {
                var start = i;
                i += 2;
                while (i < n && !(src[i] == '*' && CharAt(src, i + 1) == '/'))
                {
                    i++;
                }

                if (i < n)
                {
                    i += 2;
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            // Line comment
            if (c == '/' && c2 == '/')
            {
                var start = i;
                while (i < n && src[i] != '\n')
                {
                    i++;
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            // Raw string with backticks (no escapes, can span lines)
            if (c == '`')
            {
                i++;
                while (i < n && src[i] != '`')
                {
                    i++;
                }

                if (i < n)
                {
                    i++;
                }

                continue;
            }

            // Interpreted string with double quotes
            if (c == '"')
            {
                i++;
                while (i < n && src[i] != '"')
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        i += 2;
                        continue;
                    }

                    if (src[i] == '\n')
                    {
                        break;
                    }

                    i++;
                }

                if (i < n && src[i] == '"')
                {
                    i++;
                }

                continue;
            }

            // Rune literal with single quotes (handle as a tiny string)
            if (c == '\'')
            {
                i++;
                while (i < n && src[i] != '\'')
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        i += 2;
                        continue;
                    }

                    if (src[i] == '\n')
                    {
                        break;
                    }

                    i++;
                }

                if (i < n && src[i] == '\'')
                {
                    i++;
                }

                continue;
            }

            i++;
        }

        return new string(outBuf);
    }

    // ---------- Rust ----------
    private static string StripRust(string src)
    {
        var outBuf = src.ToCharArray();
        var i = 0;
        var n = src.Length;

        while (i < n)
        {
            var c = src[i];
            var c2 = CharAt(src, i + 1);

            // Nested block comment /* ... /* ... */ ... */
            if (c == '/' && c2 == '*')
            {
                var start = i;
                i += 2;
                var depth = 1;
                while (i < n && depth > 0)
                {
                    if (src[i] == '/' && CharAt(src, i + 1) == '*')
                    {
                        depth++;
                        i += 2;
                    }
                    else if (src[i] == '*' && CharAt(src, i + 1) == '/')
                    {
                        depth--;
                        i += 2;
                    }
                    else
                    {
                        i++;
                    }
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            // Line comment
            if (c == '/' && c2 == '/')
            {
                var start = i;
                while (i < n && src[i] != '\n')
                {
                    i++;
                }

                BlankRange(outBuf, start, i, src);
                continue;
            }

            // String literals
            if (c == '"')
            {
                i++;
                while (i < n && src[i] != '"')
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        i += 2;
                        continue;
                    }

                    i++;
                }

                if (i < n && src[i] == '"')
                {
                    i++;
                }

                continue;
            }

            // Char literal — keep simple: skip 'x' or '\x' (also lifetimes 'a)
            if (c == '\'')
            {
                i++;
                while (i < n && src[i] != '\'')
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        i += 2;
                        continue;
                    }

                    if (src[i] == '\n')
                    {
                        break;
                    }

                    i++;
                }

                if (i < n && src[i] == '\'')
                {
                    i++;
                }

                continue;
            }

            i++;
        }

        return new string(outBuf);
    }

    // ---------- Erlang ----------
    // `%` starts a line comment unless inside a "string", a 'quoted atom', or the
    // char literal `$%`. Strings and quoted atoms stay intact; only comments blank.
    private static string StripErlang(string src)
    {
        var outBuf = src.ToCharArray();
        var i = 0;
        var n = src.Length;

        while (i < n)
        {
            var c = src[i];

            if (c == '"' || c == '\'')
            {
                var quote = c;
                i++;
                while (i < n && src[i] != quote)
                {
                    if (src[i] == '\\' && i + 1 < n)
                    {
                        i += 2;
                        continue;
                    }

                    i++;
                }

                if (i < n)
                {
                    i++;
                }

                continue;
            }

            // Character literal: `$x`, `$\n`, `$%` — the next char (or escape) is data.
            if (c == '$')
            {
                i++;
                if (i < n && src[i] == '\\')
                {
                    i++;
                }

                i++;
                continue;
            }

            if (c == '%')
            {
                var end = i;
                while (end < n && src[end] != '\n')
                {
                    end++;
                }

                BlankRange(outBuf, i, end, src);
                i = end;
                continue;
            }

            i++;
        }

        return new string(outBuf);
    }
}
