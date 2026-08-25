using System.Diagnostics;

// =============================================================================
// CodeGraphTreeSitterExtractor — the extraction ENGINE. Port of CodeGraph's
// TreeSitterExtractor (extraction/tree-sitter.ts). ONE generic engine driven by a
// data-only ICodeGraphLanguageExtractor config (analysis/01 §2.2, §3.1).
//
// Contract (analysis/01 §2.4 — the load-bearing design fact): extraction emits
//   nodes + `contains` edges + unresolvedReferences ONLY.
// Everything relational (calls/imports/extends/implements) is an unresolvedReference
// carrying a NAME STRING, not a target id — even same-file calls; the resolver phase
// turns those into real edges later. UTF-8 byte offsets throughout (Decision 22):
// startLine = StartPoint.Row + 1 (1-based), column = StartPoint.Column (0-based byte).
//
// MVP scope (analysis/01 §7): visitNode ladder + createNode/contains +
// extractFunction/Class/Method/Interface/Struct/Enum/Import/Call/Variable
// (+ Property/Field/TypeAlias/EnumMembers/Inheritance/FilePackage). Deferred:
// value-refs, function-refs, type-annotation/decorator/instantiation/static-member
// refs, and all framework/embedded branches — configs simply leave those hooks unset.
// =============================================================================
internal sealed partial class CodeGraphTreeSitterExtractor
{
    private readonly string _filePath;
    private readonly string _language;
    private readonly ICodeGraphLanguageExtractor _extractor;
    private readonly CodeGraphSourceText _source;
    private readonly long _now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    private readonly List<CodeGraphNode> _nodes = new();
    private readonly List<CodeGraphEdge> _edges = new();
    private readonly List<CodeGraphUnresolvedReference> _unresolvedRefs = new();
    private readonly List<CodeGraphExtractionError> _errors = new();
    private readonly List<string> _nodeStack = new();               // stack of enclosing scope ids
    private readonly Dictionary<string, CodeGraphNode> _nodesById = new(); // id -> node (first wins; buildQualifiedName / isInsideClassLikeNode index)

    // Hot-path dispatch sets (built once — the TS engine does linear `.includes`).
    private readonly HashSet<string> _functionTypes;
    private readonly HashSet<string> _classTypes;
    private readonly HashSet<string> _methodTypes;
    private readonly HashSet<string> _interfaceTypes;
    private readonly HashSet<string> _structTypes;
    private readonly HashSet<string> _enumTypes;
    private readonly HashSet<string> _typeAliasTypes;
    private readonly HashSet<string> _importTypes;
    private readonly HashSet<string> _callTypes;
    private readonly HashSet<string> _variableTypes;
    private readonly HashSet<string>? _fieldTypes;
    private readonly HashSet<string>? _propertyTypes;
    private readonly HashSet<string>? _enumMemberTypes;
    private readonly HashSet<string>? _extraClassNodeTypes;

    public CodeGraphTreeSitterExtractor(
        string filePath,
        string language,
        ICodeGraphLanguageExtractor extractor,
        CodeGraphSourceText source)
    {
        _filePath = filePath;
        _language = language;
        _extractor = extractor;
        _source = source;

        _functionTypes = new HashSet<string>(extractor.FunctionTypes);
        _classTypes = new HashSet<string>(extractor.ClassTypes);
        _methodTypes = new HashSet<string>(extractor.MethodTypes);
        _interfaceTypes = new HashSet<string>(extractor.InterfaceTypes);
        _structTypes = new HashSet<string>(extractor.StructTypes);
        _enumTypes = new HashSet<string>(extractor.EnumTypes);
        _typeAliasTypes = new HashSet<string>(extractor.TypeAliasTypes);
        _importTypes = new HashSet<string>(extractor.ImportTypes);
        _callTypes = new HashSet<string>(extractor.CallTypes);
        _variableTypes = new HashSet<string>(extractor.VariableTypes);
        _fieldTypes = extractor.FieldTypes is { } ft ? new HashSet<string>(ft) : null;
        _propertyTypes = extractor.PropertyTypes is { } pt ? new HashSet<string>(pt) : null;
        _enumMemberTypes = extractor.EnumMemberTypes is { } et ? new HashSet<string>(et) : null;
        _extraClassNodeTypes = extractor.ExtraClassNodeTypes is { } ct ? new HashSet<string>(ct) : null;

        // Function-as-value capture spec (null when the language has none). Fields +
        // methods for the fn-ref/value-ref flushes live in CodeGraphFunctionRef.cs.
        _fnRefSpec = CodeGraphFunctionRef.SpecFor(language);
    }

    // ---------------------------------------------------------------------------
    // Entry: walk a parsed tree into an extraction result. Mirrors TS extract().
    // ---------------------------------------------------------------------------
    public CodeGraphExtractionResult Extract(CodeGraphTsTree tree)
    {
        Stopwatch sw = Stopwatch.StartNew();
        try
        {
            // File node — the scope root. Not created via CreateNode (it is the one
            // node with a `file:<path>` id, not the hashed formula).
            CodeGraphNode fileNode = new(
                Id: "file:" + _filePath,
                Kind: CodeGraphNodeKind.File,
                Name: Path.GetFileName(_filePath),
                QualifiedName: _filePath,
                FilePath: _filePath,
                Language: _language,
                StartLine: 1,
                EndLine: SourceLineCount(),
                StartColumn: 0,
                EndColumn: 0,
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
                UpdatedAt: _now);
            _nodes.Add(fileNode);
            _nodesById.TryAdd(fileNode.Id, fileNode);
            _nodeStack.Add(fileNode.Id);

            CodeGraphTsNode root = tree.RootNode;

            // JVM package header (Kotlin/Java): wrap top-level decls in a namespace
            // node so their qualifiedName carries the FQN for cross-file resolution.
            string? packageNodeId = ExtractFilePackage(root);
            if (packageNodeId != null) _nodeStack.Add(packageNodeId);

            VisitNode(root);

            // Gate + flush the two deferred, additive edge features while the file's
            // nodes/import refs are complete and the file node is still on the stack
            // (analysis/01 §2.1, §7): function-as-value candidates → `function_ref`
            // unresolvedReferences, then same-file value-`references` edges.
            FlushFnRefCandidates();
            FlushValueRefs(root);

            if (packageNodeId != null) _nodeStack.RemoveAt(_nodeStack.Count - 1);
            _nodeStack.RemoveAt(_nodeStack.Count - 1);
        }
        catch (Exception ex)
        {
            _errors.Add(new CodeGraphExtractionError(
                Message: $"Parse error: {ex.Message}",
                Severity: "error",
                FilePath: _filePath,
                Line: null,
                Column: null,
                Code: "parse_error"));
        }
        sw.Stop();

        return new CodeGraphExtractionResult(_nodes, _edges, _unresolvedRefs, _errors, sw.Elapsed.TotalMilliseconds);
    }

    // ---------------------------------------------------------------------------
    // ExtractorContext surface (internal — called by CodeGraphExtractorContext).
    // ---------------------------------------------------------------------------
    internal string FilePath => _filePath;
    internal CodeGraphSourceText Source => _source;
    internal IReadOnlyList<string> NodeStack => _nodeStack;
    internal IReadOnlyList<CodeGraphNode> Nodes => _nodes;
    internal void PushScope(string nodeId) => _nodeStack.Add(nodeId);
    internal void PopScope() { if (_nodeStack.Count > 0) _nodeStack.RemoveAt(_nodeStack.Count - 1); }
    internal void AddUnresolvedReference(CodeGraphUnresolvedReference reference) => _unresolvedRefs.Add(reference);

    private CodeGraphExtractorContext MakeExtractorContext() => new(this);

