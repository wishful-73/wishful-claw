using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphNameMatcher — the name-strategy matcher (≙ name-matcher.ts). This is
// the M3c Match slice: the real matchReference ladder (matchByFilePath ->
// matchByQualifiedName -> C++/scoped/dotted call-chain matchers -> matchMethodCall
// -> matchByExactName -> matchFuzzy), findBestMatch / preferCallSiteFile scoring,
// matchFunctionRef (callback-as-value), and matchMethodCall + resolveMethodOnType.
// Receiver-type inference lives in CodeGraphReceiverTypeInference (the heavy part).
//
// Language-family predicates (sameLanguageFamily / crossesKnownFamily) live in
// CodeGraphLanguageFamily (core-owned) — reused here, never redefined. Scoring
// constants are reproduced VERBATIM for ranking parity.
//
// Stateless: every entry point takes (ref, ctx); the ctx facade is the sole graph/
// fs access. The public methods keep the exact signatures the resolver calls.
// GLOBAL namespace, all-internal, reflection-free/AOT. Fixed regexes are
// [GeneratedRegex]; the CodeGraphReferenceResolver's ChainShape is duplicated here
// as ChainShapeRegex (each file owns its compiled patterns).
// =============================================================================
internal sealed partial class CodeGraphNameMatcher
{
    // Ceiling on how many same-named definitions the FUZZY name-match strategies
    // will score (name-matcher.ts:28). Above it, exact-name / method-call Strategy 3
    // decline rather than emit a low-confidence, almost-certainly-wrong edge — this
    // also caps per-ref cost at O(ceiling) (the #999 "Resolving refs" wedge).
    private const int DefaultAmbiguousNameCeiling = 500;
    private static readonly int AmbiguousNameCeiling = ResolveAmbiguousNameCeiling();

    // ArkUI attribute-helper decorators a `.attr(...)` chain may resolve to.
    private static readonly HashSet<string> ArkuiAttributeDecorators = new(StringComparer.Ordinal)
    {
        "Extend", "Styles", "AnimatableExtend", "Builder"
    };

    // Languages where an unprefixed capitalized call `Foo(args)` constructs the class
    // (name-matcher.ts:880 CONSTRUCTS_VIA_BARE_CALL).
    private static readonly HashSet<string> ConstructsViaBareCall = new(StringComparer.Ordinal)
    {
        CodeGraphLanguage.Kotlin, CodeGraphLanguage.Swift, CodeGraphLanguage.Scala,
        CodeGraphLanguage.Dart, CodeGraphLanguage.Pascal
    };

    private static int ResolveAmbiguousNameCeiling()
    {
        var raw = Environment.GetEnvironmentVariable("CODEGRAPH_AMBIGUOUS_NAME_CEILING");
        if (string.IsNullOrEmpty(raw))
        {
            return DefaultAmbiguousNameCeiling;
        }

        return int.TryParse(raw, out var parsed) && parsed > 0 ? parsed : DefaultAmbiguousNameCeiling;
    }

    // ── Public entry points (the resolver calls these; keep signatures exact) ──

    // The name strategy (index.ts strategy 3): try matchers by descending confidence
    // and return the best, or null. function_ref refs route to matchFunctionRef only.
    public CodeGraphResolvedRef? MatchReference(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx) =>
        MatchReferenceImpl(r, ctx);

    // Function-as-value refs (#756): exact name, function/method targets only, same
    // language family, same-file first, cross-file only when unique.
    public CodeGraphResolvedRef? MatchFunctionRef(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx) =>
        MatchFunctionRefImpl(r, ctx);

    // Dotted static-factory / fluent chain `inner().method` on a dotted-receiver
    // language — resolves the method on the inner call's return type (#750).
    public CodeGraphResolvedRef? MatchDottedCallChain(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx) =>
        MatchDottedCallChainImpl(r, ctx);

    // `::`-receiver chain variant (PHP `Cls::for()->m` / Rust `Foo::new().bar`).
    public CodeGraphResolvedRef? MatchScopedCallChain(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx) =>
        MatchScopedCallChainImpl(r, ctx);

    // Method-call resolution with receiver-type inference (`obj.method` /
    // `Class::method` / PHP `this->prop.method`).
    public CodeGraphResolvedRef? MatchMethodCall(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx) =>
        MatchMethodCallImpl(r, ctx);

