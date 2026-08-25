// =============================================================================
// CodeGraphTerraformExtractor — Terraform/HCL language config. Port of
// extraction/languages/terraform.ts (@tree-sitter-grammars/tree-sitter-hcl).
//
// The HCL grammar is generic: every Terraform top-level construct is a `block`,
// distinguished only by its first `identifier` child (resource/variable/data/…),
// with `string_lit` labels after it. All extraction is therefore driven from the
// VisitNode hook, which mints class/module/variable/namespace nodes and synthesizes
// qualified-name references (var.X, local.K, module.M, data.T.N, <type>.<name>)
// from expression subtrees. `:`-scoped refs bridge the module boundary.
// =============================================================================
internal static class CodeGraphTerraformExtractor
{
    private static readonly HashSet<string> BuiltinHeads = new(System.StringComparer.Ordinal)
        { "each", "count", "self", "path", "terraform" };
    private static readonly HashSet<string> BuiltinKeywords = new(System.StringComparer.Ordinal)
        { "null", "true", "false" };
    private static readonly HashSet<string> ModuleMetaArgs = new(System.StringComparer.Ordinal)
        { "source", "version", "count", "for_each", "providers", "depends_on" };

    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = [],
        ClassTypes = [],
        MethodTypes = [],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = [],
        CallTypes = [],
        VariableTypes = [],
        NameField = "",
        BodyField = "",
        ParamsField = "",

