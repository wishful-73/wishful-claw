using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphDynamicBoundaries — dynamic-dispatch boundary detection for
// codegraph_explore (#687; port of src/mcp/dynamic-boundaries.ts).
//
// When the flow an agent asked about does NOT connect statically, the cause is
// almost always a dynamic-dispatch site: a computed member call, getattr,
// reflection, a string-keyed bus, a typed command/mediator dispatch. Guessing the
// missing edge was rejected (silent beats wrong — a wrong edge poisons the map).
// Instead, explore ANNOUNCES the boundary honestly: the exact site where the static
// path ends, the dispatch form, and — when a key is statically visible (string
// literal, `:symbol`, `new Type`) — that key, so the caller can shortlist candidates.
//
// Detection is deterministic regex over the comment/string-stripped body of the
// symbols the agent named, at QUERY TIME only. The graph is never mutated. Matching
// runs on the stripped text (so commented-out / string-embedded code can't fire) but
// snippets and keys are sliced from the ORIGINAL source at the same offsets — both
// strippers blank contents in place, preserving offsets, precisely for this.
// (CodeGraphStripComments blanks comments but KEEPS string contents — framework
// extractors need route literals; here a dispatch shape inside a string is a false
// positive, so BlankStringContents blanks them too, quotes preserved.)
//
// AOT + ReDoS safety (analysis/04 §5 R3): every pattern is a compile-time
// [GeneratedRegex]; the body-wide scan patterns (arbitrary source up to 60K chars)
// additionally use RegexOptions.NonBacktracking for a linear-time guarantee. The
// small keyFrom helpers run on <=~80-char slices (bounded) and stay backtracking so
// the backreference in SingleStringLiteral is expressible.
// =============================================================================
internal static partial class CodeGraphDynamicBoundaries
{
    // One detected dynamic-dispatch site. MoreSites counts additional same-form+key
    // sites in the same body beyond the reported one.
    internal sealed class BoundaryMatch
    {
        public required string Form { get; init; }

        public required string Label { get; init; }

        public required string Snippet { get; init; }

        // 1-based ABSOLUTE file line of the site (ready to print).
        public required int Line { get; init; }

        // Statically-visible dispatch key (string literal / :symbol / Type name), or null.
        public string? Key { get; init; }

        // For typed-bus matches the key is a TYPE name (candidates ~ `${Key}Handler`).
        public bool KeyIsType { get; init; }

        public int MoreSites { get; set; }
    }

    private const int MaxMatchesPerBody = 3;
    private const int MaxBodyChars = 60_000; // a god-function tail is still scannable; beyond, truncate.
    private const int MaxGetattrArgs = 300;

    // Node.language sets a form applies to (null = all). Values are CodeGraphLanguage.*.
    private static readonly HashSet<string> JsFamily = new(StringComparer.Ordinal)
    {
        "typescript", "javascript", "tsx", "jsx", "vue", "svelte", "astro", "arkts"
    };

    private static readonly HashSet<string> Py = new(StringComparer.Ordinal) { "python" };
    private static readonly HashSet<string> Rb = new(StringComparer.Ordinal) { "ruby" };
    private static readonly HashSet<string> Php = new(StringComparer.Ordinal) { "php" };

    private static readonly HashSet<string> JvmCsGo = new(StringComparer.Ordinal)
    {
        "java", "kotlin", "scala", "csharp", "go"
    };

    private static readonly HashSet<string> SwiftObjc = new(StringComparer.Ordinal)
    {
        "swift", "objc", "objcpp", "objective-c"
    };

    // A single dispatch form: its stable id, human label, applicable langs (null=all),
    // its body-scan regex, and an optional key derivation from the ORIGINAL slice.
    private sealed class FormSpec
    {
        public required string Form { get; init; }

        public required string Label { get; init; }

        public HashSet<string>? Langs { get; init; }

        public required Regex Re { get; init; }

        // Derive the dispatch key from the ORIGINAL-source slice around the match.
        public Func<string, (string Key, bool KeyIsType)?>? KeyFrom { get; init; }

        // Extra ORIGINAL chars after the match end handed to KeyFrom, capped at the first
        // newline — for forms whose key trails the matched prefix (e.g. `.getMethod(` ->
        // "handlePing"). $-anchored KeyFrom regexes must leave this 0.
        public int KeyWindow { get; init; }
    }