    // ── matchReference ladder (name-matcher.ts:1911) ──────────────────────────
    private static CodeGraphResolvedRef? MatchReferenceImpl(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var name = r.ReferenceName;

        // Function-as-value refs (#756) resolve ONLY through the dedicated matcher.
        if (r.ReferenceKind == CodeGraphEdgeKind.FunctionRef)
        {
            return MatchFunctionRefImpl(r, ctx);
        }

        // ArkTS chained UI attributes — emitted with a leading dot — resolve ONLY to
        // decorator-marked attribute helpers (@Extend/@Styles/@AnimatableExtend/@Builder).
        if (lang == CodeGraphLanguage.ArkTs && name.StartsWith('.'))
        {
            var baseName = name[1..];
            var candidates = new List<CodeGraphNode>();
            foreach (var n in ctx.GetNodesByName(baseName))
            {
                if (n.Language == CodeGraphLanguage.ArkTs && n.Kind == CodeGraphNodeKind.Function && HasArkuiDecorator(n))
                {
                    candidates.Add(n);
                }
            }

            var chosen = candidates.Count > 1 ? PreferCallSiteFile(candidates, r.FilePath ?? string.Empty) : candidates;
            if (chosen.Count != 1)
            {
                return null;
            }

            return new CodeGraphResolvedRef(chosen[0].Id, 0.85, CodeGraphResolvedBy.ExactMatch);
        }

        // Erlang `-behaviour(m)` / `.app` resource refs target a MODULE (namespace).
        if (lang == CodeGraphLanguage.Erlang &&
            (r.ReferenceKind == CodeGraphEdgeKind.Implements || AppSrcRegex().IsMatch(r.FilePath ?? string.Empty)))
        {
            var modules = new List<CodeGraphNode>();
            foreach (var n in ctx.GetNodesByName(name))
            {
                if (n.Language == CodeGraphLanguage.Erlang && n.Kind == CodeGraphNodeKind.Namespace)
                {
                    modules.Add(n);
                }
            }

            var ordered = PreferCallSiteFile(modules, r.FilePath ?? string.Empty);
            if (ordered.Count == 0)
            {
                return null;
            }

            return new CodeGraphResolvedRef(ordered[0].Id, 0.9, CodeGraphResolvedBy.ExactMatch);
        }

        // Try strategies in order of confidence.
        var result = MatchByFilePath(r, ctx);
        if (result != null)
        {
            return result;
        }

        result = MatchByQualifiedName(r, ctx);
        if (result != null)
        {
            return result;
        }

        // 1b. C++ chained call whose receiver is another call (#645).
        if (lang == CodeGraphLanguage.Cpp || lang == CodeGraphLanguage.C)
        {
            result = MatchCppCallChain(r, ctx);
            if (result != null)
            {
                return result;
            }
        }

        // 1c. `::`-scoped factory chain — PHP (#608) / Rust.
        if (lang == CodeGraphLanguage.Php || lang == CodeGraphLanguage.Rust)
        {
            result = MatchScopedCallChainImpl(r, ctx);
            if (result != null)
            {
                return result;
            }
        }

        // 1d. Dotted chained static-factory / fluent call.
        if (lang is CodeGraphLanguage.Java or CodeGraphLanguage.Kotlin or CodeGraphLanguage.CSharp or
            CodeGraphLanguage.Swift or CodeGraphLanguage.Go or CodeGraphLanguage.Scala or
            CodeGraphLanguage.Dart or CodeGraphLanguage.ObjC or CodeGraphLanguage.Pascal)
        {
            result = MatchDottedCallChainImpl(r, ctx);
            if (result != null)
            {
                return result;
            }
        }

        // 2. Method call pattern.
        result = MatchMethodCallImpl(r, ctx);
        if (result != null)
        {
            return result;
        }

        // 3. Exact name match.
        result = MatchByExactName(r, ctx);
        if (result != null)
        {
            return result;
        }

        // 4. Fuzzy match (lowest confidence).
        return MatchFuzzy(r, ctx);
    }

    private static bool HasArkuiDecorator(CodeGraphNode n)
    {
        if (n.Decorators is null)
        {
            return false;
        }

        foreach (var d in n.Decorators)
        {
            if (ArkuiAttributeDecorators.Contains(d))
            {
                return true;
            }
        }

        return false;
    }

    // ── matchByFilePath (name-matcher.ts:41) ──────────────────────────────────
    private static CodeGraphResolvedRef? MatchByFilePath(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;
        if (!name.Contains('/') && !FileExtShapeRegex().IsMatch(name))
        {
            return null;
        }

        var slash = name.LastIndexOf('/');
        var fileName = slash >= 0 ? name[(slash + 1)..] : name;
        if (fileName.Length == 0)
        {
            return null;
        }

        var fileNodes = new List<CodeGraphNode>();
        foreach (var n in ctx.GetNodesByName(fileName))
        {
            if (n.Kind == CodeGraphNodeKind.File)
            {
                fileNodes.Add(n);
            }
        }

        if (fileNodes.Count == 0)
        {
            return null;
        }

        foreach (var n in fileNodes)
        {
            if (n.QualifiedName == name || n.FilePath == name)
            {
                return new CodeGraphResolvedRef(n.Id, 0.95, CodeGraphResolvedBy.FilePath);
            }
        }

        var suffixMatches = new List<CodeGraphNode>();
        foreach (var n in fileNodes)
        {
            if (n.QualifiedName.EndsWith(name, StringComparison.Ordinal) || n.FilePath.EndsWith(name, StringComparison.Ordinal))
            {
                suffixMatches.Add(n);
            }
        }

        if (suffixMatches.Count > 0)
        {
            return new CodeGraphResolvedRef(PickClosestFileNode(suffixMatches, r).Id, 0.85, CodeGraphResolvedBy.FilePath);
        }

        if (fileNodes.Count == 1)
        {
            return new CodeGraphResolvedRef(fileNodes[0].Id, 0.7, CodeGraphResolvedBy.FilePath);
        }

        return null;
    }

    // name-matcher.ts:113 pickClosestFileNode.
    private static CodeGraphNode PickClosestFileNode(List<CodeGraphNode> candidates, CodeGraphUnresolvedReference r)
    {
        var refLang = r.Language ?? CodeGraphLanguage.Unknown;
        var refFile = r.FilePath ?? string.Empty;
        var refDir = DirOf(refFile);
        var sameDir = new List<CodeGraphNode>();
        foreach (var c in candidates)
        {
            if (DirOf(c.FilePath) == refDir)
            {
                sameDir.Add(c);
            }
        }

        var pool = sameDir.Count > 0 ? sameDir : candidates;
        var best = pool[0];
        var bestScore = double.NegativeInfinity;
        foreach (var c in pool)
        {
            double score = ComputePathProximity(refFile, c.FilePath) + (CodeGraphLanguageFamily.SameFamily(c.Language, refLang) ? 5 : 0);
            if (score > bestScore)
            {
                bestScore = score;
                best = c;
            }
        }

        return best;
    }

    private static string DirOf(string p)
    {
        var i = p.LastIndexOf('/');
        return i >= 0 ? p[..i] : string.Empty;
    }

