using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphVbNetExtractor — VB.NET language config. Port of
// extraction/languages/vbnet.ts.
//
// VB Modules are static containers (Shared members) indexed as classes so members
// get normal containment/qualification. Method statements are direct children of
// the declaration (no body wrapper), so ResolveBody returns the node itself. VB
// keywords are case-insensitive, so modifier scans compare case-insensitively.
//
// PORT NOTE: vbnet.ts uses a preParse that APPENDS a trailing newline to work
// around the grammar's missing EOF token. That is a length-changing transform,
// which the C# engine forbids (Decision 22 requires an equal-byte-length buffer),
// so PreParse is intentionally omitted here — a file whose last line lacks a
// newline may end with a MISSING-newline parse error on the final statement.
// =============================================================================
internal static partial class CodeGraphVbNetExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = [],
        ClassTypes = ["class_declaration", "module_declaration"],
        MethodTypes =
        [
            "method_declaration",
            "constructor_declaration",
            "external_method_declaration",    // `Declare Function ... Lib "user32"` (P/Invoke)
            "interface_method_declaration",   // interface members are distinct node types
            "abstract_method_declaration"     // `MustOverride Sub/Function ...`
        ],
        ClassifyMethodNode = node =>
            node.Type == "constructor_declaration" ? "constructor" : "method",
        InterfaceTypes = ["interface_declaration"],
        StructTypes = ["structure_declaration"],
        EnumTypes = ["enum_declaration"],
        EnumMemberTypes = ["enum_member_declaration"],
        TypeAliasTypes = ["delegate_declaration"],
        PackageTypes = ["namespace_declaration"],
        ExtractPackage = (node, source) =>
        {
            CodeGraphTsNode name = node.ChildByField("name");
            return name.IsNull ? null : name.Text;
        },
        ImportTypes = ["imports_statement"],
        // VB uses parentheses for BOTH calls and indexing, so both are treated as
        // call sites; name matching simply never resolves an index read.
        CallTypes = ["invocation_expression", "array_access_expression", "generic_invocation_expression"],
        VariableTypes = ["declaration_statement"],
        FieldTypes = ["field_declaration"],
        PropertyTypes = ["property_declaration", "interface_property_declaration", "abstract_property_declaration"],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",

        // Method/property statements are direct children (no body wrapper), so the
        // node is its own body — without this, calls inside every Sub/Function would
        // be skipped.
        ResolveBody = (node, _) => node,

        GetReturnType = ExtractVbnetReturnType,

        GetVisibility = node =>
        {
            if (HasModifier(node, PrivateRegex())) return CodeGraphVisibility.Private;
            if (HasModifier(node, ProtectedRegex())) return CodeGraphVisibility.Protected;
            if (HasModifier(node, FriendRegex())) return CodeGraphVisibility.Internal;
            return CodeGraphVisibility.Public; // VB members default to Public in practice
        },
        IsStatic = node => HasModifier(node, SharedRegex()),
        IsConst = node =>
            HasModifier(node, ConstRegex()) ||
            (HasModifier(node, SharedRegex()) && HasModifier(node, ReadonlyRegex())),
        IsAsync = node => HasModifier(node, AsyncRegex()),

        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();
            // The name reference is the last qualified/simple/global/identifier name
            // child (skips a leading alias identifier).
            int count = node.NamedChildCount;
            for (int i = count - 1; i >= 0; i--)
            {
                CodeGraphTsNode c = node.NamedChild(i);
                if (c.Type is "qualified_name" or "simple_name" or "global_qualified_name" or "identifier")
                    return new CodeGraphImportInfo(c.Text, importText);
            }
            return null;
        },

        VisitNode = VisitVbnetNode
    };

    private static bool VisitVbnetNode(CodeGraphTsNode node, CodeGraphExtractorContext ctx)
    {
        // Events are indexed so `RaiseEvent X` / `Handles obj.X` flows have a
        // findable declaration.
        if (node.Type is "event_declaration" or "custom_event_declaration")
        {
            CodeGraphTsNode nameNode = node.ChildByField("name");
            if (!nameNode.IsNull) ctx.CreateNode(CodeGraphNodeKind.Field, nameNode.Text, node);
            return true;
        }
        // `Sub New(...)` lexes as one token with no name field — without this,
        // constructors index as `<anonymous>`.
        if (node.Type == "constructor_declaration")
        {
            CodeGraphNode? ctor = ctx.CreateNode(CodeGraphNodeKind.Constructor, "New", node);
            if (ctor != null)
            {
                ctx.PushScope(ctor.Id);
                ctx.VisitFunctionBody(node, ctor.Id);
                ctx.PopScope();
            }
            return true;
        }
        return false;
    }

    // Case-insensitive member-modifier scan (VB keywords are case-insensitive).
    private static bool HasModifier(CodeGraphTsNode node, Regex re)
    {
        int count = node.ChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.Child(i);
            if (!child.IsNull && child.Type == "member_modifier" && re.IsMatch(child.Text)) return true;
        }
        return false;
    }

    // A VB.NET method's declared return type (`Function Foo(...) As Bar`), normalized
    // to the bare class name a chained `Foo.Create().Bar()` could be called on. The
    // type lives in the method's `as_clause` child; predefined types and arrays yield
    // null, generics `List(Of Foo)` unwrap to the base, and a dotted `Ns.Foo` reduces
    // to the simple name. Subs have no as_clause → null.
    private static string? ExtractVbnetReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        CodeGraphTsNode asClause = default;
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode c = node.NamedChild(i);
            if (c.Type == "as_clause") { asClause = c; break; }
        }
        if (asClause.IsNull) return null;
        CodeGraphTsNode typeNode = asClause.ChildByField("declared_type");
        if (typeNode.IsNull || typeNode.Type == "predefined_type" || typeNode.Type == "array_type") return null;
        string t = typeNode.Text.Trim();
        t = NullableSuffixRegex().Replace(t, string.Empty);   // nullable `Foo?`
        t = GenericOfRegex().Replace(t, string.Empty);        // generics `List(Of Foo)` → `List`
        string[] segs = t.Split('.');
        string last = segs.Length > 0 ? segs[^1].Trim() : t.Trim();
        if (last.Length == 0 || !IdentifierRegex().IsMatch(last)) return null;
        return last;
    }

    [GeneratedRegex(@"^private$", RegexOptions.IgnoreCase)] private static partial Regex PrivateRegex();
    [GeneratedRegex(@"^protected(\s+friend)?$", RegexOptions.IgnoreCase)] private static partial Regex ProtectedRegex();
    [GeneratedRegex(@"^friend$", RegexOptions.IgnoreCase)] private static partial Regex FriendRegex();
    [GeneratedRegex(@"^shared$", RegexOptions.IgnoreCase)] private static partial Regex SharedRegex();
    [GeneratedRegex(@"^const$", RegexOptions.IgnoreCase)] private static partial Regex ConstRegex();
    [GeneratedRegex(@"^readonly$", RegexOptions.IgnoreCase)] private static partial Regex ReadonlyRegex();
    [GeneratedRegex(@"^async$", RegexOptions.IgnoreCase)] private static partial Regex AsyncRegex();
    [GeneratedRegex(@"\?+$")] private static partial Regex NullableSuffixRegex();
    [GeneratedRegex(@"\(\s*Of\b[^)]*\)", RegexOptions.IgnoreCase)] private static partial Regex GenericOfRegex();
    [GeneratedRegex(@"^[A-Za-z_]\w*$")] private static partial Regex IdentifierRegex();
}
