// Graph traversal algorithms ≙ CodeGraph TS `graph/traversal.ts` (GraphTraverser).
// BFS/DFS over the code knowledge graph plus the derived call-graph / type-hierarchy /
// impact / path / usage queries. Consumes CodeGraphStore's read surface exactly
// (GetNodeById + LRU, the batch GetNodesByIds N+1 killer, GetOutgoing/IncomingEdges
// with kind filter).
//
// INVARIANTS reproduced verbatim from the TS (analysis/03 §2.7, §5.3-§5.4; #1086-#1090):
//   * BFS keeps `enqueued` SEPARATE from `visited` so a node reachable via two edges
//     is queued exactly once yet every distinct edge is still recorded (#1090).
//   * The node budget is checked PER-ADD, not only on the outer loop, so one
//     high-degree node cannot overshoot `limit` (#1087/#1088).
//   * callers/callees/impact mark a node visited BEFORE the depth check, so a node
//     reached from one parent via two edges is not duplicated at maxDepth=1 (#1086).
//   * impact records each dependency edge UNCONDITIONALLY (#1089) and excludes
//     `contains` upward (#536); `instantiates` counts as a call (#774).
//
// DECISION 21 / analysis/03 R3: every unbounded DFS is an EXPLICIT STACK, never
// recursion — a StackOverflowException is uncatchable and would crash the worker.
// Each iterative frame captures a paused edge-iterator so the emitted node/edge order
// is byte-identical to the recursive original (pre-order, first-edge-deepest).
internal sealed class CodeGraphTraverser
{
    // callers/callees edge set — `instantiates` is a call (constructing a class calls
    // its constructor), so callers/callees stay inverses and `trace` crosses the
    // instantiation boundary (#774).
    private static readonly string[] CallEdgeKinds =
    {
        CodeGraphEdgeKind.Calls,
        CodeGraphEdgeKind.References,
        CodeGraphEdgeKind.Imports,
        CodeGraphEdgeKind.Instantiates
    };

    private static readonly string[] TypeEdgeKinds =
    {
        CodeGraphEdgeKind.Extends,
        CodeGraphEdgeKind.Implements
    };

    private static readonly string[] ContainsEdgeKinds = { CodeGraphEdgeKind.Contains };

    // Container kinds whose contained members are descended into during impact so a
    // caller of a contained method surfaces in the class's impact set.
    private static readonly HashSet<string> ContainerKinds = new()
    {
        CodeGraphNodeKind.Class,
        CodeGraphNodeKind.Interface,
        CodeGraphNodeKind.Struct,
        CodeGraphNodeKind.Trait,
        CodeGraphNodeKind.Protocol,
        CodeGraphNodeKind.Module,
        CodeGraphNodeKind.Enum
    };

    private static readonly IReadOnlyDictionary<string, CodeGraphNode> EmptyNodeMap =
        new Dictionary<string, CodeGraphNode>();

    private static readonly IReadOnlyList<CodeGraphEdge> EmptyEdgeList = new List<CodeGraphEdge>();

    private readonly CodeGraphStore store;

    internal CodeGraphTraverser(CodeGraphStore store)
    {
        this.store = store ?? throw new ArgumentNullException(nameof(store));
    }

    // ======================================================================
    // BFS
    // ======================================================================