    private static readonly FormSpec[] Forms =
    {
        new()
        {
            // handlers[action.type](payload) / registry[key](args). The `](` adjacency is
            // the gate; a word/`)`/`]` must precede `[` so array literals / prose can't fire.
            Form = "computed-call",
            Label = "computed member call",
            Re = ComputedCallRe(),
            KeyFrom = ComputedCallKey
        },
        new()
        {
            // import(expr) / require(expr) with a NON-literal argument -> runtime module
            // choice. Literal imports are ordinary edges and never reach this scanner.
            Form = "dynamic-import",
            Label = "dynamic import",
            Langs = JsFamily,
            Re = DynamicImportJsRe()
        },
        new()
        {
            Form = "dynamic-import",
            Label = "dynamic import",
            Langs = Py,
            Re = DynamicImportPyRe()
        },
        new()
        {
            // obj.send(:method_name) / public_send / method(:name) — ruby metaprogramming.
            Form = "ruby-send",
            Label = "send dispatch",
            Langs = Rb,
            Re = RubySendRe(),
            KeyFrom = RubySendKey
        },
        new()
        {
            // call_user_func([$this, 'method']) / $this->$method() / $callback() — PHP
            // variable functions and callables.
            Form = "php-dynamic",
            Label = "dynamic call",
            Langs = Php,
            Re = PhpDynamicRe(),
            KeyWindow = 80,
            KeyFrom = SingleStringLiteralKey
        },
        new()
        {
            // Reflection: Method.invoke / getMethod("x") / Class.forName / Go
            // reflect MethodByName / C# Activator.CreateInstance, GetMethod.
            Form = "reflection",
            Label = "reflective dispatch",
            Langs = JvmCsGo,
            Re = ReflectionRe(),
            KeyWindow = 80,
            KeyFrom = SingleStringLiteralKey
        },
        new()
        {
            // new Proxy(target, handler) / Reflect.get|apply — JS metaobject dispatch.
            Form = "proxy-reflect",
            Label = "Proxy/Reflect dispatch",
            Langs = JsFamily,
            Re = ProxyReflectRe()
        },
        new()
        {
            // mediator.Send(new CreateTodoItemCommand(...)) / bus.publish(new OrderEvent(...))
            // — typed message dispatch (MediatR/CQRS/event-bus). The request TYPE is the
            // key; the conventional target is `<Type>Handler`.
            Form = "typed-bus",
            Label = "typed message dispatch",
            Re = TypedBusRe(),
            KeyFrom = TypedBusKey
        },
        new()
        {
            // emitter.emit(eventVar, ...) / store.dispatch(action) — string-keyed dispatch
            // where the key is a RUNTIME value. (Literal-keyed emits are the synthesizer's
            // territory and connect statically when a handler matches.)
            Form = "var-key-dispatch",
            Label = "string-keyed dispatch (runtime key)",
            Re = VarKeyDispatchRe()
        },
        new()
        {
            // Swift/ObjC: #selector(name) / NSClassFromString — runtime selector dispatch.
            Form = "selector",
            Label = "selector dispatch",
            Langs = SwiftObjc,
            Re = SelectorRe(),
            KeyFrom = SelectorKey
        }
    };

    // ===========================================================================
    // Public entry — scan one symbol's body for dynamic-dispatch sites.
    //   body           the symbol's source text (sliced from the file)
    //   language       Node.language of the symbol (CodeGraphLanguage.*)
    //   fileStartLine  1-based line where `body` starts in its file — returned lines
    //                  are ABSOLUTE file lines.
    // ===========================================================================
    public static List<BoundaryMatch> ScanDynamicDispatch(string body, string language, int fileStartLine)
    {
        var original = body.Length > MaxBodyChars ? body.Substring(0, MaxBodyChars) : body;
        var stripLang = MapToStripLanguage(language);
        var commentStripped = stripLang is null ? original : CodeGraphStripComments.StripForRegex(original, stripLang);
        var stripped = BlankStringContents(commentStripped);

        var outList = new List<BoundaryMatch>();
        var seen = new Dictionary<string, BoundaryMatch>(StringComparer.Ordinal); // form+key -> first match.

        if (language == CodeGraphLanguage.Python)
        {
            ScanPythonGetattr(stripped, original, fileStartLine, outList, seen);
        }

        foreach (var spec in Forms)
        {
            if (outList.Count >= MaxMatchesPerBody)
            {
                break;
            }

            if (spec.Langs is not null && !spec.Langs.Contains(language))
            {
                continue;
            }

            foreach (Match m in spec.Re.Matches(stripped))
            {
                var sliceEnd = m.Index + m.Length;
                if (spec.KeyWindow > 0)
                {
                    var windowEnd = Math.Min(original.Length, sliceEnd + spec.KeyWindow);
                    var nl = original.IndexOf('\n', sliceEnd);
                    sliceEnd = nl != -1 && nl < windowEnd ? nl : windowEnd;
                }

                var origSlice = original.Substring(m.Index, sliceEnd - m.Index);
                var derived = spec.KeyFrom?.Invoke(origSlice);
                var dedupeKey = spec.Form + "|" + (derived?.Key ?? string.Empty);
                if (seen.TryGetValue(dedupeKey, out var prior))
                {
                    prior.MoreSites++;
                    continue;
                }

                var match = new BoundaryMatch
                {
                    Form = spec.Form,
                    Label = spec.Label,
                    Snippet = SnippetAround(original, m.Index),
                    Line = fileStartLine + CountNewlines(original, m.Index),
                    Key = derived?.Key,
                    KeyIsType = derived?.KeyIsType ?? false
                };
                seen[dedupeKey] = match;
                outList.Add(match);
                if (outList.Count >= MaxMatchesPerBody)
                {
                    return outList;
                }
            }
        }

        return outList;
    }

