using System.Text.RegularExpressions;

// Higher-level graph queries ≙ CodeGraph TS `graph/queries.ts` (GraphQueryManager),
// built on CodeGraphTraverser + the store read surface. GetContext / file-dependency /
// metrics / dead-code are the MVP surface; the glob / module-structure / circular-
// dependency / filtered-subgraph queries are ported here too (analysis/03 §2.7).
//
// Every DFS here is an EXPLICIT STACK (FindCircularDependencies) per Decision 21 — a
// StackOverflowException is uncatchable and would crash the worker on a deep import
// chain.
internal sealed class CodeGraphQueryManager
{
    // Context: type edges surfaced as the focal's "types" (type_of first, then returns).
    private static readonly string[] TypeEdgeKindsForContext =
    {
        CodeGraphEdgeKind.TypeOf,
        CodeGraphEdgeKind.Returns
    };

    private static readonly string[] ImportEdgeKinds = { CodeGraphEdgeKind.Imports };

    // Kinds scanned by FindByQualifiedName (the glob-pattern lookup has no index).
    private static readonly string[] QualifiedNameKinds =
    {
        CodeGraphNodeKind.Class,
        CodeGraphNodeKind.Function,
        CodeGraphNodeKind.Method,
        CodeGraphNodeKind.Constructor,
        CodeGraphNodeKind.Interface,
        CodeGraphNodeKind.TypeAlias,
        CodeGraphNodeKind.Variable,
        CodeGraphNodeKind.Constant
    };

    private static readonly string[] DeadCodeKinds =
    {
        CodeGraphNodeKind.Function,
        CodeGraphNodeKind.Method,
        CodeGraphNodeKind.Class
    };

    private static readonly string[] FilteredSubgraphKinds =
    {
        CodeGraphNodeKind.File,
        CodeGraphNodeKind.Module,
        CodeGraphNodeKind.Class,
        CodeGraphNodeKind.Struct,
        CodeGraphNodeKind.Interface,
        CodeGraphNodeKind.Trait,
        CodeGraphNodeKind.Function,
        CodeGraphNodeKind.Method,
        CodeGraphNodeKind.Constructor,
        CodeGraphNodeKind.Variable,
        CodeGraphNodeKind.Constant,
        CodeGraphNodeKind.Enum,
        CodeGraphNodeKind.TypeAlias
    };

    // Regex specials to escape when compiling a glob to a regex — deliberately EXCLUDES
    // `*` and `?`, which are then rewritten to `.*` / `.` (matches the TS replace chain).
    private static readonly Regex GlobEscape = new(@"[.+^${}()|\[\]\\]", RegexOptions.CultureInvariant);

    private readonly CodeGraphStore store;
    private readonly CodeGraphTraverser traverser;

    internal CodeGraphQueryManager(CodeGraphStore store)
    {
        this.store = store ?? throw new ArgumentNullException(nameof(store));
        traverser = new CodeGraphTraverser(store);
    }

    // The underlying traverser for direct traversal operations.
    internal CodeGraphTraverser Traverser => traverser;

    // ======================================================================
    // Context
    // ======================================================================

    // Focal symbol plus its structural (ancestors/children) and reference neighborhood.
    // Throws when the node is unknown (matches the TS `throw new Error`).
    internal CodeGraphContext GetContext(string nodeId)
    {
        var focal = store.GetNodeById(nodeId)
            ?? throw new InvalidOperationException($"Node not found: {nodeId}");

        var ancestors = traverser.GetAncestors(nodeId);
        var children = traverser.GetChildren(nodeId);

        var incomingRefs = new List<CodeGraphNodeEdge>();
        foreach (var edge in store.GetIncomingEdges(nodeId))
        {
            // Skip containment (already represented by ancestors).
            if (edge.Kind == CodeGraphEdgeKind.Contains)
            {
                continue;
            }

            var node = store.GetNodeById(edge.Source);
            if (node is not null)
            {
                incomingRefs.Add(new CodeGraphNodeEdge(CodeGraphNodeView.From(node), CodeGraphEdgeView.From(edge)));
            }
        }

        var outgoingRefs = new List<CodeGraphNodeEdge>();
        foreach (var edge in store.GetOutgoingEdges(nodeId))
        {
            // Skip containment (already represented by children).
            if (edge.Kind == CodeGraphEdgeKind.Contains)
            {
                continue;
            }

            var node = store.GetNodeById(edge.Target);
            if (node is not null)
            {
                outgoingRefs.Add(new CodeGraphNodeEdge(CodeGraphNodeView.From(node), CodeGraphEdgeView.From(edge)));
            }
        }

        // Type information (type_of, then returns), deduped by node id.
        var types = new List<CodeGraphNode>();
        foreach (var kind in TypeEdgeKindsForContext)
        {
            foreach (var edge in store.GetOutgoingEdges(nodeId, new[] { kind }))
            {
                var typeNode = store.GetNodeById(edge.Target);
                if (typeNode is not null && !types.Any(t => t.Id == typeNode.Id))
                {
                    types.Add(typeNode);
                }
            }
        }

        // Relevant imports — off the containing file node, if any.
        var imports = new List<CodeGraphNode>();
        var fileNode = ancestors.FirstOrDefault(a => a.Kind == CodeGraphNodeKind.File);
        if (fileNode is not null)
        {
            foreach (var edge in store.GetOutgoingEdges(fileNode.Id, ImportEdgeKinds))
            {
                var importNode = store.GetNodeById(edge.Target);
                if (importNode is not null)
                {
                    imports.Add(importNode);
                }
            }
        }

        return new CodeGraphContext(
            CodeGraphNodeView.From(focal),
            ancestors.Select(CodeGraphNodeView.From).ToList(),
            children.Select(CodeGraphNodeView.From).ToList(),
            incomingRefs,
            outgoingRefs,
            types.Select(CodeGraphNodeView.From).ToList(),
            imports.Select(CodeGraphNodeView.From).ToList());
    }