    // ── applyLanguageGate (name-matcher.ts:189) ───────────────────────────────
    private static List<CodeGraphNode> ApplyLanguageGate(IReadOnlyList<CodeGraphNode> candidates, CodeGraphUnresolvedReference r)
    {
        var refLang = r.Language ?? CodeGraphLanguage.Unknown;
        var kind = r.ReferenceKind;
        var result = new List<CodeGraphNode>();
        if (kind == CodeGraphEdgeKind.References || kind == CodeGraphEdgeKind.FunctionRef)
        {
            foreach (var c in candidates)
            {
                if (CodeGraphLanguageFamily.SameFamily(c.Language, refLang))
                {
                    result.Add(c);
                }
            }

            return result;
        }

        if (kind == CodeGraphEdgeKind.Imports)
        {
            foreach (var c in candidates)
            {
                if (!CodeGraphLanguageFamily.CrossesKnownFamily(c.Language, refLang))
                {
                    result.Add(c);
                }
            }

            return result;
        }

        foreach (var c in candidates)
        {
            result.Add(c);
        }

        return result;
    }

    // ── matchFunctionRef (name-matcher.ts:208) ────────────────────────────────
    private static CodeGraphResolvedRef? MatchFunctionRefImpl(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;
        var lang = r.Language ?? CodeGraphLanguage.Unknown;

        // `this.<member>` refs are resolved ONLY by the class-scoped resolver.
        if (name.StartsWith("this.", StringComparison.Ordinal))
        {
            return null;
        }

        var bareFnOnly = lang is CodeGraphLanguage.TypeScript or CodeGraphLanguage.Tsx or
            CodeGraphLanguage.JavaScript or CodeGraphLanguage.Jsx or CodeGraphLanguage.ArkTs or
            CodeGraphLanguage.Cpp or CodeGraphLanguage.Python or CodeGraphLanguage.Php;

        // Qualified member-pointer (`&Widget::on_click` → "Widget::on_click").
        if (name.Contains("::", StringComparison.Ordinal))
        {
            var memberName = name[(name.LastIndexOf("::", StringComparison.Ordinal) + 2)..];
            var suffix = "::" + name;
            var scoped = new List<CodeGraphNode>();
            foreach (var n in ctx.GetNodesByName(memberName))
            {
                if ((n.Kind == CodeGraphNodeKind.Function || n.Kind == CodeGraphNodeKind.Method) &&
                    CodeGraphLanguageFamily.SameFamily(n.Language, lang) &&
                    n.Id != r.FromNodeId &&
                    (n.QualifiedName == name || n.QualifiedName.EndsWith(suffix, StringComparison.Ordinal)))
                {
                    scoped.Add(n);
                }
            }

            if (scoped.Count == 0)
            {
                return null;
            }

            var sameFileScoped = new List<CodeGraphNode>();
            foreach (var n in scoped)
            {
                if (n.FilePath == r.FilePath)
                {
                    sameFileScoped.Add(n);
                }
            }

            var pool = sameFileScoped.Count > 0 ? sameFileScoped : scoped;
            if (sameFileScoped.Count == 0 && scoped.Count > 1)
            {
                return null;
            }

            return new CodeGraphResolvedRef(MinByStartLine(pool).Id, 0.9, CodeGraphResolvedBy.FunctionRef);
        }

        var candidates = new List<CodeGraphNode>();
        foreach (var n in ctx.GetNodesByName(name))
        {
            if ((n.Kind == CodeGraphNodeKind.Function || (!bareFnOnly && n.Kind == CodeGraphNodeKind.Method)) &&
                CodeGraphLanguageFamily.SameFamily(n.Language, lang) &&
                n.Id != r.FromNodeId)
            {
                candidates.Add(n);
            }
        }

        if (candidates.Count == 0)
        {
            return null;
        }

        // Swift implicit-self: a bare identifier names a METHOD only of the ENCLOSING type.
        if (lang == CodeGraphLanguage.Swift && AnyMethod(candidates))
        {
            var fromNode = ctx.GetNodeById(r.FromNodeId);
            var sep = fromNode != null ? fromNode.QualifiedName.LastIndexOf("::", StringComparison.Ordinal) : -1;
            var classPrefix = (fromNode != null && sep > 0) ? fromNode.QualifiedName[..sep] : null;
            var filtered = new List<CodeGraphNode>();
            foreach (var n in candidates)
            {
                if (n.Kind != CodeGraphNodeKind.Method)
                {
                    filtered.Add(n);
                    continue;
                }

                if (classPrefix is null)
                {
                    continue;
                }

                var mSep = n.QualifiedName.LastIndexOf("::", StringComparison.Ordinal);
                if (mSep <= 0)
                {
                    continue;
                }

                var methodPrefix = n.QualifiedName[..mSep];
                if (methodPrefix == classPrefix ||
                    methodPrefix.EndsWith("::" + classPrefix, StringComparison.Ordinal) ||
                    classPrefix.EndsWith("::" + methodPrefix, StringComparison.Ordinal))
                {
                    filtered.Add(n);
                }
            }

            candidates = filtered;
            if (candidates.Count == 0)
            {
                return null;
            }
        }

        var sameFile = new List<CodeGraphNode>();
        foreach (var n in candidates)
        {
            if (n.FilePath == r.FilePath)
            {
                sameFile.Add(n);
            }
        }

        if (sameFile.Count > 0)
        {
            // Swift: several same-named methods in one file is an overload family — refuse.
            if (lang == CodeGraphLanguage.Swift && sameFile.Count > 1 && AllMethod(sameFile))
            {
                return null;
            }

            return new CodeGraphResolvedRef(MinByStartLine(sameFile).Id, sameFile.Count == 1 ? 0.95 : 0.9, CodeGraphResolvedBy.FunctionRef);
        }

        // Cross-file: only an unambiguous match resolves.
        if (candidates.Count == 1)
        {
            return new CodeGraphResolvedRef(candidates[0].Id, 0.8, CodeGraphResolvedBy.FunctionRef);
        }

        return null;
    }