    // ---------------------------------------------------------------------------
    // The walk — a single manual recursion, an if/else ladder on node.Type keyed
    // against the config's type sets, then recurse over named children.
    // ---------------------------------------------------------------------------
    internal void VisitNode(CodeGraphTsNode node)
    {
        string nodeType = node.Type;
        bool skipChildren = false;

        // Language custom visitor hook — return true to consume the subtree.
        if (_extractor.VisitNode != null && _extractor.VisitNode(node, MakeExtractorContext()))
        {
            // The hook consumed this subtree, so the walkers below never descend into
            // it — scan it for function-as-value candidates (capture-only, halts at
            // nested functions). E.g. Scala's hook handles `val table = Seq(targetCb)`.
            ScanFnRefSubtree(node, 0);
            return;
        }

        // Function-as-value capture (#756) — independent of the dispatch ladder below
        // (its container types have no other handler there), so it can never shadow or
        // be shadowed by an extraction branch.
        MaybeCaptureFnRefs(node, nodeType);

        if (_functionTypes.Contains(nodeType))
        {
            if (IsInsideClassLikeNode() && _methodTypes.Contains(nodeType))
            {
                string kind = _extractor.ClassifyMethodNode?.Invoke(node) == "constructor"
                    ? CodeGraphNodeKind.Constructor
                    : CodeGraphNodeKind.Method;
                ExtractMethod(node, kind);
            }
            else ExtractFunction(node);
            skipChildren = true;
        }
        else if (_classTypes.Contains(nodeType))
        {
            switch (_extractor.ClassifyClassNode?.Invoke(node) ?? "class")
            {
                case "struct": ExtractStruct(node); break;
                case "enum": ExtractEnum(node); break;
                case "interface": ExtractInterface(node); break;
                case "trait": ExtractClass(node, CodeGraphNodeKind.Trait); break;
                default: ExtractClass(node); break;
            }
            skipChildren = true;
        }
        else if (_extraClassNodeTypes != null && _extraClassNodeTypes.Contains(nodeType))
        {
            ExtractClass(node);
            skipChildren = true;
        }
        else if (_methodTypes.Contains(nodeType))
        {
            string? methodKind = _extractor.ClassifyMethodNode?.Invoke(node);
            if (methodKind == "property")
            {
                CodeGraphNode? propNode = ExtractProperty(node);
                CodeGraphTsNode valueNode = node.ChildByField("value");
                if (propNode != null && !valueNode.IsNull)
                {
                    _nodeStack.Add(propNode.Id);
                    VisitFunctionBody(valueNode, string.Empty);
                    _nodeStack.RemoveAt(_nodeStack.Count - 1);
                }
                // A field initializer can register callbacks (`static handlers = { click: onClick }`).
                ScanFnRefSubtree(node, 0);
                skipChildren = true;
            }
            else
            {
                ExtractMethod(
                    node,
                    methodKind == "constructor"
                        ? CodeGraphNodeKind.Constructor
                        : CodeGraphNodeKind.Method);
                skipChildren = true;
            }
        }
        else if (_interfaceTypes.Contains(nodeType)) { ExtractInterface(node); skipChildren = true; }
        else if (_structTypes.Contains(nodeType)) { ExtractStruct(node); skipChildren = true; }
        else if (_enumTypes.Contains(nodeType)) { ExtractEnum(node); skipChildren = true; }
        else if (_typeAliasTypes.Contains(nodeType)) { skipChildren = ExtractTypeAlias(node); }
        else if (_propertyTypes != null && _propertyTypes.Contains(nodeType) && IsInsideClassLikeNode())
        {
            ExtractProperty(node);
            // Property initializers aren't walked — scan for function-as-value candidates.
            ScanFnRefSubtree(node, 0);
            skipChildren = true;
        }
        else if (_fieldTypes != null && _fieldTypes.Contains(nodeType) && IsInsideClassLikeNode())
        {
            ExtractField(node);
            // Field initializers aren't walked — scan for function-as-value candidates.
            ScanFnRefSubtree(node, 0);
            skipChildren = true;
        }
        else if (_variableTypes.Contains(nodeType) && !IsInsideClassLikeNode())
        {
            ExtractVariable(node);
            // ExtractVariable doesn't walk every initializer shape — scan the declaration
            // for function-as-value candidates (`const routes = { home: renderHome }`).
            ScanFnRefSubtree(node, 0);
            skipChildren = true;
        }
        else if (_importTypes.Contains(nodeType)) { ExtractImport(node); }
        else if (_callTypes.Contains(nodeType)) { ExtractCall(node); }

        if (!skipChildren)
        {
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (!child.IsNull) VisitNode(child);
            }
        }
    }

    // ---------------------------------------------------------------------------
    // Node creation & ids.
    // ---------------------------------------------------------------------------
    internal CodeGraphNode? CreateNode(string kind, string name, CodeGraphTsNode node, CodeGraphNodeExtra extra = default)
    {
        // Skip empty names — not meaningful symbols, and would cause FK violations.
        if (string.IsNullOrEmpty(name)) return null;

        int startLine = (int)node.StartPoint.Row + 1;
        string id = CodeGraphNodeIdFactory.NodeId(_filePath, kind, name, startLine);

        // Sibling-body grammars (Dart) put the body beyond the signature node's
        // range — extend endLine to the resolved body so the node spans it.
        int endLine = (int)node.EndPoint.Row + 1;
        if (kind is CodeGraphNodeKind.Function or CodeGraphNodeKind.Method
            or CodeGraphNodeKind.Constructor)
        {
            CodeGraphTsNode? body = _extractor.ResolveBody?.Invoke(node, _extractor.BodyField);
            if (body is { } b && !b.IsNull)
            {
                int bodyEnd = (int)b.EndPoint.Row + 1;
                if (bodyEnd > endLine) endLine = bodyEnd;
            }
        }

        IReadOnlyList<string>? decorators = extra.Decorators;
        IReadOnlyList<string>? mods = _extractor.ExtractModifiers?.Invoke(node);
        if (mods is { Count: > 0 })
        {
            List<string> merged = new();
            if (decorators != null) merged.AddRange(decorators);
            merged.AddRange(mods);
            decorators = merged;
        }

        CodeGraphNode newNode = new(
            Id: id,
            Kind: kind,
            Name: name,
            QualifiedName: extra.QualifiedName ?? BuildQualifiedName(name),
            FilePath: _filePath,
            Language: _language,
            StartLine: startLine,
            EndLine: endLine,
            StartColumn: (int)node.StartPoint.Column,
            EndColumn: (int)node.EndPoint.Column,
            Docstring: extra.Docstring,
            Signature: extra.Signature,
            Visibility: extra.Visibility,
            IsExported: extra.IsExported ?? false,
            IsAsync: extra.IsAsync ?? false,
            IsStatic: extra.IsStatic ?? false,
            IsAbstract: extra.IsAbstract ?? false,
            Decorators: decorators,
            TypeParameters: extra.TypeParameters,
            ReturnType: extra.ReturnType,
            UpdatedAt: _now);

        _nodes.Add(newNode);
        _nodesById.TryAdd(id, newNode); // first wins — matches TS `nodes.find` semantics

        if (_nodeStack.Count > 0)
        {
            string parentId = _nodeStack[^1];
            _edges.Add(new CodeGraphEdge(parentId, id, CodeGraphEdgeKind.Contains, null, null, null, null));
        }

        // Value-reference bookkeeping (const/var targets + reader scopes) for FlushValueRefs.
        if (ValueRefsEnabled) CaptureValueRefScope(kind, name, id, node);

        return newNode;
    }

    private string BuildQualifiedName(string name)
    {
        // Semantic hierarchy only (no file path — it pollutes FTS). The C/C++
        // namespace prefix is deferred (always empty in the MVP set).
        List<string> parts = new();
        foreach (string nodeId in _nodeStack)
        {
            if (_nodesById.TryGetValue(nodeId, out CodeGraphNode? n) && n.Kind != CodeGraphNodeKind.File)
                parts.Add(n.Name);
        }
        parts.Add(name);
        return string.Join("::", parts);
    }

    private bool IsInsideClassLikeNode()
    {
        if (_nodeStack.Count == 0) return false;
        if (!_nodesById.TryGetValue(_nodeStack[^1], out CodeGraphNode? parent)) return false;
        return parent.Kind is CodeGraphNodeKind.Class or CodeGraphNodeKind.Struct
            or CodeGraphNodeKind.Interface or CodeGraphNodeKind.Trait
            or CodeGraphNodeKind.Enum or CodeGraphNodeKind.Module;
    }

    // ---------------------------------------------------------------------------
    // Name resolution (port of extractName/extractNameRaw, MVP subset).
    // ---------------------------------------------------------------------------
    private string ExtractName(CodeGraphTsNode node)
    {
        string raw = ExtractNameRaw(node);
        return _extractor.RecoverMangledName != null ? _extractor.RecoverMangledName(raw) : raw;
    }

    private string ExtractNameRaw(CodeGraphTsNode node)
    {
        string? hookName = _extractor.ResolveName?.Invoke(node, _source);
        if (!string.IsNullOrEmpty(hookName)) return hookName;

        CodeGraphTsNode nameNode = node.ChildByField(_extractor.NameField);
        if (!nameNode.IsNull)
        {
            CodeGraphTsNode resolved = nameNode;
            // Unwrap C/C++ pointer/reference return declarators (no-op elsewhere).
            while (resolved.Type is "pointer_declarator" or "reference_declarator")
            {
                CodeGraphTsNode inner = resolved.ChildByField("declarator");
                if (inner.IsNull) inner = resolved.NamedChild(0);
                if (inner.IsNull) break;
                resolved = inner;
            }
            if (resolved.Type is "function_declarator" or "declarator")
            {
                CodeGraphTsNode innerName = resolved.ChildByField("declarator");
                if (innerName.IsNull) innerName = resolved.NamedChild(0);
                return innerName.IsNull ? resolved.Text : innerName.Text;
            }
            return resolved.Text;
        }

        if (node.Type is "arrow_function" or "function_expression") return "<anonymous>";

        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type is "identifier" or "type_identifier" or "simple_identifier" or "constant")
                return child.Text;
        }
        return "<anonymous>";
    }

    // ---------------------------------------------------------------------------
    // Emitters.
    // ---------------------------------------------------------------------------
    private void ExtractFunction(CodeGraphTsNode node, string? nameOverride = null)
    {
        // A function with a receiver (Rust impl method) is really a method.
        if (nameOverride == null && _extractor.GetReceiverType != null &&
            !string.IsNullOrEmpty(_extractor.GetReceiverType(node, _source)))
        {
            string kind = _extractor.ClassifyMethodNode?.Invoke(node) == "constructor"
                ? CodeGraphNodeKind.Constructor
                : CodeGraphNodeKind.Method;
            ExtractMethod(node, kind);
            return;
        }

        string name = nameOverride ?? ExtractName(node);
        if (nameOverride == null && name == "<anonymous>" &&
            node.Type is "arrow_function" or "function_expression")
        {
            CodeGraphTsNode parent = node.Parent;
            if (!parent.IsNull && parent.Type == "variable_declarator")
            {
                CodeGraphTsNode varName = parent.ChildByField("name");
                if (!varName.IsNull) name = varName.Text;
            }
        }

        if (name == "<anonymous>")
        {
            // Still walk the body (module wrappers hold named inner functions/calls).
            CodeGraphTsNode body = ResolveBodyNode(node);
            if (!body.IsNull) VisitFunctionBody(body, string.Empty);
            return;
        }

        if (_extractor.IsMisparsedFunction != null && _extractor.IsMisparsedFunction(name, node))
        {
            CodeGraphTsNode body = ResolveBodyNode(node);
            if (!body.IsNull) VisitFunctionBody(body, string.Empty);
            return;
        }

        CodeGraphNode? funcNode = CreateNode(CodeGraphNodeKind.Function, name, node, new CodeGraphNodeExtra
        {
            Docstring = CodeGraphTreeSitterHelpers.GetPrecedingDocstring(node),
            Signature = _extractor.GetSignature?.Invoke(node, _source),
            Visibility = _extractor.GetVisibility?.Invoke(node),
            IsExported = _extractor.IsExported?.Invoke(node, _source),
            IsAsync = _extractor.IsAsync?.Invoke(node),
            IsStatic = _extractor.IsStatic?.Invoke(node),
            ReturnType = _extractor.GetReturnType?.Invoke(node, _source)
        });
        if (funcNode == null) return;

        _nodeStack.Add(funcNode.Id);
        CodeGraphTsNode fnBody = ResolveBodyNode(node);
        if (!fnBody.IsNull) VisitFunctionBody(fnBody, funcNode.Id);
        _nodeStack.RemoveAt(_nodeStack.Count - 1);
    }

    private void ExtractMethod(CodeGraphTsNode node, string kind = CodeGraphNodeKind.Method)
    {
        string? receiverType = _extractor.GetReceiverType?.Invoke(node, _source);
        bool hasReceiver = !string.IsNullOrEmpty(receiverType);

        if (!IsInsideClassLikeNode() && !_extractor.MethodsAreTopLevel && !hasReceiver)
        {
            // A method_definition inside an object literal is ephemeral — walk its
            // body for calls but don't mint a node.
            CodeGraphTsNode parent = node.Parent;
            if (!parent.IsNull && parent.Type is "object" or "object_expression")
            {
                CodeGraphTsNode objBody = ResolveBodyNode(node);
                if (!objBody.IsNull) VisitFunctionBody(objBody, string.Empty);
                return;
            }
            ExtractFunction(node);
            return;
        }

        string name = ExtractName(node);
        if (_extractor.IsMisparsedFunction != null && _extractor.IsMisparsedFunction(name, node))
        {
            CodeGraphTsNode body = ResolveBodyNode(node);
            if (!body.IsNull) VisitFunctionBody(body, string.Empty);
            return;
        }

        CodeGraphNode? methodNode = CreateNode(kind, name, node, new CodeGraphNodeExtra
        {
            Docstring = CodeGraphTreeSitterHelpers.GetPrecedingDocstring(node),
            Signature = _extractor.GetSignature?.Invoke(node, _source),
            Visibility = _extractor.GetVisibility?.Invoke(node),
            IsAsync = _extractor.IsAsync?.Invoke(node),
            IsStatic = _extractor.IsStatic?.Invoke(node),
            ReturnType = _extractor.GetReturnType?.Invoke(node, _source),
            QualifiedName = hasReceiver ? $"{receiverType}::{name}" : null
        });
        if (methodNode == null) return;

        // Receiver-typed method with no class-like parent (Rust impl block): add a
        // contains edge from the owning struct/class/enum/trait found by name.
        if (hasReceiver && !IsInsideClassLikeNode())
        {
            foreach (CodeGraphNode n in _nodes)
            {
                if (n.Name == receiverType && n.FilePath == _filePath &&
                    n.Kind is CodeGraphNodeKind.Struct or CodeGraphNodeKind.Class
                        or CodeGraphNodeKind.Enum or CodeGraphNodeKind.Trait)
                {
                    _edges.Add(new CodeGraphEdge(n.Id, methodNode.Id, CodeGraphEdgeKind.Contains, null, null, null, null));
                    break;
                }
            }
        }

        _nodeStack.Add(methodNode.Id);
        CodeGraphTsNode mBody = ResolveBodyNode(node);
        if (!mBody.IsNull) VisitFunctionBody(mBody, methodNode.Id);
        _nodeStack.RemoveAt(_nodeStack.Count - 1);
    }

    private void ExtractClass(CodeGraphTsNode node, string kind = CodeGraphNodeKind.Class)
    {
        CodeGraphTsNode resolvedBody = ResolveBodyNode(node);
        if (_extractor.SkipBodilessClass && resolvedBody.IsNull) return;

        CodeGraphNode? classNode = CreateNode(kind, ExtractName(node), node, new CodeGraphNodeExtra
        {
            Docstring = CodeGraphTreeSitterHelpers.GetPrecedingDocstring(node),
            Visibility = _extractor.GetVisibility?.Invoke(node),
            IsExported = _extractor.IsExported?.Invoke(node, _source)
        });
        if (classNode == null) return;

        ExtractInheritance(node, classNode.Id);

        _nodeStack.Add(classNode.Id);
        CodeGraphTsNode body = resolvedBody.IsNull ? node : resolvedBody;
        int count = body.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = body.NamedChild(i);
            if (!child.IsNull) VisitNode(child);
        }
        // Synthesize compile-time members (Java Lombok) while class still on stack.
        _extractor.SynthesizeMembers?.Invoke(node, MakeExtractorContext());
        _nodeStack.RemoveAt(_nodeStack.Count - 1);
    }

    private void ExtractInterface(CodeGraphTsNode node)
    {
        string kind = _extractor.InterfaceKind ?? CodeGraphNodeKind.Interface;
        CodeGraphNode? interfaceNode = CreateNode(kind, ExtractName(node), node, new CodeGraphNodeExtra
        {
            Docstring = CodeGraphTreeSitterHelpers.GetPrecedingDocstring(node),
            IsExported = _extractor.IsExported?.Invoke(node, _source)
        });
        if (interfaceNode == null) return;

        ExtractInheritance(node, interfaceNode.Id);

        _nodeStack.Add(interfaceNode.Id);
        CodeGraphTsNode body = ResolveBodyNode(node);
        if (body.IsNull) body = node;
        int count = body.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = body.NamedChild(i);
            if (!child.IsNull) VisitNode(child);
        }
        _nodeStack.RemoveAt(_nodeStack.Count - 1);
    }

    private void ExtractStruct(CodeGraphTsNode node)
    {
        // No body = forward decl / type reference (except C# positional records).
        CodeGraphTsNode body = node.ChildByField(_extractor.BodyField);
        if (body.IsNull && node.Type != "record_declaration") return;

        CodeGraphNode? structNode = CreateNode(CodeGraphNodeKind.Struct, ExtractName(node), node, new CodeGraphNodeExtra
        {
            Docstring = CodeGraphTreeSitterHelpers.GetPrecedingDocstring(node),
            Visibility = _extractor.GetVisibility?.Invoke(node),
            IsExported = _extractor.IsExported?.Invoke(node, _source)
        });
        if (structNode == null) return;

        ExtractInheritance(node, structNode.Id);

        if (!body.IsNull)
        {
            _nodeStack.Add(structNode.Id);
            int count = body.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = body.NamedChild(i);
                if (!child.IsNull) VisitNode(child);
            }
            _nodeStack.RemoveAt(_nodeStack.Count - 1);
        }
    }

    private void ExtractEnum(CodeGraphTsNode node)
    {
        CodeGraphTsNode body = ResolveBodyNode(node);
        if (body.IsNull) return; // forward decl / type reference

        CodeGraphNode? enumNode = CreateNode(CodeGraphNodeKind.Enum, ExtractName(node), node, new CodeGraphNodeExtra
        {
            Docstring = CodeGraphTreeSitterHelpers.GetPrecedingDocstring(node),
            Visibility = _extractor.GetVisibility?.Invoke(node),
            IsExported = _extractor.IsExported?.Invoke(node, _source)
        });
        if (enumNode == null) return;

        ExtractInheritance(node, enumNode.Id);

        _nodeStack.Add(enumNode.Id);
        int count = body.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = body.NamedChild(i);
            if (child.IsNull) continue;
            if (_enumMemberTypes != null && _enumMemberTypes.Contains(child.Type)) ExtractEnumMembers(child);
            else VisitNode(child);
        }
        _nodeStack.RemoveAt(_nodeStack.Count - 1);
    }

    private void ExtractEnumMembers(CodeGraphTsNode node)
    {
        CodeGraphTsNode nameNode = node.ChildByField("name");
        if (!nameNode.IsNull)
        {
            CreateNode(CodeGraphNodeKind.EnumMember, nameNode.Text, node);
            return;
        }

        bool found = false;
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type is "simple_identifier" or "identifier" or "property_identifier")
            {
                CreateNode(CodeGraphNodeKind.EnumMember, child.Text, child);
                found = true;
            }
        }
        if (!found && node.NamedChildCount == 0)
            CreateNode(CodeGraphNodeKind.EnumMember, node.Text, node);
    }

    private CodeGraphNode? ExtractProperty(CodeGraphTsNode node)
    {
        string? docstring = CodeGraphTreeSitterHelpers.GetPrecedingDocstring(node);
        string? visibility = _extractor.GetVisibility?.Invoke(node);
        bool isStatic = _extractor.IsStatic?.Invoke(node) ?? false;

        string? hookName = _extractor.ExtractPropertyName?.Invoke(node, _source);
        string? name;
        if (!string.IsNullOrEmpty(hookName))
        {
            name = hookName;
        }
        else
        {
            CodeGraphTsNode nameNode = node.ChildByField("name");
            if (nameNode.IsNull) nameNode = node.ChildByField("property");
            if (nameNode.IsNull) nameNode = FirstNamedChildOfType(node, "identifier");
            name = nameNode.IsNull ? null : nameNode.Text;
        }
        if (string.IsNullOrEmpty(name)) return null;

        bool isTsJsField = node.Type is "public_field_definition" or "field_definition";
        CodeGraphTsNode typeNode = isTsJsField
            ? node.ChildByField("type")
            : FirstNamedChildNotOfTypes(node, PropertyTypeSkip);
        string? typeText = typeNode.IsNull ? null : StripLeadingColon(typeNode.Text);
        string signature = typeText != null ? $"{typeText} {name}" : name;

        return CreateNode(CodeGraphNodeKind.Property, name, node, new CodeGraphNodeExtra
        {
            Docstring = docstring,
            Signature = signature,
            Visibility = visibility,
            IsStatic = isStatic
        });
    }

    private void ExtractField(CodeGraphTsNode node)
    {
        string? docstring = CodeGraphTreeSitterHelpers.GetPrecedingDocstring(node);
        string? visibility = _extractor.GetVisibility?.Invoke(node);
        bool isStatic = _extractor.IsStatic?.Invoke(node) ?? false;

        // A Java/C# `static final` / `const` field is a constant (value-ref target).
        string fieldKind =
            (_language is CodeGraphLanguage.Java or CodeGraphLanguage.CSharp) &&
            (_extractor.IsConst?.Invoke(node) ?? false)
                ? CodeGraphNodeKind.Constant
                : CodeGraphNodeKind.Field;

        List<CodeGraphTsNode> declarators = NamedChildrenOfType(node, "variable_declarator");
        if (declarators.Count == 0)
        {
            CodeGraphTsNode varDecl = FirstNamedChildOfType(node, "variable_declaration");
            if (!varDecl.IsNull) declarators = NamedChildrenOfType(varDecl, "variable_declarator");
        }

        if (declarators.Count > 0)
        {
            CodeGraphTsNode varDecl2 = FirstNamedChildOfType(node, "variable_declaration");
            CodeGraphTsNode typeSearch = varDecl2.IsNull ? node : varDecl2;
            CodeGraphTsNode typeNode = FirstNamedChildNotOfTypes(typeSearch, FieldTypeSkip);
            string? typeText = typeNode.IsNull ? null : typeNode.Text;

            foreach (CodeGraphTsNode decl in declarators)
            {
                CodeGraphTsNode nameNode = decl.ChildByField("name");
                if (nameNode.IsNull) nameNode = FirstNamedChildOfType(decl, "identifier");
                if (nameNode.IsNull) continue;
                string nm = nameNode.Text;
                string signature = typeText != null ? $"{typeText} {nm}" : nm;
                CreateNode(fieldKind, nm, decl, new CodeGraphNodeExtra
                {
                    Docstring = docstring,
                    Signature = signature,
                    Visibility = visibility,
                    IsStatic = isStatic
                });
            }
        }
        else
        {
            CodeGraphTsNode nameNode = node.ChildByField("name");
            if (nameNode.IsNull) nameNode = FirstNamedChildOfType(node, "identifier");
            if (!nameNode.IsNull)
            {
                CreateNode(fieldKind, nameNode.Text, node, new CodeGraphNodeExtra
                {
                    Docstring = docstring,
                    Visibility = visibility,
                    IsStatic = isStatic
                });
            }
        }
    }

    private void ExtractVariable(CodeGraphTsNode node)
    {
        bool isConst = _extractor.IsConst?.Invoke(node) ?? false;
        string kind = isConst ? CodeGraphNodeKind.Constant : CodeGraphNodeKind.Variable;
        string? docstring = CodeGraphTreeSitterHelpers.GetPrecedingDocstring(node);
        bool isExported = _extractor.IsExported?.Invoke(node, _source) ?? false;

        if (_language is CodeGraphLanguage.TypeScript or CodeGraphLanguage.JavaScript
            or CodeGraphLanguage.Tsx or CodeGraphLanguage.Jsx or CodeGraphLanguage.ArkTs)
        {
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.Type != "variable_declarator") continue;
                CodeGraphTsNode nameNode = child.ChildByField("name");
                CodeGraphTsNode valueNode = child.ChildByField("value");
                if (nameNode.IsNull) continue;
                // Destructured patterns produce ugly multi-line names — skip.
                if (nameNode.Type is "object_pattern" or "array_pattern") continue;
                string name = nameNode.Text;
                // Arrow / function expressions assigned to a const are functions.
                if (!valueNode.IsNull && valueNode.Type is "arrow_function" or "function_expression")
                {
                    ExtractFunction(valueNode);
                    continue;
                }
                CreateNode(kind, name, child, new CodeGraphNodeExtra
                {
                    Docstring = docstring,
                    Signature = InitSignature(valueNode),
                    IsExported = isExported
                });
                // Walk the initializer for calls — object literals are left alone.
                if (!valueNode.IsNull && valueNode.Type is not ("object" or "object_expression"))
                    VisitFunctionBody(valueNode, string.Empty);
            }
        }
        else if (_language is CodeGraphLanguage.Python or CodeGraphLanguage.Ruby)
        {
            CodeGraphTsNode left = node.ChildByField("left");
            if (left.IsNull) left = node.NamedChild(0);
            CodeGraphTsNode right = node.ChildByField("right");
            if (right.IsNull) right = node.NamedChild(1);
            if (!left.IsNull && left.Type is "identifier" or "constant")
            {
                CreateNode(kind, left.Text, node, new CodeGraphNodeExtra
                {
                    Docstring = docstring,
                    Signature = InitSignature(right)
                });
            }
        }
        else if (_language == CodeGraphLanguage.Go)
        {
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode spec = node.NamedChild(i);
                if (spec.Type is not ("var_spec" or "const_spec")) continue;
                CodeGraphTsNode nameNode = spec.NamedChild(0);
                CodeGraphNode? varNode = null;
                if (!nameNode.IsNull && nameNode.Type == "identifier")
                {
                    CodeGraphTsNode valueNode = spec.NamedChildCount > 1
                        ? spec.NamedChild(spec.NamedChildCount - 1)
                        : default;
                    varNode = CreateNode(
                        node.Type == "const_declaration" ? CodeGraphNodeKind.Constant : CodeGraphNodeKind.Variable,
                        nameNode.Text, spec, new CodeGraphNodeExtra
                        {
                            Docstring = docstring,
                            Signature = InitSignature(valueNode)
                        });
                }
                CodeGraphTsNode valueField = spec.ChildByField("value");
                if (!valueField.IsNull)
                {
                    if (varNode != null) _nodeStack.Add(varNode.Id);
                    VisitFunctionBody(valueField, varNode?.Id ?? string.Empty);
                    if (varNode != null) _nodeStack.RemoveAt(_nodeStack.Count - 1);
                }
            }

            if (node.Type == "short_var_declaration")
            {
                CodeGraphTsNode left = node.ChildByField("left");
                CodeGraphTsNode right = node.ChildByField("right");
                if (!left.IsNull)
                {
                    if (left.Type == "expression_list")
                    {
                        int lc = left.NamedChildCount;
                        for (int j = 0; j < lc; j++)
                        {
                            CodeGraphTsNode id = left.NamedChild(j);
                            if (id.Type == "identifier")
                                CreateNode(CodeGraphNodeKind.Variable, id.Text, node,
                                    new CodeGraphNodeExtra { Docstring = docstring, Signature = InitSignature(right) });
                        }
                    }
                    else
                    {
                        CreateNode(CodeGraphNodeKind.Variable, left.Text, node,
                            new CodeGraphNodeExtra { Docstring = docstring, Signature = InitSignature(right) });
                    }
                }
            }
        }
        else
        {
            // Generic fallback for other languages.
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.Type is "identifier" or "variable_declarator")
                {
                    string name = child.Type == "identifier" ? child.Text : ExtractName(child);
                    if (!string.IsNullOrEmpty(name) && name != "<anonymous>")
                        CreateNode(kind, name, child, new CodeGraphNodeExtra { Docstring = docstring, IsExported = isExported });
                }
            }
        }
    }

    private bool ExtractTypeAlias(CodeGraphTsNode node)
    {
        string name = ExtractName(node);
        if (name == "<anonymous>") return false;
        string? docstring = CodeGraphTreeSitterHelpers.GetPrecedingDocstring(node);
        bool? isExported = _extractor.IsExported?.Invoke(node, _source);

        string? resolvedKind = _extractor.ResolveTypeAliasKind?.Invoke(node, _source);

        if (resolvedKind == "struct")
        {
            CodeGraphNode? structNode = CreateNode(CodeGraphNodeKind.Struct, name, node,
                new CodeGraphNodeExtra { Docstring = docstring, IsExported = isExported });
            if (structNode == null) return true;
            _nodeStack.Add(structNode.Id);
            CodeGraphTsNode typeChild = node.ChildByField("type");
            if (typeChild.IsNull) typeChild = FindChildByTypes(node, _extractor.StructTypes);
            if (!typeChild.IsNull)
            {
                ExtractInheritance(typeChild, structNode.Id);
                CodeGraphTsNode body = typeChild.ChildByField(_extractor.BodyField);
                if (body.IsNull) body = typeChild;
                int c = body.NamedChildCount;
                for (int i = 0; i < c; i++)
                {
                    CodeGraphTsNode child = body.NamedChild(i);
                    if (!child.IsNull) VisitNode(child);
                }
            }
            _nodeStack.RemoveAt(_nodeStack.Count - 1);
            return true;
        }

        if (resolvedKind == "enum")
        {
            CodeGraphNode? enumNode = CreateNode(CodeGraphNodeKind.Enum, name, node,
                new CodeGraphNodeExtra { Docstring = docstring, IsExported = isExported });
            if (enumNode == null) return true;
            _nodeStack.Add(enumNode.Id);
            CodeGraphTsNode innerEnum = FindChildByTypes(node, _extractor.EnumTypes);
            if (!innerEnum.IsNull)
            {
                ExtractInheritance(innerEnum, enumNode.Id);
                CodeGraphTsNode body = ResolveBodyNode(innerEnum);
                if (!body.IsNull)
                {
                    int c = body.NamedChildCount;
                    for (int i = 0; i < c; i++)
                    {
                        CodeGraphTsNode child = body.NamedChild(i);
                        if (child.IsNull) continue;
                        if (_enumMemberTypes != null && _enumMemberTypes.Contains(child.Type)) ExtractEnumMembers(child);
                        else VisitNode(child);
                    }
                }
            }
            _nodeStack.RemoveAt(_nodeStack.Count - 1);
            return true;
        }

        if (resolvedKind == "interface")
        {
            string kind = _extractor.InterfaceKind ?? CodeGraphNodeKind.Interface;
            CodeGraphNode? interfaceNode = CreateNode(kind, name, node,
                new CodeGraphNodeExtra { Docstring = docstring, IsExported = isExported });
            if (interfaceNode == null) return true;
            CodeGraphTsNode typeChild = node.ChildByField("type");
            if (!typeChild.IsNull) ExtractInheritance(typeChild, interfaceNode.Id);
            if (_language == CodeGraphLanguage.Go && !typeChild.IsNull)
                ExtractGoInterfaceMethods(typeChild, interfaceNode.Id);
            return true;
        }

        CreateNode(CodeGraphNodeKind.TypeAlias, name, node,
            new CodeGraphNodeExtra { Docstring = docstring, IsExported = isExported });
        return false;
    }

    private void ExtractGoInterfaceMethods(CodeGraphTsNode interfaceType, string ifaceId)
    {
        _nodeStack.Add(ifaceId);
        int count = interfaceType.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode m = interfaceType.NamedChild(i);
            if (m.Type is not ("method_elem" or "method_spec")) continue;
            CodeGraphTsNode nameNode = m.ChildByField("name");
            if (nameNode.IsNull) nameNode = m.NamedChild(0);
            if (nameNode.IsNull) continue;
            string mname = nameNode.Text;
            if (!string.IsNullOrEmpty(mname))
                CreateNode(CodeGraphNodeKind.Method, mname, m,
                    new CodeGraphNodeExtra { Signature = _extractor.GetSignature?.Invoke(m, _source) });
        }
        _nodeStack.RemoveAt(_nodeStack.Count - 1);
    }

    private void ExtractImport(CodeGraphTsNode node)
    {
        string importText = node.Text.Trim();

        if (_extractor.ExtractImport != null)
        {
            CodeGraphImportInfo? info = _extractor.ExtractImport(node, _source);
            if (info != null)
            {
                CreateNode(CodeGraphNodeKind.Import, info.ModuleName, node,
                    new CodeGraphNodeExtra { Signature = info.Signature });
                if (!info.HandledRefs && !string.IsNullOrEmpty(info.ModuleName) && _nodeStack.Count > 0)
                    PushRef(_nodeStack[^1], info.ModuleName, CodeGraphEdgeKind.Imports, node);
                // Per-binding import refs (recall enhancement) are deferred.
                return;
            }
            // Hook returned null → it declined; only multi-import inline handlers below.
        }

        // Python `import os, sys` — one import per module.
        if (_language == CodeGraphLanguage.Python && node.Type == "import_statement")
        {
            string? importParentId = _nodeStack.Count > 0 ? _nodeStack[^1] : null;
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.Type == "dotted_name")
                {
                    CreateNode(CodeGraphNodeKind.Import, child.Text, node, new CodeGraphNodeExtra { Signature = importText });
                    if (importParentId != null) PushRef(importParentId, child.Text, CodeGraphEdgeKind.Imports, child);
                }
                else if (child.Type == "aliased_import")
                {
                    CodeGraphTsNode dottedName = FirstNamedChildOfType(child, "dotted_name");
                    if (!dottedName.IsNull)
                    {
                        CreateNode(CodeGraphNodeKind.Import, dottedName.Text, node, new CodeGraphNodeExtra { Signature = importText });
                        if (importParentId != null) PushRef(importParentId, dottedName.Text, CodeGraphEdgeKind.Imports, dottedName);
                    }
                }
            }
            return;
        }

        // Go imports — single or grouped, one import per spec.
        if (_language == CodeGraphLanguage.Go)
        {
            string? parentId = _nodeStack.Count > 0 ? _nodeStack[^1] : null;
            CodeGraphTsNode importSpecList = FirstNamedChildOfType(node, "import_spec_list");
            if (!importSpecList.IsNull)
            {
                foreach (CodeGraphTsNode spec in NamedChildrenOfType(importSpecList, "import_spec"))
                    ExtractGoImportSpec(spec, parentId);
            }
            else
            {
                CodeGraphTsNode importSpec = FirstNamedChildOfType(node, "import_spec");
                if (!importSpec.IsNull) ExtractGoImportSpec(importSpec, parentId);
            }
            return;
        }

        // A hook that returned null intentionally declined — no generic fallback.
        if (_extractor.ExtractImport != null) return;

        CreateNode(CodeGraphNodeKind.Import, importText, node, new CodeGraphNodeExtra { Signature = importText });
    }

    private void ExtractGoImportSpec(CodeGraphTsNode spec, string? parentId)
    {
        CodeGraphTsNode stringLiteral = FirstNamedChildOfType(spec, "interpreted_string_literal");
        if (stringLiteral.IsNull) return;
        string importPath = stringLiteral.Text.Replace("\"", string.Empty).Replace("'", string.Empty);
        if (string.IsNullOrEmpty(importPath)) return;
        CreateNode(CodeGraphNodeKind.Import, importPath, spec, new CodeGraphNodeExtra { Signature = spec.Text.Trim() });
        if (parentId != null) PushRef(parentId, importPath, CodeGraphEdgeKind.Imports, spec);
    }

    private void ExtractCall(CodeGraphTsNode node)
    {
        if (_nodeStack.Count == 0) return;
        string callerId = _nodeStack[^1];

        string calleeName = string.Empty;

        // Java/Kotlin method_invocation, PHP member/scoped call — 'name' + receiver.
        CodeGraphTsNode nameField = node.ChildByField("name");
        CodeGraphTsNode objectField = node.ChildByField("object");
        if (objectField.IsNull) objectField = node.ChildByField("scope");

        if (!nameField.IsNull && !objectField.IsNull &&
            node.Type is "method_invocation" or "member_call_expression" or "scoped_call_expression")
        {
            string methodName = nameField.Text;
            string receiverName;
            if (objectField.Type == "field_access")
            {
                CodeGraphTsNode inner = objectField.ChildByField("object");
                CodeGraphTsNode fld = objectField.ChildByField("field");
                receiverName = !inner.IsNull && !fld.IsNull && inner.Type is "this" or "this_expression"
                    ? fld.Text
                    : objectField.Text;
            }
            else
            {
                receiverName = objectField.Text;
            }
            if (receiverName.StartsWith("$", StringComparison.Ordinal)) receiverName = receiverName[1..];

            if (!string.IsNullOrEmpty(methodName))
                calleeName = IsSkippedReceiver(receiverName) ? methodName : $"{receiverName}.{methodName}";
        }
        else
        {
            CodeGraphTsNode func = node.ChildByField("function");
            if (func.IsNull) func = node.NamedChild(0);

            // C++ explicit operator call `a.operator+(b)` / `p->operator+(b)` (#1247):
            // tree-sitter-cpp can't parse an operator_name in field position, so the
            // callee is NOT a field_expression — the call_expression carries
            // `function: <receiver>` plus an ERROR child wrapping the operator_name.
            // Reading the function field alone yields just the receiver (`a`), an
            // unresolvable ref. Recover `<receiver>.operator+` so it resolves like any
            // other member call (the name-matcher's CppOperatorRegex admits the operator
            // member part). Infix forms (`a + b`, `a[i]`) need real type inference and
            // are tracked separately upstream (#1258).
            if (_language == CodeGraphLanguage.Cpp && !func.IsNull)
            {
                string operatorName = string.Empty;
                int nc = node.NamedChildCount;
                for (int i = 0; i < nc; i++)
                {
                    CodeGraphTsNode child = node.NamedChild(i);
                    if (child.IsNull || child.Type != "ERROR") continue;
                    CodeGraphTsNode op = FirstNamedChildOfType(child, "operator_name");
                    if (!op.IsNull)
                    {
                        operatorName = op.Text;
                        break;
                    }
                }

                if (operatorName.Length > 0)
                {
                    // Call sites may space the symbolic name (`it.operator * ()`) while
                    // definitions index compact (`operator*`) — normalize so they match.
                    // The word forms (`operator new`) keep their space.
                    string sym = operatorName["operator".Length..].Trim();
                    if (sym.Length > 0 && !char.IsLetterOrDigit(sym[0]) && sym[0] != '_')
                    {
                        operatorName = "operator" + RemoveAllWhitespace(sym);
                    }

                    // `->` receivers resolve identically to `.` ones. A receiver that
                    // isn't a simple identifier/member chain (`(*it)`, a call result, …)
                    // can't aid type inference, and a bare operator name would fall
                    // through to exact-name matching — which GUESSES among the many
                    // same-named operators. Drop the ref: a silent miss, never a wrong
                    // edge. `this->` keeps the bare name, matching how `this.method()`
                    // calls are emitted — exact-name's same-file preference is reliable.
                    string receiverText = RemoveAllWhitespace(func.Text.Replace("->", "."));
                    if (receiverText != "this" && !IsSimpleMemberChain(receiverText)) return;
                    string opCallee = receiverText == "this" ? operatorName : receiverText + "." + operatorName;
                    PushRef(callerId, opCallee, CodeGraphEdgeKind.Calls, node);
                    return;
                }
            }

            if (!func.IsNull)
            {
                string ft = func.Type;
                if (ft is "member_expression" or "attribute" or "selector_expression"
                    or "navigation_expression" or "field_expression")
                {
                    CodeGraphTsNode property = func.ChildByField("property");
                    if (property.IsNull) property = func.ChildByField("field");
                    if (property.IsNull)
                    {
                        CodeGraphTsNode child1 = func.NamedChild(1);
                        if (!child1.IsNull && child1.Type == "navigation_suffix")
                        {
                            property = FirstNamedChildOfType(child1, "simple_identifier");
                            if (property.IsNull) property = child1;
                        }
                        else
                        {
                            property = child1;
                        }
                    }
                    if (!property.IsNull)
                    {
                        string methodName = property.Text;

                        // #1247, grammar-parsed shape: newer tree-sitter-cpp builds parse
                        // `other.operator < (x)` / `(*it).operator*()` as a plain
                        // field_expression whose field IS the operator_name (no ERROR
                        // node). Apply the same rules as the ERROR-node recovery above:
                        // normalize spaced symbolic names compact, keep `this` bare, and
                        // DROP the ref for a non-simple receiver — a bare operator name
                        // would let exact-name matching guess among same-named operators.
                        if (_language == CodeGraphLanguage.Cpp && property.Type == "operator_name")
                        {
                            string opSym = methodName["operator".Length..].Trim();
                            if (opSym.Length > 0 && !char.IsLetterOrDigit(opSym[0]) && opSym[0] != '_')
                            {
                                methodName = "operator" + RemoveAllWhitespace(opSym);
                            }

                            CodeGraphTsNode opRecv = func.ChildByField("argument");
                            if (opRecv.IsNull) opRecv = func.ChildByField("object");
                            if (opRecv.IsNull) opRecv = func.NamedChild(0);
                            string opRecvText = opRecv.IsNull
                                ? string.Empty
                                : RemoveAllWhitespace(opRecv.Text.Replace("->", "."));
                            if (opRecvText == "this")
                            {
                                calleeName = methodName;
                            }
                            else if (IsSimpleMemberChain(opRecvText))
                            {
                                calleeName = opRecvText + "." + methodName;
                            }
                            else
                            {
                                return; // silent miss, never a wrong edge
                            }

                            if (!string.IsNullOrEmpty(calleeName))
                                PushRef(callerId, calleeName, CodeGraphEdgeKind.Calls, node);
                            return;
                        }

                        CodeGraphTsNode receiver = func.ChildByField("object");
                        if (receiver.IsNull) receiver = func.ChildByField("operand");
                        if (receiver.IsNull) receiver = func.ChildByField("argument");
                        if (receiver.IsNull) receiver = func.NamedChild(0);
                        if (!receiver.IsNull && receiver.Type is "identifier" or "simple_identifier" or "field_identifier")
                        {
                            string rn = receiver.Text;
                            calleeName = IsSkippedReceiver(rn) ? methodName : $"{rn}.{methodName}";
                        }
                        else
                        {
                            calleeName = methodName;
                        }
                    }
                }
                else if (ft is "scoped_identifier" or "scoped_call_expression")
                {
                    calleeName = func.Text; // Module::function()
                }
                else
                {
                    calleeName = func.Text;
                }
            }
        }

        if (!string.IsNullOrEmpty(calleeName))
            PushRef(callerId, calleeName, CodeGraphEdgeKind.Calls, node);
    }

    private void ExtractInheritance(CodeGraphTsNode node, string classId)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.IsNull) continue;
            string ct = child.Type;

            // extends: TS extends_clause, Java superclass/extends_interfaces, PHP base_clause.
            if (ct is "extends_clause" or "superclass" or "base_clause" or "extends_interfaces")
            {
                CodeGraphTsNode typeList = FirstNamedChildOfType(child, "type_list");
                if (!typeList.IsNull)
                {
                    int tc = typeList.NamedChildCount;
                    for (int j = 0; j < tc; j++)
                    {
                        CodeGraphTsNode target = typeList.NamedChild(j);
                        if (!target.IsNull) PushRef(classId, target.Text, CodeGraphEdgeKind.Extends, target);
                    }
                }
                else
                {
                    CodeGraphTsNode target = child.NamedChild(0);
                    if (!target.IsNull) PushRef(classId, target.Text, CodeGraphEdgeKind.Extends, target);
                }
            }

            // implements: TS implements_clause, Java super_interfaces.
            if (ct is "implements_clause" or "class_interface_clause" or "super_interfaces" or "interfaces")
            {
                CodeGraphTsNode typeList = FirstNamedChildOfType(child, "type_list");
                if (!typeList.IsNull)
                {
                    int tc = typeList.NamedChildCount;
                    for (int j = 0; j < tc; j++)
                    {
                        CodeGraphTsNode iface = typeList.NamedChild(j);
                        if (!iface.IsNull) PushRef(classId, iface.Text, CodeGraphEdgeKind.Implements, iface);
                    }
                }
                else
                {
                    int cc = child.NamedChildCount;
                    for (int j = 0; j < cc; j++)
                    {
                        CodeGraphTsNode iface = child.NamedChild(j);
                        if (!iface.IsNull) PushRef(classId, iface.Text, CodeGraphEdgeKind.Implements, iface);
                    }
                }
            }

            // Python superclass list: `class Flask(Scaffold, Mixin):`
            if (ct == "argument_list" && node.Type == "class_definition")
            {
                int cc = child.NamedChildCount;
                for (int j = 0; j < cc; j++)
                {
                    CodeGraphTsNode arg = child.NamedChild(j);
                    if (arg.Type is "identifier" or "attribute")
                        PushRef(classId, arg.Text, CodeGraphEdgeKind.Extends, arg);
                }
            }

            // Go interface embedding: `interface { LabelQuerier; ... }`
            if (ct == "constraint_elem")
            {
                CodeGraphTsNode typeId = FirstNamedChildOfType(child, "type_identifier");
                if (!typeId.IsNull) PushRef(classId, typeId.Text, CodeGraphEdgeKind.Extends, typeId);
            }

            // Go struct embedding: field_declaration with no field_identifier.
            if (ct == "field_declaration" && !HasNamedChildOfType(child, "field_identifier"))
            {
                CodeGraphTsNode typeId = FirstNamedChildOfType(child, "type_identifier");
                if (!typeId.IsNull) PushRef(classId, typeId.Text, CodeGraphEdgeKind.Extends, typeId);
            }

            // Rust supertraits: `trait Sub: Super + Display { ... }`
            if (ct == "trait_bounds")
            {
                int bc = child.NamedChildCount;
                for (int j = 0; j < bc; j++)
                {
                    CodeGraphTsNode bound = child.NamedChild(j);
                    CodeGraphTsNode posNode = default;
                    if (bound.Type == "type_identifier") posNode = bound;
                    else if (bound.Type == "generic_type") posNode = FirstNamedChildOfType(bound, "type_identifier");
                    else if (bound.Type == "higher_ranked_trait_bound")
                    {
                        CodeGraphTsNode generic = FirstNamedChildOfType(bound, "generic_type");
                        posNode = !generic.IsNull ? FirstNamedChildOfType(generic, "type_identifier")
                                                  : FirstNamedChildOfType(bound, "type_identifier");
                    }
                    if (!posNode.IsNull) PushRef(classId, posNode.Text, CodeGraphEdgeKind.Extends, posNode);
                }
            }

            // C#: `class Movie : BaseItem, IPlugin` → base_list (extends for all).
            if (ct == "base_list")
            {
                int bc = child.NamedChildCount;
                for (int j = 0; j < bc; j++)
                {
                    CodeGraphTsNode baseType = child.NamedChild(j);
                    if (baseType.IsNull) continue;
                    string name;
                    if (baseType.Type == "generic_name")
                    {
                        CodeGraphTsNode id = FirstNamedChildOfType(baseType, "identifier");
                        name = id.IsNull ? baseType.Text : id.Text;
                    }
                    else
                    {
                        name = baseType.Text;
                    }
                    PushRef(classId, name, CodeGraphEdgeKind.Extends, baseType);
                }
            }

            // JavaScript class_heritage bare identifier: `class Foo extends Bar {}`.
            if (ct is "identifier" or "type_identifier" && node.Type == "class_heritage")
                PushRef(classId, child.Text, CodeGraphEdgeKind.Extends, child);

            // Recurse into container wrappers (Go field_declaration_list, TS class_heritage).
            if (ct is "field_declaration_list" or "class_heritage")
                ExtractInheritance(child, classId);
        }
    }

    private string? ExtractFilePackage(CodeGraphTsNode root)
    {
        IReadOnlyList<string>? types = _extractor.PackageTypes;
        if (types == null || types.Count == 0 || _extractor.ExtractPackage == null) return null;

        CodeGraphTsNode pkgNode = default;
        int count = root.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = root.NamedChild(i);
            if (!child.IsNull && types.Contains(child.Type)) { pkgNode = child; break; }
        }
        if (pkgNode.IsNull) return null;

        string? pkgName = _extractor.ExtractPackage(pkgNode, _source);
        if (string.IsNullOrEmpty(pkgName)) return null;

        CodeGraphNode? ns = CreateNode(CodeGraphNodeKind.Namespace, pkgName, pkgNode);
        return ns?.Id;
    }

    // ---------------------------------------------------------------------------
    // Function-body walk — extracts calls + nested named functions/structural
    // nodes (port of visitFunctionBody, MVP subset).
    // ---------------------------------------------------------------------------
    internal void VisitFunctionBody(CodeGraphTsNode body, string functionId)
    {
        _ = functionId; // (parity with TS signature; unused in the MVP walk)
        VisitForCallsAndStructure(body);
    }

    private void VisitForCallsAndStructure(CodeGraphTsNode node)
    {
        string nodeType = node.Type;

        // Function-as-value capture (#756) — function bodies are walked HERE, not in
        // VisitNode, so the capture hook must fire in both walkers (the callback-
        // registered-inside-a-function case is the dominant one).
        MaybeCaptureFnRefs(node, nodeType);

        if (_callTypes.Contains(nodeType))
        {
            ExtractCall(node);
        }
        else if (_extractor.ExtractBareCall != null)
        {
            string? calleeName = _extractor.ExtractBareCall(node, _source);
            if (!string.IsNullOrEmpty(calleeName) && _nodeStack.Count > 0)
                PushRef(_nodeStack[^1], calleeName, CodeGraphEdgeKind.Calls, node);
        }

        // Nested NAMED functions become their own nodes (anonymous fall through so
        // their inner calls attribute to the enclosing scope).
        if (_functionTypes.Contains(nodeType))
        {
            string nestedName = ExtractName(node);
            if (!string.IsNullOrEmpty(nestedName) && nestedName != "<anonymous>")
            {
                ExtractFunction(node);
                return;
            }
        }

        // Structural nodes declared inside a body (each visits its own children).
        if (_classTypes.Contains(nodeType))
        {
            switch (_extractor.ClassifyClassNode?.Invoke(node) ?? "class")
            {
                case "struct": ExtractStruct(node); break;
                case "enum": ExtractEnum(node); break;
                case "interface": ExtractInterface(node); break;
                case "trait": ExtractClass(node, CodeGraphNodeKind.Trait); break;
                default: ExtractClass(node); break;
            }
            return;
        }
        if (_structTypes.Contains(nodeType)) { ExtractStruct(node); return; }
        if (_enumTypes.Contains(nodeType)) { ExtractEnum(node); return; }
        if (_interfaceTypes.Contains(nodeType)) { ExtractInterface(node); return; }

        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (!child.IsNull) VisitForCallsAndStructure(child);
        }
    }

    // ---------------------------------------------------------------------------
    // Small helpers.
    // ---------------------------------------------------------------------------
    private static readonly HashSet<string> PropertyTypeSkip = new()
    {
        "modifier", "modifiers", "identifier", "accessor_list", "accessors", "equals_value_clause"
    };

    private static readonly HashSet<string> FieldTypeSkip = new()
    {
        "modifiers", "modifier", "variable_declarator", "variable_declaration", "marker_annotation", "annotation"
    };

    private static bool IsSkippedReceiver(string name) =>
        name is "self" or "this" or "cls" or "super" or "parent" or "static";

    private CodeGraphTsNode ResolveBodyNode(CodeGraphTsNode node)
    {
        if (_extractor.ResolveBody != null)
        {
            CodeGraphTsNode? b = _extractor.ResolveBody(node, _extractor.BodyField);
            if (b is { } body && !body.IsNull) return body;
        }
        return node.ChildByField(_extractor.BodyField);
    }

    // `\s+` strip for the operator-call recovery (#1247) — call sites space freely.
    private static string RemoveAllWhitespace(string value)
    {
        Span<char> buffer = value.Length <= 256 ? stackalloc char[value.Length] : new char[value.Length];
        int n = 0;
        foreach (char c in value)
        {
            if (!char.IsWhiteSpace(c)) buffer[n++] = c;
        }

        return n == value.Length ? value : new string(buffer[..n]);
    }

    // `^[A-Za-z_][\w.]*$` — a bare identifier or dotted member chain (#1247).
    private static bool IsSimpleMemberChain(string value)
    {
        if (value.Length == 0) return false;
        char first = value[0];
        if (!char.IsLetter(first) && first != '_') return false;
        for (int i = 1; i < value.Length; i++)
        {
            char c = value[i];
            if (!char.IsLetterOrDigit(c) && c != '_' && c != '.') return false;
        }

        return true;
    }

    private void PushRef(string fromNodeId, string referenceName, string referenceKind, CodeGraphTsNode posNode) =>
        _unresolvedRefs.Add(new CodeGraphUnresolvedReference(
            FromNodeId: fromNodeId,
            ReferenceName: referenceName,
            ReferenceKind: referenceKind,
            Line: (int)posNode.StartPoint.Row + 1,
            Column: (int)posNode.StartPoint.Column,
            FilePath: null,
            Language: null,
            Candidates: null,
            RowId: null));

    private int SourceLineCount() => _source.LineColumnAt(_source.ByteLength).Line;

    private static string StripLeadingColon(string text)
    {
        string t = text;
        if (t.StartsWith(":", StringComparison.Ordinal)) t = t[1..].TrimStart();
        return t;
    }

    private static CodeGraphTsNode FirstNamedChildOfType(CodeGraphTsNode node, string type)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type == type) return child;
        }
        return default;
    }

    private static CodeGraphTsNode FirstNamedChildNotOfTypes(CodeGraphTsNode node, HashSet<string> skip)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (!skip.Contains(child.Type)) return child;
        }
        return default;
    }

    private static CodeGraphTsNode FindChildByTypes(CodeGraphTsNode node, IReadOnlyList<string> types)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (types.Contains(child.Type)) return child;
        }
        return default;
    }

    private static bool HasNamedChildOfType(CodeGraphTsNode node, string type)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            if (node.NamedChild(i).Type == type) return true;
        }
        return false;
    }

    private static List<CodeGraphTsNode> NamedChildrenOfType(CodeGraphTsNode node, string type)
    {
        List<CodeGraphTsNode> result = new();
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type == type) result.Add(child);
        }
        return result;
    }

    private string? InitSignature(CodeGraphTsNode valueNode)
    {
        if (valueNode.IsNull) return null;
        string t = valueNode.Text;
        if (t.Length == 0) return null;
        string sliced = t.Length > 100 ? t[..100] : t;
        return "= " + sliced + (sliced.Length >= 100 ? "..." : string.Empty);
    }
}
