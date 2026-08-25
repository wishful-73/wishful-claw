using System.Diagnostics;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphMyBatisExtractor — bespoke (regex-only, no tree-sitter) extractor for
// MyBatis / iBatis mapper XML (port of extraction/mybatis-extractor.ts; analysis/01
// §7 embedded extractors, analysis/02 §3.3).
//
// MyBatis splits a DAO across two files: a Java interface (tree-sitter) declares the
// method, and an XML mapper holds the SQL keyed by `<namespace>` (the FQ Java type)
// and `id` (the method name). This extractor emits one method-shaped node per
// `<select|insert|update|delete>` and per `<sql>` fragment, qualified as
// `<namespace>::<id>` so the MyBatis framework synthesizer can suffix-match the Java
// method to the XML statement. `<include refid="...">` yields an unresolved
// reference to the SQL fragment (`<namespace>::<refid>`).
//
// Both dialects: MyBatis 3 `<mapper namespace>` and legacy iBatis 2 `<sqlMap>`
// (namespaced or namespace-less `Map.stmt` ids, plus `<statement>`/`<procedure>`).
// Non-mapper XML (pom.xml, Spring beans, web.xml, …) yields just a file node so the
// watcher can track it without emitting symbols.
//
// GLOBAL namespace, all-internal, reflection-free/AOT; [GeneratedRegex] fixed
// patterns (the per-dialect verb set is two fixed alternations, not a built regex).
// =============================================================================
internal sealed partial class CodeGraphMyBatisExtractor
{
    private readonly string filePath;
    private readonly string source;
    private readonly List<CodeGraphNode> nodes = new();
    private readonly List<CodeGraphEdge> edges = new();
    private readonly List<CodeGraphUnresolvedReference> unresolvedReferences = new();
    private readonly List<CodeGraphExtractionError> errors = new();
    private readonly List<int> lineStarts = new();

    private CodeGraphMyBatisExtractor(string filePath, string content)
    {
        this.filePath = filePath;
        // Blank out XML comments up front so commented-out statements/includes aren't
        // matched (a `<!-- <select id="old">…</select> -->` block must not produce a
        // phantom node). Length-preserving — comment bytes become spaces, newlines are
        // kept — so offsets/line numbers computed afterwards still map to the original.
        // Text inside `<![CDATA[ … ]]>` is left intact (a literal `<!--` there is SQL).
        this.source = StripXmlComments(content);
        ComputeLineStarts();
    }

    // Static entry point (parity with the TS `new MyBatisExtractor(...).extract()`).
    public static CodeGraphExtractionResult ExtractFromSource(string filePath, string content) =>
        new CodeGraphMyBatisExtractor(filePath, content).Extract();

    private CodeGraphExtractionResult Extract()
    {
        Stopwatch sw = Stopwatch.StartNew();

        CodeGraphNode fileNode = CreateFileNode();

        try
        {
            MapperRoot? root = FindMapperRoot();
            if (root is { } r)
            {
                ExtractMapper(fileNode.Id, r.Namespace, r.Dialect, r.BodyStart, r.BodyEnd);
            }
        }
        catch (Exception ex)
        {
            errors.Add(new CodeGraphExtractionError(
                $"MyBatis extraction error: {ex.Message}", "error", filePath, null, null, "parse_error"));
        }

        return new CodeGraphExtractionResult(nodes, edges, unresolvedReferences, errors, sw.Elapsed.TotalMilliseconds);
    }

