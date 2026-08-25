using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphFieldChannelSynthesizer — fieldChannelEdges (callback-synthesizer.ts:
// 179). Phase.Main, always run (no language gate). Phase-1 field-backed observer
// channels: a registrar (`onUpdate(cb){ this.callbacks.add(cb) }`) and a dispatcher
// (`triggerUpdate(){ for (cb of this.callbacks) cb() }`) share a store field. When a
// caller wires up `scene.onUpdate(this.triggerRender)`, synthesize dispatcher ->
// triggerRender. High-precision / low-recall: named callbacks only, channels paired
// by file + field.
// =============================================================================
internal sealed class CodeGraphFieldChannelSynthesizer : ICodeGraphEdgeSynthesizer
{
    // REGISTRAR_NAME (ts:33) / DISPATCHER_NAME (ts:34).
    private static readonly Regex RegistrarName = new(
        @"^(on[A-Z]\w*|subscribe|addListener|addEventListener|register|watch|listen|addCallback)$",
        RegexOptions.ECMAScript);

    private static readonly Regex DispatcherName = new(
        "(emit|trigger|notify|dispatch|fire|publish|flush)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    // registrarField (ts:139) — `this.<field>.add|push|set(`.
    private static readonly Regex RegistrarFieldRe = new(
        @"this\.(\w+)\.(?:add|push|set)\(",
        RegexOptions.ECMAScript);

    // dispatcherField (ts:144): a `for (… of this.<field>)` that invokes, or a
    // `this.<field>.forEach(`.
    private static readonly Regex ForOfRe = new(
        @"\bof\s+(?:Array\.from\(\s*)?this\.(\w+)",
        RegexOptions.ECMAScript);

    private static readonly Regex InvokeRe = new(@"\b\w+\s*\(", RegexOptions.ECMAScript);

    private static readonly Regex ForEachRe = new(@"this\.(\w+)\.forEach\(", RegexOptions.ECMAScript);

    private static readonly string[] Always = System.Array.Empty<string>();

    public string Name => "callback";

    public IReadOnlyList<string> RequiredLanguages => Always;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var registrars = new List<(CodeGraphNode Node, string Field)>();
        var dispatchers = new List<(CodeGraphNode Node, string Field)>();

        var scanned = 0;
        foreach (var m in MethodAndFunctionNodes(ctx))
        {
            if ((++scanned & 255) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var isReg = RegistrarName.IsMatch(m.Name);
            var isDisp = DispatcherName.IsMatch(m.Name);
            if (!isReg && !isDisp)
            {
                continue;
            }

            var content = ctx.ReadFile(m.FilePath);
            var src = string.IsNullOrEmpty(content)
                ? null
                : CodeGraphSynthesizerSupport.SliceLines(content, m.StartLine, m.EndLine);
            if (string.IsNullOrEmpty(src))
            {
                continue;
            }

            if (isReg)
            {
                var f = RegistrarField(src);
                if (f is not null)
                {
                    registrars.Add((m, f));
                }
            }

            if (isDisp)
            {
                var f = DispatcherField(src);
                if (f is not null)
                {
                    dispatchers.Add((m, f));
                }
            }
        }

        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var reg in registrars)
        {
            ct.ThrowIfCancellationRequested();

            var chDispatchers = new List<(CodeGraphNode Node, string Field)>();
            foreach (var d in dispatchers)
            {
                if (d.Node.FilePath == reg.Node.FilePath && d.Field == reg.Field)
                {
                    chDispatchers.Add(d);
                }
            }

            if (chDispatchers.Count == 0)
            {
                continue;
            }

            // `<registrar>( (this.)?<arg> )` — the callback argument at the wire-up
            // site. The registrar name is a plain identifier, so it is interpolated
            // raw (matching the TS `new RegExp(`${reg.node.name}\\s*\\(...`)).
            var argRe = new Regex(reg.Node.Name + @"\s*\(\s*(?:this\.)?(\w+)", RegexOptions.ECMAScript);

            var added = 0;
            foreach (var e in ctx.GetIncomingEdges(reg.Node.Id, CodeGraphSynthesizerSupport.CallsEdgeKinds))
            {
                if (added >= CodeGraphSynthesizerSupport.MaxCallbacksPerChannel)
                {
                    break;
                }

                if (e.Line is not int edgeLine || edgeLine == 0)
                {
                    continue;
                }

                var caller = ctx.GetNodeById(e.Source);
                if (caller is null)
                {
                    continue;
                }

                var callerContent = ctx.ReadFile(caller.FilePath);
                if (callerContent is null)
                {
                    continue;
                }

                var callerLines = callerContent.Split('\n');
                var idx = edgeLine - 1;
                if (idx < 0 || idx >= callerLines.Length)
                {
                    continue;
                }

                var am = argRe.Match(callerLines[idx]);
                if (!am.Success)
                {
                    continue;
                }

                var argName = am.Groups[1].Value;
                CodeGraphNode? fn = null;
                foreach (var cand in ctx.GetNodesByName(argName))
                {
                    if (cand.Kind == CodeGraphNodeKind.Method || cand.Kind == CodeGraphNodeKind.Function)
                    {
                        fn = cand;
                        break;
                    }
                }

                if (fn is null)
                {
                    continue;
                }

                foreach (var disp in chDispatchers)
                {
                    if (disp.Node.Id == fn.Id)
                    {
                        continue;
                    }

                    var key = disp.Node.Id + ">" + fn.Id;
                    if (!seen.Add(key))
                    {
                        continue;
                    }

                    edges.Add(new CodeGraphEdge(
                        disp.Node.Id,
                        fn.Id,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "callback"),
                            ("via", reg.Node.Name),
                            ("field", reg.Field),
                            // Where the callback was wired up — the #1 thing an agent
                            // greps to explain the flow.
                            ("registeredAt", caller.FilePath + ":" + edgeLine)),
                        disp.Node.StartLine,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                    added++;
                }
            }
        }

        return edges;
    }

    // Stream method + function nodes lazily (methodAndFunctionNodes, ts:173) — the
    // pass scan-and-filters to a tiny matched subset, so materializing every
    // function/method (gigabytes on a symbol-dense project) is what OOM'd #610.
    private static IEnumerable<CodeGraphNode> MethodAndFunctionNodes(CodeGraphResolutionContext ctx)
    {
        foreach (var n in ctx.IterateNodesByKind(CodeGraphNodeKind.Method))
        {
            yield return n;
        }

        foreach (var n in ctx.IterateNodesByKind(CodeGraphNodeKind.Function))
        {
            yield return n;
        }
    }

    // src.match(/this\.(\w+)\.(?:add|push|set)\(/) → the field name, or null (ts:139).
    private static string? RegistrarField(string src)
    {
        var m = RegistrarFieldRe.Match(src);
        return m.Success ? m.Groups[1].Value : null;
    }

    // dispatcherField (ts:144): a `for (… of this.<field>)` iteration that also
    // invokes, else a `this.<field>.forEach(`, else null.
    private static string? DispatcherField(string src)
    {
        var forOf = ForOfRe.Match(src);
        if (forOf.Success && InvokeRe.IsMatch(src))
        {
            return forOf.Groups[1].Value;
        }

        var forEach = ForEachRe.Match(src);
        return forEach.Success ? forEach.Groups[1].Value : null;
    }
}
