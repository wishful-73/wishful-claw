// =============================================================================
// CodeGraphBashExtractor — Bash / shell-script language config (tree-sitter-bash).
//
// CodeGraph shipped no bash extractor, so this is a fresh, minimal config for the
// TreeSitter.DotNet 1.3.0 bash grammar. A shell "symbol" is essentially a function:
//   function_definition   `foo() { … }` or `function foo { … }`
// The declaration's name is a bare `word` child (there is no `name` FIELD and `word`
// is not one of the engine's generic identifier fallbacks), so a ResolveName hook
// pulls the first `word` child. `source ./lib.sh` / variable assignments / commands
// are left unmodeled (MVP): every command is a call, so treating them as edges would
// be pure noise, and there is no cross-file bash symbol table to resolve them against.
// =============================================================================
internal static class CodeGraphBashExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_definition"],
        ClassTypes = [],
        MethodTypes = [],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = [],
        CallTypes = [],
        VariableTypes = [],
        NameField = "name",
        BodyField = "body",
        ParamsField = "",

        // function_definition's name is a bare `word` child (no `name` field, and
        // `word` isn't a generic identifier fallback) — take the first one.
        ResolveName = (node, source) =>
        {
            if (node.Type != "function_definition") return null;
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (!child.IsNull && child.Type == "word") return child.Text;
            }
            return null;
        }
    };
}