        VisitNode = VisitTerraformNode
    };

    private static bool VisitTerraformNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        if (node.Type != "block")
        {
            // .tfvars files: top-level `name = value` assignments SET the root module
            // variable of that name.
            if (node.Type == "attribute"
                && ctx.FilePath.EndsWith(".tfvars", System.StringComparison.Ordinal)
                && !node.Parent.IsNull && node.Parent.Type == "body"
                && !node.Parent.Parent.IsNull && node.Parent.Parent.Type == "config_file")
            {
                CodeGraphTsNode idNode = FirstNamedChildOfType(node, "identifier");
                string? fileNodeId = ctx.NodeStack.Count > 0 ? ctx.NodeStack[0] : null;
                if (!idNode.IsNull && fileNodeId != null)
                    EmitRef(ctx, fileNodeId, $"var.{idNode.Text}", CodeGraphEdgeKind.References, node);
                return true;
            }
            return false;
        }

        BlockHeader? header = ReadBlockHeader(node);
        if (header == null) return false;
        string type = header.Type;
        List<string> labels = header.Labels;
        CodeGraphTsNode body = GetBlockBody(node);

        // locals { ... } — every attribute becomes its own constant.
        if (type == "locals" && labels.Count == 0)
        {
            EmitLocals(body, ctx);
            return true;
        }
        // terraform { ... } settings block — no symbols, no project refs.
        if (type == "terraform" && labels.Count == 0) return true;

        // moved / import / removed state-migration blocks — anchor refs to the file.
        if ((type == "moved" || type == "import" || type == "removed") && labels.Count == 0)
        {
            string? fileNodeId = ctx.NodeStack.Count > 0 ? ctx.NodeStack[0] : null;
            if (!body.IsNull && fileNodeId != null)
                EmitReferencesInBody(body, ctx, fileNodeId, suppressScoped: true, skipTopAttrs: null);
            return true;
        }
        // assert { condition = … } — anchor its refs to the file node.
        if (type == "assert" && labels.Count == 0)
        {
            string? fileNodeId = ctx.NodeStack.Count > 0 ? ctx.NodeStack[0] : null;
            if (!body.IsNull && fileNodeId != null)
                EmitReferencesInBody(body, ctx, fileNodeId, suppressScoped: true, skipTopAttrs: null);
            return true;
        }

        BlockDecl? decl = DescribeBlock(type, labels);
        if (decl == null) return false;

        // provider "aws" { alias = "east" } is addressed as `aws.east`.
        if (type == "provider" && !body.IsNull && labels.Count > 0 && labels[0].Length > 0)
        {
            string? alias = ReadStringAttr(body, "alias", ctx.Source);
            if (alias != null)
            {
                decl.Name = $"{labels[0]}.{alias}";
                decl.QualifiedName = $"provider.{labels[0]}.{alias}";
                decl.Signature = $"provider \"{labels[0]}\" alias=\"{alias}\"";
            }
        }

        CodeGraphNode? created = ctx.CreateNode(decl.Kind, decl.Name, node, new CodeGraphNodeExtra
        {
            QualifiedName = decl.QualifiedName,
            Signature = decl.Signature,
            IsExported = decl.Kind == CodeGraphNodeKind.Variable
        });
        if (created == null) return true;

        if (!body.IsNull)
        {
            ctx.PushScope(created.Id);
            try
            {
                HashSet<string> skipTopAttrs = new(System.StringComparer.Ordinal);
                if (type == "resource" || type == "data")
                {
                    EmitProviderSelectionRef(body, ctx, created.Id);
                    skipTopAttrs.Add("provider");
                }
                if (type == "module")
                {
                    EmitModuleProvidersRefs(body, ctx, created.Id);
                    skipTopAttrs.Add("providers");
                }
                EmitReferencesInBody(body, ctx, created.Id, suppressScoped: false, skipTopAttrs: skipTopAttrs);
                if (type == "module" && labels.Count > 0 && labels[0].Length > 0)
                    EmitModuleWiring(labels[0], node, body, ctx, created.Id);
            }
            finally
            {
                ctx.PopScope();
            }
        }
        return true;
    }

    private sealed class BlockHeader
    {
        public string Type = string.Empty;
        public List<string> Labels = new();
    }

    private sealed class BlockDecl
    {
        public string Kind = string.Empty;
        public string Name = string.Empty;
        public string QualifiedName = string.Empty;
        public string Signature = string.Empty;
    }

    private static string StringLitValue(CodeGraphTsNode node)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode c = node.NamedChild(i);
            if (c.Type == "template_literal") return c.Text;
        }
        return string.Empty; // empty string ("") has no template_literal
    }

    private static BlockHeader? ReadBlockHeader(CodeGraphTsNode block)
    {
        int count = block.NamedChildCount;
        List<CodeGraphTsNode> named = new();
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode c = block.NamedChild(i);
            if (!c.IsNull) named.Add(c);
        }
        if (named.Count == 0 || named[0].Type != "identifier") return null;
        BlockHeader header = new() { Type = named[0].Text };
        for (int i = 1; i < named.Count; i++)
        {
            CodeGraphTsNode child = named[i];
            if (child.Type == "string_lit") header.Labels.Add(StringLitValue(child));
            else if (child.Type == "identifier") header.Labels.Add(child.Text);
            else break;
        }
        return header;
    }

    private static CodeGraphTsNode GetBlockBody(CodeGraphTsNode block)
    {
        int count = block.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode c = block.NamedChild(i);
            if (c.Type == "body") return c;
        }
        return default;
    }

    // Walk an expression subtree and invoke onRef for every dotted reference.
    private static void CollectReferences(CodeGraphTsNode expr, System.Action<string, int, int> onRef)
    {
        Queue<CodeGraphTsNode> queue = new();
        queue.Enqueue(expr);
        while (queue.Count > 0)
        {
            CodeGraphTsNode n = queue.Dequeue();
            if (n.Type == "variable_expr") EmitRefFromVariableExpr(n, onRef);
            int count = n.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode c = n.NamedChild(i);
                if (!c.IsNull) queue.Enqueue(c);
            }
        }
    }

    private static void EmitRefFromVariableExpr(CodeGraphTsNode varExpr, System.Action<string, int, int> onRef)
    {
        CodeGraphTsNode id = FirstNamedChildOfType(varExpr, "identifier");
        if (id.IsNull) return;
        string head = id.Text;
        if (BuiltinHeads.Contains(head) || BuiltinKeywords.Contains(head)) return;

        List<string> attrs = new();
        CodeGraphTsNode cursor = varExpr.NextNamedSibling;
        while (!cursor.IsNull)
        {
            if (cursor.Type == "get_attr")
            {
                CodeGraphTsNode attrId = FirstNamedChildOfType(cursor, "identifier");
                if (attrId.IsNull) break;
                attrs.Add(attrId.Text);
                cursor = cursor.NextNamedSibling;
            }
            else if (cursor.Type is "index" or "new_index" or "legacy_index" or "splat" or "attr_splat" or "full_splat")
            {
                cursor = cursor.NextNamedSibling;
            }
            else break;
        }

        int line = (int)varExpr.StartPoint.Row + 1;
        int col = (int)varExpr.StartPoint.Column;
        foreach (string qname in QualifyReference(head, attrs)) onRef(qname, line, col);
    }

    private static List<string> QualifyReference(string head, List<string> attrs)
    {
        List<string> refs = new();
        switch (head)
        {
            case "var":
                if (attrs.Count > 0) refs.Add($"var.{attrs[0]}");
                return refs;
            case "local":
                if (attrs.Count > 0) refs.Add($"local.{attrs[0]}");
                return refs;
            case "module":
                if (attrs.Count == 0) return refs;
                refs.Add($"module.{attrs[0]}");
                if (attrs.Count > 1) refs.Add($"module.{attrs[0]}:output.{attrs[1]}");
                if (attrs.Count > 2 && attrs[1] == "outputs") refs.Add($"module.{attrs[0]}:remote-output.{attrs[2]}");
                return refs;
            case "data":
                if (attrs.Count > 1) refs.Add($"data.{attrs[0]}.{attrs[1]}");
                return refs;
            default:
                if (attrs.Count > 0) refs.Add($"{head}.{attrs[0]}");
                return refs;
        }
    }

    private static BlockDecl? DescribeBlock(string type, List<string> labels)
    {
        string? first = labels.Count > 0 ? labels[0] : null;
        string? second = labels.Count > 1 ? labels[1] : null;
        switch (type)
        {
            case "resource":
                if (string.IsNullOrEmpty(first) || string.IsNullOrEmpty(second)) return null;
                return new BlockDecl { Kind = CodeGraphNodeKind.Class, Name = $"{first}.{second}", QualifiedName = $"{first}.{second}", Signature = $"resource \"{first}\" \"{second}\"" };
            case "data":
                if (string.IsNullOrEmpty(first) || string.IsNullOrEmpty(second)) return null;
                return new BlockDecl { Kind = CodeGraphNodeKind.Class, Name = $"{first}.{second}", QualifiedName = $"data.{first}.{second}", Signature = $"data \"{first}\" \"{second}\"" };
            case "module":
                if (string.IsNullOrEmpty(first)) return null;
                return new BlockDecl { Kind = CodeGraphNodeKind.Module, Name = first!, QualifiedName = $"module.{first}", Signature = $"module \"{first}\"" };
            case "variable":
                if (string.IsNullOrEmpty(first)) return null;
                return new BlockDecl { Kind = CodeGraphNodeKind.Variable, Name = first!, QualifiedName = $"var.{first}", Signature = $"variable \"{first}\"" };
            case "output":
                if (string.IsNullOrEmpty(first)) return null;
                return new BlockDecl { Kind = CodeGraphNodeKind.Variable, Name = first!, QualifiedName = $"output.{first}", Signature = $"output \"{first}\"" };
            case "provider":
                if (string.IsNullOrEmpty(first)) return null;
                return new BlockDecl { Kind = CodeGraphNodeKind.Namespace, Name = first!, QualifiedName = $"provider.{first}", Signature = $"provider \"{first}\"" };
            default:
                return null;
        }
    }

    private static void EmitLocals(CodeGraphTsNode body, CodeGraphExtractorContext ctx)
    {
        if (body.IsNull) return;
        int count = body.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode attr = body.NamedChild(i);
            if (attr.IsNull || attr.Type != "attribute") continue;
            CodeGraphTsNode idNode = FirstNamedChildOfType(attr, "identifier");
            if (idNode.IsNull) continue;
            string name = idNode.Text;
            CodeGraphNode? created = ctx.CreateNode(CodeGraphNodeKind.Constant, name, attr, new CodeGraphNodeExtra
            {
                QualifiedName = $"local.{name}",
                Signature = $"local.{name}"
            });
            if (created == null) continue;
            CodeGraphTsNode expr = FirstNamedChildOfType(attr, "expression");
            if (!expr.IsNull)
            {
                ctx.PushScope(created.Id);
                try
                {
                    CollectReferences(expr, (qname, line, column) =>
                        EmitRefAt(ctx, created.Id, qname, CodeGraphEdgeKind.References, line, column));
                }
                finally { ctx.PopScope(); }
            }
        }
    }

    private static void EmitReferencesInBody(CodeGraphTsNode body, CodeGraphExtractorContext ctx, string fromNodeId, bool suppressScoped, HashSet<string>? skipTopAttrs)
    {
        Queue<CodeGraphTsNode> queue = new();
        int count = body.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode c = body.NamedChild(i);
            if (c.IsNull) continue;
            if (skipTopAttrs != null && c.Type == "attribute")
            {
                CodeGraphTsNode id = FirstNamedChildOfType(c, "identifier");
                if (!id.IsNull && skipTopAttrs.Contains(id.Text)) continue;
            }
            queue.Enqueue(c);
        }
        while (queue.Count > 0)
        {
            CodeGraphTsNode n = queue.Dequeue();
            if (n.Type == "expression")
            {
                CollectReferences(n, (qname, line, column) =>
                {
                    if (suppressScoped && qname.Contains(':')) return;
                    EmitRefAt(ctx, fromNodeId, qname, CodeGraphEdgeKind.References, line, column);
                });
                continue;
            }
            int nc = n.NamedChildCount;
            for (int i = 0; i < nc; i++)
            {
                CodeGraphTsNode c = n.NamedChild(i);
                if (!c.IsNull) queue.Enqueue(c);
            }
        }
    }

    private static void EmitModuleWiring(string moduleName, CodeGraphTsNode block, CodeGraphTsNode body, CodeGraphExtractorContext ctx, string fromNodeId)
    {
        int count = body.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode attr = body.NamedChild(i);
            if (attr.IsNull || attr.Type != "attribute") continue;
            CodeGraphTsNode idNode = FirstNamedChildOfType(attr, "identifier");
            if (idNode.IsNull) continue;
            string attrName = idNode.Text;
            if (attrName == "source")
            {
                CodeGraphTsNode expr = FirstNamedChildOfType(attr, "expression");
                CodeGraphTsNode lit = expr.IsNull ? default : FindStringLit(expr);
                string src = lit.IsNull ? string.Empty : StringLitValue(lit);
                if (src.StartsWith("./", System.StringComparison.Ordinal) || src.StartsWith("../", System.StringComparison.Ordinal))
                    EmitRef(ctx, fromNodeId, $"module.{moduleName}:file", CodeGraphEdgeKind.Imports, block);
                continue;
            }
            if (ModuleMetaArgs.Contains(attrName)) continue;
            EmitRef(ctx, fromNodeId, $"module.{moduleName}:var.{attrName}", CodeGraphEdgeKind.References, attr);
        }
    }

    private static CodeGraphTsNode FindStringLit(CodeGraphTsNode expr)
    {
        Queue<CodeGraphTsNode> queue = new();
        queue.Enqueue(expr);
        while (queue.Count > 0)
        {
            CodeGraphTsNode n = queue.Dequeue();
            if (n.Type == "string_lit") return n;
            int count = n.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode c = n.NamedChild(i);
                if (!c.IsNull) queue.Enqueue(c);
            }
        }
        return default;
    }

    private static string? ReadStringAttr(CodeGraphTsNode body, string name, CodeGraphSourceText source)
    {
        int count = body.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode attr = body.NamedChild(i);
            if (attr.IsNull || attr.Type != "attribute") continue;
            CodeGraphTsNode idNode = FirstNamedChildOfType(attr, "identifier");
            if (idNode.IsNull || idNode.Text != name) continue;
            CodeGraphTsNode expr = FirstNamedChildOfType(attr, "expression");
            CodeGraphTsNode lit = expr.IsNull ? default : FindStringLit(expr);
            return lit.IsNull ? null : StringLitValue(lit);
        }
        return null;
    }

    private static void EmitProviderSelectionRef(CodeGraphTsNode body, CodeGraphExtractorContext ctx, string fromNodeId)
    {
        int count = body.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode attr = body.NamedChild(i);
            if (attr.IsNull || attr.Type != "attribute") continue;
            CodeGraphTsNode idNode = FirstNamedChildOfType(attr, "identifier");
            if (idNode.IsNull || idNode.Text != "provider") continue;
            CodeGraphTsNode expr = FirstNamedChildOfType(attr, "expression");
            if (expr.IsNull) return;
            string? sel = ProviderSelectionFromExpr(expr, ctx.Source);
            if (sel != null) EmitRef(ctx, fromNodeId, $"provider.{sel}", CodeGraphEdgeKind.References, attr);
            return;
        }
    }

    private static void EmitModuleProvidersRefs(CodeGraphTsNode body, CodeGraphExtractorContext ctx, string fromNodeId)
    {
        int count = body.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode attr = body.NamedChild(i);
            if (attr.IsNull || attr.Type != "attribute") continue;
            CodeGraphTsNode idNode = FirstNamedChildOfType(attr, "identifier");
            if (idNode.IsNull || idNode.Text != "providers") continue;
            Queue<CodeGraphTsNode> queue = new();
            queue.Enqueue(attr);
            while (queue.Count > 0)
            {
                CodeGraphTsNode n = queue.Dequeue();
                if (n.Type == "object_elem")
                {
                    CodeGraphTsNode val = n.ChildByField("val");
                    string? sel = val.IsNull ? null : ProviderSelectionFromExpr(val, ctx.Source);
                    if (sel != null) EmitRef(ctx, fromNodeId, $"provider.{sel}", CodeGraphEdgeKind.References, n);
                    continue;
                }
                int nc = n.NamedChildCount;
                for (int j = 0; j < nc; j++)
                {
                    CodeGraphTsNode c = n.NamedChild(j);
                    if (!c.IsNull) queue.Enqueue(c);
                }
            }
            return;
        }
    }

    private static string? ProviderSelectionFromExpr(CodeGraphTsNode expr, CodeGraphSourceText source)
    {
        Queue<CodeGraphTsNode> queue = new();
        queue.Enqueue(expr);
        while (queue.Count > 0)
        {
            CodeGraphTsNode n = queue.Dequeue();
            if (n.Type == "variable_expr")
            {
                CodeGraphTsNode id = FirstNamedChildOfType(n, "identifier");
                if (id.IsNull) return null;
                string head = id.Text;
                CodeGraphTsNode next = n.NextNamedSibling;
                if (!next.IsNull && next.Type == "get_attr")
                {
                    CodeGraphTsNode attrId = FirstNamedChildOfType(next, "identifier");
                    if (attrId.IsNull || !next.NextNamedSibling.IsNull) return null;
                    return $"{head}.{attrId.Text}";
                }
                return next.IsNull ? head : null;
            }
            if (n.Type is "function_call" or "conditional" or "for_expr") return null;
            int count = n.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode c = n.NamedChild(i);
                if (!c.IsNull) queue.Enqueue(c);
            }
        }
        return null;
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

    private static void EmitRef(CodeGraphExtractorContext ctx, string fromNodeId, string name, string kind, CodeGraphTsNode at) =>
        EmitRefAt(ctx, fromNodeId, name, kind, (int)at.StartPoint.Row + 1, (int)at.StartPoint.Column);

    private static void EmitRefAt(CodeGraphExtractorContext ctx, string fromNodeId, string name, string kind, int line, int column)
    {
        ctx.AddUnresolvedReference(new CodeGraphUnresolvedReference(
            FromNodeId: fromNodeId,
            ReferenceName: name,
            ReferenceKind: kind,
            Line: line,
            Column: column,
            FilePath: ctx.FilePath,
            Language: null,
            Candidates: null,
            RowId: null));
    }
}
