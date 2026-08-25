// =============================================================================
// CodeGraphHaskellExtractor — Haskell language config (tree-sitter-haskell).
//
// CodeGraph shipped no Haskell extractor — this is a fresh, minimal config. The
// grammar reuses the `function` node type for BOTH a value binding (`greet name =
// …`, a real top-level function) AND a function TYPE expression (`String -> String`
// inside a `signature`, or `a -> String` nested in another type). Only the binding
// is a symbol, so ResolveName returns a name ONLY for a `function` whose parent is
// not a `signature`/`function` (i.e. a real equation), reading its bound `variable`
// child; a type-expression `function` yields null and the engine's fallback (which
// does not recognize `variable`/`name` type nodes) skips it as anonymous.
//
// Other declarations map straight through by `name` field:
//   data_type  `data Color = …`  → class-like (a sum/product type)
//   class      `class Foo a …`   → interface (a typeclass ≈ interface/trait)
//   import     `import Data.List` → import (module child carries the module name)
// =============================================================================
internal static class CodeGraphHaskellExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function"],
        ClassTypes = ["data_type"],
        MethodTypes = [],
        InterfaceTypes = ["class"],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = ["type_synonym"],
        ImportTypes = ["import"],
        CallTypes = [],
        VariableTypes = [],
        InterfaceKind = CodeGraphNodeKind.Interface,
        NameField = "name",
        BodyField = "",
        ParamsField = "patterns",

        // Distinguish a `function` VALUE binding (a real symbol) from a `function` TYPE
        // expression (a type node reusing the same grammar rule). A type expr is always
        // nested under a `signature` or another `function`; a binding sits at the
        // declaration level. Only the binding names its bound `variable` child.
        ResolveName = (node, source) =>
        {
            if (node.Type != "function") return null; // let NameField handle data_type/class
            CodeGraphTsNode parent = node.Parent;
            if (!parent.IsNull && parent.Type is "signature" or "function")
                return null; // type expression — engine fallback yields <anonymous> → skipped
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (!child.IsNull && child.Type == "variable") return child.Text;
            }
            return null;
        },

        ExtractImport = (node, source) =>
        {
            CodeGraphTsNode module = node.ChildByField("module");
            if (module.IsNull)
            {
                int count = node.NamedChildCount;
                for (int i = 0; i < count; i++)
                {
                    CodeGraphTsNode child = node.NamedChild(i);
                    if (!child.IsNull && child.Type == "module") { module = child; break; }
                }
            }
            return module.IsNull ? null : new CodeGraphImportInfo(module.Text, node.Text.Trim());
        }
    };
}
