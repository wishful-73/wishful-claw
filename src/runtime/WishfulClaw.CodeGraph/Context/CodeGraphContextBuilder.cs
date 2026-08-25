using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphContextBuilder — the surgical-context engine (analysis/05 §2.7 / §6.5;
// port of context/index.ts ContextBuilder). The PRODUCT of the read surface: a
// multi-channel hybrid retriever (FindRelevantContext) plus the code-block assembler
// (BuildContext) and the config-leaf-redacting source reader (GetCode).
//
// FindRelevantContext is ~450 lines of tuned magic-number heuristics; every constant
// (+100 / +20 / +25 / ×0.3 / ×0.6 / brevity bonuses / diversity caps) is reproduced
// VERBATIM (analysis/05 R3/R5) — a "close enough" rewrite silently regresses which
// symbols an agent sees. Scores are UNBOUNDED / non-normalized: the FTS channel returns
// raw BM25 magnitudes, the exact/CamelCase/compound channels ~0-1 plus integer bonuses,
// and the ×-multiplier re-ranks assume that mixed scale.
//
// Ranking is over CodeGraphNodeView working candidates (the view carries every field
// the heuristics read); domain CodeGraphNode values are materialized only where the
// subgraph demands them (roots via GetNodeById; hierarchy/BFS return domain nodes).
// Reuses CodeGraphStore.{SearchNodes,FindNodesByExactName,FindNodesByNameSubstring,
// GetDominantFile,FindEdgesBetweenNodes} + CodeGraphSearchScoring + CodeGraphTraverser.
// =============================================================================
internal sealed class CodeGraphContextBuilder : ICodeGraphContextBuilder
{
    // DEFAULT_BUILD_OPTIONS / DEFAULT_FIND_OPTIONS (context/index.ts:143/167). Tuned for
    // minimal context usage: fewer nodes/blocks, smaller blocks, shallow traversal.
    private const int DefaultMaxNodes = 20;
    private const int DefaultMaxCodeBlocks = 5;
    private const int DefaultMaxCodeBlockSize = 1500;
    private const int DefaultSearchLimit = 3;
    private const int DefaultTraversalDepth = 1;
    private const double DefaultMinScore = 0.3;

    // HIGH_VALUE_NODE_KINDS (context/index.ts:159) — the default find nodeKinds; excludes
    // imports/exports (near-zero information density).
    private static readonly string[] HighValueNodeKinds =
    {
        CodeGraphNodeKind.Function, CodeGraphNodeKind.Method, CodeGraphNodeKind.Constructor,
        CodeGraphNodeKind.Class, CodeGraphNodeKind.Interface, CodeGraphNodeKind.TypeAlias,
        CodeGraphNodeKind.Struct,
        CodeGraphNodeKind.Trait, CodeGraphNodeKind.Component, CodeGraphNodeKind.Route,
        CodeGraphNodeKind.Variable, CodeGraphNodeKind.Constant, CodeGraphNodeKind.Enum,
        CodeGraphNodeKind.Module, CodeGraphNodeKind.Namespace
    };

    // FTS text-channel kinds when no explicit kind filter is set (context/index.ts:555) —
    // excludes `import` (floods FTS with qualified-name matches) and `parameter`.
    private static readonly string[] FtsSearchKinds =
    {
        CodeGraphNodeKind.File, CodeGraphNodeKind.Module, CodeGraphNodeKind.Class,
        CodeGraphNodeKind.Struct, CodeGraphNodeKind.Interface, CodeGraphNodeKind.Trait,
        CodeGraphNodeKind.Protocol, CodeGraphNodeKind.Function, CodeGraphNodeKind.Method,
        CodeGraphNodeKind.Constructor, CodeGraphNodeKind.Property, CodeGraphNodeKind.Field,
        CodeGraphNodeKind.Variable,
        CodeGraphNodeKind.Constant, CodeGraphNodeKind.Enum, CodeGraphNodeKind.EnumMember,
        CodeGraphNodeKind.TypeAlias, CodeGraphNodeKind.Namespace, CodeGraphNodeKind.Export,
        CodeGraphNodeKind.Route, CodeGraphNodeKind.Component
    };

    // Definition kinds for the prefix / CamelCase / compound channels
    // (context/index.ts:499/750).
    private static readonly string[] DefinitionKinds =
    {
        CodeGraphNodeKind.Class, CodeGraphNodeKind.Interface, CodeGraphNodeKind.Struct,
        CodeGraphNodeKind.Trait, CodeGraphNodeKind.Protocol, CodeGraphNodeKind.Enum,
        CodeGraphNodeKind.TypeAlias
    };

    // Entry-point kinds whose type hierarchy is force-expanded (context/index.ts:944).
    private static readonly HashSet<string> TypeHierarchyKinds = new(StringComparer.Ordinal)
    {
        CodeGraphNodeKind.Class, CodeGraphNodeKind.Interface, CodeGraphNodeKind.Struct,
        CodeGraphNodeKind.Trait, CodeGraphNodeKind.Protocol
    };

    // Edge kinds recovered between kept nodes after trimming (context/index.ts:1124).
    private static readonly string[] RecoveryKinds =
    {
        CodeGraphEdgeKind.Calls, CodeGraphEdgeKind.Extends, CodeGraphEdgeKind.Implements,
        CodeGraphEdgeKind.References, CodeGraphEdgeKind.Overrides
    };

    // Per-file diversity-cap kind priority (context/index.ts:1078). Missing kinds → 0.
    private static int KindPriority(string kind) => kind switch
    {
        CodeGraphNodeKind.Class or CodeGraphNodeKind.Interface or CodeGraphNodeKind.Struct
            or CodeGraphNodeKind.Trait or CodeGraphNodeKind.Protocol or CodeGraphNodeKind.Enum => 3,
        CodeGraphNodeKind.Method or CodeGraphNodeKind.Constructor or CodeGraphNodeKind.Function => 1,
        _ => 0
    };

    // extractSymbolsFromQuery regexes (context/index.ts:44). Not verbatim: JS \b is
    // ASCII-only while .NET \b is Unicode-aware (CJK chars are word chars), so the
    // literal port matched nothing when an identifier touches CJK prose
    // ("分析OrderStateMachine的实现"). The ASCII lookarounds restore JS semantics.
    private const string AsciiWordBefore = CodeGraphSearchScoring.AsciiWordBefore;
    private const string AsciiWordAfter = CodeGraphSearchScoring.AsciiWordAfter;

    private static readonly Regex CamelCasePattern =
        new(AsciiWordBefore + @"([A-Z][a-z]+(?:[A-Z][a-z]*)*|[a-z]+(?:[A-Z][a-z]*)+)" + AsciiWordAfter);

    private static readonly Regex SnakeCasePattern =
        new(AsciiWordBefore + @"([a-z][a-z0-9]*(?:_[a-z0-9]+)+)" + AsciiWordAfter, RegexOptions.IgnoreCase);

    private static readonly Regex ScreamingSnakePattern =
        new(AsciiWordBefore + @"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)" + AsciiWordAfter);

    private static readonly Regex AcronymPattern =
        new(AsciiWordBefore + @"([A-Z]{2,})" + AsciiWordAfter);

    private static readonly Regex DotNotationPattern =
        new(AsciiWordBefore + @"([a-zA-Z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+)" + AsciiWordAfter);

    private static readonly Regex LowercasePattern =
        new(AsciiWordBefore + @"([a-z][a-z0-9]{2,})" + AsciiWordAfter);

    // Common English words filtered from extracted symbols (context/index.ts:105) —
    // verbatim, compared case-insensitively.
    private static readonly HashSet<string> CommonWords = new(StringComparer.Ordinal)
    {
        "the", "and", "for", "with", "from", "this", "that", "have", "been",
        "will", "would", "could", "should", "does", "done", "make", "made",
        "use", "used", "using", "work", "works", "find", "found", "show",
        "call", "called", "calling", "get", "set", "add", "all", "any",
        "how", "what", "when", "where", "which", "who", "why",
        "not", "but", "are", "was", "were", "has", "had", "its",
        "can", "did", "may", "also", "into", "than", "then", "them",
        "each", "other", "some", "such", "only", "same", "about",
        "after", "before", "between", "through", "during", "without",
        "again", "further", "once", "here", "there", "both", "just",
        "more", "most", "very", "being", "having", "doing",
        "system", "need", "needs", "want", "wants", "like", "look",
        "change", "changes", "changed", "changing",
        "layer", "handle", "handles", "handling", "incoming", "outgoing",
        "data", "flow", "flows", "level", "levels", "request", "requests",
        "response", "responses", "implement", "implements", "implementation",
        "interface", "interfaces", "class", "classes", "method", "methods",
        "trigger", "triggers", "affected", "affect", "affects",
        "else", "code", "failing", "failed", "silently", "decide", "decides",
        "return", "returns", "returned", "take", "takes", "taken",
        "check", "checks", "checked", "create", "creates", "created",
        "read", "reads", "write", "writes", "written",
        "start", "starts", "stop", "stops", "run", "runs", "running"
    };

    private readonly CodeGraphStore store;
    private readonly string projectRoot;
    private readonly CodeGraphTraverser traverser;

    internal CodeGraphContextBuilder(CodeGraphStore store, string projectRoot, CodeGraphTraverser traverser)
    {
        this.store = store ?? throw new ArgumentNullException(nameof(store));
        this.projectRoot = projectRoot ?? throw new ArgumentNullException(nameof(projectRoot));
        this.traverser = traverser ?? throw new ArgumentNullException(nameof(traverser));
    }

    // In-process working candidate ≙ the TS `SearchResult { node, score }`. Score is
    // mutated in place (channels boost/dampen a shared object across the pipeline).
    private sealed class Candidate
    {
        public Candidate(CodeGraphNodeView node, double score)
        {
            Node = node;
            Score = score;
        }

        public CodeGraphNodeView Node { get; }

        public double Score { get; set; }
    }

    // ===========================================================================
    // buildContext (context/index.ts:216)
    // ===========================================================================
    public Task<CodeGraphTaskContext> BuildContext(
        CodeGraphTaskInput input,
        CodeGraphBuildContextOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var maxNodes = options?.MaxNodes ?? DefaultMaxNodes;
        var maxCodeBlocks = options?.MaxCodeBlocks ?? DefaultMaxCodeBlocks;
        var maxCodeBlockSize = options?.MaxCodeBlockSize ?? DefaultMaxCodeBlockSize;
        var includeCode = options?.IncludeCode ?? true;
        var searchLimit = options?.SearchLimit ?? DefaultSearchLimit;
        var traversalDepth = options?.TraversalDepth ?? DefaultTraversalDepth;
        var minScore = options?.MinScore ?? DefaultMinScore;

        // Parse input: title + (description ? ": " + description : "").
        var query = string.IsNullOrEmpty(input.Description)
            ? input.Title
            : $"{input.Title}: {input.Description}";

        var subgraph = FindRelevantContextCore(
            query,
            new CodeGraphFindRelevantContextOptions
            {
                SearchLimit = searchLimit,
                TraversalDepth = traversalDepth,
                MaxNodes = maxNodes,
                MinScore = minScore
            },
            cancellationToken);

        var entryPoints = GetEntryPoints(subgraph);
        var codeBlocks = includeCode
            ? ExtractCodeBlocks(subgraph, maxCodeBlocks, maxCodeBlockSize)
            : new List<CodeGraphCodeBlock>();
        var relatedFiles = GetRelatedFiles(subgraph);
        var summary = GenerateSummary(subgraph, entryPoints);

        var stats = new CodeGraphTaskContextStats(
            NodeCount: subgraph.Nodes.Count,
            EdgeCount: subgraph.Edges.Count,
            FileCount: relatedFiles.Count,
            CodeBlockCount: codeBlocks.Count,
            TotalCodeSize: codeBlocks.Sum(b => b.Content.Length));

        var entryViews = entryPoints.Select(CodeGraphNodeView.From).ToList();
        var dynamicBoundaries = BuildDynamicBoundariesSection(entryPoints);
        var context = new CodeGraphTaskContext(
            query, subgraph, entryViews, codeBlocks, relatedFiles, summary, stats,
            string.IsNullOrEmpty(dynamicBoundaries) ? null : dynamicBoundaries);
        return Task.FromResult(context);
    }

    // ===========================================================================
    // findRelevantContext (context/index.ts:432)
    // ===========================================================================
    public Task<CodeGraphSubgraph> FindRelevantContext(
        string query,
        CodeGraphFindRelevantContextOptions? options = null,
        CancellationToken cancellationToken = default) =>
        Task.FromResult(FindRelevantContextCore(query, options, cancellationToken));

    private CodeGraphSubgraph FindRelevantContextCore(
        string query,
        CodeGraphFindRelevantContextOptions? options,
        CancellationToken cancellationToken)
    {
        var searchLimit = options?.SearchLimit ?? DefaultSearchLimit;
        var traversalDepth = options?.TraversalDepth ?? DefaultTraversalDepth;
        var maxNodes = options?.MaxNodes ?? DefaultMaxNodes;
        var minScore = options?.MinScore ?? DefaultMinScore;
        IReadOnlyList<string> edgeKinds = options?.EdgeKinds ?? Array.Empty<string>();
        IReadOnlyList<string> nodeKinds = options?.NodeKinds ?? HighValueNodeKinds;

        // Handle empty query — empty subgraph (no confidence).
        if (string.IsNullOrWhiteSpace(query))
        {
            return new CodeGraphSubgraph();
        }

        var nodes = new Dictionary<string, CodeGraphNode>(StringComparer.Ordinal);
        var edges = new List<CodeGraphEdge>();
        var roots = new List<string>();
        var edgeKeys = new HashSet<string>(StringComparer.Ordinal);

        bool AddEdge(CodeGraphEdge e)
        {
            var key = e.Source + "|" + e.Target + "|" + e.Kind;
            if (edgeKeys.Add(key))
            {
                edges.Add(e);
                return true;
            }

            return false;
        }

        // === HYBRID SEARCH ===

        // Step 1: extract potential symbol names from the query.
        var symbolsFromQuery = ExtractSymbolsFromQuery(query);

        // Step 2: exact-name channel + co-location boost.
        var exactMatches = new List<Candidate>();
        if (symbolsFromQuery.Count > 0)
        {
            try
            {
                exactMatches = store.FindNodesByExactName(
                        symbolsFromQuery,
                        new CodeGraphSearchOptions
                        {
                            Limit = (int)Math.Ceiling(searchLimit * 5.0),
                            Kinds = nodeKinds.Count > 0 ? nodeKinds : null
                        })
                    .Select(r => new Candidate(r.Node, r.Score))
                    .ToList();

                if (exactMatches.Count > 1)
                {
                    // Co-location boost: symbols co-occurring in the same file are much
                    // more likely to be what the user is after (+ (count-1)*20).
                    var fileSymbolCounts = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);
                    foreach (var r in exactMatches)
                    {
                        if (!fileSymbolCounts.TryGetValue(r.Node.FilePath, out var names))
                        {
                            names = new HashSet<string>(StringComparer.Ordinal);
                            fileSymbolCounts[r.Node.FilePath] = names;
                        }

                        names.Add(r.Node.Name.ToLowerInvariant());
                    }

                    foreach (var r in exactMatches)
                    {
                        var symbolCount = fileSymbolCounts.TryGetValue(r.Node.FilePath, out var s) ? s.Count : 1;
                        if (symbolCount > 1)
                        {
                            r.Score += (symbolCount - 1) * 20;
                        }
                    }

                    exactMatches = exactMatches.OrderByDescending(r => r.Score).ToList();
                }

                exactMatches = exactMatches.Take((int)Math.Ceiling(searchLimit * 2.0)).ToList();
            }
            catch
            {
                exactMatches = new List<Candidate>();
            }
        }

        // Step 2b: definition-prefix channel (title-case symbol + stem variants → prefix
        // match on class/interface/… kinds; brevity bonus favors short names).
        if (symbolsFromQuery.Count > 0)
        {
            var expandedSymbols = new List<string>();
            var expandedSeen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var sym in symbolsFromQuery)
            {
                if (expandedSeen.Add(sym))
                {
                    expandedSymbols.Add(sym);
                }
            }

            foreach (var sym in symbolsFromQuery)
            {
                foreach (var variant in CodeGraphSearchScoring.GetStemVariants(sym))
                {
                    if (expandedSeen.Add(variant))
                    {
                        expandedSymbols.Add(variant);
                    }
                }
            }

            foreach (var sym in expandedSymbols)
            {
                var titleCased = TitleCase(sym);
                if (titleCased == sym)
                {
                    continue; // already title-case — handled by the exact channel.
                }

                var prefixResults = store.SearchNodes(
                    titleCased,
                    new CodeGraphSearchOptions { Limit = 30, Kinds = DefinitionKinds });

                var matched = new List<Candidate>();
                foreach (var r in prefixResults)
                {
                    if (r.Node.Name.ToLowerInvariant().StartsWith(titleCased.ToLowerInvariant(), StringComparison.Ordinal))
                    {
                        var brevityBonus = Math.Max(0.0, 10.0 - (r.Node.Name.Length - titleCased.Length) / 3.0);
                        matched.Add(new Candidate(r.Node, r.Score + 15 + brevityBonus));
                    }
                }

                matched = matched.OrderByDescending(r => r.Score).ToList();
                foreach (var r in matched.Take(searchLimit))
                {
                    if (!exactMatches.Any(e => e.Node.Id == r.Node.Id))
                    {
                        exactMatches.Add(r);
                    }
                }
            }

            exactMatches = exactMatches.OrderByDescending(r => r.Score).ToList();
            exactMatches = exactMatches.Take(searchLimit * 3).ToList();
        }

        // Step 3: FTS text channel — per-term search, boost multi-term hits (+ (hits-1)*5).
        var textResults = new List<Candidate>();
        try
        {
            var searchTerms = CodeGraphSearchScoring.ExtractSearchTerms(query);
            if (searchTerms.Count > 0)
            {
                IReadOnlyList<string> searchKinds = nodeKinds.Count > 0 ? nodeKinds : FtsSearchKinds;
                var termResultsMap = new Dictionary<string, (Candidate Result, int TermHits)>(StringComparer.Ordinal);
                foreach (var term in searchTerms)
                {
                    var termResults = store.SearchNodes(
                        term,
                        new CodeGraphSearchOptions { Limit = searchLimit * 2, Kinds = searchKinds });
                    foreach (var r in termResults)
                    {
                        if (termResultsMap.TryGetValue(r.Node.Id, out var existing))
                        {
                            existing.Result.Score = Math.Max(existing.Result.Score, r.Score);
                            termResultsMap[r.Node.Id] = (existing.Result, existing.TermHits + 1);
                        }
                        else
                        {
                            termResultsMap[r.Node.Id] = (new Candidate(r.Node, r.Score), 1);
                        }
                    }
                }

                foreach (var entry in termResultsMap.Values)
                {
                    entry.Result.Score += (entry.TermHits - 1) * 5;
                    textResults.Add(entry.Result);
                }

                textResults = textResults
                    .OrderByDescending(r => r.Score)
                    .Take(searchLimit * 2)
                    .ToList();
            }
        }
        catch
        {
            textResults = new List<Candidate>();
        }

        // Step 4: merge channels, taking the MAX score per node.
        var resultById = new Dictionary<string, Candidate>(StringComparer.Ordinal);
        var searchResults = new List<Candidate>();
        foreach (var result in exactMatches)
        {
            if (resultById.TryGetValue(result.Node.Id, out var existing))
            {
                existing.Score = Math.Max(existing.Score, result.Score);
            }
            else
            {
                resultById[result.Node.Id] = result;
                searchResults.Add(result);
            }
        }

        foreach (var result in textResults)
        {
            if (resultById.TryGetValue(result.Node.Id, out var existing))
            {
                existing.Score = Math.Max(existing.Score, result.Score);
            }
            else
            {
                resultById[result.Node.Id] = result;
                searchResults.Add(result);
            }
        }

        cancellationToken.ThrowIfCancellationRequested();

        var queryLower = query.ToLowerInvariant();
        var isTestQuery = queryLower.Contains("test") || queryLower.Contains("spec");

        // Step 6 (early): deprioritize test files so they don't take multi-term slots.
        if (!isTestQuery)
        {
            foreach (var result in searchResults)
            {
                if (CodeGraphSearchScoring.IsTestFile(result.Node.FilePath))
                {
                    result.Score *= 0.3;
                }
            }
        }

        // Step 7: core-directory boost — if one file dominates in-file call edges (≥3× the
        // next), boost its directory siblings +25 (Iter7).
        try
        {
            var dominant = store.GetDominantFile();
            if (dominant is not null && dominant.EdgeCount >= 3 * dominant.NextEdgeCount)
            {
                var slash = dominant.FilePath.LastIndexOf('/');
                if (slash > 0)
                {
                    var coreDir = dominant.FilePath.Substring(0, slash + 1);
                    foreach (var result in searchResults)
                    {
                        if (result.Node.FilePath.StartsWith(coreDir, StringComparison.Ordinal))
                        {
                            result.Score += 25;
                        }
                    }
                }
            }
        }
        catch
        {
            // SQL failure — scoring works without the boost.
        }

        // Step 5a: multi-term co-occurrence re-ranking (before truncation).
        var queryTermsForBoost = CodeGraphSearchScoring.ExtractSearchTerms(query);
        if (queryTermsForBoost.Count >= 2)
        {
            // Group stem-variant terms (substrings of each other) into one concept.
            var termGroups = new List<List<string>>();
            var sortedTerms = queryTermsForBoost.OrderByDescending(t => t.Length).ToList();
            var assigned = new HashSet<string>(StringComparer.Ordinal);
            foreach (var term in sortedTerms)
            {
                if (assigned.Contains(term))
                {
                    continue;
                }

                var group = new List<string> { term };
                assigned.Add(term);
                foreach (var other in sortedTerms)
                {
                    if (assigned.Contains(other))
                    {
                        continue;
                    }

                    if (term.Contains(other, StringComparison.Ordinal) || other.Contains(term, StringComparison.Ordinal))
                    {
                        group.Add(other);
                        assigned.Add(other);
                    }
                }

                termGroups.Add(group);
            }

            var exactMatchIds = new HashSet<string>(exactMatches.Select(r => r.Node.Id), StringComparer.Ordinal);
            var distinctiveTokens = new HashSet<string>(
                symbolsFromQuery.Where(IsDistinctiveIdentifier).Select(s => s.ToLowerInvariant()),
                StringComparer.Ordinal);
            var distinctiveExactMatchIds = new HashSet<string>(
                exactMatches.Where(r => distinctiveTokens.Contains(r.Node.Name.ToLowerInvariant())).Select(r => r.Node.Id),
                StringComparer.Ordinal);

            foreach (var result in searchResults)
            {
                var nameLower = result.Node.Name.ToLowerInvariant();
                var dirSegments = CodeGraphPosixPath.Dirname(result.Node.FilePath).ToLowerInvariant().Split('/');
                var matchCount = 0;
                foreach (var group in termGroups)
                {
                    var groupMatches = group.Any(term =>
                        nameLower.Contains(term, StringComparison.Ordinal) || Array.IndexOf(dirSegments, term) >= 0);
                    if (groupMatches)
                    {
                        matchCount++;
                    }
                }

                if (matchCount >= 2)
                {
                    result.Score *= 1 + matchCount * 0.5;
                }
                else if (distinctiveExactMatchIds.Contains(result.Node.Id))
                {
                    // Distinctive identifier the user explicitly named — keep full score.
                }
                else if (exactMatchIds.Contains(result.Node.Id))
                {
                    result.Score *= 0.3;
                }
                else
                {
                    result.Score *= 0.6;
                }
            }

            searchResults = searchResults.OrderByDescending(r => r.Score).ToList();
        }

        // Step 5b/5c: CamelCase-boundary + compound channels.
        if (symbolsFromQuery.Count > 0)
        {
            var camelSearchedTerms = new HashSet<string>(StringComparer.Ordinal);
            var searchIdSet = new HashSet<string>(searchResults.Select(r => r.Node.Id), StringComparer.Ordinal);
            var camelNodeTerms = new Dictionary<string, (Candidate Result, int TermCount)>(StringComparer.Ordinal);
            var maxCamelPerTerm = (int)Math.Ceiling(searchLimit / 2.0);

            foreach (var sym in symbolsFromQuery)
            {
                var titleCased = TitleCase(sym);
                if (titleCased.Length < 3)
                {
                    continue;
                }

                var termKey = titleCased.ToLowerInvariant();
                if (!camelSearchedTerms.Add(termKey))
                {
                    continue;
                }

                var likeResults = store.FindNodesByNameSubstring(
                    titleCased, limit: 200, kinds: DefinitionKinds, excludePrefix: true);

                var termCandidates = new List<Candidate>();
                foreach (var r in likeResults)
                {
                    var name = r.Node.Name;
                    var idx = name.IndexOf(titleCased, StringComparison.Ordinal);
                    if (idx <= 0)
                    {
                        continue;
                    }

                    // CamelCase boundary (lowercase before) OR acronym boundary (uppercase
                    // before, e.g. RPCProtocol) — a letter immediately before the match.
                    if (!char.IsAsciiLetter(name[idx - 1]))
                    {
                        continue;
                    }

                    if (searchIdSet.Contains(r.Node.Id))
                    {
                        continue;
                    }

                    if (CodeGraphSearchScoring.IsTestFile(r.Node.FilePath) && !isTestQuery)
                    {
                        continue;
                    }

                    var pathScore = CodeGraphSearchScoring.ScorePathRelevance(r.Node.FilePath, query, null);
                    var brevityBonus = Math.Max(0.0, 6.0 - (name.Length - titleCased.Length) / 4.0);
                    termCandidates.Add(new Candidate(r.Node, 8 + brevityBonus + pathScore));
                }

                termCandidates = termCandidates.OrderByDescending(c => c.Score).ToList();

                var accumPerTerm = maxCamelPerTerm * 4;
                foreach (var r in termCandidates.Take(accumPerTerm))
                {
                    if (camelNodeTerms.TryGetValue(r.Node.Id, out var existing))
                    {
                        camelNodeTerms[r.Node.Id] = (existing.Result, existing.TermCount + 1);
                    }
                    else
                    {
                        camelNodeTerms[r.Node.Id] = (r, 1);
                    }
                }
            }

            // Append CamelCase matches with multi-term boost.
            var camelResults = new List<Candidate>();
            foreach (var info in camelNodeTerms.Values)
            {
                info.Result.Score = info.Result.Score * (1 + info.TermCount) + (info.TermCount - 1) * 30;
                camelResults.Add(info.Result);
            }

            camelResults = camelResults.OrderByDescending(c => c.Score).ToList();
            foreach (var r in camelResults.Take(searchLimit))
            {
                searchResults.Add(r);
                searchIdSet.Add(r.Node.Id);
            }

            // Step 5c: compound — classes whose name contains ≥2 query terms at ANY position.
            if (symbolsFromQuery.Count >= 2)
            {
                var compoundTermMap = new Dictionary<string, (CodeGraphNodeView Node, HashSet<string> Terms)>(StringComparer.Ordinal);
                foreach (var sym in symbolsFromQuery)
                {
                    var titleCased = TitleCase(sym);
                    if (titleCased.Length < 3)
                    {
                        continue;
                    }

                    var likeResults = store.FindNodesByNameSubstring(
                        titleCased, limit: 200, kinds: DefinitionKinds, excludePrefix: false);

                    foreach (var r in likeResults)
                    {
                        if (searchIdSet.Contains(r.Node.Id))
                        {
                            continue;
                        }

                        if (CodeGraphSearchScoring.IsTestFile(r.Node.FilePath) && !isTestQuery)
                        {
                            continue;
                        }

                        if (compoundTermMap.TryGetValue(r.Node.Id, out var entry))
                        {
                            entry.Terms.Add(titleCased);
                        }
                        else
                        {
                            compoundTermMap[r.Node.Id] = (r.Node, new HashSet<string>(StringComparer.Ordinal) { titleCased });
                        }
                    }
                }

                var compoundResults = new List<Candidate>();
                foreach (var entry in compoundTermMap.Values)
                {
                    if (entry.Terms.Count >= 2)
                    {
                        var pathScore = CodeGraphSearchScoring.ScorePathRelevance(entry.Node.FilePath, query, null);
                        var brevityBonus = Math.Max(0.0, 6.0 - entry.Node.Name.Length / 8.0);
                        compoundResults.Add(new Candidate(
                            entry.Node,
                            10 + (entry.Terms.Count - 1) * 20 + pathScore + brevityBonus));
                    }
                }

                compoundResults = compoundResults.OrderByDescending(c => c.Score).ToList();
                var maxCompound = (int)Math.Ceiling(searchLimit / 2.0);
                foreach (var r in compoundResults.Take(maxCompound))
                {
                    searchResults.Add(r);
                    searchIdSet.Add(r.Node.Id);
                }
            }
        }

        // Final sort + truncation — all channels have now contributed.
        searchResults = searchResults.OrderByDescending(r => r.Score).ToList();
        searchResults = searchResults.Take(searchLimit * 3).ToList();

        // minScore filter.
        var filteredResults = searchResults.Where(r => r.Score >= minScore).ToList();

        // Resolve imports/exports to their definitions.
        filteredResults = ResolveImportsToDefinitions(filteredResults);

        // Cap entry points so traversal budget isn't spread too thin.
        if (filteredResults.Count > searchLimit)
        {
            filteredResults = filteredResults.Take(searchLimit).ToList();
        }

        // Confidence signal for the honest-handoff footer.
        var confidence = "high";
        var confTerms = CodeGraphSearchScoring.ExtractSearchTerms(query, includeStems: false)
            .Where(t => t.Length >= 3)
            .ToList();
        if (confTerms.Count >= 2 && filteredResults.Count > 0)
        {
            var distinctive = new HashSet<string>(
                symbolsFromQuery.Where(IsDistinctiveIdentifier).Select(s => s.ToLowerInvariant()),
                StringComparer.Ordinal);
            var anyStrong = filteredResults.Any(r =>
            {
                if (distinctive.Contains(r.Node.Name.ToLowerInvariant()))
                {
                    return true;
                }

                var nameLower = r.Node.Name.ToLowerInvariant();
                var dirSegs = CodeGraphPosixPath.Dirname(r.Node.FilePath).ToLowerInvariant().Split('/');
                var hits = 0;
                foreach (var t in confTerms)
                {
                    if (nameLower.Contains(t, StringComparison.Ordinal) || Array.IndexOf(dirSegs, t) >= 0)
                    {
                        if (++hits >= 2)
                        {
                            return true;
                        }
                    }
                }

                return false;
            });
            if (!anyStrong)
            {
                confidence = "low";
            }
        }

        // Add entry points to the subgraph (materialize domain nodes).
        foreach (var result in filteredResults)
        {
            var domain = store.GetNodeById(result.Node.Id);
            if (domain is null)
            {
                continue;
            }

            nodes[domain.Id] = domain;
            roots.Add(domain.Id);
        }

        cancellationToken.ThrowIfCancellationRequested();

        // Type-hierarchy expansion for class/interface entry points (2 passes for
        // siblings). Budget: up to maxNodes/4 hierarchy nodes.
        var maxHierarchyNodes = (int)Math.Ceiling(maxNodes / 4.0);
        var hierarchyNodesAdded = 0;
        foreach (var result in filteredResults)
        {
            if (hierarchyNodesAdded >= maxHierarchyNodes)
            {
                break;
            }

            if (TypeHierarchyKinds.Contains(result.Node.Kind))
            {
                var hierarchy = traverser.GetTypeHierarchy(result.Node.Id);
                foreach (var kv in hierarchy.Nodes)
                {
                    if (!nodes.ContainsKey(kv.Key))
                    {
                        nodes[kv.Key] = kv.Value;
                        hierarchyNodesAdded++;
                    }
                }

                foreach (var edge in hierarchy.Edges)
                {
                    AddEdge(edge);
                }
            }
        }

        // Pass 2: expand hierarchy of newly-discovered parent types to find siblings.
        if (hierarchyNodesAdded > 0)
        {
            var rootSetForPass2 = new HashSet<string>(roots, StringComparer.Ordinal);
            var pass2Candidates = nodes.Values
                .Where(n => TypeHierarchyKinds.Contains(n.Kind) && !rootSetForPass2.Contains(n.Id))
                .ToList();
            foreach (var candidate in pass2Candidates)
            {
                if (hierarchyNodesAdded >= maxHierarchyNodes)
                {
                    break;
                }

                var siblingHierarchy = traverser.GetTypeHierarchy(candidate.Id);
                foreach (var kv in siblingHierarchy.Nodes)
                {
                    if (!nodes.ContainsKey(kv.Key) && hierarchyNodesAdded < maxHierarchyNodes)
                    {
                        nodes[kv.Key] = kv.Value;
                        hierarchyNodesAdded++;
                    }
                }

                foreach (var edge in siblingHierarchy.Edges)
                {
                    if (nodes.ContainsKey(edge.Source) && nodes.ContainsKey(edge.Target))
                    {
                        AddEdge(edge);
                    }
                }
            }
        }

        // BFS from each entry point.
        var bfsLimit = (int)Math.Ceiling(maxNodes / (double)Math.Max(1, filteredResults.Count));
        foreach (var result in filteredResults)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var traversalResult = traverser.TraverseBFS(
                result.Node.Id,
                new CodeGraphTraversalOptions
                {
                    MaxDepth = traversalDepth,
                    EdgeKinds = edgeKinds.Count > 0 ? edgeKinds : null,
                    NodeKinds = nodeKinds.Count > 0 ? nodeKinds : null,
                    Direction = CodeGraphTraversalDirection.Both,
                    Limit = bfsLimit
                });

            foreach (var kv in traversalResult.Nodes)
            {
                if (!nodes.ContainsKey(kv.Key))
                {
                    nodes[kv.Key] = kv.Value;
                }
            }

            foreach (var edge in traversalResult.Edges)
            {
                AddEdge(edge);
            }
        }

        // Trim to max nodes if needed — prioritize entry points + their direct neighbors.
        var finalNodes = nodes;
        var finalEdges = edges;
        if (nodes.Count > maxNodes)
        {
            var priorityOrder = new List<string>();
            var prioritySet = new HashSet<string>(StringComparer.Ordinal);
            foreach (var r in roots)
            {
                if (prioritySet.Add(r))
                {
                    priorityOrder.Add(r);
                }
            }

            foreach (var edge in edges)
            {
                if (prioritySet.Contains(edge.Source) && prioritySet.Add(edge.Target))
                {
                    priorityOrder.Add(edge.Target);
                }

                if (prioritySet.Contains(edge.Target) && prioritySet.Add(edge.Source))
                {
                    priorityOrder.Add(edge.Source);
                }
            }

            finalNodes = new Dictionary<string, CodeGraphNode>(StringComparer.Ordinal);
            foreach (var id in priorityOrder)
            {
                if (finalNodes.Count >= maxNodes)
                {
                    break;
                }

                if (nodes.TryGetValue(id, out var node))
                {
                    finalNodes[id] = node;
                }
            }

            foreach (var kv in nodes)
            {
                if (finalNodes.Count >= maxNodes)
                {
                    break;
                }

                if (!finalNodes.ContainsKey(kv.Key))
                {
                    finalNodes[kv.Key] = kv.Value;
                }
            }

            finalEdges = edges.Where(e => finalNodes.ContainsKey(e.Source) && finalNodes.ContainsKey(e.Target)).ToList();
        }

        // Per-file diversity cap (~20% of budget) — no single file monopolizes the budget.
        var maxPerFile = Math.Max(5, (int)Math.Ceiling(maxNodes * 0.2));
        var fileCounts = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (var kv in finalNodes)
        {
            if (!fileCounts.TryGetValue(kv.Value.FilePath, out var ids))
            {
                ids = new List<string>();
                fileCounts[kv.Value.FilePath] = ids;
            }

            ids.Add(kv.Key);
        }

        var rootSet = new HashSet<string>(roots, StringComparer.Ordinal);
        foreach (var nodeIds in fileCounts.Values)
        {
            if (nodeIds.Count <= maxPerFile)
            {
                continue;
            }

            // Sort: entry points first, then classes/interfaces, then others (stable).
            var sorted = nodeIds
                .OrderByDescending(id => (rootSet.Contains(id) ? 10 : 0) + KindPriority(finalNodes[id].Kind))
                .ToList();
            foreach (var id in sorted.Skip(maxPerFile))
            {
                finalNodes.Remove(id);
            }
        }

        // Non-production node cap (test/sample/… ≤15% of budget). Test entry points are
        // NOT exempt — evict them from roots too.
        if (!isTestQuery)
        {
            var maxNonProd = Math.Max(3, (int)Math.Ceiling(maxNodes * 0.15));
            var nonProdIds = new List<string>();
            foreach (var kv in finalNodes)
            {
                if (CodeGraphSearchScoring.IsTestFile(kv.Value.FilePath))
                {
                    nonProdIds.Add(kv.Key);
                }
            }

            if (nonProdIds.Count > maxNonProd)
            {
                foreach (var id in nonProdIds.Skip(maxNonProd))
                {
                    finalNodes.Remove(id);
                    var rootIdx = roots.IndexOf(id);
                    if (rootIdx != -1)
                    {
                        roots.RemoveAt(rootIdx);
                    }
                }
            }
        }

        // Re-filter edges after the per-file and non-production caps.
        finalEdges = finalEdges.Where(e => finalNodes.ContainsKey(e.Source) && finalNodes.ContainsKey(e.Target)).ToList();

        // Edge recovery: discover edges between already-selected nodes to restore
        // connectivity BFS left disconnected.
        var recoveredEdges = store.FindEdgesBetweenNodes(finalNodes.Keys.ToList(), RecoveryKinds);
        var existingEdgeKeys = new HashSet<string>(
            finalEdges.Select(e => e.Source + ":" + e.Target + ":" + e.Kind),
            StringComparer.Ordinal);
        foreach (var edge in recoveredEdges)
        {
            var key = edge.Source + ":" + edge.Target + ":" + edge.Kind;
            if (existingEdgeKeys.Add(key))
            {
                finalEdges.Add(edge);
            }
        }

        var result0 = new CodeGraphSubgraph { Confidence = confidence };
        foreach (var kv in finalNodes)
        {
            result0.Nodes[kv.Key] = kv.Value;
        }

        result0.Edges.AddRange(finalEdges);
        result0.Roots.AddRange(roots);
        return result0;
    }

    // ===========================================================================
    // getCode (context/index.ts:1151) — config-leaf redaction (#383).
    // ===========================================================================
    public Task<string?> GetCode(string nodeId, CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var node = store.GetNodeById(nodeId);
        return Task.FromResult(node is null ? null : ExtractNodeCode(node));
    }

    // ===========================================================================
    // Private helpers
    // ===========================================================================

    // extractSymbolsFromQuery (context/index.ts:44). Returns query symbols in the JS
    // Set insertion order, minus the common-word stoplist.
    private static List<string> ExtractSymbolsFromQuery(string query)
    {
        var symbols = new List<string>();
        var seen = new HashSet<string>(StringComparer.Ordinal);

        void Add(string s)
        {
            if (seen.Add(s))
            {
                symbols.Add(s);
            }
        }

        foreach (Match m in CamelCasePattern.Matches(query))
        {
            var g = m.Groups[1].Value;
            if (g.Length >= 2)
            {
                Add(g);
            }
        }

        foreach (Match m in SnakeCasePattern.Matches(query))
        {
            var g = m.Groups[1].Value;
            if (g.Length >= 3)
            {
                Add(g);
            }
        }

        foreach (Match m in ScreamingSnakePattern.Matches(query))
        {
            Add(m.Groups[1].Value);
        }

        foreach (Match m in AcronymPattern.Matches(query))
        {
            Add(m.Groups[1].Value);
        }

        foreach (Match m in DotNotationPattern.Matches(query))
        {
            var g = m.Groups[1].Value;
            Add(g);
            foreach (var part in g.Split('.'))
            {
                if (part.Length >= 2)
                {
                    Add(part);
                }
            }
        }

        foreach (Match m in LowercasePattern.Matches(query))
        {
            Add(m.Groups[1].Value);
        }

        return symbols.Where(s => !CommonWords.Contains(s.ToLowerInvariant())).ToList();
    }

    // isDistinctiveIdentifier (query-utils.ts:433): snake/SCREAMING/embedded-digit, or a
    // camelCase/acronym boundary after the first char.
    private static bool IsDistinctiveIdentifier(string token)
    {
        if (string.IsNullOrEmpty(token))
        {
            return false;
        }

        foreach (var c in token)
        {
            if (c == '_' || (c >= '0' && c <= '9'))
            {
                return true;
            }
        }

        for (var i = 1; i < token.Length; i++)
        {
            if (token[i] >= 'A' && token[i] <= 'Z')
            {
                return true;
            }
        }

        return false;
    }

    // sym.charAt(0).toUpperCase() + sym.slice(1).toLowerCase().
    private static string TitleCase(string s)
    {
        if (s.Length == 0)
        {
            return s;
        }

        return char.ToUpperInvariant(s[0]) + s.Substring(1).ToLowerInvariant();
    }

    // resolveImportsToDefinitions (context/index.ts:1309): follow imports/exports edges to
    // the real definition; drop unresolved imports (low-value on their own).
    private List<Candidate> ResolveImportsToDefinitions(List<Candidate> results)
    {
        var resolved = new List<Candidate>();
        var seenIds = new HashSet<string>(StringComparer.Ordinal);

        foreach (var result in results)
        {
            var node = result.Node;
            if (node.Kind != CodeGraphNodeKind.Import && node.Kind != CodeGraphNodeKind.Export)
            {
                if (seenIds.Add(node.Id))
                {
                    resolved.Add(result);
                }

                continue;
            }

            var edgeKind = node.Kind == CodeGraphNodeKind.Import
                ? CodeGraphEdgeKind.Imports
                : CodeGraphEdgeKind.Exports;
            var outgoing = store.GetOutgoingEdges(node.Id, new[] { edgeKind });
            foreach (var edge in outgoing)
            {
                var target = store.GetNodeById(edge.Target);
                if (target is not null && seenIds.Add(target.Id))
                {
                    resolved.Add(new Candidate(CodeGraphNodeView.From(target), result.Score));
                }
            }
        }

        return resolved;
    }

    // The subgraph roots as domain nodes (getEntryPoints, context/index.ts:1196).
    private static List<CodeGraphNode> GetEntryPoints(CodeGraphSubgraph subgraph)
    {
        var result = new List<CodeGraphNode>();
        foreach (var id in subgraph.Roots)
        {
            if (subgraph.Nodes.TryGetValue(id, out var node))
            {
                result.Add(node);
            }
        }

        return result;
    }

    // extractCodeBlocks (context/index.ts:1205): entry points, then callable members,
    // then classes, up to maxBlocks.
    private List<CodeGraphCodeBlock> ExtractCodeBlocks(CodeGraphSubgraph subgraph, int maxBlocks, int maxBlockSize)
    {
        var blocks = new List<CodeGraphCodeBlock>();
        var priorityNodes = new List<CodeGraphNode>();
        var rootSet = new HashSet<string>(subgraph.Roots, StringComparer.Ordinal);

        foreach (var id in subgraph.Roots)
        {
            if (subgraph.Nodes.TryGetValue(id, out var node))
            {
                priorityNodes.Add(node);
            }
        }

        foreach (var node in subgraph.Nodes.Values)
        {
            if (!rootSet.Contains(node.Id) &&
                node.Kind is CodeGraphNodeKind.Function or CodeGraphNodeKind.Method
                    or CodeGraphNodeKind.Constructor)
            {
                priorityNodes.Add(node);
            }
        }

        foreach (var node in subgraph.Nodes.Values)
        {
            if (!rootSet.Contains(node.Id) && node.Kind == CodeGraphNodeKind.Class)
            {
                priorityNodes.Add(node);
            }
        }

        foreach (var node in priorityNodes)
        {
            if (blocks.Count >= maxBlocks)
            {
                break;
            }

            var code = ExtractNodeCode(node);
            if (code is null)
            {
                continue;
            }

            var truncated = code.Length > maxBlockSize
                ? code.Substring(0, maxBlockSize) + "\n... (truncated) ..."
                : code;

            blocks.Add(new CodeGraphCodeBlock(
                truncated, node.FilePath, node.StartLine, node.EndLine, node.Language, CodeGraphNodeView.From(node)));
        }

        return blocks;
    }

    // extractNodeCode (context/index.ts:1163). SECURITY (#383): a config-leaf node returns
    // its key only, never the on-disk secret value. Otherwise reads file lines
    // [startLine..endLine] through the strict (symlink-checked) path validator.
    private string? ExtractNodeCode(CodeGraphNode node)
    {
        if (CodeGraphPathSafety.IsConfigLeafNode(node.Kind, node.Language))
        {
            if (!string.IsNullOrEmpty(node.Signature))
            {
                return node.Signature;
            }

            return !string.IsNullOrEmpty(node.QualifiedName) ? node.QualifiedName : node.Name;
        }

        var filePath = CodeGraphPathSafety.ValidatePathWithinRoot(projectRoot, node.FilePath);
        if (filePath is null || !File.Exists(filePath))
        {
            return null;
        }

        try
        {
            var content = File.ReadAllText(filePath);
            var lines = content.Split('\n');
            var startIdx = Math.Max(0, node.StartLine - 1);
            var endIdx = Math.Min(lines.Length, node.EndLine);
            if (startIdx >= endIdx)
            {
                return string.Empty;
            }

            return string.Join("\n", lines[startIdx..endIdx]);
        }
        catch
        {
            return null;
        }
    }

    // buildDynamicBoundaries (tools.ts:2153, #687). Scan the entry-point symbols' bodies
    // for dynamic-dispatch sites (computed member calls, getattr, reflection, typed
    // message buses, runtime-keyed emits) and ANNOUNCE the boundary — the exact site, the
    // form, and (when a key is statically visible) the dispatch key — instead of guessing
    // edges. Query-time, deterministic, zero graph mutation; returns "" when nothing fires.
    private string BuildDynamicBoundariesSection(List<CodeGraphNode> scanList)
    {
        const int maxNotes = 4;          // boundary bullets per explore.
        const int maxScan = 8;           // bodies scanned.
        const int maxTotalChars = 200_000;

        var notes = new List<string>();
        var seenNode = new HashSet<string>(StringComparer.Ordinal);
        var seenSite = new HashSet<string>(StringComparer.Ordinal);
        var scanned = 0;
        var charsScanned = 0;

        foreach (var node in scanList)
        {
            if (notes.Count >= maxNotes || scanned >= maxScan || charsScanned > maxTotalChars)
            {
                break;
            }

            if (!seenNode.Add(node.Id) || node.StartLine == 0 || node.EndLine == 0)
            {
                continue;
            }

            var body = ExtractNodeCode(node);
            if (string.IsNullOrEmpty(body))
            {
                continue;
            }

            scanned++;
            charsScanned += body.Length;

            foreach (var m in CodeGraphDynamicBoundaries.ScanDynamicDispatch(body, node.Language, node.StartLine))
            {
                if (notes.Count >= maxNotes)
                {
                    break;
                }

                var siteKey = $"{node.FilePath}:{m.Line}:{m.Form}";
                if (!seenSite.Add(siteKey))
                {
                    continue;
                }

                var more = m.MoreSites > 0
                    ? $" (+{m.MoreSites} more such site{(m.MoreSites > 1 ? "s" : string.Empty)} in this body)"
                    : string.Empty;
                var keyNote = m.Key is { Length: > 0 } k
                    ? m.KeyIsType
                        ? $" — dispatch type `{k}` (candidates ~ `{k}Handler`)"
                        : $" — dispatch key `{k}`"
                    : string.Empty;
                notes.Add($"- `{node.Name}` ({node.FilePath}:{m.Line}) — {m.Label}: `{m.Snippet}`{more}{keyNote}");
            }
        }

        if (notes.Count == 0)
        {
            return string.Empty;
        }

        var lines = new List<string>
        {
            "**Dynamic boundaries (the static path ends at runtime dispatch)**",
            string.Empty
        };
        lines.AddRange(notes);
        lines.Add(string.Empty);
        lines.Add(
            "> These sites choose their call target at runtime (registry / bus / reflection) — the site shown IS "
            + "where the flow continues. To follow it, run codegraph_explore or codegraph_node on a candidate.");
        return string.Join("\n", lines);
    }

    // getRelatedFiles (context/index.ts:1271): unique file paths, sorted (UTF-16 ordinal).
    private static List<string> GetRelatedFiles(CodeGraphSubgraph subgraph)
    {
        var files = new HashSet<string>(StringComparer.Ordinal);
        foreach (var node in subgraph.Nodes.Values)
        {
            files.Add(node.FilePath);
        }

        return files.OrderBy(f => f, StringComparer.Ordinal).ToList();
    }

    // generateSummary (context/index.ts:1282).
    private static string GenerateSummary(CodeGraphSubgraph subgraph, List<CodeGraphNode> entryPoints)
    {
        var nodeCount = subgraph.Nodes.Count;
        var edgeCount = subgraph.Edges.Count;
        var files = GetRelatedFiles(subgraph);
        var entryPointNames = string.Join(", ", entryPoints.Take(3).Select(n => n.Name));
        var remaining = entryPoints.Count > 3 ? $" and {entryPoints.Count - 3} more" : string.Empty;

        return $"Found {nodeCount} relevant code symbols across {files.Count} files. " +
            $"Key entry points: {entryPointNames}{remaining}. " +
            $"{edgeCount} relationships identified.";
    }
}