    internal CodeGraphSubgraph TraverseBFS(string startId, CodeGraphTraversalOptions? options = null)
    {
        var maxDepth = options?.MaxDepth ?? int.MaxValue;
        var edgeKinds = options?.EdgeKinds is { Count: > 0 } ek ? ek : null;
        var nodeKinds = options?.NodeKinds is { Count: > 0 } nk ? nk : null;
        var direction = options?.Direction ?? CodeGraphTraversalDirection.Outgoing;
        var limit = options?.Limit ?? 1000;
        var includeStart = options?.IncludeStart ?? true;

        var result = new CodeGraphSubgraph();
        var startNode = store.GetNodeById(startId);
        if (startNode is null)
        {
            return result;
        }

        var nodes = result.Nodes;
        var edges = result.Edges;
        var visited = new HashSet<string>();
        // Enqueue-once guard, tracked separately from `visited` (set only on dequeue).
        // Guarding the enqueue on `visited` alone let a target reachable via two edges
        // queue twice; the second dequeue hit `visited` and its edge was never recorded
        // (#1090).
        var enqueued = new HashSet<string> { startNode.Id };
        // Edge-identity dedup so a `both`-direction scan records each A->B edge once.
        var seenEdges = new HashSet<string>();
        var queue = new Queue<BfsStep>();
        queue.Enqueue(new BfsStep(startNode, 0));

        if (includeStart)
        {
            nodes[startNode.Id] = startNode;
        }

        while (queue.Count > 0 && nodes.Count < limit)
        {
            var step = queue.Dequeue();
            var node = step.Node;
            var depth = step.Depth;

            if (!visited.Add(node.Id))
            {
                continue;
            }

            if (depth >= maxDepth)
            {
                continue;
            }

            // Prioritize structural edges (contains, then calls) over reference edges so
            // BFS discovers internal structure before fanning out. OrderBy is a STABLE
            // sort (matches JS Array.sort stability), preserving edge order within a
            // priority band.
            var adjacent = GetAdjacentEdges(node.Id, direction, edgeKinds);
            var ordered = adjacent
                .OrderBy(e => e.Kind == CodeGraphEdgeKind.Contains ? 0 : e.Kind == CodeGraphEdgeKind.Calls ? 1 : 2)
                .ToList();

            // Batch-fetch the neighbors we might newly enqueue in one query (the N+1
            // killer). Already-queued/visited neighbors are in `nodes` already.
            var neighborNodes = BuildNeighborMap(ordered, node.Id, visited, enqueued);

            foreach (var adjEdge in ordered)
            {
                var nextNodeId = adjEdge.Source == node.Id ? adjEdge.Target : adjEdge.Source;
                if (!neighborNodes.TryGetValue(nextNodeId, out var nextNode)
                    && !nodes.TryGetValue(nextNodeId, out nextNode))
                {
                    continue;
                }

                if (nodeKinds is not null && !nodeKinds.Contains(nextNode.Kind))
                {
                    continue;
                }

                // Enqueue each neighbor once, only while under the node budget — the cap
                // is checked per-add here, not just on the outer while (#1087).
                if (!visited.Contains(nextNodeId) && !enqueued.Contains(nextNodeId))
                {
                    if (nodes.Count >= limit)
                    {
                        continue;
                    }

                    enqueued.Add(nextNodeId);
                    nodes[nextNode.Id] = nextNode;
                    queue.Enqueue(new BfsStep(nextNode, depth + 1));
                }

                // Record every distinct edge among kept nodes (collected on the adjacency
                // scan, not once per dequeue) so parallel edges to the same target survive
                // (#1090).
                var key = EdgeKey(adjEdge);
                if (seenEdges.Add(key))
                {
                    edges.Add(adjEdge);
                }
            }
        }

        result.Roots.Add(startId);
        return result;
    }

    // ======================================================================
    // DFS (explicit stack — Decision 21)
    // ======================================================================

