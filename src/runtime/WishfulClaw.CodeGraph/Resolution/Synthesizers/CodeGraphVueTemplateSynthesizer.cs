using System.Text;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphVueTemplateSynthesizer — vueTemplateEdges (callback-synthesizer.ts:1257).
// Phase.Main, gated to Vue. A Vue SFC's `<template>` mounts child components and binds
// event handlers, but neither is a static call edge, so the SFC component node
// dead-ends at the template hop. Bridge it per SFC:
//   • parent -> child component render edges (`<el-button>` / `<MediaCard/>`), incl.
//     Nuxt directory-prefixed auto-import names (`components/media/Card.vue` used as
//     `<MediaCard/>`);
//   • parent -> template event handler (`@click="fn"` / `v-on:click="fn"`), resolving a
//     handler that is a destructured composable return (`const { close: closeSidebar }
//     = useSidebarControl()`) to the composable's returned member.
//
// Component-render edges are `synthesizedBy:'jsx-render'`; handler edges
// `synthesizedBy:'vue-handler'`. Both `calls` / `heuristic`, capped per SFC.
// =============================================================================
internal sealed class CodeGraphVueTemplateSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredVue = { CodeGraphLanguage.Vue };

    // <template>…</template> / <script>…</script> extraction (ts:1282/1290).
    private static readonly Regex TemplateRe =
        new(@"<template[^>]*>([\s\S]*)</template>", RegexOptions.ECMAScript | RegexOptions.IgnoreCase);

    private static readonly Regex ScriptRe =
        new(@"<script[^>]*>([\s\S]*?)</script>", RegexOptions.ECMAScript | RegexOptions.IgnoreCase);

    // VUE_KEBAB_RE (ts:47) — kebab-case child components (<el-button> → ElButton).
    private static readonly Regex VueKebabRe =
        new(@"<([a-z][a-z0-9]*(?:-[a-z0-9]+)+)[\s/>]", RegexOptions.ECMAScript);

    // VUE_PASCAL_RE (ts:51) — PascalCase component tags (<MediaCard/>).
    private static readonly Regex VuePascalRe = new(@"<([A-Z][A-Za-z0-9]*)[\s/>]", RegexOptions.ECMAScript);

    // VUE_HANDLER_RE (ts:52) — `@click="fn"` / `v-on:click="fn"`.
    private static readonly Regex VueHandlerRe =
        new("(?:@|v-on:)([a-zA-Z][\\w-]*)(?:\\.[\\w]+)*\\s*=\\s*\"([^\"]+)\"", RegexOptions.ECMAScript);

    // VUE_DESTRUCTURE_RE (ts:55) — `const { close: closeSidebar } = useSidebarControl()`.
    private static readonly Regex VueDestructureRe =
        new(@"(?:const|let|var)\s*\{([^}]+)\}\s*=\s*(\w+)\s*\(", RegexOptions.ECMAScript);

    // A destructure part: `key` | `key: alias` (ts:1297).
    private static readonly Regex DestructurePartRe = new(@"^(\w+)\s*(?::\s*(\w+))?$", RegexOptions.ECMAScript);

    // Composables / hooks only (ts:1295).
    private static readonly Regex UseHookRe = new(@"^use[A-Z]", RegexOptions.ECMAScript);

    // Leading identifier of a handler expression (ts:1337).
    private static readonly Regex ExprNameRe = new(@"^([A-Za-z_]\w*)", RegexOptions.ECMAScript);

    // nuxtComponentName filename-extension strip (ts:95).
    private static readonly Regex NuxtExtRe =
        new(@"\.(vue|ts|tsx|js|jsx)$", RegexOptions.ECMAScript | RegexOptions.IgnoreCase);

    // COMPONENT_KINDS / HANDLER_KINDS / RETURN_KINDS (ts:1262-1266).
    private static readonly HashSet<string> ComponentKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Component, CodeGraphNodeKind.Function, CodeGraphNodeKind.Class
    };

    private static readonly HashSet<string> HandlerKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Method, CodeGraphNodeKind.Function
    };

    private static readonly HashSet<string> ReturnKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Method, CodeGraphNodeKind.Function, CodeGraphNodeKind.Variable, CodeGraphNodeKind.Constant
    };

    public string Name => "vue-template";

    public IReadOnlyList<string> RequiredLanguages => RequiredVue;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var scanned = 0;

        // Nuxt auto-imported nested components by their DIRECTORY-PREFIXED name
        // (components/media/Card.vue → <MediaCard/>), which a basename match misses.
        var nuxtComponents = new Dictionary<string, CodeGraphNode>(StringComparer.Ordinal);
        foreach (var c in ctx.IterateNodesByKind(CodeGraphNodeKind.Component))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            var nn = NuxtComponentName(c.FilePath);
            if (nn is not null && !nuxtComponents.ContainsKey(nn))
            {
                nuxtComponents[nn] = c;
            }
        }

        var scannedFiles = 0;
        foreach (var file in ctx.GetAllFiles())
        {
            if ((++scannedFiles & 15) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (!file.EndsWith(".vue", StringComparison.Ordinal))
            {
                continue;
            }

            var content = ctx.ReadFile(file);
            if (string.IsNullOrEmpty(content))
            {
                continue;
            }

            var tplMatch = TemplateRe.Match(content);
            if (!tplMatch.Success)
            {
                continue;
            }

            var tpl = tplMatch.Groups[1].Value;
            if (tpl.Length == 0)
            {
                continue;
            }

            CodeGraphNode? found = null;
            foreach (var n in ctx.GetNodesInFile(file))
            {
                if (n.Kind == CodeGraphNodeKind.Component)
                {
                    found = n;
                    break;
                }
            }

            if (found is null)
            {
                continue;
            }

            CodeGraphNode comp = found;

            // Composable-destructure map: alias → (composable, key).
            var scriptMatch = ScriptRe.Match(content);
            var script = scriptMatch.Success ? scriptMatch.Groups[1].Value : string.Empty;
            var destructured = new Dictionary<string, (string Composable, string Key)>(StringComparer.Ordinal);
            foreach (Match dm in VueDestructureRe.Matches(script))
            {
                var composableName = dm.Groups[2].Value;
                if (!UseHookRe.IsMatch(composableName))
                {
                    continue; // composables / hooks only
                }

                foreach (var part in dm.Groups[1].Value.Split(','))
                {
                    var pm = DestructurePartRe.Match(part.Trim());
                    if (!pm.Success)
                    {
                        continue;
                    }

                    var pkey = pm.Groups[1].Value;
                    var alias = pm.Groups[2].Success && pm.Groups[2].Value.Length > 0 ? pm.Groups[2].Value : pkey;
                    destructured[alias] = (composableName, pkey);
                }
            }

            var added = 0;

            void AddEdge(CodeGraphNode? target, string synthesizedBy, string metadata)
            {
                if (added >= CodeGraphSynthesizerSupport.MaxJsxChildren || target is null || target.Id == comp.Id)
                {
                    return;
                }

                var k = comp.Id + ">" + target.Id + ">" + synthesizedBy;
                if (!seen.Add(k))
                {
                    return;
                }

                edges.Add(new CodeGraphEdge(
                    comp.Id,
                    target.Id,
                    CodeGraphEdgeKind.Calls,
                    metadata,
                    comp.StartLine,
                    Column: null,
                    CodeGraphProvenance.Heuristic));
                added++;
            }

            // Prefer a target in THIS SFC (handlers live in the same file's script).
            CodeGraphNode? Resolve(string name, HashSet<string> kinds)
            {
                CodeGraphNode? first = null;
                foreach (var n in ctx.GetNodesByName(name))
                {
                    if (!kinds.Contains(n.Kind))
                    {
                        continue;
                    }

                    if (first is null)
                    {
                        first = n;
                    }

                    if (n.FilePath == file)
                    {
                        return n;
                    }
                }

                return first;
            }

            foreach (Match km in VueKebabRe.Matches(tpl))
            {
                var raw = km.Groups[1].Value;
                var tag = KebabToPascal(raw);
                var target = Resolve(tag, ComponentKinds);
                if (target is null)
                {
                    nuxtComponents.TryGetValue(tag, out target);
                }

                AddEdge(target, "jsx-render", CodeGraphSynthesizerSupport.Metadata(
                    ("synthesizedBy", "jsx-render"), ("via", raw)));
            }

            // PascalCase component tags: direct name match, then the Nuxt dir-prefixed
            // auto-import name. Built-ins match neither → no edge.
            foreach (Match pm in VuePascalRe.Matches(tpl))
            {
                var tag = pm.Groups[1].Value;
                var target = Resolve(tag, ComponentKinds);
                if (target is null)
                {
                    nuxtComponents.TryGetValue(tag, out target);
                }

                AddEdge(target, "jsx-render", CodeGraphSynthesizerSupport.Metadata(
                    ("synthesizedBy", "jsx-render"), ("via", tag)));
            }

            foreach (Match hm in VueHandlerRe.Matches(tpl))
            {
                var evt = hm.Groups[1].Value;
                var expr = hm.Groups[2].Value.Trim();
                if (expr.Contains("=>", StringComparison.Ordinal) || expr.StartsWith("$", StringComparison.Ordinal))
                {
                    continue; // inline arrow / $emit
                }

                var nameM = ExprNameRe.Match(expr);
                if (!nameM.Success)
                {
                    continue;
                }

                var name = nameM.Groups[1].Value;
                var direct = Resolve(name, HandlerKinds);
                if (direct is not null)
                {
                    AddEdge(direct, "vue-handler", CodeGraphSynthesizerSupport.Metadata(
                        ("synthesizedBy", "vue-handler"), ("event", evt)));
                    continue;
                }

                // Composable-destructure handler → the composable's returned member.
                if (!destructured.TryGetValue(name, out var d))
                {
                    continue;
                }

                var composable = Resolve(d.Composable, HandlerKinds);
                if (composable is null)
                {
                    continue;
                }

                CodeGraphNode? keyFn = null;
                foreach (var kn in ctx.GetNodesByName(d.Key))
                {
                    if (ReturnKinds.Contains(kn.Kind) && kn.FilePath == composable.FilePath)
                    {
                        keyFn = kn;
                        break;
                    }
                }

                if (keyFn is not null)
                {
                    AddEdge(keyFn, "vue-handler", CodeGraphSynthesizerSupport.Metadata(
                        ("synthesizedBy", "vue-handler"), ("event", evt), ("via", d.Composable)));
                }
            }
        }

        return edges;
    }

    // kebab-case → PascalCase (ts:79). Empty segments contribute nothing (JS
    // ''.charAt(0).toUpperCase() + ''.slice(1) === '').
    private static string KebabToPascal(string s)
    {
        var sb = new StringBuilder();
        foreach (var p in s.Split('-'))
        {
            if (p.Length == 0)
            {
                continue;
            }

            sb.Append(char.ToUpperInvariant(p[0]));
            sb.Append(p, 1, p.Length - 1);
        }

        return sb.ToString();
    }

    // Nuxt auto-import name for a component from its path UNDER components/ (ts:92):
    // components/media/Card.vue → MediaCard; base/BaseButton.vue → BaseButton (dedup a
    // segment that prefixes the next). Null for a flat component (matched by basename).
    private static string? NuxtComponentName(string filePath)
    {
        var marker = filePath.LastIndexOf("components/", StringComparison.Ordinal);
        if (marker == -1)
        {
            return null;
        }

        var rel = NuxtExtRe.Replace(filePath.Substring(marker + "components/".Length), string.Empty);
        var segs = new List<string>();
        foreach (var seg in rel.Split('/'))
        {
            if (seg.Length == 0)
            {
                continue; // filter(Boolean)
            }

            segs.Add(KebabToPascal(seg));
        }

        if (segs.Count < 2)
        {
            return null;
        }

        var outList = new List<string>();
        foreach (var s in segs)
        {
            var prev = outList.Count > 0 ? outList[outList.Count - 1] : null;
            if (!string.IsNullOrEmpty(prev) && s.StartsWith(prev, StringComparison.Ordinal))
            {
                outList[outList.Count - 1] = s;
            }
            else
            {
                outList.Add(s);
            }
        }

        return string.Concat(outList);
    }
}
