using System.Text;
using System.Text.Json;

// =============================================================================
// CodeGraphCallPaths — the in-memory DFS over `calls` edges that surfaces execution
// chains connecting ≥2 query-relevant roots (context/index.ts buildCallPathsSection
// :320), plus the low-confidence honest-handoff note (:285) and its stable marker
// (context/markers.ts). Both are markdown SECTIONS the formatter appends to
// buildContext output; keeping them here mirrors the TS ContextBuilder private methods.
//
// This bakes path-finding INTO the always-loaded context tool: agents reliably read
// context output but do not discover/adopt a standalone trace tool, so "how does X
// reach Y" is answered here without the agent needing to find/choose a new tool. Chains
// stop where the static call graph ends (dynamic dispatch) — an honest truncation;
// synthesized (heuristic) hops are labeled inline with their registration site.
// =============================================================================
internal static class CodeGraphCallPaths
{
    // LOW_CONFIDENCE_MARKER (context/markers.ts:19). A STABLE sentinel: the MCP/tool layer
    // detects it to suppress the contradictory "this is comprehensive" framing. Changing
    // the text is a breaking sentinel change — keep the emitter and any detector in sync.
    public const string LowConfidenceMarker = "### ⚠️ Low-confidence match";

    private const int MaxHops = 6;

    // buildCallPathsSection (context/index.ts:320). Returns the markdown section, or "".
    public static string BuildCallPathsSection(CodeGraphSubgraph subgraph)
    {
        // Adjacency over `calls` edges whose both endpoints are in the subgraph.
        var adj = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var e in subgraph.Edges)
        {
            if (e.Kind != CodeGraphEdgeKind.Calls)
            {
                continue;
            }

            if (!subgraph.Nodes.ContainsKey(e.Source) || !subgraph.Nodes.ContainsKey(e.Target))
            {
                continue;
            }

            if (adj.TryGetValue(e.Source, out var list))
            {
                list.Add(e.Target);
            }
            else
            {
                adj[e.Source] = new List<string> { e.Target };
            }
        }

        if (adj.Count == 0)
        {
            return string.Empty;
        }

        var chains = new List<List<string>>();
        var budget = 2000; // bound DFS work on dense subgraphs

        void Dfs(string id, List<string> path, HashSet<string> seen)
        {
            if (budget-- <= 0)
            {
                return;
            }

            var next = (adj.TryGetValue(id, out var neighbors) ? neighbors : (IReadOnlyList<string>)Array.Empty<string>())
                .Where(t => !seen.Contains(t))
                .ToList();
            if (next.Count == 0 || path.Count >= MaxHops)
            {
                if (path.Count >= 3)
                {
                    chains.Add(new List<string>(path)); // ≥3 nodes = a real flow, not one call
                }

                return;
            }

            foreach (var t in next)
            {
                seen.Add(t);
                var nextPath = new List<string>(path) { t };
                Dfs(t, nextPath, seen);
                seen.Remove(t);
            }
        }

        var starts = (subgraph.Roots.Count > 0
                ? subgraph.Roots.Where(id => adj.ContainsKey(id))
                : adj.Keys)
            .Take(5)
            .ToList();
        foreach (var s in starts)
        {
            Dfs(s, new List<string> { s }, new HashSet<string>(StringComparer.Ordinal) { s });
        }

        if (chains.Count == 0)
        {
            return string.Empty;
        }

        // Keep only chains connecting ≥2 roots; rank by #roots then length; drop any that
        // is a sub-path of a longer kept chain.
        var rootSet = new HashSet<string>(subgraph.Roots, StringComparer.Ordinal);
        int RootCount(List<string> c) => c.Count(id => rootSet.Contains(id));

        var relevant = chains.Where(c => RootCount(c) >= 2)
            .OrderByDescending(RootCount)
            .ThenByDescending(c => c.Count)
            .ToList();
        var kept = new List<List<string>>();
        foreach (var c in relevant)
        {
            var key = string.Join(">", c);
            if (kept.Any(k => string.Join(">", k).Contains(key, StringComparison.Ordinal)))
            {
                continue;
            }

            kept.Add(c);
            if (kept.Count >= 3)
            {
                break;
            }
        }

        if (kept.Count == 0)
        {
            return string.Empty;
        }

        string Name(string id) => subgraph.Nodes.TryGetValue(id, out var n) ? n.Name : id;