    internal CodeGraphSubgraph TraverseDFS(string startId, CodeGraphTraversalOptions? options = null)
    {
        var maxDepth = options?.MaxDepth ?? int.MaxValue;
        var edgeKinds = options?.EdgeKinds is { Count: > 0 } ek ? ek : null;
        var nodeKinds = options?.NodeKinds is { Count: > 0 } nk ? nk : null;
        var direction = options?.Direction ?? CodeGraphTraversalDirection.Outgoing;
        var limit = options?.Limit ?? 1000;
        var includeStart = options?.IncludeStart ?? true;

        var result = new CodeGraphSubgraph();
        var startNode = store.GetNodeById(startId);
        if (startNode is null)
        {
            return result;
        }

        var nodes = result.Nodes;
        var edges = result.Edges;
        var visited = new HashSet<string>();

        if (includeStart)
        {
            nodes[startNode.Id] = startNode;
        }

        var stack = new Stack<DfsFrame>();
        stack.Push(new DfsFrame(startNode, 0));

        while (stack.Count > 0)
        {
            var frame = stack.Peek();

            if (frame.Edges is null)
            {
                // Frame entry ≙ top of the recursive dfsRecursive: bail on already-visited,
                // over-budget, or too-deep before doing any work.
                if (visited.Contains(frame.Node.Id) || nodes.Count >= limit || frame.Depth >= maxDepth)
                {
                    stack.Pop();
                    continue;
                }

                visited.Add(frame.Node.Id);
                var adjacent = GetAdjacentEdges(frame.Node.Id, direction, edgeKinds);
                frame.Edges = adjacent;
                frame.Neighbors = BuildNeighborMap(adjacent, frame.Node.Id, visited, enqueued: null);
                frame.Index = 0;
            }

            var frameEdges = frame.Edges!;
            var frameNeighbors = frame.Neighbors!;
            var pushed = false;

            while (frame.Index < frameEdges.Count)
            {
                // Cap per-add, not just at the top of each frame (#1088).
                if (nodes.Count >= limit)
                {
                    break;
                }

                var edge = frameEdges[frame.Index];
                frame.Index++;

                var nextNodeId = edge.Source == frame.Node.Id ? edge.Target : edge.Source;
                if (visited.Contains(nextNodeId))
                {
                    continue;
                }

                if (!frameNeighbors.TryGetValue(nextNodeId, out var nextNode))
                {
                    continue;
                }

                if (nodeKinds is not null && !nodeKinds.Contains(nextNode.Kind))
                {
                    continue;
                }

                nodes[nextNode.Id] = nextNode;
                edges.Add(edge);
                stack.Push(new DfsFrame(nextNode, frame.Depth + 1));
                pushed = true;
                break;
            }

            if (!pushed)
            {
                stack.Pop();
            }
        }

        result.Roots.Add(startId);
        return result;
    }

    private List<CodeGraphEdge> GetAdjacentEdges(string nodeId, string direction, IReadOnlyList<string>? edgeKinds)
    {
        if (direction == CodeGraphTraversalDirection.Outgoing)
        {
            return new List<CodeGraphEdge>(store.GetOutgoingEdges(nodeId, edgeKinds));
        }

        if (direction == CodeGraphTraversalDirection.Incoming)
        {
            return new List<CodeGraphEdge>(store.GetIncomingEdges(nodeId, edgeKinds));
        }

        var both = new List<CodeGraphEdge>();
        both.AddRange(store.GetOutgoingEdges(nodeId, edgeKinds));
        both.AddRange(store.GetIncomingEdges(nodeId, edgeKinds));
        return both;
    }

    // Batch-fetch neighbors not yet visited/enqueued. Passing enqueued=null (DFS) filters
    // on `visited` only, matching the TS.
    private IReadOnlyDictionary<string, CodeGraphNode> BuildNeighborMap(
        IReadOnlyList<CodeGraphEdge> edges,
        string nodeId,
        HashSet<string> visited,
        HashSet<string>? enqueued)
    {
        var wantIds = new List<string>();
        foreach (var e in edges)
        {
            var id = e.Source == nodeId ? e.Target : e.Source;
            if (visited.Contains(id))
            {
                continue;
            }

            if (enqueued is not null && enqueued.Contains(id))
            {
                continue;
            }

            wantIds.Add(id);
        }

        return wantIds.Count > 0 ? store.GetNodesByIds(wantIds) : EmptyNodeMap;
    }

    private static string EdgeKey(CodeGraphEdge e) =>
        $"{e.Source}|{e.Target}|{e.Kind}|{e.Line ?? -1}|{e.Column ?? -1}";

    // ======================================================================
    // Callers / callees
    // ======================================================================

    internal List<CodeGraphNodeEdgePair> GetCallers(string nodeId, int maxDepth = 1) =>
        CollectCalls(nodeId, maxDepth, incoming: true);

    internal List<CodeGraphNodeEdgePair> GetCallees(string nodeId, int maxDepth = 1) =>
        CollectCalls(nodeId, maxDepth, incoming: false);

