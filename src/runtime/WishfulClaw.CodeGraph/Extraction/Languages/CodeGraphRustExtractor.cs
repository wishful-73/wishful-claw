using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphRustExtractor — Rust language config. Port of
// extraction/languages/rust.ts.
//
// Rust has no classes — methods live in `impl` blocks. A `function_item` with an
// impl-block ancestor is a method (GetReceiverType names the impl's type, and the
// engine attaches the method to that struct/enum/trait). `function_signature_item`
// is a bodiless trait-method declaration, extracted so a trait's method set is
// first-class. Interfaces are traits (InterfaceKind = "trait").
// =============================================================================
internal static partial class CodeGraphRustExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_item", "function_signature_item"],
        ClassTypes = [], // Rust has impl blocks
        MethodTypes = ["function_item", "function_signature_item"],
        InterfaceTypes = ["trait_item"],
        StructTypes = ["struct_item"],
        EnumTypes = ["enum_item"],
        EnumMemberTypes = ["enum_variant"],
        TypeAliasTypes = ["type_item"],
        ImportTypes = ["use_declaration"],
        CallTypes = ["call_expression"],
        VariableTypes = ["let_declaration", "const_item", "static_item"],
        InterfaceKind = CodeGraphNodeKind.Trait,
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",
        ReturnField = "return_type",
        GetReturnType = ExtractRustReturnType,

        GetSignature = (node, source) =>
        {
            CodeGraphTsNode paramsNode = node.ChildByField("parameters");
            if (paramsNode.IsNull) return null;
            string sig = paramsNode.Text;
            CodeGraphTsNode returnType = node.ChildByField("return_type");
            if (!returnType.IsNull) sig += " -> " + returnType.Text;
            return sig;
        },

        IsAsync = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (!child.IsNull && child.Type == "async") return true;
            }
            return false;
        },

        GetVisibility = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (!child.IsNull && child.Type == "visibility_modifier")
                    return child.Text.Contains("pub", StringComparison.Ordinal)
                        ? CodeGraphVisibility.Public
                        : CodeGraphVisibility.Private;
            }
            return CodeGraphVisibility.Private; // Rust defaults to private
        },

        // Walk up the AST to the enclosing impl_item. `impl Type {…}` — Type is a
        // direct type_identifier child; `impl Trait for Type {…}` — Type is the LAST
        // type_identifier (the first belongs to the trait path).
        GetReceiverType = (node, source) =>
        {
            CodeGraphTsNode parent = node.Parent;
            while (!parent.IsNull)
            {
                if (parent.Type == "impl_item")
                {
                    CodeGraphTsNode lastTypeIdent = default;
                    bool found = false;
                    int count = parent.NamedChildCount;
                    for (int i = 0; i < count; i++)
                    {
                        CodeGraphTsNode c = parent.NamedChild(i);
                        if (c.Type == "type_identifier") { lastTypeIdent = c; found = true; }
                    }
                    if (found) return lastTypeIdent.Text;

                    // Generic types: `impl<T> MyStruct<T> {…}`.
                    CodeGraphTsNode genericType = FirstNamedChildOfType(parent, "generic_type");
                    if (!genericType.IsNull)
                    {
                        CodeGraphTsNode innerType = FirstNamedChildOfType(genericType, "type_identifier");
                        if (!innerType.IsNull) return innerType.Text;
                    }
                    return null;
                }
                parent = parent.Parent;
            }
            return null;
        },

        ExtractImport = (node, source) => ExtractRustImport(node)
    };

    // Rust `use` declaration → the root crate/module of its use argument.
    private static CodeGraphImportInfo? ExtractRustImport(CodeGraphTsNode node)
    {
        string importText = node.Text.Trim();
        CodeGraphTsNode useArg = FindNamedChildOfTypes(node, RustUseArgTypes);
        if (!useArg.IsNull)
            return new CodeGraphImportInfo(RustRootModule(useArg), importText);
        return null;
    }

    // A Rust function's declared return type, normalized to the bare type a chained
    // `Foo::new().bar()` could be called on. `-> Self` yields the marker `self`; a
    // reference `&Foo` is unwrapped; generics reduce to the base (`Vec<Foo>` → `Vec`);
    // primitives / unit / tuple yield null.
    private static string? ExtractRustReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode rt = node.ChildByField("return_type");
        if (rt.IsNull) return null;

        if (rt.Type == "reference_type")
        {
            CodeGraphTsNode inner = FindNamedChildOfTypes(rt, RustRefInnerTypes);
            if (!inner.IsNull) rt = inner;
        }
        if (rt.Type is "primitive_type" or "unit_type" or "tuple_type") return null;

        string text = AngleGenericRegex().Replace(rt.Text.Trim(), string.Empty);
        string last = text.Split("::")[^1].Trim();
        if (last.Length == 0 || !IdentifierRegex().IsMatch(last)) return null;
        return last == "Self" ? "self" : last;
    }

    // Root crate/module of a scoped use path (`std::collections::HashMap` → `std`).
    private static string RustRootModule(CodeGraphTsNode scopedNode)
    {
        CodeGraphTsNode firstChild = scopedNode.NamedChild(0);
        if (firstChild.IsNull) return scopedNode.Text;
        string t = firstChild.Type;
        if (t is "identifier" or "crate" or "super" or "self") return firstChild.Text;
        if (t == "scoped_identifier") return RustRootModule(firstChild);
        return firstChild.Text;
    }

    private static readonly HashSet<string> RustRefInnerTypes =
        new() { "type_identifier", "scoped_type_identifier", "generic_type" };

    private static readonly HashSet<string> RustUseArgTypes =
        new() { "scoped_use_list", "scoped_identifier", "use_list", "identifier" };

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
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")] private static partial Regex IdentifierRegex();
}
