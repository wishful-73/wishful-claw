using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphNixExtractor — Nix language config. Port of extraction/languages/nix.ts.
//
// Nix is entirely expression-based, so all extraction runs through the VisitNode
// hook: a `binding` becomes a function (when its value is a lambda) or a variable;
// `inherit` clauses mint variables; `apply_expression` mines calls and the
// `import ./x.nix` / `callPackage ./pkg.nix` file-dependency idioms. Members of a
// returned attrset are marked exported.
// =============================================================================
internal static partial class CodeGraphNixExtractor
{
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

        VisitNode = VisitNixNode
    };

    private static bool VisitNixNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        CodeGraphSourceText source = ctx.Source;

        if (node.Type == "binding")
        {
            CodeGraphTsNode attrpath = node.ChildByField("attrpath");
            if (attrpath.IsNull) attrpath = node.NamedChild(0);
            if (attrpath.IsNull) return false;
            string name = attrpath.Text.Trim();
            if (name.Length == 0) return false;

            CodeGraphTsNode valueNode = node.ChildByField("expression");
            if (valueNode.IsNull) valueNode = node.ChildByField("value");
            if (valueNode.IsNull) valueNode = node.NamedChild(1);
            if (valueNode.IsNull) return false;

            if (valueNode.Type == "function_expression")
            {
                (List<string> pars, CodeGraphTsNode bodyNode) = GetCurriedParamsAndBody(valueNode, source);
                CodeGraphNode? funcNode = ctx.CreateNode(CodeGraphNodeKind.Function, name, node, new CodeGraphNodeExtra
                {
                    Signature = FormatFunctionSignature(pars),
                    IsExported = IsReturnedAttrsetMember(node)
                });
                if (funcNode != null)
                {
                    ctx.PushScope(funcNode.Id);
                    if (!bodyNode.IsNull) ctx.VisitNode(bodyNode);
                    ctx.PopScope();
                }
            }
            else
            {
                string initValue = valueNode.Text;
                if (initValue.Length > 100) initValue = initValue.Substring(0, 100);
                ctx.CreateNode(CodeGraphNodeKind.Variable, name, node, new CodeGraphNodeExtra
                {
                    Signature = initValue.Length > 0 ? $"= {initValue}{(initValue.Length >= 100 ? "..." : string.Empty)}" : null,
                    IsExported = IsReturnedAttrsetMember(node)
                });

                // NixOS/home-manager `imports = [ ./hardware.nix ]` / flake `modules = [...]`
                // reference files without an `import` call. Only literal path entries count.
                string finalSegment = LastDotSegment(name);
                if ((finalSegment == "imports" || finalSegment == "modules") && valueNode.Type == "list_expression")
                {
                    int count = valueNode.NamedChildCount;
                    for (int i = 0; i < count; i++)
                    {
                        CodeGraphTsNode child = valueNode.NamedChild(i);
                        if (child.Type == "path_expression")
                        {
                            string entryPath = child.Text.Trim();
                            if (IsStaticProjectPath(entryPath)) EmitFileImport(ctx, entryPath, child);
                        }
                    }
                }

                ctx.VisitNode(valueNode);
            }

            return true;
        }

        if (node.Type == "function_expression")
        {
            CodeGraphTsNode bodyNode = node.NamedChild(node.NamedChildCount - 1);
            if (!bodyNode.IsNull) ctx.VisitNode(bodyNode);
            return true;
        }

        if (node.Type is "inherit" or "inherit_from")
        {
            CodeGraphTsNode attrs = InheritedAttrs(node);
            if (!attrs.IsNull)
            {
                int count = attrs.NamedChildCount;
                for (int i = 0; i < count; i++)
                {
                    CodeGraphTsNode child = attrs.NamedChild(i);
                    string name = child.Text.Trim();
                    if (name.Length > 0)
                        ctx.CreateNode(CodeGraphNodeKind.Variable, name, child, new CodeGraphNodeExtra
                        {
                            IsExported = IsReturnedAttrsetMember(child)
                        });
                }
            }
            int nc = node.NamedChildCount;
            for (int i = 0; i < nc; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.Type != "inherited_attrs") ctx.VisitNode(child);
            }
            return true;
        }

        if (node.Type == "apply_expression")
        {
            string? directCallee = GetDirectCalleeName(node, source);
            bool isDirectImport = directCallee is "import" or "builtins.import";
            CodeGraphTsNode parent = node.Parent;
            CodeGraphTsNode parentFn = default;
            if (!parent.IsNull && parent.Type == "apply_expression")
            {
                parentFn = parent.ChildByField("function");
                if (parentFn.IsNull) parentFn = parent.NamedChild(0);
            }
            bool isCalleeOfParent = !parentFn.IsNull && NodesEqual(parentFn, node);

            if (!(isCalleeOfParent && !isDirectImport))
            {
                if (isDirectImport)
                {
                    CodeGraphTsNode argNode = node.ChildByField("argument");
                    if (argNode.IsNull) argNode = node.NamedChild(1);
                    string? importPath = argNode.IsNull ? null : GetStaticImportPath(argNode, source);
                    if (importPath != null) EmitFileImport(ctx, importPath, node);
                }
                else
                {
                    string? calleeName = GetCalleeName(node, source);
                    if (calleeName != null && calleeName != "import" && calleeName != "builtins.import" && ctx.NodeStack.Count > 0)
                        EmitRef(ctx, ctx.NodeStack[ctx.NodeStack.Count - 1], calleeName, CodeGraphEdgeKind.Calls, node);

                    // `callPackage ./pkg.nix { }` loads the file like `import` does.
                    if (calleeName != null && IsCallPackageName(calleeName))
                    {
                        CodeGraphTsNode firstArg = GetFirstApplyArgument(node);
                        string? importPath = firstArg.IsNull ? null : GetStaticImportPath(firstArg, source);
                        if (importPath != null) EmitFileImport(ctx, importPath, node);
                    }
                }
            }

            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++) ctx.VisitNode(node.NamedChild(i));
            return true;
        }

        return false;
    }

    private static CodeGraphTsNode UnwrapVariableExpression(CodeGraphTsNode node)
    {
        if (node.Type != "variable_expression") return node;
        CodeGraphTsNode inner = node.NamedChild(0);
        return inner.IsNull ? node : inner;
    }

    private static string? GetCalleeName(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode current = node;
        while (current.Type == "apply_expression")
        {
            CodeGraphTsNode funcNode = current.ChildByField("function");
            if (funcNode.IsNull) funcNode = current.NamedChild(0);
            if (funcNode.IsNull) break;
            current = funcNode;
        }
        current = UnwrapVariableExpression(current);
        if (current.Type is "identifier" or "select_expression") return current.Text.Trim();
        return null;
    }

    private static string? GetDirectCalleeName(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode funcNode = node.ChildByField("function");
        if (funcNode.IsNull) funcNode = node.NamedChild(0);
        if (funcNode.IsNull) return null;
        funcNode = UnwrapVariableExpression(funcNode);
        return funcNode.Text.Trim();
    }

    private static bool IsStaticProjectPath(string value) =>
        (value.StartsWith("./", System.StringComparison.Ordinal) || value.StartsWith("../", System.StringComparison.Ordinal))
        && !PathRejectRegex().IsMatch(value);

    private static string? GetStaticImportPath(CodeGraphTsNode argNode, CodeGraphSourceText source)
    {
        CodeGraphTsNode current = argNode;
        while (current.Type == "parenthesized_expression")
        {
            CodeGraphTsNode inner = current.NamedChild(0);
            if (inner.IsNull) break;
            current = inner;
        }
        string text = current.Text.Trim();
        if (((text.StartsWith("\"", System.StringComparison.Ordinal) && text.EndsWith("\"", System.StringComparison.Ordinal))
             || (text.StartsWith("'", System.StringComparison.Ordinal) && text.EndsWith("'", System.StringComparison.Ordinal)))
            && text.Length >= 2)
        {
            text = text.Substring(1, text.Length - 2);
        }
        return IsStaticProjectPath(text) ? text : null;
    }

    private static bool IsReturnedAttrsetMember(CodeGraphTsNode node)
    {
        CodeGraphTsNode current = node;
        bool seenReturnedAttrset = false;
        while (!current.IsNull)
        {
            CodeGraphTsNode parent = current.Parent;
            if (parent.IsNull) break;

            if (parent.Type == "let_expression")
            {
                CodeGraphTsNode bodyNode = parent.ChildByField("body");
                if (bodyNode.IsNull) bodyNode = parent.ChildByField("expression");
                if (bodyNode.IsNull || !NodesEqual(bodyNode, current)) return false;
            }
            if (parent.Type == "binding" && !NodesEqual(current, node)) return false;
            if (parent.Type is "formal_parameters" or "formals") return false;
            if (parent.Type is "attrset" or "rec_attrset" or "attrset_expression" or "rec_attrset_expression")
                seenReturnedAttrset = true;

            current = parent;
        }
        return seenReturnedAttrset;
    }

    private static (List<string> Params, CodeGraphTsNode BodyNode) GetCurriedParamsAndBody(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        List<string> pars = new();
        CodeGraphTsNode current = node;
        while (current.Type == "function_expression" && current.NamedChildCount > 0)
        {
            CodeGraphTsNode bodyNode = current.NamedChild(current.NamedChildCount - 1);
            if (bodyNode.IsNull) break;
            string paramPart = source.Slice(current.StartByte, bodyNode.StartByte).Trim();
            string paramText = paramPart.EndsWith(":", System.StringComparison.Ordinal)
                ? paramPart.Substring(0, paramPart.Length - 1).Trim() : paramPart;
            if (paramText.Length > 0) pars.Add(paramText);
            if (bodyNode.Type == "function_expression") current = bodyNode;
            else return (pars, bodyNode);
        }
        CodeGraphTsNode tail = current.NamedChildCount > 0 ? current.NamedChild(current.NamedChildCount - 1) : default;
        return (pars, tail);
    }

    private static string FormatFunctionSignature(List<string> pars)
    {
        if (pars.Count == 0) return "()";
        if (pars.Count > 1) return string.Join(" : ", pars);
        string param = pars[0];
        if (param.Length == 0) return "()";
        return param.StartsWith("(", System.StringComparison.Ordinal) || param.Contains('{') || param.Contains('@')
            ? param : $"({param})";
    }

    private static CodeGraphTsNode InheritedAttrs(CodeGraphTsNode node)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type == "inherited_attrs") return child;
        }
        return default;
    }

    private static bool IsCallPackageName(string name) =>
        name == "callPackage" || name == "callPackages"
        || name.EndsWith(".callPackage", System.StringComparison.Ordinal)
        || name.EndsWith(".callPackages", System.StringComparison.Ordinal);

    private static CodeGraphTsNode GetFirstApplyArgument(CodeGraphTsNode node)
    {
        CodeGraphTsNode inner = node;
        while (true)
        {
            CodeGraphTsNode fn = inner.ChildByField("function");
            if (fn.IsNull) fn = inner.NamedChild(0);
            if (!fn.IsNull && fn.Type == "apply_expression") { inner = fn; continue; }
            break;
        }
        CodeGraphTsNode arg = inner.ChildByField("argument");
        if (arg.IsNull) arg = inner.NamedChild(1);
        return arg;
    }

    private static void EmitFileImport(CodeGraphExtractorContext ctx, string importPath, CodeGraphTsNode anchorNode)
    {
        string sig = anchorNode.Text.Trim();
        if (sig.Length > 100) sig = sig.Substring(0, 100);
        CodeGraphNode? impNode = ctx.CreateNode(CodeGraphNodeKind.Import, importPath, anchorNode, new CodeGraphNodeExtra { Signature = sig });
        if (impNode != null && ctx.NodeStack.Count > 0)
            EmitRef(ctx, ctx.NodeStack[ctx.NodeStack.Count - 1], importPath, CodeGraphEdgeKind.Imports, anchorNode);
    }

    private static void EmitRef(CodeGraphExtractorContext ctx, string fromNodeId, string name, string kind, CodeGraphTsNode at)
    {
        ctx.AddUnresolvedReference(new CodeGraphUnresolvedReference(
            FromNodeId: fromNodeId,
            ReferenceName: name,
            ReferenceKind: kind,
            Line: (int)at.StartPoint.Row + 1,
            Column: (int)at.StartPoint.Column,
            FilePath: ctx.FilePath,
            Language: null,
            Candidates: null,
            RowId: null));
    }

    private static string LastDotSegment(string name)
    {
        int idx = name.LastIndexOf('.');
        return idx < 0 ? name : name.Substring(idx + 1);
    }

    // The C# node surface exposes no node-identity primitive; two nodes with the
    // same span + symbol are the same node for the checks here.
    private static bool NodesEqual(CodeGraphTsNode a, CodeGraphTsNode b) =>
        a.StartByte == b.StartByte && a.EndByte == b.EndByte && a.Symbol == b.Symbol;

    [GeneratedRegex(@"[\s{}()\[\];""'<>$]")] private static partial Regex PathRejectRegex();
}