    private CodeGraphNode CreateFileNode()
    {
        string[] lines = source.Split('\n');
        int endColumn = lines.Length > 0 ? lines[^1].Length : 0;
        string id = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.File, filePath, 1);
        CodeGraphNode node = FileNode(id, endColumn, Math.Max(1, lines.Length));
        nodes.Add(node);
        return node;
    }

    // MyBatis 3 `<mapper namespace="com.foo.Bar">` (namespace required) OR iBatis 2
    // `<sqlMap namespace="Account">` / a namespace-less `<sqlMap>` (statement ids carry
    // the qualifier as `Map.statement`). Either quote style is accepted. Body offsets
    // scope statement extraction to the root's contents.
    private MapperRoot? FindMapperRoot()
    {
        Match mapper = MapperTagRegex().Match(source);
        if (mapper.Success)
        {
            Match ns = NamespaceAttrRegex().Match(mapper.Groups[1].Value);
            if (ns.Success)
            {
                int bodyStart = mapper.Index + mapper.Length;
                int closeIdx = source.IndexOf("</mapper>", bodyStart, StringComparison.Ordinal);
                return new MapperRoot(ns.Groups[2].Value, "mybatis", bodyStart, closeIdx >= 0 ? closeIdx : source.Length);
            }
        }

        // iBatis 2 SqlMap. `\b` keeps `<sqlMapConfig>` (the config root, no statements)
        // from matching. namespace is optional.
        Match sqlMap = SqlMapTagRegex().Match(source);
        if (sqlMap.Success)
        {
            Match ns = NamespaceAttrRegex().Match(sqlMap.Groups[1].Value);
            int bodyStart = sqlMap.Index + sqlMap.Length;
            int closeIdx = source.IndexOf("</sqlMap>", bodyStart, StringComparison.Ordinal);
            return new MapperRoot(ns.Success ? ns.Groups[2].Value : string.Empty, "ibatis", bodyStart, closeIdx >= 0 ? closeIdx : source.Length);
        }

        return null;
    }

    private void ExtractMapper(string fileNodeId, string @namespace, string dialect, int bodyStart, int bodyEnd)
    {
        string body = source.Substring(bodyStart, bodyEnd - bodyStart);

        // iBatis 2 adds `<statement>`/`<procedure>` on top of the MyBatis 3 verbs;
        // gating by dialect keeps MyBatis extraction unchanged.
        Regex stmtRegex = dialect == "ibatis" ? IBatisStmtRegex() : MyBatisStmtRegex();
        long now = Now();

        foreach (Match m in stmtRegex.Matches(body))
        {
            string elemType = m.Groups[1].Value;
            string attrs = m.Groups[2].Value;
            string elemBody = m.Groups[3].Value;

            // Accept either quote style. The MyBatis identifier attributes matched here
            // (namespace/id/refid/resultType/parameterType) are Java FQNs / method names
            // / type aliases and never contain a quote, so excluding both quotes is safe.
            Match idMatch = IdAttrRegex().Match(attrs);
            if (!idMatch.Success)
            {
                continue;
            }

            string id = idMatch.Groups[2].Value;
            int absoluteIndex = bodyStart + m.Index;
            int startLine = GetLineNumber(absoluteIndex);
            int endLine = GetLineNumber(absoluteIndex + m.Length);
            (string qualified, string name) = QualifyStatement(@namespace, id);
            bool isSqlFragment = elemType == "sql";

            // The id-hash folds in the statement's byte offset (unique per statement in
            // the file), not just the start line: two statements sharing a qualifiedName
            // AND a start line (a vendor-split `databaseId` pair on one line) would else
            // hash to the same id and `INSERT OR REPLACE INTO nodes` would drop one.
            string nodeId = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Method, qualified, absoluteIndex);
            CodeGraphNode node = StatementNode(
                nodeId, name, qualified, BuildSignature(elemType, attrs, isSqlFragment), PreviewSql(elemBody), startLine, endLine, now);
            nodes.Add(node);
            edges.Add(new CodeGraphEdge(fileNodeId, nodeId, CodeGraphEdgeKind.Contains, null, null, null, null));

            // <include refid="X"/> → reference to the SQL fragment in this mapper (or in
            // another mapper when the refid is qualified — `ns.X`).
            int openingTagLen = m.Length - elemBody.Length - ("</" + elemType + ">").Length;
            foreach (Match inc in IncludeRefidRegex().Matches(elemBody))
            {
                string refid = inc.Groups[2].Value;
                string refQualified = refid.Contains('.', StringComparison.Ordinal)
                    ? refid.Replace(".", "::", StringComparison.Ordinal)
                    : @namespace.Length > 0
                        ? $"{@namespace}::{refid}"
                        : refid;
                int includeOffset = absoluteIndex + openingTagLen + inc.Index;
                int line = GetLineNumber(includeOffset);
                unresolvedReferences.Add(new CodeGraphUnresolvedReference(
                    nodeId, refQualified, CodeGraphEdgeKind.References, line, 0, null, null, null, null));
            }
        }
    }

    private static string BuildSignature(string elemType, string attrs, bool isSqlFragment)
    {
        if (isSqlFragment)
        {
            return "<sql>";
        }

        string verb = elemType.ToUpperInvariant();
        string? result = MatchAttr(ResultTypeAttrRegex(), attrs);
        string? param = MatchAttr(ParameterTypeAttrRegex(), attrs);
        // A vendor-split statement carries `databaseId`; surface it so the two otherwise-
        // identical `<namespace>::<id>` nodes are distinguishable.
        string? dbId = MatchAttr(DatabaseIdAttrRegex(), attrs);
        var parts = new List<string> { verb };
        if (param is not null)
        {
            parts.Add($"param={param}");
        }

        if (result is not null)
        {
            parts.Add($"result={result}");
        }

        if (dbId is not null)
        {
            parts.Add($"databaseId={dbId}");
        }

        return string.Join(' ', parts);
    }

    private static string? MatchAttr(Regex regex, string attrs)
    {
        Match m = regex.Match(attrs);
        return m.Success ? m.Groups[2].Value : null;
    }

    // `<namespace>::<id>` (the shape the synthesizer suffix-matches against a Java
    // `<Class>::<method>`) plus the display name. A namespace-less iBatis `<sqlMap>`
    // carries the qualifier as `Map.statement`, so split on the last dot.
    private static (string QualifiedName, string Name) QualifyStatement(string @namespace, string id)
    {
        if (@namespace.Length > 0)
        {
            return ($"{@namespace}::{id}", id);
        }

        int dot = id.LastIndexOf('.');
        if (dot >= 0)
        {
            return ($"{id[..dot]}::{id[(dot + 1)..]}", id[(dot + 1)..]);
        }

        return (id, id);
    }

    private static string PreviewSql(string body)
    {
        string stripped = TagRegex().Replace(body, " ");
        string collapsed = WhitespaceRegex().Replace(stripped, " ").Trim();
        return collapsed.Length > 200 ? collapsed[..200] : collapsed;
    }

    // Length-preserving XML comment blanking (comment chars → spaces, newlines kept),
    // skipping CDATA so a literal `<!--` inside `<![CDATA[ … ]]>` stays SQL data.
    private static string StripXmlComments(string src)
    {
        char[] outChars = src.ToCharArray();
        int n = src.Length;
        int i = 0;
        while (i < n)
        {
            if (src.AsSpan(i).StartsWith("<![CDATA[", StringComparison.Ordinal))
            {
                int from = Math.Min(i + 9, n);
                int end = src.IndexOf("]]>", from, StringComparison.Ordinal);
                i = end >= 0 ? end + 3 : n;
                continue;
            }

            if (src.AsSpan(i).StartsWith("<!--", StringComparison.Ordinal))
            {
                int from = Math.Min(i + 4, n);
                int end = src.IndexOf("-->", from, StringComparison.Ordinal);
                int stop = end >= 0 ? end + 3 : n;
                for (int j = i; j < stop; j++)
                {
                    if (src[j] != '\n')
                    {
                        outChars[j] = ' ';
                    }
                }

                i = stop;
                continue;
            }

            i++;
        }

        return new string(outChars);
    }

    private void ComputeLineStarts()
    {
        lineStarts.Add(0);
        for (int i = 0; i < source.Length; i++)
        {
            if (source[i] == '\n')
            {
                lineStarts.Add(i + 1);
            }
        }
    }

    // 1-based line of a byte offset via binary search over the line-start table.
    private int GetLineNumber(int offset)
    {
        int lo = 0;
        int hi = lineStarts.Count - 1;
        while (lo < hi)
        {
            int mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= offset)
            {
                lo = mid;
            }
            else
            {
                hi = mid - 1;
            }
        }

        return lo + 1;
    }

    private CodeGraphNode FileNode(string id, int endColumn, int endLine) =>
        new(id, CodeGraphNodeKind.File, FileName(filePath), filePath, filePath, CodeGraphLanguage.Xml,
            1, endLine, 0, endColumn, null, null, null, false, false, false, false, null, null, null, Now());

    private CodeGraphNode StatementNode(
        string id, string name, string qualifiedName, string signature, string docstring, int startLine, int endLine, long now) =>
        new(id, CodeGraphNodeKind.Method, name, qualifiedName, filePath, CodeGraphLanguage.Xml,
            startLine, endLine, 0, 0, docstring, signature, null, false, false, false, false, null, null, null, now);

    private static string FileName(string path)
    {
        int slash = path.LastIndexOf('/');
        return slash >= 0 && slash + 1 < path.Length ? path[(slash + 1)..] : path;
    }

    private static long Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private readonly record struct MapperRoot(string Namespace, string Dialect, int BodyStart, int BodyEnd);

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from mybatis-extractor.ts ──────

    [GeneratedRegex(@"<mapper\b([^>]*)>")]
    private static partial Regex MapperTagRegex();

    [GeneratedRegex(@"<sqlMap\b([^>]*)>")]
    private static partial Regex SqlMapTagRegex();

    [GeneratedRegex(@"\bnamespace\s*=\s*([""'])([^""']+)\1")]
    private static partial Regex NamespaceAttrRegex();

    [GeneratedRegex(@"\bid\s*=\s*([""'])([^""']+)\1")]
    private static partial Regex IdAttrRegex();

    [GeneratedRegex(@"<include\b[^>]*\brefid\s*=\s*([""'])([^""']+)\1")]
    private static partial Regex IncludeRefidRegex();

    [GeneratedRegex(@"\bresultType\s*=\s*([""'])([^""']+)\1")]
    private static partial Regex ResultTypeAttrRegex();

    [GeneratedRegex(@"\bparameterType\s*=\s*([""'])([^""']+)\1")]
    private static partial Regex ParameterTypeAttrRegex();

    [GeneratedRegex(@"\bdatabaseId\s*=\s*([""'])([^""']+)\1")]
    private static partial Regex DatabaseIdAttrRegex();

    [GeneratedRegex(@"<(select|insert|update|delete|sql)\b([^>]*)>([\s\S]*?)</\1>")]
    private static partial Regex MyBatisStmtRegex();

    [GeneratedRegex(@"<(select|insert|update|delete|sql|statement|procedure)\b([^>]*)>([\s\S]*?)</\1>")]
    private static partial Regex IBatisStmtRegex();

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex TagRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
