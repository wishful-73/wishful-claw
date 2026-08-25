using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphJavaExtractor — Java language config. Port of
// extraction/languages/java.ts (MVP subset).
//
// `annotation_type_declaration` (`@interface Foo {…}`) is treated as an interface so
// annotation types become resolvable nodes. Fields are extracted (FieldTypes); a
// `static final` field is promoted to a constant via IsConst. A file `package`
// header wraps top-level types in a namespace so their qualified names carry the FQN.
//
// DEFERRED (analysis/01 §7): Lombok member synthesis (synthesizeMembers) — the
// compile-time getter/setter/builder/log generation is not ported for the MVP.
// =============================================================================
internal static partial class CodeGraphJavaExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = [],
        ClassTypes = ["class_declaration"],
        MethodTypes = ["method_declaration", "constructor_declaration"],
        ClassifyMethodNode = node =>
            node.Type == "constructor_declaration" ? "constructor" : "method",
        InterfaceTypes = ["interface_declaration", "annotation_type_declaration"],
        StructTypes = [],
        EnumTypes = ["enum_declaration"],
        EnumMemberTypes = ["enum_constant"],
        TypeAliasTypes = [],
        ImportTypes = ["import_declaration"],
        CallTypes = ["method_invocation"],
        VariableTypes = ["local_variable_declaration"],
        FieldTypes = ["field_declaration"],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",
        ReturnField = "type",
        GetReturnType = (node, source) => NormalizeJavaType(node.ChildByField("type")),

        GetSignature = (node, source) =>
        {
            CodeGraphTsNode paramsNode = node.ChildByField("parameters");
            if (paramsNode.IsNull) return null;
            string paramsText = paramsNode.Text;
            CodeGraphTsNode returnType = node.ChildByField("type");
            return returnType.IsNull ? paramsText : returnType.Text + " " + paramsText;
        },

        GetVisibility = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull || child.Type != "modifiers") continue;
                string text = child.Text;
                if (text.Contains("public", StringComparison.Ordinal)) return CodeGraphVisibility.Public;
                if (text.Contains("private", StringComparison.Ordinal)) return CodeGraphVisibility.Private;
                if (text.Contains("protected", StringComparison.Ordinal)) return CodeGraphVisibility.Protected;
            }
            return null;
        },

        IsStatic = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (!child.IsNull && child.Type == "modifiers" &&
                    child.Text.Contains("static", StringComparison.Ordinal))
                    return true;
            }
            return false;
        },

        // A `static final` field is a Java constant (drives `constant` kind so
        // value-reference edges target it); instance / final-only / static-only stay
        // mutable fields.
        IsConst = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull || child.Type != "modifiers") continue;
                string text = child.Text;
                return StaticWordRegex().IsMatch(text) && FinalWordRegex().IsMatch(text);
            }
            return false;
        },

        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();
            CodeGraphTsNode scopedId = FirstNamedChildOfType(node, "scoped_identifier");
            if (!scopedId.IsNull)
                return new CodeGraphImportInfo(scopedId.Text, importText);
            return null;
        },

        PackageTypes = ["package_declaration"],
        ExtractPackage = (node, source) => ExtractJavaPackageName(node)
    };

    // package_declaration → first scoped_identifier or single-segment identifier.
    private static string? ExtractJavaPackageName(CodeGraphTsNode node)
    {
        CodeGraphTsNode id = FindNamedChildOfTypes(node, JavaPackageIdTypes);
        return id.IsNull ? null : id.Text.Trim();
    }

    // Normalize a Java type node to the bare class name a chained `foo.getThing().bar()`
    // could be called on: primitives/void/arrays yield null (no class to chain on),
    // `List<Foo>` unwraps to `List`, a dotted qualifier `java.util.List` → `List`.
    private static string? NormalizeJavaType(CodeGraphTsNode typeNode)
    {
        if (typeNode.IsNull) return null;
        if (JavaNonClassReturnNodes.Contains(typeNode.Type)) return null;
        if (typeNode.Type == "array_type") return null;
        string raw = AngleGenericRegex().Replace(typeNode.Text.Trim(), string.Empty);
        string last = raw.Split('.')[^1].Trim();
        if (last.Length == 0 || !IdentifierRegex().IsMatch(last)) return null;
        return last;
    }

    private static readonly HashSet<string> JavaNonClassReturnNodes =
        new() { "void_type", "integral_type", "floating_point_type", "boolean_type" };

    private static readonly HashSet<string> JavaPackageIdTypes =
        new() { "scoped_identifier", "identifier" };

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
    [GeneratedRegex(@"\bstatic\b")] private static partial Regex StaticWordRegex();
    [GeneratedRegex(@"\bfinal\b")] private static partial Regex FinalWordRegex();
}
