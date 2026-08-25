// =============================================================================
// CodeGraphTypeScriptExtractor — TypeScript + TSX language config. Port of
// extraction/languages/typescript.ts. Both `typescript` and `tsx` map to this one
// instance in CodeGraphExtractorRegistry (languages/index.ts parity).
//
// A declarative ICodeGraphLanguageExtractor: grammar node-type name arrays + field
// names + the minimal MVP hooks (name/signature/visibility/exported/async/import).
// Framework/value-ref branches are deferred (analysis/01 §7) — left unset.
// =============================================================================
internal static class CodeGraphTypeScriptExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_declaration", "arrow_function", "function_expression"],
        ClassTypes = ["class_declaration", "abstract_class_declaration"],
        MethodTypes = ["method_definition", "public_field_definition"],
        ClassifyMethodNode = ClassifyTsClassMember,
        InterfaceTypes = ["interface_declaration"],
        StructTypes = [],
        EnumTypes = ["enum_declaration"],
        EnumMemberTypes = ["property_identifier", "enum_assignment"],
        TypeAliasTypes = ["type_alias_declaration"],
        ImportTypes = ["import_statement"],
        CallTypes = ["call_expression"],
        VariableTypes = ["lexical_declaration", "variable_declaration"],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",
        ReturnField = "return_type",

        // public_field_definition (arrow-function class fields) nest the callable body
        // inside an arrow_function/function_expression child — or inside a HOF wrapper
        // call's arguments (`field = throttle(() => {…})`). Return that inner body so
        // the field's calls are walked.
        ResolveBody = ResolveTsFieldBody,

        GetSignature = (node, source) =>
        {
            CodeGraphTsNode paramsNode = node.ChildByField("parameters");
            if (paramsNode.IsNull) return null;
            string sig = paramsNode.Text;
            CodeGraphTsNode returnType = node.ChildByField("return_type");
            if (!returnType.IsNull)
            {
                string rt = returnType.Text;
                if (rt.StartsWith(":", StringComparison.Ordinal)) rt = rt[1..].TrimStart();
                sig += ": " + rt;
            }
            return sig;
        },

        GetVisibility = node =>
        {
            for (int i = 0; i < node.ChildCount; i++)
            {
                CodeGraphTsNode child = node.Child(i);
                if (child.IsNull || child.Type != "accessibility_modifier") continue;
                string text = child.Text;
                if (text == "public") return CodeGraphVisibility.Public;
                if (text == "private") return CodeGraphVisibility.Private;
                if (text == "protected") return CodeGraphVisibility.Protected;
            }
            return null;
        },

        // Walk the parent chain to an export_statement ancestor — handles a deeply
        // nested arrow function under `export const X = () => {…}`.
        IsExported = (node, source) => HasExportAncestor(node),
        IsAsync = node => HasChildOfType(node, "async"),
        IsStatic = node => HasChildOfType(node, "static"),
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

    // A TS/JS class field is a METHOD only when its value is callable — an arrow
    // function, a function expression, or a HOF call wrapping one; otherwise it is a
    // PROPERTY. method_definition / accessors are always methods (#808).
    private static string ClassifyTsClassMember(CodeGraphTsNode node)
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

    private static CodeGraphTsNode? ResolveTsFieldBody(CodeGraphTsNode node, string bodyField)
    {
        if (node.Type != "public_field_definition") return null;

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
