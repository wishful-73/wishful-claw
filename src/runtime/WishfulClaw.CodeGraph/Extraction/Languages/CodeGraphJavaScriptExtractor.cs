// =============================================================================
// CodeGraphJavaScriptExtractor — JavaScript + JSX language config. Port of
// extraction/languages/javascript.ts. Both `javascript` and `jsx` map to this one
// instance in CodeGraphExtractorRegistry (languages/index.ts parity).
//
// Mirrors the TypeScript config minus the type-system node types (no interfaces /
// enums / type aliases). JS `field_definition` ≙ TS `public_field_definition`:
// plain fields are properties, function-valued fields are methods (#808). The key
// is named by the `property` field (not `name`), so ResolveName recovers it.
// =============================================================================
internal static class CodeGraphJavaScriptExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_declaration", "arrow_function", "function_expression"],
        ClassTypes = ["class_declaration"],
        MethodTypes = ["method_definition", "field_definition"],
        ClassifyMethodNode = ClassifyJsClassMember,
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = ["import_statement"],
        CallTypes = ["call_expression"],
        VariableTypes = ["lexical_declaration", "variable_declaration"],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",

        // JS `field_definition` names its key the `property` field — without this,
        // arrow-function handler fields extracted no name and produced no node (#808).
        ResolveName = (node, source) =>
        {
            if (node.Type == "field_definition")
            {
                CodeGraphTsNode prop = node.ChildByField("property");
                if (!prop.IsNull) return prop.Text;
            }
            return null;
        },

        // field_definition arrow-function bodies nest inside an arrow_function /
        // function_expression child, or inside a HOF wrapper call's arguments.
        ResolveBody = ResolveJsFieldBody,

        GetSignature = (node, source) =>
        {
            CodeGraphTsNode paramsNode = node.ChildByField("parameters");
            return paramsNode.IsNull ? null : paramsNode.Text;
        },

        IsExported = (node, source) => HasExportAncestor(node),
        IsAsync = node => HasChildOfType(node, "async"),
        IsConst = node => node.Type == "lexical_declaration" && HasChildOfType(node, "const"),

        ExtractImport = (node, source) =>
        {
            CodeGraphTsNode sourceField = node.ChildByField("source");
            if (!sourceField.IsNull)
            {
                string moduleName = StripQuotes(sourceField.Text);
                if (!string.IsNullOrEmpty(moduleName))
                    return new CodeGraphImportInfo(moduleName, node.Text.Trim());
            }
            return null;
        }
    };

    private static string ClassifyJsClassMember(CodeGraphTsNode node)
    {
        if (node.Type == "method_definition")
        {
            CodeGraphTsNode name = node.ChildByField("name");
            if (!name.IsNull && name.Text == "constructor") return "constructor";
            return "method";
        }

        if (node.Type != "public_field_definition" && node.Type != "field_definition")
            return "method";

        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.IsNull) continue;
            if (child.Type is "arrow_function" or "function_expression") return "method";
            if (child.Type == "call_expression" && ArgsContainFunction(child)) return "method";
        }
        return "property";
    }

    private static CodeGraphTsNode? ResolveJsFieldBody(CodeGraphTsNode node, string bodyField)
    {
        if (node.Type != "field_definition") return null;

        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.IsNull) continue;
            if (child.Type is "arrow_function" or "function_expression")
                return child.ChildByField(bodyField);
            if (child.Type == "call_expression")
            {
                CodeGraphTsNode args = child.ChildByField("arguments");
                if (args.IsNull) continue;
                int ac = args.NamedChildCount;
                for (int j = 0; j < ac; j++)
                {
                    CodeGraphTsNode arg = args.NamedChild(j);
                    if (!arg.IsNull && arg.Type is "arrow_function" or "function_expression")
                        return arg.ChildByField(bodyField);
                }
            }
        }
        return null;
    }

    private static bool ArgsContainFunction(CodeGraphTsNode callExpr)
    {
        CodeGraphTsNode args = callExpr.ChildByField("arguments");
        if (args.IsNull) return false;
        int ac = args.NamedChildCount;
        for (int j = 0; j < ac; j++)
        {
            CodeGraphTsNode arg = args.NamedChild(j);
            if (!arg.IsNull && arg.Type is "arrow_function" or "function_expression") return true;
        }
        return false;
    }

    private static bool HasExportAncestor(CodeGraphTsNode node)
    {
        CodeGraphTsNode current = node.Parent;
        while (!current.IsNull)
        {
            if (current.Type == "export_statement") return true;
            current = current.Parent;
        }
        return false;
    }

    private static bool HasChildOfType(CodeGraphTsNode node, string type)
    {
        for (int i = 0; i < node.ChildCount; i++)
        {
            CodeGraphTsNode child = node.Child(i);
            if (!child.IsNull && child.Type == type) return true;
        }
        return false;
    }

    private static string StripQuotes(string text) =>
        text.Replace("'", string.Empty).Replace("\"", string.Empty);
}