    // Iterative equivalent of getCallersRecursive/getCalleesRecursive. Mark-visited-
    // BEFORE-depth (#1086); batch caller/callee fetch (N+1 killer). `incoming` picks
    // callers (edges into the node) vs callees (edges out of the node).
    private List<CodeGraphNodeEdgePair> CollectCalls(string startId, int maxDepth, bool incoming)
    {
        var result = new List<CodeGraphNodeEdgePair>();
        var visited = new HashSet<string>();
        var stack = new Stack<CallFrame>();
        stack.Push(new CallFrame(startId, 0));

        while (stack.Count > 0)
        {
            var frame = stack.Peek();

            if (frame.Edges is null)
            {
                if (!visited.Add(frame.Id))
                {
                    stack.Pop();
                    continue;
                }

                if (frame.Depth >= maxDepth)
                {
                    stack.Pop();
                    continue;
                }

                var edges = incoming
                    ? store.GetIncomingEdges(frame.Id, CallEdgeKinds)
                    : store.GetOutgoingEdges(frame.Id, CallEdgeKinds);
                if (edges.Count == 0)
                {
                    stack.Pop();
                    continue;
                }

                frame.Edges = edges;
                frame.Neighbors = store.GetNodesByIds(EndpointIds(edges, incoming));
                frame.Index = 0;
            }

            var frameEdges = frame.Edges!;
            var frameNeighbors = frame.Neighbors!;
            var pushed = false;

            while (frame.Index < frameEdges.Count)
            {
                var edge = frameEdges[frame.Index];
                frame.Index++;

                var endpointId = incoming ? edge.Source : edge.Target;
                if (frameNeighbors.TryGetValue(endpointId, out var neighbor)
                    && !visited.Contains(neighbor.Id))
                {
                    result.Add(new CodeGraphNodeEdgePair(neighbor, edge));
                    stack.Push(new CallFrame(neighbor.Id, frame.Depth + 1));
                    pushed = true;
                    break;
                }
            }

            if (!pushed)
            {
                stack.Pop();
            }
        }

        return result;
    }

    internal CodeGraphSubgraph GetCallGraph(string nodeId, int depth = 2)
    {
        var result = new CodeGraphSubgraph();
        var focal = store.GetNodeById(nodeId);
        if (focal is null)
        {
            return result;
        }

        result.Nodes[focal.Id] = focal;

        foreach (var pair in GetCallers(nodeId, depth))
        {
            result.Nodes[pair.Node.Id] = pair.Node;
            result.Edges.Add(pair.Edge);
        }

        foreach (var pair in GetCallees(nodeId, depth))
        {
            result.Nodes[pair.Node.Id] = pair.Node;
            result.Edges.Add(pair.Edge);
        }

        result.Roots.Add(nodeId);
        return result;
    }

    // ======================================================================
    // Type hierarchy
    // ======================================================================

    internal CodeGraphSubgraph GetTypeHierarchy(string nodeId)
    {
        var result = new CodeGraphSubgraph();
        var focal = store.GetNodeById(nodeId);
        if (focal is null)
        {
            return result;
        }

        result.Nodes[focal.Id] = focal;
        // Ancestors then descendants SHARE one `visited` set (faithful to the TS): the
        // ancestors pass marks the focal visited, so the descendants pass short-circuits
        // on the focal exactly as in graph/traversal.ts.
        var visited = new HashSet<string>();
        CollectTypeHierarchy(nodeId, incoming: false, result.Nodes, result.Edges, visited);
        CollectTypeHierarchy(nodeId, incoming: true, result.Nodes, result.Edges, visited);
        result.Roots.Add(nodeId);
        return result;
    }

