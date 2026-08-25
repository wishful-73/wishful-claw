using System.Text.Json;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphNestJsResolver — NestJS decorator-based framework resolver (port of
// resolution/frameworks/nestjs.ts; analysis/02 §3.3 row 4). Regex-over-source
// (comment-stripped), not AST traversal. Contributes:
//   * resolve(): provider/controller refs (constructor-injected `UsersService`)
//     to their class, preferring the Nest file-name convention (`*.service.ts`…).
//   * extract(): route nodes across NestJS transport layers —
//       HTTP:          @Controller(prefix) + @Get/@Post/… (paths joined)
//       GraphQL:       @Resolver + @Query/@Mutation/@Subscription
//       Microservices: @MessagePattern / @EventPattern
//       WebSockets:    @WebSocketGateway(ns) + @SubscribeMessage(event)
//     via a decorator scanner (sticky-regex handler/class lookahead) + a
//     string-aware balanced-paren argument reader.
//   * postExtract(): cross-file `RouterModule.register([...])` prefixing — walks the
//     module registration tree + `@Module({ controllers })` to rewrite route names
//     (a mini JS-object-literal parser). The route node id + qualifiedName are
//     preserved across the update (edges reference the id; qualifiedName keeps the
//     original method:path, which makes the pass idempotent).
//
// GLOBAL namespace, all-internal, reflection-free/AOT. Fixed patterns via
// [GeneratedRegex]; package.json parsed with JsonDocument (never Deserialize<T>).
// =============================================================================
internal sealed partial class CodeGraphNestJsResolver : ICodeGraphFrameworkResolver
{
    public string Name => "nestjs";

    public IReadOnlyList<string>? Languages { get; } = new[]
    {
        CodeGraphLanguage.TypeScript, CodeGraphLanguage.JavaScript
    };

    private static readonly string[] HttpMethods = { "Get", "Post", "Put", "Patch", "Delete", "Head", "Options", "All" };
    private static readonly string[] GqlOps = { "Query", "Mutation", "Subscription" };
    private static readonly string[] MessageNames = { "MessagePattern", "EventPattern" };
    private static readonly string[] SubscribeNames = { "SubscribeMessage" };
    private static readonly string[] ControllerNames = { "Controller" };
    private static readonly string[] ResolverNames = { "Resolver" };
    private static readonly string[] GatewayNames = { "WebSocketGateway" };
    private static readonly string[] InjectableNames = { "Injectable" };
    private static readonly string[] ModuleNames = { "Module" };
    private static readonly string[] CatchNames = { "Catch" };

    // Provider resolution conventions: name suffix -> preferred file-name fragment.
    private static readonly (string Suffix, string Convention)[] ProviderConventions =
    {
        ("Service", ".service."),
        ("Controller", ".controller."),
        ("Resolver", ".resolver."),
        ("Gateway", ".gateway."),
        ("Repository", ".repository."),
        ("Guard", ".guard."),
        ("Interceptor", ".interceptor."),
        ("Pipe", ".pipe."),
        ("Module", ".module.")
    };

    // Class-scope kinds.
    private const string ScopeController = "controller";
    private const string ScopeResolver = "resolver";
    private const string ScopeGateway = "gateway";
    private const string ScopeOther = "other";

    // ------------------------------------------------------------------
    // detect
    // ------------------------------------------------------------------
    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var packageJson = ctx.ReadFile("package.json");
        if (packageJson is not null &&
            PackageJsonHasDependency(packageJson, static k => k.StartsWith("@nestjs/", StringComparison.Ordinal)))
        {
            return true;
        }

        // Fallback: NestJS-specific decorators in conventionally named files.
        foreach (var file in ctx.GetAllFiles())
        {
            if (file.EndsWith(".controller.ts", StringComparison.Ordinal) ||
                file.EndsWith(".controller.js", StringComparison.Ordinal) ||
                file.EndsWith(".module.ts", StringComparison.Ordinal) ||
                file.EndsWith(".resolver.ts", StringComparison.Ordinal) ||
                file.EndsWith(".gateway.ts", StringComparison.Ordinal))
            {
                var content = ctx.ReadFile(file);
                if (content is not null &&
                    (content.Contains("@nestjs/", StringComparison.Ordinal) ||
                     content.Contains("@Controller", StringComparison.Ordinal) ||
                     content.Contains("@Module(", StringComparison.Ordinal) ||
                     content.Contains("@Resolver(", StringComparison.Ordinal) ||
                     content.Contains("@WebSocketGateway(", StringComparison.Ordinal)))
                {
                    return true;
                }
            }
        }

        return false;
    }

    // ------------------------------------------------------------------
    // resolve — provider/controller refs to their class
    // ------------------------------------------------------------------
    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        foreach (var (suffix, convention) in ProviderConventions)
        {
            if (!r.ReferenceName.EndsWith(suffix, StringComparison.Ordinal))
            {
                continue;
            }

            List<CodeGraphNode>? candidates = null;
            foreach (var n in ctx.GetNodesByName(r.ReferenceName))
            {
                if (n.Kind == CodeGraphNodeKind.Class)
                {
                    (candidates ??= new List<CodeGraphNode>()).Add(n);
                }
            }

            if (candidates is null || candidates.Count == 0)
            {
                return null;
            }

            CodeGraphNode? preferred = null;
            foreach (var n in candidates)
            {
                if (n.FilePath.Contains(convention, StringComparison.Ordinal))
                {
                    preferred = n;
                    break;
                }
            }

            var target = preferred ?? candidates[0];
            return new CodeGraphResolvedRef(target.Id, preferred is not null ? 0.85 : 0.7, CodeGraphResolvedBy.Framework);
        }

        return null;
    }

    // ------------------------------------------------------------------
    // extract
    // ------------------------------------------------------------------
    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (!ExtGuardRegex().IsMatch(filePath))
        {
            return new CodeGraphFrameworkExtraction(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());
        }

        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lang = DetectLanguage(filePath);
        var safe = CodeGraphStripComments.StripForRegex(content, lang);

        void AddRoute(int index, string method, string path, int length, string? handler)
        {
            var line = LineAt(safe, index);
            var node = RouteNode(
                $"route:{filePath}:{line}:{method}:{path}",
                $"{method} {path}",
                $"{filePath}::{method}:{path}",
                filePath, line, length, lang, now);
            nodes.Add(node);
            if (!string.IsNullOrEmpty(handler))
            {
                references.Add(RouteRef(node.Id, handler, CodeGraphEdgeKind.References, line, filePath, lang));
            }
        }

        var scopes = BuildClassScopes(safe);

        // HTTP routes: method decorator path joined onto the enclosing controller's prefix.
        foreach (var hit in FindDecorators(safe, HttpMethods))
        {
            var scope = ScopeFor(scopes, hit.Index);
            var prefix = scope is not null && scope.Kind == ScopeController ? scope.Prefix : string.Empty;
            var path = JoinHttpPath(prefix, ParseStringArg(hit.Args));
            AddRoute(hit.Index, hit.Name.ToUpperInvariant(), path, hit.Length, MethodNameAfter(safe, hit.End));
        }

        // GraphQL operations: only inside an @Resolver class (disambiguates the REST
        // `@Query()` parameter decorator, which lives inside @Controller classes).
        foreach (var hit in FindDecorators(safe, GqlOps))
        {
            var scope = ScopeFor(scopes, hit.Index);
            if (scope is null || scope.Kind != ScopeResolver)
            {
                continue;
            }

            var handler = MethodNameAfter(safe, hit.End);
            var name = ParseGraphqlName(hit.Args, handler);
            AddRoute(hit.Index, hit.Name.ToUpperInvariant(), name, hit.Length, handler);
        }

        // Microservice message/event handlers.
        foreach (var hit in FindDecorators(safe, MessageNames))
        {
            var verb = hit.Name == "EventPattern" ? "EVENT" : "MESSAGE";
            var handler = MethodNameAfter(safe, hit.End);
            var arg = ParseStringArg(hit.Args);
            var path = arg.Length > 0 ? arg : handler ?? string.Empty;
            AddRoute(hit.Index, verb, path, hit.Length, handler);
        }

        // WebSocket message handlers, prefixed with the gateway namespace when present.
        foreach (var hit in FindDecorators(safe, SubscribeNames))
        {
            var scope = ScopeFor(scopes, hit.Index);
            var namespaceStr = scope is not null && scope.Kind == ScopeGateway ? scope.Prefix : string.Empty;
            var handler = MethodNameAfter(safe, hit.End);
            var arg = ParseStringArg(hit.Args);
            var evt = arg.Length > 0 ? arg : handler ?? string.Empty;
            AddRoute(hit.Index, "WS", namespaceStr.Length > 0 ? $"{namespaceStr}:{evt}" : evt, hit.Length, handler);
        }

        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // ------------------------------------------------------------------
    // postExtract — cross-file RouterModule.register([...]) prefixing
    // ------------------------------------------------------------------
    public IReadOnlyList<CodeGraphNode> PostExtract(CodeGraphResolutionContext ctx)
    {
        var moduleToPrefix = new Dictionary<string, string>(StringComparer.Ordinal);
        var controllerToModule = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var filePath in ctx.GetAllFiles())
        {
            if (!ModuleFileRegex().IsMatch(filePath))
            {
                continue;
            }

            var content = ctx.ReadFile(filePath);
            if (string.IsNullOrEmpty(content))
            {
                continue;
            }

            var safe = CodeGraphStripComments.StripForRegex(content, DetectLanguage(filePath));
            CollectRouterModuleRegistrations(safe, moduleToPrefix);
            CollectModuleControllers(safe, controllerToModule);
        }

        var controllerToPrefix = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var kv in controllerToModule)
        {
            // '' and '/' are no-op prefixes; skip them so we don't run updates that
            // would set name to the value it already has.
            if (moduleToPrefix.TryGetValue(kv.Value, out var prefix) && prefix.Length > 0 && prefix != "/")
            {
                controllerToPrefix[kv.Key] = prefix;
            }
        }

        if (controllerToPrefix.Count == 0)
        {
            return Array.Empty<CodeGraphNode>();
        }

        var updates = new List<CodeGraphNode>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        foreach (var kv in controllerToPrefix)
        {
            var controllerName = kv.Key;
            var prefix = kv.Value;
            foreach (var cls in ctx.GetNodesByName(controllerName))
            {
                if (cls.Kind != CodeGraphNodeKind.Class)
                {
                    continue;
                }

                foreach (var route in ctx.GetNodesInFile(cls.FilePath))
                {
                    if (route.Kind != CodeGraphNodeKind.Route)
                    {
                        continue;
                    }

                    // Each route must be associated with the controller whose line range
                    // contains it (multiple controllers can live in one file).
                    if (route.StartLine < cls.StartLine || route.StartLine > cls.EndLine)
                    {
                        continue;
                    }

                    var updated = ApplyModulePrefix(route, prefix, now);
                    if (updated is not null && updated.Name != route.Name)
                    {
                        updates.Add(updated);
                    }
                }
            }
        }

        return updates;
    }

    // ------------------------------------------------------------------
    // Decorator scanning
    // ------------------------------------------------------------------
    private readonly record struct DecoratorHit(string Name, string Args, int Index, int End, int Length);

    // Find every `@Name(...)` decorator whose name is in `names`, using a string-aware
    // balanced-paren reader for the arg list so type thunks like `@Query(() => [User])`
    // are captured whole rather than truncated at the inner `()`.
    private static List<DecoratorHit> FindDecorators(string safe, string[] names)
    {
        var hits = new List<DecoratorHit>();
        var re = new Regex("@(" + string.Join("|", names) + @")\s*\(");
        var m = re.Match(safe);
        while (m.Success)
        {
            var openIndex = m.Index + m.Length - 1; // position of '('
            var parsed = ReadArgs(safe, openIndex);
            if (parsed is null)
            {
                m = m.NextMatch();
                continue;
            }

            hits.Add(new DecoratorHit(m.Groups[1].Value, parsed.Value.Args, m.Index, parsed.Value.End, parsed.Value.End - m.Index));
            m = re.Match(safe, parsed.Value.End); // resume past the args
        }

        return hits;
    }

    // Read a balanced `(...)` starting at `openIndex` (which must point at `(`).
    // String-aware. Returns the inner text and the index just past the closing `)`.
    private static (string Args, int End)? ReadArgs(string s, int openIndex)
    {
        if (openIndex < 0 || openIndex >= s.Length || s[openIndex] != '(')
        {
            return null;
        }

        var depth = 0;
        var inStr = '\0';
        for (var i = openIndex; i < s.Length; i++)
        {
            var ch = s[i];
            if (inStr != '\0')
            {
                if (ch == '\\')
                {
                    i++;
                    continue;
                }

                if (ch == inStr)
                {
                    inStr = '\0';
                }

                continue;
            }

            if (ch == '"' || ch == '\'' || ch == '`')
            {
                inStr = ch;
                continue;
            }

            if (ch == '(')
            {
                depth++;
            }
            else if (ch == ')')
            {
                depth--;
                if (depth == 0)
                {
                    return (s[(openIndex + 1)..i], i + 1);
                }
            }
        }

        return null;
    }

    // Starting just after a method decorator's `)`, return the name of the method it
    // decorates. Skips stacked decorators + access/async modifiers in between.
    private static string? MethodNameAfter(string safe, int start)
    {
        var i = start;

        void EatWs()
        {
            if (i > safe.Length)
            {
                i = safe.Length;
            }

            var m = WsStickyRegex().Match(safe, i);
            i = m.Index + m.Length;
        }

        // Skip stacked decorators.
        while (true)
        {
            EatWs();
            if (CharAt(safe, i) != '@')
            {
                break;
            }

            var dm = DecoNameStickyRegex().Match(safe, i);
            if (!dm.Success)
            {
                break;
            }

            i = dm.Index + dm.Length;
            EatWs();
            if (CharAt(safe, i) == '(')
            {
                var parsed = ReadArgs(safe, i);
                if (parsed is null)
                {
                    return null;
                }

                i = parsed.Value.End;
            }
        }

        // Skip access/async/static modifiers.
        while (true)
        {
            EatWs();
            var mm = ModifierStickyRegex().Match(safe, i);
            if (mm.Success && mm.Index + mm.Length > i)
            {
                i = mm.Index + mm.Length;
                continue;
            }

            break;
        }

        EatWs();
        var im = IdentStickyRegex().Match(safe, i);
        return im.Success ? im.Groups[1].Value : null;
    }

    // Starting just after a class decorator's `)`, return the class name it decorates.
    // Mirrors MethodNameAfter: skips stacked decorators + export/default/abstract.
    private static string? ClassNameAfter(string safe, int start)
    {
        var i = start;

        void EatWs()
        {
            if (i > safe.Length)
            {
                i = safe.Length;
            }

            var m = WsStickyRegex().Match(safe, i);
            i = m.Index + m.Length;
        }

        while (true)
        {
            EatWs();
            if (CharAt(safe, i) != '@')
            {
                break;
            }

            var dm = DecoNameStickyRegex().Match(safe, i);
            if (!dm.Success)
            {
                break;
            }

            i = dm.Index + dm.Length;
            EatWs();
            if (CharAt(safe, i) == '(')
            {
                var parsed = ReadArgs(safe, i);
                if (parsed is null)
                {
                    return null;
                }

                i = parsed.Value.End;
            }
        }

        EatWs();
        var cm = ClassDeclStickyRegex().Match(safe, i);
        return cm.Success ? cm.Groups[1].Value : null;
    }

    // ------------------------------------------------------------------
    // Class scopes (controller / resolver / gateway boundaries)
    // ------------------------------------------------------------------
    private sealed record ClassScope(string Kind, string Prefix, int Start, int End);

    // Build class-level decorator scopes, sorted by position. Each scope runs from its
    // decorator up to the next class decorator (of any kind).
    private static List<ClassScope> BuildClassScopes(string safe)
    {
        var raw = new List<(string Kind, string Prefix, int Index)>();
        foreach (var hit in FindDecorators(safe, ControllerNames))
        {
            raw.Add((ScopeController, ParseControllerPrefix(hit.Args), hit.Index));
        }

        foreach (var hit in FindDecorators(safe, ResolverNames))
        {
            raw.Add((ScopeResolver, string.Empty, hit.Index));
        }

        foreach (var hit in FindDecorators(safe, GatewayNames))
        {
            raw.Add((ScopeGateway, ParseGatewayNamespace(hit.Args), hit.Index));
        }

        foreach (var hit in FindDecorators(safe, InjectableNames))
        {
            raw.Add((ScopeOther, string.Empty, hit.Index));
        }

        foreach (var hit in FindDecorators(safe, ModuleNames))
        {
            raw.Add((ScopeOther, string.Empty, hit.Index));
        }

        foreach (var hit in FindDecorators(safe, CatchNames))
        {
            raw.Add((ScopeOther, string.Empty, hit.Index));
        }

        raw.Sort(static (a, b) => a.Index.CompareTo(b.Index));

        var scopes = new List<ClassScope>(raw.Count);
        for (var i = 0; i < raw.Count; i++)
        {
            var end = i + 1 < raw.Count ? raw[i + 1].Index : safe.Length;
            scopes.Add(new ClassScope(raw[i].Kind, raw[i].Prefix, raw[i].Index, end));
        }

        return scopes;
    }

    private static ClassScope? ScopeFor(List<ClassScope> scopes, int index)
    {
        foreach (var s in scopes)
        {
            if (index >= s.Start && index < s.End)
            {
                return s;
            }
        }

        return null;
    }

    // ------------------------------------------------------------------
    // Argument parsing
    // ------------------------------------------------------------------

    // First string literal anywhere in the args, or '' (covers `'x'`, `{ k: 'x' }`).
    private static string ParseStringArg(string args)
    {
        var m = StringArgRegex().Match(args);
        return m.Success ? m.Groups[1].Value : string.Empty;
    }

    // `@Controller('users')` | `@Controller({ path: 'users' })` | `@Controller()`.
    private static string ParseControllerPrefix(string args)
    {
        var obj = ControllerPathRegex().Match(args);
        return obj.Success ? obj.Groups[1].Value : ParseStringArg(args);
    }

    // `@WebSocketGateway({ namespace: 'chat' })` | `@WebSocketGateway()`.
    private static string ParseGatewayNamespace(string args)
    {
        var m = GatewayNamespaceRegex().Match(args);
        return m.Success ? m.Groups[1].Value : string.Empty;
    }

    // GraphQL op name: explicit `{ name: 'x' }` or leading string literal, else the
    // handler method name.
    private static string ParseGraphqlName(string args, string? handler)
    {
        var named = GqlNameRegex().Match(args);
        if (named.Success)
        {
            return named.Groups[1].Value;
        }

        var lead = GqlLeadRegex().Match(args);
        if (lead.Success)
        {
            return lead.Groups[1].Value;
        }

        return handler ?? string.Empty;
    }

    // ------------------------------------------------------------------
    // Path helpers
    // ------------------------------------------------------------------

    // Join a controller prefix and method path into a single normalised `/path`.
    private static string JoinHttpPath(string prefix, string sub)
    {
        var parts = new List<string>(2);
        foreach (var p in new[] { prefix, sub })
        {
            var t = SlashTrimRegex().Replace(p.Trim(), string.Empty);
            if (t.Length > 0)
            {
                parts.Add(t);
            }
        }

        return "/" + string.Join("/", parts);
    }

    private static string DetectLanguage(string filePath) =>
        filePath.EndsWith(".ts", StringComparison.Ordinal) || filePath.EndsWith(".tsx", StringComparison.Ordinal)
            ? CodeGraphLanguage.TypeScript
            : CodeGraphLanguage.JavaScript;

    // ------------------------------------------------------------------
    // RouterModule + @Module walkers (postExtract)
    // ------------------------------------------------------------------
    private sealed record RouteItem(string Path, string? ModuleName, List<RouteItem> Children);

    // Walk every `RouterModule.register/forRoot/forChild([...])` and populate `out`
    // with Module -> /full/prefix. First-write-wins.
    private static void CollectRouterModuleRegistrations(string safe, Dictionary<string, string> outMap)
    {
        var re = RouterModuleRegex();
        var m = re.Match(safe);
        while (m.Success)
        {
            var openIndex = m.Index + m.Length - 1;
            var parsed = ReadArgs(safe, openIndex);
            if (parsed is null)
            {
                m = m.NextMatch();
                continue;
            }

            var items = ParseRoutesArray(parsed.Value.Args);
            WalkRoutesTree(items, string.Empty, outMap);
            m = re.Match(safe, parsed.Value.End);
        }
    }

    private static List<RouteItem> ParseRoutesArray(string args)
    {
        var trimmed = args.Trim();
        if (!trimmed.StartsWith('['))
        {
            return new List<RouteItem>();
        }

        var close = MatchingClose(trimmed, 0);
        if (close < 0)
        {
            return new List<RouteItem>();
        }

        return ParseRouteObjects(trimmed[1..close]);
    }

    private static List<RouteItem> ParseRouteObjects(string s)
    {
        var items = new List<RouteItem>();
        foreach (var obj in SplitTopLevelObjects(s))
        {
            var path = ParseStringField(obj, "path");
            var moduleName = ParseIdentField(obj, "module");
            var childrenStr = ParseArrayField(obj, "children");
            var children = childrenStr is not null ? ParseRouteObjects(childrenStr) : new List<RouteItem>();
            items.Add(new RouteItem(path, moduleName, children));
        }

        return items;
    }

    private static void WalkRoutesTree(List<RouteItem> items, string parentPrefix, Dictionary<string, string> outMap)
    {
        foreach (var item in items)
        {
            var myPrefix = JoinHttpPath(parentPrefix, item.Path);
            if (!string.IsNullOrEmpty(item.ModuleName) && !outMap.ContainsKey(item.ModuleName))
            {
                outMap[item.ModuleName] = myPrefix;
            }

            if (item.Children.Count > 0)
            {
                WalkRoutesTree(item.Children, myPrefix, outMap);
            }
        }
    }

    // Walk every `@Module(...)` decorator and populate `out` with
    // Controller -> enclosingModuleClassName (first-write-wins).
    private static void CollectModuleControllers(string safe, Dictionary<string, string> outMap)
    {
        foreach (var hit in FindDecorators(safe, ModuleNames))
        {
            var className = ClassNameAfter(safe, hit.End);
            if (string.IsNullOrEmpty(className))
            {
                continue;
            }

            foreach (var controller in ParseControllersField(hit.Args))
            {
                if (!outMap.ContainsKey(controller))
                {
                    outMap[controller] = className;
                }
            }
        }
    }

    private static List<string> ParseControllersField(string args)
    {
        var inner = ParseArrayField(args, "controllers");
        if (inner is null)
        {
            return new List<string>();
        }

        var result = new List<string>();
        foreach (var part in inner.Split(','))
        {
            var t = part.Trim();
            if (ControllerIdentRegex().IsMatch(t))
            {
                result.Add(t);
            }
        }

        return result;
    }

    // Recompute a route node's name by prepending `prefix` to the ORIGINAL in-file
    // path, recovered from qualifiedName (`${filePath}::${method}:${path}`) which is
    // never mutated — that keeps the pass idempotent. id + qualifiedName preserved.
    private static CodeGraphNode? ApplyModulePrefix(CodeGraphNode route, string prefix, long now)
    {
        const string sep = "::";
        var idx = route.QualifiedName.IndexOf(sep, StringComparison.Ordinal);
        if (idx < 0)
        {
            return null;
        }

        var tail = route.QualifiedName[(idx + sep.Length)..];
        var colon = tail.IndexOf(':');
        if (colon < 0)
        {
            return null;
        }

        var method = tail[..colon];
        var original = tail[(colon + 1)..];
        var newName = $"{method} {JoinHttpPath(prefix, original)}";
        return route with { Name = newName, UpdatedAt = now };
    }

    // ------------------------------------------------------------------
    // Object/array literal splitters
    // ------------------------------------------------------------------

    // Index of the bracket that closes the one at `open`, or -1. String-aware.
    private static int MatchingClose(string s, int open)
    {
        if (open < 0 || open >= s.Length)
        {
            return -1;
        }

        var opener = s[open];
        if (opener != '[' && opener != '{' && opener != '(')
        {
            return -1;
        }

        var depth = 0;
        var inStr = '\0';
        for (var i = open; i < s.Length; i++)
        {
            var ch = s[i];
            if (inStr != '\0')
            {
                if (ch == '\\')
                {
                    i++;
                    continue;
                }

                if (ch == inStr)
                {
                    inStr = '\0';
                }

                continue;
            }

            if (ch == '"' || ch == '\'' || ch == '`')
            {
                inStr = ch;
                continue;
            }

            if (ch == '{' || ch == '[' || ch == '(')
            {
                depth++;
            }
            else if (ch == '}' || ch == ']' || ch == ')')
            {
                depth--;
                if (depth == 0)
                {
                    return i;
                }
            }
        }

        return -1;
    }

    // Split `s` into the contents of each top-level object literal (balanced brackets
    // + string literals).
    private static List<string> SplitTopLevelObjects(string s)
    {
        var outList = new List<string>();
        var depth = 0;
        var objStart = -1;
        var inStr = '\0';
        for (var i = 0; i < s.Length; i++)
        {
            var ch = s[i];
            if (inStr != '\0')
            {
                if (ch == '\\')
                {
                    i++;
                    continue;
                }

                if (ch == inStr)
                {
                    inStr = '\0';
                }

                continue;
            }

            if (ch == '"' || ch == '\'' || ch == '`')
            {
                inStr = ch;
                continue;
            }

            if (depth == 0 && ch == '{')
            {
                depth = 1;
                objStart = i;
                continue;
            }

            if (ch == '{' || ch == '[' || ch == '(')
            {
                depth++;
            }
            else if (ch == '}' || ch == ']' || ch == ')')
            {
                depth--;
                if (depth == 0 && objStart >= 0 && ch == '}')
                {
                    outList.Add(s[(objStart + 1)..i]);
                    objStart = -1;
                }
            }
        }

        return outList;
    }

    // Read a string-valued field `key: 'value'` out of one object body, or ''. The
    // leading char class guards against a field whose name is a suffix of the target.
    private static string ParseStringField(string obj, string name)
    {
        var re = new Regex("(?:^|[,{\\s])" + Regex.Escape(name) + "\\s*:\\s*['\"`]([^'\"`]*)['\"`]");
        var m = re.Match(obj);
        return m.Success ? m.Groups[1].Value : string.Empty;
    }

    // Read an identifier-valued field `key: SomeIdent` out of one object body.
    private static string? ParseIdentField(string obj, string name)
    {
        var re = new Regex("(?:^|[,{\\s])" + Regex.Escape(name) + "\\s*:\\s*([A-Za-z_$][\\w$]*)");
        var m = re.Match(obj);
        return m.Success ? m.Groups[1].Value : null;
    }

    // Read an array-valued field `key: [ ... ]` as the raw inner text.
    private static string? ParseArrayField(string obj, string name)
    {
        var re = new Regex("(?:^|[,{\\s])" + Regex.Escape(name) + "\\s*:\\s*\\[");
        var m = re.Match(obj);
        if (!m.Success)
        {
            return null;
        }

        var open = m.Index + m.Length - 1;
        var close = MatchingClose(obj, open);
        if (close < 0)
        {
            return null;
        }

        return obj[(open + 1)..close];
    }

    // ------------------------------------------------------------------
    // Shared helpers
    // ------------------------------------------------------------------
    private static bool PackageJsonHasDependency(string packageJson, Func<string, bool> keyMatches)
    {
        try
        {
            using var doc = JsonDocument.Parse(packageJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            foreach (var section in DependencySections)
            {
                if (root.TryGetProperty(section, out var deps) && deps.ValueKind == JsonValueKind.Object)
                {
                    foreach (var prop in deps.EnumerateObject())
                    {
                        if (keyMatches(prop.Name))
                        {
                            return true;
                        }
                    }
                }
            }
        }
        catch (JsonException)
        {
            // Invalid JSON — fall through to the source scan.
        }

        return false;
    }

    private static readonly string[] DependencySections = { "dependencies", "devDependencies" };

    private static char CharAt(string s, int i) => i >= 0 && i < s.Length ? s[i] : '\0';

    private static int LineAt(string s, int index)
    {
        var line = 1;
        var limit = Math.Min(index, s.Length);
        for (var i = 0; i < limit; i++)
        {
            if (s[i] == '\n')
            {
                line++;
            }
        }

        return line;
    }

    private static CodeGraphNode RouteNode(
        string id, string name, string qualifiedName, string filePath, int line, int endColumn, string language, long now) =>
        new(
            Id: id,
            Kind: CodeGraphNodeKind.Route,
            Name: name,
            QualifiedName: qualifiedName,
            FilePath: filePath,
            Language: language,
            StartLine: line,
            EndLine: line,
            StartColumn: 0,
            EndColumn: endColumn,
            Docstring: null,
            Signature: null,
            Visibility: null,
            IsExported: false,
            IsAsync: false,
            IsStatic: false,
            IsAbstract: false,
            Decorators: null,
            TypeParameters: null,
            ReturnType: null,
            UpdatedAt: now);

    private static CodeGraphUnresolvedReference RouteRef(
        string fromNodeId, string referenceName, string referenceKind, int line, string filePath, string language) =>
        new(
            FromNodeId: fromNodeId,
            ReferenceName: referenceName,
            ReferenceKind: referenceKind,
            Line: line,
            Column: 0,
            FilePath: filePath,
            Language: language,
            Candidates: null,
            RowId: null);

    // ------------------------------------------------------------------
    // Fixed patterns ([GeneratedRegex]) — verbatim from nestjs.ts
    // ------------------------------------------------------------------
    [GeneratedRegex(@"\.(m?js|tsx?|cjs)$")]
    private static partial Regex ExtGuardRegex();

    [GeneratedRegex(@"\.module\.(m?[jt]s|cjs)$")]
    private static partial Regex ModuleFileRegex();

    [GeneratedRegex(@"\bRouterModule\s*\.\s*(?:register|forRoot|forChild)\s*\(")]
    private static partial Regex RouterModuleRegex();

    [GeneratedRegex(@"['""`]([^'""`]*)['""`]")]
    private static partial Regex StringArgRegex();

    [GeneratedRegex(@"path\s*:\s*['""`]([^'""`]*)['""`]")]
    private static partial Regex ControllerPathRegex();

    [GeneratedRegex(@"namespace\s*:\s*['""`]([^'""`]*)['""`]")]
    private static partial Regex GatewayNamespaceRegex();

    [GeneratedRegex(@"name\s*:\s*['""`]([^'""`]*)['""`]")]
    private static partial Regex GqlNameRegex();

    [GeneratedRegex(@"^\s*['""`]([^'""`]*)['""`]")]
    private static partial Regex GqlLeadRegex();

    [GeneratedRegex(@"^/+|/+$")]
    private static partial Regex SlashTrimRegex();

    [GeneratedRegex(@"^[A-Za-z_$][\w$]*$")]
    private static partial Regex ControllerIdentRegex();

    [GeneratedRegex(@"\G\s*")]
    private static partial Regex WsStickyRegex();

    [GeneratedRegex(@"\G@[\w.]+")]
    private static partial Regex DecoNameStickyRegex();

    [GeneratedRegex(@"\G(?:public|private|protected|async|static)\b")]
    private static partial Regex ModifierStickyRegex();

    [GeneratedRegex(@"\G([A-Za-z_$][\w$]*)\s*\(")]
    private static partial Regex IdentStickyRegex();

    [GeneratedRegex(@"\G(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)")]
    private static partial Regex ClassDeclStickyRegex();
}
