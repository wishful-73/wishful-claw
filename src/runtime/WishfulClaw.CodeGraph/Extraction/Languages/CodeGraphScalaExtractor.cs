using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphScalaExtractor — Scala language config. Port of extraction/languages/scala.ts.
//
// class / object / trait all extract as class-like (ClassifyClassNode tags a trait;
// InterfaceKind = 'trait'). A `def` is a method inside a class-like scope and a
// function at top level (MethodTypes, empty FunctionTypes — same pattern as Kotlin).
// `val`/`var` live in a `pattern` field (not `name`), so a VisitNode hook extracts
// them: a val in an `object` (a singleton) is a shared `constant`, a val in a
// class/trait/enum is a per-instance `field`. The hook also unwraps
// `enum_case_definitions` into enum-member nodes and flattens `extension` bodies.
//
// DEFERRED (analysis/01 §7, MVP scope): the val/var type-annotation `references`
// emission (emitScalaTypeRefs) is a type-ref behavior left for the follow-up — the
// hook creates the node but does not walk its declared type.
// =============================================================================
internal static partial class CodeGraphScalaExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        // Top-level `function_definition` is routed through MethodTypes (Kotlin pattern).
        FunctionTypes = [],
        ClassTypes = ["class_definition", "object_definition", "trait_definition"],
        MethodTypes = ["function_definition", "function_declaration"],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = ["enum_definition"],
        // enum members are handled in VisitNode (enum_case_definitions wraps the cases).
        TypeAliasTypes = ["type_definition"],
        ImportTypes = ["import_declaration"],
        CallTypes = ["call_expression"],
        VariableTypes = [], // val/var handled in VisitNode (use `pattern`, not `name`)
        InterfaceKind = CodeGraphNodeKind.Trait,
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",
        ReturnField = "return_type",
        GetReturnType = ExtractScalaReturnType,

        ClassifyClassNode = node =>
            node.Type == "trait_definition" ? CodeGraphNodeKind.Trait : "class",

        GetSignature = (node, source) =>
        {
            CodeGraphTsNode paramsNode = node.ChildByField("parameters");
            CodeGraphTsNode returnType = node.ChildByField("return_type");
            if (paramsNode.IsNull && returnType.IsNull) return null;
            string sig = paramsNode.IsNull ? string.Empty : paramsNode.Text;
            if (!returnType.IsNull) sig += ": " + returnType.Text;
            return sig.Length > 0 ? sig : null;
        },

        GetVisibility = ExtractScalaVisibility,
        IsAsync = _ => false,

        IsStatic = node =>
        {
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (!child.IsNull && child.Type == "modifiers" &&
                    child.Text.Contains("static", StringComparison.Ordinal))
                    return true;
            }
            return false;
        },

        VisitNode = VisitScalaNode,

        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();
            CodeGraphTsNode pathNode = node.ChildByField("path");
            if (!pathNode.IsNull) return new CodeGraphImportInfo(pathNode.Text, importText);
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.Type is "identifier" or "stable_identifier")
                    return new CodeGraphImportInfo(child.Text, importText);
            }
            return null;
        }
    };

    private static bool VisitScalaNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        string t = node.Type;

        // val/var: the name is in the `pattern` field (an identifier), not `name`.
        if (t is "val_definition" or "var_definition")
        {
            string? name = ScalaValVarName(node);
            if (name == null) return false;

            // An `object` is a singleton — its vals are shared constants (the Scala
            // `static final` idiom). A class/trait/enum/given val is a per-instance
            // field. The AST node type of the ENCLOSING definition distinguishes them
            // (both `object` and `class` extract as the `class` kind).
            string? enclosingDef = null;
            for (CodeGraphTsNode p = node.Parent; !p.IsNull; p = p.Parent)
            {
                if (p.Type is "class_definition" or "trait_definition" or "enum_definition"
                    or "given_definition" or "object_definition")
                {
                    enclosingDef = p.Type;
                    break;
                }
            }
            bool isInstanceField = enclosingDef is "class_definition" or "trait_definition"
                or "enum_definition" or "given_definition";
            string kind = isInstanceField
                ? CodeGraphNodeKind.Field
                : (t == "val_definition" ? CodeGraphNodeKind.Constant : CodeGraphNodeKind.Variable);

            CodeGraphTsNode typeNode = node.ChildByField("type");
            string? sig = typeNode.IsNull
                ? null
                : $"{(t == "val_definition" ? "val" : "var")} {name}: {typeNode.Text}";

            ctx.CreateNode(kind, name, node, new CodeGraphNodeExtra
            {
                Signature = sig,
                Visibility = ExtractScalaVisibility(node)
            });
            return true;
        }

        // enum_case_definitions wraps simple_enum_case / full_enum_case children.
        if (t == "enum_case_definitions")
        {
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.Type is "simple_enum_case" or "full_enum_case")
                {
                    CodeGraphTsNode nameNode = child.ChildByField("name");
                    if (!nameNode.IsNull) ctx.CreateNode(CodeGraphNodeKind.EnumMember, nameNode.Text, child);
                }
            }
            return true;
        }

        // extension_definition: visit body children directly, no container node.
        if (t == "extension_definition")
        {
            CodeGraphTsNode body = node.ChildByField("body");
            if (!body.IsNull)
            {
                int count = body.NamedChildCount;
                for (int i = 0; i < count; i++)
                {
                    CodeGraphTsNode child = body.NamedChild(i);
                    if (!child.IsNull) ctx.VisitNode(child);
                }
            }
            return true;
        }

        return false;
    }

    // val/var name: the `pattern` field is an identifier, or wraps one. (scala.ts getValVarName)
    private static string? ScalaValVarName(CodeGraphTsNode node)
    {
        CodeGraphTsNode pattern = node.ChildByField("pattern");
        if (pattern.IsNull) return null;
        if (pattern.Type == "identifier") return pattern.Text;
        int count = pattern.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = pattern.NamedChild(i);
            if (child.Type == "identifier") return child.Text;
        }
        return null;
    }

    // A method's declared return type as a bare type name (the chained-factory
    // mechanism): `def create(): Bar` → `Bar`; `List[Bar]` → `List` (method is on the
    // container); qualified `pkg.Bar` → `Bar`. A `this.type` singleton is left null.
    // (scala.ts extractScalaReturnType)
    private static string? ExtractScalaReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode rt = node.ChildByField("return_type");
        if (rt.IsNull) return null;
        string raw = rt.Text.Trim();
        if (raw.StartsWith("this.", StringComparison.Ordinal)) return null; // `this.type` — unhandled
        string baseType = GenericArgsRegex().Replace(raw, string.Empty); // List[Bar] → List
        baseType = WhitespaceRegex().Replace(baseType, string.Empty);
        string[] segs = baseType.Split('.');
        string last = segs.Length > 0 ? segs[^1] : baseType; // pkg.Bar → Bar
        if (last.Length == 0 || !IdentifierRegex().IsMatch(last)) return null;
        return last;
    }

    private static string ExtractScalaVisibility(CodeGraphTsNode node)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.IsNull) continue;
            if (child.Type is "modifiers" or "access_modifier")
            {
                string text = child.Text;
                if (text.Contains("private", StringComparison.Ordinal)) return CodeGraphVisibility.Private;
                if (text.Contains("protected", StringComparison.Ordinal)) return CodeGraphVisibility.Protected;
            }
        }
        return CodeGraphVisibility.Public;
    }

    [GeneratedRegex(@"\[[^\]]*\]")] private static partial Regex GenericArgsRegex();
    [GeneratedRegex(@"\s+")] private static partial Regex WhitespaceRegex();
    [GeneratedRegex(@"^[A-Za-z_]\w*$")] private static partial Regex IdentifierRegex();
}