    // ======================================================================
    // File dependencies (symbol-graph projection; NOT imports edges)
    // ======================================================================

    internal IReadOnlyList<string> GetFileDependencies(string filePath) =>
        store.GetDependencyFilePaths(filePath);

    internal IReadOnlyList<string> GetFileDependents(string filePath) =>
        store.GetDependentFilePaths(filePath);

    // ======================================================================
    // Symbol lookups
    // ======================================================================

    internal List<CodeGraphNode> GetExportedSymbols(string filePath)
    {
        var exported = new List<CodeGraphNode>();
        foreach (var node in store.GetNodesByFile(filePath))
        {
            if (node.IsExported)
            {
                exported.Add(node);
            }
        }

        return exported;
    }

    // Symbols whose qualified name matches a glob (`*` = any run, `?` = one char).
    // Unindexed — scans candidate kinds and regex-tests each (faithful to the TS note).
    internal List<CodeGraphNode> FindByQualifiedName(string pattern)
    {
        var escaped = GlobEscape.Replace(pattern, static m => "\\" + m.Value);
        var regexPattern = escaped.Replace("*", ".*").Replace("?", ".");
        var regex = new Regex("^" + regexPattern + "$", RegexOptions.CultureInvariant);

        var matches = new List<CodeGraphNode>();
        foreach (var kind in QualifiedNameKinds)
        {
            foreach (var node in store.GetNodesByKind(kind))
            {
                if (regex.IsMatch(node.QualifiedName))
                {
                    matches.Add(node);
                }
            }
        }

        return matches;
    }

    // ======================================================================
    // Module structure / circular dependencies
    // ======================================================================

    // Directory -> contained file paths. Files with no `/` land under ".".
    internal Dictionary<string, List<string>> GetModuleStructure()
    {
        var structure = new Dictionary<string, List<string>>();
        foreach (var file in store.GetFiles())
        {
            var parts = file.Path.Split('/');
            var dir = parts.Length > 1 ? string.Join("/", parts, 0, parts.Length - 1) : ".";
            if (dir.Length == 0)
            {
                dir = ".";
            }

            if (!structure.TryGetValue(dir, out var list))
            {
                list = new List<string>();
                structure[dir] = list;
            }

            list.Add(file.Path);
        }

        return structure;
    }

    // Cycles in the file-dependency graph, each a list of file paths. Explicit-stack DFS
    // over GetFileDependencies with a recursion-stack for back-edge detection.
    internal List<List<string>> FindCircularDependencies()
    {
        var cycles = new List<List<string>>();
        var visited = new HashSet<string>();
        var recursionStack = new HashSet<string>();

        foreach (var file in store.GetFiles())
        {
            if (!visited.Contains(file.Path))
            {
                DfsCircular(file.Path, cycles, visited, recursionStack);
            }
        }

        return cycles;
    }

