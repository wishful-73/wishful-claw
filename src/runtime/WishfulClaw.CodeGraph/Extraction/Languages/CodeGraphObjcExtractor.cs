using System.Linq;
using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphObjcExtractor — Objective-C language config. Port of
// extraction/languages/objc.ts.
//
// Only `@interface` (class_interface) emits a class node; `@implementation`
// (class_implementation) reuses it via VisitNode, extracting its methods under the
// existing class scope. Methods are selector-named (ResolveName builds `doThing:with:`)
// and static-classified by the leading `+`. `@protocol` maps to the `protocol` kind
// (InterfaceKind). GetReturnType captures the declared return type for the chained
// static-factory mechanism (#750), skipping nullability/ARC qualifiers.
// =============================================================================
internal static partial class CodeGraphObjcExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_definition"],
        // Only @interface emits a class node; @implementation reuses it via VisitNode.
        ClassTypes = ["class_interface"],
        MethodTypes = ["method_definition"],
        InterfaceTypes = ["protocol_declaration"],
        InterfaceKind = CodeGraphNodeKind.Protocol,
        StructTypes = ["struct_specifier"],
        EnumTypes = ["enum_specifier"],
        EnumMemberTypes = ["enumerator"],
        TypeAliasTypes = ["type_definition"],
        ImportTypes = ["preproc_include"],
        CallTypes = ["call_expression", "message_expression"],
        VariableTypes = ["declaration"],
        PropertyTypes = ["property_declaration"],
        NameField = "declarator",
        BodyField = "body",
        ParamsField = "parameters",
        GetReturnType = ExtractObjcReturnType,
        ResolveName = ExtractObjcMethodName,
        ExtractPropertyName = ExtractObjcPropertyName,

        ResolveBody = (node, bodyField) =>
        {
            CodeGraphTsNode fromField = node.ChildByField(bodyField);
            if (!fromField.IsNull) return fromField;
            return FindCompoundStatement(node);
        },

        ResolveTypeAliasKind = (node, source) =>
        {
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.IsNull) continue;
                if (child.Type == "enum_specifier" && !child.ChildByField("body").IsNull) return CodeGraphNodeKind.Enum;
                if (child.Type == "struct_specifier" && !child.ChildByField("body").IsNull) return CodeGraphNodeKind.Struct;
            }
            return null;
        },

        IsStatic = node => LeadingPlusRegex().IsMatch(node.Text),

        VisitNode = (node, ctx) =>
        {
            if (node.Type != "class_implementation") return false;

            CodeGraphTsNode classNameNode = FirstNamedChildOfType(node, "identifier");
            if (classNameNode.IsNull) return true;

            string className = classNameNode.Text;
            CodeGraphNode? classNode =
                ctx.Nodes.FirstOrDefault(n =>
                    n.Name == className && n.FilePath == ctx.FilePath && n.Kind == CodeGraphNodeKind.Class)
                ?? ctx.CreateNode(CodeGraphNodeKind.Class, className, node);
            if (classNode == null) return true;

            ctx.PushScope(classNode.Id);
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.Type != "implementation_definition") continue;
                int ic = child.NamedChildCount;
                for (int j = 0; j < ic; j++)
                {
                    CodeGraphTsNode implChild = child.NamedChild(j);
                    if (!implChild.IsNull) ctx.VisitNode(implChild);
                }
            }
            ctx.PopScope();
            return true;
        },

        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();
            CodeGraphTsNode systemLib = FirstNamedChildOfType(node, "system_lib_string");
            if (!systemLib.IsNull)
                return new CodeGraphImportInfo(AngleEdgeRegex().Replace(systemLib.Text, string.Empty), importText);
            CodeGraphTsNode stringLiteral = FirstNamedChildOfType(node, "string_literal");
            if (!stringLiteral.IsNull)
            {
                CodeGraphTsNode stringContent = FirstNamedChildOfType(stringLiteral, "string_content");
                if (!stringContent.IsNull)
                    return new CodeGraphImportInfo(stringContent.Text, importText);
            }
            return null;
        }
    };

    // Build the ObjC selector: `greet`, `doThing:`, or `doThing:with:`.
    private static string? ExtractObjcMethodName(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        if (node.Type != "method_definition" && node.Type != "method_declaration") return null;

        List<CodeGraphTsNode> identifiers = new();
        int count = node.NamedChildCount;
        bool hasParameters = false;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type == "identifier") identifiers.Add(child);
            else if (child.Type == "method_parameter") hasParameters = true;
        }
        if (identifiers.Count == 0) return null;
        if (!hasParameters) return identifiers[0].Text;
        return string.Concat(identifiers.Select(id => id.Text + ":"));
    }

    // Nullability / ARC qualifiers that sit where a return type's first type identifier
    // does — never the type itself.
    private static readonly HashSet<string> ObjcTypeQualifiers = new()
    {
        "nonnull", "nullable", "null_unspecified", "null_resettable",
        "_Nonnull", "_Nullable", "_Null_unspecified", "__nonnull", "__nullable",
        "const", "volatile", "strong", "weak", "copy", "assign", "retain", "oneway",
        "__strong", "__weak", "__unsafe_unretained", "__autoreleasing", "__kindof"
    };

    // Collect the type identifiers under a `method_type`, in document order.
    private static void CollectTypeIdentifiers(CodeGraphTsNode node, List<string> into)
    {
        if (node.Type == "type_identifier") into.Add(node.Text.Trim());
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (!child.IsNull) CollectTypeIdentifiers(child, into);
        }
    }

    // Capture an ObjC method's declared return type as a bare class name (#750).
    private static string? ExtractObjcReturnType(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        if (node.Type != "method_definition" && node.Type != "method_declaration") return null;
        CodeGraphTsNode methodType = FirstNamedChildOfType(node, "method_type");
        if (methodType.IsNull) return null;
        List<string> ids = new();
        CollectTypeIdentifiers(methodType, ids);
        string? name = ids.FirstOrDefault(n => !ObjcTypeQualifiers.Contains(n));
        if (name == null || !IdentifierRegex().IsMatch(name) ||
            name == "void" || name == "id" || name == "instancetype")
            return null;
        return name;
    }

    private static string? ExtractObjcPropertyName(CodeGraphTsNode node, CodeGraphSourceText source)
    {
        if (node.Type != "property_declaration") return null;

        CodeGraphTsNode structDecl = FirstNamedChildOfType(node, "struct_declaration");
        if (structDecl.IsNull) return null;

        CodeGraphTsNode structDeclarator = FirstNamedChildOfType(structDecl, "struct_declarator");
        if (structDeclarator.IsNull) return null;

        CodeGraphTsNode current = structDeclarator;
        while (!current.IsNull)
        {
            CodeGraphTsNode inner = current.ChildByField("declarator");
            if (inner.IsNull) inner = FirstNamedChildOfTypes(current, PropertyInnerTypes);
            if (inner.IsNull) break;
            if (inner.Type == "identifier") return inner.Text;
            current = inner;
        }
        return null;
    }

    private static readonly HashSet<string> PropertyInnerTypes =
        new() { "identifier", "pointer_declarator" };

    private static CodeGraphTsNode FindCompoundStatement(CodeGraphTsNode node)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type == "compound_statement") return child;
        }
        return default;
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

    private static CodeGraphTsNode FirstNamedChildOfTypes(CodeGraphTsNode node, HashSet<string> types)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (types.Contains(child.Type)) return child;
        }
        return default;
    }

    [GeneratedRegex(@"^\s*\+")] private static partial Regex LeadingPlusRegex();
    [GeneratedRegex(@"^<|>$")] private static partial Regex AngleEdgeRegex();
    [GeneratedRegex(@"^[A-Za-z_][A-Za-z0-9_]*$")] private static partial Regex IdentifierRegex();
}