        // Synthesized (dynamic-dispatch) hops are real `calls` edges invisible to static
        // parsing — label them inline (keyed "source>target").
        var synthByPair = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var e in subgraph.Edges)
        {
            if (e.Kind != CodeGraphEdgeKind.Calls || e.Provenance != CodeGraphProvenance.Heuristic)
            {
                continue;
            }

            var meta = SynthMetadata.Parse(e.Metadata);
            if (meta.SynthesizedBy is null)
            {
                continue;
            }

            var at = meta.RegisteredAt is not null ? $" @{meta.RegisteredAt}" : string.Empty;
            var label = meta.SynthesizedBy switch
            {
                "callback" => $"callback via {(!string.IsNullOrEmpty(meta.Via) ? $"`{meta.Via}`" : "registrar")}{at}",
                "react-render" => $"React re-render via setState{at}",
                "jsx-render" => $"renders <{(string.IsNullOrEmpty(meta.Via) ? "child" : meta.Via)}>",
                "vue-handler" => $"Vue @{(string.IsNullOrEmpty(meta.Event) ? "event" : meta.Event)} handler",
                _ => $"event {(!string.IsNullOrEmpty(meta.Event) ? $"`{meta.Event}`" : string.Empty)}{at}"
            };
            synthByPair[$"{e.Source}>{e.Target}"] = label;
        }

        string RenderChain(List<string> c)
        {
            var sb = new StringBuilder(Name(c[0]));
            for (var i = 1; i < c.Count; i++)
            {
                if (synthByPair.TryGetValue($"{c[i - 1]}>{c[i]}", out var synth))
                {
                    sb.Append($" →[{synth}] {Name(c[i])}");
                }
                else
                {
                    sb.Append($" → {Name(c[i])}");
                }
            }

            return sb.ToString();
        }

        var hasSynth = kept.Any(c =>
        {
            for (var i = 1; i < c.Count; i++)
            {
                if (synthByPair.ContainsKey($"{c[i - 1]}>{c[i]}"))
                {
                    return true;
                }
            }

            return false;
        });

        var lines = new List<string>
        {
            string.Empty,
            "## Call paths",
            string.Empty,
            "Execution flow among the key symbols (traced through the call graph):",
            string.Empty
        };
        lines.AddRange(kept.Select(c => $"- {RenderChain(c)}"));
        lines.Add(string.Empty);
        lines.Add(hasSynth
            ? "_Hops marked `[callback/event …]` are dynamic dispatch bridged by codegraph (with the registration site); the rest are direct calls. codegraph_node any symbol for its body._"
            : "_codegraph_node any symbol above for its source + its own callers/callees._");
        return "\n" + string.Join("\n", lines) + "\n";
    }

    // buildLowConfidenceNote (context/index.ts:285). Appended when retrieval confidence is
    // low: admits the uncertainty and routes the agent to explore/search + closest dirs.
    public static string BuildLowConfidenceNote(IReadOnlyList<CodeGraphNodeView> entryPoints)
    {
        var dirs = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var n in entryPoints)
        {
            var slash = n.FilePath.LastIndexOf('/');
            var dir = slash > 0 ? n.FilePath.Substring(0, slash) : n.FilePath;
            if (seen.Add(dir))
            {
                dirs.Add(dir);
            }

            if (dirs.Count >= 4)
            {
                break;
            }
        }

        var dirLine = dirs.Count > 0
            ? "\n- `codegraph_files` a likely area: " + string.Join(", ", dirs.Select(d => $"`{d}`"))
            : string.Empty;

        return "\n\n" + LowConfidenceMarker + "\n\n"
            + "This query matched mostly on common words, so the entry points above may "
            + "be off-target — treat them as a starting point, not a complete answer. "
            + "For a reliable result:\n"
            + "- `codegraph_explore` with the **exact symbol names** you are after "
            + "(class / function / method names), or\n"
            + "- `codegraph_search <name>` for one specific symbol"
            + dirLine
            + "\n\nDo not assume the list above is comprehensive.";
    }

    // Reflection-free projection of an edge's metadata JSON — only the four fields the
    // synthesized-hop labels read. A non-object / malformed / absent metadata → all null.
    private readonly struct SynthMetadata
    {
        private SynthMetadata(string? synthesizedBy, string? registeredAt, string? via, string? evt)
        {
            SynthesizedBy = synthesizedBy;
            RegisteredAt = registeredAt;
            Via = via;
            Event = evt;
        }

        public string? SynthesizedBy { get; }

        public string? RegisteredAt { get; }

        public string? Via { get; }

        public string? Event { get; }

        public static SynthMetadata Parse(string? json)
        {
            if (string.IsNullOrEmpty(json))
            {
                return default;
            }

            try
            {
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.ValueKind != JsonValueKind.Object)
                {
                    return default;
                }

                return new SynthMetadata(
                    StringProp(doc.RootElement, "synthesizedBy"),
                    StringProp(doc.RootElement, "registeredAt"),
                    StringProp(doc.RootElement, "via"),
                    StringProp(doc.RootElement, "event"));
            }
            catch (JsonException)
            {
                return default;
            }
        }

        private static string? StringProp(JsonElement obj, string name) =>
            obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
                ? value.GetString()
                : null;
    }
}
