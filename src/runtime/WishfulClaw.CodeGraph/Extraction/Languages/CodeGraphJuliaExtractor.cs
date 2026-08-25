// =============================================================================
// CodeGraphJuliaExtractor — Julia language config (tree-sitter-julia).
//
// CodeGraph shipped no Julia extractor — this is a fresh, minimal config. Julia
// buries the declared name a couple of levels down, so name resolution is a hook:
//   function_definition  `function greet(x) … end` → signature > call_expression > identifier
//   struct_definition    `struct Point … end`      → type_head > identifier  (Point{T} → Point)
//   abstract_definition  `abstract type Animal end` → type_head > identifier  (class-like base)
//   import/using         `import Base`              → identifier module name
// struct_definition has NO named body field (its `block` is an unnamed child), so the
// generic ExtractStruct — which requires ChildByField(bodyField) — can't see it; a
// VisitNode hook mints the struct node directly instead. Short-form `f(x) = …` (an
// `assignment`) and const/global bindings are left for the follow-up (the engine's
// variable extraction is driven off per-language branches).
// =============================================================================
internal static class CodeGraphJuliaExtractor
{
    public static readonly ICodeGraphLanguageExtractor Instance = new CodeGraphLanguageExtractor
    {
        FunctionTypes = ["function_definition"],
        ClassTypes = ["abstract_definition"],
        MethodTypes = [],
        InterfaceTypes = [],
        StructTypes = [],
        EnumTypes = [],
        TypeAliasTypes = [],
        ImportTypes = ["import_statement", "using_statement"],
        CallTypes = [],
        VariableTypes = [],
        NameField = "name",
        BodyField = "",
        ParamsField = "",

        ResolveName = (node, source) =>
        {
            switch (node.Type)
            {
                case "function_definition":
                {
                    // signature is a call_expression `greet(args)` (or a bare identifier
                    // for `function greet end`); the callee identifier is the name.
                    CodeGraphTsNode sig = FirstNamedChildOfType(node, "signature");
                    CodeGraphTsNode scope = sig.IsNull ? node : sig;
                    CodeGraphTsNode call = FirstNamedChildOfType(scope, "call_expression");
                    CodeGraphTsNode target = call.IsNull ? scope : call;
                    return FirstIdentifierText(target);
                }
                case "abstract_definition":
                {
                    CodeGraphTsNode head = FirstNamedChildOfType(node, "type_head");
                    return FirstIdentifierText(head.IsNull ? node : head);
                }
                default:
                    return null;
            }
        },

        // struct_definition has no named body field, so the generic ExtractStruct
        // (which keys off ChildByField(bodyField)) can't emit it — mint it here.
        VisitNode = (node, ctx) =>
        {
            if (node.Type != "struct_definition") return false;
            CodeGraphTsNode head = FirstNamedChildOfType(node, "type_head");
            string? name = FirstIdentifierText(head.IsNull ? node : head);
            if (name == null) return false;
            ctx.CreateNode(CodeGraphNodeKind.Struct, name, node);
            return true; // consumed — don't descend into fields (unmodeled in MVP)
        },

        ExtractImport = (node, source) =>
        {
            string text = node.Text.Trim();
            int count = node.NamedChildCount;
            for (int i = 0; i < count; i++)
            {
                CodeGraphTsNode child = node.NamedChild(i);
                if (child.IsNull) continue;
                if (child.Type is "identifier" or "importer_list" or "selected_import" or "scoped_identifier")
                {
                    string? id = FirstIdentifierText(child);
                    if (id != null) return new CodeGraphImportInfo(id, text);
                    if (!child.Text.Trim().Equals(string.Empty, StringComparison.Ordinal))
                        return new CodeGraphImportInfo(child.Text.Trim(), text);
                }
            }
            return null;
        }
    };

    private static CodeGraphTsNode FirstNamedChildOfType(CodeGraphTsNode node, string type)
    {
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (!child.IsNull && child.Type == type) return child;
        }
        return default;
    }

    // First `identifier` in a direct-child scan, else the first identifier found by a
    // shallow descent (covers `type_head` → `identifier` and parametric `Point{T}`).
    private static string? FirstIdentifierText(CodeGraphTsNode node)
    {
        if (node.IsNull) return null;
        if (node.Type == "identifier") return node.Text;
        int count = node.NamedChildCount;
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            if (!child.IsNull && child.Type == "identifier") return child.Text;
        }
        for (int i = 0; i < count; i++)
        {
            CodeGraphTsNode child = node.NamedChild(i);
            string? nested = FirstIdentifierText(child);
            if (nested != null) return nested;
        }
        return null;
    }
}
