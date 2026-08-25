using System.Text.Json;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphDrupalResolver — Drupal 8/9/10/11 framework resolver (port of
// resolution/frameworks/drupal.ts; analysis/02 §3.3 row 2). Contributes:
//   * detect(): composer.json (`name`/`type`/`require` "drupal/*") JSON parse, with a
//     `*.info.yml` + `.module`/`.routing.yml`/… fallback for composer-less modules.
//   * extract(): `route` nodes from `*.routing.yml` (hand-parsed) with `references` to
//     the `_controller`/`_form`/entity handler; and hook-implementation refs from
//     `.module`/`.install`/`.theme`/`.inc`/`.php` files (docblock `@Implements hook_X()`
//     + `{module}_{hook}` name pattern). Hook refs point from the implementing
//     function node — whose id is RECONSTRUCTED via CodeGraphNodeIdFactory (the same
//     formula tree-sitter extraction used) — to the canonical `hook_X` name.
//   * resolve(): FQCN `Class::method` / bare-FQCN form / `hook_X` → the graph node.
//
// GLOBAL namespace, all-internal, reflection-free/AOT. composer.json via JsonDocument
// (never Deserialize<T>); YAML/hooks hand-scanned; [GeneratedRegex] fixed patterns.
// =============================================================================
internal sealed partial class CodeGraphDrupalResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] DrupalLanguages = { CodeGraphLanguage.Php, CodeGraphLanguage.Yaml };

    private static readonly CodeGraphFrameworkExtraction EmptyExtraction =
        new(Array.Empty<CodeGraphNode>(), Array.Empty<CodeGraphUnresolvedReference>());

    // Files scanned for hook implementations (drupal.ts:205).
    private static readonly string[] HookFileExtensions = { ".module", ".install", ".theme", ".inc" };

    private static readonly string[] ComposerDepSections = { "require", "require-dev" };

    public string Name => "drupal";

    public IReadOnlyList<string>? Languages => DrupalLanguages;

    // Drupal route handlers are FQCNs (`\Drupal\…\Class::method`, single-colon
    // controller-service `\Drupal\…\Class:method`, or bare `\…\FormClass`) and hook
    // refs are canonical `hook_*` names — none match a declared symbol, so the
    // name-existence pre-filter would drop them. Claim the shapes resolve() handles.
    public bool ClaimsReference(string name) =>
        name.StartsWith("hook_", StringComparison.Ordinal) ||
        name.Contains('\\') ||
        ClaimShapeRegex().IsMatch(name);

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        // Primary: composer.json identifies a Drupal project/module/theme/profile. A
        // contrib module often has an EMPTY `require` but still declares
        // `"name": "drupal/<module>"` + `"type": "drupal-module"`, so check those too.
        var composer = ctx.ReadFile("composer.json");
        if (composer is not null)
        {
            try
            {
                using var doc = JsonDocument.Parse(composer);
                var root = doc.RootElement;
                if (root.ValueKind == JsonValueKind.Object)
                {
                    if (root.TryGetProperty("name", out var name) && name.ValueKind == JsonValueKind.String &&
                        name.GetString()!.StartsWith("drupal/", StringComparison.Ordinal))
                    {
                        return true;
                    }

                    if (root.TryGetProperty("type", out var type) && type.ValueKind == JsonValueKind.String &&
                        type.GetString()!.StartsWith("drupal-", StringComparison.Ordinal))
                    {
                        return true;
                    }

                    foreach (var section in ComposerDepSections)
                    {
                        if (root.TryGetProperty(section, out var deps) && deps.ValueKind == JsonValueKind.Object)
                        {
                            foreach (var dep in deps.EnumerateObject())
                            {
                                if (dep.Name.StartsWith("drupal/", StringComparison.Ordinal))
                                {
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
            catch (JsonException)
            {
                // malformed composer.json — fall through to file-based detection
            }
        }

        // Fallback: a `*.info.yml` manifest alongside a Drupal PHP/route file. Require
        // both so a stray `.info.yml` elsewhere doesn't trigger a false positive.
        var files = ctx.GetAllFiles();
        var hasInfoYml = false;
        foreach (var f in files)
        {
            if (f.EndsWith(".info.yml", StringComparison.Ordinal))
            {
                hasInfoYml = true;
                break;
            }
        }

        if (!hasInfoYml)
        {
            return false;
        }

        foreach (var f in files)
        {
            if (f.EndsWith(".routing.yml", StringComparison.Ordinal) ||
                f.EndsWith(".module", StringComparison.Ordinal) ||
                f.EndsWith(".install", StringComparison.Ordinal) ||
                f.EndsWith(".theme", StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;

        // _controller: '\Drupal\…\ClassName::methodName' (double colon) or the
        // single-colon controller-service form '\Drupal\…\ClassName:methodName'.
        var controllerMatch = ControllerRefRegex().Match(name);
        if (controllerMatch.Success)
        {
            var className = controllerMatch.Groups[1].Value;
            var methodName = controllerMatch.Groups[2].Value;
            foreach (var cls in ctx.GetNodesByName(className))
            {
                if (cls.Kind != CodeGraphNodeKind.Class)
                {
                    continue;
                }

                foreach (var n in ctx.GetNodesInFile(cls.FilePath))
                {
                    if (n.Kind == CodeGraphNodeKind.Method && n.Name == methodName)
                    {
                        return new CodeGraphResolvedRef(n.Id, 0.9, CodeGraphResolvedBy.Framework);
                    }
                }

                return new CodeGraphResolvedRef(cls.Id, 0.7, CodeGraphResolvedBy.Framework);
            }
        }

        // _form / _entity_form: '\Drupal\…\ClassName' (bare FQCN, no method).
        if (name.Contains('\\') && !name.Contains(':'))
        {
            var className = LastSegment(name);
            if (!string.IsNullOrEmpty(className))
            {
                foreach (var cls in ctx.GetNodesByName(className))
                {
                    if (cls.Kind == CodeGraphNodeKind.Class)
                    {
                        return new CodeGraphResolvedRef(cls.Id, 0.85, CodeGraphResolvedBy.Framework);
                    }
                }
            }
        }

        // hook_X — find any function named `*_{hookSuffix}` in a hook file.
        if (name.StartsWith("hook_", StringComparison.Ordinal))
        {
            var suffix = "_" + name.Substring(5);
            foreach (var n in ctx.GetNodesByKind(CodeGraphNodeKind.Function))
            {
                if (n.Name.EndsWith(suffix, StringComparison.Ordinal) && IsDrupalHookFile(n.FilePath))
                {
                    return new CodeGraphResolvedRef(n.Id, 0.75, CodeGraphResolvedBy.Framework);
                }
            }
        }

        return null;
    }

    public CodeGraphFrameworkExtraction? Extract(string filePath, string content)
    {
        if (filePath.EndsWith(".routing.yml", StringComparison.Ordinal))
        {
            return ExtractDrupalRoutes(filePath, content);
        }

        if (IsDrupalHookFile(filePath) || filePath.EndsWith(".php", StringComparison.Ordinal))
        {
            return ExtractDrupalHooks(filePath, content);
        }

        return EmptyExtraction;
    }

    // Parse a Drupal `*.routing.yml` into route nodes + handler references (drupal.ts:97).
    private static CodeGraphFrameworkExtraction ExtractDrupalRoutes(string filePath, string content)
    {
        var nodes = new List<CodeGraphNode>();
        var references = new List<CodeGraphUnresolvedReference>();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        var lines = content.Split('\n');

        string? pendingName = null;
        var pendingLine = 0;
        string? currentPath = null;
        var handlerRefs = new List<string>();
        var methods = new List<string>();

        void FlushRoute()
        {
            if (pendingName is null || currentPath is null)
            {
                return;
            }

            var methodTag = methods.Count > 0 ? $" [{string.Join(",", methods)}]" : string.Empty;
            var routeNode = new CodeGraphNode(
                $"route:{filePath}:{pendingLine}:{currentPath}", CodeGraphNodeKind.Route, $"{currentPath}{methodTag}",
                $"{filePath}::{pendingName}", filePath, CodeGraphLanguage.Yaml, pendingLine, pendingLine, 0, 0,
                null, null, null, false, false, false, false, null, null, null, now);
            nodes.Add(routeNode);

            foreach (var handler in handlerRefs)
            {
                references.Add(new CodeGraphUnresolvedReference(
                    routeNode.Id, handler, CodeGraphEdgeKind.References, pendingLine, 0, filePath, CodeGraphLanguage.Yaml, null, null));
            }
        }

        for (var i = 0; i < lines.Length; i++)
        {
            var line = lines[i];
            var trimmed = line.Trim();
            if (trimmed.Length == 0 || trimmed.StartsWith('#'))
            {
                continue;
            }

            // Top-level route name: no leading whitespace, ends with a colon (no value).
            // `^\S…` already implies the `!/^\s/` guard the TS spells out explicitly.
            if (TopLevelKeyRegex().IsMatch(line))
            {
                FlushRoute();
                pendingName = trimmed.Substring(0, trimmed.Length - 1).Trim();
                pendingLine = i + 1;
                currentPath = null;
                handlerRefs = new List<string>();
                methods = new List<string>();
                continue;
            }

            var pathM = PathRegex().Match(trimmed);
            if (pathM.Success)
            {
                currentPath = pathM.Groups[1].Value.Trim();
                continue;
            }

            var ctrlM = ControllerLineRegex().Match(trimmed);
            if (ctrlM.Success)
            {
                handlerRefs.Add(ctrlM.Groups[1].Value.Trim());
                continue;
            }

            var formM = FormLineRegex().Match(trimmed);
            if (formM.Success)
            {
                handlerRefs.Add(formM.Groups[1].Value.Trim());
                continue;
            }

            var entM = EntityLineRegex().Match(trimmed);
            if (entM.Success)
            {
                handlerRefs.Add(entM.Groups[2].Value.Trim());
                continue;
            }

            var methM = MethodsLineRegex().Match(trimmed);
            if (methM.Success)
            {
                methods = SplitMethods(methM.Groups[1].Value);
            }
        }

        FlushRoute();
        return new CodeGraphFrameworkExtraction(nodes, references);
    }

    // Extract hook-implementation references from a Drupal PHP file (drupal.ts:226).
    // Emits NO nodes — refs point FROM the implementing function node (id reconstructed
    // via CodeGraphNodeIdFactory) TO the canonical hook name.
    private static CodeGraphFrameworkExtraction ExtractDrupalHooks(string filePath, string content)
    {
        var references = new List<CodeGraphUnresolvedReference>();

        // funcName -> 1-indexed line, mirroring tree-sitter's numbering (first def wins).
        var funcLineMap = new Dictionary<string, int>(StringComparer.Ordinal);
        var funcOrder = new List<string>();
        foreach (Match fm in FuncDefRegex().Matches(content))
        {
            var fname = fm.Groups[1].Value;
            if (!funcLineMap.ContainsKey(fname))
            {
                funcLineMap[fname] = LineAt(content, fm.Index);
                funcOrder.Add(fname);
            }
        }

        void EmitHookRef(string hookName, string funcName)
        {
            if (!funcLineMap.TryGetValue(funcName, out var lineNum))
            {
                return;
            }

            var nodeId = CodeGraphNodeIdFactory.NodeId(filePath, CodeGraphNodeKind.Function, funcName, lineNum);
            references.Add(new CodeGraphUnresolvedReference(
                nodeId, hookName, CodeGraphEdgeKind.References, lineNum, 0, filePath, CodeGraphLanguage.Php, null, null));
        }

        // Strategy A: docblock `Implements hook_X().` immediately preceding a function.
        var docblockMatched = new HashSet<string>(StringComparer.Ordinal);
        foreach (Match m in DocblockHookRegex().Matches(content))
        {
            EmitHookRef(m.Groups[1].Value, m.Groups[2].Value);
            docblockMatched.Add(m.Groups[2].Value);
        }

        // Strategy B: fallback name pattern `{moduleName}_{hookSuffix}` for functions
        // without docblocks (not already matched by Strategy A).
        var moduleName = ModuleNameFromPath(filePath);
        if (moduleName is not null)
        {
            var prefix = moduleName + "_";
            foreach (var funcName in funcOrder)
            {
                if (docblockMatched.Contains(funcName) || !funcName.StartsWith(prefix, StringComparison.Ordinal))
                {
                    continue;
                }

                var hookSuffix = funcName.Substring(prefix.Length);
                if (hookSuffix.Length == 0)
                {
                    continue;
                }

                EmitHookRef($"hook_{hookSuffix}", funcName);
            }
        }

        return new CodeGraphFrameworkExtraction(Array.Empty<CodeGraphNode>(), references);
    }

    private static bool IsDrupalHookFile(string filePath)
    {
        foreach (var ext in HookFileExtensions)
        {
            if (filePath.EndsWith(ext, StringComparison.Ordinal))
            {
                return true;
            }
        }

        return false;
    }

    // Last PHP namespace segment of a FQCN like `\Drupal\mymodule\Controller\Foo`, or
    // null when the string doesn't look like a FQCN (drupal.ts:62).
    private static string? LastSegment(string fqcn)
    {
        var clean = LeadingBackslashRegex().Replace(fqcn, string.Empty).Trim();
        if (!clean.Contains('\\'))
        {
            return null;
        }

        var parts = clean.Split('\\');
        return parts.Length > 0 ? parts[^1] : null;
    }

    // Drupal module name from a file path (drupal.ts:73):
    //   web/modules/custom/my_module/my_module.module -> my_module
    private static string? ModuleNameFromPath(string filePath)
    {
        var m = ModulePathRegex().Match(filePath);
        return m.Success ? m.Groups[1].Value : null;
    }

    // `[GET, POST]` -> ["GET","POST"] (trim, upper, drop empties).
    private static List<string> SplitMethods(string list)
    {
        var result = new List<string>();
        foreach (var part in list.Split(','))
        {
            var m = part.Trim().ToUpperInvariant();
            if (m.Length > 0)
            {
                result.Add(m);
            }
        }

        return result;
    }

    // 1-based line of `index` (≙ content.slice(0, index).split('\n').length).
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

    // ── Fixed patterns ([GeneratedRegex]) — verbatim from drupal.ts ────────────

    [GeneratedRegex(@"^[A-Za-z_]\w*::?\w+$")]
    private static partial Regex ClaimShapeRegex();

    [GeneratedRegex(@"^\\?(?:Drupal\\[^:]+\\)?([^\\:]+):{1,2}(\w+)$")]
    private static partial Regex ControllerRefRegex();

    [GeneratedRegex(@"^\\+")]
    private static partial Regex LeadingBackslashRegex();

    [GeneratedRegex(@"/([^/]+)\.[^./]+$")]
    private static partial Regex ModulePathRegex();

    [GeneratedRegex(@"^function\s+(\w+)\s*\(", RegexOptions.Multiline)]
    private static partial Regex FuncDefRegex();

    [GeneratedRegex(@"/\*\*[\s\S]*?(?:@|\*\s+)Implements\s+(hook_\w+)\s*\(\)[\s\S]*?\*/\s*\n(?:\s*\n)*function\s+(\w+)\s*\(")]
    private static partial Regex DocblockHookRegex();

    [GeneratedRegex(@"^\S.*:\s*$")]
    private static partial Regex TopLevelKeyRegex();

    [GeneratedRegex(@"^path:\s*['""]?([^'""#\n]+?)['""]?\s*(?:#.*)?$")]
    private static partial Regex PathRegex();

    [GeneratedRegex(@"^_controller:\s*['""]?([^'""#\n]+?)['""]?\s*(?:#.*)?$")]
    private static partial Regex ControllerLineRegex();

    [GeneratedRegex(@"^_form:\s*['""]?([^'""#\n]+?)['""]?\s*(?:#.*)?$")]
    private static partial Regex FormLineRegex();

    [GeneratedRegex(@"^_(entity_form|entity_list|entity_view):\s*['""]?([^'""#\n]+?)['""]?\s*(?:#.*)?$")]
    private static partial Regex EntityLineRegex();

    [GeneratedRegex(@"^methods:\s*\[([^\]]+)\]")]
    private static partial Regex MethodsLineRegex();
}
