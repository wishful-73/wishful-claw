// =============================================================================
// CodeGraphErlangExtractor — Erlang language config. Port of
// extraction/languages/erlang.ts (WhatsApp/tree-sitter-erlang, ABI 14).
//
// Erlang is form-based; three shapes don't fit the generic extractor and are
// dispatched through VisitNode:
//   - a function's name lives on its CLAUSE (one fun_decl per clause) — consecutive
//     same-name fun_decls are merged into a single function node;
//   - -spec/-type/-callback bodies parse as `call` nodes, so those subtrees are
//     consumed to avoid bogus call refs;
//   - record_decl carries fields as direct children (no body field).
// `-module(m)` is a package so every function's qualifiedName is `m::f`, matching
// the reference shape a remote call `mod:f(...)` produces.
//
// PORT NOTES: the C# node surface has no getPrecedingDocstring, so Docstring is
// omitted; CodeGraphNodeExtra has no endLine field, so the continuation-clause span
// extension is dropped (calls are still attributed to the merged node).
// =============================================================================
internal static class CodeGraphErlangExtractor
{
    // Per-file memos. Extraction is file-sequential within a worker, so a single
    // memo keyed by filePath is safe (and resets naturally).
    private static string _exportsFile = string.Empty;
    private static bool _exportsAll;
    private static HashSet<string> _exportsMemo = new(System.StringComparer.Ordinal);

    private static string _lastFnFile = string.Empty;
    private static string _lastFnName = string.Empty;
    private static string _lastFnId = string.Empty;

    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["fun_decl"],      // dispatched via VisitNode (name on the clause)
        ClassTypes = [],
        MethodTypes = [],
        InterfaceTypes = [],
        StructTypes = ["record_decl"],     // dispatched via VisitNode (direct-child fields)
        EnumTypes = [],
        TypeAliasTypes = ["type_alias", "opaque"], // dispatched via VisitNode
        ImportTypes = ["import_attribute", "pp_include", "pp_include_lib"],
        CallTypes =
        [
            "call",
            "internal_fun",       // fun f/1
            "external_fun",       // fun mod:f/1
            "record_expr",        // #rec{...}
            "record_update_expr", // X#rec{...}
            "record_index_expr",  // #rec.field
            "record_field_expr",  // X#rec.field
            "macro_call_expr"     // ?MACRO / ?MACRO(...)
        ],
        VariableTypes = [],
        NameField = "name",
        BodyField = "body",
        ParamsField = "args",

        PackageTypes = ["module_attribute"],
        ExtractPackage = (node, source) =>
        {
            CodeGraphTsNode name = node.ChildByField("name");
            return name.IsNull ? null : AtomText(name);
        },

        ExtractImport = (node, source) =>
        {
            if (node.Type == "import_attribute")
            {
                CodeGraphTsNode mod = node.ChildByField("module");
                if (mod.IsNull) return null;
                return new CodeGraphImportInfo(AtomText(mod), Clip(CollapseWs(node.Text), 200));
            }
            // pp_include / pp_include_lib — a C-include-style dependency on a .hrl.
            CodeGraphTsNode file = node.ChildByField("file");
            if (file.IsNull) return null;
            string headerPath = StripQuotes(file.Text);
            if (headerPath.Length == 0) return null;
            return new CodeGraphImportInfo(headerPath, node.Text.Trim());
        },

