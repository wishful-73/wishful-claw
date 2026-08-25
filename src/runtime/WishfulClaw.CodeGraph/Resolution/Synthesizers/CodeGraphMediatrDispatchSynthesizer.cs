using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphMediatrDispatchSynthesizer — mediatrDispatchEdges (callback-synthesizer.ts:
// 2765). Phase.Main, gate has('csharp') (ts:3536). MediatR decouples a Send/Publish call
// site from its Handle method through a mediator, linked by the request/notification TYPE
// (the IRequestHandler<T,…> generic):
//   public class CancelOrderCommandHandler : IRequestHandler<CancelOrderCommand, bool> {
//       public async Task<bool> Handle(CancelOrderCommand request, CancellationToken ct) {…}
//   var command = new CancelOrderCommand(orderId);   await _mediator.Send(command);
// Bridge it: link the enclosing method at each mediator `.Send(x)`/`.Publish(x)` -> the
// `Handle` of the handler for x's type. C# method nodes have NO signature, so the handler's
// request type is read from the class base-list source; the sent type is resolved from the
// argument (inline `new X`, a local `var v = new X`, or a param/local `X v`). TWO gates: the
// receiver must be mediator-ish, and the resolved type must be a known handler request type.
// =============================================================================
internal sealed class CodeGraphMediatrDispatchSynthesizer : ICodeGraphEdgeSynthesizer
{
    // MEDIATR_HANDLER_BASE_RE (ts:2736).
    private static readonly Regex HandlerBaseRe = new(
        @"(?:IRequestHandler|INotificationHandler)\s*<\s*([A-Za-z_]\w*)",
        RegexOptions.ECMAScript);

    // MEDIATR_DISPATCH_RE (ts:2737).
    private static readonly Regex DispatchRe = new(
        @"([A-Za-z_][\w.]*)\s*\.\s*(?:Send|Publish)\s*\(\s*(new\s+[A-Z]\w*|[A-Za-z_]\w*)",
        RegexOptions.ECMAScript);

    // MEDIATR_RECEIVER_RE (ts:2738) — case-insensitive literal alternation.
    private static readonly Regex ReceiverRe = new(
        "(?:mediator|sender|publisher)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    // MEDIATR_CS_EXT (ts:2739).
    private static readonly Regex CsExt = new(@"\.cs$", RegexOptions.ECMAScript);

    // resolveMediatrArgType helpers (ts:2747/2749).
    private static readonly Regex InlNewRe = new(@"^new\s+([A-Z]\w*)", RegexOptions.ECMAScript);
    private static readonly Regex ArgIdentRe = new(@"^[A-Za-z_]\w*$", RegexOptions.ECMAScript);

    // MEDIATR_FANOUT_CAP (ts:2740) / MEDIATR_HANDLER_DECL_LOOKAHEAD (ts:2741).
    private const int MediatrFanoutCap = 80;
    private const int MediatrHandlerDeclLookahead = 4;

    // has('csharp') (ts:3536).
    private static readonly string[] Required = { CodeGraphLanguage.CSharp };

    public string Name => "mediatr-dispatch";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var scannedFiles = 0;

        // Pass 1 — request/notification type -> the Handle method of each handler class.
        var handlers = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!CsExt.IsMatch(file))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) ||
                (!content.Contains("IRequestHandler<", StringComparison.Ordinal) &&
                 !content.Contains("INotificationHandler<", StringComparison.Ordinal)))
            {
                continue;
            }

            var lines = content.Split('\n');
            var nodesInFile = ctx.GetNodesInFile(file);
            foreach (var cls in nodesInFile)
            {
                if (cls.Kind != CodeGraphNodeKind.Class)
                {
                    continue;
                }

                var declStart = cls.StartLine - 1;
                if (declStart < 0 || declStart >= lines.Length)
                {
                    continue;
                }

                var declEnd = Math.Min(lines.Length, declStart + MediatrHandlerDeclLookahead);
                var decl = string.Join("\n", lines, declStart, declEnd - declStart);
                var m = HandlerBaseRe.Match(decl);
                if (!m.Success)
                {
                    continue;
                }

                var type = m.Groups[1].Value;
                var end = cls.EndLine;
                CodeGraphNode? handle = null;
                foreach (var n in nodesInFile)
                {
                    if (n.Kind == CodeGraphNodeKind.Method && n.Name == "Handle" &&
                        n.StartLine >= cls.StartLine && n.StartLine <= end)
                    {
                        handle = n;
                        break;
                    }
                }

                if (handle is null)
                {
                    continue;
                }

                if (handlers.TryGetValue(type, out var arr))
                {
                    arr.Add(handle);
                }
                else
                {
                    handlers[type] = new List<CodeGraphNode> { handle };
                }
            }
        }

        if (handlers.Count == 0)
        {
            return System.Array.Empty<CodeGraphEdge>();
        }

        // Pass 2 — link each mediator-ish .Send(x)/.Publish(x) -> the handler of x's type.
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!CsExt.IsMatch(file))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) ||
                (!content.Contains(".Send(", StringComparison.Ordinal) &&
                 !content.Contains(".Publish(", StringComparison.Ordinal)))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.CSharp);
            var safeLines = safe.Split('\n');
            var nodesInFile = ctx.GetNodesInFile(file);
            var lineOf = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);
            var added = 0;
            foreach (Match m in DispatchRe.Matches(safe))
            {
                if (added >= MediatrFanoutCap)
                {
                    break;
                }

                if (!ReceiverRe.IsMatch(m.Groups[1].Value))
                {
                    continue; // not a mediator (MessagingCenter, HttpClient, …)
                }

                var line = lineOf(m.Index);
                var disp = CodeGraphSynthesizerSupport.EnclosingFn(nodesInFile, line);
                if (disp is null)
                {
                    continue;
                }

                var type = ResolveMediatrArgType(m.Groups[2].Value, safeLines, disp.StartLine, line);
                if (type is null || !handlers.TryGetValue(type, out var targets))
                {
                    continue;
                }

                foreach (var target in targets)
                {
                    if (target.Id == disp.Id)
                    {
                        continue;
                    }

                    var key = disp.Id + ">" + target.Id;
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    edges.Add(new CodeGraphEdge(
                        disp.Id,
                        target.Id,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "mediatr-dispatch"),
                            ("via", type),
                            ("registeredAt", file + ":" + line)),
                        line,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                    added++;
                }
            }
        }

        return edges;
    }

    // resolveMediatrArgType (ts:2746): the type sent at a `.Send(arg)`/`.Publish(arg)`
    // site — an inline `new X(…)`, else `arg` resolved within the enclosing method (a
    // `… arg = new X(…)` assignment wins, else a `X arg` declaration). Null when unseen.
    private static string? ResolveMediatrArgType(string arg, string[] lines, int methodStart, int dispatchLine)
    {
        var inl = InlNewRe.Match(arg);
        if (inl.Success)
        {
            return inl.Groups[1].Value;
        }

        if (!ArgIdentRe.IsMatch(arg))
        {
            return null;
        }

        // `arg` is a validated identifier — raw interpolation is safe (matches the TS).
        var assignRe = new Regex(@"\b" + arg + @"\b\s*=\s*new\s+([A-Z]\w*)", RegexOptions.ECMAScript);
        var declRe = new Regex(@"\b([A-Z]\w*)\b\s+" + arg + @"\b", RegexOptions.ECMAScript);
        string? declType = null;
        for (var i = Math.Max(0, methodStart - 1); i < dispatchLine && i < lines.Length; i++)
        {
            var ln = lines[i];
            var a = assignRe.Match(ln);
            if (a.Success)
            {
                return a.Groups[1].Value; // an explicit `arg = new X` is the most specific
            }

            if (declType is null)
            {
                var d = declRe.Match(ln);
                if (d.Success)
                {
                    declType = d.Groups[1].Value; // remember, keep scanning for an assignment
                }
            }
        }

        return declType;
    }
}