    // ===========================================================================
    // Python getattr dispatch — handled in code, not the Forms table, because real
    // getattr calls have nested-call arguments spanning lines that a regex argument
    // class can't bound. Two shapes:
    //   getattr(obj, name)(args)                      -> immediate call
    //   handler = getattr(obj, name) ... handler(...)  -> assigned, called later
    // ===========================================================================
    private static void ScanPythonGetattr(
        string stripped, string original, int fileStartLine, List<BoundaryMatch> outList, Dictionary<string, BoundaryMatch> seen)
    {
        foreach (Match m in GetattrRe().Matches(stripped))
        {
            if (outList.Count >= MaxMatchesPerBody)
            {
                break;
            }

            var open = m.Index + m.Length - 1;
            var close = MatchBalancedParen(stripped, open);
            if (close == -1)
            {
                continue;
            }

            string? form = null;
            var label = string.Empty;

            // Immediate call: getattr(...)(
            var afterLen = Math.Min(7, stripped.Length - (close + 1));
            var after = afterLen > 0 ? stripped.Substring(close + 1, afterLen) : string.Empty;
            if (GetattrImmediateCallRe().IsMatch(after))
            {
                form = "getattr-call";
                label = "getattr dispatch";
            }
            else
            {
                // Assigned form: look back for `name =` and forward for `name(`.
                var lineStart = stripped.LastIndexOf('\n', Math.Max(0, m.Index - 1)) + 1;
                var before = stripped.Substring(lineStart, m.Index - lineStart);
                var assign = GetattrAssignRe().Match(before);
                if (assign.Success)
                {
                    var name = assign.Groups[1].Value;
                    var rest = stripped.Substring(close + 1);
                    if (Regex.IsMatch(rest, $@"\b{Regex.Escape(name)}\s*\(", RegexOptions.NonBacktracking))
                    {
                        form = "getattr-assign";
                        label = "getattr dispatch (assigned, called later)";
                    }
                }
            }

            if (form is null)
            {
                continue;
            }

            var key = SingleStringLiteral(original.Substring(open + 1, close - (open + 1)));
            var dedupeKey = form + "|" + (key ?? string.Empty);
            if (seen.TryGetValue(dedupeKey, out var prior))
            {
                prior.MoreSites++;
                continue;
            }

            var match = new BoundaryMatch
            {
                Form = form,
                Label = label,
                Snippet = SnippetAround(original, m.Index),
                Line = fileStartLine + CountNewlines(original, m.Index),
                Key = key
            };
            seen[dedupeKey] = match;
            outList.Add(match);
        }
    }

    // Index of the `)` balancing `text[open]`, or -1 (cap: MaxGetattrArgs chars).
    private static int MatchBalancedParen(string text, int open)
    {
        var depth = 0;
        var end = Math.Min(text.Length, open + MaxGetattrArgs);
        for (var i = open; i < end; i++)
        {
            var c = text[i];
            if (c == '(')
            {
                depth++;
            }
            else if (c == ')' && --depth == 0)
            {
                return i;
            }
        }

        return -1;
    }

    // ===========================================================================
    // Comment/string strippers
    // ===========================================================================