        VisitNode = VisitErlangNode
    };

    private static bool VisitErlangNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        switch (node.Type)
        {
            case "fun_decl": return HandleFunDecl(node, ctx);
            case "record_decl": return HandleRecordDecl(node, ctx);
            case "type_alias":
            case "opaque": return HandleTypeAlias(node, ctx);
            case "pp_define": return HandlePpDefine(node, ctx);
            case "behaviour_attribute": return HandleBehaviour(node, ctx);
            // -spec / -callback: their type expressions parse as `call` nodes — consume.
            case "spec":
            case "callback": return true;
            case "tuple":
                CodeGraphTsNode parent = node.Parent;
                CodeGraphTsNode first = node.NamedChild(0);
                if (!parent.IsNull && parent.Type == "source_file"
                    && AppResourceFileRegex().IsMatch(ctx.FilePath)
                    && !first.IsNull && first.Type == "atom" && AtomText(first) == "application")
                {
                    return HandleAppResourceTuple(node, ctx);
                }
                return false;
            default: return false;
        }
    }

    private static bool HandleFunDecl(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        List<CodeGraphTsNode> clauses = ChildrenOfType(node, "function_clause");
        if (clauses.Count == 0) return true; // macro-templated clause — no static name
        CodeGraphTsNode first = clauses[0];
        CodeGraphTsNode nameNode = first.ChildByField("name");
        if (nameNode.IsNull) return true;
        string name = AtomText(nameNode);
        if (name.Length == 0) return true;

        // Continuation clause: attribute this clause's calls to the existing node.
        if (ctx.FilePath == _lastFnFile && name == _lastFnName && _lastFnId.Length > 0)
        {
            ctx.PushScope(_lastFnId);
            foreach (CodeGraphTsNode clause in clauses) ctx.VisitFunctionBody(clause, _lastFnId);
            ctx.PopScope();
            return true;
        }

        CodeGraphTsNode spec = PrecedingSpec(node, name);
        (bool all, HashSet<string> exports) = ModuleExports(node, ctx.FilePath);
        CodeGraphNode? fn = ctx.CreateNode(CodeGraphNodeKind.Function, name, node, new CodeGraphNodeExtra
        {
            Signature = spec.IsNull ? ClauseHeader(first, ctx.Source) : Clip(CollapseWs(spec.Text), 300),
            IsExported = all || exports.Contains(name)
        });
        if (fn == null) return true;
        ctx.PushScope(fn.Id);
        foreach (CodeGraphTsNode clause in clauses) ctx.VisitFunctionBody(clause, fn.Id);
        ctx.PopScope();
        _lastFnFile = ctx.FilePath;
        _lastFnName = name;
        _lastFnId = fn.Id;
        return true;
    }

    private static bool HandleRecordDecl(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        CodeGraphTsNode nameNode = node.ChildByField("name");
        if (nameNode.IsNull) return true;
        CodeGraphNode? rec = ctx.CreateNode(CodeGraphNodeKind.Struct, AtomText(nameNode), node, new CodeGraphNodeExtra
        {
            Signature = Clip(CollapseWs(node.Text), 300)
        });
        if (rec != null)
        {
            ctx.PushScope(rec.Id);
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode field = node.NamedChild(i);
                if (field.Type != "record_field") continue;
                CodeGraphTsNode fieldName = field.ChildByField("name");
                if (!fieldName.IsNull) ctx.CreateNode(CodeGraphNodeKind.Field, AtomText(fieldName), field);
            }
            ctx.PopScope();
        }
        return true; // field types/defaults are type-position exprs — don't descend
    }

    private static bool HandleTypeAlias(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        CodeGraphTsNode typeName = node.ChildByField("name"); // type_name wrapper
        CodeGraphTsNode nameNode = typeName.IsNull ? default : typeName.ChildByField("name");
        if (!nameNode.IsNull)
            ctx.CreateNode(CodeGraphNodeKind.TypeAlias, AtomText(nameNode), node, new CodeGraphNodeExtra
            {
                Signature = Clip(CollapseWs(node.Text), 200)
            });
        return true;
    }

    private static bool HandlePpDefine(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        CodeGraphTsNode lhs = node.ChildByField("lhs");
        CodeGraphTsNode nameNode = lhs.IsNull ? default : lhs.ChildByField("name");
        if (nameNode.IsNull) return true;
        CodeGraphNode? macro = ctx.CreateNode(CodeGraphNodeKind.Constant, nameNode.Text, node, new CodeGraphNodeExtra
        {
            Signature = Clip(CollapseWs(node.Text), 200)
        });
        CodeGraphTsNode replacement = node.ChildByField("replacement");
        if (macro != null && !replacement.IsNull)
        {
            ctx.PushScope(macro.Id);
            ctx.VisitFunctionBody(replacement, macro.Id);
            ctx.PopScope();
        }
        return true;
    }

    private static bool HandleBehaviour(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        CodeGraphTsNode nameNode = node.ChildByField("name");
        string? parentId = ctx.NodeStack.Count > 0 ? ctx.NodeStack[ctx.NodeStack.Count - 1] : null;
        if (!nameNode.IsNull && parentId != null)
            EmitRef(ctx, parentId, AtomText(nameNode), CodeGraphEdgeKind.Implements, node);
        return true;
    }

    // OTP application resource file: `{application, Name, Props}.` — `mod` names the
    // callback module, `applications`/`included_applications` declare dependencies.
    private static bool HandleAppResourceTuple(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        string? parentId = ctx.NodeStack.Count > 0 ? ctx.NodeStack[ctx.NodeStack.Count - 1] : null;
        CodeGraphTsNode props = node.NamedChild(2);
        if (parentId == null || props.IsNull || props.Type != "list") return true;

        void Ref(CodeGraphTsNode nameNode, string kind)
        {
            string name = AtomText(nameNode);
            if (name.Length == 0) return;
            EmitRef(ctx, parentId, name, kind, nameNode);
        }

        int count = props.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode prop = props.NamedChild(i);
            if (prop.Type != "tuple" || prop.NamedChildCount < 2) continue;
            CodeGraphTsNode key = prop.NamedChild(0);
            CodeGraphTsNode value = prop.NamedChild(1);
            if (key.IsNull || key.Type != "atom" || value.IsNull) continue;
            string keyName = AtomText(key);
            if (keyName == "mod" && value.Type == "tuple")
            {
                CodeGraphTsNode mod = value.NamedChild(0);
                if (!mod.IsNull && mod.Type == "atom") Ref(mod, CodeGraphEdgeKind.References);
            }
            else if ((keyName == "applications" || keyName == "included_applications") && value.Type == "list")
            {
                int vc = value.NamedChildCount;
                for (int j = 0; j < vc; j++)
                {
                    CodeGraphTsNode app = value.NamedChild(j);
                    if (app.Type == "atom") Ref(app, CodeGraphEdgeKind.Imports);
                }
            }
        }
        return true;
    }

    private static (bool All, HashSet<string> Exports) ModuleExports(CodeGraphTsNode node, string filePath)
    {
        if (filePath == _exportsFile) return (_exportsAll, _exportsMemo);
        CodeGraphTsNode root = node;
        while (!root.Parent.IsNull) root = root.Parent;
        bool all = false;
        HashSet<string> result = new(System.StringComparer.Ordinal);
        int count = root.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode form = root.NamedChild(i);
            if (form.IsNull) continue;
            if (form.Type == "compile_options_attribute" && form.Text.Contains("export_all", System.StringComparison.Ordinal))
            {
                all = true;
                break;
            }
            if (form.Type == "export_attribute")
            {
                int fc = form.NamedChildCount;
                for (int j = 0; j < fc; j++)
                {
                    CodeGraphTsNode fa = form.NamedChild(j);
                    if (fa.Type != "fa") continue;
                    CodeGraphTsNode fun = fa.ChildByField("fun");
                    if (!fun.IsNull) result.Add(AtomText(fun));
                }
            }
        }
        _exportsFile = filePath;
        _exportsAll = all;
        _exportsMemo = result;
        return (all, result);
    }

    private static CodeGraphTsNode PrecedingSpec(CodeGraphTsNode node, string name)
    {
        CodeGraphTsNode prev = node.PrevNamedSibling;
        while (!prev.IsNull && prev.Type == "comment") prev = prev.PrevNamedSibling;
        if (!prev.IsNull && prev.Type == "spec")
        {
            CodeGraphTsNode specFun = prev.ChildByField("fun");
            if (!specFun.IsNull && AtomText(specFun) == name) return prev;
        }
        return default;
    }

    private static string? ClauseHeader(CodeGraphTsNode clause, CodeGraphSourceText source)
    {
        CodeGraphTsNode body = clause.ChildByField("body");
        int end = body.IsNull ? clause.EndByte : body.StartByte;
        string header = CollapseWs(source.Slice(clause.StartByte, end));
        return header.Length > 0 ? header : null;
    }

    private static List<CodeGraphTsNode> ChildrenOfType(CodeGraphTsNode node, string type)
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

    // Text of an atom with quoted-atom quotes stripped (`'EXIT'` → `EXIT`).
    private static string AtomText(CodeGraphTsNode node)
    {
        string text = node.Text;
        if (text.Length >= 2 && text[0] == '\'' && text[^1] == '\'')
            return text.Substring(1, text.Length - 2);
        return text;
    }

    private static string CollapseWs(string text) => WhitespaceRegex().Replace(text, " ").Trim();

    private static string Clip(string text, int max) => text.Length > max ? text.Substring(0, max) : text;

    private static string StripQuotes(string s)
    {
        if (s.StartsWith("\"", System.StringComparison.Ordinal)) s = s.Substring(1);
        if (s.EndsWith("\"", System.StringComparison.Ordinal)) s = s.Substring(0, s.Length - 1);
        return s;
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

    private static readonly System.Text.RegularExpressions.Regex WhitespaceRegexImpl =
        new(@"\s+", System.Text.RegularExpressions.RegexOptions.Compiled);
    private static System.Text.RegularExpressions.Regex WhitespaceRegex() => WhitespaceRegexImpl;

    private static readonly System.Text.RegularExpressions.Regex AppResourceFileRegexImpl =
        new(@"\.app(\.src)?$", System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.Compiled);
    private static System.Text.RegularExpressions.Regex AppResourceFileRegex() => AppResourceFileRegexImpl;
}
