using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphLaravelResolver — Laravel / PHP framework resolver (port of
// resolution/frameworks/laravel.ts; analysis/02 §3.3 row 1). Contributes:
//   * resolve(): Eloquent `Model::method` static calls (convention paths), and the
//     precise `Controller@method` route action produced by Extract.
//   * extract(): `route` nodes for `Route::METHOD('/path', handler)` and
//     `Route::resource('name', Controller::class)`. The handler expression is parsed
//     into the linking symbol — a `[Class::class, 'method']` tuple / `'C@m'` string
//     becomes the PRECISE `Class@method` so common actions (`index`/`show`) resolve
//     to the RIGHT controller, not whichever name-match wins first.
//
// GLOBAL namespace, all-internal, reflection-free/AOT. Fixed patterns via
// [GeneratedRegex]; PHP comments stripped (strings preserved) before scanning.
// =============================================================================
internal sealed partial class CodeGraphLaravelResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] PhpLanguages = { CodeGraphLanguage.Php };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    // Laravel helper functions — external, never a local node (laravel.ts:79).
    private static readonly HashSet<string> HelperFunctions = new(StringComparer.Ordinal)
    {
        "route", "view", "config", "env", "app", "abort", "redirect", "response",
        "request", "session", "url", "asset", "mix"
    };

    // Laravel facade → underlying class map (laravel.ts:15). Currently unused by
    // resolve() (facades resolve to external framework code); kept for parity + a
    // future facade-resolution pass, mirroring the exported TS table.
    internal static readonly IReadOnlyDictionary<string, string> FacadeMappings =
        new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["Auth"] = @"Illuminate\Auth\AuthManager",
            ["Cache"] = @"Illuminate\Cache\CacheManager",
            ["Config"] = @"Illuminate\Config\Repository",
            ["DB"] = @"Illuminate\Database\DatabaseManager",
            ["Event"] = @"Illuminate\Events\Dispatcher",
            ["File"] = @"Illuminate\Filesystem\Filesystem",
            ["Gate"] = @"Illuminate\Auth\Access\Gate",
            ["Hash"] = @"Illuminate\Hashing\HashManager",
            ["Log"] = @"Illuminate\Log\LogManager",
            ["Mail"] = @"Illuminate\Mail\Mailer",
            ["Queue"] = @"Illuminate\Queue\QueueManager",
            ["Redis"] = @"Illuminate\Redis\RedisManager",
            ["Request"] = @"Illuminate\Http\Request",
            ["Response"] = @"Illuminate\Http\Response",
            ["Route"] = @"Illuminate\Routing\Router",
            ["Session"] = @"Illuminate\Session\SessionManager",
            ["Storage"] = @"Illuminate\Filesystem\FilesystemManager",
            ["URL"] = @"Illuminate\Routing\UrlGenerator",
            ["Validator"] = @"Illuminate\Validation\Factory",
            ["View"] = @"Illuminate\View\Factory"
        };

    public string Name => "laravel";

    public IReadOnlyList<string>? Languages => PhpLanguages;

    // `Controller@method` route refs name no declared symbol, so resolveOne's pre-filter
    // would drop them before resolve() runs (Pattern 4). Claim them (laravel.ts:50).
    public bool ClaimsReference(string name) => ControllerActionRegex().IsMatch(name);

    public bool Detect(CodeGraphResolutionContext ctx) =>
        ctx.FileExists("artisan") || ctx.FileExists("app/Http/Kernel.php");

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        // Pattern 1: Model::method() — Eloquent static calls.
        var modelMatch = ModelCallRegex().Match(name);
        if (modelMatch.Success)
        {
            var target = ResolveModelCall(modelMatch.Groups[1].Value, modelMatch.Groups[2].Value, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.85, CodeGraphResolvedBy.Framework);
            }
        }

        // Pattern 2: Facade calls — Auth::user(), Cache::get(). Facades resolve to
        // external Laravel code, so they cannot bind to a local node (laravel.ts:71).
        if (FacadeRegex().IsMatch(name))
        {
            return null;
        }

        // Pattern 3: Helper function calls — route(), view(), config(). External.
        if (HelperFunctions.Contains(name))
        {
            return null;
        }

        // Pattern 4: Controller method references (Controller@method).
        var controllerMatch = ControllerActionRegex().Match(name);
        if (controllerMatch.Success)
        {
            var target = ResolveControllerMethod(controllerMatch.Groups[1].Value, controllerMatch.Groups[2].Value, ctx);
            if (target is not null)
            {
                return new CodeGraphResolvedRef(target, 0.9, CodeGraphResolvedBy.Framework);
            }
        }

        return null;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!filePath.EndsWith(".php", StringComparison.Ordinal))
        {
            return EmptyExtraction;
        }

        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var safe = CodeGraphStripComments.StripForRegex(content, CodeGraphLanguage.Php);

        // Route::METHOD('/path', handler-expr) — handler-expr can be
        // [Class::class, 'method'] | 'Controller@method' | Closure | Class::class.
        foreach (Match match in RouteRegex().Matches(safe))
        {
            var routePath = match.Groups[2].Value;
            var line = LineAt(safe, match.Index);
            var upper = match.Groups[1].Value.ToUpperInvariant();
            var routeNode = RouteNode($"route:{filePath}:{line}:{upper}:{routePath}", $"{upper} {routePath}",
                $"{filePath}::route:{routePath}", filePath, line, match.Length, now);
            nodes.Add(routeNode);

            var handlerName = ExtractLaravelHandler(match.Groups[3].Value);
            if (handlerName is not null)
            {
                references.Add(RouteRef(routeNode.Id, handlerName, CodeGraphEdgeKind.References, line, filePath));
            }
        }

        // Route::resource('name', Controller::class) / Route::apiResource(...).
        foreach (Match match in ResourceRegex().Matches(safe))
        {
            var resourceName = match.Groups[2].Value;
            var line = LineAt(safe, match.Index);
            var routeNode = RouteNode($"route:{filePath}:{line}:RESOURCE:{resourceName}", $"resource:{resourceName}",
                $"{filePath}::route:{resourceName}", filePath, line, match.Length, now);
            nodes.Add(routeNode);

            if (match.Groups[3].Success)
            {
                var controllerName = ExtractLaravelHandler(match.Groups[3].Value);
                if (controllerName is not null)
                {
                    references.Add(RouteRef(routeNode.Id, controllerName, CodeGraphEdgeKind.Imports, line, filePath));
                }
            }
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // Parse a Laravel route handler expression into the symbol to link (laravel.ts:193):
    //   [Class::class, 'method'] -> `Class@method`   (PRECISE — keeps the controller)
    //   'Controller@method'      -> `Controller@method`
    //   Class::class             -> `Class`
    //   anything else (closure)  -> null
    private static string? ExtractLaravelHandler(string expr)
    {
        var trimmed = expr.Trim();

        var tupleMatch = HandlerTupleRegex().Match(trimmed);
        if (tupleMatch.Success)
        {
            return $"{Short(tupleMatch.Groups[1].Value)}@{tupleMatch.Groups[2].Value}";
        }

        var atMatch = HandlerAtRegex().Match(trimmed);
        if (atMatch.Success)
        {
            return $"{Short(atMatch.Groups[1].Value)}@{atMatch.Groups[2].Value}";
        }

        var classMatch = HandlerClassRegex().Match(trimmed);
        if (classMatch.Success)
        {
            return Short(classMatch.Groups[1].Value);
        }

        return null;
    }

    // Strip the PHP namespace — last segment after '\' (≙ s.split('\\').pop()).
    private static string Short(string s) => LastSegment(s, '\\');

    // Resolve a Model::method() call by Laravel convention path (laravel.ts:217).
    private static string? ResolveModelCall(string className, string methodName, CodeGraphResolutionContext ctx)
    {
        // app/Models/ first (Laravel 8+), then app/ (Laravel 7 and below).
        string[] modelPaths = { $"app/Models/{className}.php", $"app/{className}.php" };
        foreach (var modelPath in modelPaths)
        {
            if (!ctx.FileExists(modelPath))
            {
                continue;
            }

            var fileNodes = ctx.GetNodesInFile(modelPath);
            var methodNode = FindByKindAndName(fileNodes, CodeGraphNodeKind.Method, methodName);
            if (methodNode is not null)
            {
                return methodNode.Id;
            }

            var classNode = FindByKindAndName(fileNodes, CodeGraphNodeKind.Class, className);
            if (classNode is not null)
            {
                return classNode.Id;
            }
        }

        return null;
    }

    // Resolve a Controller@method reference by convention, then by name (laravel.ts:266).
    private static string? ResolveControllerMethod(string controller, string method, CodeGraphResolutionContext ctx)
    {
        var controllerPath = $"app/Http/Controllers/{controller}.php";
        if (ctx.FileExists(controllerPath))
        {
            var methodNode = FindByKindAndName(ctx.GetNodesInFile(controllerPath), CodeGraphNodeKind.Method, method);
            if (methodNode is not null)
            {
                return methodNode.Id;
            }
        }

        // Name-based lookup for namespaced controllers.
        foreach (var ctrl in ctx.GetNodesByName(controller))
        {
            if (ctrl.Kind == CodeGraphNodeKind.Class && ctrl.FilePath.Contains("Controllers", StringComparison.Ordinal))
            {
                var methodNode = FindByKindAndName(ctx.GetNodesInFile(ctrl.FilePath), CodeGraphNodeKind.Method, method);
                if (methodNode is not null)
                {
                    return methodNode.Id;
                }
            }
        }

        return null;
    }

    private static CodeGraphNode? FindByKindAndName(IReadOnlyList<CodeGraphNode> nodes, string kind, string name)
    {
        foreach (var n in nodes)
        {
            if (n.Kind == kind && n.Name == name)
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
        new(id, CodeGraphNodeKind.Route, name, qualifiedName, filePath, CodeGraphLanguage.Php, line, line, 0, endColumn,
            null, null, null, false, false, false, false, null, null, null, now);

    private static CodeGraphUnresolvedReference RouteRef(string fromNodeId, string referenceName, string referenceKind, int line, string filePath) =>
        new(fromNodeId, referenceName, referenceKind, line, 0, filePath, CodeGraphLanguage.Php, null, null);

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from laravel.ts ───────────

    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*Controller@\w+$")]
    private static partial Regex ControllerActionRegex();

    [GeneratedRegex(@"^([A-Z][a-zA-Z]+)::(\w+)$")]
    private static partial Regex ModelCallRegex();

    [GeneratedRegex(@"^(Auth|Cache|DB|Log|Mail|Queue|Session|Storage|Validator|Route|Request|Response)::(\w+)$")]
    private static partial Regex FacadeRegex();

    [GeneratedRegex(@"Route::(get|post|put|patch|delete|options|any)\s*\(\s*['""]([^'""]+)['""]\s*,\s*([^)]+)\)")]
    private static partial Regex RouteRegex();

    [GeneratedRegex(@"Route::(resource|apiResource)\s*\(\s*['""]([^'""]+)['""]\s*(?:,\s*([^)]+))?\)")]
    private static partial Regex ResourceRegex();

    [GeneratedRegex(@"^\[\s*([A-Za-z_\\][\w\\]*)::class\s*,\s*['""]([^'""]+)['""]\s*\]")]
    private static partial Regex HandlerTupleRegex();

    [GeneratedRegex(@"^['""]([^'""@]+)@([^'""]+)['""]$")]
    private static partial Regex HandlerAtRegex();

    [GeneratedRegex(@"^([A-Za-z_\\][\w\\]*)::class")]
    private static partial Regex HandlerClassRegex();
}