    // Blank the CONTENTS of string literals (quotes preserved, offsets preserved) so
    // dispatch-shaped prose — docs, error messages, template text — can't fire a
    // matcher. Run AFTER comment stripping. Backslash escapes honored; '/" strings end
    // at a newline (unterminated); backticks span lines, and `${...}` inside them is
    // blanked too. Missing a dispatch inside a template literal is acceptable;
    // false-firing on prose is not.
    public static string BlankStringContents(string text)
    {
        var outBuf = text.ToCharArray();
        var i = 0;
        var n = text.Length;
        while (i < n)
        {
            var c = text[i];
            if (c == '"' || c == '\'' || c == '`')
            {
                var quote = c;
                i++;
                while (i < n && text[i] != quote)
                {
                    if (text[i] == '\\' && i + 1 < n)
                    {
                        outBuf[i] = ' ';
                        outBuf[i + 1] = ' ';
                        i += 2;
                        continue;
                    }

                    if (quote != '`' && text[i] == '\n')
                    {
                        break; // unterminated — stop blanking.
                    }

                    if (text[i] != '\n')
                    {
                        outBuf[i] = ' '; // keep newlines for line math.
                    }

                    i++;
                }

                if (i < n && text[i] == quote)
                {
                    i++;
                }

                continue;
            }

            i++;
        }

        return new string(outBuf);
    }

    // Map a Node.language to the CodeGraphStripComments language whose blanker fits,
    // or null (no dedicated blanker — leave comments intact, matching the TS default).
    private static string? MapToStripLanguage(string language) => language switch
    {
        CodeGraphLanguage.Python => CodeGraphLanguage.Python,
        CodeGraphLanguage.Ruby => CodeGraphLanguage.Ruby,
        CodeGraphLanguage.Rust => CodeGraphLanguage.Rust,
        CodeGraphLanguage.Php => CodeGraphLanguage.Php,
        CodeGraphLanguage.Go => CodeGraphLanguage.Go,
        CodeGraphLanguage.JavaScript or CodeGraphLanguage.Jsx => CodeGraphLanguage.JavaScript,
        CodeGraphLanguage.TypeScript or CodeGraphLanguage.Tsx or CodeGraphLanguage.Vue
            or CodeGraphLanguage.Svelte or CodeGraphLanguage.Astro or CodeGraphLanguage.ArkTs
            => CodeGraphLanguage.TypeScript,
        CodeGraphLanguage.Java or CodeGraphLanguage.Kotlin or CodeGraphLanguage.Scala
            or CodeGraphLanguage.Dart => CodeGraphLanguage.Java,
        CodeGraphLanguage.CSharp => CodeGraphLanguage.CSharp,
        CodeGraphLanguage.Swift => CodeGraphLanguage.Swift,
        // C-style comments + double-quoted strings — close enough for blanking.
        CodeGraphLanguage.C or CodeGraphLanguage.Cpp or CodeGraphLanguage.ObjC or "objcpp"
            => CodeGraphLanguage.Java,
        _ => null
    };

    // ===========================================================================
    // Key derivation helpers (run on small ORIGINAL slices)
    // ===========================================================================

    // Exactly one quoted literal and no concatenation -> that literal is the key.
    private static string? SingleStringLiteral(string text)
    {
        var m = SingleStringLiteralRe().Match(text);
        return m.Success ? m.Groups[2].Value : null;
    }

    private static (string Key, bool KeyIsType)? SingleStringLiteralKey(string orig)
    {
        var key = SingleStringLiteral(orig);
        return key is not null ? (key, false) : null;
    }

    private static (string Key, bool KeyIsType)? ComputedCallKey(string orig)
    {
        var inner = ComputedCallKeyRe().Match(orig);
        if (!inner.Success)
        {
            return null;
        }

        var key = SingleStringLiteral(inner.Groups[1].Value);
        return key is not null ? (key, false) : null;
    }

    private static (string Key, bool KeyIsType)? RubySendKey(string orig)
    {
        var m = RubySymbolRe().Match(orig);
        return m.Success ? (m.Groups[1].Value, false) : null;
    }

    private static (string Key, bool KeyIsType)? TypedBusKey(string orig)
    {
        var m = TypedBusKeyRe().Match(orig);
        return m.Success ? (m.Groups[1].Value, true) : null;
    }

    private static (string Key, bool KeyIsType)? SelectorKey(string orig)
    {
        var m = SelectorKeyRe().Match(orig);
        if (!m.Success)
        {
            return null;
        }

        var segs = m.Groups[1].Value.Split('.');
        return (segs[^1], false);
    }

    // ===========================================================================
    // Small helpers
    // ===========================================================================

    private static int CountNewlines(string text, int end)
    {
        var count = 0;
        for (var i = 0; i < end && i < text.Length; i++)
        {
            if (text[i] == '\n')
            {
                count++;
            }
        }

        return count;
    }

