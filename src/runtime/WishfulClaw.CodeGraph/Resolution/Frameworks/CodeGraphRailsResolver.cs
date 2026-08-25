using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphRailsResolver — Ruby on Rails framework resolver (≙ frameworks/ruby.ts
// `railsResolver`). Two jobs:
//   * route -> controller#action edges: explicit `get '/p', to: 'c#a'` routes AND
//     RESTful `resources :articles` (expanded into the 7 REST actions) become `route`
//     nodes that `references` a precise `controller#action` (never a bare action, so
//     the every-controller-has-an-`index` ambiguity is avoided).
//   * convention lookups: Model (ActiveRecord), Controller, Helper, Service/Job refs
//     resolved by Rails file-path convention (CamelCase -> snake_case.rb).
//
// The pluralize/camelize tables are the naive ActiveSupport approximations ported
// verbatim from ruby.ts.
//
// Global namespace, internal, reflection-free, [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphRailsResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] RubyLanguages = { CodeGraphLanguage.Ruby };

    // RESTful action → (HTTP verb, path builder). `resources` gets all seven; a singular
    // `resource` omits `index` (ruby.ts:197-207).
    private static readonly string[] PluralActions = { "index", "create", "new", "show", "edit", "update", "destroy" };
    private static readonly string[] SingularActions = { "create", "new", "show", "edit", "update", "destroy" };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    public string Name => "rails";

    public IReadOnlyList<string>? Languages => RubyLanguages;

    // `controller#action` route refs name no declared symbol, so resolveOne's pre-filter
    // would drop them before resolve() runs. Claim them so they reach Pattern 0 (ruby.ts:18).
    public bool ClaimsReference(string name) => ControllerActionRegex().IsMatch(name);

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        // Gemfile with rails.
        var gemfile = ctx.ReadFile("Gemfile");
        if (gemfile is not null && gemfile.Contains("'rails'"))
        {
            return true;
        }

        // config/application.rb (Rails signature).
        if (ctx.FileExists("config/application.rb"))
        {
            return true;
        }

        // Typical Rails directory structure.
        return ctx.FileExists("app/controllers/application_controller.rb") || ctx.FileExists("config/routes.rb");
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        // Pattern 0: route action `controller#action` → the action method in that
        // controller. Precise — avoids the bare-`action` ambiguity.
        var ca = ControllerActionRegex().Match(name);
        if (ca.Success)
        {
            var id = ResolveControllerAction(ca.Groups[1].Value, ca.Groups[2].Value, ctx);
            return id is null ? null : new CodeGraphResolvedRef(id, 0.85, CodeGraphResolvedBy.Framework);
        }

        // Pattern 1: Model references (ActiveRecord), PascalCase bare name.
        if (PascalNameRegex().IsMatch(name))
        {
            var id = ResolveModel(name, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: Controller references.
        if (name.EndsWith("Controller", StringComparison.Ordinal))
        {
            var id = ResolveController(name, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 3: Helper references.
        if (name.EndsWith("Helper", StringComparison.Ordinal))
        {
            var id = ResolveHelper(name, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 4: Service / Job references.
        if (name.EndsWith("Service", StringComparison.Ordinal) || name.EndsWith("Job", StringComparison.Ordinal))
        {
            var id = ResolveService(name, ctx);
            if (id is not null)
            {
                return new CodeGraphResolvedRef(id, 0.8, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!filePath.EndsWith(".rb", StringComparison.Ordinal))
        {
            return EmptyExtraction;
        }

        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Ruby);

        // get/post/... '/path', to: 'controller#action'  (also `=> 'controller#action'`).
        foreach (Match match in RouteRegex().Matches(safe))
        {
            var routePath = match.Groups[2].Value;
            var ctrl = match.Groups[3].Value;
            var action = match.Groups[4].Value;
            var line = LineAt(safe, match.Index);
            var upper = match.Groups[1].Value.ToUpperInvariant();
            var routeNode = RouteNode($"route:{filePath}:{line}:{upper}:{routePath}", $"{upper} {routePath}",
                $"{filePath}::route:{routePath}", filePath, line, match.Length, now);
            nodes.Add(routeNode);
            references.Add(RouteRef(routeNode.Id, $"{ctrl}#{action}", line, filePath));
        }

        // RESTful `resources :articles` / `resource :user` — the dominant Rails routing.
        // Expand into one controller#action ref per REST verb.
        foreach (Match match in ResourcesRegex().Matches(safe))
        {
            var plural = match.Groups[1].Value == "resources";
            var resName = match.Groups[2].Value;
            var tail = match.Groups[3].Success ? match.Groups[3].Value : string.Empty;
            var actions = plural ? PluralActions : SingularActions;

            var only = OnlyRegex().Match(tail);
            var except = ExceptRegex().Match(tail);
            if (only.Success)
            {
                var set = SymbolSet(only.Groups[1].Value);
                actions = FilterActions(actions, set, keep: true);
            }
            else if (except.Success)
            {
                var set = SymbolSet(except.Groups[1].Value);
                actions = FilterActions(actions, set, keep: false);
            }

            // `resources :articles` → articles (ArticlesController); `resource :user` → users.
            var ctrl = plural ? resName : Pluralize(resName);
            var line = LineAt(safe, match.Index);
            foreach (var action in actions)
            {
                var (method, path) = RestfulRoute(action, resName);
                var routeNode = RouteNode($"route:{filePath}:{line}:{method}:{ctrl}#{action}", $"{method} {path}",
                    $"{filePath}::route:{ctrl}#{action}", filePath, line, match.Length, now);
                nodes.Add(routeNode);
                references.Add(RouteRef(routeNode.Id, $"{ctrl}#{action}", line, filePath));
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // RESTful action → HTTP verb + path (ruby.ts RESTFUL_ROUTES).
    private static (string Method, string Path) RestfulRoute(string action, string r) => action switch
    {
        "index" => ("GET", $"/{r}"),
        "create" => ("POST", $"/{r}"),
        "new" => ("GET", $"/{r}/new"),
        "show" => ("GET", $"/{r}/:id"),
        "edit" => ("GET", $"/{r}/:id/edit"),
        "update" => ("PATCH", $"/{r}/:id"),
        "destroy" => ("DELETE", $"/{r}/:id"),
        _ => ("ANY", $"/{r}")
    };

    // Naive ActiveSupport-style pluralize — covers common resource names (ruby.ts:210).
    private static string Pluralize(string w)
    {
        if (ConsonantYRegex().IsMatch(w))
        {
            return w.Substring(0, w.Length - 1) + "ies";
        }

        if (SibilantRegex().IsMatch(w))
        {
            return w + "es";
        }

        return w + "s";
    }

    // snake_case → CamelCase (`user_profiles` → `UserProfiles`).
    private static string Camelize(string s)
    {
        var sb = new System.Text.StringBuilder();
        foreach (var w in s.Split('_'))
        {
            if (w.Length == 0)
            {
                continue;
            }

            sb.Append(char.ToUpperInvariant(w[0])).Append(w.Substring(1));
        }

        return sb.ToString();
    }

    // Resolve `controller#action` to the action method in that controller (ruby.ts:222).
    private static string? ResolveControllerAction(string ctrlPath, string action, CodeGraphResolutionContext ctx)
    {
        // Rails convention: `articles` → app/controllers/articles_controller.rb.
        var direct = $"app/controllers/{ctrlPath}_controller.rb";
        if (ctx.FileExists(direct))
        {
            var m = FindMethod(ctx.GetNodesInFile(direct), action);
            if (m is not null)
            {
                return m.Id;
            }
        }

        // Fall back: controller class by name, then the action method in its file.
        var cls = Camelize(LastSegment(ctrlPath, '/')) + "Controller";
        foreach (var ctrl in ctx.GetNodesByName(cls))
        {
            if (ctrl.Kind != CodeGraphNodeKind.Class)
            {
                continue;
            }

            var m = FindMethod(ctx.GetNodesInFile(ctrl.FilePath), action);
            if (m is not null)
            {
                return m.Id;
            }
        }

        return null;
    }

    private static string? ResolveModel(string name, CodeGraphResolutionContext ctx)
    {
        var snakeName = SnakeCase(name);
        string[] possiblePaths = { $"app/models/{snakeName}.rb", $"app/models/concerns/{snakeName}.rb" };
        foreach (var modelPath in possiblePaths)
        {
            if (!ctx.FileExists(modelPath))
            {
                continue;
            }

            var node = FindClassNamed(ctx.GetNodesInFile(modelPath), name);
            if (node is not null)
            {
                return node.Id;
            }
        }

        // Fall back to name-based lookup, preferring app/models/.
        foreach (var n in ctx.GetNodesByName(name))
        {
            if (n.Kind == CodeGraphNodeKind.Class && n.FilePath.Contains("app/models/"))
            {
                return n.Id;
            }
        }

        return null;
    }

    private static string? ResolveController(string name, CodeGraphResolutionContext ctx)
    {
        var snakeName = SnakeCase(name);
        string[] possiblePaths =
        {
            $"app/controllers/{snakeName}.rb", $"app/controllers/api/{snakeName}.rb", $"app/controllers/api/v1/{snakeName}.rb"
        };
        foreach (var controllerPath in possiblePaths)
        {
            if (!ctx.FileExists(controllerPath))
            {
                continue;
            }

            var node = FindClassNamed(ctx.GetNodesInFile(controllerPath), name);
            if (node is not null)
            {
                return node.Id;
            }
        }

        foreach (var n in ctx.GetNodesByName(name))
        {
            if (n.Kind == CodeGraphNodeKind.Class && n.FilePath.Contains("controllers/"))
            {
                return n.Id;
            }
        }

        return null;
    }

    private static string? ResolveHelper(string name, CodeGraphResolutionContext ctx)
    {
        var snakeName = SnakeCase(name);
        var helperPath = $"app/helpers/{snakeName}.rb";
        if (ctx.FileExists(helperPath))
        {
            foreach (var n in ctx.GetNodesInFile(helperPath))
            {
                if (n.Kind == CodeGraphNodeKind.Module && n.Name == name)
                {
                    return n.Id;
                }
            }
        }

        return null;
    }

    private static string? ResolveService(string name, CodeGraphResolutionContext ctx)
    {
        var snakeName = SnakeCase(name);
        string[] possiblePaths = { $"app/services/{snakeName}.rb", $"app/jobs/{snakeName}.rb", $"app/workers/{snakeName}.rb" };
        foreach (var servicePath in possiblePaths)
        {
            if (!ctx.FileExists(servicePath))
            {
                continue;
            }

            var node = FindClassNamed(ctx.GetNodesInFile(servicePath), name);
            if (node is not null)
            {
                return node.Id;
            }
        }

        return null;
    }

    // CamelCase → snake_case (≙ name.replace(/([A-Z])/g, '_$1').toLowerCase().slice(1)).
    private static string SnakeCase(string name)
    {
        var replaced = UpperCharRegex().Replace(name, "_$1").ToLowerInvariant();
        return replaced.Length > 0 ? replaced.Substring(1) : replaced;
    }

    // `[:a, :b]` symbol list → set of bare names (strip a leading colon).
    private static HashSet<string> SymbolSet(string s)
    {
        var set = new HashSet<string>(StringComparer.Ordinal);
        foreach (var part in s.Split(','))
        {
            var x = part.Trim();
            if (x.StartsWith(':'))
            {
                x = x.Substring(1);
            }

            set.Add(x);
        }

        return set;
    }

    private static string[] FilterActions(string[] actions, HashSet<string> set, bool keep)
    {
        var result = new List<string>(actions.Length);
        foreach (var a in actions)
        {
            if (set.Contains(a) == keep)
            {
                result.Add(a);
            }
        }

        return result.ToArray();
    }

    private static CodeGraphNode? FindMethod(IReadOnlyList<CodeGraphNode> nodes, string action)
    {
        foreach (var n in nodes)
        {
            if ((n.Kind == CodeGraphNodeKind.Method || n.Kind == CodeGraphNodeKind.Function) && n.Name == action)
            {
                return n;
            }
        }

        return null;
    }

    private static CodeGraphNode? FindClassNamed(IReadOnlyList<CodeGraphNode> nodes, string name)
    {
        foreach (var n in nodes)
        {
            if (n.Kind == CodeGraphNodeKind.Class && n.Name == name)
            {
                return n;
            }
        }

        return null;
    }

    private static string LastSegment(string s, char sep)
    {
        var idx = s.LastIndexOf(sep);
        return idx >= 0 ? s.Substring(idx + 1) : s;
    }

    // 1-based line of `index` (≙ safe.slice(0, index).split('\n').length).
    private static int LineAt(string s, int index)
    {
        var line = 1;
        var end = index < s.Length ? index : s.Length;
        for (var i = 0; i < end; i++)
        {
            if (s[i] == '\n')
            {
                line++;
            }
        }

        return line;
    }

    private static CodeGraphNode RouteNode(string id, string name, string qualifiedName, string filePath, int line, int endColumn, long now) =>
        new(id, CodeGraphNodeKind.Route, name, qualifiedName, filePath, CodeGraphLanguage.Ruby, line, line, 0, endColumn,
            null, null, null, false, false, false, false, null, null, null, now);

    private static CodeGraphUnresolvedReference RouteRef(string fromNodeId, string referenceName, int line, string filePath) =>
        new(fromNodeId, referenceName, CodeGraphEdgeKind.References, line, 0, filePath, CodeGraphLanguage.Ruby, null, null);

    // ── Fixed patterns ([GeneratedRegex]) ─────────────────────────────────────

    [GeneratedRegex(@"^([\w/]+)#(\w+)$")]
    private static partial Regex ControllerActionRegex();

    [GeneratedRegex(@"^[A-Z][a-zA-Z]+$")]
    private static partial Regex PascalNameRegex();

    [GeneratedRegex(@"\b(get|post|put|patch|delete|match)\s+['""]([^'""]+)['""]\s*(?:,\s*to:\s*|=>\s*)['""]([^#'""]+)#([^'""]+)['""]")]
    private static partial Regex RouteRegex();

    [GeneratedRegex(@"\b(resources?)\s+:(\w+)([^\n]*)")]
    private static partial Regex ResourcesRegex();

    [GeneratedRegex(@"only:\s*\[([^\]]*)\]")]
    private static partial Regex OnlyRegex();

    [GeneratedRegex(@"except:\s*\[([^\]]*)\]")]
    private static partial Regex ExceptRegex();

    [GeneratedRegex(@"([A-Z])")]
    private static partial Regex UpperCharRegex();

    [GeneratedRegex(@"[^aeiou]y$")]
    private static partial Regex ConsonantYRegex();

    [GeneratedRegex(@"(s|x|z|ch|sh)$")]
    private static partial Regex SibilantRegex();
}
