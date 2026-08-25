using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphArkUiEmitterSynthesizer — arkuiEmitterEdges (callback-synthesizer.ts:
// 573). Phase.Main, gated to arkts. HarmonyOS `@ohos.events.emitter` bus bridge:
// `emitter.emit(eventId)` fires `emitter.on(eventId, cb)`, a framework-internal
// hop with no static edge. Link the emit-site enclosing function/method → the
// on/once-site enclosing function/method when both reference the SAME statically-
// recoverable event key. Numeric keys pair within the same FILE only; named keys
// within the same workspace module dir (or whole project when no modules), both
// behind a fan-out cap.
// =============================================================================
internal sealed class CodeGraphArkUiEmitterSynthesizer : ICodeGraphEdgeSynthesizer
{
    // ARKUI_EMITTER_CALL_RE (ts:549).
    private static readonly Regex EmitterCallRe = new(
        @"\bemitter\s*\.\s*(emit|on|once)\s*\(\s*([A-Za-z_$][\w$.]*|\{[^)]{0,120}?\beventId\s*:\s*[^,}]+[^)]*?\})",
        RegexOptions.CultureInvariant);

    private static readonly Regex EventIdLitRe = new(@"\beventId\s*:\s*([\w$.]+)", RegexOptions.CultureInvariant);
    private static readonly Regex NumericRe = new(@"^\d+$", RegexOptions.CultureInvariant);
    private static readonly Regex NameTokenRe = new(@"^[\w$.]+$", RegexOptions.CultureInvariant);

    // ARKUI_EMITTER_FANOUT_CAP (ts:552).
    private const int FanoutCap = 8;

    private static readonly string[] Required = { CodeGraphLanguage.ArkTs };

    public string Name => "arkui-emitter";

    public IReadOnlyList<string> RequiredLanguages => Required;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    private readonly record struct Site(string NodeId, string File, int Line);

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var emits = new Dictionary<string, List<Site>>(StringComparer.Ordinal);
        var handlers = new Dictionary<string, List<Site>>(StringComparer.Ordinal);
        var moduleDirs = ModuleDirs(ctx);

        var scanned = 0;
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scanned & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!file.EndsWith(".ets", StringComparison.Ordinal))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content) || !content.Contains("emitter.", StringComparison.Ordinal))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.TypeScript);
            var nodes = FnNodesInFile(ctx, file);
            var lineAt = CodeGraphSynthesizerSupport.MakeLineAt(safe, 1);

            foreach (Match m in EmitterCallRe.Matches(safe))
            {
                var verb = m.Groups[1].Value;
                var arg = m.Groups[2].Value.Trim();
                var line = lineAt(m.Index);
                var encl = SmallestEnclosing(nodes, line);
                if (encl is null)
                {
                    continue;
                }

                // Recover the event key from the first argument.
                string? key = null;
                string? idLit = null;
                if (arg.StartsWith("{", StringComparison.Ordinal))
                {
                    var lit = EventIdLitRe.Match(arg);
                    if (lit.Success)
                    {
                        idLit = lit.Groups[1].Value;
                    }
                }

                var token = idLit ?? arg;
                if (NumericRe.IsMatch(token))
                {
                    key = "num:" + file + ":" + token; // numeric: same-file only
                }
                else if (token.Contains('.'))
                {
                    key = "name:" + ModuleScopeOf(moduleDirs, file) + ":" + token;
                }
                else
                {
                    // Local variable — chase its same-file declaration one level:
                    // `let x = new EventsId(K)` / `const x = K`.
                    Regex declRe;
                    try
                    {
                        declRe = new Regex(
                            "\\b" + Regex.Escape(token) +
                            "\\b\\s*(?::[^=\\n]+)?=\\s*(?:new\\s+[\\w$.]+\\(\\s*([^)\\n]+?)\\s*\\)|([\\w$.]+))",
                            RegexOptions.CultureInvariant);
                    }
                    catch (ArgumentException)
                    {
                        continue;
                    }

                    var decl = declRe.Match(safe);
                    string? inner = null;
                    if (decl.Success)
                    {
                        inner = decl.Groups[1].Success ? decl.Groups[1].Value.Trim()
                            : decl.Groups[2].Success ? decl.Groups[2].Value.Trim()
                            : null;
                    }

                    if (!string.IsNullOrEmpty(inner) && NumericRe.IsMatch(inner))
                    {
                        key = "num:" + file + ":" + inner;
                    }
                    else if (!string.IsNullOrEmpty(inner) && NameTokenRe.IsMatch(inner))
                    {
                        key = "name:" + ModuleScopeOf(moduleDirs, file) + ":" + inner;
                    }
                }

                if (key is null)
                {
                    continue;
                }

                var site = new Site(encl.Id, file, line);
                var bucket = verb == "emit" ? emits : handlers;
                if (!bucket.TryGetValue(key, out var arr))
                {
                    arr = new List<Site>();
                    bucket[key] = arr;
                }

                arr.Add(site);
            }
        }

        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (key, emitSites) in emits)
        {
            if (!handlers.TryGetValue(key, out var handlerSites))
            {
                continue;
            }

            if (emitSites.Count > FanoutCap || handlerSites.Count > FanoutCap)
            {
                continue;
            }

            var eventLabel = key[(key.LastIndexOf(':') + 1)..];
            foreach (var e in emitSites)
            {
                foreach (var h in handlerSites)
                {
                    if (e.NodeId == h.NodeId)
                    {
                        continue;
                    }

                    var dedupe = e.NodeId + ">" + h.NodeId;
                    if (!seen.Add(dedupe))
                    {
                        continue;
                    }

                    edges.Add(new CodeGraphEdge(
                        e.NodeId,
                        h.NodeId,
                        CodeGraphEdgeKind.Calls,
                        CodeGraphSynthesizerSupport.Metadata(
                            ("synthesizedBy", "arkui-emitter"),
                            ("event", eventLabel),
                            ("registeredAt", h.File + ":" + h.Line)),
                        e.Line,
                        Column: null,
                        CodeGraphProvenance.Heuristic));
                }
            }
        }

        return edges;
    }

    // Distinct workspace-module directories, longest first (ts:580 / :684).
    internal static List<string> ModuleDirs(CodeGraphResolutionContext ctx)
    {
        var ws = ctx.GetWorkspacePackages();
        if (ws is null)
        {
            return new List<string>();
        }

        var dirs = new List<string>(new HashSet<string>(ws.ByName.Values, StringComparer.Ordinal));
        dirs.Sort((a, b) => b.Length - a.Length);
        return dirs;
    }

    internal static string ModuleScopeOf(List<string> moduleDirs, string file)
    {
        foreach (var dir in moduleDirs)
        {
            if (file == dir || file.StartsWith(dir + "/", StringComparison.Ordinal))
            {
                return dir;
            }
        }

        return string.Empty;
    }

    internal static List<CodeGraphNode> FnNodesInFile(CodeGraphResolutionContext ctx, string file)
    {
        var nodes = new List<CodeGraphNode>();
        foreach (var n in ctx.GetNodesInFile(file))
        {
            if (n.Kind == CodeGraphNodeKind.Method || n.Kind == CodeGraphNodeKind.Function)
            {
                nodes.Add(n);
            }
        }

        return nodes;
    }

    // Smallest-span enclosing node (ts sort by (endLine-startLine) asc, take [0]).
    internal static CodeGraphNode? SmallestEnclosing(List<CodeGraphNode> nodes, int line)
    {
        CodeGraphNode? best = null;
        var bestSpan = int.MaxValue;
        foreach (var n in nodes)
        {
            if (n.StartLine <= line && n.EndLine >= line)
            {
                var span = n.EndLine - n.StartLine;
                if (span < bestSpan)
                {
                    bestSpan = span;
                    best = n;
                }
            }
        }

        return best;
    }
}
