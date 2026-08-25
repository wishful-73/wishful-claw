// =============================================================================
// CodeGraphMyBatisJavaXmlSynthesizer — mybatisJavaXmlEdges (callback-synthesizer.ts:
// 1782). Phase.Main, gated to Java+XML. MyBatis maps a Java mapper-interface method to
// a `<select>` / `<insert>` / … statement in an XML mapper by `<namespace>::<id>`; the
// SQL runs via a runtime proxy, so the interface method has no static edge to the XML
// statement it executes. The MyBatis XML extractor emits each statement as an `xml`
// `method` node whose qualifiedName is `<namespace>::<id>`; this pass indexes the Java
// (or Kotlin) mapper methods by `<SimpleClassName>::<methodName>` and links each Java
// method -> its XML statement.
//
// Ambiguous matches (several same-simple-name classes) are dropped — silent beats wrong.
// Edge is `calls` / `heuristic` / `synthesizedBy:'mybatis-java-xml'`.
// =============================================================================
internal sealed class CodeGraphMyBatisJavaXmlSynthesizer : ICodeGraphEdgeSynthesizer
{
    private static readonly string[] RequiredJavaXml = { CodeGraphLanguage.Java, CodeGraphLanguage.Xml };

    private static readonly string[] QnSeparator = { "::" };

    public string Name => "mybatis-java-xml";

    public IReadOnlyList<string> RequiredLanguages => RequiredJavaXml;

    public CodeGraphSynthPhase Phase => CodeGraphSynthPhase.Main;

    public IEnumerable<CodeGraphEdge> Synthesize(CodeGraphResolutionContext ctx, CancellationToken ct)
    {
        var edges = new List<CodeGraphEdge>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var scanned = 0;

        // Index Java/Kotlin methods by `<ClassName>::<methodName>` for O(1) lookup.
        var javaIndex = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        foreach (var m in ctx.IterateNodesByKind(CodeGraphNodeKind.Method))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (m.Language != CodeGraphLanguage.Java && m.Language != CodeGraphLanguage.Kotlin)
            {
                continue;
            }

            var parts = m.QualifiedName.Split(QnSeparator, StringSplitOptions.None);
            var last = parts[parts.Length - 1];
            var cls = parts.Length >= 2 ? parts[parts.Length - 2] : null;
            if (string.IsNullOrEmpty(last) || string.IsNullOrEmpty(cls))
            {
                continue;
            }

            var indexKey = cls + "::" + last;
            if (!javaIndex.TryGetValue(indexKey, out var arr))
            {
                arr = new List<CodeGraphNode>();
                javaIndex[indexKey] = arr;
            }

            arr.Add(m);
        }

        foreach (var xml in ctx.IterateNodesByKind(CodeGraphNodeKind.Method))
        {
            if ((++scanned & 63) == 0)
            {
                ct.ThrowIfCancellationRequested();
            }

            if (xml.Language != CodeGraphLanguage.Xml)
            {
                continue;
            }

            // Qualified name: `<namespace>::<id>`. Extract the simple class name.
            var colonIdx = xml.QualifiedName.LastIndexOf("::", StringComparison.Ordinal);
            if (colonIdx < 0)
            {
                continue;
            }

            var ns = xml.QualifiedName.Substring(0, colonIdx);
            var id = xml.QualifiedName.Substring(colonIdx + 2);
            if (ns.Length == 0 || id.Length == 0)
            {
                continue;
            }

            var dotIdx = ns.LastIndexOf('.');
            var className = dotIdx >= 0 ? ns.Substring(dotIdx + 1) : ns;
            if (!javaIndex.TryGetValue(className + "::" + id, out var candidates) || candidates.Count == 0)
            {
                continue;
            }

            // Drop ambiguous matches (multiple same-name classes).
            if (candidates.Count > 1)
            {
                continue;
            }

            var java = candidates[0];
            var key = java.Id + ">" + xml.Id;
            if (!seen.Add(key))
            {
                continue;
            }

            edges.Add(new CodeGraphEdge(
                java.Id,
                xml.Id,
                CodeGraphEdgeKind.Calls,
                CodeGraphSynthesizerSupport.Metadata(
                    ("synthesizedBy", "mybatis-java-xml"),
                    ("via", className + "." + id),
                    ("registeredAt", xml.FilePath + ":" + xml.StartLine)),
                java.StartLine,
                Column: null,
                CodeGraphProvenance.Heuristic));
        }

        return edges;
    }
}
