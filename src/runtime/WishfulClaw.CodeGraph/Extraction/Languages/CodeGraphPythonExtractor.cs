// =============================================================================
// CodeGraphPythonExtractor — Python language config. Port of
// extraction/languages/python.ts.
//
// Methods are functions inside classes (methodTypes == functionTypes) — the engine
// disambiguates by scope (IsInsideClassLikeNode). Variables come from `assignment`
// nodes; the engine's ExtractVariable has a Python-specific left/right branch.
//
// isAsync note: python.ts reads node.previousSibling (an UNNAMED sibling). The C#
// CodeGraphTsNode surface exposes no unnamed-sibling navigation, so this scans the
// function_definition's direct children for the `async` keyword token — where
// tree-sitter-python actually places it (`optional('async')` leads the rule) — which
// is the same child-scan the TS/Rust/C# configs use for their async detection.
// =============================================================================
internal static class CodeGraphPythonExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_definition"],
        ClassTypes = ["class_definition"],
        MethodTypes = ["function_definition"],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = ["import_statement", "import_from_statement"],
        CallTypes = ["call"],
        VariableTypes = ["assignment"],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",
        ReturnField = "return_type",

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

        // @staticmethod decorator sits as the preceding named sibling inside the
        // wrapping decorated_definition.
        IsStatic = node =>
        {
            CodeGraphTsNode prev = node.PrevNamedSibling;
            if (!prev.IsNull && prev.Type == "decorator")
                return prev.Text.Contains("staticmethod", StringComparison.Ordinal);
            return false;
        },

        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();
            if (node.Type == "import_from_statement")
            {
                CodeGraphTsNode moduleNode = node.ChildByField("module_name");
                if (!moduleNode.IsNull)
                    return new CodeGraphImportInfo(moduleNode.Text, importText);
            }
            // import_statement creates multiple imports — return null for the engine's
            // Python-specific `import os, sys` fallback branch.
            return null;
        }
    };
}
