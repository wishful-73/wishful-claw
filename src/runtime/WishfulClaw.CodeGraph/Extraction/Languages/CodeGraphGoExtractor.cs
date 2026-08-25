using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphGoExtractor — Go language config. Port of extraction/languages/go.ts.
//
// Go has no classes: struct/interface declarations arrive as `type_spec` and are
// classified by ResolveTypeAliasKind (the engine turns a struct/interface type_spec
// into a struct/interface node). Methods are top-level (MethodsAreTopLevel) with a
// receiver — GetReceiverType names the owning type so the engine attaches the method
// to its struct. Exportedness is capitalization of the identifier.
// =============================================================================
internal static partial class CodeGraphGoExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_declaration"],
        ClassTypes = [], // Go doesn't have classes
        MethodTypes = ["method_declaration"],
        InterfaceTypes = [], // Handled via type_spec → ResolveTypeAliasKind
        StructTypes = [], // Handled via type_spec → ResolveTypeAliasKind
        EnumTypes = [],
        TypeAliasTypes = ["type_spec"],
        ImportTypes = ["import_declaration"],
        CallTypes = ["call_expression"],
        VariableTypes = ["var_declaration", "short_var_declaration", "const_declaration"],
        MethodsAreTopLevel = true,
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",
        ReturnField = "result",
        GetReturnType = ExtractGoReturnType,

        GetSignature = (node, source) =>
        {
            CodeGraphTsNode paramsNode = node.ChildByField("parameters");
            if (paramsNode.IsNull) return null;
            string sig = paramsNode.Text;
            CodeGraphTsNode result = node.ChildByField("result");
            if (!result.IsNull) sig += " " + result.Text;
            return sig;
        },

        // Go type_spec: `type Foo struct {…}` / `type Bar interface {…}` — the inner
        // type lives in the `type` field.
        ResolveTypeAliasKind = (node, source) =>
        {
            CodeGraphTsNode typeChild = node.ChildByField("type");
            if (typeChild.IsNull) return null;
            if (typeChild.Type == "struct_type") return "struct";
            if (typeChild.Type == "interface_type") return "interface";
            return null;
        },

        // Go: a symbol is exported when its identifier starts with an uppercase letter.
        IsExported = (node, source) =>
        {
            CodeGraphTsNode nameNode = node.ChildByField("name");
            if (nameNode.IsNull) return false;
            string text = nameNode.Text;
            if (text.Length == 0) return false;
            char first = text[0];
            return first >= 'A' && first <= 'Z';
        },

        // method_declaration has a `receiver` field: `func (sl *scrapeLoop) run(…)`.
        // Pull the bare type name out of "(sl *Type)", "(sl Type)", "(*Type)",
        // "(Type)" and generic receivers "(s *Stack[T])" (#583).
        GetReceiverType = (node, source) =>
        {
            CodeGraphTsNode receiver = node.ChildByField("receiver");
            if (receiver.IsNull) return null;
            Match m = ReceiverRegex().Match(receiver.Text);
            return m.Success ? m.Groups[1].Value : null;
        }
    };

    // A Go function's declared return type, normalized to the bare type a chained
    // `New().Method()` could be called on. Reads `result`: a pointer `*Foo` unwraps
    // to `Foo`, a multi-return `(*Foo, error)` takes the first result, a qualified
    // `pkg.Foo` reduces to its last segment, generics to the base.
    private static string? ExtractGoReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode result = node.ChildByField("result");
        if (result.IsNull) return null;

        // Multi-return `(T, error)` → the first result's type.
        if (result.Type == "parameter_list")
        {
            CodeGraphTsNode first = FirstNamedChildOfType(result, "parameter_declaration");
            if (first.IsNull) return null;
            CodeGraphTsNode t = first.ChildByField("type");
            result = t.IsNull ? first : t;
        }

        // Unwrap a pointer `*Foo` → `Foo`.
        if (result.Type == "pointer_type")
        {
            CodeGraphTsNode inner = FindNamedChildOfTypes(result, GoPointerInnerTypes);
            if (!inner.IsNull) result = inner;
        }

        string text = result.Text.Trim();
        if (text.StartsWith("*", StringComparison.Ordinal)) text = text[1..];
        text = AngleGenericRegex().Replace(text, string.Empty); // strip `<…>`
        text = SquareBracketRegex().Replace(text, string.Empty); // strip generic args `Foo[T]`
        string last = text.Split('.')[^1].Trim(); // qualified `pkg.Foo` → `Foo`
        if (last.Length == 0 || !IdentifierRegex().IsMatch(last)) return null;
        return last;
    }

    private static readonly HashSet<string> GoPointerInnerTypes =
        new() { "type_identifier", "qualified_type", "generic_type" };

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

    private static CodeGraphTsNode FindNamedChildOfTypes(CodeGraphTsNode node, HashSet<string> types)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (types.Contains(child.Type)) return child;
        }
        return default;
    }

    [GeneratedRegex(@"<[^>]*>")] private static partial Regex AngleGenericRegex();
    [GeneratedRegex(@"\[[^\]]*\]")] private static partial Regex SquareBracketRegex();
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")] private static partial Regex IdentifierRegex();

    [GeneratedRegex(@"\(\s*(?:[A-Za-z_][A-Za-z0-9_]*\s+)?\*?\s*([A-Za-z_][A-Za-z0-9_]*)")]
    private static partial Regex ReceiverRegex();
}