    // Iterative getTypeAncestors (incoming=false, follow extends/implements outward) /
    // getTypeDescendants (incoming=true). Add condition is `!nodes.ContainsKey` (not
    // `visited`), matching the TS.
    private void CollectTypeHierarchy(
        string startId,
        bool incoming,
        Dictionary<string, CodeGraphNode> nodes,
        List<CodeGraphEdge> edges,
        HashSet<string> visited)
    {
        var stack = new Stack<TypeFrame>();
        stack.Push(new TypeFrame(startId));

        while (stack.Count > 0)
        {
            var frame = stack.Peek();

            if (frame.Edges is null)
            {
                if (!visited.Add(frame.Id))
                {
                    stack.Pop();
                    continue;
                }

                var hierarchyEdges = incoming
                    ? store.GetIncomingEdges(frame.Id, TypeEdgeKinds)
                    : store.GetOutgoingEdges(frame.Id, TypeEdgeKinds);
                if (hierarchyEdges.Count == 0)
                {
                    stack.Pop();
                    continue;
                }

                frame.Edges = hierarchyEdges;
                frame.Neighbors = store.GetNodesByIds(EndpointIds(hierarchyEdges, incoming));
                frame.Index = 0;
            }

            var frameEdges = frame.Edges!;
            var frameNeighbors = frame.Neighbors!;
            var pushed = false;

            while (frame.Index < frameEdges.Count)
            {
                var edge = frameEdges[frame.Index];
                frame.Index++;

                var endpointId = incoming ? edge.Source : edge.Target;
                if (frameNeighbors.TryGetValue(endpointId, out var neighbor)
                    && !nodes.ContainsKey(neighbor.Id))
                {
                    nodes[neighbor.Id] = neighbor;
                    edges.Add(edge);
                    stack.Push(new TypeFrame(neighbor.Id));
                    pushed = true;
                    break;
                }
            }

            if (!pushed)
            {
                stack.Pop();
            }
        }
    }

    // ======================================================================
    // Usages
    // ======================================================================

    internal List<CodeGraphNodeEdgePair> FindUsages(string nodeId)
    {
        var result = new List<CodeGraphNodeEdgePair>();
        var incomingEdges = store.GetIncomingEdges(nodeId);
        if (incomingEdges.Count == 0)
        {
            return result;
        }

        var sources = store.GetNodesByIds(EndpointIds(incomingEdges, incoming: true));
        foreach (var edge in incomingEdges)
        {
            if (sources.TryGetValue(edge.Source, out var sourceNode))
            {
                result.Add(new CodeGraphNodeEdgePair(sourceNode, edge));
            }
        }

        return result;
    }

    // ======================================================================
    // Impact radius (explicit stack, two-phase per frame)
    // ======================================================================

    internal CodeGraphSubgraph GetImpactRadius(string nodeId, int maxDepth = 3)
    {
        var result = new CodeGraphSubgraph();
        var focal = store.GetNodeById(nodeId);
        if (focal is null)
        {
            return result;
        }

        result.Nodes[focal.Id] = focal;
        var visited = new HashSet<string>();
        CollectImpact(nodeId, maxDepth, result.Nodes, result.Edges, visited);
        result.Roots.Add(nodeId);
        return result;
    }