    // ── matchByExactName (name-matcher.ts:346) ────────────────────────────────
    private static CodeGraphResolvedRef? MatchByExactName(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var gated = ApplyLanguageGate(ctx.GetNodesByName(r.ReferenceName), r);
        var candidates = new List<CodeGraphNode>();
        foreach (var n in gated)
        {
            if (n.Kind != CodeGraphNodeKind.Import)
            {
                candidates.Add(n);
            }
        }

        if (candidates.Count == 0)
        {
            return null;
        }

        if (candidates.Count == 1)
        {
            var isCrossLanguage = candidates[0].Language != lang;
            return new CodeGraphResolvedRef(candidates[0].Id, isCrossLanguage ? 0.5 : 0.9, CodeGraphResolvedBy.ExactMatch);
        }

        // Ubiquitous-name ceiling (#999): decline above it.
        if (candidates.Count > AmbiguousNameCeiling)
        {
            return null;
        }

        var bestMatch = FindBestMatch(r, candidates);
        if (bestMatch != null)
        {
            var proximity = ComputePathProximity(r.FilePath ?? string.Empty, bestMatch.FilePath);
            var confidence = proximity >= 30 ? 0.7 : 0.4;
            return new CodeGraphResolvedRef(bestMatch.Id, confidence, CodeGraphResolvedBy.ExactMatch);
        }

        return null;
    }

    // ── matchByQualifiedName (name-matcher.ts:406) ────────────────────────────
    private static CodeGraphResolvedRef? MatchByQualifiedName(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var name = r.ReferenceName;
        if (!name.Contains("::", StringComparison.Ordinal) && !name.Contains('.'))
        {
            return null;
        }

        var isCalls = r.ReferenceKind == CodeGraphEdgeKind.Calls;
        var candidates = KeepForRef(ctx.GetNodesByQualifiedName(name), isCalls);

        if (candidates.Count == 1)
        {
            return new CodeGraphResolvedRef(candidates[0].Id, 0.95, CodeGraphResolvedBy.QualifiedName);
        }

        // Several symbols share this exact qualified name: prefer the call site's own file.
        if (candidates.Count > 1)
        {
            var ordered = PreferCallSiteFile(candidates, r.FilePath ?? string.Empty);
            if (ordered[0].FilePath == r.FilePath)
            {
                return new CodeGraphResolvedRef(ordered[0].Id, 0.95, CodeGraphResolvedBy.QualifiedName);
            }
        }

        // Partial qualified-name match — again preferring the call site's own file.
        var parts = QnSplitRegex().Split(name);
        var lastName = parts.Length > 0 ? parts[^1] : string.Empty;
        if (lastName.Length > 0)
        {
            var partialCandidates = new List<CodeGraphNode>();
            foreach (var candidate in KeepForRef(ctx.GetNodesByName(lastName), isCalls))
            {
                if (candidate.QualifiedName.EndsWith(name, StringComparison.Ordinal))
                {
                    partialCandidates.Add(candidate);
                }
            }

            var ordered = PreferCallSiteFile(partialCandidates, r.FilePath ?? string.Empty);
            if (ordered.Count > 0)
            {
                return new CodeGraphResolvedRef(ordered[0].Id, 0.85, CodeGraphResolvedBy.QualifiedName);
            }
        }

        return null;
    }

    // A `calls` ref must never resolve to a yaml/properties config node (#1180).
    private static List<CodeGraphNode> KeepForRef(IReadOnlyList<CodeGraphNode> nodes, bool isCalls)
    {
        var result = new List<CodeGraphNode>();
        foreach (var n in nodes)
        {
            if (isCalls && n.Kind == CodeGraphNodeKind.Constant &&
                (n.Language == CodeGraphLanguage.Yaml || n.Language == CodeGraphLanguage.Properties))
            {
                continue;
            }

            result.Add(n);
        }

        return result;
    }

    // ── preferCallSiteFile (name-matcher.ts:485) ──────────────────────────────
    private static IReadOnlyList<CodeGraphNode> PreferCallSiteFile(IReadOnlyList<CodeGraphNode> nodes, string callSiteFile)
    {
        if (nodes.Count < 2)
        {
            return nodes;
        }

        var same = new List<CodeGraphNode>();
        var other = new List<CodeGraphNode>();
        foreach (var n in nodes)
        {
            if (n.FilePath == callSiteFile)
            {
                same.Add(n);
            }
            else
            {
                other.Add(n);
            }
        }

        if (same.Count == 0)
        {
            return nodes;
        }

        same.AddRange(other);
        return same;
    }

    // ── resolveMethodOnType (name-matcher.ts:498) ─────────────────────────────
    private static CodeGraphResolvedRef? ResolveMethodOnType(
        string typeName,
        string methodName,
        CodeGraphUnresolvedReference r,
        CodeGraphResolutionContext ctx,
        double confidence,
        string resolvedBy,
        string? preferredFqn = null,
        int depth = 0)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var matches = ctx.GetMethodMatches(typeName, methodName, lang);
        if (matches.Count == 0)
        {
            // Conformance fallback: walk supertypes transitively (depth-capped).
            if (depth < 4)
            {
                foreach (var supertype in ctx.GetSupertypes(typeName, lang))
                {
                    var via = ResolveMethodOnType(supertype, methodName, r, ctx, confidence, resolvedBy, preferredFqn, depth + 1);
                    if (via != null)
                    {
                        return via;
                    }
                }
            }

            return null;
        }

