using System.Text.RegularExpressions;

// =============================================================================
// CodeGraphCfmlExtractor — CFML (ColdFusion) language configs. Port of
// extraction/languages/cfscript.ts + cfquery.ts.
//
// Two grammars ship for CFML, so two configs live here:
//   * Instance       — cfscript: `component`/`interface` bodies, `function`
//     declarations/expressions, `import`/`include`, and CFML access modifiers.
//     The `component` node is reused for BOTH `component { … }` and
//     `interface { … }`; ClassifyClassNode reads the literal first token to tag it.
//   * CfQueryInstance — cfquery: only `#hash#` expressions inside a <cfquery> SQL
//     body are real CFML (parsed as call_expression), so the config maps just
//     CallTypes and yields call references and nothing else.
// The lead wires cfscript → Instance and cfquery → CfQueryInstance (and cfml →
// Instance) in the registry.
// =============================================================================
internal static partial class CodeGraphCfmlExtractor
{
    // cfscript — the full CFML component/function extractor.
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_declaration", "function_expression", "arrow_function"],
        ClassTypes = ["component"],
        MethodTypes = ["function_declaration", "method_definition"],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = ["import_statement", "include_statement"],
        CallTypes = ["call_expression"],
        VariableTypes = ["variable_declaration"],
        PropertyTypes = ["property_declaration"],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters",

        // `component` is reused for both `component { ... }` and `interface { ... }` —
        // the only difference is the literal first token (child(0).type is 'component'
        // or 'interface', both unnamed).
        ClassifyClassNode = node =>
            node.Child(0).Type == "interface" ? CodeGraphNodeKind.Interface : "class",

        GetVisibility = CfmlVisibility,

        GetSignature = (node, source) =>
        {
            CodeGraphTsNode paramsNode = node.ChildByField("parameters");
            return paramsNode.IsNull ? null : paramsNode.Text;
        },

        ExtractImport = (node, source) =>
        {
            string importText = node.Text.Trim();

            if (node.Type == "include_statement")
            {
                // `include "path/to/file.cfm";` — the included template path.
                CodeGraphTsNode expr = FindNamedChildOfType(node, "string");
                if (expr.IsNull) return null;
                string included = QuoteEdgeRegex().Replace(expr.Text, string.Empty);
                return included.Length > 0 ? new CodeGraphImportInfo(included, importText) : null;
            }

            // `import com.foo.Bar;` (dotted path) or
            // `import "java:java.util.ArrayList";` (string form).
            CodeGraphTsNode sourceNode = node.ChildByField("source");
            if (sourceNode.IsNull) return null;

            string moduleName;
            if (sourceNode.Type == "import_path")
            {
                List<string> parts = new();
                int count = sourceNode.NamedChildCount;
                for (int i = 0; i < count; i++) parts.Add(sourceNode.NamedChild(i).Text);
                moduleName = string.Join(".", parts);
            }
            else
            {
                moduleName = QuoteEdgeRegex().Replace(sourceNode.Text, string.Empty);
            }
            return moduleName.Length > 0 ? new CodeGraphImportInfo(moduleName, importText) : null;
        }
    };

    // cfquery — only embedded `#…#` call expressions in the SQL body are modeled.
    public static readonly ICodeGraphLanguageExtractor CfQueryInstance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = [],
        ClassTypes = [],
        MethodTypes = [],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = [],
        CallTypes = ["call_expression"],
        VariableTypes = [],
        NameField = "name",
        BodyField = "body",
        ParamsField = "parameters"
    };

    // CFML access modifiers (`public`/`private`/`package`/`remote`) on a function.
    private static string? CfmlVisibility(CodeGraphTsNode node)
    {
        for (int i = 0; i < node.ChildCount; i++)
        {
            CodeGraphTsNode child = node.Child(i);
            if (child.Type != "access_type") continue;
            string text = child.Text;
            if (text == "public") return CodeGraphVisibility.Public;
            if (text == "private") return CodeGraphVisibility.Private;
            if (text == "package") return CodeGraphVisibility.Internal;
            if (text == "remote") return CodeGraphVisibility.Public;
        }
        return null;
    }

    private static CodeGraphTsNode FindNamedChildOfType(CodeGraphTsNode node, string type)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (child.Type == type) return child;
        }
        return default;
    }

    // Strip one leading and one trailing quote (single or double), mirroring the
    // TS `.replace(/^["']|["']$/g, '')`.
    [GeneratedRegex("^[\"']|[\"']$")] private static partial Regex QuoteEdgeRegex();
}