    // Iterative getImpactRecursive. Phase 1 descends container children at the SAME
    // depth; phase 2 walks incoming (non-contains) dependents at depth+1, recording each
    // dependency edge UNCONDITIONALLY (#1089). Mark-visited-before-depth (#1089); exclude
    // `contains` upward so a leaf symbol's impact does not re-expand its siblings (#536).
    private void CollectImpact(
        string startId,
        int maxDepth,
        Dictionary<string, CodeGraphNode> nodes,
        List<CodeGraphEdge> edges,
        HashSet<string> visited)
    {
        var stack = new Stack<ImpactFrame>();
        stack.Push(new ImpactFrame(startId, 0));

        while (stack.Count > 0)
        {
            var frame = stack.Peek();

            if (frame.Phase == 0)
            {
                if (!visited.Add(frame.Id))
                {
                    stack.Pop();
                    continue;
                }

                if (frame.Depth >= maxDepth)
                {
                    stack.Pop();
                    continue;
                }

                var focalNode = store.GetNodeById(frame.Id);
                if (focalNode is not null && ContainerKinds.Contains(focalNode.Kind))
                {
                    var containsEdges = store.GetOutgoingEdges(frame.Id, ContainsEdgeKinds);
                    frame.ContainsEdges = containsEdges;
                    frame.ContainsMap = containsEdges.Count > 0
                        ? store.GetNodesByIds(EndpointIds(containsEdges, incoming: false))
                        : EmptyNodeMap;
                }
                else
                {
                    frame.ContainsEdges = EmptyEdgeList;
                    frame.ContainsMap = EmptyNodeMap;
                }

                var incoming = FilterOutContains(store.GetIncomingEdges(frame.Id));
                frame.IncomingEdges = incoming;
                frame.IncomingMap = incoming.Count > 0
                    ? store.GetNodesByIds(EndpointIds(incoming, incoming: true))
                    : EmptyNodeMap;

                frame.ContainsIndex = 0;
                frame.IncomingIndex = 0;
                frame.Phase = 1;
            }

            if (frame.Phase == 1)
            {
                var containsEdges = frame.ContainsEdges!;
                var containsMap = frame.ContainsMap!;
                var advanced = false;

                while (frame.ContainsIndex < containsEdges.Count)
                {
                    var edge = containsEdges[frame.ContainsIndex];
                    frame.ContainsIndex++;

                    if (containsMap.TryGetValue(edge.Target, out var childNode)
                        && !visited.Contains(childNode.Id))
                    {
                        nodes[childNode.Id] = childNode;
                        edges.Add(edge);
                        // Children are part of the same symbol → recurse at the SAME depth.
                        stack.Push(new ImpactFrame(childNode.Id, frame.Depth));
                        advanced = true;
                        break;
                    }
                }

                if (advanced)
                {
                    continue;
                }

                frame.Phase = 2;
            }

            {
                var incomingEdges = frame.IncomingEdges!;
                var incomingMap = frame.IncomingMap!;
                var advanced = false;

                while (frame.IncomingIndex < incomingEdges.Count)
                {
                    var edge = incomingEdges[frame.IncomingIndex];
                    frame.IncomingIndex++;

                    if (!incomingMap.TryGetValue(edge.Source, out var sourceNode))
                    {
                        continue;
                    }

                    // Record the dependency edge unconditionally (#1089).
                    edges.Add(edge);

                    if (!visited.Contains(sourceNode.Id))
                    {
                        nodes[sourceNode.Id] = sourceNode;
                        stack.Push(new ImpactFrame(sourceNode.Id, frame.Depth + 1));
                        advanced = true;
                        break;
                    }
                }

                if (advanced)
                {
                    continue;
                }

                stack.Pop();
            }
        }
    }

    // ======================================================================
    // Shortest path (BFS with explicit queue)
    // ======================================================================

    internal List<CodeGraphPathStep>? FindPath(
        string fromId,
        string toId,
        IReadOnlyList<string>? edgeKinds = null)
    {
        var fromNode = store.GetNodeById(fromId);
        var toNode = store.GetNodeById(toId);
        if (fromNode is null || toNode is null)
        {
            return null;
        }

        var kinds = edgeKinds is { Count: > 0 } ek ? ek : null;
        var visited = new HashSet<string>();
        var queue = new Queue<PathState>();
        queue.Enqueue(new PathState(fromId, new List<CodeGraphPathStep> { new(fromNode, null) }));

        while (queue.Count > 0)
        {
            var state = queue.Dequeue();
            if (state.NodeId == toId)
            {
                return state.Path;
            }

            if (!visited.Add(state.NodeId))
            {
                continue;
            }

            var outgoingEdges = store.GetOutgoingEdges(state.NodeId, kinds);
            if (outgoingEdges.Count == 0)
            {
                continue;
            }

            var wantIds = new List<string>();
            foreach (var e in outgoingEdges)
            {
                if (!visited.Contains(e.Target))
                {
                    wantIds.Add(e.Target);
                }
            }

            var nextNodes = wantIds.Count > 0 ? store.GetNodesByIds(wantIds) : EmptyNodeMap;

            foreach (var edge in outgoingEdges)
            {
                if (!visited.Contains(edge.Target) && nextNodes.TryGetValue(edge.Target, out var nextNode))
                {
                    var nextPath = new List<CodeGraphPathStep>(state.Path) { new(nextNode, edge) };
                    queue.Enqueue(new PathState(edge.Target, nextPath));
                }
            }
        }

        return null;
    }

    // ======================================================================
    // Containment: ancestors / children
    // ======================================================================