    // The full source line containing `index`, trimmed and capped for display.
    private static string SnippetAround(string text, int index)
    {
        var lineStart = text.LastIndexOf('\n', Math.Max(0, index - 1)) + 1;
        var lineEnd = text.IndexOf('\n', index);
        if (lineEnd == -1)
        {
            lineEnd = text.Length;
        }

        var line = text.Substring(lineStart, lineEnd - lineStart).Trim();
        return line.Length > 120 ? line.Substring(0, 117) + "..." : line;
    }

    // ===========================================================================
    // Compiled patterns. Body-wide scans use NonBacktracking (linear-time over 60K
    // arbitrary chars); the JS dynamic-import lookahead and the SingleStringLiteral
    // backreference are inexpressible under NonBacktracking, so those stay backtracking
    // but only ever run on bounded inputs.
    // ===========================================================================

    [GeneratedRegex(@"[\w$)\]]\s*\[([^[\]\n]{1,80})\]\s*\(", RegexOptions.NonBacktracking)]
    private static partial Regex ComputedCallRe();

    [GeneratedRegex(@"\[([^[\]\n]{1,80})\]\s*\($")]
    private static partial Regex ComputedCallKeyRe();

    [GeneratedRegex(@"\b(?:import|require)\s*\(\s*(?![\s'""`)])")]
    private static partial Regex DynamicImportJsRe();

    [GeneratedRegex(@"\bimportlib\.import_module\s*\(|\b__import__\s*\(", RegexOptions.NonBacktracking)]
    private static partial Regex DynamicImportPyRe();

    [GeneratedRegex(@"\.(?:public_)?send\s*\(\s*:?\w+|\bmethod\s*\(\s*:\w+\s*\)", RegexOptions.NonBacktracking)]
    private static partial Regex RubySendRe();

    [GeneratedRegex(@":(\w+)")]
    private static partial Regex RubySymbolRe();

    [GeneratedRegex(@"\bcall_user_func(?:_array)?\s*\(|\$this\s*->\s*\$\w+\s*\(|\$\w+\s*\(", RegexOptions.NonBacktracking)]
    private static partial Regex PhpDynamicRe();

    [GeneratedRegex(@"\.invoke\s*\(|\.get(?:Declared)?Method\s*\(|\.GetMethod\s*\(|MethodByName\s*\(|Activator\.CreateInstance|Class\.forName\s*\(", RegexOptions.NonBacktracking)]
    private static partial Regex ReflectionRe();

    [GeneratedRegex(@"\bnew\s+Proxy\s*\(|\bReflect\.(?:get|apply|construct)\s*\(", RegexOptions.NonBacktracking)]
    private static partial Regex ProxyReflectRe();

    [GeneratedRegex(@"\.(?:[Ss]end|[Pp]ublish|[Dd]ispatch|[Ee]xecute|[Pp]ost|[Ee]mit)(?:Async)?\s*(?:<[^<>\n]{0,80}>)?\s*\(\s*new\s+([A-Z]\w*)", RegexOptions.NonBacktracking)]
    private static partial Regex TypedBusRe();

    [GeneratedRegex(@"new\s+([A-Z]\w*)$")]
    private static partial Regex TypedBusKeyRe();

    [GeneratedRegex(@"\.(?:emit|dispatch|trigger|fire|publish|broadcast)\s*\(\s*[A-Za-z_$][\w$]*(?:\.[\w$]+){0,3}\s*[,)]", RegexOptions.NonBacktracking)]
    private static partial Regex VarKeyDispatchRe();

    [GeneratedRegex(@"#selector\s*\(\s*([\w.]+)|NSClassFromString\s*\(", RegexOptions.NonBacktracking)]
    private static partial Regex SelectorRe();

    [GeneratedRegex(@"#selector\s*\(\s*([\w.]+)")]
    private static partial Regex SelectorKeyRe();

    [GeneratedRegex(@"\bgetattr\s*\(", RegexOptions.NonBacktracking)]
    private static partial Regex GetattrRe();

    [GeneratedRegex(@"^\s*\(")]
    private static partial Regex GetattrImmediateCallRe();

    [GeneratedRegex(@"(\w+)\s*=\s*$")]
    private static partial Regex GetattrAssignRe();

    [GeneratedRegex(@"^[^'""`]*(['""`])([\w.:-]{2,64})\1[^'""`]*$")]
    private static partial Regex SingleStringLiteralRe();
}