    private void DfsCircular(
        string rootPath,
        List<List<string>> cycles,
        HashSet<string> visited,
        HashSet<string> recursionStack)
    {
        var stack = new Stack<CircularFrame>();
        stack.Push(new CircularFrame(rootPath, new List<string>()));

        while (stack.Count > 0)
        {
            var frame = stack.Peek();

            if (frame.Deps is null)
            {
                if (recursionStack.Contains(frame.FilePath))
                {
                    // Back edge — record the cycle (the path suffix from the re-entered node).
                    var cycleStart = frame.Path.IndexOf(frame.FilePath);
                    if (cycleStart != -1)
                    {
                        cycles.Add(frame.Path.GetRange(cycleStart, frame.Path.Count - cycleStart));
                    }

                    stack.Pop();
                    continue;
                }

                if (visited.Contains(frame.FilePath))
                {
                    stack.Pop();
                    continue;
                }

                visited.Add(frame.FilePath);
                recursionStack.Add(frame.FilePath);
                frame.Deps = GetFileDependencies(frame.FilePath);
                frame.Index = 0;
            }

            var deps = frame.Deps!;
            if (frame.Index < deps.Count)
            {
                var dep = deps[frame.Index];
                frame.Index++;
                var childPath = new List<string>(frame.Path) { frame.FilePath };
                stack.Push(new CircularFrame(dep, childPath));
                continue;
            }

            // Post-order: leave the recursion stack as we unwind.
            recursionStack.Remove(frame.FilePath);
            stack.Pop();
        }
    }

    // ======================================================================
    // Metrics / dead code / filtered subgraph
    // ======================================================================

    internal CodeGraphNodeMetrics GetNodeMetrics(string nodeId)
    {
        var incomingEdges = store.GetIncomingEdges(nodeId);
        var outgoingEdges = store.GetOutgoingEdges(nodeId);

        var callCount = 0;
        var containsCount = 0;
        foreach (var e in outgoingEdges)
        {
            if (e.Kind == CodeGraphEdgeKind.Calls)
            {
                callCount++;
            }
            else if (e.Kind == CodeGraphEdgeKind.Contains)
            {
                containsCount++;
            }
        }

        var callerCount = 0;
        foreach (var e in incomingEdges)
        {
            if (e.Kind == CodeGraphEdgeKind.Calls)
            {
                callerCount++;
            }
        }

        var ancestors = traverser.GetAncestors(nodeId);

        return new CodeGraphNodeMetrics(
            incomingEdges.Count,
            outgoingEdges.Count,
            callCount,
            callerCount,
            containsCount,
            ancestors.Count);
    }

    // Nodes with no non-contains incoming references. Exported symbols are skipped (they
    // may be used externally). Passing an empty kind list yields an empty result (matches
    // the TS `kinds || default`, where a present-but-empty list stays empty).
    internal List<CodeGraphNode> FindDeadCode(IReadOnlyList<string>? kinds = null)
    {
        var targetKinds = kinds ?? DeadCodeKinds;
        var deadCode = new List<CodeGraphNode>();

        foreach (var kind in targetKinds)
        {
            foreach (var node in store.GetNodesByKind(kind))
            {
                if (node.IsExported)
                {
                    continue;
                }

                var hasReference = false;
                foreach (var edge in store.GetIncomingEdges(node.Id))
                {
                    if (edge.Kind != CodeGraphEdgeKind.Contains)
                    {
                        hasReference = true;
                        break;
                    }
                }

                if (!hasReference)
                {
                    deadCode.Add(node);
                }
            }
        }

        return deadCode;
    }

    // Subgraph of nodes (over common kinds) matching `filter`; when includeEdges, also the
    // outgoing edges whose target is also in the set.
    internal CodeGraphSubgraph GetFilteredSubgraph(Func<CodeGraphNode, bool> filter, bool includeEdges = true)
    {
        var result = new CodeGraphSubgraph();

        foreach (var kind in FilteredSubgraphKinds)
        {
            foreach (var node in store.GetNodesByKind(kind))
            {
                if (filter(node))
                {
                    result.Nodes[node.Id] = node;
                }
            }
        }

        if (includeEdges)
        {
            foreach (var nodeId in result.Nodes.Keys.ToList())
            {
                foreach (var edge in store.GetOutgoingEdges(nodeId))
                {
                    if (result.Nodes.ContainsKey(edge.Target))
                    {
                        result.Edges.Add(edge);
                    }
                }
            }
        }

        return result;
    }

    private sealed class CircularFrame
    {
        public CircularFrame(string filePath, List<string> path)
        {
            FilePath = filePath;
            Path = path;
        }

        public string FilePath { get; }

        public List<string> Path { get; }

        public IReadOnlyList<string>? Deps { get; set; }

        public int Index { get; set; }
    }
}

// getNodeMetrics result — structural complexity signals for a node.
internal sealed record CodeGraphNodeMetrics(
    int IncomingEdgeCount,
    int OutgoingEdgeCount,
    int CallCount,
    int CallerCount,
    int ChildCount,
    int Depth);