        // Java/Kotlin import disambiguation (#314): the import FQN's file-path suffix
        // pins WHICH class declaration typeName refers to.
        if (matches.Count > 1 && !string.IsNullOrEmpty(preferredFqn))
        {
            var ext = lang == CodeGraphLanguage.Kotlin ? ".kt" : ".java";
            var fqnPath = preferredFqn.Replace('.', '/') + ext;
            var altPath = "/" + fqnPath;
            foreach (var m in matches)
            {
                var fp = m.FilePath.Replace('\\', '/');
                if (fp.EndsWith(fqnPath, StringComparison.Ordinal) || fp.EndsWith(altPath, StringComparison.Ordinal))
                {
                    return new CodeGraphResolvedRef(m.Id, confidence, resolvedBy);
                }
            }
        }

        // Language-agnostic disambiguation: prefer the call site's own file (#1079).
        var ordered = PreferCallSiteFile(matches, r.FilePath ?? string.Empty);
        return new CodeGraphResolvedRef(ordered[0].Id, confidence, resolvedBy);
    }

    // ── C++ call chain (name-matcher.ts:831 matchCppCallChain) ────────────────
    private static CodeGraphResolvedRef? MatchCppCallChain(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var m = ChainShapeRegex().Match(r.ReferenceName);
        if (!m.Success || m.Groups[1].Value.Length == 0 || m.Groups[2].Value.Length == 0)
        {
            return null;
        }

        var cls = CodeGraphReceiverTypeInference.ResolveCppCallResultType(m.Groups[1].Value, r, ctx);
        if (cls is null)
        {
            return null;
        }

        return ResolveMethodOnType(cls, m.Groups[2].Value, r, ctx, 0.85, CodeGraphResolvedBy.InstanceMethod);
    }

    // ── `::`-scoped factory chain (name-matcher.ts:853 matchScopedCallChain) ──
    private static CodeGraphResolvedRef? MatchScopedCallChainImpl(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var m = ChainShapeRegex().Match(r.ReferenceName);
        if (!m.Success || m.Groups[1].Value.Length == 0 || m.Groups[2].Value.Length == 0)
        {
            return null;
        }

        var inner = m.Groups[1].Value;
        var method = m.Groups[2].Value;
        if (!inner.Contains("::", StringComparison.Ordinal))
        {
            return null; // only static-factory (`Cls::method`) chains
        }

        var factoryClass = inner[..inner.LastIndexOf("::", StringComparison.Ordinal)];
        var ret = CodeGraphReceiverTypeInference.LookupCalleeReturnType(inner, r, ctx);
        if (ret is null)
        {
            return null;
        }

        // `self` (self/static/$this marker) → the factory's class.
        var resolvedClass = ret == "self" ? factoryClass : ret;
        return ResolveMethodOnType(resolvedClass, method, r, ctx, 0.85, CodeGraphResolvedBy.InstanceMethod);
    }

    // ── Dotted call chain (name-matcher.ts:892 matchDottedCallChain) ──────────
    private static CodeGraphResolvedRef? MatchDottedCallChainImpl(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var m = ChainShapeRegex().Match(r.ReferenceName);
        if (!m.Success || m.Groups[1].Value.Length == 0 || m.Groups[2].Value.Length == 0)
        {
            return null;
        }

        var inner = m.Groups[1].Value; // `Foo.getInstance`
        var method = m.Groups[2].Value; // `bar`
        var lastDot = inner.LastIndexOf('.');

        if (lastDot <= 0)
        {
            // Go: bare package-level factory FUNCTION `New().method()`.
            if (lang == CodeGraphLanguage.Go)
            {
                var ret = CodeGraphReceiverTypeInference.LookupCalleeReturnType(inner, r, ctx);
                if (ret != null)
                {
                    return ResolveMethodOnType(ret, method, r, ctx, 0.85, CodeGraphResolvedBy.InstanceMethod, ImportedFqnOf(ret, r, ctx));
                }

                // `inner` isn't a factory with a captured return type — fall back to
                // bare-name resolution of the method, tied to the ORIGINAL ref.
                var bareRef = r with { ReferenceName = method };
                return MatchByExactName(bareRef, ctx) ?? MatchFuzzy(bareRef, ctx);
            }

            // Constructor receiver `Foo(args).method()` — only where a bare capitalized
            // call constructs the class (Kotlin/Swift/Scala/Dart/Pascal).
            if (!ConstructsViaBareCall.Contains(lang) || !(inner.Length > 0 && inner[0] >= 'A' && inner[0] <= 'Z'))
            {
                return null;
            }

            return ResolveMethodOnType(inner, method, r, ctx, 0.85, CodeGraphResolvedBy.InstanceMethod, ImportedFqnOf(inner, r, ctx));
        }

        // Factory/fluent receiver `Receiver.factory(args).method()`.
        var beforeDot = inner[..lastDot];
        var segDot = beforeDot.LastIndexOf('.');
        var factoryClass = segDot >= 0 ? beforeDot[(segDot + 1)..] : beforeDot; // simple class name
        var factoryMethod = inner[(lastDot + 1)..];
        if (factoryClass.Length == 0 || factoryMethod.Length == 0)
        {
            return null;
        }

        var factoryRet = CodeGraphReceiverTypeInference.LookupCalleeReturnType(factoryClass + "::" + factoryMethod, r, ctx);
        if (factoryRet is null)
        {
            // Objective-C: a class-message factory returns an instance of the RECEIVER class.
            if (lang == CodeGraphLanguage.ObjC && factoryClass.Length > 0 && factoryClass[0] >= 'A' && factoryClass[0] <= 'Z')
            {
                return ResolveMethodOnType(factoryClass, method, r, ctx, 0.8, CodeGraphResolvedBy.InstanceMethod, ImportedFqnOf(factoryClass, r, ctx));
            }

            // Pascal/Delphi: a `TFoo`/`IFoo` factory with no captured return type is a
            // constructor returning its own class.
            if (lang == CodeGraphLanguage.Pascal && factoryClass.Length > 0 && (factoryClass[0] == 'T' || factoryClass[0] == 'I'))
            {
                return ResolveMethodOnType(factoryClass, method, r, ctx, 0.8, CodeGraphResolvedBy.InstanceMethod, ImportedFqnOf(factoryClass, r, ctx));
            }

            return null;
        }

        return ResolveMethodOnType(factoryRet, method, r, ctx, 0.85, CodeGraphResolvedBy.InstanceMethod, ImportedFqnOf(factoryRet, r, ctx));
    }

    // name-matcher.ts:986 importedFqnOf.
    private static string? ImportedFqnOf(string typeName, CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        foreach (var i in ctx.GetImportMappings(r.FilePath ?? string.Empty, lang))
        {
            if (i.LocalName == typeName)
            {
                return i.Source;
            }
        }

        return null;
    }

    // ── matchMethodCall (name-matcher.ts:1450) ────────────────────────────────
    private static CodeGraphResolvedRef? MatchMethodCallImpl(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var name = r.ReferenceName;

        var dotMatch = Nz(DotMethodRegex().Match(name));
        if (dotMatch is null && lang == CodeGraphLanguage.Cpp)
        {
            dotMatch = Nz(CppOperatorRegex().Match(name));
        }

        var colonMatch = Nz(ColonMethodRegex().Match(name));
        var luaColonMatch = (lang == CodeGraphLanguage.Lua || lang == CodeGraphLanguage.Luau)
            ? Nz(LuaColonRegex().Match(name))
            : null;
        var rDollarMatch = lang == CodeGraphLanguage.R ? Nz(RDollarRegex().Match(name)) : null;

        // PHP property receiver: `$this->prop->method()` reaches here as
        // `this->prop.method` — resolve EXCLUSIVELY via declared-type inference.
        var phpThisPropMatch = lang == CodeGraphLanguage.Php ? Nz(PhpThisPropRegex().Match(name)) : null;
        if (phpThisPropMatch is not null)
        {
            var receiver = phpThisPropMatch.Groups[1].Value;
            var phpMethodName = phpThisPropMatch.Groups[2].Value;
            var inferred = CodeGraphReceiverTypeInference.InferLocalReceiverType(receiver, r, ctx);
            if (inferred is null)
            {
                return null;
            }

            return ResolveMethodOnType(inferred, phpMethodName, r, ctx, 0.9, CodeGraphResolvedBy.InstanceMethod, ImportedFqnOf(inferred, r, ctx));
        }

        var match = dotMatch ?? colonMatch ?? luaColonMatch ?? rDollarMatch;
        if (match is null)
        {
            return null;
        }

        var objectOrClass = match.Groups[1].Value;
        var methodName = match.Groups[2].Value;
        var inferableReceiver = dotMatch is not null || luaColonMatch is not null || rDollarMatch is not null;

        // Infer the receiver's type from its local declaration/initializer (#1108).
        if (inferableReceiver)
        {
            var inferredType = lang == CodeGraphLanguage.Cpp
                ? CodeGraphReceiverTypeInference.InferCppReceiverType(objectOrClass, r, ctx)
                : CodeGraphReceiverTypeInference.InferLocalReceiverType(objectOrClass, r, ctx);
            if (inferredType != null)
            {
                string? importedFqn = null;
                if (lang == CodeGraphLanguage.Java || lang == CodeGraphLanguage.Kotlin)
                {
                    importedFqn = FindImportedSource(ctx, r.FilePath ?? string.Empty, lang, inferredType);
                }

                var typedMatch = ResolveMethodOnType(inferredType, methodName, r, ctx, 0.9, CodeGraphResolvedBy.InstanceMethod, importedFqn);
                if (typedMatch != null)
                {
                    return typedMatch;
                }
            }
        }

        // Java/Kotlin: receiver may be a field whose name doesn't match the type by
        // convention (`userbo` → `UserBO`). Look up the field's declared type.
        if ((lang == CodeGraphLanguage.Java || lang == CodeGraphLanguage.Kotlin) && dotMatch is not null)
        {
            var inferredType = CodeGraphReceiverTypeInference.InferJavaFieldReceiverType(objectOrClass, r, ctx);
            if (inferredType != null)
            {
                var importedFqn = FindImportedSource(ctx, r.FilePath ?? string.Empty, lang, inferredType);
                var typedMatch = ResolveMethodOnType(inferredType, methodName, r, ctx, 0.9, CodeGraphResolvedBy.InstanceMethod, importedFqn);
                if (typedMatch != null)
                {
                    return typedMatch;
                }
            }
        }

        // Strategy 1: Direct class name match.
        foreach (var classNode in PreferCallSiteFile(ctx.GetNodesByName(objectOrClass), r.FilePath ?? string.Empty))
        {
            if (classNode.Kind == CodeGraphNodeKind.Class || classNode.Kind == CodeGraphNodeKind.Struct || classNode.Kind == CodeGraphNodeKind.Interface)
            {
                if (classNode.Language != lang)
                {
                    continue;
                }

                var methodNode = FindMethodInFile(ctx, classNode.FilePath, methodName, classNode.Name);
                if (methodNode != null)
                {
                    return new CodeGraphResolvedRef(methodNode.Id, 0.85, CodeGraphResolvedBy.QualifiedName);
                }
            }
        }

        // Strategy 2: Instance variable receiver — capitalized form to find the class.
        if (objectOrClass.Length > 0)
        {
            var capitalizedReceiver = char.ToUpperInvariant(objectOrClass[0]) + objectOrClass[1..];
            if (capitalizedReceiver != objectOrClass)
            {
                foreach (var classNode in PreferCallSiteFile(ctx.GetNodesByName(capitalizedReceiver), r.FilePath ?? string.Empty))
                {
                    if (classNode.Kind == CodeGraphNodeKind.Class || classNode.Kind == CodeGraphNodeKind.Struct || classNode.Kind == CodeGraphNodeKind.Interface)
                    {
                        if (classNode.Language != lang)
                        {
                            continue;
                        }

                        var methodNode = FindMethodInFile(ctx, classNode.FilePath, methodName, classNode.Name);
                        if (methodNode != null)
                        {
                            return new CodeGraphResolvedRef(methodNode.Id, 0.8, CodeGraphResolvedBy.InstanceMethod);
                        }
                    }
                }
            }
        }

        // Strategy 3: Find methods by name, score by receiver-word overlap.
        if (methodName.Length > 0)
        {
            var methodCandidates = ctx.GetNodesByName(methodName);
            // Ubiquitous-method ceiling (#999): bail before the O(K) work.
            if (methodCandidates.Count > AmbiguousNameCeiling)
            {
                return null;
            }

            var methods = new List<CodeGraphNode>();
            foreach (var n in methodCandidates)
            {
                if (n.Kind == CodeGraphNodeKind.Method && n.Name == methodName)
                {
                    methods.Add(n);
                }
            }

            var sameLanguageMethods = new List<CodeGraphNode>();
            foreach (var mm in methods)
            {
                if (mm.Language == lang)
                {
                    sameLanguageMethods.Add(mm);
                }
            }

            var targetMethods = sameLanguageMethods.Count > 0 ? sameLanguageMethods : methods;

            if (targetMethods.Count == 1 && targetMethods[0].Language == lang)
            {
                return new CodeGraphResolvedRef(targetMethods[0].Id, 0.7, CodeGraphResolvedBy.InstanceMethod);
            }

            if (targetMethods.Count > 1)
            {
                var receiverWords = SplitCamelCase(objectOrClass);
                CodeGraphNode? bestMatch = null;
                var bestScore = 0;
                foreach (var mm in PreferCallSiteFile(targetMethods, r.FilePath ?? string.Empty))
                {
                    var classWords = SplitCamelCase(mm.QualifiedName);
                    var score = CountWordOverlap(receiverWords, classWords);
                    if (mm.Language == lang)
                    {
                        score += 1;
                    }

                    if (score > bestScore)
                    {
                        bestScore = score;
                        bestMatch = mm;
                    }
                }

                if (bestMatch != null && bestScore >= 2)
                {
                    return new CodeGraphResolvedRef(bestMatch.Id, 0.65, CodeGraphResolvedBy.InstanceMethod);
                }
            }
        }

        return null;
    }

    private static string? FindImportedSource(CodeGraphResolutionContext ctx, string filePath, string language, string localName)
    {
        foreach (var i in ctx.GetImportMappings(filePath, language))
        {
            if (i.LocalName == localName)
            {
                return i.Source;
            }
        }

        return null;
    }

    private static CodeGraphNode? FindMethodInFile(CodeGraphResolutionContext ctx, string filePath, string methodName, string className)
    {
        foreach (var n in ctx.GetNodesInFile(filePath))
        {
            if (n.Kind == CodeGraphNodeKind.Method && n.Name == methodName &&
                n.QualifiedName.Contains(className, StringComparison.Ordinal))
            {
                return n;
            }
        }

        return null;
    }

    private static int CountWordOverlap(List<string> receiverWords, List<string> classWords)
    {
        var count = 0;
        foreach (var w in receiverWords)
        {
            foreach (var cw in classWords)
            {
                if (string.Equals(cw, w, StringComparison.OrdinalIgnoreCase))
                {
                    count++;
                    break;
                }
            }
        }

        return count;
    }

    // name-matcher.ts:1723 splitCamelCase.
    private static List<string> SplitCamelCase(string str)
    {
        var s = Camel1Regex().Replace(str, "$1 $2");
        s = Camel2Regex().Replace(s, "$1 $2");
        var result = new List<string>();
        foreach (var w in CamelSplitRegex().Split(s))
        {
            if (w.Length > 1)
            {
                result.Add(w);
            }
        }

        return result;
    }

    // ── findBestMatch (name-matcher.ts:1771) ──────────────────────────────────
    private static CodeGraphNode? FindBestMatch(CodeGraphUnresolvedReference r, List<CodeGraphNode> candidates)
    {
        var refLang = r.Language ?? CodeGraphLanguage.Unknown;
        var refFile = r.FilePath ?? string.Empty;
        var kind = r.ReferenceKind;

        double bestScore = -1;
        CodeGraphNode? bestNode = null;

        var refDirs = SplitDropLast(refFile);

        var hasSameLanguage = false;
        foreach (var c in candidates)
        {
            if (c.Language == refLang)
            {
                hasSameLanguage = true;
                break;
            }
        }

        foreach (var candidate in candidates)
        {
            if (hasSameLanguage && candidate.Language != refLang)
            {
                continue;
            }

            double score = 0;

            if (candidate.FilePath == refFile)
            {
                score += 100;
            }

            score += PathProximityFromDirs(refDirs, candidate.FilePath);

            if (candidate.Language == refLang)
            {
                score += 50;
            }
            else
            {
                score -= 80;
            }

            if (kind == CodeGraphEdgeKind.Calls)
            {
                if (candidate.Kind == CodeGraphNodeKind.Function || candidate.Kind == CodeGraphNodeKind.Method)
                {
                    score += 25;
                }
            }

            if (kind == CodeGraphEdgeKind.Instantiates)
            {
                if (candidate.Kind == CodeGraphNodeKind.Class || candidate.Kind == CodeGraphNodeKind.Struct || candidate.Kind == CodeGraphNodeKind.Interface)
                {
                    score += 25;
                }
            }

            if (kind == CodeGraphEdgeKind.Decorates)
            {
                if (candidate.Kind == CodeGraphNodeKind.Function || candidate.Kind == CodeGraphNodeKind.Method)
                {
                    score += 25;
                }
                else if (candidate.Kind == CodeGraphNodeKind.Class || candidate.Kind == CodeGraphNodeKind.Interface)
                {
                    score += 15;
                }
            }

            if (candidate.IsExported)
            {
                score += 10;
            }

            if (candidate.FilePath == refFile && candidate.StartLine != 0)
            {
                var distance = Math.Abs(candidate.StartLine - r.Line);
                score += Math.Max(0.0, 20.0 - distance / 10.0);
            }

            if (score > bestScore)
            {
                bestScore = score;
                bestNode = candidate;
            }
        }

        return bestNode;
    }

    // ── matchFuzzy (name-matcher.ts:1875) ─────────────────────────────────────
    private static CodeGraphResolvedRef? MatchFuzzy(CodeGraphUnresolvedReference r, CodeGraphResolutionContext ctx)
    {
        var lang = r.Language ?? CodeGraphLanguage.Unknown;
        var lowerName = r.ReferenceName.ToLowerInvariant();
        var candidates = ctx.GetNodesByLowerName(lowerName);

        var callable = new List<CodeGraphNode>();
        foreach (var n in candidates)
        {
            if (n.Kind == CodeGraphNodeKind.Function || n.Kind == CodeGraphNodeKind.Method || n.Kind == CodeGraphNodeKind.Class)
            {
                callable.Add(n);
            }
        }

        var gated = ApplyLanguageGate(callable, r);

        var sameLanguage = new List<CodeGraphNode>();
        foreach (var n in gated)
        {
            if (n.Language == lang)
            {
                sameLanguage.Add(n);
            }
        }

        var final = sameLanguage.Count > 0 ? sameLanguage : gated;
        if (final.Count == 1)
        {
            var isCrossLanguage = final[0].Language != lang;
            return new CodeGraphResolvedRef(final[0].Id, isCrossLanguage ? 0.3 : 0.5, CodeGraphResolvedBy.Fuzzy);
        }

        return null;
    }

    // ── Path-proximity scoring (name-matcher.ts:1740 / :1762) ─────────────────
    private static int PathProximityFromDirs(string[] dir1, string filePath2)
    {
        var dir2 = SplitDropLast(filePath2);
        var shared = 0;
        var limit = Math.Min(dir1.Length, dir2.Length);
        for (var i = 0; i < limit; i++)
        {
            if (dir1[i] == dir2[i])
            {
                shared++;
            }
            else
            {
                break;
            }
        }

        // Each shared directory segment contributes 15 points, capped at 80.
        return Math.Min(shared * 15, 80);
    }

    private static int ComputePathProximity(string filePath1, string filePath2) =>
        PathProximityFromDirs(SplitDropLast(filePath1), filePath2);

    // path.split('/') with the trailing filename dropped (JS split('/') + pop()).
    private static string[] SplitDropLast(string path)
    {
        var parts = path.Split('/');
        if (parts.Length <= 1)
        {
            return Array.Empty<string>();
        }

        var result = new string[parts.Length - 1];
        Array.Copy(parts, result, parts.Length - 1);
        return result;
    }

    // ── Small helpers ─────────────────────────────────────────────────────────
    private static Match? Nz(Match m) => m.Success ? m : null;

    private static bool AnyMethod(List<CodeGraphNode> nodes)
    {
        foreach (var n in nodes)
        {
            if (n.Kind == CodeGraphNodeKind.Method)
            {
                return true;
            }
        }

        return false;
    }

    private static bool AllMethod(List<CodeGraphNode> nodes)
    {
        foreach (var n in nodes)
        {
            if (n.Kind != CodeGraphNodeKind.Method)
            {
                return false;
            }
        }

        return true;
    }

    // reduce((a, b) => a.startLine <= b.startLine ? a : b) — min start line, first on tie.
    private static CodeGraphNode MinByStartLine(List<CodeGraphNode> nodes)
    {
        var best = nodes[0];
        for (var i = 1; i < nodes.Count; i++)
        {
            if (nodes[i].StartLine < best.StartLine)
            {
                best = nodes[i];
            }
        }

        return best;
    }

    // ── Fixed patterns ([GeneratedRegex]) ─────────────────────────────────────

    // The extractor's chained-receiver encoding `inner().method` (CHAIN_SHAPE).
    [GeneratedRegex(@"^(.+)\(\)\.(\w+)$")]
    private static partial Regex ChainShapeRegex();

    // Path-like OR a bare filename ending in a short extension (`Foo.h`).
    [GeneratedRegex(@"\.[A-Za-z][A-Za-z0-9]{0,3}$")]
    private static partial Regex FileExtShapeRegex();

    [GeneratedRegex(@"^([\w.]+)\.(\w+:?(?:\w+:)*)$")]
    private static partial Regex DotMethodRegex();

    [GeneratedRegex(@"^([\w.]+)\.(operator[^\w\s.]+)$")]
    private static partial Regex CppOperatorRegex();

    [GeneratedRegex(@"^(\w+)::(\w+)$")]
    private static partial Regex ColonMethodRegex();

    [GeneratedRegex(@"^([\w.]+):(\w+)$")]
    private static partial Regex LuaColonRegex();

    [GeneratedRegex(@"^([\w.]+)\$(\w+)$")]
    private static partial Regex RDollarRegex();

    [GeneratedRegex(@"^(this->\w+)\.(\w+)$")]
    private static partial Regex PhpThisPropRegex();

    [GeneratedRegex(@"[:.]")]
    private static partial Regex QnSplitRegex();

    [GeneratedRegex(@"([a-z])([A-Z])")]
    private static partial Regex Camel1Regex();

    [GeneratedRegex(@"([A-Z]+)([A-Z][a-z])")]
    private static partial Regex Camel2Regex();

    [GeneratedRegex(@"[\s._:/\\]+")]
    private static partial Regex CamelSplitRegex();

    [GeneratedRegex(@"\.app(?:\.src)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex AppSrcRegex();
}
