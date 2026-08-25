using System.Runtime.CompilerServices;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphSwiftObjcBridgeResolver — Swift <-> Objective-C bridge resolver (port of
// frameworks/swift-objc.ts + the swiftBaseNamesForObjcSelector / isObjcExposed name-math
// from resolution/swift-objc-bridge.ts). Closes both cross-language call directions in
// mixed iOS codebases:
//   * Swift call -> ObjC method: from a bare Swift name, look up ObjC methods whose
//     bridged Swift base name matches (via a reverse-bridge map, built once per context).
//   * ObjC call -> Swift method: from an ObjC selector, derive candidate Swift base
//     names and bind to an @objc-exposed Swift method/function.
//
// Every produced edge is resolvedBy 'framework' with confidence 0.6. Global namespace,
// all-internal, reflection-free/AOT; fixed patterns via [GeneratedRegex]. The per-context
// reverse-bridge map (a JS WeakMap) is a ConditionalWeakTable.
// =============================================================================
internal sealed partial class CodeGraphSwiftObjcBridgeResolver : ICodeGraphFrameworkResolver
{
    private static readonly string[] BridgeLanguages = { CodeGraphLanguage.Swift, CodeGraphLanguage.ObjC };

    // Read line above + the declaration line — Swift attributes typically sit on the
    // preceding line or inline.
    private const int SourceProbeLines = 3;

    // Names too generic to bridge with precision (common Cocoa / NSObject conventions);
    // the regular name-matcher already handles refs of these names.
    private static readonly HashSet<string> GenericNames = new(StringComparer.Ordinal)
    {
        "init", "description", "debugDescription", "hash", "isEqual", "isEqualTo", "copy",
        "mutableCopy", "class", "self", "count", "length", "value", "name", "data", "string",
        "object", "add", "remove", "update", "load", "save", "reload", "cancel", "start", "stop",
        "pause", "resume", "close", "open", "show", "hide", "toString", "dealloc", "release",
        "retain", "autorelease"
    };

    // Memoized "Swift base name -> ObjC method nodes" map, keyed by context identity.
    private static readonly ConditionalWeakTable<CodeGraphResolutionContext, Dictionary<string, List<CodeGraphNode>>>
        ObjcByCandidateSwiftBase = new();

    public string Name => "swift-objc-bridge";

    public IReadOnlyList<string>? Languages => BridgeLanguages;

    public bool Detect(CodeGraphResolutionContext ctx)
    {
        var hasSwift = false;
        var hasObjc = false;
        foreach (var f in ctx.GetAllFiles())
        {
            if (f.EndsWith(".swift", StringComparison.Ordinal))
            {
                hasSwift = true;
            }
            else if (f.EndsWith(".m", StringComparison.Ordinal) || f.EndsWith(".mm", StringComparison.Ordinal))
            {
                hasObjc = true;
            }

            if (hasSwift && hasObjc)
            {
                return true;
            }
        }

        return false;
    }

    // Selector-shape references (containing ':') name no Swift node — opt them through
    // the name-exists pre-filter so they reach Resolve().
    public bool ClaimsReference(string name) => name.Contains(':');

    public CodeGraphResolvedRef? Resolve(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        if (r.Language == CodeGraphLanguage.Swift)
        {
            return ResolveSwiftCallToObjc(r, ctx);
        }

        if (r.Language == CodeGraphLanguage.ObjC)
        {
            return ResolveObjcCallToSwift(r, ctx);
        }

        return null;
    }

    private static CodeGraphResolvedRef? ResolveSwiftCallToObjc(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var rawName = LastDotSegment(r.ReferenceName);
        var map = BuildObjcMap(ctx);
        if (!map.TryGetValue(rawName, out var candidates) || candidates.Count == 0)
        {
            return null;
        }

        var target = candidates[0];
        return new CodeGraphResolvedRef(target.Id, 0.6, CodeGraphResolvedBy.Framework);
    }

    private static CodeGraphResolvedRef? ResolveObjcCallToSwift(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var rawSelector = LastDotSegment(r.ReferenceName);

        // Bridge math only applies to selector-shape names (contain ':').
        if (!rawSelector.Contains(':'))
        {
            return null;
        }

        foreach (var candidate in SwiftBaseNamesForObjcSelector(rawSelector))
        {
            foreach (var match in ctx.GetNodesByName(candidate))
            {
                if (match.Language != CodeGraphLanguage.Swift ||
                    (match.Kind != CodeGraphNodeKind.Method && match.Kind != CodeGraphNodeKind.Function))
                {
                    continue;
                }

                var window = DeclarationSourceWindow(match, ctx);
                if (IsObjcExposed(window))
                {
                    return new CodeGraphResolvedRef(match.Id, 0.6, CodeGraphResolvedBy.Framework);
                }
            }
        }

        return null;
    }

    // Build the reverse-bridge map: for every ObjC method node, record it under each
    // Swift base name that would auto-bridge to its selector. Runs once per context.
    private static Dictionary<string, List<CodeGraphNode>> BuildObjcMap(CodeGraphResolutionContext ctx)
    {
        if (ObjcByCandidateSwiftBase.TryGetValue(ctx, out var cached))
        {
            return cached;
        }

        var map = new Dictionary<string, List<CodeGraphNode>>(StringComparer.Ordinal);
        foreach (var node in ctx.GetNodesByKind(CodeGraphNodeKind.Method))
        {
            if (node.Language != CodeGraphLanguage.ObjC)
            {
                continue;
            }

            foreach (var c in SwiftBaseNamesForObjcSelector(node.Name))
            {
                // Skip the trivial verbatim case (name-matcher handles it) and generic names.
                if (c == node.Name && !node.Name.Contains(':'))
                {
                    continue;
                }

                if (GenericNames.Contains(c))
                {
                    continue;
                }

                if (map.TryGetValue(c, out var arr))
                {
                    arr.Add(node);
                }
                else
                {
                    map[c] = new List<CodeGraphNode> { node };
                }
            }
        }

        ObjcByCandidateSwiftBase.AddOrUpdate(ctx, map);
        return map;
    }

    // Read a small window of source ending at node.startLine, for @objc/@nonobjc probing.
    private static string DeclarationSourceWindow(CodeGraphNode node, CodeGraphResolutionContext ctx)
    {
        var content = ctx.ReadFile(node.FilePath);
        if (content is null)
        {
            return string.Empty;
        }

        var lines = SplitLines(content);
        var startIdx = Math.Max(0, node.StartLine - 1 - SourceProbeLines);
        var endIdx = Math.Min(lines.Length, node.StartLine);
        if (endIdx <= startIdx)
        {
            return string.Empty;
        }

        return string.Join('\n', lines[startIdx..endIdx]);
    }

    // ── Bridge name-math (≙ resolution/swift-objc-bridge.ts) ───────────────────

    // From an ObjC selector, the candidate Swift base names the resolver should try.
    // Insertion order is preserved (the first candidate is always the raw first keyword).
    private static List<string> SwiftBaseNamesForObjcSelector(string selector)
    {
        var result = new List<string>();
        if (selector.Length == 0)
        {
            return result;
        }

        var keywords = selector.TrimEnd(':').Split(':');
        var firstKeyword = keywords[0];
        if (firstKeyword.Length == 0)
        {
            return result;
        }

        var seen = new HashSet<string>(StringComparer.Ordinal);

        void Add(string s)
        {
            if (s.Length > 0 && seen.Add(s))
            {
                result.Add(s);
            }
        }

        Add(firstKeyword);

        if (firstKeyword.StartsWith("initWith", StringComparison.Ordinal))
        {
            Add("init");
        }

        var prep = PrepositionRegex().Match(firstKeyword);
        if (prep.Success && prep.Groups[1].Value.Length > 0)
        {
            Add(prep.Groups[1].Value);
        }

        if (keywords.Length == 1 && SetterRegex().IsMatch(firstKeyword) && selector.EndsWith(':'))
        {
            var propName = LowerFirst(firstKeyword[3..]);
            Add(propName);
        }

        return result;
    }

    // @nonobjc opts out even when @objc is also present; otherwise @objc = exposed.
    private static bool IsObjcExposed(string sourceSlice)
    {
        if (NonObjcRegex().IsMatch(sourceSlice))
        {
            return false;
        }

        return ObjcRegex().IsMatch(sourceSlice);
    }

    private static string LowerFirst(string s) =>
        s.Length > 0 ? char.ToLowerInvariant(s[0]) + s[1..] : s;

    // ref.referenceName after the final '.', or the whole string.
    private static string LastDotSegment(string name)
    {
        var idx = name.LastIndexOf('.');
        return idx >= 0 ? name[(idx + 1)..] : name;
    }

    // Split on /\r?\n/ (drop the '\r' consumed by the delimiter).
    private static string[] SplitLines(string content)
    {
        var parts = content.Split('\n');
        for (var i = 0; i < parts.Length; i++)
        {
            if (parts[i].Length > 0 && parts[i][^1] == '\r')
            {
                parts[i] = parts[i][..^1];
            }
        }

        return parts;
    }

    [GeneratedRegex(@"^([a-z][a-zA-Z0-9]*?)(?:With|For|By|In|On|At|From|To|Of|As)[A-Z]")]
    private static partial Regex PrepositionRegex();

    [GeneratedRegex(@"^set[A-Z]")]
    private static partial Regex SetterRegex();

    [GeneratedRegex(@"@nonobjc\b")]
    private static partial Regex NonObjcRegex();

    [GeneratedRegex(@"@objc\b")]
    private static partial Regex ObjcRegex();
}
