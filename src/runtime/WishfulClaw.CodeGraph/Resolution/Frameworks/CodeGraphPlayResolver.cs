using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphPlayResolver — Play Framework (Scala/Java) resolver (port of
// resolution/frameworks/play.ts; analysis/02 §3.3). Play declares HTTP routes in a
// dedicated `conf/routes` file (and included `conf/*.routes`), Rails-style:
//
//   GET   /computers        controllers.Application.list(p: Int ?= 0)
//   POST  /computers        controllers.Application.save
//
// The file is extensionless, so the walk only indexes it because IsPlayRoutesFile
// opts it in; it flows through the no-grammar path and this resolver's Extract()
// emits the routes. Each route references its handler as `Controller.method` (the
// package prefix is dropped), resolved to the action method in the controller class.
//
// Named CodeGraphPlayResolver (Name = "play"). GLOBAL namespace, all-internal,
// reflection-free/AOT; [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphPlayResolver : ICodeGraphFrameworkResolver
{
    // `yaml` so this resolver runs on conf/routes (detectLanguage maps it to yaml);
    // `scala`/`java` so it's active in Play projects of either language.
    private static readonly string[] PlayLanguages = { CodeGraphLanguage.Scala, CodeGraphLanguage.Java, CodeGraphLanguage.Yaml };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    public string Name => "play";

    public IReadOnlyList<string>? Languages => PlayLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        string? buildSbt = ctx.ReadFile("build.sbt");
        if (buildSbt is not null && BuildSbtRegex().IsMatch(buildSbt))
        {
            return true;
        }

        return ctx.FileExists("conf/routes") || ctx.FileExists("conf/application.conf");
    }

    // The handler is `Controller.method` (a class-qualified action), which names no
    // bare declared symbol, so the resolveOne pre-filter could drop it — claim it.
    public bool ClaimsReference(string name) => HandlerRefRegex().IsMatch(name);

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        Match m = HandlerRefCaptureRegex().Match(r.ReferenceName);
        if (!m.Success)
        {
            return null;
        }

        string className = m.Groups[1].Value;
        string methodName = m.Groups[2].Value;

        foreach (CodeGraphNode cls in ctx.GetNodesByName(className))
        {
            if (cls.Kind != CodeGraphNodeKind.Class)
            {
                continue;
            }

            foreach (CodeGraphNode n in ctx.GetNodesInFile(cls.FilePath))
            {
                if ((n.Kind == CodeGraphNodeKind.Method || n.Kind == CodeGraphNodeKind.Function) && n.Name == methodName)
                {
                    return new CodeGraphResolvedRef(n.Id, 0.9, CodeGraphResolvedBy.Framework);
                }
            }
        }

        return null;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!CodeGraphLanguageMap.IsPlayRoutesFile(filePath))
        {
            return EmptyExtraction;
        }

        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        long now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

        string[] lines = content.Split('\n');
        for (int i = 0; i < lines.Length; i++)
        {
            string line = lines[i].Trim();
            // Skip comments and `->` route includes (a sub-router mount, not an action).
            if (line.Length == 0 || line.StartsWith('#') || line.StartsWith("->", StringComparison.Ordinal))
            {
                continue;
            }

            Match m = RouteLineRegex().Match(line);
            if (!m.Success)
            {
                continue;
            }

            string method = m.Groups[1].Value;
            string routePath = m.Groups[2].Value;
            string action = m.Groups[3].Value;

            // action: `controllers.Application.list(p: Int ?= 0)` → drop args, keep the
            // last `Controller.method` segment (the package prefix is irrelevant).
            string fqn = SplitFirst(action, '(').Trim();
            string[] parts = fqn.Split('.', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2)
            {
                continue;
            }

            string handlerRef = $"{parts[^2]}.{parts[^1]}"; // Application.list

            int lineNum = i + 1;
            CodeGraphNode routeNode = RouteNode(
                $"route:{filePath}:{lineNum}:{method}:{routePath}",
                $"{method} {routePath}",
                $"{filePath}::{method}:{routePath}",
                filePath,
                lineNum,
                now);
            nodes.Add(routeNode);
            references.Add(new CodeGraphUnresolvedReference(
                routeNode.Id, handlerRef, CodeGraphEdgeKind.References, lineNum, 0, filePath, CodeGraphLanguage.Scala, null, null));
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // Substring up to (excluding) the first occurrence of `sep`, or the whole string.
    private static string SplitFirst(string s, char sep)
    {
        int idx = s.IndexOf(sep);
        return idx >= 0 ? s[..idx] : s;
    }

    private static CodeGraphNode RouteNode(string id, string name, string qualifiedName, string filePath, int line, long now) =>
        new(id, CodeGraphNodeKind.Route, name, qualifiedName, filePath, CodeGraphLanguage.Scala, line, line, 0, 0,
            null, null, null, false, false, false, false, null, null, null, now);

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from play.ts ───────────────────

    [GeneratedRegex(@"playframework|""play""|sbt-plugin|PlayScala|PlayJava", RegexOptions.IgnoreCase)]
    private static partial Regex BuildSbtRegex();

    [GeneratedRegex(@"^[A-Za-z_]\w*\.[A-Za-z_]\w*$")]
    private static partial Regex HandlerRefRegex();

    [GeneratedRegex(@"^([A-Za-z_]\w*)\.([A-Za-z_]\w*)$")]
    private static partial Regex HandlerRefCaptureRegex();

    [GeneratedRegex(@"^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(\S+)\s+(.+)$")]
    private static partial Regex RouteLineRegex();
}
