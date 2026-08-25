using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphGinMiddlewareSynthesizer — ginMiddlewareChainEdges (callback-synthesizer.ts:
// 1895). Phase.Main, gated to Go. Gin runs its middleware/handler chain by indexing a
// `handlers` slice (`c.handlers[c.index](c)`) — a runtime dispatch with no static call
// edge — so a request never statically reaches the middleware registered with
// `.Use(...)` / `.GET("/p", h)`. Bridge it: find the chain dispatcher method(s) (the
// one that invokes the `handlers` slice by index) and link each dispatcher -> every
// HandlerFunc registered through a gin registration call, so trace/callees reach the
// middleware and route handlers.
//
// String args (paths/methods) and inline closures are dropped by the tail-ident
// extractor; only bare/`pkg.Func()` handler identifiers survive. Capped per dispatcher.
// =============================================================================
internal sealed class CodeGraphGinMiddlewareSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredGo = { CodeGraphLanguage.Go };

    // GIN_DISPATCH_RE (ts:1861) — `c.handlers[c.index](c)`. A plain test.
    private static readonly Regex DispatchRe = new(
        @"\.handlers\s*\[[^\]]*\]\s*\(",
        RegexOptions.ECMAScript);

    // GIN_REG_RE (ts:1862) — a gin registration call `.Use(` / `.GET(` / … / `.Handle(`.
    private static readonly Regex RegRe = new(
        @"\.(?:Use|GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Any|Handle)\s*\(",
        RegexOptions.ECMAScript);

    // Cheap per-file prefilter (ts:1908) — the method-verb registration forms.
    private static readonly Regex RegPrefilter = new(
        @"\.(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD|Any|Handle)\(",
        RegexOptions.ECMAScript);

    // Tail-ident cleanup regexes for goHandlerIdent (ts:1888).
    private static readonly Regex TrailingCallRe = new(@"\(\s*\)$", RegexOptions.ECMAScript);
    private static readonly Regex TailIdentRe = new(@"(?:\.|^)([A-Za-z_]\w*)$", RegexOptions.ECMAScript);

    public string Name => "gin-middleware-chain";

    public IReadOnlyList<string> RequiredLanguages => RequiredGo;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        // 1. Find the chain dispatcher(s): a Go method that invokes a `handlers` slice by
        //    index.
        var dispatchers = new List<CodeGraphNode>();
        var scanned = 0;
        foreach (var n in ctx.IterateNodesByKind(CodeGraphNodeKind.Method))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (n.Language != CodeGraphLanguage.Go)
            {
                continue;
            }

            var content = ctx.ReadFile(n.FilePath);
            var src = string.IsNullOrEmpty(content)
                ? null
                : CodeGraphSynthesizerSupport.SliceLines(content, n.StartLine, n.EndLine);
            if (!string.IsNullOrEmpty(src) && DispatchRe.IsMatch(src))
            {
                dispatchers.Add(n);
            }
        }

        if (dispatchers.Count == 0)
        {
            return System.Array.Empty<CodeGraphEdge>(); // not a gin repo — bail
        }

        // 2. Collect handler identifiers registered via gin registration calls. String
        //    args (paths/methods) and inline closures are dropped by GoHandlerIdent.
        var registered = new Dictionary<string, string>(StringComparer.Ordinal); // name -> registeredAt
        var scannedFiles = 0;
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!file.EndsWith(".go", StringComparison.Ordinal))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) ||
                (!content.Contains(".Use(", StringComparison.Ordinal) && !RegPrefilter.IsMatch(content)))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Go);
            var lineAt = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);
            foreach (Match m in RegRe.Matches(safe))
            {
                var parenIdx = m.Index + m.Length - 1;
                var argStr = GoBalancedArgs(safe, parenIdx);
                if (argStr is null)
                {
                    continue;
                }

                var line = lineAt(m.Index);
                foreach (var arg in GoSplitArgs(argStr))
                {
                    var name = GoHandlerIdent(arg);
                    if (name is not null && !registered.ContainsKey(name))
                    {
                        registered[name] = file + ":" + line;
                    }
                }
            }
        }

        if (registered.Count == 0)
        {
            return System.Array.Empty<CodeGraphEdge>();
        }

        // 3. Link each dispatcher -> each registered handler node (dedup, capped).
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var disp in dispatchers)
        {
            var added = 0;
            foreach (var (name, registeredAt) in registered)
            {
                if (added >= CodeGraphSynthesizerSupport.MaxCallbacksPerChannel)
                {
                    break;
                }

                CodeGraphNode? handler = null;
                foreach (var cand in ctx.GetNodesByName(name))
                {
                    if ((cand.Kind == CodeGraphNodeKind.Function || cand.Kind == CodeGraphNodeKind.Method) &&
                        cand.Language == CodeGraphLanguage.Go)
                    {
                        handler = cand;
                        break;
                    }
                }

                if (handler is null || handler.Id == disp.Id)
                {
                    continue;
                }

                var key = disp.Id + ">" + handler.Id;
                if (!seen.Add(key))
                {
                    continue;
                }

                edges.Add(new CodeGraphEdge(
                    disp.Id,
                    handler.Id,
                    CodeGraphEdgeKind.Calls,
                    CodeGraphSynthesizerSupport.Metadata(
                        ("synthesizedBy", "gin-middleware-chain"),
                        ("via", name),
                        ("registeredAt", registeredAt)),
                    disp.StartLine,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
                added++;
            }
        }

        return edges;
    }

    // Balanced `(...)` body starting at the '(' index; null if unbalanced (ts:1865).
    private static string? GoBalancedArgs(string s, int openIdx)
    {
        var depth = 0;
        for (var i = openIdx; i < s.Length; i++)
        {
            var c = s[i];
            if (c == '(')
            {
                depth++;
            }
            else if (c == ')')
            {
                depth--;
                if (depth == 0)
                {
                    return s.Substring(openIdx + 1, i - (openIdx + 1));
                }
            }
        }

        return null;
    }

    // Split a top-level comma list, respecting nested () [] {} (ts:1875).
    private static List<string> GoSplitArgs(string args)
    {
        var outList = new List<string>();
        var depth = 0;
        var cur = new System.Text.StringBuilder();
        foreach (var c in args)
        {
            if (c == '(' || c == '[' || c == '{')
            {
                depth++;
                cur.Append(c);
            }
            else if (c == ')' || c == ']' || c == '}')
            {
                depth--;
                cur.Append(c);
            }
            else if (c == ',' && depth == 0)
            {
                outList.Add(cur.ToString());
                cur.Clear();
            }
            else
            {
                cur.Append(c);
            }
        }

        if (cur.ToString().Trim().Length > 0)
        {
            outList.Add(cur.ToString());
        }

        return outList;
    }

    // Tail ident of a handler arg: `gin.Logger()`->`Logger`, `mw`->`mw`; null for
    // string paths / closures (ts:1888).
    private static string? GoHandlerIdent(string expr)
    {
        var cleaned = TrailingCallRe.Replace(expr.Trim(), string.Empty); // drop a trailing call ()
        if (cleaned.Length == 0 || cleaned[0] == '"' || cleaned[0] == '`' ||
            cleaned.StartsWith("func", StringComparison.Ordinal))
        {
            return null;
        }

        var m = TailIdentRe.Match(cleaned);
        return m.Success ? m.Groups[1].Value : null;
    }
}