    internal List<CodeGraphNode> GetAncestors(string nodeId)
    {
        var ancestors = new List<CodeGraphNode>();
        var visited = new HashSet<string>();
        var currentId = nodeId;

        while (true)
        {
            if (!visited.Add(currentId))
            {
                break;
            }

            var containingEdges = store.GetIncomingEdges(currentId, ContainsEdgeKinds);
            if (containingEdges.Count == 0)
            {
                break;
            }

            // At most one containing parent in a well-formed graph — take the first.
            var parentNode = store.GetNodeById(containingEdges[0].Source);
            if (parentNode is null)
            {
                break;
            }

            ancestors.Add(parentNode);
            currentId = parentNode.Id;
        }

        return ancestors;
    }

    internal List<CodeGraphNode> GetChildren(string nodeId)
    {
        var containsEdges = store.GetOutgoingEdges(nodeId, ContainsEdgeKinds);
        var children = new List<CodeGraphNode>();
        if (containsEdges.Count == 0)
        {
            return children;
        }

        var childNodes = store.GetNodesByIds(EndpointIds(containsEdges, incoming: false));
        foreach (var edge in containsEdges)
        {
            if (childNodes.TryGetValue(edge.Target, out var childNode))
            {
                children.Add(childNode);
            }
        }

        return children;
    }

    // ======================================================================
    // Helpers / frame types
    // ======================================================================

    private static List<string> EndpointIds(IReadOnlyList<CodeGraphEdge> edges, bool incoming)
    {
        var ids = new List<string>(edges.Count);
        foreach (var e in edges)
        {
            ids.Add(incoming ? e.Source : e.Target);
        }

        return ids;
    }

    private static List<CodeGraphEdge> FilterOutContains(IReadOnlyList<CodeGraphEdge> edges)
    {
        var kept = new List<CodeGraphEdge>();
        foreach (var e in edges)
        {
            if (e.Kind != CodeGraphEdgeKind.Contains)
            {
                kept.Add(e);
            }
        }

        return kept;
    }

    private readonly record struct BfsStep(CodeGraphNode Node, int Depth);

    private readonly record struct PathState(string NodeId, List<CodeGraphPathStep> Path);

    private sealed class DfsFrame
    {
        public DfsFrame(CodeGraphNode node, int depth)
        {
            Node = node;
            Depth = depth;
        }

        public CodeGraphNode Node { get; }

        public int Depth { get; }

        public List<CodeGraphEdge>? Edges { get; set; }

        public IReadOnlyDictionary<string, CodeGraphNode>? Neighbors { get; set; }

        public int Index { get; set; }
    }

    private sealed class CallFrame
    {
        public CallFrame(string id, int depth)
        {
            Id = id;
            Depth = depth;
        }

        public string Id { get; }

        public int Depth { get; }

        public IReadOnlyList<CodeGraphEdge>? Edges { get; set; }

        public IReadOnlyDictionary<string, CodeGraphNode>? Neighbors { get; set; }

        public int Index { get; set; }
    }

    private sealed class TypeFrame
    {
        public TypeFrame(string id)
        {
            Id = id;
        }

        public string Id { get; }

        public IReadOnlyList<CodeGraphEdge>? Edges { get; set; }

        public IReadOnlyDictionary<string, CodeGraphNode>? Neighbors { get; set; }

        public int Index { get; set; }
    }

    private sealed class ImpactFrame
    {
        public ImpactFrame(string id, int depth)
        {
            Id = id;
            Depth = depth;
        }

        public string Id { get; }

        public int Depth { get; }

        public int Phase { get; set; }

        public IReadOnlyList<CodeGraphEdge>? ContainsEdges { get; set; }

        public IReadOnlyDictionary<string, CodeGraphNode>? ContainsMap { get; set; }

        public int ContainsIndex { get; set; }

        public IReadOnlyList<CodeGraphEdge>? IncomingEdges { get; set; }

        public IReadOnlyDictionary<string, CodeGraphNode>? IncomingMap { get; set; }

        public int IncomingIndex { get; set; }
    }
}

// In-process {node, edge} pair returned by the traverser's derived queries (callers /
// callees / usages). Domain-typed — projected to CodeGraphNodeView/EdgeView only at the
// tool boundary.
internal sealed record CodeGraphNodeEdgePair(CodeGraphNode Node, CodeGraphEdge Edge);

// One step of a FindPath result. Edge is null for the origin node.
internal sealed record CodeGraphPathStep(CodeGraphNode Node, CodeGraphEdge? Edge);
