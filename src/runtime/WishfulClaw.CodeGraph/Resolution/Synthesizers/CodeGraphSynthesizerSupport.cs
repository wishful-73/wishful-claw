using System.Buffers;
using System.Text;
using System.Text.Json;

// =============================================================================
// CodeGraphSynthesizerSupport — the shared primitives every dynamic-edge
// synthesizer transcribes from the top of callback-synthesizer.ts: the FANOUT
// caps, FN_KINDS, enclosingFn, sliceLines, makeLineAt, the two graph helpers
// (methodsOf / methodNameSet), and a reflection-free metadata-JSON builder. Kept
// in one place so each CodeGraph*Synthesizer stays a faithful 1:1 transcription of
// its TS function without re-deriving the primitives.
//
// GLOBAL namespace, all-internal, reflection-free/AOT (Decision 16/17): edge
// metadata is emitted with Utf8JsonWriter, never JsonSerializer.
// =============================================================================
internal static class CodeGraphSynthesizerSupport
{
    // callback-synthesizer.ts:35 (MAX_CALLBACKS_PER_CHANNEL), :43 (MAX_JSX_CHILDREN),
    // :36 (EVENT_FANOUT_CAP).
    internal const int MaxCallbacksPerChannel = 40;
    internal const int MaxJsxChildren = 30;
    internal const int EventFanoutCap = 6;

    // Edge-kind filters reused across passes (one shared array each — avoids a
    // per-call allocation on the hot getOutgoingEdges/getIncomingEdges scans).
    internal static readonly string[] ContainsEdgeKinds = { CodeGraphEdgeKind.Contains };
    internal static readonly string[] CallsEdgeKinds = { CodeGraphEdgeKind.Calls };
    internal static readonly string[] ImplementsExtendsEdgeKinds =
    {
        CodeGraphEdgeKind.Implements, CodeGraphEdgeKind.Extends
    };

    // FN_KINDS (callback-synthesizer.ts:152) — the node kinds enclosingFn attributes to.
    private static readonly HashSet<string> FnKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Method, CodeGraphNodeKind.Function, CodeGraphNodeKind.Component
    };

    // Innermost function/method/component node whose [startLine, endLine] contains
    // `line`; prefers the tightest (latest-starting) encloser (enclosingFn, ts:155).
    internal static CodeGraphNode? EnclosingFn(IReadOnlyList<CodeGraphNode> nodesInFile, int line)
    {
        CodeGraphNode? best = null;
        foreach (var n in nodesInFile)
        {
            if (!FnKinds.Contains(n.Kind))
            {
                continue;
            }

            var end = n.EndLine;
            if (n.StartLine <= line && end >= line)
            {
                if (best is null || n.StartLine >= best.StartLine)
                {
                    best = n; // prefer the tightest (latest-starting) encloser
                }
            }
        }

        return best;
    }

    // content.split('\n').slice(startLine - 1, endLine).join('\n') — 1-based,
    // inclusive of endLine (sliceLines, ts:107). Returns null only when a bound is
    // falsy (<= 0), mirroring TS `if (!startLine || !endLine) return null`; an empty
    // slice yields "" exactly as JS `[].join('\n')` does.
    internal static string? SliceLines(string content, int startLine, int endLine)
    {
        if (startLine <= 0 || endLine <= 0)
        {
            return null;
        }

        var lines = content.Split('\n');
        var start = startLine - 1;
        var end = endLine;
        if (start < 0)
        {
            start = 0;
        }

        if (start >= lines.Length || end <= start)
        {
            return string.Empty; // JS slice past the end / empty range → []
        }

        if (end > lines.Length)
        {
            end = lines.Length;
        }

        return string.Join("\n", lines, start, end - start);
    }

    // Per-match 1-based line resolver over `src` anchored at `baseLine`: returns
    // baseLine + (# of '\n' strictly before idx). The newline index is built lazily
    // on first call (most sources never produce a match), then binary-searched
    // (makeLineAt, ts:120) — O(source) once instead of O(source) per match.
    internal static Func<int, int> MakeLineAt(string src, int baseLine)
    {
        List<int>? nl = null;
        return idx =>
        {
            if (nl is null)
            {
                nl = new List<int>();
                for (var i = src.IndexOf('\n'); i != -1; i = src.IndexOf('\n', i + 1))
                {
                    nl.Add(i);
                }
            }

            // Count newlines strictly before idx.
            var lo = 0;
            var hi = nl.Count;
            while (lo < hi)
            {
                var mid = (lo + hi) >> 1;
                if (nl[mid] < idx)
                {
                    lo = mid + 1;
                }
                else
                {
                    hi = mid;
                }
            }

            return baseLine + lo;
        };
    }

    // Method nodes directly contained by a container (its `contains` edges whose
    // target is a method), materialized (methodsOf, ts:407/756/1032).
    internal static List<CodeGraphNode> MethodsOf(CodeGraphResolutionContext ctx, string containerId)
    {
        var result = new List<CodeGraphNode>();
        foreach (var e in ctx.GetOutgoingEdges(containerId, ContainsEdgeKinds))
        {
            var n = ctx.GetNodeById(e.Target);
            if (n is not null && n.Kind == CodeGraphNodeKind.Method)
            {
                result.Add(n);
            }
        }

        return result;
    }

    // Name set of a container's method children (methodNameSet, ts:831). Ordinal —
    // JS Set membership is case-sensitive.
    internal static HashSet<string> MethodNameSet(CodeGraphResolutionContext ctx, string containerId)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var e in ctx.GetOutgoingEdges(containerId, ContainsEdgeKinds))
        {
            var n = ctx.GetNodeById(e.Target);
            if (n is not null && n.Kind == CodeGraphNodeKind.Method)
            {
                set.Add(n.Name);
            }
        }

        return set;
    }

    // Build a synthesized edge's raw-JSON metadata { key: value, ... } via
    // Utf8JsonWriter (reflection-free, correct escaping). Every synthesizer metadata
    // value is a string; key order is the TS object-literal order the caller passes.
    internal static string Metadata(params (string Key, string Value)[] fields)
    {
        var buffer = new ArrayBufferWriter<byte>(128);
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            foreach (var (key, value) in fields)
            {
                writer.WriteString(key, value);
            }

            writer.WriteEndObject();
        }

        return Encoding.UTF8.GetString(buffer.WrittenSpan);
    }
}
